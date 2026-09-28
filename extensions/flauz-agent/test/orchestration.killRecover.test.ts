/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-001 M1 restart/recovery safety suite - the kill-and-recover matrix.
 *
 * BINDING CONTRACT (work order section 1, M1): after a process kill at ANY
 * point, a recovery pass reconstructs logical state from the persisted
 * graph + journal - no lost steps, no duplicated side effects, no
 * fabricated transitions.
 *
 * Layer A (in-process crash points): for every op boundary of every
 * scenario, a fresh store reloads the on-disk prefix and must derive the
 * IDENTICAL state as the uninterrupted run (byte-identical rows, so the
 * states are compared exactly); plus a torn-tail simulation at every row
 * boundary (a crash mid-append drops exactly the incomplete row).
 *
 * Layer B (REAL SIGKILL matrix): the scenario runs in a spawned child
 * (test/harness/killTarget.ts, phase-gated); the parent kills it with
 * SIGKILL before/after EVERY op, then:
 *   1. the killed run's journal is a byte-identical prefix of the golden
 *      run's journal (the kill lost nothing, mutated nothing);
 *   2. recoveryScan appends ONLY legitimate recovery rows (step-interrupted
 *      for steps actually running, lease-expired for leases actually
 *      expired, cancel continuation, recovery-scan) - actor service,
 *      provenance recovery;
 *   3. re-driving the graph completes exactly what an uninterrupted run
 *      would complete (a fixpoint simulator of the recovery semantics
 *      computes the expectation), and human gates HOLD (no step is
 *      auto-granted: gated steps stall at awaiting-approval);
 *   4. the effect sink log shows every idempotency key executed EXACTLY
 *      once (re-driven attempts replay; they never duplicate).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OrchestrationStore } from '../core/orchStore.mjs';
import { recoveryScan } from '../core/recovery.mjs';
import { driveGraph } from '../core/runtime.mjs';
import { planRetry, DEFAULT_RETRY_POLICY } from '../core/policy.mjs';
import {
	goldenRun, readJournal, readGraphs, writeTornJournal, stableStringify, snapshotOf, FileEffectSink, makeClock,
	type ScenarioOp, type GoldenRun,
} from './harness/orchWorkspace.ts';

/** The error-message extractor for assert predicates (unknown-safe). */
function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

const CLOCK_BASE = 1700000000000;
const FAR_FUTURE = 1893456000000;
const RECOVERY_ROW_TYPES = new Set(['step-interrupted', 'lease-expired', 'step-cancelled', 'graph-cancelled', 'recovery-scan']);

// ---------------------------------------------------------------------------
// The scenarios (every journal transition class appears in at least one)
// ---------------------------------------------------------------------------

const SUCCESS_STEPS: Array<Record<string, unknown>> = [
	{ stepId: 'S-01', title: 'first', instruction: 'run the first step' },
	{ stepId: 'S-02', title: 'second', instruction: 'run the second step', dependsOn: ['S-01'] },
	{ stepId: 'S-03', title: 'third gated', instruction: 'run the third step', dependsOn: ['S-01', 'S-02'], gate: 'human-approval' },
	{ stepId: 'S-04', title: 'fourth routed', instruction: 'run the fourth step', dependsOn: ['S-02'] },
];

