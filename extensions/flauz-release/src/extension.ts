/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Flauz Release extension activation (A-PROD-004-W5, TL-A).
 *
 * Activation discipline (activation-lint R1-R3): command activation ONLY
 * (`onCommand:flauz.release.*`) -- never `*`, never onStartupFinished (that
 * budget is bridge + workspace only).
 *
 * Wires the node ReleaseFsPort (the ONLY node dependency of the extension --
 * the flauz-migration/flauz-telemetry wiring-row precedent), the wall clock,
 * and the repo-state product probe: the workspace root when it carries the
 * packaging-parity registry (the dogfood posture -- the Flauz repo open in
 * Flauz), else the typed no-product-state refusal at the command layer (the
 * runtime-installed-product angle is A-PROD-005's production-readiness
 * lane, reported as residue, never improvised here).
 */

import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import { setVscodeApi } from './globals.ts';
import type { ReleaseFsPort, VersionsInfo } from './api.ts';
import { registerReleaseCommands, type ReleaseCommandServices } from './commands.ts';
import { isProductRoot } from './productState.ts';

const nodeFs: ReleaseFsPort = {
        readFileUtf8: async path => {
                try {
                        return await fs.readFile(path, { encoding: 'utf-8' });
                } catch (err) {
                        if ((err as { code?: string }).code === 'ENOENT') {
                                return undefined;
                        }
                        throw err;
                }
        },
        readdir: async path => {
                try {
                        return await fs.readdir(path);
                } catch (err) {
                        // Unlistable = missing (ENOENT) OR a non-directory path (ENOTDIR):
                        // both surface as undefined so the readers treat the path as a
                        // leaf, never crash on a file-where-a-dir-was-probed.
                        const code = (err as { code?: string }).code;
                        if (code === 'ENOENT' || code === 'ENOTDIR') {
                                return undefined;
                        }
                        throw err;
                }
        },
        mkdir: path => fs.mkdir(path, { recursive: true }),
        writeFile: (path, contents) => fs.writeFile(path, contents, { encoding: 'utf-8' }),
        appendFile: (path, contents) => fs.appendFile(path, contents, { encoding: 'utf-8' }),
};

/** The live versions block (the W3 liveVersions wiring: every installed flauz built-in). */
function liveVersions(): VersionsInfo {
        const extensions = vscode.extensions.all
                .filter(extension => extension.id.startsWith('flauz.'))
                .map(extension => ({ id: extension.id, version: extension.packageJSON.version }))
                .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        return { productVersion: vscode.version, productName: 'Flauz', extensions };
}

export function activate(context: vscode.ExtensionContext): void {
        setVscodeApi(vscode);

        const channel = vscode.window.createOutputChannel('Flauz Release');
        const services: ReleaseCommandServices = {
                fs: nodeFs,
                clock: (): number => Date.now(),
                channel,
                getWorkspaceRoot: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
                getProductRoot: async () => {
                        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                        if (root === undefined) {
                                return undefined;
                        }
                        return await isProductRoot(root, nodeFs) ? root : undefined;
                },
                versions: () => liveVersions(),
        };

        for (const disposable of [channel, ...registerReleaseCommands(services)]) {
                context.subscriptions.push(disposable);
        }
}

export function deactivate(): void {
        // Nothing to do -- all disposables ride context.subscriptions.
}
