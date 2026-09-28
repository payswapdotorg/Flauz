/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Type declarations for `core/orchProtocol.mjs` (the orchestration service
 * protocol contract, TL2-001 M4). Extension source imports these types only
 * (`import type`); tests import the runtime module directly. Hand-written
 * per the zero-dependency discipline (the contracts.d.mts pattern).
 */

export declare const ORCH_PROTOCOL_V1: 'flauz.orch/v1';
export declare const ORCH_PROTOCOL_VERSIONS: string[];
export declare const ORCH_NAMESPACE: 'flauz.orch';
export declare const ORCH_CAPABILITY: 'flauz.orch';

export interface OrchMethodInfo {
	namespace: string;
	since: string;
	versions: string[];
	status: 'stable';
	note: string;
}

export declare const ORCH_METHODS: Record<string, OrchMethodInfo>;
export declare const ORCH_METHOD_NAMES: string[];
export declare function orchMethodVersions(method: string): string[] | null;

export declare const ORCH_FAILURE_CODES: {
	UNSUPPORTED_VERSION: 'flauz.orch.err.unsupported-version';
	UNKNOWN_METHOD: 'flauz.orch.err.unknown-method';
	INVALID_PARAMS: 'flauz.orch.err.invalid-params';
	NOT_READY: 'flauz.orch.err.not-ready';
	SHUTTING_DOWN: 'flauz.orch.err.shutting-down';
	UNKNOWN_GRAPH: 'flauz.orch.err.unknown-graph';
	UNKNOWN_STEP: 'flauz.orch.err.unknown-step';
	ILLEGAL_TRANSITION: 'flauz.orch.err.illegal-transition';
	NOT_IMPLEMENTED: 'flauz.orch.err.not-implemented';
	INTERNAL: 'flauz.orch.err.internal';
};
export declare const ORCH_FAILURE_CODE_VALUES: string[];

export interface OrchFailure {
	code: string;
	message: string;
	details?: Record<string, unknown>;
	/** The originating seam flauz.err.* code when this failure is a seam mapping. */
	seamCode?: string | null;
	/** The originating OrchestrationError code when this failure is a domain mapping. */
	domainCode?: string;
}

export declare function orchFailure(code: string, message: string, details?: Record<string, unknown>): OrchFailure;

/** The typed-failure carrier thrown by the mediator / transport adapter (Error subclass; .orchFailure is the envelope). */
export declare class OrchProtocolFailure extends Error {
	readonly orchFailure: OrchFailure;
	constructor(failure: OrchFailure);
}

export declare function orchFailureOf(error: unknown): OrchFailure;
export declare function isOrchFailure(value: unknown): value is OrchFailure;
export declare const ORCHESTRATION_ERROR_CODE_MAP: Record<string, string>;
export declare const SEAM_FAILURE_CODE_MAP: Record<string, string>;
export declare function mapSeamFailure(error: unknown): OrchFailure;
export declare function mapOrchestrationError(error: unknown): OrchFailure;

export type OrchNegotiation =
	| { offered: false }
	| { offered: true; ok: true; version: string }
	| { offered: true; ok: false; failure: OrchFailure };

export declare function negotiateOrchVersion(clientVersions: unknown): OrchNegotiation;
export declare function orchHelloOffer(hello: unknown): string[] | null;
export declare function composeOrchReady(ready: Record<string, unknown>, orchVersion: string | null): Record<string, unknown>;
export declare function orchSessionOf(offeredVersions: unknown, ready: unknown): { orch: boolean; version: string | null; failure: OrchFailure | null };
export declare function orchMethodDispatchable(method: string, seamVersion: string, orchVersion: string | null): boolean;
export declare function assertOrchSession(session: unknown, method: string): OrchFailure | null;

export interface OrchRequestKeys {
	required: string[];
	optional: string[];
}

export declare const ORCH_REQUEST_KEYS: Record<string, OrchRequestKeys>;
export declare function validateOrchRequest(method: string, args: unknown): string | undefined;
export declare function validateOrchResult(method: string, result: unknown): string | undefined;

export interface OrchEventInfo {
	since: string;
	note: string;
}

export declare const ORCH_EVENTS: Record<string, OrchEventInfo>;
export declare const ORCH_EVENT_NAMES: string[];
export declare const ORCH_ROW_EVENT_OF: Record<string, string>;
export declare function orchEventOfRow(row: Record<string, unknown>): { event: string; payload: Record<string, unknown> } | null;
export declare function journalRowEventOf(row: Record<string, unknown>): { event: string; payload: Record<string, unknown> };
export declare function validateOrchEventPayload(event: string, payload: unknown): string | undefined;