const SCENARIO_SUCCESS: ScenarioOp[] = [
	{ op: 'submit', title: 'success scenario', steps: SUCCESS_STEPS, policy: { onStepFailure: 'fail-graph' } },
	{ op: 'approve' },
	{ op: 'claim', stepId: 'S-01', holder: 'agent-x' },
	{ op: 'releaseClaim', stepId: 'S-01' },
	{ op: 'lease', stepId: 'S-02', holder: 'agent-y', ttlMs: 60000 },
	{ op: 'renewLease', stepId: 'S-02', ttlMs: 60000 },
	{ op: 'releaseLease', stepId: 'S-02' },
	{ op: 'start', stepId: 'S-01', runnerId: 'runner-a' },
	{ op: 'effect', stepId: 'S-01', outcome: 'ok', value: 'first done' },
	{ op: 'finishOk', stepId: 'S-01', output: 'first done' },
	{ op: 'start', stepId: 'S-02', runnerId: 'runner-a' },
	{ op: 'effect', stepId: 'S-02', outcome: 'fail', failureClass: 'timeout', message: 'timed out once' },
	{ op: 'finishFail', stepId: 'S-02', failureClass: 'timeout', message: 'timed out once' },
	{ op: 'retry', stepId: 'S-02' },
	{ op: 'start', stepId: 'S-02', runnerId: 'runner-a' },
	{ op: 'effect', stepId: 'S-02', outcome: 'ok', value: 'second done' },
	{ op: 'finishOk', stepId: 'S-02', output: 'second done' },
	{ op: 'approvalRequest', stepId: 'S-03' },
	{ op: 'approvalGrant', stepId: 'S-03' },
	{ op: 'route', stepId: 'S-04', targetAgent: 'flauz.agent.worker-1', reason: 'capability-match' },
	{ op: 'start', stepId: 'S-04', runnerId: 'flauz.agent.worker-1' },
	{ op: 'delegation', stepId: 'S-04', messageId: 'M-000001' },
	{ op: 'effect', stepId: 'S-04', outcome: 'ok', value: 'worker result' },
	{ op: 'result', stepId: 'S-04', messageId: 'M-000001', outcome: 'ok', summary: 'worker result' },
	{ op: 'start', stepId: 'S-03', runnerId: 'runner-a' },
	{ op: 'effect', stepId: 'S-03', outcome: 'ok', value: 'third done' },
	{ op: 'finishOk', stepId: 'S-03', output: 'third done' },
	{ op: 'complete' },
	{ op: 'scan' },
];

const SCENARIO_CANCEL: ScenarioOp[] = [
	{ op: 'submit', title: 'cancel scenario', steps: [
		{ stepId: 'S-01', title: 'a', instruction: 'a' },
		{ stepId: 'S-02', title: 'b', instruction: 'b', dependsOn: ['S-01'] },
	] },
	{ op: 'approve' },
	{ op: 'start', stepId: 'S-01', runnerId: 'runner-a' },
	{ op: 'effect', stepId: 'S-01', outcome: 'ok', value: 'partial work' },
	{ op: 'cancel', reason: 'user changed their mind' },
];

const SCENARIO_TAKEOVER: ScenarioOp[] = [
	{ op: 'submit', title: 'takeover scenario', steps: [{ stepId: 'S-01', title: 'a', instruction: 'a' }] },
	{ op: 'approve' },
	{ op: 'claim', stepId: 'S-01', holder: 'agent-x' },
	{ op: 'start', stepId: 'S-01', runnerId: 'runner-b' },
	{ op: 'takeoverRequest', stepId: 'S-01' },
	{ op: 'takeoverAccept', stepId: 'S-01' },
	{ op: 'takeoverComplete', stepId: 'S-01', summary: 'finished by hand' },
	{ op: 'complete' },
];

const SCENARIO_REJECT: ScenarioOp[] = [
	{ op: 'submit', title: 'reject scenario', steps: [{ stepId: 'S-01', title: 'a', instruction: 'a' }] },
	{ op: 'reject' },
];

const SCENARIO_FAIL: ScenarioOp[] = [
	{ op: 'submit', title: 'fail scenario', steps: [{ stepId: 'S-01', title: 'a', instruction: 'a', retryPolicy: { maxAttempts: 1, backoff: { kind: 'fixed', baseMs: 10 }, retryOn: ['transient'] } }], policy: { onStepFailure: 'fail-graph' } },
	{ op: 'approve' },
	{ op: 'start', stepId: 'S-01', runnerId: 'runner-a' },
	{ op: 'effect', stepId: 'S-01', outcome: 'fail', failureClass: 'transient', message: 'still failing' },
	{ op: 'finishFail', stepId: 'S-01', failureClass: 'transient', message: 'still failing' },
	{ op: 'failGraph', stepId: 'S-01' },
];

const SCENARIO_INTERRUPT: ScenarioOp[] = [
	{ op: 'submit', title: 'interrupt scenario', steps: [{ stepId: 'S-01', title: 'a', instruction: 'a' }] },
	{ op: 'approve' },
	{ op: 'lease', stepId: 'S-01', holder: 'agent-y', ttlMs: 1000 },
	{ op: 'start', stepId: 'S-01', runnerId: 'runner-a' },
	{ op: 'effect', stepId: 'S-01', outcome: 'ok', value: 'work happened but was never recorded' },
];

