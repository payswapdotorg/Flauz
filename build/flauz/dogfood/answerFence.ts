/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * A-PROD-003-W2.1 (P2-FIX-118) -- the markdown-fence-tolerant answer
 * extraction. Extended by A-PROD-003-W3.1 (P2-FIX-120) with the
 * prose-adjacent extraction fallback.
 *
 * The W2 live-provider run (records banked at
 * build/flauz/dogfood/records/w2-live-provider-2026-10-01/) surfaced the
 * classic real-model integration behavior: the live glm-4-plus answered
 * the provider-configuration question with a CORRECT-shaped JSON
 * payload wrapped in a markdown code fence, and the answer contract's
 * raw-JSON parse rejected it on formatting alone ("the completion is
 * not valid JSON: Unexpected token '`'").
 *
 * The W3 live re-run (records banked at
 * build/flauz/dogfood/records/aprod003-w3-live-2026-10-01/) surfaced the
 * residual (P2-FIX-120, the 118 class's second iteration): the live
 * model emits the fenced JSON SURROUNDED BY PROSE ("```json {...} ```
 * Success!") -- and the W2.1 stripper only strips a fence pair that
 * ENDS the text (the TRAILING_FENCE regex requires only whitespace
 * after the closing fence). Prose before/after the fence defeated it.
 *
 * The fix lives at the harness seam (this module + the exercises' parse
 * functions): the fence-tolerant parse for LIVE lanes is now
 * clean-pair-strip FIRST (the W2.1 semantics, back-compat), then the
 * P2-FIX-120 extraction fallback -- the FIRST COMPLETE fenced block
 * from ANYWHERE in the text. The discipline:
 *
 *   - a LEADING fence line (``` or ```json, optional info string) plus a
 *     TRAILING fence line -- one pair around the payload -- is stripped
 *     (W2.1, UNCHANGED -- its semantics and tests stay green);
 *   - P2-FIX-120: otherwise the first COMPLETE fence pair anywhere in
 *     the text (a fence-opening line, content, a matching fence-closing
 *     line) is EXTRACTED and its body parsed; prose before/after the
 *     block is allowed;
 *   - MALFORMED JSON inside the stripped/extracted fence still FAILS
 *     (a fence never silently accepts a broken payload);
 *   - a text with NO complete fence pair (no fence at all, or an
 *     unterminated opening) falls to the raw parse -- the honest
 *     failure;
 *   - the raw-JSON path stays the machine-lane DEFAULT (the fake lane
 *     never fences; `fenceTolerant` is opt-in, set by the exercises for
 *     live-provider mode only).
 *
 * Harness module (build/flauz/dogfood/**): NOT a gate instrument.
 */

/** Matches a leading fence line at the very start (optional info string, e.g. ```json). */
const LEADING_FENCE = /^\s*```[ \t]*[A-Za-z0-9_.+-]*[ \t]*\r?\n/;

/** Matches a trailing fence line at the very end (only whitespace after it). */
const TRAILING_FENCE = /\r?\n[ \t]*```\s*$/;

/**
 * P2-FIX-120: matches a COMPLETE fence-OPENING line anywhere in the text
 * (horizontal whitespace, then ``` with an optional info string, then
 * nothing else on the line).
 */
const FENCE_OPEN_LINE = /^[ \t]*```[ \t]*[A-Za-z0-9_.+-]*[ \t]*\r?$/;

/**
 * P2-FIX-120: matches a COMPLETE fence-CLOSING line anywhere in the text
 * (a BARE ``` line -- a fence line carrying an info string never closes
 * a block; it is interior content).
 */
const FENCE_CLOSE_LINE = /^[ \t]*```[ \t]*\r?$/;

/** The outcome of one strip attempt: whether a fence pair was stripped, and the body to parse. */
export interface FenceStripOutcome {
        readonly fenced: boolean;
        readonly body: string;
}

/**
 * Strips ONE leading/trailing markdown fence pair around a JSON payload.
 * Never throws; when the text is not a cleanly-fenced payload it is
 * returned unchanged (`fenced: false`) and the caller's raw parse fails
 * honestly.
 */
export function stripMarkdownJsonFence(text: string): FenceStripOutcome {
        const leading = LEADING_FENCE.exec(text);
        if (leading === null) {
                return { fenced: false, body: text };
        }
        const trailing = TRAILING_FENCE.exec(text);
        if (trailing === null) {
                return { fenced: false, body: text };
        }
        return { fenced: true, body: text.slice(leading[0].length, text.length - trailing[0].length) };
}

/**
 * The outcome of one extraction attempt: whether a COMPLETE fenced
 * block was found, and its body (the raw text when not found).
 */
export interface FenceExtractOutcome {
        readonly found: boolean;
        readonly body: string;
}

/**
 * P2-FIX-120: extracts the FIRST COMPLETE fenced block from anywhere in
 * the text -- a fence-OPENING line (``` or ```info), then content, then
 * a matching fence-CLOSING line. Prose BEFORE/AFTER the block is
 * allowed (the live model's conversational wrapping); the block's
 * interior is returned verbatim as the body to parse (the same body
 * semantics as the W2.1 clean-pair strip: the line breaks hugging the
 * fence lines belong to the fence, not the payload).
 *
 * Never throws. A text with NO complete fence pair (no fence at all, or
 * an opening that is never closed) is returned unchanged (`found:
 * false`) and the caller's raw parse fails honestly. When the first
 * fence-opening line is never closed, no later complete pair can exist
 * without closing it (any later bare ``` line WOULD close it), so the
 * search stops there.
 */
export function extractFirstFencedJsonBlock(text: string): FenceExtractOutcome {
        const lines = text.split('\n');
        let lineStart = 0;
        for (let openIndex = 0; openIndex < lines.length; openIndex += 1) {
                const openLine = lines[openIndex] ?? '';
                if (FENCE_OPEN_LINE.test(openLine)) {
                        const innerStart = lineStart + openLine.length + 1; // past the opening line's line break
                        let cursor = innerStart;
                        for (let closeIndex = openIndex + 1; closeIndex < lines.length; closeIndex += 1) {
                                const innerLine = lines[closeIndex] ?? '';
                                if (FENCE_CLOSE_LINE.test(innerLine)) {
                                        // the body ends before the line break that precedes the closing
                                        // fence line (the clean-pair body semantics)
                                        let end = cursor;
                                        if (end > innerStart && text.charAt(end - 1) === '\n') {
                                                end -= 1;
                                                if (end > innerStart && text.charAt(end - 1) === '\r') {
                                                        end -= 1;
                                                }
                                        }
                                        return { found: true, body: text.slice(innerStart, end) };
                                }
                                cursor += innerLine.length + 1;
                        }
                        return { found: false, body: text };
                }
                lineStart += openLine.length + 1;
        }
        return { found: false, body: text };
}

/**
 * The answer-parse options shared by the exercises' answer contracts.
 * `fenceTolerant` is set for LIVE lanes only (P2-FIX-118/P2-FIX-120);
 * the default (`false`) keeps the raw-JSON path as the machine-lane
 * default.
 */
export interface AnswerParseOptions {
        readonly fenceTolerant?: boolean;
}

/**
 * The fence-removal path that produced a fence-tolerant parse body
 * (`via` is absent on the raw path -- no fence was removed).
 */
export type FenceRemovalVia = 'clean-pair' | 'extracted';

/**
 * The composed fence-tolerant outcome: the body to parse, whether a
 * fence was removed, and WHICH path removed it (P2-FIX-120 -- the
 * receipts/tests pin the path, not just the boolean).
 */
export interface FenceTolerantOutcome {
        readonly fenced: boolean;
        readonly body: string;
        readonly via?: FenceRemovalVia;
}

/**
 * The fence-tolerant body resolution for the LIVE-lane answer contracts
 * (P2-FIX-118 + P2-FIX-120): the W2.1 clean-pair strip FIRST
 * (back-compat -- byte-identical behavior for the clean shapes), then
 * the P2-FIX-120 extraction fallback (the FIRST COMPLETE fenced block
 * from anywhere in the text; prose before/after allowed). Machine lanes
 * (`fenceTolerant` unset/false) parse raw JSON only -- the W1 evidence
 * path, unchanged.
 */
export function fenceTolerantParseBody(text: string, options?: AnswerParseOptions): FenceTolerantOutcome {
        if (options?.fenceTolerant !== true) {
                return { fenced: false, body: text };
        }
        const cleanPair = stripMarkdownJsonFence(text);
        if (cleanPair.fenced) {
                return { fenced: true, body: cleanPair.body, via: 'clean-pair' };
        }
        const extracted = extractFirstFencedJsonBlock(text);
        if (extracted.found) {
                return { fenced: true, body: extracted.body, via: 'extracted' };
        }
        return { fenced: false, body: text };
}
