/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * FLAUZ-TL2-F1 — cancellation propagation + concurrent-append integrity
 * (battery INV-3 + INV-6), unit level on the durable-graph stack.
 *
 * The Agent OS battery (extensions/flauz-workflow/test/agentos-battery.test.ts)
 * is the independent verifier of the WORKFLOW-side contracts; this suite pins
 * the SAME laws on the flauz-agent/core durable orchestration stack:
 *
 *   INV-3 (M3):
 *     (a) a mid-flight cancel stops downstream work — the drive's
 *         pre-dispatch gate + post-effect abort mean step 2 NEVER starts
 *         (exactly one effect executed);
 *     (b) a cancel recorded before the drive never starts step 1;
 *     (c) a stale run unwinds with the TYPED cancelled-observed outcome
 *         (code 'stale-run-cancelled', message retaining the state-machine
 *         detail) — never the generic illegal-transition crash;
 *     (d) the cancel-attributed evidence rows land in the ledger and the
 *         journal chain verifies;
 *     (e) the INV-4 posture stays fail-closed: approval gates never
 *         auto-grant, a cancelled gate is never granted, a gated step never
 *         executes without the human approval.
 *
 *   INV-6 (M2):
 *     (a) the deterministic lost-update rendezvous at unit level — two
 *         appenders interleaved at the preview->mint window serialize on the
 *         transition lock: unique contiguous seqs, chain verifies;
 *     (b) a plain sequential append regression;
 *     (c) a lock-free direct write is IMPOSSIBLE through the public API
 *         while a serialized operation is in flight (code 'lock-violation'),
 *         and a stale candidate fails the journal-head assertion loudly.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { OrchestrationStore } from '../core/orchStore.mjs';
import { driveGraph } from '../core/runtime.mjs';
import { recoveryScan } from '../core/recovery.mjs';
import { WorkspaceSeam } from '../core/service.mjs';
import { OrchestrationError } from '../core/orchestration.mjs';
import { makeClock, readEvidenceLedger } from './harness/orchWorkspace.ts';

