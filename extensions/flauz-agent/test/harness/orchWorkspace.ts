/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Shared harness for the orchestration suites (TL2-001/TL2-004).
 *
 * Provides: deterministic clocks, the FILE-BACKED IDEMPOTENT EFFECT SINK
 * (the durability test vehicle - its log survives SIGKILL, so a re-driven
 * attempt with the same idempotency key replays instead of duplicating),
 * the shared scenario op vocabulary + executor (one op = one or more
 * journal appends; used by BOTH the in-process golden run and the spawned
 * kill target so their journals are byte-identical), the kill-matrix
 * scenarios, and stable state snapshots for deep-equality assertions.
 */

import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrchestrationStore } from '../../core/orchStore.mjs';
import { WorkspaceSeam } from '../../core/service.mjs';
import { recoveryScan } from '../../core/recovery.mjs';

/** A deterministic incrementing clock (identical call sequences give identical rows). */
export function makeClock(base: number): { clock(): number } {
	let value = base;
	return {
		clock() {
			value += 1000;
			return value;
		},
	};
}

export function sha256Of(value: string): string {
	return createHash('sha256').update(value, 'utf-8').digest('hex');
}

/**
 * The file-backed idempotent effect sink. Every run() call appends one log
 * line {key, replayed} to <path>; a key already present replays its recorded
 * outcome instead of executing (the sink port contract, made durable for the
 * kill matrix - the log survives SIGKILL).
 */
/** One sink log line: the outcome of one run() call (fresh or replayed). */
export interface SinkLogEntry {
	key: string;
	replayed: boolean;
	ok: boolean;
	value?: string;
	failureClass?: string;
	message?: string;
}

export class FileEffectSink {
	readonly logPath: string;
	private readonly entries: SinkLogEntry[] = [];
	private readonly byKey: Map<string, { ok: boolean; value?: string; failureClass?: string; message?: string }>;

	constructor(logPath: string) {
		this.logPath = logPath;
		this.byKey = new Map();
		if (existsSync(logPath)) {
			for (const line of readFileSync(logPath, 'utf-8').split('\n')) {
				if (line.length === 0) {
					continue;
				}
				const entry = JSON.parse(line) as { key: string; replayed: boolean; ok: boolean; value?: string; failureClass?: string; message?: string };
				this.entries.push(entry);
				if (!entry.replayed) {
					this.byKey.set(entry.key, { ok: entry.ok, value: entry.value, failureClass: entry.failureClass, message: entry.message });
				}
			}
		}
	}

	run(key: string, spec: { graphId: string; stepId: string; attempt: number; instruction: string }): { ok: boolean; value?: string; failureClass?: string; message?: string; replayed: boolean } {
		const recorded = this.byKey.get(key);
		if (recorded !== undefined) {
			// The effect already executed (its log line survived the crash) -
			// replay the recorded outcome, NEVER execute twice.
			const entry: SinkLogEntry = { key, replayed: true, ...recorded };
			this.entries.push(entry);
			appendFileSync(this.logPath, `${JSON.stringify(entry)}\n`);
			return { ...recorded, replayed: true };
		}
		// First execution of this key with no scripted outcome: the
		// deterministic default (a fresh side effect - counted as an execution).
		const outcome = { ok: true as const, value: `effect:${spec.stepId}:attempt-${spec.attempt}` };
		this.script(key, outcome);
		return { ...outcome, replayed: false };
	}

	/** Script one outcome for a key BEFORE the effect runs (the kill target + golden run both do this in op 'effect'). */
	script(key: string, outcome: { ok: true; value: string } | { ok: false; failureClass: string; message: string }): void {
		if (this.byKey.has(key)) {
			throw new Error(`FileEffectSink.script: key ${key} already executed`);
		}
		const entry: SinkLogEntry = { key, replayed: false, ...outcome };
		this.entries.push(entry);
		this.byKey.set(key, outcome as { ok: boolean; value?: string; failureClass?: string; message?: string });
		appendFileSync(this.logPath, `${JSON.stringify(entry)}\n`);
	}

	/** Fresh (non-replayed) executions - the duplicate-side-effect detector. */
	freshExecutions(): string[] {
		return this.entries.filter((entry) => !entry.replayed).map((entry) => entry.key);
	}

