/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Per-session hardening tests (TL3-002 items 3.1 + 3.2), pinned BOTH
 * directions:
 *
 *   3.1 User-agent discipline — agent sessions override the user agent via
 *       Emulation.setUserAgentOverride with the browser UA + the appended
 *       `FlauzAgent/<v>` product token (deterministic for a given base UA;
 *       the partition/session identity is NEVER embedded in the UA -- no
 *       workspace identity leaks into a request header). HUMAN sessions are
 *       never sent the override command at all (browser default preserved).
 *   3.2 Download policy — EVERY session (human and agent) sets
 *       Browser.setDownloadBehavior {behavior:'deny'} on open; v0 has NO
 *       allow surface.
 *
 * Fail-closed: a hardening command failure fails the session open with a
 * TYPED error (flauz.browser.tab.hardening) and the half-activated target is
 * closed browser-level (never a half-open, unhardened tab).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserPolicyEngine } from '../src/policy.ts';
import { CdpEndpointHost } from '../src/runtime/host.ts';
import { BrowserSessionManager, isNavigationOutcome } from '../src/runtime/sessionManager.ts';
import { FakeBrowserState, FakeCdpTransport } from '../src/cdp/fake.ts';
import {
        FLAUZ_AGENT_UA_TOKEN,
        flauzAgentUserAgent,
        isFlauzAgentUserAgent,
} from '../src/runtime/hardening.ts';

const WORKSPACE_ROOT = '/ws/acme';

const HARDENING_POLICY = JSON.stringify({
        schemaVersion: 0,
        driver: { allow: ['*.example.com'] },
        webRequest: { allow: ['*.example.com'] },
        willNavigate: { allow: ['*.example.com'] },
        partitions: { scope: 'persist', perAgent: true },
});

interface HardeningRig {
        state: FakeBrowserState;
        manager: BrowserSessionManager;
        transports: FakeCdpTransport[];
}

function rig(policyText: string = HARDENING_POLICY): HardeningRig {
        const state = new FakeBrowserState();
        const transports: FakeCdpTransport[] = [];
        const host = new CdpEndpointHost('ws://127.0.0.1:9222/devtools/browser/fake', {
                transportFactory: () => {
                        const transport = new FakeCdpTransport({ state, commandTimeoutMs: 500 });
                        transports.push(transport);
                        return transport;
                },
        });
        const manager = new BrowserSessionManager({
                engine: () => BrowserPolicyEngine.fromPolicyText(policyText),
                host,
                workspaceRoot: WORKSPACE_ROOT,
                commandTimeoutMs: 150,
                navigationTimeoutMs: 300,
        });
        return { state, manager, transports };
}

// #region 3.1 User-agent discipline

test('AGENT session: Emulation.setUserAgentOverride sent with the browser UA + the FlauzAgent product token', async () => {
        const hardeningRig = rig();
        const opened = await hardeningRig.manager.open({ initiator: 'agent', agentId: 'worker-1' });
        assert.equal(opened.descriptor.state, 'active');
        const targetId = opened.descriptor.tabs[0]?.targetId ?? '';
        const override = hardeningRig.state.userAgentOverrideOf(targetId);
        assert.ok(override !== undefined, 'the agent tab carries a UA override');
        // deterministic derivation: <base UA> + ' FlauzAgent/0' (the fake's base UA
        // is the Runtime.evaluate round-trip value):
        assert.equal(override, `flauz-fake-eval:navigator.userAgent ${FLAUZ_AGENT_UA_TOKEN}`);
        assert.ok(isFlauzAgentUserAgent(override), 'machine-checkable: the token is present as a UA product segment');
        // the command went through the session-scoped transport with exactly that payload:
        const commands = hardeningRig.transports[0]?.commandsOf('Emulation.setUserAgentOverride') ?? [];
        assert.equal(commands.length, 1);
        assert.deepEqual(commands[0]?.params, { userAgent: override });
        assert.ok(commands[0]?.sessionId !== undefined, 'session-scoped (flat protocol)');
        // no workspace/agent identity leaks into the UA (the partition stays off the wire):
        assert.ok(!override.includes(opened.descriptor.partition));
        assert.ok(!override.includes('worker-1'));
        await hardeningRig.manager.dispose();
});

test('HUMAN session: ZERO Emulation.setUserAgentOverride commands — the browser default is untouched', async () => {
        const hardeningRig = rig();
        const opened = await hardeningRig.manager.open({ initiator: 'human' });
        assert.equal(opened.descriptor.state, 'active');
        const targetId = opened.descriptor.tabs[0]?.targetId ?? '';
        assert.equal(hardeningRig.state.userAgentOverrideOf(targetId), undefined, 'no override recorded browser-side');
        const allTransports = hardeningRig.transports.flatMap(transport => transport.commandsOf('Emulation.setUserAgentOverride'));
        assert.equal(allTransports.length, 0, 'pinned: the human path never sends the override command');
        // and the agent path DOES (both directions in one rig):
        const agent = await hardeningRig.manager.open({ initiator: 'agent', agentId: 'worker-2' });
        assert.equal(hardeningRig.state.userAgentOverrideOf(agent.descriptor.tabs[0]?.targetId ?? '') !== undefined, true);
        await hardeningRig.manager.dispose();
});

