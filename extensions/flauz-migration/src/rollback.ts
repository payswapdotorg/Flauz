/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The safety path (A-PROD-004-W3, `flauz.migration.rollback`).
 *
 * THE ORDER OF OPERATIONS IS THE LAW:
 *
 *   1. RESOLVE THE ANCHOR -- the argument names an export directory, or the
 *      default resolves the anchor recorded by the MOST RECENT migration
 *      record (`.flauz/migration/migration-log.jsonl`); no migration record
 *      and no argument = the typed nothing-to-roll-back refusal (crash
 *      recovery from an arbitrary export is flauz.backup.restore's job).
 *   2. VERIFY FIRST -- the anchor is verified end to end against its
 *      MANIFEST (per-file sha256, per-surface counts, the chain verifiers
 *      re-run on the copied state). ANY mismatch is the typed tamper
 *      refusal; rollback NEVER proceeds from an unverified anchor.
 *   3. CONSENT -- every target surface file that exists and is non-empty
 *      requires the EXPLICIT overwrite consent (the `overwrite` argument,
 *      the W2 restore law) or the whole rollback refuses typed BEFORE a
 *      single byte is written. Surfaces the anchor records as ABSENT are
 *      left untouched (reported, never faked, never deleted).
 *   4. RESTORE -- per-surface atomic stage+rename, byte-identical from the
 *      anchor's state/ copy (the W2 restore discipline: a crash during
 *      staging leaves zero target effects; a crash during the rename phase
 *      leaves a prefix-committed rollback that a re-run with consent
 *      completes).
 *   5. CLEAN THE MIGRATION ARTIFACTS -- the in-progress marker and any
 *      stage leftovers are removed, and the persisted plan is DELETED (the
 *      fresh-plan law: a resume-after-rollback is a fresh
 *      flauz.migration.plan, never a blind continue).
 *   6. BANK -- the rollback record is banked (what/when/which-migration/
 *      which-anchor) at `.flauz/migration/rollback-log.jsonl` + the
 *      census-visible ledger note row + the watermark re-sync -- the
 *      migration + rollback pair is visible to the next diagnostics census.
 *
 * Note on banking vs byte-identity (the W2 law): the restore itself is
 * byte-identical per surface (the anchor restores the exact bytes); the
 * banking step then appends the disclosed rollback row to the ledger. A
 * torn migration rolled back is additionally cleanable: the torn state is
 * REPORTED (not refused) -- rollback IS the recovery path.
 */

import {
        type MigrationFsPort,
        type Clock,
        type SurfaceId,
        MigrationError,
        MARKER_PATH,
        MIGRATION_LOG_PATH,
        PLAN_PATH,
        ROLLBACK_LOG_PATH,
        ROLLBACK_RECORD_SCHEMA_ID,
        STAGE_SUFFIX,
        canonicalJson,
        isPlainObject,
        joinPath,
        utf8ByteLength,
} from './api.ts';
import { verifyAnchorExport, type AnchorVerification } from './anchor.ts';
import { detectTornState, type TornState } from './torn.ts';
import { appendRecordLine, bankLedgerRowFor } from './banking.ts';
import { surfaceOfSourcePath } from './surfaces.ts';
import { sweepArtifact } from './privacy.ts';
import { formatTimestamp } from './format.ts';

/** The rollback command id (the provenance value pinned into the rollback record). */
export const ROLLBACK_COMMAND_LINE = 'flauz.migration.rollback';

/** One restored surface's outcome. */
export interface RestoredSurface {
        readonly surface: SurfaceId;
        readonly files: readonly { readonly sourcePath: string; readonly bytes: number }[];
}

/** The banking outcome of the rollback path (the pair: the re-banked migration row + the rollback row). */
export interface RollbackBankingOutcome {
        readonly rollbackRecordAppended: boolean;
        /** The migration record's re-banked ledger row (the pair's other half; undefined when the migration was torn). */
        readonly migrationRowSeq?: number;
        readonly rollbackRowSeq?: number;
        readonly watermarkUpdated: boolean;
        readonly skippedReason?: string;
}

