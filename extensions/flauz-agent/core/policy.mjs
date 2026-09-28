/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Flauz orchestration policy core (TL2-001, M2) - pure, zero-dependency.
 *
 * The typed retry/cancel/takeover policy layer of the durable orchestration
 * runtime. Imported at runtime by core/orchestration.mjs (graph-spec
 * validation), core/runtime.mjs (execution semantics) and the node --test
 * suites; never from shipped extension code (the .d.mts mirror carries the
 * types). No filesystem, no clock - every function is pure and takes `now`
 * explicitly, so recovery and tests are deterministic.
 *
 * Failure classes split TERMINAL vs RETRYABLE (the caller's retry policy
 * decides WHICH retryable classes it actually retries; a terminal class is
 * never retried by any policy):
 *   terminal:     invalid-input, approval-denied, policy-violation,
 *                 not-implemented, permanent
 *   retryable:    transient, timeout, unavailable, dependency-failure,
 *                 unknown-default
 *
 * Backoff shapes: 'fixed' | 'linear' | 'exponential' (capped by maxMs).
 * The default policy matches the house posture: 3 attempts, exponential
 * backoff from 1s capped at 30s, retrying transient/timeout/unavailable.
 *
 * Takeover is HUMAN-ONLY by construction (core/orchestration.mjs gates the
 * takeover-accepted/completed transitions on actor 'human'); this module
 * only classifies and plans, it never grants anything.
 */

export const RETRY_BACKOFF_KINDS = ['fixed', 'linear', 'exponential'];

export const TERMINAL_FAILURE_CLASSES = [
	'invalid-input',
	'approval-denied',
	'policy-violation',
	'not-implemented',
	'permanent',
];

export const RETRYABLE_FAILURE_CLASSES = [
	'transient',
	'timeout',
	'unavailable',
	'dependency-failure',
	'unknown-default',
];

export const ALL_FAILURE_CLASSES = [...TERMINAL_FAILURE_CLASSES, ...RETRYABLE_FAILURE_CLASSES];

export const CANCEL_CAUSES = ['user-cancel', 'propagation', 'dependency-failed'];

/** The default retry policy (documented default; steps may override). */
export const DEFAULT_RETRY_POLICY = Object.freeze({
	maxAttempts: 3,
	backoff: Object.freeze({ kind: 'exponential', baseMs: 1000, maxMs: 30000 }),
	retryOn: Object.freeze(['transient', 'timeout', 'unavailable']),
});

