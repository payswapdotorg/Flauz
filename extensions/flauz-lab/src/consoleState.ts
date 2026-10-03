/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * LAB-009 W1 console state machine - the pure, vscode-free core of the Lab
 * console. The extension renders what this module decides; every effect
 * (scenario listing, running the ladder) flows through the injected
 * LabConsolePort (src/labConsolePort.ts). Node-free by construction: no
 * imports outside this module's own shape family, so `node --test` runs it
 * under plain type stripping.
 *
 * DETERMINISM LAW: no Math.random, no clock reads; every timestamp
 * is an injected string (nowIso parameters). The same inputs always produce
 * a byte-identical result.
 *
 * THE CLOSED APPLY SEAM (DL-85 law): saving a recommendation is allowed and
 * reversible; APPLYING it through the console is refused in W1 - the refusal
 * reason is carried on every save result and shown to the user every time.
 */

/** One fixture task scenario the console can run. */
export interface LabScenarioSummary {
	/** Scenario id (resolves in the task-world catalog). */
	readonly id: string;
	/** Human-readable scenario name. */
	readonly name: string;
	/** The task type the scenario exercises. */
	readonly taskTypeId: string;
	/** Base difficulty (0..1) of the scenario's instances. */
	readonly difficultyBase: number;
}

/** One evaluated candidate organization, as shown in the view. */
export interface LabCandidateRow {
	/** Candidate id from the organization search lane. */
	readonly candidateId: string;
	/** Candidate name. */
	readonly name: string;
	/** Organization topology (single/pipeline/hierarchical/hub-and-spoke). */
	readonly topology: string;
	/** Ladder utility (higher is better). */
	readonly utility: number;
	/** Success score (0..1, higher better). */
	readonly success: number;
	/** Quality score (0..1, higher better). */
	readonly quality: number;
	/** Latency score (0..1, LOWER is better). */
	readonly latency: number;
	/** Cost score (0..1, LOWER is better). */
	readonly cost: number;
}

/** One candidate-vs-baseline comparison row; positive delta ALWAYS means better. */
export interface LabComparisonRow {
	readonly dimension: 'success' | 'quality' | 'latency' | 'cost';
	readonly candidateValue: number;
	readonly baselineValue: number;
	readonly delta: number;
}

/** The frozen outcome of one console run. */
export interface LabRunSummary {
	/** Caller-minted run id. */
	readonly runId: string;
	/** The scenario that ran. */
	readonly scenarioId: string;
	/** Ladder level executed (W1 runs the L2 robustness rung). */
	readonly ladderLevel: number;
	/** Seeds used (W1 uses the fixed pair). */
	readonly seeds: readonly number[];
	/** Evaluated candidates, ranked by the engine (utility desc). */
	readonly candidates: readonly LabCandidateRow[];
	/** Per-candidate comparison rows vs the baseline (candidates[0] is the baseline). */
	readonly comparison: readonly { candidateId: string; rows: readonly LabComparisonRow[] }[];
	/** The engine's best candidate id. */
	readonly bestCandidateId: string;
	/** Honesty label carried from the engine (fixture stays fixture). */
	readonly evidenceLevel: string;
}

/** One saved recommendation (in-session W1 persistence; reversible, auditable). */
export interface SavedRecommendation {
	/** `rec-` + 8 lowercase hex chars, deterministic in the save inputs. */
	readonly recommendationId: string;
	readonly runId: string;
	readonly candidateId: string;
	/** ISO string, injected at the save call. */
	readonly createdAt: string;
	readonly reversible: true;
	/** The apply refusal, carried verbatim on every save. */
	readonly refusalReason: string;
}

/** The result of a save call. */
export interface SaveOutcome {
	/** True iff the recommendation was saved. */
	readonly saved: boolean;
	/** Set when refused: why the console refused. */
	readonly reason?: string;
	/** The saved record when saved. */
	readonly recommendation?: SavedRecommendation;
}

/**
 * The refusal shown on EVERY save: applying routes through Agent OS via the
 * LAB-010 bridge; the console is a recommendation surface, never a second
 * execution engine.
 */
export const APPLY_REFUSAL_REASON =
	'Applying routes through Agent OS via the Lab bridge (LAB-010): the Lab console never becomes a second execution engine.';

