/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * P2-FIX-204 — the human takeover port (the fifth human gate).
 *
 * The orchestration runtime has carried takeover since TL2-004: the protocol
 * methods `flauz.orch.requestTakeover` / `flauz.orch.acceptTakeover` /
 * `flauz.orch.completeTakeover` (actor `human` — the kill-recover matrix
 * guarantees `takeover-pending` / `taken-over` NEVER auto-advance), and the
 * journey rehearsal's approval-takeover leg proved the full fail-closed
 * sequence: the interrupted gate moves to `takeover-pending`, the human-only
 * acceptance lands with attribution, and the step is completed by the HUMAN
 * with takeover evidence minted into the shared ledger. None of that was
 * reachable from a user-facing surface — this module is the bridge's half of
 * the fix (the participant `/takeover` command and the Agent Sessions row
 * affordance both drive this port).
 *
 * The port drives the REAL in-process orchestration mediator
 * (core/orchMediator.mjs — the flauz.orch.* dispatch surface) against the
 * workspace root. The journal/graphs under `.flauz/orchestration/` are
 * written by this port's store only (the single-writer discipline); the
 * flauz.tasks/v0 surfaces stay owned by the core service through the
 * taskPort adapter (the evidence rows the takeover ops mint are appended by
 * the SERVICE over the seam — the ledger keeps exactly one writer).
 */

import { OrchestrationMediator } from '../core/orchMediator.mjs';
import type { TaskPort } from '../core/orchStore.mjs';
import { sha256Of } from './artifacts.ts';
import type { SeamClient } from './seamClient.ts';
import type { EvidenceRowInput, TaskEvent } from './types.ts';

/** Provenance origin stamped on every takeover row this port lands. */
export const TAKEOVER_ORIGIN = 'flauz-agent:/takeover';

/** The participant slash command this port serves (package.json contributes it as the fifth human gate). */
export const TAKEOVER_COMMAND_NAME = 'takeover';

/**
 * A snapshot of the one step of the active task that is waiting on a human:
 *   - 'stuck'            the step is halted on a pending approval gate (the
 *                        LEG 9 interrupt case — takeover is the escape hatch);
 *   - 'takeover-pending' a takeover was requested but not yet accepted;
 *   - 'taken-over'       the step is held for the human (the agent may not run it).
 */
export interface TakeoverStepSnapshot {
	readonly state: 'stuck' | 'takeover-pending' | 'taken-over';
	readonly graphId: string;
	readonly stepId: string;
	readonly stepTitle: string;
}

/** The minted takeover evidence (the LEG 9 discipline: one note row per completed takeover). */
export interface TakeoverEvidenceReceipt {
	readonly uri: string;
	readonly sha256: string;
	readonly evidenceId: string | null;
}

/** The journal rows a takeover landed (all carry actor `human`). */
export interface TakeoverRowReceipt {
	readonly type: 'takeover-requested' | 'takeover-accepted' | 'takeover-completed';
	readonly rowId: string;
}

/** What a completed takeover looks like to a user-facing surface. */
export interface TakeoverReceipt {
	readonly graphId: string;
	readonly stepId: string;
	readonly stepTitle: string;
	readonly summary: string;
	readonly rows: readonly TakeoverRowReceipt[];
	readonly evidence: TakeoverEvidenceReceipt | undefined;
}

/**
 * Fail-closed result contract: a takeover either landed (with its receipt),
 * or did not — 'none' (nothing is waiting on a human) / 'error' (the
 * orchestration state refused or could not be read) — never a fabricated
 * success.
 */
export type TakeoverResult =
	| { readonly outcome: 'taken-over'; readonly receipt: TakeoverReceipt }
	| { readonly outcome: 'none'; readonly message: string }
	| { readonly outcome: 'error'; readonly message: string };

/** The takeover surface the bridge depends on (injectable; the real port drives the mediator). */
export interface TakeoverPort {
	/** The active task's human-gated step, when one exists (fail-closed: undefined when none). */
	stuckStepOf(taskId: string): Promise<TakeoverStepSnapshot | undefined>;
	/**
	 * Perform the human takeover sequence on the active task's stuck step:
	 * request (when the step is still gated) -> accept -> complete, every
	 * step an actor-`human` transition with journaled evidence. The optional
	 * note is the human's reason/summary (the completion summary defaults
	 * to an honest sentence when empty).
	 */
	takeOverStep(taskId: string, note: string): Promise<TakeoverResult>;
}

