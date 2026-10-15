/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The industry task-world extension registry (DH residue wave 1 / GAP-1): the three industry
 * fixture task-worlds - finance (world-finance-fixtures), healthcare (world-healthcare-fixtures)
 * and construction (world-construction-fixtures) - for the LAB-003 fixture lane, closing gap
 * ledger row 1 ('lab-task-worlds coverage': the SE fixture world only). Each world is composed
 * exactly like the landed SE world: three scenarios per world, curated fragment banks, an
 * information boundary in the SE world's shape, named input banks, and deterministic instance
 * generation.
 *
 * THE REGISTRY-EXTENSION DISCLOSURE (binding): the landed TASK_WORLDS registry in
 * taskWorlds.ts is census-pinned to the single SE fixture world by landed batteries in two
 * families (the lab suite and the benchmarks contract suite pin TASK_WORLDS.length === 1 and
 * the exact three-scenario id list); appending to the landed array would break those landed
 * tests. The three industry worlds therefore register here, in the industry extension
 * registry (INDUSTRY_TASK_WORLDS), and the combined catalog (ALL_TASK_WORLDS) is composed by
 * import from the REAL landed registry - the SE world's authority stays the real module
 * (referential identity, never a transcription). This is an extension of the registry lane,
 * never a second authority over the landed registry: the landed registry is untouched, no
 * catalog injection exists anywhere, and the landed lookups keep resolving exactly as before.
 *
 * THE IMPORT LAW: the per-instance generation engine is the REAL LAB-003 machinery -
 * generateInstance is imported from taskWorlds.ts and driven with the industry data (the same
 * fnv1a32 sub-seed law, the same mulberry32 stream, the same composition and difficulty
 * laws); there is no second simulation engine. The industry scenario fragment banks and data
 * tables come from the three pure-data industry modules.
 *
 * THE COMPOSITION-NOT-FORK LAW: the industries differ only in data. One engine, one boundary
 * law, one difficulty law serve all four worlds (the landed SE world plus the three industry
 * worlds); a further industry is a new pure-data module plus one registry row here, never a
 * code path.
 *
 * THE EVIDENCE LAW: every industry world is labeled evidenceLevel 'fixture' - curated
 * fixture-level content, honestly labeled, never promoted by wording.
 *
 * DETERMINISM LAW: this module never calls Math.random, Date.now or `new Date()`, and never
 * reads process.env; every generated WorldInstance is a pure function of
 * (scenarioId, seed, instanceIndex) through the REAL imported engine, so the instance stream
 * is independent of the requested count and of sibling order.
 */

import { type TaskScenario, type WorldModelVersion } from './labContracts.js';
import {
	TASK_WORLDS,
	getScenario,
	getWorld,
	generateInstances,
	generateInstance,
	type ScenarioBanks,
	type TaskWorldDescriptor,
	type TaskWorldTables,
	type WorldInstance,
} from './taskWorlds.js';
import {
	FINANCE_WORLD_ID,
	FINANCE_CONTEXT_PATHS,
	FINANCE_OBSTACLE_KINDS,
	FINANCE_TASK_WORLD,
	FINANCE_SCENARIO_BANKS,
} from './financeTaskWorld.js';
import {
	HEALTHCARE_WORLD_ID,
	HEALTHCARE_CONTEXT_PATHS,
	HEALTHCARE_OBSTACLE_KINDS,
	HEALTHCARE_TASK_WORLD,
	HEALTHCARE_SCENARIO_BANKS,
} from './healthcareTaskWorld.js';
import {
	CONSTRUCTION_WORLD_ID,
	CONSTRUCTION_CONTEXT_PATHS,
	CONSTRUCTION_OBSTACLE_KINDS,
	CONSTRUCTION_TASK_WORLD,
	CONSTRUCTION_SCENARIO_BANKS,
} from './constructionTaskWorld.js';

/** The industry extension registry: exactly the three industry fixture task-worlds (finance, healthcare, construction), each a TaskWorldDescriptor composed exactly like the landed SE world. */
export const INDUSTRY_TASK_WORLDS: TaskWorldDescriptor[] = [
	FINANCE_TASK_WORLD,
	HEALTHCARE_TASK_WORLD,
	CONSTRUCTION_TASK_WORLD,
];

/** The combined task-world catalog: the REAL landed SE registry (imported, never duplicated) plus the three industry worlds - the SE entry is referentially the real registry's own descriptor. */
export const ALL_TASK_WORLDS: TaskWorldDescriptor[] = [...TASK_WORLDS, ...INDUSTRY_TASK_WORLDS];

/** The industry scenario fragment banks (the union of the three pure-data industry modules' banks). */
const INDUSTRY_SCENARIO_BANKS: ReadonlyMap<string, ScenarioBanks> = new Map<string, ScenarioBanks>([
	...FINANCE_SCENARIO_BANKS,
	...HEALTHCARE_SCENARIO_BANKS,
	...CONSTRUCTION_SCENARIO_BANKS,
]);

