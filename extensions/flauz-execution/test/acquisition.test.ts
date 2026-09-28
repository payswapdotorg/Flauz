/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-S2 M2 suite: the task-level acquisition/release contract - mock
 * drivers over the REAL journal store and the REAL orchestration store
 * (extensions/flauz-agent/core/orchStore.mjs imported at the Node runtime
 * boundary; its .d.mts sibling supplies the types).
 *
 * Pins:
 *   - acquire bound to a RUNNING step (the graph-state gate);
 *   - the task-step lease taken through the REAL orchestration journal
 *     (L-NNN-NN-N reference on the resource-acquired row);
 *   - the fail-closed denial taxonomy (typed, journaled, never retried by
 *     the manager) and its mapping into the orchestration failure classes;
 *   - release on completion / rollback / revocation;
 *   - the expiry sweep (service actor) and idempotent re-acquire.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OrchestrationStore } from '../../flauz-agent/core/orchStore.mjs';
import {
	ExecutionResourceManager,
	type GraphStatePort,
	type ResourceOpenerPort,
	type StepBinding,
} from '../src/acquisition.ts';
import { ExecJournalStore } from '../src/journal.ts';
import { type ExecFailure, type ExecutionRequest, type ExecutionResourceRef, type SurfaceSnapshot, toOrchFailureClass, ORCH_TERMINAL_FAILURE_CLASSES } from '../src/contracts.ts';
import { BROWSER_REF, ENVIRONMENT_REF, FILE_REF, pinnedMinter, steppingClock, tempRoot } from './helpers.ts';

const BROWSER_SURFACE = {
	resourceClass: 'browser-session',
	sessionId: 'flauz:browser:9c8d7e6f5a4b3c2d',
	initiator: 'agent',
	partition: 'persist:flauz-0123456789abcdef-worker-1',
	state: 'active',
	tabIds: ['flauz:tab:0123456789abcdef'],
	policySourceRef: 'flauz:browser-policy/v0@workspace-file#0123456789abcdef',
} as const;

const ENVIRONMENT_SURFACE = {
	resourceClass: 'environment',
	descriptorId: 'env-staging',
	providerKind: 'workspace-remote',
	lifecycleState: 'running/attached',
	executorKind: 'fake-local',
	infrastructureClass: 'real',
	trustPosture: 'trusted',
	attachLeaseId: 'lease-1',
} as const;

/** A scriptable mock opener (the M3 adapters' stand-in; fixture-shaped surfaces). */
class MockOpener implements ResourceOpenerPort {
	readonly calls: unknown[] = [];
	failNext: { gate: ExecFailure['gate']; message: string; verdictDigest?: string } | undefined;
	surface: Record<string, unknown> = { ...BROWSER_SURFACE };

	async open(request: ExecutionRequest, binding: StepBinding): Promise<{ ok: true; resource: ExecutionResourceRef; surface: SurfaceSnapshot } | { ok: false; failure: ExecFailure }> {
		this.calls.push({ request, binding });
		if (this.failNext !== undefined) {
			const failure: ExecFailure = { failureClass: 'acquire-denied', gate: this.failNext.gate, message: this.failNext.message, ...(this.failNext.verdictDigest !== undefined ? { verdictDigest: this.failNext.verdictDigest } : {}) };
			this.failNext = undefined;
			return { ok: false, failure };
		}
		const resource = request.resource ?? BROWSER_REF;
		return { ok: true, resource: { ...resource }, surface: this.surface as unknown as SurfaceSnapshot };
	}
}

