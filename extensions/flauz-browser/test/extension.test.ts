/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Extension wiring (src/extension.ts) under the fidelity-mapped vscode mock:
 * activation loads the workspace policy (fail-closed on missing/broken
 * files), registers the command surface, watches the policy file, and the
 * commands behave observably (log lines + return values).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importWithVscodeMock } from './harness/vscode-redirect.ts';
import { __configure, __reset, __state } from './harness/vscode-mock-module.ts';
import type { MockVscodeState } from './harness/vscode-mock.ts';

interface ExtensionModule {
        activate(context: { subscriptions: Array<{ dispose(): void }> }): Promise<void>;
        deactivate(): void;
}

async function bootExtension(): Promise<ExtensionModule> {
        return importWithVscodeMock<ExtensionModule>(new URL('../src/extension.ts', import.meta.url));
}

function channelLines(state: MockVscodeState): string[] {
        const channel = state.outputChannels.find(c => c.name === 'Flauz Browser Policy');
        return channel === undefined ? [] : channel.lines;
}

function commandHandler(name: string): (...args: unknown[]) => unknown {
        const record = __state().commands.find(c => c.command === name);
        assert.ok(record !== undefined, `command '${name}' must be registered`);
        return record.handler;
}

async function freshActivate(policyText: string | undefined): Promise<ExtensionModule> {
        __reset();
        if (policyText !== undefined) {
                __configure({ fsFiles: new Map<string, string>([['/ws/acme/.flauz/browser-policy.json', policyText]]) });
        } else {
                __configure({ fsFiles: new Map<string, string>() });
        }
        const extension = await bootExtension();
        await extension.activate({ subscriptions: [] });
        return extension;
}

test('activation with a valid policy file logs the effective policy (canary grep target)', async () => {
        const extension = await freshActivate('{"schemaVersion":0,"driver":{"allow":["*.example.com"],"deny":["evil.example.com"]}}');
        const lines = channelLines(__state());
        assert.ok(lines.some(l => l.includes('flauz.browser: effective policy flauz.browser-policy/v0 source=workspace-file schemaVersion=0')), 'effective-policy line');
        assert.ok(lines.some(l => l.includes('flauz.browser: layer driver: enabled=true allow=1 deny=1 fileRoots=0')), 'driver layer line');
        assert.ok(lines.some(l => l.includes('flauz.browser: partitions scope=persist perAgent=false')), 'partitions line');
        void extension.deactivate();
});

test('activation with a missing policy file logs the deny-all default (fail-closed)', async () => {
        const extension = await freshActivate(undefined);
        const lines = channelLines(__state());
        assert.ok(lines.some(l => l.includes('source=builtin-default')), 'builtin-default source');
        assert.ok(lines.some(l => l.includes('no .flauz/browser-policy.json found')), 'missing-file warning');
        void extension.deactivate();
});

test('activation with a broken policy file logs INVALID + code and stays fail-closed', async () => {
        const extension = await freshActivate('{"schemaVersion":0,"nope":1}');
        const lines = channelLines(__state());
        assert.ok(lines.some(l => l.includes('policy file INVALID (FLAUZ_POLICY_SCHEMA)')), 'INVALID line with code');
        assert.ok(lines.some(l => l.includes('deny-all builtin default in effect (fail-closed)')), 'fail-closed note');
        // the deny-all default is actually in effect:
        const verdict = commandHandler('flauz.browser.evaluate')({ url: 'https://anything.example.com/' }) as { decision: string };
        assert.equal(verdict.decision, 'deny');
        void extension.deactivate();
});

test('activation registers the five flauz.browser.* commands', async () => {
        const extension = await freshActivate('{"schemaVersion":0}');
        const names = __state().commands.map(c => c.command);
        assert.deepEqual(names.sort(), [
                'flauz.browser.checkUrl',
                'flauz.browser.evaluate',
                'flauz.browser.setPolicy',
                'flauz.browser.showPolicy',
                'flauz.browser.verifyPolicy',
        ].sort());
        void extension.deactivate();
});

test('activation watches the policy file and hot-reloads on change', async () => {
        const extension = await freshActivate('{"schemaVersion":0}');
        const state = __state();
        assert.equal(state.watchers.length, 1);
        assert.equal(state.watchers[0]?.pattern, '.flauz/browser-policy.json');
        // simulate an on-disk change through the mock fs + watcher callback:
        state.fsFiles.set('/ws/acme/.flauz/browser-policy.json', '{"schemaVersion":0,"driver":{"allow":["*.example.com"]}}');
        (state.watchers[0]?.changeHandlers ?? []).forEach(handler => handler());
        await new Promise<void>(resolve => queueMicrotask(() => resolve()));
        // give the async reload a tick to land:
        await new Promise<void>(resolve => setTimeout(() => resolve(), 0));
        assert.ok(channelLines(state).some(l => l.includes('policy file changed on disk; reloaded (source=workspace-file)')), 'reload line');
        const verdict = commandHandler('flauz.browser.evaluate')({ url: 'https://docs.example.com/' }) as { decision: string; layer: string };
        // webRequest still deny-all (only driver has the allowlist), so overall deny but at webRequest:
        assert.equal(verdict.decision, 'deny');
        assert.equal(verdict.layer, 'webRequest');
        void extension.deactivate();
});

