/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-F3 suite: the lease-conflict contract (the TL2-004 follow-up that
 * activates the battery's INV-5).
 *
 * BINDING CONTRACT (the work order's section 3.1):
 *  - the flauz.a2a/v0 resource-claim path ENFORCES: a claim against a
 *    resource whose lease is currently held by another holder receives the
 *    TYPED conflict error flauz.a2a.lease-conflict carrying the current
 *    holder's identity, the lease id and the lease deadline (the
 *    informational-only notice posture is retired for the claim path);
 *  - BOTH attempts are journaled as evidence-bearing rows (DL-60:
 *    preview-before-mint, recomputable sha256 linkage, transition-lock
 *    serialization) - the conflict is recorded history, never a dropped
 *    message;
 *  - an EXPIRED lease does not conflict: the takeover goes through the
 *    existing recovery-pass hygiene (DL-61: expiry from op + drive loop +
 *    recovery pass; the takeover is recorded). Deadline-less holds (the
 *    exclusive step CLAIM) hold until an explicit release - a human decides
 *    (the DL-66 posture);
 *  - DL-72 lease reuse: a retry attempt of the SAME durable step reuses its
 *    active task-step lease and never conflicts with itself;
 *  - fail-closed: the typed error is an honest refusal - no auto-grant, no
 *    silent takeover (a foreign release of a LIVE lease is refused), no
 *    approval-gate weakening (the TL2-004 kill-recover posture regresses
 *    nothing).
 *
 * Surfaces under test (the ONE law of core/leaseConflict.mjs):
 *  - the a2a bus claim path (A2ABus.post of resource-claim acquires);
 *  - the store lease transitions (acquireLease/acquireClaim);
 *  - the composed claim op (claimStepLease: store evidence + bus notice).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrchestrationStore } from '../core/orchStore.mjs';
import { WorkspaceSeam } from '../core/service.mjs';
import { recoveryScan } from '../core/recovery.mjs';
import { contentHashOf, OrchestrationError } from '../core/orchestration.mjs';
import { validateLedgerRows } from '../core/contracts.mjs';
import { A2ABus } from '../core/a2a.mjs';
import {
	LeaseConflictError,
	LEASE_CONFLICT_CODE,
	claimStepLease,
	evaluateLeaseClaim,
	isLeaseConflictError,
	isLeaseLive,
	leaseConflictFacts,
	releaseStepLease,
	stepResourceId,
} from '../core/leaseConflict.mjs';
import { makeClock, sha256Of } from './harness/orchWorkspace.ts';

interface LedgerRow {
	seq?: number;
	taskId?: string;
	kind?: string;
	uri?: string;
	sha256?: string;
	evidenceId?: string;
}

interface ConflictRow {
	type: string;
	rowId: string;
	graphId: string;
	stepId: string | null;
	actor: string;
	origin: string;
	ts: number;
	payload: { violation: string; expectedHolder: string; actualRunner: string; evidenceId?: string; note?: string };
}

/** The flauz.tasks/v0 ledger chain verifies (the seam's own law, applied to the wired root). */
function seamLedgerVerifies(root: string): boolean {
	return validateLedgerRows(new WorkspaceSeam(root).ledgerLines).ok;
}

function makeRoot(prefix: string): string {
	return mkdtempSync(join(tmpdir(), `flauz-tl2f3-${prefix}-`));
}

/** A store wired to the REAL WorkspaceSeam taskPort (full-fidelity evidence minting). */
function makeWiredStore(prefix: string, base = 1700000000000): { store: OrchestrationStore; root: string; seam: WorkspaceSeam; clock(): number } {
	const root = makeRoot(prefix);
	const { clock } = makeClock(base);
	const seam = new WorkspaceSeam(root);
	const store = new OrchestrationStore(root, { taskPort: seam, clock });
	return { store, root, seam, clock };
}

function readLedger(root: string): LedgerRow[] {
	const path = join(root, '.flauz', 'evidence', 'ledger.jsonl');
	try {
		return readFileSync(path, 'utf-8').split('\n').filter((line: string) => line.length > 0).map((line: string) => JSON.parse(line) as LedgerRow);
	} catch {
		return [];
	}
}

/** The ledger row OF a minted evidence id (the ledger stores seq; the E-id is its padded projection). */
function ledgerRowOfEvidenceId(ledger: LedgerRow[], evidenceId: string): LedgerRow | undefined {
	const seq = Number.parseInt(evidenceId.slice(2), 10);
	return ledger.find((row) => row.seq === seq);
}

/** The canonical transition facts of a journal row (payload minus the minted evidenceId - the recomputable sha256 input). */
function transitionFactsOf(row: { graphId: string; stepId: string | null; type: string; actor: string; origin: string; ts: number; payload: Record<string, unknown> }): Record<string, unknown> {
	const payload = { ...row.payload };
	delete payload.evidenceId;
	return { graphId: row.graphId, stepId: row.stepId, type: row.type, actor: row.actor, origin: row.origin, ts: row.ts, payload };
}

const STEP = [{ stepId: 'S-01', title: 'contended shared work', instruction: 'two agents race for the lease' }];
const GATED_STEP = [{ stepId: 'S-01', title: 'gated work', instruction: 'needs a human', gate: 'human-approval' }];

async function submittedApproved(store: OrchestrationStore, steps: Array<Record<string, unknown>> = STEP): Promise<string> {
	const submitted = await store.submitGraph({ title: 'tl2f3 conflict graph', steps, actor: 'agent', origin: 'test:tl2f3' });
	await store.approveGraph({ graphId: submitted.graphId, actor: 'human', origin: 'test:tl2f3' });
	return submitted.graphId;
}

// ---------------------------------------------------------------------------
// (0) The law itself: liveness + the decision table
// ---------------------------------------------------------------------------

test('the lease law: deadline-less holds; deadline-bearing is live strictly before its deadline', () => {
	assert.equal(isLeaseLive(null, 9_000_000_000_000), true, 'a deadline-less lease holds until an explicit release (a human decides)');
	assert.equal(isLeaseLive(1_700_000_060_000, 1_700_000_000_000), true, 'live strictly before the deadline');
	assert.equal(isLeaseLive(1_700_000_060_000, 1_700_000_060_000), false, 'at the deadline the lease is expired (an observed deadline passage)');
	assert.equal(isLeaseLive(1_700_000_060_000, 1_700_000_060_001), false, 'past the deadline the lease is expired');
});

