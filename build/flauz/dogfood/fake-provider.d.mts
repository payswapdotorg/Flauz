/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Type declarations for `fake-provider.mjs` (the A-PROD-003 dogfood
 * fake/scripted provider lanes). Hand-written per the zero-dependency
 * discipline (the frictionlog.d.mts pattern) so the harness's TypeScript
 * modules and tests typecheck against the real runtime module without a
 * repo install.
 */

/** The repo-relative module the exploration question is about (the canonical evidence ledger). */
export declare const CANONICAL_LEDGER_MODULE: string;

/** One consumer entry of the exploration answer map. */
export interface FakeLaneConsumer {
    readonly file: string;
    readonly line: number;
    readonly consumes: readonly string[];
}

/** Maps every consumer of the evidence ledger across extensions/flauz-* (the fake lane's live computation). */
export declare function computeLedgerConsumerMap(repoRoot: string, ledgerModule?: string): Promise<readonly FakeLaneConsumer[]>;

/**
 * P2-FIX-119: the fake lane's prompt-facts read for the
 * provider-configuration question (both lanes answer from the
 * prompt-carried workspace facts; the server-side computation path is
 * retired).
 */
export type AnswerSwitchFromPromptOutcome =
    | { readonly ok: true; readonly answer: { readonly enabledDogfoodProviders: readonly string[]; readonly routingDecisionCount: number; readonly lastDecisionId: string } }
    | { readonly ok: false; readonly error: string };

export declare function answerSwitchFromPrompt(prompt: string): AnswerSwitchFromPromptOutcome;

/** The two local lanes on one real socket (the census counters are live getters). */
export declare function startFakeProvider(options: {
    readonly repoRoot: string;
    readonly workspaceRoot: string;
    readonly port?: number;
}): Promise<{
    readonly port: number;
    readonly chatCalls: number;
    readonly failCalls: number;
    readonly exploreComputations: number;
    readonly configPromptReads: number;
    readonly close: () => void;
}>;
