/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Type declarations for `core/serviceBoundary.mjs` (the TL2-S1 Agent OS
 * service boundary). Hand-written per the zero-dependency discipline (the
 * contracts.d.mts / protocol.d.mts pattern): the .mjs is a Node-runtime
 * module (it composes src/seamClient.ts and core/protocol.mjs and is
 * consumed by the orchestration side + node --test suites, never bundled
 * into the shipped extension); these types serve every static consumer.
 */

import type {
	AppendEventResult,
	AppendEvidenceResult,
	CreateCheckpointResult,
	CreateTaskResult,
	GetTaskResult,
	ListTasksResult,
	SeamEventEnvelope,
	SeamHealthPingResult,
	SeamHealthStatusResult,
	SeamLifecycleInitializeResult,
	SeamLifecycleShutdownResult,
	Task,
	TaskEvent,
	EvidenceRowInput,
	VerifyLedgerResult,
} from '../src/types.ts';
import type { A2aMessage, A2aMessageInput } from './a2a.d.mts';

/** The adapter's machine-readable failure-code namespace (closed set). */
export declare const BOUNDARY_FAILURE_CODES: {
	readonly PROTOCOL_MISMATCH: 'flauz.os.err.protocol-mismatch';
	readonly METHOD_UNAVAILABLE: 'flauz.os.err.method-unavailable';
	readonly SEAM_REJECTED: 'flauz.os.err.seam-rejected';
	readonly SERVICE_DIED: 'flauz.os.err.service-died';
	readonly OUTCOME_UNKNOWN: 'flauz.os.err.outcome-unknown';
	readonly REQUEST_TIMEOUT: 'flauz.os.err.request-timeout';
	readonly NOT_CONNECTED: 'flauz.os.err.not-connected';
};

/** Retry hints (closed set): how a caller may proceed after a failure. */
export declare const BOUNDARY_RETRY_HINTS: readonly ['never', 'reconnect-then-retry', 'reconcile-then-new-attempt'];

export type BoundaryFailureCode = (typeof BOUNDARY_FAILURE_CODES)[keyof typeof BOUNDARY_FAILURE_CODES];
export type BoundaryRetryHint = (typeof BOUNDARY_RETRY_HINTS)[number];

/** Per-code default semantics (machine-checkable failure table). */
export declare const BOUNDARY_FAILURE_CLASSES: Record<BoundaryFailureCode, { retryable: boolean; retryHint: BoundaryRetryHint }>;

/** Default capability namespaces the Agent OS requires of a v1 service. */
export declare const DEFAULT_REQUIRED_CAPABILITIES: readonly string[];

/** Effect classes the adapter distinguishes for failure semantics. */
export type SeamMethodClass = 'read-only' | 'idempotent' | 'side-effecting';

/** Classify a seam method for failure semantics. */
export declare function seamMethodClass(method: string): SeamMethodClass;

/**
 * A machine-readable boundary failure: `code` (closed set), `message`,
 * `details` (seamCode/method/reason/phase/...), `retryHint`, `retryable`.
 */
export declare class BoundaryFailure extends Error {
	readonly name: 'BoundaryFailure';
	readonly code: BoundaryFailureCode;
	readonly details: Record<string, unknown>;
	readonly retryHint: BoundaryRetryHint;
	readonly retryable: boolean;
}

export type SeamGateVerdict = { ok: true } | { ok: false; failure: BoundaryFailure };

/**
 * Gate one seam method against a negotiated version + advertised
 * capabilities (derived from the core/protocol.mjs registry).
 */
export declare function gateSeamMethod(method: string, negotiatedVersion: string, capabilities: readonly string[]): SeamGateVerdict;

/** Classify a failed seam send into the boundary failure taxonomy. */
export declare function classifySendFailure(method: string, error: unknown): BoundaryFailure;

/** Boundary-level (non-seam) lifecycle observation record for supervision. */
export interface BoundaryEventRecord {
	boundaryEvent: string;
	payload: Record<string, unknown>;
	ts: number;
}

export declare function boundaryEvent(boundaryEvent: string, payload: Record<string, unknown>): BoundaryEventRecord;