test('the lease law: the decision table (acquired | reused | takeover | conflict)', () => {
	const resource = 'flauz-orch/G-001/S-01';
	// no active lease: the claim acquires
	assert.deepEqual(evaluateLeaseClaim({ active: undefined, claimant: 'agent-a', now: 1, resource }), { ok: true, outcome: 'acquired' });
	// the same holder: DL-72 reuse, never a self-conflict
	assert.deepEqual(evaluateLeaseClaim({ active: { holder: 'agent-a', leaseId: 'L-001-01-1', deadline: 100 }, claimant: 'agent-a', now: 1, resource }), { ok: true, outcome: 'reused' });
	// bus posture: an expired lease does not conflict (the takeover)
	assert.deepEqual(evaluateLeaseClaim({ active: { holder: 'agent-a', leaseId: 'L-001-01-1', deadline: 100 }, claimant: 'agent-b', now: 200, resource }), { ok: true, outcome: 'takeover' });
	// store posture: a RECORDED-active lease conflicts regardless of the wall clock
	assert.deepEqual(evaluateLeaseClaim({ active: { holder: 'agent-a', leaseId: 'L-001-01-1', deadline: 100 }, claimant: 'agent-b', now: 200, resource, recordedExpiry: true }), {
		ok: false,
		conflict: { code: LEASE_CONFLICT_CODE, resource, violation: 'lease', holder: 'agent-a', leaseId: 'L-001-01-1', deadline: 100, claimant: 'agent-b' },
	}, 'the store posture: the journal\'s recorded state is the truth (the takeover goes through the recorded expiry hygiene)');
	// bus posture: a live foreign lease conflicts
	assert.equal(evaluateLeaseClaim({ active: { holder: 'agent-a', leaseId: 'L-001-01-1', deadline: 100 }, claimant: 'agent-b', now: 50, resource }).ok, false);
	// deadline-less holds: conflicts at any observation time
	assert.equal(evaluateLeaseClaim({ active: { holder: 'agent-a', leaseId: 'C-001-01', deadline: null }, claimant: 'agent-b', now: 9_000_000_000_000, resource }).ok, false);
});

// ---------------------------------------------------------------------------
// (a) + (b) The race through the composed flauz.a2a claim path: exactly one
// winner; the typed conflict shape; BOTH attempts journaled; chains verify
// ---------------------------------------------------------------------------

test('two concurrent claimants race through the flauz.a2a claim path: one acquires, the other receives the typed conflict; both attempts are journaled with attribution', async () => {
	const { store, root } = makeWiredStore('race');
	const graphId = await submittedApproved(store);
	const bus = new A2ABus(root);
	const resource = stepResourceId(graphId, 'S-01');

	// the race: two claimants, one resource, through the composed claim path
	const race = await Promise.allSettled([
		claimStepLease(store, bus, { graphId, stepId: 'S-01', claimant: 'flauz.agent.worker-1', ttlMs: 60_000, origin: 'a2a:flauz.agent.worker-1' }),
		claimStepLease(store, bus, { graphId, stepId: 'S-01', claimant: 'flauz.agent.worker-2', ttlMs: 60_000, origin: 'a2a:flauz.agent.worker-2' }),
	]);
	const winners = race.filter((result) => result.status === 'fulfilled');
	const losers = race.filter((result) => result.status === 'rejected');
	assert.equal(winners.length, 1, 'exactly one claimant acquired the lease');
	assert.equal(losers.length, 1, 'exactly one claimant was refused');
	const winner = (winners[0] as PromiseFulfilledResult<{ status: string; leaseId: string; holder: string; deadline: number; rowId: string; noticeId: string }>).value;
	const acquired = store.journalRows.filter((row) => row.type === 'lease-acquired');
	assert.equal(winner.status, 'acquired');
	assert.match(winner.leaseId, /^L-001-01-1$/);
	assert.equal(winner.holder, 'flauz.agent.worker-1', 'the first claimant into the transition lock wins (deterministic)');
	assert.equal(winner.deadline, (acquired[0].payload as { expiresAt: number }).expiresAt, 'the returned deadline is the acquisition row expiresAt');

	// the typed conflict SHAPE: code, holder, lease id, deadline (the assertable facts)
	const loserReason = (losers[0] as PromiseRejectedResult).reason;
	assert.ok(isLeaseConflictError(loserReason), 'the refusal is the typed lease conflict');
	assert.ok(loserReason instanceof LeaseConflictError);
	assert.ok(loserReason instanceof OrchestrationError, 'the typed conflict belongs to the closed-set taxonomy posture (an OrchestrationError subclass)');
	const facts = leaseConflictFacts(loserReason);
	assert.deepEqual(facts, {
		code: LEASE_CONFLICT_CODE,
		resource,
		violation: 'lease',
		holder: 'flauz.agent.worker-1',
		leaseId: 'L-001-01-1',
		deadline: winner.deadline,
		claimant: 'flauz.agent.worker-2',
	}, 'the typed facts: the current holder, the lease id, the deadline');

	// BOTH attempts are journaled with attribution: the winner's acquisition + the loser's refusal
	const conflicts = store.journalRows.filter((row) => row.type === 'conflict-noticed') as unknown as ConflictRow[];
	assert.equal(acquired.length, 1, 'exactly one lease-acquired row (never a silent double-execution)');
	assert.equal((acquired[0].payload as { holder: string }).holder, 'flauz.agent.worker-1');
	assert.equal(conflicts.length, 1, 'the loser\'s refusal is recorded history, not a dropped message');
	assert.equal(conflicts[0].payload.violation, 'lease');
	assert.equal(conflicts[0].payload.expectedHolder, 'flauz.agent.worker-1', 'the refusal names the current holder');
	assert.equal(conflicts[0].payload.actualRunner, 'flauz.agent.worker-2', 'the refusal names the refused claimant');
	assert.match(conflicts[0].payload.evidenceId ?? '', /^E-\d{6,}$/, 'the refusal minted its evidence row');

	// the winner's acquisition carries its evidence row too
	assert.match((acquired[0].payload as { evidenceId?: string }).evidenceId ?? '', /^E-\d{6,}$/);

	// the evidence linkage is verifiable: every minted sha256 recomputes from the journal row
	const ledger = readLedger(root);
	for (const row of [...acquired, ...conflicts]) {
		const evidenceId = (row.payload as { evidenceId?: string }).evidenceId as string;
		const ledgerRow = ledgerRowOfEvidenceId(ledger, evidenceId);
		assert.ok(ledgerRow !== undefined, `evidence row ${evidenceId} exists in the ledger`);
		assert.equal(ledgerRow.uri, `flauz-orch-transition://${row.rowId}`);
		assert.equal(ledgerRow.sha256, contentHashOf(transitionFactsOf(row)), 'the sha256 recomputes from the journal row (no fabricated evidence)');
	}

	// both chains verify end-to-end: the orchestration journal + the evidence ledger
	assert.equal(store.verifyJournal().ok, true, 'the hash-chained orchestration journal verifies');
	assert.equal(seamLedgerVerifies(root), true, 'the flauz.tasks/v0 evidence ledger chain verifies');

	// the winner's acquire notice landed on the on-disk bus (the watcher mirror)
	const journal = readFileSync(join(root, '.flauz', 'a2a', 'messages.jsonl'), 'utf-8').split('\n').filter((line: string) => line.length > 0).map((line: string) => JSON.parse(line) as { id: string; kind: string; from: string; to: string; payload: { action: string; resource: string; leaseUntil: number } });
	assert.equal(journal.length, 1, 'exactly one acquire notice (the loser\'s notice never landed)');
	assert.equal(journal[0].kind, 'resource-claim');
	assert.equal(journal[0].from, 'flauz.agent.worker-1');
	assert.equal(journal[0].payload.action, 'acquire');
	assert.equal(journal[0].payload.resource, resource);
	assert.equal(journal[0].payload.leaseUntil, winner.deadline);
	assert.equal(journal[0].id, winner.noticeId);
});

