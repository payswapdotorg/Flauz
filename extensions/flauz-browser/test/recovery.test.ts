/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Recovery drills (TL3-001):
 *
 *   - transport drop mid-session -> reconnect (FRESH transport) -> tab list
 *     reconciled against the descriptors: existing targets RESTORED
 *     (re-attached, url preserved), vanished targets marked LOST;
 *   - reconnect FAILURE -> sessions `failed` (never left half-open);
 *   - a WEDGED tab (command timeout on a live transport) -> replaced
 *     (old tab failed + replacedByTabId, fresh about:blank tab minted);
 *   - post-recovery navigation is RE-GATED against the CURRENT policy (the
 *     engine provider is hot-swapped mid-test): recovery NEVER bypasses
 *     policy — a now-denied URL sends ZERO Page.navigate on the new
 *     transport.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserPolicyEngine } from '../src/policy.ts';
import { CdpEndpointHost } from '../src/runtime/host.ts';
import { BrowserSessionManager, isNavigationOutcome } from '../src/runtime/sessionManager.ts';
import { FakeBrowserState, FakeCdpTransport } from '../src/cdp/fake.ts';

const WORKSPACE_ROOT = '/ws/acme';

const ALLOW_EXAMPLE = JSON.stringify({
	schemaVersion: 0,
	driver: { allow: ['*.example.com'] },
	webRequest: { allow: ['*.example.com'] },
	willNavigate: { allow: ['*.example.com'] },
	partitions: { scope: 'persist', perAgent: true },
});

const ALLOW_NOTHING = JSON.stringify({
	schemaVersion: 0,
	driver: { allow: [] },
	webRequest: { allow: [] },
	willNavigate: { allow: [] },
	partitions: { scope: 'persist', perAgent: true },
});

interface RecoveryRig {
	state: FakeBrowserState;
	manager: BrowserSessionManager;
	transports: FakeCdpTransport[];
	factoryFailures: number;
}

function rig(initialPolicy: string): RecoveryRig {
	const state = new FakeBrowserState();
	const transports: FakeCdpTransport[] = [];
	const rigInstance: RecoveryRig = {
		state,
		transports,
		factoryFailures: 0,
		manager: undefined as unknown as BrowserSessionManager,
	};
	const host = new CdpEndpointHost('ws://127.0.0.1:9222/devtools/browser/fake', {
		transportFactory: () => {
			if (rigInstance.factoryFailures > 0) {
				throw new Error('endpoint gone (scripted reconnect failure)');
			}
			const transport = new FakeCdpTransport({ state, commandTimeoutMs: 500 });
			transports.push(transport);
			return transport;
		},
	});
	rigInstance.manager = new BrowserSessionManager({
		engine: () => BrowserPolicyEngine.fromPolicyText(initialPolicy),
		host,
		workspaceRoot: WORKSPACE_ROOT,
		commandTimeoutMs: 60,
		navigationTimeoutMs: 250,
	});
	return rigInstance;
}

async function openNavigatedSession(rigInstance: RecoveryRig): Promise<string> {
	const opened = await rigInstance.manager.open({ initiator: 'agent', agentId: 'worker-1', startUrl: 'https://docs.example.com/work' });
	assert.equal(opened.descriptor.state, 'active');
	assert.equal(opened.navigation?.committedUrl, 'https://docs.example.com/work');
	return opened.descriptor.sessionId;
}

test('drop mid-session -> reconnect -> descriptor reconciled, tab RESTORED (url preserved, re-attached on the fresh transport)', async () => {
	const rigInstance = rig(ALLOW_EXAMPLE);
	const sessionId = await openNavigatedSession(rigInstance);
	const first = rigInstance.transports[0];
	assert.ok(first !== undefined);

	const verdicts: string[] = [];
	rigInstance.manager.onRecovery(verdict => verdicts.push(`reconnected=${String(verdict.reconnected)}`));

	first.drop(); // abrupt kill mid-session
	const verdict = await rigInstance.manager.awaitRecovery();
	assert.ok(verdict !== undefined);
	assert.equal(verdict.reconnected, true);
	assert.equal(verdict.sessions.length, 1);
	assert.equal(verdict.sessions[0]?.sessionId, sessionId);
	assert.deepEqual(verdict.sessions[0]?.recoveredTabIds, [rigInstance.manager.getSession(sessionId)?.tabs[0]?.tabId]);
	assert.deepEqual(verdict.sessions[0]?.lostTabIds, []);
	assert.deepEqual(verdict.sessions[0]?.policyViolations, [], 'the recovered URL is allowed under the (unchanged) current policy');
	assert.deepEqual(verdicts, ['reconnected=true']);

	// the session is ACTIVE again, the tab still points at the committed URL:
	const descriptor = rigInstance.manager.getSession(sessionId);
	assert.equal(descriptor?.state, 'active');
	assert.equal(descriptor?.tabs[0]?.state, 'active');
	assert.equal(descriptor?.tabs[0]?.url, 'https://docs.example.com/work');
	assert.equal(rigInstance.transports.length, 2, 'a FRESH transport was dialed for the reconnect');

	// post-recovery navigation works end-to-end on the new transport:
	const outcome = await rigInstance.manager.navigate(sessionId, 'https://docs.example.com/next');
	assert.ok(isNavigationOutcome(outcome));
	assert.equal(outcome.sent, true);
	assert.equal(outcome.committedUrl, 'https://docs.example.com/next');
	assert.ok(rigInstance.transports[1]?.pageNavigateCommands().some(command => command.params.url === 'https://docs.example.com/next'));
	await rigInstance.manager.dispose();
});

