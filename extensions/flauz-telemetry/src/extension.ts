/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Flauz Telemetry extension activation (A-PROD-004-W4, TL-A).
 *
 * Activation discipline (activation-lint R1-R3): command activation ONLY
 * (`onCommand:flauz.telemetry.*` + `onCommand:flauz.failures.list`) -- never
 * `*`, never onStartupFinished (that budget is bridge + workspace only).
 *
 * Wires the node TelemetryFsPort (the ONLY node dependency of the extension
 * -- the flauz-memory/flauz-migration wiring-row precedent) and the wall
 * clock. No network surface exists anywhere in this extension: the telemetry
 * plane is local-first by construction (v0).
 */

import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import { setVscodeApi } from './globals.ts';
import type { TelemetryFsPort } from './api.ts';
import { registerTelemetryCommands, type TelemetryCommandServices } from './commands.ts';

const nodeFs: TelemetryFsPort = {
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
			// both surface as undefined so the observers treat the path as a
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
	remove: path => fs.rm(path, { force: true }),
};

export function activate(context: vscode.ExtensionContext): void {
	setVscodeApi(vscode);

	const channel = vscode.window.createOutputChannel('Flauz Telemetry');
	const services: TelemetryCommandServices = {
		fs: nodeFs,
		clock: (): number => Date.now(),
		channel,
		getWorkspaceRoot: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
	};

	for (const disposable of [channel, ...registerTelemetryCommands(services)]) {
		context.subscriptions.push(disposable);
	}
}

export function deactivate(): void {
	// Nothing to do -- all disposables ride context.subscriptions.
}