test('the a2a bus claim path itself enforces: a raw second acquire receives the typed conflict', () => {
	const root = makeRoot('bus-race');
	const bus = new A2ABus(root);
	const first = bus.post({ message: { kind: 'resource-claim', from: 'agent-a', to: 'flauz.watchers', ts: 1_700_000_000_000, payload: { action: 'acquire', resource: 'flauz-orch/G-001/S-01', leaseUntil: 1_700_000_060_000 } } });
	assert.equal(first.id, 'M-000001');
	// the projection: the notice IS the lease
	assert.deepEqual(bus.activeClaimOf('flauz-orch/G-001/S-01'), { holder: 'agent-a', leaseId: 'M-000001', deadline: 1_700_000_060_000, seq: 1 });
	// a foreign claimant receives the typed conflict (the enforcement point)
	assert.throws(() => bus.post({ message: { kind: 'resource-claim', from: 'agent-b', to: 'flauz.watchers', ts: 1_700_000_010_000, payload: { action: 'acquire', resource: 'flauz-orch/G-001/S-01', leaseUntil: 1_700_000_070_000 } } }), (error: unknown) => {
		assert.ok(isLeaseConflictError(error));
		const facts = leaseConflictFacts(error);
		assert.deepEqual(facts, {
			code: LEASE_CONFLICT_CODE,
			resource: 'flauz-orch/G-001/S-01',
			violation: 'lease',
			holder: 'agent-a',
			leaseId: 'M-000001',
			deadline: 1_700_000_060_000,
			claimant: 'agent-b',
		});
		return true;
	}, 'the raw bus claim path refuses a live foreign acquire with the typed conflict');
	// the refused notice never landed (the journal carries exactly the first acquire)
	assert.equal(bus.activeClaimOf('flauz-orch/G-001/S-01')?.leaseId, 'M-000001');
});

// ---------------------------------------------------------------------------
// (c) Expiry composition: an expired lease does not conflict - the takeover
// goes through the existing recovery-pass hygiene (DL-61)
// ---------------------------------------------------------------------------

test('an expired lease does not conflict after the recovery pass records the expiry; the takeover is recorded with the next ordinal lease id', async () => {
	const { store, root } = makeWiredStore('expiry');
	const graphId = await submittedApproved(store);
	const bus = new A2ABus(root);
	// agent-a acquires a short lease; the clock then passes the deadline
	const first = await claimStepLease(store, bus, { graphId, stepId: 'S-01', claimant: 'agent-a', ttlMs: 5_000, origin: 'a2a:agent-a' });
	assert.equal(first.leaseId, 'L-001-01-1');
	// before the recorded expiry the store posture still conflicts (the journal's recorded state is the truth)
	await assert.rejects(() => claimStepLease(store, bus, { graphId, stepId: 'S-01', claimant: 'agent-b', ttlMs: 60_000, origin: 'a2a:agent-b' }), (error: unknown) => isLeaseConflictError(error) && leaseConflictFacts(error)?.deadline === first.deadline,
		'the recorded-active lease conflicts (the takeover goes through the hygiene, never around it)');
	// the existing recovery-pass hygiene: a fresh store over the same root records the observed deadline passage
	const reloaded = new OrchestrationStore(root, { taskPort: new WorkspaceSeam(root), clock: makeClock(1_700_000_900_000).clock });
	const report = await recoveryScan(reloaded, { now: 1_700_000_900_000 });
	assert.ok(report.actions.includes('G-001:lease-expired:L-001-01-1'), `the recovery pass freed the expired lease (${JSON.stringify(report.actions)})`);
	// NOW the takeover: no conflict; the acquisition lands with the NEXT ordinal lease id (recorded)
	const takeover = await claimStepLease(reloaded, bus, { graphId, stepId: 'S-01', claimant: 'agent-b', ttlMs: 60_000, origin: 'a2a:agent-b' });
	assert.equal(takeover.status, 'acquired');
	assert.equal(takeover.leaseId, 'L-001-01-2', 'the takeover minted the next ordinal lease id');
	const expiredRows = reloaded.journalRows.filter((row) => row.type === 'lease-expired');
	assert.equal(expiredRows.length, 1, 'the takeover is recorded (the lease-expired row landed before the acquisition)');
	assert.equal((expiredRows[0].payload as { holder: string }).holder, 'agent-a');
	assert.equal(reloaded.verifyJournal().ok, true);
});

