/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Type declarations for `core/policy.mjs` (the retry/cancel policy core).
 * Hand-written per the zero-dependency discipline (contracts.d.mts pattern).
 */

export declare const RETRY_BACKOFF_KINDS: string[];
export declare const TERMINAL_FAILURE_CLASSES: string[];
export declare const RETRYABLE_FAILURE_CLASSES: string[];
export declare const ALL_FAILURE_CLASSES: string[];
export declare const CANCEL_CAUSES: string[];
export declare const DEFAULT_RETRY_POLICY: Readonly<RetryPolicy>;

export interface RetryPolicy {
	maxAttempts: number;
	backoff: { kind: string; baseMs: number; maxMs?: number };
	retryOn: string[];
}

export declare function validateRetryPolicy(value: unknown): { ok: true; policy: RetryPolicy } | { ok: false; error: string };
export declare function classifyFailure(failure: unknown): string;
export declare function backoffDelayMs(policy: RetryPolicy, attempt: number, now?: number): number;
export declare function planRetry(input: { policy: RetryPolicy; attempt: number; failureClass: string; now: number }):
	| { retry: true; nextAttempt: number; nextAttemptAt: number; delayMs: number }
	| { retry: false; reason: 'terminal-class' | 'attempts-exhausted' };
export declare function planCancellation(steps: Record<string, { status: string }>): { cancelStepIds: string[] };
