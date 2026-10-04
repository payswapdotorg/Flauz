/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * ZC-002 background-agent UX contracts — UX session registry view (roster).
 *
 * PROJECTION, NOT AUTHORITY: `BackgroundAgentRosterEntry` is a read-model of
 * one task in the background-agent roster; `rosterFromTaskRecords` is a pure
 * projection and `HEALTH_PROJECTION` is a pure total classification of the
 * authority states. The projected state authority is `LIFECYCLE_STATES` from
 * extensions/flauz-execution/src/contracts.ts (contract-duplicated below); the
 * session authority is AgentSessionDescriptor (ARCHITECTURE-LOCK §5). No new
 * authority is introduced.
 *
 * DETERMINISM LAW: no `Math.random`, no `Date.now`/`new Date()` inside this
 * module. `rosterFromTaskRecords` is a pure function of its input.
 *
 * ZERO-DEPENDENCY LAW: this module imports nothing. The agent-task state
 * vocabulary is CONTRACT-DUPLICATED and pinned in test/common/registryView.test.ts.
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

/** The agent-task state authority, CONTRACT-DUPLICATED from `LIFECYCLE_STATES`. */
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

/** Terminal agent-task states. */
export const TERMINAL_AGENT_TASK_STATES = ['destroyed', 'failed'] as const;

/** Running-shape states (actively executing). */
export const ACTIVE_AGENT_TASK_STATES = ['running', 'running/attached'] as const;

/** Waiting-shape states (not actively executing, not terminal). */
export const IDLE_AGENT_TASK_STATES = [
	'registered',
	'created',
	'starting',
	'stopping',
	'stopped',
	'stopped/attached',
] as const;

/** The health projection of a roster entry. */
export type HealthProjection = 'active' | 'idle' | 'terminal';

/**
 * Pure projection of the AgentSessionDescriptor fields the roster needs.
 * Identity only — no capability grants.
 */
export interface AgentSessionDescriptorSummary {
	sessionId: string;
	agentBodyId?: string;
	modelId?: string;
	environmentId?: string;
}

/**
 * TOTAL health-classification law: each authority state is classified exactly
 * once as `active` (running-shape), `idle` (waiting-shape) or `terminal`.
 */
export const HEALTH_PROJECTION: Record<AgentTaskState, HealthProjection> = {
	'registered': 'idle',
	'created': 'idle',
	'starting': 'idle',
	'running': 'active',
	'stopping': 'idle',
	'stopped': 'idle',
	'destroyed': 'terminal',
	'failed': 'terminal',
	'running/attached': 'active',
	'stopped/attached': 'idle',
};

/**
 * One entry in the background-agent roster — a pure read-model.
 */
export interface BackgroundAgentRosterEntry {
	scope: CapabilityScope;
	contractVersion: string;
	taskId: string;
	sessionSummary: AgentSessionDescriptorSummary;
	currentState: AgentTaskState;
	healthProjection: HealthProjection;
}

/**
 * The plain input shape `rosterFromTaskRecords` accepts. Carries ONLY
 * authority fields: scope, task id, the projected AgentTaskState, and a
 * session descriptor summary.
 */
export interface RosterTaskRecord {
	scope: CapabilityScope;
	taskId: string;
	currentState: AgentTaskState;
	sessionSummary: AgentSessionDescriptorSummary;
}

/**
 * Pure: the health projection for a single authority state. Total — defined
 * for every `AgentTaskState`.
 */
export function healthOf(taskState: AgentTaskState): HealthProjection {
	return HEALTH_PROJECTION[taskState];
}

/**
 * Pure: projects an array of `RosterTaskRecord` into the background-agent
 * roster. Each entry's `healthProjection` is derived from `currentState` via
 * the total `HEALTH_PROJECTION` map. The roster order mirrors the input order.
 */
export function rosterFromTaskRecords(records: RosterTaskRecord[]): BackgroundAgentRosterEntry[] {
	if (!Array.isArray(records)) {
		return [];
	}
	const roster: BackgroundAgentRosterEntry[] = [];
	for (const record of records) {
		// Fail-closed: skip records missing scope, with empty scope fields, or
		// with an empty task id. The session summary is otherwise trusted as a
		// projection of AgentSessionDescriptor.
		if (!record || !record.scope
			|| typeof record.scope.workspaceId !== 'string' || record.scope.workspaceId.length === 0
			|| typeof record.scope.tenantId !== 'string' || record.scope.tenantId.length === 0
			|| typeof record.taskId !== 'string' || record.taskId.length === 0) {
			continue;
		}
		roster.push({
			scope: record.scope,
			contractVersion: BACKGROUND_AGENT_UX_VERSION,
			taskId: record.taskId,
			sessionSummary: record.sessionSummary,
			currentState: record.currentState,
			healthProjection: HEALTH_PROJECTION[record.currentState],
		});
	}
	return roster;
}