	replays(): string[] {
		return this.entries.filter((entry) => entry.replayed).map((entry) => entry.key);
	}
}

export type ScenarioOp =
	| { op: 'submit'; title: string; steps: Array<Record<string, unknown>>; policy?: Record<string, unknown> }
	| { op: 'approve' }
	| { op: 'reject' }
	| { op: 'claim'; stepId: string; holder: string }
	| { op: 'releaseClaim'; stepId: string }
	| { op: 'lease'; stepId: string; holder: string; ttlMs: number }
	| { op: 'renewLease'; stepId: string; ttlMs: number }
	| { op: 'releaseLease'; stepId: string }
	| { op: 'approvalRequest'; stepId: string; expiresAt?: number }
	| { op: 'approvalGrant'; stepId: string }
	| { op: 'approvalDeny'; stepId: string }
	| { op: 'approvalExpire'; stepId: string; expiredAt?: number }
	| { op: 'takeoverRequest'; stepId: string }
	| { op: 'takeoverAccept'; stepId: string }
	| { op: 'takeoverComplete'; stepId: string; summary: string }
	| { op: 'start'; stepId: string; runnerId: string }
	| { op: 'effect'; stepId: string; outcome: 'ok' | 'fail'; value?: string; failureClass?: string; message?: string }
	| { op: 'finishOk'; stepId: string; output?: string }
	| { op: 'finishFail'; stepId: string; failureClass: string; message: string }
	| { op: 'retry'; stepId: string }
	| { op: 'cancel'; reason: string }
	| { op: 'route'; stepId: string; targetAgent: string; reason: string }
	| { op: 'delegation'; stepId: string; messageId: string }
	| { op: 'result'; stepId: string; messageId: string; outcome: 'ok' | 'failed' | 'cancelled'; summary: string }
	| { op: 'failGraph'; stepId: string }
	| { op: 'complete' }
	| { op: 'scan' }
	| { op: 'noop' };

/** Executor context carried across ops (the graph under drive + per-step starts). */
export interface ExecutorContext {
	graphId: string | null;
	lastStart: Map<string, { attempt: number; idempotencyKey: string }>;
	lastRowIds: string[];
}

export function freshContext(): ExecutorContext {
	return { graphId: null, lastStart: new Map(), lastRowIds: [] };
}

export function opName(op: ScenarioOp): string {
	return op.op;
}

