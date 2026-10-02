/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The `flauz.diag.*` command surface (A-PROD-004-W1).
 *
 * Commands carry DATA only -- every effect (fs, output channel, clock,
 * versions, environment) is a port wired by the extension layer or injected
 * by tests; command args never carry code.
 *
 * THE DISCLOSURE LAW: `flauz.diag.bundle` renders EXACTLY what the bundle
 * will contain (the artifact-class enumeration + the refusals) into the
 * output channel BEFORE creating anything; the same enumeration is pinned
 * inside the produced MANIFEST.json (the bundle self-documents).
 */

import type * as vscode from 'vscode';
import { vscodeApi } from './globals.ts';
import {
        type BundleClass,
        type Clock,
        type DiagFsPort,
        type EnvironmentInfo,
        type OutputChannelPort,
        type VersionsInfo,
        REFUSED_CLASSES,
        DiagnosticsError,
        FLAUZ_DIR,
} from './api.ts';
import { collectDiagnostics, type DiagnosticsSnapshot } from './census.ts';
import { ARTIFACT_CLASS_DISCLOSURE, REFUSAL_DISCLOSURE, createSupportBundle, resolveInclude, type SupportBundleResult } from './bundle.ts';
import { CONTENTS_FUTURE_DECISIONS } from './privacy.ts';
import { formatTimestamp } from './format.ts';

export const COMMAND_IDS = ['flauz.diag.bundle', 'flauz.diag.show'] as const;
export type DiagnosticsCommandId = (typeof COMMAND_IDS)[number];

/** The ports the commands consume (all injected; the flauz-memory services pattern). */
export interface DiagnosticsCommandServices {
        readonly fs: DiagFsPort;
        readonly clock: Clock;
        readonly channel: OutputChannelPort;
        /** The workspace root (undefined: the honest no-workspace degradation). */
        readonly getWorkspaceRoot: () => string | undefined;
        readonly versions: () => VersionsInfo;
        readonly environment: () => EnvironmentInfo;
}

