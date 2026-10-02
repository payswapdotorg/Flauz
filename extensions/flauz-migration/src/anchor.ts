/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The anchor machinery (A-PROD-004-W3): the W2 export builder + export
 * verifier, contract-duplicated from extensions/flauz-backup (DL-32 -- never
 * imported across extensions) and pinned CROSS-RECOGNIZABLE in BOTH
 * directions by test/contract.test.ts against the REAL flauz-backup
 * machinery: an anchor this module creates verifies GREEN under the real
 * flauz.backup verify, and a real flauz.backup export verifies GREEN here.
 *
 * The anchor IS a W2 export:
 *
 *   `<workspace>/.flauz-exports/export-<stamp>/`
 *     export.json     metadata (versions, timestamp, workspace identity,
 *                     format version 1, commandLine 'flauz.migration.execute',
 *                     receipts of the other metadata artifacts)
 *     MANIFEST.json   the per-surface inventory (every copied file's sha256 +
 *                     bytes, the surface counts, the format version per surface)
 *     integrity.json  the tamper-evidence verdicts re-run at anchor time
 *     state/.flauz/…  the surface files themselves, byte-identical
 *
 * The provenance difference (commandLine + extensionId) is the only shape
 * difference from a `flauz.backup.export` artifact -- the schema ids, the
 * directory layout and every receipt law are identical, which is what makes
 * the anchor consumable by BOTH flauz.migration.rollback and
 * flauz.backup.verify/restore.
 */

import {
        type MigrationFsPort,
        type Clock,
        type SurfaceId,
        type VersionsInfo,
        MigrationError,
        ANCHOR_COMMAND_LINE,
        EXPORT_DIR_PREFIX,
        EXPORT_FORMAT_VERSION,
        EXPORT_SCHEMA_ID,
        EXPORTS_DIR,
        INTEGRITY_SCHEMA_ID,
        MANIFEST_SCHEMA_ID,
        canonicalJson,
        deepSorted,
        isPlainObject,
        joinPath,
        serializeArtifact,
        sha256Hex,
        utf8ByteLength,
} from './api.ts';
import { collectIntegrity, type IntegrityVerdicts } from './verify.ts';
import { countSurface, enumerateSurfaces, enumerateSurfacesFromManifest, stateMirrorPath, surfaceFileStructurallyComplete, surfaceOfSourcePath } from './surfaces.ts';
import { sweepArtifact } from './privacy.ts';
import { toIsoStamp } from './format.ts';

// ---------------------------------------------------------------------------
// The artifact shapes (byte-shape-identical with the W2 export artifacts)
// ---------------------------------------------------------------------------

/** One copied state file's receipt (the MANIFEST law: sha256 + bytes + both paths). */
export interface StateFileReceipt {
        readonly sourcePath: string;
        readonly exportPath: string;
        readonly present: boolean;
        readonly sha256?: string;
        readonly bytes?: number;
}

/** One surface's inventory row. */
export interface SurfaceInventory {
        readonly surface: SurfaceId;
        readonly present: boolean;
        readonly formatVersion: string;
        readonly dirPresent?: boolean;
        readonly counts: Record<string, unknown>;
        readonly files: readonly StateFileReceipt[];
}

/** The MANIFEST.json artifact body. */
export interface AnchorManifest {
        readonly $schema: typeof MANIFEST_SCHEMA_ID;
        readonly schemaVersion: 0;
        readonly formatVersion: typeof EXPORT_FORMAT_VERSION;
        readonly createdAt: number;
        readonly exportDirName: string;
        readonly surfaces: readonly SurfaceInventory[];
        readonly files: readonly StateFileReceipt[];
        readonly fileCount: number;
        readonly totalBytes: number;
        readonly privacyLaw: string;
}

/** The integrity.json artifact body (the anchor-time verdicts). */
export interface AnchorIntegrity {
        readonly $schema: typeof INTEGRITY_SCHEMA_ID;
        readonly schemaVersion: 0;
        readonly createdAt: number;
        readonly scope: string;
        readonly evidenceLedger: IntegrityVerdicts['evidenceLedger'];
        readonly opsChain: IntegrityVerdicts['opsChain'];
}

