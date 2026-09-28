/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-001 M2 suite: typed retry policy, cancellation propagation, takeover.
 *
 * The human authorization boundary is PRESERVED and pinned here: approvals
 * and takeovers are requests that gate execution, never auto-granted -
 * the runtime stalls at awaiting-approval / takeover-pending until a HUMAN
 * actor decides, and a crash in between changes nothing about that.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrchestrationStore } from '../core/orchStore.mjs';
import { driveGraph } from '../core/runtime.mjs';
import { recoveryScan } from '../core/recovery.mjs';
import { DEFAULT_RETRY_POLICY, planRetry, backoffDelayMs, validateRetryPolicy, TERMINAL_FAILURE_CLASSES, RETRYABLE_FAILURE_CLASSES } from '../core/policy.mjs';
import { journalLine } from '../core/orchestration.mjs';
import { FileEffectSink, makeClock, type ScenarioOp, executeOp, freshContext } from './harness/orchWorkspace.ts';

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

const FAR_FUTURE = 1893456000000;

function makeRoot(): string {
	return mkdtempSync(join(tmpdir(), 'flauz-orch-policy-'));
}

function makeStore(root: string, clockBase = 1700000000000): OrchestrationStore {
	const { clock } = makeClock(clockBase);
	return new OrchestrationStore(root, { clock });
}

/** A scripted-outcome sink (no log file - used only for drive tests in-process). */
class ScriptedSink {
	private readonly outcomes: Map<string, { ok: boolean; value?: string; failureClass?: string; message?: string }>;
	readonly keys: string[] = [];
	constructor(outcomes: Array<[string, { ok: boolean; value?: string; failureClass?: string; message?: string }]> = []) {
		this.outcomes = new Map(outcomes);
	}
	run(key: string, spec: { stepId: string; attempt: number }): { ok: boolean; value?: string; failureClass?: string; message?: string; replayed: boolean } {
		this.keys.push(key);
		const outcome = this.outcomes.get(key) ?? { ok: true, value: `ok:${spec.stepId}#${spec.attempt}` };
		return { ...outcome, replayed: false };
	}
}

async function submittedGraph(root: string, steps: Array<Record<string, unknown>>, policy: Record<string, unknown> = {}): Promise<{ store: OrchestrationStore; graphId: string }> {
	const store = makeStore(root);
	const submitted = await store.submitGraph({ title: 'policy graph', steps, policy, actor: 'agent', origin: 'test:policy' });
	store.approveGraph({ graphId: submitted.graphId, actor: 'human', origin: 'test:policy' });
	return { store, graphId: submitted.graphId };
}

async function driveAll(store: OrchestrationStore, graphId: string, sink: { run: unknown }, now: number): Promise<Awaited<ReturnType<typeof driveGraph>>> {
	return await driveGraph(store, { graphId, sink: sink as never, now, runnerId: 'runtime-test' });
}

// ---------------------------------------------------------------------------
// typed retry policy
// ---------------------------------------------------------------------------

test('retry policy: the full validation matrix', () => {
	assert.equal(validateRetryPolicy(DEFAULT_RETRY_POLICY).ok, true);
	const bad: unknown[] = [
		null,
		42,
		{},
		{ maxAttempts: 1 },
		{ maxAttempts: 0, backoff: { kind: 'fixed', baseMs: 1 }, retryOn: ['transient'] },
		{ maxAttempts: 2, backoff: { kind: 'fixed', baseMs: 0 }, retryOn: ['transient'] },
		{ maxAttempts: 2, backoff: { kind: 'fixed', baseMs: 1 }, retryOn: [] },
		{ maxAttempts: 2, backoff: { kind: 'fixed', baseMs: 1 }, retryOn: ['transient'], extra: 1 },
		{ maxAttempts: 2, backoff: { kind: 'fixed', baseMs: 10, maxMs: 5 }, retryOn: ['transient'] },
	];
	for (const policy of bad) {
		assert.equal(validateRetryPolicy(policy).ok, false, JSON.stringify(policy));
	}
	// terminal classes are refused in retryOn, hard rule
	for (const failureClass of TERMINAL_FAILURE_CLASSES) {
		const verdict = validateRetryPolicy({ maxAttempts: 2, backoff: { kind: 'fixed', baseMs: 1 }, retryOn: [failureClass] });
		assert.equal(verdict.ok, false, failureClass);
	}
	// unknown classes are refused
	assert.equal(validateRetryPolicy({ maxAttempts: 2, backoff: { kind: 'fixed', baseMs: 1 }, retryOn: ['sometimes'] }).ok, false);
	// every retryable class is accepted
	for (const failureClass of RETRYABLE_FAILURE_CLASSES) {
		const verdict = validateRetryPolicy({ maxAttempts: 2, backoff: { kind: 'fixed', baseMs: 1 }, retryOn: [failureClass] });
		assert.equal(verdict.ok, true, failureClass);
	}
});

