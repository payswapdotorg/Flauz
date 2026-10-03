/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The supervision-verdict core (A-PROD-005-W4): the
 * `flauz.durability.status` semantics.
 *
 * The verdict table per lane (the order's law, typed, never silent):
 *
 *   supervised-green -- LIVE + the lane's state surfaces resolve (the
 *                      checkpoint-law consultation resolved);
 *   stale            -- the lane's liveness is STALE (liveness dominates);
 *   flat             -- the lane's liveness is FLAT (liveness dominates);
 *   unknown          -- a TORN lane row (the registry parsed, the row did
 *                      not) or a torn consulted audit: typed, never guessed;
 *   degraded         -- LIVE but the lane's state surfaces do NOT resolve
 *                      (a surface absent from the workspace, an owner with
 *                      zero workspace-bound surfaces, or the consulted
 *                      audit absent/torn -- typed, never a silent green).
 *
 * THE CHECKPOINT LAW CONSULTATION (read-only, the order's law): for each
 * lane the durability of its state --
 *   (a) the workspace-bound record surfaces the lane's owning extension
 *       owns, through the W3 isolation audit's derivation surfaces (the
 *       newest `.flauz/isolation/audit-<stamp>.json` record, read-only,
 *       contract-duplicated shapes); a surface resolves when it is present;
 *   (b) the W2 backup plane's export anchor when one exists (the newest
 *       `.flauz-exports/export-<stamp>/export.json`, the banked export the
 *       lane's workspace resolves; absence is honest, never a violation).
 *
 * The beat-history shape: the inter-beat intervals of the ring -- min /
 * median / max plus the jitter disclosure (the maximum deviation from the
 * lane's configured heartbeat interval; numbers only, never contents).
 * The median is the middle element after sorting; for even counts the mean
 * of the two middle elements (documented, deterministic).
 *
 * The record persists `.flauz/durability/status-<stamp>.json`
 * (`flauz.durability-status/v1`), swept fail-closed + banked
 * census-visible (taskId `flauz-durability`).
 */

import {
        type Clock,
        type DurabilityFsPort,
        type LaneRecord,
        type LivenessClass,
        type SupervisionVerdict,
        type IsolationAuditSurfaceRow,
        type ConsultationState,
        type ExportAnchorState,
        type LanesRegistryState,
        DURABILITY_DIR,
        EXTENSION_ID,
        STATUS_PREFIX,
        STATUS_SCHEMA_ID,
        joinPath,
        readLanesRegistry,
        consultIsolationAudit,
        resolveExportAnchor,
        serializeArtifact,
} from './api.ts';
import { classifyLiveness, BOUNDARY_DISCLOSURE } from './heartbeat.ts';
import { durabilityStamp } from './lanes.ts';
import { bankRecord, type BankingOutcome } from './banking.ts';

/** One lane's beat-history shape (the inter-beat intervals of the ring). */
export interface IntervalStats {
        readonly sampleCount: number;
        readonly minMs: number;
        readonly medianMs: number;
        readonly maxMs: number;
        /** The jitter disclosure: the maximum ABSOLUTE deviation from the lane's configured interval. */
        readonly maxDeviationMs: number;
}

/** One lane's checkpoint-law consultation row. */
export interface CheckpointLawRow {
        /** The consulted audit record (workspace-relative) + its typed state. */
        readonly consultation: 'resolved' | 'degraded' | 'absent' | 'unknown';
        readonly consultedRecord?: string;
        /** The lane's owning extension's workspace-bound surfaces (shapes only, from the audit's derivation). */
        readonly stateSurfaces: readonly {
                readonly id: string;
                readonly owner: string;
                readonly classification: string;
                readonly boundary: string;
                readonly present: boolean;
        }[];
        /** True when >=1 surface exists and every one is present (the supervised-green gate). */
        readonly stateSurfacesResolve: boolean;
        /** The W2 backup plane's export anchor (present only when the operator banked one; a torn newest export is disclosed typed, never silent). */
        readonly exportAnchor: {
                readonly present: boolean;
                readonly exportDirName?: string;
                readonly createdAt?: number;
                readonly tornReason?: string;
        };
}

/** One lane's verdict row (the status record's typed table). */
export interface LaneStatusRow {
        readonly laneId: string;
        readonly owner: string;
        readonly liveness: LivenessClass;
        readonly verdict: SupervisionVerdict;
        readonly beats: number;
        readonly totalBeats: number;
        readonly intervalStats?: IntervalStats;
        readonly escalation: {
                readonly policy: string;
                readonly demandCount: number;
                readonly lastDemandAt?: number;
                /** True when the lane's CURRENT liveness demands escalation (stale/flat now). */
                readonly outstanding: boolean;
        };
        readonly checkpointLaw: CheckpointLawRow;
        /** Present ONLY on torn rows (the typed-unknown source). */
        readonly tornReason?: string;
}

/** The persisted supervision-verdict record (schema `flauz.durability-status/v1`). */
export interface DurabilityStatusRecord {
        readonly $schema: typeof STATUS_SCHEMA_ID;
        readonly schemaVersion: 0;
        readonly kind: 'flauz-durability-status';
        readonly createdAt: number;
        readonly extensionId: typeof EXTENSION_ID;
        /** The honest-boundary disclosure, verbatim in every record. */
        readonly boundaryDisclosure: string;
        /** The lane registry's typed state at the verdict's instant. */
        readonly registryState: 'resolved' | 'torn' | 'absent';
        readonly tornReason?: string;
        readonly lanes: readonly LaneStatusRow[];
        readonly counts: {
                readonly lanes: number;
                readonly supervisedGreen: number;
                readonly stale: number;
                readonly flat: number;
                readonly unknown: number;
                readonly degraded: number;
                readonly escalationOutstanding: number;
        };
}

/** The status outcome (command-level). */
export interface StatusResult {
        readonly ok: true;
        readonly record: DurabilityStatusRecord;
        readonly persisted: PersistedStatus;
}

/** The persisted outcome. */
export interface PersistedStatus {
        readonly recordPath: string;
        readonly record: DurabilityStatusRecord;
        readonly banking: BankingOutcome;
}

/** The inter-beat interval statistics of one ring (the beat-history shape). */
export function intervalStatsOf(lane: LaneRecord): IntervalStats | undefined {
        if (lane.beats.length < 2) {
                return undefined; // a single beat has no interval; honest absence, never a faked zero
        }
        const diffs: number[] = [];
        for (let index = 1; index < lane.beats.length; index++) {
                diffs.push((lane.beats[index] as number) - (lane.beats[index - 1] as number));
        }
        const sorted = [...diffs].sort((a, b) => a - b);
        const middle = Math.floor(sorted.length / 2);
        const median = sorted.length % 2 === 1 ? (sorted[middle] as number) : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
        let maxDeviation = 0;
        for (const diff of diffs) {
                maxDeviation = Math.max(maxDeviation, Math.abs(diff - lane.heartbeatIntervalMs));
        }
        return {
                sampleCount: diffs.length,
                minMs: sorted[0] as number,
                medianMs: median,
                maxMs: sorted[sorted.length - 1] as number,
                maxDeviationMs: maxDeviation,
        };
}

/** The checkpoint-law consultation for one lane (read-only over the consulted surfaces). */
function checkpointLawOf(lane: LaneRecord, consultation: ConsultationState, anchor: ExportAnchorState): CheckpointLawRow {
        if (consultation.state === 'absent' || consultation.state === 'torn') {
                return {
                        consultation: 'unknown',
                        stateSurfaces: [],
                        stateSurfacesResolve: false,
                        exportAnchor: anchorToRow(anchor),
                };
        }
        const surfaces = consultation.consultation.surfaces.filter(
                (surface: IsolationAuditSurfaceRow) => surface.owner === lane.owner && surface.classification === 'workspace-bound',
        );
        const everyPresent = surfaces.length > 0 && surfaces.every(surface => surface.present);
        return {
                consultation: surfaces.length === 0 ? 'absent' : everyPresent ? 'resolved' : 'degraded',
                consultedRecord: consultation.consultation.consultedRecord,
                stateSurfaces: surfaces.map(surface => ({
                        id: surface.id,
                        owner: surface.owner,
                        classification: surface.classification,
                        boundary: surface.boundary,
                        present: surface.present,
                })),
                stateSurfacesResolve: everyPresent,
                exportAnchor: anchorToRow(anchor),
        };
}

function anchorToRow(anchor: ExportAnchorState): CheckpointLawRow['exportAnchor'] {
        if (anchor.state === 'present') {
                return { present: true, ...(anchor.anchor.exportDirName !== undefined ? { exportDirName: anchor.anchor.exportDirName } : {}), ...(anchor.anchor.createdAt !== undefined ? { createdAt: anchor.anchor.createdAt } : {}) };
        }
        if (anchor.state === 'torn') {
                // a torn newest export is disclosed typed (the anchor exists but does not resolve) -- never a silent false
                return { present: false, tornReason: anchor.reason };
        }
        return { present: false };
}

/** The verdict law: liveness dominates; the checkpoint law gates green; never a silent green. */
function verdictOf(liveness: LivenessClass, checkpoint: CheckpointLawRow): SupervisionVerdict {
        if (liveness === 'STALE') {
                return 'stale';
        }
        if (liveness === 'FLAT') {
                return 'flat';
        }
        if (liveness === 'UNKNOWN') {
                return 'unknown';
        }
        // LIVE: the checkpoint law decides between supervised-green and degraded.
        return checkpoint.stateSurfacesResolve ? 'supervised-green' : 'degraded';
}

/**
 * The supervision verdict: every registered lane with its liveness class,
 * its beat-history shape, its escalation state and its checkpoint-law
 * consultation. A torn registry persists the honest typed record (zero
 * lanes + the reason -- never a guessed summary); a torn lane row carries
 * the typed unknown verdict.
 */
export async function runStatus(deps: { root: string; fs: DurabilityFsPort; clock: Clock }): Promise<StatusResult> {
        const at = deps.clock();
        const registry: LanesRegistryState = await readLanesRegistry(deps.root, deps.fs);
        const consultation = await consultIsolationAudit(deps.root, deps.fs);
        const anchor = await resolveExportAnchor(deps.root, deps.fs);

        const rows: LaneStatusRow[] = [];
        if (registry.state === 'resolved') {
                for (const lane of registry.record.lanes) {
                        const liveness = classifyLiveness(lane, at);
                        const checkpoint = checkpointLawOf(lane, consultation, anchor);
                        rows.push({
                                laneId: lane.laneId,
                                owner: lane.owner,
                                liveness,
                                verdict: verdictOf(liveness, checkpoint),
                                beats: lane.beats.length,
                                totalBeats: lane.totalBeats,
                                ...(intervalStatsOf(lane) !== undefined ? { intervalStats: intervalStatsOf(lane) } : {}),
                                escalation: {
                                        policy: lane.escalationPolicy,
                                        demandCount: lane.escalation.demandCount,
                                        ...(lane.escalation.lastDemandAt !== undefined ? { lastDemandAt: lane.escalation.lastDemandAt } : {}),
                                        outstanding: liveness === 'STALE' || liveness === 'FLAT',
                                },
                                checkpointLaw: checkpoint,
                        });
                }
                // torn lane rows surface as typed unknown verdicts (the registry parsed, the row did not -- never a guessed verdict)
                for (const tornLaneId of registry.tornLaneIds) {
                        rows.push({
                                laneId: tornLaneId,
                                owner: '(torn)',
                                liveness: 'UNKNOWN',
                                verdict: 'unknown',
                                beats: 0,
                                totalBeats: 0,
                                escalation: { policy: '(torn)', demandCount: 0, outstanding: false },
                                checkpointLaw: { consultation: 'unknown', stateSurfaces: [], stateSurfacesResolve: false, exportAnchor: anchorToRow(anchor) },
                                tornReason: 'the lane row is torn (the registry parsed, the row did not) -- typed unknown, never a guessed verdict',
                        });
                }
        }

        const record: DurabilityStatusRecord = {
                $schema: STATUS_SCHEMA_ID,
                schemaVersion: 0,
                kind: 'flauz-durability-status',
                createdAt: at,
                extensionId: EXTENSION_ID,
                boundaryDisclosure: BOUNDARY_DISCLOSURE,
                registryState: registry.state,
                ...(registry.state === 'torn' ? { tornReason: registry.reason } : {}),
                lanes: rows,
                counts: {
                        lanes: rows.length,
                        supervisedGreen: rows.filter(row => row.verdict === 'supervised-green').length,
                        stale: rows.filter(row => row.verdict === 'stale').length,
                        flat: rows.filter(row => row.verdict === 'flat').length,
                        unknown: rows.filter(row => row.verdict === 'unknown').length,
                        degraded: rows.filter(row => row.verdict === 'degraded').length,
                        escalationOutstanding: rows.filter(row => row.escalation.outstanding).length,
                },
        };

        const persisted = await persistStatus(deps, record);
        return { ok: true, record, persisted };
}

/** Persists the status record the W3 way: swept, written, banked census-visible. */
export async function persistStatus(deps: { root: string; fs: DurabilityFsPort; clock: Clock }, record: DurabilityStatusRecord): Promise<PersistedStatus> {
        const recordLine = serializeArtifact(record);
        const stamp = durabilityStamp(record.createdAt);
        const recordRelPath = joinPath(DURABILITY_DIR, `${STATUS_PREFIX}${stamp}.json`);
        const recordPath = joinPath(deps.root, recordRelPath);
        await deps.fs.mkdir(joinPath(deps.root, DURABILITY_DIR));
        await deps.fs.writeFile(recordPath, recordLine);
        const banking = await bankRecord(deps, record, recordLine, recordRelPath);
        return { recordPath, record, banking };
}

/** Renders the supervision verdict (the disclosure-first law). */
export function renderStatus(result: StatusResult): string[] {
        const lines: string[] = [];
        const { record } = result;
        if (record.registryState !== 'resolved') {
                lines.push(`  lane registry: ${record.registryState}${record.tornReason !== undefined ? ` (${record.tornReason})` : ''} -- the honest typed degradation, never a guessed summary`);
        }
        for (const row of record.lanes) {
                lines.push(`  lane ${row.laneId} (owner ${row.owner}): ${row.verdict}`);
                lines.push(`    liveness ${row.liveness} · ring ${row.beats} (total ${row.totalBeats}) · escalation ${row.escalation.policy}${row.escalation.outstanding ? ' OUTSTANDING' : ''}${row.escalation.demandCount > 0 ? ` (${row.escalation.demandCount} demand(s) recorded)` : ''}`);
                if (row.intervalStats !== undefined) {
                        lines.push(`    beat-history shape: intervals min ${row.intervalStats.minMs}ms / median ${row.intervalStats.medianMs}ms / max ${row.intervalStats.maxMs}ms over ${row.intervalStats.sampleCount} sample(s) · jitter: max deviation ${row.intervalStats.maxDeviationMs}ms from the configured interval`);
                } else {
                        lines.push('    beat-history shape: fewer than two beats -- no interval statistics (honest absence, never a faked zero)');
                }
                const law = row.checkpointLaw;
                const anchorText = law.exportAnchor.present
                        ? `present (${law.exportAnchor.exportDirName})`
                        : law.exportAnchor.tornReason !== undefined
                                ? `TORN (${law.exportAnchor.tornReason} -- a banked export exists but does not resolve; typed, never silent)`
                                : 'absent (no banked export -- honest, never a violation)';
                lines.push(`    checkpoint law: ${law.consultation}${law.consultedRecord !== undefined ? ` (consulted ${law.consultedRecord})` : ''} · ${law.stateSurfaces.length} workspace-bound surface(s)${law.stateSurfacesResolve ? ', all present' : law.stateSurfaces.length === 0 ? ' -- the owner owns none (typed absent: nothing durable behind the lane)' : ' -- ABSENT SURFACE(S) do not resolve'} · export anchor ${anchorText}`);
                if (row.tornReason !== undefined) {
                        lines.push(`    torn row: ${row.tornReason}`);
                }
        }
        lines.push(`  verdict table: ${record.counts.lanes} lane(s) -- ${record.counts.supervisedGreen} supervised-green · ${record.counts.stale} stale · ${record.counts.flat} flat · ${record.counts.unknown} unknown · ${record.counts.degraded} degraded · ${record.counts.escalationOutstanding} escalation(s) outstanding`);
        return lines;
}

/** Re-exported for the suite's newest-record resolution assertions. */
export { durabilityStamp };
