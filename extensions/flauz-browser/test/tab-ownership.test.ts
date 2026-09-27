/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Credential isolation tests (TL3-002 item 3.5): tabs belong to EXACTLY ONE
 * session/partition.
 *
 *   - cross-partition tab use is a TYPED error (flauz.browser.tab.cross-partition);
 *   - same-partition foreign-session use is a typed error too
 *     (flauz.browser.tab.foreign-session — ownership is per session);
 *   - recovery re-attach only re-attaches targets the ownership registry
 *     attributes to THIS session+partition (a popup attached through the gate
 *     is owned by its session and survives recovery as that session's tab).
 *
 * (Electron-side partition MINTING remains product-side gap G5 — documented
 * in INTEGRATION-GAP.md, not attempted here.)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserPolicyEngine } from '../src/policy.ts';
import { CdpEndpointHost } from '../src/runtime/host.ts';
import { BrowserSessionManager, isNavigationOutcome } from '../src/runtime/sessionManager.ts';
import { FakeBrowserState, FakeCdpTransport } from '../src/cdp/fake.ts';

const WORKSPACE_ROOT = '/ws/acme';

const OWNERSHIP_POLICY = JSON.stringify({
	schemaVersion: 0,
	driver: { allow: ['*.example.com'] },
	webRequest: { allow: ['*.example.com'] },
	willNavigate: { allow: ['*.example.com'] },
	partitions: { scope: 'persist', perAgent: true },
});

interface OwnershipRig {
	state: FakeBrowserState;
	manager: BrowserSessionManager;
	transports: FakeCdpTransport[];
}

function rig(): OwnershipRig {
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
		engine: () => BrowserPolicyEngine.fromPolicyText(OWNERSHIP_POLICY),
		host,
		workspaceRoot: WORKSPACE_ROOT,
		commandTimeoutMs: 150,
		navigationTimeoutMs: 300,
	});
	return { state, manager, transports };
}

