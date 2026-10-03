/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * LAB-009 W1 - the `flauz.lab` tree view (container `flauz`): scenarios, the
 * active run's candidates, the selected candidate's comparison rows, the
 * saved recommendations with their apply-refusal notes, and the observed
 * refresh-failure row ('Unable to Load Lab', contextValue 'flauzError', the
 * Retry-titled row command - the shared error grammar).
 *
 * DI shape mirrors extensions/flauz-agent/src/sessionsView.ts: the module
 * takes the vscode slices it needs as parameters so tests run under plain
 * `node --test` without the editor. Node-free: no node: imports anywhere.
 * Every row carries accessibilityInformation (premium spec sections 4/6).
 */

import type * as vscode from 'vscode';
import {
	APPLY_REFUSAL_REASON,
	type LabConsoleState,
	type LabComparisonRow,
	type LabScenarioSummary,
	comparisonForSelected,
} from './consoleState.ts';

/** View id this module serves (contributed in package.json, container `flauz`). */
export const LAB_VIEW_ID = 'flauz.lab';

/** Commands contributed for the view (see package.json; focus follows the flauz.focusView.<view> law). */
export const VIEW_COMMAND_IDS = [
	'flauz.lab.runNow',
	'flauz.lab.saveRecommendation',
	'flauz.focusView.lab',
	'flauz.lab.refreshView',
] as const;

/** Row-internal commands (invoked by tree rows; registered by extension.ts). */
export const SELECT_SCENARIO_COMMAND = 'flauz.lab.selectScenario';
export const SELECT_CANDIDATE_COMMAND = 'flauz.lab.selectCandidate';

/** The retry command the error row carries (the refresh command re-used as Retry). */
export const ERROR_RETRY_COMMAND = 'flauz.lab.refreshView';

/** Tree element union: scenario rows, the run header, candidate rows, comparison rows, saved rows, the error row. */
export type LabTreeElement =
	| { readonly kind: 'scenario'; readonly scenario: LabScenarioSummary; readonly active: boolean }
	| { readonly kind: 'run'; readonly runId: string; readonly scenarioId: string; readonly ladderLevel: number; readonly evidenceLevel: string }
	| { readonly kind: 'candidate'; readonly candidateId: string; readonly name: string; readonly topology: string; readonly utility: number; readonly success: number; readonly quality: number; readonly latency: number; readonly cost: number; readonly selected: boolean; readonly baseline: boolean }
	| { readonly kind: 'comparison'; readonly row: LabComparisonRow }
	| { readonly kind: 'savedHeader' }
	| { readonly kind: 'saved'; readonly recommendationId: string; readonly candidateId: string; readonly createdAt: string; readonly refusal: string }
	| { readonly kind: 'error'; readonly message: string };

/** The vscode slices the view needs (injected: real api in extension.ts, doubles in tests). */
export interface LabViewApi {
	registerTreeDataProvider(viewId: string, provider: vscode.TreeDataProvider<LabTreeElement>): vscode.Disposable;
	EventEmitter: new <T>() => vscode.EventEmitter<T>;
	TreeItem: typeof vscode.TreeItem;
	ThemeIcon: typeof vscode.ThemeIcon;
	TreeItemCollapsibleState: typeof vscode.TreeItemCollapsibleState;
}

/** Map a console state to the tree elements the view shows (section-ordered, error first). */
export function treeElementsFor(state: LabConsoleState): LabTreeElement[] {
	const elements: LabTreeElement[] = [];
	if (state.error !== undefined) {
		elements.push({ kind: 'error', message: state.error });
	}
	for (const scenario of state.scenarios) {
		elements.push({ kind: 'scenario', scenario, active: scenario.id === state.activeScenarioId });
	}
	const run = state.lastRun;
	if (run) {
		elements.push({ kind: 'run', runId: run.runId, scenarioId: run.scenarioId, ladderLevel: run.ladderLevel, evidenceLevel: run.evidenceLevel });
		for (const candidate of run.candidates) {
			elements.push({
				kind: 'candidate',
				candidateId: candidate.candidateId,
				name: candidate.name,
				topology: candidate.topology,
				utility: candidate.utility,
				success: candidate.success,
				quality: candidate.quality,
				latency: candidate.latency,
				cost: candidate.cost,
				selected: candidate.candidateId === state.selectedCandidateId,
				baseline: candidate.candidateId === run.candidates[0].candidateId,
			});
		}
		const comparison = comparisonForSelected(state);
		for (const row of comparison) {
			elements.push({ kind: 'comparison', row });
		}
	}
	if (state.saved.length > 0) {
		elements.push({ kind: 'savedHeader' });
		for (const saved of state.saved) {
			elements.push({ kind: 'saved', recommendationId: saved.recommendationId, candidateId: saved.candidateId, createdAt: saved.createdAt, refusal: saved.refusalReason });
		}
	}
	return elements;
}

