/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * ZC-002 background-agent UX contracts — Launch.
 *
 * PROJECTION, NOT AUTHORITY: every type here is a read-model / request shape
 * over the Flauz agent-task state machine and session/lease/evidence
 * semantics. This module introduces no scheduler, executor, message bus or
 * persistence engine. The projected state authority is `LIFECYCLE_STATES` from
 * extensions/flauz-execution/src/contracts.ts (contract-duplicated below as
 * `AGENT_TASK_STATES`); the session descriptor authority is
 * AgentSessionDescriptor (ARCHITECTURE-LOCK §5). See the README for the full
 * projected-authorities list and the "projections not authorities" rule.
 *
 * DETERMINISM LAW: no `Math.random`, no `Date.now`/`new Date()` inside this
 * module. Timestamps are plain ISO strings set only at persistence edges; every
 * guard is a pure function of its inputs.
 *
 * ZERO-DEPENDENCY LAW: this module imports nothing. The agent-task state
 * vocabulary is CONTRACT-DUPLICATED (closed `as const` list with a derived
 * union) and pinned against the authority by runtime equality + type pins in
 * test/common/launch.test.ts.
 *
 * SCOPING LAW: every persisted record carries `scope: CapabilityScope` and
 * `contractVersion: string`; timestamps are plain-string ISO 8601.
 */

/** Version of this contract set; a record is current only when its `contractVersion` matches exactly. */
export const BACKGROUND_AGENT_UX_VERSION = '1.0.0';

/** Workspace/tenant scoping tuple attached to every persisted record. */
export interface CapabilityScope {
	workspaceId: string;
	tenantId: string;
}

/**
 * The agent-task state authority, CONTRACT-DUPLICATED from `LIFECYCLE_STATES`
 * (extensions/flauz-execution/src/contracts.ts — the execution lifecycle state
 * machine). Duplicated, never imported, per the zero-dependency law; pinned by
 * runtime list equality + type pins in the test suites.
 */
export const AGENT_TASK_STATES = [
	'registered',
	'created',
	'starting',
	'running',
	'stopping',
	'stopped',
	'destroyed',
	'failed',
	'running/attached',
	'stopped/attached',
] as const;
export type AgentTaskState = (typeof AGENT_TASK_STATES)[number];

/** Terminal agent-task states: no further control verbs admitted. */
export const TERMINAL_AGENT_TASK_STATES = ['destroyed', 'failed'] as const;

/** The projected authority state a task starts in at launch. */
export const INITIAL_AGENT_TASK_STATE: AgentTaskState = 'registered';

/** Pre-launch states: a launch has not yet created the task. */
export const PRE_LAUNCH_AGENT_TASK_STATES = ['registered'] as const;

/**
 * Pure projection of the AgentSessionDescriptor fields the launch surface needs
 * to declare what it is launching. Identity only — no capability grants.
 */
export interface AgentSessionDescriptorSummary {
	sessionId: string;
	agentBodyId?: string;
	modelId?: string;
	environmentId?: string;
}

/** Budget hints as plain non-negative numbers; advisory, never enforceable here. */
export interface AgentBudgetHints {
	maxCostUsd?: number;
	maxLatencyMs?: number;
	maxSteps?: number;
}

/**
 * Launch request — a pure request shape. Carries scope, the contract version,
 * a projection of the session to launch, a digest of the initial instruction,
 * advisory budget hints (plain numbers) and the request timestamp.
 */
export interface AgentLaunchRequest {
	scope: CapabilityScope;
	contractVersion: string;
	sessionDescriptorSummary: AgentSessionDescriptorSummary;
	initialInstructionDigest: string;
	budgetHints: AgentBudgetHints;
	requestedAtIso: string;
}

/** Lease grant summary fields ONLY — never the full lease record. */
export interface LeaseGrantSummary {
	leaseId: string;
	grantedAtIso: string;
	expiresAtIso: string;
}

/**
 * Launch acceptance — the authority's pure projection of whether it will admit
 * the launch. `projectedInitialTaskState` is the AgentTaskState the authority
 * will start in; `leaseGrant` carries lease summary fields ONLY and is present
 * iff `accepted`.
 */
export interface AgentLaunchAcceptance {
	scope: CapabilityScope;
	contractVersion: string;
	accepted: boolean;
	projectedInitialTaskState: AgentTaskState;
	leaseGrant: LeaseGrantSummary | null;
	rejectionReason?: string;
}

/**
 * Pure: true iff `n` is a finite non-negative number.
 */
function isFiniteNonNegative(n: number | undefined): boolean {
	return typeof n === 'number' && Number.isFinite(n) && n >= 0;
}

/**
 * Pure: true iff `s` is a non-empty string.
 */
function isNonEmptyString(s: unknown): s is string {
	return typeof s === 'string' && s.length > 0;
}