test('cross-partition tab use is a TYPED error (two agents, per-agent partitions)', async () => {
	const ownershipRig = rig();
	const one = await ownershipRig.manager.open({ initiator: 'agent', agentId: 'worker-1' });
	const two = await ownershipRig.manager.open({ initiator: 'agent', agentId: 'worker-2' });
	assert.notEqual(one.descriptor.partition, two.descriptor.partition, 'per-agent partitions differ');

	const foreignTabId = two.descriptor.tabs[0]?.tabId ?? '';
	const sentBefore = ownershipRig.transports.flatMap(transport => transport.sentCommands).length;
	const result = await ownershipRig.manager.navigate(one.descriptor.sessionId, 'https://docs.example.com/x', { tabId: foreignTabId });
	assert.ok(!isNavigationOutcome(result), 'a typed session error, not a navigation outcome');
	assert.equal((result as { error: { code: string } }).error.code, 'flauz.browser.tab.cross-partition');
	assert.match((result as { error: { message: string } }).error.message, /credential isolation/);
	assert.match((result as { error: { message: string } }).error.message, new RegExp(one.descriptor.partition.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
	// ZERO commands were issued on the foreign tab's behalf:
	assert.equal(ownershipRig.transports.flatMap(transport => transport.sentCommands).length, sentBefore);
	await ownershipRig.manager.dispose();
});

test('same-partition foreign-session tab use is a typed error (two human sessions share the workspace partition)', async () => {
	const ownershipRig = rig();
	const one = await ownershipRig.manager.open({ initiator: 'human' });
	const two = await ownershipRig.manager.open({ initiator: 'human' });
	assert.equal(one.descriptor.partition, two.descriptor.partition, 'human sessions share the workspace jar');

	const foreignTabId = two.descriptor.tabs[0]?.tabId ?? '';
	const result = await ownershipRig.manager.navigate(one.descriptor.sessionId, 'https://docs.example.com/x', { tabId: foreignTabId });
	assert.ok(!isNavigationOutcome(result));
	assert.equal((result as { error: { code: string } }).error.code, 'flauz.browser.tab.foreign-session', 'tabs are owned by exactly one session even within a partition');
	// capture surfaces enforce the same rule:
	const tail = ownershipRig.manager.consoleTail(one.descriptor.sessionId, foreignTabId);
	assert.ok('error' in (tail as object));
	assert.equal((tail as { error: { code: string } }).error.code, 'flauz.browser.tab.foreign-session');
	// unknown tabs stay unknown (the pre-existing typed error is unchanged):
	const unknown = await ownershipRig.manager.navigate(one.descriptor.sessionId, 'https://docs.example.com/x', { tabId: 'flauz:tab:0000000000000000' });
	assert.equal((unknown as { error: { code: string } }).error.code, 'flauz.browser.tab.unknown');
	await ownershipRig.manager.dispose();
});

test('recovery re-attach restores ONLY owned targets: main tab + gate-attached popup both survive as the SAME session tabs', async () => {
	const ownershipRig = rig();
	const opened = await ownershipRig.manager.open({ initiator: 'agent', agentId: 'worker-1', startUrl: 'https://docs.example.com/work' });
	const sessionId = opened.descriptor.sessionId;
	const mainTargetId = opened.descriptor.tabs[0]?.targetId ?? '';

	// attach a popup through the gate (allowed host):
	ownershipRig.transports[0]?.openPopupFrom(mainTargetId, 'https://docs.example.com/popup');
	await ownershipRig.manager.awaitPopupGate();
	const popupTabId = ownershipRig.manager.popupGateEvents()[0]?.attachedTabId;
	assert.ok(popupTabId !== undefined);
	assert.equal(ownershipRig.manager.getSession(sessionId)?.tabs.length, 2);

	// a SECOND session over the same browser (different partition):
	const other = await ownershipRig.manager.open({ initiator: 'agent', agentId: 'worker-2' });
	assert.equal(ownershipRig.manager.getSession(other.descriptor.sessionId)?.tabs.length, 1);

	// drop + reconnect: reconcile must restore exactly the OWNED targets per session:
	ownershipRig.transports[0]?.drop();
	const verdict = await ownershipRig.manager.awaitRecovery();
	assert.equal(verdict?.reconnected, true);
	const reportOf = (sessionIdToFind: string) => verdict?.sessions.find(sessionReport => sessionReport.sessionId === sessionIdToFind);
	assert.equal(reportOf(sessionId)?.recoveredTabIds.length, 2, 'the main tab AND the gate-attached popup are re-attached to their owner');
	assert.deepEqual(reportOf(sessionId)?.lostTabIds, []);
	assert.equal(reportOf(other.descriptor.sessionId)?.recoveredTabIds.length, 1, 'the other session gets exactly its own tab');
	// ownership survives the recovery (the popup is still the same logical tab of the same session):
	const descriptor = ownershipRig.manager.getSession(sessionId);
	assert.equal(descriptor?.tabs.find(tab => tab.tabId === popupTabId)?.state, 'active');
	assert.equal(descriptor?.tabs.find(tab => tab.tabId === popupTabId)?.url, 'https://docs.example.com/popup');
	// and the popup is navigable through the pipeline post-recovery:
	const outcome = await ownershipRig.manager.navigate(sessionId, 'https://docs.example.com/next', { tabId: popupTabId });
	assert.ok(isNavigationOutcome(outcome) && outcome.sent && outcome.tabId === popupTabId);
	await ownershipRig.manager.dispose();
});

test('recovery marks a vanished owned target LOST and never borrows a target of another session', async () => {
	const ownershipRig = rig();
	const opened = await ownershipRig.manager.open({ initiator: 'agent', agentId: 'worker-1', startUrl: 'https://docs.example.com/work' });
	const sessionId = opened.descriptor.sessionId;
	const popupTarget = opened.descriptor.tabs[0]?.targetId ?? '';

	// attach a popup, then kill its target externally before the drop:
	ownershipRig.transports[0]?.openPopupFrom(popupTarget, 'https://docs.example.com/popup');
	await ownershipRig.manager.awaitPopupGate();
	const popupTabId = ownershipRig.manager.popupGateEvents()[0]?.attachedTabId ?? '';
	const popupTargetId = ownershipRig.manager.getSession(sessionId)?.tabs.find(tab => tab.tabId === popupTabId)?.targetId ?? '';
	assert.ok(ownershipRig.state.closeTarget(popupTargetId), 'the popup target dies externally');

	ownershipRig.transports[0]?.drop();
	const verdict = await ownershipRig.manager.awaitRecovery();
	assert.equal(verdict?.reconnected, true);
	const report = verdict?.sessions.find(sessionReport => sessionReport.sessionId === sessionId);
	assert.deepEqual(report?.recoveredTabIds, [ownershipRig.manager.getSession(sessionId)?.tabs.find(tab => tab.tabId !== popupTabId)?.tabId]);
	assert.deepEqual(report?.lostTabIds, [popupTabId]);
	const lostTab = ownershipRig.manager.getSession(sessionId)?.tabs.find(tab => tab.tabId === popupTabId);
	assert.equal(lostTab?.state, 'lost');
	assert.equal(lostTab?.error?.code, 'flauz.browser.tab.lost');
	await ownershipRig.manager.dispose();
});
