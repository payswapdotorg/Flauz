/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Popup / new-target gate tests (TL3-002 item 3.3 — the B1c class for
 * popups): every live tab auto-attaches to the page targets it creates
 * (Target.setAutoAttach, flatten, waitForDebuggerOnStart) and gates each new
 * target's URL through the policy engine with the SESSION's initiator class
 * BEFORE the target is used.
 *
 *   - a popup to a DENIED host never survives (closed immediately + an
 *     evidence row carrying the untrusted-content marker);
 *   - a popup to an ALLOWED host attaches as a tab of the session (hardened
 *     + gated like every other tab);
 *   - the gate consults the right layers per initiator class (the agent
 *     allowlist never gates human popups and vice versa);
 *   - fail-closed: a denied popup that cannot be closed fails the session.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserPolicyEngine } from '../src/policy.ts';
import { CdpEndpointHost } from '../src/runtime/host.ts';
import { BrowserSessionManager, isNavigationOutcome } from '../src/runtime/sessionManager.ts';
import { FakeBrowserState, FakeCdpTransport } from '../src/cdp/fake.ts';
import { UNTRUSTED_CONTENT_MARKER, isUntrustedContentNote } from '../src/runtime/capture.ts';

const WORKSPACE_ROOT = '/ws/acme';

const GATE_POLICY = JSON.stringify({
        schemaVersion: 0,
        driver: { allow: ['*.example.com'] },
        webRequest: { allow: ['*.example.com', 'humans.example.org'] },
        willNavigate: { allow: ['*.example.com', 'humans.example.org'], deny: ['blocked.example.com'] },
        partitions: { scope: 'persist', perAgent: true },
});

interface GateRig {
        state: FakeBrowserState;
        manager: BrowserSessionManager;
        transports: FakeCdpTransport[];
}

