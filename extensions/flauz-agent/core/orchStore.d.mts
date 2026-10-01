/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Type declarations for `core/orchStore.mjs` (the orchestration store).
 * Hand-written per the zero-dependency discipline (contracts.d.mts pattern).
 */

import type { GraphRecord, JournalRow, OrchestrationError, StepSpec } from './orchestration.d.mts';

export declare class OrchestrationStoreError extends OrchestrationError {}

/** The workspace-seam port the store links through (WorkspaceSeam in service wiring; fakes in tests). */
/**
 * The workspace-seam port the store links through (WorkspaceSeam in service
 * wiring - its methods are SYNC; fakes in tests are often async). The store
 * awaits every call, so implementations may return either shape.
 */
export interface TaskPort {
	createTask(args: { title: string }): Promise<{ taskId: string }> | { taskId: string };
	appendEvent(args: { taskId: string; event: Record<string, unknown> }): Promise<{ task: unknown }> | { task: unknown };
	appendEvidence(args: { taskId: string; row: { kind: string; uri: string; sha256: string; note?: string } }): Promise<{ evidenceId: string; seq: number }> | { evidenceId: string; seq: number };
}

export interface StoreOptions {
	taskPort?: TaskPort | null;
	clock?: () => number;
}

export interface EvidenceItemInput {
	kind: string;
	uri: string;
	sha256: string;
}

/**
 * P2-FIX-115: the typed failure-time non-completable warning carried by a
 * failed finishStep result whose failure leaves the graph no completable path
 * (additive; absent while a retry path remains). The landed step-failed row
 * is byte-identical to the pre-fix shape - the warning rides the RESULT, never
 * the journal row.
 */
export interface NonCompletableWarning {
	code: 'graph-non-completable';
	reason: 'terminal-class' | 'attempts-exhausted';
	graphId: string;
	stepId: string;
	attempt: number | null;
	failureClass: string;
	evidenceId: string | null;
	message: string;
}

/** A failed finishStep result: the landed step-failed row (+ the additive P2-FIX-115 warning). */
export type StepFailedResult = JournalRow & { nonCompletable?: NonCompletableWarning };

export declare class OrchestrationStore {
	constructor(root: string, options?: StoreOptions);

	root: string;
	graphs: GraphRecord[];
	journalRows: JournalRow[];
	tornTail: { line: string; reason: string } | null;
	taskPort: TaskPort | null;
	clock: () => number;

