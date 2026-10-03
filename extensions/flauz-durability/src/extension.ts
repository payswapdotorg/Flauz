/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Flauz Durability extension activation (A-PROD-005-W4, TL-A).
 *
 * Activation discipline (activation-lint R1-R3): command activation ONLY
 * (`onCommand:flauz.durability.register + heartbeat + status`) -- never
 * `*`, never onStartupFinished (that budget is bridge + workspace only).
 *
 * Wires the node DurabilityFsPort (readFileUtf8 + readdir over the
 * workspace tree + the write surface over the workspace .flauz/ tree) and
 * follows the flauz-isolation wiring precedent for the wall clock, the
 * output channel and the workspace-root probe.
 */

import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import { setVscodeApi } from './globals.ts';
import {
        type DurabilityFsPort,
} from './api.ts';
import { registerDurabilityCommands, type DurabilityCommandServices } from './commands.ts';

const nodeFs: DurabilityFsPort = {
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
                        // Unlistable = missing (ENOENT), a non-directory path (ENOTDIR) or an
                        // unreadable path (EACCES/EPERM): all surface as undefined so the
                        // readers treat the path as a leaf, never crash on a
                        // file-where-a-dir-was-probed or a permission-bound tree.
                        const code = (err as { code?: string }).code;
                        if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EACCES' || code === 'EPERM') {
                                return undefined;
                        }
                        throw err;
                }
        },
        mkdir: path => fs.mkdir(path, { recursive: true }),
        writeFile: (path, contents) => fs.writeFile(path, contents, { encoding: 'utf-8' }),
        appendFile: (path, contents) => fs.appendFile(path, contents, { encoding: 'utf-8' }),
};

export function activate(context: vscode.ExtensionContext): void {
        setVscodeApi(vscode);

        const channel = vscode.window.createOutputChannel('Flauz Durability');
        const services: DurabilityCommandServices = {
                fs: nodeFs,
                clock: (): number => Date.now(),
                channel,
                getWorkspaceRoot: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
        };

        for (const disposable of [channel, ...registerDurabilityCommands(services)]) {
                context.subscriptions.push(disposable);
        }
}

export function deactivate(): void {
        // Nothing to do -- all disposables ride context.subscriptions.
}