function makeRoot(prefix: string): string {
	return mkdtempSync(join(tmpdir(), `flauz-f1-${prefix}-`));
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function codeOf(error: unknown): string | undefined {
	return (error as { code?: string } | null)?.code;
}

async function approvedGraph(store: OrchestrationStore, steps: Array<Record<string, unknown>>): Promise<string> {
	const submitted = await store.submitGraph({ title: 'f1 graph', steps, actor: 'agent', origin: 'test:f1' });
	await store.approveGraph({ graphId: submitted.graphId, actor: 'human', origin: 'test:f1' });
	return submitted.graphId;
}

/** A counting sink: records every effect execution and can park mid-flight on a gate. */
class GatedSink {
	readonly executions: string[] = [];
	private gate: Promise<void> | null = null;
	private release: (() => void) | null = null;

	blockNext(): void {
		this.gate = new Promise<void>(resolve => {
			this.release = resolve;
		});
	}

	unblock(): void {
		this.release?.();
		this.release = null;
	}

	async run(key: string, spec: { stepId: string; attempt: number }): Promise<{ ok: boolean; value: string; replayed: boolean }> {
		this.executions.push(key);
		if (this.gate !== null) {
			const gate = this.gate;
			this.gate = null;
			await gate;
		}
		return { ok: true, value: `effect:${spec.stepId}:attempt-${spec.attempt}`, replayed: false };
	}
}

/**
 * The rendezvous taskPort: its appendEvidence awaits a caller-controlled gate,
 * so an evidence-bearing store operation can be parked INSIDE its
 * preview -> mint -> append window (the deterministic interleaving point).
 */
class RendezvousTaskPort {
	readonly evidenceCalls: Array<{ taskId: string; row: { uri: string } }> = [];
	private gate: Promise<void> | null = null;
	private releaseGate: (() => void) | null = null;

	parkNextEvidence(): void {
		this.gate = new Promise<void>(resolve => {
			this.releaseGate = resolve;
		});
	}

	release(): void {
		this.releaseGate?.();
		this.releaseGate = null;
	}

	createTask(args: { title: string }): { taskId: string } {
		return { taskId: 'T-001' };
	}

	appendEvent(args: { taskId: string; event: Record<string, unknown> }): { task: null } {
		return { task: null };
	}

	async appendEvidence(args: { taskId: string; row: { uri: string } }): Promise<{ evidenceId: string; seq: number }> {
		this.evidenceCalls.push(args);
		if (this.gate !== null) {
			const gate = this.gate;
			this.gate = null;
			await gate;
		}
		return { evidenceId: `E-${String(this.evidenceCalls.length).padStart(6, '0')}`, seq: this.evidenceCalls.length };
	}
}

// ---------------------------------------------------------------------------
// INV-3 (M3) — cancellation propagation on the durable-graph stack
// ---------------------------------------------------------------------------

test('M3a: a human cancel landing mid-flight stops downstream work (step 2 never starts; one effect executed)', async () => {
	const root = makeRoot('m3a');
	const { clock } = makeClock(1000);
	const store = new OrchestrationStore(root, { clock });
	const graphId = await approvedGraph(store, [
		{ stepId: 'S-01', title: 'first', instruction: 'first' },
		{ stepId: 'S-02', title: 'second', instruction: 'second', dependsOn: ['S-01'] },
	]);

	const sink = new GatedSink();
	sink.blockNext(); // step S-01's effect parks mid-flight; the cancel lands underneath it
	const drive = driveGraph(store, { graphId, sink, runnerId: 'f1-runner', origin: 'test:f1' });
	await new Promise<void>(resolve => setImmediate(resolve)); // the drive enters sink.run(S-01)

	// the human cancel, recorded with attribution, mid-flight
	await store.cancelGraph({ graphId, reason: 'user aborted the run', actor: 'human', origin: 'chat:/cancel' });
	sink.unblock();
	const report = await drive;

	// exactly ONE effect executed: S-02 NEVER started (the downstream gate + the in-flight abort)
	assert.equal(sink.executions.length, 1, `effect executions: ${JSON.stringify(sink.executions)}`);
	assert.equal(report.started.length, 1);
	assert.equal(report.started[0]?.stepId, 'S-01');
	assert.equal(report.completed, false, 'a cancelled drive never completes the graph');
	assert.equal(report.cancelled, true, 'the typed cancellation outcome is surfaced');
	assert.ok(report.cancelObservation, 'the drive records the attributed cancellation observation');
	assert.equal(report.cancelObservation?.reason, 'in-flight-abort');
	assert.equal(report.cancelObservation?.stepId, 'S-01');
	assert.equal(report.cancelObservation?.evidenceId, null, 'no taskPort -> the journal row is the primary record');

	// the graph stays terminal cancelled; every step cancelled; no fake success
	const state = store.getGraphState(graphId) as { graphStatus: string; steps: Record<string, { status: string }>; cancelObserved: { reason: string; actor: string } | null };
	assert.equal(state.graphStatus, 'cancelled');
	assert.equal(state.steps['S-01']?.status, 'cancelled');
	assert.equal(state.steps['S-02']?.status, 'cancelled');
	assert.equal(state.cancelObserved?.reason, 'in-flight-abort');
	// the observation row carries the CANCEL'S actor (attribution propagation)
	const observedRow = store.journalRows.find(row => row.type === 'cancel-observed');
	assert.ok(observedRow, 'the cancel-observed journal row exists');
	assert.equal(observedRow?.actor, 'human');
});

test('M3b: a cancel recorded BEFORE the drive never starts any step', async () => {
	const root = makeRoot('m3b');
	const { clock } = makeClock(2000);
	const store = new OrchestrationStore(root, { clock });
	const graphId = await approvedGraph(store, [
		{ stepId: 'S-01', title: 'first', instruction: 'first' },
		{ stepId: 'S-02', title: 'second', instruction: 'second' },
	]);

	await store.cancelGraph({ graphId, reason: 'never mind', actor: 'human', origin: 'chat:/cancel' });
	const sink = new GatedSink();
	const report = await driveGraph(store, { graphId, sink, origin: 'test:f1' });

	assert.equal(sink.executions.length, 0, 'no step was ever dispatched');
	assert.equal(report.started.length, 0);
	assert.equal(report.cancelled, true);
	assert.equal(report.cancelObservation?.reason, 'downstream-stopped', 'the pre-dispatch gate tripped and recorded the observation');
	const state = store.getGraphState(graphId) as { graphStatus: string };
	assert.equal(state.graphStatus, 'cancelled');
});

test('M3c: a stale run unwinds with the TYPED cancelled-observed outcome, not the generic state-machine crash', async () => {
	const root = makeRoot('m3c');
	const { clock } = makeClock(3000);
	const store = new OrchestrationStore(root, { clock });
	const graphId = await approvedGraph(store, [
		{ stepId: 'S-01', title: 'first', instruction: 'first' },
		{ stepId: 'S-02', title: 'second', instruction: 'second', dependsOn: ['S-01'] },
	]);
	const started = await store.startStep({ graphId, stepId: 'S-01', runnerId: 'stale-runner', actor: 'agent', origin: 'test:f1' });

	// the cancel sweeps the in-flight S-01 underneath its runner
	await store.cancelGraph({ graphId, reason: 'user aborted the run', actor: 'human', origin: 'chat:/cancel' });

	// level 3: the stale runner is past its last checkpoint and appends a step transition
	await assert.rejects(
		() => store.finishStep({ graphId, stepId: 'S-01', attempt: started.attempt, outcome: 'succeeded', actor: 'agent', origin: 'test:f1', output: 'late' }),
		(error: unknown) => {
			assert.ok(error instanceof OrchestrationError);
			assert.equal(codeOf(error), 'stale-run-cancelled', `the typed outcome, not the generic crash (got ${String(codeOf(error))})`);
			assert.match(messageOf(error), /stale run observed terminal cancelled/);
			// the state-machine detail stays embedded (diagnosable, and the pinned
			// regression surface keeps matching)
			assert.match(messageOf(error), /not allowed from step status cancelled/);
			return true;
		},
	);

	// a new start on the cancelled graph is also the typed stale-run outcome
	await assert.rejects(
		() => store.startStep({ graphId, stepId: 'S-02', runnerId: 'another', actor: 'agent', origin: 'test:f1' }),
		(error: unknown) => {
			assert.equal(codeOf(error), 'stale-run-cancelled');
			assert.match(messageOf(error), /not allowed from step status cancelled|not allowed from graph status cancelled/);
			return true;
		},
	);

	// every OTHER illegal transition keeps the generic state-machine error (only the cancelled path is typed)
	const other = await approvedGraph(store, [{ stepId: 'S-01', title: 'x', instruction: 'x' }]);
	await assert.rejects(
		() => store.completeGraph({ graphId: other, actor: 'agent', origin: 'test:f1' }),
		(error: unknown) => {
			assert.equal(codeOf(error), 'illegal-transition');
			assert.ok(!/stale run/.test(messageOf(error)), 'the generic illegal transition is not the stale-run outcome');
			return true;
		},
	);
});

test('M3d: the cancel-attributed evidence rows verify in the chain (real WorkspaceSeam taskPort)', async () => {
	const root = makeRoot('m3d');
	const { clock } = makeClock(4000);
	const seam = new WorkspaceSeam(root);
	const store = new OrchestrationStore(root, { clock, taskPort: seam });
	const graphId = await approvedGraph(store, [
		{ stepId: 'S-01', title: 'first', instruction: 'first' },
		{ stepId: 'S-02', title: 'second', instruction: 'second', dependsOn: ['S-01'] },
	]);

	const sink = new GatedSink();
	sink.blockNext();
	const drive = driveGraph(store, { graphId, sink, runnerId: 'f1-runner', origin: 'test:f1' });
	await new Promise<void>(resolve => setImmediate(resolve));
	await store.cancelGraph({ graphId, reason: 'user aborted the run', actor: 'human', origin: 'chat:/cancel' });
	sink.unblock();
	const report = await drive;

	// the cancel-observed row minted a ledger evidence row (DL-60 linkage)
	assert.ok(report.cancelObservation?.evidenceId, 'the observation carries its minted evidence id');
	const ledger = readEvidenceLedger(root);
	const observed = ledger.find(row => typeof row.uri === 'string' && (row.uri as string).startsWith('flauz-orch-transition://'));
	assert.ok(observed, 'the transition-evidence row is in the ledger');

	// both durable chains verify
	const journalVerdict = store.verifyJournal();
	assert.ok(journalVerdict.ok, `journal verify: ${JSON.stringify(journalVerdict)}`);
	const seamState = (seam as unknown as { verifyLedger: () => { ok: boolean; rows: number; firstBadSeq?: number } }).verifyLedger();
	assert.ok(seamState.ok, `ledger verify: ${JSON.stringify(seamState)}`);

	// the journal row's payload embeds the minted evidence id
	const observedRow = store.journalRows.find(row => row.type === 'cancel-observed');
	assert.equal(observedRow?.payload.evidenceId, report.cancelObservation?.evidenceId);
	assert.equal(observedRow?.actor, 'human', 'attribution: the observation row carries the CANCEL\'S actor');

	// seqs stay unique + contiguous under the serialized appends
	const seqs = store.journalRows.map(row => row.seq);
	assert.deepEqual(seqs, seqs.slice().sort((a, b) => a - b), 'journal rows are seq-ascending');
	assert.equal(new Set(seqs).size, seqs.length, 'no duplicate seqs');
});

test('M3e: INV-4 posture regression — approval gates stay fail-closed around the cancellation semantics', async () => {
	const root = makeRoot('m3e');
	const { clock } = makeClock(5000);
	const store = new OrchestrationStore(root, { clock });
	const graphId = await approvedGraph(store, [
		{ stepId: 'S-01', title: 'gated', instruction: 'gated', gate: 'human-approval' },
	]);

	// the drive records the approval REQUEST (never a grant) and stops there
	const sink = new GatedSink();
	const report = await driveGraph(store, { graphId, sink, origin: 'test:f1' });
	assert.equal(sink.executions.length, 0, 'a gated step never executes without the human approval');
	const pending = store.getGraphState(graphId) as { steps: Record<string, { status: string; approval: { state: string } | null }> };
	assert.equal(pending.steps['S-01']?.status, 'awaiting-approval');
	assert.equal(pending.steps['S-01']?.approval?.state, 'pending');
	assert.equal(report.completed, false);

	// an agent cannot grant the approval (human-only actor gate, unchanged)
	await assert.rejects(
		() => store.approvalDecide({ graphId, stepId: 'S-01', decision: 'granted', actor: 'agent', origin: 'test:f1' }),
		(error: unknown) => {
			assert.match(messageOf(error), /requires actor human, got 'agent'/);
			return true;
		},
	);

	// a cancel during the approval wait cancels the step; a LATE grant is the
	// typed stale-run outcome (never an auto-grant, never a resurrection)
	await store.cancelGraph({ graphId, reason: 'user aborted at the gate', actor: 'human', origin: 'chat:/cancel' });
	await assert.rejects(
		() => store.approvalDecide({ graphId, stepId: 'S-01', decision: 'granted', actor: 'human', origin: 'test:f1' }),
		(error: unknown) => {
			assert.equal(codeOf(error), 'stale-run-cancelled');
			return true;
		},
	);
	const cancelled = store.getGraphState(graphId) as { graphStatus: string; steps: Record<string, { status: string }> };
	assert.equal(cancelled.graphStatus, 'cancelled');
	assert.equal(cancelled.steps['S-01']?.status, 'cancelled');

	// the gated-step law survives: starting the gated step without any
	// approval-granted record is rejected even before any cancel existed
	const other = await approvedGraph(store, [{ stepId: 'S-01', title: 'g', instruction: 'g', gate: 'human-approval' }]);
	await assert.rejects(
		() => store.startStep({ graphId: other, stepId: 'S-01', runnerId: 'r', actor: 'agent', origin: 'test:f1' }),
		(error: unknown) => {
			assert.match(messageOf(error), /no human approval-granted record/);
			return true;
		},
	);
});

// ---------------------------------------------------------------------------
// INV-6 (M2) — concurrent-append integrity on the durable-graph stack
// ---------------------------------------------------------------------------

test('M2a: the deterministic lost-update rendezvous serializes — two appenders at the mint window, unique contiguous seqs, chain verifies', async () => {
	const root = makeRoot('m2a');
	const { clock } = makeClock(6000);
	const taskPort = new RendezvousTaskPort();
	const store = new OrchestrationStore(root, { clock, taskPort });
	const graphId = await approvedGraph(store, [
		{ stepId: 'S-01', title: 'a', instruction: 'a' },
		{ stepId: 'S-02', title: 'b', instruction: 'b' },
	]);
	const rowsBefore = store.journalRows.length;

	// appender A parks INSIDE its preview -> mint -> append window
	taskPort.parkNextEvidence();
	const opA = store.approvalRequest({ graphId, stepId: 'S-01', reason: 'gate a', actor: 'agent', origin: 'test:f1' });
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(taskPort.evidenceCalls.length, 1, 'appender A reached the mint window');

	// appender B queues on the transition lock behind A (the interleaving that
	// used to lose updates before the serialized-append discipline)
	const opB = store.approvalRequest({ graphId, stepId: 'S-02', reason: 'gate b', actor: 'agent', origin: 'test:f1' });

	// M2c (part 1): a lock-free direct write is impossible while a serialized op is in flight
	assert.throws(
		() => store.appendRow('route-decided', { graphId, stepId: null, actor: 'agent', origin: 'test:rogue', payload: { targetAgent: 'flauz.agent.rogue', reason: 'capability-match' } }),
		(error: unknown) => {
			assert.equal(codeOf(error), 'lock-violation');
			assert.match(messageOf(error), /lock-free direct journal write is impossible/);
			return true;
		},
	);

	taskPort.release();
	const [rowA, rowB] = await Promise.all([opA, opB]);

	// unique contiguous seqs, chain verifies
	const verdict = store.verifyJournal();
	assert.ok(verdict.ok, `journal verify: ${JSON.stringify(verdict)}`);
	const seqs = store.journalRows.map(row => row.seq);
	assert.deepEqual(seqs, Array.from({ length: seqs.length }, (_, index) => index + 1), 'seqs are unique and contiguous from 1');
	assert.equal(rowA.seq, rowsBefore + 1);
	assert.equal(rowB.seq, rowsBefore + 2);
	// both evidence-bearing rows landed with their minted linkage intact
	assert.match(rowA.payload.evidenceId as string, /^E-\d{6,}$/);
	assert.match(rowB.payload.evidenceId as string, /^E-\d{6,}$/);
});

test('M2b: plain sequential appends keep the chain contiguous and verifying (regression)', async () => {
	const root = makeRoot('m2b');
	const { clock } = makeClock(7000);
	const store = new OrchestrationStore(root, { clock });
	const graphId = await approvedGraph(store, [
		{ stepId: 'S-01', title: 'a', instruction: 'a' },
		{ stepId: 'S-02', title: 'b', instruction: 'b', dependsOn: ['S-01'] },
	]);

	const sink = new GatedSink();
	const report = await driveGraph(store, { graphId, sink, origin: 'test:f1' });
	assert.equal(report.completed, true);
	assert.equal(sink.executions.length, 2);

	const seqs = store.journalRows.map(row => row.seq);
	assert.deepEqual(seqs, Array.from({ length: seqs.length }, (_, index) => index + 1));
	assert.ok(store.verifyJournal().ok);

	// the recovery pass (serialized appends through appendRowLocked) keeps the law
	const scan = await recoveryScan(store, { now: 8_000_000_000_000 });
	assert.ok(scan.clean, `recovery actions: ${JSON.stringify(scan.actions)}`);
	const seqsAfter = store.journalRows.map(row => row.seq);
	assert.deepEqual(seqsAfter, Array.from({ length: seqsAfter.length }, (_, index) => index + 1));
	assert.ok(store.verifyJournal().ok);
});

test('M2c: a bypassed candidate fails the journal-head assertion loudly (the single-writer discipline is enforced fail-closed)', async () => {
	const root = makeRoot('m2c');
	const { clock } = makeClock(8000);
	const store = new OrchestrationStore(root, { clock });
	const graphId = await approvedGraph(store, [{ stepId: 'S-01', title: 'a', instruction: 'a' }]);

	// a candidate is previewed (seq minted)...
	const candidate = store.previewRow('route-decided', {
		graphId,
		stepId: null,
		actor: 'agent',
		origin: 'test:f1',
		payload: { targetAgent: 'flauz.agent.worker-1', reason: 'capability-match' },
	});
	// ...another append lands at that seq (the head moves underneath)...
	await store.appendRowLocked('route-decided', {
		graphId,
		stepId: 'S-01',
		actor: 'agent',
		origin: 'test:f1',
		payload: { targetAgent: 'flauz.agent.worker-2', reason: 'load-balance' },
	});
	// ...the stale candidate can no longer land: the shifted head fails loudly
	// (the replay's seq-ascending law or the explicit head assertion - either
	// way the discipline is enforced fail-closed and the disk is untouched)
	assert.throws(
		() => store.appendCandidate(candidate),
		(error: unknown) => {
			assert.ok(codeOf(error) === 'internal' || codeOf(error) === 'illegal-transition', `unexpected code ${String(codeOf(error))}`);
			assert.match(messageOf(error), /no longer matches the journal head|seq-ascending/);
			return true;
		},
	);
	// the chain is intact: the refused write never touched the disk
	assert.ok(store.verifyJournal().ok);
});

test('M2 (audit): the append-path inventory — every journal write goes through the serialized store API', async () => {
	// The serialized-append law covers the three append-only ledgers under
	// flauz-agent/core: the orchestration journal (appendRow/appendRowInternal
	// + appendCandidate, all guarded or in-lock), the evidence ledger
	// (WorkspaceSeam.appendEvidence - synchronous single-owner stdio service,
	// no interleaving window by construction) and the A2A journal (A2ABus.post
	// - same). This test proves the store-side law end-to-end: a mixed storm of
	// concurrent serialized operations interleaves with zero lost updates.
	const root = makeRoot('m2audit');
	const { clock } = makeClock(9000);
	const store = new OrchestrationStore(root, { clock });
	const graphId = await approvedGraph(store, [
		{ stepId: 'S-01', title: 'a', instruction: 'a' },
		{ stepId: 'S-02', title: 'b', instruction: 'b' },
		{ stepId: 'S-03', title: 'c', instruction: 'c' },
	]);

	const storm = [] as Array<Promise<unknown>>;
	for (let index = 0; index < 12; index += 1) {
		storm.push(store.appendRowLocked('route-decided', {
			graphId,
			stepId: index % 2 === 0 ? null : 'S-01',
			actor: 'agent',
			origin: `test:storm-${index}`,
			payload: { targetAgent: 'flauz.agent.worker-1', reason: 'capability-match', details: { index } },
		}));
	}
	storm.push(store.submitGraph({ title: 'concurrent submit', steps: [{ stepId: 'S-01', title: 'x', instruction: 'x' }], actor: 'agent', origin: 'test:storm' }));
	storm.push(store.cancelGraph({ graphId, reason: 'storm cancel', actor: 'human', origin: 'test:storm' }));
	await Promise.all(storm);

	const seqs = store.journalRows.map(row => row.seq);
	assert.deepEqual(seqs, Array.from({ length: seqs.length }, (_, index) => index + 1), 'no lost updates under the concurrent storm');
	assert.ok(store.verifyJournal().ok);
	const state = store.getGraphState(graphId) as { graphStatus: string; cancelRequested: boolean };
	assert.equal(state.graphStatus, 'cancelled');
	assert.equal(state.cancelRequested, true);
});

test('M3/M2 compose: recovery of a crashed drive after a mid-flight cancel keeps both laws (serialized appends, coherent cancellation)', async () => {
	const root = makeRoot('compose');
	const { clock } = makeClock(10_000);
	const store = new OrchestrationStore(root, { clock });
	const graphId = await approvedGraph(store, [
		{ stepId: 'S-01', title: 'first', instruction: 'first' },
		{ stepId: 'S-02', title: 'second', instruction: 'second', dependsOn: ['S-01'] },
	]);
	await store.startStep({ graphId, stepId: 'S-01', runnerId: 'crashed-runner', actor: 'agent', origin: 'test:f1' });
	await store.cancelGraph({ graphId, reason: 'user aborted the run', actor: 'human', origin: 'chat:/cancel' });

	// the "process died" between the cancel and the sweep... it did not (the
	// sweep is atomic here), so instead: reload from disk and run the recovery
	// pass (the serialized-append path) over the cancelled graph.
	const reloaded = new OrchestrationStore(root, { clock });
	const scan = await recoveryScan(reloaded, { now: 11_000_000_000_000 });
	assert.ok(scan.clean || scan.actions.every(action => !action.includes('cancel-continued')), 'the coherent cancellation needs no continuation');
	assert.ok(reloaded.verifyJournal().ok);
	const seqs = reloaded.journalRows.map(row => row.seq);
	assert.deepEqual(seqs, Array.from({ length: seqs.length }, (_, index) => index + 1));

	// a re-drive observes the recorded cancellation and stops (level 1)
	const sink = new GatedSink();
	const report = await driveGraph(reloaded, { graphId, sink, origin: 'test:f1' });
	assert.equal(sink.executions.length, 0);
	assert.equal(report.cancelled, true);
	assert.equal(report.cancelObservation?.reason, 'downstream-stopped');
	// and the observation is journaled once, with the cancel's actor
	const observed = reloaded.journalRows.filter(row => row.type === 'cancel-observed');
	assert.equal(observed.length, 1);
	assert.equal(observed[0]?.actor, 'human');
	assert.ok(reloaded.verifyJournal().ok);
});
