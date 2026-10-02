/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The export verifier (A-PROD-004-W2): re-checks an export against its
 * MANIFEST and reports the per-surface verdict table.
 *
 * The verdict vocabulary (one per surface + the metadata class):
 *
 *   green    -- every copied file's sha256 + bytes re-derive exactly from the
 *               manifest receipt, the re-derived surface counts match the
 *               manifest's recorded counts, and the file set is exactly the
 *               manifest's (no extras, no absent-where-absent violations);
 *   tampered -- a file's bytes no longer match its receipt (edited content,
 *               or a SWAPPED surface file: the digest matches ANOTHER
 *               manifest entry), the recorded counts no longer match the
 *               copied bytes, a metadata artifact's own receipt (in
 *               export.json) no longer matches, or an unexpected file rides
 *               the export;
 *   torn     -- a file the manifest says was copied is MISSING from the
 *               export, or is SHORTER than its recorded byte size (an
 *               interrupted copy), or a metadata artifact is missing.
 *
 * The chain verifiers are RE-RUN on the COPIED state (root = the export's
 * state/ dir, the same relative layout) and compared with the export-time
 * verdicts pinned in integrity.json: identical bytes must produce identical
 * verdicts -- a divergence is tampering. The verdicts themselves are honest
 * DATA about the exported state (an export of a chain-broken workspace is
 * still a green EXPORT -- it faithfully copies what was there; the verdicts
 * say so).
 */

import {
        type BackupFsPort,
        type SurfaceId,
        EXPORTS_DIR,
        EXPORT_DIR_PREFIX,
        BackupError,
        EXPORT_FORMAT_VERSION,
        canonicalJson,
        deepSorted,
        isPlainObject,
        joinPath,
        sha256Hex,
        utf8ByteLength,
} from './api.ts';
import { collectIntegrity, type IntegrityVerdicts } from './verify.ts';
import { countSurface, enumerateSurfacesFromManifest, surfaceFileStructurallyComplete, surfaceOfSourcePath } from './surfaces.ts';
import { sweepArtifact } from './privacy.ts';

/** The per-surface verdict vocabulary. */
export type SurfaceVerdict = 'green' | 'tampered' | 'torn';

/** One file's check outcome. */
export interface FileCheck {
        readonly sourcePath: string;
        readonly exportPath: string;
        readonly receiptPresent: boolean;
        readonly actualPresent: boolean;
        readonly verdict: SurfaceVerdict;
        readonly reasons: readonly string[];
}

/** One surface's check outcome (the verdict table row). */
export interface SurfaceCheck {
        readonly surface: SurfaceId;
        readonly manifestPresent: boolean;
        readonly verdict: SurfaceVerdict;
        readonly files: readonly FileCheck[];
        readonly countsMatch: boolean;
        readonly reasons: readonly string[];
}

/** The metadata artifacts' receipt check (export.json's receipts vs the actual bytes). */
export interface MetadataCheck {
        readonly manifestReceiptOk: boolean | undefined;
        readonly integrityReceiptOk: boolean | undefined;
        readonly verdict: SurfaceVerdict;
        readonly reasons: readonly string[];
}

/** The whole verification result (the `flauz.backup.verify` surface). */
export interface ExportVerification {
        readonly exportDir: string;
        readonly exportDirName: string;
        readonly ok: boolean;
        readonly formatVersion: number | undefined;
        readonly metadata: MetadataCheck;
        readonly surfaces: readonly SurfaceCheck[];
        readonly chainVerdicts: IntegrityVerdicts;
        readonly exportTimeVerdicts: IntegrityVerdicts | undefined;
        readonly verdictsConsistent: boolean;
        readonly extras: readonly string[];
}

/** Deps of the verifier. */
export interface VerifyDeps {
        readonly root: string;
        readonly fs: BackupFsPort;
}

/**
 * Resolves an export directory reference (a name under `.flauz-exports/`, a
 * path relative to the root, or the newest export when undefined) to its
 * directory path + name. Throws FLAUZ_BACKUP_EXPORT_NOT_FOUND when nothing
 * matches.
 */