test('bus posture: at/past the acquire notice\'s leaseUntil the lease does not conflict - the new acquire takes over the projection', () => {
	const root = makeRoot('bus-expiry');
	const bus = new A2ABus(root);
	bus.post({ message: { kind: 'resource-claim', from: 'agent-a', to: 'flauz.watchers', ts: 1_700_000_000_000, payload: { action: 'acquire', resource: 'r-1', leaseUntil: 1_700_000_060_000 } } });
	// at the deadline the lease is expired: the takeover lands without a conflict
	const takeover = bus.post({ message: { kind: 'resource-claim', from: 'agent-b', to: 'flauz.watchers', ts: 1_700_000_060_000, payload: { action: 'acquire', resource: 'r-1', leaseUntil: 1_700_000_160_000 } } });
	assert.equal(takeover.id, 'M-000002');
	assert.deepEqual(bus.activeClaimOf('r-1'), { holder: 'agent-b', leaseId: 'M-000002', deadline: 1_700_000_160_000, seq: 2 }, 'the new acquire supersedes the expired one in the projection');
});

// ---------------------------------------------------------------------------
// (d) DL-72 lease reuse: a retry of the same durable step reuses its active
// lease and never conflicts with itself
// ---------------------------------------------------------------------------

test('the same holder re-claiming reuses the active lease (DL-72): no self-conflict, no second lease row, no second notice', async () => {
	const { store, root } = makeWiredStore('reuse');
	const graphId = await submittedApproved(store);
	const bus = new A2ABus(root);
	const first = await claimStepLease(store, bus, { graphId, stepId: 'S-01', claimant: 'agent-a', ttlMs: 60_000, origin: 'a2a:agent-a' });
	assert.equal(first.status, 'acquired');
	// the retry: the SAME claimant, the SAME durable step
	const retry = await claimStepLease(store, bus, { graphId, stepId: 'S-01', claimant: 'agent-a', ttlMs: 60_000, origin: 'a2a:agent-a' });
	assert.equal(retry.status, 'reused', 'the retry reuses the active lease');
	assert.equal(retry.leaseId, first.leaseId);
	assert.equal(retry.deadline, first.deadline);
	assert.equal(retry.rowId, first.rowId);
	assert.equal(retry.noticeId, null, 'a reuse posts no second notice');
	// one lease row, one notice, zero conflicts
	assert.equal(store.journalRows.filter((row) => row.type === 'lease-acquired').length, 1, 'the one-active-lease-per-step invariant holds (no second acquisition row)');
	assert.equal(store.journalRows.filter((row) => row.type === 'conflict-noticed').length, 0, 'never a self-conflict');
	const journal = readFileSync(join(root, '.flauz', 'a2a', 'messages.jsonl'), 'utf-8').split('\n').filter((line: string) => line.length > 0);
	assert.equal(journal.length, 1, 'exactly one acquire notice');
	// the raw store surface: acquireLease by the same holder returns the row that last set the lease facts
	const renewed = await store.renewLease({ graphId, stepId: 'S-01', ttlMs: 30_000, actor: 'agent', origin: 'test:tl2f3' });
	const reacquired = await store.acquireLease({ graphId, stepId: 'S-01', holder: 'agent-a', ttlMs: 60_000, actor: 'agent', origin: 'test:tl2f3' });
	assert.equal((reacquired.payload as { leaseId: string }).leaseId, first.leaseId);
	assert.equal((reacquired.payload as { expiresAt: number }).expiresAt, (renewed.payload as { expiresAt: number }).expiresAt, 'the reuse returns the row that last set the lease facts (the renewal)');
	assert.equal(store.journalRows.filter((row) => row.type === 'lease-acquired').length, 1, 'still one acquisition row');
	// the raw bus surface: a same-claimant re-acquire lands (the projection takes the last acquire)
	const busRoot = makeRoot('bus-reuse');
	const bus2 = new A2ABus(busRoot);
	bus2.post({ message: { kind: 'resource-claim', from: 'agent-a', to: 'flauz.watchers', ts: 1_700_000_000_000, payload: { action: 'acquire', resource: 'r-1', leaseUntil: 1_700_000_060_000 } } });
	const renotified = bus2.post({ message: { kind: 'resource-claim', from: 'agent-a', to: 'flauz.watchers', ts: 1_700_000_010_000, payload: { action: 'acquire', resource: 'r-1', leaseUntil: 1_700_000_080_000 } } });
	assert.equal(renotified.id, 'M-000002', 'the same claimant re-acquires without a conflict');
	assert.equal(bus2.activeClaimOf('r-1')?.deadline, 1_700_000_080_000);
});

// ---------------------------------------------------------------------------
// (e) Deadline-less holds: the exclusive step CLAIM holds until an explicit
// release (a human decides, the DL-66 posture) and conflicts while it does
// ---------------------------------------------------------------------------