const SCENARIOS: Array<[string, ScenarioOp[]]> = [
	['success', SCENARIO_SUCCESS],
	['cancel', SCENARIO_CANCEL],
	['takeover', SCENARIO_TAKEOVER],
	['reject', SCENARIO_REJECT],
	['fail', SCENARIO_FAIL],
	['interrupt', SCENARIO_INTERRUPT],
];

// ---------------------------------------------------------------------------
// The fixpoint simulator of recovery semantics (the expected final state)
// ---------------------------------------------------------------------------

interface StepLike {
	status: string;
	attempt: number;
	failure: { retryPlanned: boolean } | null;
	approval: { state: string } | null;
}

interface SinkOutcome {
	ok: boolean;
	failureClass?: string;
}

interface PolicyShape {
	maxAttempts: number;
	backoff: { kind: string; baseMs: number; maxMs?: number };
	retryOn: string[];
}

/**
 * What the re-drive MUST produce from the golden state at the kill point,
 * the killed run's sink outcomes and the graph's policies:
 *  - a ready/running step runs; its outcome is the REPLAYED sink outcome of
 *    its in-flight key when that key already executed (a scripted failure
 *    replays as a failure), else the deterministic default (ok);
 *  - a failed step with a planned retry retries (the retry attempt's key is
 *    fresh, so it runs the default outcome) unless the real planner refuses;
 *  - gated steps that become eligible stall at awaiting-approval (the human
 *    gate HOLDS); blocked steps unblock as dependencies succeed;
 *  - human-gated states (awaiting-approval, takeover-*) never move.
 */
function simulateReDrive(goldenState: {
	graphStatus: string;
	steps: Record<string, StepLike & { attempt: number }>;
}, graphSpec: {
	policy: { onStepFailure?: string; defaultRetryPolicy?: PolicyShape | null };
	steps: Array<{ stepId: string; gate?: string; dependsOn?: string[]; retryPolicy?: PolicyShape | null }>;
}, sinkOutcomes: Map<string, SinkOutcome>): { graphStatus: string; steps: Record<string, string> } {
	const statuses: Record<string, string> = {};
	const failurePlanned: Record<string, boolean> = {};
	const attempts: Record<string, number> = {};
	for (const [stepId, step] of Object.entries(goldenState.steps)) {
		statuses[stepId] = step.status;
		failurePlanned[stepId] = step.failure !== null && step.failure.retryPlanned;
		attempts[stepId] = step.attempt;
	}
	if (goldenState.graphStatus === 'planning' || goldenState.graphStatus === 'submitted') {
		// The graph approval gate holds: nothing runs.
		return { graphStatus: goldenState.graphStatus, steps: statuses };
	}
	const policyOf = (stepId: string): PolicyShape => {
		const spec = graphSpec.steps.find((candidate) => candidate.stepId === stepId);
		return spec?.retryPolicy ?? graphSpec.policy.defaultRetryPolicy ?? DEFAULT_RETRY_POLICY;
	};
	const runOutcome = (stepId: string, attempt: number): SinkOutcome => {
		const key = `flauz-orch/G-001/${stepId}/run/${String(attempt)}`;
		return sinkOutcomes.get(key) ?? { ok: true };
	};
	const retryAllowed = (stepId: string, attempt: number, failureClass: string): boolean =>
		planRetry({ policy: policyOf(stepId), attempt, failureClass, now: 0 }).retry;
	let progress = true;
	while (progress) {
		progress = false;
		for (const step of graphSpec.steps) {
			const status = statuses[step.stepId];
			const gateOpen = step.gate !== 'human-approval' || (goldenState.steps[step.stepId]?.approval?.state === 'granted');
			if (status === 'running') {
				const outcome = runOutcome(step.stepId, attempts[step.stepId]);
				if (outcome.ok) {
					statuses[step.stepId] = 'succeeded';
				} else if (retryAllowed(step.stepId, attempts[step.stepId], outcome.failureClass ?? 'unknown-default')) {
					// the retry attempt's key is fresh -> deterministic default ok
					attempts[step.stepId] += 1;
					statuses[step.stepId] = 'succeeded';
				} else {
					statuses[step.stepId] = 'failed';
				}
				progress = true;
			} else if (status === 'ready') {
				if (!gateOpen) {
					statuses[step.stepId] = 'awaiting-approval';
				} else {
					const outcome = runOutcome(step.stepId, attempts[step.stepId] + 1);
					statuses[step.stepId] = outcome.ok ? 'succeeded' : 'failed';
				}
				progress = true;
			} else if (status === 'failed' && failurePlanned[step.stepId]) {
				if (retryAllowed(step.stepId, attempts[step.stepId], 'transient')) {
					statuses[step.stepId] = 'succeeded';
				}
				progress = true;
			} else if (status === 'blocked') {
				const deps = step.dependsOn ?? [];
				if (deps.every((dep) => statuses[dep] === 'succeeded')) {
					const open = step.gate !== 'human-approval' || (goldenState.steps[step.stepId]?.approval?.state === 'granted');
					statuses[step.stepId] = open ? 'succeeded' : 'awaiting-approval';
					progress = true;
				}
			}
		}
	}
	const values = Object.values(statuses);
	let graphStatus = goldenState.graphStatus;
	if (goldenState.graphStatus === 'approved') {
		if (values.every((status) => status === 'succeeded')) {
			graphStatus = 'completed';
		} else if (values.includes('failed') && graphSpec.policy.onStepFailure === 'fail-graph') {
			graphStatus = 'failed';
		}
	}
	return { graphStatus, steps: statuses };
}