function isPlainObject(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPositiveInteger(value) {
	return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value) {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
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

/**
 * Validate a retry policy. Shape (exact keys):
 *   { maxAttempts: positive integer >= 1,
 *     backoff: { kind, baseMs, maxMs? },
 *     retryOn: array of retryable failure classes }
 * `retryOn` may not contain terminal classes (a terminal failure is never
 * retried - hard rule, not a policy knob).
 *
 * @returns {{ ok: true, policy: object } | { ok: false, error: string }}
 */
export function validateRetryPolicy(value) {
	if (!isPlainObject(value)) {
		return { ok: false, error: 'retry policy must be a JSON object' };
	}
	if (!hasExactKeys(value, ['maxAttempts', 'backoff', 'retryOn'])) {
		return { ok: false, error: 'retry policy must have exactly the keys [backoff, maxAttempts, retryOn]' };
	}
	if (!isPositiveInteger(value.maxAttempts)) {
		return { ok: false, error: 'retry policy maxAttempts must be a positive integer' };
	}
	if (!isPlainObject(value.backoff) || !hasExactKeys(value.backoff, ['kind', 'baseMs'], ['maxMs'])) {
		return { ok: false, error: 'retry policy backoff must have exactly the keys [baseMs, kind, maxMs?]' };
	}
	if (!RETRY_BACKOFF_KINDS.includes(value.backoff.kind)) {
		return { ok: false, error: `retry policy backoff kind must be one of ${RETRY_BACKOFF_KINDS.join(' | ')} (got ${JSON.stringify(value.backoff.kind)})` };
	}
	if (!isPositiveInteger(value.backoff.baseMs)) {
		return { ok: false, error: 'retry policy backoff baseMs must be a positive integer (epoch ms)' };
	}
	if (value.backoff.maxMs !== undefined && !isPositiveInteger(value.backoff.maxMs)) {
		return { ok: false, error: 'retry policy backoff maxMs must be a positive integer (epoch ms)' };
	}
	if (value.backoff.maxMs !== undefined && value.backoff.maxMs < value.backoff.baseMs) {
		return { ok: false, error: 'retry policy backoff maxMs must be >= baseMs' };
	}
	if (!Array.isArray(value.retryOn) || value.retryOn.length === 0) {
		return { ok: false, error: 'retry policy retryOn must be a non-empty array of failure classes' };
	}
	for (const failureClass of value.retryOn) {
		if (TERMINAL_FAILURE_CLASSES.includes(failureClass)) {
			return { ok: false, error: `retry policy retryOn must not contain the terminal failure class '${failureClass}' (terminal failures are never retried)` };
		}
		if (!RETRYABLE_FAILURE_CLASSES.includes(failureClass)) {
			return { ok: false, error: `retry policy retryOn entry '${String(failureClass)}' is not a known failure class (${ALL_FAILURE_CLASSES.join(' | ')})` };
		}
	}
	return { ok: true, policy: value };
}

/**
 * Classify a failure into a failure class. Accepts a class-carrying object
 * ({ failureClass }) or a raw value (message/Error-like); unclassifiable
 * failures land in 'unknown-default' which is RETRYABLE (the runtime still
 * applies the attempt budget - never an infinite loop).
 *
 * @returns {string} a member of ALL_FAILURE_CLASSES
 */
export function classifyFailure(failure) {
	if (isPlainObject(failure) && typeof failure.failureClass === 'string') {
		if (ALL_FAILURE_CLASSES.includes(failure.failureClass)) {
			return failure.failureClass;
		}
		return 'unknown-default';
	}
	if (failure instanceof Error || typeof failure === 'string') {
		return 'unknown-default';
	}
	return 'unknown-default';
}

/**
 * The backoff delay (ms) BEFORE attempt `attempt` (1-based; attempt 1 has no
 * delay - delays start with the first RETRY, attempt 2).
 *
 * Shapes: fixed (baseMs every retry), linear (baseMs * retryNumber),
 * exponential (baseMs * 2^(retryNumber - 1)), all capped at maxMs.
 */
export function backoffDelayMs(policy, attempt, now) {
	if (!isPositiveInteger(attempt) || attempt < 2) {
		return isNonNegativeInteger(now) ? now : 0;
	}
	const retryNumber = attempt - 1;
	const backoff = policy.backoff;
	let delay;
	if (backoff.kind === 'fixed') {
		delay = backoff.baseMs;
	} else if (backoff.kind === 'linear') {
		delay = backoff.baseMs * retryNumber;
	} else {
		delay = backoff.baseMs * (2 ** (retryNumber - 1));
	}
	if (typeof backoff.maxMs === 'number') {
		delay = Math.min(delay, backoff.maxMs);
	}
	return delay;
}

/**
 * Decide whether a failed attempt should be retried, and when.
 *
 * @param {{ policy: object, attempt: number, failureClass: string, now: number }} input
 * @returns {{ retry: true, nextAttempt: number, nextAttemptAt: number, delayMs: number } |
 *           { retry: false, reason: 'terminal-class' | 'attempts-exhausted' }}
 */
export function planRetry(input) {
	const { policy, attempt, failureClass, now } = input;
	if (TERMINAL_FAILURE_CLASSES.includes(failureClass)) {
		return { retry: false, reason: 'terminal-class' };
	}
	if (!policy.retryOn.includes(failureClass)) {
		return { retry: false, reason: 'terminal-class' };
	}
	const nextAttempt = attempt + 1;
	if (nextAttempt > policy.maxAttempts) {
		return { retry: false, reason: 'attempts-exhausted' };
	}
	const delayMs = backoffDelayMs(policy, nextAttempt, now);
	return { retry: true, nextAttempt, nextAttemptAt: now + delayMs, delayMs };
}

/**
 * Plan the coherent cancellation sweep for a graph (pure). Given the derived
 * step statuses, returns the step ids that must receive a step-cancelled row
 * (every non-terminal step) - the caller (runtime or recovery continuation)
 * appends the rows with its own provenance.
 *
 * Terminal step statuses ('succeeded', 'cancelled') are never re-cancelled;
 * 'failed' steps ARE cancellable (a coherent stop freezes pending retries).
 */
export function planCancellation(steps) {
	const cancellable = [];
	for (const [stepId, step] of Object.entries(steps)) {
		if (step.status !== 'succeeded' && step.status !== 'cancelled') {
			cancellable.push(stepId);
		}
	}
	cancellable.sort();
	return { cancelStepIds: cancellable };
}
