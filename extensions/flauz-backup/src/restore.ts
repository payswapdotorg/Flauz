/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The crash-recovery path (A-PROD-004-W2): restore a workspace's durable
 * state from a verified export.
 *
 * THE ORDER OF OPERATIONS IS THE LAW:
 *
 *   1. VERIFY FIRST -- the export is verified end to end against its
 *      MANIFEST (per-file sha256, per-surface counts, the chain verifiers
 *      re-run on the copied state). ANY mismatch is the typed tamper
 *      refusal; restore NEVER proceeds from an unverified export.
 *   2. PLAN + CONSENT -- every present surface file is staged for restore;
 *      a target surface file that exists and is non-empty requires the
 *      EXPLICIT overwrite consent (the `overwrite` argument) or the whole
 *      restore refuses (typed) BEFORE a single byte is written. Surfaces the
 *      export records as ABSENT are left untouched (reported, never faked,
 *      never deleted).
 *   3. EXECUTE -- per-surface atomic stage+rename: every file is staged to a
 *      sibling temp path inside its target directory, then renamed over the
 *      target. A crash during staging leaves zero target effects; a crash
 *      during the rename phase leaves a prefix-committed restore that a
 *      re-run (with consent) completes.
 *   4. BANK -- a recovery record is banked into the restored state:
 *      (a) the durable record at `.flauz/backup/recovery-log.jsonl`
 *          (what/when/from-which-export), and (b) an evidence-ledger note
 *          row (the synthetic-taskId `flauz-backup` precedent of the owning
 *          ledger's own `flauz.ledger` checkpoint rows) whose uri points at
 *          the recovery log and whose sha256 pins the record's canonical
 *          bytes -- so the NEXT DIAGNOSTICS CENSUS genuinely reports the
 *          recovery (rowCount + 1, kindCounts.note + 1, a new chain head).
 *          When a size watermark exists it is rewritten consistently (the
 *          watermark is unsigned JSON: rowCount/bytes/head of the
 *          post-banking ledger), keeping every post-restore integrity
 *          verdict GREEN.
 */

import {
        type BackupFsPort,
        type Clock,
        type SurfaceId,
        BackupError,
        RECOVERY_LOG_PATH,
        RECOVERY_SCHEMA_ID,
        RECOVERY_TASK_ID,
        SIZE_PATH,
        LEDGER_PATH,
        canonicalJson,
        isPlainObject,
        joinPath,
        sha256Hex,
        utf8ByteLength,
} from './api.ts';
import { isSha256Hex, ledgerHeadHash, ledgerRowHash, parseLedgerLine, type LedgerRowShape } from './verify.ts';
import { verifyExport, type ExportVerification } from './inspect.ts';
import { surfaceOfSourcePath } from './surfaces.ts';
import { sweepArtifact } from './privacy.ts';

/** The restore command id (the provenance value pinned into the recovery record). */
export const RESTORE_COMMAND_LINE = 'flauz.backup.restore';

/** The stage-file suffix (sibling temp path inside the target directory). */
const STAGE_SUFFIX = '.flauz-restore.tmp';

/** One restored surface's outcome. */
export interface RestoredSurface {
        readonly surface: SurfaceId;
        readonly files: readonly { readonly sourcePath: string; readonly bytes: number }[];
}

/** The recovery-record banking outcome. */
export interface BankingOutcome {
        readonly recoveryRecordAppended: boolean;
        readonly ledgerRowSeq?: number;
        readonly watermarkUpdated: boolean;
        readonly skippedReason?: string;
}

/** The restore result (surfaced by the command + tests). */
export interface RestoreResult {
        readonly exportDir: string;
        readonly exportDirName: string;
        readonly exportCreatedAt: number | undefined;
        readonly restoredSurfaces: readonly RestoredSurface[];
        readonly restoredFileCount: number;
        readonly restoredBytes: number;
        readonly leftAbsent: readonly { readonly surface: SurfaceId; readonly absentFiles: readonly string[] }[];
        readonly nonEmptyTargets: readonly string[];
        readonly banked: BankingOutcome;
        readonly restoredAt: number;
}

/** Deps of the restore path. */
export interface RestoreDeps {
        readonly root: string;
        readonly fs: BackupFsPort;
        readonly clock: Clock;
}

/** The consent flag: `overwrite: true` is the explicit overwrite consent. */
export interface RestoreOptions {
        readonly overwrite?: boolean;
}

/** The banked recovery record shape (the durable record + the ledger row's pinned payload). */
export interface RecoveryRecord {
        readonly $schema: typeof RECOVERY_SCHEMA_ID;
        readonly schemaVersion: 0;
        readonly at: number;
        readonly exportDir: string;
        readonly exportCreatedAt: number | undefined;
        readonly exportManifestSha256: string | undefined;
        readonly surfaces: readonly string[];
        readonly fileCount: number;
        readonly restoredBytes: number;
        readonly commandLine: string;
}

/** The contract-duplicated watermark shape (flauz-workspace hardening.ts LedgerWatermark; DL-32). */
export interface LedgerWatermarkShape {
        readonly $schema: string;
        readonly rowCount: number;
        readonly bytes: number;
        readonly headSha256: string;
        readonly lastCheckpointSeq: number | null;
        readonly updatedAt: number;
}

const SIZE_SCHEMA = 'flauz.evidence.size/v1';

/** Lenient parse of a stored watermark (undefined when not the owning shape). */
function parseWatermarkLenient(value: unknown): LedgerWatermarkShape | undefined {
        if (!isPlainObject(value)) {
                return undefined;
        }
        if (value.$schema !== SIZE_SCHEMA || typeof value.rowCount !== 'number' || typeof value.bytes !== 'number' || typeof value.headSha256 !== 'string' || typeof value.updatedAt !== 'number') {
                return undefined;
        }
        const lastCheckpointSeq = value.lastCheckpointSeq;
        if (lastCheckpointSeq !== null && typeof lastCheckpointSeq !== 'number') {
                return undefined;
        }
        if (!isSha256Hex(value.headSha256)) {
                return undefined;
        }
        return {
                $schema: value.$schema,
                rowCount: value.rowCount,
                bytes: value.bytes,
                headSha256: value.headSha256,
                lastCheckpointSeq,
                updatedAt: value.updatedAt,
        };
}

/** The owning serialization discipline: sorted keys, 2-space indent, one trailing newline. */
export function serializeWatermark(watermark: LedgerWatermarkShape): string {
        const sorted: Record<string, unknown> = {
                $schema: SIZE_SCHEMA,
                bytes: watermark.bytes,
                headSha256: watermark.headSha256,
                lastCheckpointSeq: watermark.lastCheckpointSeq,
                rowCount: watermark.rowCount,
                updatedAt: watermark.updatedAt,
        };
        return `${JSON.stringify(sorted, null, 2)}\n`;
}

/**
 * The crash-recovery path. Verifies first (typed refusal on ANY mismatch),
 * plans (typed refusal when a non-empty target lacks the explicit overwrite
 * consent -- BEFORE any byte is written), executes per-surface atomic
 * stage+rename, then banks the recovery record.
 */
export async function restoreExport(deps: RestoreDeps, reference: string | undefined, options: RestoreOptions = {}): Promise<RestoreResult> {
        // --- 1. VERIFY FIRST (never proceeds from an unverified export) ---
        const verification: ExportVerification = await verifyExport({ root: deps.root, fs: deps.fs }, reference);
        if (!verification.ok) {
                const table = verification.surfaces
                        .map(surface => `${String(surface.surface)}=${surface.verdict}`)
                        .join(', ');
                const metadata = `metadata=${String(verification.metadata.verdict)}`;
                const extras = verification.extras.length > 0 ? `, ${String(verification.extras.length)} unexpected state file(s)` : '';
                throw new BackupError(
                        'FLAUZ_BACKUP_TAMPERED',
                        `flauz.backup/v1: restore REFUSED -- the export '${String(verification.exportDirName)}' does not verify against its manifest (${metadata}, ${table}${extras}); restore never proceeds from an unverified export`,
                );
        }

        const manifestText = await deps.fs.readFileUtf8(joinPath(verification.exportDir, 'MANIFEST.json'));
        const exportText = await deps.fs.readFileUtf8(joinPath(verification.exportDir, 'export.json'));
        if (manifestText === undefined || exportText === undefined) {
                // unreachable post-verification (a green verification implies both parse); fail-closed anyway
                throw new BackupError('FLAUZ_BACKUP_TAMPERED', 'flauz.backup/v1: restore REFUSED -- the export\'s metadata vanished mid-restore (concurrent modification?)');
        }
        const manifest: unknown = JSON.parse(manifestText);
        const exportMeta: unknown = JSON.parse(exportText);
        const recordedArtifacts = isPlainObject(exportMeta) && Array.isArray(exportMeta.artifacts)
                ? exportMeta.artifacts.filter((entry): entry is { file: string; sha256: string } => isPlainObject(entry) && typeof entry.file === 'string' && typeof entry.sha256 === 'string')
                : [];
        const manifestSha = recordedArtifacts.find(artifact => artifact.file === 'MANIFEST.json')?.sha256;

        // --- 2. PLAN (present surfaces restored; absent surfaces left untouched) ---
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

        // the consent gate: EVERY non-empty target is collected BEFORE any write
        const nonEmptyTargets: string[] = [];
        for (const receipt of toRestore) {
                const targetText = await deps.fs.readFileUtf8(joinPath(deps.root, receipt.sourcePath));
                if (targetText !== undefined && utf8ByteLength(targetText) > 0) {
                        nonEmptyTargets.push(receipt.sourcePath);
                }
        }
        if (nonEmptyTargets.length > 0 && options.overwrite !== true) {
                throw new BackupError(
                        'FLAUZ_BACKUP_TARGET_NOT_EMPTY',
                        `flauz.backup/v1: restore REFUSED -- ${String(nonEmptyTargets.length)} target surface file(s) already exist and are non-empty (${nonEmptyTargets.join(', ')}); pass { overwrite: true } as the explicit overwrite consent to replace them (nothing has been written)`,
                );
        }

        // --- 3. EXECUTE (per-surface atomic stage+rename) ---
        const restoredSurfaces = new Map<SurfaceId, { sourcePath: string; bytes: number }[]>();
        let restoredBytes = 0;
        // phase A: stage every file (a crash here leaves zero target effects)
        for (const receipt of toRestore) {
                const text = await deps.fs.readFileUtf8(joinPath(verification.exportDir, receipt.exportPath));
                if (text === undefined) {
                        // unreachable post-verification; fail-closed
                        throw new BackupError('FLAUZ_BACKUP_TAMPERED', `flauz.backup/v1: restore REFUSED -- ${String(receipt.exportPath)} vanished mid-restore (concurrent modification?)`);
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

        // --- 4. BANK the recovery record ---
        const restoredAt = deps.clock();
        const exportCreatedAt = isPlainObject(exportMeta) && typeof exportMeta.createdAt === 'number' ? exportMeta.createdAt : undefined;
        const record: RecoveryRecord = {
                $schema: RECOVERY_SCHEMA_ID,
                schemaVersion: 0,
                at: restoredAt,
                exportDir: verification.exportDirName,
                exportCreatedAt,
                exportManifestSha256: manifestSha,
                surfaces: [...restoredSurfaces.keys()].sort(),
                fileCount: toRestore.length,
                restoredBytes,
                commandLine: RESTORE_COMMAND_LINE,
        };
        sweepArtifact(record, 'recovery-record');
        const recordLine = canonicalJson(record);
        await deps.fs.mkdir(joinPath(deps.root, RECOVERY_LOG_PATH.split('/').slice(0, -1).join('/')));
        await deps.fs.appendFile(joinPath(deps.root, RECOVERY_LOG_PATH), `${recordLine}\n`);

        const banking = await bankLedgerRow(deps, record, recordLine);

        const result: RestoreResult = {
                exportDir: verification.exportDir,
                exportDirName: verification.exportDirName,
                exportCreatedAt: record.exportCreatedAt,
                restoredSurfaces: [...restoredSurfaces.entries()].map(([surface, files]) => ({ surface, files })).sort((a, b) => (a.surface < b.surface ? -1 : 1)),
                restoredFileCount: toRestore.length,
                restoredBytes,
                leftAbsent: [...leftAbsent.entries()].map(([surface, absentFiles]) => ({ surface, absentFiles: [...absentFiles].sort() })).sort((a, b) => (a.surface < b.surface ? -1 : 1)),
                nonEmptyTargets: [...nonEmptyTargets].sort(),
                banked: banking,
                restoredAt,
        };
        sweepArtifact(result, 'restore-result');
        return result;
}

/**
 * Banks the recovery record's ledger row (the census-report law): reads the
 * restored ledger, appends the note row as a valid chain continuation, and
 * re-syncs the size watermark when one exists. Degrades honestly (recorded
 * reason, no ledger mutation) when the restored ledger does not parse+chain.
 */
async function bankLedgerRow(deps: RestoreDeps, record: RecoveryRecord, recordLine: string): Promise<BankingOutcome> {
        const ledgerPath = joinPath(deps.root, LEDGER_PATH);
        const text = await deps.fs.readFileUtf8(ledgerPath);
        const rows: LedgerRowShape[] = [];
        if (text !== undefined && text !== '') {
                for (const [index, line] of text.split('\n').filter(line => line !== '').entries()) {
                        const outcome = parseLedgerLine(line, index + 1);
                        if (!outcome.ok) {
                                return { recoveryRecordAppended: true, watermarkUpdated: false, skippedReason: `the ledger row was not banked: the restored ledger does not parse (${outcome.error}) -- the recovery record lives in ${RECOVERY_LOG_PATH} only` };
                        }
                        rows.push(outcome.row);
                }
        }

        const row: LedgerRowShape = {
                seq: rows.length + 1,
                ts: record.at,
                taskId: RECOVERY_TASK_ID,
                kind: 'note',
                uri: RECOVERY_LOG_PATH,
                sha256: sha256Hex(recordLine),
                prev: rows.length === 0 ? null : ledgerRowHash(rows[rows.length - 1] as LedgerRowShape),
        };
        const rowLine = canonicalJson(row);

        if (text === undefined) {
                // the export carried no ledger: banking creates it (mkdir + first row)
                await deps.fs.mkdir(ledgerPath.split('/').slice(0, -1).join('/'));
                await deps.fs.writeFile(ledgerPath, `${rowLine}\n`);
        } else {
                await deps.fs.appendFile(ledgerPath, `${rowLine}\n`);
        }

        // the watermark re-sync (only when the owner wrote one): rowCount/bytes/head of the POST-banking ledger
        let watermarkUpdated = false;
        const watermarkText = await deps.fs.readFileUtf8(joinPath(deps.root, SIZE_PATH));
        if (watermarkText !== undefined) {
                let existing: LedgerWatermarkShape | undefined;
                try {
                        existing = parseWatermarkLenient(JSON.parse(watermarkText) as unknown);
                } catch {
                        existing = undefined; // a corrupt watermark is not resynced (reported below); it stays as the export restored it
                }
                const newText = await deps.fs.readFileUtf8(ledgerPath) ?? '';
                const updated: LedgerWatermarkShape = {
                        $schema: SIZE_SCHEMA,
                        rowCount: rows.length + 1,
                        bytes: utf8ByteLength(newText),
                        headSha256: ledgerHeadHash([...rows, row]),
                        lastCheckpointSeq: existing !== undefined ? existing.lastCheckpointSeq : null,
                        updatedAt: record.at,
                };
                await deps.fs.writeFile(joinPath(deps.root, SIZE_PATH), serializeWatermark(updated));
                watermarkUpdated = true;
        }

        return { recoveryRecordAppended: true, ledgerRowSeq: row.seq, watermarkUpdated };
}
