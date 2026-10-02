/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The export builder (A-PROD-004-W2): writes
 * `<workspace>/.flauz-exports/export-<stamp>/` containing:
 *
 *   export.json    -- the metadata: product/extension versions, timestamp,
 *                     workspace identity, export format version (v1), the
 *                     command line that produced it, and the sha256+bytes of
 *                     the other metadata artifacts;
 *   MANIFEST.json  -- the per-surface inventory: every file copied, its
 *                     sha256 + byte size + the surface's row/record counts +
 *                     the format version per surface (absent surfaces are
 *                     listed as absent, never faked);
 *   integrity.json -- the tamper-evidence verdicts re-run AT EXPORT TIME
 *                     (the ledger chain verify + the ops-chain verify, the
 *                     same verdicts the diagnostics surface reports);
 *   state/         -- the surface files themselves, copied BYTE-IDENTICAL,
 *                     mirroring the workspace's `.flauz/` layout exactly
 *                     (`state/.flauz/tasks.json`, ...). The state copy IS the
 *                     backup; it legitimately carries durable-state CONTENTS.
 *
 * Every METADATA artifact is swept for secret-shaped values before any byte
 * is written (fail-closed; the state copy is exempt by law -- contents are a
 * backup's job). Exports are workspace-local in v0: no network, no
 * telemetry, they never leave the machine.
 */

import {
        type BackupFsPort,
        type Clock,
        type SurfaceId,
        type VersionsInfo,
        EXPORT_DIR_PREFIX,
        EXPORT_FORMAT_VERSION,
        EXPORT_SCHEMA_ID,
        EXPORTS_DIR,
        INTEGRITY_SCHEMA_ID,
        MANIFEST_SCHEMA_ID,
        joinPath,
        serializeArtifact,
        sha256Hex,
        utf8ByteLength,
} from './api.ts';
import { collectIntegrity, type IntegrityVerdicts } from './verify.ts';
import { countSurface, enumerateSurfaces, stateMirrorPath } from './surfaces.ts';
import { sweepArtifact } from './privacy.ts';
import { toIsoStamp } from './format.ts';

/** The export command id (the `commandLine` provenance value pinned into export.json). */
export const EXPORT_COMMAND_LINE = 'flauz.backup.export';

// ---------------------------------------------------------------------------
// The artifact shapes
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
export interface ExportManifest {
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

/** The integrity.json artifact body (the export-time verdicts). */
export interface ExportIntegrity {
        readonly $schema: typeof INTEGRITY_SCHEMA_ID;
        readonly schemaVersion: 0;
        readonly createdAt: number;
        readonly scope: string;
        readonly evidenceLedger: IntegrityVerdicts['evidenceLedger'];
        readonly opsChain: IntegrityVerdicts['opsChain'];
}

/** The export.json artifact body. */
export interface ExportMetadata {
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

/** The createExport result (surfaced by the command + tests). */
export interface ExportResult {
        readonly exportDir: string;
        readonly exportDirName: string;
        readonly createdAt: number;
        readonly fileCount: number;
        readonly totalBytes: number;
        readonly surfaces: readonly { readonly surface: SurfaceId; readonly present: boolean; readonly fileCount: number }[];
}

/** Deps of the export builder. */
export interface ExportDeps {
        readonly root: string;
        readonly fs: BackupFsPort;
        readonly clock: Clock;
        readonly versions: VersionsInfo;
}

/**
 * The filename-safe stamp of an export directory: the toIsoStamp serialization
 * (format.ts -- the PU6 single timestamp source) with the path-hostile ':'
 * stripped (path sanitization, not date formatting; the support-bundle
 * precedent). ISO stamps sort lexicographically -- the newest export is the
 * lexicographically last `export-*` dir.
 */
export function exportStamp(epochMs: number): string {
        return toIsoStamp(epochMs).replaceAll(':', '');
}

/** Lists the export directories a root carries, oldest first (the newest-export resolution). */
export async function listExportDirs(root: string, fs: BackupFsPort): Promise<string[]> {
        const entries = await fs.readdir(joinPath(root, EXPORTS_DIR));
        if (entries === undefined) {
                return [];
        }
        return entries.filter(name => name.startsWith(EXPORT_DIR_PREFIX)).sort();
}

/**
 * The light presence probe behind the pre-creation disclosure: every surface
 * with its files' presence resolved (a readFile probe per fixed file -- no
 * digests, no writes; the same presence facts createExport will act on).
 */
export async function enumerateForDisclosure(root: string, fs: BackupFsPort): Promise<readonly { def: { id: SurfaceId; formatVersion: string }; files: { readonly present: boolean }[]; present: boolean }[]> {
        const enumerations = await enumerateSurfaces(root, fs);
        const out: { def: { id: SurfaceId; formatVersion: string }; files: { readonly present: boolean }[]; present: boolean }[] = [];
        for (const enumeration of enumerations) {
                const files: { readonly present: boolean }[] = [];
                let present = false;
                for (const file of enumeration.files) {
                        const text = await fs.readFileUtf8(joinPath(root, file.sourcePath));
                        const isPresent = text !== undefined;
                        files.push({ present: isPresent });
                        present = present || isPresent;
                }
                if (enumeration.def.dirFile !== undefined) {
                        const dirEntries = await fs.readdir(joinPath(root, enumeration.def.dirFile.dir));
                        if (dirEntries !== undefined) {
                                present = true;
                        }
                }
                out.push({ def: { id: enumeration.def.id, formatVersion: enumeration.def.formatVersion }, files, present });
        }
        return out;
}

/** Resolves the newest export dir name (undefined when none exist). */
export async function newestExportDir(root: string, fs: BackupFsPort): Promise<string | undefined> {
        const dirs = await listExportDirs(root, fs);
        return dirs.length === 0 ? undefined : dirs[dirs.length - 1];
}

/**
 * The pre-creation disclosure (the enumeration law): EXACTLY what the export
 * will contain, rendered BEFORE anything is created. The command surface and
 * the tests share this render.
 */
export function renderExportDisclosure(surfaces: readonly { def: { id: SurfaceId; formatVersion: string }; files: readonly { readonly present: boolean }[]; present: boolean }[], exportDirName: string): readonly string[] {
        const lines: string[] = [];
        lines.push(`flauz.backup.export: creating a durable-state export at ${exportDirName}/ -- it will contain:`);
        lines.push(`  MANIFEST.json (the per-surface inventory: every copied file's sha256 + bytes + the surface counts + format versions)`);
        lines.push(`  integrity.json (the ledger + ops-chain tamper-evidence verdicts, re-run at export time)`);
        lines.push(`  export.json (the metadata: versions, timestamp, workspace identity, format version, the command line)`);
        lines.push(`  state/ (the durable-state files themselves, copied byte-identical) -- the surface inventory:`);
        for (const surface of surfaces) {
                const presentCount = surface.files.filter(file => file.present).length;
                const marker = surface.present ? '[present ]' : '[ABSENT  ]';
                lines.push(`  ${marker} ${String(surface.def.id)} (${String(surface.def.formatVersion)}): ${String(presentCount)}/${String(surface.files.length)} file(s)`);
        }
        lines.push(`  privacy law: the state copy legitimately carries durable-state CONTENTS (a backup's job); the metadata surfaces (export.json, MANIFEST.json, integrity.json) carry counts, hashes, paths and ids only and are swept for secret-shaped values before a single byte is written.`);
        lines.push(`  exports are workspace-local in v0: no network, no telemetry, never leave the machine.`);
        return lines;
}

/**
 * Creates the export. Reads every surface file, builds the per-surface
 * inventory + the export-time integrity verdicts, sweeps every metadata
 * artifact, and only then writes: state files byte-identical, integrity.json,
 * MANIFEST.json, export.json (which carries the other two's receipts).
 */
export async function createExport(deps: ExportDeps): Promise<ExportResult> {
        const createdAt = deps.clock();
        const dirName = `${EXPORT_DIR_PREFIX}${exportStamp(createdAt)}`;
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

        // --- the export-time integrity verdicts (over the workspace state) ---
        const verdicts = await collectIntegrity(deps.root, deps.fs);

        // --- assemble the metadata artifacts (every one swept) ---
        const manifest: ExportManifest = {
                $schema: MANIFEST_SCHEMA_ID,
                schemaVersion: 0,
                formatVersion: EXPORT_FORMAT_VERSION,
                createdAt,
                exportDirName: dirName,
                surfaces: inventories,
                files: [...flatReceipts].sort((a, b) => (a.sourcePath < b.sourcePath ? -1 : a.sourcePath > b.sourcePath ? 1 : 0)),
                fileCount: flatReceipts.filter(receipt => receipt.present).length,
                totalBytes,
                privacyLaw: 'SPLIT-SIDED: the state/ copy legitimately carries durable-state CONTENTS byte-identically (a backup\'s job); the metadata surfaces carry counts, hashes, paths and ids only, swept for secret-shaped values before write. Workspace-local in v0: no network, no telemetry, never leaves the machine.',
        };
        sweepArtifact(manifest, 'MANIFEST.json');

        const integrity: ExportIntegrity = {
                $schema: INTEGRITY_SCHEMA_ID,
                schemaVersion: 0,
                createdAt,
                scope: 'export-time re-run over the workspace state (the same verdicts the flauz-diagnostics surface reports)',
                evidenceLedger: verdicts.evidenceLedger,
                opsChain: verdicts.opsChain,
        };
        sweepArtifact(integrity, 'integrity.json');

        const manifestText = serializeArtifact(manifest);
        const integrityText = serializeArtifact(integrity);
        const extensionVersion = deps.versions.extensions.find(extension => extension.id === 'flauz.flauz-backup')?.version ?? 'unknown';
        const metadata: ExportMetadata = {
                $schema: EXPORT_SCHEMA_ID,
                schemaVersion: 0,
                formatVersion: EXPORT_FORMAT_VERSION,
                createdAt,
                productName: deps.versions.productName,
                productVersion: deps.versions.productVersion,
                extensionId: 'flauz.flauz-backup',
                extensionVersion,
                extensions: deps.versions.extensions,
                workspaceRoot: deps.root,
                commandLine: EXPORT_COMMAND_LINE,
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
                surfaces: inventories.map(inventory => ({ surface: inventory.surface, present: inventory.present, fileCount: inventory.files.filter(file => file.present).length })),
        };
}
