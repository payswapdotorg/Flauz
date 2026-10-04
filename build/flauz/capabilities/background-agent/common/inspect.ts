/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * ZC-002 background-agent UX contracts — Inspect.
 *
 * PROJECTION, NOT AUTHORITY: `AgentInspectView` is a read-model over a task
 * record's authority fields (AgentTaskState, evidence digest, lease remaining,
 * journal timeline). The projected state authority is `LIFECYCLE_STATES` from
 * extensions/flauz-execution/src/contracts.ts (contract-duplicated below); the
 * timeline/evidence/lease authorities are the execution journal, EvidenceRow
 * and OperationLease (ARCHITECTURE-LOCK §5). No new authority is introduced.
 *
 * DETERMINISM LAW: no `Math.random`, no `Date.now`/`new Date()` inside this
 * module. Timestamps are plain ISO strings; `projectInspectView` is a pure
 * function of its input.
 *
 * ZERO-DEPENDENCY LAW: this module imports nothing. The agent-task state
 * vocabulary is CONTRACT-DUPLICATED and pinned in test/common/inspect.test.ts.
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

/** One bounded summary entry of the journal timeline. */
export interface AgentTimelineDigestEntry {
	atIso: string;
	kind: string;
	digest: string;
}

/** Bound on the number of timeline entries an inspect view retains. */
export const TIMELINE_DIGEST_MAX = 10;

/**
 * The inspect read-model — a pure projection of a task record's authority
 * fields. `leaseRemaining` is a plain non-negative number (milliseconds
 * remaining); `timelineDigest` is bounded to the last `TIMELINE_DIGEST_MAX`
 * summary entries.
 */
export interface AgentInspectView {
	scope: CapabilityScope;
	contractVersion: string;
	taskId: string;
	currentState: AgentTaskState;
	lastEvidenceDigest: string | null;
	leaseRemaining: number;
	timelineDigest: AgentTimelineDigestEntry[];
}

/**
 * The plain input shape `projectInspectView` accepts. Carries ONLY authority
 * fields: scope, task id, the projected AgentTaskState, the last evidence
 * digest, the lease remaining (ms), and the raw journal timeline.
 */
export interface InspectTaskRecord {
	scope: CapabilityScope;
	taskId: string;
	currentState: AgentTaskState;
	lastEvidenceDigest: string | null;
	leaseRemainingMs: number;
	timeline: AgentTimelineDigestEntry[];
}

/**
 * Pure: projects an `InspectTaskRecord` into a bounded `AgentInspectView`.
 * The timeline is truncated to the last `TIMELINE_DIGEST_MAX` entries
 * (deterministic, order-preserving). `leaseRemaining` is clamped to >= 0.
 */
export function projectInspectView(record: InspectTaskRecord): AgentInspectView {
	const rawTimeline = Array.isArray(record.timeline) ? record.timeline : [];
	const start = Math.max(0, rawTimeline.length - TIMELINE_DIGEST_MAX);
	const timelineDigest = rawTimeline.slice(start);
	const leaseRemaining = typeof record.leaseRemainingMs === 'number' && Number.isFinite(record.leaseRemainingMs) && record.leaseRemainingMs > 0
		? record.leaseRemainingMs
		: 0;
	return {
		scope: record.scope,
		contractVersion: BACKGROUND_AGENT_UX_VERSION,
		taskId: record.taskId,
		currentState: record.currentState,
		lastEvidenceDigest: record.lastEvidenceDigest ?? null,
		leaseRemaining,
		timelineDigest,
	};
}

/**
 * Pure: deep equality of two inspect views. Two views are equal iff every
 * field matches, including timeline length and each timeline entry
 * (`atIso`, `kind`, `digest`).
 */
export function inspectViewsEqual(a: AgentInspectView, b: AgentInspectView): boolean {
	if (a === b) {
		return true;
	}
	if (!a || !b) {
		return false;
	}
	if (a.contractVersion !== b.contractVersion) {
		return false;
	}
	if (a.taskId !== b.taskId) {
		return false;
	}
	if (a.currentState !== b.currentState) {
		return false;
	}
	if (a.lastEvidenceDigest !== b.lastEvidenceDigest) {
		return false;
	}
	if (a.leaseRemaining !== b.leaseRemaining) {
		return false;
	}
	if (a.scope.workspaceId !== b.scope.workspaceId || a.scope.tenantId !== b.scope.tenantId) {
		return false;
	}
	const at = a.timelineDigest;
	const bt = b.timelineDigest;
	if (at.length !== bt.length) {
		return false;
	}
	for (let i = 0; i < at.length; i++) {
		if (at[i].atIso !== bt[i].atIso || at[i].kind !== bt[i].kind || at[i].digest !== bt[i].digest) {
			return false;
		}
	}
	return true;
}