/** Execute one op against the store (the shared golden/kill vocabulary). */
export async function executeOp(store: OrchestrationStore, sink: FileEffectSink, op: ScenarioOp, ctx: ExecutorContext): Promise<void> {
	ctx.lastRowIds = [];
	const origin = 'test:scenario';
	const row = (result: unknown): void => {
		const rowId = (result as { rowId?: string }).rowId;
		if (typeof rowId === 'string') {
			ctx.lastRowIds.push(rowId);
		}
	};
	switch (op.op) {
		case 'submit': {
			const submitted = await store.submitGraph({ title: op.title, steps: op.steps, policy: op.policy, actor: 'agent', origin });
			ctx.graphId = submitted.graphId;
			ctx.lastRowIds.push(submitted.rowId);
			return;
		}
		case 'approve':
			row(store.approveGraph({ graphId: ctx.graphId as string, actor: 'human', origin }));
			return;
		case 'reject':
			row(store.rejectGraph({ graphId: ctx.graphId as string, actor: 'human', origin }));
			return;
		case 'claim':
			row(await store.acquireClaim({ graphId: ctx.graphId as string, stepId: op.stepId, holder: op.holder, actor: 'agent', origin }));
			return;
		case 'releaseClaim':
			row(await store.releaseClaim({ graphId: ctx.graphId as string, stepId: op.stepId, actor: 'agent', origin }));
			return;
		case 'lease':
			row(await store.acquireLease({ graphId: ctx.graphId as string, stepId: op.stepId, holder: op.holder, ttlMs: op.ttlMs, actor: 'agent', origin }));
			return;
		case 'renewLease':
			row(await store.renewLease({ graphId: ctx.graphId as string, stepId: op.stepId, ttlMs: op.ttlMs, actor: 'agent', origin }));
			return;
		case 'releaseLease':
			row(await store.releaseLease({ graphId: ctx.graphId as string, stepId: op.stepId, actor: 'agent', origin }));
			return;
		case 'approvalRequest':
			row(await store.approvalRequest({ graphId: ctx.graphId as string, stepId: op.stepId, reason: `scenario approval request for ${op.stepId}`, ...(op.expiresAt !== undefined ? { expiresAt: op.expiresAt } : {}), actor: 'agent', origin }));
			return;
		case 'approvalExpire':
			row(await store.expireApproval({ graphId: ctx.graphId as string, stepId: op.stepId, ...(op.expiredAt !== undefined ? { expiredAt: op.expiredAt } : {}), actor: 'service', origin }));
			return;
		case 'approvalGrant':
			row(await store.approvalDecide({ graphId: ctx.graphId as string, stepId: op.stepId, decision: 'granted', actor: 'human', origin }));
			return;
		case 'approvalDeny':
			row(await store.approvalDecide({ graphId: ctx.graphId as string, stepId: op.stepId, decision: 'denied', actor: 'human', origin }));
			return;
		case 'takeoverRequest':
			row(await store.takeoverRequest({ graphId: ctx.graphId as string, stepId: op.stepId, actor: 'human', origin }));
			return;
		case 'takeoverAccept':
			row(await store.takeoverAccept({ graphId: ctx.graphId as string, stepId: op.stepId, actor: 'human', origin }));
			return;
		case 'takeoverComplete':
			row(await store.takeoverComplete({
				graphId: ctx.graphId as string,
				stepId: op.stepId,
				actor: 'human',
				origin,
				summary: op.summary,
				evidence: [{ kind: 'note', uri: `flauz-test://takeover/${op.stepId}`, sha256: sha256Of(op.summary) }],
			}));
			return;
		case 'start': {
			const started = await store.startStep({ graphId: ctx.graphId as string, stepId: op.stepId, runnerId: op.runnerId, actor: 'agent', origin });
			ctx.lastStart.set(op.stepId, { attempt: started.attempt, idempotencyKey: started.idempotencyKey });
			ctx.lastRowIds.push(started.rowId);
			return;
		}
		case 'effect': {
			const start = ctx.lastStart.get(op.stepId);
			if (start === undefined) {
				throw new Error(`op 'effect' for ${op.stepId} without a prior 'start'`);
			}
			if (op.outcome === 'ok') {
				sink.script(start.idempotencyKey, { ok: true, value: op.value ?? `effect:${op.stepId}:attempt-${start.attempt}` });
			} else {
				sink.script(start.idempotencyKey, { ok: false, failureClass: op.failureClass ?? 'transient', message: op.message ?? `scripted failure ${op.stepId}#${start.attempt}` });
			}
			return;
		}
		case 'finishOk': {
			const start = ctx.lastStart.get(op.stepId);
			const attempt = start?.attempt ?? 1;
			const output = op.output ?? `effect:${op.stepId}:attempt-${attempt}`;
			row(await store.finishStep({
				graphId: ctx.graphId as string,
				stepId: op.stepId,
				attempt,
				outcome: 'succeeded',
				actor: 'agent',
				origin,
				output,
				evidence: [{ kind: 'note', uri: `flauz-orch-effect://${ctx.graphId as string}/${op.stepId}/run/${attempt}`, sha256: sha256Of(output) }],
			}));
			return;
		}
		case 'finishFail':
			row(await store.finishStep({
				graphId: ctx.graphId as string,
				stepId: op.stepId,
				attempt: ctx.lastStart.get(op.stepId)?.attempt,
				outcome: 'failed',
				actor: 'agent',
				origin,
				failureClass: op.failureClass,
				message: op.message,
			}));
			return;
		case 'retry':
			row(await store.retryStep({ graphId: ctx.graphId as string, stepId: op.stepId, actor: 'service', origin }));
			return;
		case 'cancel':
			await store.cancelGraph({ graphId: ctx.graphId as string, reason: op.reason, actor: 'human', origin });
			return;
		case 'route':
			row(store.routeDecide({ graphId: ctx.graphId as string, stepId: op.stepId, targetAgent: op.targetAgent, reason: op.reason, actor: 'agent', origin }));
			return;
		case 'delegation': {
			const state = store.getGraphState(ctx.graphId as string) as { routing: Record<string, { rowId: string }> };
			const decision = state.routing[op.stepId] ?? state.routing['*'];
			row(store.delegationSent({ graphId: ctx.graphId as string, stepId: op.stepId, decisionRowId: decision.rowId, messageId: op.messageId, actor: 'service', origin }));
			return;
		}
		case 'result':
			row(await store.receiveResult({ graphId: ctx.graphId as string, stepId: op.stepId, messageId: op.messageId, outcome: op.outcome, summary: op.summary, actor: 'agent', origin: 'a2a:worker-1' }));
			return;
		case 'failGraph':
			row(store.failGraph({ graphId: ctx.graphId as string, failedStepId: op.stepId, actor: 'service', origin }));
			return;
		case 'complete':
			row(store.completeGraph({ graphId: ctx.graphId as string, actor: 'service', origin }));
			return;
		case 'scan':
			await recoveryScan(store, { now: 1893456000000 });
			return;
		case 'noop':
			return;
	}
}