test('retry lifecycle: fail -> backoff-gated retry -> success', async () => {
	const root = makeRoot();
	const { store, graphId } = await submittedGraph(root, [
		{ stepId: 'S-01', title: 'flaky', instruction: 'flaky step', retryPolicy: { maxAttempts: 3, backoff: { kind: 'fixed', baseMs: 1000 }, retryOn: ['transient', 'timeout'] } },
	]);
	const sink = new ScriptedSink([
		['flauz-orch/G-001/S-01/run/1', { ok: false, failureClass: 'transient', message: 'attempt 1 flaked' }],
	]);
	// attempt 1 fails (transient)
	let report: Awaited<ReturnType<typeof driveGraph>> = await driveAll(store, graphId, sink, 1000000);
	assert.equal(report.started.length, 1);
	assert.equal(report.started[0].attempt, 1);
	// the failure is recorded with a planned retry (the drive schedules it in the same pass)
	const failedRow = store.journalRows.find((row) => row.type === 'step-failed');
	assert.equal(failedRow?.payload.retryPlanned, true);
	// the retry is scheduled but gated by the backoff window
	let state = store.getGraphState(graphId) as unknown as { graphStatus: string; steps: Record<string, { status: string; retryNotBefore: number | null; takeover: Record<string, unknown> | null }> };
	assert.equal(state.steps['S-01'].status, 'ready');
	assert.equal(state.steps['S-01'].retryNotBefore, 1000000 + 1000);
	// driving inside the window does NOT run it (backoff is honored)
	report = await driveAll(store, graphId, sink, 1000000 + 500);
	assert.equal(report.started.length, 0);
	// past the window the retry runs (attempt 2, same sink default ok)
	report = await driveAll(store, graphId, sink, 1000000 + 1001);
	assert.equal(report.started.length, 1);
	assert.equal(report.started[0].attempt, 2);
	state = store.getGraphState(graphId) as unknown as { graphStatus: string; steps: Record<string, { status: string; retryNotBefore: number | null; takeover: Record<string, unknown> | null }> };
	assert.equal(state.steps['S-01'].status, 'succeeded');
	// and the graph completes
	assert.equal(report.completed, true);
	assert.equal(report.graphStatus, 'completed');
});

test('retry lifecycle: exhausted attempts -> terminal failure -> onStepFailure fail-graph', async () => {
	const root = makeRoot();
	const { store, graphId } = await submittedGraph(root, [
		{ stepId: 'S-01', title: 'doomed', instruction: 'doomed step', retryPolicy: { maxAttempts: 2, backoff: { kind: 'fixed', baseMs: 1 }, retryOn: ['transient'] } },
	], { onStepFailure: 'fail-graph' });
	// every attempt fails with a scripted sink
	const sink = {
		async run(key: string, spec: { stepId: string; attempt: number }) {
			return { ok: false, failureClass: 'transient', message: `attempt ${spec.attempt} failed`, replayed: false };
		},
	};
	await driveAll(store, graphId, sink, 1000);
	await driveAll(store, graphId, sink, 2000);
	await driveAll(store, graphId, sink, 3000);
	const state = store.getGraphState(graphId) as { graphStatus: string; steps: Record<string, { status: string; failure: { retryPlanned: boolean } | null }> };
	assert.equal(state.steps['S-01'].status, 'failed');
	assert.equal(state.steps['S-01'].failure?.retryPlanned, false, 'attempts exhausted -> no retry planned');
	assert.equal(state.graphStatus, 'failed', 'fail-graph policy failed the graph');
});

