/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Unit tests for the industry task-world extension (DH residue wave 1 / GAP-1), repo-standard
 * suite/test shape. The cross-pins import the REAL LAB-003 module (taskWorlds.ts) and the REAL
 * labContracts module and pin referential identity - THE IMPORT LAW as a test: the combined
 * catalog's SE entry IS the landed registry's own descriptor, and SE-scenario generation
 * through the combined entry point is byte-identical to the REAL generateInstances output.
 * The in-suite determinism greps pin the new modules to law-comment lines only (the
 * banned-global patterns are assembled piecewise so this test source itself stays grep-clean).
 */

import assert from 'assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TASK_WORLDS, generateInstances, getScenario, getWorld, listWorlds, visiblePayload, type ScenarioBanks, type WorldInstance } from '../../common/taskWorlds.js';
import {
	ALL_TASK_WORLDS,
	INDUSTRY_TASK_WORLDS,
	generateIndustryInstances,
	generateTaskInstances,
	getIndustryScenario,
	getIndustryWorld,
	getTaskScenario,
	getTaskWorld,
	listAllWorlds,
	listIndustryWorlds,
	taskWorldModelVersion,
} from '../../common/industryTaskWorlds.js';
import { FINANCE_CONTEXT_PATHS, FINANCE_OBSTACLE_KINDS, FINANCE_SCENARIO_BANKS } from '../../common/financeTaskWorld.js';
import { HEALTHCARE_CONTEXT_PATHS, HEALTHCARE_OBSTACLE_KINDS, HEALTHCARE_SCENARIO_BANKS } from '../../common/healthcareTaskWorld.js';
import { CONSTRUCTION_CONTEXT_PATHS, CONSTRUCTION_OBSTACLE_KINDS, CONSTRUCTION_SCENARIO_BANKS } from '../../common/constructionTaskWorld.js';
import { LAB_CONTRACTS_VERSION, type TaskScenario } from '../../common/labContracts.js';

const RUN_SEED = 20260301;

const INDUSTRY_WORLD_IDS = [
	'world-finance-fixtures',
	'world-healthcare-fixtures',
	'world-construction-fixtures',
];

const INDUSTRY_DOMAINS: { [worldId: string]: string } = {
	['world-finance-fixtures']: 'finance',
	['world-healthcare-fixtures']: 'healthcare',
	['world-construction-fixtures']: 'construction',
};

const SE_SCENARIO_IDS = [
	'scenario-se-bugfix-regression',
	'scenario-se-feature-addition',
	'scenario-se-flaky-investigation',
];

const INDUSTRY_SCENARIO_IDS = [
	'scenario-finance-reconciliation-discrepancy',
	'scenario-finance-regulatory-report-validation',
	'scenario-finance-payment-failure-triage',
	'scenario-healthcare-scheduling-integrity',
	'scenario-healthcare-record-access-audit',
	'scenario-healthcare-claim-coding-validation',
	'scenario-construction-submittal-coordination',
	'scenario-construction-schedule-impact-analysis',
	'scenario-construction-inspection-finding-closure',
];

const INDUSTRY_WORLD_TABLES: { [worldId: string]: { contextPaths: readonly string[]; obstacleKinds: readonly string[]; banks: ReadonlyMap<string, ScenarioBanks> } } = {
	['world-finance-fixtures']: { contextPaths: FINANCE_CONTEXT_PATHS, obstacleKinds: FINANCE_OBSTACLE_KINDS, banks: FINANCE_SCENARIO_BANKS },
	['world-healthcare-fixtures']: { contextPaths: HEALTHCARE_CONTEXT_PATHS, obstacleKinds: HEALTHCARE_OBSTACLE_KINDS, banks: HEALTHCARE_SCENARIO_BANKS },
	['world-construction-fixtures']: { contextPaths: CONSTRUCTION_CONTEXT_PATHS, obstacleKinds: CONSTRUCTION_OBSTACLE_KINDS, banks: CONSTRUCTION_SCENARIO_BANKS },
};

const LANDED_PERTURBATION_VOCABULARY = ['obstacle-mix', 'context-relevance', 'acceptance-count', 'brief-phrasing'];

const EVIDENCE_RUNGS_ABOVE_FIXTURE = ['simulated', 'local-real', 'runtime-real', 'live-provider', 'production-real'];

/** Piecewise-assembled so this test source itself stays grep-clean (the family convention). */
const BANNED_GLOBAL_PATTERNS = ['Date' + '.now', 'new ' + 'Date', 'Math' + '.random', 'process' + '.env'];

/** In-suite determinism grep: every hit must be a law-comment line (the ban is quoted, never called). */
function determinismGrepHits(relativeModulePath: string): string[] {
	const modulePath = fileURLToPath(new URL(relativeModulePath, import.meta.url));
	const source = readFileSync(modulePath, 'utf8');
	return source.split('\n').filter((line) => BANNED_GLOBAL_PATTERNS.some((banned) => line.includes(banned)));
}

