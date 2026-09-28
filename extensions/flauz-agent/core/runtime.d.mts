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
import type { ProviderRetryConfig } from './providerRetry.d.mts';

export declare const EFFECT_SINK_SHAPE: string;

export interface EffectSpec {
	graphId: string;
	stepId: string;
	attempt: number;
	tool: string | null;
	toolInput: Record<string, unknown> | null;
	instruction: string;
}

/** The DL-35 typed provider error surfaced by a failed effect (the bounded retry trigger - TL2-F2). */
export interface ProviderErrorField {
	code: string;
	retryClass: 'none' | 'immediate' | 'short-backoff' | 'long-backoff';
	retryAfterMs?: number;
}

export interface EffectSinkResult {
	ok: boolean;
	value?: unknown;
	failureClass?: string;
	message?: string;
	replayed?: boolean;
	providerError?: ProviderErrorField;
}

export interface EffectSink {
	run(idempotencyKey: string, spec: EffectSpec): Promise<EffectSinkResult> | EffectSinkResult;
}

export interface DriveStartRecord {
	stepId: string;
	attempt: number;
	idempotencyKey: string;
	replayed: boolean;
	providerAttempts: number;
	providerExhausted: boolean;
}

export interface DriveReport {
	graphId: string;
	graphStatus: string;
	started: DriveStartRecord[];
	completed: boolean;
	rounds: number;
	summary: Record<string, unknown>;
}

export declare function driveGraph(store: OrchestrationStore, input: { graphId: string; sink: EffectSink; runnerId?: string; actor?: string; origin?: string; now?: number; logger?: (message: string) => void; providerRetry?: ProviderRetryConfig | null; wait?: (ms: number) => Promise<void> }): Promise<DriveReport>;
export declare function applyFailurePolicy(store: OrchestrationStore, graphId: string, state: unknown, options?: { origin?: string; now?: number }): Promise<void>;
export declare function transitiveDependents(graph: GraphRecord, failed: Set<string>): string[];
