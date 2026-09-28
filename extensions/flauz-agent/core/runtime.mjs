/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Flauz orchestration runtime (TL2-001 M1/M2) - the deterministic executor.
 *
 * Drives a durable graph's steps through the store. NO vendor coupling: step
 * effects go through the injected EffectSink PORT (run(key, spec) -> result)
 * keyed by the idempotency key - the runtime never touches a model or tool
 * SDK. The sink contract (binding): run() is idempotent per key - a
 * completed-but-unrecorded effect (crash between effect and journal append)
 * replays its recorded outcome instead of executing twice. The file-backed
 * fixture sink lives in the test harness; the production sink is the future
 * stateful service's effect executor (INTEGRATION-GAPS).
 *
 * Determinism: steps run sequentially in a fixed loop (v0; the DAG order
 * emerges as dependencies unlock). `now` is injectable.
 *
 * The human authorization boundary: driveGraph NEVER starts a step of a
 * graph that is not 'approved' (graph-approved is human-actor-only in the
 * transition table), NEVER starts a gated step without a human
 * approval-granted row, and NEVER grants approvals itself - a gated step
 * gets its approval-requested row (a request, never a grant) and execution
 * stops there until a human decides. Takeover is entirely human-actor
 * (takeover-accepted/completed); the runtime only surfaces it.
 *
 * Crash safety: every state change is a journal row; a crash between the
 * sink call and the finish row leaves the step 'running' - recovery marks
 * it interrupted and the re-drive re-uses the SAME attempt (same key), so
 * the sink replays instead of duplicating.
 */

import { createHash } from 'node:crypto';
import { planRetry, classifyFailure } from './policy.mjs';
import { summarizeState } from './orchestration.mjs';

function sha256Hex(value) {
	return createHash('sha256').update(String(value), 'utf-8').digest('hex');
}

/**
 * The effect port. run(key, spec) -> {ok: true, value, replayed} |
 * {ok: false, failureClass, message, replayed}. MUST be idempotent per key.
 */
export const EFFECT_SINK_SHAPE = 'run(idempotencyKey, spec) -> {ok, value|failureClass+message, replayed}';

