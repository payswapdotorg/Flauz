/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import { setVscodeApi } from './globals.ts';
import { joinPath, type FileSystemPort } from './api.ts';
import { TaskService } from './taskService.ts';
import { EvidenceLedger } from './ledger.ts';
import { CheckpointInterop } from './checkpoint.ts';
import { FlauzArtifactProvider } from './scmArtifactProvider.ts';
import { registerWorkspaceCommands, type WorkspaceServices } from './commands.ts';
import { registerWorkspaceViews } from './views.ts';
import { registerLiveEvents } from './liveEvents.ts';

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
	// TL4-H2: the activation log channel (the flauz-agent posture) -- records
	// the live-events wiring decisions (watcher active / guarded off).
	const channel = vscode.window.createOutputChannel('Flauz Workspace');
	const log = (message: string): void => {
		channel.appendLine(message);
	};

	// TL4-001: the activity-bar shell (container `flauz`, views flauz.home +
	// flauz.tasks) registers BEFORE any early return so the views — and their
	// viewsWelcome states — exist even without a workspace folder. The services
	// attach below when a folder is open.
	const servicesRef: { current?: WorkspaceServices } = {};
	const views = registerWorkspaceViews({
		getServices: () => servicesRef.current,
		getWorkspaceRoot: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
		readFile: async relativePath => {
			const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
			return root === undefined ? undefined : nodeFs.readFileUtf8(joinPath(root, relativePath));
		},
	});

	// TL4-H2 -- live file events: a real watcher over the `.flauz/` state tree
	// debounces disk changes into the EXISTING views.refresh() path (never a
	// parallel loading path; last-known-good rows survive failed re-reads).
	// Inside the guard (no workspace folder) the watcher is not created and
	// the skip is logged -- the flauz-agent connect-guard posture.
	const liveEvents = registerLiveEvents({
		getWorkspaceRoot: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
		refresh: () => views.refresh(),
		log,
	});

	if (workspaceRoot === undefined) {
		vscode.window.showWarningMessage('flauz-workspace: no workspace folder open — .flauz/ state stays inactive.');
		for (const disposable of [channel, ...views.disposables, ...liveEvents.disposables, ...registerGuideCommand(context)]) {
			context.subscriptions.push(disposable);
		}
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
	servicesRef.current = services;
	for (const disposable of [channel, ...views.disposables, ...liveEvents.disposables, ...registerGuideCommand(context), sourceControl, artifacts, ...registerWorkspaceCommands(services)]) {
		context.subscriptions.push(disposable);
	}

	void (async () => {
		try {
			await tasks.bootstrap();
			await ledger.ensure();
			views.refresh();
		} catch (err) {
			vscode.window.showErrorMessage(`flauz-workspace: failed to bootstrap .flauz/ state: ${err instanceof Error ? err.message : String(err)}`);
		}
	})();
}

export function deactivate(): void {
	// Nothing to do — all disposables ride context.subscriptions.
}

/**
 * TL4-002 — the docs surface v1 (docs/FLAUZ-PROGRAM/TL4-PREMIUM-UX.md
 * section 4): the guide ships with the extension (flauz-guide.md at the
 * extension root) and opens from every error row's context menu (the stock
 * `viewItem == flauzError` menu rule) as well as the command palette.
 */
function registerGuideCommand(context: vscode.ExtensionContext): vscode.Disposable[] {
	const guideUri = vscode.Uri.joinPath(context.extensionUri, 'flauz-guide.md');
	return [
		vscode.commands.registerCommand('flauz.workspace.openGuide', async () => {
			try {
				const document = await vscode.workspace.openTextDocument(guideUri);
				void vscode.window.showTextDocument(document);
			} catch (err) {
				void vscode.window.showErrorMessage(`flauz-workspace: the Flauz guide is missing from the extension folder (${err instanceof Error ? err.message : String(err)}).`);
			}
		}),
	];
}