test('a deadline-less claim holds and conflicts until the explicit release', async () => {
	const { store, root } = makeWiredStore('claim');
	const graphId = await submittedApproved(store);
	const bus = new A2ABus(root);
	const claim = await store.acquireClaim({ graphId, stepId: 'S-01', holder: 'agent-a', actor: 'agent', origin: 'a2a:agent-a' });
	assert.equal((claim.payload as { claimId: string }).claimId, 'C-001-01');
	// a second claimant conflicts - the typed facts carry deadline null (the hold has NO deadline)
	await assert.rejects(() => store.acquireClaim({ graphId, stepId: 'S-01', holder: 'agent-b', actor: 'agent', origin: 'a2a:agent-b' }), (error: unknown) => {
		assert.ok(isLeaseConflictError(error));
		const facts = leaseConflictFacts(error);
		assert.ok(facts !== null);
		assert.equal(facts.violation, 'claim');
		assert.equal(facts.leaseId, 'C-001-01');
		assert.equal(facts.holder, 'agent-a');
		assert.equal(facts.claimant, 'agent-b');
		assert.equal(facts.deadline, null, 'the deadline-less hold: only an explicit release ends it');
		return true;
	}, 'the deadline-less claim conflicts with every other claimant');
	// the refusal is recorded history with its evidence row
	const conflicts = store.journalRows.filter((row) => row.type === 'conflict-noticed') as unknown as ConflictRow[];
	assert.equal(conflicts.length, 1);
	assert.equal(conflicts[0].payload.violation, 'claim');
	assert.match(conflicts[0].payload.evidenceId ?? '', /^E-\d{6,}$/);
	// the claim law: isLeaseLive(null) is always true; the evaluation conflicts at any observation time
	assert.equal(isLeaseLive(null, 9_000_000_000_000), true);
	assert.equal(evaluateLeaseClaim({ active: { holder: 'agent-a', leaseId: 'C-001-01', deadline: null }, claimant: 'agent-b', now: 9_000_000_000_000, resource: 'flauz-orch/G-001/S-01' }).ok, false, 'the deadline-less hold conflicts at any observation time');
	// the same holder re-claiming reuses (no self-conflict)
	const reclaimed = await store.acquireClaim({ graphId, stepId: 'S-01', holder: 'agent-a', actor: 'agent', origin: 'a2a:agent-a' });
	assert.equal((reclaimed.payload as { claimId: string }).claimId, 'C-001-01', 'the same holder re-claim reuses the active claim');
	assert.equal(store.journalRows.filter((row) => row.type === 'claim-acquired').length, 1);
	// the explicit release ends the hold; the next claimant acquires (re-acquire reuses the deterministic claim id)
	await store.releaseClaim({ graphId, stepId: 'S-01', actor: 'human', origin: 'chat:/release' });
	const taken = await store.acquireClaim({ graphId, stepId: 'S-01', holder: 'agent-b', actor: 'agent', origin: 'a2a:agent-b' });
	assert.equal((taken.payload as { claimId: string }).claimId, 'C-001-01', 'the exclusive per-step claim id is deterministic');
	assert.equal(store.verifyJournal().ok, true);
	assert.equal(seamLedgerVerifies(root), true);
});

// ---------------------------------------------------------------------------
// Fail-closed: no silent takeover through a foreign release
// ---------------------------------------------------------------------------

test('a foreign release/expire of a LIVE lease is refused (no silent takeover through the notice journal)', () => {
	const root = makeRoot('bus-release');
	const bus = new A2ABus(root);
	bus.post({ message: { kind: 'resource-claim', from: 'agent-a', to: 'flauz.watchers', ts: 1_700_000_000_000, payload: { action: 'acquire', resource: 'r-1', leaseUntil: 1_700_000_060_000 } } });
	// a foreign release of the LIVE lease is refused with the typed conflict
	assert.throws(() => bus.post({ message: { kind: 'resource-claim', from: 'agent-b', to: 'flauz.watchers', ts: 1_700_000_010_000, payload: { action: 'release', resource: 'r-1', leaseUntil: null } } }), (error: unknown) => {
		const facts = leaseConflictFacts(error);
		assert.ok(facts !== null);
		assert.equal(facts.holder, 'agent-a');
		assert.equal(facts.deadline, 1_700_000_060_000);
		return true;
	}, 'only the active holder may clear a LIVE lease');
	assert.equal(bus.activeClaimOf('r-1')?.holder, 'agent-a', 'the lease still holds');
	// the HOLDER's release clears it
	bus.post({ message: { kind: 'resource-claim', from: 'agent-a', to: 'flauz.watchers', ts: 1_700_000_020_000, payload: { action: 'release', resource: 'r-1', leaseUntil: null } } });
	assert.equal(bus.activeClaimOf('r-1'), undefined, 'the holder\'s release cleared the projection');
	// after the release the resource is free again
	const reclaimed = bus.post({ message: { kind: 'resource-claim', from: 'agent-b', to: 'flauz.watchers', ts: 1_700_000_030_000, payload: { action: 'acquire', resource: 'r-1', leaseUntil: 1_700_000_090_000 } } });
	assert.equal(reclaimed.id, 'M-000003');
});

// ---------------------------------------------------------------------------
// (f) The TL2-004 regression: the approval gates stay fail-closed beside the
// conflict contract; the conflict history is durable (kill-recover)
// ---------------------------------------------------------------------------

test('the approval gates stay fail-closed beside the conflict contract; the conflict history survives the restart', async () => {
	const { store, root } = makeWiredStore('regression');
	const bus = new A2ABus(root);
	const graphId = await submittedApproved(store, GATED_STEP);
	// a gated step with a DEADLINE-BEARING approval request, plus a live lease held by agent-a
	await store.approvalRequest({ graphId, stepId: 'S-01', reason: 'gate', expiresAt: 1_700_000_030_000, actor: 'agent', origin: 'test:tl2f3' });
	const held = await claimStepLease(store, bus, { graphId, stepId: 'S-01', claimant: 'agent-a', ttlMs: 2_000_000, origin: 'a2a:agent-a' });
	assert.equal(held.status, 'acquired');
	// a conflicting claim is refused (the typed conflict) - and it NEVER grants the approval
	await assert.rejects(() => claimStepLease(store, bus, { graphId, stepId: 'S-01', claimant: 'agent-b', ttlMs: 2_000_000, origin: 'a2a:agent-b' }), (error: unknown) => isLeaseConflictError(error));
	assert.equal(store.journalRows.some((row) => row.type === 'approval-granted'), false, 'the conflict refusal never auto-grants an approval (no auto-grant, no gate weakening)');
	// the process dies; a fresh store + bus reload the SAME root (kill-recover)
	const reloaded = new OrchestrationStore(root, { taskPort: new WorkspaceSeam(root), clock: makeClock(1_700_000_900_000).clock });
	const reloadedBus = new A2ABus(root);
	// the conflict contract is DURABLE STATE: the live lease still holds after the restart
	await assert.rejects(() => claimStepLease(reloaded, reloadedBus, { graphId, stepId: 'S-01', claimant: 'agent-b', ttlMs: 2_000_000, origin: 'a2a:agent-b' }), (error: unknown) => {
		const facts = leaseConflictFacts(error);
		return facts?.holder === 'agent-a' && facts?.leaseId === 'L-001-01-1';
	}, 'the winner\'s lease survived the restart (the journal is the truth)');
	// the deadline-bearing approval expires during recovery - fail-closed, the step is CANCELLED (never auto-granted)
	const report = await recoveryScan(reloaded, { now: 1_700_000_900_000 });
	assert.ok(report.actions.includes('G-001:approval-expired:S-01'), JSON.stringify(report.actions));
	const state = reloaded.getGraphState(graphId) as { steps: Record<string, { status: string; approval: { state: string } | null }> };
	assert.equal(state.steps['S-01'].status, 'cancelled', 'the expired approval gate cancelled the step (fail-closed)');
	assert.equal(state.steps['S-01'].approval?.state, 'expired');
	assert.equal(reloaded.journalRows.some((row) => row.type === 'approval-granted'), false, 'no approval was ever granted by the machinery');
	// the holder re-claiming its OWN lease after the restart still reuses (DL-72 is durable too)
	const reuse = await claimStepLease(reloaded, reloadedBus, { graphId, stepId: 'S-01', claimant: 'agent-a', ttlMs: 2_000_000, origin: 'a2a:agent-a' });
	assert.equal(reuse.status, 'reused');
	assert.equal(reuse.leaseId, 'L-001-01-1');
	assert.equal(reloaded.verifyJournal().ok, true, 'the journal chain verifies across the whole regression run');
	assert.equal(seamLedgerVerifies(root), true, 'the evidence chain verifies across the whole regression run');
});