/** Every industry scenario's full bank set, keyed by scenario id. */
function banksOf(scenarioId: string): ScenarioBanks {
	const worldId = INDUSTRY_SCENARIO_IDS.includes(scenarioId) ? industryWorldIdOf(scenarioId) : '';
	const entry = INDUSTRY_WORLD_TABLES[worldId];
	assert.ok(entry, `no world tables recorded for the scenario ${scenarioId}`);
	const banks = entry.banks.get(scenarioId);
	assert.ok(banks, `no banks recorded for the scenario ${scenarioId}`);
	return banks;
}

/** The owning industry world id of an industry scenario id (prefix law). */
function industryWorldIdOf(scenarioId: string): string {
	const domain = scenarioId.split('-')[1] ?? '';
	const worldId = `world-${domain}-fixtures`;
	assert.ok(INDUSTRY_WORLD_IDS.includes(worldId), `scenario id ${scenarioId} does not follow the scenario-<industry>- convention`);
	return worldId;
}

/** Reconstruct the brief's composition from its own banks and assert the composition law. */
function assertBriefComposition(scenarioId: string, brief: string): void {
	const banks = banksOf(scenarioId);
	const openerHits = banks.openers.filter((fragment) => brief.startsWith(fragment));
	assert.strictEqual(openerHits.length, 1, `the brief must open with exactly one opener (found ${openerHits.length}): ${brief.slice(0, 80)}`);
	const opener = openerHits[0]!;
	const deliverableHits = banks.deliverables.filter((fragment) => brief.endsWith(fragment));
	assert.strictEqual(deliverableHits.length, 1, 'the brief must end with exactly one deliverable');
	const deliverable = deliverableHits[0]!;
	const evidenceHits = banks.evidenceFragments.filter((fragment) => brief.includes(fragment));
	assert.ok(evidenceHits.length >= 1 && evidenceHits.length <= 2, `the brief must carry 1-2 evidence fragments (found ${evidenceHits.length})`);
	const constraintHits = banks.constraints.filter((fragment) => brief.includes(fragment));
	assert.strictEqual(constraintHits.length, 1, 'the brief must carry exactly one constraint');
	const constraint = constraintHits[0]!;
	const constraintAt = brief.indexOf(constraint);
	assert.ok(constraintAt > opener.length, 'the constraint must follow the opener');
	assert.ok(brief.indexOf(deliverable) > constraintAt, 'the deliverable must follow the constraint');
	for (const evidence of evidenceHits) {
		const evidenceAt = brief.indexOf(evidence);
		assert.ok(evidenceAt > opener.length && evidenceAt < constraintAt, 'each evidence fragment must sit between the opener and the constraint');
	}
}

/** Assert the criteria are a 2-4 entry subsequence of the scenario's criterion bank, in canonical bank order. */
function assertCanonicalCriteria(scenarioId: string, criteria: string[]): void {
	const banks = banksOf(scenarioId);
	assert.ok(criteria.length >= 2 && criteria.length <= 4, `acceptance criteria count must be 2-4 (found ${criteria.length})`);
	let cursor = 0;
	for (const criterion of criteria) {
		const found = banks.acceptanceCriteria.indexOf(criterion, cursor);
		assert.ok(found >= 0, `criterion is not a member of the scenario's bank in canonical order: ${criterion}`);
		cursor = found + 1;
	}
}

/** Average obstacle severity of an instance (0 when obstacle-free, mirroring the engine). */
function averageSeverity(instance: WorldInstance): number {
	if (instance.obstacles.length === 0) {
		return 0;
	}
	return instance.obstacles.reduce((sum, obstacle) => sum + obstacle.severity, 0) / instance.obstacles.length;
}

