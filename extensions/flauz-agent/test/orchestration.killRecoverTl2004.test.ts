/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-004 closure kill-and-recover matrix (M5) - the restart/recovery
 * safety contract extended to the NEW transition classes:
 *
 *  - approval-requested with a DEADLINE: a kill before the expiry op leaves
 *    the request pending; recovery EXPIRES it when the deadline passed
 *    while the process was down (fail-closed; never auto-granted) - and a
 *    LIVE deadline holds through the restart;
 *  - approval-denied / approval-expired: gate-terminal cancellations feed
 *    the graph failure policy coherently after recovery;
 *  - takeover: a kill at any lifecycle point leaves a human-gated state
 *    that recovery NEVER advances (takeover-pending/taken-over hold; the
 *    re-drive completes only what a human completed);
 *  - lease conflicts: the informational notices (and their evidence rows)
 *    survive kills; expired leases free their steps during recovery;
 *  - EVIDENCE LINKAGE: every minted ledger row's uri
 *    (flauz-orch-transition://<rowId>) references a journal row that EXISTS
 *    in the recovered journal at every kill point (no fabricated evidence
 *    linkage, no shifted rowIds - the transition lock holds).
 *
 * Same two layers as the landed matrix (test/orchestration.killRecover.test.ts):
 *  A. in-process crash points - every op boundary reloads to the identical
 *     logical state; a torn final line drops exactly the incomplete row;
 *  B. REAL SIGKILL before/after EVERY op - the killed journal is a
 *     byte-identical prefix of the golden run; recovery appends only
 *     legitimate recovery rows; the re-drive reaches the fixpoint of the
 *     recovery semantics (the extended simulator below); every effect key
 *     executed exactly once.
 *
 * All scenarios run with the REAL WorkspaceSeam taskPort (taskPort: true) -
 * full-fidelity evidence minting in both the golden run and the kill target.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OrchestrationStore } from '../core/orchStore.mjs';
import { WorkspaceSeam } from '../core/service.mjs';
import { recoveryScan } from '../core/recovery.mjs';
import { driveGraph } from '../core/runtime.mjs';
import { planRetry, DEFAULT_RETRY_POLICY } from '../core/policy.mjs';
import {
	goldenRun, readJournal, readGraphs, readEvidenceLedger, writeTornJournal, stableStringify, snapshotOf, FileEffectSink, makeClock,
	type ScenarioOp, type GoldenRun,
} from './harness/orchWorkspace.ts';

const CLOCK_BASE = 1700000000000;
const FAR_FUTURE = 1893456000000;
const RECOVERY_ROW_TYPES = new Set(['step-interrupted', 'lease-expired', 'approval-expired', 'step-cancelled', 'graph-cancelled', 'recovery-scan']);

// ---------------------------------------------------------------------------
// The scenarios (every NEW transition class appears; all with the real taskPort)
// ---------------------------------------------------------------------------

const GATED_STEP: Array<Record<string, unknown>> = [{ stepId: 'S-01', title: 'gated work', instruction: 'needs a human', gate: 'human-approval' }];

const SCENARIO_APPROVAL_EXPIRY: ScenarioOp[] = [
	{ op: 'submit', title: 'approval expiry scenario', steps: GATED_STEP, policy: { onStepFailure: 'fail-graph' } },
	{ op: 'approve' },
	{ op: 'approvalRequest', stepId: 'S-01', expiresAt: CLOCK_BASE + 30000 },
	{ op: 'approvalExpire', stepId: 'S-01' },
	{ op: 'failGraph', stepId: 'S-01' },
	{ op: 'scan' },
];

const SCENARIO_APPROVAL_DENIAL: ScenarioOp[] = [
	{ op: 'submit', title: 'approval denial scenario', steps: GATED_STEP, policy: { onStepFailure: 'fail-graph' } },
	{ op: 'approve' },
	{ op: 'approvalRequest', stepId: 'S-01' },
	{ op: 'approvalDeny', stepId: 'S-01' },
	{ op: 'failGraph', stepId: 'S-01' },
	{ op: 'scan' },
];