/** The real orchestration store behind the graph-state port. */
function realGraph(root: string): { store: OrchestrationStore; port: GraphStatePort } {
	const store = new OrchestrationStore(root, { clock: steppingClock(1730000000000) });
	const port: GraphStatePort = {
		stepStatus(graphId, stepId) {
			try {
				const state = store.stateOf(graphId);
				const step = (state.steps as Record<string, { status?: string }>)[stepId];
				return step?.status ?? 'unknown-step';
			} catch {
				return 'unknown-graph';
			}
		},
		async acquireStepLease(input) {
			const row = await store.acquireLease({ graphId: input.graphId, stepId: input.stepId, holder: input.holder, ttlMs: input.ttlMs, actor: 'agent', origin: 'exec:lease' });
			const payload = row.payload as { leaseId: string; expiresAt: number };
			return { leaseId: payload.leaseId, expiresAt: payload.expiresAt };
		},
		activeStepLease(graphId, stepId) {
			try {
				const state = store.stateOf(graphId);
				const lease = (state.leases as Record<string, { leaseId: string; holder: string; expiresAt: number } | undefined>)[stepId];
				return lease ?? null;
			} catch {
				return null;
			}
		},
	};
	return { store, port };
}

interface Rig {
	root: string;
	cleanup: () => void;
	store: OrchestrationStore;
	manager: ExecutionResourceManager;
	journal: ExecJournalStore;
	opener: MockOpener;
	clock: () => number;
}

/** Boots a real graph (G-001, one step, approved + started) + the manager. */
async function rig(options: { leaseTtlMs?: number } = {}): Promise<Rig> {
	const { root, cleanup } = tempRoot();
	const { store, port } = realGraph(root);
	const journal = new ExecJournalStore(root, { clock: steppingClock(1730000000000, 500), mintAcquisitionId: pinnedMinter() });
	await store.submitGraph({
		title: 'exec resources rig',
		steps: [{ stepId: 'S-01', title: 'drive', instruction: 'drive the resource', tool: 'flauz.exec.browser', toolInput: { resource: { ...BROWSER_REF }, action: 'navigate', url: 'https://docs.flauz.dev' } }],
		actor: 'agent',
		origin: 'test:acquisition',
	});
	await store.approveGraph({ graphId: 'G-001', actor: 'human', origin: 'test:acquisition' });
	const opener = new MockOpener();
	const manager = new ExecutionResourceManager({ journal, graph: port, opener, clock: journalClock(journal) });
	return { root, cleanup, store, manager, journal, opener, clock: journalClock(journal) };
}

function journalClock(journal: ExecJournalStore): () => number {
	return () => {
		const rows = journal.rowsAll();
		return rows.length === 0 ? 1730000000000 : rows[rows.length - 1].ts;
	};
}

function binding(overrides: Partial<StepBinding> = {}): StepBinding {
	return { graphId: 'G-001', stepId: 'S-01', attempt: 1, idempotencyKey: 'flauz-orch/G-001/S-01/run/1', runnerId: 'worker-1', actor: 'agent', origin: 'test:acquisition', ...overrides };
}

test('acquire: happy path journals resource-acquired + handoff with the step binding', async () => {
	const r = await rig();
	await r.store.startStep({ graphId: 'G-001', stepId: 'S-01', runnerId: 'worker-1', actor: 'agent', origin: 'test' });
	const outcome = await r.manager.acquire({ resource: { ...BROWSER_REF }, action: 'navigate', url: 'https://docs.flauz.dev', purpose: 'verify docs' }, binding());
	assert.ok(outcome.ok, outcome.ok ? '' : JSON.stringify(outcome.failure));
	if (!outcome.ok) { return; }
	assert.equal(outcome.replayed, false);
	assert.equal(outcome.acquisition.state, 'acquired');
	assert.equal(outcome.acquisition.graphId, 'G-001');
	assert.equal(outcome.acquisition.stepId, 'S-01');
	assert.equal(outcome.acquisition.idempotencyKey, 'flauz-orch/G-001/S-01/run/1');
	assert.equal(outcome.acquisition.surfaceDigests.length, 1, 'the hand-off surface digest is recorded');
	assert.ok(r.journal.verifyJournal().ok);
	r.cleanup();
});

