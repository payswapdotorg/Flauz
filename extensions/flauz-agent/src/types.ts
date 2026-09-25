/**
 * Shared seam types for the Flauz Agent Bridge (F side).
 *
 * The transition/ledger logic itself lives in `core/contracts.mjs` (G side);
 * these types mirror the wire shapes so both sides compile against one
 * description of the seam contract §H.
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
