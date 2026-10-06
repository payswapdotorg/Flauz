/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Type declarations for `bgAgent.mjs` (the CR-002 background-agent
 * runtime). Hand-written per the zero-dependency discipline (the
 * contracts.d.mts pattern): self-contained structural types only.
 */

export type BgAgentErrorCode =
        | 'NOT_FOUND'
        | 'INVALID_SPEC'
        | 'INVALID_COMMAND'
        | 'INVALID_TRANSITION'
        | 'SEAM_FAILURE'
        | 'DISPOSED';

export declare class BgAgentError extends Error {
        code: BgAgentErrorCode;
        constructor(code: BgAgentErrorCode, message?: string);
}

/** The seam vocabulary resolved at bind time (never invented by the runtime). */
export interface BgAgentVocabulary {
        actor: string;
        reason: string;
        /** The launch/delegation message kind (the a2a task-delegation lane). */
        kind: string;
        /** The steering/control message kind (the a2a steering-relay lane). */
        steeringKind: string;
        from: string;
        fromValidated: boolean;
        origin: string;
        messageKinds: string[];
        orchActors: string[];
        routingReasons: string[];
        terminalStepStatuses: string[];
        validateAgentId: ((value: unknown) => boolean) | null;
}

export interface BgAgentLaunchSpec {
        agentId: string;
        label?: string;
        input?: Record<string, unknown>;
}

export interface BgAgentLaunchResult {
        runId: string;
        agentId: string;
        status: string;
}

export interface BgAgentEvent {
        at: number;
        kind: string;
        data: Record<string, unknown>;
        seq: number;
        rowId: string;
}

export interface BgAgentInspectResult {
        runId: string;
        agentId: string | null;
        label: string | null;
        status: string;
        phase: string | null;
        terminal: boolean;
        createdAt: number | null;
        updatedAt: number | null;
        completedAt: number | null;
        events: BgAgentEvent[];
        eventCount: number;
}

export interface BgAgentMessageInput {
        type?: string;
        payload: unknown;
}

export interface BgAgentMessageResult {
        runId: string;
        delivered: true;
        messageId: string;
        seq: number;
        type: string;
}

export type BgAgentControlCommand = 'pause' | 'resume' | 'cancel';

export interface BgAgentControlResult {
        runId: string;
        command: BgAgentControlCommand;
        /** false for the advisory pause/resume, true for the enforced cancel. */
        enforced: boolean;
        /** cancel only: the store's cancelled step ids. */
        cancelledSteps?: string[];
        /** pause/resume only: the posted control message id. */
        messageId?: string;
        /** cancel only: the best-effort notice message id (null when unpostable). */
        noticeMessageId?: string | null;
}

export interface BgAgentOutcome {
        runId: string;
        status: string;
        terminal: boolean;
        ok: boolean;
        result: string | null;
        error: string | null;
        timedOut: boolean;
}

export interface BgAgentRosterEntry {
        agentId: string;
        pending: number;
        runs: number;
}

/** The validated structural slice of the REAL OrchestrationStore the runtime (and tests) use. */
export interface BgAgentStoreView {
        submitGraph(input: Record<string, unknown>): Promise<{ graphId: string; taskId: string | null; stepIds: string[]; rowId: string }>;
        approveGraph(input: Record<string, unknown>): Promise<unknown>;
        routeDecide(input: Record<string, unknown>): Promise<{ rowId: string }>;
        delegationSent(input: Record<string, unknown>): Promise<unknown>;
        cancelGraph(input: Record<string, unknown>): Promise<{ cancelledSteps: string[] }>;
        startStep(input: Record<string, unknown>): Promise<{ attempt: number; idempotencyKey: string; rowId: string }>;
        finishStep(input: Record<string, unknown>): Promise<unknown>;
        stateOf(graphId: string): unknown;
        rowsFor(graphId: string): unknown;
        listGraphs(): unknown;
        dispose?(): unknown;
}

/** The validated structural slice of the REAL A2ABus the runtime (and tests) use. */
export interface BgAgentBusView {
        post(args: {
                message: {
                        kind: string;
                        from: string;
                        to: string;
                        ts?: number;
                        inReplyTo?: string | null;
                        payload: Record<string, unknown>;
                };
        }): { id: string; seq: number; message: Record<string, unknown> };
        collect(args: { agentId: string; consume?: boolean }): { messages: Array<Record<string, unknown>> };
        list(): { agents: Array<{ agentId: string; pending: number }> };
}

export interface BgAgentRuntime {
        launch(spec: BgAgentLaunchSpec): Promise<BgAgentLaunchResult>;
        inspect(runId: string, options?: { eventLimit?: number }): Promise<BgAgentInspectResult>;
        message(runId: string, message: BgAgentMessageInput): Promise<BgAgentMessageResult>;
        control(runId: string, command: BgAgentControlCommand, options?: { reason?: string }): Promise<BgAgentControlResult>;
        outcome(runId: string, options?: { waitMs?: number; pollMs?: number }): Promise<BgAgentOutcome>;
        roster(options?: { agentId?: string }): Promise<BgAgentRosterEntry[]>;
        dispose(): Promise<void>;
}

export interface BgAgentRuntimeDeps {
        store: BgAgentStoreView;
        bus: BgAgentBusView;
        now?: () => number;
        vocabulary?: Partial<BgAgentVocabulary>;
        logger?: { warn?: (message: string) => void } | null;
}

export declare function createBgAgentRuntime(deps?: Partial<BgAgentRuntimeDeps>): BgAgentRuntime;

export type BgAgentLoadVerdict =
        | {
                        bound: true;
                        runtime: BgAgentRuntime;
                        store: BgAgentStoreView;
                        bus: BgAgentBusView;
                        vocabulary: BgAgentVocabulary;
          }
        | { bound: false; detail: string };

export declare function loadBgAgentRuntime(options: {
        root: string;
        now?: () => number;
        logger?: { warn?: (message: string) => void } | null;
}): Promise<BgAgentLoadVerdict>;
