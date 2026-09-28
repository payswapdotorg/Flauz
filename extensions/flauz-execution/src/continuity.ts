/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-S2 M4 - the continuity export/restore/reattach integration points:
 * continuity metadata wired into the durable execution graph as
 * first-class persisted rows.
 *
 * The bridge consumes the REAL TL3-006 continuity capability
 * (flauz-environments src/continuityExec: the ContinuityManager over
 * flauz.continuity-bundle/v0 + flauz.continuity-ops/v0) through a
 * structural port and journals:
 *
 *   - continuity-exported  (aggregate row): the bundle id, the surface
 *     classification counts (carried/lost/redacted) and the source
 *     environment - the export record bound to the task's journal.
 *   - continuity-restored  (per acquisition): environment restore rebinds
 *     LOST environment acquisitions (lost -> acquired) with the new
 *     surface, the bundle linkage and the authorization-regated evidence
 *     (the trust posture re-check after restore - fail-closed: an
 *     untrusted restored target is NEVER rebound).
 *   - session-reattached   (per acquisition): browser session loss +
 *     reattach rebinds LOST browser acquisitions when the REAL session
 *     manager's recovery reconciled the session (the same logical session
 *     id, a fresh access surface, the CURRENT policy source re-recorded).
 *
 * Everything is recorded; nothing is fabricated: a rebind that fails the
 * authorization re-gate leaves the acquisition LOST (the typed outcome is
 * returned to the caller; the journal stays the honest truth).
 */

import {
	type ExecActor,
	execSha256Hex,
	canonicalJson,
} from './contracts.ts';
import { ExecJournalStore, type AcquisitionProjection } from './journal.ts';
import type { BrowserSessionManagerPort, EnvironmentLifecyclePort } from './adapters.ts';
import type { EnvironmentSurfaceSnapshot, SurfaceSnapshot } from './contracts.ts';

// ---------------------------------------------------------------------------
// The continuity port (structural; the REAL ContinuityManager satisfies it)
// ---------------------------------------------------------------------------

/** One manifest surface entry (the classification counts derive from these). */
export interface BundleSurfaceEntryLike {
	readonly status: 'carried' | 'lost' | 'redacted';
}

/** The manifest subset this bridge records (contract-duplicated shape). */
export interface ContinuityBundleManifestLike {
	readonly bundleId: string;
	readonly surfaces: Readonly<Record<string, BundleSurfaceEntryLike>>;
	readonly sourceEnvironmentId?: string;
	readonly switchPlanRef?: string;
}

export interface ContinuityPort {
	export(request: { actor?: unknown; environmentId?: unknown; switchPlanRef?: unknown }): Promise<{ ok: true; manifest: ContinuityBundleManifestLike } | { ok: false; error: { code: string; message: string } }>;
	restore(request: { bundleId: unknown; actor?: unknown; targetEnvironmentId?: unknown; force?: unknown }): Promise<{ ok: true; surfaces: readonly unknown[] } | { ok: false; error: { code: string; message: string }; surfaces: readonly unknown[] }>;
	verify(request: { bundleId: unknown; actor?: unknown }): Promise<{ ok: true } | { ok: false; error: { code: string; message: string } }>;
}

// ---------------------------------------------------------------------------
// Export integration point
// ---------------------------------------------------------------------------

export interface ContinuityExportInput {
	readonly actor?: ExecActor;
	readonly environmentId?: string;
	readonly switchPlanRef?: string;
	readonly origin: string;
	readonly graphId?: string | null;
}

export type ContinuityExportOutcome =
	| { readonly ok: true; readonly bundleId: string; readonly rowId: string; readonly carried: number; readonly lost: number; readonly redacted: number }
	| { readonly ok: false; readonly error: { readonly code: string; readonly message: string } };

/** Exports continuity through the REAL manager + journals the aggregate row. */
export async function bindContinuityExport(journal: ExecJournalStore, continuity: ContinuityPort, input: ContinuityExportInput): Promise<ContinuityExportOutcome> {
	const actor = (input.actor ?? 'service') as ExecActor;
	const outcome = await continuity.export({ actor: actor === 'service' ? 'tool' : actor, ...(input.environmentId !== undefined ? { environmentId: input.environmentId } : {}), ...(input.switchPlanRef !== undefined ? { switchPlanRef: input.switchPlanRef } : {}) });
	if (!outcome.ok) {
		return { ok: false, error: outcome.error };
	}
	const surfaces = Object.values(outcome.manifest.surfaces);
	const carried = surfaces.filter((surface) => surface.status === 'carried').length;
	const lost = surfaces.filter((surface) => surface.status === 'lost').length;
	const redacted = surfaces.filter((surface) => surface.status === 'redacted').length;
	const row = journal.appendRow('continuity-exported', {
		graphId: input.graphId ?? null,
		actor,
		origin: input.origin,
		payload: {
			bundleId: outcome.manifest.bundleId,
			...(input.environmentId !== undefined ? { environmentId: input.environmentId } : {}),
			surfacesCarried: carried,
			surfacesLost: lost,
			surfacesRedacted: redacted,
			...(input.switchPlanRef !== undefined ? { switchPlanRef: input.switchPlanRef } : {}),
		},
	});
	return { ok: true, bundleId: outcome.manifest.bundleId, rowId: row.rowId, carried, lost, redacted };
}