/** The export.json artifact body. */
export interface AnchorMetadata {
        readonly $schema: typeof EXPORT_SCHEMA_ID;
        readonly schemaVersion: 0;
        readonly formatVersion: typeof EXPORT_FORMAT_VERSION;
        readonly createdAt: number;
        readonly productName: string;
        readonly productVersion: string;
        readonly extensionId: string;
        readonly extensionVersion: string;
        readonly extensions: readonly { readonly id: string; readonly version: string }[];
        readonly workspaceRoot: string;
        readonly commandLine: string;
        readonly surfaces: readonly { readonly surface: SurfaceId; readonly present: boolean }[];
        readonly artifacts: readonly { readonly file: string; readonly sha256: string; readonly bytes: number }[];
}

/** The createAnchor result (surfaced by execute + tests). */
export interface AnchorResult {
        readonly exportDir: string;
        readonly exportDirName: string;
        readonly createdAt: number;
        readonly fileCount: number;
        readonly totalBytes: number;
        readonly manifestSha256: string;
        readonly surfaces: readonly { readonly surface: SurfaceId; readonly present: boolean; readonly fileCount: number }[];
}

/** Deps of the anchor builder. */
export interface AnchorDeps {
        readonly root: string;
        readonly fs: MigrationFsPort;
        readonly clock: Clock;
        readonly versions: VersionsInfo;
}

// ---------------------------------------------------------------------------
// Anchor directory resolution
// ---------------------------------------------------------------------------

/**
 * The filename-safe stamp of an export directory: the toIsoStamp serialization
 * (format.ts -- the PU6 single timestamp source) with the path-hostile ':'
 * stripped. ISO stamps sort lexicographically -- the newest anchor is the
 * lexicographically last `export-*` dir.
 */
export function anchorStamp(epochMs: number): string {
        return toIsoStamp(epochMs).replaceAll(':', '');
}

/** Lists the export directories a root carries, oldest first. */
export async function listAnchorDirs(root: string, fs: MigrationFsPort): Promise<string[]> {
        const entries = await fs.readdir(joinPath(root, EXPORTS_DIR));
        if (entries === undefined) {
                return [];
        }
        return entries.filter(name => name.startsWith(EXPORT_DIR_PREFIX)).sort();
}

/** Resolves the newest export dir name (undefined when none exist). */
export async function newestAnchorDir(root: string, fs: MigrationFsPort): Promise<string | undefined> {
        const dirs = await listAnchorDirs(root, fs);
        return dirs.length === 0 ? undefined : dirs[dirs.length - 1];
}

/**
 * Resolves an export directory reference (a name under `.flauz-exports/`, a
 * path relative to the root, or the newest export when undefined) to its
 * directory path + name. Throws FLAUZ_MIGRATION_ANCHOR_NOT_FOUND when
 * nothing matches.
 */
export async function resolveAnchorDir(deps: { root: string; fs: MigrationFsPort }, reference: string | undefined): Promise<{ exportDir: string; exportDirName: string }> {
        if (reference === undefined || reference === '') {
                const entries = await deps.fs.readdir(joinPath(deps.root, EXPORTS_DIR));
                const dirs = (entries ?? []).filter(name => name.startsWith(EXPORT_DIR_PREFIX)).sort();
                if (dirs.length === 0) {
                        throw new MigrationError('FLAUZ_MIGRATION_ANCHOR_NOT_FOUND', `flauz.migration/v1: no exports exist under ${EXPORTS_DIR}/ -- an anchor is created by flauz.migration.execute (or flauz.backup.export)`);
                }
                const name = dirs[dirs.length - 1] as string;
                return { exportDir: joinPath(deps.root, EXPORTS_DIR, name), exportDirName: name };
        }
        const clean = reference.replace(/\/+$/, '');
        const name = clean.includes('/') ? clean.split('/').pop() ?? clean : clean;
        const dir = clean.includes('/') ? (clean.startsWith('/') || clean === name ? clean : joinPath(deps.root, clean)) : joinPath(deps.root, EXPORTS_DIR, clean);
        const probe = await deps.fs.readdir(dir);
        if (probe === undefined) {
                throw new MigrationError('FLAUZ_MIGRATION_ANCHOR_NOT_FOUND', `flauz.migration/v1: the anchor export directory '${String(reference)}' does not exist (expected at ${String(dir)})`);
        }
        return { exportDir: dir, exportDirName: name };
}

// ---------------------------------------------------------------------------
// The anchor builder (the W2 createExport law, commandLine adapted)
// ---------------------------------------------------------------------------