// ---------------------------------------------------------------------------
// Layer A: in-process crash points (reload equivalence + torn tail)
// ---------------------------------------------------------------------------

test('layer A: every op boundary reloads to the identical logical state', async () => {
	for (const [name, ops] of SCENARIOS) {
		const golden = await goldenRun(`layerA-${name}`, ops, CLOCK_BASE);
		try {
			const graphs = readGraphs(golden.root);
			const lines = readJournal(golden.root);
			for (let k = 0; k < ops.length; k += 1) {
				const rowsAfter = golden.rowCounts[k];
				const root = mkdtempSync(join(tmpdir(), `flauz-orch-reload-${name}-`));
				if (rowsAfter > 0) {
					mkdirSync(join(root, '.flauz', 'orchestration'), { recursive: true });
					writeFileSync(join(root, '.flauz', 'orchestration', 'graphs.json'), graphs);
					writeFileSync(join(root, '.flauz', 'orchestration', 'journal.jsonl'), `${lines.slice(0, rowsAfter).join('\n')}\n`);
				}
				const { clock } = makeClock(CLOCK_BASE);
				const store = new OrchestrationStore(root, { clock });
				assert.equal(store.journalRows.length, rowsAfter, `${name} op ${String(k)} (${ops[k].op}): row count`);
				if (golden.snapshots[k] !== '') {
					assert.equal(snapshotOf(store, golden.graphId), golden.snapshots[k], `${name} op ${String(k)} (${ops[k].op}): identical state`);
				}
			}
		} finally {
			rmSync(golden.root, { recursive: true, force: true });
		}
	}
});

test('layer A: a torn final line is dropped as a crash artifact (every row boundary)', async () => {
	for (const [name, ops] of SCENARIOS) {
		const golden = await goldenRun(`torn-${name}`, ops, CLOCK_BASE);
		try {
			const graphs = readGraphs(golden.root);
			const lines = readJournal(golden.root);
			for (let r = 0; r < lines.length; r += 1) {
				const root = mkdtempSync(join(tmpdir(), `flauz-orch-torn-${name}-`));
				mkdirSync(join(root, '.flauz', 'orchestration'), { recursive: true });
				writeFileSync(join(root, '.flauz', 'orchestration', 'graphs.json'), graphs);
				// row r torn in half mid-write, on top of an r-row prefix
				writeTornJournal(root, lines.slice(0, r), lines[r].slice(0, Math.floor(lines[r].length / 2)));
				const { clock } = makeClock(CLOCK_BASE);
				const store = new OrchestrationStore(root, { clock });
				assert.notEqual(store.tornTail, null, `${name} row ${String(r)}: torn tail detected`);
				assert.equal(store.journalRows.length, r, `${name} row ${String(r)}: prefix survives`);
				// the torn state equals the CLEAN prefix state at the same row
				// boundary (valid at EVERY row boundary, including mid-op rows)
				const cleanRoot = mkdtempSync(join(tmpdir(), `flauz-orch-clean-${name}-`));
				mkdirSync(join(cleanRoot, '.flauz', 'orchestration'), { recursive: true });
				writeFileSync(join(cleanRoot, '.flauz', 'orchestration', 'graphs.json'), graphs);
				writeFileSync(join(cleanRoot, '.flauz', 'orchestration', 'journal.jsonl'), `${lines.slice(0, r).join('\n')}\n`);
				const cleanStore = new OrchestrationStore(cleanRoot, { clock: makeClock(CLOCK_BASE).clock });
				assert.equal(store.journalRows.length, cleanStore.journalRows.length, `${name} row ${String(r)}: same surviving rows`);
				if (cleanStore.journalRows.length > 0) {
					assert.equal(snapshotOf(store, golden.graphId), snapshotOf(cleanStore, golden.graphId), `${name} row ${String(r)}: torn == clean prefix`);
				}
				rmSync(cleanRoot, { recursive: true, force: true });
			}
		} finally {
			rmSync(golden.root, { recursive: true, force: true });
		}
	}
});

