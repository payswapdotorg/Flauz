/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Type declarations for `core/orchStore.mjs` (the orchestration store).
 * Hand-written per the zero-dependency discipline (contracts.d.mts pattern).
 */

import type { GraphRecord, JournalRow, OrchestrationError } from './orchestration.d.mts';

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

export declare class OrchestrationStore {
        constructor(root: string, options?: StoreOptions);

        root: string;
        graphs: GraphRecord[];
        journalRows: JournalRow[];
        tornTail: { line: string; reason: string } | null;
        taskPort: TaskPort | null;

        load(): void;
        saveGraphs(): void;
        requireGraph(graphId: string): GraphRecord;
        appendRow(type: string, fields: { graphId: string; stepId?: string | null; actor: string; origin: string; attempt?: number | null; idempotencyKey?: string | null; ts?: number; payload: Record<string, unknown> }): JournalRow;
        /** Build one candidate row (validation + construction, NO write) - the preview half of the evidence-bearing ops. */
        candidateRow(type: string, fields: { graphId: string; stepId?: string | null; actor: string; origin: string; attempt?: number | null; idempotencyKey?: string | null; ts?: number; payload: Record<string, unknown> }): JournalRow;
        /** Dry-run the full append validation without writing (no orphan evidence on illegal transitions). */
        previewRow(type: string, fields: { graphId: string; stepId?: string | null; actor: string; origin: string; attempt?: number | null; idempotencyKey?: string | null; ts?: number; payload: Record<string, unknown> }): JournalRow;
        /** Append a previously built candidate (asserts the journal head; fails loudly on a violated single-writer discipline). */
        appendCandidate(candidate: JournalRow): JournalRow;
        /** Serialize the preview -> mint -> append window (the rowId-evidence linkage guarantee). */
        withTransitionLock<T>(fn: () => T | Promise<T>): Promise<T>;
        /** Mint the ledger evidence row of one transition (null without taskPort/taskId). */
        mintTransitionEvidence(candidate: JournalRow): Promise<string | null>;
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
        }): Promise<JournalRow>;
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
        }): Promise<JournalRow>;
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

        acquireClaim(input: { graphId: string; stepId: string; holder: string; actor?: string; origin: string }): Promise<JournalRow>;
        releaseClaim(input: { graphId: string; stepId: string; actor?: string; origin: string }): Promise<JournalRow>;
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
