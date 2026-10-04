/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * ZC-002 background-agent UX contracts — Control (pause / stop / cancel / resume).
 *
 * PROJECTION, NOT AUTHORITY: the control verbs are typed request shapes over
 * the agent-task state machine; `controlAdmissible` is a pure transition-map
 * guard derived from the authority. The projected state authority is
 * `LIFECYCLE_STATES` from extensions/flauz-execution/src/contracts.ts
 * (contract-duplicated below). No executor, no scheduler, no side effect.
 *
 * DETERMINISM LAW: no `Math.random`, no `Date.now`/`new Date()` inside this
 * module. Timestamps are plain ISO strings; `controlAdmissible` is a pure
 * function of (taskState, verb).
 *
 * ZERO-DEPENDENCY LAW: this module imports nothing. The agent-task state
 * vocabulary is CONTRACT-DUPLICATED and pinned in test/common/control.test.ts.
 *
 * FAIL-CLOSED TYPING: an illegal (verb, state) pair is guarded —
 * `controlAdmissible` returns `false` for it; it is never representable as
 * admissible. The admissibility map is TOTAL over the authority states: every
 * `AgentTaskState` has a defined (possibly empty) admissible-verb list.
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

/** Terminal agent-task states: no control verbs admitted. */
export const TERMINAL_AGENT_TASK_STATES = ['destroyed', 'failed'] as const;

/** The control verbs exposed by the background-agent UX surface. */
export const CONTROL_VERBS = ['pause', 'stop', 'cancel', 'resume'] as const;
export type ControlVerb = (typeof CONTROL_VERBS)[number];

/** Common shape of a control request — each verb has a dedicated request type. */
interface ControlRequestBase {
	scope: CapabilityScope;
	contractVersion: string;
	taskId: string;
	reason: string;
	requestedAtIso: string;
}

/** Request to pause a running-shape task. */
export interface PauseRequest extends ControlRequestBase {
	verb: 'pause';
}

/** Request to stop a running/starting task. */
export interface StopRequest extends ControlRequestBase {
	verb: 'stop';
}

/** Request to cancel a non-terminal task. */
export interface CancelRequest extends ControlRequestBase {
	verb: 'cancel';
}

/** Request to resume a stopped-shape task. */
export interface ResumeRequest extends ControlRequestBase {
	verb: 'resume';
}

/** Union of all control request shapes. */
export type ControlRequest = PauseRequest | StopRequest | CancelRequest | ResumeRequest;

/**
 * TOTAL admissibility map: for each `AgentTaskState`, the admissible control
 * verbs the authority state machine admits FROM that state. Every authority
 * state is classified exactly once. Terminal states admit no verbs.
 *
 * Rationale (pure projection over the execution lifecycle state machine):
 *   - pause    — from running-shape states (`running`, `running/attached`);
 *   - stop     — from a running or starting task (`starting`, `running`,
 *                 `running/attached`);
 *   - cancel   — from any non-terminal state (a registered/created/starting/
 *                 running/stopping/stopped/attached-stopped task may be
 *                 cancelled); never from `destroyed`/`failed`;
 *   - resume   — from stopped-shape states (`stopped`, `stopped/attached`),
 *                 the closest authority projection of a paused-and-resumable
 *                 task (the authority has no dedicated `paused` state).
 */
export const CONTROL_ADMISSIBILITY: Record<AgentTaskState, ControlVerb[]> = {
	'registered': ['cancel'],
	'created': ['cancel'],
	'starting': ['stop', 'cancel'],
	'running': ['pause', 'stop', 'cancel'],
	'stopping': ['cancel'],
	'stopped': ['resume', 'cancel'],
	'destroyed': [],
	'failed': [],
	'running/attached': ['pause', 'stop', 'cancel'],
	'stopped/attached': ['resume', 'cancel'],
};

/**
 * Pure guard: true iff `verb` is admissible from `taskState` under the
 * authority state machine. Total — defined for every (state, verb) pair.
 */
export function controlAdmissible(taskState: AgentTaskState, verb: ControlVerb): boolean {
	const admitted = CONTROL_ADMISSIBILITY[taskState];
	return Array.isArray(admitted) && admitted.includes(verb);
}

/**
 * Pure: the list of control verbs admissible from `taskState`. Total — defined
 * for every authority state (terminal states return `[]`).
 */
export function admissibleControlVerbs(taskState: AgentTaskState): ControlVerb[] {
	return CONTROL_ADMISSIBILITY[taskState].slice();
}

/**
 * Pure guard: true iff `request` is well-formed against the current contract
 * version and carries a non-empty task id, reason and ISO timestamp.
 */
export function isWellFormedControlRequest(request: ControlRequest): boolean {
	if (!request || request.contractVersion !== BACKGROUND_AGENT_UX_VERSION) {
		return false;
	}
	if (!request.scope || typeof request.scope.workspaceId !== 'string' || request.scope.workspaceId.length === 0
		|| typeof request.scope.tenantId !== 'string' || request.scope.tenantId.length === 0) {
		return false;
	}
	if (typeof request.taskId !== 'string' || request.taskId.length === 0) {
		return false;
	}
	if (typeof request.reason !== 'string' || request.reason.length === 0) {
		return false;
	}
	if (typeof request.requestedAtIso !== 'string' || request.requestedAtIso.length === 0) {
		return false;
	}
	return CONTROL_VERBS.includes(request.verb);
}
