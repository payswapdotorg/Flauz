/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Flauz Agent Bridge — extension entry point (activation wiring).
 *
 * PERF-PLAN section 1.2/section 2.1: activation is `onStartupFinished` + narrow
 * `onCommand:flauz.*` / `onView:flauz.agentSessions` events (never `*`). The
 * activation sequence emits the documented marks, in order (timerService only
 * aggregates `code/`-prefixed marks, PERFORMANCE-PLAN section 6.2):
 *
 *   code/flauz/willActivateBridge      -> wraps the whole activation (pair row 5)
 *   code/flauz/willConnectCore         -> fork core/service.mjs (hello/ready)
 *   code/flauz/didConnectCore
 *   code/flauz/willRegisterParticipants -> flauz.agent participant + flauz_terminal tool
 *   code/flauz/didRegisterParticipants
 *   code/flauz/willWarmModels           -> one selectChatModels call
 *   code/flauz/didWarmModels
 *   code/flauz/didActivateBridge
 *
 * TL4-001: activation also registers the `flauz.agentSessions` view FIRST —
 * the tree reflects the bridge status object updated at each milestone below.
 *
 * Without an open workspace folder the bridge degrades gracefully: the core
 * service is not started and only an explanatory log line is written (the
 * seam, participant, and ledger command all need a workspace root).
 */

import * as vscode from 'vscode';
import { mark, FlauzMarks } from './marks.ts';
import { SeamClient } from './seamClient.ts';
import { selectPreferredModels, type ModelSelection } from './models.ts';
import { Orchestrator, type ToolResultLike } from './orchestrator.ts';
import { registerTerminalTool } from './tools/terminalTool.ts';
import { registerParticipant, PARTICIPANT_ID } from './participant.ts';
import { registerAgentSessionsView, type BridgeStatus } from './sessionsView.ts';
import { createOrchTakeoverPort, seamTaskPort } from './takeover.ts';
import type { Task } from './types.ts';

let activeSeam: SeamClient | undefined;

/** Probes the seam for the most recent non-terminal task (the view's active-task row). */
async function activeTaskFromSeam(seam: SeamClient): Promise<Task | undefined> {
	const { tasks } = await seam.listTasks();
	const active = tasks.filter(task => !['done', 'failed', 'cancelled'].includes(task.status));
	return active[active.length - 1];
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	// PERF section 1.3 row 5: the bridge-activation budget pair (added at first-CI
	// integration — the startup-pair gate requires an emit site for every
	// budgeted mark, PERF section 6.3/R6).
	mark(FlauzMarks.willActivateBridge);
	try {
		await activateInner(context);
	} finally {
		mark(FlauzMarks.didActivateBridge);
	}
}

