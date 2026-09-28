/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Flauz multi-agent routing (TL2-001 M3 / TL2-006 seed) - zero-dependency.
 *
 * The bridge between the durable task graph (core/orchestration.mjs) and
 * the agent-to-agent bus (core/a2a.mjs, typed mirror
 * extensions/flauz-workflow/src/messaging.ts). Everything rides the typed
 * A2A v0 message shapes:
 *
 *   task-delegation   parent -> worker: the delegated subtask. Built from
 *                     SHARED TASK STATE ONLY (taskDescription = step title,
 *                     prompt = step instruction, taskId = the linked
 *                     T-task, optional workflowId) - the delegating agent's
 *                     PRIVATE CONTEXT (attempt history, claims, failures,
 *                     tool internals) never enters the message. The
 *                     separation is structural: buildTaskDelegation
 *                     projects exactly the a2a payload keys, and the bus
 *                     validates the shape on post.
 *   result-report     worker -> parent: mapped back onto the graph as a
 *                     result-received receipt + the step transition, with
 *                     provenance origin 'a2a:<agentId>'.
 *   steering-relay    parent -> worker: mid-run steering for a delegated
 *                     step (built here; delivery scheduling stays with the
 *                     mediator).
 *   resource-claim    claim/lease notices to watchers: graph-level claims
 *                     and leases are mirrored onto the bus as Claim+Lease
 *                     notices (acquire carries leaseUntil - the NOTICE
 *                     horizon; the graph-level claim itself has no expiry,
 *                     documented v0 deviation).
 *
 * Routing decision records: every delegation is preceded by a
 * route-decided journal row - WHY this agent (capability-match |
 * load-balance | operator-choice) with details - so the decision is
 * durable, provenance-carrying evidence, not a side-channel.
 *
 * The bus is an injected PORT ({ post({message}) }) so this module stays
 * pure; the service wiring passes the real A2ABus, tests pass the real
 * bus on a temp workspace (fidelity) or fakes.
 */

import { isAgentId, OrchestrationError } from './orchestration.mjs';

/** The notice horizon of a graph-level claim mirrored onto the bus (ms after the notice). */
export const CLAIM_NOTICE_TTL_MS = 60000;

const A2A_AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function isPlainObject(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Rank candidate agents for a step by CAPABILITY MATCH. A candidate
 * qualifies when it declares the required capability (when the step asks
 * for one) and is on the step's allowedAgents list (when the step has
 * one); qualified candidates are ranked by declared capability count
 * (most specific first), then by id for determinism.
 *
 * @param candidates [{agentId, capabilities: string[]}]
 * @param hints {requiredCapability?: string, allowedAgents?: string[]}
 * @returns {qualified: string[], rejected: [{agentId, reason: string}]}
 */
export function rankAgentsByCapability(candidates, hints = {}) {
	if (!Array.isArray(candidates)) {
		throw new OrchestrationError('rankAgentsByCapability requires a candidates array', 'invalid-params');
	}
	const qualified = [];
	const rejected = [];
	for (const candidate of candidates) {
		if (!isPlainObject(candidate) || !A2A_AGENT_ID.test(String(candidate.agentId ?? ''))) {
			rejected.push({ agentId: String(candidate?.agentId ?? ''), reason: 'not an agent id' });
			continue;
		}
		const capabilities = Array.isArray(candidate.capabilities) ? candidate.capabilities : [];
		if (hints.requiredCapability !== undefined && !capabilities.includes(hints.requiredCapability)) {
			rejected.push({ agentId: candidate.agentId, reason: `missing capability '${hints.requiredCapability}'` });
			continue;
		}
		if (hints.allowedAgents !== undefined && !hints.allowedAgents.includes(candidate.agentId)) {
			rejected.push({ agentId: candidate.agentId, reason: 'not on the step allowedAgents list' });
			continue;
		}
		qualified.push({ agentId: candidate.agentId, capabilityCount: capabilities.length });
	}
	qualified.sort((a, b) => (b.capabilityCount - a.capabilityCount) || (a.agentId < b.agentId ? -1 : 1));
	return {
		qualified: qualified.map((entry) => entry.agentId),
		rejected,
	};
}

/**
 * Pick the least-loaded candidate (the load-balance reason). Deterministic:
 * lowest load, then lowest id.
 *
 * @param candidates [{agentId, load: number}]
 * @returns {agentId: string, load: number} - throws when candidates is empty.
 */