test('flauzAgentUserAgent: appends the token exactly once (idempotent composition, whitespace-safe)', () => {
        assert.equal(flauzAgentUserAgent('Mozilla/5.0 (X11; Linux x86_64) Chrome/1.0'), `Mozilla/5.0 (X11; Linux x86_64) Chrome/1.0 ${FLAUZ_AGENT_UA_TOKEN}`);
        assert.equal(flauzAgentUserAgent('  spaced  '), `spaced ${FLAUZ_AGENT_UA_TOKEN}`, 'the base is trimmed');
        assert.equal(flauzAgentUserAgent(''), FLAUZ_AGENT_UA_TOKEN);
        assert.ok(isFlauzAgentUserAgent(flauzAgentUserAgent('base')));
        assert.ok(!isFlauzAgentUserAgent('Mozilla/5.0 (plain browser)'));
        assert.ok(!isFlauzAgentUserAgent('FlauzAgent/0-lookalike'), 'the token must be an exact segment, not a prefix');
});

// #endregion

// #region 3.2 Download policy (deny by default, every session)

test('EVERY session sets Browser.setDownloadBehavior {behavior:"deny"} on open (agent and human)', async () => {
        const hardeningRig = rig();
        const agent = await hardeningRig.manager.open({ initiator: 'agent', agentId: 'worker-1' });
        const human = await hardeningRig.manager.open({ initiator: 'human' });
        for (const opened of [agent, human]) {
                const targetId = opened.descriptor.tabs[0]?.targetId ?? '';
                assert.equal(hardeningRig.state.downloadBehaviorOf(targetId), 'deny', `${opened.descriptor.initiator} tab downloads denied`);
        }
        const commands = hardeningRig.transports.flatMap(transport => transport.commandsOf('Browser.setDownloadBehavior'));
        assert.equal(commands.length, 2, 'one deny per minted tab (agent + human)');
        for (const command of commands) {
                assert.deepEqual(command.params, { behavior: 'deny' });
                assert.ok(command.sessionId !== undefined, 'scoped to the session (flat protocol)');
        }
        await hardeningRig.manager.dispose();
});

// #endregion

// #region Fail-closed hardening

test('FAIL-CLOSED: a download-policy command failure fails the session open (typed error, target closed browser-level)', async () => {
        const state = new FakeBrowserState();
        const transports: FakeCdpTransport[] = [];
        const host = new CdpEndpointHost('ws://127.0.0.1:9222/devtools/browser/fake', {
                transportFactory: () => {
                        const transport = new FakeCdpTransport({ state, commandTimeoutMs: 500 });
                        transport.failCommand('Browser.setDownloadBehavior');
                        transports.push(transport);
                        return transport;
                },
        });
        const manager = new BrowserSessionManager({
                engine: () => BrowserPolicyEngine.fromPolicyText(HARDENING_POLICY),
                host,
                workspaceRoot: WORKSPACE_ROOT,
                commandTimeoutMs: 150,
                navigationTimeoutMs: 300,
        });
        const opened = await manager.open({ initiator: 'agent', agentId: 'worker-1' });
        assert.equal(opened.descriptor.state, 'failed', 'never a half-open unhardened session');
        assert.equal(opened.error?.code, 'flauz.browser.tab.hardening');
        assert.match(opened.error?.message ?? '', /Browser\.setDownloadBehavior/);
        // the target that failed activation was closed browser-level (no ungoverned tab lingers):
        const closeCommands = transports[0]?.commandsOf('Target.closeTarget') ?? [];
        assert.equal(closeCommands.length, 1, 'the half-activated target was closed immediately');
        await manager.dispose();
});

test('FAIL-CLOSED: a UA-override command failure fails the AGENT session open (typed error)', async () => {
        const state = new FakeBrowserState();
        const transports: FakeCdpTransport[] = [];
        const host = new CdpEndpointHost('ws://127.0.0.1:9222/devtools/browser/fake', {
                transportFactory: () => {
                        const transport = new FakeCdpTransport({ state, commandTimeoutMs: 500 });
                        transport.failCommand('Emulation.setUserAgentOverride');
                        transports.push(transport);
                        return transport;
                },
        });
        const manager = new BrowserSessionManager({
                engine: () => BrowserPolicyEngine.fromPolicyText(HARDENING_POLICY),
                host,
                workspaceRoot: WORKSPACE_ROOT,
                commandTimeoutMs: 150,
                navigationTimeoutMs: 300,
        });
        const agent = await manager.open({ initiator: 'agent', agentId: 'worker-1' });
        assert.equal(agent.descriptor.state, 'failed');
        assert.equal(agent.error?.code, 'flauz.browser.tab.hardening');
        assert.match(agent.error?.message ?? '', /Emulation\.setUserAgentOverride/);
        // the human path is unaffected by the UA fault (no override is ever sent):
        const human = await manager.open({ initiator: 'human' });
        assert.equal(human.descriptor.state, 'active', 'human sessions do not send the UA override, so the fault never fires');
        // navigation on the healthy human session still works end-to-end:
        const outcome = await manager.navigate(human.descriptor.sessionId, 'https://docs.example.com/ok');
        assert.ok(isNavigationOutcome(outcome) && outcome.sent);
        await manager.dispose();
});

// #endregion
