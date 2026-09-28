/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Flauz Memory extension activation (TL2-003, Worker C).
 *
 * Activation discipline (activation-lint R1-R3): command activation ONLY
 * (`onCommand:flauz.memory.*`) - never `*`, never onStartupFinished (that
 * budget is bridge + workspace only).
 *
 * Wires the node FileSystemPort into the MemoryStore (the durable tiered
 * memory substrate under `.flauz/memory/`).
 */

import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import { setVscodeApi } from './globals.ts';
import type { FileSystemPort } from '../../flauz-workspace/src/api.ts';
import { MemoryStore } from './memory.ts';
import { registerMemoryCommands, type MemoryCommandServices } from './commands.ts';

const nodeFs: FileSystemPort = {
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
	writeFile: (path, contents) => fs.writeFile(path, contents, { encoding: 'utf-8' }),
	appendFile: (path, contents) => fs.appendFile(path, contents, { encoding: 'utf-8' }),
	rename: (fromPath, toPath) => fs.rename(fromPath, toPath),
	mkdir: path => fs.mkdir(path, { recursive: true }),
};

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	setVscodeApi(vscode);

	const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (workspaceRoot === undefined) {
		vscode.window.showWarningMessage('flauz-memory: no workspace folder open - memory state stays inactive.');
		return;
	}

	const clock = (): number => Date.now();
	const store = new MemoryStore({ root: workspaceRoot, fs: nodeFs, clock });
	const services: MemoryCommandServices = { store };

	for (const disposable of registerMemoryCommands(services)) {
		context.subscriptions.push(disposable);
	}

	void (async () => {
		try {
			await store.ensure();
		} catch (err) {
			vscode.window.showErrorMessage(`flauz-memory: failed to bootstrap .flauz/memory state: ${err instanceof Error ? err.message : String(err)}`);
		}
	})();
}

export function deactivate(): void {
	// Nothing to do - all disposables ride context.subscriptions.
}
