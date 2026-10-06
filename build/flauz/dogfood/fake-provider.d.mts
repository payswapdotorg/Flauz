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
 *
 * A-PROD-003-W8 note: this declaration set was RE-SYNCED to the landed
 * runtime module (the W7 station landing had left it stale -- the
 * tools-lane surface and the browser-policy lane were undeclared); the
 * W8 lanes (environments-lifecycle + workspace-continuity) are declared
 * from birth.
 */

/** The repo-relative module the exploration question is about (the canonical evidence ledger). */
export declare const CANONICAL_LEDGER_MODULE: string;

/** The tools lane's SOUND superset search command (the A-PROD-003-W7 lane). */
export declare const TOOLS_LANE_SEARCH_COMMAND: string;

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

/** W7: the browser-policy outcome-map answer, computed from the prompt-carried facts. */
export type AnswerBrowserPolicyFromPromptOutcome =
    | { readonly ok: true; readonly answer: { readonly schema: string; readonly question: string; readonly method: string; readonly navigations: unknown; readonly dropRecovery: unknown } }
    | { readonly ok: false; readonly error: string };

export declare function answerBrowserPolicyFromPrompt(prompt: string): AnswerBrowserPolicyFromPromptOutcome;

/** W7: the tools-lane scripted agent turn (the directive or the answer document, raw JSON). */
export declare function toolsAgentTurn(prompt: string): string;

/** W8: the environments-lifecycle answer, computed from the prompt-carried op-sequence facts. */
export type AnswerEnvironmentsLifecycleFromPromptOutcome =
    | {
        readonly ok: true;
        readonly answer: {
            readonly schema: string;
            readonly question: string;
            readonly method: string;
            readonly environments: Readonly<Record<string, string>>;
            readonly opsLedger: { readonly rows: number; readonly kinds: Readonly<Record<string, number>> };
            readonly failureLegs: readonly { readonly leg: string; readonly verdict: 'illegal' | 'rejected'; readonly code: string }[];
        };
    }
    | { readonly ok: false; readonly error: string };

export declare function answerEnvironmentsLifecycleFromPrompt(prompt: string): AnswerEnvironmentsLifecycleFromPromptOutcome;

/** W8: the workspace-continuity answer, computed from the prompt-carried continuity facts. */
export type AnswerWorkspaceContinuityFromPromptOutcome =
    | {
        readonly ok: true;
        readonly answer: {
            readonly schema: string;
            readonly question: string;
            readonly method: string;
            readonly bundleId: string;
            readonly restoreOutcomes: readonly { readonly surface: string; readonly outcome: string }[];
            readonly redactedSurfaces: readonly { readonly surface: string; readonly why: string }[];
            readonly failureLegs: readonly { readonly leg: string; readonly code: string }[];
        };
    }
    | { readonly ok: false; readonly error: string };

export declare function answerWorkspaceContinuityFromPrompt(prompt: string): AnswerWorkspaceContinuityFromPromptOutcome;

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
    readonly toolsComputations: number;
    readonly environmentsComputations: number;
    readonly continuityComputations: number;
    readonly close: () => void;
}>;
