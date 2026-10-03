/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Flauz Production extension activation (A-PROD-005-W1, TL-A).
 *
 * Activation discipline (activation-lint R1-R3): command activation ONLY
 * (`onCommand:flauz.production.*`) -- never `*`, never onStartupFinished
 * (that budget is bridge + workspace only).
 *
 * Wires the node ProductionFsPort (the ONLY node dependency of the
 * extension -- the flauz-migration/flauz-telemetry/flauz-release
 * wiring-row precedent), the wall clock, the repo-state product probe (the
 * W5 port: the workspace root when it carries the packaging-parity
 * registry, the dogfood posture -- the Flauz repo open in Flauz), and the
 * RUNTIME INSTALLED-PRODUCT PORT (this wave's seam): the live
 * vscode.extensions.all enumeration, the exact surface the W5 report
 * reserved for this lane. Where no flauz extension is loaded the port
 * reports the honest empty/absent state and the census degrades typed.
 */

import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import { setVscodeApi } from './globals.ts';
import type { ProductionFsPort, VersionsInfo } from './api.ts';
import { registerProductionCommands, type ProductionCommandServices } from './commands.ts';
import { isProductRoot } from './productState.ts';
import type { InstalledProductPort, RuntimeExtensionInfo } from './installedProduct.ts';

const nodeFs: ProductionFsPort = {
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

/**
 * The runtime installed-product port over vscode.extensions.all (THE SEAM
 * this wave drives -- the W5 report's reserved lane): enumerates every
 * flauz-published extension the runtime ACTUALLY loaded, with the version
 * the runtime resolved and the installed path (the dist-tree root the
 * census reads the manifest under).
 */
const runtimeInstalledProduct: InstalledProductPort = {
        listFlauzExtensions: async () => {
                const infos: RuntimeExtensionInfo[] = [];
                for (const extension of vscode.extensions.all) {
                        if (!extension.id.startsWith('flauz.')) {
                                continue;
                        }
                        infos.push({
                                id: extension.id,
                                version: typeof extension.packageJSON.version === 'string' ? extension.packageJSON.version : '0.0.0',
                                extensionPath: extension.extensionPath,
                        });
                }
                return infos.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        },
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

        const channel = vscode.window.createOutputChannel('Flauz Production');
        const services: ProductionCommandServices = {
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
                installedProduct: runtimeInstalledProduct,
                versions: () => liveVersions(),
        };

        for (const disposable of [channel, ...registerProductionCommands(services)]) {
                context.subscriptions.push(disposable);
        }
}

export function deactivate(): void {
        // Nothing to do -- all disposables ride context.subscriptions.
}
