/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Flauz Lab console - extension entry point (LAB-009 W1).
 *
 * Activation: `onView:flauz.lab` + narrow `onCommand:flauz.lab.*` events only
 * (never `*`, never onStartupFinished - the activation budget law). The view
 * registers FIRST so the shell surface exists whatever happens below; every
 * tree row is observed state from the deterministic lab core, never
 * fabricated.
 *
 * The console is a recommendation surface: Run Lab Now executes the L2
 * fixture ladder through the runtime port, Save Recommendation records the
 * reversible draft and ALWAYS surfaces the apply refusal (applying routes
 * through Agent OS via the LAB-010 bridge - DL-85's closed door).
 */

import * as vscode from 'vscode';
import {
	type LabConsoleState,
	applyRun,
	clearError,
	failScenarioRefresh,
	initialConsoleState,
	saveRecommendation,
	selectCandidate,
	selectScenario,
} from './consoleState.ts';
import type { LabConsolePort } from './labConsolePort.ts';
import {
	LAB_VIEW_ID,
	SELECT_CANDIDATE_COMMAND,
	SELECT_SCENARIO_COMMAND,
	VIEW_COMMAND_IDS,
	registerLabView,
} from './labView.ts';
import { flauzLabConsolePort } from './labFlauzPort.ts';

import { toIsoStamp } from './format.ts';

/** ISO timestamp for persistence edges (the only clock read in the extension; the shared module is the single timestamp source). */
function nowIso(): string {
	return toIsoStamp(Date.now());
}

/** Monotonic console run counter (run ids are caller-minted, deterministic in shape). */
let runCounter = 0;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const channel = vscode.window.createOutputChannel('Flauz Lab');
	const log = (message: string) => channel.appendLine(message);
	context.subscriptions.push({ dispose: () => channel.dispose() });

	const port: LabConsolePort = flauzLabConsolePort;
	const stateRef: { current: LabConsoleState } = { current: initialConsoleState([]) };

	// The view registers FIRST (the shell surface law); the tree starts empty
	// and fills when the scenario refresh below lands.
	const view = registerLabView(
		{
			registerTreeDataProvider: (viewId, provider) => vscode.window.registerTreeDataProvider(viewId, provider),
			EventEmitter: vscode.EventEmitter,
			TreeItem: vscode.TreeItem,
			ThemeIcon: vscode.ThemeIcon,
			TreeItemCollapsibleState: vscode.TreeItemCollapsibleState,
		},
		stateRef,
	);

	const refreshScenarios = async (): Promise<void> => {
		stateRef.current = clearError(stateRef.current);
		try {
			const scenarios = await port.listScenarios();
			const keepActive = stateRef.current.activeScenarioId !== undefined
				&& scenarios.some((s) => s.id === stateRef.current.activeScenarioId);
			stateRef.current = {
				...stateRef.current,
				scenarios,
				activeScenarioId: keepActive ? stateRef.current.activeScenarioId : scenarios[0]?.id,
			};
			log(`scenarios refreshed: ${scenarios.length} (active: ${stateRef.current.activeScenarioId ?? 'none'})`);
			view.refresh();
		} catch (error) {
			const message = String(error);
			log(`scenario refresh failed: ${message}`);
			stateRef.current = failScenarioRefresh(stateRef.current, message);
			view.refresh();
		}
	};

	const runNow = async (): Promise<void> => {
		const scenarioId = stateRef.current.activeScenarioId;
		if (!scenarioId) {
			vscode.window.showWarningMessage('Flauz Lab: no scenario selected.');
			return;
		}
		runCounter += 1;
		const runId = `console-w1-${runCounter}`;
		const summary = await port.runScenario(scenarioId, runId, nowIso());
		if (!summary) {
			vscode.window.showErrorMessage(`Flauz Lab: run ${runId} over ${scenarioId} produced no summary.`);
			return;
		}
		stateRef.current = applyRun(stateRef.current, summary);
		log(`run ${runId} over ${scenarioId}: ${summary.candidates.length} candidates, best ${summary.bestCandidateId} (${summary.evidenceLevel})`);
		view.refresh();
		vscode.window.showInformationMessage(`Flauz Lab: run complete - best candidate ${summary.bestCandidateId} (evidence: ${summary.evidenceLevel}).`);
	};

	const save = async (): Promise<void> => {
		const { state, outcome } = saveRecommendation(stateRef.current, undefined, nowIso());
		stateRef.current = state;
		view.refresh();
		if (outcome.saved && outcome.recommendation) {
			// The refusal rides EVERY successful save - DL-85's closed apply door.
			vscode.window.showInformationMessage(`Flauz Lab: saved ${outcome.recommendation.recommendationId}. ${outcome.recommendation.refusalReason}`);
		} else {
			vscode.window.showWarningMessage(`Flauz Lab: save refused - ${outcome.reason ?? 'unknown reason'}`);
		}
	};

	context.subscriptions.push(
		vscode.commands.registerCommand(VIEW_COMMAND_IDS[0], () => { void runNow(); }),
		vscode.commands.registerCommand(VIEW_COMMAND_IDS[1], () => { void save(); }),
		vscode.commands.registerCommand(VIEW_COMMAND_IDS[2], () => { vscode.commands.executeCommand(`${LAB_VIEW_ID}.focus`); }),
		vscode.commands.registerCommand(VIEW_COMMAND_IDS[3], () => { void refreshScenarios(); }),
	);

	// Scenario selection + candidate inspection ride the tree rows' command args.
	context.subscriptions.push(
		vscode.commands.registerCommand(SELECT_SCENARIO_COMMAND, (scenarioId: string) => {
			stateRef.current = selectScenario(stateRef.current, scenarioId);
			view.refresh();
		}),
		vscode.commands.registerCommand(SELECT_CANDIDATE_COMMAND, (candidateId: string) => {
			stateRef.current = selectCandidate(stateRef.current, candidateId);
			view.refresh();
		}),
	);

	await refreshScenarios();
}

export function deactivate(): void {
	// Nothing to dispose beyond subscriptions (the channel and the tree
	// registration ride context.subscriptions).
}
