/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Flauz Harness console - extension entry point (DH-010).
 *
 * Activation: `onView:flauz.harness` + narrow `onCommand:flauz.harness.*`
 * events only (never `*`, never onStartupFinished - the activation
 * budget law). The view registers FIRST so the shell surface exists
 * whatever happens below; every tree row is observed state from the
 * real Domain Harness OS kits and the DH-010 projection - never
 * fabricated.
 *
 * The console is a selection/inspection/composition surface: the
 * selection session ops (industry / company / work types / roles /
 * propose) ride the REAL DH-02 onboarding kit through the runtime
 * port; the navigation model rides the REAL DH-010 projection over
 * the REAL loaded records. NOTHING executes; ACTIVATION stays routed
 * through the DH-01 authority - the closed door disclosed on the
 * lifecycle row and on every recorded proposal (ARCHITECTURE-LOCK
 * 12.5/12.6).
 */

import * as vscode from 'vscode';
import {
	type HarnessConsoleState,
	applyHarnessList,
	applyNavigationLoad,
	applyRoleCompositions,
	applySessionResult,
	clearError,
	failOperation,
	initialHarnessState,
	recordProposal,
	selectHarness,
	selectRolesComposition,
	selectSession,
} from './harnessState.ts';
import type { HarnessConsolePort, SessionOpResult } from './harnessPort.ts';
import {
	HARNESS_VIEW_ID,
	INSPECT_HARNESS_COMMAND,
	SELECT_ROLES_COMMAND,
	SELECT_SESSION_COMMAND,
	VIEW_COMMAND_IDS,
	registerHarnessView,
} from './harnessView.ts';
import { cryptoRng, openFlauzHarnessPort } from './flauzHarnessPort.ts';

import { toIsoStamp } from './format.ts';

/** ISO timestamp for persistence edges (the only clock read in the extension; the shared module is the single timestamp source). */
function nowIso(): string {
	return toIsoStamp(Date.now());
}