suite('industryTaskWorlds', () => {

	suite('the registry-extension law', () => {
		test('the landed TASK_WORLDS registry stays census-pinned at exactly one SE world (the landed batteries\' frozen state is untouched by this extension)', () => {
			assert.strictEqual(TASK_WORLDS.length, 1);
			assert.strictEqual(TASK_WORLDS[0]?.world.worldId, 'world-se-fixtures');
			assert.strictEqual(listWorlds().length, 1);
			assert.deepStrictEqual(listWorlds()[0]?.taskScenarios.map((scenario) => scenario.id), SE_SCENARIO_IDS);
		});

		test('INDUSTRY_TASK_WORLDS carries exactly the three industry worlds in the pinned order', () => {
			assert.strictEqual(INDUSTRY_TASK_WORLDS.length, 3);
			assert.deepStrictEqual(INDUSTRY_TASK_WORLDS.map((world) => world.world.worldId), INDUSTRY_WORLD_IDS);
		});

		test('ALL_TASK_WORLDS is the composed catalog: the REAL imported SE registry first, then the three industry worlds', () => {
			assert.strictEqual(ALL_TASK_WORLDS.length, 4);
			assert.deepStrictEqual(ALL_TASK_WORLDS.map((world) => world.world.worldId), ['world-se-fixtures', ...INDUSTRY_WORLD_IDS]);
			assert.strictEqual(ALL_TASK_WORLDS[0] === TASK_WORLDS[0], true, 'the SE entry must be referentially the landed registry\'s own descriptor (imported, never duplicated)');
		});

		test('listIndustryWorlds and listAllWorlds return fresh arrays that mirror their catalogs', () => {
			const industryList = listIndustryWorlds();
			assert.deepStrictEqual(industryList, INDUSTRY_TASK_WORLDS);
			assert.notStrictEqual(industryList, INDUSTRY_TASK_WORLDS);
			industryList.pop();
			assert.strictEqual(INDUSTRY_TASK_WORLDS.length, 3, 'mutating the returned array must not affect the registry');
			const allList = listAllWorlds();
			assert.deepStrictEqual(allList, ALL_TASK_WORLDS);
			assert.notStrictEqual(allList, ALL_TASK_WORLDS);
			allList.pop();
			assert.strictEqual(ALL_TASK_WORLDS.length, 4);
		});

		test('every industry world pins the lab-contracts version and the lab-fixtures scope on the world and on every scenario', () => {
			for (const world of INDUSTRY_TASK_WORLDS) {
				assert.strictEqual(world.contractVersion, LAB_CONTRACTS_VERSION);
				assert.strictEqual(world.scope.workspaceId, 'lab-fixtures');
				assert.strictEqual(world.scope.tenantId, 'lab-fixtures');
				for (const scenario of world.taskScenarios) {
					assert.strictEqual(scenario.contractVersion, LAB_CONTRACTS_VERSION);
					assert.strictEqual(scenario.scope.workspaceId, 'lab-fixtures');
					assert.strictEqual(scenario.scope.tenantId, 'lab-fixtures');
				}
			}
		});

		test('every industry world records seedPolicy fixed and evidenceLevel fixture - never promoted', () => {
			for (const world of INDUSTRY_TASK_WORLDS) {
				assert.strictEqual(world.world.seedPolicy, 'fixed');
				assert.strictEqual(world.world.evidenceLevel, 'fixture');
			}
		});

		test('every industry world\'s provenance is the honest fixture-lane sentence in the SE world\'s style', () => {
			for (const world of INDUSTRY_TASK_WORLDS) {
				const provenance = world.world.provenance;
				assert.ok(provenance.startsWith('Fixture lane:'), `provenance must open with the fixture-lane marker: ${provenance.slice(0, 40)}`);
				assert.ok(provenance.includes('synthetic'), 'provenance must name the synthetic layout');
				assert.ok(provenance.includes('no real'), 'provenance must carry the no-real-data disclosure');
				for (const rung of EVIDENCE_RUNGS_ABOVE_FIXTURE) {
					assert.strictEqual(provenance.includes(rung), false, `provenance must not claim the ${rung} rung`);
				}
			}
		});

		test('the information boundary split: brief/context/obstacles/evidenceLevel visible, acceptanceCriteria/difficulty withheld, disjoint, with a non-empty note', () => {
			for (const world of INDUSTRY_TASK_WORLDS) {
				const boundary = world.informationBoundary;
				assert.deepStrictEqual(boundary.visibleToAgent, ['brief', 'contextFiles', 'obstacles', 'evidenceLevel']);
				assert.deepStrictEqual(boundary.withheldFromAgent, ['acceptanceCriteria', 'difficulty']);
				for (const kind of boundary.visibleToAgent) {
					assert.strictEqual(boundary.withheldFromAgent.includes(kind), false, `visible kind '${kind}' must not also be withheld`);
				}
				assert.ok(typeof boundary.notes === 'string' && boundary.notes.length > 0);
			}
		});

		test('the named input banks: four per industry world, prefixed bank-<industry>-, unique across the whole combined catalog', () => {
			const seenBanks: string[] = [];
			for (const world of ALL_TASK_WORLDS) {
				const domain = world.world.domain;
				const lanePrefix = domain === 'software-engineering' ? 'bank-se-' : `bank-${domain}-`;
				assert.strictEqual(world.inputs.length, 4, `world ${world.world.worldId} must name four input banks`);
				for (const bank of world.inputs) {
					assert.ok(bank.startsWith(lanePrefix), `bank '${bank}' must be prefixed ${lanePrefix}`);
					assert.strictEqual(seenBanks.includes(bank), false, `duplicate bank name across the catalog: ${bank}`);
					seenBanks.push(bank);
				}
			}
			assert.strictEqual(seenBanks.length, 16);
		});
	});

	suite('the scenario catalog', () => {
		test('nine industry scenarios across the three worlds, three per world, with unique ids', () => {
			for (const world of INDUSTRY_TASK_WORLDS) {
				assert.strictEqual(world.taskScenarios.length, 3, `world ${world.world.worldId} must carry three scenarios`);
			}
			const ids = INDUSTRY_TASK_WORLDS.flatMap((world) => world.taskScenarios.map((scenario) => scenario.id));
			assert.strictEqual(ids.length, 9);
			assert.strictEqual(new Set(ids).size, 9);
			for (const scenarioId of INDUSTRY_SCENARIO_IDS) {
				assert.ok(ids.includes(scenarioId), `missing industry scenario id ${scenarioId}`);
			}
		});

		test('scenario ids follow the scenario-<industry>- convention and never collide with the landed SE ids', () => {
			for (const scenarioId of INDUSTRY_SCENARIO_IDS) {
				assert.ok(scenarioId.startsWith('scenario-'));
				const domain = scenarioId.split('-')[1] ?? '';
				assert.ok(['finance', 'healthcare', 'construction'].includes(domain), `scenario id ${scenarioId} must name its industry`);
				assert.strictEqual(SE_SCENARIO_IDS.includes(scenarioId), false);
			}
			for (const seId of SE_SCENARIO_IDS) {
				assert.strictEqual(INDUSTRY_SCENARIO_IDS.includes(seId), false);
			}
		});

		test('every industry scenario back-references its owning world id', () => {
			for (const world of INDUSTRY_TASK_WORLDS) {
				for (const scenario of world.taskScenarios) {
					assert.strictEqual(scenario.worldId, world.world.worldId);
				}
			}
		});

		test('task type ids follow the tt- convention and are unique across the nine industry scenarios', () => {
			const taskTypeIds = INDUSTRY_TASK_WORLDS.flatMap((world) => world.taskScenarios.map((scenario) => scenario.taskTypeId));
			assert.strictEqual(taskTypeIds.length, 9);
			assert.strictEqual(new Set(taskTypeIds).size, 9);
			for (const taskTypeId of taskTypeIds) {
				assert.ok(taskTypeId.startsWith('tt-'), `taskTypeId must follow the tt- convention: ${taskTypeId}`);
			}
		});

		test('perturbations stay within 2-4, are unique members, and draw from the landed perturbation vocabulary', () => {
			for (const world of INDUSTRY_TASK_WORLDS) {
				for (const scenario of world.taskScenarios) {
					assert.ok(scenario.perturbations.length >= 2 && scenario.perturbations.length <= 4);
					assert.strictEqual(new Set(scenario.perturbations).size, scenario.perturbations.length);
					for (const perturbation of scenario.perturbations) {
						assert.ok(LANDED_PERTURBATION_VOCABULARY.includes(perturbation), `perturbation '${perturbation}' is outside the landed vocabulary`);
					}
				}
			}
		});

		test('instanceCount and difficultyBase are pinned per scenario in the 6..8 / 0..1 bands', () => {
			const facts: { [scenarioId: string]: { instanceCount: number; difficultyBase: number } } = {};
			for (const world of INDUSTRY_TASK_WORLDS) {
				for (const scenario of world.taskScenarios) {
					facts[scenario.id] = { instanceCount: scenario.instanceCount, difficultyBase: scenario.difficultyBase };
				}
			}
			for (const scenarioId of INDUSTRY_SCENARIO_IDS) {
				const entry = facts[scenarioId];
				assert.ok(entry, `no facts recorded for scenario ${scenarioId}`);
				assert.ok(entry.instanceCount >= 6 && entry.instanceCount <= 8, `instanceCount for ${scenarioId} must sit in 6..8`);
				assert.ok(entry.difficultyBase >= 0 && entry.difficultyBase <= 1, `difficultyBase for ${scenarioId} must sit in 0..1`);
			}
			assert.strictEqual(Object.values(facts).reduce((sum, entry) => sum + entry.instanceCount, 0), 66, '8 + 8 + 6 per world, three worlds');
		});

		test('names and descriptions are non-empty domain-shaped strings', () => {
			for (const world of INDUSTRY_TASK_WORLDS) {
				const domain = world.world.domain;
				for (const scenario of world.taskScenarios) {
					assert.ok(scenario.name.startsWith(`${domain[0]!.toUpperCase()}${domain.slice(1)} fixture:`), `scenario name must carry the fixture marker: ${scenario.name}`);
					assert.ok(scenario.description.length > 20);
				}
			}
		});
	});

	suite('the lookups (registry / listing / getWorld / getScenario)', () => {
		test('getIndustryWorld hits for the three industry ids and misses for unknowns and the SE world id', () => {
			for (const worldId of INDUSTRY_WORLD_IDS) {
				const world = getIndustryWorld(worldId);
				assert.ok(world);
				assert.strictEqual(world.world.worldId, worldId);
				assert.strictEqual(world.world.domain, INDUSTRY_DOMAINS[worldId]);
			}
			assert.strictEqual(getIndustryWorld('world-does-not-exist'), undefined);
			assert.strictEqual(getIndustryWorld('world-se-fixtures'), undefined);
		});

		test('getTaskWorld resolves all four worlds, the SE one referentially through the REAL module', () => {
			for (const worldId of ['world-se-fixtures', ...INDUSTRY_WORLD_IDS]) {
				const world = getTaskWorld(worldId);
				assert.ok(world, `world ${worldId} must resolve through the combined lookup`);
				assert.strictEqual(world.world.worldId, worldId);
			}
			assert.strictEqual(getTaskWorld('world-se-fixtures') === getWorld('world-se-fixtures'), true, 'the SE resolution must be the REAL module\'s own object');
			assert.strictEqual(getTaskWorld('world-does-not-exist'), undefined);
		});

		test('getIndustryScenario hits for all nine industry scenario ids and misses for SE ids and unknowns', () => {
			for (const scenarioId of INDUSTRY_SCENARIO_IDS) {
				const scenario = getIndustryScenario(scenarioId);
				assert.ok(scenario);
				assert.strictEqual(scenario.id, scenarioId);
				assert.ok(scenario.worldId.startsWith('world-'));
			}
			for (const seId of SE_SCENARIO_IDS) {
				assert.strictEqual(getIndustryScenario(seId), undefined);
			}
			assert.strictEqual(getIndustryScenario('scenario-does-not-exist'), undefined);
		});

		test('getTaskScenario resolves all twelve scenario ids, the SE ones referentially through the REAL module', () => {
			for (const scenarioId of [...SE_SCENARIO_IDS, ...INDUSTRY_SCENARIO_IDS]) {
				const scenario = getTaskScenario(scenarioId);
				assert.ok(scenario, `scenario ${scenarioId} must resolve through the combined lookup`);
				assert.strictEqual(scenario.id, scenarioId);
			}
			for (const seId of SE_SCENARIO_IDS) {
				assert.strictEqual(getTaskScenario(seId) === getScenario(seId), true, 'the SE resolution must be the REAL module\'s own object');
			}
			assert.strictEqual(getTaskScenario('scenario-does-not-exist'), undefined);
		});

		test('no catalog injection: the landed module\'s own lookups never resolve industry ids (the landed registry is untouched by the extension)', () => {
			for (const worldId of INDUSTRY_WORLD_IDS) {
				assert.strictEqual(getWorld(worldId), undefined, `the landed getWorld must not resolve ${worldId}`);
			}
			for (const scenarioId of INDUSTRY_SCENARIO_IDS) {
				assert.strictEqual(getScenario(scenarioId), undefined, `the landed getScenario must not resolve ${scenarioId}`);
				assert.deepStrictEqual(generateInstances(scenarioId, RUN_SEED, 4), [], `the landed generateInstances must not generate ${scenarioId}`);
			}
		});

		test('the combined lookups return the industry module\'s own records referentially (never transcribed copies)', () => {
			for (const scenarioId of INDUSTRY_SCENARIO_IDS) {
				assert.strictEqual(getTaskScenario(scenarioId) === getIndustryScenario(scenarioId), true, `the combined resolution of ${scenarioId} must be the industry record itself`);
			}
			for (const worldId of INDUSTRY_WORLD_IDS) {
				assert.strictEqual(getTaskWorld(worldId) === getIndustryWorld(worldId), true, `the combined resolution of ${worldId} must be the industry record itself`);
			}
		});

		test('taskWorldModelVersion returns the recorded WorldModelVersion for all four worlds and undefined for unknowns', () => {
			for (const worldId of ['world-se-fixtures', ...INDUSTRY_WORLD_IDS]) {
				const model = taskWorldModelVersion(worldId);
				assert.ok(model);
				assert.strictEqual(model.worldId, worldId);
				assert.strictEqual(model.evidenceLevel, 'fixture');
			}
			assert.strictEqual(taskWorldModelVersion('world-se-fixtures')?.domain, 'software-engineering');
			assert.strictEqual(taskWorldModelVersion('world-finance-fixtures')?.domain, 'finance');
			assert.strictEqual(taskWorldModelVersion('world-healthcare-fixtures')?.domain, 'healthcare');
			assert.strictEqual(taskWorldModelVersion('world-construction-fixtures')?.domain, 'construction');
			assert.strictEqual(taskWorldModelVersion('world-does-not-exist'), undefined);
		});
	});

	suite('deterministic generation (the REAL engine, imported)', () => {
		test('identical (scenarioId, seed, count) produces deeply identical instances for every industry scenario', () => {
			for (const scenarioId of INDUSTRY_SCENARIO_IDS) {
				const first = generateIndustryInstances(scenarioId, RUN_SEED, 6);
				const second = generateIndustryInstances(scenarioId, RUN_SEED, 6);
				assert.strictEqual(first.length, 6);
				assert.deepStrictEqual(first, second);
			}
		});

		test('different seeds produce different instance streams for every industry scenario', () => {
			for (const scenarioId of INDUSTRY_SCENARIO_IDS) {
				const firstBriefs = generateIndustryInstances(scenarioId, 101, 5).map((instance) => instance.brief);
				const secondBriefs = generateIndustryInstances(scenarioId, 202, 5).map((instance) => instance.brief);
				assert.strictEqual(firstBriefs.length, 5);
				assert.notDeepStrictEqual(firstBriefs, secondBriefs);
			}
		});

		test('the instance stream is independent of the requested count: the first 4 of 8 equal a direct run of 4', () => {
			for (const scenarioId of INDUSTRY_SCENARIO_IDS) {
				const eight = generateIndustryInstances(scenarioId, RUN_SEED, 8);
				const four = generateIndustryInstances(scenarioId, RUN_SEED, 4);
				assert.strictEqual(eight.length, 8);
				assert.strictEqual(four.length, 4);
				assert.deepStrictEqual(eight.slice(0, 4), four);
			}
		});

		test('instance 2 is identical whether the run count is 4 or 8', () => {
			for (const scenarioId of INDUSTRY_SCENARIO_IDS) {
				const eight = generateIndustryInstances(scenarioId, RUN_SEED, 8);
				const four = generateIndustryInstances(scenarioId, RUN_SEED, 4);
				const fromEight = eight[2];
				const fromFour = four[2];
				assert.ok(fromEight);
				assert.ok(fromFour);
				assert.deepStrictEqual(fromEight, fromFour);
			}
		});

		test('unknown scenario ids and non-positive counts yield the empty list', () => {
			assert.deepStrictEqual(generateIndustryInstances('scenario-does-not-exist', RUN_SEED, 8), []);
			assert.deepStrictEqual(generateIndustryInstances('scenario-se-bugfix-regression', RUN_SEED, 8), [], 'an SE scenario id is not an industry scenario id');
			for (const scenarioId of INDUSTRY_SCENARIO_IDS.slice(0, 3)) {
				assert.deepStrictEqual(generateIndustryInstances(scenarioId, RUN_SEED, 0), []);
				assert.deepStrictEqual(generateIndustryInstances(scenarioId, RUN_SEED, -1), []);
				assert.deepStrictEqual(generateIndustryInstances(scenarioId, RUN_SEED, -8), []);
			}
			assert.deepStrictEqual(generateTaskInstances('scenario-does-not-exist', RUN_SEED, 8), []);
			assert.deepStrictEqual(generateTaskInstances('scenario-finance-payment-failure-triage', RUN_SEED, 0), []);
		});

		test('every instance carries its scenarioId, seed and instanceIndex verbatim, with evidenceLevel fixture', () => {
			for (const scenarioId of INDUSTRY_SCENARIO_IDS) {
				const instances = generateIndustryInstances(scenarioId, RUN_SEED, 5);
				for (let index = 0; index < instances.length; index++) {
					const instance = instances[index];
					assert.ok(instance);
					assert.strictEqual(instance.scenarioId, scenarioId);
					assert.strictEqual(instance.seed, RUN_SEED);
					assert.strictEqual(instance.instanceIndex, index);
					assert.strictEqual(instance.evidenceLevel, 'fixture');
				}
			}
		});

		test('THE IMPORT LAW as a test: generateTaskInstances over an SE scenario id is byte-identical to the REAL generateInstances output', () => {
			for (const scenarioId of SE_SCENARIO_IDS) {
				const throughCombined = generateTaskInstances(scenarioId, 7, 4);
				const throughReal = generateInstances(scenarioId, 7, 4);
				assert.strictEqual(throughCombined.length, 4);
				assert.deepStrictEqual(throughCombined, throughReal);
			}
		});

		test('generateTaskInstances equals generateIndustryInstances for industry scenario ids (one engine, one stream)', () => {
			for (const scenarioId of INDUSTRY_SCENARIO_IDS) {
				assert.deepStrictEqual(generateTaskInstances(scenarioId, RUN_SEED, 6), generateIndustryInstances(scenarioId, RUN_SEED, 6));
			}
		});

		test('cross-world independence: the same seed over one scenario per world produces three different brief streams', () => {
			const financeBriefs = generateIndustryInstances('scenario-finance-reconciliation-discrepancy', RUN_SEED, 5).map((instance) => instance.brief);
			const healthcareBriefs = generateIndustryInstances('scenario-healthcare-scheduling-integrity', RUN_SEED, 5).map((instance) => instance.brief);
			const constructionBriefs = generateIndustryInstances('scenario-construction-submittal-coordination', RUN_SEED, 5).map((instance) => instance.brief);
			assert.notDeepStrictEqual(financeBriefs, healthcareBriefs);
			assert.notDeepStrictEqual(financeBriefs, constructionBriefs);
			assert.notDeepStrictEqual(healthcareBriefs, constructionBriefs);
		});
	});

	suite('the generator shape (the structural law over the industry tables)', () => {
		test('context files: 3-6 unique entries drawn from the owning world\'s 24-path table, lines 40..900 in steps of 20, relevance 0.3..1.0, ascending path order', () => {
			for (const scenarioId of INDUSTRY_SCENARIO_IDS) {
				const worldId = industryWorldIdOf(scenarioId);
				const table = INDUSTRY_WORLD_TABLES[worldId]!.contextPaths;
				for (const instance of generateIndustryInstances(scenarioId, RUN_SEED, 8)) {
					assert.ok(instance.contextFiles.length >= 3 && instance.contextFiles.length <= 6);
					const paths: string[] = [];
					for (const file of instance.contextFiles) {
						assert.ok(table.includes(file.path), `path ${file.path} is not in the ${worldId} table`);
						assert.ok(file.lines >= 40 && file.lines <= 900);
						assert.strictEqual(file.lines % 20, 0);
						assert.ok(file.relevance >= 0.3 && file.relevance <= 1.0);
						paths.push(file.path);
					}
					assert.strictEqual(new Set(paths).size, paths.length, 'context paths must be unique within an instance');
					const sorted = paths.slice().sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
					assert.deepStrictEqual(paths, sorted, 'context files must be emitted in ascending path order');
				}
			}
		});

		test('obstacles: 1-3 unique kinds drawn from the owning world\'s 8-kind table, severity 0.2..0.9, ascending kind order', () => {
			for (const scenarioId of INDUSTRY_SCENARIO_IDS) {
				const worldId = industryWorldIdOf(scenarioId);
				const table = INDUSTRY_WORLD_TABLES[worldId]!.obstacleKinds;
				for (const instance of generateIndustryInstances(scenarioId, RUN_SEED, 8)) {
					assert.ok(instance.obstacles.length >= 1 && instance.obstacles.length <= 3);
					const kinds: string[] = [];
					for (const obstacle of instance.obstacles) {
						assert.ok(table.includes(obstacle.kind), `kind ${obstacle.kind} is not in the ${worldId} table`);
						assert.ok(obstacle.severity >= 0.2 && obstacle.severity <= 0.9);
						kinds.push(obstacle.kind);
					}
					assert.strictEqual(new Set(kinds).size, kinds.length, 'obstacle kinds must be unique within an instance');
					const sorted = kinds.slice().sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
					assert.deepStrictEqual(kinds, sorted, 'obstacles must be emitted in ascending kind order');
				}
			}
		});

		test('briefs compose from the scenario\'s own banks: one opener, 1-2 evidence fragments, one constraint, one deliverable, in that order', () => {
			for (const scenarioId of INDUSTRY_SCENARIO_IDS) {
				for (const instance of generateIndustryInstances(scenarioId, RUN_SEED, 8)) {
					assertBriefComposition(scenarioId, instance.brief);
				}
			}
		});

		test('acceptance criteria: 2-4 entries forming a subsequence of the scenario\'s criterion bank in canonical bank order', () => {
			for (const scenarioId of INDUSTRY_SCENARIO_IDS) {
				for (const instance of generateIndustryInstances(scenarioId, RUN_SEED, 8)) {
					assertCanonicalCriteria(scenarioId, instance.acceptanceCriteria);
				}
			}
		});

		test('difficulty obeys clamp(0.05, 0.95, difficultyBase + 0.25 * averageSeverity + jitter) with |jitter| <= 0.05', () => {
			for (const scenarioId of INDUSTRY_SCENARIO_IDS) {
				const scenario = getIndustryScenario(scenarioId) as TaskScenario;
				for (const instance of generateIndustryInstances(scenarioId, RUN_SEED, 8)) {
					assert.ok(instance.difficulty >= 0.05 && instance.difficulty <= 0.95);
					const impliedJitter = instance.difficulty - scenario.difficultyBase - 0.25 * averageSeverity(instance);
					const clamped = instance.difficulty === 0.05 || instance.difficulty === 0.95;
					assert.ok(clamped || Math.abs(impliedJitter) <= 0.05 + 1e-9, `implied jitter ${impliedJitter} escapes the ±0.05 band`);
				}
			}
		});

		test('the difficulty law: instances in the top obstacle-severity half are harder on average than the bottom half', () => {
			for (const scenarioId of INDUSTRY_SCENARIO_IDS) {
				const instances = generateIndustryInstances(scenarioId, RUN_SEED, 40);
				assert.strictEqual(instances.length, 40);
				const entries = instances.map((instance) => ({ instance, average: averageSeverity(instance) }));
				entries.sort((left, right) => left.average - right.average);
				const bottom = entries.slice(0, 20);
				const top = entries.slice(20, 40);
				const mean = (list: typeof entries): number => list.reduce((sum, entry) => sum + entry.instance.difficulty, 0) / list.length;
				assert.ok(mean(top) > mean(bottom), `raising obstacle severity must raise difficulty on average for ${scenarioId}`);
			}
		});
	});

	suite('the information boundary law (runtime)', () => {
		test('visiblePayload over industry instances omits the withheld ground truth and keeps the visible fields verbatim', () => {
			const scenarioIds = [
				'scenario-finance-regulatory-report-validation',
				'scenario-healthcare-record-access-audit',
				'scenario-construction-schedule-impact-analysis',
			];
			for (const scenarioId of scenarioIds) {
				const instances = generateIndustryInstances(scenarioId, RUN_SEED, 5);
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
				assert.strictEqual(payload.evidenceLevel, 'fixture');
			}
		});

		test('visiblePayload copies the visible arrays so the agent lane cannot mutate the recorded instance', () => {
			const instance = generateIndustryInstances('scenario-finance-payment-failure-triage', RUN_SEED, 3)[1];
			assert.ok(instance);
			const payload = visiblePayload(instance);
			assert.notStrictEqual(payload.contextFiles, instance.contextFiles);
			assert.notStrictEqual(payload.obstacles, instance.obstacles);
			payload.contextFiles.pop();
			payload.obstacles.pop();
			assert.strictEqual(instance.contextFiles.length >= 3, true, 'mutating the payload must not shrink the instance\'s context files');
			assert.strictEqual(instance.obstacles.length >= 1, true, 'mutating the payload must not shrink the instance\'s obstacles');
		});
	});

	suite('bank honesty (every named input bank has real data behind it)', () => {
		test('the brief-fragments banks: every industry scenario carries 5 openers, 6 evidence fragments, 5 constraints, 5 deliverables - all non-empty and unique in their bank', () => {
			for (const scenarioId of INDUSTRY_SCENARIO_IDS) {
				const banks = banksOf(scenarioId);
				assert.strictEqual(banks.openers.length, 5);
				assert.strictEqual(banks.evidenceFragments.length, 6);
				assert.strictEqual(banks.constraints.length, 5);
				assert.strictEqual(banks.deliverables.length, 5);
				assert.strictEqual(new Set(banks.openers).size, 5);
				assert.strictEqual(new Set(banks.evidenceFragments).size, 6);
				assert.strictEqual(new Set(banks.constraints).size, 5);
				assert.strictEqual(new Set(banks.deliverables).size, 5);
				for (const bank of [banks.openers, banks.evidenceFragments, banks.constraints, banks.deliverables]) {
					for (const fragment of bank) {
						assert.ok(typeof fragment === 'string' && fragment.length > 0);
					}
				}
			}
		});

		test('the acceptance-criteria banks: 5 criteria per industry scenario, non-empty, unique', () => {
			for (const scenarioId of INDUSTRY_SCENARIO_IDS) {
				const criteria = banksOf(scenarioId).acceptanceCriteria;
				assert.strictEqual(criteria.length, 5);
				assert.strictEqual(new Set(criteria).size, 5);
				for (const criterion of criteria) {
					assert.ok(criterion.length > 0);
				}
			}
		});

		test('the context-layout banks: every industry world\'s 24-path table is real data the generator actually draws from', () => {
			for (const worldId of INDUSTRY_WORLD_IDS) {
				const table = INDUSTRY_WORLD_TABLES[worldId]!.contextPaths;
				const domain = INDUSTRY_DOMAINS[worldId];
				assert.strictEqual(table.length, 24, `the ${worldId} context layout must carry 24 paths`);
				assert.strictEqual(new Set(table).size, 24);
				for (const path of table) {
					assert.ok(path.startsWith(`${domain}/`), `path ${path} must sit under the ${domain}/ layout`);
					assert.ok(/\.(csv|json|yaml|sql)$/.test(path), `path ${path} must carry a known fixture extension`);
				}
				const drawn = new Set<string>();
				for (const scenario of getIndustryWorld(worldId)?.taskScenarios ?? []) {
					for (const instance of generateIndustryInstances(scenario.id, RUN_SEED, 12)) {
						for (const file of instance.contextFiles) {
							drawn.add(file.path);
						}
					}
				}
				assert.ok(drawn.size >= 12, `generation over ${worldId} must actually draw from the layout table (drew ${drawn.size} distinct paths)`);
				for (const path of drawn) {
					assert.ok(table.includes(path));
				}
			}
		});

		test('the obstacle-kind-table banks: every industry world\'s 8-kind table is real data the generator actually draws from', () => {
			for (const worldId of INDUSTRY_WORLD_IDS) {
				const table = INDUSTRY_WORLD_TABLES[worldId]!.obstacleKinds;
				assert.strictEqual(table.length, 8, `the ${worldId} obstacle table must carry 8 kinds`);
				assert.strictEqual(new Set(table).size, 8);
				for (const kind of table) {
					assert.ok(/^[a-z]+(-[a-z]+)*$/.test(kind), `kind ${kind} must be kebab-case`);
				}
				const drawn = new Set<string>();
				for (const scenario of getIndustryWorld(worldId)?.taskScenarios ?? []) {
					for (const instance of generateIndustryInstances(scenario.id, RUN_SEED, 12)) {
						for (const obstacle of instance.obstacles) {
							drawn.add(obstacle.kind);
						}
					}
				}
				assert.ok(drawn.size >= 4, `generation over ${worldId} must actually draw from the obstacle table (drew ${drawn.size} distinct kinds)`);
				for (const kind of drawn) {
					assert.ok(table.includes(kind));
				}
			}
		});
	});

	suite('in-suite determinism greps (the determinism law as a test)', () => {
		test('every banned-global hit in financeTaskWorld.ts is a law-comment line', () => {
			const hits = determinismGrepHits('../../common/financeTaskWorld.ts');
			assert.strictEqual(hits.length > 0, true, 'the ban must be quoted in the law comments');
			for (const line of hits) {
				assert.match(line.trim(), /^\*/);
			}
		});

		test('every banned-global hit in healthcareTaskWorld.ts is a law-comment line', () => {
			const hits = determinismGrepHits('../../common/healthcareTaskWorld.ts');
			assert.strictEqual(hits.length > 0, true, 'the ban must be quoted in the law comments');
			for (const line of hits) {
				assert.match(line.trim(), /^\*/);
			}
		});

		test('every banned-global hit in constructionTaskWorld.ts is a law-comment line', () => {
			const hits = determinismGrepHits('../../common/constructionTaskWorld.ts');
			assert.strictEqual(hits.length > 0, true, 'the ban must be quoted in the law comments');
			for (const line of hits) {
				assert.match(line.trim(), /^\*/);
			}
		});

		test('every banned-global hit in industryTaskWorlds.ts is a law-comment line', () => {
			const hits = determinismGrepHits('../../common/industryTaskWorlds.ts');
			assert.strictEqual(hits.length > 0, true, 'the ban must be quoted in the law comments');
			for (const line of hits) {
				assert.match(line.trim(), /^\*/);
			}
		});

		test('every banned-global hit in the extended taskWorlds.ts (the landed module with the exported surface) is still a law-comment line', () => {
			const hits = determinismGrepHits('../../common/taskWorlds.ts');
			assert.strictEqual(hits.length > 0, true, 'the ban must be quoted in the law comments');
			for (const line of hits) {
				assert.match(line.trim(), /^\*/);
			}
		});
	});
});