/** Maps the taskPort the store expects onto the bridge's seam client (the service keeps the ledger single-writer). */
export function seamTaskPort(seam: SeamClient): TaskPort {
	return {
		createTask(args: { title: string }) {
			return seam.createTask(args.title);
		},
		appendEvent(args: { taskId: string; event: Record<string, unknown> }) {
			return seam.appendEvent(args.taskId, args.event as Omit<TaskEvent, 'ts'> & { ts?: number });
		},
		appendEvidence(args: { taskId: string; row: { kind: string; uri: string; sha256: string; note?: string } }) {
			// The store mints ledger rows with its fixed kinds ('note' for every takeover
			// op) — the typed seam input narrows that same set.
			return seam.appendEvidence(args.taskId, args.row as EvidenceRowInput);
		},
	};
}

/** Step statuses that hold for a human, ranked so an in-flight takeover wins over a fresh gate. */
const HUMAN_HOLD_RANK: Readonly<Record<string, number>> = {
	'takeover-pending': 0,
	'taken-over': 1,
	'awaiting-approval': 2,
};

const TERMINAL_GRAPH_STATUSES: readonly string[] = ['completed', 'failed', 'cancelled'];

interface HumanHeldStep {
	readonly graphId: string;
	readonly stepId: string;
	readonly stepTitle: string;
	readonly status: 'awaiting-approval' | 'takeover-pending' | 'taken-over';
}

/** The rowId half of the mediator's dispatch result envelope ({rowId, evidenceId?}). */
function rowIdOfResult(result: Record<string, unknown>): string {
	const rowId = result.rowId;
	return typeof rowId === 'string' ? rowId : '';
}

/**
 * The real takeover port: one fresh mediator per operation (the store loads
 * the on-disk journal strictly at construction — per-operation construction
 * is the no-staleness posture; only this port writes `.flauz/orchestration/`).
 */
