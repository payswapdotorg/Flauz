/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * ZC-001 family 4: Run observability/health contracts. Versioned data contracts,
 * constants, and the pure run-health classifier. Zero-dependency by law: this module
 * imports nothing.
 *
 * DETERMINISM LAW: no `Math.random`, no `Date.now`, no `new Date()` inside this module.
 * Timestamps are plain ISO strings set only at persistence edges; `silentForMs` is a
 * duration measured at the persistence edge that minted the snapshot, never inside
 * this module.
 *
 * SCOPING LAW: every persisted record carries `scope: ZcodeScope` and
 * `contractVersion: string`.
 *
 * PROJECTION LAW: this module is a READ-MODEL over existing authorities, never a new
 * authority. A RunHealthSnapshot summarizes the observable surface of one run (the
 * projected event timeline of the task/journal authorities: extensions/flauz-agent
 * events, the flauz.execution-journal/v0 rows of extensions/flauz-execution) plus the
 * per-agent in-flight roster. No monitor, no scheduler, no probe may appear here:
 * types, constants, pure guards only.
 *
 * THRESHOLD LAW: every classification threshold is a named exported constant
 * (STALL_AFTER_MS); no hidden magic numbers. The classifier is pure: same snapshot
 * in, same verdict out, always.
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
 * Stall threshold: a run whose stall signal (silentForMs) is at or beyond this many
 * milliseconds since its last event classifies as `stalled`. Exported for tuning;
 * the classifier never hides a magic number.
 */
export const STALL_AFTER_MS = 120000;

/**
 * The run health status union.
 */
export const RUN_HEALTH_STATUSES = ['healthy', 'stalled', 'unknown'] as const;
export type RunHealthStatus = (typeof RUN_HEALTH_STATUSES)[number];

/**
 * One row of the concurrency roster: how many operations the named agent has
 * in flight.
 */
export interface AgentInFlightCount {
	readonly agentId: string;
	readonly inFlight: number;
}

/**
 * Read-model of one run's observable health. `lastEventAtIso` is the plain ISO
 * stamp of the last projected event ('' means the run has no events yet);
 * `silentForMs` is the stall signal: milliseconds elapsed since that event,
 * measured at the snapshot's persistence edge; `concurrencyRoster` carries the
 * per-agent in-flight counts. No polling or probe state lives here.
 */
export interface RunHealthSnapshot {
	scope: ZcodeScope;
	contractVersion: string;
	runId: string;
	lastEventAtIso: string;
	silentForMs: number;
	concurrencyRoster: readonly AgentInFlightCount[];
}

/**
 * Pure classifier: maps one snapshot to a RunHealthStatus.
 *
 * - `unknown`: no event yet (lastEventAtIso is ''), a malformed stall signal
 *   (negative or non-finite silentForMs), or a malformed roster row (empty
 *   agentId, negative or non-integer inFlight). Fail-closed: ambiguity is never
 *   reported as healthy or stalled.
 * - `stalled`: silentForMs >= STALL_AFTER_MS.
 * - `healthy`: everything else.
 */
export function classifyRunHealth(snapshot: RunHealthSnapshot): RunHealthStatus {
	if (snapshot.lastEventAtIso === '') {
		return 'unknown';
	}
	if (typeof snapshot.silentForMs !== 'number' || !Number.isFinite(snapshot.silentForMs) || snapshot.silentForMs < 0) {
		return 'unknown';
	}
	for (const row of snapshot.concurrencyRoster) {
		if (typeof row !== 'object' || row === null) {
			return 'unknown';
		}
		if (row.agentId === '' || typeof row.inFlight !== 'number' || !Number.isInteger(row.inFlight) || row.inFlight < 0) {
			return 'unknown';
		}
	}
	return snapshot.silentForMs >= STALL_AFTER_MS ? 'stalled' : 'healthy';
}

/**
 * Guard: true iff the record pins the exact current ZCODE_PATTERNS_CONTRACTS_VERSION.
 */
export function isVersionedRunHealthSnapshot(record: { contractVersion?: string }): boolean {
	return record.contractVersion === ZCODE_PATTERNS_CONTRACTS_VERSION;
}
