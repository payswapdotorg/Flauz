/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/
/**
* TL2-F2B — the environments-lifecycle bounded provider-retry policy (INV-2).
*
* The semantic mirror of the LANDED durable-runtime retry contract
* (extensions/flauz-agent/core/providerRetry.mjs, PR #45 — the read-only
* precedent), spoken at the environments LIFECYCLE seam in this repo's own
* TypeScript idiom. The retry loop itself lives in the MANAGER's op path
* (manager.ts runExecutorOpBounded): the executors stay frozen adapters —
* the cloud executor only SURFACES the structured, ephemeral retry hint on
* the failed-effect error it already returns (cloudHttp.ts `call()` attaches
* `providerRetryHint: { status, retryAfterMs? }` to CLOUD_PROVIDER_ERROR;
* the hint is NEVER persisted — the manager records exactly the pinned
* {code, message} payload into the PIN-2 lines).
*
* THE CONTRACT (docs/FLAUZ-PROGRAM/WORK-REGISTRY.md AO-H1 / F2b):
*
* 1. TRIGGER — a typed retryable provider error class, surfaced by the
*    executor as a WELL-FORMED structured hint on the failed effect error.
*    At this seam that is CLOUD_PROVIDER_ERROR from a transient HTTP class:
*    5xx, plus the network-ish rate limit 429. Everything else keeps the
*    pre-F2B single-shot honest path BYTE-IDENTICALLY: absent hints (every
*    other error class — CLOUD_SANDBOX_UNKNOWN 404, CLOUD_AUTH_FAILED,
*    CLOUD_UNREACHABLE, CLOUD_TIMEOUT, VAULT_REF_UNRESOLVED, the local/
*    simulated/ssh/docker executors' errors), MALFORMED hints (garbage is
*    never retried — fail-closed, the precedent's readProviderError
*    posture), and non-retryable statuses (4xx CLOUD_PROVIDER_ERROR — client
*    errors are ours, not the provider's). A THROWN executor (lost response)
*    is never retried blindly: the outcome is unknown, so re-issuing could
*    double-apply the effect — the typed EXECUTOR_THREW failure rides the
*    single-shot path (the precedent's DL-53 posture; CLOUD_TIMEOUT /
*    CLOUD_UNREACHABLE stay single-shot for the same reason at this seam).
*
* 2. BOUND — maxAttempts TOTAL attempts (default 3). The config is
*    ADDITIVE: the optional `providerRetry: { maxAttempts?: <positive int> }`
*    field on the manager options; absent -> 3; `maxAttempts: 1` is the
*    off-switch (the additivity law: byte-identical single-shot, no attempt
*    rows, one provider call). An INVALID config is a typed fail-closed
*    constructor throw (RETRY_CONFIG_INVALID) — never a silent
*    default-masking.
*
* 3. BACKOFF — the wait between attempts honors the provider hint's
*    retryAfterMs (parsed from a Retry-After-style response header by the
*    cloud executor) bounded by the sane cap PROVIDER_RETRY_AFTER_CAP_MS;
*    otherwise the minimal fixed delay PROVIDER_RETRY_FIXED_DELAY_MS. The
*    wait is an INJECTED PORT (`providerRetryWait` on the manager options;
*    default: the real timer) so tests, the battery and the drill stay
*    deterministic — never a real sleep on the test path.
*
* 4. RECORDING — every attempt of an ENGAGED window appends one ops-ledger
*    row (the existing PIN-2 journal, exact pinned key set — the attempt
*    ordinal, the window bound, the wait applied and the next-ordinal (or
*    the exhaustion) ride the error.message in the parseable grammar below,
*    with the typed outcome as the row's error.code). Windows that never
*    engage (first-attempt success, terminal/absent/malformed hints, or the
*    off-switch) mint no rows — the single-shot path is already recorded by
*    the request-level row. A within-window recovery mints no extra row: the
*    request-level ok row closes the window and the successful attempt's
*    ordinal is reconstructable from the preceding attempt row's
*    next-attempt marker (the pinned key set carries no ordinal field — the
*    honest composition, stated in the lane REPORT).
*
* 5. EXHAUSTION — after maxAttempts retryable failures the op resolves to
*    the EXISTING typed terminal failure outcome through the unchanged
*    failure path: the request-level error row, failureState, the typed
*    {ok:false, error} outcome. Exhaustion is terminal — never a silent
*    success, never an auto-pass.
*
* 6. COMPOSABILITY — a caller-driven retry after exhaustion (a second
*    `perform(...)`) starts a FRESH window: a new attempt sequence from
*    ordinal 1 with a fresh budget.
*
* The attempt-row message grammar (single line, ASCII, parseable by the
* exported parser — the battery journey and the drills read the ledger with
* a plain file read and identify attempt rows through it):
*
*   provider retry attempt <ordinal>/<maxAttempts> on <op>: <CODE> (wait <ms>ms, next attempt <next>) - <original executor message>
*   provider retry attempt <ordinal>/<maxAttempts> on <op>: <CODE> (wait <ms>ms, window exhausted) - <original executor message>
*
* vscode-free, zero deps, Node stdlib only.
*/
import { EnvironmentLifecycleError, type EnvironmentOpName, type ExecutorEffectError, type ProviderRetryHint } from './types.ts';

