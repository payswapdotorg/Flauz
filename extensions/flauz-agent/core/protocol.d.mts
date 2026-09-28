/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Type declarations for `core/protocol.mjs` (the TL1-003 versioned seam
 * protocol). Hand-written per the zero-dependency discipline (the
 * contracts.d.mts / a2a.d.mts pattern): the .mjs is never loaded from
 * shipped extension code; tests and the conformance suite import the
 * runtime module directly and get these types via the sibling-declaration
 * resolution. `src/types.ts` mirrors the client-facing wire shapes.
 */

export type SeamProtocolVersion = 'flauz.seam/v0' | 'flauz.seam/v1';

export declare const SEAM_PROTOCOL_V0: SeamProtocolVersion;
export declare const SEAM_PROTOCOL_V1: SeamProtocolVersion;
/** All supported protocol versions, ascending (last entry = latest). */
export declare const SEAM_PROTOCOL_VERSIONS: SeamProtocolVersion[];

/** Service exit code for a hello whose protocolVersions match nothing supported. */
export declare const SEAM_EXIT_PROTOCOL_MISMATCH: 4;

/** The v1 structured error envelope: {code, message, details?}, code in the flauz.err.* namespace. */
export interface SeamStructuredError {
	code: string;
	message: string;
	details?: Record<string, unknown>;
}

export type SeamNegotiation =
	| { ok: true; version: SeamProtocolVersion }
	| { ok: false; error: SeamStructuredError };

/**
 * Negotiate from a hello's `protocolVersions` field: absent/null/non-array
 * -> v0; array -> highest mutually supported entry; no overlap -> the
 * structured flauz.err.unsupported-version rejection.
 */
export declare function negotiateProtocolVersion(clientVersions: unknown): SeamNegotiation;

export interface SeamMethodInfo {
	namespace: string;
	since: SeamProtocolVersion;
	versions: SeamProtocolVersion[];
	status: 'stable' | 'legacy' | 'skeleton';
	note?: string;
}

/** The method namespace registry — the single source of truth for dispatch + version gating. */
export declare const SEAM_METHODS: Record<string, SeamMethodInfo>;

/** Every method of the fail-closed auth skeleton. */
export declare const AUTH_METHODS: string[];

/** Protocol versions at which `method` is dispatchable, or null when unregistered. */
export declare function seamMethodVersions(method: string): SeamProtocolVersion[] | null;

/** Capability namespaces advertised in the v1 ready (auth skeleton advertises none). */
export declare function capabilitiesForVersion(version: string): string[];

export declare const SEAM_ERROR_CODES: Record<
	'UNSUPPORTED_VERSION' | 'UNKNOWN_METHOD' | 'INVALID_PARAMS' | 'INTERNAL' | 'NOT_IMPLEMENTED',
	string
>;

export declare function seamError(code: string, message: string, details?: Record<string, unknown>): SeamStructuredError;
export declare function isSeamError(value: unknown): value is SeamStructuredError;
/** v0 string projection of a structured error: "<code>: <message>". */
export declare function seamErrorToString(error: SeamStructuredError): string;

export declare const SEAM_EVENT_ENVELOPE_TYPE: 'event';

/** Server-initiated event envelope — field-aligned with FlauzEventEnvelope (ARCHITECTURE-LOCK §5). */
export interface SeamEventEnvelope {
	type: 'event';
	event: string;
	payload: Record<string, unknown>;
	ts: number;
}

export declare function seamEvent(event: string, payload: Record<string, unknown>, ts?: number): SeamEventEnvelope;
export declare function isSeamEvent(value: unknown): value is SeamEventEnvelope;
