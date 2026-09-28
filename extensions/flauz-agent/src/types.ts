/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Shared seam types for the Flauz Agent Bridge (F side).
 *
 * The transition/ledger logic itself lives in `core/contracts.mjs` (G side);
 * these types mirror the wire shapes so both sides compile against one
 * description of the seam contract section H.
 */

export type TaskStatus =
	| 'plan'
	| 'awaiting-approval'
	| 'execute'
	| 'verify'
	| 'awaiting-signoff'
	| 'failed'
	| 'done'
	| 'cancelled';

export type EventActor = 'agent' | 'human' | 'tool';

export interface TaskEvent {
	ts: number;
	actor: EventActor;
	type: string;
	payload: Record<string, unknown>;
}

export interface TaskChange {
	uri: string;
	checkpointRef: string | null;
}

export interface TaskTiming {
	created: number;
	updatedAt: number;
}

export interface Task {
	id: string;
	title: string;
	status: TaskStatus;
	events: TaskEvent[];
	timing: TaskTiming;
	changes: TaskChange[];
}

export interface TaskEnvelope {
	$schema: string;
	tasks: Task[];
}

export type EvidenceKind = 'changeset' | 'screenshot' | 'command-output' | 'note';

export interface EvidenceRowInput {
	kind: EvidenceKind;
	uri: string;
	sha256: string;
	note?: string;
}

/** Command result shapes from the `flauz.workspace.*` seam. */
export interface CreateTaskResult {
	taskId: string;
}

export interface AppendEventResult {
	task: Task;
}

export interface ListTasksResult {
	tasks: Task[];
}

export interface GetTaskResult {
	task: Task;
}

export interface AppendEvidenceResult {
	evidenceId: string;
	seq: number;
}

export interface CreateCheckpointResult {
	checkpointRef: string | null;
}

export interface VerifyLedgerResult {
	ok: boolean;
	rows: number;
	firstBadSeq?: number;
}

/**
 * Seam protocol versions (TL1-003; `core/protocol.mjs` is the runtime source
 * of truth, `core/protocol.d.mts` its typed mirror). v0 is the frozen wire
 * contract; v1 is the additive negotiated extension.
 */
export type SeamProtocolVersion = 'flauz.seam/v0' | 'flauz.seam/v1';

/**
 * The v1 structured error envelope: `{code, message, details?}` with
 * machine-readable `flauz.err.*` codes. A v0 service keeps the plain string
 * error shape (hard backward-compat bound).
 */
export interface SeamStructuredError {
	code: string;
	message: string;
	details?: Record<string, unknown>;
}

/**
 * The v1 server-initiated event envelope on the service stdout,
 * field-aligned with the FlauzEventEnvelope stable cross-TL contract family
 * (ARCHITECTURE-LOCK §5). Emitted only under a negotiated protocol
 * version >= v1; the v0 file-based relay keeps running unchanged.
 */
export interface SeamEventEnvelope {
	type: 'event';
	event: string;
	payload: Record<string, unknown>;
	ts: number;
}

/** Result of `flauz.health.ping` (v1). */
export interface SeamHealthPingResult {
	pong: true;
	ts: number;
	protocolVersion: string;
	uptimeMs: number;
}

/** Result of `flauz.health.status` (v1). */
export interface SeamHealthStatusResult {
	status: 'ok';
	service: string;
	serviceVersion: string;
	protocolVersion: string;
	uptimeMs: number;
	tasks: number;
	ledgerRows: number;
	relay: boolean;
}

/** Result of `flauz.lifecycle.initialize` (v1, idempotent; `replay` marks a repeat call). */
export interface SeamLifecycleInitializeResult {
	initialized: true;
	workspaceRoot: string;
	tasks: number;
	ledgerRows: number;
	replay: boolean;
}

/** Result of `flauz.lifecycle.shutdown` (v1, graceful and idempotent). */
export interface SeamLifecycleShutdownResult {
	ok: true;
	shuttingDown: true;
}

/** Structurally-typed view of the seam the orchestrator depends on. */
export interface SeamLike {
	createTask(title: string): Promise<CreateTaskResult>;
	appendEvent(taskId: string, event: Omit<TaskEvent, 'ts'> & { ts?: number }): Promise<AppendEventResult>;
	listTasks(): Promise<ListTasksResult>;
	getTask(taskId: string): Promise<GetTaskResult>;
	appendEvidence(taskId: string, row: EvidenceRowInput): Promise<AppendEvidenceResult>;
	createCheckpoint(taskId: string, requestId: string, stopId?: string): Promise<CreateCheckpointResult>;
	verifyLedger(): Promise<VerifyLedgerResult>;
}