export interface BoundaryOptions {
	/** Absolute path of the workspace root the service operates on. */
	workspaceRoot: string;
	/** Extension globalStorage path (the v0 event relay mirror). */
	globalStoragePath?: string;
	/** Node binary used to spawn the service (defaults to process.execPath). */
	nodePath?: string;
	/** Path to core/service.mjs (defaults to the copy next to src/). */
	servicePath?: string;
	/** Injectable spawn for tests. */
	spawnFn?: unknown;
	connectTimeoutMs?: number;
	requestTimeoutMs?: number;
	/** Diagnostic sink. */
	logger?: (message: string) => void;
	/** Seam event envelopes (v1 wire events), with adapter bookkeeping. */
	onEvent?: (event: SeamEventEnvelope) => void;
	/** Process-exit supervision hook (fires once per live generation). */
	onExit?: (code: number | null, error: Error | undefined) => void;
	/** Boundary lifecycle observations (connected/disconnected/event-gap/reconnected/recovered/health-degraded/shutdown). */
	onBoundaryEvent?: (record: BoundaryEventRecord) => void;
	/** Capability namespaces required of a v1 service (default: flauz.a2a + flauz.workspace). */
	requiredCapabilities?: readonly string[];
	/** Affirm bring-up with flauz.lifecycle.initialize at v1 (default: true). */
	affirmLifecycle?: boolean;
}

export interface BoundaryCallOptions {
	/** Attempt key (the <surface>/<id>/run/<attempt> house pattern). */
	idempotencyKey?: string;
}

/** The logical state re-read over the seam (listTasks + verifyLedger + a2a.list). */
export interface AgentOsStateSnapshot {
	tasks: Task[];
	ledger: { ok: true; rows: number } | { ok: false; rows: number; firstBadSeq?: number };
	a2a: { agents: Array<{ agentId: string; pending: number }> } | null;
}

/** The recovery report (recover(): re-spawn, re-hello, re-negotiate, re-read). */
export interface BoundaryRecoveryReport {
	generation: number;
	protocolVersion: string;
	capabilities: string[];
	protocolVersionChanged: boolean;
	lifecycle: SeamLifecycleInitializeResult | null;
	snapshot: AgentOsStateSnapshot;
	eventGap: true;
}

export interface BoundaryStartReport {
	protocolVersion: string;
	capabilities: string[];
	lifecycle: SeamLifecycleInitializeResult | null;
	servicePid: number | undefined;
}

export interface HealthWatchOptions {
	intervalMs?: number;
	onUnhealthy?: (failure: BoundaryFailure) => void;
}

/** The Agent OS service boundary (construct via AgentOsServiceBoundary.start()). */
export declare class AgentOsServiceBoundary {
	static start(options: BoundaryOptions): Promise<AgentOsServiceBoundary>;
	private constructor(options: BoundaryOptions);

	readonly protocolVersion: string | null;
	readonly capabilities: readonly string[];
	readonly connected: boolean;
	readonly servicePid: number | undefined;
	readonly generation: number;
	readonly eventsReceived: number;
	readonly lastEventTs: number | null;
	readonly startReport: BoundaryStartReport | null;

	describe(): Record<string, unknown>;

	call<T = unknown>(method: string, args?: Record<string, unknown>, options?: BoundaryCallOptions): Promise<T>;

	createTask(title: string, options?: BoundaryCallOptions): Promise<CreateTaskResult>;
	appendEvent(taskId: string, event: Omit<TaskEvent, 'ts'> & { ts?: number }, options?: BoundaryCallOptions): Promise<AppendEventResult>;
	listTasks(options?: BoundaryCallOptions): Promise<ListTasksResult>;
	getTask(taskId: string, options?: BoundaryCallOptions): Promise<GetTaskResult>;
	appendEvidence(taskId: string, row: EvidenceRowInput, options?: BoundaryCallOptions): Promise<AppendEvidenceResult>;
	createCheckpoint(taskId: string, requestId: string, stopId?: string, options?: BoundaryCallOptions): Promise<CreateCheckpointResult>;
	verifyLedger(options?: BoundaryCallOptions): Promise<VerifyLedgerResult>;

	a2aPost(message: A2aMessageInput, options?: BoundaryCallOptions): Promise<{ id: string; seq: number; message: A2aMessage }>;
	a2aCollect(agentId: string, consume?: boolean, options?: BoundaryCallOptions): Promise<{ messages: A2aMessage[] }>;
	a2aList(options?: BoundaryCallOptions): Promise<{ agents: Array<{ agentId: string; pending: number }> }>;

	healthPing(options?: BoundaryCallOptions): Promise<SeamHealthPingResult>;
	healthStatus(options?: BoundaryCallOptions): Promise<SeamHealthStatusResult>;
	lifecycleInitialize(options?: BoundaryCallOptions): Promise<SeamLifecycleInitializeResult>;
	lifecycleShutdown(options?: BoundaryCallOptions): Promise<SeamLifecycleShutdownResult>;

	snapshot(options?: { includeA2a?: boolean }): Promise<AgentOsStateSnapshot>;
	recover(): Promise<BoundaryRecoveryReport>;

	startHealthPoll(watch?: HealthWatchOptions): ReturnType<typeof setInterval>;
	stopHealthPoll(): void;
	shutdown(): Promise<void>;
	dispose(): Promise<void>;
}
