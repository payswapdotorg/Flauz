/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * ZC-002 background-agent UX contracts — Message.
 *
 * PROJECTION, NOT AUTHORITY: `AgentMessage` is a read-model of a single
 * user<->agent message; `canDeliverMessage` is a pure guard derived from the
 * authority state machine. The projected state authority is `LIFECYCLE_STATES`
 * from extensions/flauz-execution/src/contracts.ts (contract-duplicated below).
 * No message bus, no transport, no persistence is introduced here.
 *
 * DETERMINISM LAW: no `Math.random`, no `Date.now`/`new Date()` inside this
 * module. Timestamps are plain ISO strings; `canDeliverMessage` is a pure
 * function of (taskState, direction).
 *
 * ZERO-DEPENDENCY LAW: this module imports nothing. The agent-task state
 * vocabulary is CONTRACT-DUPLICATED and pinned in test/common/message.test.ts.
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

/** Pre-launch agent-task states: the task has been registered but not created. */
export const PRE_LAUNCH_AGENT_TASK_STATES = ['registered'] as const;

/** Direction of a message relative to the agent. */
export type AgentMessageDirection = 'to-agent' | 'from-agent';

/**
 * One user<->agent message — a pure read-model. `digest` is the content digest
 * of the message payload (never the payload itself); `sentAtIso` is the
 * persistence-edge ISO 8601 timestamp.
 */
export interface AgentMessage {
	scope: CapabilityScope;
	contractVersion: string;
	taskId: string;
	direction: AgentMessageDirection;
	sentAtIso: string;
	digest: string;
}

/**
 * Message-delivery law, derived from the authority state machine: a message
 * delivers only in states where the authority permits interaction — never in a
 * terminal state, never in a pre-launch state. The legal set is therefore
 * every `AGENT_TASK_STATES` value except `TERMINAL_AGENT_TASK_STATES` and
 * `PRE_LAUNCH_AGENT_TASK_STATES`.
 *
 * The law is currently uniform across directions (both `to-agent` and
 * `from-agent` are admitted in the same interactive set); the `direction`
 * parameter is accepted so the signature is fail-closed (a caller cannot ask
 * for a delivery verdict without declaring a direction) and so the guard can
 * diverge by direction if a future authority refinement distinguishes them.
 */
export const MESSAGE_DELIVERABLE_STATES = [
	'created',
	'starting',
	'running',
	'stopping',
	'stopped',
	'running/attached',
	'stopped/attached',
] as const;

/**
 * Pure guard: true iff a message of `direction` may be delivered while the task
 * is in `taskState`. Fail-closed: an unknown direction never delivers.
 */
export function canDeliverMessage(taskState: AgentTaskState, direction: AgentMessageDirection): boolean {
	if (direction !== 'to-agent' && direction !== 'from-agent') {
		return false;
	}
	return MESSAGE_DELIVERABLE_STATES.includes(taskState as (typeof MESSAGE_DELIVERABLE_STATES)[number]);
}
