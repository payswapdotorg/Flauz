/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * ZC-001 family 3: Plan continuity contracts. Versioned data contracts, constants,
 * transition maps, and pure guards for approved-plan continuity across sessions.
 * Zero-dependency by law: this module imports nothing.
 *
 * DETERMINISM LAW: no `Math.random`, no `Date.now`, no `new Date()` inside this module.
 * Timestamps are plain ISO strings set only at persistence edges.
 *
 * SCOPING LAW: every persisted record carries `scope: ZcodeScope` and
 * `contractVersion: string`.
 *
 * PROJECTION LAW: this module is a READ-MODEL over existing authorities, never a new
 * authority. An ApprovedPlanRecord summarizes an approved plan whose owning authority
 * task (extensions/flauz-agent Task / TaskEnvelope, driven by the flauz.tasks/v0 state
 * machine in extensions/flauz-workspace) governs whether steps may proceed; the
 * plan/steps shape projects the workflow envelope authority (extensions/flauz-workflow:
 * WorkflowFragment plan + ordered steps). No plan scheduler, no execution engine may
 * appear here: types, constants, pure guards, mapping tables only.
 *
 * CONTINUITY LAW (fail-closed): a plan step may only proceed while the owning
 * authority task is in an active state. Pinned-plan steps NEVER proceed under a
 * failed or cancelled authority task: pinning preserves a step for continuation,
 * it never resurrects a dead task. The law is encoded in exported pure guards and
 * pinned exhaustively by tests over every (step status, task status) pair.
 */

/**
 * Version of the ZC-001 pattern contract set; a record is current only when its
 * `contractVersion` matches exactly. Re-declared in every zcode-patterns contract
 * module because the zero-import law forbids a shared base module; tests pin all
 * declarations to this exact value.
 */
export const ZCODE_PATTERNS_CONTRACTS_VERSION = '1.0.0';

/**
 * Workspace/tenant scoping tuple attached to every persisted zcode-patterns record.
 */
export interface ZcodeScope {
	workspaceId: string;
	tenantId: string;
}

/**
 * Contract-duplicated authority vocabulary: the TaskStatus set of the task/session
 * authority (extensions/flauz-agent/src/types.ts, mirrored by the flauz.tasks/v0
 * state machine in extensions/flauz-workspace/src/api.ts). Duplicated, never imported,
 * because common/ contract modules import nothing; tests pin this list against the
 * authority list AND against the sibling duplication in backgroundAgent.ts so drift
 * is impossible.
 */
export const AUTHORITY_TASK_STATUSES = [
	'plan',
	'awaiting-approval',
	'execute',
	'verify',
	'awaiting-signoff',
	'failed',
	'done',
	'cancelled',
] as const;
export type AuthorityTaskStatus = (typeof AUTHORITY_TASK_STATUSES)[number];

/**
 * Contract-duplicated authority vocabulary: the active statuses of the flauz.tasks/v0
 * state machine (extensions/flauz-workspace ACTIVE_STATUSES, the set from which
 * `cancel` is legal). Pinned against the authority list by tests.
 */
export const AUTHORITY_ACTIVE_TASK_STATUSES = [
	'plan',
	'awaiting-approval',
	'execute',
	'verify',
	'awaiting-signoff',
] as const;
export type AuthorityActiveTaskStatus = (typeof AUTHORITY_ACTIVE_TASK_STATUSES)[number];

/**
 * The plan step status set of the projection.
 */
export const PLAN_STEP_STATUSES = ['pending', 'in-progress', 'completed', 'failed', 'skipped'] as const;
export type PlanStepStatus = (typeof PLAN_STEP_STATUSES)[number];

/**
 * Legal plan step status transitions; an empty list marks a terminal step status.
 */
export const planStepStatusTransitions: Readonly<Record<PlanStepStatus, readonly PlanStepStatus[]>> = {
	pending: ['in-progress', 'skipped'],
	'in-progress': ['completed', 'failed'],
	completed: [],
	failed: [],
	skipped: [],
};

/**
 * Pure lookup: reports whether `from` -> `to` is a legal plan step status transition.
 */
export function canTransitionPlanStepStatus(from: PlanStepStatus, to: PlanStepStatus): boolean {
	return planStepStatusTransitions[from].includes(to);
}

/**
 * Summary of one approved plan step. `seq` mirrors the ordered-steps discipline of
 * the workflow envelope authority; `pinned` marks a step the user preserved for
 * continuation.
 */
export interface ApprovedPlanStep {
	readonly stepId: string;
	readonly seq: number;
	readonly title: string;
	readonly status: PlanStepStatus;
	readonly pinned: boolean;
}

/**
 * Read-model of one approved plan. `owningTaskId` references the authority task that
 * governs the plan; `sessionLineage` lists the session ids that carried the plan,
 * oldest first; `steps` summarizes the plan steps in seq order. No plan execution
 * state lives here.
 */
export interface ApprovedPlanRecord {
	scope: ZcodeScope;
	contractVersion: string;
	planId: string;
	owningTaskId: string;
	sessionLineage: readonly string[];
	approvedAtIso: string;
	steps: readonly ApprovedPlanStep[];
}

/**
 * The continuity law, general guard: a step may proceed only while the owning
 * authority task is in an active state AND the step itself is in a forward-looking
 * status. Under `failed`, `cancelled`, or `done` authority tasks nothing proceeds.
 */
export function planStepMayProceed(stepStatus: PlanStepStatus, taskStatus: AuthorityTaskStatus): boolean {
	if (!(AUTHORITY_ACTIVE_TASK_STATUSES as readonly string[]).includes(taskStatus)) {
		return false;
	}
	return stepStatus === 'pending' || stepStatus === 'in-progress';
}

/**
 * The continuity law, pinned guard (deliberately fail-closed twice): a pinned-plan
 * step NEVER proceeds under a `failed` or `cancelled` authority task, regardless of
 * the general guard. The hard floor is restated here on purpose so that even if the
 * active-status set ever drifts, the two terminal-death statuses remain pinned shut
 * for pinned steps. Pinning preserves a step for future continuation; it never
 * resurrects a dead task.
 */
export function pinnedPlanStepMayProceed(step: ApprovedPlanStep, taskStatus: AuthorityTaskStatus): boolean {
	if (taskStatus === 'failed' || taskStatus === 'cancelled') {
		return false;
	}
	return planStepMayProceed(step.status, taskStatus);
}

/**
 * Guard: true iff the record pins the exact current ZCODE_PATTERNS_CONTRACTS_VERSION.
 */
export function isVersionedApprovedPlanRecord(record: { contractVersion?: string }): boolean {
	return record.contractVersion === ZCODE_PATTERNS_CONTRACTS_VERSION;
}
