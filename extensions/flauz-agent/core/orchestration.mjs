/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Flauz durable orchestration core (TL2-001, M1) - pure, zero-dependency.
 *
 * The durable task-graph state machine and its persistence formats. This
 * module is the orchestration sibling of core/contracts.mjs: pure logic
 * shared by the core service (G side), core/recovery.mjs, core/runtime.mjs
 * and the node --test suites. Extension source imports TYPES only from the
 * sibling orchestration.d.mts (the contracts.d.mts discipline); the .mjs is
 * imported at runtime only by Node.
 *
 * Persistence (DL-9/DL-20 house style, sibling-envelope discipline - the
 * flauz.tasks/v0 envelope is NEVER reinterpreted in place):
 *
 *   .flauz/orchestration/graphs.json   envelope 'flauz.orch.graphs/v1':
 *                                     { $schema, graphs: [graph records] }.
 *                                     Graph records are DEFINITIONS ONLY
 *                                     (task -> steps -> tool invocations ->
 *                                     expected evidence); logical state is
 *                                     always a REPLAY PROJECTION of the
 *                                     journal, never persisted.
 *   .flauz/orchestration/journal.jsonl rows 'flauz.orch.journal/v1':
 *                                     append-only, one canonical JSON object
 *                                     per line, hash-chained (each row's prev
 *                                     carries the previous row's hash; seq 1
 *                                     has prev null). Exactly 14 fields per
 *                                     row, provenance on every row:
 *                                     actor (human|agent|tool|service),
 *                                     origin (where it came from), and
 *                                     contentHash (sha256 of the canonical
 *                                     payload - the content-hash linkage).
 *
 * Version discipline (binding): loading is STRICT v1 - a bad $schema,
 * unknown keys or malformed records fail loudly and are never silently
 * rewritten; a future v2 is a NEW sibling artifact, never an in-place
 * reinterpretation.
 *
 * TL2-004 closure (M5): approval requests, takeover records and lease/
 * claim/conflict notices are FIRST-CLASS transitions with EVIDENCE ROWS -
 * each op mints one flauz.tasks/v0 ledger row (kind 'note', uri
 * flauz-orch-transition://<rowId>, sha256 over the canonical transition
 * facts) and embeds the minted evidenceId in the journal payload. The
 * approval lifecycle is complete: approval-requested -> approval-granted |
 * approval-denied | approval-expired; expiry is SERVICE-ONLY and
 * fail-closed (a cancelled step, never an auto-grant), and only a request
 * that carries expiresAt can expire. Lease conflicts join the claim
 * conflicts as informational notices (v0 enforcement at the extension
 * layer, the routing-module posture).
 *
 * Transition discipline (the 9-transition seam posture, lifted to graphs):
 * every row that changes state must satisfy the STEP_TRANSITIONS or
 * GRAPH_TRANSITIONS table - legal source status first, actor gate second -
 * and every other row class is an observational/coordination record that
 * changes no state. Illegal transitions throw with the allowed source
 * statuses listed, exactly like contracts.mjs applyTransition.
 *
 * Idempotency (the <surface>/<id>/run/<attempt> house pattern): every
 * side-effecting step attempt carries idempotencyKey
 * 'flauz-orch/<graphId>/<stepId>/run/<attempt>'. After a crash, a step whose
 * step-started row exists without a completion row is INTERRUPTED - it is
 * re-driven with the SAME attempt (same key), so a completed-but-unrecorded
 * side effect replays as a no-op at the effect sink instead of executing
 * twice. See core/recovery.mjs and core/runtime.mjs.
 */

import { createHash } from 'node:crypto';
import { canonicalJson } from './contracts.mjs';
import { validateRetryPolicy, CANCEL_CAUSES } from './policy.mjs';

export const ORCH_GRAPHS_SCHEMA = 'flauz.orch.graphs/v1';
export const ORCH_JOURNAL_ROW_SCHEMA = 'flauz.orch.journal/v1';
export const ORCH_DIR = '.flauz/orchestration';
export const ORCH_GRAPHS_PATH = '.flauz/orchestration/graphs.json';
export const ORCH_JOURNAL_PATH = '.flauz/orchestration/journal.jsonl';

/** Journal row actors. The v0 task seam uses agent|human|tool; the durable
 * graph adds 'service' because the orchestration service itself is an actor
 * (recovery, propagation, lease expiry). */
export const ORCH_ACTORS = ['human', 'agent', 'tool', 'service'];

export const STEP_STATUSES = [
        'blocked',
        'ready',
        'awaiting-approval',
        'running',
        'succeeded',
        'failed',
        'cancelled',
        'takeover-pending',
        'taken-over',
];

export const TERMINAL_STEP_STATUSES = ['succeeded', 'cancelled'];

export const GRAPH_STATUSES = ['planning', 'submitted', 'approved', 'completed', 'failed', 'cancelled'];

export const STEP_GATES = ['none', 'human-approval'];

export const ROUTING_REASONS = ['capability-match', 'load-balance', 'operator-choice'];

export const CONFLICT_VIOLATIONS = ['claim', 'lease'];

/**
 * The bounded provider-retry window outcomes (TL2-F2, the INV-2 contract):
 *   - 'retryable-failed'  the provider attempt failed with a DL-35 retryable
 *                         typed error and the window still has budget; the
 *                         next attempt ordinal is named in the payload.
 *   - 'exhausted'         the window's final retryable failure (attemptOrdinal
 *                         === maxAttempts): the step now fails terminally
 *                         (fail-closed - never a silent success, never an
 *                         auto-pass).
 *   - 'recovered'         a later attempt of an engaged window SUCCEEDED
 *                         (after at least one recorded retryable failure); the
 *                         code/retryClass fields name the failure the window
 *                         recovered FROM.
 */
export const PROVIDER_RETRY_OUTCOMES = ['retryable-failed', 'exhausted', 'recovered'];

/**
 * The DL-35 retryable retry classes (the retry executor's trigger set; the
 * fourth class 'none' is terminal-by-contract and never opens a window).
 */
export const PROVIDER_RETRY_CLASSES = ['immediate', 'short-backoff', 'long-backoff'];

const GRAPH_ID_PATTERN = /^G-\d{3,}$/;
const STEP_ID_PATTERN = /^S-\d{2,}$/;
const ROW_ID_PATTERN = /^R-\d{6,}$/;
const CLAIM_ID_PATTERN = /^C-\d{3,}-\d{2,}$/;
const LEASE_ID_PATTERN = /^L-\d{3,}-\d{2,}-\d{1,}$/;
const AGENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const EVIDENCE_ID_PATTERN = /^E-\d{6,}$/;
const A2A_MESSAGE_ID_PATTERN = /^M-\d{6,}$/;

/** Journal row ids follow the E-NNNNNN/M-NNNNNN discipline (DL-21 clause 4). */
export function rowIdOf(seq) {
        return `R-${String(seq).padStart(6, '0')}`;
}

export function isGraphId(value) {
        return typeof value === 'string' && GRAPH_ID_PATTERN.test(value);
}

export function isStepId(value) {
        return typeof value === 'string' && STEP_ID_PATTERN.test(value);
}

export function isRowId(value) {
        return typeof value === 'string' && ROW_ID_PATTERN.test(value);
}

export function isClaimId(value) {
        return typeof value === 'string' && CLAIM_ID_PATTERN.test(value);
}

export function isLeaseId(value) {
        return typeof value === 'string' && LEASE_ID_PATTERN.test(value);
}

export function isAgentId(value) {
        return typeof value === 'string' && AGENT_ID_PATTERN.test(value);
}

/**
 * The idempotency key of a step attempt - the <surface>/<id>/run/<attempt>
 * house pattern. Pure derivation so the runtime, the recovery pass and the
 * effect sink all compute the identical key.
 */
export function idempotencyKeyOf(graphId, stepId, attempt) {
        return `flauz-orch/${graphId}/${stepId}/run/${attempt}`;
}

/** Deterministic claim id (exclusive per step; re-acquire after release reuses it). */
export function claimIdOf(graphId, stepId) {
        return `C-${graphId.slice(2)}-${stepId.slice(2)}`;
}

/** Deterministic lease id (unique per acquisition: the trailing counter is the step's acquisition ordinal). */
export function leaseIdOf(graphId, stepId, ordinal) {
        return `L-${graphId.slice(2)}-${stepId.slice(2)}-${ordinal}`;
}

