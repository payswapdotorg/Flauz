/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Unit tests for the healthcare industry task-world fixture (DH residue wave 1 / GAP-1),
 * repo-standard suite/test shape. The cross-pins import the REAL healthcare data module and
 * the REAL LAB-003 machinery through the industry extension (industryTaskWorlds.ts) - THE
 * IMPORT LAW as a test: the descriptor, the scenarios and the banks under test are the
 * module's own exported records, and generation flows through the REAL imported engine.
 */

import assert from 'assert';
import { HEALTHCARE_CONTEXT_PATHS, HEALTHCARE_OBSTACLE_KINDS, HEALTHCARE_SCENARIO_BANKS, HEALTHCARE_TASK_SCENARIOS, HEALTHCARE_TASK_WORLD, HEALTHCARE_WORLD_ID } from '../../common/healthcareTaskWorld.js';
import { generateIndustryInstances, generateTaskInstances, getIndustryScenario, getIndustryWorld } from '../../common/industryTaskWorlds.js';
import { visiblePayload } from '../../common/taskWorlds.js';
import { LAB_CONTRACTS_VERSION } from '../../common/labContracts.js';

const WORLD_ID = 'world-healthcare-fixtures';

const SCENARIO_IDS = [
	'scenario-healthcare-scheduling-integrity',
	'scenario-healthcare-record-access-audit',
	'scenario-healthcare-claim-coding-validation',
];

interface ScenarioFacts {
	taskTypeId: string;
	instanceCount: number;
	difficultyBase: number;
	perturbations: string[];
}

const SCENARIO_FACTS: { [id: string]: ScenarioFacts } = {
	['scenario-healthcare-scheduling-integrity']: { taskTypeId: 'tt-scheduling-integrity-diff-inspection', instanceCount: 8, difficultyBase: 0.5, perturbations: ['obstacle-mix', 'context-relevance', 'acceptance-count'] },
	['scenario-healthcare-record-access-audit']: { taskTypeId: 'tt-record-access-audit-review', instanceCount: 8, difficultyBase: 0.45, perturbations: ['obstacle-mix', 'brief-phrasing', 'context-relevance'] },
	['scenario-healthcare-claim-coding-validation']: { taskTypeId: 'tt-claim-coding-validation-review', instanceCount: 6, difficultyBase: 0.55, perturbations: ['obstacle-mix', 'brief-phrasing', 'context-relevance', 'acceptance-count'] },
};

const RUN_SEED = 20260301;