/** The default window bound (the documented default; the packet's §3.1.2). */
export const PROVIDER_RETRY_MAX_ATTEMPTS_DEFAULT = 3;

/** The sane cap on a single honored retryAfterMs wait (the precedent's §3.3). */
export const PROVIDER_RETRY_AFTER_CAP_MS = 30_000;

/**
* The minimal fixed delay applied between attempts when the provider surfaced
* no Retry-After-style hint (deterministic-friendly; injectable wait port —
* production waits are real, tests never sleep).
*/
export const PROVIDER_RETRY_FIXED_DELAY_MS = 25;

/** The stable prefix of an ops-ledger attempt-row error message. */
export const PROVIDER_RETRY_ATTEMPT_PREFIX = 'provider retry attempt ';

/** The injectable wait port (tests/drills control the clock; default: the real timer). */
export type RetryWaitPort = (ms: number) => Promise<void>;

/** The additive bound configuration (manager options `providerRetry`). */
export interface ProviderRetryOptions {
	/** Total attempts per window (default 3; 1 = the off-switch — byte-identical single-shot). */
	readonly maxAttempts?: number;
}

/** The parsed facts of one ops-ledger attempt row (the grammar above). */
export interface ProviderRetryAttemptFacts {
	readonly ordinal: number;
	readonly maxAttempts: number;
	readonly op: EnvironmentOpName;
	readonly code: string;
	readonly waitAppliedMs: number;
	/** Present when another attempt follows; absent on the exhaustion row. */
	readonly nextAttemptOrdinal?: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
* Resolves the window bound from the additive manager-options field. Accepts
* undefined/null (absent -> the documented default 3) or
* `{ maxAttempts?: positive integer }` (absent maxAttempts -> default).
* Anything else throws the typed RETRY_CONFIG_INVALID error — an invalid
* config is never silently defaulted (fail-closed).
*/
export function resolveRetryBound(config: unknown): number {
	if (config === undefined || config === null) {
		return PROVIDER_RETRY_MAX_ATTEMPTS_DEFAULT;
	}
	if (!isPlainObject(config)) {
		throw new EnvironmentLifecycleError('RETRY_CONFIG_INVALID', `providerRetry config must be a JSON object { maxAttempts?: number } (the additive manager-options field; got ${JSON.stringify(config)})`);
	}
	const keys = Object.keys(config);
	if (keys.length > 1 || (keys.length === 1 && keys[0] !== 'maxAttempts')) {
		throw new EnvironmentLifecycleError('RETRY_CONFIG_INVALID', `providerRetry config must have at most the key [maxAttempts] (got ${JSON.stringify(keys)})`);
	}
	const maxAttempts = config['maxAttempts'];
	if (maxAttempts === undefined) {
		return PROVIDER_RETRY_MAX_ATTEMPTS_DEFAULT;
	}
	if (typeof maxAttempts !== 'number' || !Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
		throw new EnvironmentLifecycleError('RETRY_CONFIG_INVALID', `providerRetry.maxAttempts must be a positive integer (got ${JSON.stringify(maxAttempts)})`);
	}
	return maxAttempts;
}

/**
* Structural read of the retry hint a failed executor effect carries:
* `error.providerRetryHint = { status, retryAfterMs? }`. Returns null when
* the error carries NO hint or a MALFORMED one (garbage is never retried —
* fail-closed, mirroring the precedent's readProviderError).
*/
export function readProviderRetryHint(error: ExecutorEffectError | undefined): ProviderRetryHint | null {
	if (error === undefined || !isPlainObject(error.providerRetryHint)) {
		return null;
	}
	const hint = error.providerRetryHint as Record<string, unknown>;
	const status = hint['status'];
	if (typeof status !== 'number' || !Number.isSafeInteger(status) || status < 400 || status > 599) {
		return null; // a failure hint carries a failure status; anything else is malformed
	}
	const retryAfterMs = hint['retryAfterMs'];
	if (retryAfterMs !== undefined && !isNonNegativeInteger(retryAfterMs)) {
		return null;
	}
	return { status, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) };
}

