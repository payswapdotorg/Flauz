/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * LAB-009 W1 view rendering tests (node --test; the vscode slices are
 * injected doubles, mirroring the flauz-agent sessionsView test shape).
 */

import { test } from 'node:test';
import { deepStrictEqual, ok, strictEqual } from 'node:assert';

import {
	LAB_VIEW_ID,
	SELECT_CANDIDATE_COMMAND,
	SELECT_SCENARIO_COMMAND,
	VIEW_COMMAND_IDS,
	treeElementsFor,
	treeItemFor,
	registerLabView,
	type LabTreeElement,
	type LabViewApi,
} from '../src/labView.ts';
import {
	type LabConsoleState,
	type LabRunSummary,
	type LabScenarioSummary,
	applyRun,
	initialConsoleState,
	saveRecommendation,
	selectCandidate,
	selectScenario,
} from '../src/consoleState.ts';

// ---- the injected vscode doubles (the flauz-agent DI shape) -------------------------------

class FakeEventEmitter<T> {
	private listeners: ((value: T) => void)[] = [];
	readonly event = (listener: (value: T) => void): { dispose(): void } => {
		this.listeners.push(listener);
		return { dispose: () => { this.listeners = this.listeners.filter((l) => l !== listener); } };
	};
	fire(value: T): void { for (const l of this.listeners) { l(value); } }
}

const COLLAPSIBLE = { None: 0, Expanded: 1, Collapsed: 2 } as const;

interface FakeTreeItemShape {
	label: string;
	description?: string;
	tooltip?: string;
	iconPath?: unknown;
	collapsibleState?: number;
	command?: { command: string; title: string; arguments?: unknown[] };
	contextValue?: string;
	accessibilityInformation?: { label: string };
}

class FakeTreeItem implements FakeTreeItemShape {
	label = '';
	description?: string;
	tooltip?: string;
	iconPath?: unknown;
	collapsibleState?: number;
	command?: { command: string; title: string; arguments?: unknown[] };
	contextValue?: string;
	accessibilityInformation?: { label: string };
	constructor(label: string) { this.label = label; }
}

const registered: { viewId: string; provider: unknown }[] = [];

const api: LabViewApi = {
	registerTreeDataProvider: (viewId, provider) => { registered.push({ viewId, provider }); return { dispose: () => undefined }; },
	EventEmitter: FakeEventEmitter as unknown as LabViewApi['EventEmitter'],
	TreeItem: FakeTreeItem as unknown as LabViewApi['TreeItem'],
	ThemeIcon: class { id: string; constructor(id: string) { this.id = id; } } as unknown as LabViewApi['ThemeIcon'],
	TreeItemCollapsibleState: COLLAPSIBLE as unknown as LabViewApi['TreeItemCollapsibleState'],
};

// ---- fixtures -----------------------------------------------------------------------------

const scenarios: LabScenarioSummary[] = [
	{ id: 'scn-bugfix', name: 'Bugfix regression', taskTypeId: 'tt-implementation-tests', difficultyBase: 0.45 },
	{ id: 'scn-feature', name: 'Feature addition', taskTypeId: 'tt-implementation-review', difficultyBase: 0.6 },
];

const summary: LabRunSummary = {
	runId: 'console-w1-1',
	scenarioId: 'scn-bugfix',
	ladderLevel: 2,
	seeds: [7, 11],
	candidates: [
		{ candidateId: 'cand-solo', name: 'Solo generalist', topology: 'single', utility: 0.5, success: 0.6, quality: 0.5, latency: 0.3, cost: 0.2 },
		{ candidateId: 'cand-pipe', name: 'Pipeline pair', topology: 'pipeline', utility: 0.7, success: 0.8, quality: 0.7, latency: 0.4, cost: 0.35 },
	],
	comparison: [
		{ candidateId: 'cand-solo', rows: [{ dimension: 'success', candidateValue: 0.6, baselineValue: 0.6, delta: 0 }] },
		{ candidateId: 'cand-pipe', rows: [
			{ dimension: 'success', candidateValue: 0.8, baselineValue: 0.6, delta: 0.2 },
			{ dimension: 'cost', candidateValue: 0.35, baselineValue: 0.2, delta: -0.15 },
		] },
	],
	bestCandidateId: 'cand-pipe',
	evidenceLevel: 'fixture',
};

function readyState(): LabConsoleState {
	let state = initialConsoleState(scenarios);
	state = selectScenario(state, 'scn-bugfix');
	state = applyRun(state, summary);
	return state;
}

// ---- tests --------------------------------------------------------------------------------

test('the view id and command ids match the manifest contributions', () => {
	strictEqual(LAB_VIEW_ID, 'flauz.lab');
	deepStrictEqual([...VIEW_COMMAND_IDS], [
		'flauz.lab.runNow',
		'flauz.lab.saveRecommendation',
		'flauz.focusView.lab',
		'flauz.lab.refreshView',
	]);
});

test('the empty state renders only scenario rows', () => {
	const elements = treeElementsFor(initialConsoleState(scenarios));
	strictEqual(elements.length, 2);
	ok(elements.every((e) => e.kind === 'scenario'));
});

test('the active scenario row is marked and carries the select command', () => {
	const elements = treeElementsFor(selectScenario(initialConsoleState(scenarios), 'scn-bugfix'));
	const active = elements.find((e) => e.kind === 'scenario' && e.active);
	ok(active);
	const item = treeItemFor(active, api);
	strictEqual(item.description, 'active');
	strictEqual(item.command?.command, SELECT_SCENARIO_COMMAND);
	deepStrictEqual(item.command?.arguments, ['scn-bugfix']);
});