test('acquire: the graph-state gate denies unless the step is RUNNING (fail-closed, typed)', async () => {
	const r = await rig();
	const outcome = await r.manager.acquire({ resource: { ...BROWSER_REF }, action: 'navigate', url: 'https://x' }, binding());
	assert.ok(!outcome.ok);
	if (outcome.ok) { return; }
	assert.equal(outcome.failure.failureClass, 'acquire-denied');
	assert.equal(outcome.failure.gate, 'graph-state');
	assert.equal(toOrchFailureClass('acquire-denied'), 'policy-violation');
	assert.ok(ORCH_TERMINAL_FAILURE_CLASSES.includes('policy-violation'), 'graph-state denials map to a TERMINAL class - never retried');
	assert.equal(r.opener.calls.length, 0, 'the opener is never called when the gate denies (zero side effects)');
	const denied = [...r.journal.acquisitions().values()].filter((a) => a.state === 'denied');
	assert.equal(denied.length, 1);
	assert.equal(denied[0]?.denied?.gate, 'graph-state');
	r.cleanup();
});

test('acquire: an invalid request is a typed invalid-request denial (no fabricated resource rows)', async () => {
	const r = await rig();
	await r.store.startStep({ graphId: 'G-001', stepId: 'S-01', runnerId: 'worker-1', actor: 'agent', origin: 'test' });
	const outcome = await r.manager.acquire({ resource: { ...BROWSER_REF }, action: 'sideways' }, binding());
	assert.ok(!outcome.ok);
	if (outcome.ok) { return; }
	assert.equal(outcome.failure.gate, 'invalid-request');
	assert.equal(toOrchFailureClass('invalid-request'), 'invalid-input');
	const rows = r.journal.rowsAll().filter((row) => row.type === 'acquire-denied');
	assert.equal(rows.length, 1);
	assert.deepEqual((rows[0]?.payload as Record<string, unknown>).resource, { ...BROWSER_REF }, 'the attempted resource is recorded when the request carries a parseable one');
	r.cleanup();
});

test('acquire: a policy denial from the opener is journaled and maps terminal (fail-closed posture)', async () => {
	const r = await rig();
	await r.store.startStep({ graphId: 'G-001', stepId: 'S-01', runnerId: 'worker-1', actor: 'agent', origin: 'test' });
	r.opener.failNext = { gate: 'browser-policy', message: 'driver allowlist denies evil.example.com', verdictDigest: 'a'.repeat(64) };
	const outcome = await r.manager.acquire({ resource: { ...BROWSER_REF }, action: 'navigate', url: 'https://evil.example.com' }, binding());
	assert.ok(!outcome.ok);
	if (outcome.ok) { return; }
	assert.equal(outcome.failure.failureClass, 'acquire-denied');
	assert.equal(toOrchFailureClass('acquire-denied'), 'policy-violation');
	const deniedRow = r.journal.rowsAll().find((row) => row.type === 'acquire-denied');
	assert.notEqual(deniedRow, undefined);
	assert.equal((deniedRow?.payload as Record<string, unknown>).gate, 'browser-policy');
	assert.deepEqual((deniedRow?.payload as Record<string, unknown>).resource, { ...BROWSER_REF }, 'the attempted resource is recorded');
	// the fail-closed law: the manager does NOT retry the denial itself
	assert.equal(r.opener.calls.length, 1);
	r.cleanup();
});

test('acquire: idempotent - the same key + acquired resource replays as the same acquisition (no new rows)', async () => {
	const r = await rig();
	await r.store.startStep({ graphId: 'G-001', stepId: 'S-01', runnerId: 'worker-1', actor: 'agent', origin: 'test' });
	const first = await r.manager.acquire({ resource: { ...BROWSER_REF }, action: 'navigate', url: 'https://docs.flauz.dev' }, binding());
	const rowsAfterFirst = r.journal.rowsAll().length;
	const second = await r.manager.acquire({ resource: { ...BROWSER_REF }, action: 'navigate', url: 'https://docs.flauz.dev' }, binding());
	assert.ok(second.ok);
	if (!first.ok || !second.ok) { return; }
	assert.equal(second.replayed, true);
	assert.equal(second.acquisition.acquisitionId, first.acquisition.acquisitionId);
	assert.equal(r.journal.rowsAll().length, rowsAfterFirst, 'no duplicate rows on replay');
	r.cleanup();
});

