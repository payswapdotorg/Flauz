/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Flauz bounded provider-retry executor (TL2-F2) - the INV-2 product contract.
 *
 * The automatic, bounded, RECORDED provider-retry loop of the durable
 * orchestration runtime. It lives at the durable step-execution seam - the
 * provider call a durable step issues through its EffectSink
 * (core/runtime.mjs driveGraph: store.startStep -> sink.run ->
 * store.finishStep) - and NEVER inside a provider adapter: the adapters stay
 * frozen, the runtime owns the retry policy (the TL2 architectural decision).
 *
 * THE CONTRACT (docs/FLAUZ-PROGRAM/TL2-AGENTOS-BATTERY.md INV-2):
 *
 * 1. TRIGGER - a typed provider error whose DL-35 `retryClass` is retryable
 *    ('immediate' | 'short-backoff' | 'long-backoff'), surfaced by the sink as
 *    `providerError: { code, retryClass, retryAfterMs? }` on a failed effect.
 *    Terminal-class errors ('none') and failures carrying NO typed provider
 *    error fail immediately - the existing honest single-shot path, unchanged
 *    (a malformed providerError is likewise never retried: fail-closed).
 *    A sink that THROWS (a lost response) is never retried optimistically
 *    (DL-53: outcome-unknown is surfaced, not re-issued; the recovery pass
 *    owns the interrupted step and the idempotency key replays the settle).
 *
 * 2. BOUND - the step's provider call is retried automatically up to
 *    `maxAttempts` TOTAL attempts (default 3). The bound is configurable
 *    additively through the routing-policy/providers state family (DL-36):
 *    the optional `providerRetry: { maxAttempts?: <positive int> }` field,
 *    absent -> 3; zero migration; an absent field is default behavior. The
 *    config is resolved by resolveProviderRetryBound() and an INVALID config
 *    throws a typed error (fail-closed, never silently defaulted).
 *
 * 3. BACKOFF - the error's `retryAfterMs` is honored when present, bounded by
 *    a sane cap: min(retryAfterMs, RETRY_AFTER_CAP_MS). When absent, the next
 *    attempt is IMMEDIATE (the deterministic fixture-rung posture) - the wait
 *    actually applied is recorded on every attempt row (waitAppliedMs). The
 *    wait is an INJECTED PORT (default: real timer): harnesses and the battery
 *    control the clock and never sleep for real.
 *
 * 4. RECORDING - every attempt of an ENGAGED window appends an ops-ledger row
 *    (the orchestration journal, DL-60 discipline: serialized by the store
 *    transition lock, replay-validated before write, hash-chained): actor
 *    attribution, the step attempt + window key, the attempt ordinal, the
 *    typed outcome (the DL-35 code / retryable class / vendor hint), the wait
 *    applied, and the next ordinal when another attempt follows. Windows that
 *    never retry (first-attempt success, or a terminal/absent typed error)
 *    mint no rows - the honest single-shot path is already recorded by the
 *    step-succeeded / step-failed transitions.
 *
 * 5. EXHAUSTION - after maxAttempts retryable failures the step fails with the
 *    TERMINAL typed failure through the EXISTING honest path: the effect
 *    surfaces, finishStep records step-failed with retryPlanned pinned FALSE
 *    (the window consumed the budget; the automatic step-retry loop stays
 *    silent - exhaustion is terminal, never a silent success, never an
 *    auto-pass), lifecycle 'failed', ops rows recorded.
 *
 * 6. COMPOSABILITY - caller-driven retries compose ABOVE the automatic loop:
 *    an explicit caller retry (store.retryStep -> a fresh step attempt) starts
 *    a FRESH bounded window with a FRESH idempotency key
 *    (flauz-orch/<graph>/<step>/run/<next-attempt>). Within one window the
 *    provider attempts are keyed `<window-key>#p<ordinal>` (attempt 1 keeps
 *    the canonical window key byte-identically): each provider attempt
 *    settles its own idempotency key in the sink, so a completed-but-unknown
 *    effect is replayed - never duplicated - and only a CONFIRMED retryable
 *    typed error triggers the next attempt (DL-53).
 *
 * ZERO-NETWORK POSTURE (DL-37): the retry loop only re-issues calls through
 * the sink the runtime already drives; it never touches provider enablement,
 * credentials or routing - retry logic never enables a provider.
 */