/**
* Is the hinted HTTP status a TRANSIENT provider class? 5xx (provider-side
* failure) and 429 (the network-ish rate limit). Every other status — the
* 4xx client errors a 400-class CLOUD_PROVIDER_ERROR carries, and the
* 401/403/404 classes mapped to their own typed codes without hints — is
* NOT retryable.
*/
export function isRetryableProviderStatus(status: number): boolean {
	return (status >= 500 && status <= 599) || status === 429;
}

/**
* The wait to apply before the next attempt: the hint's retryAfterMs when
* present, bounded by the sane cap; otherwise the minimal fixed delay. Pure.
*/
export function providerRetryWaitMs(hint: ProviderRetryHint, fixedDelayMs: number = PROVIDER_RETRY_FIXED_DELAY_MS): number {
	if (hint.retryAfterMs === undefined) {
		return fixedDelayMs;
	}
	return Math.min(hint.retryAfterMs, PROVIDER_RETRY_AFTER_CAP_MS);
}

/** The default (real-time) wait port: 0 ms resolves immediately. */
export function defaultRetryWait(ms: number): Promise<void> {
	if (!isNonNegativeInteger(ms) || ms === 0) {
		return Promise.resolve();
	}
	return new Promise(resolve => {
		setTimeout(resolve, ms);
	});
}

/** Formats one attempt row's error message (the grammar in the module doc). */
export function formatProviderRetryAttemptMessage(facts: ProviderRetryAttemptFacts, originalMessage: string): string {
	const outcome = facts.nextAttemptOrdinal === undefined
		? 'window exhausted'
		: `next attempt ${facts.nextAttemptOrdinal}`;
	return `provider retry attempt ${facts.ordinal}/${facts.maxAttempts} on ${facts.op}: ${facts.code} (wait ${facts.waitAppliedMs}ms, ${outcome}) - ${originalMessage}`;
}

const ATTEMPT_MESSAGE_PATTERN = /^provider retry attempt (\d+)\/(\d+) on ([a-z]+): ([A-Z0-9_]+) \(wait (\d+)ms, (?:next attempt (\d+)|window exhausted)\)(?: - )?([\S\s]*)$/;

/**
* Parses an ops-ledger error message back into the attempt facts (the single
* source of truth for the grammar — the battery journey and the drills
* identify attempt rows through this, never a hand-rolled regex). Returns
* undefined for any message that is not an attempt row.
*/
export function parseProviderRetryAttemptMessage(message: string | undefined): ProviderRetryAttemptFacts | undefined {
	if (typeof message !== 'string' || !message.startsWith(PROVIDER_RETRY_ATTEMPT_PREFIX)) {
		return undefined;
	}
	const match = ATTEMPT_MESSAGE_PATTERN.exec(message);
	if (match === null) {
		return undefined;
	}
	const ordinal = Number.parseInt(match[1]!, 10);
	const maxAttempts = Number.parseInt(match[2]!, 10);
	const op = match[3] as EnvironmentOpName;
	const code = match[4]!;
	const waitAppliedMs = Number.parseInt(match[5]!, 10);
	const nextAttemptOrdinal = match[6] === undefined ? undefined : Number.parseInt(match[6], 10);
	if (nextAttemptOrdinal !== undefined && nextAttemptOrdinal !== ordinal + 1) {
		return undefined; // a well-formed row's next ordinal is ordinal + 1
	}
	if (ordinal < 1 || ordinal > maxAttempts) {
		return undefined;
	}
	return { ordinal, maxAttempts, op, code, waitAppliedMs, ...(nextAttemptOrdinal === undefined ? {} : { nextAttemptOrdinal }) };
}