// ---------------------------------------------------------------------------
// The composed claim op input validation (fail-closed on malformed input)
// ---------------------------------------------------------------------------

test('claimStepLease validates its input fail-closed', async () => {
	const { store } = makeWiredStore('params');
	const graphId = await submittedApproved(store);
	const bus = new A2ABus(makeRoot('params-bus'));
	await assert.rejects(() => claimStepLease(store, bus, { graphId, stepId: 'S-01', claimant: '!not-an-agent', ttlMs: 1000, origin: 'test:tl2f3' }), /claimant must be an agent id/);
	await assert.rejects(() => claimStepLease(store, bus, { graphId, stepId: 'S-01', claimant: 'agent-a', ttlMs: 0, origin: 'test:tl2f3' }), /ttlMs must be a positive integer/);
	await assert.rejects(() => claimStepLease(store, bus, { graphId, stepId: 'S-01', claimant: 'agent-a', ttlMs: 1000, origin: '' }), /origin must be a non-empty provenance string/);
	await assert.rejects(() => claimStepLease(store, null as unknown as A2ABus, { graphId, stepId: 'S-01', claimant: 'agent-a', ttlMs: 1000, origin: 'test:tl2f3' }), /requires an a2a bus port/);
	await assert.rejects(() => claimStepLease(store, bus, { graphId: 'G-999', stepId: 'S-01', claimant: 'agent-a', ttlMs: 1000, origin: 'test:tl2f3' }), /unknown graph/);
});

// ---------------------------------------------------------------------------
// The evidence discipline of the refusal (DL-60: preview-before-mint under
// the transition lock; concurrent claims serialize)
// ---------------------------------------------------------------------------

test('concurrent conflicting claims serialize through the transition lock and each refusal mints exactly one evidence row', async () => {
	const { store, root } = makeWiredStore('concurrent');
	const graphId = await submittedApproved(store);
	const bus = new A2ABus(root);
	const winner = claimStepLease(store, bus, { graphId, stepId: 'S-01', claimant: 'agent-a', ttlMs: 60_000, origin: 'a2a:agent-a' });
	const loser1 = claimStepLease(store, bus, { graphId, stepId: 'S-01', claimant: 'agent-b', ttlMs: 60_000, origin: 'a2a:agent-b' });
	const loser2 = claimStepLease(store, bus, { graphId, stepId: 'S-01', claimant: 'agent-c', ttlMs: 60_000, origin: 'a2a:agent-c' });
	const [won, lost1, lost2] = await Promise.allSettled([winner, loser1, loser2]);
	assert.equal(won.status, 'fulfilled');
	assert.equal(lost1.status, 'rejected');
	assert.equal(lost2.status, 'rejected');
	assert.equal(store.journalRows.filter((row) => row.type === 'lease-acquired').length, 1);
	assert.equal(store.journalRows.filter((row) => row.type === 'conflict-noticed').length, 2, 'each refusal minted exactly one conflict-noticed row');
	// every refusal's evidence row references its own journal row (the linkage held under concurrency)
	const ledger = readLedger(root);
	for (const row of store.journalRows.filter((candidate) => candidate.type === 'conflict-noticed')) {
		const evidenceId = (row.payload as { evidenceId?: string }).evidenceId as string;
		const ledgerRow = ledgerRowOfEvidenceId(ledger, evidenceId);
		assert.ok(ledgerRow !== undefined, `evidence row ${evidenceId} exists in the ledger`);
		assert.equal(ledgerRow?.uri, `flauz-orch-transition://${row.rowId}`, 'the rowId linkage held under concurrency (no shifted linkage)');
		assert.equal(ledgerRow?.sha256, contentHashOf(transitionFactsOf(row)));
	}
	assert.equal(store.verifyJournal().ok, true);
	assert.equal(seamLedgerVerifies(root), true);
});

// ---------------------------------------------------------------------------
// The typed error through the orch protocol mediator: the closed-set mapping
// (fail-closed taxonomy posture, provenance preserved)
// ---------------------------------------------------------------------------

test('the typed conflict maps into the closed failure taxonomy: an OrchestrationError subclass carrying the conflict facts', () => {
	const error = new LeaseConflictError({ code: LEASE_CONFLICT_CODE, resource: 'flauz-orch/G-001/S-01', violation: 'lease', holder: 'agent-a', leaseId: 'L-001-01-1', deadline: 1_700_000_060_000, claimant: 'agent-b' });
	assert.ok(error instanceof OrchestrationError);
	assert.equal(error.code, 'illegal-transition', 'the domain code rides the closed ORCHESTRATION_ERROR_CODE_MAP (the taxonomy posture)');
	assert.equal(error.conflictCode, LEASE_CONFLICT_CODE, 'the conflict identity is the a2a namespace');
	assert.match(error.message, /is active/, 'the deterministic message keeps the landed law\'s phrasing');
	assert.match(error.message, /agent-a/);
	assert.match(error.message, /L-001-01-1/);
	assert.match(error.message, /1_700_000_060_000|1700000060000/);
	// the plain facts projection and the guards
	assert.deepEqual(leaseConflictFacts(error), { code: LEASE_CONFLICT_CODE, resource: 'flauz-orch/G-001/S-01', violation: 'lease', holder: 'agent-a', leaseId: 'L-001-01-1', deadline: 1_700_000_060_000, claimant: 'agent-b' });
	assert.equal(isLeaseConflictError(error), true);
	assert.equal(isLeaseConflictError(new Error('nope')), false);
	assert.equal(isLeaseConflictError(null), false);
	assert.equal(leaseConflictFacts(new Error('nope')), null);
});