export function pickByLoad(candidates) {
	if (!Array.isArray(candidates) || candidates.length === 0) {
		throw new OrchestrationError('pickByLoad requires a non-empty candidates array', 'invalid-params');
	}
	let best = null;
	for (const candidate of candidates) {
		if (!isPlainObject(candidate) || !A2A_AGENT_ID.test(String(candidate.agentId ?? '')) || typeof candidate.load !== 'number' || !Number.isFinite(candidate.load)) {
			throw new OrchestrationError('pickByLoad candidates must be [{agentId, load: number}]', 'invalid-params');
		}
		if (best === null || candidate.load < best.load || (candidate.load === best.load && candidate.agentId < best.agentId)) {
			best = candidate;
		}
	}
	return { agentId: best.agentId, load: best.load };
}

/**
 * The SHARED-TASK-STATE projection of a step for delegation. Exactly the
 * a2a task-delegation payload keys - the private context (attempts,
 * failures, claims, toolInput internals) is structurally excluded.
 */
export function buildTaskDelegation(store, input) {
	const graph = store.requireGraph(input.graphId);
	const step = store.requireStep(graph, input.stepId);
	if (graph.taskId === null) {
		throw new OrchestrationError(`delegation requires a graph linked to a T-task (graph ${input.graphId} has taskId null - submit it with the taskPort seam)`, 'invalid-params');
	}
	return {
		taskId: graph.taskId,
		taskDescription: step.title,
		prompt: step.instruction,
	};
}

/**
 * Delegate one step to an agent end to end:
 *   1. route-decided - the durable routing decision record (WHY this agent);
 *   2. startStep - the parent starts the attempt (runnerId = the target
 *      agent; the claim conflict check runs inside startStep);
 *   3. the bus post - the typed task-delegation message;
 *   4. delegation-sent - the receipt linking decision row + message id.
 *
 * @param store the orchestration store
 * @param bus the a2a bus port ({ post({message}) -> {id, seq, message} })
 * @param input {graphId, stepId, targetAgent, reason: 'capability-match'|'load-balance'|'operator-choice', details?, fromAgent?, workflowId?, actor?, origin?}
 */
export async function delegateStep(store, bus, input) {
	if (!isAgentId(input.targetAgent)) {
		throw new OrchestrationError(`delegateStep targetAgent must be an agent id (got ${JSON.stringify(input.targetAgent)})`, 'invalid-params');
	}
	if (!['capability-match', 'load-balance', 'operator-choice'].includes(input.reason)) {
		throw new OrchestrationError(`delegateStep reason must be 'capability-match' | 'load-balance' | 'operator-choice' (got ${JSON.stringify(input.reason)})`, 'invalid-params');
	}
	if (input.fromAgent !== undefined && !isAgentId(input.fromAgent)) {
		throw new OrchestrationError(`delegateStep fromAgent must be an agent id (got ${JSON.stringify(input.fromAgent)})`, 'invalid-params');
	}
	if (bus === null || typeof bus.post !== 'function') {
		throw new OrchestrationError('delegateStep requires an a2a bus port ({ post({message}) })', 'invalid-params');
	}
	const graph = store.requireGraph(input.graphId);
	store.requireStep(graph, input.stepId);
	const decision = await store.routeDecide({
		graphId: input.graphId,
		stepId: input.stepId,
		targetAgent: input.targetAgent,
		reason: input.reason,
		details: input.details,
		actor: input.actor ?? 'agent',
		origin: input.origin ?? 'runtime:route',
	});
	const start = await store.startStep({
		graphId: input.graphId,
		stepId: input.stepId,
		runnerId: input.targetAgent,
		actor: input.actor ?? 'agent',
		origin: input.origin ?? 'runtime:route',
	});
	const payload = buildTaskDelegation(store, { graphId: input.graphId, stepId: input.stepId });
	if (input.workflowId !== undefined) {
		payload.workflowId = input.workflowId;
	}
	const posted = await bus.post({
		message: {
			kind: 'task-delegation',
			from: input.fromAgent ?? 'flauz.agent',
			to: input.targetAgent,
			payload,
		},
	});
	const receipt = await store.delegationSent({
		graphId: input.graphId,
		stepId: input.stepId,
		decisionRowId: decision.rowId,
		messageId: posted.id,
		actor: input.actor ?? 'service',
		origin: input.origin ?? 'runtime:route',
	});
	return { decisionRowId: decision.rowId, messageId: posted.id, attempt: start.attempt, idempotencyKey: start.idempotencyKey, receiptRowId: receipt.rowId, message: posted.message };
}