// ---------------------------------------------------------------------------
// Layer B: the real SIGKILL matrix
// ---------------------------------------------------------------------------

interface KillTargetHandle {
	child: ChildProcess;
	nextLine(): Promise<string>;
	send(line: string): void;
}

function spawnKillTarget(root: string, ops: ScenarioOp[]): KillTargetHandle {
	const planFile = join(root, 'kill-plan.json');
	writeFileSync(planFile, JSON.stringify({ ops, clockBase: CLOCK_BASE }));
	const targetPath = fileURLToPath(new URL('./harness/killTarget.ts', import.meta.url));
	const child = spawn(process.execPath, [targetPath, root, planFile], { stdio: ['pipe', 'pipe', 'pipe'] });
	const pending: string[] = [];
	const waiters: Array<(line: string) => void> = [];
	let buffer = '';
	child.stdout.setEncoding('utf-8');
	child.stdout.on('data', (chunk: { toString(encoding?: string): string }) => {
		buffer += chunk.toString();
		let newline = buffer.indexOf('\n');
		while (newline !== -1) {
			const line = buffer.slice(0, newline).trim();
			buffer = buffer.slice(newline + 1);
			if (line.length > 0) {
				const waiter = waiters.shift();
				if (waiter !== undefined) {
					waiter(line);
				} else {
					pending.push(line);
				}
			}
			newline = buffer.indexOf('\n');
		}
	});
	let stderrBuffer = '';
	child.stderr.setEncoding('utf-8');
	child.stderr.on('data', (chunk: { toString(encoding?: string): string }) => {
		stderrBuffer += chunk.toString();
	});
	return {
		child,
		nextLine() {
			const buffered = pending.shift();
			if (buffered !== undefined) {
				return Promise.resolve(buffered);
			}
			return new Promise((resolve) => {
				waiters.push(resolve);
			});
		},
		send(line: string) {
			child.stdin.write(`${line}\n`);
		},
	};
}

async function killAt(ops: ScenarioOp[], killOpIndex: number, phase: 'before' | 'after'): Promise<string> {
	const root = mkdtempSync(join(tmpdir(), `flauz-orch-kill-`));
	const handle = spawnKillTarget(root, ops);
	try {
		for (let index = 0; index <= killOpIndex; index += 1) {
			const ready = await handle.nextLine();
			assert.match(ready, /^READY\t/);
			const [ , readyIndex, readyName] = ready.split('\t');
			assert.equal(Number(readyIndex), index, `target READY order at ${ready}`);
			assert.equal(readyName, ops[index].op);
			if (phase === 'before' && index === killOpIndex) {
				handle.child.kill('SIGKILL');
				await new Promise((resolve) => handle.child.once('exit', resolve));
				return root;
			}
			handle.send('go');
			const done = await handle.nextLine();
			assert.equal(done, `DONE\t${String(index)}`);
			if (phase === 'after' && index === killOpIndex) {
				handle.child.kill('SIGKILL');
				await new Promise((resolve) => handle.child.once('exit', resolve));
				return root;
			}
		}
		// no kill requested (sanity): let the scenario finish
		handle.send('go');
		const completion = await handle.nextLine();
		assert.equal(completion, 'SCENARIO-COMPLETE');
		handle.child.kill('SIGKILL');
		await new Promise((resolve) => handle.child.once('exit', resolve));
		return root;
	} catch (error) {
		handle.child.kill('SIGKILL');
		throw error;
	}
}

function goldenStateAt(golden: GoldenRun, opIndex: number): { graphStatus: string; steps: Record<string, StepLike> } {
	const parsed = JSON.parse(golden.snapshots[opIndex]) as { graphStatus: string; steps: Record<string, StepLike> };
	return parsed;
}

