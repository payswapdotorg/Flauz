/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The `flauz.backup.*` command surface (A-PROD-004-W2).
 *
 * Commands carry DATA only -- every effect (fs, output channel, clock,
 * versions) is a port wired by the extension layer or injected by tests;
 * command args never carry code.
 *
 * THE DISCLOSURE LAW (the W1 precedent): `flauz.backup.export` renders
 * EXACTLY what the export will contain (the surface enumeration + the
 * privacy law) into the output channel BEFORE creating anything; the same
 * enumeration is pinned inside the produced MANIFEST.json. `flauz.backup
 * .restore` renders the restore plan; the typed refusals (tampered export,
 * non-empty target without consent) carry the full plan detail so the
 * operator sees the gate, not a wall.
 */

import type * as vscode from 'vscode';
import { vscodeApi } from './globals.ts';
import {
        type BackupFsPort,
        type Clock,
        type OutputChannelPort,
        type VersionsInfo,
        BackupError,
        EXPORTS_DIR,
} from './api.ts';
import { createExport, listExportDirs, newestExportDir, renderExportDisclosure, enumerateForDisclosure, type ExportResult } from './export.ts';
import { renderVerdictTable, sweptVerification, verifyExport, type ExportVerification } from './inspect.ts';
import { restoreExport, type RestoreResult } from './restore.ts';
import { formatTimestamp } from './format.ts';

export const COMMAND_IDS = ['flauz.backup.export', 'flauz.backup.verify', 'flauz.backup.restore'] as const;
export type BackupCommandId = (typeof COMMAND_IDS)[number];

/** The ports the commands consume (all injected; the flauz-memory services pattern). */
export interface BackupCommandServices {
        readonly fs: BackupFsPort;
        readonly clock: Clock;
        readonly channel: OutputChannelPort;
        /** The workspace root (undefined: the honest no-workspace degradation). */
        readonly getWorkspaceRoot: () => string | undefined;
        readonly versions: () => VersionsInfo;
}

function renderResult(result: ExportResult, channel: OutputChannelPort): void {
        channel.appendLine(`flauz.backup.export: export created at ${String(result.exportDir)} (${String(result.fileCount)} state file(s), ${String(result.totalBytes)} bytes, ${String(result.surfaces.filter(surface => surface.present).length)}/${String(result.surfaces.length)} surface(s) present).`);
}

function renderRestoreResult(result: RestoreResult, channel: OutputChannelPort): void {
        channel.appendLine(`flauz.backup.restore: restored ${String(result.restoredFileCount)} file(s) (${String(result.restoredBytes)} bytes) from ${String(result.exportDirName)} into the workspace at ${formatTimestamp(result.restoredAt)} UTC.`);
        for (const surface of result.restoredSurfaces) {
                channel.appendLine(`  restored  ${String(surface.surface)} (${String(surface.files.length)} file(s))`);
        }
        for (const absent of result.leftAbsent) {
                channel.appendLine(`  untouched ${String(absent.surface)} (absent in the export: ${absent.absentFiles.join(', ')})`);
        }
        channel.appendLine(`  banked    the recovery record (${String(result.banked.ledgerRowSeq !== undefined ? `ledger row seq ${String(result.banked.ledgerRowSeq)}` : 'ledger row skipped -- see the result' )}${result.banked.watermarkUpdated ? ', watermark resynced' : ''}) -- the next diagnostics census reports it.`);
}

/** Parses the export-dir argument ({ exportDir } | 'name' | undefined). */
function parseExportDirArg(arg: unknown): string | undefined {
        if (arg === undefined || arg === null) {
                return undefined;
        }
        if (typeof arg === 'string') {
                return arg;
        }
        if (typeof arg === 'object' && !Array.isArray(arg)) {
                const record = arg as Record<string, unknown>;
                if (record.exportDir === undefined || record.exportDir === null) {
                        return undefined;
                }
                if (typeof record.exportDir === 'string') {
                        return record.exportDir;
                }
        }
        throw new BackupError('FLAUZ_BACKUP_EXPORT_NOT_FOUND', `flauz.backup: the 'exportDir' argument must be an export directory name (or omit it for the newest export under ${EXPORTS_DIR}/)`);
}

