/**
 * Flauz Agent Bridge — extension entry point (activation wiring).
 *
 * PERF-PLAN §1.2/§2.1: activation is `onStartupFinished` + two narrow
 * `onCommand:flauz.*` events (never `*`). The activation sequence emits the
 * documented marks, in order (timerService only aggregates `code/`-prefixed
 * marks, PERFORMANCE-PLAN §6.2):
 *
 *   code/flauz/willConnectCore      -> fork core/service.mjs (hello/ready)
 *   code/flauz/didConnectCore
 *   code/flauz/willRegisterParticipants -> flauz.agent participant + flauz_terminal tool
 *   code/flauz/didRegisterParticipants
 *   code/flauz/willWarmModels       -> one selectChatModels call
 *   code/flauz/didWarmModels
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

let activeSeam: SeamClient | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	// PERF §1.3 row 5: the bridge-activation budget pair (added at first-CI
	// integration — the startup-pair gate requires an emit site for every
	// budgeted mark, PERF §6.3/R6).
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

	let seam: SeamClient | undefined;
	if (workspaceRoot !== undefined) {
		mark(FlauzMarks.willConnectCore);
		try {
			seam = await SeamClient.start({
				workspaceRoot,
				globalStoragePath: context.globalStorageUri.fsPath,
				logger: log,
			});
		} catch (error) {
			log(`core service failed to start: ${error instanceof Error ? error.message : String(error)}`);
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

	if (seam !== undefined && workspaceRoot !== undefined) {
		const selection: { current: ModelSelection } = { current: { models: [], status: 'no-models' } };
		const orchestrator = new Orchestrator({
			seam,
			workspaceRoot,
			getModelSelection: () => selection.current,
			invokeTool: (name, options) =>
				vscode.lm.invokeTool(name, {
					toolInvocationToken: options.toolInvocationToken as vscode.ChatParticipantToolToken,
					input: options.input,
				}) as Promise<ToolResultLike>,
			logger: log,
		});
		const participantHandle = registerParticipant(
			(id, handler) => vscode.chat.createChatParticipant(id, handler),
			{ orchestrator, getModelSelection: () => selection.current, logger: log },
		);
		context.subscriptions.push(participantHandle);

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

		mark(FlauzMarks.didRegisterParticipants);

		mark(FlauzMarks.willWarmModels);
		selection.current = await selectPreferredModels((selector) => vscode.lm.selectChatModels(selector));
		mark(FlauzMarks.didWarmModels);
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