/**
 * Creates the anchor export. Reads every surface file, builds the
 * per-surface inventory + the anchor-time integrity verdicts, sweeps every
 * metadata artifact, and only then writes: state files byte-identical,
 * integrity.json, MANIFEST.json, export.json (which carries the other two's
 * receipts). The result carries the MANIFEST's own sha256 (the migration
 * record's anchor pin).
 */
export async function createAnchorExport(deps: AnchorDeps): Promise<AnchorResult> {
        const createdAt = deps.clock();
        const dirName = `${EXPORT_DIR_PREFIX}${anchorStamp(createdAt)}`;
        const exportDir = joinPath(deps.root, EXPORTS_DIR, dirName);

        // --- enumerate + read every surface file ---
        const enumerations = await enumerateSurfaces(deps.root, deps.fs);
        const texts = new Map<string, string>();
        const inventories: SurfaceInventory[] = [];
        const flatReceipts: StateFileReceipt[] = [];
        let totalBytes = 0;

        for (const enumeration of enumerations) {
                const surfaceTexts = new Map<string, string>();
                const files: StateFileReceipt[] = [];
                for (const file of enumeration.files) {
                        const text = await deps.fs.readFileUtf8(joinPath(deps.root, file.sourcePath));
                        if (text !== undefined) {
                                texts.set(file.sourcePath, text);
                                surfaceTexts.set(file.sourcePath, text);
                                const bytes = utf8ByteLength(text);
                                totalBytes += bytes;
                                const receipt: StateFileReceipt = { sourcePath: file.sourcePath, exportPath: file.exportPath, present: true, sha256: sha256Hex(text), bytes };
                                files.push(receipt);
                                flatReceipts.push(receipt);
                        } else {
                                const receipt: StateFileReceipt = { sourcePath: file.sourcePath, exportPath: file.exportPath, present: false };
                                files.push(receipt);
                                flatReceipts.push(receipt);
                        }
                }
                // the census presence semantics: a surface is present when any of its
                // files is, or (workflows) when its enumerated dir exists even if empty
                let present = files.some(file => file.present);
                let dirPresent: boolean | undefined;
                if (enumeration.def.dirFile !== undefined) {
                        const dirEntries = await deps.fs.readdir(joinPath(deps.root, enumeration.def.dirFile.dir));
                        if (dirEntries !== undefined) {
                                present = true;
                                dirPresent = true;
                        }
                }
                const inventory: SurfaceInventory = dirPresent === undefined
                        ? {
                                surface: enumeration.def.id,
                                present,
                                formatVersion: enumeration.def.formatVersion,
                                counts: countSurface(enumeration.def.id, surfaceTexts),
                                files,
                        }
                        : {
                                surface: enumeration.def.id,
                                present,
                                formatVersion: enumeration.def.formatVersion,
                                dirPresent,
                                counts: countSurface(enumeration.def.id, surfaceTexts),
                                files,
                        };
                inventories.push(inventory);
        }

        // --- the anchor-time integrity verdicts (over the workspace state) ---
        const verdicts = await collectIntegrity(deps.root, deps.fs);

        // --- assemble the metadata artifacts (every one swept) ---
        const manifest: AnchorManifest = {
                $schema: MANIFEST_SCHEMA_ID,
                schemaVersion: 0,
                formatVersion: EXPORT_FORMAT_VERSION,
                createdAt,
                exportDirName: dirName,
                surfaces: inventories,
                files: [...flatReceipts].sort((a, b) => (a.sourcePath < b.sourcePath ? -1 : a.sourcePath > b.sourcePath ? 1 : 0)),
                fileCount: flatReceipts.filter(receipt => receipt.present).length,
                totalBytes,
                privacyLaw: 'SPLIT-SIDED: the state/ copy legitimately carries durable-state CONTENTS byte-identically (an anchor\'s job); the metadata surfaces carry counts, hashes, paths and ids only, swept for secret-shaped values before write. Workspace-local in v0: no network, no telemetry, never leaves the machine.',
        };
        sweepArtifact(manifest, 'MANIFEST.json');

        const integrity: AnchorIntegrity = {
                $schema: INTEGRITY_SCHEMA_ID,
                schemaVersion: 0,
                createdAt,
                scope: 'anchor-time re-run over the workspace state (the same verdicts the flauz-diagnostics surface reports)',
                evidenceLedger: verdicts.evidenceLedger,
                opsChain: verdicts.opsChain,
        };
        sweepArtifact(integrity, 'integrity.json');

        const manifestText = serializeArtifact(manifest);
        const integrityText = serializeArtifact(integrity);
        const extensionVersion = deps.versions.extensions.find(extension => extension.id === 'flauz.flauz-migration')?.version ?? 'unknown';
        const metadata: AnchorMetadata = {
                $schema: EXPORT_SCHEMA_ID,
                schemaVersion: 0,
                formatVersion: EXPORT_FORMAT_VERSION,
                createdAt,
                productName: deps.versions.productName,
                productVersion: deps.versions.productVersion,
                extensionId: 'flauz.flauz-migration',
                extensionVersion,
                extensions: deps.versions.extensions,
                workspaceRoot: deps.root,
                commandLine: ANCHOR_COMMAND_LINE,
                surfaces: inventories.map(inventory => ({ surface: inventory.surface, present: inventory.present })),
                artifacts: [
                        { file: 'MANIFEST.json', sha256: sha256Hex(manifestText), bytes: utf8ByteLength(manifestText) },
                        { file: 'integrity.json', sha256: sha256Hex(integrityText), bytes: utf8ByteLength(integrityText) },
                ],
        };
        sweepArtifact(metadata, 'export.json');

        // --- write (only now that every metadata artifact swept clean) ---
        await deps.fs.mkdir(exportDir);
        for (const [sourcePath, text] of texts) {
                const target = joinPath(exportDir, stateMirrorPath(sourcePath));
                await deps.fs.mkdir(joinPath(exportDir, stateMirrorPath(sourcePath).split('/').slice(0, -1).join('/')));
                await deps.fs.writeFile(target, text);
        }
        // an empty-but-present enumerated dir (the workflows census edge) is state too
        for (const enumeration of enumerations) {
                if (enumeration.def.dirFile !== undefined) {
                        const inventory = inventories.find(entry => entry.surface === enumeration.def.id);
                        if (inventory !== undefined && inventory.dirPresent === true) {
                                await deps.fs.mkdir(joinPath(exportDir, stateMirrorPath(enumeration.def.dirFile.dir)));
                        }
                }
        }
        await deps.fs.writeFile(joinPath(exportDir, 'integrity.json'), integrityText);
        await deps.fs.writeFile(joinPath(exportDir, 'MANIFEST.json'), manifestText);
        await deps.fs.writeFile(joinPath(exportDir, 'export.json'), serializeArtifact(metadata));

        return {
                exportDir,
                exportDirName: dirName,
                createdAt,
                fileCount: manifest.fileCount,
                totalBytes,
                manifestSha256: sha256Hex(manifestText),
                surfaces: inventories.map(inventory => ({ surface: inventory.surface, present: inventory.present, fileCount: inventory.files.filter(file => file.present).length })),
        };
}