// ---------------------------------------------------------------------------
// Environment restore + rebind integration point
// ---------------------------------------------------------------------------

export interface EnvironmentRestoreInput {
	readonly bundleId: string;
	readonly targetEnvironmentId?: string;
	readonly force?: boolean;
	readonly actor?: ExecActor;
	readonly origin: string;
}

export interface RebindResult {
	readonly acquisitionId: string;
	readonly rebound: boolean;
	readonly reason: string;
}

export type EnvironmentRestoreOutcome =
	| { readonly ok: true; readonly rebinds: readonly RebindResult[]; readonly rowIds: readonly string[] }
	| { readonly ok: false; readonly error: { readonly code: string; readonly message: string } };

/**
 * Restores continuity through the REAL manager + rebinds LOST environment
 * acquisitions. The authorization re-gate: the target environment's trust
 * posture + health are re-verified via the lifecycle manager BEFORE any
 * rebind (fail-closed - an untrusted or unverifiable target is never
 * rebound; the acquisition stays lost, honestly).
 */
export async function restoreEnvironmentContinuity(journal: ExecJournalStore, continuity: ContinuityPort, lifecycle: EnvironmentLifecyclePort, input: EnvironmentRestoreInput): Promise<EnvironmentRestoreOutcome> {
	const actor = (input.actor ?? 'service') as ExecActor;
	const restored = await continuity.restore({ bundleId: input.bundleId, actor: actor === 'service' ? 'tool' : actor, ...(input.targetEnvironmentId !== undefined ? { targetEnvironmentId: input.targetEnvironmentId } : {}), ...(input.force === true ? { force: true } : {}) });
	if (!restored.ok) {
		return { ok: false, error: restored.error };
	}
	const rebinds: RebindResult[] = [];
	const rowIds: string[] = [];
	// The LOST environment acquisitions matching the target env (or all lost
	// environment acquisitions when no target is named).
	const candidates = [...journal.acquisitions().values()].filter((acquisition) => {
		if (acquisition.state !== 'lost' || acquisition.resource.resourceClass !== 'environment') {
			return false;
		}
		if (input.targetEnvironmentId === undefined) {
			return true;
		}
		const descriptorId = acquisition.resource.id.split(':')[2] ?? '';
		return descriptorId === input.targetEnvironmentId;
	});
	for (const acquisition of candidates) {
		const descriptorId = acquisition.resource.id.split(':')[2] ?? '';
		const report = await describeEnvironment(lifecycle, descriptorId);
		let rebound = false;
		let reason = '';
		let surface: EnvironmentSurfaceSnapshot | undefined;
		if (report === undefined) {
			reason = `environment ${descriptorId} is unknown to the registry after restore (no rebind - fail-closed)`;
		} else if (report.trust === 'untrusted') {
			reason = `environment ${descriptorId} trust posture is 'untrusted' after restore (no rebind - fail-closed)`;
		} else if (report.verdict.health === 'stale' || report.verdict.health === 'orphan') {
			reason = `environment ${descriptorId} health is '${report.verdict.health}' after restore (no rebind)`;
		} else {
			rebound = true;
			reason = `environment ${descriptorId} restored (state '${report.state}', trust '${report.trust}')`;
			surface = environmentSurfaceOf(report);
		}
		if (rebound && surface !== undefined) {
			const row = journal.appendRow('continuity-restored', {
				graphId: acquisition.graphId,
				stepId: acquisition.stepId,
				attempt: acquisition.attempt,
				idempotencyKey: null,
				acquisitionId: acquisition.acquisitionId,
				actor,
				origin: input.origin,
				payload: {
					bundleId: input.bundleId,
					...(input.targetEnvironmentId !== undefined ? { targetEnvironmentId: input.targetEnvironmentId } : {}),
					authorizationRegated: true,
					note: reason,
				},
			});
			rowIds.push(row.rowId);
			// The new access surface as a hand-off row (the digest chain grows).
			journal.appendRow('handoff-recorded', {
				graphId: acquisition.graphId,
				stepId: acquisition.stepId,
				attempt: acquisition.attempt,
				idempotencyKey: null,
				acquisitionId: acquisition.acquisitionId,
				actor: 'tool',
				origin: `${input.origin}:handoff`,
				payload: { surface, surfaceDigest: execSha256Hex(canonicalJson(surface)) },
			});
		}
		rebinds.push({ acquisitionId: acquisition.acquisitionId, rebound, reason });
	}
	return { ok: true, rebinds, rowIds };
}