/** The `flauz.diag.show` render (also the unit-test surface of the show command). */
export function renderDiagnostics(snapshot: DiagnosticsSnapshot): readonly string[] {
        const lines: string[] = [];
        lines.push(`Flauz Diagnostics (${formatTimestamp(snapshot.createdAt)} UTC) -- flauz.diagnostics/v0`);
        lines.push('');
        lines.push('Versions');
        lines.push(`  product            ${String(snapshot.versions.productName)} ${String(snapshot.versions.productVersion)}`);
        for (const extension of snapshot.versions.extensions) {
                lines.push(`  extension          ${String(extension.id)} @ ${String(extension.version)}`);
        }
        lines.push('');
        lines.push('Environment');
        lines.push(`  node               ${String(snapshot.environment.nodeVersion)}`);
        lines.push(`  platform           ${String(snapshot.environment.platform)}`);
        lines.push(`  arch               ${String(snapshot.environment.arch)}`);
        lines.push('');
        lines.push('Durable state (.flauz/ census -- counts and hashes only, never contents)');
        for (const row of Object.values(snapshot.durableState)) {
                const summary = Object.entries(row)
                        .filter(([key]) => key !== 'present' && key !== 'path')
                        .map(([key, value]) => `${key}=${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
                        .join(' ');
                lines.push(`  ${row.present ? 'present' : 'ABSENT  '} ${String(row.path)}${summary.length > 0 ? `  (${summary})` : ''}`);
        }
        return lines;
}

function renderDisclosure(include: readonly BundleClass[]): readonly string[] {
        const lines: string[] = [];
        lines.push(`flauz.diag.bundle: creating a support bundle under ${FLAUZ_DIR}/ -- it will contain:`);
        for (const disclosure of ARTIFACT_CLASS_DISCLOSURE) {
                const included = disclosure.artifactClass === 'manifest' || include.includes(disclosure.artifactClass);
                lines.push(`  ${included ? '[include]' : '[skip]    '} ${String(disclosure.artifactClass)} (${String(disclosure.file)}): ${String(disclosure.contains)}`);
        }
        for (const refusal of REFUSAL_DISCLOSURE) {
                lines.push(`  [REFUSED ] ${String(refusal.artifactClass)}: ${String(refusal.reason)}`);
        }
        return lines;
}

function parseIncludeArg(arg: unknown): readonly string[] | undefined {
        if (arg === undefined || arg === null) {
                return undefined;
        }
        if (typeof arg === 'object' && !Array.isArray(arg)) {
                const record = arg as Record<string, unknown>;
                const include = record.include;
                if (include === undefined) {
                        return undefined;
                }
                return parseIncludeArg(include);
        }
        if (typeof arg === 'string') {
                return [arg];
        }
        if (Array.isArray(arg) && arg.every(entry => typeof entry === 'string')) {
                return arg as readonly string[];
        }
        throw new DiagnosticsError('FLAUZ_DIAG_UNKNOWN_CLASS', `flauz.diag.bundle: the 'include' argument must be a class name or an array of class names (valid: manifest, diagnostics, provider-lanes, recent-events, integrity; refused: ${REFUSED_CLASSES.join(', ')})`);
}

export type DiagnosticsHandler = (arg: unknown) => Promise<unknown>;

export function registerDiagnosticsCommands(services: DiagnosticsCommandServices): vscode.Disposable[] {
        const api = vscodeApi();
        const handlers: Record<DiagnosticsCommandId, DiagnosticsHandler> = {
                'flauz.diag.bundle': async arg => {
                        const root = services.getWorkspaceRoot();
                        if (root === undefined) {
                                services.channel.appendLine('flauz.diag.bundle: no workspace folder open -- the durable .flauz/ state is inactive, nothing to bundle.');
                                return { ok: false, code: 'FLAUZ_DIAG_NO_WORKSPACE' };
                        }
                        // resolve + refuse BEFORE any effect (the privacy gate is pure)
                        const include = parseIncludeArg(arg);
                        const resolved = resolveInclude(include);

                        // THE DISCLOSURE LAW: render exactly what the bundle contains first
                        for (const line of renderDisclosure(resolved)) {
                                services.channel.appendLine(line);
                        }
                        if (include !== undefined && include.includes('contents')) {
                                // unreachable (resolveInclude threw above); kept as the belt-and-braces refusal
                                throw new DiagnosticsError('FLAUZ_DIAG_CONTENTS_REFUSED', `flauz.diagnostics/v0: the 'contents' class is refused in v0; future decision: ${CONTENTS_FUTURE_DECISIONS.join('; ')}`);
                        }

                        const result: SupportBundleResult = await createSupportBundle({
                                root,
                                fs: services.fs,
                                clock: services.clock,
                                versions: services.versions(),
                                environment: services.environment(),
                        }, resolved);
                        services.channel.appendLine(`flauz.diag.bundle: bundle created at ${String(result.bundleDir)} (${String(result.files.length)} file(s): ${result.files.map(file => `${String(file.file)} ${String(file.sha256.slice(0, 12))}...`).join(', ')})`);
                        return { ok: true, path: result.bundleDir, files: result.files, createdAt: result.createdAt };
                },
                'flauz.diag.show': async () => {
                        const root = services.getWorkspaceRoot();
                        if (root === undefined) {
                                services.channel.appendLine('flauz.diag.show: no workspace folder open -- the durable .flauz/ state is inactive, nothing to show.');
                                return { ok: false, code: 'FLAUZ_DIAG_NO_WORKSPACE' };
                        }
                        const snapshot = await collectDiagnostics({
                                root,
                                fs: services.fs,
                                clock: services.clock,
                                versions: services.versions(),
                                environment: services.environment(),
                        });
                        for (const line of renderDiagnostics(snapshot)) {
                                services.channel.appendLine(line);
                        }
                        return { ok: true, diagnostics: snapshot };
                },
        };
        const disposables: vscode.Disposable[] = [];
        for (const id of COMMAND_IDS) {
                disposables.push(api.commands.registerCommand(id, handlers[id]));
        }
        return disposables;
}