test('flauz.browser.evaluate: machine surface returns the combined verdict object', async () => {
        const extension = await freshActivate('{"schemaVersion":0,"driver":{"allow":["*.example.com"]}}');
        const verdict = commandHandler('flauz.browser.evaluate')({ url: 'https://docs.example.com/x', initiator: 'agent-tool' }) as Record<string, unknown>;
        assert.equal(verdict['decision'], 'deny'); // webRequest deny-all carries it
        assert.equal(verdict['layer'], 'webRequest');
        assert.equal(verdict['url'], 'https://docs.example.com/x');
        assert.equal(verdict['initiator'], 'agent-tool');
        const user = commandHandler('flauz.browser.evaluate')({ url: 'https://docs.example.com/x', initiator: 'user' }) as Record<string, unknown>;
        assert.equal(user['layer'], 'willNavigate');
        // argument validation:
        assert.equal((commandHandler('flauz.browser.evaluate')('nonsense') as { error: string }).error.includes('expected an argument object'), true);
        assert.equal((commandHandler('flauz.browser.evaluate')({}) as { error: string }).error.includes('url must be a non-empty string'), true);
        void extension.deactivate();
});

test('flauz.browser.evaluate derives the partition from the workspace when none is given', async () => {
        const extension = await freshActivate('{"schemaVersion":0,"driver":{"allow":["*.example.com"],"fileRoots":[".flauz"]}}');
        const verdict = commandHandler('flauz.browser.evaluate')({ url: 'file:///ws/acme/.flauz/artifacts/T-001/shot.png' }) as Record<string, unknown>;
        assert.equal(verdict['decision'], 'allow');
        assert.match(String(verdict['partition']), /^persist:flauz-[0-9a-f]{16}$/);
        void extension.deactivate();
});

test('flauz.browser.checkUrl logs both initiator paths and returns both verdicts', async () => {
        const extension = await freshActivate('{"schemaVersion":0,"driver":{"allow":["*.example.com"]}}');
        const result = await (commandHandler('flauz.browser.checkUrl')('https://evil.org/pay') as Promise<{ agentTool: { decision: string; layer: string }; user: { decision: string; layer: string } }>);
        assert.equal(result.agentTool.decision, 'deny');
        assert.equal(result.agentTool.layer, 'driver');
        assert.equal(result.user.decision, 'deny');
        assert.equal(result.user.layer, 'willNavigate');
        const lines = channelLines(__state());
        assert.ok(lines.some(l => l.includes('flauz.browser: agent-tool path: deny driver https://evil.org/pay')), 'agent-tool log line');
        assert.ok(lines.some(l => l.includes('flauz.browser: user path:         deny willNavigate https://evil.org/pay')), 'user log line');
        void extension.deactivate();
});

test('flauz.browser.verifyPolicy reports PASS on a valid file and FAIL with code+path on a broken one', async () => {
        const extension = await freshActivate('{"schemaVersion":0,"driver":{"allow":["*.example.com"]}}');
        const pass = await (commandHandler('flauz.browser.verifyPolicy')() as Promise<{ ok: boolean }>);
        assert.equal(pass.ok, true);
        assert.ok(channelLines(__state()).some(l => l.includes('verifyPolicy: PASS')));

        __state().fsFiles.set('/ws/acme/.flauz/browser-policy.json', '{"schemaVersion":0,"driver":{"enabled":"yes"}}');
        const fail = await (commandHandler('flauz.browser.verifyPolicy')() as Promise<{ ok: boolean; error?: { code: string; path: string } }>);
        assert.equal(fail.ok, false);
        assert.equal(fail.error?.code, 'FLAUZ_POLICY_SCHEMA');
        assert.equal(fail.error?.path, 'driver.enabled');
        assert.ok(channelLines(__state()).some(l => l.includes('verifyPolicy: FAIL FLAUZ_POLICY_SCHEMA at driver.enabled')));
        void extension.deactivate();
});

test('flauz.browser.setPolicy creates the deny-all starter template when the file is absent', async () => {
        const extension = await freshActivate(undefined);
        const state = __state();
        await commandHandler('flauz.browser.setPolicy')();
        assert.ok(state.createdDirectories.some(p => p === '/ws/acme/.flauz'));
        const written = state.writtenFiles.find(w => w.path === '/ws/acme/.flauz/browser-policy.json');
        assert.ok(written !== undefined, 'template written');
        assert.equal(written?.text, JSON.stringify({ driver: {}, partitions: { perAgent: false, scope: 'persist' }, schemaVersion: 0, webRequest: {}, willNavigate: {} }, null, 2) + '\n');
        assert.ok(state.openedDocuments.includes('/ws/acme/.flauz/browser-policy.json'));
        assert.ok(state.shownDocuments.includes('/ws/acme/.flauz/browser-policy.json'));
        void extension.deactivate();
});

test('flauz.browser.showPolicy re-dumps the effective policy', async () => {
        const extension = await freshActivate('{"schemaVersion":0,"webRequest":{"allow":["*.example.com"]}}');
        const before = channelLines(__state()).length;
        commandHandler('flauz.browser.showPolicy')();
        assert.ok(channelLines(__state()).length > before);
        assert.ok(channelLines(__state()).some(l => l.includes('flauz.browser: layer webRequest: enabled=true allow=1 deny=0')));
        void extension.deactivate();
});

test('activation without a workspace folder degrades gracefully (commands still registered)', async () => {
        __reset({ workspaceFolders: undefined, fsFiles: new Map<string, string>() });
        const extension = await bootExtension();
        await extension.activate({ subscriptions: [] });
        const lines = channelLines(__state());
        assert.ok(lines.some(l => l.includes('no workspace folder open')));
        assert.equal(__state().watchers.length, 0);
        assert.equal(__state().commands.length, 5);
        const verdict = commandHandler('flauz.browser.evaluate')({ url: 'https://x.org/' }) as Record<string, unknown>;
        assert.equal(verdict['decision'], 'deny');
        assert.equal(verdict['partition'], '');
        void extension.deactivate();
});
