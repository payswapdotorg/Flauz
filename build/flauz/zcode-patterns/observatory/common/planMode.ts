/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the repository root for license information.
 *--------------------------------------------------------------------------------------------- */

/**
 * ZC-004 Observatory - Plan Mode contracts (explicit plan mode).
 *
 * LAWS (violations are rejected):
 * - The journal is canonical. Every type here is a read-model, request shape,
 *   or pure projection over the canonical Flauz journal and the agent
 *   authority (extensions/flauz-agent/src/types.ts: TaskStatus, Task,
 *   TaskEvent, TaskEnvelope). This module is never a second authority.
 * - DETERMINISM: no Math.random, no Date.now, no new Date(). Timestamps are
 *   plain ISO-8601 strings; digests are injected or derived purely.
 * - ZERO-DEPENDENCY: no import statements. Shared vocabulary (contract
 *   version, ObservatoryScope) is declared locally, mirroring
 *   build/flauz/lab/common/labContracts.ts.
 * - FAIL-CLOSED: inadmissible transitions and plan drift are typed verdicts
 *   carrying the exact violated law - never exceptions, never silent.
 *
 */

export const OBSERVATORY_CONTRACTS_VERSION = '1.0.0';

export interface ObservatoryScope {
    workspaceId: string;
    tenantId: string;
}

export const PLAN_MODE_STATES = [
    'draft',
    'awaiting-approval',
    'approved',
    'executing',
    'superseded'
] as const;

export type PlanModeState = (typeof PLAN_MODE_STATES)[number];

/** Forward-only edges. The single demotion edge is '-> superseded'. */
export const PLAN_MODE_FORWARD_TRANSITIONS: Readonly<
    Record<PlanModeState, readonly PlanModeState[]>
> = {
    draft: ['awaiting-approval', 'superseded'],
    'awaiting-approval': ['approved', 'superseded'],
    approved: ['executing', 'superseded'],
    executing: ['superseded'],
    superseded: []
};

export type PlanModeEvidenceKind =
    | 'approval-requested'
    | 'plan-approved'
    | 'execution-started'
    | 'plan-superseded';

const PLAN_MODE_EVIDENCE_KIND_BY_EDGE: Readonly<Record<string, PlanModeEvidenceKind | undefined>> = {
    'draft->awaiting-approval': 'approval-requested',
    'awaiting-approval->approved': 'plan-approved',
    'approved->executing': 'execution-started',
    'draft->superseded': 'plan-superseded',
    'awaiting-approval->superseded': 'plan-superseded',
    'approved->superseded': 'plan-superseded',
    'executing->superseded': 'plan-superseded'
};

export interface PlanModeTransitionRequest {
    from: PlanModeState;
    to: PlanModeState;
    evidenceDigest: string;
    /** REQUIRED iff to === 'superseded' (the ONE demotion law). */
    successorPlanRevisionDigest?: string;
}

export type PlanModeTransitionVerdict =
    | { admissible: true; evidenceKind: PlanModeEvidenceKind }
    | {
            admissible: false;
            violatedLaw:
                | 'plan-mode-transition-not-forward'
                | 'plan-mode-evidence-missing'
                | 'plan-mode-supersede-requires-successor-digest';
            detail: string;
      };

export function canTransitionPlanMode(
    request: PlanModeTransitionRequest
): PlanModeTransitionVerdict {
    if (!PLAN_MODE_FORWARD_TRANSITIONS[request.from].includes(request.to)) {
        return {
            admissible: false,
            violatedLaw: 'plan-mode-transition-not-forward',
            detail: request.from + ' -> ' + request.to + ' is not a forward plan-mode edge'
        };
    }
    if (!isNonEmptyDigest(request.evidenceDigest)) {
        return {
            admissible: false,
            violatedLaw: 'plan-mode-evidence-missing',
            detail: 'every plan-mode transition is evidence-bearing'
        };
    }
    if (
        request.to === 'superseded' &&
        !isNonEmptyDigest(request.successorPlanRevisionDigest ?? '')
    ) {
        return {
            admissible: false,
            violatedLaw: 'plan-mode-supersede-requires-successor-digest',
            detail: 'superseding a plan requires the successor plan revision digest'
        };
    }
    const evidenceKind = PLAN_MODE_EVIDENCE_KIND_BY_EDGE[request.from + '->' + request.to];
    if (evidenceKind === undefined) {
        return {
            admissible: false,
            violatedLaw: 'plan-mode-evidence-missing',
            detail: 'no evidence kind is defined for edge ' + request.from + ' -> ' + request.to
        };
    }
    return { admissible: true, evidenceKind: evidenceKind };
}