/** The rollback result (surfaced by the command + tests). */
export interface RollbackResult {
        readonly anchor: { readonly exportDir: string; readonly exportDirName: string; readonly manifestSha256: string | undefined };
        /** The migration this rollback reversed (absent when a torn migration had no banked record). */
        readonly rolledBack: { readonly migrationAt: number; readonly planId: string } | undefined;
        readonly restoredSurfaces: readonly RestoredSurface[];
        readonly restoredFileCount: number;
        readonly restoredBytes: number;
        readonly leftAbsent: readonly { readonly surface: SurfaceId; readonly absentFiles: readonly string[] }[];
        readonly nonEmptyTargets: readonly string[];
        readonly tornCleanedUp: TornState;
        readonly planCleared: boolean;
        readonly banked: RollbackBankingOutcome;
        readonly rolledBackAt: number;
}

/** Deps of the rollback path. */
export interface RollbackDeps {
        readonly root: string;
        readonly fs: MigrationFsPort;
        readonly clock: Clock;
}

/** The consent + anchor-reference options (`overwrite: true` is the explicit overwrite consent; `anchor` overrides the most-recent-migration default). */
export interface RollbackOptions {
        readonly overwrite?: boolean;
        /** Explicit anchor reference (an export dir name or path; default: the most recent migration record's anchor). */
        readonly anchor?: string;
}

/** The banked rollback record shape (the durable record + the ledger row's pinned payload). */
export interface RollbackRecord {
        readonly $schema: typeof ROLLBACK_RECORD_SCHEMA_ID;
        readonly schemaVersion: 0;
        readonly at: number;
        readonly commandLine: string;
        readonly rolledBack: { readonly migrationAt: number; readonly planId: string } | undefined;
        readonly anchor: { readonly exportDirName: string; readonly manifestSha256: string | undefined };
        readonly restoredSurfaces: readonly string[];
        readonly restoredFileCount: number;
        readonly restoredBytes: number;
        readonly leftAbsentSurfaces: readonly string[];
        readonly tornCleaned: boolean;
        readonly planCleared: boolean;
}

/** The stage-file suffix strip helper (the leftovers this path cleans). */
function stripStageSuffix(path: string): string {
        return path.endsWith(STAGE_SUFFIX) ? path.slice(0, -STAGE_SUFFIX.length) : path;
}

/** Reads the most recent migration record's canonical line (the pair re-banking payload). */
async function latestMigrationRecordLine(deps: RollbackDeps): Promise<string | undefined> {
        const text = await deps.fs.readFileUtf8(joinPath(deps.root, MIGRATION_LOG_PATH));
        if (text === undefined) {
                return undefined;
        }
        const lines = text.split('\n').filter(line => line !== '');
        return lines[lines.length - 1];
}

/** Reads the most recent migration record (the default anchor source + the pair link). */
async function latestMigrationRecord(deps: RollbackDeps): Promise<{ at: number; planId: string; anchorDirName: string } | undefined> {
        const text = await deps.fs.readFileUtf8(joinPath(deps.root, MIGRATION_LOG_PATH));
        if (text === undefined) {
                return undefined;
        }
        const lines = text.split('\n').filter(line => line !== '');
        const last = lines[lines.length - 1];
        if (last === undefined) {
                return undefined;
        }
        try {
                const parsed: unknown = JSON.parse(last);
                if (isPlainObject(parsed) && typeof parsed.at === 'number' && typeof parsed.planId === 'string' && isPlainObject(parsed.anchor) && typeof parsed.anchor.exportDirName === 'string') {
                        return { at: parsed.at, planId: parsed.planId, anchorDirName: parsed.anchor.exportDirName };
                }
        } catch {
                // a malformed last line is honest data: fall through to undefined
        }
        return undefined;
}

/**
 * The safety path. Resolve + VERIFY FIRST (typed tamper refusal on ANY
 * mismatch -- rollback never proceeds from an unverified anchor), consent,
 * per-surface atomic stage+rename restore, migration-artifact cleanup (the
 * fresh-plan law), then the rollback-record banking.
 */
