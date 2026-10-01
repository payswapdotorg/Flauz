/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * A-PROD-003-W3.2 (dogfood harness) -- P2-FIX-121: the live lane's
 * completion budget + the finish-reason surfacing.
 *
 * The REGISTERED finding (docs/FLAUZ-PROGRAM/findings/
 * P2-FIX-121-live-truncation-budget.md): the platform's default
 * completion budget (~4096 tokens) truncates the real 23-consumer
 * exploration map mid-JSON (finish_reason: length at completion_tokens
 * 4095, the opening fence without the closing); the raw parse then
 * fails honestly but SILENTLY -- the truncation itself never shows in
 * the receipts. This module is the harness-side fix's shared core:
 *
 *   - the env-only knob FLAUZ_DOGFOOD_LIVE_MAX_TOKENS (OPTIONAL,
 *     fail-closed on a malformed value; a generous default of 32_768
 *     tokens) parsed PURE (parseLiveMaxTokens) so the test suite can
 *     pin the default / env / malformed classes without running the
 *     driver;
 *   - the ask-stream consumption (consumeAskStream): joins the adapter's
 *     text deltas AND captures the terminal `finish` event's
 *     finishReason -- the surface the W1 driver loop dropped on the
 *     floor;
 *   - the visible truncation marker (finishReasonDetail /
 *     answerParseFailDetail): a `length` finish renders as TRUNCATED in
 *     the ask receipts' details -- a VISIBLE truncation, never a
 *     silent ok.
 *
 * The knob lands on the LIVE lane's ask requests ONLY (the driver wires
 * ChatRequest.maxOutputTokens -- the neutral request surface the REAL
 * openAiCompat adapter maps onto the wire body's `max_tokens`,
 * extensions/flauz-models/src/adapters/openAiCompat.ts
 * buildOpenAiRequestBody); the fake lanes' request shape is UNCHANGED
 * (the P2-FIX-121 acceptance).
 *
 * Harness module (build/flauz/dogfood/**): NOT a gate instrument.
 */

/** P2-FIX-121: the env-only completion-budget knob's name (fail-closed on a malformed value). */
export const LIVE_MAX_TOKENS_ENV = 'FLAUZ_DOGFOOD_LIVE_MAX_TOKENS';

/** P2-FIX-121: the generous default completion budget (tokens) when the knob is absent. */
export const DEFAULT_LIVE_MAX_TOKENS = 32_768;

/**
 * P2-FIX-121: parses the raw FLAUZ_DOGFOOD_LIVE_MAX_TOKENS value
 * ('' = the knob is absent). PURE + total: absent -> the generous
 * default; a positive safe integer -> the env value; ANYTHING else
 * (non-numeric, zero, negative, fractional, exponent-form, padded,
 * beyond Number.MAX_SAFE_INTEGER) -> { ok: false } -- the driver FAILS
 * CLOSED on that class (exit 2, the harness's env-contract discipline,
 * same as P2-FIX-117); the test suite pins every class here.
 */
export function parseLiveMaxTokens(raw) {
	if (raw === '') {
		return { ok: true, tokens: DEFAULT_LIVE_MAX_TOKENS, source: 'default' };
	}
	if (typeof raw !== 'string' || !/^[0-9]+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1) {
		return { ok: false, error: `${LIVE_MAX_TOKENS_ENV} must be a positive integer of completion tokens (got ${JSON.stringify(raw)})` };
	}
	return { ok: true, tokens: Number(raw), source: 'env' };
}

/**
 * P2-FIX-121: consumes one adapter stream (the REAL openAiCompat
 * adapter's event sequence) into the ask outcome core -- the joined
 * text PLUS the finish reason from the terminal `finish` event (the
 * adapter's contract guarantees exactly one finish event on success;
 * the defensive default 'other' covers a stream that ends without
 * one). This replaces the W1 driver loop that read text-deltas only
 * and dropped the finish event on the floor.
 */
export async function consumeAskStream(stream) {
	const parts = [];
	let finishReason = 'other';
	for await (const event of stream) {
		if (event.type === 'text-delta') {
			parts.push(event.text);
			continue;
		}
		if (event.type === 'finish') {
			finishReason = event.finishReason;
		}
	}
	return { text: parts.join(''), finishReason };
}

/**
 * P2-FIX-121: the visible finish-reason surface for an ask receipt
 * detail. A `length` finish is the token-budget truncation class: it
 * renders as the VISIBLE TRUNCATED marker -- never a silent ok. Every
 * other reason renders plainly.
 */
export function finishReasonDetail(finishReason) {
	if (finishReason === 'length') {
		return 'TRUNCATED (finish_reason: length — the completion stopped at the completion-token budget; the text may be cut mid-structure)';
	}
	return `finish_reason: ${finishReason}`;
}

/** True exactly when the finish reason is the token-budget truncation class (finish_reason: length). */
export function isTruncatedFinish(finishReason) {
	return finishReason === 'length';
}

/**
 * P2-FIX-121: the answer-parse-failure receipt detail. The W4 live
 * failure class (finish_reason: length -> the fenced JSON cut
 * mid-structure -> the raw parse fails) previously surfaced as a BARE
 * raw-parse error; now the parse failure carries the finish reason,
 * and a `length` finish appends the VISIBLE TRUNCATED marker plus the
 * knob that widens the budget (the live exploration run's answer
 * parses, or fails with a VISIBLE truncation marker -- never a bare
 * raw-parse error again).
 */
export function answerParseFailDetail(parseError, finishReason) {
	if (finishReason === 'length') {
		return `${parseError} | ${finishReasonDetail(finishReason)} (widen the live lane's completion budget via ${LIVE_MAX_TOKENS_ENV})`;
	}
	return `${parseError} | ${finishReasonDetail(finishReason)}`;
}
