/*---------------------------------------------------------------------------------------------
 *  flauz-workspace — src/extension.ts
 *
 *  Composition root. Installs the real vscode API into globals, wires the node-backed
 *  FileSystemPort, bootstraps `.flauz/`, attaches the artifact provider to a dedicated
 *  SourceControl, and registers the command seam. Everything below the seam (services)
 *  is vscode-agnostic and node-typing-agnostic; this is the ONLY module importing
 *  'vscode' and node builtins at runtime.
 *
 *  Build note: `main` points at ./out/extension.js, produced by the upstream
 *  built-in-extension compile (CI-side per MIGRATION-PLAN section 5 — never built in this
 *  sandbox). Local verification is tsc --noEmit + node --test over src/ + test/.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import { setVscodeApi } from './globals.ts';
import type { FileSystemPort } from './api.ts';
import { TaskService } from './taskService.ts';
import { EvidenceLedger } from './ledger.ts';
import { CheckpointInterop } from './checkpoint.ts';
import { FlauzArtifactProvider } from './scmArtifactProvider.ts';
import { registerWorkspaceCommands, type WorkspaceServices } from './commands.ts';

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

export function activate(context: vscode.ExtensionContext): void {
	setVscodeApi(vscode);

	const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (workspaceRoot === undefined) {
		vscode.window.showWarningMessage('flauz-workspace: no workspace folder open — .flauz/ state stays inactive.');
		return;
	}

	const clock = (): number => Date.now();
	const tasks = new TaskService({ root: workspaceRoot, fs: nodeFs, clock });
	const ledger = new EvidenceLedger({ root: workspaceRoot, fs: nodeFs, clock });
	const checkpoints = new CheckpointInterop(tasks, ledger, clock);
	const artifacts = new FlauzArtifactProvider(() => ledger.readRows());

	const sourceControl = vscode.scm.createSourceControl('flauz-evidence', 'Flauz Evidence');
	sourceControl.artifactProvider = artifacts;

	const services: WorkspaceServices = { tasks, ledger, checkpoints, artifacts };
	for (const disposable of [sourceControl, artifacts, ...registerWorkspaceCommands(services)]) {
		context.subscriptions.push(disposable);
	}

	void (async () => {
		try {
			await tasks.bootstrap();
			await ledger.ensure();
		} catch (err) {
			vscode.window.showErrorMessage(`flauz-workspace: failed to bootstrap .flauz/ state: ${err instanceof Error ? err.message : String(err)}`);
		}
	})();
}

export function deactivate(): void {
	// Nothing to do — all disposables ride context.subscriptions.
}