// ---------------------------------------------------------------------------
// P2-FIX-104 (DL-78, the release-mirror law): a durable lease release
// PROJECTS onto the A2A bus - the composed release mints the retraction
// notice, the bus projection retracts, and a fresh claim by any claimant
// proceeds with both layers in agreement
// ---------------------------------------------------------------------------

test('P2-FIX-104 acceptance (DL-78 release-mirror): the composed release retracts the bus notice; a fresh claimStepLease by a different claimant lands exactly one acquisition row and the bus projection names the new holder', async () => {
	const { store, root } = makeWiredStore('p2fix104-accept');
	const graphId = await submittedApproved(store);
	const bus = new A2ABus(root);
	const resource = stepResourceId(graphId, 'S-01');

	// worker-1 holds the step lease through the composed claim path (row + notice)
	const first = await claimStepLease(store, bus, { graphId, stepId: 'S-01', claimant: 'flauz.agent.worker-1', ttlMs: 60_000, origin: 'a2a:flauz.agent.worker-1' });
	assert.equal(first.status, 'acquired');
	assert.notEqual(bus.activeClaimOf(resource), undefined, 'the acquire notice is the journal-projected claim');

	// the composed release (the DL-78 mirror): the durable row FIRST, then the retraction notice
	const released = await releaseStepLease(store, bus, { graphId, stepId: 'S-01', origin: 'a2a:flauz.agent.worker-1' });
	assert.equal(released.status, 'released');
	assert.equal(released.leaseId, first.leaseId);
	assert.equal(released.holder, 'flauz.agent.worker-1');
	assert.notEqual(released.rowId, null);
	assert.notEqual(released.noticeId, null);

	// the durable layer: exactly one lease-released row (the store's own release row shape), evidence-bearing
	const releasedRows = store.journalRows.filter((row) => row.type === 'lease-released');
	assert.equal(releasedRows.length, 1, 'exactly one lease-released row');
	assert.equal((releasedRows[0].payload as { leaseId: string }).leaseId, first.leaseId);
	assert.equal((releasedRows[0].payload as { holder: string }).holder, 'flauz.agent.worker-1');
	assert.equal((store.stateOf(graphId) as { leases?: Record<string, unknown> }).leases?.['S-01'], undefined, 'the store layer is free');
	assert.match((releasedRows[0].payload as { evidenceId?: string }).evidenceId ?? '', /^E-\d{6,}$/, 'the release minted its evidence row');
	const ledger = readLedger(root);
	const releaseEvidenceId = (releasedRows[0].payload as { evidenceId?: string }).evidenceId as string;
	const releaseLedgerRow = ledgerRowOfEvidenceId(ledger, releaseEvidenceId);
	assert.ok(releaseLedgerRow !== undefined, 'the release evidence row exists in the ledger');
	assert.equal(releaseLedgerRow?.uri, `flauz-orch-transition://${releasedRows[0].rowId}`, 'the release evidence references its own journal row');
	assert.equal(releaseLedgerRow?.sha256, contentHashOf(transitionFactsOf(releasedRows[0])), 'the release sha256 recomputes from the journal row (no fabricated evidence)');

	// the bus layer: the projection RETRACTED (the mirror - the notice never outlives the release)
	assert.equal(bus.activeClaimOf(resource), undefined, 'bus.activeClaimOf returns undefined once the release lands (DL-78)');

	// the retraction notice on the on-disk bus journal: acquire, release, both from the holder
	const notices = readFileSync(join(root, '.flauz', 'a2a', 'messages.jsonl'), 'utf-8').split('\n').filter((line: string) => line.length > 0).map((line: string) => JSON.parse(line) as { id: string; kind: string; from: string; to: string; payload: { action: string; resource: string; leaseUntil: number | null } });
	assert.equal(notices.length, 2, 'exactly two notices: the acquire and the retraction');
	assert.deepEqual(notices[0]?.payload, { action: 'acquire', resource, leaseUntil: first.deadline });
	assert.deepEqual(notices[1]?.payload, { action: 'release', resource, leaseUntil: null }, 'the retraction notice carries leaseUntil null (only acquire carries a lease)');
	assert.equal(notices[1]?.kind, 'resource-claim');
	assert.equal(notices[1]?.from, 'flauz.agent.worker-1', 'the retraction is minted from the RELEASED holder (fail-closed: only the active holder may clear a live claim)');
	assert.equal(notices[1]?.id, released.noticeId);

	// THE ACCEPTANCE TEST: a fresh claimStepLease by a DIFFERENT claimant - both layers in agreement
	const acquiredRowsBefore = store.journalRows.filter((row) => row.type === 'lease-acquired').length;
	const fresh = await claimStepLease(store, bus, { graphId, stepId: 'S-01', claimant: 'flauz.agent.worker-2', ttlMs: 60_000, origin: 'a2a:flauz.agent.worker-2' });
	assert.equal(fresh.status, 'acquired', 'the fresh claim by a different claimant proceeds (no typed conflict - both layers agree)');
	const acquiredRows = store.journalRows.filter((row) => row.type === 'lease-acquired');
	assert.equal(acquiredRows.length, acquiredRowsBefore + 1, 'exactly one acquisition row landed for the fresh claim');
	assert.equal((acquiredRows[acquiredRows.length - 1].payload as { holder: string }).holder, 'flauz.agent.worker-2');
	assert.equal(store.journalRows.filter((row) => row.type === 'conflict-noticed').length, 0, 'no refusal row: the released lease no longer conflicts');

	// the bus projection names the NEW holder
	const active = bus.activeClaimOf(resource);
	assert.equal(active?.holder, 'flauz.agent.worker-2');
	assert.equal(active?.leaseId, fresh.noticeId, 'the projection is the fresh acquire notice');

	// both chains verify end-to-end through the release and the re-acquire
	assert.equal(store.verifyJournal().ok, true);
	assert.equal(seamLedgerVerifies(root), true);
});