export function createOrchTakeoverPort(root: string, taskPort: TaskPort, logger?: (message: string) => void): TakeoverPort {
	const withMediator = async <T>(fn: (mediator: OrchestrationMediator) => Promise<T>): Promise<T> => {
		const mediator = new OrchestrationMediator(root, { taskPort });
		return fn(mediator);
	};

	/** The active task's most recent non-terminal attached graph, when one exists. */
	const graphOf = (mediator: OrchestrationMediator, taskId: string): { graphId: string; title: string } | undefined => {
		const attached = mediator.store
			.listGraphs()
			.filter(graph => graph.taskId === taskId && !TERMINAL_GRAPH_STATUSES.includes(graph.graphStatus));
		return attached.length > 0 ? { graphId: attached[attached.length - 1]!.graphId, title: attached[attached.length - 1]!.title } : undefined;
	};

	/** The step of `graphId` that is waiting on a human (an in-flight takeover first, then the pending gate). */
	const humanHeldStepOf = (mediator: OrchestrationMediator, graphId: string): HumanHeldStep | undefined => {
		const state = mediator.store.stateOf(graphId);
		let best: HumanHeldStep | undefined;
		let bestRank = Number.POSITIVE_INFINITY;
		for (const step of state.graph.steps) {
			const status = state.steps[step.stepId]?.status;
			if (typeof status !== 'string' || !(status in HUMAN_HOLD_RANK)) {
				continue;
			}
			const rank = HUMAN_HOLD_RANK[status] ?? Number.POSITIVE_INFINITY;
			if (rank < bestRank) {
				best = { graphId, stepId: step.stepId, stepTitle: step.title, status: status as HumanHeldStep['status'] };
				bestRank = rank;
			}
		}
		return best;
	};

	const snapshotOf = (step: HumanHeldStep): TakeoverStepSnapshot => ({
		state: step.status === 'awaiting-approval' ? 'stuck' : step.status,
		graphId: step.graphId,
		stepId: step.stepId,
		stepTitle: step.stepTitle,
	});

	return {
		async stuckStepOf(taskId: string): Promise<TakeoverStepSnapshot | undefined> {
			try {
				return await withMediator(async mediator => {
					const graph = graphOf(mediator, taskId);
					if (graph === undefined) {
						return undefined;
					}
					const step = humanHeldStepOf(mediator, graph.graphId);
					return step === undefined ? undefined : snapshotOf(step);
				});
			} catch (error) {
				logger?.(`takeover probe failed: ${error instanceof Error ? error.message : String(error)}`);
				return undefined;
			}
		},

		async takeOverStep(taskId: string, note: string): Promise<TakeoverResult> {
			const trimmed = note.trim();
			try {
				return await withMediator(async mediator => {
					const graph = graphOf(mediator, taskId);
					if (graph === undefined) {
						return {
							outcome: 'none' as const,
							message: `Task ${taskId} has no orchestration graph to take over — takeover applies to a gated step of a running plan.`,
						};
					}
					const step = humanHeldStepOf(mediator, graph.graphId);
					if (step === undefined) {
						return {
							outcome: 'none' as const,
							message: `No step of ${graph.graphId} is waiting on a human gate — nothing to take over. Reply /approve or /request-changes to move the plan, or /cancel to abort.`,
						};
					}
					const rows: TakeoverRowReceipt[] = [];
					// (a) the REQUEST — only while the step is still gated (a pending
					// or accepted takeover resumes at (b)/(c) instead).
					if (step.status === 'awaiting-approval') {
						const requested = await mediator.dispatch('flauz.orch.requestTakeover', {
							actor: 'human',
							graphId: step.graphId,
							origin: TAKEOVER_ORIGIN,
							stepId: step.stepId,
							reason: trimmed.length > 0 ? trimmed : 'the human interrupts the pending gate and takes the stuck step over by hand',
						});
						rows.push({ type: 'takeover-requested', rowId: rowIdOfResult(requested) });
					}
					// (b) the ACCEPT — human-only by the transition table.
					if (step.status === 'awaiting-approval' || step.status === 'takeover-pending') {
						const accepted = await mediator.dispatch('flauz.orch.acceptTakeover', {
							actor: 'human',
							graphId: step.graphId,
							note: 'the human accepted the takeover through the /takeover human gate',
							origin: TAKEOVER_ORIGIN,
							stepId: step.stepId,
						});
						rows.push({ type: 'takeover-accepted', rowId: rowIdOfResult(accepted) });
					}
					// (c) the COMPLETION — the step finishes as the human, with the
					// LEG 9 evidence discipline (one note row, uri naming the
					// taken-over step, sha256 over the summary).
					const summary = trimmed.length > 0
						? trimmed
						: `the human completed ${step.stepId} of ${step.graphId} by hand (takeover human gate — no agent execution)`;
					const evidenceInput = { kind: 'note', uri: `flauz-orch-takeover://${step.graphId}/${step.stepId}`, sha256: sha256Of(summary) };
					const completed = await mediator.dispatch('flauz.orch.completeTakeover', {
						actor: 'human',
						evidence: [evidenceInput],
						graphId: step.graphId,
						origin: TAKEOVER_ORIGIN,
						stepId: step.stepId,
						summary,
					});
					const completedRowId = rowIdOfResult(completed);
					rows.push({ type: 'takeover-completed', rowId: completedRowId });
					const completedRow = mediator.store.journalRows.find(row => row.rowId === completedRowId);
					const minted = (completedRow?.payload as { evidence?: Array<{ uri?: unknown; sha256?: unknown; evidenceId?: unknown }> } | undefined)?.evidence?.[0];
					const evidence: TakeoverEvidenceReceipt | undefined = minted !== undefined
						? {
							uri: typeof minted.uri === 'string' ? minted.uri : evidenceInput.uri,
							sha256: typeof minted.sha256 === 'string' ? minted.sha256 : evidenceInput.sha256,
							evidenceId: typeof minted.evidenceId === 'string' ? minted.evidenceId : null,
						}
						: undefined;
					return {
						outcome: 'taken-over' as const,
						receipt: {
							graphId: step.graphId,
							stepId: step.stepId,
							stepTitle: step.stepTitle,
							summary,
							rows,
							evidence,
						},
					};
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				logger?.(`takeover failed: ${message}`);
				return { outcome: 'error', message };
			}
		},
	};
}
