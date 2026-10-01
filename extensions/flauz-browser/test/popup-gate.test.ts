/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Popup / new-target gate tests (TL3-002 item 3.3 — the B1c class for
 * popups — RE-PINNED by P2-FIX-106 to the DL-79 contract): the gate is
 * placed at BROWSER-level auto-attach (Target.setAutoAttach with
 * waitForDebuggerOnStart at the browser scope — the only placement real
 * Chromium delivers window.open targets to; drill finding F-DELIVERY),
 * a held target is attributed by targetInfo.openerId, and a session
 * opener's popup has its pending destination observed PRE-USE through the
 * Fetch domain (the FIRST Fetch.requestPaused — targetInfo.url is EMPTY at
 * attach on real Chromium, drill finding F-POPUP-URL) and policy-checked
 * with the OPENER session's initiator class.
 *
 *   - a popup to a DENIED host is aborted BEFORE the wire
 *     (Fetch.failRequest) and destroyed before use (Target.closeTarget):
 *     zero committed loads, an evidence row carrying the untrusted-content
 *     marker, observedUrl + openerId on the event;
 *   - a popup to an ALLOWED host is released, its navigation resumes
 *     (Fetch.disable) and it attaches as a tab of the session (hardened +
 *     gated like every other tab — nested popups too);
 *   - no-URL popups (window.open() with no destination) and non-session
 *     openers are released immediately on opener attribution (no
 *     indefinite hold is lawful — drill finding F-OPENER-BLOCK);
 *   - the gate consults the right layers per initiator class (the agent
 *     allowlist never gates human popups and vice versa);
 *   - fail-closed: a denied popup that cannot be closed fails the session;
 *   - the per-tab page-session auto-attach stays for tab-scoped session
 *     work (the DL-79 scope guard — unchanged shape).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserPolicyEngine } from '../src/policy.ts';
import { CdpEndpointHost } from '../src/runtime/host.ts';
import { BrowserSessionManager, isNavigationOutcome } from '../src/runtime/sessionManager.ts';
import { FakeBrowserState, FakeCdpTransport } from '../src/cdp/fake.ts';
import type { CdpParams } from '../src/cdp/transport.ts';
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

function rig(policyText: string = GATE_POLICY, options: { noUrlPopupWindowMs?: number } = {}): GateRig {
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
		noUrlPopupWindowMs: options.noUrlPopupWindowMs,
	});
	return { state, manager, transports };
}

/** One root-delivered Target.attachedToTarget (the raw wire shape the re-modeled fake delivers). */
interface ObservedAttach {
	readonly targetId: string;
	readonly url: string;
	readonly openerId: string | undefined;
	readonly waitingForDebugger: boolean;
	readonly rootScope: boolean;
	readonly sessionId: string;
}

/** Records every root-delivered Target.attachedToTarget on the first transport (the raw wire shape). */
function observeAttaches(gateRig: GateRig): ObservedAttach[] {
	const attaches: ObservedAttach[] = [];
	gateRig.transports[0]?.on('Target.attachedToTarget', (params: CdpParams, scopeSessionId: string | undefined) => {
		const info = params.targetInfo as { targetId?: unknown; url?: unknown; openerId?: unknown } | undefined;
		attaches.push({
			targetId: typeof info?.targetId === 'string' ? info.targetId : '',
			url: typeof info?.url === 'string' ? info.url : '',
			openerId: typeof info?.openerId === 'string' ? info.openerId : undefined,
			waitingForDebugger: params.waitingForDebugger === true,
			rootScope: scopeSessionId === undefined,
			sessionId: typeof params.sessionId === 'string' ? params.sessionId : '',
		});
	});
	return attaches;
}

/** The held (auto-attach) session id for the popup a given opener created, from the raw attach delivery. */
function heldSessionOf(attaches: readonly ObservedAttach[], openerTargetId: string): string {
	const attach = attaches.find(entry => entry.openerId === openerTargetId && entry.waitingForDebugger && entry.rootScope);
	return attach?.sessionId ?? '';
}

