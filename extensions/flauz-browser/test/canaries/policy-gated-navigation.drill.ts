/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * B-POLICY driver-level canary drill (TL3-001, A-class assertions):
 * the policy-gated-navigation drill executed against the REAL runtime
 * (BrowserSessionManager + CdpEndpointHost + the navigation pipeline) over
 * the FakeCdpTransport simulator — zero network, zero secrets.
 *
 * This is the unit-level satisfaction of the B-POLICY A4-A10 driver
 * assertions (see build/flauz/canaries/B-POLICY.md): activation-independent,
 * it pins THE invariant — a policy-denied navigation sends ZERO CDP
 * `Page.navigate` commands — plus the allow path, the post-commit violation
 * reset recommendation, and the human/agent separation, all with the REAL
 * engine and REAL pipeline code.
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
	// to a webRequest-denied host is flagged with the about:blank reset. ---
	state.commitUrlMapper = requested => requested === 'https://docs.example.com/trap' ? 'https://evil.org/trap' : requested;
	const trapped = await manager.navigate(agent.descriptor.sessionId, 'https://docs.example.com/trap');
	drillAssert(
		isNavigationOutcome(trapped) && trapped.violation !== undefined && trapped.violation.resetTo === 'about:blank' && trapped.violation.verdict.layer === 'webRequest',
		'A7/F2: the committed-URL residual is flagged with the forced-reset recommendation',
		JSON.stringify(isNavigationOutcome(trapped) ? { violation: trapped.violation?.resetTo, layer: trapped.violation?.verdict.layer } : trapped),
	);
	state.commitUrlMapper = undefined;

	// --- A9-user (human path): the agent allowlist never gates humans. ---
	const human = await manager.open({ initiator: 'human' });
	const humanNav = await manager.navigate(human.descriptor.sessionId, 'https://humans.example.org/portal');
	drillAssert(
		isNavigationOutcome(humanNav) && humanNav.sent === true && humanNav.verdict.initiator === 'user' && humanNav.committedUrl === 'https://humans.example.org/portal',
		'A9-user: a human navigation consults willNavigate+webRequest (agent allowlist does not gate humans)',
		JSON.stringify(isNavigationOutcome(humanNav) ? { sent: humanNav.sent, initiator: humanNav.verdict.initiator } : humanNav),
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
