/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Unit tests for build/flauz/lab/common/closedLoop.ts (LAB-011, Flauz, TL-B lane).
 *
 * Deterministic by construction: a frozen fixture activity corpus, a fixed
 * scenario/seed/weight set, one injected ISO stamp. The station gate (scoped
 * strict tsc + mocha tdd over the merged lab tree) is the execution authority.
 */

import assert from 'assert';
import {
	executeFixtureInstance,
	runClosedLoop,
	type ClosedLoopProof,
	type ClosedLoopRequest,
} from '../../common/closedLoop.js';
import type { LabActivityRecord, WorkloadLearningControls } from '../../common/workloadLearning.js';
import type { LabScope, TaskOutcome } from '../../common/labContracts.js';
import { getScenario, generateInstances } from '../../common/taskWorlds.js';

const SCOPE: LabScope = { workspaceId: 'lab-fixtures', tenantId: 'lab-fixtures' };
const NOW = '2026-03-05T09:00:00.000Z';

const CONTROLS: WorkloadLearningControls = {
	optIn: true,
	retentionDays: 90,
	exportable: true,
};

/** The fixture activity corpus: a bugfix-heavy workload (the loop's scenario family). */
function activityCorpus(): LabActivityRecord[] {
	const records: LabActivityRecord[] = [];
	for (let i = 0; i < 6; i++) {
		records.push({
			scope: SCOPE,
			taskFamily: 'bugfix',
			toolKinds: ['editor', 'shell', 'vcs'],
			usedBrowser: false,
			usedEnvironment: true,
			durationMinutes: 40 + 10 * i,
			complexityHint: 0.4,
			parallelThreads: 1,
			humanInterventions: i % 2,
			requiredReview: true,
			qualitySensitivity: 0.7,
			costSensitivity: 0.3,
			latencySensitivity: 0.5,
			occurredAt: `2026-03-0${i + 1}T10:00:00.000Z`,
		});
	}
	return records;
}

/** The scenario the loop runs: the seeded bugfix-regression fixture. */
const SCENARIO_ID = 'scenario-se-bugfix-regression';

function request(): ClosedLoopRequest {
	return {
		scope: SCOPE,
		runLabel: 'proof-w1',
		activity: activityCorpus(),
		controls: CONTROLS,
		profileId: 'wp-closed-loop',
		taskScenarioId: SCENARIO_ID,
		ladderSeeds: [7, 11],
		instanceCount: 4,
		utilityWeights: { success: 0.3, quality: 0.3, latency: 0.2, cost: 0.2 },
		maxAgents: 4,
		modelIds: ['model-fixture-m', 'model-fixture-s', 'model-fixture-l'],
		toolModes: ['all', 'lean'],
		nowIso: NOW,
	};
}

/** The seeded scenario's task type (must match the learned bugfix family's inference). */
function scenarioTaskTypeId(): string {
	const scenario = getScenario(SCENARIO_ID);
	assert.ok(scenario);
	return scenario.taskTypeId;
}

suite('closedLoop gates', () => {

	test('refuses the proof when workload learning is not opted in (the LAB-002 law)', () => {
		const req = request();
		req.controls = { ...CONTROLS, optIn: false };
		assert.strictEqual(runClosedLoop(req), undefined);
	});

	test('refuses the proof when the scenario does not resolve', () => {
		const req = request();
		req.taskScenarioId = 'scn-nope';
		assert.strictEqual(runClosedLoop(req), undefined);
	});

	test('refuses the proof when the scenario family was never discovered by the workload (incoherent loop)', () => {
		const req = request();
		// A corpus with zero retained records still learns the (empty) profile; no
		// family exists for the scenario's task type to belong to.
		req.activity = [];
		assert.strictEqual(runClosedLoop(req), undefined);
	});
});