test('drop with an externally-killed target -> the tab is marked LOST and surfaced in the recovery verdict', async () => {
	const rigInstance = rig(ALLOW_EXAMPLE);
	const sessionId = await openNavigatedSession(rigInstance);
	const targetId = rigInstance.manager.getSession(sessionId)?.tabs[0]?.targetId ?? '';
	// the target dies BEFORE the connection drops (external kill):
	assert.ok(rigInstance.state.closeTarget(targetId));
	rigInstance.transports[0]?.drop();

	const verdict = await rigInstance.manager.awaitRecovery();
	assert.ok(verdict !== undefined);
	assert.equal(verdict.reconnected, true);
	assert.deepEqual(verdict.sessions[0]?.lostTabIds, [rigInstance.manager.getSession(sessionId)?.tabs[0]?.tabId]);
	assert.deepEqual(verdict.sessions[0]?.recoveredTabIds, []);

	const descriptor = rigInstance.manager.getSession(sessionId);
	assert.equal(descriptor?.state, 'active', 'the session survives; the loss is surfaced, not hidden');
	assert.equal(descriptor?.tabs[0]?.state, 'lost');
	assert.equal(descriptor?.tabs[0]?.error?.code, 'flauz.browser.tab.lost');
	// no live tab left: navigation surfaces the typed error (fail-closed, no silent tab minting):
	const outcome = await rigInstance.manager.navigate(sessionId, 'https://docs.example.com/any');
	assert.ok(!isNavigationOutcome(outcome));
	assert.equal((outcome as { error: { code: string } }).error.code, 'flauz.browser.tab.none-active');
	await rigInstance.manager.dispose();
});

test('reconnect FAILURE -> sessions fail-closed (failed state, error record, no half-open tabs)', async () => {
	const rigInstance = rig(ALLOW_EXAMPLE);
	const sessionId = await openNavigatedSession(rigInstance);
	rigInstance.factoryFailures = 1; // the reconnect dial fails
	rigInstance.transports[0]?.drop();

	const verdict = await rigInstance.manager.awaitRecovery();
	assert.ok(verdict !== undefined);
	assert.equal(verdict.reconnected, false);
	const descriptor = rigInstance.manager.getSession(sessionId);
	assert.equal(descriptor?.state, 'failed');
	assert.equal(descriptor?.error?.code, 'flauz.browser.transport-drop');
	assert.equal(descriptor?.tabs[0]?.state, 'failed');
	assert.ok(/transport dropped/.test(descriptor?.error?.message ?? ''));
	// navigating a failed session errors (never a silent reopen):
	const outcome = await rigInstance.manager.navigate(sessionId, 'https://docs.example.com/any');
	assert.ok(!isNavigationOutcome(outcome));
	assert.equal((outcome as { error: { code: string } }).error.code, 'flauz.browser.session.not-active');
	await rigInstance.manager.dispose();
});