export interface PlanDocumentRef {
    scope: ObservatoryScope;
    contractVersion: string;
    planId: string;
    revisionDigest: string;
    approvedAtIso: string;
    approvalEvidenceDigest: string;
}

export interface PlanContinuityRecord {
    scope: ObservatoryScope;
    contractVersion: string;
    planId: string;
    taskRef: string;
    /** The revision digest pinned at execution start - the continuity anchor. */
    pinnedRevisionDigest: string;
    pinnedAtIso: string;
}

export type PlanContinuityVerdict =
    | { kind: 'current'; planRevisionDigest: string }
    | {
            kind: 'drifted';
            violatedLaw: 'plan-revision-drift';
            pinnedRevisionDigest: string;
            observedRevisionDigest: string;
      };

/** Drift is a typed verdict, never an exception. */
export function planContinuityVerdict(
    record: PlanContinuityRecord,
    observedRevisionDigest: string
): PlanContinuityVerdict {
    if (record.pinnedRevisionDigest === observedRevisionDigest) {
        return { kind: 'current', planRevisionDigest: observedRevisionDigest };
    }
    return {
        kind: 'drifted',
        violatedLaw: 'plan-revision-drift',
        pinnedRevisionDigest: record.pinnedRevisionDigest,
        observedRevisionDigest: observedRevisionDigest
    };
}

/**
 * Projection from the agent authority TaskStatus.
 *
 * SEAM (completed repo-side by the TL at application time): the entries
 * below cover the authority TaskStatus members transcribed verbatim from
 * extensions/flauz-agent/src/types.ts (plan, awaiting-approval, execute,
 * verify, awaiting-signoff, failed, done, cancelled). Mapping rule:
 * pre-approval statuses project to draft / awaiting-approval; every
 * post-approval status projects to 'executing' (the plan stays pinned
 * until superseded). DO NOT GUESS - unmapped statuses fail closed and the
 * mocha suite iterates the authority list to pin totality.
 */
export const PLAN_MODE_BY_TASK_STATUS: Readonly<Record<string, PlanModeState | undefined>> = {
    plan: 'draft',
    'awaiting-approval': 'awaiting-approval',
    execute: 'executing',
    verify: 'executing',
    'awaiting-signoff': 'executing',
    failed: 'executing',
    done: 'executing',
    cancelled: 'executing'
};

export type PlanModeProjectionVerdict =
    | { planMode: PlanModeState }
    | { violatedLaw: 'task-status-unmapped'; taskStatus: string };

/** Total as a function; fail-closed as a mapping. */
export function planModeFromTaskStatus(taskStatus: string): PlanModeProjectionVerdict {
    const planMode = PLAN_MODE_BY_TASK_STATUS[taskStatus];
    if (planMode === undefined) {
        return { violatedLaw: 'task-status-unmapped', taskStatus: taskStatus };
    }
    return { planMode: planMode };
}

function isNonEmptyDigest(digest: string): boolean {
    return typeof digest === 'string' && digest.length > 0;
}

/** The forward-adjacency query: which states may follow `from` directly. */
export function planModeTargets(from: PlanModeState): readonly PlanModeState[] {
    return PLAN_MODE_FORWARD_TRANSITIONS[from];
}

/**
 * The evidence-kind query for a (from, to) edge: undefined when no such
 * forward edge exists (the pair is not a transition, so no evidence kind
 * applies — never a fabricated one).
 */
export function planModeEvidenceKindOf(
    from: PlanModeState,
    to: PlanModeState
): PlanModeEvidenceKind | undefined {
    return PLAN_MODE_EVIDENCE_KIND_BY_EDGE[from + '->' + to];
}
