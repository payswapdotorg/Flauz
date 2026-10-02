/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Flauz Migration extension activation (A-PROD-004-W3, TL-A).
 *
 * Activation discipline (activation-lint R1-R3): command activation ONLY
 * (`onCommand:flauz.migration.*`) -- never `*`, never onStartupFinished (that
 * budget is bridge + workspace only).
 *
 * Wires the node MigrationFsPort (the ONLY node dependency of the extension --
 * the flauz-memory wiring-row precedent), the product/extension versions and
 * the wall clock.
 */

import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import { setVscodeApi } from './globals.ts';
import type { MigrationFsPort } from './api.ts';
import { registerMigrationCommands, type MigrationCommandServices } from './commands.ts';

const nodeFs: MigrationFsPort = {
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
                        // both surface as undefined so the census/walk logic treats the
                        // path as a leaf, never crashes on a file-where-a-dir-was-probed.
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
        rename: (fromPath, toPath) => fs.rename(fromPath, toPath),
        remove: path => fs.rm(path, { force: true }),
};

/** The live product/extension versions (the flauz built-ins only; the host supplies the rest). */
function liveVersions(): { productVersion: string; productName: string; extensions: { id: string; version: string }[] } {
        const extensions = vscode.extensions.all
                .filter(extension => extension.id.startsWith('flauz.'))
                .map(extension => ({ id: extension.id, version: extension.packageJSON?.version ?? 'unknown' }))
                .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        return {
                productVersion: vscode.version,
                productName: 'Flauz',
                extensions,
        };
}

export function activate(context: vscode.ExtensionContext): void {
        setVscodeApi(vscode);

        const channel = vscode.window.createOutputChannel('Flauz Migration');
        const services: MigrationCommandServices = {
                fs: nodeFs,
                clock: (): number => Date.now(),
                channel,
                getWorkspaceRoot: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
                versions: liveVersions,
        };

        for (const disposable of [channel, ...registerMigrationCommands(services)]) {
                context.subscriptions.push(disposable);
        }
}

export function deactivate(): void {
        // Nothing to do -- all disposables ride context.subscriptions.
}