test('terminal failure classes are never retried (invalid-input)', async () => {
	const root = makeRoot();
	const { store, graphId } = await submittedGraph(root, [
		{ stepId: 'S-01', title: 'bad input', instruction: 'bad input step', retryPolicy: { maxAttempts: 3, backoff: { kind: 'fixed', baseMs: 1 }, retryOn: ['transient', 'timeout'] } },
	]);
	const sink = {
		async run() {
			return { ok: false, failureClass: 'invalid-input', message: 'the tool input is malformed', replayed: false };
		},
	};
	const report = await driveAll(store, graphId, sink, 1000);
	await driveAll(store, graphId, sink, 999999);
	const state = store.getGraphState(graphId) as { steps: Record<string, { status: string; failure: { class: string } | null }> };
	assert.equal(state.steps['S-01'].status, 'failed');
	assert.equal(state.steps['S-01'].failure?.class, 'invalid-input');
	assert.equal(report.started.length, 1, 'exactly one attempt - terminal classes never retry');
});

test('onStepFailure continue: dependents are cancelled with cause dependency-failed', async () => {
	const root = makeRoot();
	const { store, graphId } = await submittedGraph(root, [
		{ stepId: 'S-01', title: 'root', instruction: 'root step', retryPolicy: { maxAttempts: 1, backoff: { kind: 'fixed', baseMs: 1 }, retryOn: ['transient'] } },
		{ stepId: 'S-02', title: 'child', instruction: 'child step', dependsOn: ['S-01'] },
		{ stepId: 'S-03', title: 'grandchild', instruction: 'grandchild step', dependsOn: ['S-02'] },
		{ stepId: 'S-04', title: 'independent', instruction: 'independent step' },
	], { onStepFailure: 'continue' });
	const sink = new ScriptedSink([
		['flauz-orch/G-001/S-01/run/1', { ok: false, failureClass: 'transient', message: 'doomed from the start' }],
	]);
	await driveAll(store, graphId, sink, 1000);
	await driveAll(store, graphId, sink, 999999);
	const state = store.getGraphState(graphId) as { graphStatus: string; steps: Record<string, { status: string }> };
	assert.equal(state.steps['S-01'].status, 'failed');
	assert.equal(state.steps['S-02'].status, 'cancelled', 'direct dependent cancelled (dependency-failed)');
	assert.equal(state.steps['S-03'].status, 'cancelled', 'transitive dependent cancelled (dependency-failed)');
	assert.equal(state.steps['S-04'].status, 'succeeded', 'independent step still drains');
	const cancelledRows = store.journalRows.filter((row) => row.type === 'step-cancelled' && row.payload.cause === 'dependency-failed');
	assert.equal(cancelledRows.length, 2);
	// the graph does NOT complete and does NOT fail-fast: it drains to its policy end
	assert.equal(state.graphStatus, 'approved');
});

test('crash between step-failed and step-retry-scheduled: the runtime re-derives the pending retry', async () => {
	const root = makeRoot();
	const { store, graphId } = await submittedGraph(root, [
		{ stepId: 'S-01', title: 'flaky', instruction: 'flaky step', retryPolicy: { maxAttempts: 3, backoff: { kind: 'fixed', baseMs: 1000 }, retryOn: ['transient'] } },
	]);
	const sink = new ScriptedSink([
		['flauz-orch/G-001/S-01/run/1', { ok: false, failureClass: 'transient', message: 'attempt 1 flaked' }],
	]);
	// attempt 1 fails; retryPlanned is recorded but the retry-scheduled row is
	// "lost to the crash" - simulate by never appending it: drive once (which
	// schedules it), then verify the no-schedule state directly via the store.
	const report = await driveAll(store, graphId, sink, 1000000);
	assert.equal(report.started.length, 1);
	// rebuild the mid-crash state manually: strip the runtime's retry row
	const rows = store.journalRows.filter((row) => row.type !== 'step-retry-scheduled');
	const freshRoot = makeRoot();
	const { mkdirSync, writeFileSync } = await import('node:fs');
	mkdirSync(join(freshRoot, '.flauz', 'orchestration'), { recursive: true });
	writeFileSync(join(freshRoot, '.flauz', 'orchestration', 'graphs.json'), readFileSync(join(root, '.flauz', 'orchestration', 'graphs.json'), 'utf-8'));
	writeFileSync(join(freshRoot, '.flauz', 'orchestration', 'journal.jsonl'), `${rows.map((row) => journalLine(row)).join('\n')}\n`);
	const crashed = makeStore(freshRoot);
	const crashedState = crashed.getGraphState(graphId) as { steps: Record<string, { status: string; failure: { retryPlanned: boolean } | null; nextAttempt: number | null }> };
	assert.equal(crashedState.steps['S-01'].status, 'failed');
	assert.equal(crashedState.steps['S-01'].failure?.retryPlanned, true);
	assert.equal(crashedState.steps['S-01'].nextAttempt, null, 'the retry row never landed (mid-crash state)');
	// the runtime re-derives and schedules the retry without any external help;
	// the attempt runs once the backoff window elapses (the scheduler tick)
	await driveAll(crashed, graphId, new ScriptedSink(), 2000000 + 2000);
	const drive = await driveAll(crashed, graphId, new ScriptedSink(), 3000000);
	const after = crashed.getGraphState(graphId) as { steps: Record<string, { status: string }> };
	assert.equal(after.steps['S-01'].status, 'succeeded');
	assert.equal(drive.completed, true);
});

