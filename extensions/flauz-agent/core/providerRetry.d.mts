/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Type declarations for `core/providerRetry.mjs` (the bounded provider-retry
 * executor - the TL2-F2 INV-2 contract). Hand-written per the zero-dependency
 * discipline (contracts.d.mts pattern).
 */

import type { OrchestrationStore } from './orchStore.d.mts';
import type { EffectSink, EffectSpec, EffectSinkResult } from './runtime.d.mts';

export declare const PROVIDER_RETRY_MAX_ATTEMPTS_DEFAULT: 3;
export declare const RETRY_AFTER_CAP_MS: 30000;

/** The DL-36 routing-policy state family additive bound config (absent -> default 3). */
export interface ProviderRetryConfig {
	maxAttempts?: number;
}

/** The DL-35 typed provider error a sink surfaced on a failed effect (structural fields of flauz-models ProviderError). */
export interface ProviderErrorShape {
	code: string;
	retryClass: 'none' | 'immediate' | 'short-backoff' | 'long-backoff';
	retryAfterMs?: number;
}

export declare function resolveProviderRetryBound(config: ProviderRetryConfig | null | undefined): number;
export declare function readProviderError(effect: unknown): ProviderErrorShape | null;
export declare function isRetryableProviderError(providerError: ProviderErrorShape | null): boolean;
export declare function providerRetryWaitMs(providerError: ProviderErrorShape): number;
export declare function providerAttemptKeyOf(windowKey: string, attemptOrdinal: number): string;
export declare function defaultProviderRetryWait(ms: number): Promise<void>;

export interface ProviderRetryWindowResult {
	effect: EffectSinkResult;
	providerAttempts: number;
	exhausted: boolean;
}

export interface ProviderRetryInput {
	graphId: string;
	stepId: string;
	start: { attempt: number; idempotencyKey: string };
	spec: EffectSpec;
	actor?: string;
	origin?: string;
	providerRetry?: ProviderRetryConfig | null;
	wait?: (ms: number) => Promise<void>;
}

export declare function runProviderCallWithBoundedRetry(store: OrchestrationStore, sink: EffectSink, input: ProviderRetryInput): Promise<ProviderRetryWindowResult>;