test('P2-FIX-106: the popup gate is placed at BROWSER level (root-scope Target.setAutoAttach, flatten + waitForDebuggerOnStart + page filter); the per-tab page-session auto-attach stays for tab-scoped session work (DL-79 scope guard)', async () => {
	const gateRig = rig();
	const opened = await gateRig.manager.open({ initiator: 'agent', agentId: 'worker-1' });
	assert.equal(opened.descriptor.state, 'active');
	const commands = gateRig.transports[0]?.commandsOf('Target.setAutoAttach') ?? [];
	const browserScope = commands.filter(command => command.sessionId === undefined);
	assert.equal(browserScope.length, 1, 'ONE browser-scope gate per connection (the DL-79 placement — the only placement real Chromium delivers window.open targets to)');
	const params = browserScope[0]?.params as Record<string, unknown>;
	assert.equal(params.autoAttach, true);
	assert.equal(params.waitForDebuggerOnStart, true, 'new targets pause BEFORE first use — the gate runs first');
	assert.equal(params.flatten, true);
	assert.deepEqual(params.filter, [{ type: 'page' }], 'scoped to page targets (the window.open/target=_blank class)');
	const tabScoped = commands.filter(command => command.sessionId !== undefined);
	assert.equal(tabScoped.length, 1, 'the per-tab page-session auto-attach keeps its landed shape (tab-scoped session work — unchanged)');
	const tabParams = tabScoped[0]?.params as Record<string, unknown>;
	assert.equal(tabParams.autoAttach, true);
	assert.equal(tabParams.waitForDebuggerOnStart, true);
	assert.equal(tabParams.flatten, true);
	await gateRig.manager.dispose();
});

test('P2-FIX-106 (F-DELIVERY flipped): a popup to a DENIED host is intercepted at browser level — DENY event with observedUrl + openerId, request aborted BEFORE the wire, target destroyed (zero committed loads)', async () => {
	const gateRig = rig();
	const opened = await gateRig.manager.open({ initiator: 'agent', agentId: 'worker-1', startUrl: 'https://docs.example.com/page' });
	const sessionId = opened.descriptor.sessionId;
	const sourceTargetId = opened.descriptor.tabs[0]?.targetId ?? '';

	const popupTargetId = gateRig.transports[0]?.openPopupFrom(sourceTargetId, 'https://evil.org/popup');
	assert.ok(popupTargetId !== undefined, 'the popup was observed by the browser-level gate (F-DELIVERY fixed at the new placement)');
	await gateRig.manager.awaitPopupGate();

	// THE assertion: the denied popup target does not exist in the browser:
	assert.equal(gateRig.state.hasTarget(popupTargetId ?? ''), false, 'the denied popup never survives');
	// the denial is surfaced as a gate event + evidence row:
	const events = gateRig.manager.popupGateEvents();
	assert.equal(events.length, 1);
	const event = events[0];
	assert.equal(event.decision, 'deny');
	assert.equal(event.observedUrl, 'https://evil.org/popup', 'the observed destination (the first Fetch.requestPaused)');
	assert.equal(event.url, event.observedUrl, 'the legacy url field carries the OBSERVED URL (DL-79)');
	assert.equal(event.openerId, sourceTargetId, 'opener attribution (DL-79 additive field)');
	assert.equal(event.verdict.decision, 'deny');
	assert.equal(event.verdict.layer, 'driver', 'the agent path consults the driver allowlist');
	assert.equal(event.verdict.initiator, 'agent-tool', 'the OPENER SESSION initiator class gates the popup');
	assert.equal(event.closed, true);
	assert.equal(event.sessionId, sessionId);
	// the evidence row carries the machine-checkable untrusted-content marker:
	assert.ok(isUntrustedContentNote(event.evidenceRow.note), 'popup URLs are page-derived: the row note is marked');
	assert.match(event.evidenceRow.note, /^untrusted-content: deny\/driver agent-tool https:\/\/evil\.org\/popup/);
	assert.equal(event.evidenceRow.kind, 'note');
	assert.match(event.evidenceRow.sha256, /^[0-9a-f]{64}$/);
	// the deny wire order: Fetch.failRequest (abort BEFORE the wire) PRECEDES Target.closeTarget (destroy before use):
	const failRequest = gateRig.transports[0]?.commandsOf('Fetch.failRequest') ?? [];
	assert.equal(failRequest.length, 1, 'the paused request is aborted before the wire');
	assert.equal((failRequest[0]?.params as { errorReason?: unknown }).errorReason, 'BlockedByClient');
	assert.ok(failRequest[0]?.sessionId !== undefined, 'session-scoped to the held popup session');
	const popupClose = (gateRig.transports[0]?.commandsOf('Target.closeTarget') ?? [])
		.find(command => (command.params as { targetId?: unknown }).targetId === popupTargetId);
	assert.ok(popupClose !== undefined, 'the held target is destroyed');
	assert.ok(failRequest[0] !== undefined && popupClose.seq > failRequest[0].seq, 'abort-before-the-wire precedes destroy-before-use');
	// and ZERO Page.navigate was ever sent for the popup (the gate closes BEFORE use):
	assert.ok((gateRig.transports[0]?.pageNavigateCommands() ?? []).every(command => command.params.url !== 'https://evil.org/popup'));
	// the session is untouched by the denial (still active, still one tab):
	assert.equal(gateRig.manager.getSession(sessionId)?.state, 'active');
	assert.equal(gateRig.manager.getSession(sessionId)?.tabs.length, 1);
	await gateRig.manager.dispose();
});

