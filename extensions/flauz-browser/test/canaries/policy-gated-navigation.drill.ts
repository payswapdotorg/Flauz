/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * B-POLICY driver-level canary drill (TL3-001, A-class assertions;
 * extended by TL3-002 with the session-security A-class assertions):
 * the policy-gated-navigation drill executed against the REAL runtime
 * (BrowserSessionManager + CdpEndpointHost + the navigation pipeline) over
 * the FakeCdpTransport simulator — zero network, zero secrets.
 *
 * This is the unit-level satisfaction of the B-POLICY A4-A10 driver
 * assertions (see build/flauz/canaries/B-POLICY.md): activation-independent,
 * it pins THE invariant — a policy-denied navigation sends ZERO CDP
 * `Page.navigate` commands — plus the allow path, the post-commit violation
 * reset recommendation, the human/agent separation, all with the REAL
 * engine and REAL pipeline code.
 *
 * TL3-002 additions (session security): the per-session hardening
 * (FlauzAgent UA token on agent sessions only; downloads denied for every
 * session), the EXECUTED post-commit reset (G6, security.enforceReset), and
 * the popup/new-target gate (denied popups never survive; allowed popups
 * attach).
 *
 * NOTE: the FakeCdpTransport is TEST INFRASTRUCTURE (documented in
 * src/cdp/fake.ts); boot-level workbench assertions remain separate.
 *
 * Exit codes: 0 = drill green; 1 = any assertion failed.
 * Run: node test/canaries/policy-gated-navigation.drill.ts
 */

import { BrowserPolicyEngine } from '../../src/policy.ts';
import { CdpEndpointHost } from '../../src/runtime/host.ts';
import { BrowserSessionManager, isNavigationOutcome } from '../../src/runtime/sessionManager.ts';
import { FakeBrowserState, FakeCdpTransport } from '../../src/cdp/fake.ts';
import { FLAUZ_AGENT_UA_TOKEN } from '../../src/runtime/hardening.ts';

const WORKSPACE_ROOT = process.env['FLAUZ_DRILL_WORKSPACE_ROOT'] ?? '/ws/flauz-drill';

/** The B-POLICY fixture policy (the canary matrix `base`): restrictive allowlist. */
const POLICY = JSON.stringify({
	schemaVersion: 0,
	driver: { allow: ['*.example.com'] },
	webRequest: { allow: ['*.example.com', 'humans.example.org'] },
	willNavigate: { allow: ['*.example.com', 'humans.example.org'] },
	partitions: { scope: 'persist', perAgent: true },
});

let failures = 0;

function drillAssert(condition: boolean, label: string, detail: string): void {
	if (condition) {
		console.log(`B-POLICY driver drill: PASS ${label}`);
	} else {
		failures += 1;
		console.error(`B-POLICY driver drill: FAIL ${label} -- ${detail}`);
	}
}