test('P2-FIX-104 regression: releaseStepLease validates its input fail-closed and refuses a step with no active lease', async () => {
	const { store } = makeWiredStore('p2fix104-params');
	const graphId = await submittedApproved(store);
	const bus = new A2ABus(makeRoot('p2fix104-params-bus'));
	await assert.rejects(() => releaseStepLease(store, bus, null as unknown as { graphId: string; stepId: string; origin: string }), /releaseStepLease requires/);
	await assert.rejects(() => releaseStepLease(store, bus, { graphId: '', stepId: 'S-01', origin: 'test:p2fix104' }), /requires a graphId and stepId/);
	await assert.rejects(() => releaseStepLease(store, bus, { graphId, stepId: 'S-01', origin: '' }), /origin must be a non-empty provenance string/);
	await assert.rejects(() => releaseStepLease(store, null as unknown as A2ABus, { graphId, stepId: 'S-01', origin: 'test:p2fix104' }), /requires an a2a bus port/);
	await assert.rejects(() => releaseStepLease(store, bus, { graphId: 'G-999', stepId: 'S-01', origin: 'test:p2fix104' }), /unknown graph/);
	// the store's own release posture, verbatim: a step with no active lease refuses
	await assert.rejects(() => releaseStepLease(store, bus, { graphId, stepId: 'S-01', origin: 'test:p2fix104' }), (error: unknown) => error instanceof OrchestrationError && error.code === 'illegal-transition' && /no active lease/.test(error.message));
	// the refusals minted no rows (fail-closed: no partial state)
	assert.equal(store.journalRows.filter((row) => row.type === 'lease-released').length, 0);
});

test('P2-FIX-104 regression: the leaseUntil horizon stays advisory for EXPIRY (an un-released expired lease does not retract; the takeover still goes through the recorded-expiry hygiene)', async () => {
	const { store, root } = makeWiredStore('p2fix104-expiry');
	const graphId = await submittedApproved(store);
	const bus = new A2ABus(root);
	const resource = stepResourceId(graphId, 'S-01');
	const first = await claimStepLease(store, bus, { graphId, stepId: 'S-01', claimant: 'agent-a', ttlMs: 5_000, origin: 'a2a:agent-a' });
	// the clock passes the deadline; the lease is EXPIRED but un-released and un-recorded
	const reloaded = new OrchestrationStore(root, { taskPort: new WorkspaceSeam(root), clock: makeClock(1_700_000_900_000).clock });
	const reloadedBus = new A2ABus(root);
	// the v0 expiry posture is UNCHANGED by the mirror: no auto-retraction, the store posture still conflicts
	assert.notEqual(reloadedBus.activeClaimOf(resource), undefined, 'an expired-but-un-released lease does not mint a retraction (the mirror fires on RELEASE only)');
	await assert.rejects(() => claimStepLease(reloaded, reloadedBus, { graphId, stepId: 'S-01', claimant: 'agent-b', ttlMs: 60_000, origin: 'a2a:agent-b' }), (error: unknown) => isLeaseConflictError(error) && leaseConflictFacts(error)?.deadline === first.deadline,
		'the recorded-active lease still conflicts (the takeover goes through the hygiene, never around it)');
	assert.equal(reloaded.journalRows.filter((row) => row.type === 'lease-released').length, 0, 'no release was involved (expiry is not release)');
	// the existing hygiene records the expiry; NOW the takeover lands and the bus names the taker
	const report = await recoveryScan(reloaded, { now: 1_700_000_900_000 });
	assert.ok(report.actions.includes('G-001:lease-expired:L-001-01-1'), `the recovery pass freed the expired lease (${JSON.stringify(report.actions)})`);
	const takeover = await claimStepLease(reloaded, reloadedBus, { graphId, stepId: 'S-01', claimant: 'agent-b', ttlMs: 60_000, origin: 'a2a:agent-b' });
	assert.equal(takeover.status, 'acquired');
	assert.equal(takeover.leaseId, 'L-001-01-2', 'the takeover minted the next ordinal lease id');
	assert.equal(reloadedBus.activeClaimOf(resource)?.holder, 'agent-b', 'the bus projection names the taker');
	assert.equal(reloaded.verifyJournal().ok, true);
});

test('P2-FIX-104 regression: the retracted projection is durable state (the mirror survives the restart; a different claimant acquires after recovery)', async () => {
	const { store, root } = makeWiredStore('p2fix104-restart');
	const graphId = await submittedApproved(store);
	const bus = new A2ABus(root);
	const resource = stepResourceId(graphId, 'S-01');
	await claimStepLease(store, bus, { graphId, stepId: 'S-01', claimant: 'agent-a', ttlMs: 60_000, origin: 'a2a:agent-a' });
	await releaseStepLease(store, bus, { graphId, stepId: 'S-01', origin: 'a2a:agent-a' });
	// kill-recover: fresh store + bus over the SAME root (the on-disk journals are the truth)
	const reloaded = new OrchestrationStore(root, { taskPort: new WorkspaceSeam(root), clock: makeClock(1_700_000_100_000).clock });
	const reloadedBus = new A2ABus(root);
	assert.equal((reloaded.stateOf(graphId) as { leases?: Record<string, unknown> }).leases?.['S-01'], undefined, 'the store layer is free after the restart');
	assert.equal(reloadedBus.activeClaimOf(resource), undefined, 'the retraction survived the restart (the projection re-derives from the notice journal)');
	// the acceptance posture holds post-restart: a different claimant proceeds with both layers in agreement
	const fresh = await claimStepLease(reloaded, reloadedBus, { graphId, stepId: 'S-01', claimant: 'agent-b', ttlMs: 60_000, origin: 'a2a:agent-b' });
	assert.equal(fresh.status, 'acquired');
	assert.equal(reloadedBus.activeClaimOf(resource)?.holder, 'agent-b', 'the bus projection names the new holder after recovery');
	const acquired = reloaded.journalRows.filter((row) => row.type === 'lease-acquired');
	assert.equal(acquired.length, 2, 'the original acquisition plus exactly one fresh acquisition row');
	assert.equal((acquired[1].payload as { holder: string }).holder, 'agent-b');
	assert.equal(reloaded.journalRows.filter((row) => row.type === 'conflict-noticed').length, 0);
	assert.equal(reloaded.verifyJournal().ok, true);
	assert.equal(seamLedgerVerifies(root), true);
});