	load(): void;
	saveGraphs(): void;
	requireGraph(graphId: string): GraphRecord;
	requireStep(graph: GraphRecord, stepId: string): StepSpec;
	appendRow(type: string, fields: { graphId: string; stepId?: string | null; actor: string; origin: string; attempt?: number | null; idempotencyKey?: string | null; ts?: number; payload: Record<string, unknown> }): JournalRow;
	/** Build one candidate row (validation + construction, NO write) - the preview half of the evidence-bearing ops. */
	candidateRow(type: string, fields: { graphId: string; stepId?: string | null; actor: string; origin: string; attempt?: number | null; idempotencyKey?: string | null; ts?: number; payload: Record<string, unknown> }): JournalRow;
	/** Dry-run the full append validation without writing (no orphan evidence on illegal transitions). */
	previewRow(type: string, fields: { graphId: string; stepId?: string | null; actor: string; origin: string; attempt?: number | null; idempotencyKey?: string | null; ts?: number; payload: Record<string, unknown> }): JournalRow;
	/** Append a previously built candidate (asserts the journal head; fails loudly on a violated single-writer discipline). */
	appendCandidate(candidate: JournalRow): JournalRow;
	/** Serialize the preview -> mint -> append window (the rowId-evidence linkage guarantee). */
	withTransitionLock<T>(fn: () => T | Promise<T>): Promise<T>;
	/** FLAUZ-TL2-F1 (DL-75): the serialized append for async call sites - transition lock -> appendRowInternal. Refuses lock-free writes under contention. */
	appendRowLocked(type: string, fields: { graphId: string; stepId?: string | null; actor: string; origin: string; attempt?: number | null; idempotencyKey?: string | null; ts?: number; payload: Record<string, unknown> }): Promise<JournalRow>;
	/** FLAUZ-TL2-F1 (DL-75): the guard-free append half for callers that already hold the transition lock. Never call directly - the public appendRow enforces the lock-discipline guard. */
	appendRowInternal(type: string, fields: { graphId: string; stepId?: string | null; actor: string; origin: string; attempt?: number | null; idempotencyKey?: string | null; ts?: number; payload: Record<string, unknown> }): JournalRow;
	/** Mint the ledger evidence row of one transition (null without taskPort/taskId). */
	mintTransitionEvidence(candidate: JournalRow): Promise<string | null>;
	/** P2-FIX-115: mint the failure-time evidence row of the non-completable signal (null without taskPort/taskId). */
	mintNonCompletableEvidence(candidate: JournalRow, plan: { retry: false; reason: 'terminal-class' | 'attempts-exhausted' }, failureClass: string): Promise<string | null>;
	/** The evidence-bearing transition append (preview -> mint -> append). */
	appendEvidenceBearingRow(type: string, fields: { graphId: string; stepId?: string | null; actor: string; origin: string; attempt?: number | null; idempotencyKey?: string | null; ts?: number; payload: Record<string, unknown> }): Promise<JournalRow>;
	/** Same, for a caller already holding the transition lock. */
	appendEvidenceBearingRowLocked(type: string, fields: { graphId: string; stepId?: string | null; actor: string; origin: string; attempt?: number | null; idempotencyKey?: string | null; ts?: number; payload: Record<string, unknown> }): Promise<JournalRow>;
	rowsFor(graphId: string): JournalRow[];
	stateOf(graphId: string): import('./orchestration.d.mts').DerivedGraphState;
	verifyJournal(): { ok: boolean; rows: number; firstBadSeq?: number };
	getGraphState(graphId: string): Record<string, unknown>;
	listGraphs(): Array<{ graphId: string; taskId: string | null; title: string; graphStatus: string; execution: unknown }>;

	submitGraph(input: {
		title: string;
		steps: Array<Record<string, unknown>>;
		policy?: Record<string, unknown>;
		taskId?: string;
		actor?: string;
		origin?: string;
	}): Promise<{ graphId: string; taskId: string | null; stepIds: string[]; rowId: string }>;

	approveGraph(input: { graphId: string; actor: string; origin: string; note?: string }): Promise<JournalRow>;
	rejectGraph(input: { graphId: string; actor: string; origin: string; note?: string }): Promise<JournalRow>;
	completeGraph(input: { graphId: string; actor: string; origin: string }): Promise<JournalRow>;
	failGraph(input: { graphId: string; failedStepId: string; actor: string; origin: string }): Promise<JournalRow>;

	startStep(input: { graphId: string; stepId: string; runnerId: string; actor?: string; origin: string }): Promise<{ attempt: number; idempotencyKey: string; rowId: string }>;
	finishStep(input: {
		graphId: string;
		stepId: string;
		attempt?: number;
		outcome: 'succeeded' | 'failed';
		output?: string;
		message?: string;
		error?: unknown;
		failureClass?: string;
		retryPlanned?: boolean;
		evidence?: EvidenceItemInput[];
		actor?: string;
		origin: string;
	}): Promise<StepFailedResult>;
	finishStepLocked(input: {
		graphId: string;
		stepId: string;
		attempt?: number;
		outcome: 'succeeded' | 'failed';
		output?: string;
		message?: string;
		error?: unknown;
		failureClass?: string;
		retryPlanned?: boolean;
		evidence?: EvidenceItemInput[];
		actor?: string;
		origin: string;
	}): Promise<StepFailedResult>;
	retryStep(input: { graphId: string; stepId: string; actor?: string; origin: string }): Promise<JournalRow>;
	retryStepLocked(input: { graphId: string; stepId: string; actor?: string; origin: string }): JournalRow;
	/** Record one bounded provider-retry attempt row (TL2-F2): serialized by the transition lock, hash-chained, replay-validated. */
	recordProviderRetry(input: {
		graphId: string;
		stepId: string;
		attempt: number;
		idempotencyKey: string;
		attemptOrdinal: number;
		outcome: 'retryable-failed' | 'exhausted' | 'recovered';
		code: string;
		retryClass: string;
		retryAfterMs?: number;
		waitAppliedMs: number;
		maxAttempts: number;
		nextAttemptOrdinal?: number;
		actor?: string;
		origin?: string;
	}): Promise<JournalRow>;
	cancelGraph(input: { graphId: string; reason?: string; actor: string; origin: string }): Promise<{ cancelledSteps: string[] }>;