import { OrchestrationError, PROVIDER_RETRY_CLASSES } from './orchestration.mjs';

/** The default window bound (the documented default; section 3.2). */
export const PROVIDER_RETRY_MAX_ATTEMPTS_DEFAULT = 3;

/** The sane cap on a single honored retryAfterMs wait (section 3.3). */
export const RETRY_AFTER_CAP_MS = 30000;

/** Every DL-35 retry class (terminal 'none' included) - the structural read set. */
const ALL_RETRY_CLASSES = ['none', ...PROVIDER_RETRY_CLASSES];

function isPlainObject(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPositiveInteger(value) {
	return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value) {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Resolve the window bound from the routing-policy/providers state family's
 * additive optional field. Accepts undefined/null (absent -> the documented
 * default 3) or { maxAttempts?: positive integer } (absent maxAttempts ->
 * default). Anything else throws a typed OrchestrationError - an invalid
 * config is never silently defaulted (fail-closed).
 */
export function resolveProviderRetryBound(config) {
	if (config === undefined || config === null) {
		return PROVIDER_RETRY_MAX_ATTEMPTS_DEFAULT;
	}
	if (!isPlainObject(config)) {
		throw new OrchestrationError(`providerRetry config must be a JSON object { maxAttempts?: number } (the routing-policy state family additive field; got ${JSON.stringify(config)})`, 'invalid-params');
	}
	const keys = Object.keys(config);
	if (keys.length > 1 || (keys.length === 1 && keys[0] !== 'maxAttempts')) {
		throw new OrchestrationError(`providerRetry config must have at most the key [maxAttempts] (got ${JSON.stringify(keys)})`, 'invalid-params');
	}
	if (config.maxAttempts === undefined) {
		return PROVIDER_RETRY_MAX_ATTEMPTS_DEFAULT;
	}
	if (!isPositiveInteger(config.maxAttempts)) {
		throw new OrchestrationError(`providerRetry.maxAttempts must be a positive integer (got ${JSON.stringify(config.maxAttempts)})`, 'invalid-params');
	}
	return config.maxAttempts;
}

/**
 * Structural read of the typed provider error a sink surfaced on a failed
 * effect: `effect.providerError = { code, retryClass, retryAfterMs? }` (the
 * DL-35 ProviderError fields adapters already carry - flauz-models
 * src/contract/errors.ts). Returns null when the effect carries no typed
 * provider error or a MALFORMED one (fail-closed: garbage is never retried).
 */
export function readProviderError(effect) {
	if (!isPlainObject(effect) || !isPlainObject(effect.providerError)) {
		return null;
	}
	const providerError = effect.providerError;
	if (typeof providerError.code !== 'string' || providerError.code.length === 0) {
		return null;
	}
	if (typeof providerError.retryClass !== 'string' || !ALL_RETRY_CLASSES.includes(providerError.retryClass)) {
		return null;
	}
	if (providerError.retryAfterMs !== undefined && !isNonNegativeInteger(providerError.retryAfterMs)) {
		return null;
	}
	return {
		code: providerError.code,
		retryClass: providerError.retryClass,
		...(providerError.retryAfterMs !== undefined ? { retryAfterMs: providerError.retryAfterMs } : {}),
	};
}

/** Is this typed provider error retryable per the DL-35 fixed table? */
export function isRetryableProviderError(providerError) {
	return providerError !== null && PROVIDER_RETRY_CLASSES.includes(providerError.retryClass);
}

/**
 * The wait to apply before the next attempt: the error's retryAfterMs when
 * present, bounded by the sane cap; 0 (immediate) when absent - the
 * deterministic posture (section 3.3). Pure.
 */
export function providerRetryWaitMs(providerError) {
	if (providerError.retryAfterMs === undefined) {
		return 0;
	}
	return Math.min(providerError.retryAfterMs, RETRY_AFTER_CAP_MS);
}

/**
 * The idempotency key of one provider attempt inside a window: attempt 1
 * keeps the canonical window key (byte-identical to the pre-F2 contract -
 * existing sinks and journals are unchanged); attempts >= 2 append
 * `#p<ordinal>` so each provider attempt settles its own key (the sink
 * idempotency discipline; DL-53's fresh-key reconciliation).
 */
export function providerAttemptKeyOf(windowKey, attemptOrdinal) {
	return attemptOrdinal === 1 ? windowKey : `${windowKey}#p${attemptOrdinal}`;
}

/** The default (real-time) wait port: 0 ms resolves immediately. */
export function defaultProviderRetryWait(ms) {
	if (!isNonNegativeInteger(ms) || ms === 0) {
		return Promise.resolve();
	}
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

/**
 * Run one durable step's provider call under the bounded, recorded retry
 * contract. Called by core/runtime.mjs driveGraph between startStep and
 * finishStep; never by adapters, never by callers directly.
 *
 * @param {import('./orchStore.mjs').OrchestrationStore} store
 * @param {object} sink the effect sink (EFFECT_SINK_SHAPE)
 * @param {object} input { graphId, stepId, start: {attempt, idempotencyKey},
 *                         spec (the effect spec), actor?, origin?,
 *                         providerRetry? (the DL-36 additive bound config),
 *                         wait? (the injectable wait port) }
 * @returns {Promise<{ effect: object, providerAttempts: number, exhausted: boolean }>}
 *          the final effect plus the window facts: how many provider attempts
 *          ran, and whether the window exhausted its bound (the caller pins
 *          the terminal retryPlanned=false on the step failure).
 */
export async function runProviderCallWithBoundedRetry(store, sink, input) {
	const maxAttempts = resolveProviderRetryBound(input.providerRetry);
	const wait = input.wait ?? defaultProviderRetryWait;
	const actor = input.actor ?? 'agent';
	const origin = input.origin ?? 'runtime:drive';
	const windowKey = input.start.idempotencyKey;
	let attemptOrdinal = 1;
	let waitAppliedMs = 0;
	let lastProviderError = null;
	for (;;) {
		const effect = await sink.run(providerAttemptKeyOf(windowKey, attemptOrdinal), input.spec);
		if (isPlainObject(effect) && effect.ok) {
			if (attemptOrdinal > 1 && lastProviderError !== null) {
				await store.recordProviderRetry({
					graphId: input.graphId,
					stepId: input.stepId,
					attempt: input.start.attempt,
					idempotencyKey: windowKey,
					attemptOrdinal,
					outcome: 'recovered',
					code: lastProviderError.code,
					retryClass: lastProviderError.retryClass,
					waitAppliedMs,
					maxAttempts,
					actor,
					origin,
				});
			}
			return { effect, providerAttempts: attemptOrdinal, exhausted: false };
		}
		const providerError = readProviderError(effect);
		if (!isRetryableProviderError(providerError)) {
			// No trigger: terminal-class, no typed provider error, or a
			// malformed one - the existing honest single-shot path.
			return { effect, providerAttempts: attemptOrdinal, exhausted: false };
		}
		lastProviderError = providerError;
		const isLast = attemptOrdinal >= maxAttempts;
		await store.recordProviderRetry({
			graphId: input.graphId,
			stepId: input.stepId,
			attempt: input.start.attempt,
			idempotencyKey: windowKey,
			attemptOrdinal,
			outcome: isLast ? 'exhausted' : 'retryable-failed',
			code: providerError.code,
			retryClass: providerError.retryClass,
			...(providerError.retryAfterMs !== undefined ? { retryAfterMs: providerError.retryAfterMs } : {}),
			waitAppliedMs,
			maxAttempts,
			...(isLast ? {} : { nextAttemptOrdinal: attemptOrdinal + 1 }),
			actor,
			origin,
		});
		if (isLast) {
			// Exhaustion: the terminal typed failure rides the EXISTING
			// honest path (step-failed, retryPlanned pinned false).
			return { effect, providerAttempts: attemptOrdinal, exhausted: true };
		}
		const waitMs = providerRetryWaitMs(providerError);
		await wait(waitMs);
		attemptOrdinal += 1;
		waitAppliedMs = waitMs;
	}
}
