/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * BrowserSessionManager tests (TL3-001): open/list/close/focus, the
 * BrowserSessionDescriptor contract, partition derivation per initiator, and
 * the PINNED human-vs-agent separation (README "Semantics" item 3) in BOTH
 * directions:
 *
 *   - agent navigations consult driver + webRequest: an agent is DENIED
 *     wherever the driver layer denies (the driver allowlist is
 *     AUTHORITATIVE for agents) even when the human path allows;
 *   - human navigations consult willNavigate + webRequest: the AGENT
 *     allowlist NEVER gates humans (a human can be allowed where agents are
 *     denied) and the willNavigate rules never gate agents.
 *
 * The host is the real CdpEndpointHost over a FakeCdpTransport (shared
 * FakeBrowserState) — the same wiring the endpoint path uses in production,
 * minus the network.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserPolicyEngine } from '../src/policy.ts';
import { CdpEndpointHost } from '../src/runtime/host.ts';
import { BrowserSessionManager, isNavigationOutcome, type RecoveryVerdict, isSessionError } from '../src/runtime/sessionManager.ts';
import { FakeBrowserState, FakeCdpTransport } from '../src/cdp/fake.ts';

const WORKSPACE_ROOT = '/ws/acme';

/**
 * The separation policy:
 *   - driver allowlist: *.example.com (agents may drive example.com subdomains);
 *   - webRequest allowlist: *.example.com + humans.example.org;
 *   - willNavigate allowlist: *.example.com + humans.example.org, but DENIES
 *     blocked-for-humans.example.com (a user-path-only rule);
 *   - perAgent partitions enabled.
 */
const SEPARATION_POLICY = JSON.stringify({
	schemaVersion: 0,
	driver: { allow: ['*.example.com'] },
	webRequest: { allow: ['*.example.com', 'humans.example.org'] },
	willNavigate: { allow: ['*.example.com', 'humans.example.org'], deny: ['blocked-for-humans.example.com'] },
	partitions: { scope: 'persist', perAgent: true },
});

const NO_PER_AGENT_POLICY = JSON.stringify({
	schemaVersion: 0,
	driver: { allow: ['*.example.com'] },
	webRequest: { allow: ['*.example.com'] },
	willNavigate: { allow: ['*'] },
	partitions: { scope: 'persist', perAgent: false },
});

interface TestRig {
	state: FakeBrowserState;
	manager: BrowserSessionManager;
	transports: FakeCdpTransport[];
}

function rig(policyText: string, options: { engine?: () => BrowserPolicyEngine } = {}): TestRig {
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
		engine: options.engine ?? (() => BrowserPolicyEngine.fromPolicyText(policyText)),
		host,
		workspaceRoot: WORKSPACE_ROOT,
		commandTimeoutMs: 150,
		navigationTimeoutMs: 300,
	});
	return { state, manager, transports };
}