test('acquire: a denial then a retry reuses the SAME acquisition id (the next attempt)', async () => {
	const r = await rig();
	await r.store.startStep({ graphId: 'G-001', stepId: 'S-01', runnerId: 'worker-1', actor: 'agent', origin: 'test' });
	r.opener.failNext = { gate: 'browser-policy', message: 'deny once' };
	const denied = await r.manager.acquire({ resource: { ...BROWSER_REF }, action: 'navigate', url: 'https://x' }, binding());
	assert.ok(!denied.ok);
	const retry = await r.manager.acquire({ resource: { ...BROWSER_REF }, action: 'navigate', url: 'https://docs.flauz.dev' }, binding());
	assert.ok(retry.ok);
	if (!retry.ok) { return; }
	assert.match(retry.acquisition.acquisitionId, /^flauz:exec:[0-9a-f]{16}$/);
	const acquired = [...r.journal.acquisitions().values()].filter((a) => a.state === 'acquired');
	assert.equal(acquired.length, 1);
	r.cleanup();
});

test('acquire with leaseTtlMs: the TASK-STEP LEASE is taken through the real orchestration journal', async () => {
	const r = await rig();
	await r.store.startStep({ graphId: 'G-001', stepId: 'S-01', runnerId: 'worker-1', actor: 'agent', origin: 'test' });
	const outcome = await r.manager.acquire({ resource: { ...ENVIRONMENT_REF }, action: 'attach', leaseTtlMs: 30000 }, binding());
	assert.ok(outcome.ok);
	if (!outcome.ok) { return; }
	const lease = outcome.acquisition.lease;
	assert.notEqual(lease, null);
	assert.match(lease?.leaseId ?? '', /^L-001-01-1$/, 'the orchestration lease reference (L-NNN-NN-N)');
	const orchLeaseRow = r.store.rowsFor('G-001').find((row) => row.type === 'lease-acquired');
	assert.notEqual(orchLeaseRow, undefined, 'the real orchestration journal carries lease-acquired');
	assert.ok(r.store.verifyJournal().ok, 'the orchestration journal stays verifiable after the lease');
	r.cleanup();
});

test('release: completion path; the acquisition ends released', async () => {
	const r = await rig();
	await r.store.startStep({ graphId: 'G-001', stepId: 'S-01', runnerId: 'worker-1', actor: 'agent', origin: 'test' });
	const outcome = await r.manager.acquire({ resource: { ...BROWSER_REF }, action: 'navigate', url: 'https://docs.flauz.dev' }, binding());
	assert.ok(outcome.ok);
	if (!outcome.ok) { return; }
	const released = await r.manager.release({ acquisitionId: outcome.acquisition.acquisitionId, releaseKind: 'completion', actor: 'service', origin: 'exec:release' });
	assert.ok(released.ok);
	assert.equal(r.journal.acquisitionOf(outcome.acquisition.acquisitionId).state, 'released');
	assert.equal(r.journal.heldAcquisitions({ graphId: 'G-001' }).length, 0);
	r.cleanup();
});

test('release: revocation is a HUMAN act (releaseKind revocation, actor human)', async () => {
	const r = await rig();
	await r.store.startStep({ graphId: 'G-001', stepId: 'S-01', runnerId: 'worker-1', actor: 'agent', origin: 'test' });
	const outcome = await r.manager.acquire({ resource: { ...BROWSER_REF }, action: 'navigate', url: 'https://docs.flauz.dev' }, binding());
	if (!outcome.ok) { return; }
	const released = await r.manager.release({ acquisitionId: outcome.acquisition.acquisitionId, releaseKind: 'revocation', actor: 'human', origin: 'exec:revoke' });
	assert.ok(released.ok);
	const row = r.journal.rowsAll().find((row) => row.type === 'resource-released');
	assert.equal((row?.payload as Record<string, unknown>).releaseKind, 'revocation');
	assert.equal(row?.actor, 'human');
	r.cleanup();
});