// ---------------------------------------------------------------------------
// cancellation propagation
// ---------------------------------------------------------------------------

test('user cancel: persisted cancellation record + coherent graph-wide stop', async () => {
	const root = makeRoot();
	const { store, graphId } = await submittedGraph(root, [
		{ stepId: 'S-01', title: 'a', instruction: 'a' },
		{ stepId: 'S-02', title: 'b', instruction: 'b', dependsOn: ['S-01'] },
		{ stepId: 'S-03', title: 'c', instruction: 'c', gate: 'human-approval' },
	]);
	// one step running, one blocked, one gated-pending
	store.startStep({ graphId, stepId: 'S-01', runnerId: 'r', actor: 'agent', origin: 'test:policy' });
	const result = await store.cancelGraph({ graphId, reason: 'user aborted the run', actor: 'human', origin: 'chat:/cancel' });
	assert.deepEqual(result.cancelledSteps, ['S-01', 'S-02', 'S-03']);
	const state = store.getGraphState(graphId) as { graphStatus: string; cancelRequested: boolean; cancelReason: string; steps: Record<string, { status: string }> };
	assert.equal(state.graphStatus, 'cancelled');
	assert.equal(state.cancelRequested, true, 'the cancellation record is persisted in the journal');
	assert.equal(state.cancelReason, 'user aborted the run');
	for (const stepId of ['S-01', 'S-02', 'S-03']) {
		assert.equal(state.steps[stepId].status, 'cancelled', stepId);
	}
	// every propagated row carries its provenance
	const propagated = store.journalRows.filter((row) => row.type === 'step-cancelled');
	assert.equal(propagated.length, 3);
	for (const row of propagated) {
		assert.equal(row.actor, 'service');
		assert.equal(row.origin, 'runtime:cancel-propagation');
		assert.equal(row.payload.cause, 'user-cancel');
	}
	// terminal statuses hold: nothing may move after cancellation
	assert.throws(() => store.startStep({ graphId, stepId: 'S-02', runnerId: 'r', actor: 'agent', origin: 'test:policy' }),
		(error: unknown) => /not allowed from step status cancelled/.test(messageOf(error)));
});

test('crash mid-sweep: recovery continues the cancellation to coherence', async () => {
	const root = makeRoot();
	const { store, graphId } = await submittedGraph(root, [
		{ stepId: 'S-01', title: 'a', instruction: 'a' },
		{ stepId: 'S-02', title: 'b', instruction: 'b' },
	]);
	store.startStep({ graphId, stepId: 'S-01', runnerId: 'r', actor: 'agent', origin: 'test:policy' });
	// simulate the crash: only cancel-requested + ONE step-cancelled landed
	store.appendRow('cancel-requested', {
		graphId,
		actor: 'human',
		origin: 'chat:/cancel',
		payload: { reason: 'crash mid-sweep' },
	});
	store.appendRow('step-cancelled', {
		graphId,
		stepId: 'S-01',
		actor: 'service',
		origin: 'runtime:cancel-propagation',
		payload: { cause: 'user-cancel' },
	});
	// reload from disk (the "process died" after those rows)
	const reloaded = makeStore(root);
	const midState = reloaded.getGraphState(graphId) as { cancelRequested: boolean; graphStatus: string; steps: Record<string, { status: string }> };
	assert.equal(midState.cancelRequested, true);
	assert.equal(midState.graphStatus, 'approved', 'graph not yet cancelled - the sweep is incomplete');
	assert.equal(midState.steps['S-01'].status, 'cancelled');
	assert.equal(midState.steps['S-02'].status, 'ready', 'S-02 escaped the first sweep');
	// recovery completes the coherent stop
	const report = await recoveryScan(reloaded, { now: FAR_FUTURE });
	assert.ok(report.actions.includes('G-001:cancel-continued:S-02'), JSON.stringify(report.actions));
	assert.ok(report.actions.includes('G-001:graph-cancelled'), JSON.stringify(report.actions));
	const after = reloaded.getGraphState(graphId) as { graphStatus: string; steps: Record<string, { status: string }> };
	assert.equal(after.graphStatus, 'cancelled');
	assert.equal(after.steps['S-02'].status, 'cancelled');
	// the continued rows carry recovery provenance
	const continued = reloaded.journalRows.filter((row) => row.origin === 'recovery:cancel-continuation');
	assert.equal(continued.length, 2);
});