test('P2-FIX-106 (F-POPUP-URL flipped): the attach delivers url EMPTY + openerId at ROOT scope (the pinned real-Chromium facts) and the gate observes the destination PRE-USE via the first Fetch.requestPaused', async () => {
	const gateRig = rig();
	const opened = await gateRig.manager.open({ initiator: 'agent', agentId: 'worker-1', startUrl: 'https://docs.example.com/page' });
	const sourceTargetId = opened.descriptor.tabs[0]?.targetId ?? '';
	const attaches = observeAttaches(gateRig);

	const popupTargetId = gateRig.transports[0]?.openPopupFrom(sourceTargetId, 'https://evil.org/popup');
	await gateRig.manager.awaitPopupGate();

	const attach = attaches.find(entry => entry.targetId === popupTargetId && entry.openerId === sourceTargetId);
	assert.ok(attach !== undefined, 'the popup attach was delivered');
	assert.equal(attach.url, '', 'F-POPUP-URL (pinned real-Chromium fact): targetInfo.url is EMPTY STRING at attach — the pending destination is NOT available at gate time');
	assert.equal(attach.waitingForDebugger, true, 'the popup arrives HELD (waitForDebuggerOnStart)');
	assert.equal(attach.rootScope, true, 'F-DELIVERY (pinned): the attach is delivered at BROWSER scope (root) — page sessions receive nothing');
	// and the gate still got the URL — observed pre-use at FIRST-request time:
	const event = gateRig.manager.popupGateEvents()[0];
	assert.equal(event.decision, 'deny');
	assert.equal(event.observedUrl, 'https://evil.org/popup', 'F-POPUP-URL FLIPPED: the gate observed the pending destination via the first Fetch.requestPaused');
	// the arm-before-release sequencing (the race discipline: released before arming, the destination would slip past ungated):
	const heldSessionId = heldSessionOf(attaches, sourceTargetId);
	assert.ok(heldSessionId !== '');
	const fetchEnable = (gateRig.transports[0]?.commandsOf('Fetch.enable') ?? []).find(command => command.sessionId === heldSessionId);
	const release = (gateRig.transports[0]?.commandsOf('Runtime.runIfWaitingForDebugger') ?? []).find(command => command.sessionId === heldSessionId);
	assert.ok(fetchEnable !== undefined && release !== undefined, 'interception armed + hold released on the held session');
	assert.ok(fetchEnable.seq < release.seq, 'interception is armed BEFORE the hold is released');
	await gateRig.manager.dispose();
});