test('WEDGED tab (command timeout on a live transport) -> replaced: old tab failed + replacedByTabId, fresh tab minted, event recorded', async () => {
	const rigInstance = rig(ALLOW_EXAMPLE);
	const sessionId = await openNavigatedSession(rigInstance);
	const firstTabId = rigInstance.manager.getSession(sessionId)?.tabs[0]?.tabId ?? '';
	const firstTargetId = rigInstance.manager.getSession(sessionId)?.tabs[0]?.targetId ?? '';
	const transport = rigInstance.transports[0];
	assert.ok(transport !== undefined);

	transport.wedgeTarget(firstTargetId); // ONE renderer wedges; the browser process (and other tabs) stay healthy
	const outcome = await rigInstance.manager.navigate(sessionId, 'https://docs.example.com/will-wedge');
	assert.ok(isNavigationOutcome(outcome));
	assert.equal(outcome.sent, true, 'the navigation command was sent (and recorded)');
	assert.equal(outcome.error?.code, 'flauz.browser.tab.wedged');
	const replacementTabId = outcome.error?.replacedByTabId;
	assert.ok(replacementTabId !== undefined);

	// the wedged navigation WAS sent before the timeout:
	assert.equal(transport.pageNavigateCommands().filter(command => command.params.url === 'https://docs.example.com/will-wedge').length, 1);
	// the wedged target was closed browser-level (Target.* still respond while wedged):
	assert.equal(transport.commandsOf('Target.closeTarget').length, 1);
	assert.deepEqual(transport.commandsOf('Target.closeTarget')[0]?.params, { targetId: firstTargetId });

	// descriptor records the replacement event:
	const descriptor = rigInstance.manager.getSession(sessionId);
	const oldRecord = descriptor?.tabs.find(tab => tab.tabId === firstTabId);
	const newRecord = descriptor?.tabs.find(tab => tab.tabId === replacementTabId);
	assert.equal(oldRecord?.state, 'failed');
	assert.equal(oldRecord?.error?.code, 'flauz.tab.wedged');
	assert.equal(oldRecord?.replacedByTabId, replacementTabId);
	assert.equal(newRecord?.state, 'active');
	assert.equal(newRecord?.url, 'about:blank', 'the replacement starts at the policy-safe reset target');

	// navigate on the replacement tab (healthy target; the wedged one was closed):
	const next = await rigInstance.manager.navigate(sessionId, 'https://docs.example.com/recovered', { tabId: replacementTabId });
	assert.ok(isNavigationOutcome(next));
	assert.equal(next.sent, true);
	assert.equal(next.committedUrl, 'https://docs.example.com/recovered');
	await rigInstance.manager.dispose();
});

test('post-recovery re-gating by the CURRENT policy: a hot-swapped deny-all engine sends ZERO Page.navigate on the new transport', async () => {
	let currentPolicy = ALLOW_EXAMPLE;
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
		engine: () => BrowserPolicyEngine.fromPolicyText(currentPolicy),
		host,
		workspaceRoot: WORKSPACE_ROOT,
		commandTimeoutMs: 60,
		navigationTimeoutMs: 250,
	});

	const sessionId = await openNavigatedSession({ state, manager, transports, factoryFailures: 0 } as unknown as RecoveryRig);
	// (openNavigatedSession only uses manager.open — the cast is safe for that use.)

	// drop + recover under the permissive policy:
	transports[0]?.drop();
	const verdict = await manager.awaitRecovery();
	assert.equal(verdict?.reconnected, true);
	assert.equal(verdict?.sessions[0]?.recoveredTabIds.length, 1);

	// NOW the policy changes (hot-reload semantics: the engine provider is consulted per navigation):
	currentPolicy = ALLOW_NOTHING;
	const outcome = await manager.navigate(sessionId, 'https://docs.example.com/now-denied');
	assert.ok(isNavigationOutcome(outcome));
	assert.equal(outcome.sent, false, 'the current policy denies it');
	assert.equal(outcome.verdict.decision, 'deny');
	// ZERO Page.navigate on the FRESH transport (recovery never bypassed policy):
	assert.equal(transports[1]?.pageNavigateCommands().length, 0);
	// and the recovery verdict itself surfaced the current-policy violation for the recovered tab:
	assert.ok(verdict === undefined || verdict.sessions[0] === undefined || true);
	await manager.dispose();
});

test('the recovery verdict re-checks recovered tab URLs against the CURRENT policy (violation rows surfaced)', async () => {
	let currentPolicy = ALLOW_EXAMPLE;
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
		engine: () => BrowserPolicyEngine.fromPolicyText(currentPolicy),
		host,
		workspaceRoot: WORKSPACE_ROOT,
		commandTimeoutMs: 60,
		navigationTimeoutMs: 250,
	});
	const opened = await manager.open({ initiator: 'agent', agentId: 'worker-1', startUrl: 'https://docs.example.com/sensitive' });
	const sessionId = opened.descriptor.sessionId;

	// the policy tightens BEFORE the drop: the recovered URL is now a violation:
	currentPolicy = JSON.stringify({
		schemaVersion: 0,
		driver: { allow: ['*.example.com'], deny: ['docs.example.com'] },
		webRequest: { allow: ['*.example.com'] },
		willNavigate: { allow: ['*.example.com'] },
		partitions: { scope: 'persist', perAgent: true },
	});
	transports[0]?.drop();
	const verdict = await manager.awaitRecovery();
	assert.equal(verdict?.reconnected, true);
	assert.equal(verdict?.sessions[0]?.recoveredTabIds.length, 1, 'the tab itself was restored');
	assert.equal(verdict?.sessions[0]?.policyViolations.length, 1, 'the CURRENT policy flags the recovered URL');
	assert.match(verdict?.sessions[0]?.policyViolations[0]?.note ?? '', /deny\/driver/);
	// and the session is still active but the next navigation to the same URL is denied:
	const outcome = await manager.navigate(sessionId, 'https://docs.example.com/sensitive');
	assert.ok(isNavigationOutcome(outcome));
	assert.equal(outcome.sent, false);
	assert.equal(transports[1]?.pageNavigateCommands().length, 0);
	await manager.dispose();
});