/**
 * Pure admission guard over the roster. A launch is admissible iff:
 *   - the request pins the current BACKGROUND_AGENT_UX_VERSION;
 *   - scope (workspaceId, tenantId) is non-empty;
 *   - the session descriptor summary carries a non-empty sessionId;
 *   - the initial instruction digest is non-empty;
 *   - every present budget hint is a finite non-negative number;
 *   - there is roster room: `currentRosterCount < maxConcurrent` (both >= 0).
 *
 * This is a pure projection over roster capacity; it grants nothing and
 * persists nothing.
 */
export function canAcceptLaunch(
	request: AgentLaunchRequest,
	currentRosterCount: number,
	maxConcurrent: number,
): boolean {
	if (request.contractVersion !== BACKGROUND_AGENT_UX_VERSION) {
		return false;
	}
	if (!request.scope || !isNonEmptyString(request.scope.workspaceId) || !isNonEmptyString(request.scope.tenantId)) {
		return false;
	}
	if (!request.sessionDescriptorSummary || !isNonEmptyString(request.sessionDescriptorSummary.sessionId)) {
		return false;
	}
	if (!isNonEmptyString(request.initialInstructionDigest)) {
		return false;
	}
	const hints = request.budgetHints ?? {};
	if (!isFiniteNonNegative(hints.maxCostUsd) && hints.maxCostUsd !== undefined) {
		return false;
	}
	if (!isFiniteNonNegative(hints.maxLatencyMs) && hints.maxLatencyMs !== undefined) {
		return false;
	}
	if (!isFiniteNonNegative(hints.maxSteps) && hints.maxSteps !== undefined) {
		return false;
	}
	if (typeof currentRosterCount !== 'number' || !Number.isFinite(currentRosterCount) || currentRosterCount < 0) {
		return false;
	}
	if (typeof maxConcurrent !== 'number' || !Number.isFinite(maxConcurrent) || maxConcurrent < 0) {
		return false;
	}
	return currentRosterCount < maxConcurrent;
}

/**
 * Pure: builds the projected `AgentLaunchAcceptance` for a launch request
 * against the current roster. The projected initial task state is always
 * `INITIAL_AGENT_TASK_STATE`; `leaseGrant` is a pure placeholder summary iff
 * admissible (the authority minted lease id is supplied by the caller's
 * persistence edge — this helper only shapes the projection).
 */
export function buildLaunchAcceptance(
	request: AgentLaunchRequest,
	currentRosterCount: number,
	maxConcurrent: number,
	leaseGrant: LeaseGrantSummary | null,
): AgentLaunchAcceptance {
	const accepted = canAcceptLaunch(request, currentRosterCount, maxConcurrent);
	return {
		scope: request.scope,
		contractVersion: BACKGROUND_AGENT_UX_VERSION,
		accepted,
		projectedInitialTaskState: INITIAL_AGENT_TASK_STATE,
		leaseGrant: accepted ? leaseGrant : null,
		rejectionReason: accepted ? undefined : rejectionReasonFor(request, currentRosterCount, maxConcurrent),
	};
}

/**
 * Pure: a stable, human-readable rejection reason (fail-closed; never leaks
 * secret material). Deterministic — a function of the inputs only.
 */
export function rejectionReasonFor(
	request: AgentLaunchRequest,
	currentRosterCount: number,
	maxConcurrent: number,
): string {
	if (request.contractVersion !== BACKGROUND_AGENT_UX_VERSION) {
		return 'contract-version-mismatch';
	}
	if (!request.scope || !isNonEmptyString(request.scope.workspaceId) || !isNonEmptyString(request.scope.tenantId)) {
		return 'invalid-scope';
	}
	if (!request.sessionDescriptorSummary || !isNonEmptyString(request.sessionDescriptorSummary.sessionId)) {
		return 'invalid-session-descriptor-summary';
	}
	if (!isNonEmptyString(request.initialInstructionDigest)) {
		return 'missing-initial-instruction-digest';
	}
	const hints = request.budgetHints ?? {};
	if (
		(hints.maxCostUsd !== undefined && !isFiniteNonNegative(hints.maxCostUsd)) ||
		(hints.maxLatencyMs !== undefined && !isFiniteNonNegative(hints.maxLatencyMs)) ||
		(hints.maxSteps !== undefined && !isFiniteNonNegative(hints.maxSteps))
	) {
		return 'invalid-budget-hints';
	}
	if (!(Number.isFinite(currentRosterCount) && currentRosterCount >= 0) || !(Number.isFinite(maxConcurrent) && maxConcurrent >= 0)) {
		return 'invalid-roster-arguments';
	}
	if (currentRosterCount >= maxConcurrent) {
		return 'roster-full';
	}
	return 'unknown';
}