export async function resolveExportDir(deps: VerifyDeps, reference: string | undefined): Promise<{ exportDir: string; exportDirName: string }> {
        if (reference === undefined || reference === '') {
                const entries = await deps.fs.readdir(joinPath(deps.root, EXPORTS_DIR));
                const dirs = (entries ?? []).filter(name => name.startsWith(EXPORT_DIR_PREFIX)).sort();
                if (dirs.length === 0) {
                        throw new BackupError('FLAUZ_BACKUP_EXPORT_NOT_FOUND', `flauz.backup/v1: no exports exist under ${EXPORTS_DIR}/ -- run flauz.backup.export first`);
                }
                const name = dirs[dirs.length - 1] as string;
                return { exportDir: joinPath(deps.root, EXPORTS_DIR, name), exportDirName: name };
        }
        const clean = reference.replace(/\/+$/, '');
        const name = clean.includes('/') ? clean.split('/').pop() ?? clean : clean;
        const dir = clean.includes('/') ? (clean.startsWith('/') || clean === name ? clean : joinPath(deps.root, clean)) : joinPath(deps.root, EXPORTS_DIR, clean);
        const probe = await deps.fs.readdir(dir);
        if (probe === undefined) {
                throw new BackupError('FLAUZ_BACKUP_EXPORT_NOT_FOUND', `flauz.backup/v1: the export directory '${String(reference)}' does not exist (expected at ${String(dir)})`);
        }
        return { exportDir: dir, exportDirName: name };
}

/** Recursively lists every file under a dir, as export-relative paths. */
async function walkFiles(fs: BackupFsPort, dir: string, prefix: string): Promise<string[]> {
        const entries = await fs.readdir(dir);
        if (entries === undefined) {
                return [];
        }
        const out: string[] = [];
        for (const entry of [...entries].sort()) {
                const rel = prefix === '' ? entry : `${prefix}/${entry}`;
                const sub = await walkFiles(fs, joinPath(dir, entry), rel);
                if (sub.length > 0) {
                        out.push(...sub);
                } else {
                        out.push(rel);
                }
        }
        return out;
}

function worse(a: SurfaceVerdict, b: SurfaceVerdict): SurfaceVerdict {
        if (a === 'tampered' || b === 'tampered') {
                return 'tampered';
        }
        if (a === 'torn' || b === 'torn') {
                return 'torn';
        }
        return 'green';
}

/** Order-insensitive deep equality (both sides canonicalized before comparison). */
function canonicallyEqual(a: unknown, b: unknown): boolean {
        return canonicalJson(deepSorted(a)) === canonicalJson(deepSorted(b));
}

/**
 * Verifies an export end to end. Never writes; throws only the typed
 * not-found / format refusals (a tampered or torn export is a RESULT here,
 * not a throw -- the restore path turns non-green verdicts into its typed
 * refusal).
 */