/** The workspace root seam (the first workspace folder; undefined when no folder is open - the port never opens then). */
function workspaceRoot(): string | undefined {
	const folder = vscode.workspace.workspaceFolders?.[0];
	return folder?.uri.fsPath;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const channel = vscode.window.createOutputChannel('Flauz Harness');
	const log = (message: string) => channel.appendLine(message);
	context.subscriptions.push({ dispose: () => channel.dispose() });

	const root = workspaceRoot();
	if (root === undefined) {
		// The view registers FIRST (the shell surface law) even with no folder
		// open; the console stays at the honest empty state and every op surfaces
		// the observed no-workspace refusal.
		const emptyRef: { current: HarnessConsoleState } = { current: initialHarnessState([], [], []) };
		emptyRef.current = failOperation(emptyRef.current, 'No workspace folder is open - the Flauz Harness state lives under the workspace root (.flauz/harness).');
		const idleView = registerHarnessView(
			{
				registerTreeDataProvider: (viewId, provider) => vscode.window.registerTreeDataProvider(viewId, provider),
				EventEmitter: vscode.EventEmitter,
				TreeItem: vscode.TreeItem,
				ThemeIcon: vscode.ThemeIcon,
				TreeItemCollapsibleState: vscode.TreeItemCollapsibleState,
			},
			emptyRef,
		);
		context.subscriptions.push(
			vscode.commands.registerCommand(VIEW_COMMAND_IDS[5], () => { vscode.commands.executeCommand(`${HARNESS_VIEW_ID}.focus`); }),
			vscode.commands.registerCommand(VIEW_COMMAND_IDS[6], () => { idleView.refresh(); }),
		);
		return;
	}

	const opened = await openFlauzHarnessPort({ root, clock: nowIso, rng: cryptoRng });
	if (!opened.ok) {
		log(`the port refused to open: ${opened.reason}: ${opened.detail}`);
		vscode.window.showErrorMessage(`Flauz Harness: the harness state could not be opened - ${opened.reason}.`);
		return;
	}
	const port: HarnessConsolePort = opened.port;
	log(`port ${port.id} opened over ${root} (mode ${port.mode})`);

	const stateRef: { current: HarnessConsoleState } = { current: initialHarnessState([], [], []) };

	// The view registers FIRST (the shell surface law); the tree starts empty
	// and fills when the refresh below lands.
	const view = registerHarnessView(
		{
			registerTreeDataProvider: (viewId, provider) => vscode.window.registerTreeDataProvider(viewId, provider),
			EventEmitter: vscode.EventEmitter,
			TreeItem: vscode.TreeItem,
			ThemeIcon: vscode.ThemeIcon,
			TreeItemCollapsibleState: vscode.TreeItemCollapsibleState,
		},
		stateRef,
	);

	/** The observed refresh: the vocabularies, the roles options, the harness list, the driven session. */
	const refresh = async (): Promise<void> => {
		stateRef.current = clearError(stateRef.current);
		try {
			const [industries, sizeBands, workTypes, roles, harnesses] = await Promise.all([
				port.listIndustries(),
				port.listSizeBands(),
				port.listWorkTypes(),
				port.listRoleCompositions(),
				port.listHarnesses(),
			]);
			stateRef.current = initialHarnessState(industries, sizeBands, workTypes);
			stateRef.current = applyRoleCompositions(stateRef.current, roles);
			stateRef.current = applyHarnessList(stateRef.current, harnesses);
			const driven = stateRef.current.activeSessionId;
			if (driven !== undefined) {
				stateRef.current = applySessionResult(stateRef.current, await port.inspectSession(driven));
			}
			log(`refreshed: ${stateRef.current.harnesses.length} harnesses, ${stateRef.current.roleCompositions.length} role compositions`);
			if (stateRef.current.inspectedHarnessId !== undefined) {
				const navigation = await port.loadNavigation(stateRef.current.inspectedHarnessId);
				stateRef.current = applyNavigationLoad(stateRef.current, stateRef.current.inspectedHarnessId, navigation);
			}
			view.refresh();
		} catch (error) {
			const message = String(error);
			log(`refresh failed: ${message}`);
			stateRef.current = failOperation(stateRef.current, message);
			view.refresh();
		}
	};

	/** Folds a session op into the state and surfaces the observed refusal when refused. */
	const runSessionOp = async (op: () => Promise<SessionOpResult>): Promise<void> => {
		stateRef.current = clearError(stateRef.current);
		const result = await op();
		stateRef.current = applySessionResult(stateRef.current, result);
		if (!result.ok) {
			log(`session op refused: ${result.reason}: ${result.detail}`);
			vscode.window.showWarningMessage(`Flauz Harness: ${result.reason} - ${result.detail}`);
		}
		view.refresh();
	};

	const beginSession = async (): Promise<void> => {
		await runSessionOp(() => port.beginSession());
	};

	const selectIndustry = async (): Promise<void> => {
		const sessionId = stateRef.current.activeSessionId;
		if (sessionId === undefined) {
			vscode.window.showWarningMessage('Flauz Harness: begin a session first.');
			return;
		}
		const industry = await vscode.window.showQuickPick([...stateRef.current.industries], { placeHolder: 'Select the industry' });
		if (industry === undefined) {
			return;
		}
		await runSessionOp(() => port.selectIndustry(sessionId, industry));
	};

	const composeCompany = async (): Promise<void> => {
		const sessionId = stateRef.current.activeSessionId;
		if (sessionId === undefined) {
			vscode.window.showWarningMessage('Flauz Harness: begin a session first.');
			return;
		}
		const displayName = await vscode.window.showInputBox({ placeHolder: 'The company display name', prompt: 'The company profile\'s display name (at most 120 characters)' });
		if (displayName === undefined) {
			return;
		}
		const sizeBand = await vscode.window.showQuickPick([...stateRef.current.sizeBands], { placeHolder: 'Select the company size band' });
		if (sizeBand === undefined) {
			return;
		}
		await runSessionOp(() => port.composeCompany(sessionId, displayName, sizeBand));
	};

	const selectWorkTypes = async (): Promise<void> => {
		const sessionId = stateRef.current.activeSessionId;
		if (sessionId === undefined) {
			vscode.window.showWarningMessage('Flauz Harness: begin a session first.');
			return;
		}
		const picks = await vscode.window.showQuickPick(
			stateRef.current.workTypes.map((workType) => ({ label: workType, picked: false })),
			{ placeHolder: 'Select the work types (the frozen list order is preserved)', canPickMany: true },
		);
		if (picks === undefined) {
			return;
		}
		const workTypes = stateRef.current.workTypes.filter((workType) => picks.some((pick) => pick.label === workType));
		await runSessionOp(() => port.selectWorkTypes(sessionId, workTypes));
	};

	const proposeDraft = async (): Promise<void> => {
		const sessionId = stateRef.current.activeSessionId;
		if (sessionId === undefined) {
			vscode.window.showWarningMessage('Flauz Harness: begin a session first.');
			return;
		}
		const rolesSessionId = stateRef.current.selectedRolesSessionId;
		if (rolesSessionId === undefined) {
			vscode.window.showWarningMessage('Flauz Harness: select a role composition for the draft first.');
			return;
		}
		await runSessionOp(() => port.proposeDraft(sessionId, rolesSessionId));
		const session = stateRef.current.sessions.find((candidate) => candidate.sessionId === sessionId);
		const harnessId = session?.proposedHarnessId;
		if (session !== undefined && session.stage === 'proposed' && harnessId !== undefined) {
			const { proposal } = recordProposal(stateRef.current, sessionId, harnessId, nowIso());
			stateRef.current = { ...stateRef.current, proposals: [...stateRef.current.proposals, proposal] };
			log(`proposed ${harnessId} through the real DH-02 walk (${proposal.proposalId})`);
			// The refusal rides EVERY recorded proposal - the closed activation door.
			vscode.window.showInformationMessage(`Flauz Harness: proposed ${harnessId}. ${proposal.refusalReason}`);
		}
		view.refresh();
	};

	const inspectHarness = async (harnessId: string): Promise<void> => {
		stateRef.current = clearError(stateRef.current);
		stateRef.current = selectHarness(stateRef.current, harnessId);
		const navigation = await port.loadNavigation(harnessId);
		stateRef.current = applyNavigationLoad(stateRef.current, harnessId, navigation);
		if (!navigation.ok) {
			log(`navigation load refused: ${navigation.reason}: ${navigation.detail}`);
			vscode.window.showWarningMessage(`Flauz Harness: ${navigation.reason} - ${navigation.detail}`);
		} else {
			log(`navigation model loaded for ${harnessId}: ${navigation.model.sections.length} sections`);
		}
		view.refresh();
	};

	context.subscriptions.push(
		vscode.commands.registerCommand(VIEW_COMMAND_IDS[0], () => { void beginSession(); }),
		vscode.commands.registerCommand(VIEW_COMMAND_IDS[1], () => { void selectIndustry(); }),
		vscode.commands.registerCommand(VIEW_COMMAND_IDS[2], () => { void composeCompany(); }),
		vscode.commands.registerCommand(VIEW_COMMAND_IDS[3], () => { void selectWorkTypes(); }),
		vscode.commands.registerCommand(VIEW_COMMAND_IDS[4], () => { void proposeDraft(); }),
		vscode.commands.registerCommand(VIEW_COMMAND_IDS[5], () => { vscode.commands.executeCommand(`${HARNESS_VIEW_ID}.focus`); }),
		vscode.commands.registerCommand(VIEW_COMMAND_IDS[6], () => { void refresh(); }),
	);

	// Session driving, roles selection and harness inspection ride the tree rows' command args.
	context.subscriptions.push(
		vscode.commands.registerCommand(SELECT_SESSION_COMMAND, (sessionId: string) => {
			stateRef.current = selectSession(stateRef.current, sessionId);
			view.refresh();
		}),
		vscode.commands.registerCommand(SELECT_ROLES_COMMAND, (rolesSessionId: string) => {
			stateRef.current = selectRolesComposition(stateRef.current, rolesSessionId);
			view.refresh();
		}),
		vscode.commands.registerCommand(INSPECT_HARNESS_COMMAND, (harnessId: string) => {
			void inspectHarness(harnessId);
		}),
	);

	await refresh();
}

export function deactivate(): void {
	// Nothing to dispose beyond subscriptions (the channel and the tree
	// registration ride context.subscriptions).
}
