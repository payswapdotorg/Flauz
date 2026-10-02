/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * LAB-009 W1 console state machine tests (node --test, plain type stripping;
 * no vscode, no node: imports, no lab-core imports - the port contract only).
 * Deterministic by construction: frozen literal fixtures + injected ISO strings.
 */

import { test } from 'node:test';
import { deepStrictEqual, ok, strictEqual } from 'node:assert';

import {
	APPLY_REFUSAL_REASON,
	type LabConsoleState,
	type LabRunSummary,
	type LabScenarioSummary,
	applyRun,
	clearError,
	comparisonForSelected,
	failScenarioRefresh,
	initialConsoleState,
	saveRecommendation,
	selectCandidate,
	selectScenario,
} from '../src/consoleState.ts';

const NOW = '2026-03-03T10:00:00.000Z';

const scenarios: LabScenarioSummary[] = [
	{ id: 'scn-bugfix', name: 'Bugfix regression', taskTypeId: 'tt-implementation-tests', difficultyBase: 0.45 },
	{ id: 'scn-feature', name: 'Feature addition', taskTypeId: 'tt-implementation-review', difficultyBase: 0.6 },
	{ id: 'scn-flaky', name: 'Flaky investigation', taskTypeId: 'tt-investigation-runtime-check', difficultyBase: 0.5 },
];

function summary(): LabRunSummary {
	return {
		runId: 'console-w1-1',
		scenarioId: 'scn-bugfix',
		ladderLevel: 2,
		seeds: [7, 11],
		candidates: [
			{ candidateId: 'cand-solo', name: 'Solo generalist', topology: 'single', utility: 0.5, success: 0.6, quality: 0.5, latency: 0.3, cost: 0.2 },
			{ candidateId: 'cand-pipe', name: 'Pipeline pair', topology: 'pipeline', utility: 0.7, success: 0.8, quality: 0.7, latency: 0.4, cost: 0.35 },
		],
		comparison: [
			{
				candidateId: 'cand-solo',
				rows: [
					{ dimension: 'success', candidateValue: 0.6, baselineValue: 0.6, delta: 0 },
					{ dimension: 'cost', candidateValue: 0.2, baselineValue: 0.2, delta: 0 },
				],
			},
			{
				candidateId: 'cand-pipe',
				rows: [
					{ dimension: 'success', candidateValue: 0.8, baselineValue: 0.6, delta: 0.2 },
					{ dimension: 'cost', candidateValue: 0.35, baselineValue: 0.2, delta: -0.15 },
				],
			},
		],
		bestCandidateId: 'cand-pipe',
		evidenceLevel: 'fixture',
	};
}

function readyState(): LabConsoleState {
	let state = initialConsoleState(scenarios);
	state = selectScenario(state, 'scn-bugfix');
	state = applyRun(state, summary());
	return state;
}

test('initial state: scenarios listed, nothing active, nothing run, nothing saved', () => {
	const state = initialConsoleState(scenarios);
	deepStrictEqual(state.scenarios, scenarios);
	strictEqual(state.activeScenarioId, undefined);
	strictEqual(state.lastRun, undefined);
	strictEqual(state.selectedCandidateId, undefined);
	deepStrictEqual(state.saved, []);
});

test('selectScenario activates a known scenario and clears the stale run context', () => {
	const state = selectScenario(readyState(), 'scn-feature');
	strictEqual(state.activeScenarioId, 'scn-feature');
	strictEqual(state.lastRun, undefined);
	strictEqual(state.selectedCandidateId, undefined);
});

test('selectScenario refuses an unknown scenario (state unchanged)', () => {
	const before = readyState();
	const after = selectScenario(before, 'scn-nope');
	deepStrictEqual(after, before);
});

test('selectScenario on the already-active scenario is a no-op', () => {
	const before = readyState();
	const after = selectScenario(before, 'scn-bugfix');
	deepStrictEqual(after, before);
});

test('applyRun folds the summary and selects the run best candidate by default', () => {
	const state = applyRun(selectScenario(initialConsoleState(scenarios), 'scn-bugfix'), summary());
	ok(state.lastRun);
	strictEqual(state.selectedCandidateId, 'cand-pipe');
});