test('open(agent): descriptor contract pinned (schema, logical session id, partition, policySourceRef, initial tab)', async () => {
	const { manager } = rig(SEPARATION_POLICY);
	const result = await manager.open({ initiator: 'agent', agentId: 'worker-1' });
	const descriptor = result.descriptor;
	assert.equal(descriptor.schemaVersion, 0);
	assert.equal(descriptor.state, 'active');
	assert.equal(descriptor.initiator, 'agent');
	assert.equal(descriptor.agentId, 'worker-1');
	assert.match(descriptor.sessionId, /^flauz:browser:[0-9a-f]{16}$/, 'logical session id shape — never a URL or path');
	assert.match(descriptor.partition, /^persist:flauz-[0-9a-f]{16}-worker-1$/, 'per-agent partition suffix');
	assert.match(descriptor.policySourceRef, /^flauz:browser-policy\/v0@workspace-file#[0-9a-f]{16}$/);
	assert.match(descriptor.createdAt, /^\d{4}-\d{2}-\d{2}T/);
	assert.equal(descriptor.tabs.length, 1, 'an agent session opens with one tab at the reset target');
	assert.equal(descriptor.tabs[0]?.url, 'about:blank');
	assert.match(descriptor.tabs[0]?.tabId ?? '', /^flauz:tab:[0-9a-f]{16}$/);
	assert.equal(descriptor.tabs[0]?.state, 'active');
});

test('open(human): partition has NO agent suffix (the same workspace jar)', async () => {
	const { manager } = rig(SEPARATION_POLICY);
	const result = await manager.open({ initiator: 'human' });
	assert.match(result.descriptor.partition, /^persist:flauz-[0-9a-f]{16}$/, 'human sessions share the workspace partition');
	assert.equal(result.descriptor.agentId, undefined);
	assert.equal(result.descriptor.initiator, 'human');
});

test('open(agent) with perAgent=false + agentId: fail-closed failed session, ZERO CDP commands (the endpoint is never even dialed)', async () => {
	const { manager, transports } = rig(NO_PER_AGENT_POLICY);
	const result = await manager.open({ initiator: 'agent', agentId: 'worker-1' });
	assert.equal(result.descriptor.state, 'failed');
	assert.equal(result.error?.code, 'flauz.browser.partition');
	assert.equal(transports.length, 0, 'no transport was ever dialed (fail-closed before any host interaction)');
	assert.equal(result.descriptor.tabs.length, 0);
});

test('open with a DENIED startUrl: session failed BEFORE any host interaction (zero CDP commands) + verdict + evidence row', async () => {
	const { manager, transports } = rig(SEPARATION_POLICY);
	const result = await manager.open({ initiator: 'agent', agentId: 'worker-1', startUrl: 'https://evil.org/pay' });
	assert.equal(result.descriptor.state, 'failed');
	assert.equal(result.error?.code, 'flauz.browser.policy.deny');
	assert.equal(result.verdict?.decision, 'deny');
	assert.equal(result.verdict?.layer, 'driver');
	assert.equal(result.verdict?.initiator, 'agent-tool');
	assert.equal(result.evidenceRow?.kind, 'note');
	assert.match(result.evidenceRow?.sha256 ?? '', /^[0-9a-f]{64}$/);
	assert.equal(transports.length, 0, 'no transport was ever dialed');
});

test('open with an ALLOWED startUrl: active session, navigation pipeline ran, committed URL recorded', async () => {
	const { manager, transports } = rig(SEPARATION_POLICY);
	const result = await manager.open({ initiator: 'agent', agentId: 'worker-1', startUrl: 'https://docs.example.com/guide' });
	assert.equal(result.descriptor.state, 'active');
	assert.equal(result.navigation?.sent, true);
	assert.equal(result.navigation?.committedUrl, 'https://docs.example.com/guide');
	assert.equal(result.descriptor.tabs[0]?.url, 'https://docs.example.com/guide');
	assert.ok(transports[0]?.pageNavigateCommands().some(command => (command.params.url as string) === 'https://docs.example.com/guide'));
});

test('HUMAN/AGENT SEPARATION (pinned both directions): agents denied where humans are allowed', async () => {
	const { manager, transports } = rig(SEPARATION_POLICY);
	const agent = await manager.open({ initiator: 'agent', agentId: 'worker-1' });
	const human = await manager.open({ initiator: 'human' });
	assert.equal(agent.descriptor.state, 'active');
	assert.equal(human.descriptor.state, 'active');

	// Direction 1: the driver allowlist gates the AGENT and never the human.
	const url = 'https://humans.example.org/portal'; // NOT in the driver allowlist
	const agentOutcome = await manager.navigate(agent.descriptor.sessionId, url);
	const humanOutcome = await manager.navigate(human.descriptor.sessionId, url);
	assert.ok(isNavigationOutcome(agentOutcome));
	assert.ok(isNavigationOutcome(humanOutcome));

	assert.equal(agentOutcome.sent, false, 'agent navigation to a non-driver-allowlisted host: NO CDP command');
	assert.equal(agentOutcome.verdict.decision, 'deny');
	assert.equal(agentOutcome.verdict.layer, 'driver');
	assert.equal(agentOutcome.verdict.initiator, 'agent-tool');

	assert.equal(humanOutcome.sent, true, 'human navigation: the same host is allowed (willNavigate + webRequest)');
	assert.equal(humanOutcome.verdict.decision, 'allow');
	assert.equal(humanOutcome.verdict.initiator, 'user');
	assert.equal(humanOutcome.committedUrl, url);

	// the ZERO-command invariant, asserted on the fake's sent-command log:
	const navigateCommands = transports.flatMap(transport => transport.pageNavigateCommands());
	assert.equal(navigateCommands.filter(command => command.params.url === url).length, 1, 'exactly ONE Page.navigate (the human one)');
});

test('SEPARATION direction 2: willNavigate rules gate the HUMAN and never the agent', async () => {
	const { manager } = rig(SEPARATION_POLICY);
	const agent = await manager.open({ initiator: 'agent', agentId: 'worker-1' });
	const human = await manager.open({ initiator: 'human' });
	const url = 'https://blocked-for-humans.example.com/'; // willNavigate deny (user-path-only rule)

	const humanOutcome = await manager.navigate(human.descriptor.sessionId, url);
	assert.ok(isNavigationOutcome(humanOutcome));
	assert.equal(humanOutcome.sent, false);
	assert.equal(humanOutcome.verdict.decision, 'deny');
	assert.equal(humanOutcome.verdict.layer, 'willNavigate');
	assert.equal(humanOutcome.verdict.initiator, 'user');

	const agentOutcome = await manager.navigate(agent.descriptor.sessionId, url);
	assert.ok(isNavigationOutcome(agentOutcome));
	assert.equal(agentOutcome.sent, true, 'the agent path never consults willNavigate (B1c firing model)');
	assert.equal(agentOutcome.verdict.decision, 'allow');
	assert.equal(agentOutcome.verdict.initiator, 'agent-tool');
	assert.equal(agentOutcome.committedUrl, url);
});

test('list() returns deep snapshots: external mutation cannot corrupt manager state', async () => {
	const { manager } = rig(SEPARATION_POLICY);
	const opened = await manager.open({ initiator: 'agent', agentId: 'worker-1' });
	const listed = manager.list();
	assert.equal(listed.length, 1);
	assert.equal(listed[0]?.sessionId, opened.descriptor.sessionId);
	assert.notEqual(listed[0], opened.descriptor, 'snapshots are clones');
	(listed[0] as { state: string }).state = 'closed'; // type-asserted mutation of the SNAPSHOT
	(listed[0]?.tabs as unknown as { length: number }).length = 0;
	assert.equal(manager.getSession(opened.descriptor.sessionId)?.state, 'active', 'internal state untouched');
	assert.equal(manager.getSession(opened.descriptor.sessionId)?.tabs.length, 1);
});

test('close(sessionId): closes every tab via the host, seals the descriptor, stays auditable; unknown sessions error', async () => {
	const { manager, transports } = rig(SEPARATION_POLICY);
	const opened = await manager.open({ initiator: 'agent', agentId: 'worker-1' });
	const sessionId = opened.descriptor.sessionId;
	const closed = await manager.close(sessionId);
	assert.ok(!isSessionError(closed));
	assert.equal(closed.state, 'closed');
	assert.equal(closed.tabs[0]?.state, 'closed');
	assert.match(closed.tabs[0]?.closedAt ?? '', /^\d{4}-\d{2}-\d{2}T/);
	assert.ok(transports[0]?.commandsOf('Target.closeTarget').length === 1, 'the tab target was closed over CDP');
	// the closed session is still listable (audit surface) but not navigable:
	assert.equal(manager.list().length, 1);
	const after = await manager.navigate(sessionId, 'https://docs.example.com/');
	assert.ok(!isNavigationOutcome(after));
	assert.equal((after as { error: { code: string } }).error.code, 'flauz.browser.session.not-active');
	// idempotent:
	const again = await manager.close(sessionId);
	assert.ok(!isSessionError(again));
	assert.equal(again.state, 'closed');
	const unknown = await manager.close('flauz:browser:0000000000000000');
	assert.ok(isSessionError(unknown));
});

test('focus(tabId): activates the tab target (endpoint host surface)', async () => {
	const { manager, transports } = rig(SEPARATION_POLICY);
	const opened = await manager.open({ initiator: 'agent', agentId: 'worker-1' });
	const focused = await manager.focus(opened.descriptor.tabs[0]?.tabId ?? '');
	assert.equal(focused, true);
	assert.ok(transports[0]?.commandsOf('Target.activateTarget').length === 1);
	const missed = await manager.focus('flauz:tab:0000000000000000');
	assert.equal(typeof missed, 'object');
	assert.equal((missed as { error: { code: string } }).error.code, 'flauz.browser.tab.unknown');
});

test('navigate on an unknown session surfaces a typed session error', async () => {
	const { manager } = rig(SEPARATION_POLICY);
	const result = await manager.navigate('flauz:browser:0000000000000000', 'https://docs.example.com/');
	assert.ok(!isNavigationOutcome(result));
	assert.equal((result as { error: { code: string } }).error.code, 'flauz.browser.session.unknown');
});

test('recovery verdicts are observable via onRecovery (wired end-to-end by the drop tests)', async () => {
	const { manager } = rig(SEPARATION_POLICY);
	const seen: RecoveryVerdict[] = [];
	manager.onRecovery(verdict => seen.push(verdict));
	await manager.open({ initiator: 'agent', agentId: 'worker-1' });
	assert.deepEqual(seen, [], 'no spurious recovery verdicts without a drop');
	await manager.dispose();
});

test('missing policy file => builtin deny-all: an agent session opens but every navigation is denied (fail-closed)', async () => {
	const transports: FakeCdpTransport[] = [];
	const denyAll = new BrowserSessionManager({
		engine: () => BrowserPolicyEngine.fromPolicyText(undefined),
		host: new CdpEndpointHost('ws://fake', {
			transportFactory: () => {
				const transport = new FakeCdpTransport({ state: new FakeBrowserState(), commandTimeoutMs: 500 });
				transports.push(transport);
				return transport;
			},
		}),
		workspaceRoot: WORKSPACE_ROOT,
		commandTimeoutMs: 150,
		navigationTimeoutMs: 300,
	});
	const opened = await denyAll.open({ initiator: 'agent' });
	assert.equal(opened.descriptor.state, 'active', 'deny-all still allows session shells (about:blank only)');
	assert.equal(opened.descriptor.partition.match(/worker|^-/)?.[0] ?? 'no-suffix', 'no-suffix');
	const outcome = await denyAll.navigate(opened.descriptor.sessionId, 'https://anything.example.com/');
	assert.ok(isNavigationOutcome(outcome));
	assert.equal(outcome.sent, false);
	assert.equal(outcome.verdict.decision, 'deny');
	assert.equal(outcome.verdict.layer, 'driver', 'deny-all: the driver layer (first gate on the agent path) carries the deny');
	assert.ok(transports.every(transport => transport.pageNavigateCommands().length === 0), 'ZERO Page.navigate under deny-all');
});