suite('healthcareTaskWorld', () => {

	suite('the world descriptor', () => {
		test('world model version: worldId, version, domain, seedPolicy, evidenceLevel and provenance are recorded', () => {
			const model = HEALTHCARE_TASK_WORLD.world;
			assert.strictEqual(model.worldId, WORLD_ID);
			assert.strictEqual(HEALTHCARE_WORLD_ID, WORLD_ID);
			assert.strictEqual(model.version, '1.0.0');
			assert.strictEqual(model.domain, 'healthcare');
			assert.strictEqual(model.seedPolicy, 'fixed');
			assert.strictEqual(model.evidenceLevel, 'fixture');
			assert.ok(typeof model.provenance === 'string' && model.provenance.length > 0);
		});

		test('provenance is the honest fixture-lane sentence over the synthetic healthcare-operations layout', () => {
			const provenance = HEALTHCARE_TASK_WORLD.world.provenance;
			assert.ok(provenance.startsWith('Fixture lane:'));
			assert.ok(provenance.includes('hand-authored fragment banks'));
			assert.ok(provenance.includes('synthetic healthcare-operations layout'));
			assert.ok(provenance.includes('no real telemetry, no real patient data'));
			for (const rung of ['simulated', 'local-real', 'runtime-real', 'live-provider', 'production-real']) {
				assert.strictEqual(provenance.includes(rung), false, `provenance must not claim the ${rung} rung`);
			}
		});

		test('the world pins the lab-contracts version and the lab-fixtures scope, as does every scenario', () => {
			assert.strictEqual(HEALTHCARE_TASK_WORLD.contractVersion, LAB_CONTRACTS_VERSION);
			assert.strictEqual(HEALTHCARE_TASK_WORLD.scope.workspaceId, 'lab-fixtures');
			assert.strictEqual(HEALTHCARE_TASK_WORLD.scope.tenantId, 'lab-fixtures');
			for (const scenario of HEALTHCARE_TASK_WORLD.taskScenarios) {
				assert.strictEqual(scenario.contractVersion, LAB_CONTRACTS_VERSION);
				assert.strictEqual(scenario.scope.workspaceId, 'lab-fixtures');
				assert.strictEqual(scenario.scope.tenantId, 'lab-fixtures');
			}
		});

		test('the information boundary is the SE world\'s shape: brief/contextFiles/obstacles/evidenceLevel visible, acceptanceCriteria/difficulty withheld', () => {
			const boundary = HEALTHCARE_TASK_WORLD.informationBoundary;
			assert.deepStrictEqual(boundary.visibleToAgent, ['brief', 'contextFiles', 'obstacles', 'evidenceLevel']);
			assert.deepStrictEqual(boundary.withheldFromAgent, ['acceptanceCriteria', 'difficulty']);
			for (const kind of boundary.visibleToAgent) {
				assert.strictEqual(boundary.withheldFromAgent.includes(kind), false);
			}
			assert.ok(boundary.notes.length > 0);
		});

		test('the named input banks are exactly the four healthcare banks', () => {
			assert.deepStrictEqual(HEALTHCARE_TASK_WORLD.inputs, [
				'bank-healthcare-brief-fragments',
				'bank-healthcare-context-layout',
				'bank-healthcare-obstacle-kind-table',
				'bank-healthcare-acceptance-criteria',
			]);
		});
	});

	suite('the scenario catalog', () => {
		test('exactly three scenarios with the pinned ids in order, back-referencing the healthcare world', () => {
			assert.strictEqual(HEALTHCARE_TASK_WORLD.taskScenarios.length, 3);
			assert.deepStrictEqual(HEALTHCARE_TASK_WORLD.taskScenarios.map((scenario) => scenario.id), SCENARIO_IDS);
			assert.deepStrictEqual(HEALTHCARE_TASK_SCENARIOS.map((scenario) => scenario.id), SCENARIO_IDS);
			for (const scenario of HEALTHCARE_TASK_WORLD.taskScenarios) {
				assert.strictEqual(scenario.worldId, WORLD_ID);
			}
		});

		test('the descriptor\'s scenarios are referentially the exported scenario records', () => {
			for (let index = 0; index < HEALTHCARE_TASK_SCENARIOS.length; index++) {
				assert.strictEqual(HEALTHCARE_TASK_WORLD.taskScenarios[index] === HEALTHCARE_TASK_SCENARIOS[index], true);
			}
		});

		test('scenario law: task type ids, instance counts, difficulty bases and perturbations are pinned', () => {
			for (const scenario of HEALTHCARE_TASK_WORLD.taskScenarios) {
				const facts = SCENARIO_FACTS[scenario.id];
				assert.ok(facts, `no facts recorded for scenario ${scenario.id}`);
				assert.ok(scenario.taskTypeId.startsWith('tt-'));
				assert.strictEqual(scenario.taskTypeId, facts.taskTypeId);
				assert.strictEqual(scenario.instanceCount, facts.instanceCount);
				assert.strictEqual(scenario.difficultyBase, facts.difficultyBase);
				assert.deepStrictEqual(scenario.perturbations, facts.perturbations);
				assert.strictEqual(new Set(scenario.perturbations).size, scenario.perturbations.length);
			}
			assert.strictEqual(SCENARIO_FACTS['scenario-healthcare-scheduling-integrity']!.instanceCount, 8);
			assert.strictEqual(SCENARIO_FACTS['scenario-healthcare-record-access-audit']!.instanceCount, 8);
			assert.strictEqual(SCENARIO_FACTS['scenario-healthcare-claim-coding-validation']!.instanceCount, 6);
		});

		test('names carry the Healthcare fixture marker and descriptions are non-empty', () => {
			for (const scenario of HEALTHCARE_TASK_WORLD.taskScenarios) {
				assert.ok(scenario.name.startsWith('Healthcare fixture:'), `name must carry the marker: ${scenario.name}`);
				assert.ok(scenario.description.length > 20);
			}
		});

		test('the healthcare scenarios resolve through the industry lookups', () => {
			const world = getIndustryWorld(WORLD_ID);
			assert.ok(world);
			assert.strictEqual(world.world.worldId, WORLD_ID);
			for (const scenarioId of SCENARIO_IDS) {
				const scenario = getIndustryScenario(scenarioId);
				assert.ok(scenario);
				assert.strictEqual(scenario.worldId, WORLD_ID);
			}
		});
	});

	suite('the fixture tables', () => {
		test('the context layout is exactly 24 unique healthcare paths with known fixture extensions', () => {
			assert.strictEqual(HEALTHCARE_CONTEXT_PATHS.length, 24);
			assert.strictEqual(new Set(HEALTHCARE_CONTEXT_PATHS).size, 24);
			for (const path of HEALTHCARE_CONTEXT_PATHS) {
				assert.ok(path.startsWith('healthcare/'), `path ${path} must sit under healthcare/`);
				assert.ok(/\.(csv|json|yaml|sql)$/.test(path), `path ${path} must carry a known fixture extension`);
				assert.ok(path.length > 'healthcare/x/x.'.length);
			}
		});

		test('the context layout covers the healthcare subsystem families the scenarios draw from', () => {
			const families = new Set(HEALTHCARE_CONTEXT_PATHS.map((path) => path.split('/')[1]));
			assert.deepStrictEqual([...families].sort(), ['audit', 'billing', 'claims', 'interoperability', 'quality', 'records', 'scheduling']);
		});

		test('the obstacle table is exactly 8 unique kebab-case healthcare obstacle kinds', () => {
			assert.strictEqual(HEALTHCARE_OBSTACLE_KINDS.length, 8);
			assert.strictEqual(new Set(HEALTHCARE_OBSTACLE_KINDS).size, 8);
			for (const kind of HEALTHCARE_OBSTACLE_KINDS) {
				assert.ok(/^[a-z]+(-[a-z]+)*$/.test(kind), `kind ${kind} must be kebab-case`);
			}
		});
	});

	suite('the fragment banks', () => {
		test('bank keys are exactly the three healthcare scenario ids', () => {
			assert.strictEqual(HEALTHCARE_SCENARIO_BANKS.size, 3);
			assert.deepStrictEqual([...HEALTHCARE_SCENARIO_BANKS.keys()], SCENARIO_IDS);
		});

		test('every scenario carries 5 openers, 6 evidence fragments, 5 constraints, 5 deliverables and 5 acceptance criteria', () => {
			for (const scenarioId of SCENARIO_IDS) {
				const banks = HEALTHCARE_SCENARIO_BANKS.get(scenarioId);
				assert.ok(banks, `missing banks for ${scenarioId}`);
				assert.strictEqual(banks.openers.length, 5);
				assert.strictEqual(banks.evidenceFragments.length, 6);
				assert.strictEqual(banks.constraints.length, 5);
				assert.strictEqual(banks.deliverables.length, 5);
				assert.strictEqual(banks.acceptanceCriteria.length, 5);
				assert.strictEqual(new Set(banks.openers).size, 5);
				assert.strictEqual(new Set(banks.evidenceFragments).size, 6);
				assert.strictEqual(new Set(banks.constraints).size, 5);
				assert.strictEqual(new Set(banks.deliverables).size, 5);
				assert.strictEqual(new Set(banks.acceptanceCriteria).size, 5);
			}
		});

		test('constraints open with Constraint:, deliverables with Deliverable:, evidence fragments with Symptom: or Signal:', () => {
			for (const scenarioId of SCENARIO_IDS) {
				const banks = HEALTHCARE_SCENARIO_BANKS.get(scenarioId);
				assert.ok(banks);
				for (const constraint of banks.constraints) {
					assert.ok(constraint.startsWith('Constraint:'), `constraint must carry the marker: ${constraint.slice(0, 40)}`);
				}
				for (const deliverable of banks.deliverables) {
					assert.ok(deliverable.startsWith('Deliverable:'), `deliverable must carry the marker: ${deliverable.slice(0, 40)}`);
				}
				for (const evidence of banks.evidenceFragments) {
					assert.ok(evidence.startsWith('Symptom:') || evidence.startsWith('Signal:'), `evidence fragment must carry a symptom/signal marker: ${evidence.slice(0, 40)}`);
				}
			}
		});
	});

	suite('generation through the REAL engine', () => {
		test('determinism: identical (scenarioId, seed, count) produces deeply identical instances', () => {
			for (const scenarioId of SCENARIO_IDS) {
				const first = generateIndustryInstances(scenarioId, RUN_SEED, 6);
				const second = generateIndustryInstances(scenarioId, RUN_SEED, 6);
				assert.strictEqual(first.length, 6);
				assert.deepStrictEqual(first, second);
			}
		});

		test('determinism: different seeds produce different briefs', () => {
			const firstBriefs = generateIndustryInstances('scenario-healthcare-record-access-audit', 101, 5).map((instance) => instance.brief);
			const secondBriefs = generateIndustryInstances('scenario-healthcare-record-access-audit', 202, 5).map((instance) => instance.brief);
			assert.strictEqual(firstBriefs.length, 5);
			assert.notDeepStrictEqual(firstBriefs, secondBriefs);
		});

		test('count independence: the first 4 of 8 instances are identical to a direct run of 4', () => {
			const eight = generateIndustryInstances('scenario-healthcare-scheduling-integrity', RUN_SEED, 8);
			const four = generateIndustryInstances('scenario-healthcare-scheduling-integrity', RUN_SEED, 4);
			assert.strictEqual(eight.length, 8);
			assert.strictEqual(four.length, 4);
			assert.deepStrictEqual(eight.slice(0, 4), four);
		});

		test('generator shape: every instance obeys the structural law over the healthcare tables', () => {
			for (const scenarioId of SCENARIO_IDS) {
				const facts = SCENARIO_FACTS[scenarioId]!;
				const instances = generateIndustryInstances(scenarioId, RUN_SEED, facts.instanceCount);
				assert.strictEqual(instances.length, facts.instanceCount);
				for (const instance of instances) {
					assert.strictEqual(instance.scenarioId, scenarioId);
					assert.strictEqual(instance.seed, RUN_SEED);
					assert.ok(instance.brief.includes('Deliverable:'));
					assert.ok(instance.contextFiles.length >= 3 && instance.contextFiles.length <= 6);
					for (const file of instance.contextFiles) {
						assert.ok(HEALTHCARE_CONTEXT_PATHS.includes(file.path), `unexpected healthcare path ${file.path}`);
						assert.ok(file.lines >= 40 && file.lines <= 900);
						assert.strictEqual(file.lines % 20, 0);
						assert.ok(file.relevance >= 0.3 && file.relevance <= 1.0);
					}
					assert.strictEqual(new Set(instance.contextFiles.map((file) => file.path)).size, instance.contextFiles.length);
					assert.ok(instance.obstacles.length >= 1 && instance.obstacles.length <= 3);
					for (const obstacle of instance.obstacles) {
						assert.ok(HEALTHCARE_OBSTACLE_KINDS.includes(obstacle.kind), `unexpected healthcare obstacle kind ${obstacle.kind}`);
						assert.ok(obstacle.severity >= 0.2 && obstacle.severity <= 0.9);
					}
					assert.ok(instance.acceptanceCriteria.length >= 2 && instance.acceptanceCriteria.length <= 4);
					assert.ok(instance.difficulty >= 0.05 && instance.difficulty <= 0.95);
					assert.strictEqual(instance.evidenceLevel, 'fixture');
				}
			}
		});

		test('briefs draw only from this world\'s own scenario banks', () => {
			for (const scenarioId of SCENARIO_IDS) {
				const banks = HEALTHCARE_SCENARIO_BANKS.get(scenarioId)!;
				for (const instance of generateIndustryInstances(scenarioId, RUN_SEED, 8)) {
					assert.ok(banks.openers.some((fragment) => instance.brief.startsWith(fragment)));
					assert.ok(banks.deliverables.some((fragment) => instance.brief.endsWith(fragment)));
					assert.ok(banks.constraints.some((fragment) => instance.brief.includes(fragment)));
				}
			}
		});

		test('generateTaskInstances carries the healthcare scenarios through the same engine and stream', () => {
			for (const scenarioId of SCENARIO_IDS) {
				assert.deepStrictEqual(generateTaskInstances(scenarioId, RUN_SEED, 6), generateIndustryInstances(scenarioId, RUN_SEED, 6));
			}
		});

		test('boundary law: the visible payload omits the withheld ground truth and keeps the visible fields verbatim', () => {
			const instances = generateIndustryInstances('scenario-healthcare-record-access-audit', RUN_SEED, 5);
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
			assert.strictEqual(payload.evidenceLevel, 'fixture');
		});

		test('difficulty law: instances in the top obstacle-severity half are harder on average than the bottom half', () => {
			const instances = generateIndustryInstances('scenario-healthcare-scheduling-integrity', RUN_SEED, 40);
			assert.strictEqual(instances.length, 40);
			const entries = instances.map((instance) => ({
				instance,
				average: instance.obstacles.reduce((sum, obstacle) => sum + obstacle.severity, 0) / instance.obstacles.length,
			}));
			entries.sort((left, right) => left.average - right.average);
			const bottomHalf = entries.slice(0, 20);
			const topHalf = entries.slice(20, 40);
			const mean = (list: typeof entries): number => list.reduce((sum, entry) => sum + entry.instance.difficulty, 0) / list.length;
			assert.ok(mean(topHalf) > mean(bottomHalf), 'raising obstacle severity must raise difficulty on average');
		});
	});
});