// ---------------------------------------------------------------------------
// The anchor verifier (the W2 verifyExport law)
// ---------------------------------------------------------------------------

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

/** The whole verification result (the anchor verification surface). */
export interface AnchorVerification {
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
export interface AnchorVerifyDeps {
        readonly root: string;
        readonly fs: MigrationFsPort;
}

/** Recursively lists every file under a dir, as export-relative paths. */
async function walkFiles(fs: MigrationFsPort, dir: string, prefix: string): Promise<string[]> {
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

function stateSourceOf(exportPath: string): string {
        return exportPath.slice('state/'.length);
}

/**
 * Verifies an anchor export end to end. Never writes; throws only the typed
 * not-found / format refusals (a tampered or torn anchor is a RESULT here,
 * not a throw -- the execute/rollback paths turn non-green verdicts into
 * their typed refusals).
 */
export async function verifyAnchorExport(deps: AnchorVerifyDeps, reference: string | undefined): Promise<AnchorVerification> {
        const { exportDir, exportDirName } = await resolveAnchorDir(deps, reference);

        // --- the metadata artifacts (export.json is the entry point) ---
        const exportText = await deps.fs.readFileUtf8(joinPath(exportDir, 'export.json'));
        const manifestText = await deps.fs.readFileUtf8(joinPath(exportDir, 'MANIFEST.json'));
        const integrityText = await deps.fs.readFileUtf8(joinPath(exportDir, 'integrity.json'));
        if (exportText === undefined && manifestText === undefined && await deps.fs.readdir(joinPath(exportDir, 'state')) === undefined) {
                throw new MigrationError('FLAUZ_MIGRATION_ANCHOR_NOT_FOUND', `flauz.migration/v1: '${String(exportDirName)}' carries no export.json, no MANIFEST.json and no state/ -- it is not an export directory`);
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
                let parsed: unknown;
                try {
                        parsed = JSON.parse(exportText);
                } catch (err) {
                        // fail-closed and TYPED (an unparseable entry point is a torn/tampered metadata artifact)
                        throw new MigrationError('FLAUZ_MIGRATION_FORMAT', `flauz.migration/v1: export.json is not parseable JSON (${(err as Error).message})`);
                }
                if (!isPlainObject(parsed)) {
                        throw new MigrationError('FLAUZ_MIGRATION_FORMAT', `flauz.migration/v1: export.json is not a JSON object (${String(exportDirName)})`);
                }
                formatVersion = typeof parsed.formatVersion === 'number' ? parsed.formatVersion : undefined;
                if (formatVersion !== EXPORT_FORMAT_VERSION) {
                        throw new MigrationError('FLAUZ_MIGRATION_FORMAT', `flauz.migration/v1: export format version ${String(formatVersion)} is not ${String(EXPORT_FORMAT_VERSION)} -- this extension verifies v1 anchors only (a future reader owns the upgrade path)`);
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
                                surfaces[ledgerIndex] = { ...ledgerSurface, verdict: worse(ledgerSurface.verdict, 'tampered'), reasons: [...ledgerSurface.reasons, 'the re-run ledger verdict diverges from the anchor-time verdict pinned in integrity.json (same bytes must produce the same verdict)'] };
                        }
                }
                if (!canonicallyEqual(exportTimeVerdicts.opsChain, chainVerdicts.opsChain)) {
                        verdictsConsistent = false;
                        if (opsIndex >= 0) {
                                const opsSurface = surfaces[opsIndex] as SurfaceCheck;
                                surfaces[opsIndex] = { ...opsSurface, verdict: worse(opsSurface.verdict, 'tampered'), reasons: [...opsSurface.reasons, 'the re-run ops-chain verdict diverges from the anchor-time verdict pinned in integrity.json'] };
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

/** Sweeps a verification result before it is rendered (the metadata law extends to reports). */
export function sweptVerification(verification: AnchorVerification): AnchorVerification {
        sweepArtifact(verification, 'verification');
        return verification;
}

/** Renders the anchor verdict table (the execute/rollback channel surface + the tests' pin). */
export function renderAnchorVerdictTable(verification: AnchorVerification): readonly string[] {
        const lines: string[] = [];
        lines.push(`flauz.migration: anchor ${String(verification.exportDirName)} (format v${String(verification.formatVersion)}) -- ${verification.ok ? 'GREEN (the anchor matches its manifest)' : 'REFUSED (the anchor does not match its manifest)'}`);
        lines.push(`  metadata: ${String(verification.metadata.verdict)}${verification.metadata.reasons.length > 0 ? ` -- ${verification.metadata.reasons.join('; ')}` : ''}`);
        lines.push('  surface verdicts:');
        for (const surface of verification.surfaces) {
                const summary = surface.reasons.length > 0 ? ` -- ${surface.reasons.join('; ')}` : '';
                lines.push(`    ${surface.verdict.padEnd(7)} ${String(surface.surface)} (${String(surface.files.length)} file(s), counts ${surface.countsMatch ? 'match' : 'MISMATCH'})${summary}`);
        }
        const ledger = verification.chainVerdicts.evidenceLedger;
        const ops = verification.chainVerdicts.opsChain;
        lines.push(`  chain verdicts re-run on the copied state: ledger ${ledger.ok ? 'ok' : 'BROKEN'} (${String(ledger.rows)} rows, head ${ledger.headSha256.slice(0, 12)}...), ops ${ops.ok ? 'ok' : 'BROKEN'} (${String(ops.records)} records, ${String(ops.problems.length)} problem(s)) -- honest data about the anchored state${verification.exportTimeVerdicts !== undefined ? (verification.verdictsConsistent ? ' (consistent with the anchor-time verdicts)' : ' (DIVERGES from the anchor-time verdicts -- tampering)') : ''}`);
        if (verification.extras.length > 0) {
                lines.push(`  unexpected state files (not in the manifest): ${verification.extras.join(', ')}`);
        }
        return lines;
}
