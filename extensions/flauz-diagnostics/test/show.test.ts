/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * A-PROD-004-W1 -- the COMMAND-SURFACE suite: `flauz.diag.show` (renders the
 * diagnostics surface into the output channel, creates nothing) and the
 * `flauz.diag.bundle` disclosure law (the enumeration is rendered BEFORE the
 * bundle is created).
 *
 * The commands run against their real registration path: a vscode-API shim
 * records registerCommand calls (the services are injected ports, the
 * flauz-memory commands-test pattern).
 */

import assert from 'node:assert/strict';

import type * as vscode from 'vscode';
import { setVscodeApi } from '../src/globals.ts';
import { COMMAND_IDS, registerDiagnosticsCommands, renderDiagnostics, type DiagnosticsCommandServices } from '../src/commands.ts';
import { collectDiagnostics } from '../src/census.ts';
import { bootFixtureWorkspace, listBundleDirs, type FixtureWorkspace } from './helpers.ts';

/** The vscode-API shim: records registered commands + disposables. */
function vscodeShim(): { registered: Map<string, (arg: unknown) => Promise<unknown>>; disposables: unknown[] } {
        const registered = new Map<string, (arg: unknown) => Promise<unknown>>();
        const disposables: unknown[] = [];
        const shim = {
                commands: {
                        registerCommand(id: string, handler: (arg: unknown) => Promise<unknown>): object {
                                registered.set(id, handler);
                                return { dispose(): void { /* recorded via the array below */ } };
                        },
                },
        };
        setVscodeApi(shim as unknown as typeof vscode);
        return { registered, disposables };
}

suite('commands: flauz.diag.show + the disclosure law', () => {
        let fixture: FixtureWorkspace;
        let lines: string[];

        suiteSetup(async () => {
                fixture = await bootFixtureWorkspace();
        });

        suiteTeardown(async () => {
                await fixture.cleanup();
        });

        setup(() => {
                lines = [];
        });

        function services(): DiagnosticsCommandServices {
                return {
                        fs: fixture.fs,
                        clock: fixture.clock,
                        channel: { appendLine: line => { lines.push(line); } },
                        getWorkspaceRoot: () => fixture.root,
                        versions: () => ({ productVersion: '0.1.0', productName: 'Flauz', extensions: [{ id: 'flauz.flauz-diagnostics', version: '0.1.0' }] }),
                        environment: () => ({ nodeVersion: '24.21.0', platform: 'linux', arch: 'x64' }),
                };
        }

        test('flauz.diag.show renders the census into the channel and creates NO bundle', async () => {
                const { registered } = vscodeShim();
                registerDiagnosticsCommands(services());
                assert.ok(registered.has('flauz.diag.show'));
                const handler = registered.get('flauz.diag.show') as (arg: unknown) => Promise<unknown>;
                const result = await handler(undefined) as { ok: boolean; diagnostics: Record<string, unknown> };
                assert.strictEqual(result.ok, true);
                assert.ok(lines.some(line => line.includes('Flauz Diagnostics')), 'the header renders');
                assert.ok(lines.some(line => line.includes('.flauz/tasks.json')), 'the tasks census row renders');
                assert.ok(lines.some(line => line.includes('.flauz/evidence/ledger.jsonl')), 'the ledger census row renders');
                assert.ok(lines.some(line => line.includes('rowCount=')), 'counts render');
                assert.ok(lines.some(line => line.includes('node ')), 'the environment renders');
                const bundles = await listBundleDirs(fixture.root);
                assert.deepStrictEqual(bundles, [], 'show created no bundle');
        });

        test('flauz.diag.show degrades honestly without a workspace folder (typed result, channel notice, no throw)', async () => {
                const { registered } = vscodeShim();
                registerDiagnosticsCommands({ ...services(), getWorkspaceRoot: () => undefined });
                const handler = registered.get('flauz.diag.show') as (arg: unknown) => Promise<unknown>;
                const result = await handler(undefined) as { ok: boolean; code: string };
                assert.strictEqual(result.ok, false);
                assert.strictEqual(result.code, 'FLAUZ_DIAG_NO_WORKSPACE');
                assert.ok(lines.some(line => line.includes('no workspace folder open')));
        });

        test('flauz.diag.bundle renders the full disclosure BEFORE creating the bundle', async () => {
                const { registered } = vscodeShim();
                registerDiagnosticsCommands(services());
                const handler = registered.get('flauz.diag.bundle') as (arg: unknown) => Promise<unknown>;
                const result = await handler(undefined) as { ok: boolean; path: string };
                assert.strictEqual(result.ok, true);
                // the disclosure came first: the enumeration lines precede the created-at line
                const disclosureIndex = lines.findIndex(line => line.includes('it will contain'));
                const createdIndex = lines.findIndex(line => line.includes('bundle created at'));
                assert.ok(disclosureIndex >= 0, 'the disclosure header renders');
                assert.ok(createdIndex > disclosureIndex, 'the disclosure precedes the creation notice');
                // every artifact class is named with its file
                for (const marker of ['MANIFEST.json', 'diagnostics.json', 'provider-lanes.json', 'recent-events.json', 'integrity.json']) {
                        assert.ok(lines.some(line => line.includes(marker)), `the disclosure names ${String(marker)}`);
                }
                // the refusal is part of the disclosure
                assert.ok(lines.some(line => line.includes('[REFUSED ] contents')), 'the disclosure names the refused class');
        });

        test('flauz.diag.bundle refuses contents through the command surface with the typed error and no bundle', async () => {
                const { registered } = vscodeShim();
                registerDiagnosticsCommands(services());
                const handler = registered.get('flauz.diag.bundle') as (arg: unknown) => Promise<unknown>;
                const before = await listBundleDirs(fixture.root);
                await assert.rejects(handler({ include: ['contents'] }), (err: unknown) => {
                        assert.ok(String((err as Error).message).includes('REFUSED in a v0 support bundle'));
                        return true;
                });
                assert.deepStrictEqual(await listBundleDirs(fixture.root), before, 'the refusal created no bundle');
        });

        test('the command surface registers exactly the two contributed commands (the activation contract)', () => {
                const { registered } = vscodeShim();
                registerDiagnosticsCommands(services());
                assert.deepStrictEqual([...registered.keys()].sort(), [...COMMAND_IDS].sort());
        });

        test('renderDiagnostics never prints file contents (counts, hashes, paths and ids only)', async () => {
                const snapshot = await collectDiagnostics({
                        root: fixture.root,
                        fs: fixture.fs,
                        clock: fixture.clock,
                        versions: { productVersion: '0.1.0', productName: 'Flauz', extensions: [] },
                        environment: { nodeVersion: '24.21.0', platform: 'linux', arch: 'x64' },
                });
                const rendered = renderDiagnostics(snapshot).join('\n');
                // the fixture's real titles/outputs are contents -- they must not render
                assert.ok(!rendered.includes('Diagnose the flaky provider lane'), 'task titles never render');
                assert.ok(!rendered.includes('ordinary step output'), 'step outputs never render');
                assert.ok(!rendered.includes('the diagnostics fixture graph'), 'graph titles never render');
                // the metadata does
                assert.ok(rendered.includes('.flauz/tasks.json'));
                assert.ok(rendered.includes('rowCount=2'));
        });
});