function rig(policyText: string = GATE_POLICY): GateRig {
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

test('every live tab auto-attaches (Target.setAutoAttach flatten + waitForDebuggerOnStart, page filter)', async () => {
        const gateRig = rig();
        const opened = await gateRig.manager.open({ initiator: 'agent', agentId: 'worker-1' });
        assert.equal(opened.descriptor.state, 'active');
        const commands = gateRig.transports[0]?.commandsOf('Target.setAutoAttach') ?? [];
        assert.equal(commands.length, 1, 'the initial tab is gated');
        const params = commands[0]?.params as Record<string, unknown>;
        assert.equal(params['autoAttach'], true);
        assert.equal(params['waitForDebuggerOnStart'], true, 'new targets pause BEFORE first use — the gate runs first');
        assert.equal(params['flatten'], true);
        assert.deepEqual(params['filter'], [{ type: 'page' }], 'scoped to page targets (the window.open/target=_blank class)');
        assert.ok(commands[0]?.sessionId !== undefined, 'session-scoped');
        await gateRig.manager.dispose();
});

test('a popup to a DENIED host never survives: closed immediately + evidence row with the untrusted-content marker', async () => {
        const gateRig = rig();
        const opened = await gateRig.manager.open({ initiator: 'agent', agentId: 'worker-1', startUrl: 'https://docs.example.com/page' });
        const sessionId = opened.descriptor.sessionId;
        const sourceTargetId = opened.descriptor.tabs[0]?.targetId ?? '';

        const popupTargetId = gateRig.transports[0]?.openPopupFrom(sourceTargetId, 'https://evil.org/popup');
        assert.ok(popupTargetId !== undefined, 'the popup was observed by the auto-attached session');
        await gateRig.manager.awaitPopupGate();

        // THE assertion: the denied popup target does not exist in the browser:
        assert.equal(gateRig.state.hasTarget(popupTargetId ?? ''), false, 'the denied popup never survives');
        // the denial is surfaced as a gate event + evidence row:
        const events = gateRig.manager.popupGateEvents();
        assert.equal(events.length, 1);
        const event = events[0];
        assert.equal(event.decision, 'deny');
        assert.equal(event.url, 'https://evil.org/popup');
        assert.equal(event.verdict.decision, 'deny');
        assert.equal(event.verdict.layer, 'driver', 'the agent path consults the driver allowlist');
        assert.equal(event.verdict.initiator, 'agent-tool', 'the SESSION initiator class gates the popup');
        assert.equal(event.closed, true);
        assert.equal(event.sessionId, sessionId);
        // the evidence row carries the machine-checkable untrusted-content marker:
        assert.ok(isUntrustedContentNote(event.evidenceRow.note), 'popup URLs are page-derived: the row note is marked');
        assert.match(event.evidenceRow.note, /^untrusted-content: deny\/driver agent-tool https:\/\/evil\.org\/popup/);
        assert.equal(event.evidenceRow.kind, 'note');
        assert.match(event.evidenceRow.sha256, /^[0-9a-f]{64}$/);
        // and ZERO Page.navigate was ever sent for the popup (the gate closes BEFORE use):
        assert.ok((gateRig.transports[0]?.pageNavigateCommands() ?? []).every(command => command.params['url'] !== 'https://evil.org/popup'));
        // the session is untouched by the denial (still active, still one tab):
        assert.equal(gateRig.manager.getSession(sessionId)?.state, 'active');
        assert.equal(gateRig.manager.getSession(sessionId)?.tabs.length, 1);
        await gateRig.manager.dispose();
});

test('a popup to an ALLOWED host attaches as a tab of the SAME session (hardened + gated like every tab)', async () => {
        const gateRig = rig();
        const opened = await gateRig.manager.open({ initiator: 'agent', agentId: 'worker-1', startUrl: 'https://docs.example.com/page' });
        const sessionId = opened.descriptor.sessionId;
        const sourceTargetId = opened.descriptor.tabs[0]?.targetId ?? '';

        gateRig.transports[0]?.openPopupFrom(sourceTargetId, 'https://docs.example.com/popup');
        await gateRig.manager.awaitPopupGate();

        const events = gateRig.manager.popupGateEvents();
        assert.equal(events.length, 1);
        assert.equal(events[0]?.decision, 'allow');
        assert.equal(events[0]?.verdict.decision, 'allow');
        assert.equal(events[0]?.attachedTabId !== undefined, true, 'the popup became a session tab');
        assert.equal(events[0]?.closed, undefined);
        assert.ok(isUntrustedContentNote(events[0]?.evidenceRow.note ?? ''), 'allow rows carry the marker too (page-derived URL)');

        // the popup is now a tab of the session (same partition ownership):
        const descriptor = gateRig.manager.getSession(sessionId);
        assert.equal(descriptor?.tabs.length, 2, 'source tab + the attached popup');
        const popupTab = descriptor?.tabs.find(tab => tab.tabId === events[0]?.attachedTabId);
        assert.ok(popupTab !== undefined);
        assert.equal(popupTab.url, 'https://docs.example.com/popup');
        assert.equal(popupTab.state, 'active');
        // hardened like every tab (agent session: UA override + download deny on the popup target):
        assert.equal(gateRig.state.downloadBehaviorOf(popupTab.targetId), 'deny');
        assert.ok(gateRig.state.userAgentOverrideOf(popupTab.targetId)?.includes('FlauzAgent/0'));
        // gated like every tab: the popup tab has its own auto-attach (nested popups gated too):
        const autoAttachCommands = (gateRig.transports[0]?.commandsOf('Target.setAutoAttach') ?? []).length;
        assert.equal(autoAttachCommands, 2, 'one gate per live tab (source + popup)');
        // and it is navigable through the policy pipeline:
        const outcome = await gateRig.manager.navigate(sessionId, 'https://docs.example.com/next', { tabId: popupTab.tabId });
        assert.ok(isNavigationOutcome(outcome));
        assert.equal(outcome.sent, true);
        assert.equal(outcome.tabId, popupTab.tabId);
        // foreign-session use of the POPUP tab is a typed error (ownership, item 3.5):
        const other = await gateRig.manager.open({ initiator: 'agent', agentId: 'worker-2' });
        const foreign = await gateRig.manager.navigate(other.descriptor.sessionId, 'https://docs.example.com/x', { tabId: popupTab.tabId });
        assert.ok(!isNavigationOutcome(foreign));
        assert.equal((foreign as { error: { code: string } }).error.code, 'flauz.browser.tab.cross-partition');
        await gateRig.manager.dispose();
});

test('the gate consults the SESSION initiator class: a HUMAN session popup is gated by willNavigate (agent allowlist never gates humans)', async () => {
        const gateRig = rig();
        const human = await gateRig.manager.open({ initiator: 'human', startUrl: 'https://docs.example.com/human-page' });
        const sourceTargetId = human.descriptor.tabs[0]?.targetId ?? '';

        // blocked.example.com is denied by a USER-path-only rule (willNavigate):
        gateRig.transports[0]?.openPopupFrom(sourceTargetId, 'https://blocked.example.com/popup');
        await gateRig.manager.awaitPopupGate();
        let events = gateRig.manager.popupGateEvents();
        assert.equal(events[0]?.decision, 'deny');
        assert.equal(events[0]?.verdict.layer, 'willNavigate', 'the human path consults willNavigate + webRequest');
        assert.equal(events[0]?.verdict.initiator, 'user');

        // humans.example.org is OUTSIDE the driver allowlist but allowed on the user path:
        gateRig.transports[0]?.openPopupFrom(sourceTargetId, 'https://humans.example.org/portal');
        await gateRig.manager.awaitPopupGate();
        events = gateRig.manager.popupGateEvents();
        assert.equal(events[1]?.decision, 'allow', 'the agent allowlist does not gate human popups');
        assert.equal(events[1]?.attachedTabId !== undefined, true);
        assert.equal(gateRig.manager.getSession(human.descriptor.sessionId)?.tabs.length, 2);
        // the human popup tab got the download deny but NO UA override:
        const popupTab = gateRig.manager.getSession(human.descriptor.sessionId)?.tabs.find(tab => tab.tabId === events[1]?.attachedTabId);
        assert.equal(gateRig.state.downloadBehaviorOf(popupTab?.targetId ?? ''), 'deny');
        assert.equal(gateRig.state.userAgentOverrideOf(popupTab?.targetId ?? ''), undefined);
        await gateRig.manager.dispose();
});

test('fail-closed: a denied popup that CANNOT be closed fails the session (never an ungoverned target)', async () => {
        const gateRig = rig();
        const opened = await gateRig.manager.open({ initiator: 'agent', agentId: 'worker-1', startUrl: 'https://docs.example.com/page' });
        const sessionId = opened.descriptor.sessionId;
        const sourceTargetId = opened.descriptor.tabs[0]?.targetId ?? '';

        // Script: every Target.closeTarget on the connection answers with an
        // error (the gate's deny close goes through the host's browser-level
        // closeTab -> Target.closeTarget).
        gateRig.transports[0]?.failCommand('Target.closeTarget');
        const popupTargetId = gateRig.transports[0]?.openPopupFrom(sourceTargetId, 'https://evil.org/popup');
        await gateRig.manager.awaitPopupGate();

        assert.ok(popupTargetId !== undefined);
        const descriptor = gateRig.manager.getSession(sessionId);
        assert.equal(descriptor?.state, 'failed', 'an ungovernable denied target fails the session (fail-closed)');
        assert.equal(descriptor?.error?.code, 'flauz.browser.popup-gate');
        assert.match(descriptor?.error?.message ?? '', /could not close denied target/);
        const event = gateRig.manager.popupGateEvents()[0];
        assert.equal(event.decision, 'deny');
        assert.equal(event.closed, false);
        assert.match(event.closeError ?? '', /scripted failure: Target\.closeTarget/);
        // the evidence row still exists (the attempt is ledgered even on close failure):
        assert.ok(isUntrustedContentNote(event.evidenceRow.note));
        await gateRig.manager.dispose();
});

test('the gate is observable via onPopupGate and the audit log is ordered', async () => {
        const gateRig = rig();
        const seen: string[] = [];
        gateRig.manager.onPopupGate(event => seen.push(`${event.decision}:${event.url}`));
        const opened = await gateRig.manager.open({ initiator: 'agent', agentId: 'worker-1', startUrl: 'https://docs.example.com/page' });
        const sourceTargetId = opened.descriptor.tabs[0]?.targetId ?? '';
        gateRig.transports[0]?.openPopupFrom(sourceTargetId, 'https://evil.org/one');
        gateRig.transports[0]?.openPopupFrom(sourceTargetId, 'https://docs.example.com/two');
        await gateRig.manager.awaitPopupGate();
        assert.deepEqual(seen, ['deny:https://evil.org/one', 'allow:https://docs.example.com/two']);
        assert.deepEqual(gateRig.manager.popupGateEvents().map(event => `${event.decision}:${event.url}`), seen);
        await gateRig.manager.dispose();
});

test('the marker discipline: gate rows carry the boundary marker constant exactly', async () => {
        const gateRig = rig();
        const opened = await gateRig.manager.open({ initiator: 'agent', agentId: 'worker-1', startUrl: 'https://docs.example.com/page' });
        const sourceTargetId = opened.descriptor.tabs[0]?.targetId ?? '';
        gateRig.transports[0]?.openPopupFrom(sourceTargetId, 'https://evil.org/marked');
        await gateRig.manager.awaitPopupGate();
        const note = gateRig.manager.popupGateEvents()[0]?.evidenceRow.note ?? '';
        assert.ok(note.startsWith(UNTRUSTED_CONTENT_MARKER));
        assert.ok(isUntrustedContentNote(note));
        await gateRig.manager.dispose();
});
