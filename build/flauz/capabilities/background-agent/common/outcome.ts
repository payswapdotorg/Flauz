/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * ZC-002 background-agent UX contracts — Outcome.
 *
 * PROJECTION, NOT AUTHORITY: `AgentOutcome` is a read-model of a settled task;
 * `outcomeFromTerminalState` is a pure total mapping from the authority's
 * terminal states to a disposition. The projected state authority is
 * `LIFECYCLE_STATES` from extensions/flauz-execution/src/contracts.ts
 * (contract-duplicated below); the evidence authority is EvidenceRow and the
 * artifact authority is the execution resource/journal handoff
 * (ARCHITECTURE-LOCK §5). No new authority is introduced.
 *
 * DETERMINISM LAW: no `Math.random`, no `Date.now`/`new Date()` inside this
 * module. Timestamps are plain ISO strings; `outcomeFromTerminalState` is a
 * pure function of `taskState`.
 *
 * ZERO-DEPENDENCY LAW: this module imports nothing. The agent-task state
 * vocabulary is CONTRACT-DUPLICATED and pinned in test/common/outcome.test.ts.
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

/**
 * The disposition of a settled task. The four values cover the ZC-002 outcome
 * surface (completion / failure / lost / cancelled). `outcomeFromTerminalState`
 * produces `failed` and `cancelled` from the authority's terminal lifecycle
 * states; `completed` and `lost` are produced by sibling authority paths (a
 * task reaching `done`, or an acquisition reaching `lost`) and are carried on
 * handoff records — see the README for the projected-authorities note.
 */
export type AgentDisposition = 'completed' | 'failed' | 'lost' | 'cancelled';

/** All terminal dispositions (every disposition is a settled outcome). */
export const TERMINAL_DISPOSITIONS = ['completed', 'failed', 'lost', 'cancelled'] as const;

/** One artifact handed off at task settlement. */
export interface ArtifactHandoff {
	kind: string;
	digest: string;
	byteSize: number;
}

/**
 * The outcome of a settled background-agent task — a pure read-model. The
 * `terminalTaskState` is the projected authority state at settlement; the
 * `evidenceDigest` is the content digest of the terminal evidence row (or
 * `null` if none was recorded); `artifacts` is the bounded handoff list.
 */
export interface AgentOutcome {
	scope: CapabilityScope;
	contractVersion: string;
	taskId: string;
	disposition: AgentDisposition;
	terminalTaskState: AgentTaskState;
	evidenceDigest: string | null;
	artifacts: ArtifactHandoff[];
}

/**
 * TOTAL mapping from a terminal authority state to exactly one disposition.
 * Returns `null` for non-terminal states (a non-terminal state has no
 * outcome). Fail-closed assignment:
 *   - `failed`     -> 'failed'   (explicit failure terminal state);
 *   - `destroyed`  -> 'cancelled' (a destroyed task environment did not
 *                     produce a verified completion signal — fail-closed, it
 *                     is never promoted to 'completed' by wording alone).
 *
 * The mapping is total over the authority's terminal states and is pinned by
 * iterating those states in test/common/outcome.test.ts.
 */
export const OUTCOME_FROM_TERMINAL_STATE: Record<(typeof TERMINAL_AGENT_TASK_STATES)[number], AgentDisposition> = {
	'destroyed': 'cancelled',
	'failed': 'failed',
};

/**
 * Pure: the disposition for a terminal `taskState`, or `null` if `taskState`
 * is not terminal. Total — defined for every `AgentTaskState` (returns `null`
 * for the eight non-terminal states, never throws).
 */
export function outcomeFromTerminalState(taskState: AgentTaskState): AgentDisposition | null {
	if (TERMINAL_AGENT_TASK_STATES.includes(taskState as (typeof TERMINAL_AGENT_TASK_STATES)[number])) {
		return OUTCOME_FROM_TERMINAL_STATE[taskState as (typeof TERMINAL_AGENT_TASK_STATES)[number]];
	}
	return null;
}

/**
 * Pure guard: true iff `disposition` is one of the terminal dispositions.
 */
export function isTerminalDisposition(disposition: AgentDisposition): boolean {
	return (TERMINAL_DISPOSITIONS as readonly string[]).includes(disposition);
}

/**
 * Pure guard: true iff `outcome` is settled — i.e. its recorded
 * `terminalTaskState` is a terminal authority state. Fail-closed: an outcome
 * whose `terminalTaskState` is not terminal is not yet settled.
 */
export function isTerminalOutcome(outcome: AgentOutcome): boolean {
	if (!outcome || !outcome.terminalTaskState) {
		return false;
	}
	return TERMINAL_AGENT_TASK_STATES.includes(outcome.terminalTaskState as (typeof TERMINAL_AGENT_TASK_STATES)[number]);
}
