/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * A-PROD-003-W1 (dogfood harness) -- the harness/exercise contracts.
 *
 * The types the driver and the exercise scripts share. Every seam type
 * is imported from the REAL product modules (the journey-drill
 * discipline): TaskService, EvidenceLedger, MemoryStore from
 * flauz-workspace/flauz-memory src, OrchestrationStore from the
 * flauz-agent core declarations. Nothing here redefines a product
 * contract; the harness only shapes what it injects.
 */

import type { TaskService } from '../../../extensions/flauz-workspace/src/taskService.ts';
import type { EvidenceLedger } from '../../../extensions/flauz-workspace/src/ledger.ts';
import type { MemoryStore } from '../../../extensions/flauz-memory/src/memory.ts';
import type { OrchestrationStore } from '../../../extensions/flauz-agent/core/orchStore.mjs';
import type { FinishReason } from '../../../extensions/flauz-models/src/contract/types.ts';
import type { FrictionLog } from './frictionlog.mjs';

/** The selectable provider lanes of the harness (the work order's vendor-neutral contract). */
export type ProviderLaneId = 'fake' | 'scripted-failing' | 'live';

/** Which lane plays the "healthy" role in this run (the fake lane in the W1 sandbox; live at the station in W2). */
export type DogfoodMode = 'fake-lane' | 'live-provider';

/** Receipt of one provider-lane selection (the providers-file enablement act + its evidence row). */
export interface LaneSwitchReceipt {
        readonly switchNo: number;
        readonly lane: ProviderLaneId;
        readonly providerId: string;
        readonly enabledLanes: readonly string[];
        readonly providersFileSha256: string;
        readonly evidenceId: string;
        readonly seq: number;
        readonly at: number;
}

/** A successful model call through the real fabric (route + adapter stream). */
export interface AskOk {
        readonly kind: 'ok';
        readonly text: string;
        readonly decisionId: string;
        readonly providerId: string;
        readonly modelId: string;
        readonly durationMs: number;
        readonly attempts: number;
        /** P2-FIX-117: the wall-clock budget that governed this ask (wired through AdapterConfig.requestTimeoutMs). */
        readonly wallClockBudgetMs: number;
        /**
         * P2-FIX-121: why the model stopped, from the adapter's terminal finish
         * event (the fake lanes finish 'stop'; the live vendor streams its own
         * reason). A `length` finish is the token-budget truncation class: the
         * ask receipts mark it as a VISIBLE TRUNCATED, never a silent ok.
         */
        readonly finishReason: FinishReason;
}

/** A typed provider failure surfaced by the real adapter (the product's own error taxonomy). */
export interface AskProviderFailure {
        readonly kind: 'provider-failure';
        readonly code: string;
        readonly retryable: boolean;
        readonly retryClass: string;
        readonly status: number | undefined;
        readonly retryAfterMs: number | undefined;
        readonly message: string;
        readonly decisionId: string;
        readonly providerId: string;
        readonly modelId: string;
        readonly durationMs: number;
        readonly attempts: number;
        /** P2-FIX-117: the wall-clock budget that governed this ask (wired through AdapterConfig.requestTimeoutMs). */
        readonly wallClockBudgetMs: number;
}

export type AskOutcome = AskOk | AskProviderFailure;

/**
 * The context handed to an ask-time prompt builder: the ask's durable
 * routing decision has already been minted when the builder runs
 * (P2-FIX-119 -- facts embedded at ask time include it).
 */
export interface AskPromptContext {
        readonly decisionId: string;
}

/**
 * One ask prompt: either the literal text, or a builder invoked INSIDE
 * the ask window -- after the durable routing decision, right before
 * the request ships (P2-FIX-119: the provider-switch question embeds
 * the workspace facts at ask time).
 */
export type AskPrompt = string | ((context: AskPromptContext) => string | Promise<string>);

/**
 * The Model Fabric facade the exercises drive: `selectLane` performs the
 * real enablement act (workspace providers file + routing policy +
 * registry reload) and mints one evidence row per switch; `ask` routes
 * one request through the real ModelRouter (a durable decision per
 * call) and streams the completion through the real adapter.
 */
export interface ProviderLaneFacade {
        selectLane(lane: ProviderLaneId): Promise<LaneSwitchReceipt>;
        ask(prompt: AskPrompt): Promise<AskOutcome>;
}

/** The harness context an exercise runs against (all REAL product seams; one workspace root per run). */
export interface DogfoodHarness {
        readonly runId: string;
        readonly mode: DogfoodMode;
        readonly root: string;
        readonly repoRoot: string;
        readonly recordsDir: string;
        readonly clock: () => number;
        readonly friction: FrictionLog;
        readonly tasks: TaskService;
        readonly ledger: EvidenceLedger;
        readonly memory: MemoryStore;
        readonly store: OrchestrationStore;
        readonly provider: ProviderLaneFacade;
        readonly exerciseId: string;
        readonly taskId: string;
        readonly graphId: string;
        readonly stepId: string;
        readonly log: (line: string) => void;
}

/** One assertion of an exercise receipt (the journey recorder discipline: a false check FAILs). */
export interface ExerciseCheck {
        readonly id: string;
        readonly ok: boolean;
        readonly detail: string;
}

/** The per-exercise receipt (schema flauz.dogfood-exercise-receipt/v1 on disk). */
export interface ExerciseReceipt {
        readonly schema: 'flauz.dogfood-exercise-receipt/v1';
        readonly exerciseId: string;
        readonly title: string;
        readonly dimensions: readonly string[];
        readonly verdict: 'PASS' | 'FAIL';
        readonly checks: readonly ExerciseCheck[];
        readonly evidenceIds: readonly string[];
        readonly evidenceItems: readonly EvidenceItem[];
        readonly frictionLogPath: string;
        readonly frictionRows: { readonly friction: number; readonly timing: number; readonly recovery: number };
        readonly evidenceLevels: { readonly seams: string; readonly modelIntelligence: string };
        readonly notes: readonly string[];
}

/** An exercise script the driver executes against the real seams. */
export interface DogfoodExercise {
        readonly id: string;
        readonly title: string;
        readonly prompt: string;
        readonly dimensions: readonly string[];
        readonly run: (harness: DogfoodHarness) => Promise<ExerciseReceipt>;
}

/** The evidence item shape finishStep carries (the store's EvidenceItemInput). */
export interface EvidenceItem {
        readonly kind: string;
        readonly uri: string;
        readonly sha256: string;
}