/** Parses the restore consent argument ({ overwrite: boolean }). */
function parseOverwriteArg(arg: unknown): boolean {
        if (arg === undefined || arg === null) {
                return false;
        }
        if (typeof arg === 'object' && !Array.isArray(arg)) {
                const record = arg as Record<string, unknown>;
                if (record.overwrite === undefined) {
                        return false;
                }
                if (typeof record.overwrite === 'boolean') {
                        return record.overwrite;
                }
        }
        throw new BackupError('FLAUZ_BACKUP_TARGET_NOT_EMPTY', 'flauz.backup.restore: the \'overwrite\' argument must be a boolean (true is the explicit overwrite consent for non-empty target surfaces)');
}

export type BackupHandler = (arg: unknown) => Promise<unknown>;

export function registerBackupCommands(services: BackupCommandServices): vscode.Disposable[] {
        const api = vscodeApi();
        const handlers: Record<BackupCommandId, BackupHandler> = {
                'flauz.backup.export': async () => {
                        const root = services.getWorkspaceRoot();
                        if (root === undefined) {
                                services.channel.appendLine('flauz.backup.export: no workspace folder open -- the durable .flauz/ state is inactive, nothing to export.');
                                return { ok: false, code: 'FLAUZ_BACKUP_NO_WORKSPACE' };
                        }
                        // THE DISCLOSURE LAW: render exactly what the export will contain first
                        const disclosures = await enumerateForDisclosure(root, services.fs);
                        const preview = await newestExportDir(root, services.fs);
                        const nextName = `export-<${preview === undefined ? 'first' : 'next stamp'}>`;
                        for (const line of renderExportDisclosure(disclosures, nextName)) {
                                services.channel.appendLine(line);
                        }
                        const result: ExportResult = await createExport({
                                root,
                                fs: services.fs,
                                clock: services.clock,
                                versions: services.versions(),
                        });
                        renderResult(result, services.channel);
                        return { ok: true, path: result.exportDir, exportDirName: result.exportDirName, fileCount: result.fileCount, totalBytes: result.totalBytes, surfaces: result.surfaces, createdAt: result.createdAt };
                },
                'flauz.backup.verify': async arg => {
                        const root = services.getWorkspaceRoot();
                        if (root === undefined) {
                                services.channel.appendLine('flauz.backup.verify: no workspace folder open -- exports live under the workspace root, nothing to verify.');
                                return { ok: false, code: 'FLAUZ_BACKUP_NO_WORKSPACE' };
                        }
                        const reference = parseExportDirArg(arg);
                        const dirs = await listExportDirs(root, services.fs);
                        if (reference === undefined && dirs.length === 0) {
                                services.channel.appendLine(`flauz.backup.verify: no exports exist under ${EXPORTS_DIR}/ -- run flauz.backup.export first.`);
                                return { ok: false, code: 'FLAUZ_BACKUP_EXPORT_NOT_FOUND' };
                        }
                        const verification: ExportVerification = sweptVerification(await verifyExport({ root, fs: services.fs }, reference));
                        for (const line of renderVerdictTable(verification)) {
                                services.channel.appendLine(line);
                        }
                        return { ok: verification.ok, verification };
                },
                'flauz.backup.restore': async arg => {
                        const root = services.getWorkspaceRoot();
                        if (root === undefined) {
                                services.channel.appendLine('flauz.backup.restore: no workspace folder open -- there is no target workspace to restore into.');
                                return { ok: false, code: 'FLAUZ_BACKUP_NO_WORKSPACE' };
                        }
                        const reference = parseExportDirArg(arg);
                        const overwrite = parseOverwriteArg(arg);
                        services.channel.appendLine(`flauz.backup.restore: crash recovery from an export under ${EXPORTS_DIR}/${reference === undefined ? ' (the newest)' : ` (${String(reference)})`} -- verify first, then per-surface atomic stage+rename${overwrite ? ' with the explicit overwrite consent' : ''}.`);
                        try {
                                const result: RestoreResult = await restoreExport({ root, fs: services.fs, clock: services.clock }, reference, { overwrite });
                                renderRestoreResult(result, services.channel);
                                return { ok: true, result };
                        } catch (err) {
                                if (err instanceof BackupError) {
                                        // the typed refusals carry the plan detail: render them into the channel (the gate, not a wall)
                                        services.channel.appendLine(`flauz.backup.restore: REFUSED -- ${err.message}`);
                                        throw err;
                                }
                                throw err;
                        }
                },
        };
        const disposables: vscode.Disposable[] = [];
        for (const id of COMMAND_IDS) {
                disposables.push(api.commands.registerCommand(id, handlers[id]));
        }
        return disposables;
}