/** Render one tree element as a vscode TreeItem (label/description/tooltip/icon/command/a11y). */
export function treeItemFor(element: LabTreeElement, api: LabViewApi): vscode.TreeItem {
	const item = new api.TreeItem('');
	switch (element.kind) {
		case 'error': {
			// The shared error grammar: Unable to Load <Surface>, contextValue
			// 'flauzError', a Retry-titled row command, the retry sentence.
			item.label = 'Unable to Load Lab';
			item.description = 'scenario refresh failed';
			item.tooltip = `${element.message}\n\nSelecting this row retries the scenario refresh.`;
			item.iconPath = new api.ThemeIcon('error');
			item.collapsibleState = api.TreeItemCollapsibleState.None;
			item.contextValue = 'flauzError';
			item.command = { command: ERROR_RETRY_COMMAND, title: 'Retry' };
			item.accessibilityInformation = { label: `Unable to load the Flauz Lab scenarios: ${element.message}. Select to retry.` };
			break;
		}
		case 'scenario': {
			item.label = element.scenario.name;
			item.description = element.active ? 'active' : element.scenario.taskTypeId;
			item.tooltip = `${element.scenario.id} - ${element.scenario.name} (task type ${element.scenario.taskTypeId}, difficulty base ${element.scenario.difficultyBase})`;
			item.iconPath = new api.ThemeIcon(element.active ? 'play-circle' : 'list-unordered');
			item.collapsibleState = api.TreeItemCollapsibleState.None;
			item.command = { command: SELECT_SCENARIO_COMMAND, title: 'Select Scenario', arguments: [element.scenario.id] };
			item.accessibilityInformation = { label: `Scenario ${element.scenario.name}${element.active ? ' (active)' : ''}, task type ${element.scenario.taskTypeId}. Select to make it active.` };
			break;
		}
		case 'run': {
			item.label = `Run ${element.runId}`;
			item.description = `L${element.ladderLevel} - ${element.evidenceLevel}`;
			item.tooltip = `Ladder run ${element.runId} over scenario ${element.scenarioId} at ladder level ${element.ladderLevel} (evidence: ${element.evidenceLevel}).`;
			item.iconPath = new api.ThemeIcon('beaker');
			item.collapsibleState = api.TreeItemCollapsibleState.Expanded;
			item.accessibilityInformation = { label: `Lab run ${element.runId}, ladder level ${element.ladderLevel}, evidence ${element.evidenceLevel}.` };
			break;
		}
		case 'candidate': {
			item.label = element.name;
			item.description = `utility ${element.utility.toFixed(3)} - ${element.topology}${element.baseline ? ' (baseline)' : ''}`;
			item.tooltip = `Candidate ${element.candidateId} - ${element.topology}\nutility ${element.utility.toFixed(3)}, success ${element.success.toFixed(3)}, quality ${element.quality.toFixed(3)}, latency ${element.latency.toFixed(3)} (lower better), cost ${element.cost.toFixed(3)} (lower better)${element.baseline ? '\nThe single-agent baseline.' : ''}${element.selected ? '\nSelected for comparison.' : ''}`;
			item.iconPath = new api.ThemeIcon(element.baseline ? 'circle-outline' : element.selected ? 'eye' : 'circle-filled');
			item.collapsibleState = api.TreeItemCollapsibleState.None;
			item.command = { command: SELECT_CANDIDATE_COMMAND, title: 'Inspect Candidate', arguments: [element.candidateId] };
			item.accessibilityInformation = { label: `Candidate ${element.name}, ${element.topology}, utility ${element.utility.toFixed(3)}${element.baseline ? ', the baseline' : ''}. Select to inspect and compare.` };
			break;
		}
		case 'comparison': {
			const better = element.row.delta > 0;
			item.label = `${element.row.dimension}`;
			item.description = `${element.row.candidateValue.toFixed(3)} vs ${element.row.baselineValue.toFixed(3)} (${better ? '+' : ''}${element.row.delta.toFixed(3)})`;
			item.tooltip = `Candidate ${element.row.candidateValue.toFixed(3)} vs baseline ${element.row.baselineValue.toFixed(3)} on ${element.row.dimension}; positive delta always means better.`;
			item.iconPath = new api.ThemeIcon(better ? 'arrow-up' : element.row.delta < 0 ? 'arrow-down' : 'arrow-right');
			item.collapsibleState = api.TreeItemCollapsibleState.None;
			item.accessibilityInformation = { label: `${element.row.dimension}: candidate ${element.row.candidateValue.toFixed(3)} versus baseline ${element.row.baselineValue.toFixed(3)}, delta ${element.row.delta.toFixed(3)}${better ? ', better' : element.row.delta < 0 ? ', worse' : ''}.` };
			break;
		}
		case 'savedHeader': {
			item.label = 'Saved recommendations';
			item.description = 'apply stays refused';
			item.tooltip = APPLY_REFUSAL_REASON;
			item.iconPath = new api.ThemeIcon('bookmark');
			item.collapsibleState = api.TreeItemCollapsibleState.Expanded;
			item.accessibilityInformation = { label: 'Saved recommendations. Applying stays refused: recommendations apply through Agent OS.' };
			break;
		}
		case 'saved': {
			item.label = element.recommendationId;
			item.description = `${element.candidateId} - saved ${element.createdAt}`;
			item.tooltip = `${element.recommendationId}: candidate ${element.candidateId} from run at ${element.createdAt}.\n${element.refusal}`;
			item.iconPath = new api.ThemeIcon('bookmark');
			item.collapsibleState = api.TreeItemCollapsibleState.None;
			item.accessibilityInformation = { label: `Saved recommendation ${element.recommendationId} for candidate ${element.candidateId}. ${element.refusal}` };
			break;
		}
	}
	return item;
}

/**
 * Register the `flauz.lab` tree view over a mutable state ref. The provider
 * re-reads `stateRef.current` on every getChildren; the returned `refresh`
 * fires the change event so the tree repaints (extension.ts calls it after
 * every state transition).
 */
export function registerLabView(api: LabViewApi, stateRef: { current: LabConsoleState }): { refresh(): void } {
	const emitter = new api.EventEmitter<LabTreeElement | undefined>();
	const provider: vscode.TreeDataProvider<LabTreeElement> = {
		onDidChangeTreeData: emitter.event,
		getTreeItem: (element: LabTreeElement) => treeItemFor(element, api),
		getChildren: () => treeElementsFor(stateRef.current),
	};
	api.registerTreeDataProvider(LAB_VIEW_ID, provider);
	return {
		refresh(): void {
			emitter.fire(undefined);
		},
	};
}