test('cancel from awaiting-approval: the human gate is also cancellable', async () => {
	const root = makeRoot();
	const { store, graphId } = await submittedGraph(root, [{ stepId: 'S-01', title: 'gated', instruction: 'gated', gate: 'human-approval' }]);
	store.approvalRequest({ graphId, stepId: 'S-01', reason: 'gate', actor: 'service', origin: 'runtime:gate' });
	const result = await store.cancelGraph({ graphId, reason: 'never mind', actor: 'human', origin: 'chat:/cancel' });
	assert.deepEqual(result.cancelledSteps, ['S-01']);
	const state = store.getGraphState(graphId) as { graphStatus: string };
	assert.equal(state.graphStatus, 'cancelled');
});

// ---------------------------------------------------------------------------
// takeover (human assumes a step - a distinct transition class with provenance)
// ---------------------------------------------------------------------------

test('takeover: full lifecycle with provenance and evidence', async () => {
	const root = makeRoot();
	const { store, graphId } = await submittedGraph(root, [{ stepId: 'S-01', title: 'stuck', instruction: 'a stuck step' }]);
	store.startStep({ graphId, stepId: 'S-01', runnerId: 'runner-a', actor: 'agent', origin: 'test:policy' });
	// the human requests takeover of the running step
	const requested = store.takeoverRequest({ graphId, stepId: 'S-01', actor: 'human', origin: 'chat:/takeover' });
	assert.equal(requested.type, 'takeover-requested');
	let state = store.getGraphState(graphId) as unknown as { graphStatus: string; steps: Record<string, { status: string; takeover: Record<string, unknown> | null }> };
	assert.equal(state.steps['S-01'].status, 'takeover-pending');
	assert.equal(state.steps['S-01'].takeover?.requestedBy, 'human');
	// the step is now owned by the human: the runtime cannot run it
	const drive = await driveAll(store, graphId, new ScriptedSink(), FAR_FUTURE);
	assert.equal(drive.started.length, 0, 'a takeover-pending step is not runnable by the runtime');
	// accept + complete are HUMAN-ONLY (pinned in the core suite; here the happy path)
	store.takeoverAccept({ graphId, stepId: 'S-01', actor: 'human', origin: 'chat:/takeover' });
	const completed = await store.takeoverComplete({
		graphId, stepId: 'S-01', actor: 'human', origin: 'chat:/takeover',
		summary: 'finished the debugging by hand',
		evidence: [{ kind: 'note', uri: 'flauz-test://takeover/manual-fix', sha256: 'b'.repeat(64) }],
	});
	assert.equal(completed.type, 'takeover-completed', 'a DISTINCT transition class');
	state = store.getGraphState(graphId) as unknown as { graphStatus: string; steps: Record<string, { status: string; takeover: Record<string, unknown> | null }> };
	assert.equal(state.steps['S-01'].status, 'succeeded');
	assert.equal(state.steps['S-01'].takeover?.state, 'completed');
	assert.equal(state.graphStatus, 'approved');
	// provenance: the row carries actor human + the origin surface
	assert.equal(completed.actor, 'human');
	assert.equal(completed.origin, 'chat:/takeover');
	// the graph can now complete
	store.completeGraph({ graphId, actor: 'service', origin: 'runtime:completion' });
	assert.equal((store.getGraphState(graphId) as { graphStatus: string }).graphStatus, 'completed');
});