/**
 * Ingest a worker's a2a result-report for a delegated step: the
 * result-received receipt (provenance origin 'a2a:<agentId>') plus the
 * mapped step transition. outcome 'ok' -> step-succeeded; 'failed' ->
 * step-failed (failureClass unknown-default, policy decides the retry);
 * 'cancelled' -> receipt only (cancel propagation owns step rows).
 *
 * @param input {graphId, stepId, messageId, outcome: 'ok'|'failed'|'cancelled', summary, evidenceIds?, fromAgent}
 */
export async function ingestResultReport(store, input) {
	if (!['ok', 'failed', 'cancelled'].includes(input.outcome)) {
		throw new OrchestrationError(`ingestResultReport outcome must be 'ok' | 'failed' | 'cancelled' (got ${JSON.stringify(input.outcome)})`, 'invalid-params');
	}
	const origin = `a2a:${input.fromAgent ?? 'unknown'}`;
	const receipt = await store.receiveResult({
		graphId: input.graphId,
		stepId: input.stepId,
		messageId: input.messageId,
		outcome: input.outcome,
		summary: input.summary,
		evidenceIds: input.evidenceIds ?? [],
		actor: 'agent',
		origin,
	});
	return { receiptRowId: receipt.rowId, origin };
}

/**
 * Build the steering-relay payload for a delegated step (mid-run steering;
 * the C-24 surface analog). Delivery scheduling stays with the mediator.
 */
export function buildSteeringRelay(store, input) {
	const graph = store.requireGraph(input.graphId);
	store.requireStep(graph, input.stepId);
	if (typeof input.message !== 'string' || input.message.length === 0) {
		throw new OrchestrationError('buildSteeringRelay requires a non-empty message', 'invalid-params');
	}
	if (graph.taskId === null) {
		throw new OrchestrationError(`steering requires a graph linked to a T-task (graph ${input.graphId} has taskId null)`, 'invalid-params');
	}
	return { taskId: graph.taskId, message: input.message };
}

/**
 * Mirror a graph-level claim or lease onto the bus as a Claim+Lease notice
 * (the resource-claim message; a claim IS a lease on the bus, so acquire
 * carries leaseUntil - the NOTICE horizon, not the graph-level claim
 * expiry; graph claims have none, documented v0).
 *
 * @param input {action: 'acquire'|'release'|'expire', resource, holder, leaseUntil?: number|null, fromAgent?, toAgent?}
 */
export async function mirrorResourceClaim(bus, input) {
	if (bus === null || typeof bus.post !== 'function') {
		throw new OrchestrationError('mirrorResourceClaim requires an a2a bus port', 'invalid-params');
	}
	if (!['acquire', 'release', 'expire'].includes(input.action)) {
		throw new OrchestrationError(`mirrorResourceClaim action must be acquire | release | expire (got ${JSON.stringify(input.action)})`, 'invalid-params');
	}
	if (typeof input.resource !== 'string' || input.resource.length === 0) {
		throw new OrchestrationError('mirrorResourceClaim requires a non-empty resource id', 'invalid-params');
	}
	if (!isAgentId(input.holder)) {
		throw new OrchestrationError(`mirrorResourceClaim holder must be an agent id (got ${JSON.stringify(input.holder)})`, 'invalid-params');
	}
	let leaseUntil = input.leaseUntil ?? null;
	if (input.action === 'acquire' && leaseUntil === null) {
		leaseUntil = Date.now() + CLAIM_NOTICE_TTL_MS;
	}
	const posted = await bus.post({
		message: {
			kind: 'resource-claim',
			from: input.fromAgent ?? input.holder,
			to: input.toAgent ?? 'flauz.watchers',
			payload: { action: input.action, resource: input.resource, leaseUntil },
		},
	});
	return { messageId: posted.id, leaseUntil };
}

/** The bus resource id of a graph step (the shared-resource identity for notices). */
export function stepResourceId(graphId, stepId) {
	return `flauz-orch/${graphId}/${stepId}`;
}
