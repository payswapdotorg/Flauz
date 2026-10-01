/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Unit tests for the task-world module (LAB-003), repo-standard suite/test shape. Authored
 * in the sandbox pod without the in-repo harness and without the real labContracts module,
 * so these tests are NOT executed in the pod against the real imports; the real gate is
 * run by the TL on Flauz main.
 */

import assert from 'assert';
import {
	TASK_WORLDS,
	generateInstances,
	visiblePayload,
	getWorld,
	listWorlds,
	getScenario,
	worldModelVersion,
	type WorldInstance,
} from '../../common/taskWorlds.js';

const WORLD_ID = 'world-se-fixtures';
const CONTRACT_VERSION = '1.0.0';
const RUN_SEED = 20260301;

const SCENARIO_IDS = [
	'scenario-se-bugfix-regression',
	'scenario-se-feature-addition',
	'scenario-se-flaky-investigation',
];

interface ScenarioFacts {
	taskTypeId: string;
	instanceCount: number;
	difficultyBase: number;
}

const SCENARIO_FACTS: { [id: string]: ScenarioFacts } = {
	['scenario-se-bugfix-regression']: { taskTypeId: 'tt-bugfix-regression-tests', instanceCount: 8, difficultyBase: 0.45 },
	['scenario-se-feature-addition']: { taskTypeId: 'tt-feature-addition-tests', instanceCount: 8, difficultyBase: 0.6 },
	['scenario-se-flaky-investigation']: { taskTypeId: 'tt-flaky-investigation-runtime-check', instanceCount: 6, difficultyBase: 0.5 },
};

interface SeverityEntry {
	instance: WorldInstance;
	averageSeverity: number;
}

function averageDifficulty(entries: SeverityEntry[]): number {
	return entries.reduce((sum, entry) => sum + entry.instance.difficulty, 0) / entries.length;
}

