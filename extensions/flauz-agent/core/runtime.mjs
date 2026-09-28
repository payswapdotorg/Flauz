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
import { runProviderCallWithBoundedRetry } from './providerRetry.mjs';

function sha256Hex(value) {
	return createHash('sha256').update(String(value), 'utf-8').digest('hex');
}

/**
 * The effect port. run(key, spec) -> {ok: true, value, replayed} |
 * {ok: false, failureClass, message, replayed, providerError?}. MUST be
 * idempotent per key. A failed effect MAY carry `providerError:
 * { code, retryClass, retryAfterMs? }` - the DL-35 typed provider error the
 * call failed with - which the bounded provider-retry executor consumes
 * (core/providerRetry.mjs, the TL2-F2 INV-2 contract).
 */
export const EFFECT_SINK_SHAPE = 'run(idempotencyKey, spec) -> {ok, value|failureClass+message, replayed, providerError?}';

function isPositiveInteger(value) {
	return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/**
 * Drive one graph as far as its gates allow.
 *
 * The provider call each step issues through the sink runs under the
 * automatic BOUNDED, RECORDED provider-retry contract (TL2-F2):
 * a DL-35 retryable typed provider error (`providerError` on the failed
 * effect) is retried up to `input.providerRetry.maxAttempts` total attempts
 * (default 3; the routing-policy state family additive field), honoring
 * `retryAfterMs` capped at 30s (or immediately when absent - the wait
 * applied is recorded), every attempt journaled as a `provider-retry` row
 * (actor, ordinal, typed outcome, wait; hash-chained), and exhaustion is a
 * TERMINAL typed failure (retryPlanned pinned false - the honest path, no
 * silent success). `input.wait` is the injectable wait port harnesses
 * control for determinism. Terminal-class and untyped failures keep the
 * existing single-shot behavior byte-identically.
 *
 * @param {import('./orchStore.mjs').OrchestrationStore} store
 * @param {{ graphId: string, sink: object, runnerId?: string, actor?: string,
 *           origin?: string, now?: number, logger?: (message: string) => void,
 *           providerRetry?: { maxAttempts?: number } | null,
 *           wait?: (ms: number) => Promise<void> }} input
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
	while (progress) {
		progress = false;
		rounds += 1;
		if (rounds > graph.steps.length * 4 + 8) {
			throw new Error(`driveGraph exceeded the round budget for ${input.graphId} (a policy loop is stuck)`);
		}
		const state = store.stateOf(input.graphId);
		if (state.graphStatus === 'completed' || state.graphStatus === 'cancelled' || state.graphStatus === 'failed') {
			break;
		}
		// 1. schedule pending retries (crash between step-failed and
		//    step-retry-scheduled is re-derived here, never fabricated).
		for (const step of Object.values(state.steps)) {
			if (step.status === 'failed' && step.failure !== null && step.failure.retryPlanned && step.nextAttempt === null) {
				const spec = graph.steps.find((candidate) => candidate.stepId === step.stepId);
				const plan = planRetry({ policy: store.policyFor(graph, spec), attempt: step.lastStartedAttempt, failureClass: step.failure.class, now: input.now ?? Date.now() });
				if (plan.retry) {
					store.appendRow('step-retry-scheduled', {
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
			const retried = await runProviderCallWithBoundedRetry(store, sink, {
				graphId: input.graphId,
				stepId: candidate,
				start,
				spec: {
					graphId: input.graphId,
					stepId: candidate,
					attempt: start.attempt,
					tool: spec.tool ?? null,
					toolInput: spec.toolInput ?? null,
					instruction: spec.instruction,
				},
				actor,
				origin,
				providerRetry: input.providerRetry,
				wait: input.wait,
			});
			const effect = retried.effect;
			started.push({ stepId: candidate, attempt: start.attempt, idempotencyKey: start.idempotencyKey, replayed: effect.replayed === true, providerAttempts: retried.providerAttempts, providerExhausted: retried.exhausted });
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
					// exhaustion is TERMINAL: the bounded window consumed the
					// retry budget - the automatic step-retry loop stays
					// silent and an explicit caller retry opens a fresh window.
					...(retried.exhausted ? { retryPlanned: false } : {}),
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
				store.appendRow('step-cancelled', {
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