test('takeover survives a crash: the pending state holds until the human returns', async () => {
	const root = makeRoot();
	const ops: ScenarioOp[] = [
		{ op: 'submit', title: 'takeover crash', steps: [{ stepId: 'S-01', title: 'a', instruction: 'a' }] },
		{ op: 'approve' },
		{ op: 'start', stepId: 'S-01', runnerId: 'runner-a' },
		{ op: 'takeoverRequest', stepId: 'S-01' },
	];
	const { clock } = makeClock(1700000000000);
	const store = makeStore(root);
	const ctx = freshContext();
	const sink = new FileEffectSink(join(root, 'effect-sink.jsonl'));
	for (const op of ops) {
		await executeOp(store, sink, op, ctx);
	}
	// "crash": a fresh store reloads
	const reloaded = makeStore(root);
	const state = reloaded.getGraphState('G-001') as { steps: Record<string, { status: string }>; interrupted: string[] };
	assert.equal(state.steps['S-01'].status, 'takeover-pending', 'the takeover state survives the restart');
	// recovery does NOT touch it (not running, not a lease, not a cancel) -
	// the human gate survives the crash exactly as it stood
	const report = await recoveryScan(reloaded, { now: FAR_FUTURE });
	assert.equal(report.clean, true, JSON.stringify(report.actions));
	assert.equal((reloaded.getGraphState('G-001') as { steps: Record<string, { status: string }> }).steps['S-01'].status, 'takeover-pending');
	// the human returns post-restart and completes
	reloaded.takeoverAccept({ graphId: 'G-001', stepId: 'S-01', actor: 'human', origin: 'chat:/takeover' });
	await reloaded.takeoverComplete({ graphId: 'G-001', stepId: 'S-01', actor: 'human', origin: 'chat:/takeover', summary: 'done later' });
	const after = reloaded.getGraphState('G-001') as { steps: Record<string, { status: string }> };
	assert.equal(after.steps['S-01'].status, 'succeeded');
});

// ---------------------------------------------------------------------------
// the never-auto-granted posture
// ---------------------------------------------------------------------------

test('a gated step NEVER runs without a human grant (drive stalls, then proceeds after grant)', async () => {
	const root = makeRoot();
	const { store, graphId } = await submittedGraph(root, [
		{ stepId: 'S-01', title: 'gated', instruction: 'gated step', gate: 'human-approval' },
		{ stepId: 'S-02', title: 'free', instruction: 'free step' },
	], { onStepFailure: 'manual' });
	const sink = new ScriptedSink();
	let report = await driveAll(store, graphId, sink, 1000);
	// S-02 runs; S-01 gets its REQUEST recorded and stalls
	const startedIds = report.started.map((entry) => entry.stepId);
	assert.deepEqual(startedIds, ['S-02']);
	const state = store.getGraphState(graphId) as { pendingApprovals: string[]; steps: Record<string, { status: string }> };
	assert.deepEqual(state.pendingApprovals, ['S-01']);
	assert.equal(state.steps['S-01'].status, 'awaiting-approval');
	// driving again changes nothing (never auto-granted)
	await driveAll(store, graphId, sink, 999999);
	assert.deepEqual((store.getGraphState(graphId) as { pendingApprovals: string[] }).pendingApprovals, ['S-01']);
	// the human grants; only then does the step run
	store.approvalDecide({ graphId, stepId: 'S-01', decision: 'granted', actor: 'human', origin: 'chat:/approve' });
	report = await driveAll(store, graphId, sink, 1000000);
	assert.deepEqual(report.started.map((entry) => entry.stepId), ['S-01']);
	assert.equal(report.completed, true);
	// the grant row is human-actor with its origin surface
	const grant = store.journalRows.find((row) => row.type === 'approval-granted');
	assert.equal(grant?.actor, 'human');
	assert.equal(grant?.origin, 'chat:/approve');
});

test('denial cancels the gated step with a denial failure record (the human can always say no)', async () => {
	const root = makeRoot();
	const { store, graphId } = await submittedGraph(root, [{ stepId: 'S-01', title: 'gated', instruction: 'gated', gate: 'human-approval' }]);
	const sink = new ScriptedSink();
	await driveAll(store, graphId, sink, 1000);
	store.approvalDecide({ graphId, stepId: 'S-01', decision: 'denied', note: 'not this command', actor: 'human', origin: 'chat:/deny' });
	const state = store.getGraphState(graphId) as { steps: Record<string, { status: string; failure: { class: string } | null; approval: { state: string } | null }> };
	assert.equal(state.steps['S-01'].status, 'cancelled');
	assert.equal(state.steps['S-01'].failure?.class, 'approval-denied');
	assert.equal(state.steps['S-01'].approval?.state, 'denied');
});