suite('taskWorlds', () => {

	test('world catalog: exactly one fixture world, pinned to contract version 1.0.0 and the lab-fixtures scope', () => {
		assert.strictEqual(TASK_WORLDS.length, 1);
		const worlds = listWorlds();
		assert.strictEqual(worlds.length, 1);
		const world = worlds[0];
		assert.ok(world);
		assert.strictEqual(world.contractVersion, CONTRACT_VERSION);
		assert.strictEqual(world.scope.workspaceId, 'lab-fixtures');
		assert.strictEqual(world.scope.tenantId, 'lab-fixtures');
		for (const scenario of world.taskScenarios) {
			assert.strictEqual(scenario.contractVersion, CONTRACT_VERSION);
			assert.strictEqual(scenario.scope.workspaceId, 'lab-fixtures');
			assert.strictEqual(scenario.scope.tenantId, 'lab-fixtures');
		}
	});

	test('world model version: worldId, version, domain, seedPolicy, evidenceLevel and provenance are recorded', () => {
		const world = listWorlds()[0];
		assert.ok(world);
		const model = world.world;
		assert.strictEqual(model.worldId, WORLD_ID);
		assert.strictEqual(model.version, '1.0.0');
		assert.strictEqual(model.domain, 'software-engineering');
		assert.strictEqual(model.seedPolicy, 'fixed');
		assert.strictEqual(model.evidenceLevel, 'fixture');
		assert.ok(typeof model.provenance === 'string' && model.provenance.length > 0);
	});

	test('information boundary: visible and withheld lists are non-empty and disjoint', () => {
		const world = listWorlds()[0];
		assert.ok(world);
		const boundary = world.informationBoundary;
		assert.ok(boundary.visibleToAgent.length > 0);
		assert.ok(boundary.withheldFromAgent.length > 0);
		for (const kind of boundary.visibleToAgent) {
			assert.strictEqual(boundary.withheldFromAgent.includes(kind), false, `visible kind '${kind}' must not also be withheld`);
		}
		assert.ok(boundary.visibleToAgent.includes('brief'));
		assert.ok(boundary.visibleToAgent.includes('contextFiles'));
		assert.ok(boundary.visibleToAgent.includes('obstacles'));
		assert.ok(boundary.withheldFromAgent.includes('acceptanceCriteria'));
		assert.ok(boundary.withheldFromAgent.includes('difficulty'));
		assert.ok(typeof boundary.notes === 'string' && boundary.notes.length > 0);
	});

	test('scenario catalog: three scenarios with unique ids that back-reference the world', () => {
		const world = listWorlds()[0];
		assert.ok(world);
		assert.strictEqual(world.taskScenarios.length, 3);
		const ids = world.taskScenarios.map((scenario) => scenario.id);
		assert.strictEqual(new Set(ids).size, 3);
		for (const scenarioId of SCENARIO_IDS) {
			assert.ok(ids.includes(scenarioId), `missing scenario id ${scenarioId}`);
		}
		for (const scenario of world.taskScenarios) {
			assert.strictEqual(scenario.worldId, WORLD_ID);
			assert.ok(scenario.name.length > 0);
			assert.ok(scenario.description.length > 0);
		}
	});

	test('scenario law: task type ids follow the tt- convention, perturbations stay within 2-4, counts and difficulty base are pinned', () => {
		const world = listWorlds()[0];
		assert.ok(world);
		for (const scenario of world.taskScenarios) {
			assert.ok(scenario.taskTypeId.startsWith('tt-'), `taskTypeId must follow the tt- convention: ${scenario.taskTypeId}`);
			const facts = SCENARIO_FACTS[scenario.id];
			assert.ok(facts, `no facts recorded for scenario ${scenario.id}`);
			assert.strictEqual(scenario.taskTypeId, facts.taskTypeId);
			assert.strictEqual(scenario.instanceCount, facts.instanceCount);
			assert.strictEqual(scenario.difficultyBase, facts.difficultyBase);
			assert.ok(scenario.perturbations.length >= 2 && scenario.perturbations.length <= 4);
			assert.strictEqual(new Set(scenario.perturbations).size, scenario.perturbations.length);
			for (const perturbation of scenario.perturbations) {
				assert.ok(perturbation.length > 0);
			}
		}
		assert.strictEqual(SCENARIO_FACTS['scenario-se-bugfix-regression']!.instanceCount, 8);
		assert.strictEqual(SCENARIO_FACTS['scenario-se-feature-addition']!.instanceCount, 8);
		assert.strictEqual(SCENARIO_FACTS['scenario-se-flaky-investigation']!.instanceCount, 6);
	});

	test('determinism: identical (scenarioId, seed, count) produces deeply identical instances', () => {
		for (const scenarioId of SCENARIO_IDS) {
			const first = generateInstances(scenarioId, RUN_SEED, 6);
			const second = generateInstances(scenarioId, RUN_SEED, 6);
			assert.strictEqual(first.length, 6);
			assert.deepStrictEqual(first, second);
		}
	});

	test('determinism: different seeds produce different briefs', () => {
		const firstBriefs = generateInstances('scenario-se-flaky-investigation', 101, 5).map((instance) => instance.brief);
		const secondBriefs = generateInstances('scenario-se-flaky-investigation', 202, 5).map((instance) => instance.brief);
		assert.strictEqual(firstBriefs.length, 5);
		assert.strictEqual(secondBriefs.length, 5);
		assert.notDeepStrictEqual(firstBriefs, secondBriefs);
	});

	test('count independence: the first 4 of 8 instances are identical to a direct run of 4', () => {
		const eight = generateInstances('scenario-se-bugfix-regression', RUN_SEED, 8);
		const four = generateInstances('scenario-se-bugfix-regression', RUN_SEED, 4);
		assert.strictEqual(eight.length, 8);
		assert.strictEqual(four.length, 4);
		assert.deepStrictEqual(eight.slice(0, 4), four);
	});

	test('count independence: instance 2 is identical whether the run count is 4 or 8', () => {
		const eight = generateInstances('scenario-se-feature-addition', RUN_SEED, 8);
		const four = generateInstances('scenario-se-feature-addition', RUN_SEED, 4);
		assert.strictEqual(eight.length, 8);
		assert.strictEqual(four.length, 4);
		const fromEight = eight[2];
		const fromFour = four[2];
		assert.ok(fromEight);
		assert.ok(fromFour);
		assert.deepStrictEqual(fromEight, fromFour);
	});

	test('generator: unknown scenario id yields the empty list', () => {
		assert.deepStrictEqual(generateInstances('scenario-does-not-exist', RUN_SEED, 8), []);
	});

	test('generator: non-positive count yields the empty list', () => {
		assert.deepStrictEqual(generateInstances('scenario-se-bugfix-regression', RUN_SEED, 0), []);
		assert.deepStrictEqual(generateInstances('scenario-se-bugfix-regression', RUN_SEED, -1), []);
		assert.deepStrictEqual(generateInstances('scenario-se-bugfix-regression', RUN_SEED, -8), []);
	});

	test('generator shape: every instance obeys the structural law', () => {
		for (const scenarioId of SCENARIO_IDS) {
			const facts = SCENARIO_FACTS[scenarioId];
			assert.ok(facts, `no facts recorded for scenario ${scenarioId}`);
			const instances = generateInstances(scenarioId, RUN_SEED, facts.instanceCount);
			assert.strictEqual(instances.length, facts.instanceCount);
			for (const instance of instances) {
				assert.strictEqual(instance.scenarioId, scenarioId);
				assert.strictEqual(instance.seed, RUN_SEED);
				assert.ok(typeof instance.brief === 'string' && instance.brief.length > 0);
				assert.ok(instance.brief.includes('Deliverable:'));
				assert.ok(instance.contextFiles.length >= 3 && instance.contextFiles.length <= 6);
				const paths = new Set<string>();
				for (const file of instance.contextFiles) {
					assert.ok(file.path.startsWith('src/') || file.path.startsWith('test/'), `unexpected repo path ${file.path}`);
					assert.ok(file.lines >= 40 && file.lines <= 900);
					assert.strictEqual(file.lines % 20, 0);
					assert.ok(file.relevance >= 0.3 && file.relevance <= 1.0);
					paths.add(file.path);
				}
				assert.strictEqual(paths.size, instance.contextFiles.length);
				assert.ok(instance.obstacles.length >= 1 && instance.obstacles.length <= 3);
				const kinds = new Set<string>();
				for (const obstacle of instance.obstacles) {
					assert.ok(typeof obstacle.kind === 'string' && obstacle.kind.length > 0);
					assert.ok(obstacle.severity >= 0.2 && obstacle.severity <= 0.9);
					kinds.add(obstacle.kind);
				}
				assert.strictEqual(kinds.size, instance.obstacles.length);
				assert.ok(instance.acceptanceCriteria.length >= 2 && instance.acceptanceCriteria.length <= 4);
				for (const criterion of instance.acceptanceCriteria) {
					assert.ok(criterion.length > 0);
				}
				assert.ok(instance.difficulty >= 0.05 && instance.difficulty <= 0.95);
				assert.strictEqual(instance.evidenceLevel, 'fixture');
			}
		}
	});

	test('difficulty law: instances in the top obstacle-severity half are harder on average than the bottom half', () => {
		const instances = generateInstances('scenario-se-bugfix-regression', RUN_SEED, 40);
		assert.strictEqual(instances.length, 40);
		const entries: SeverityEntry[] = instances.map((instance) => ({
			instance,
			averageSeverity: instance.obstacles.reduce((sum, obstacle) => sum + obstacle.severity, 0) / instance.obstacles.length,
		}));
		entries.sort((left, right) => left.averageSeverity - right.averageSeverity);
		const bottomHalf = entries.slice(0, 20);
		const topHalf = entries.slice(20, 40);
		assert.ok(averageDifficulty(topHalf) > averageDifficulty(bottomHalf), 'raising obstacle severity must raise difficulty on average');
	});

	test('boundary law: the visible payload omits withheld ground truth and keeps visible fields verbatim', () => {
		const instances = generateInstances('scenario-se-feature-addition', RUN_SEED, 5);
		assert.strictEqual(instances.length, 5);
		const instance = instances[2];
		assert.ok(instance);
		const payload = visiblePayload(instance);
		assert.strictEqual('acceptanceCriteria' in payload, false);
		assert.strictEqual('difficulty' in payload, false);
		assert.strictEqual(payload.scenarioId, instance.scenarioId);
		assert.strictEqual(payload.instanceIndex, instance.instanceIndex);
		assert.strictEqual(payload.brief, instance.brief);
		assert.deepStrictEqual(payload.contextFiles, instance.contextFiles);
		assert.deepStrictEqual(payload.obstacles, instance.obstacles);
		assert.strictEqual(payload.evidenceLevel, instance.evidenceLevel);
	});

	test('lookups: world, scenario and world-model version hits and misses', () => {
		const world = getWorld(WORLD_ID);
		assert.ok(world);
		assert.strictEqual(world.world.worldId, WORLD_ID);
		assert.strictEqual(getWorld('world-does-not-exist'), undefined);
		const scenario = getScenario('scenario-se-bugfix-regression');
		assert.ok(scenario);
		assert.strictEqual(scenario.worldId, WORLD_ID);
		assert.strictEqual(getScenario('scenario-does-not-exist'), undefined);
		const model = worldModelVersion(WORLD_ID);
		assert.ok(model);
		assert.strictEqual(model.worldId, WORLD_ID);
		assert.strictEqual(model.domain, 'software-engineering');
		assert.strictEqual(worldModelVersion('world-does-not-exist'), undefined);
	});
});