async function main(): Promise<void> {
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
		engine: () => BrowserPolicyEngine.fromPolicyText(POLICY),
		host,
		workspaceRoot: WORKSPACE_ROOT,
		commandTimeoutMs: 150,
		navigationTimeoutMs: 300,
	});

	// --- A5 (driver gate): a CDP navigation to a non-allowlisted host is
	// denied BEFORE any Page.navigate (ZERO CDP navigation commands). ---
	const agent = await manager.open({ initiator: 'agent', agentId: 'drill-agent' });
	drillAssert(agent.descriptor.state === 'active', 'A4/A9: agent session opens with a flauz partition', `state=${agent.descriptor.state}`);
	drillAssert(/^persist:flauz-[0-9a-f]{16}-drill-agent$/.test(agent.descriptor.partition), 'A9: partition name is persist:flauz-<16hex>-<agent>', agent.descriptor.partition);
	const denied = await manager.navigate(agent.descriptor.sessionId, 'https://evil.org/pay');
	drillAssert(
		isNavigationOutcome(denied) && denied.sent === false && denied.verdict.decision === 'deny' && denied.verdict.layer === 'driver',
		'A5: CDP nav to a non-allowlisted host blocked at the driver layer (no navigation happened)',
		JSON.stringify(isNavigationOutcome(denied) ? { sent: denied.sent, verdict: denied.verdict } : denied),
	);
	drillAssert(
		transports.every(transport => transport.pageNavigateCommands().length === 0),
		'A5: ZERO Page.navigate commands were sent for the denied navigation',
		`${transports.reduce((sum, transport) => sum + transport.pageNavigateCommands().length, 0)} navigate command(s) recorded`,
	);
	const deniedRow = isNavigationOutcome(denied) ? denied.evidenceRow : undefined;
	drillAssert(
		deniedRow !== undefined && deniedRow.kind === 'note' && /^[0-9a-f]{64}$/.test(deniedRow.sha256),
		'A10: the denied attempt produced a ledger-ready evidence row',
		JSON.stringify(deniedRow),
	);

	// --- allow path: an allowlisted host navigates + commits + reconciles. ---
	const allowed = await manager.navigate(agent.descriptor.sessionId, 'https://docs.example.com/guide');
	drillAssert(
		isNavigationOutcome(allowed) && allowed.sent === true && allowed.committedUrl === 'https://docs.example.com/guide' && allowed.violation === undefined,
		'allow: an allowlisted host navigates and the committed URL reconciles clean',
		JSON.stringify(isNavigationOutcome(allowed) ? { sent: allowed.sent, committed: allowed.committedUrl } : allowed),
	);

	// --- A7 (reconciliation residual): a driver-allowed request that COMMITS
	// to a webRequest-denied host is flagged with the about:blank reset — and
	// (TL3-002, G6 EXECUTION) the reset is EXECUTED on the runtime-owned tab
	// (security.enforceReset defaults true; the recommendation is no longer
	// advisory-only runtime-side). ---
	state.commitUrlMapper = requested => requested === 'https://docs.example.com/trap' ? 'https://evil.org/trap' : requested;
	const trapped = await manager.navigate(agent.descriptor.sessionId, 'https://docs.example.com/trap');
	drillAssert(
		isNavigationOutcome(trapped) && trapped.violation !== undefined && trapped.violation.resetTo === 'about:blank' && trapped.violation.verdict.layer === 'webRequest',
		'A7/F2: the committed-URL residual is flagged with the forced-reset recommendation',
		JSON.stringify(isNavigationOutcome(trapped) ? { violation: trapped.violation?.resetTo, layer: trapped.violation?.verdict.layer } : trapped),
	);
	drillAssert(
		isNavigationOutcome(trapped) && trapped.violation?.resetExecuted?.resetTo === 'about:blank' && trapped.violation.resetExecuted.committedUrl === 'about:blank',
		'G6-EXEC: the recommended reset was EXECUTED through the policy engine (the tab landed on about:blank)',
		JSON.stringify(isNavigationOutcome(trapped) ? { resetExecuted: trapped.violation?.resetExecuted?.resetTo, committed: trapped.violation?.resetExecuted?.committedUrl } : trapped),
	);
	drillAssert(
		manager.getSession(agent.descriptor.sessionId)?.tabs[0]?.url === 'about:blank',
		'G6-EXEC: the offending tab is at about:blank after the enforced reset',
		String(manager.getSession(agent.descriptor.sessionId)?.tabs[0]?.url),
	);
	state.commitUrlMapper = undefined;

	// --- TL3-002 hardening (3.1/3.2): the agent session carries the
	// FlauzAgent UA token + denied downloads; the human session keeps the
	// browser default UA and is STILL download-denied. ---
	const agentTargetId = agent.descriptor.tabs[0]?.targetId ?? '';
	drillAssert(
		state.userAgentOverrideOf(agentTargetId) === `flauz-fake-eval:navigator.userAgent ${FLAUZ_AGENT_UA_TOKEN}`,
		'TL3-002/3.1: the agent session UA is the browser UA + the FlauzAgent product token',
		String(state.userAgentOverrideOf(agentTargetId)),
	);
	drillAssert(
		state.downloadBehaviorOf(agentTargetId) === 'deny',
		'TL3-002/3.2: the agent session denies downloads',
		String(state.downloadBehaviorOf(agentTargetId)),
	);

	// --- TL3-002 popup gate (3.3): a denied popup never survives; an
	// allowed popup attaches as a session tab. ---
	const deniedPopupTargetId = transports[0]?.openPopupFrom(agentTargetId, 'https://evil.org/popup');
	await manager.awaitPopupGate();
	drillAssert(
		deniedPopupTargetId !== undefined && !state.hasTarget(deniedPopupTargetId),
		'TL3-002/3.3: a popup to a denied host NEVER survives (closed before use)',
		String(deniedPopupTargetId),
	);
	const gateDeny = manager.popupGateEvents().find(event => event.url === 'https://evil.org/popup');
	drillAssert(
		gateDeny !== undefined && gateDeny.decision === 'deny' && gateDeny.closed === true && gateDeny.verdict.initiator === 'agent-tool',
		'TL3-002/3.3: the denied popup is ledgered (gate event + evidence row, session initiator class)',
		JSON.stringify(gateDeny === undefined ? undefined : { decision: gateDeny.decision, closed: gateDeny.closed }),
	);
	transports[0]?.openPopupFrom(agentTargetId, 'https://docs.example.com/popup');
	await manager.awaitPopupGate();
	const gateAllow = manager.popupGateEvents().find(event => event.url === 'https://docs.example.com/popup');
	drillAssert(
		gateAllow !== undefined && gateAllow.decision === 'allow' && gateAllow.attachedTabId !== undefined && manager.getSession(agent.descriptor.sessionId)?.tabs.some(tab => tab.tabId === gateAllow.attachedTabId && tab.url === 'https://docs.example.com/popup') === true,
		'TL3-002/3.3: a popup to an allowed host ATTACHES as a tab of the session',
		JSON.stringify(gateAllow === undefined ? undefined : { decision: gateAllow.decision, attachedTabId: gateAllow.attachedTabId }),
	);

	// --- A9-user (human path): the agent allowlist never gates humans. ---
	const human = await manager.open({ initiator: 'human' });
	const humanNav = await manager.navigate(human.descriptor.sessionId, 'https://humans.example.org/portal');
	drillAssert(
		isNavigationOutcome(humanNav) && humanNav.sent === true && humanNav.verdict.initiator === 'user' && humanNav.committedUrl === 'https://humans.example.org/portal',
		'A9-user: a human navigation consults willNavigate+webRequest (agent allowlist does not gate humans)',
		JSON.stringify(isNavigationOutcome(humanNav) ? { sent: humanNav.sent, initiator: humanNav.verdict.initiator } : humanNav),
	);
	// TL3-002 hardening, the human direction: NO UA override (browser
	// default preserved) + downloads STILL denied:
	const humanTargetId = human.descriptor.tabs[0]?.targetId ?? '';
	drillAssert(
		state.userAgentOverrideOf(humanTargetId) === undefined,
		'TL3-002/3.1: the human session keeps the browser default UA (zero override commands)',
		String(state.userAgentOverrideOf(humanTargetId)),
	);
	drillAssert(
		state.downloadBehaviorOf(humanTargetId) === 'deny',
		'TL3-002/3.2: the human session denies downloads too (every session)',
		String(state.downloadBehaviorOf(humanTargetId)),
	);

	await manager.dispose();
	if (failures > 0) {
		console.error(`B-POLICY driver drill: FAILED (${failures} assertion(s))`);
		process.exit(1);
	}
	console.log('B-POLICY driver drill: GREEN (policy-gated navigation invariant holds with zero CDP commands on deny)');
}

void main().catch(error => {
	console.error('B-POLICY driver drill: ERROR', error);
	process.exit(1);
});
