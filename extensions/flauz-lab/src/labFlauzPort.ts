/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * LAB-009 W1 runtime port binding - the ONLY cross-lane runtime edge (DL-85):
 * this file imports the deterministic lab core at build/flauz/lab/ with the
 * core's own .js specifiers, which esbuild resolves at bundle time. NO TEST
 * EVER IMPORTS THIS FILE: Node type stripping cannot resolve those .js
 * specifiers (verified station-side before the wave landed), so the test
 * lane covers the console state machine and the view rendering against the
 * port contract, while this binding is exercised by the bundle + activation
 * gates.
 *
 * The W1 run policy: the L2 robustness rung over the fixture scenario with
 * the fixed seed pair [7, 11], 4 instances per seed, the balanced utility
 * weights, and the organization search bound of 4 agents. Candidates come
 * from the organization search over the fixture body catalog (the baseline
 * single agent is always candidates[0] - the lab law).
 */

import type { LabConsolePort, LabRunSummary, LabScenarioSummary } from './labConsolePort.ts';
import { runLadder } from '../../../build/flauz/lab/common/runEngine.js';
import { listWorlds, getScenario } from '../../../build/flauz/lab/common/taskWorlds.js';
import { searchOrganizations } from '../../../build/flauz/lab/common/orgSearch.js';

/** The W1 run policy (frozen, documented): ladder level, seeds, instance count, weights. */
export const W1_LADDER_LEVEL = 2;
export const W1_SEEDS: readonly number[] = [7, 11];
export const W1_INSTANCE_COUNT = 4;
export const W1_MAX_AGENTS = 4;
export const W1_UTILITY_WEIGHTS: Record<'success' | 'quality' | 'latency' | 'cost', number> = {
	success: 0.3,
	quality: 0.3,
	latency: 0.2,
	cost: 0.2,
};

/** The fixture scope the W1 console serves. */
const SCOPE = { workspaceId: 'lab-fixtures', tenantId: 'lab-fixtures' } as const;

/** List the fixture scenarios across the world catalog. */
function fixtureScenarios(): LabScenarioSummary[] {
	const scenarios: LabScenarioSummary[] = [];
	for (const world of listWorlds()) {
		for (const scenario of world.taskScenarios) {
			scenarios.push({
				id: scenario.id,
				name: scenario.name,
				taskTypeId: scenario.taskTypeId,
				difficultyBase: scenario.difficultyBase,
			});
		}
	}
	return scenarios;
}

/** The W1 console port over the deterministic lab core. */
export const flauzLabConsolePort: LabConsolePort = {
	id: 'flauz-lab-console-fixture-v1',
	mode: 'fixture',
	async listScenarios(): Promise<LabScenarioSummary[]> {
		return fixtureScenarios();
	},
	async runScenario(scenarioId: string, runId: string, _nowIso: string): Promise<LabRunSummary | undefined> {
		const scenario = getScenario(scenarioId);
		if (!scenario) {
			return undefined;
		}
		const search = searchOrganizations({
			scope: SCOPE,
			scenarioId,
			taskTypeId: scenario.taskTypeId,
			utilityWeights: { ...W1_UTILITY_WEIGHTS },
			ladderLevel: W1_LADDER_LEVEL,
			seeds: W1_SEEDS.slice(),
			maxAgents: W1_MAX_AGENTS,
		});
		if (!search || search.candidates.length === 0) {
			return undefined;
		}
		const ladder = runLadder({
			scope: SCOPE,
			runId,
			taskScenarioId: scenarioId,
			ladderLevel: W1_LADDER_LEVEL,
			seeds: W1_SEEDS.slice(),
			instanceCount: W1_INSTANCE_COUNT,
			utilityWeights: { ...W1_UTILITY_WEIGHTS },
			candidates: search.candidates.map((scored) => scored.candidate),
		});
		if (!ladder) {
			return undefined;
		}
		// The console ranks the engine's reports by utility (desc, candidate-id
		// asc on ties); the baseline stays first-in-source and identified by the
		// view via the run's comparison rows.
		const ranked = ladder.reports
			.slice()
			.sort((a, b) => (b.utility - a.utility) || (a.candidate.id < b.candidate.id ? -1 : 1));
		const candidates = ranked.map((report) => {
			const score = (dimension: string) => report.scores.find((s) => s.dimension === dimension)?.value ?? 0;
			return {
				candidateId: report.candidate.id,
				name: report.candidate.name,
				topology: report.candidate.topology,
				utility: report.utility,
				success: score('success'),
				quality: score('quality'),
				latency: score('latency'),
				cost: score('cost'),
			};
		});
		const comparison = ladder.reports.map((report) => ({
			candidateId: report.candidate.id,
			rows: report.comparison.map((row) => ({
				dimension: row.dimension,
				candidateValue: row.candidateValue,
				baselineValue: row.baselineValue,
				delta: row.delta,
			})),
		}));
		return {
			runId,
			scenarioId,
			ladderLevel: W1_LADDER_LEVEL,
			seeds: W1_SEEDS.slice(),
			candidates,
			comparison,
			bestCandidateId: ladder.bestReport.candidate.id,
			evidenceLevel: ladder.bestReport.evidenceLevel,
		};
	},
};