export class OrchestrationError extends Error {
        constructor(message, code) {
                super(message);
                this.name = 'OrchestrationError';
                this.code = code;
        }
}

function isPlainObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, required, optional = []) {
        const keys = Object.keys(value);
        if (keys.length < required.length || keys.length > required.length + optional.length) {
                return false;
        }
        for (const key of required) {
                if (!Object.prototype.hasOwnProperty.call(value, key)) {
                        return false;
                }
        }
        for (const key of keys) {
                if (!required.includes(key) && !optional.includes(key)) {
                        return false;
                }
        }
        return true;
}

function isPositiveInteger(value) {
        return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value) {
        return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isNonEmptyString(value) {
        return typeof value === 'string' && value.length > 0;
}

// ---------------------------------------------------------------------------
// Graph-spec validation (the .flauz/orchestration/graphs.json records)
// ---------------------------------------------------------------------------

/**
 * Validate one step spec. Exact keys:
 *   { stepId, title, instruction, tool?, toolInput?, gate?, dependsOn?,
 *     retryPolicy?, routing? }
 * - tool: the tool PORT name (never a vendor SDK - no model-vendor coupling);
 * - gate: 'none' | 'human-approval' (a gated step records approval-requested
 *   when it becomes eligible and NEVER runs before a human approval-granted);
 * - routing: { allowedAgents?, requiredCapability? } - routing HINTS, the
 *   routing decision record is journaled separately at route time.
 *
 * @returns {{ ok: true, step: object } | { ok: false, error: string }}
 */
export function validateStepSpec(value) {
        if (!isPlainObject(value)) {
                return { ok: false, error: 'step spec must be a JSON object' };
        }
        if (!hasExactKeys(value, ['stepId', 'title', 'instruction'], ['tool', 'toolInput', 'gate', 'dependsOn', 'retryPolicy', 'routing'])) {
                return { ok: false, error: `step spec must have exactly the keys [dependsOn?, gate?, instruction, retryPolicy?, routing?, stepId, title, tool?, toolInput?] (step ${JSON.stringify(value.stepId)})` };
        }
        if (!isStepId(value.stepId)) {
                return { ok: false, error: `step spec stepId must match /^S-\\d{2,}$/ (got ${JSON.stringify(value.stepId)})` };
        }
        if (!isNonEmptyString(value.title)) {
                return { ok: false, error: `step ${value.stepId}: title must be a non-empty string` };
        }
        if (!isNonEmptyString(value.instruction)) {
                return { ok: false, error: `step ${value.stepId}: instruction must be a non-empty string` };
        }
        if (value.tool !== undefined && value.tool !== null && !isNonEmptyString(value.tool)) {
                return { ok: false, error: `step ${value.stepId}: tool must be a non-empty string (a tool port name) or null` };
        }
        if (value.toolInput !== undefined && value.toolInput !== null && !isPlainObject(value.toolInput)) {
                return { ok: false, error: `step ${value.stepId}: toolInput must be a JSON object or null` };
        }
        if (value.gate !== undefined && !STEP_GATES.includes(value.gate)) {
                return { ok: false, error: `step ${value.stepId}: gate must be one of ${STEP_GATES.join(' | ')} (got ${JSON.stringify(value.gate)})` };
        }
        if (value.dependsOn !== undefined) {
                if (!Array.isArray(value.dependsOn) || !value.dependsOn.every((dep) => isStepId(dep))) {
                        return { ok: false, error: `step ${value.stepId}: dependsOn must be an array of step ids` };
                }
                if (value.dependsOn.includes(value.stepId)) {
                        return { ok: false, error: `step ${value.stepId}: dependsOn must not include itself (a DAG has no self-loops)` };
                }
        }
        if (value.retryPolicy !== undefined && value.retryPolicy !== null) {
                const verdict = validateRetryPolicy(value.retryPolicy);
                if (!verdict.ok) {
                        return { ok: false, error: `step ${value.stepId}: ${verdict.error}` };
                }
        }
        if (value.routing !== undefined && value.routing !== null) {
                const routing = value.routing;
                if (!isPlainObject(routing) || !hasExactKeys(routing, [], ['allowedAgents', 'requiredCapability'])) {
                        return { ok: false, error: `step ${value.stepId}: routing must have only the keys [allowedAgents?, requiredCapability?]` };
                }
                if (routing.allowedAgents !== undefined && (!Array.isArray(routing.allowedAgents) || routing.allowedAgents.length === 0 || !routing.allowedAgents.every((id) => isAgentId(id)))) {
                        return { ok: false, error: `step ${value.stepId}: routing.allowedAgents must be a non-empty array of agent ids` };
                }
                if (routing.requiredCapability !== undefined && !isNonEmptyString(routing.requiredCapability)) {
                        return { ok: false, error: `step ${value.stepId}: routing.requiredCapability must be a non-empty string` };
                }
        }
        return { ok: true, step: value };
}

/**
 * Validate one graph record (definition). Exact keys:
 *   { graphId, taskId, title, policy, steps, createdAt, updatedAt }
 * policy (all optional, exact keys): { onStepFailure?, defaultRetryPolicy? }
 * - onStepFailure: 'fail-graph' | 'continue' | 'manual' (default 'manual').
 */
export function validateGraphRecord(value) {
        if (!isPlainObject(value)) {
                return { ok: false, error: 'graph record must be a JSON object' };
        }
        if (!hasExactKeys(value, ['graphId', 'taskId', 'title', 'policy', 'steps', 'createdAt', 'updatedAt'])) {
                return { ok: false, error: `graph record must have exactly the keys [createdAt, graphId, policy, steps, taskId, title, updatedAt]` };
        }
        if (!isGraphId(value.graphId)) {
                return { ok: false, error: `graphId must match /^G-\\d{3,}$/ (got ${JSON.stringify(value.graphId)})` };
        }
        if (value.taskId !== null && !/^T-\d{3,}$/.test(value.taskId)) {
                return { ok: false, error: `graph ${value.graphId}: taskId must match /^T-\\d{3,}$/ or be null` };
        }
        if (!isNonEmptyString(value.title)) {
                return { ok: false, error: `graph ${value.graphId}: title must be a non-empty string` };
        }
        if (!isPlainObject(value.policy) || !hasExactKeys(value.policy, [], ['onStepFailure', 'defaultRetryPolicy'])) {
                return { ok: false, error: `graph ${value.graphId}: policy must have only the keys [onStepFailure?, defaultRetryPolicy?]` };
        }
        if (value.policy.onStepFailure !== undefined && !['fail-graph', 'continue', 'manual'].includes(value.policy.onStepFailure)) {
                return { ok: false, error: `graph ${value.graphId}: policy.onStepFailure must be 'fail-graph' | 'continue' | 'manual'` };
        }
        if (value.policy.defaultRetryPolicy !== undefined && value.policy.defaultRetryPolicy !== null) {
                const verdict = validateRetryPolicy(value.policy.defaultRetryPolicy);
                if (!verdict.ok) {
                        return { ok: false, error: `graph ${value.graphId}: ${verdict.error}` };
                }
        }
        if (!Array.isArray(value.steps) || value.steps.length === 0) {
                return { ok: false, error: `graph ${value.graphId}: steps must be a non-empty array` };
        }
        const seen = new Set();
        for (const step of value.steps) {
                const verdict = validateStepSpec(step);
                if (!verdict.ok) {
                        return { ok: false, error: `graph ${value.graphId}: ${verdict.error}` };
                }
                if (seen.has(step.stepId)) {
                        return { ok: false, error: `graph ${value.graphId}: duplicate stepId ${step.stepId}` };
                }
                seen.add(step.stepId);
        }
        for (const step of value.steps) {
                for (const dep of step.dependsOn ?? []) {
                        if (!seen.has(dep)) {
                                return { ok: false, error: `graph ${value.graphId}: step ${step.stepId} depends on unknown step ${dep}` };
                        }
                }
        }
        const cycle = findCycle(value.steps);
        if (cycle !== null) {
                return { ok: false, error: `graph ${value.graphId}: dependency cycle detected (${cycle.join(' -> ')})` };
        }
        if (!isPositiveInteger(value.createdAt) || !isPositiveInteger(value.updatedAt)) {
                return { ok: false, error: `graph ${value.graphId}: createdAt/updatedAt must be epoch-ms positive integers` };
        }
        return { ok: true, graph: value };
}

function findCycle(steps) {
        const byId = new Map(steps.map((step) => [step.stepId, step]));
        const state = new Map();
        const stack = [];
        function visit(stepId) {
                const phase = state.get(stepId);
                if (phase === 1) {
                        const at = stack.indexOf(stepId);
                        return [...stack.slice(at), stepId];
                }
                if (phase === 2) {
                        return null;
                }
                state.set(stepId, 1);
                stack.push(stepId);
                for (const dep of byId.get(stepId).dependsOn ?? []) {
                        const found = visit(dep);
                        if (found !== null) {
                                return found;
                        }
                }
                stack.pop();
                state.set(stepId, 2);
                return null;
        }
        for (const step of steps) {
                const found = visit(step.stepId);
                if (found !== null) {
                        return found;
                }
        }
        return null;
}

// ---------------------------------------------------------------------------
// Journal row validation (strict: exactly 14 fields, payload by type)
// ---------------------------------------------------------------------------

export const JOURNAL_ROW_FIELDS = [
        '$schema', 'seq', 'rowId', 'ts', 'graphId', 'stepId', 'type', 'actor',
        'origin', 'attempt', 'idempotencyKey', 'payload', 'contentHash', 'prev',
];

/**
 * Row hash: sha256 over the canonical JSON of the row MINUS its prev field
 * (the ledger discipline - the hash is recomputed, never stored; the NEXT
 * row's prev carries it).
 */
export function rowHashOf(row) {
        const projected = {};
        for (const field of JOURNAL_ROW_FIELDS) {
                if (field !== 'prev') {
                        projected[field] = row[field];
                }
        }
        return createHash('sha256').update(canonicalJson(projected), 'utf8').digest('hex');
}

/** contentHash: sha256 over the canonical JSON of the payload. */
export function contentHashOf(payload) {
        return createHash('sha256').update(canonicalJson(payload), 'utf8').digest('hex');
}

/** The exact journal line bytes of a row (canonical JSON, sorted keys). */
export function journalLine(row) {
        return canonicalJson(row);
}

function validateEvidenceItem(item, label) {
        if (!isPlainObject(item) || !hasExactKeys(item, ['evidenceId', 'kind', 'uri', 'sha256'])) {
                return `${label}: evidence items must have exactly the keys [evidenceId, kind, sha256, uri] (evidenceId may be null before ledger minting)`;
        }
        if (item.evidenceId !== null && !EVIDENCE_ID_PATTERN.test(item.evidenceId)) {
                return `${label}: evidence item evidenceId must match /^E-\\d{6,}$/ or be null`;
        }
        if (!['changeset', 'screenshot', 'command-output', 'note', 'checkpoint'].includes(item.kind)) {
                return `${label}: evidence item kind must be a flauz.tasks/v0 evidence kind`;
        }
        if (!isNonEmptyString(item.uri)) {
                return `${label}: evidence item uri must be a non-empty string`;
        }
        if (!SHA256_HEX.test(item.sha256)) {
                return `${label}: evidence item sha256 must be 64 lowercase hex chars`;
        }
        return undefined;
}

/**
 * Per-type payload validation. Every event class has an EXACT payload shape
 * (the a2a discipline: every rule is violated by exactly one bad fixture in
 * the test matrix).
 */
export function validateJournalPayload(type, payload) {
        if (!isPlainObject(payload)) {
                return `journal ${type} payload must be a JSON object`;
        }
        const label = `journal ${type}`;
        if (type === 'graph-submitted') {
                if (!hasExactKeys(payload, ['title', 'stepCount', 'taskId'])) {
                        return `${label} payload must have exactly the keys [stepCount, taskId, title]`;
                }
                if (!isNonEmptyString(payload.title) || !isPositiveInteger(payload.stepCount)) {
                        return `${label} payload title must be a non-empty string and stepCount a positive integer`;
                }
                if (payload.taskId !== null && !/^T-\d{3,}$/.test(payload.taskId)) {
                        return `${label} payload taskId must match /^T-\\d{3,}$/ or be null`;
                }
                return undefined;
        }
        if (type === 'graph-approved' || type === 'graph-rejected') {
                if (!hasExactKeys(payload, [], ['note'])) {
                        return `${label} payload must have only the optional key [note]`;
                }
                return undefined;
        }
        if (type === 'graph-cancelled') {
                if (!hasExactKeys(payload, [], ['reason'])) {
                        return `${label} payload must have only the optional key [reason]`;
                }
                return undefined;
        }
        if (type === 'graph-completed') {
                if (!hasExactKeys(payload, ['succeededCount'])) {
                        return `${label} payload must have exactly the key [succeededCount]`;
                }
                if (!isPositiveInteger(payload.succeededCount)) {
                        return `${label} payload succeededCount must be a positive integer`;
                }
                return undefined;
        }
        if (type === 'graph-failed') {
                if (!hasExactKeys(payload, ['failedStepId'])) {
                        return `${label} payload must have exactly the key [failedStepId]`;
                }
                if (!isStepId(payload.failedStepId)) {
                        return `${label} payload failedStepId must be a step id`;
                }
                return undefined;
        }
        if (type === 'step-started') {
                if (!hasExactKeys(payload, ['runnerId'], ['note'])) {
                        return `${label} payload must have exactly the keys [note?, runnerId]`;
                }
                if (!isNonEmptyString(payload.runnerId)) {
                        return `${label} payload runnerId must be a non-empty string`;
                }
                return undefined;
        }
        if (type === 'step-succeeded' || type === 'takeover-completed') {
                if (!hasExactKeys(payload, ['evidence'], ['evidenceId', 'output'])) {
                        return `${label} payload must have exactly the keys [evidence, output?]`;
                }
                if (!Array.isArray(payload.evidence)) {
                        return `${label} payload evidence must be an array`;
                }
                for (const item of payload.evidence) {
                        const error = validateEvidenceItem(item, label);
                        if (error !== undefined) {
                                return error;
                        }
                }
                if (payload.output !== undefined && typeof payload.output !== 'string') {
                        return `${label} payload output must be a string when present`;
                }
                return undefined;
        }
        if (type === 'step-failed') {
                if (!hasExactKeys(payload, ['failureClass', 'message', 'retryPlanned'])) {
                        return `${label} payload must have exactly the keys [failureClass, message, retryPlanned]`;
                }
                if (typeof payload.failureClass !== 'string' || payload.failureClass.length === 0) {
                        return `${label} payload failureClass must be a non-empty string`;
                }
                if (typeof payload.message !== 'string') {
                        return `${label} payload message must be a string`;
                }
                if (typeof payload.retryPlanned !== 'boolean') {
                        return `${label} payload retryPlanned must be a boolean`;
                }
                return undefined;
        }
        if (type === 'step-retry-scheduled') {
                if (!hasExactKeys(payload, ['nextAttempt', 'nextAttemptAt'])) {
                        return `${label} payload must have exactly the keys [nextAttempt, nextAttemptAt]`;
                }
                if (!isPositiveInteger(payload.nextAttempt) || !isPositiveInteger(payload.nextAttemptAt)) {
                        return `${label} payload nextAttempt/nextAttemptAt must be positive integers`;
                }
                return undefined;
        }
        if (type === 'step-cancelled') {
                if (!hasExactKeys(payload, ['cause'], ['note'])) {
                        return `${label} payload must have exactly the keys [cause, note?]`;
                }
                if (!CANCEL_CAUSES.includes(payload.cause)) {
                        return `${label} payload cause must be one of ${CANCEL_CAUSES.join(' | ')} (got ${JSON.stringify(payload.cause)})`;
                }
                return undefined;
        }
        if (type === 'approval-requested') {
                if (!hasExactKeys(payload, ['reason'], ['evidenceId', 'expiresAt'])) {
                        return `${label} payload must have exactly the keys [evidenceId?, expiresAt?, reason]`;
                }
                if (!isNonEmptyString(payload.reason)) {
                        return `${label} payload reason must be a non-empty string`;
                }
                if (payload.expiresAt !== undefined && !isPositiveInteger(payload.expiresAt)) {
                        return `${label} payload expiresAt must be a positive integer (epoch ms; only a request that carries a deadline can expire)`;
                }
                if (payload.evidenceId !== undefined && !EVIDENCE_ID_PATTERN.test(payload.evidenceId)) {
                        return `${label} payload evidenceId must match /^E-\\d{6,}$/ (the minted ledger row of this transition)`;
                }
                return undefined;
        }
        if (type === 'approval-expired') {
                if (!hasExactKeys(payload, ['expiredAt'], ['evidenceId', 'note'])) {
                        return `${label} payload must have exactly the keys [evidenceId?, expiredAt, note?]`;
                }
                if (!isPositiveInteger(payload.expiredAt)) {
                        return `${label} payload expiredAt must be a positive integer (epoch ms - the observed expiry, never before the request deadline)`;
                }
                if (payload.evidenceId !== undefined && !EVIDENCE_ID_PATTERN.test(payload.evidenceId)) {
                        return `${label} payload evidenceId must match /^E-\\d{6,}$/`;
                }
                return undefined;
        }
        if (type === 'approval-granted' || type === 'approval-denied') {
                if (!hasExactKeys(payload, [], ['evidenceId', 'note'])) {
                        return `${label} payload must have only the optional keys [evidenceId?, note?]`;
                }
                if (payload.evidenceId !== undefined && !EVIDENCE_ID_PATTERN.test(payload.evidenceId)) {
                        return `${label} payload evidenceId must match /^E-\\d{6,}$/ (the minted ledger row of this decision)`;
                }
                return undefined;
        }
        if (type === 'takeover-requested') {
                if (!hasExactKeys(payload, [], ['evidenceId', 'reason'])) {
                        return `${label} payload must have only the optional keys [evidenceId?, reason?]`;
                }
                if (payload.evidenceId !== undefined && !EVIDENCE_ID_PATTERN.test(payload.evidenceId)) {
                        return `${label} payload evidenceId must match /^E-\\d{6,}$/ (the minted ledger row of this request)`;
                }
                return undefined;
        }
        if (type === 'takeover-accepted') {
                if (!hasExactKeys(payload, [], ['evidenceId', 'note'])) {
                        return `${label} payload must have only the optional keys [evidenceId?, note?]`;
                }
                if (payload.evidenceId !== undefined && !EVIDENCE_ID_PATTERN.test(payload.evidenceId)) {
                        return `${label} payload evidenceId must match /^E-\\d{6,}$/ (the minted ledger row of this acceptance)`;
                }
                return undefined;
        }
        if (type === 'claim-acquired' || type === 'claim-released') {
                if (!hasExactKeys(payload, ['claimId', 'holder'], ['evidenceId'])) {
                        return `${label} payload must have exactly the keys [claimId, evidenceId?, holder]`;
                }
                if (!isClaimId(payload.claimId)) {
                        return `${label} payload claimId must match /^C-\\d{3,}-\\d{2,}$/`;
                }
                if (!isAgentId(payload.holder)) {
                        return `${label} payload holder must be an agent id`;
                }
                if (payload.evidenceId !== undefined && !EVIDENCE_ID_PATTERN.test(payload.evidenceId)) {
                        return `${label} payload evidenceId must match /^E-\\d{6,}$/ (the minted ledger row of this notice)`;
                }
                return undefined;
        }
        if (type === 'lease-acquired' || type === 'lease-renewed') {
                if (!hasExactKeys(payload, ['leaseId', 'holder', 'expiresAt'], ['evidenceId'])) {
                        return `${label} payload must have exactly the keys [evidenceId?, expiresAt, holder, leaseId]`;
                }
                if (!isLeaseId(payload.leaseId)) {
                        return `${label} payload leaseId must match /^L-\\d{3,}-\\d{2,}-\\d{1,}$/`;
                }
                if (!isAgentId(payload.holder)) {
                        return `${label} payload holder must be an agent id`;
                }
                if (!isPositiveInteger(payload.expiresAt)) {
                        return `${label} payload expiresAt must be a positive integer (epoch ms)`;
                }
                if (payload.evidenceId !== undefined && !EVIDENCE_ID_PATTERN.test(payload.evidenceId)) {
                        return `${label} payload evidenceId must match /^E-\\d{6,}$/ (the minted ledger row of this notice)`;
                }
                return undefined;
        }
        if (type === 'lease-released') {
                if (!hasExactKeys(payload, ['leaseId', 'holder'], ['evidenceId'])) {
                        return `${label} payload must have exactly the keys [evidenceId?, holder, leaseId]`;
                }
                if (!isLeaseId(payload.leaseId) || !isAgentId(payload.holder)) {
                        return `${label} payload leaseId/holder shapes are invalid`;
                }
                if (payload.evidenceId !== undefined && !EVIDENCE_ID_PATTERN.test(payload.evidenceId)) {
                        return `${label} payload evidenceId must match /^E-\\d{6,}$/ (the minted ledger row of this notice)`;
                }
                return undefined;
        }
        if (type === 'lease-expired') {
                if (!hasExactKeys(payload, ['leaseId', 'holder', 'expiredAt'], ['evidenceId'])) {
                        return `${label} payload must have exactly the keys [evidenceId?, expiredAt, holder, leaseId]`;
                }
                if (!isLeaseId(payload.leaseId) || !isAgentId(payload.holder) || !isPositiveInteger(payload.expiredAt)) {
                        return `${label} payload leaseId/holder/expiredAt shapes are invalid`;
                }
                if (payload.evidenceId !== undefined && !EVIDENCE_ID_PATTERN.test(payload.evidenceId)) {
                        return `${label} payload evidenceId must match /^E-\\d{6,}$/ (the minted ledger row of this notice)`;
                }
                return undefined;
        }
        if (type === 'conflict-noticed') {
                if (!hasExactKeys(payload, ['violation', 'expectedHolder', 'actualRunner'], ['evidenceId', 'note'])) {
                        return `${label} payload must have exactly the keys [actualRunner, evidenceId?, expectedHolder, note?, violation]`;
                }
                if (payload.evidenceId !== undefined && !EVIDENCE_ID_PATTERN.test(payload.evidenceId)) {
                        return `${label} payload evidenceId must match /^E-\\d{6,}$/ (the minted ledger row of this notice)`;
                }
                if (!CONFLICT_VIOLATIONS.includes(payload.violation)) {
                        return `${label} payload violation must be one of ${CONFLICT_VIOLATIONS.join(' | ')}`;
                }
                if (!isNonEmptyString(payload.expectedHolder) || !isNonEmptyString(payload.actualRunner)) {
                        return `${label} payload expectedHolder/actualRunner must be non-empty strings`;
                }
                return undefined;
        }
        if (type === 'provider-retry') {
                if (!hasExactKeys(payload, ['attemptOrdinal', 'code', 'maxAttempts', 'outcome', 'retryClass', 'waitAppliedMs'], ['nextAttemptOrdinal', 'retryAfterMs'])) {
                        return `${label} payload must have exactly the keys [attemptOrdinal, code, maxAttempts, outcome, retryClass, waitAppliedMs] plus optionals [nextAttemptOrdinal?, retryAfterMs?]`;
                }
                if (!PROVIDER_RETRY_OUTCOMES.includes(payload.outcome)) {
                        return `${label} payload outcome must be one of ${PROVIDER_RETRY_OUTCOMES.join(' | ')} (got ${JSON.stringify(payload.outcome)})`;
                }
                if (!isPositiveInteger(payload.attemptOrdinal) || !isPositiveInteger(payload.maxAttempts)) {
                        return `${label} payload attemptOrdinal/maxAttempts must be positive integers`;
                }
                if (payload.attemptOrdinal > payload.maxAttempts) {
                        return `${label} payload attemptOrdinal must be <= maxAttempts (the window bound)`;
                }
                if (!isNonEmptyString(payload.code)) {
                        return `${label} payload code must be a non-empty string (the DL-35 provider error code)`;
                }
                if (!PROVIDER_RETRY_CLASSES.includes(payload.retryClass)) {
                        return `${label} payload retryClass must be one of ${PROVIDER_RETRY_CLASSES.join(' | ')} (a retryable DL-35 class; 'none' is terminal and never opens a window)`;
                }
                if (!isNonNegativeInteger(payload.waitAppliedMs)) {
                        return `${label} payload waitAppliedMs must be a non-negative integer (the wait applied before this attempt)`;
                }
                if (payload.retryAfterMs !== undefined && !isNonNegativeInteger(payload.retryAfterMs)) {
                        return `${label} payload retryAfterMs must be a non-negative integer (the vendor hint, when present)`;
                }
                if (payload.outcome === 'retryable-failed') {
                        if (payload.nextAttemptOrdinal === undefined) {
                                return `${label} payload nextAttemptOrdinal is required when outcome is 'retryable-failed'`;
                        }
                        if (!isPositiveInteger(payload.nextAttemptOrdinal) || payload.nextAttemptOrdinal !== payload.attemptOrdinal + 1) {
                                return `${label} payload nextAttemptOrdinal must be attemptOrdinal + 1 (a strictly ordinal window)`;
                        }
                        if (payload.attemptOrdinal >= payload.maxAttempts) {
                                return `${label} payload outcome 'retryable-failed' requires remaining budget (attemptOrdinal < maxAttempts; the final retryable failure is 'exhausted')`;
                        }
                } else if (payload.nextAttemptOrdinal !== undefined) {
                        return `${label} payload nextAttemptOrdinal is only allowed when outcome is 'retryable-failed' (terminal windows name no next attempt)`;
                }
                if (payload.outcome === 'exhausted' && payload.attemptOrdinal !== payload.maxAttempts) {
                        return `${label} payload outcome 'exhausted' requires attemptOrdinal === maxAttempts (the bound was consumed)`;
                }
                if (payload.outcome === 'recovered' && payload.attemptOrdinal < 2) {
                        return `${label} payload outcome 'recovered' requires attemptOrdinal >= 2 (a recovery follows at least one recorded failure)`;
                }
                return undefined;
        }
        if (type === 'route-decided') {
                if (!hasExactKeys(payload, ['targetAgent', 'reason'], ['details'])) {
                        return `${label} payload must have exactly the keys [details?, reason, targetAgent]`;
                }
                if (!isAgentId(payload.targetAgent)) {
                        return `${label} payload targetAgent must be an agent id`;
                }
                if (!ROUTING_REASONS.includes(payload.reason)) {
                        return `${label} payload reason must be one of ${ROUTING_REASONS.join(' | ')} (got ${JSON.stringify(payload.reason)})`;
                }
                if (payload.details !== undefined && !isPlainObject(payload.details)) {
                        return `${label} payload details must be a JSON object when present`;
                }
                return undefined;
        }
        if (type === 'delegation-sent') {
                if (!hasExactKeys(payload, ['decisionRowId', 'messageId'])) {
                        return `${label} payload must have exactly the keys [decisionRowId, messageId]`;
                }
                if (!isRowId(payload.decisionRowId)) {
                        return `${label} payload decisionRowId must be a row id`;
                }
                if (!A2A_MESSAGE_ID_PATTERN.test(payload.messageId)) {
                        return `${label} payload messageId must match /^M-\\d{6,}$/ (the a2a bus id)`;
                }
                return undefined;
        }
        if (type === 'result-received') {
                if (!hasExactKeys(payload, ['messageId', 'outcome', 'summary', 'evidenceIds'])) {
                        return `${label} payload must have exactly the keys [evidenceIds, messageId, outcome, summary]`;
                }
                if (!A2A_MESSAGE_ID_PATTERN.test(payload.messageId)) {
                        return `${label} payload messageId must match /^M-\\d{6,}$/`;
                }
                if (!['ok', 'failed', 'cancelled'].includes(payload.outcome)) {
                        return `${label} payload outcome must be 'ok' | 'failed' | 'cancelled' (a2a result-report alignment)`;
                }
                if (!isNonEmptyString(payload.summary)) {
                        return `${label} payload summary must be a non-empty string`;
                }
                if (!Array.isArray(payload.evidenceIds) || !payload.evidenceIds.every((id) => EVIDENCE_ID_PATTERN.test(id))) {
                        return `${label} payload evidenceIds must be an array of E-NNNNNN ids`;
                }
                return undefined;
        }
        if (type === 'cancel-requested') {
                if (!hasExactKeys(payload, ['reason'])) {
                        return `${label} payload must have exactly the key [reason]`;
                }
                if (!isNonEmptyString(payload.reason)) {
                        return `${label} payload reason must be a non-empty string`;
                }
                return undefined;
        }
        if (type === 'step-interrupted') {
                if (!hasExactKeys(payload, ['cause'], ['note'])) {
                        return `${label} payload must have exactly the keys [cause, note?]`;
                }
                if (!isNonEmptyString(payload.cause)) {
                        return `${label} payload cause must be a non-empty string (e.g. 'process-exit')`;
                }
                return undefined;
        }
        if (type === 'recovery-scan') {
                if (!hasExactKeys(payload, ['actions', 'clean'])) {
                        return `${label} payload must have exactly the keys [actions, clean]`;
                }
                if (!Array.isArray(payload.actions) || !payload.actions.every((action) => typeof action === 'string' && action.length > 0)) {
                        return `${label} payload actions must be an array of non-empty action strings`;
                }
                if (typeof payload.clean !== 'boolean') {
                        return `${label} payload clean must be a boolean`;
                }
                return undefined;
        }
        return `unknown journal event type '${String(type)}'`;
}

// ---------------------------------------------------------------------------
// Transition tables (the 9-transition-seam discipline, lifted to graphs)
// ---------------------------------------------------------------------------

/**
 * Step-level status transitions. Every status-changing step event must match
 * a rule here: legal source status FIRST, actor gate second (the
 * contracts.mjs applyTransition ordering); everything else is rejected with
 * the allowed source statuses listed.
 *
 * actor gates preserve the human authorization boundary:
 *   - approval-granted / approval-denied / takeover-accepted /
 *     takeover-completed are HUMAN-ONLY (approvals and takeovers are
 *     requests that gate execution - never auto-granted);
 *   - approval-expired is SERVICE-ONLY (a mechanical deadline timeout -
 *     fail-closed: the step is CANCELLED, never auto-granted; only a
 *     request that carries expiresAt can ever expire);
 *   - step-started / step-failed are agent|tool|service (the executors);
 *   - step-cancelled is human|service (propagation).
 */
export const STEP_TRANSITIONS = [
        { type: 'step-started', from: ['ready'], actors: ['agent', 'tool', 'service'], to: 'running' },
        { type: 'step-succeeded', from: ['running'], actors: ['agent', 'tool', 'service'], to: 'succeeded' },
        { type: 'step-failed', from: ['running'], actors: ['agent', 'tool', 'service'], to: 'failed' },
        { type: 'step-retry-scheduled', from: ['failed'], actors: ['agent', 'service'], to: 'ready' },
        { type: 'step-cancelled', from: ['blocked', 'ready', 'awaiting-approval', 'running', 'takeover-pending', 'failed'], actors: ['human', 'service'], to: 'cancelled' },
        { type: 'step-interrupted', from: ['running'], actors: ['service'], to: 'ready' },
        { type: 'approval-requested', from: ['ready'], actors: ['agent', 'service'], to: 'awaiting-approval' },
        { type: 'approval-granted', from: ['awaiting-approval'], actors: ['human'], to: 'ready' },
        { type: 'approval-denied', from: ['awaiting-approval'], actors: ['human'], to: 'cancelled' },
        { type: 'approval-expired', from: ['awaiting-approval'], actors: ['service'], to: 'cancelled' },
        { type: 'takeover-requested', from: ['ready', 'running', 'awaiting-approval'], actors: ['human', 'agent'], to: 'takeover-pending' },
        { type: 'takeover-accepted', from: ['takeover-pending'], actors: ['human'], to: 'taken-over' },
        { type: 'takeover-completed', from: ['taken-over'], actors: ['human'], to: 'succeeded' },
];

/** Graph-level status transitions (graph-approved is HUMAN-ONLY). */
export const GRAPH_TRANSITIONS = [
        { type: 'graph-submitted', from: ['planning'], actors: ['agent', 'human'], to: 'submitted' },
        { type: 'graph-approved', from: ['submitted'], actors: ['human'], to: 'approved' },
        { type: 'graph-rejected', from: ['submitted'], actors: ['human'], to: 'planning' },
        { type: 'graph-cancelled', from: ['planning', 'submitted', 'approved'], actors: ['human', 'service'], to: 'cancelled' },
        { type: 'graph-completed', from: ['approved'], actors: ['agent', 'tool', 'service'], to: 'completed' },
        { type: 'graph-failed', from: ['approved'], actors: ['agent', 'tool', 'service'], to: 'failed' },
];

/** Event types that change STEP status (used by the replay + legality check). */
export const STEP_TRANSITION_TYPES = STEP_TRANSITIONS.map((rule) => rule.type);

/** Event types that change GRAPH status. */
export const GRAPH_TRANSITION_TYPES = GRAPH_TRANSITIONS.map((rule) => rule.type);

/** Every journal event type (transition verbs + observational/coordination records). */
export const JOURNAL_EVENT_TYPES = [
        ...GRAPH_TRANSITION_TYPES,
        ...STEP_TRANSITION_TYPES,
        'claim-acquired',
        'claim-released',
        'lease-acquired',
        'lease-renewed',
        'lease-released',
        'lease-expired',
        'conflict-noticed',
        'provider-retry',
        'route-decided',
        'delegation-sent',
        'result-received',
        'cancel-requested',
        'recovery-scan',
];

/** stepId nullability per event type: graph-level (null), step-level (set), either. */
const EVENT_LEVELS = {
        'graph-submitted': 'graph',
        'graph-approved': 'graph',
        'graph-rejected': 'graph',
        'graph-cancelled': 'graph',
        'graph-completed': 'graph',
        'graph-failed': 'graph',
        'cancel-requested': 'graph',
        'recovery-scan': 'graph',
        'route-decided': 'either',
        'delegation-sent': 'either',
        'result-received': 'step',
        'approval-expired': 'step',
        'claim-acquired': 'step',
        'claim-released': 'step',
        'lease-acquired': 'step',
        'lease-renewed': 'step',
        'lease-released': 'step',
        'lease-expired': 'step',
        'conflict-noticed': 'step',
        'provider-retry': 'step',
};

export function eventLevel(type) {
        if (STEP_TRANSITION_TYPES.includes(type)) {
                return 'step';
        }
        if (GRAPH_TRANSITION_TYPES.includes(type)) {
                return 'graph';
        }
        return EVENT_LEVELS[type] ?? 'step';
}

/**
 * Full structural validation of one journal row (the strict-load path and
 * the append path share it). Checks: exact 14 fields, id/seq consistency,
 * actor/origin/ts/attempt/idempotencyKey shapes, event-type level vs
 * stepId, per-type payload shape, contentHash correctness. Chain linkage
 * (prev) and byte-canonicity are checked by the caller (store/replay).
 *
 * @returns {{ ok: true, row: object } | { ok: false, error: string }}
 */
export function validateJournalRow(row) {
        if (!isPlainObject(row)) {
                return { ok: false, error: 'journal row must be a JSON object' };
        }
        if (!hasExactKeys(row, JOURNAL_ROW_FIELDS)) {
                return { ok: false, error: `journal row must have exactly the ${String(JOURNAL_ROW_FIELDS.length)} keys [${JOURNAL_ROW_FIELDS.slice().sort().join(', ')}]` };
        }
        if (row.$schema !== ORCH_JOURNAL_ROW_SCHEMA) {
                return { ok: false, error: `journal row $schema must be '${ORCH_JOURNAL_ROW_SCHEMA}' (got ${JSON.stringify(row.$schema)})` };
        }
        if (!isPositiveInteger(row.seq) || !isPositiveInteger(row.ts)) {
                return { ok: false, error: `journal row ${String(row.rowId)}: seq/ts must be positive integers` };
        }
        if (row.rowId !== rowIdOf(row.seq)) {
                return { ok: false, error: `journal row id must be '${rowIdOf(row.seq)}' (derived from seq; got ${JSON.stringify(row.rowId)})` };
        }
        if (!isGraphId(row.graphId)) {
                return { ok: false, error: `journal row ${String(row.rowId)}: graphId must match /^G-\\d{3,}$/` };
        }
        if (!JOURNAL_EVENT_TYPES.includes(row.type)) {
                return { ok: false, error: `journal row ${String(row.rowId)}: unknown event type '${String(row.type)}'` };
        }
        if (!ORCH_ACTORS.includes(row.actor)) {
                return { ok: false, error: `journal row ${String(row.rowId)}: actor must be one of ${ORCH_ACTORS.join(' | ')} (got '${String(row.actor)}')` };
        }
        if (!isNonEmptyString(row.origin)) {
                return { ok: false, error: `journal row ${String(row.rowId)}: origin must be a non-empty provenance string` };
        }
        const level = eventLevel(row.type);
        if (level === 'graph' && row.stepId !== null) {
                return { ok: false, error: `journal row ${String(row.rowId)}: ${row.type} is graph-level (stepId must be null)` };
        }
        if (level === 'step' && !isStepId(row.stepId)) {
                return { ok: false, error: `journal row ${String(row.rowId)}: ${row.type} is step-level (stepId must match /^S-\\d{2,}$/)` };
        }
        if (level === 'either' && row.stepId !== null && !isStepId(row.stepId)) {
                return { ok: false, error: `journal row ${String(row.rowId)}: stepId must match /^S-\\d{2,}$/ or be null` };
        }
        if (row.attempt !== null && !isPositiveInteger(row.attempt)) {
                return { ok: false, error: `journal row ${String(row.rowId)}: attempt must be a positive integer or null` };
        }
        if (row.idempotencyKey !== null && typeof row.idempotencyKey !== 'string') {
                return { ok: false, error: `journal row ${String(row.rowId)}: idempotencyKey must be a string or null` };
        }
        const payloadError = validateJournalPayload(row.type, row.payload);
        if (payloadError !== undefined) {
                return { ok: false, error: `journal row ${String(row.rowId)}: ${payloadError}` };
        }
        if (row.contentHash !== contentHashOf(row.payload)) {
                return { ok: false, error: `journal row ${String(row.rowId)}: contentHash does not match the canonical payload (content-hash linkage broken)` };
        }
        if (row.prev !== null && !SHA256_HEX.test(row.prev)) {
                return { ok: false, error: `journal row ${String(row.rowId)}: prev must be 64 lowercase hex chars or null` };
        }
        return { ok: true, row };
}

// ---------------------------------------------------------------------------
// Replay derivation (logical state = projection of the journal)
// ---------------------------------------------------------------------------

function freshStepState(stepId) {
        return {
                stepId,
                status: undefined,
                blockedOn: [],
                attempt: 0,
                lastStartedAttempt: 0,
                retrySameAttempt: null,
                nextAttempt: null,
                retryNotBefore: null,
                runnerId: null,
                failure: null,
                evidence: [],
                approval: null,
                takeover: null,
                startedAt: null,
                updatedAt: null,
                providerRetry: null,
        };
}

function isTerminal(step) {
        return step.status === 'succeeded' || step.status === 'cancelled';
}

/**
 * The effective status of a step: the journal-driven explicit status, or the
 * derived base while no explicit status exists:
 *   - graph not approved yet -> 'blocked' (the human gate at graph level);
 *   - dependencies not all succeeded -> 'blocked';
 *   - otherwise 'ready'.
 */
export function effectiveStepStatus(state, stepId) {
        const step = state.steps[stepId];
        if (step.status !== undefined) {
                return step.status;
        }
        if (state.graphStatus !== 'approved' && state.graphStatus !== 'completed' && state.graphStatus !== 'failed') {
                return 'blocked';
        }
        const spec = state.spec.steps.find((candidate) => candidate.stepId === stepId);
        for (const dep of spec.dependsOn ?? []) {
                if (state.steps[dep].status !== 'succeeded') {
                        return 'blocked';
                }
        }
        return 'ready';
}

/**
 * Replay a graph's journal rows into the logical state. Every row is
 * validated structurally AND against the transition tables as it is applied
 * - a journal containing a transition that could not legally have happened
 * fails loudly (no fabricated transitions, mechanically enforced).
 *
 * @param {object} graph the graph record (definition)
 * @param {object[]} rows the graph's journal rows, seq-ascending
 * @returns {{ ok: true, state: object } | { ok: false, error: string }}
 */
export function deriveGraphState(graph, rows) {
        const state = {
                graphId: graph.graphId,
                graph,
                spec: graph,
                graphStatus: 'planning',
                steps: {},
                claims: {},
                leases: {},
                leasesSeen: {},
                pendingApprovals: [],
                takeover: null,
                cancelRequested: false,
                cancelReason: null,
                routing: {},
                delegations: {},
                interrupted: [],
                completedAt: null,
        };
        for (const step of graph.steps) {
                state.steps[step.stepId] = freshStepState(step.stepId);
        }
        let lastSeq = 0;
        for (const row of rows) {
                const verdict = validateJournalRow(row);
                if (!verdict.ok) {
                        return { ok: false, error: `journal seq ${String(row.seq)}: ${verdict.error}` };
                }
                if (row.seq <= lastSeq) {
                        return { ok: false, error: `journal rows must be seq-ascending (seq ${String(row.seq)} after ${String(lastSeq)})` };
                }
                lastSeq = row.seq;
                const applyError = applyRowToState(state, row);
                if (applyError !== undefined) {
                        return { ok: false, error: `journal seq ${String(row.seq)} (${row.type}): ${applyError}` };
                }
        }
        finalizeState(state);
        return { ok: true, state };
}

/** Apply one validated row to the replay state; returns an error string or undefined. */
function applyRowToState(state, row) {
        const type = row.type;
        if (GRAPH_TRANSITION_TYPES.includes(type)) {
                const rule = GRAPH_TRANSITIONS.find((candidate) => candidate.type === type);
                if (!rule.from.includes(state.graphStatus)) {
                        return `transition ${type} is not allowed from graph status ${state.graphStatus} (allowed source statuses: ${rule.from.join(', ')})`;
                }
                if (!rule.actors.includes(row.actor)) {
                        return `transition ${type} from ${state.graphStatus} requires actor ${rule.actors.join(' | ')}, got '${row.actor}'`;
                }
                if (type === 'graph-completed') {
                        const notSucceeded = Object.values(state.steps).filter((step) => step.status !== 'succeeded');
                        if (notSucceeded.length > 0) {
                                return `graph-completed requires every step succeeded (pending: ${notSucceeded.map((step) => step.stepId).sort().join(', ')}) - fabricated completion is rejected`;
                        }
                }
                if (type === 'graph-failed') {
                        const failed = Object.values(state.steps).filter((step) => step.status === 'failed' || step.status === 'cancelled');
                        if (failed.length === 0) {
                                return 'graph-failed requires at least one failed or cancelled step';
                        }
                        if (!state.steps[row.payload.failedStepId] || !['failed', 'cancelled'].includes(state.steps[row.payload.failedStepId].status)) {
                                return `graph-failed failedStepId ${String(row.payload.failedStepId)} is not a failed step`;
                        }
                }
                state.graphStatus = rule.to;
                if (type === 'graph-completed') {
                        state.completedAt = row.ts;
                }
                return undefined;
        }
        if (STEP_TRANSITION_TYPES.includes(type)) {
                const step = state.steps[row.stepId];
                if (step === undefined) {
                        return `unknown step ${row.stepId}`;
                }
                const current = effectiveStepStatus(state, row.stepId);
                const rule = STEP_TRANSITIONS.find((candidate) => candidate.type === type);
                if (!rule.from.includes(current)) {
                        return `transition ${type} is not allowed from step status ${current} (allowed source statuses: ${rule.from.join(', ')})`;
                }
                if (!rule.actors.includes(row.actor)) {
                        return `transition ${type} from ${current} requires actor ${rule.actors.join(' | ')}, got '${row.actor}'`;
                }
                if (type === 'step-started') {
                        const spec = state.spec.steps.find((candidate) => candidate.stepId === row.stepId);
                        if (spec.gate === 'human-approval' && !(step.approval !== null && step.approval.state === 'granted')) {
                                return `step ${row.stepId} is gated 'human-approval' and has no human approval-granted record - execution is not unlocked (approvals are never auto-granted)`;
                        }
                        const expected = step.retrySameAttempt ?? (step.lastStartedAttempt + 1);
                        if (row.attempt !== expected) {
                                return `step-started attempt must be ${String(expected)} (${step.retrySameAttempt !== null ? 'interrupted re-drive of the same attempt' : 'last attempt + 1'}; got ${String(row.attempt)})`;
                        }
                        if (row.idempotencyKey !== idempotencyKeyOf(row.graphId, row.stepId, row.attempt)) {
                                return `step-started idempotencyKey must be ${idempotencyKeyOf(row.graphId, row.stepId, row.attempt)} (the <surface>/<id>/run/<attempt> house pattern)`;
                        }
                        if (step.retrySameAttempt !== null) {
                                step.retrySameAttempt = null;
                        }
                        step.lastStartedAttempt = row.attempt;
                        step.attempt = row.attempt;
                        step.runnerId = row.payload.runnerId;
                        step.startedAt = row.ts;
                        step.providerRetry = null;
                }
                if (type === 'step-succeeded' || type === 'step-failed') {
                        if (row.attempt !== step.lastStartedAttempt) {
                                return `${type} attempt must be ${String(step.lastStartedAttempt)} (the in-flight attempt; got ${String(row.attempt)})`;
                        }
                }
                if (type === 'step-interrupted') {
                        step.retrySameAttempt = step.lastStartedAttempt;
                }
                if (type === 'step-retry-scheduled') {
                        if (row.payload.nextAttempt !== step.lastStartedAttempt + 1) {
                                return `step-retry-scheduled nextAttempt must be ${String(step.lastStartedAttempt + 1)} (got ${String(row.payload.nextAttempt)})`;
                        }
                        step.nextAttempt = row.payload.nextAttempt;
                        step.retryNotBefore = row.payload.nextAttemptAt;
                }
                if (type === 'step-failed') {
                        step.failure = { class: row.payload.failureClass, message: row.payload.message, retryPlanned: row.payload.retryPlanned };
                }
                if (type === 'step-succeeded') {
                        step.evidence.push(...row.payload.evidence);
                }
                if (type === 'takeover-completed') {
                        step.evidence.push(...row.payload.evidence);
                }
                if (type === 'approval-requested') {
                        step.approval = { requestedAt: row.ts, reason: row.payload.reason, state: 'pending', ...(row.payload.expiresAt !== undefined ? { expiresAt: row.payload.expiresAt } : {}), ...(row.payload.evidenceId !== undefined ? { evidenceId: row.payload.evidenceId } : {}) };
                }
                if (type === 'approval-granted') {
                        step.approval = { ...step.approval, state: 'granted', grantedAt: row.ts, ...(row.payload.evidenceId !== undefined ? { evidenceId: row.payload.evidenceId } : {}) };
                }
                if (type === 'approval-expired') {
                        step.approval = { ...step.approval, state: 'expired', expiredAt: row.payload.expiredAt, ...(row.payload.evidenceId !== undefined ? { evidenceId: row.payload.evidenceId } : {}) };
                        step.failure = { class: 'approval-expired', message: 'the approval deadline passed without a human decision (fail-closed: never auto-granted)', retryPlanned: false };
                }
                if (type === 'approval-denied') {
                        step.approval = { ...step.approval, state: 'denied', deniedAt: row.ts, ...(row.payload.evidenceId !== undefined ? { evidenceId: row.payload.evidenceId } : {}) };
                        step.failure = { class: 'approval-denied', message: 'approval denied by the human gate', retryPlanned: false };
                }
                if (type === 'takeover-requested') {
                        step.takeover = { requestedAt: row.ts, state: 'pending', requestedBy: row.actor };
                        state.takeover = { stepId: row.stepId, state: 'pending' };
                }
                if (type === 'takeover-accepted') {
                        step.takeover = { ...step.takeover, state: 'accepted', acceptedAt: row.ts };
                        state.takeover = { stepId: row.stepId, state: 'accepted' };
                }
                if (type === 'takeover-completed') {
                        step.takeover = { ...step.takeover, state: 'completed', completedAt: row.ts, summary: row.payload.output ?? '' };
                        state.takeover = { stepId: row.stepId, state: 'completed' };
                }
                step.status = rule.to;
                return undefined;
        }
        // observational / coordination records (no status change)
        if (type === 'cancel-requested') {
                state.cancelRequested = true;
                state.cancelReason = row.payload.reason;
                return undefined;
        }
        if (type === 'provider-retry') {
                const step = state.steps[row.stepId];
                if (step === undefined) {
                        return `unknown step ${row.stepId}`;
                }
                const current = effectiveStepStatus(state, row.stepId);
                if (current !== 'running') {
                        return `provider-retry for step ${row.stepId} requires the step to be running (the bounded window lives inside one in-flight step attempt; got '${current}')`;
                }
                if (row.attempt !== step.lastStartedAttempt) {
                        return `provider-retry attempt must be ${String(step.lastStartedAttempt)} (the in-flight step attempt; got ${String(row.attempt)})`;
                }
                if (row.idempotencyKey !== idempotencyKeyOf(row.graphId, row.stepId, step.lastStartedAttempt)) {
                        return `provider-retry idempotencyKey must be ${idempotencyKeyOf(row.graphId, row.stepId, step.lastStartedAttempt)} (the window key of the in-flight attempt)`;
                }
                const window = step.providerRetry;
                if (window !== null && window.ended) {
                        return `provider-retry for step ${row.stepId} after the window already ended (${window.lastOutcome} at ordinal ${String(window.lastOrdinal)}) - a bounded window is one terminal sequence, never reopened`;
                }
                if (window === null) {
                        if (row.payload.attemptOrdinal !== 1) {
                                return `the first provider-retry row of a window must be attemptOrdinal 1 (got ${String(row.payload.attemptOrdinal)})`;
                        }
                } else if (row.payload.attemptOrdinal !== window.lastOrdinal + 1) {
                        return `provider-retry attemptOrdinal must be ${String(window.lastOrdinal + 1)} (strictly ordinal window; got ${String(row.payload.attemptOrdinal)})`;
                }
                step.providerRetry = {
                        rows: (window === null ? 0 : window.rows) + 1,
                        lastOrdinal: row.payload.attemptOrdinal,
                        maxAttempts: row.payload.maxAttempts,
                        lastOutcome: row.payload.outcome,
                        ended: row.payload.outcome !== 'retryable-failed',
                };
                return undefined;
        }
        if (type === 'claim-acquired') {
                if (state.claims[row.stepId] !== undefined) {
                        return `claim-acquired for step ${row.stepId} while ${state.claims[row.stepId].claimId} is active (claims are exclusive; release first)`;
                }
                state.claims[row.stepId] = { claimId: row.payload.claimId, holder: row.payload.holder, since: row.ts, ...(row.payload.evidenceId !== undefined ? { evidenceId: row.payload.evidenceId } : {}) };
                return undefined;
        }
        if (type === 'claim-released') {
                const active = state.claims[row.stepId];
                if (active === undefined || active.claimId !== row.payload.claimId) {
                        return `claim-released for ${row.payload.claimId} without a matching active claim`;
                }
                delete state.claims[row.stepId];
                return undefined;
        }
        if (type === 'lease-acquired') {
                if (state.leases[row.stepId] !== undefined) {
                        return `lease-acquired for step ${row.stepId} while ${state.leases[row.stepId].leaseId} is active (release or let it expire first)`;
                }
                state.leases[row.stepId] = { leaseId: row.payload.leaseId, holder: row.payload.holder, expiresAt: row.payload.expiresAt, acquiredAt: row.ts, renewals: 0, ...(row.payload.evidenceId !== undefined ? { evidenceId: row.payload.evidenceId } : {}) };
                state.leasesSeen[row.stepId] = (state.leasesSeen[row.stepId] ?? 0) + 1;
                return undefined;
        }
        if (type === 'lease-renewed') {
                const lease = state.leases[row.stepId];
                if (lease === undefined || lease.leaseId !== row.payload.leaseId) {
                        return `lease-renewed for ${row.payload.leaseId} without a matching active lease`;
                }
                lease.expiresAt = row.payload.expiresAt;
                lease.renewals += 1;
                return undefined;
        }
        if (type === 'lease-released' || type === 'lease-expired') {
                const lease = state.leases[row.stepId];
                if (lease === undefined || lease.leaseId !== row.payload.leaseId) {
                        return `${type} for ${row.payload.leaseId} without a matching active lease`;
                }
                delete state.leases[row.stepId];
                return undefined;
        }
        if (type === 'route-decided') {
                const key = row.stepId ?? '*';
                state.routing[key] = { rowId: row.rowId, targetAgent: row.payload.targetAgent, reason: row.payload.reason, details: row.payload.details ?? null, at: row.ts };
                return undefined;
        }
        if (type === 'delegation-sent') {
                const key = row.stepId ?? '*';
                state.delegations[key] = { decisionRowId: row.payload.decisionRowId, messageId: row.payload.messageId, at: row.ts, resolved: false };
                return undefined;
        }
        if (type === 'result-received' && row.stepId !== null && state.delegations[row.stepId] !== undefined) {
                state.delegations[row.stepId].resolved = true;
        }
        // conflict-noticed, result-received, recovery-scan: audit records only.
        return undefined;
}

function finalizeState(state) {
        state.pendingApprovals = [];
        for (const step of Object.values(state.steps)) {
                if (step.status === 'awaiting-approval') {
                        state.pendingApprovals.push(step.stepId);
                }
        }
        state.pendingApprovals.sort();
        state.interrupted = [];
        for (const step of Object.values(state.steps)) {
                if (step.status === 'running') {
                        const delegation = state.delegations[step.stepId];
                        if (delegation !== undefined && delegation.resolved !== true) {
                                // a remote attempt still in flight - running, not interrupted
                                continue;
                        }
                        state.interrupted.push(step.stepId);
                }
        }
        state.interrupted.sort();
        state.derived = deriveExecution(state);
}

/** The derived execution projection of a graph (never persisted). */
function deriveExecution(state) {
        const steps = Object.values(state.steps);
        if (state.graphStatus === 'cancelled' || state.graphStatus === 'rejected') {
                return { phase: state.graphStatus, runnable: [], blocked: [], awaitingApproval: [], running: [] };
        }
        if (state.graphStatus === 'completed') {
                return { phase: 'completed', runnable: [], blocked: [], awaitingApproval: [], running: [] };
        }
        if (state.graphStatus === 'failed') {
                return { phase: 'failed', runnable: [], blocked: [], awaitingApproval: [], running: [] };
        }
        if (state.graphStatus === 'planning' || state.graphStatus === 'submitted') {
                return { phase: 'awaiting-graph-approval', runnable: [], blocked: steps.map((step) => step.stepId), awaitingApproval: [], running: [] };
        }
        const runnable = [];
        const blocked = [];
        const awaitingApproval = [];
        const running = [];
        for (const step of steps) {
                const status = effectiveStepStatus(state, step.stepId);
                if (status === 'running') {
                        running.push(step.stepId);
                } else if (status === 'awaiting-approval') {
                        awaitingApproval.push(step.stepId);
                } else if (status === 'ready') {
                        runnable.push(step.stepId);
                } else if (status === 'blocked') {
                        blocked.push(step.stepId);
                }
        }
        return {
                phase: running.length > 0 ? 'running' : (awaitingApproval.length > 0 ? 'awaiting-approval' : (runnable.length > 0 ? 'runnable' : (blocked.length > 0 ? 'blocked' : 'drained'))),
                runnable,
                blocked,
                awaitingApproval,
                running,
        };
}

/** A compact summary of a derived state (list projections). */
export function summarizeState(state) {
        const steps = {};
        for (const [stepId, step] of Object.entries(state.steps)) {
                steps[stepId] = {
                        stepId,
                        status: effectiveStepStatus(state, stepId),
                        attempt: step.attempt,
                        nextAttempt: step.nextAttempt,
                        retryNotBefore: step.retryNotBefore,
                        runnerId: step.runnerId,
                        failure: step.failure,
                        evidence: step.evidence,
                        approval: step.approval,
                        takeover: step.takeover,
                        providerRetry: step.providerRetry,
                };
        }
        return {
                graphId: state.graphId,
                graphStatus: state.graphStatus,
                execution: state.derived,
                steps,
                claims: state.claims,
                leases: state.leases,
                pendingApprovals: state.pendingApprovals,
                takeover: state.takeover,
                cancelRequested: state.cancelRequested,
                cancelReason: state.cancelReason,
                routing: state.routing,
                delegations: state.delegations,
                interrupted: state.interrupted,
                needsRecovery: state.interrupted.length > 0,
        };
}