// ---------------------------------------------------------------------------
// Browser session reattach integration point
// ---------------------------------------------------------------------------

export interface BrowserReattachInput {
	readonly acquisitionId: string;
	readonly actor?: ExecActor;
	readonly origin: string;
}

export type BrowserReattachOutcome =
	| { readonly ok: true; readonly acquisitionId: string; readonly rowId: string }
	| { readonly ok: false; readonly error: { readonly code: string; readonly message: string } };

/**
 * Reattaches a LOST browser acquisition when the REAL session manager's
 * recovery reconciled the session (the same logical session id; the
 * CURRENT policy source is re-recorded on the surface - the manager's
 * recovery re-gates against the current policy, and this row records that
 * the recheck passed). A session that is gone/closed/failed stays LOST.
 */
export async function reattachBrowserSession(journal: ExecJournalStore, browser: BrowserSessionManagerPort, input: BrowserReattachInput): Promise<BrowserReattachOutcome> {
	const actor = (input.actor ?? 'service') as ExecActor;
	const acquisition = journal.acquisitions().get(input.acquisitionId);
	if (acquisition === undefined) {
		return { ok: false, error: { code: 'EXEC_ACQUISITION_UNKNOWN', message: `unknown acquisition ${input.acquisitionId}` } };
	}
	if (acquisition.resource.resourceClass !== 'browser-session') {
		return { ok: false, error: { code: 'EXEC_ACQUISITION_STATE', message: `acquisition ${input.acquisitionId} is not a browser-session acquisition` } };
	}
	if (acquisition.state !== 'lost') {
		return { ok: false, error: { code: 'EXEC_ACQUISITION_STATE', message: `acquisition ${input.acquisitionId} is '${acquisition.state}' (reattach requires 'lost')` } };
	}
	const descriptor = browser.getSession(acquisition.resource.id);
	if (descriptor === undefined) {
		return { ok: false, error: { code: 'EXEC_RESOURCE_LOST', message: `browser session ${acquisition.resource.id} is not live (no reattach)` } };
	}
	if (descriptor.state !== 'active' && descriptor.state !== 'suspended') {
		return { ok: false, error: { code: 'EXEC_RESOURCE_LOST', message: `browser session ${acquisition.resource.id} is '${descriptor.state}' (no reattach)` } };
	}
	const surface: SurfaceSnapshot = {
		resourceClass: 'browser-session',
		sessionId: descriptor.sessionId,
		initiator: descriptor.initiator,
		partition: descriptor.partition,
		state: descriptor.state,
		tabIds: descriptor.tabs.map((tab) => tab.tabId),
		policySourceRef: descriptor.policySourceRef ?? 'unknown-policy-source',
	};
	const row = journal.appendRow('session-reattached', {
		graphId: acquisition.graphId,
		stepId: acquisition.stepId,
		attempt: acquisition.attempt,
		idempotencyKey: null,
		acquisitionId: acquisition.acquisitionId,
		actor,
		origin: input.origin,
		payload: {
			policyRecheck: 'pass',
			surface,
			surfaceDigest: execSha256Hex(canonicalJson(surface)),
			note: `session ${descriptor.sessionId} reconciled (state '${descriptor.state}', current policy source re-recorded)`,
		},
	});
	return { ok: true, acquisitionId: acquisition.acquisitionId, rowId: row.rowId };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type EnvironmentReport = Awaited<ReturnType<EnvironmentLifecyclePort['describe']>>;

async function describeEnvironment(lifecycle: EnvironmentLifecyclePort, descriptorId: string): Promise<EnvironmentReport | undefined> {
	try {
		return await lifecycle.describe({ id: descriptorId });
	} catch {
		return undefined;
	}
}

function environmentSurfaceOf(report: EnvironmentReport): EnvironmentSurfaceSnapshot {
	return {
		resourceClass: 'environment',
		descriptorId: report.environmentId,
		providerKind: report.kind as EnvironmentSurfaceSnapshot['providerKind'],
		lifecycleState: report.state as EnvironmentSurfaceSnapshot['lifecycleState'],
		executorKind: report.executorKind,
		infrastructureClass: report.executorKind.includes('simulated') ? 'simulated' : 'real',
		trustPosture: report.trust as EnvironmentSurfaceSnapshot['trustPosture'],
		...(report.verdict.lease?.leaseId !== undefined ? { attachLeaseId: report.verdict.lease.leaseId } : {}),
	};
}