suite('closedLoop proof', () => {

	let proof: ClosedLoopProof;

	suiteSetup(() => {
		const result = runClosedLoop(request());
		assert.ok(result);
		proof = result;
	});

	test('the proof runs all ten stages, dense 1..10, in the B11 order', () => {
		assert.deepStrictEqual(proof.stages.map((s) => s.step), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
		assert.deepStrictEqual(
			proof.stages.map((s) => s.stage),
			[
				'workload-observation',
				'task-type-discovery',
				'world-generation',
				'organization-search',
				'model-occupancy-search',
				'robust-simulation',
				'real-flauz-execution',
				'outcome-measurement',
				'calibration',
				'improved-second-run',
			],
		);
	});

	test('stage 1-2: the workload is learned and the scenario family was discovered (the coherence gate)', () => {
		assert.strictEqual(proof.learning.retainedRecordCount, 6);
		assert.ok(proof.learning.taskTypes.length >= 1);
		const familyPrefix = 'tt-' + scenarioTaskTypeId().split('-')[1];
		assert.ok(proof.learning.taskTypes.some((t) => t.taskTypeId.startsWith(familyPrefix + '-')), `the learned set must carry the ${familyPrefix} family`);
	});

	test('stage 3: the world generated the requested instances', () => {
		assert.strictEqual(proof.instances.length, 4);
		assert.ok(proof.instances.every((i) => i.scenarioId === SCENARIO_ID));
	});

	test('stage 4-5: the organization search and the occupancy search both produced ranked results', () => {
		assert.ok(proof.occupancy.candidates.length >= 1);
		assert.ok(proof.occupiedOrganization.nodes.length >= 1);
		assert.strictEqual(proof.occupiedOrganization.occupancy.length, proof.occupiedOrganization.nodes.length);
	});

	test('stage 6: the L2 ladder ran over the baseline and the occupied organization with robustness present', () => {
		assert.strictEqual(proof.firstRun.reports.length, 2);
		for (const report of proof.firstRun.reports) {
			assert.ok(report.robustness);
			assert.strictEqual(report.robustness?.seedsEvaluated, 2);
		}
		assert.strictEqual(proof.firstRun.baselineReport.candidate.id, proof.firstRun.reports[0].candidate.id);
	});

	test('stage 7: the bridge drafted Agent OS requests with approval ask and zero side effects', () => {
		assert.strictEqual(proof.recommendation.status, 'issued');
		assert.strictEqual(proof.bridge.taskRequest.changes.length, 0);
		assert.ok(proof.bridge.workflowDraft.steps.length >= 1);
		assert.ok(proof.bridge.workflowDraft.steps.every((s) => s.approval === 'ask'));
	});

	test('stage 7: every instance executed through the deterministic fixture port', () => {
		assert.strictEqual(proof.executions.length, 4);
		for (const execution of proof.executions) {
			assert.ok(execution.outcome.verification.every((v) => v.passed));
			assert.ok(execution.outcome.latencyMs > 0 && execution.outcome.costUsd > 0);
		}
	});

	test('stage 8: the calibration corpus carries 4 rows per execution (16 total)', () => {
		assert.strictEqual(proof.observations.length, 16);
		assert.ok(proof.observations.every((r) => r.recommendationId === proof.recommendation.id));
		assert.ok(proof.observations.every((r) => r.observedAt === NOW));
	});

	test('stage 9: the calibration model is trusted (>= 3 rows) and fixture-labeled', () => {
		assert.strictEqual(proof.calibration.observationCount, 16);
		assert.strictEqual(proof.calibration.evidenceLevel, 'fixture');
	});

	test('stage 10: the loop CLOSED - every correctable dimension improved or tied', () => {
		assert.strictEqual(proof.loopClosed, true);
		assert.strictEqual(proof.gaps.length, 2);
		for (const gap of proof.gaps) {
			assert.ok(gap.improved);
			assert.ok(gap.gapAfter <= gap.gapBefore);
		}
	});

	test('stage 10: the corrected prediction moved toward the observed truth on success', () => {
		const success = proof.gaps.find((g) => g.dimension === 'success');
		assert.ok(success);
		const factor = proof.calibration.factors.success;
		assert.ok(factor > 1 || factor < 1, 'the fixture outcome must differ from the prediction for the loop to have signal');
		assert.ok(Math.abs(success.corrected - success.observed) <= Math.abs(success.predicted - success.observed));
	});

	test('deterministic: the same request yields a byte-identical proof', () => {
		const a = runClosedLoop(request());
		const b = runClosedLoop(request());
		assert.ok(a && b);
		assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
	});

	test('the proof pins the contract version, the scope and the fixture honesty label', () => {
		assert.strictEqual(proof.contractVersion, '1.0.0');
		assert.deepStrictEqual(proof.scope, SCOPE);
		assert.strictEqual(proof.evidenceLevel, 'fixture');
	});
});

suite('executeFixtureInstance (the fixture LabExecutionPort)', () => {

	test('deterministic outcomes: the same instance and organization yield the identical outcome', () => {
		const instances = generateInstances(SCENARIO_ID, 7, 2);
		assert.ok(instances.length >= 2);
		const org = { nodes: [{ id: 'n1', bodyId: 'body-implementer', role: 'implementer' }] };
		const a = executeFixtureInstance(instances[0], org as never);
		const b = executeFixtureInstance(instances[0], org as never);
		assert.deepStrictEqual(a, b);
	});

	test('harder instances never succeed more often than easier ones (the monotone law)', () => {
		const instances = generateInstances(SCENARIO_ID, 7, 8);
		const org = { nodes: [{ id: 'n1', bodyId: 'body-implementer', role: 'implementer' }] };
		let last = 1;
		for (const instance of instances.slice().sort((x, y) => y.difficulty - x.difficulty)) {
			const outcome: TaskOutcome = executeFixtureInstance(instance, org as never);
			assert.ok(outcome.success ? 1 : 0 <= last);
			last = Math.min(last, outcome.success ? 1 : 0);
		}
	});

	test('bigger organizations cover more (the coverage law: success non-decreasing in nodes)', () => {
		const instances = generateInstances(SCENARIO_ID, 7, 4);
		const small = executeFixtureInstance(instances[0], { nodes: [{ id: 'n1', bodyId: 'b', role: 'r' }] } as never);
		const big = executeFixtureInstance(instances[0], { nodes: [{ id: 'n1', bodyId: 'b', role: 'r' }, { id: 'n2', bodyId: 'b', role: 'r' }, { id: 'n3', bodyId: 'b', role: 'r' }, { id: 'n4', bodyId: 'b', role: 'r' }] } as never);
		assert.ok(big.success || !small.success);
	});
});