/** The W1 console state (immutable shape; every transition returns a new state). */
export interface LabConsoleState {
	/** Scenarios from the last refresh. */
	readonly scenarios: readonly LabScenarioSummary[];
	/** The active scenario id (undefined until one is selected). */
	readonly activeScenarioId?: string;
	/** The last run summary (undefined until a run completes). */
	readonly lastRun?: LabRunSummary;
	/** The selected candidate in the view (defaults to the run's best). */
	readonly selectedCandidateId?: string;
	/** Saved recommendations, newest last. */
	readonly saved: readonly SavedRecommendation[];
	/** Observed refresh failure (the 'Unable to Load Lab' row; cleared on retry). */
	readonly error?: string;
}

/** FNV-1a 32-bit hash rendered as exactly 8 lowercase hex chars (deterministic). */
function fnv1a32hex(text: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash.toString(16).padStart(8, '0');
}

/** The initial state: scenarios from the port refresh, nothing selected, nothing run. */
export function initialConsoleState(scenarios: readonly LabScenarioSummary[]): LabConsoleState {
	return { scenarios, saved: [] };
}

/** Select the active scenario; unknown ids are refused (the state is returned unchanged). */
export function selectScenario(state: LabConsoleState, scenarioId: string): LabConsoleState {
	const known = state.scenarios.some((s) => s.id === scenarioId);
	if (!known || state.activeScenarioId === scenarioId) {
		return state;
	}
	// A new scenario invalidates the previous run's selection context.
	return { ...state, activeScenarioId: scenarioId, lastRun: undefined, selectedCandidateId: undefined };
}

/** Record an observed scenario-refresh failure (shown as the Unable to Load Lab row). */
export function failScenarioRefresh(state: LabConsoleState, message: string): LabConsoleState {
	return { ...state, error: message };
}

/** Clear the observed error (the retry path: a fresh refresh attempt begins). */
export function clearError(state: LabConsoleState): LabConsoleState {
	if (state.error === undefined) {
		return state;
	}
	const next: LabConsoleState = { ...state };
	delete (next as { error?: string }).error;
	return next;
}

/** Fold a completed run into the state; the selected candidate defaults to the run's best. */
export function applyRun(state: LabConsoleState, summary: LabRunSummary): LabConsoleState {
	if (state.activeScenarioId !== summary.scenarioId) {
		return state; // a run for a scenario that is not active is ignored
	}
	if (summary.candidates.length === 0) {
		return state;
	}
	return {
		...state,
		lastRun: summary,
		selectedCandidateId: summary.bestCandidateId,
	};
}

/** Select a candidate for inspection; unknown or runless states are refused. */
export function selectCandidate(state: LabConsoleState, candidateId: string): LabConsoleState {
	const run = state.lastRun;
	if (!run || !run.candidates.some((c) => c.candidateId === candidateId)) {
		return state;
	}
	return { ...state, selectedCandidateId: candidateId };
}

/** The comparison rows for the selected candidate (empty when nothing is selected). */
export function comparisonForSelected(state: LabConsoleState): readonly LabComparisonRow[] {
	const run = state.lastRun;
	const selected = state.selectedCandidateId;
	if (!run || !selected) {
		return [];
	}
	return run.comparison.find((c) => c.candidateId === selected)?.rows ?? [];
}

/**
 * Save the selected (or explicitly passed) candidate as a recommendation.
 * Refused when there is no run, when the candidate is unknown, or when the
 * candidate is the baseline itself (recommending the status quo is not a
 * recommendation). Every successful save carries the apply refusal verbatim.
 */
export function saveRecommendation(state: LabConsoleState, candidateId: string | undefined, nowIso: string): { state: LabConsoleState; outcome: SaveOutcome } {
	const run = state.lastRun;
	const target = candidateId ?? state.selectedCandidateId;
	if (!run || !target) {
		return { state, outcome: { saved: false, reason: 'No run and no candidate selected yet.' } };
	}
	const candidate = run.candidates.find((c) => c.candidateId === target);
	if (!candidate) {
		return { state, outcome: { saved: false, reason: `Unknown candidate: ${target}` } };
	}
	if (run.candidates[0].candidateId === target) {
		return { state, outcome: { saved: false, reason: 'The single-agent baseline is the status quo, not a recommendation.' } };
	}
	const recommendation: SavedRecommendation = {
		recommendationId: `rec-${fnv1a32hex(`${run.runId}|${target}|${nowIso}`)}`,
		runId: run.runId,
		candidateId: target,
		createdAt: nowIso,
		reversible: true,
		refusalReason: APPLY_REFUSAL_REASON,
	};
	return {
		state: { ...state, saved: [...state.saved, recommendation] },
		outcome: { saved: true, recommendation },
	};
}
