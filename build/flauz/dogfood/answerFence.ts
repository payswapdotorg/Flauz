/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * A-PROD-003-W2.1 (P2-FIX-118) -- the markdown-fence-tolerant answer
 * extraction.
 *
 * The W2 live-provider run (records banked at
 * build/flauz/dogfood/records/w2-live-provider-2026-10-01/) surfaced the
 * classic real-model integration behavior: the live glm-4-plus answered
 * the provider-configuration question with a CORRECT-shaped JSON
 * payload wrapped in a markdown code fence, and the answer contract's
 * raw-JSON parse rejected it on formatting alone ("the completion is
 * not valid JSON: Unexpected token '`'").
 *
 * The fix lives at the harness seam (this module + the exercises' parse
 * functions): strip-fence-then-parse for LIVE lanes. The discipline:
 *
 *   - a LEADING fence line (``` or ```json, optional info string) plus a
 *     TRAILING fence line -- one pair around the payload -- is stripped;
 *   - MALFORMED JSON inside the fence still FAILS (the fence never
 *     silently accepts a broken payload);
 *   - a partial fence (opening without closing, or prose after the
 *     closing fence) is NOT stripped -- the raw parse fails honestly;
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
 * The answer-parse options shared by the exercises' answer contracts.
 * `fenceTolerant` is set for LIVE lanes only (P2-FIX-118); the default
 * (`false`) keeps the raw-JSON path as the machine-lane default.
 */
export interface AnswerParseOptions {
        readonly fenceTolerant?: boolean;
}
