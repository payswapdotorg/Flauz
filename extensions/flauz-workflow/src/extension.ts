/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Flauz Workflow extension activation (Wave 4, Lane K).
 *
 * Activation discipline (PERFORMANCE-PLAN section 2.1/2.2, activation-lint R1-R3):
 * command activation ONLY (`onCommand:flauz.workflow.*`) - never `*`, never
 * onStartupFinished (that budget is bridge + workspace only).
 *
 * Wires the node FileSystemPort + the flauz-workspace services (TaskService,
 * EvidenceLedger - the .flauz/ flauz.tasks/v0 state family this lane extends)
 * into the WorkflowService, plus the two production ports:
 *
 *   - ShellToolExecutor: executes recorded command steps via node:child_process
 *     in the workspace root. Approval posture (SECURITY-MODEL section 3.4): the
 *     recorded human approval covers the exact recorded input (digest binding);
 *     'ask' steps and 'ask' mode re-confirm through the quick-pick gate.
 *   - QuickPickApprovalPort: the 'ask' human gate via vscode.window.
 */

import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { setVscodeApi, vscodeApi } from './globals.ts';
import { loadCheckpointSigner } from './keys.ts';
import type { CheckpointSigner, FileSystemPort } from '../../flauz-workspace/src/api.ts';
import { TaskService } from '../../flauz-workspace/src/taskService.ts';
import { EvidenceLedger } from '../../flauz-workspace/src/ledger.ts';
import { WorkflowService, type ApprovalPort, type ToolExecutorPort, type WorkflowFragment, type WorkflowToolStep } from './envelope.ts';
import { registerWorkflowCommands, type WorkflowCommandServices } from './commands.ts';

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

const SHELL = process.platform === 'win32' ? 'cmd' : 'sh';
const SHELL_FLAG = process.platform === 'win32' ? '/c' : '-c';

/**
 * Executes a recorded command step (v0: shell capture; stdout+stderr recorded,
 * exit code decides ok). The Wave-5 binding to the participant's
 * toolInvocationToken + the flauz_terminal tool's native HumanApproval gate is
 * the documented GAPS-AND-SKIPS follow-up.
 */
export function shellExecutor(workspaceRoot: string): ToolExecutorPort {
	return async (step: WorkflowToolStep) => {
		const command = typeof step.input.command === 'string' ? step.input.command : '';
		if (command.length === 0) {
			return { ok: false, output: 'flauz-workflow: tool step has no recorded command' };
		}
		return new Promise(resolve => {
			execFile(SHELL, [SHELL_FLAG, command], { cwd: workspaceRoot, encoding: 'utf-8', timeout: 30_000 }, (error, stdout, stderr) => {
				const output = `${stdout ?? ''}${stderr ?? ''}`.trim();
				if (error) {
					resolve({ ok: false, output: output.length > 0 ? output : String(error) });
					return;
				}
				resolve({ ok: true, output });
			});
		});
	};
}

/** The 'ask' human gate: quick pick with the three legal decisions per gate. */
export function quickPickApprovalPort(): ApprovalPort {
	return async (gate: 'approval' | 'sign-off', fragment: WorkflowFragment) => {
		const api = vscodeApi();
		const title = gate === 'approval'
			? `Workflow ${fragment.id}: approve the re-run of "${fragment.title}"?`
			: `Workflow ${fragment.id}: sign off the re-run?`;
		type GateChoice = 'approve' | 'request-changes' | 'cancel' | 'sign-off' | 'skip';
		const picks: Array<{ label: string; value: GateChoice }> = gate === 'approval'
			? [
				{ label: 'Approve', value: 'approve' },
				{ label: 'Request changes', value: 'request-changes' },
				{ label: 'Cancel', value: 'cancel' },
			]
			: [
				{ label: 'Sign off', value: 'sign-off' },
				{ label: 'Leave awaiting sign-off', value: 'skip' },
			];
		const choice = await api.window.showQuickPick(picks, { placeHolder: title });
		if (choice === undefined) {
			return gate === 'approval' ? 'cancel' : 'skip';
		}
		return choice.value;
	};
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	setVscodeApi(vscode);

	const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (workspaceRoot === undefined) {
		vscode.window.showWarningMessage('flauz-workflow: no workspace folder open - workflow state stays inactive.');
		return;
	}

	const clock = (): number => Date.now();
	// DL-20 hardening: load the USER checkpoint keystore (~/.flauz/keystore -
	// the user owns the chain, SECURITY-MODEL section 3.3). v0 posture: the
	// fixture manifest format of src/keys.ts; the real OS-backed keystore is
	// product integration (REPORT GAPS-AND-SKIPS). No keystore -> UNHARDENED
	// (v0 hash-chain-only behavior, documented).
	const keystoreDir = path.join(os.homedir(), '.flauz', 'keystore');
	const readUtf8 = async (target: string): Promise<string | undefined> => {
		try {
			return await fs.readFile(target, { encoding: 'utf-8' });
		} catch {
			return undefined;
		}
	};
	let signer: CheckpointSigner | undefined;
	try {
		signer = await loadCheckpointSigner(keystoreDir, readUtf8, (...parts: string[]) => path.join(...parts.filter(part => part.length > 0)));
	} catch (err) {
		vscode.window.showWarningMessage(`flauz-workflow: checkpoint keystore at ${keystoreDir} failed to load (${err instanceof Error ? err.message : String(err)}); the ledger runs UNHARDENED.`);
	}
	const tasks = new TaskService({ root: workspaceRoot, fs: nodeFs, clock });
	const ledger = new EvidenceLedger({ root: workspaceRoot, fs: nodeFs, clock, ...(signer !== undefined ? { signer } : {}) });
	if (signer !== undefined) {
		vscode.window.showInformationMessage(`flauz-workflow: ledger hardening ON (signed checkpoints via ${signer.algorithm} key '${signer.keyId}')`);
	}
	const workflows = new WorkflowService({ root: workspaceRoot, fs: nodeFs, tasks, ledger, clock });
	const services: WorkflowCommandServices = {
		workflows,
		executor: shellExecutor(workspaceRoot),
		ask: quickPickApprovalPort(),
	};

	for (const disposable of registerWorkflowCommands(services)) {
		context.subscriptions.push(disposable);
	}

	void (async () => {
		try {
			await tasks.bootstrap();
			await ledger.ensure();
			await nodeFs.mkdir(`${workspaceRoot}/.flauz/workflows`);
			// Seed the empty registry when absent so list() and the canary have a
			// deterministic artifact from the first boot on.
			const indexPath = `${workspaceRoot}/.flauz/workflows/index.json`;
			if (await nodeFs.readFileUtf8(indexPath) === undefined) {
				await nodeFs.writeFile(indexPath, '{\n  "$schema": "flauz.workflows/v1",\n  "workflows": []\n}\n');
			}
		} catch (err) {
			vscode.window.showErrorMessage(`flauz-workflow: failed to bootstrap .flauz/ workflow state: ${err instanceof Error ? err.message : String(err)}`);
		}
	})();
}

export function deactivate(): void {
	// Nothing to do - all disposables ride context.subscriptions.
}