test('applyRun refuses a summary for a scenario that is not the active one', () => {
	const before = selectScenario(initialConsoleState(scenarios), 'scn-flaky');
	const after = applyRun(before, summary());
	deepStrictEqual(after, before);
});

test('applyRun refuses a summary with no candidates', () => {
	const before = selectScenario(initialConsoleState(scenarios), 'scn-bugfix');
	const empty = { ...summary(), candidates: [] };
	const after = applyRun(before, empty as unknown as LabRunSummary);
	deepStrictEqual(after, before);
});

test('selectCandidate moves the inspection target and the comparison follows', () => {
	let state = readyState();
	strictEqual(comparisonForSelected(state).length, 2);
	state = selectCandidate(state, 'cand-solo');
	strictEqual(state.selectedCandidateId, 'cand-solo');
	const rows = comparisonForSelected(state);
	strictEqual(rows.length, 2);
	strictEqual(rows[0].delta, 0);
});

test('selectCandidate refuses an unknown candidate or a runless state', () => {
	const before = readyState();
	deepStrictEqual(selectCandidate(before, 'cand-nope'), before);
	deepStrictEqual(selectCandidate(initialConsoleState(scenarios), 'cand-pipe'), initialConsoleState(scenarios));
});

test('comparisonForSelected is empty before any selection', () => {
	deepStrictEqual(comparisonForSelected(initialConsoleState(scenarios)), []);
});

test('saveRecommendation saves the selected candidate with the refusal riding verbatim', () => {
	const { state, outcome } = saveRecommendation(readyState(), undefined, NOW);
	const rec = outcome.recommendation;
	ok(outcome.saved && rec);
	strictEqual(rec.candidateId, 'cand-pipe');
	strictEqual(rec.runId, 'console-w1-1');
	strictEqual(rec.createdAt, NOW);
	strictEqual(rec.reversible, true);
	strictEqual(rec.refusalReason, APPLY_REFUSAL_REASON);
	strictEqual(state.saved.length, 1);
	ok(/^rec-[0-9a-f]{8}$/.test(rec.recommendationId));
});

test('saveRecommendation refuses when no run and no candidate is selected', () => {
	const { outcome } = saveRecommendation(initialConsoleState(scenarios), undefined, NOW);
	strictEqual(outcome.saved, false);
	ok(outcome.reason);
});

test('saveRecommendation refuses an unknown candidate id', () => {
	const { outcome } = saveRecommendation(readyState(), 'cand-nope', NOW);
	strictEqual(outcome.saved, false);
	ok(outcome.reason?.includes('cand-nope'));
});

test('saveRecommendation refuses the baseline itself (the status quo is not a recommendation)', () => {
	const { outcome } = saveRecommendation(readyState(), 'cand-solo', NOW);
	strictEqual(outcome.saved, false);
	ok(outcome.reason?.includes('baseline'));
});

test('saveRecommendation mints deterministic ids and accumulates saves newest-last', () => {
	const first = saveRecommendation(readyState(), 'cand-pipe', NOW);
	const firstRec = first.outcome.recommendation;
	ok(firstRec);
	const second = saveRecommendation(first.state, 'cand-pipe', NOW);
	const secondRec = second.outcome.recommendation;
	ok(secondRec);
	strictEqual(secondRec.recommendationId, firstRec.recommendationId);
	strictEqual(second.state.saved.length, 2);
	const other = saveRecommendation(readyState(), 'cand-pipe', '2026-03-04T10:00:00.000Z');
	const otherRec = other.outcome.recommendation;
	ok(otherRec);
	ok(otherRec.recommendationId !== firstRec.recommendationId);
});

test('the apply refusal names the Agent OS bridge and the no-second-engine law', () => {
	ok(APPLY_REFUSAL_REASON.includes('Agent OS'));
	ok(APPLY_REFUSAL_REASON.includes('never becomes a second execution engine'));
});

test('failScenarioRefresh records the observed error and clearError clears it (the retry path)', () => {
	const clean = initialConsoleState(scenarios);
	const failed = failScenarioRefresh(clean, 'port refused');
	strictEqual(failed.error, 'port refused');
	const cleared = clearError(failed);
	strictEqual(cleared.error, undefined);
	deepStrictEqual(cleared, clean);
});

test('clearError on a clean state is a no-op', () => {
	const clean = initialConsoleState(scenarios);
	deepStrictEqual(clearError(clean), clean);
});