function isPositiveInteger(value) {
	return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/**
 * Drive one graph as far as its gates allow.
 *
 * INV-3 cancellation propagation (three levels):
 *  1. DOWNSTREAM GATE - the loop re-reads the graph state from the store
 *     before dispatching each next step; a terminal 'cancelled' graph never
 *     starts a subsequent step. When the gate trips the drive records ONE
 *     cancel-attributed evidence row (actor = the recorded cancel's actor,
 *     reason 'downstream-stopped') and returns the typed cancellation
 *     outcome.
 *  2. IN-FLIGHT ABORT - after the effect sink resolves, the drive re-reads
 *     the state before recording the step transition; a step (or graph) that
 *     became 'cancelled' mid-flight is NOT completed (never a fake success,
 *     never a silent step-succeeded): the abort is recorded with attribution
 *     (reason 'in-flight-abort') and the drive unwinds with the typed
 *     cancellation outcome.
 *  3. TYPED PROPAGATION - a runner already past its last checkpoint that
 *     appends a transition into the cancelled target gets the store's TYPED
 *     stale-run/cancelled-observed outcome (code 'stale-run-cancelled'), not
 *     the generic state-machine crash (see orchStore.assertNotStaleRun).
 *
 * @param {import('./orchStore.mjs').OrchestrationStore} store
 * @param {{ graphId: string, sink: object, runnerId?: string, actor?: string,
 *           origin?: string, now?: number, logger?: (message: string) => void }} input
 */
export async function driveGraph(store, input) {
	const sink = input.sink;
	if (sink === null || typeof sink !== 'object' || typeof sink.run !== 'function') {
		throw new Error(`driveGraph requires an effect sink (${EFFECT_SINK_SHAPE})`);
	}
	const runnerId = input.runnerId ?? 'flauz-runtime';
	const actor = input.actor ?? 'agent';
	const origin = input.origin ?? 'runtime:drive';
	const graph = store.requireGraph(input.graphId);
	const started = [];
	let rounds = 0;
	let progress = true;
	let cancelObservation = null;
	const recordCancelObservation = async (reason, stepId) => {
		if (cancelObservation !== null) {
			return;
		}
		const stateNow = store.stateOf(input.graphId);
		const row = await store.appendEvidenceBearingRow('cancel-observed', {
			graphId: input.graphId,
			stepId: stepId ?? null,
			actor: stateNow.cancelActor ?? 'service',
			origin: 'runtime:cancel-propagation',
			payload: { reason, note: `runner ${runnerId} observed the recorded cancellation (${reason})` },
		});
		cancelObservation = {
			rowId: row.rowId,
			evidenceId: row.payload.evidenceId ?? null,
			reason,
			...(stepId !== undefined ? { stepId } : {}),
		};
	};
	while (progress) {
		progress = false;
		rounds += 1;
		if (rounds > graph.steps.length * 4 + 8) {
			throw new Error(`driveGraph exceeded the round budget for ${input.graphId} (a policy loop is stuck)`);
		}
		const state = store.stateOf(input.graphId);
		if (state.graphStatus === 'completed' || state.graphStatus === 'cancelled' || state.graphStatus === 'failed') {
			if (state.graphStatus === 'cancelled') {
				// Level 1: the downstream gate - record the attributed observation.
				await recordCancelObservation('downstream-stopped');
			}
			break;
		}
		// 1. schedule pending retries (crash between step-failed and
		//    step-retry-scheduled is re-derived here, never fabricated).
		for (const step of Object.values(state.steps)) {
			if (step.status === 'failed' && step.failure !== null && step.failure.retryPlanned && step.nextAttempt === null) {
				const spec = graph.steps.find((candidate) => candidate.stepId === step.stepId);
				const plan = planRetry({ policy: store.policyFor(graph, spec), attempt: step.lastStartedAttempt, failureClass: step.failure.class, now: input.now ?? Date.now() });
				if (plan.retry) {
					await store.appendRowLocked('step-retry-scheduled', {
						graphId: input.graphId,
						stepId: step.stepId,
						actor: 'service',
						origin: 'runtime:retry',
						payload: { nextAttempt: plan.nextAttempt, nextAttemptAt: plan.nextAttemptAt },
					});
					progress = true;
				}
			}
		}
		// 2. gated steps: record the approval REQUEST (never a grant - the
		//    human decides via approvalDecide; the store op mints the evidence
		//    row), then expire deadline-bearing requests whose deadline passed
		//    (the fail-closed TL2-004 timeout - actor service, step cancelled).
		const gateSummary = summarizeState(store.stateOf(input.graphId));
		for (const step of graph.steps) {
			const stepState = gateSummary.steps[step.stepId];
			if (step.gate === 'human-approval' && stepState.status === 'ready' && stepState.approval === null) {
				await store.approvalRequest({
					graphId: input.graphId,
					stepId: step.stepId,
					reason: `step ${step.stepId} is gated 'human-approval' and awaits a human decision`,
					actor: 'service',
					origin: 'runtime:gate',
				});
				progress = true;
			}
			if (step.gate === 'human-approval' && stepState.status === 'awaiting-approval' && stepState.approval !== null && stepState.approval.expiresAt !== undefined && stepState.approval.expiresAt <= (input.now ?? Date.now())) {
				await store.expireApproval({
					graphId: input.graphId,
					stepId: step.stepId,
					actor: 'service',
					origin: 'runtime:gate-expiry',
				});
				progress = true;
			}
		}
		// 3. run one runnable step (sequential v0; summary re-derived after
		//    any approval-requested rows appended above).
		const summary = summarizeState(store.stateOf(input.graphId));
		const candidate = summary.execution.runnable
			.filter((stepId) => {
				const stepState = summary.steps[stepId];
				return stepState.retryNotBefore === null || stepState.retryNotBefore <= (input.now ?? Date.now());
			})
			.sort()[0];
		if (candidate !== undefined) {
			const spec = graph.steps.find((step) => step.stepId === candidate);
			const start = await store.startStep({ graphId: input.graphId, stepId: candidate, runnerId, actor, origin });
			const effect = await sink.run(start.idempotencyKey, {
				graphId: input.graphId,
				stepId: candidate,
				attempt: start.attempt,
				tool: spec.tool ?? null,
				toolInput: spec.toolInput ?? null,
				instruction: spec.instruction,
			});
			started.push({ stepId: candidate, attempt: start.attempt, idempotencyKey: start.idempotencyKey, replayed: effect.replayed === true });
			// Level 2: the in-flight abort checkpoint - the state is re-read
			// after the effect and before the step transition is recorded. A
			// step/graph cancelled mid-flight is NEVER completed (no fake
			// success, no silent step-succeeded): the abort is recorded with
			// attribution and the drive unwinds with the typed outcome.
			const postEffect = store.stateOf(input.graphId);
			const stepCancelledMidFlight = postEffect.steps[candidate] !== undefined && postEffect.steps[candidate].status === 'cancelled';
			if (postEffect.graphStatus === 'cancelled' || stepCancelledMidFlight) {
				await recordCancelObservation('in-flight-abort', candidate);
				break;
			}
			if (effect.ok) {
				await store.finishStep({
					graphId: input.graphId,
					stepId: candidate,
					attempt: start.attempt,
					outcome: 'succeeded',
					actor,
					origin,
					output: String(effect.value),
					evidence: [{
						kind: 'note',
						uri: `flauz-orch-effect://${input.graphId}/${candidate}/run/${start.attempt}`,
						sha256: sha256Hex(effect.value),
					}],
				});
			} else {
				await store.finishStep({
					graphId: input.graphId,
					stepId: candidate,
					attempt: start.attempt,
					outcome: 'failed',
					actor,
					origin,
					error: { failureClass: effect.failureClass, message: effect.message },
					failureClass: effect.failureClass,
					message: effect.message,
				});
			}
			progress = true;
		}
		if (!progress) {
			break;
		}
	}
	// 4. permanent-failure policy + completion.
	const finalState = store.stateOf(input.graphId);
	await applyFailurePolicy(store, input.graphId, finalState, { origin, now: input.now });
	const after = store.stateOf(input.graphId);
	const allSucceeded = Object.values(after.steps).every((step) => step.status === 'succeeded');
	let completed = false;
	if (allSucceeded && after.graphStatus === 'approved') {
		await store.completeGraph({ graphId: input.graphId, actor: 'service', origin: 'runtime:completion' });
		completed = true;
	}
	return {
		graphId: input.graphId,
		graphStatus: store.stateOf(input.graphId).graphStatus,
		started,
		completed,
		rounds,
		cancelled: cancelObservation !== null || store.stateOf(input.graphId).graphStatus === 'cancelled',
		cancelObservation,
		summary: summarizeState(store.stateOf(input.graphId)),
	};
}

/**
 * Apply the graph's onStepFailure policy for permanently failed steps:
 *  - 'fail-graph': append graph-failed (the first permanently failed step);
 *  - 'continue'  : cancel the (transitive) dependents with cause
 *                  'dependency-failed' so the rest of the graph can drain;
 *  - 'manual' (default): record nothing - the human decides.
 */
export async function applyFailurePolicy(store, graphId, state, options = {}) {
	const graph = store.requireGraph(graphId);
	const policy = graph.policy.onStepFailure ?? 'manual';
	// Permanently failed: exhausted/terminal FAILED steps, plus the
	// GATE-TERMINAL cancellations (approval-denied / approval-expired carry
	// a failure record with retryPlanned false - the step will never run;
	// user/dependency cancellations carry no failure record and stay out).
	const permanentlyFailed = Object.values(state.steps).filter((step) =>
		(step.status === 'failed' && (step.failure === null || step.failure.retryPlanned === false))
		|| (step.status === 'cancelled' && step.failure !== null && step.failure.retryPlanned === false));
	if (permanentlyFailed.length === 0) {
		return;
	}
	if (policy === 'fail-graph') {
		if (state.graphStatus === 'approved') {
			await store.failGraph({ graphId, failedStepId: permanentlyFailed[0].stepId, actor: 'service', origin: options.origin ?? 'runtime:policy' });
		}
		return;
	}
	if (policy === 'continue') {
		const failed = new Set(permanentlyFailed.map((step) => step.stepId));
		const dependents = transitiveDependents(graph, failed);
		for (const stepId of dependents) {
			const current = summarizeState(store.stateOf(graphId)).steps[stepId];
			if (!['succeeded', 'cancelled'].includes(current.status)) {
				await store.appendRowLocked('step-cancelled', {
					graphId,
					stepId,
					actor: 'service',
					origin: 'runtime:policy',
					payload: { cause: 'dependency-failed' },
				});
			}
		}
	}
}

/** All step ids that (transitively) depend on any step in `failed`. */
export function transitiveDependents(graph, failed) {
	const dependents = new Set();
	let grew = true;
	while (grew) {
		grew = false;
		for (const step of graph.steps) {
			if (dependents.has(step.stepId)) {
				continue;
			}
			const deps = step.dependsOn ?? [];
			if (deps.some((dep) => failed.has(dep) || dependents.has(dep))) {
				dependents.add(step.stepId);
				grew = true;
			}
		}
	}
	return [...dependents].sort();
}