const SCENARIO_TAKEOVER_EVIDENCE: ScenarioOp[] = [
	{ op: 'submit', title: 'takeover evidence scenario', steps: [{ stepId: 'S-01', title: 'stuck work', instruction: 'contended' }] },
	{ op: 'approve' },
	{ op: 'claim', stepId: 'S-01', holder: 'agent-x' },
	{ op: 'start', stepId: 'S-01', runnerId: 'runner-b' },
	{ op: 'takeoverRequest', stepId: 'S-01' },
	{ op: 'takeoverAccept', stepId: 'S-01' },
	{ op: 'takeoverComplete', stepId: 'S-01', summary: 'finished by hand' },
	{ op: 'complete' },
	{ op: 'scan' },
];

const SCENARIO_LEASE_CONFLICT: ScenarioOp[] = [
	{ op: 'submit', title: 'lease conflict scenario', steps: [{ stepId: 'S-01', title: 'shared work', instruction: 'contended' }] },
	{ op: 'approve' },
	{ op: 'lease', stepId: 'S-01', holder: 'agent-a', ttlMs: 5000 },
	{ op: 'start', stepId: 'S-01', runnerId: 'runner-b' },
	{ op: 'effect', stepId: 'S-01', outcome: 'ok', value: 'done anyway (informational v0)' },
	{ op: 'finishOk', stepId: 'S-01', output: 'done anyway (informational v0)' },
	{ op: 'complete' },
	{ op: 'scan' },
];

const SCENARIOS: Array<[string, ScenarioOp[]]> = [
	['approval-expiry', SCENARIO_APPROVAL_EXPIRY],
	['approval-denial', SCENARIO_APPROVAL_DENIAL],
	['takeover-evidence', SCENARIO_TAKEOVER_EVIDENCE],
	['lease-conflict', SCENARIO_LEASE_CONFLICT],
];

// ---------------------------------------------------------------------------
// The extended fixpoint simulator (recovery semantics + the new classes)
// ---------------------------------------------------------------------------

interface StepLike {
	status: string;
	attempt: number;
	failure: { retryPlanned: boolean } | null;
	approval: { state: string; expiresAt?: number } | null;
}