/** The outcomes that already EXECUTED in the killed run (fresh sink log entries, keyed by idempotency key). */
function sinkOutcomesOf(root: string): Map<string, SinkOutcome> {
	const outcomes = new Map<string, SinkOutcome>();
	const logPath = join(root, 'effect-sink.jsonl');
	if (!existsSync(logPath)) {
		return outcomes;
	}
	for (const line of readFileSync(logPath, 'utf-8').split('\n')) {
		if (line.length === 0) {
			continue;
		}
		const entry = JSON.parse(line) as { key: string; replayed: boolean; ok: boolean; failureClass?: string };
		if (!entry.replayed && !outcomes.has(entry.key)) {
			outcomes.set(entry.key, { ok: entry.ok, failureClass: entry.failureClass });
		}
	}
	return outcomes;
}

for (const [scenarioName, ops] of SCENARIOS) {
	test(`layer B: SIGKILL matrix - ${scenarioName} (before/after every op)`, { timeout: 120000 }, async () => {
		const golden = await goldenRun(`matrix-${scenarioName}`, ops, CLOCK_BASE);
		try {
			const graphs = readGraphs(golden.root);
			const goldenLines = readJournal(golden.root);
			const graphSpec = JSON.parse(graphs).graphs[0] as {
				policy: { onStepFailure?: string; defaultRetryPolicy?: PolicyShape | null };
				steps: Array<{ stepId: string; gate?: string; dependsOn?: string[]; retryPolicy?: PolicyShape | null }>;
			};
			for (let opIndex = 0; opIndex < ops.length; opIndex += 1) {
				for (const phase of ['before', 'after'] as const) {
					const root = await killAt(ops, opIndex, phase);
					try {
						const rowsAtKill = phase === 'before' ? (opIndex === 0 ? 0 : golden.rowCounts[opIndex - 1]) : golden.rowCounts[opIndex];
						const killedLines = readJournal(root);
						// 1. the killed journal is a byte-identical prefix of the golden journal
						assert.equal(killedLines.length, rowsAtKill, `${scenarioName} ${phase} op ${String(opIndex)}: row count ${String(killedLines.length)} vs ${String(rowsAtKill)}`);
						for (let r = 0; r < rowsAtKill; r += 1) {
							assert.equal(killedLines[r], goldenLines[r], `${scenarioName} ${phase} op ${String(opIndex)} row ${String(r)}: byte-identical`);
						}
						// 2. recovery: only legitimate recovery rows are appended
						const { clock } = makeClock(CLOCK_BASE + 5000000);
						const store = new OrchestrationStore(root, { clock });
						assert.equal(store.journalRows.length, rowsAtKill);
						if (rowsAtKill === 0) {
							// killed before anything was submitted: an empty workspace
							// recovers to an empty workspace (nothing fabricated)
							const emptyReport = await recoveryScan(store, { now: FAR_FUTURE });
							assert.equal(emptyReport.clean, true);
							assert.equal(store.journalRows.length, 0); // no graphs -> no rows (nothing fabricated)
							continue;
						}
						const report = await recoveryScan(store, { now: FAR_FUTURE });
						for (const row of store.journalRows.slice(rowsAtKill)) {
							assert.ok(RECOVERY_ROW_TYPES.has(row.type), `${scenarioName} ${phase} op ${String(opIndex)}: post-kill row ${row.type} is a recovery class`);
							assert.equal(row.actor, 'service');
						}
						const stateAfterRecovery = store.getGraphState(golden.graphId) as { interrupted: string[]; steps: Record<string, { status: string }> };
						assert.deepEqual(stateAfterRecovery.interrupted, [], 'recovery marks every interrupted step');
						// 3. re-drive: the fixpoint of the recovery semantics. The
						// scheduler ticks through backoff windows (escalating now),
						// exactly like a live runtime would.
						const sink = new FileEffectSink(join(root, 'effect-sink.jsonl'));
						let previousSummary = '';
						for (let tick = 0; tick < 8; tick += 1) {
							await driveGraph(store, { graphId: golden.graphId, sink, now: FAR_FUTURE + tick * 120000, runnerId: 're-drive' });
							const summary = stableStringify(store.getGraphState(golden.graphId));
							if (summary === previousSummary) {
								break;
							}
							previousSummary = summary;
						}
						const finalState = store.getGraphState(golden.graphId) as {
							graphStatus: string;
							steps: Record<string, StepLike>;
						};
						const goldenAtKill = goldenStateAt(golden, phase === 'before' ? Math.max(0, opIndex - 1) : opIndex);
						const expected = simulateReDrive(goldenAtKill, graphSpec, sinkOutcomesOf(root));
						const actual = { graphStatus: finalState.graphStatus, steps: Object.fromEntries(Object.entries(finalState.steps).map(([stepId, step]) => [stepId, step.status])) };
						assert.deepEqual(actual, expected, `${scenarioName} ${phase} op ${String(opIndex)} (${ops[opIndex].op}): re-drive fixpoint`);
						// 4. no duplicated side effects: every key executed exactly once
						const fresh = sink.freshExecutions();
						assert.equal(new Set(fresh).size, fresh.length, `${scenarioName} ${phase} op ${String(opIndex)}: no key executed twice`);
						assert.equal(store.verifyJournal().ok, true, 'journal chain intact after recovery + re-drive');
					} finally {
						rmSync(root, { recursive: true, force: true });
					}
				}
			}
		} finally {
			rmSync(golden.root, { recursive: true, force: true });
		}
	});
}

