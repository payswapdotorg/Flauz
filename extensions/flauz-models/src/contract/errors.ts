/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-002 (Worker B) -- the provider error taxonomy (M1).
 *
 * Terminal vs retryable is a CONTRACT, not a per-adapter mood: every adapter
 * maps vendor failures onto these codes and every code carries a fixed
 * retry posture. The `{ retryable, retryClass }` pair is the SHARED SEAM for
 * Worker A's durable-orchestration retry policy (TL2-001): Worker A's
 * runtime consumes `ProviderError.retryClass` / `retryAfterMs` and documents
 * his mapping in his report; the TL reconciles the two sides. Numbering of
 * decisions is left to the TL (this module only defines the shape).
 *
 * Classes:
 * - 'none'           terminal for this request -- do not retry.
 * - 'immediate'      retryable without a backoff beat (idempotent transient).
 * - 'short-backoff'  retryable with a short backoff (sub-second scale).
 * - 'long-backoff'   retryable with a long backoff (rate limits; honor
 *                    retryAfterMs when the vendor supplied it).
 */

/** Every failure class an adapter or the routing layer can produce. */
export type ProviderErrorCode =
	| 'AUTH_FAILED'
	| 'PERMISSION_DENIED'
	| 'NOT_FOUND'
	| 'BAD_REQUEST'
	| 'CONTEXT_OVERFLOW'
	| 'RATE_LIMITED'
	| 'PROVIDER_OVERLOADED'
	| 'NETWORK_ERROR'
	| 'TIMEOUT'
	| 'CANCELLED'
	| 'MALFORMED_RESPONSE'
	| 'CREDENTIAL_UNRESOLVED'
	| 'PROTOCOL_ERROR'
	| 'NO_CANDIDATE';

/** Retry posture (the Worker A seam). */
export type RetryClass = 'none' | 'immediate' | 'short-backoff' | 'long-backoff';

/**
 * The fixed retry policy per code. RATE_LIMITED is the only long-backoff
 * class; CANCELLED is terminal-by-intent (the caller asked to stop); the
 * malformed/protocol classes are terminal for the response they belong to
 * (retrying identical bytes against an identical endpoint would only burn
 * quota).
 */
export const RETRY_POLICY: Readonly<Record<ProviderErrorCode, { readonly retryable: boolean; readonly retryClass: RetryClass }>> = Object.freeze({
	AUTH_FAILED: { retryable: false, retryClass: 'none' },
	PERMISSION_DENIED: { retryable: false, retryClass: 'none' },
	NOT_FOUND: { retryable: false, retryClass: 'none' },
	BAD_REQUEST: { retryable: false, retryClass: 'none' },
	CONTEXT_OVERFLOW: { retryable: false, retryClass: 'none' },
	RATE_LIMITED: { retryable: true, retryClass: 'long-backoff' },
	PROVIDER_OVERLOADED: { retryable: true, retryClass: 'short-backoff' },
	NETWORK_ERROR: { retryable: true, retryClass: 'short-backoff' },
	TIMEOUT: { retryable: true, retryClass: 'short-backoff' },
	CANCELLED: { retryable: false, retryClass: 'none' },
	MALFORMED_RESPONSE: { retryable: false, retryClass: 'none' },
	CREDENTIAL_UNRESOLVED: { retryable: false, retryClass: 'none' },
	PROTOCOL_ERROR: { retryable: false, retryClass: 'none' },
	NO_CANDIDATE: { retryable: false, retryClass: 'none' },
});

/** Details carried on a ProviderError. */
export interface ProviderErrorDetails {
	/** HTTP status when the failure came from an HTTP response. */
	readonly status?: number;
	/** Vendor-supplied retry hint (Retry-After seconds or a wire field), in milliseconds. */
	readonly retryAfterMs?: number;
	/** The provider id the failing call belongs to. */
	readonly providerId?: string;
	/** The model id the failing call belongs to. */
	readonly modelId?: string;
	/** Underlying cause (original error object). */
	readonly cause?: unknown;
}

/** The typed provider failure -- adapters throw this, never a bare Error. */
export class ProviderError extends Error {
	readonly code: ProviderErrorCode;
	readonly retryable: boolean;
	readonly retryClass: RetryClass;
	readonly status?: number;
	readonly retryAfterMs?: number;
	readonly providerId?: string;
	readonly modelId?: string;

	constructor(code: ProviderErrorCode, message: string, details: ProviderErrorDetails = {}) {
		super(message);
		this.name = 'ProviderError';
		this.code = code;
		this.retryable = RETRY_POLICY[code].retryable;
		this.retryClass = RETRY_POLICY[code].retryClass;
		this.status = details.status;
		this.retryAfterMs = details.retryAfterMs;
		this.providerId = details.providerId;
		this.modelId = details.modelId;
		const cause = details.cause;
		if (cause !== undefined) {
			(this as { cause?: unknown }).cause = cause;
		}
	}
}

/** Structural guard for ProviderError. */
export function isProviderError(value: unknown): value is ProviderError {
	return value instanceof ProviderError;
}

/**
 * Parses a vendor Retry-After hint (seconds, integer or HTTP-date is NOT
 * supported -- integer seconds only, which is what the fixture wire carries)
 * into milliseconds. Returns undefined when absent or unparsable.
 */
export function parseRetryAfterSeconds(value: string | undefined): number | undefined {
	if (value === undefined) {
		return undefined;
	}
	const seconds = Number.parseInt(value, 10);
	if (Number.isNaN(seconds) || seconds < 0) {
		return undefined;
	}
	return seconds * 1000;
}
