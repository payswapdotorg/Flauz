/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * ZC-001 family 1: Background-agent lifecycle projection. Versioned data contracts,
 * constants, pure guards, and transition maps for the background-agent run read-model.
 * Zero-dependency by law: this module imports nothing.
 *
 * DETERMINISM LAW: no `Math.random`, no `Date.now`, no `new Date()` inside this module.
 * Timestamps are plain ISO strings set only at persistence edges.
 *
 * SCOPING LAW: every persisted record carries `scope: ZcodeScope` and
 * `contractVersion: string`.
 *
 * PROJECTION LAW: this module is a READ-MODEL over existing authorities, never a new
 * authority. The projected phase set and its transition map project the TaskStatus /
 * TaskEnvelope semantics of extensions/flauz-agent/src/types.ts (the task/session/event
 * authority) and the flauz.tasks/v0 state machine owned by extensions/flauz-workspace.
 * No scheduler, journal, permission broker, router, or persistence engine may appear
 * here: types, constants, pure guards, mapping tables only.
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
 * authority list so drift is impossible.
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
 * The projected background-agent run phase set. One phase per authority TaskStatus:
 * the projection is total (every authority state maps to exactly one phase).
 */
export const BACKGROUND_RUN_PHASES = [
	'planning',
	'awaiting-input',
	'executing',
	'verifying',
	'awaiting-signoff',
	'failed',
	'completed',
	'cancelled',
] as const;
export type BackgroundRunPhase = (typeof BACKGROUND_RUN_PHASES)[number];

/**
 * Total pure mapping from the authority TaskStatus to the projected run phase.
 * Every authority state maps to exactly one projected phase; no branching, no clock,
 * no randomness.
 */
export const BACKGROUND_RUN_PHASE_OF_TASK_STATUS: Readonly<Record<AuthorityTaskStatus, BackgroundRunPhase>> = {
	plan: 'planning',
	'awaiting-approval': 'awaiting-input',
	execute: 'executing',
	verify: 'verifying',
	'awaiting-signoff': 'awaiting-signoff',
	failed: 'failed',
	done: 'completed',
	cancelled: 'cancelled',
};

/**
 * Pure lookup: the projected run phase for one authority TaskStatus.
 */
export function toBackgroundRunPhase(taskStatus: AuthorityTaskStatus): BackgroundRunPhase {
	return BACKGROUND_RUN_PHASE_OF_TASK_STATUS[taskStatus];
}

/**
 * Read-model of one background agent run. The run is a projection of an authority
 * task envelope (flauz.tasks/v0): `taskEnvelopeId` references that envelope,
 * `sessionId` references the owning agent session, and `lifecycle` is the projected
 * phase of the authority task status. No scheduling or execution state lives here.
 */
export interface BackgroundAgentRunRecord {
	scope: ZcodeScope;
	contractVersion: string;
	id: string;
	sessionId: string;
	taskEnvelopeId: string;
	lifecycle: BackgroundRunPhase;
	createdAt: string;
	updatedAt: string;
}

/**
 * Legal projected phase transitions. This table projects the flauz.tasks/v0 state
 * machine (submit-plan, approve, request-changes, report, verify-pass, verify-fail,
 * fail, sign-off, cancel) through the phase mapping: every authority transition is a
 * legal projected transition. An empty list marks a terminal phase.
 */
export const backgroundRunPhaseTransitions: Readonly<Record<BackgroundRunPhase, readonly BackgroundRunPhase[]>> = {
	planning: ['awaiting-input', 'cancelled'],
	'awaiting-input': ['planning', 'executing', 'cancelled'],
	executing: ['verifying', 'failed', 'cancelled'],
	verifying: ['awaiting-signoff', 'executing', 'cancelled'],
	'awaiting-signoff': ['completed', 'cancelled'],
	failed: [],
	completed: [],
	cancelled: [],
};

/**
 * Pure lookup: reports whether `from` -> `to` is a legal projected background run
 * phase transition.
 */
export function canTransitionBackgroundRunPhase(from: BackgroundRunPhase, to: BackgroundRunPhase): boolean {
	return backgroundRunPhaseTransitions[from].includes(to);
}

/**
 * Guard: true iff the record pins the exact current ZCODE_PATTERNS_CONTRACTS_VERSION.
 */
export function isVersionedBackgroundAgentRunRecord(record: { contractVersion?: string }): boolean {
	return record.contractVersion === ZCODE_PATTERNS_CONTRACTS_VERSION;
}