async function activateInner(context: vscode.ExtensionContext): Promise<void> {
	const channel = vscode.window.createOutputChannel('Flauz Agent');
	const log = (message: string) => channel.appendLine(message);
	context.subscriptions.push({ dispose: () => channel.dispose() });

	const folders = vscode.workspace.workspaceFolders;
	const workspaceRoot = folders !== undefined && folders.length > 0 ? folders[0].uri.fsPath : undefined;

	// TL4-001: the flauz.agentSessions view registers FIRST so the shell surface
	// exists whatever happens below. The status object is the view's single
	// source of truth — every milestone updates it and refreshes the tree
	// (observed state only, never fabricated; see src/sessionsView.ts).
	const statusRef: { current: BridgeStatus } = {
		current: {
			coreConnected: false,
			participantRegistered: false,
			terminalToolRegistered: false,
			workspaceOpen: workspaceRoot !== undefined,
		},
	};
	const sessionsView = registerAgentSessionsView(
		{
			registerTreeDataProvider: (viewId, provider) => vscode.window.registerTreeDataProvider(viewId, provider),
			registerCommand: (command, handler) => vscode.commands.registerCommand(command, handler),
			executeCommand: (command, ...args) => vscode.commands.executeCommand(command, ...args),
			EventEmitter: vscode.EventEmitter,
			TreeItem: vscode.TreeItem,
			ThemeIcon: vscode.ThemeIcon,
			TreeItemCollapsibleState: vscode.TreeItemCollapsibleState,
		},
		() => statusRef.current,
	);
	for (const disposable of sessionsView.disposables) {
		context.subscriptions.push(disposable);
	}
	const updateStatus = (patch: Partial<BridgeStatus>): void => {
		statusRef.current = { ...statusRef.current, ...patch };
		sessionsView.provider.refresh();
	};

	let seam: SeamClient | undefined;
	if (workspaceRoot !== undefined) {
		mark(FlauzMarks.willConnectCore);
		try {
			seam = await SeamClient.start({
				workspaceRoot,
				globalStoragePath: context.globalStorageUri.fsPath,
				logger: log,
			});
			updateStatus({ coreConnected: true, activeTask: () => activeTaskFromSeam(seam!) });
		} catch (error) {
			log(`core service failed to start: ${error instanceof Error ? error.message : String(error)}`);
			updateStatus({ coreError: error instanceof Error ? error.message : String(error) });
		}
		mark(FlauzMarks.didConnectCore);
	} else {
		log('no workspace folder open; core service not started (the participant needs a workspace root)');
	}
	activeSeam = seam;

	mark(FlauzMarks.willRegisterParticipants);
	const toolHandle = registerTerminalTool(
		(name, tool) => vscode.lm.registerTool(name, tool),
		{
			terminalFactory: (name) => vscode.window.createTerminal({ name }),
			logger: log,
		},
	);
	context.subscriptions.push(toolHandle);
	updateStatus({ terminalToolRegistered: true });

	if (seam !== undefined && workspaceRoot !== undefined) {
		const selection: { current: ModelSelection } = { current: { models: [], status: 'no-models' } };
		// P2-FIX-204: the human takeover port — the fifth human gate. The
		// in-process orch mediator owns .flauz/orchestration/; the evidence
		// rows the takeover ops mint go through the seam (the service stays
		// the ledger's single writer).
		const takeoverPort = createOrchTakeoverPort(workspaceRoot, seamTaskPort(seam), log);
		const orchestrator = new Orchestrator({
			seam,
			workspaceRoot,
			getModelSelection: () => selection.current,
			invokeTool: (name, options) =>
				vscode.lm.invokeTool(name, {
					toolInvocationToken: options.toolInvocationToken as vscode.ChatParticipantToolToken,
					input: options.input,
				}) as Promise<ToolResultLike>,
			takeoverPort,
			logger: log,
		});
		const participantHandle = registerParticipant(
			(id, handler) => vscode.chat.createChatParticipant(id, handler),
			{ orchestrator, getModelSelection: () => selection.current, logger: log },
		);
		context.subscriptions.push(participantHandle);
		updateStatus({ participantRegistered: true, takeoverStep: (taskId) => takeoverPort.stuckStepOf(taskId) });

		context.subscriptions.push(
			vscode.commands.registerCommand('flauz.showTasks', async () => {
				const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(vscode.Uri.file(workspaceRoot), '.flauz', 'tasks.json'));
				void vscode.window.showTextDocument(document);
			}),
		);
		context.subscriptions.push(
			vscode.commands.registerCommand('flauz.verifyLedger', async () => {
				const verdict = await seam!.verifyLedger();
				log(`ledger verify: ok=${String(verdict.ok)} rows=${String(verdict.rows)}${verdict.firstBadSeq !== undefined ? ` firstBadSeq=${String(verdict.firstBadSeq)}` : ''}`);
				channel.show();
			}),
		);
		// P2-FIX-204: the Agent Sessions row/palette affordance — performs the
		// same human takeover sequence as the /takeover chat command
		// (request -> accept -> complete, actor human, evidence-bearing).
		context.subscriptions.push(
			vscode.commands.registerCommand('flauz.agent.takeoverStep', async (arg?: { taskId?: unknown }) => {
				const taskId = typeof arg?.taskId === 'string' ? arg.taskId : (await activeTaskFromSeam(seam!))?.id;
				if (taskId === undefined) {
					log('takeover: no active Flauz task — nothing to take over');
					return;
				}
				const result = await takeoverPort.takeOverStep(taskId, '');
				if (result.outcome === 'taken-over') {
					log(`takeover: step ${result.receipt.stepId} of ${result.receipt.graphId} completed by the human (rows: ${result.receipt.rows.map(row => row.rowId).join(', ')})`);
				} else {
					log(`takeover: ${result.message}`);
				}
				sessionsView.provider.refresh();
				channel.show();
			}),
		);

		mark(FlauzMarks.didRegisterParticipants);

		mark(FlauzMarks.willWarmModels);
		selection.current = await selectPreferredModels((selector) => vscode.lm.selectChatModels(selector));
		mark(FlauzMarks.didWarmModels);
		updateStatus({ modelSelection: selection.current });
		log(`models: ${selection.current.status}${selection.current.models.length > 0 ? ` (${selection.current.models.map((model) => `${model.vendor}/${model.id}`).join(', ')})` : ''}`);
	} else {
		mark(FlauzMarks.didRegisterParticipants);
	}
}

export function deactivate(): void {
	const seam = activeSeam;
	activeSeam = undefined;
	void seam?.dispose();
}
