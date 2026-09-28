/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Type declarations for `core/orchestration.mjs` (the durable task-graph
 * core). Extension source imports these types only (`import type`); tests
 * import the runtime module directly. Hand-written per the zero-dependency
 * discipline (the contracts.d.mts pattern).
 */

export declare const ORCH_GRAPHS_SCHEMA: 'flauz.orch.graphs/v1';
export declare const ORCH_JOURNAL_ROW_SCHEMA: 'flauz.orch.journal/v1';
export declare const ORCH_DIR: string;
export declare const ORCH_GRAPHS_PATH: string;
export declare const ORCH_JOURNAL_PATH: string;
export declare const ORCH_ACTORS: string[];
export declare const STEP_STATUSES: string[];
export declare const TERMINAL_STEP_STATUSES: string[];
export declare const GRAPH_STATUSES: string[];
export declare const STEP_GATES: string[];
export declare const ROUTING_REASONS: string[];
export declare const CONFLICT_VIOLATIONS: string[];
export declare const JOURNAL_ROW_FIELDS: string[];
export declare const STEP_TRANSITION_TYPES: string[];
export declare const GRAPH_TRANSITION_TYPES: string[];
export declare const JOURNAL_EVENT_TYPES: string[];
export declare const PROVIDER_RETRY_OUTCOMES: string[];
export declare const PROVIDER_RETRY_CLASSES: string[];

export interface StepTransitionRule {
	type: string;
	from: string[];
	actors: string[];
	to: string;
}

export interface GraphTransitionRule {
	type: string;
	from: string[];
	actors: string[];
	to: string;
}

export declare const STEP_TRANSITIONS: StepTransitionRule[];
export declare const GRAPH_TRANSITIONS: GraphTransitionRule[];

export declare function rowIdOf(seq: number): string;
export declare function isGraphId(value: unknown): boolean;
export declare function isStepId(value: unknown): boolean;
export declare function isRowId(value: unknown): boolean;
export declare function isClaimId(value: unknown): boolean;
export declare function isLeaseId(value: unknown): boolean;
export declare function isAgentId(value: unknown): boolean;
/** FLAUZ-TL2-F1: true when the event type is a state-changing transition (step- or graph-level). */
export declare function isTransitionType(type: string): boolean;
export declare function idempotencyKeyOf(graphId: string, stepId: string, attempt: number): string;
export declare function claimIdOf(graphId: string, stepId: string): string;
export declare function leaseIdOf(graphId: string, stepId: string, ordinal: number): string;

export declare class OrchestrationError extends Error {
	code: string;
	constructor(message: string, code: string);
}

export interface StepSpec {
	stepId: string;
	title: string;
	instruction: string;
	tool?: string | null;
	toolInput?: Record<string, unknown> | null;
	gate?: string;
	dependsOn?: string[];
	retryPolicy?: Record<string, unknown> | null;
	routing?: { allowedAgents?: string[]; requiredCapability?: string } | null;
}

export interface GraphRecord {
	graphId: string;
	taskId: string | null;
	title: string;
	policy: { onStepFailure?: string; defaultRetryPolicy?: Record<string, unknown> | null };
	steps: StepSpec[];
	createdAt: number;
	updatedAt: number;
}

export declare function validateStepSpec(value: unknown): { ok: true; step: StepSpec } | { ok: false; error: string };
export declare function validateGraphRecord(value: unknown): { ok: true; graph: GraphRecord } | { ok: false; error: string };

export interface JournalRow {
	$schema: string;
	seq: number;
	rowId: string;
	ts: number;
	graphId: string;
	stepId: string | null;
	type: string;
	actor: string;
	origin: string;
	attempt: number | null;
	idempotencyKey: string | null;
	payload: Record<string, unknown>;
	contentHash: string;
	prev: string | null;
}

export declare function rowHashOf(row: JournalRow): string;
export declare function contentHashOf(payload: unknown): string;
export declare function journalLine(row: JournalRow): string;
export declare function validateJournalPayload(type: string, payload: unknown): string | undefined;
export declare function validateJournalRow(row: unknown): { ok: true; row: JournalRow } | { ok: false; error: string };
export declare function eventLevel(type: string): 'graph' | 'step' | 'either';

export interface DerivedStepState {
	stepId: string;
	status: string | undefined;
	blockedOn?: string[];
	attempt: number;
	lastStartedAttempt: number;
	retrySameAttempt: number | null;
	nextAttempt: number | null;
	retryNotBefore: number | null;
	runnerId: string | null;
	failure: { class: string; message: string; retryPlanned: boolean } | null;
	evidence: Array<{ evidenceId: string | null; kind: string; uri: string; sha256: string }>;
	approval: { requestedAt: number; reason: string; state: string; grantedAt?: number; deniedAt?: number } | null;
	takeover: Record<string, unknown> | null;
	startedAt: number | null;
	updatedAt: number | null;
	/** The bounded provider-retry window projection (TL2-F2): null until the first provider-retry row of an attempt. */
	providerRetry: { rows: number; lastOrdinal: number; maxAttempts: number; lastOutcome: string; ended: boolean } | null;
}

export interface DerivedGraphState {
	graphId: string;
	graph: GraphRecord;
	spec: GraphRecord;
	graphStatus: string;
	steps: Record<string, DerivedStepState>;
	claims: Record<string, { claimId: string; holder: string; since: number }>;
	leases: Record<string, { leaseId: string; holder: string; expiresAt: number; acquiredAt: number; renewals: number }>;
	leasesSeen: Record<string, number>;
	pendingApprovals: string[];
	takeover: { stepId: string; state: string } | null;
	cancelRequested: boolean;
	cancelReason: string | null;
	/** FLAUZ-TL2-F1: the actor of the recorded cancel-requested row (the attribution source for cancel-observed rows). */
	cancelActor: string | null;
	/** FLAUZ-TL2-F1: the latest cancel-observed record (the drive loop's attributed cancellation observation). */
	cancelObserved: { rowId: string; reason: string; actor: string; stepId: string | null; at: number; evidenceId?: string } | null;
	routing: Record<string, unknown>;
	delegations: Record<string, unknown>;
	interrupted: string[];
	completedAt: number | null;
	derived: {
		phase: string;
		runnable: string[];
		blocked: string[];
		awaitingApproval: string[];
		running: string[];
	};
}

export declare function deriveGraphState(graph: GraphRecord, rows: JournalRow[]): { ok: true; state: DerivedGraphState } | { ok: false; error: string };
export declare function effectiveStepStatus(state: DerivedGraphState, stepId: string): string;
export declare function summarizeState(state: DerivedGraphState): Record<string, unknown>;