interface GoldenSnapshot {
	graphStatus: string;
	steps: Record<string, StepLike>;
	delegations: Record<string, { resolved: boolean }>;
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
 * What the re-drive MUST produce from the golden state at the kill point.
 * Beyond the landed rules (running/ready/failed/blocked), this models:
 *  - awaiting-approval + a DEADLINE that passed by recovery time -> the
 *    recovery expiry cancels the step (fail-closed, never a grant);
 *  - awaiting-approval without a deadline (or with a live one) -> HOLDS;
 *  - gate-terminal cancellations (approval-denied / approval-expired carry
 *    a failure record) feed the fail-graph policy;
 *  - takeover-pending / taken-over NEVER move (human-only transitions).
 */
function simulateReDrive(goldenState: GoldenSnapshot, graphSpec: {
	policy: { onStepFailure?: string; defaultRetryPolicy?: PolicyShape | null };
	steps: Array<{ stepId: string; gate?: string; dependsOn?: string[]; retryPolicy?: PolicyShape | null }>;
}, sinkOutcomes: Map<string, SinkOutcome>, recoveryNow: number): { graphStatus: string; steps: Record<string, string> } {
	const statuses: Record<string, string> = {};
	const failurePlanned: Record<string, boolean> = {};
	const gateTerminal: Record<string, boolean> = {};
	const attempts: Record<string, number> = {};
	for (const [stepId, step] of Object.entries(goldenState.steps)) {
		statuses[stepId] = step.status;
		failurePlanned[stepId] = step.failure !== null && step.failure.retryPlanned;
		gateTerminal[stepId] = step.status === 'cancelled' && step.failure !== null && step.failure.retryPlanned === false;
		attempts[stepId] = step.attempt;
	}
	// The recovery pass first: deadline-bearing pending approvals whose
	// deadline passed by recoveryNow are expired (cancelled, fail-closed).
	for (const [stepId, step] of Object.entries(goldenState.steps)) {
		if (statuses[stepId] === 'awaiting-approval' && step.approval?.expiresAt !== undefined && step.approval.expiresAt <= recoveryNow) {
			statuses[stepId] = 'cancelled';
			gateTerminal[stepId] = true;
			failurePlanned[stepId] = false;
		}
	}
	if (goldenState.graphStatus === 'planning' || goldenState.graphStatus === 'submitted') {
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
			const delegationInFlight = goldenState.delegations?.[step.stepId]?.resolved === false;
			if (status === 'running' && delegationInFlight) {
				continue;
			}
			if (status === 'running') {
				const outcome = runOutcome(step.stepId, attempts[step.stepId]);
				if (outcome.ok) {
					statuses[step.stepId] = 'succeeded';
				} else if (retryAllowed(step.stepId, attempts[step.stepId], outcome.failureClass ?? 'unknown-default')) {
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
			// awaiting-approval (live/none deadline), takeover-pending, taken-over,
			// cancelled, succeeded: never move - the human gates hold.
		}
	}
	const values = Object.values(statuses);
	let graphStatus = goldenState.graphStatus;
	if (goldenState.graphStatus === 'approved') {
		if (values.every((status) => status === 'succeeded')) {
			graphStatus = 'completed';
		} else if (graphSpec.policy.onStepFailure === 'fail-graph' && (values.includes('failed') || Object.values(gateTerminal).some(Boolean))) {
			graphStatus = 'failed';
		}
	}
	return { graphStatus, steps: statuses };
}

// ---------------------------------------------------------------------------
// Layer A: in-process crash points
// ---------------------------------------------------------------------------

test('layer A (tl2004): every op boundary reloads to the identical logical state', async () => {
	for (const [name, ops] of SCENARIOS) {
		const golden = await goldenRun(`tl2004-layerA-${name}`, ops, CLOCK_BASE, { taskPort: true });
		try {
			const graphs = readGraphs(golden.root);
			const lines = readJournal(golden.root);
			for (let k = 0; k < ops.length; k += 1) {
				const rowsAfter = golden.rowCounts[k];
				const root = mkdtempSync(join(tmpdir(), `flauz-tl2004-reload-${name}-`));
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

test('layer A (tl2004): a torn final line drops exactly the incomplete row (every row boundary)', async () => {
	for (const [name, ops] of SCENARIOS) {
		const golden = await goldenRun(`tl2004-torn-${name}`, ops, CLOCK_BASE, { taskPort: true });
		try {
			const graphs = readGraphs(golden.root);
			const lines = readJournal(golden.root);
			for (let r = 0; r < lines.length; r += 1) {
				const root = mkdtempSync(join(tmpdir(), `flauz-tl2004-torn-${name}-`));
				mkdirSync(join(root, '.flauz', 'orchestration'), { recursive: true });
				writeFileSync(join(root, '.flauz', 'orchestration', 'graphs.json'), graphs);
				writeTornJournal(root, lines.slice(0, r), lines[r].slice(0, Math.floor(lines[r].length / 2)));
				const { clock } = makeClock(CLOCK_BASE);
				const store = new OrchestrationStore(root, { clock });
				assert.notEqual(store.tornTail, null, `${name} row ${String(r)}: torn tail detected`);
				assert.equal(store.journalRows.length, r, `${name} row ${String(r)}: prefix survives`);
				const cleanRoot = mkdtempSync(join(tmpdir(), `flauz-tl2004-clean-${name}-`));
				mkdirSync(join(cleanRoot, '.flauz', 'orchestration'), { recursive: true });
				writeFileSync(join(cleanRoot, '.flauz', 'orchestration', 'graphs.json'), graphs);
				writeFileSync(join(cleanRoot, '.flauz', 'orchestration', 'journal.jsonl'), `${lines.slice(0, r).join('\n')}\n`);
				const cleanStore = new OrchestrationStore(cleanRoot, { clock: makeClock(CLOCK_BASE).clock });
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
	writeFileSync(planFile, JSON.stringify({ ops, clockBase: CLOCK_BASE, taskPort: true }));
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
	const root = mkdtempSync(join(tmpdir(), 'flauz-tl2004-kill-'));
	const handle = spawnKillTarget(root, ops);
	try {
		for (let index = 0; index <= killOpIndex; index += 1) {
			const ready = await handle.nextLine();
			assert.match(ready, /^READY\t/);
			const [, readyIndex, readyName] = ready.split('\t');
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

function goldenStateAt(golden: GoldenRun, opIndex: number): GoldenSnapshot {
	return JSON.parse(golden.snapshots[opIndex]) as GoldenSnapshot;
}

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

/** The TL2-004 evidence-linkage invariant: every transition-evidence uri references a journal row that exists. */
function assertEvidenceLinkage(root: string, label: string): void {
	const journal = readJournal(root);
	const rowIds = new Set(journal.map((line) => (JSON.parse(line) as { rowId: string }).rowId));
	for (const ledgerRow of readEvidenceLedger(root)) {
		const uri = ledgerRow.uri;
		if (typeof uri === 'string' && uri.startsWith('flauz-orch-transition://')) {
			assert.ok(rowIds.has(uri.slice('flauz-orch-transition://'.length)), `${label}: evidence uri references a real journal row (${uri})`);
		}
	}
}

for (const [scenarioName, ops] of SCENARIOS) {
	test(`layer B (tl2004): SIGKILL matrix - ${scenarioName} (before/after every op)`, { timeout: 120000 }, async () => {
		const golden = await goldenRun(`tl2004-matrix-${scenarioName}`, ops, CLOCK_BASE, { taskPort: true });
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
						assert.equal(killedLines.length, rowsAtKill, `${scenarioName} ${phase} op ${String(opIndex)}: row count`);
						for (let r = 0; r < rowsAtKill; r += 1) {
							assert.equal(killedLines[r], goldenLines[r], `${scenarioName} ${phase} op ${String(opIndex)} row ${String(r)}: byte-identical`);
						}
						// 2. the evidence linkage invariant holds at the kill point
						assertEvidenceLinkage(root, `${scenarioName} ${phase} op ${String(opIndex)}`);
						// 3. recovery: only legitimate recovery rows are appended
						const { clock } = makeClock(CLOCK_BASE + 5000000);
						const store = new OrchestrationStore(root, { clock, taskPort: new WorkspaceSeam(root) });
						assert.equal(store.journalRows.length, rowsAtKill);
						if (rowsAtKill === 0) {
							const emptyReport = await recoveryScan(store, { now: FAR_FUTURE });
							assert.equal(emptyReport.clean, true);
							continue;
						}
						const report = await recoveryScan(store, { now: FAR_FUTURE });
						for (const row of store.journalRows.slice(rowsAtKill)) {
							assert.ok(RECOVERY_ROW_TYPES.has(row.type), `${scenarioName} ${phase} op ${String(opIndex)}: post-kill row ${row.type} is a recovery class`);
							assert.equal(row.actor, 'service');
						}
						const stateAfterRecovery = store.getGraphState(golden.graphId) as { interrupted: string[] };
						assert.deepEqual(stateAfterRecovery.interrupted, [], 'recovery marks every interrupted step');
						// 4. re-drive: the fixpoint of the extended recovery semantics
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
						const expected = simulateReDrive(goldenAtKill, graphSpec, sinkOutcomesOf(root), FAR_FUTURE);
						const actual = { graphStatus: finalState.graphStatus, steps: Object.fromEntries(Object.entries(finalState.steps).map(([stepId, step]) => [stepId, step.status])) };
						assert.deepEqual(actual, expected, `${scenarioName} ${phase} op ${String(opIndex)} (${ops[opIndex].op}): re-drive fixpoint`);
						// 5. no duplicated side effects + the chain and the evidence linkage hold after recovery + re-drive
						const fresh = sink.freshExecutions();
						assert.equal(new Set(fresh).size, fresh.length, 'no key executed twice');
						assert.equal(store.verifyJournal().ok, true, 'journal chain intact after recovery + re-drive');
						assertEvidenceLinkage(root, `${scenarioName} ${phase} op ${String(opIndex)} post-re-drive`);
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

// ---------------------------------------------------------------------------
// The TL2-004-specific recovery guarantees
// ---------------------------------------------------------------------------

test('recovery expires a deadline-bearing approval exactly once and reports it honestly', async () => {
	const ops: ScenarioOp[] = [
		{ op: 'submit', title: 'honest expiry', steps: GATED_STEP, policy: { onStepFailure: 'fail-graph' } },
		{ op: 'approve' },
		{ op: 'approvalRequest', stepId: 'S-01', expiresAt: CLOCK_BASE + 30000 },
	];
	const golden = await goldenRun('tl2004-honest-expiry', ops, CLOCK_BASE, { taskPort: true });
	try {
		const graphs = readGraphs(golden.root);
		const lines = readJournal(golden.root);
		const root = mkdtempSync(join(tmpdir(), 'flauz-tl2004-honest-'));
		mkdirSync(join(root, '.flauz', 'orchestration'), { recursive: true });
		writeFileSync(join(root, '.flauz', 'orchestration', 'graphs.json'), graphs);
		const rowsAfterRequest = golden.rowCounts[2];
		writeFileSync(join(root, '.flauz', 'orchestration', 'journal.jsonl'), `${lines.slice(0, rowsAfterRequest).join('\n')}\n`);
		const { clock } = makeClock(CLOCK_BASE);
		const store = new OrchestrationStore(root, { clock, taskPort: new WorkspaceSeam(root) });
		const report = await recoveryScan(store, { now: FAR_FUTURE, record: true });
		assert.equal(report.clean, false);
		assert.ok(report.actions.includes('G-001:approval-expired:S-01'), report.actions.join(','));
		const expiredRow = store.journalRows.find((row) => row.type === 'approval-expired');
		assert.equal(expiredRow?.payload.expiredAt, CLOCK_BASE + 30000);
		assert.equal(expiredRow?.actor, 'service');
		// a second scan of the now-clean state records zero actions (idempotent semantics)
		const second = await recoveryScan(store, { now: FAR_FUTURE, record: true });
		assert.equal(second.clean, true);
		// the human gate is still intact: the expired step is cancelled, never granted
		const state = store.getGraphState('G-001') as { steps: Record<string, { status: string; approval: { state: string } | null }> };
		assert.equal(state.steps['S-01'].status, 'cancelled');
		assert.equal(state.steps['S-01'].approval?.state, 'expired');
	} finally {
		rmSync(golden.root, { recursive: true, force: true });
	}
});

test('a live approval deadline holds through recovery (the human gate survives restarts)', async () => {
	const ops: ScenarioOp[] = [
		{ op: 'submit', title: 'live deadline', steps: GATED_STEP, policy: { onStepFailure: 'manual' } },
		{ op: 'approve' },
		{ op: 'approvalRequest', stepId: 'S-01', expiresAt: FAR_FUTURE + 1000000 },
	];
	const golden = await goldenRun('tl2004-live-deadline', ops, CLOCK_BASE, { taskPort: true });
	try {
		const graphs = readGraphs(golden.root);
		const lines = readJournal(golden.root);
		const root = mkdtempSync(join(tmpdir(), 'flauz-tl2004-live-'));
		mkdirSync(join(root, '.flauz', 'orchestration'), { recursive: true });
		writeFileSync(join(root, '.flauz', 'orchestration', 'graphs.json'), graphs);
		writeFileSync(join(root, '.flauz', 'orchestration', 'journal.jsonl'), `${lines.slice(0, golden.rowCounts[2]).join('\n')}\n`);
		const { clock } = makeClock(CLOCK_BASE);
		const store = new OrchestrationStore(root, { clock, taskPort: new WorkspaceSeam(root) });
		await recoveryScan(store, { now: FAR_FUTURE, record: true });
		const state = store.getGraphState('G-001') as { steps: Record<string, { status: string; approval: { state: string } | null }> };
		assert.equal(state.steps['S-01'].status, 'awaiting-approval', 'the live deadline did not expire');
		assert.equal(state.steps['S-01'].approval?.state, 'pending');
		// and the re-drive does not grant it either
		const sink = new FileEffectSink(join(root, 'effect-sink.jsonl'));
		await driveGraph(store, { graphId: 'G-001', sink, now: FAR_FUTURE, runnerId: 're-drive' });
		const after = store.getGraphState('G-001') as { steps: Record<string, { status: string }> };
		assert.equal(after.steps['S-01'].status, 'awaiting-approval', 'never auto-granted');
	} finally {
		rmSync(golden.root, { recursive: true, force: true });
	}
});