test('P2-FIX-106: a popup to an ALLOWED host is released + attaches as a tab of the SAME session (hardened + owned + nested popups gated)', async () => {
	const gateRig = rig();
	const opened = await gateRig.manager.open({ initiator: 'agent', agentId: 'worker-1', startUrl: 'https://docs.example.com/page' });
	const sessionId = opened.descriptor.sessionId;
	const sourceTargetId = opened.descriptor.tabs[0]?.targetId ?? '';

	const popupTargetId = gateRig.transports[0]?.openPopupFrom(sourceTargetId, 'https://docs.example.com/popup');
	await gateRig.manager.awaitPopupGate();

	const events = gateRig.manager.popupGateEvents();
	assert.equal(events.length, 1);
	assert.equal(events[0]?.decision, 'allow');
	assert.equal(events[0]?.observedUrl, 'https://docs.example.com/popup');
	assert.equal(events[0]?.openerId, sourceTargetId);
	assert.equal(events[0]?.verdict.decision, 'allow');
	assert.equal(events[0]?.attachedTabId !== undefined, true, 'the popup became a session tab');
	assert.equal(events[0]?.closed, undefined);
	assert.ok(isUntrustedContentNote(events[0]?.evidenceRow.note ?? ''), 'allow rows carry the marker too (page-derived URL)');

	// the popup is now a tab of the session (same partition ownership):
	const descriptor = gateRig.manager.getSession(sessionId);
	assert.equal(descriptor?.tabs.length, 2, 'source tab + the attached popup');
	const popupTab = descriptor?.tabs.find(tab => tab.tabId === events[0]?.attachedTabId);
	assert.ok(popupTab !== undefined);
	assert.equal(popupTab.targetId, popupTargetId);
	assert.equal(popupTab.url, 'https://docs.example.com/popup', 'the tab record carries the OBSERVED url');
	assert.equal(popupTab.state, 'active');
	assert.equal(gateRig.state.urlOf(popupTab.targetId), 'https://docs.example.com/popup', 'the paused navigation resumed (Fetch.disable) and committed');
	// hardened like every tab (agent session: UA override + download deny on the popup target):
	assert.equal(gateRig.state.downloadBehaviorOf(popupTab.targetId), 'deny');
	assert.ok(gateRig.state.userAgentOverrideOf(popupTab.targetId)?.includes('FlauzAgent/0'));
	// gated like every tab: the popup tab carries the per-tab page-session auto-attach (tab-scoped work):
	const tabScoped = (gateRig.transports[0]?.commandsOf('Target.setAutoAttach') ?? []).filter(command => command.sessionId !== undefined);
	assert.equal(tabScoped.length, 2, 'one per live tab (source + popup)');
	assert.equal((gateRig.transports[0]?.commandsOf('Target.setAutoAttach') ?? []).filter(command => command.sessionId === undefined).length, 1, 'ONE browser-scope gate for the whole connection');
	// nested popups from the POPUP tab are gated too (attribution through the same browser-level gate):
	const nested = gateRig.transports[0]?.openPopupFrom(popupTab.targetId, 'https://evil.org/nested');
	await gateRig.manager.awaitPopupGate();
	assert.ok(nested !== undefined);
	const nestedEvent = gateRig.manager.popupGateEvents()[1];
	assert.equal(nestedEvent?.decision, 'deny', 'nested popups are gated (the browser gate covers every session tab)');
	assert.equal(nestedEvent?.sourceTabId, popupTab.tabId);
	assert.equal(nestedEvent?.openerId, popupTab.targetId);
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

test('P2-FIX-106: the gate consults the OPENER SESSION initiator class: a HUMAN session popup is gated by willNavigate (agent allowlist never gates humans)', async () => {
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
	assert.equal(events[0]?.openerId, sourceTargetId);

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

test('P2-FIX-106 fail-closed: a denied popup that CANNOT be closed fails the session (never an ungoverned target)', async () => {
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
	assert.equal(event.observedUrl, 'https://evil.org/popup', 'the verdict was still reached (the pause was observed first)');
	assert.equal((gateRig.transports[0]?.commandsOf('Fetch.failRequest') ?? []).length, 1, 'the abort preceded the failed close');
	assert.equal(event.closed, false);
	assert.match(event.closeError ?? '', /scripted failure: Target\.closeTarget/);
	// the evidence row still exists (the attempt is ledgered even on close failure):
	assert.ok(isUntrustedContentNote(event.evidenceRow.note));
	await gateRig.manager.dispose();
});

test('P2-FIX-106: the gate is observable via onPopupGate and the audit log is ordered', async () => {
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

test('P2-FIX-106: the marker discipline: gate rows carry the boundary marker constant exactly', async () => {
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

// F-RELEASE-CMD regression (TL3-P2), re-pinned by P2-FIX-106: real Chromium
// rejects `Runtime.run` with "'Runtime.run' wasn't found" (the real release
// command is `Runtime.runIfWaitingForDebugger`). The gate's release rides the
// popup's HELD (auto-attach) session, and the held-session sequence is the
// DL-79 order: arm interception -> release the hold -> (verdict) disarm.
test('P2-FIX-106 F-RELEASE-CMD regression: the release is the REAL CDP command Runtime.runIfWaitingForDebugger on the popup\'s held session (never Runtime.run), in the DL-79 order', async () => {
	const gateRig = rig();
	const opened = await gateRig.manager.open({ initiator: 'agent', agentId: 'worker-1', startUrl: 'https://docs.example.com/page' });
	const sourceTargetId = opened.descriptor.tabs[0]?.targetId ?? '';
	const attaches = observeAttaches(gateRig);

	gateRig.transports[0]?.openPopupFrom(sourceTargetId, 'https://docs.example.com/popup');
	await gateRig.manager.awaitPopupGate();

	// The allowed popup ATTACHED (a rejected release would have closed it):
	const events = gateRig.manager.popupGateEvents();
	assert.equal(events.length, 1);
	assert.equal(events[0]?.decision, 'allow', 'the policy allowed the popup');
	assert.equal(events[0]?.attachedTabId !== undefined, true, 'the popup became a session tab (the release was accepted)');
	assert.equal(events[0]?.attachError, undefined, 'no attach error: the release command is a real CDP method');
	assert.equal(gateRig.state.hasTarget(events[0]?.targetId ?? ''), true, 'the popup target still exists (not closed by a failed release)');

	// THE regression pin — the wire evidence (the fake mirrors real Chromium):
	const wrongCommand = gateRig.transports[0]?.commandsOf('Runtime.run') ?? [];
	assert.equal(wrongCommand.length, 0, '`Runtime.run` is NOT a real CDP method (real Chromium: "wasn\'t found") — it is never sent');
	const heldSessionId = heldSessionOf(attaches, sourceTargetId);
	assert.ok(heldSessionId !== '', 'the popup\'s held (auto-attach) session was delivered at root scope');
	const release = (gateRig.transports[0]?.commandsOf('Runtime.runIfWaitingForDebugger') ?? []).filter(command => command.sessionId === heldSessionId);
	assert.equal(release.length, 1, 'exactly one release command, on the popup\'s HELD session');
	// the full held-session sequence (the DL-79 order):
	const heldCommands = (gateRig.transports[0]?.sentCommands ?? []).filter(command => command.sessionId === heldSessionId);
	assert.deepEqual(heldCommands.map(command => command.method), ['Fetch.enable', 'Runtime.runIfWaitingForDebugger', 'Fetch.disable'], 'arm interception, release the hold, then disarm on the allow verdict');
	await gateRig.manager.dispose();
});

// P2-FIX-106 (DL-79 no-URL rule): a window.open() popup with NO destination
// fires no request ever (real-Chromium-pinned) — the gate must not hold it
// (decisiveness): the hold is released immediately at arming and the bounded
// no-request window then disarms interception. No gate event (no destination
// was gated).
test('P2-FIX-106 no-URL rule: a window.open() popup with no destination is released immediately on opener attribution; the no-request window disarms interception (no gate event, no indefinite hold)', async () => {
	const gateRig = rig(GATE_POLICY, { noUrlPopupWindowMs: 25 });
	const opened = await gateRig.manager.open({ initiator: 'agent', agentId: 'worker-1', startUrl: 'https://docs.example.com/page' });
	const sessionId = opened.descriptor.sessionId;
	const sourceTargetId = opened.descriptor.tabs[0]?.targetId ?? '';
	const attaches = observeAttaches(gateRig);

	const popupTargetId = gateRig.transports[0]?.openPopupFrom(sourceTargetId, '');
	assert.ok(popupTargetId !== undefined, 'the no-destination popup was held at browser level');
	await gateRig.manager.awaitPopupGate();

	assert.equal(gateRig.manager.popupGateEvents().length, 0, 'no gate event: no destination was gated');
	assert.equal(gateRig.state.hasTarget(popupTargetId ?? ''), true, 'the no-URL popup is RELEASED, not closed (nothing to gate)');
	assert.equal(gateRig.manager.getSession(sessionId)?.tabs.length, 1, 'it does not become a session tab');
	const heldSessionId = heldSessionOf(attaches, sourceTargetId);
	assert.ok(heldSessionId !== '');
	const heldCommands = (gateRig.transports[0]?.sentCommands ?? []).filter(command => command.sessionId === heldSessionId);
	assert.deepEqual(heldCommands.map(command => command.method), ['Fetch.enable', 'Runtime.runIfWaitingForDebugger', 'Fetch.disable'], 'released immediately at arming (decisiveness); interception disarmed when the no-request window expires');
	assert.equal((gateRig.transports[0]?.commandsOf('Fetch.failRequest') ?? []).length, 0, 'nothing to abort (no request ever paused)');
	await gateRig.manager.dispose();
});

// P2-FIX-106 (DL-79 opener-attribution rule): a popup whose opener is NOT a
// session tab (another page's target, browser UI, ...) is NOT the runtime's
// to gate — released immediately, no interception, no gate event.
test('P2-FIX-106 non-session opener rule: a popup whose opener is NOT a session tab is not the runtime\'s to gate (released immediately, no interception, no gate event)', async () => {
	const gateRig = rig();
	const opened = await gateRig.manager.open({ initiator: 'agent', agentId: 'worker-1' });
	const foreignOpenerId = gateRig.state.createTarget('https://foreign.example.net/opener'); // NOT owned by any session
	const attaches = observeAttaches(gateRig);

	const popupTargetId = gateRig.transports[0]?.openPopupFrom(foreignOpenerId, 'https://docs.example.com/not-ours');
	assert.ok(popupTargetId !== undefined, 'the popup was held at browser level (attribution decides)');
	await gateRig.manager.awaitPopupGate();

	assert.equal(gateRig.manager.popupGateEvents().length, 0, 'not the runtime\'s to gate');
	assert.equal(gateRig.manager.getSession(opened.descriptor.sessionId)?.tabs.length, 1);
	const heldSessionId = heldSessionOf(attaches, foreignOpenerId);
	assert.ok(heldSessionId !== '');
	const heldCommands = (gateRig.transports[0]?.sentCommands ?? []).filter(command => command.sessionId === heldSessionId);
	assert.deepEqual(heldCommands.map(command => command.method), ['Runtime.runIfWaitingForDebugger'], 'released immediately on opener attribution — no interception at all');
	assert.equal(gateRig.state.hasTarget(popupTargetId ?? ''), true);
	assert.equal(gateRig.state.urlOf(popupTargetId ?? ''), 'https://docs.example.com/not-ours', 'the released non-session popup proceeds with its navigation ungated (not ours)');
	await gateRig.manager.dispose();
});

// P2-FIX-106: browser-scope auto-attach intercepts the runtime's OWN minted
// tabs too (real-Chromium-verified) — the gate releases them on opener
// attribution (no opener — not ours to gate) so the mint proceeds. With no
// popups in play, the ONE held-session release on the connection IS the
// minted tab's (the gate only ever releases held auto-attach sessions).
test('P2-FIX-106: the runtime\'s own minted tabs are held by the browser-scope auto-attach and released on opener attribution (no opener — not ours to gate)', async () => {
	const gateRig = rig();
	const opened = await gateRig.manager.open({ initiator: 'agent', agentId: 'worker-1' });
	await gateRig.manager.awaitPopupGate();

	assert.equal(gateRig.transports[0]?.hasBrowserAutoAttach(), true, 'the browser-scope auto-attach is armed');
	const mintedTargetId = opened.descriptor.tabs[0]?.targetId ?? '';
	const release = gateRig.transports[0]?.commandsOf('Runtime.runIfWaitingForDebugger') ?? [];
	assert.equal(release.length, 1, 'exactly one release on the connection: the minted tab\'s held (auto-attach) session');
	assert.ok(release[0]?.sessionId !== undefined, 'the release is session-scoped to the auto-attach held session');
	assert.notEqual(release[0]?.sessionId, gateRig.transports[0]?.sessionIdOf(mintedTargetId), 'NOT the runtime\'s mint session — the gate\'s held session');
	assert.equal(gateRig.manager.popupGateEvents().length, 0, 'no gate event: a minted tab is not a popup');
	assert.equal(opened.descriptor.state, 'active', 'the mint proceeds (released before use)');
	await gateRig.manager.dispose();
});
