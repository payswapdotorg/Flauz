/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Type declarations for `core/runtime.mjs` (the deterministic executor).
 * Hand-written per the zero-dependency discipline (contracts.d.mts pattern).
 */

import type { OrchestrationStore } from './orchStore.d.mts';
import type { GraphRecord } from './orchestration.d.mts';

export declare const EFFECT_SINK_SHAPE: string;

export interface EffectSpec {
	graphId: string;
	stepId: string;
	attempt: number;
	tool: string | null;
	toolInput: Record<string, unknown> | null;
	instruction: string;
}

export interface EffectSinkResult {
	ok: boolean;
	value?: unknown;
	failureClass?: string;
	message?: string;
	replayed?: boolean;
}

export interface EffectSink {
	run(idempotencyKey: string, spec: EffectSpec): Promise<EffectSinkResult> | EffectSinkResult;
}

export interface DriveStartRecord {
	stepId: string;
	attempt: number;
	idempotencyKey: string;
	replayed: boolean;
}

export interface DriveCancelObservation {
	rowId: string;
	evidenceId: string | null;
	reason: string;
	stepId?: string;
}

export interface DriveReport {
	graphId: string;
	graphStatus: string;
	started: DriveStartRecord[];
	completed: boolean;
	rounds: number;
	/** FLAUZ-TL2-F1 (INV-3): the typed cancellation outcome - true when the drive observed the recorded cancellation. */
	cancelled: boolean;
	cancelObservation: DriveCancelObservation | null;
	summary: Record<string, unknown>;
}

export declare function driveGraph(store: OrchestrationStore, input: { graphId: string; sink: EffectSink; runnerId?: string; actor?: string; origin?: string; now?: number; logger?: (message: string) => void }): Promise<DriveReport>;
export declare function applyFailurePolicy(store: OrchestrationStore, graphId: string, state: unknown, options?: { origin?: string; now?: number }): Promise<void>;
export declare function transitiveDependents(graph: GraphRecord, failed: Set<string>): string[];
