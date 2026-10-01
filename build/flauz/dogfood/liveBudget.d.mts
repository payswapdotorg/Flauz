/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Type declarations for `liveBudget.mjs` (the A-PROD-003-W3.2 dogfood
 * P2-FIX-121 module: the live completion-budget knob + the
 * finish-reason surfacing). Hand-written per the zero-dependency
 * discipline (the frictionlog.d.mts pattern) so the harness's
 * TypeScript modules and tests typecheck against the real runtime
 * module without a repo install.
 */

/** The env-only completion-budget knob's name (P2-FIX-121; fail-closed on a malformed value). */
export declare const LIVE_MAX_TOKENS_ENV: 'FLAUZ_DOGFOOD_LIVE_MAX_TOKENS';

/** The generous default completion budget in tokens when the knob is absent (P2-FIX-121). */
export declare const DEFAULT_LIVE_MAX_TOKENS: 32768;

/**
 * Why the model stopped generating. Mirrors the product contract's
 * FinishReason (extensions/flauz-models/src/contract/types.ts) --
 * declared locally per the zero-dependency declaration discipline
 * (structurally identical, so the product's values assign through).
 */
export type FinishReason = 'stop' | 'length' | 'tool-calls' | 'content-filter' | 'other';

/** parseLiveMaxTokens: absent -> the default; a positive safe integer -> the env value; anything else -> fail-closed. */
export type LiveMaxTokens =
	| { readonly ok: true; readonly tokens: number; readonly source: 'default' | 'env' }
	| { readonly ok: false; readonly error: string };

export declare function parseLiveMaxTokens(raw: string): LiveMaxTokens;

/**
 * One adapter stream event, loosely typed: `type` discriminates; the
 * consumers read what they need (text-delta.text, finish.finishReason).
 * Loose on purpose so the REAL adapter's event union (the product's
 * ProviderStreamEvent) and synthetic test streams assign through
 * without the declaration importing product types.
 */
export interface AskStreamEvent {
	readonly type: string;
	readonly text?: string;
	readonly finishReason?: FinishReason;
	readonly [key: string]: unknown;
}

/** The ask-stream outcome core: the joined text + the terminal finish event's reason. */
export interface AskStreamOutcome {
	readonly text: string;
	readonly finishReason: FinishReason;
}

export declare function consumeAskStream(stream: AsyncIterable<AskStreamEvent>): Promise<AskStreamOutcome>;

export declare function finishReasonDetail(finishReason: FinishReason): string;

export declare function isTruncatedFinish(finishReason: FinishReason): boolean;

export declare function answerParseFailDetail(parseError: string, finishReason: FinishReason): string;