export async function rollbackMigration(deps: RollbackDeps, options: RollbackOptions = {}): Promise<RollbackResult> {
        // --- the torn state is REPORTED here (rollback IS the recovery path; it does not refuse on torn) ---
        const torn = await detectTornState(deps.root, deps.fs);

        // --- 1. resolve the anchor ---
        const latest = await latestMigrationRecord(deps);
        const reference = options.anchor ?? latest?.anchorDirName;
        if (reference === undefined) {
                throw new MigrationError(
                        'FLAUZ_MIGRATION_NO_MIGRATION',
                        `flauz.migration.rollback: REFUSED -- no migration record exists at ${MIGRATION_LOG_PATH} and no anchor argument was given (nothing to roll back; crash recovery from an arbitrary export is flauz.backup.restore's job)`,
                );
        }

        // --- 2. VERIFY FIRST (never proceeds from an unverified anchor) ---
        const verification: AnchorVerification = await verifyAnchorExport({ root: deps.root, fs: deps.fs }, reference);
        if (!verification.ok) {
                const table = verification.surfaces
                        .map(surface => `${String(surface.surface)}=${surface.verdict}`)
                        .join(', ');
                const metadata = `metadata=${String(verification.metadata.verdict)}`;
                const extras = verification.extras.length > 0 ? `, ${String(verification.extras.length)} unexpected state file(s)` : '';
                throw new MigrationError(
                        'FLAUZ_MIGRATION_TAMPERED',
                        `flauz.migration.rollback: REFUSED -- the anchor '${String(verification.exportDirName)}' does not verify against its manifest (${metadata}, ${table}${extras}); rollback NEVER proceeds from an unverified anchor`,
                );
        }
        const manifestText = await deps.fs.readFileUtf8(joinPath(verification.exportDir, 'MANIFEST.json'));
        const exportText = await deps.fs.readFileUtf8(joinPath(verification.exportDir, 'export.json'));
        if (manifestText === undefined || exportText === undefined) {
                // unreachable post-verification (a green verification implies both parse); fail-closed anyway
                throw new MigrationError('FLAUZ_MIGRATION_TAMPERED', 'flauz.migration.rollback: REFUSED -- the anchor\'s metadata vanished mid-rollback (concurrent modification?)');
        }
        const manifest: unknown = JSON.parse(manifestText);
        const exportMeta: unknown = JSON.parse(exportText);
        const recordedArtifacts = isPlainObject(exportMeta) && Array.isArray(exportMeta.artifacts)
                ? exportMeta.artifacts.filter((entry): entry is { file: string; sha256: string } => isPlainObject(entry) && typeof entry.file === 'string' && typeof entry.sha256 === 'string')
                : [];
        const manifestSha = recordedArtifacts.find(artifact => artifact.file === 'MANIFEST.json')?.sha256;

        // --- 3. consent (every non-empty target is collected BEFORE any write) ---
        type Receipt = { sourcePath: string; exportPath: string; present: boolean; bytes?: number };
        const receipts = (isPlainObject(manifest) && Array.isArray(manifest.files)
                ? manifest.files
                : []).filter((entry): entry is Receipt => isPlainObject(entry) && typeof entry.sourcePath === 'string' && typeof entry.exportPath === 'string' && typeof entry.present === 'boolean' && (entry.present === false || typeof entry.bytes === 'number'));
        const toRestore: Receipt[] = receipts.filter(receipt => receipt.present);
        const leftAbsent = new Map<SurfaceId, string[]>();
        for (const receipt of receipts.filter(receipt => !receipt.present)) {
                const surface = surfaceOfSourcePath(receipt.sourcePath);
                if (surface !== undefined) {
                        const list = leftAbsent.get(surface) ?? [];
                        list.push(receipt.sourcePath);
                        leftAbsent.set(surface, list);
                }
        }
        const nonEmptyTargets: string[] = [];
        for (const receipt of toRestore) {
                const targetText = await deps.fs.readFileUtf8(joinPath(deps.root, receipt.sourcePath));
                if (targetText !== undefined && utf8ByteLength(targetText) > 0) {
                        nonEmptyTargets.push(receipt.sourcePath);
                }
        }
        if (nonEmptyTargets.length > 0 && options.overwrite !== true) {
                throw new MigrationError(
                        'FLAUZ_MIGRATION_TARGET_NOT_EMPTY',
                        `flauz.migration.rollback: REFUSED -- ${String(nonEmptyTargets.length)} target surface file(s) already exist and are non-empty (${nonEmptyTargets.join(', ')}); pass { overwrite: true } as the explicit overwrite consent to replace them (nothing has been written)`,
                );
        }

        // --- 4. RESTORE (per-surface atomic stage+rename, byte-identical from the anchor) ---
        const restoredSurfaces = new Map<SurfaceId, { sourcePath: string; bytes: number }[]>();
        let restoredBytes = 0;
        // phase A: stage every file (a crash here leaves zero target effects)
        for (const receipt of toRestore) {
                const text = await deps.fs.readFileUtf8(joinPath(verification.exportDir, receipt.exportPath));
                if (text === undefined) {
                        // unreachable post-verification; fail-closed
                        throw new MigrationError('FLAUZ_MIGRATION_TAMPERED', `flauz.migration.rollback: REFUSED -- ${String(receipt.exportPath)} vanished mid-rollback (concurrent modification?)`);
                }
                const target = joinPath(deps.root, receipt.sourcePath);
                await deps.fs.mkdir(target.split('/').slice(0, -1).join('/'));
                await deps.fs.writeFile(`${target}${STAGE_SUFFIX}`, text);
        }
        // phase B: rename every staged file over its target (the commit)
        for (const receipt of toRestore) {
                const target = joinPath(deps.root, receipt.sourcePath);
                await deps.fs.rename(`${target}${STAGE_SUFFIX}`, target);
                const bytes = utf8ByteLength(await deps.fs.readFileUtf8(target) ?? '');
                restoredBytes += bytes;
                const surface = surfaceOfSourcePath(receipt.sourcePath);
                if (surface !== undefined) {
                        const list = restoredSurfaces.get(surface) ?? [];
                        list.push({ sourcePath: receipt.sourcePath, bytes });
                        restoredSurfaces.set(surface, list);
                }
        }

        // --- 5. clean the migration artifacts (the fresh-plan law) ---
        if (torn.markerPresent) {
                await deps.fs.remove(joinPath(deps.root, MARKER_PATH));
        }
        for (const leftover of torn.stageLeftovers) {
                await deps.fs.remove(joinPath(deps.root, stripStageSuffix(leftover.path) + STAGE_SUFFIX));
        }
        const planText = await deps.fs.readFileUtf8(joinPath(deps.root, PLAN_PATH));
        const planCleared = planText !== undefined;
        if (planCleared) {
                await deps.fs.remove(joinPath(deps.root, PLAN_PATH));
        }

        // --- 6. BANK the rollback record ---
        const rolledBackAt = deps.clock();
        const record: RollbackRecord = {
                $schema: ROLLBACK_RECORD_SCHEMA_ID,
                schemaVersion: 0,
                at: rolledBackAt,
                commandLine: ROLLBACK_COMMAND_LINE,
                rolledBack: latest !== undefined && latest.anchorDirName === verification.exportDirName ? { migrationAt: latest.at, planId: latest.planId } : undefined,
                anchor: { exportDirName: verification.exportDirName, manifestSha256: manifestSha },
                restoredSurfaces: [...restoredSurfaces.keys()].sort(),
                restoredFileCount: toRestore.length,
                restoredBytes,
                leftAbsentSurfaces: [...leftAbsent.keys()].sort(),
                tornCleaned: torn.torn,
                planCleared,
        };
        const recordLine = canonicalJson(record);
        sweepArtifact(record, 'rollback-record');
        await appendRecordLine(deps, recordLine, ROLLBACK_LOG_PATH);
        // THE PAIR LAW: the migration record this rollback reversed is RE-BANKED as a ledger
        // row (its original row was rolled back with the ledger itself) -- after a
        // migration + rollback cycle the census sees BOTH events (rowCount + 2,
        // kindCounts.note + 2), the pair the work order demands.
        let migrationRowSeq: number | undefined;
        let pairSkippedReason: string | undefined;
        if (latest !== undefined && latest.anchorDirName === verification.exportDirName) {
                const migrationLine = await latestMigrationRecordLine(deps);
                if (migrationLine !== undefined) {
                        const pairBanking = await bankLedgerRowFor(deps, migrationLine, MIGRATION_LOG_PATH);
                        migrationRowSeq = pairBanking.ledgerRowSeq;
                        pairSkippedReason = pairBanking.skippedReason;
                }
        }
        const rollbackBanking = await bankLedgerRowFor(deps, recordLine, ROLLBACK_LOG_PATH);
        const banking: RollbackBankingOutcome = {
                rollbackRecordAppended: true,
                ...(migrationRowSeq !== undefined ? { migrationRowSeq } : {}),
                ...(rollbackBanking.ledgerRowSeq !== undefined ? { rollbackRowSeq: rollbackBanking.ledgerRowSeq } : {}),
                watermarkUpdated: rollbackBanking.watermarkUpdated,
                ...(rollbackBanking.skippedReason !== undefined ? { skippedReason: rollbackBanking.skippedReason } : pairSkippedReason !== undefined ? { skippedReason: pairSkippedReason } : {}),
        };

        const result: RollbackResult = {
                anchor: { exportDir: verification.exportDir, exportDirName: verification.exportDirName, manifestSha256: manifestSha },
                rolledBack: record.rolledBack,
                restoredSurfaces: [...restoredSurfaces.entries()].map(([surface, files]) => ({ surface, files })).sort((a, b) => (a.surface < b.surface ? -1 : 1)),
                restoredFileCount: toRestore.length,
                restoredBytes,
                leftAbsent: [...leftAbsent.entries()].map(([surface, absentFiles]) => ({ surface, absentFiles: [...absentFiles].sort() })).sort((a, b) => (a.surface < b.surface ? -1 : 1)),
                nonEmptyTargets: [...nonEmptyTargets].sort(),
                tornCleanedUp: torn,
                planCleared,
                banked: banking,
                rolledBackAt,
        };
        sweepArtifact(result, 'rollback-result');
        return result;
}