	approvalRequest(input: { graphId: string; stepId: string; reason: string; expiresAt?: number; actor?: string; origin: string }): Promise<JournalRow>;
	approvalDecide(input: { graphId: string; stepId: string; decision: 'granted' | 'denied'; note?: string; actor: string; origin: string }): Promise<JournalRow>;
	/** The fail-closed TL2-004 timeout: service-only, deadline-bearing pending approvals only; the step is CANCELLED, never auto-granted. */
	expireApproval(input: { graphId: string; stepId: string; expiredAt?: number; note?: string; actor?: string; origin: string }): Promise<JournalRow>;
	takeoverRequest(input: { graphId: string; stepId: string; reason?: string; actor: string; origin: string }): Promise<JournalRow>;
	takeoverAccept(input: { graphId: string; stepId: string; note?: string; actor: string; origin: string }): Promise<JournalRow>;
	takeoverComplete(input: { graphId: string; stepId: string; summary?: string; evidence?: EvidenceItemInput[]; actor: string; origin: string }): Promise<JournalRow>;

	/**
	 * Acquire the exclusive (DEADLINE-LESS) step claim - the notice with
	 * its evidence row. TL2-F3: a claim against an active FOREIGN claim is
	 * refused with the typed LeaseConflictError (holder, claim id,
	 * deadline null) after the refusal is journaled as evidence-bearing
	 * history; the SAME holder re-claiming reuses the active claim and
	 * gets its acquisition row back.
	 */
	acquireClaim(input: { graphId: string; stepId: string; holder: string; actor?: string; origin: string }): Promise<JournalRow>;
	releaseClaim(input: { graphId: string; stepId: string; actor?: string; origin: string }): Promise<JournalRow>;
	/**
	 * Acquire a TTL lease on the step - the notice with its evidence row.
	 * TL2-F3: a claim against a LIVE foreign lease is refused with the
	 * typed LeaseConflictError (holder, lease id, deadline) after the
	 * refusal is journaled as evidence-bearing history; an EXPIRED lease
	 * does not conflict (the takeover records the expiry then acquires
	 * with the next ordinal lease id); the SAME holder re-acquiring
	 * reuses the active lease (DL-72) and gets the row that last set the
	 * lease facts (acquisition or renewal) back.
	 */
	acquireLease(input: { graphId: string; stepId: string; holder: string; ttlMs: number; actor?: string; origin: string }): Promise<JournalRow>;
	renewLease(input: { graphId: string; stepId: string; ttlMs: number; actor?: string; origin: string }): Promise<JournalRow>;
	releaseLease(input: { graphId: string; stepId: string; actor?: string; origin: string }): Promise<JournalRow>;
	noticeConflict(input: { graphId: string; stepId: string; violation: string; expectedHolder: string; actualRunner: string; note?: string; actor?: string; origin: string }): Promise<JournalRow>;

	routeDecide(input: { graphId: string; stepId?: string | null; targetAgent: string; reason: string; details?: Record<string, unknown>; actor?: string; origin: string }): Promise<JournalRow>;
	delegationSent(input: { graphId: string; stepId?: string | null; decisionRowId: string; messageId: string; actor?: string; origin: string }): Promise<JournalRow>;
	receiveResult(input: { graphId: string; stepId: string; messageId: string; outcome: string; summary: string; evidenceIds?: string[]; actor?: string; origin: string }): Promise<JournalRow>;

	policyFor(graph: GraphRecord, step: { retryPolicy?: RetryPolicyShape | null }): RetryPolicyShape;
}

export interface RetryPolicyShape {
	maxAttempts: number;
	backoff: { kind: string; baseMs: number; maxMs?: number };
	retryOn: string[];
}