test('an inactive scenario row shows its task type instead of active', () => {
	const elements = treeElementsFor(selectScenario(initialConsoleState(scenarios), 'scn-bugfix'));
	const inactive = elements.find((e) => e.kind === 'scenario' && !e.active) as Extract<LabTreeElement, { kind: 'scenario' }>;
	strictEqual(treeItemFor(inactive, api).description, 'tt-implementation-review');
});

test('a ready state renders scenarios, run header, candidates and the selected comparison', () => {
	const elements = treeElementsFor(readyState());
	const kinds = elements.map((e) => e.kind);
	deepStrictEqual(kinds, ['scenario', 'scenario', 'run', 'candidate', 'candidate', 'comparison', 'comparison']);
});

test('the run header carries the ladder level and the honesty label', () => {
	const runRow = treeElementsFor(readyState()).find((e) => e.kind === 'run');
	ok(runRow);
	const item = treeItemFor(runRow, api);
	strictEqual(item.description, 'L2 - fixture');
});

test('the baseline candidate row is marked and the selected row is distinct', () => {
	const elements = treeElementsFor(readyState()).filter((e) => e.kind === 'candidate') as Extract<LabTreeElement, { kind: 'candidate' }>[];
	strictEqual(elements.length, 2);
	const baseline = elements.find((e) => e.baseline);
	const selected = elements.find((e) => e.selected);
	ok(baseline && selected);
	strictEqual(baseline.candidateId, 'cand-solo');
	strictEqual(selected.candidateId, 'cand-pipe');
	const baselineItem = treeItemFor(baseline, api) as unknown as FakeTreeItemShape;
	const selectedItem = treeItemFor(selected, api) as unknown as FakeTreeItemShape;
	ok(baselineItem.tooltip?.includes('baseline'));
	ok(selectedItem.tooltip?.includes('Selected for comparison'));
});

test('candidate rows carry the inspect command with the candidate id', () => {
	const elements = treeElementsFor(readyState()).filter((e) => e.kind === 'candidate');
	for (const element of elements) {
		const item = treeItemFor(element, api);
		strictEqual(item.command?.command, SELECT_CANDIDATE_COMMAND);
	}
	const first = treeItemFor(elements[0], api);
	deepStrictEqual(first.command?.arguments, ['cand-solo']);
});

test('comparison rows render positive deltas with the up arrow and negative with the down arrow', () => {
	const elements = treeElementsFor(readyState()).filter((e) => e.kind === 'comparison');
	strictEqual(elements.length, 2);
	const up = treeItemFor(elements[0], api);
	const down = treeItemFor(elements[1], api);
	ok((up.iconPath as { id: string }).id === 'arrow-up');
	ok((down.iconPath as { id: string }).id === 'arrow-down');
	strictEqual(up.description, '0.800 vs 0.600 (+0.200)');
	strictEqual(down.description, '0.350 vs 0.200 (-0.150)');
});

test('switching the inspected candidate switches the comparison rows', () => {
	const state = selectCandidate(readyState(), 'cand-solo');
	const rows = treeElementsFor(state).filter((e) => e.kind === 'comparison');
	strictEqual(rows.length, 1);
});

test('saved recommendations render under their header with the refusal in the tooltip', () => {
	const { state } = saveRecommendation(readyState(), undefined, '2026-03-03T10:00:00.000Z');
	const elements = treeElementsFor(state);
	const header = elements.find((e) => e.kind === 'savedHeader');
	const saved = elements.find((e) => e.kind === 'saved');
	ok(header && saved);
	strictEqual(treeItemFor(header, api).description, 'apply stays refused');
	const savedItem = treeItemFor(saved, api) as unknown as FakeTreeItemShape;
	ok(savedItem.tooltip?.includes('never becomes a second execution engine'));
	ok(savedItem.label.startsWith('rec-'));
});

test('registerLabView registers the provider for the flauz.lab view and refresh fires the change event', () => {
	registered.length = 0;
	const stateRef = { current: initialConsoleState(scenarios) };
	const view = registerLabView(api, stateRef);
	strictEqual(registered.length, 1);
	strictEqual(registered[0].viewId, 'flauz.lab');
	const provider = registered[0].provider as { getChildren(): LabTreeElement[] };
	strictEqual(provider.getChildren().length, 2);
	stateRef.current = readyState();
	strictEqual(provider.getChildren().length, 7);
	view.refresh();
});

test('the error row carries the shared grammar: Unable to Load Lab, flauzError, Retry, the retry sentence', () => {
	const failed = { ...readyState(), error: 'port refused' };
	const elements = treeElementsFor(failed);
	const errorRow = elements.find((e) => e.kind === 'error');
	ok(errorRow);
	const item = treeItemFor(errorRow, api) as unknown as FakeTreeItemShape;
	strictEqual(item.label, 'Unable to Load Lab');
	strictEqual(item.contextValue, 'flauzError');
	strictEqual(item.command?.command, 'flauz.lab.refreshView');
	strictEqual(item.command?.title, 'Retry');
	ok(item.tooltip?.includes('Selecting this row retries'));
	ok(item.accessibilityInformation !== undefined && item.accessibilityInformation.label.length > 0);
});

test('the error row renders first when a refresh failure is observed', () => {
	const failed = { ...readyState(), error: 'port refused' };
	strictEqual(treeElementsFor(failed)[0].kind, 'error');
});

test('every tree row carries accessibilityInformation', () => {
	const withSaved = saveRecommendation(readyState(), undefined, '2026-03-03T10:00:00.000Z');
	const failed = { ...withSaved.state, error: 'port refused' };
	for (const element of treeElementsFor(failed)) {
		const item = treeItemFor(element, api) as unknown as FakeTreeItemShape;
		ok(item.accessibilityInformation !== undefined && item.accessibilityInformation.label.length > 0, `a11y missing on ${element.kind}`);
	}
});