/** Renders the rollback result (the channel surface + the tests' pin). */
export function renderRollbackResult(result: RollbackResult): readonly string[] {
        const lines: string[] = [];
        lines.push(`flauz.migration.rollback: rolled back to the anchor ${result.anchor.exportDirName} at ${formatTimestamp(result.rolledBackAt)} UTC (verified before any restore; ${String(result.restoredFileCount)} file(s), ${String(result.restoredBytes)} bytes).`);
        if (result.rolledBack !== undefined) {
                lines.push(`  reversed: the migration of ${formatTimestamp(result.rolledBack.migrationAt)} UTC (plan ${result.rolledBack.planId.slice(0, 12)}...) -- the pair is visible to the next diagnostics census.`);
        } else {
                lines.push('  reversed: a torn migration (no banked migration record -- the marker was cleaned, the rollback record stands alone).');
        }
        for (const surface of result.restoredSurfaces) {
                lines.push(`  restored  ${String(surface.surface)} (${String(surface.files.length)} file(s))`);
        }
        for (const absent of result.leftAbsent) {
                lines.push(`  untouched ${String(absent.surface)} (absent in the anchor: ${absent.absentFiles.join(', ')})`);
        }
        if (result.tornCleanedUp.torn) {
                lines.push(`  cleaned up the torn state: ${result.tornCleanedUp.reasons.join('; ')}`);
        }
        lines.push(`  plan cleared: ${result.planCleared ? 'yes (a resume-after-rollback is a FRESH plan, never a blind continue)' : 'no plan was persisted'}`);
        lines.push(`  banked: the rollback record (ledger row seq ${result.banked.rollbackRowSeq !== undefined ? String(result.banked.rollbackRowSeq) : 'skipped -- see the result'}${result.banked.migrationRowSeq !== undefined ? `, the reversed migration's record re-banked as ledger row seq ${String(result.banked.migrationRowSeq)} (the pair)` : ''}${result.banked.watermarkUpdated ? ', watermark resynced' : ''}).`);
        return lines;
}
