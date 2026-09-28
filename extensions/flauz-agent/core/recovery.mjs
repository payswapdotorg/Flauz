/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Flauz orchestration recovery pass (TL2-001, M1) - zero-dependency.
 *
 * The restart/recovery safety contract, made mechanical:
 *
 *  1. the store's strict load already verified the global journal chain and
 *     dropped a torn FINAL line as a crash artifact (the transition never
 *     completed - dropping it loses nothing: side effects are keyed by
 *     idempotency key, so a re-drive replays instead of duplicating);
 *  2. this pass reconstructs every graph's logical state by replay (the
 *     projection is the state - nothing is cached);
 *  3. steps left 'running' at journal end (their process died) are marked
 *     step-interrupted - an OBSERVATIONAL transition with provenance
 *     (actor service, origin recovery) that returns the step to 'ready'
 *     with the SAME attempt, so the re-drive re-uses the identical
 *     idempotency key;
 *  4. leases whose expiry passed while the process was down are marked
 *     lease-expired (the step becomes claimable again);
 *  5. a cancellation sweep interrupted by the crash is CONTINUED to
 *     coherence (cancel-requested is persisted; every non-terminal step
 *     still receives its step-cancelled row, then graph-cancelled);
 *  6. one recovery-scan row per graph records what the pass did - every
 *     appended row corresponds to a real observed event, and a scan that
 *     observed nothing anomalous still records itself (the scan itself is
 *     a real, explicitly requested event).
 *
 * The pass NEVER fabricates: it does not schedule retries (a retry is a
 * policy decision re-derived by the runtime), does not complete steps, does
 * not grant approvals (the human gate survives crashes by construction -
 * approval-granted is human-actor-only in the transition table).
 */

import { planCancellation } from './policy.mjs';
import { summarizeState } from './orchestration.mjs';

/**
 * Run the recovery pass over every graph in the store.
 *
 * @param {OrchestrationStore} store a freshly constructed store on the
 *        recovered workspace root (its load already dropped any torn tail).
 * @param {{ record?: boolean, now?: number, actor?: string, origin?: string }} options
 *        record=false computes the report without appending anything.
 * @returns the recovery report {scannedAt, clean, journalRows, tornTail,
 *          actions, graphs: [{graphId, clean, actions, summary}]}
 */
export async function recoveryScan(store, options = {}) {
	const record = options.record !== false;
	const now = options.now ?? Date.now();
	const actor = options.actor ?? 'service';
	const origin = options.origin ?? 'recovery';
	const actions = [];
	const graphs = [];
	for (const graph of store.graphs) {
		const graphActions = [];
		const state = store.stateOf(graph.graphId);
		for (const stepId of state.interrupted) {
			const step = state.steps[stepId];
			if (record) {
				store.appendRow('step-interrupted', {
					graphId: graph.graphId,
					stepId,
					actor,
					origin,
					attempt: step.lastStartedAttempt,
					idempotencyKey: null,
					payload: { cause: 'process-exit', note: `runner ${step.runnerId ?? 'unknown'} did not record a completion before the process died` },
				});
			}
			graphActions.push(`step-interrupted:${stepId}`);
		}
		for (const [stepId, lease] of Object.entries(state.leases)) {
			if (lease.expiresAt <= now) {
				if (record) {
					store.appendRow('lease-expired', {
						graphId: graph.graphId,
						stepId,
						actor,
						origin,
						payload: { leaseId: lease.leaseId, holder: lease.holder, expiredAt: now },
					});
				}
				graphActions.push(`lease-expired:${lease.leaseId}`);
			}
		}
		if (state.cancelRequested && state.graphStatus !== 'cancelled') {
			const plan = planCancellation(
				Object.fromEntries(Object.entries(state.steps).map(([stepId, step]) => [stepId, { status: effectiveOf(store, graph.graphId, stepId) }])),
			);
			for (const stepId of plan.cancelStepIds) {
				if (record) {
					store.appendRow('step-cancelled', {
						graphId: graph.graphId,
						stepId,
						actor,
						origin: 'recovery:cancel-continuation',
						payload: { cause: 'propagation', note: 'cancellation sweep continued after restart' },
					});
				}
				graphActions.push(`cancel-continued:${stepId}`);
			}
			if (record && plan.cancelStepIds.length > 0) {
				store.appendRow('graph-cancelled', {
					graphId: graph.graphId,
					actor,
					origin: 'recovery:cancel-continuation',
					payload: { reason: state.cancelReason ?? 'continued cancellation' },
				});
			}
			if (plan.cancelStepIds.length > 0) {
				graphActions.push('graph-cancelled');
			}
		}
		const clean = graphActions.length === 0;
		if (record) {
			store.appendRow('recovery-scan', {
				graphId: graph.graphId,
				actor,
				origin,
				payload: { actions: graphActions, clean },
			});
		}
		graphs.push({ graphId: graph.graphId, clean, actions: graphActions, summary: summarizeState(store.stateOf(graph.graphId)) });
		actions.push(...graphActions.map((action) => `${graph.graphId}:${action}`));
	}
	return {
		scannedAt: now,
		clean: actions.length === 0,
		journalRows: store.journalRows.length,
		tornTail: store.tornTail,
		actions,
		graphs,
	};
}

function effectiveOf(store, graphId, stepId) {
	const state = store.stateOf(graphId);
	const summary = summarizeState(state);
	return summary.steps[stepId].status;
}