export async function verifyExport(deps: VerifyDeps, reference: string | undefined): Promise<ExportVerification> {
        const { exportDir, exportDirName } = await resolveExportDir(deps, reference);

        // --- the metadata artifacts (export.json is the entry point) ---
        const exportText = await deps.fs.readFileUtf8(joinPath(exportDir, 'export.json'));
        const manifestText = await deps.fs.readFileUtf8(joinPath(exportDir, 'MANIFEST.json'));
        const integrityText = await deps.fs.readFileUtf8(joinPath(exportDir, 'integrity.json'));
        if (exportText === undefined && manifestText === undefined && await deps.fs.readdir(joinPath(exportDir, 'state')) === undefined) {
                throw new BackupError('FLAUZ_BACKUP_EXPORT_NOT_FOUND', `flauz.backup/v1: '${String(exportDirName)}' carries no export.json, no MANIFEST.json and no state/ -- it is not an export directory`);
        }

        const metadataReasons: string[] = [];
        let metadataVerdict: SurfaceVerdict = 'green';
        if (exportText === undefined) {
                metadataVerdict = worse(metadataVerdict, 'torn');
                metadataReasons.push('export.json is missing (the export never completed, or was truncated)');
        }

        // the format gate (typed refusal, not a verdict: an unknown format is not
        // tampering, it is a future/foreign artifact this version cannot judge)
        let formatVersion: number | undefined;
        let recordedArtifacts: { readonly file: string; readonly sha256: string; readonly bytes: number }[] | undefined;
        if (exportText !== undefined) {
                const parsed: unknown = JSON.parse(exportText);
                if (!isPlainObject(parsed)) {
                        throw new BackupError('FLAUZ_BACKUP_FORMAT', `flauz.backup/v1: export.json is not a JSON object (${String(exportDirName)})`);
                }
                formatVersion = typeof parsed.formatVersion === 'number' ? parsed.formatVersion : undefined;
                if (formatVersion !== EXPORT_FORMAT_VERSION) {
                        throw new BackupError('FLAUZ_BACKUP_FORMAT', `flauz.backup/v1: export format version ${String(formatVersion)} is not ${String(EXPORT_FORMAT_VERSION)} -- this extension verifies v1 exports only (a future reader owns the upgrade path)`);
                }
                if (Array.isArray(parsed.artifacts)) {
                        recordedArtifacts = parsed.artifacts.filter((entry): entry is { file: string; sha256: string; bytes: number } => isPlainObject(entry) && typeof entry.file === 'string' && typeof entry.sha256 === 'string' && typeof entry.bytes === 'number');
                }
        }

        // --- the metadata receipts (export.json pins MANIFEST.json + integrity.json) ---
        let manifestReceiptOk: boolean | undefined;
        let integrityReceiptOk: boolean | undefined;
        for (const artifact of recordedArtifacts ?? []) {
                const actual = artifact.file === 'MANIFEST.json' ? manifestText : artifact.file === 'integrity.json' ? integrityText : undefined;
                if (actual === undefined) {
                        metadataVerdict = worse(metadataVerdict, 'torn');
                        metadataReasons.push(`${artifact.file} is recorded in export.json but missing from the export`);
                        if (artifact.file === 'MANIFEST.json') {
                                manifestReceiptOk = false;
                        }
                        if (artifact.file === 'integrity.json') {
                                integrityReceiptOk = false;
                        }
                        continue;
                }
                const okNow = sha256Hex(actual) === artifact.sha256 && utf8ByteLength(actual) === artifact.bytes;
                if (artifact.file === 'MANIFEST.json') {
                        manifestReceiptOk = okNow;
                }
                if (artifact.file === 'integrity.json') {
                        integrityReceiptOk = okNow;
                }
                if (!okNow) {
                        metadataVerdict = worse(metadataVerdict, 'tampered');
                        metadataReasons.push(`${artifact.file} no longer matches its export.json receipt (sha256 ${String(artifact.sha256.slice(0, 12))}... + ${String(artifact.bytes)} bytes) -- the metadata was edited after creation`);
                }
        }

        if (manifestText === undefined) {
                // torn at the metadata level; no per-surface table is derivable
                return {
                        exportDir,
                        exportDirName,
                        ok: false,
                        formatVersion,
                        metadata: { manifestReceiptOk, integrityReceiptOk, verdict: worse(metadataVerdict, 'torn'), reasons: [...metadataReasons, 'MANIFEST.json is missing (the export never completed, or was truncated)'] },
                        surfaces: [],
                        chainVerdicts: { evidenceLedger: { ok: true, rows: 0, headSha256: sha256Hex('') }, opsChain: { ok: true, records: 0, problems: [] } },
                        exportTimeVerdicts: undefined,
                        verdictsConsistent: true,
                        extras: [],
                };
        }

        let manifest: unknown;
        try {
                manifest = JSON.parse(manifestText);
        } catch (err) {
                return {
                        exportDir,
                        exportDirName,
                        ok: false,
                        formatVersion,
                        metadata: { manifestReceiptOk: false, integrityReceiptOk, verdict: 'tampered', reasons: [...metadataReasons, `MANIFEST.json is not parseable JSON (${(err as Error).message})`] },
                        surfaces: [],
                        chainVerdicts: { evidenceLedger: { ok: true, rows: 0, headSha256: sha256Hex('') }, opsChain: { ok: true, records: 0, problems: [] } },
                        exportTimeVerdicts: undefined,
                        verdictsConsistent: true,
                        extras: [],
                };
        }
        if (!isPlainObject(manifest) || !Array.isArray(manifest.files)) {
                return {
                        exportDir,
                        exportDirName,
                        ok: false,
                        formatVersion,
                        metadata: { manifestReceiptOk: false, integrityReceiptOk, verdict: 'tampered', reasons: [...metadataReasons, 'MANIFEST.json does not carry a files[] inventory (not a flauz.backup-manifest/v1 body)'] },
                        surfaces: [],
                        chainVerdicts: { evidenceLedger: { ok: true, rows: 0, headSha256: sha256Hex('') }, opsChain: { ok: true, records: 0, problems: [] } },
                        exportTimeVerdicts: undefined,
                        verdictsConsistent: true,
                        extras: [],
                };
        }

        // --- the per-file checks (sha256 + bytes + presence vs the receipts) ---
        type Receipt = { sourcePath: string; exportPath: string; present: boolean; sha256?: string; bytes?: number };
        const receipts = (manifest.files as unknown[]).filter((entry): entry is Receipt => isPlainObject(entry) && typeof entry.sourcePath === 'string' && typeof entry.exportPath === 'string' && typeof entry.present === 'boolean');
        const allDigests = new Set(receipts.filter(receipt => receipt.present).map(receipt => receipt.sha256));

        const fileChecks: FileCheck[] = [];
        const copiedTexts = new Map<string, string>();
        for (const receipt of receipts) {
                const actual = await deps.fs.readFileUtf8(joinPath(exportDir, receipt.exportPath));
                const reasons: string[] = [];
                let verdict: SurfaceVerdict = 'green';
                if (!receipt.present) {
                        if (actual !== undefined) {
                                verdict = 'tampered';
                                reasons.push(`the manifest records ${String(receipt.sourcePath)} as ABSENT in the exported workspace, but the export carries a file for it`);
                        }
                } else if (actual === undefined) {
                        verdict = 'torn';
                        reasons.push(`${String(receipt.exportPath)} is missing from the export (the manifest says it was copied)`);
                } else {
                        const bytes = utf8ByteLength(actual);
                        const digest = sha256Hex(actual);
                        if (bytes < (receipt.bytes ?? 0) && (bytes === 0 || !surfaceFileStructurallyComplete(receipt.sourcePath, actual))) {
                                verdict = 'torn';
                                reasons.push(`${String(receipt.exportPath)} is ${String(bytes)} bytes, shorter than the recorded ${String(receipt.bytes ?? 0)} (an interrupted copy)`);
                        } else if (digest !== receipt.sha256) {
                                verdict = 'tampered';
                                if (allDigests.has(digest)) {
                                        reasons.push(`${String(receipt.exportPath)} no longer matches its receipt -- its digest matches ANOTHER manifest entry (a swapped surface file)`);
                                } else {
                                        reasons.push(`${String(receipt.exportPath)} no longer matches its receipt (sha256 ${String(receipt.sha256?.slice(0, 12) ?? '')}... expected, ${digest.slice(0, 12)}... actual)`);
                                }
                        }
                        if (verdict === 'green') {
                                copiedTexts.set(receipt.sourcePath, actual);
                        }
                }
                fileChecks.push({ sourcePath: receipt.sourcePath, exportPath: receipt.exportPath, receiptPresent: receipt.present, actualPresent: actual !== undefined, verdict, reasons });
        }

        // --- extra state files (anything under state/ not in the manifest) ---
        const manifestExportPaths = new Set(receipts.map(receipt => receipt.exportPath));
        const stateFiles = await walkFiles(deps.fs, joinPath(exportDir, 'state'), 'state');
        const extras = stateFiles.filter(file => !manifestExportPaths.has(file));

        // --- the per-surface table (verdict + counts re-derivation) ---
        const recordedSurfaces = new Map<string, Record<string, unknown>>();
        if (Array.isArray(manifest.surfaces)) {
                for (const entry of manifest.surfaces) {
                        if (isPlainObject(entry) && typeof entry.surface === 'string') {
                                recordedSurfaces.set(entry.surface, entry);
                        }
                }
        }
        const surfaces: SurfaceCheck[] = [];
        for (const enumeration of enumerateSurfacesFromManifest(receipts)) {
                const files = fileChecks.filter(check => surfaceOfSourcePath(check.sourcePath) === enumeration.def.id);
                const recorded = recordedSurfaces.get(enumeration.def.id);
                const reasons: string[] = [...files.flatMap(file => file.reasons)];
                let verdict: SurfaceVerdict = files.length === 0 ? 'green' : files.reduce<SurfaceVerdict>((acc, file) => worse(acc, file.verdict), 'green');
                if (extras.some(extra => surfaceOfSourcePath(stateSourceOf(extra)) === enumeration.def.id)) {
                        verdict = worse(verdict, 'tampered');
                        reasons.push('the export carries state files the manifest does not enumerate (unexpected content)');
                }
                // the counts re-derivation: the manifest's recorded counts must match
                // the copied bytes. It runs over the surface's GREEN files whenever
                // any remain -- a swap leaves every file green-per-receipt (sha256+size
                // match SOMETHING in the manifest) while the counts re-derive from the
                // wrong bytes and expose the manifest drift (the swapped-file class).
                // When NO file of the surface is green the count drift is already
                // explained by the torn/tampered file itself (the double-punish law:
                // one anomaly, one verdict, the file-level class wins).
                let countsMatch = true;
                const greenFiles = files.filter(file => file.verdict === 'green' && file.receiptPresent);
                const redFiles = files.filter(file => file.verdict !== 'green');
                if (greenFiles.length > 0 && redFiles.length === 0) {
                        const surfaceTexts = new Map<string, string>();
                        for (const check of greenFiles) {
                                surfaceTexts.set(check.sourcePath, copiedTexts.get(check.sourcePath) ?? '');
                        }
                        const rederived = countSurface(enumeration.def.id, surfaceTexts);
                        const recordedCounts = recorded !== undefined && isPlainObject(recorded.counts) ? recorded.counts as Record<string, unknown> : {};
                        if (!canonicallyEqual(recordedCounts, rederived) && (Object.keys(recordedCounts).length > 0 || Object.keys(rederived).length > 0)) {
                                countsMatch = false;
                                verdict = worse(verdict, 'tampered');
                                reasons.push('the manifest\'s recorded counts no longer match the copied bytes');
                        }
                }
                surfaces.push({
                        surface: enumeration.def.id,
                        manifestPresent: typeof recorded?.present === 'boolean' ? recorded.present : files.some(file => file.receiptPresent),
                        verdict,
                        files,
                        countsMatch,
                        reasons,
                });
        }

        // --- the chain verifiers, re-run on the COPIED state ---
        const chainVerdicts = await collectIntegrity(joinPath(exportDir, 'state'), deps.fs);
        let exportTimeVerdicts: IntegrityVerdicts | undefined;
        let verdictsConsistent = true;
        if (integrityText !== undefined) {
                try {
                        const parsed: unknown = JSON.parse(integrityText);
                        if (isPlainObject(parsed) && isPlainObject(parsed.evidenceLedger) && isPlainObject(parsed.opsChain)) {
                                exportTimeVerdicts = { evidenceLedger: parsed.evidenceLedger as unknown as IntegrityVerdicts['evidenceLedger'], opsChain: parsed.opsChain as unknown as IntegrityVerdicts['opsChain'] };
                        }
                } catch {
                        // an unparseable integrity.json is a torn metadata artifact (caught by the receipt check when its bytes drifted)
                }
        }
        if (exportTimeVerdicts !== undefined) {
                const ledgerIndex = surfaces.findIndex(surface => surface.surface === 'evidenceLedger');
                const opsIndex = surfaces.findIndex(surface => surface.surface === 'opsChain');
                if (!canonicallyEqual(exportTimeVerdicts.evidenceLedger, chainVerdicts.evidenceLedger)) {
                        verdictsConsistent = false;
                        if (ledgerIndex >= 0) {
                                const ledgerSurface = surfaces[ledgerIndex] as SurfaceCheck;
                                surfaces[ledgerIndex] = { ...ledgerSurface, verdict: worse(ledgerSurface.verdict, 'tampered'), reasons: [...ledgerSurface.reasons, 'the re-run ledger verdict diverges from the export-time verdict pinned in integrity.json (same bytes must produce the same verdict)'] };
                        }
                }
                if (!canonicallyEqual(exportTimeVerdicts.opsChain, chainVerdicts.opsChain)) {
                        verdictsConsistent = false;
                        if (opsIndex >= 0) {
                                const opsSurface = surfaces[opsIndex] as SurfaceCheck;
                                surfaces[opsIndex] = { ...opsSurface, verdict: worse(opsSurface.verdict, 'tampered'), reasons: [...opsSurface.reasons, 'the re-run ops-chain verdict diverges from the export-time verdict pinned in integrity.json'] };
                        }
                }
        }

        const ok = metadataVerdict === 'green' && extras.length === 0 && surfaces.every(surface => surface.verdict === 'green');
        return {
                exportDir,
                exportDirName,
                ok,
                formatVersion,
                metadata: { manifestReceiptOk, integrityReceiptOk, verdict: metadataVerdict, reasons: metadataReasons },
                surfaces,
                chainVerdicts,
                exportTimeVerdicts,
                verdictsConsistent,
                extras,
        };
}