test('recovery scan report is honest: actions match observed interruptions', async () => {
	const golden = await goldenRun('honest-recovery', SCENARIO_INTERRUPT, CLOCK_BASE);
	try {
		const graphs = readGraphs(golden.root);
		const lines = readJournal(golden.root);
		const root = mkdtempSync(join(tmpdir(), 'flauz-orch-honest-'));
		mkdirSync(join(root, '.flauz', 'orchestration'), { recursive: true });
		writeFileSync(join(root, '.flauz', 'orchestration', 'graphs.json'), graphs);
		// kill after 'start S-01' (running) with the lease already expired (ttl 1)
		const rowsAfterStart = golden.rowCounts[3];
		writeFileSync(join(root, '.flauz', 'orchestration', 'journal.jsonl'), `${lines.slice(0, rowsAfterStart).join('\n')}\n`);
		const { clock } = makeClock(CLOCK_BASE);
		const store = new OrchestrationStore(root, { clock });
		const report = await recoveryScan(store, { now: FAR_FUTURE, record: true });
		assert.equal(report.clean, false);
		assert.ok(report.actions.includes('G-001:step-interrupted:S-01'), `actions: ${report.actions.join(',')}`);
		assert.ok(report.actions.some((action) => action.startsWith('G-001:lease-expired:')), `actions: ${report.actions.join(',')}`);
		// a second scan of the now-clean state records zero actions (idempotent semantics)
		const second = await recoveryScan(store, { now: FAR_FUTURE, record: true });
		assert.equal(second.clean, true);
		assert.deepEqual(second.actions, []);
		// record=false computes without appending
		const rowsBefore = store.journalRows.length;
		const third = await recoveryScan(store, { now: FAR_FUTURE, record: false });
		assert.equal(third.actions.length, 0);
		assert.equal(store.journalRows.length, rowsBefore);
	} finally {
		rmSync(golden.root, { recursive: true, force: true });
	}
});

test('torn tail from a real mid-append crash is surfaced, never silently fabricated', async () => {
	const golden = await goldenRun('torn-real', SCENARIO_SUCCESS, CLOCK_BASE);
	try {
		const graphs = readGraphs(golden.root);
		const lines = readJournal(golden.root);
		const root = mkdtempSync(join(tmpdir(), 'flauz-orch-tornreal-'));
		mkdirSync(join(root, '.flauz', 'orchestration'), { recursive: true });
		writeFileSync(join(root, '.flauz', 'orchestration', 'graphs.json'), graphs);
		// a REAL partial write: half the bytes of the next row, no newline
		writeTornJournal(root, lines.slice(0, 5), lines[5].slice(0, 40));
		const { clock } = makeClock(CLOCK_BASE);
		const store = new OrchestrationStore(root, { clock });
		assert.notEqual(store.tornTail, null);
		assert.equal(store.journalRows.length, 5);
		const report = await recoveryScan(store, { now: FAR_FUTURE, record: false });
		assert.equal(report.journalRows, 5);
		assert.ok(report.tornTail !== null, 'the torn tail is surfaced in the report');
	} finally {
		rmSync(golden.root, { recursive: true, force: true });
	}
});