/** The industry worlds' fixture data tables keyed by world id (the same table shape the landed SE world records in taskWorlds.ts). */
const INDUSTRY_WORLD_TABLES: ReadonlyMap<string, TaskWorldTables> = new Map<string, TaskWorldTables>([
	[FINANCE_WORLD_ID, { contextPaths: FINANCE_CONTEXT_PATHS, obstacleKinds: FINANCE_OBSTACLE_KINDS }],
	[HEALTHCARE_WORLD_ID, { contextPaths: HEALTHCARE_CONTEXT_PATHS, obstacleKinds: HEALTHCARE_OBSTACLE_KINDS }],
	[CONSTRUCTION_WORLD_ID, { contextPaths: CONSTRUCTION_CONTEXT_PATHS, obstacleKinds: CONSTRUCTION_OBSTACLE_KINDS }],
]);

// --------------------------------------------------------------------------------------------
// Deterministic generation (the REAL engine, imported)
// --------------------------------------------------------------------------------------------

/** Deterministically generate count instances (indices 0..count-1) of an industry scenario through the REAL imported generateInstance engine; every instance is a pure function of (scenarioId, seed, instanceIndex); returns [] iff the scenarioId is not an industry scenario id or count <= 0. */
export function generateIndustryInstances(scenarioId: string, seed: number, count: number): WorldInstance[] {
	const scenario = getIndustryScenario(scenarioId);
	if (scenario === undefined || count <= 0) {
		return [];
	}
	const banks = INDUSTRY_SCENARIO_BANKS.get(scenario.id);
	const world = getIndustryWorld(scenario.worldId);
	const tables = INDUSTRY_WORLD_TABLES.get(scenario.worldId);
	if (banks === undefined || world === undefined || tables === undefined) {
		return [];
	}
	const instances: WorldInstance[] = [];
	for (let instanceIndex = 0; instanceIndex < count; instanceIndex++) {
		instances.push(generateInstance(scenario, banks, world.world.evidenceLevel, tables, seed, instanceIndex));
	}
	return instances;
}

/** Deterministically generate count instances of any registered scenario - landed SE scenarios delegate to the REAL generateInstances, industry scenarios to generateIndustryInstances (one engine, one entry point); returns [] iff the scenarioId is unknown or count <= 0. */
export function generateTaskInstances(scenarioId: string, seed: number, count: number): WorldInstance[] {
	const landed = generateInstances(scenarioId, seed, count);
	if (landed.length > 0) {
		return landed;
	}
	return generateIndustryInstances(scenarioId, seed, count);
}

// --------------------------------------------------------------------------------------------
// Pure lookups (the extension lane; every combined lookup consults the REAL module first)
// --------------------------------------------------------------------------------------------

/** Look up an industry task world by its worldId (pure). */
export function getIndustryWorld(worldId: string): TaskWorldDescriptor | undefined {
	return INDUSTRY_TASK_WORLDS.find((world) => world.world.worldId === worldId);
}

/** Look up a task world across the combined catalog - the REAL landed module's getWorld first, then the industry extension (pure; the SE resolution is referentially the real module's own). */
export function getTaskWorld(worldId: string): TaskWorldDescriptor | undefined {
	const landed = getWorld(worldId);
	return landed !== undefined ? landed : getIndustryWorld(worldId);
}

/** Look up an industry scenario by its id across the three industry worlds (pure). */
export function getIndustryScenario(scenarioId: string): TaskScenario | undefined {
	for (const world of INDUSTRY_TASK_WORLDS) {
		const scenario = world.taskScenarios.find((candidate) => candidate.id === scenarioId);
		if (scenario !== undefined) {
			return scenario;
		}
	}
	return undefined;
}

/** Look up a scenario across the combined catalog - the REAL landed module's getScenario first, then the industry extension (pure; the SE resolution is referentially the real module's own). */
export function getTaskScenario(scenarioId: string): TaskScenario | undefined {
	const landed = getScenario(scenarioId);
	return landed !== undefined ? landed : getIndustryScenario(scenarioId);
}

/** List the industry task worlds (pure; returns a fresh array). */
export function listIndustryWorlds(): TaskWorldDescriptor[] {
	return INDUSTRY_TASK_WORLDS.slice();
}

/** List all task worlds across the combined catalog (pure; returns a fresh array). */
export function listAllWorlds(): TaskWorldDescriptor[] {
	return ALL_TASK_WORLDS.slice();
}

/** Look up a WorldModelVersion by worldId across the combined catalog (pure). */
export function taskWorldModelVersion(worldId: string): WorldModelVersion | undefined {
	const world = getTaskWorld(worldId);
	return world === undefined ? undefined : world.world;
}