function stateSourceOf(exportPath: string): string {
        return exportPath.slice('state/'.length);
}

/** Sweeps a verification result before it is rendered (the metadata law extends to reports). */
export function sweptVerification(verification: ExportVerification): ExportVerification {
        sweepArtifact(verification, 'verification');
        return verification;
}

/** Renders the verdict table (the `flauz.backup.verify` channel surface + the tests' pin). */
export function renderVerdictTable(verification: ExportVerification): readonly string[] {
        const lines: string[] = [];
        lines.push(`flauz.backup.verify: ${String(verification.exportDirName)} (format v${String(verification.formatVersion)}) -- ${verification.ok ? 'GREEN (the export matches its manifest)' : 'REFUSED (the export does not match its manifest)'}`);
        lines.push(`  metadata: ${String(verification.metadata.verdict)}${verification.metadata.reasons.length > 0 ? ` -- ${verification.metadata.reasons.join('; ')}` : ''}`);
        lines.push('  surface verdicts:');
        for (const surface of verification.surfaces) {
                const summary = surface.reasons.length > 0 ? ` -- ${surface.reasons.join('; ')}` : '';
                lines.push(`    ${surface.verdict.padEnd(7)} ${String(surface.surface)} (${String(surface.files.length)} file(s), counts ${surface.countsMatch ? 'match' : 'MISMATCH'})${summary}`);
        }
        const ledger = verification.chainVerdicts.evidenceLedger;
        const ops = verification.chainVerdicts.opsChain;
        lines.push(`  chain verdicts re-run on the copied state: ledger ${ledger.ok ? 'ok' : 'BROKEN'} (${String(ledger.rows)} rows, head ${ledger.headSha256.slice(0, 12)}...), ops ${ops.ok ? 'ok' : 'BROKEN'} (${String(ops.records)} records, ${String(ops.problems.length)} problem(s)) -- honest data about the exported state${verification.exportTimeVerdicts !== undefined ? (verification.verdictsConsistent ? ' (consistent with the export-time verdicts)' : ' (DIVERGES from the export-time verdicts -- tampering)') : ''}`);
        if (verification.extras.length > 0) {
                lines.push(`  unexpected state files (not in the manifest): ${verification.extras.join(', ')}`);
        }
        return lines;
}