test('release: unknown acquisition and terminal states are typed errors, never silent', async () => {
	const r = await rig();
	const unknown = await r.manager.release({ acquisitionId: 'flauz:exec:00000000000000ff', releaseKind: 'completion', actor: 'service', origin: 't' });
	assert.ok(!unknown.ok);
	await r.store.startStep({ graphId: 'G-001', stepId: 'S-01', runnerId: 'worker-1', actor: 'agent', origin: 'test' });
	const outcome = await r.manager.acquire({ resource: { ...BROWSER_REF }, action: 'navigate', url: 'https://x' }, binding());
	if (!outcome.ok) { return; }
	await r.manager.release({ acquisitionId: outcome.acquisition.acquisitionId, releaseKind: 'completion', actor: 'service', origin: 't' });
	const again = await r.manager.release({ acquisitionId: outcome.acquisition.acquisitionId, releaseKind: 'completion', actor: 'service', origin: 't' });
	assert.ok(!again.ok);
	assert.match((again as { error: { message: string } }).error.message, /releasable states/);
	r.cleanup();
});

test('expiry sweep: the SERVICE actor expires lease-bound acquisitions; a fresh acquire needs a fresh id', async () => {
	const r = await rig();
	await r.store.startStep({ graphId: 'G-001', stepId: 'S-01', runnerId: 'worker-1', actor: 'agent', origin: 'test' });
	const outcome = await r.manager.acquire({ resource: { ...ENVIRONMENT_REF }, action: 'attach', leaseTtlMs: 1000 }, binding());
	if (!outcome.ok) { return; }
	const sweep = r.manager.sweepExpirations(1730000100000);
	assert.deepEqual(sweep.expired, [outcome.acquisition.acquisitionId]);
	assert.equal(r.journal.acquisitionOf(outcome.acquisition.acquisitionId).state, 'expired');
	const expiredRow = r.journal.rowsAll().find((row) => row.type === 'resource-expired');
	assert.equal(expiredRow?.actor, 'service');
	// re-acquire after expiry is a FRESH acquisition (terminal state honored)
	const again = await r.manager.acquire({ resource: { ...ENVIRONMENT_REF }, action: 'attach' }, binding({ attempt: 2, idempotencyKey: 'flauz-orch/G-001/S-01/run/2' }));
	assert.ok(again.ok);
	if (!again.ok) { return; }
	assert.notEqual(again.acquisition.acquisitionId, outcome.acquisition.acquisitionId);
	r.cleanup();
});

test('rollback: every held acquisition of the graph is released + the coherence record', async () => {
	const r = await rig();
	await r.store.startStep({ graphId: 'G-001', stepId: 'S-01', runnerId: 'worker-1', actor: 'agent', origin: 'test' });
	await r.manager.acquire({ resource: { ...BROWSER_REF }, action: 'navigate', url: 'https://a' }, binding());
	r.opener.surface = { ...ENVIRONMENT_SURFACE };
	await r.manager.acquire({ resource: { ...ENVIRONMENT_REF }, action: 'attach' }, binding({ idempotencyKey: 'flauz-orch/G-001/S-01/run/2', attempt: 2 }));
	r.opener.surface = { resourceClass: 'logical-resource', refId: FILE_REF.id, family: 'file-system', surface: { kind: 'file-system', root: '/ws', path: 'src/app.ts' } };
	await r.manager.acquire({ resource: { ...FILE_REF }, action: 'resolve' }, binding({ idempotencyKey: 'flauz-orch/G-001/S-01/run/3', attempt: 3 }));
	assert.equal(r.journal.heldAcquisitions({ graphId: 'G-001' }).length, 3);
	const report = await r.manager.rollbackGraph({ graphId: 'G-001', cause: 'user-cancel', origin: 'exec:rollback' });
	assert.equal(report.released.length, 3);
	assert.equal(report.coherent, true);
	assert.equal(r.journal.heldAcquisitions({ graphId: 'G-001' }).length, 0, 'coherent end state - nothing held');
	const rollbackRow = r.journal.rowsAll().find((row) => row.type === 'rollback-recorded');
	assert.equal((rollbackRow?.payload as Record<string, unknown>).cause, 'user-cancel');
	assert.equal((rollbackRow?.payload as Record<string, unknown>).coherent, true);
	assert.ok(r.journal.verifyJournal().ok);
	assert.ok(r.store.verifyJournal().ok, 'the orchestration journal is untouched by the rollback sweep (its own rows only)');
	r.cleanup();
});