/** A fresh temp workspace. */
export function makeWorkspace(prefix: string): string {
	return mkdtempSync(join(tmpdir(), `flauz-orch-${prefix}-`));
}

/** Stable deep stringify (sorted keys) for state-equality assertions. */
export function stableStringify(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map(stableStringify).join(',')}]`;
	}
	if (value !== null && typeof value === 'object') {
		const record = value as Record<string, unknown>;
		const keys = Object.keys(record).sort();
		return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
	}
	return JSON.stringify(value);
}

export function snapshotOf(store: OrchestrationStore, graphId: string): string {
	return stableStringify(store.getGraphState(graphId));
}

/**
 * The golden run: executes every op in-process, snapshotting the state and
 * the journal after each op. Returns per-op row counts so callers can map
 * row boundaries to op boundaries.
 */
export interface GoldenRun {
	root: string;
	graphId: string;
	snapshots: string[];
	journalLines: string[];
	rowCounts: number[];
	sink: FileEffectSink;
}

export async function goldenRun(prefix: string, ops: ScenarioOp[], clockBase: number, options: { taskPort?: boolean } = {}): Promise<GoldenRun> {
	const root = makeWorkspace(prefix);
	const { clock } = makeClock(clockBase);
	const store = new OrchestrationStore(root, { clock, ...(options.taskPort === true ? { taskPort: new WorkspaceSeam(root) } : {}) });
	const sink = new FileEffectSink(join(root, 'effect-sink.jsonl'));
	const ctx = freshContext();
	const snapshots: string[] = [];
	const rowCounts: number[] = [];
	for (const op of ops) {
		await executeOp(store, sink, op, ctx);
		if (ctx.graphId !== null) {
			snapshots.push(snapshotOf(store, ctx.graphId));
		} else {
			snapshots.push('');
		}
		rowCounts.push(store.journalRows.length);
	}
	return {
		root,
		graphId: ctx.graphId ?? 'G-001',
		snapshots,
		journalLines: store.journalRows.map((rowValue) => JSON.stringify(rowValue)),
		rowCounts,
		sink,
	};
}

/** Read the journal lines of a workspace (raw file bytes). */
export function readJournal(root: string): string[] {
	const path = join(root, '.flauz', 'orchestration', 'journal.jsonl');
	if (!existsSync(path)) {
		return [];
	}
	return readFileSync(path, 'utf-8').split('\n').filter((line) => line.length > 0);
}

/** Read the evidence ledger rows of a workspace (the minted TL2-004 transition rows live here). */
export function readEvidenceLedger(root: string): Array<Record<string, unknown>> {
	const path = join(root, '.flauz', 'evidence', 'ledger.jsonl');
	if (!existsSync(path)) {
		return [];
	}
	return readFileSync(path, 'utf-8').split('\n').filter((line) => line.length > 0).map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** Read the graphs envelope (raw file bytes). */
export function readGraphs(root: string): string {
	const path = join(root, '.flauz', 'orchestration', 'graphs.json');
	if (!existsSync(path)) {
		return '';
	}
	return readFileSync(path, 'utf-8');
}

/** Write a torn-tail journal (prefix + a partial next line) for crash simulation. */
export function writeTornJournal(root: string, lines: string[], partial: string): void {
	const path = join(root, '.flauz', 'orchestration', 'journal.jsonl');
	writeFileSync(path, `${lines.map((line) => line).join('\n')}${lines.length > 0 ? '\n' : ''}${partial}`);
}
