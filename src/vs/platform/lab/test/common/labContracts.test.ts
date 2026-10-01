/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import {
	LAB_CONTRACTS_VERSION,
	canTransitionLabRunStatus,
	labRunStatusTransitions,
	isVersionedLabRecord,
	isValidUtilityWeights,
	type LabRun,
	type LabScope,
	type WorldModelVersion,
	type BaselineComparison,
} from '../../common/labContracts.js';

suite('labContracts', () => {

	test('LAB_CONTRACTS_VERSION equals 1.0.0', () => {
		assert.strictEqual(LAB_CONTRACTS_VERSION, '1.0.0');
	});

	test('labRunStatusTransitions pins the exact legal transition map', () => {
		assert.deepStrictEqual(labRunStatusTransitions, {
			draft: ['queued'],
			queued: ['running', 'failed'],
			running: ['evaluated', 'failed'],
			evaluated: ['recommended', 'failed'],
			recommended: [],
			failed: [],
		});
	});

	test('legal transitions: draft->queued, queued->running, running->evaluated, evaluated->recommended', () => {
		assert.ok(canTransitionLabRunStatus('draft', 'queued'));
		assert.ok(canTransitionLabRunStatus('queued', 'running'));
		assert.ok(canTransitionLabRunStatus('running', 'evaluated'));
		assert.ok(canTransitionLabRunStatus('evaluated', 'recommended'));
	});

	test('illegal transitions: draft->running, recommended->queued, failed->running', () => {
		assert.ok(!canTransitionLabRunStatus('draft', 'running'));
		assert.ok(!canTransitionLabRunStatus('recommended', 'queued'));
		assert.ok(!canTransitionLabRunStatus('failed', 'running'));
	});

	test('isVersionedLabRecord: true for current version, false for stale or missing', () => {
		assert.ok(isVersionedLabRecord({ contractVersion: LAB_CONTRACTS_VERSION }));
		assert.ok(!isVersionedLabRecord({ contractVersion: '0.9.0' }));
		assert.ok(!isVersionedLabRecord({}));
	});

	test('isValidUtilityWeights: true for balanced weights', () => {
		assert.ok(isValidUtilityWeights({ success: 0.4, quality: 0.3, latency: 0.2, cost: 0.1 }));
		assert.ok(isValidUtilityWeights({ success: 0.25, quality: 0.25, latency: 0.25, cost: 0.25 }));
	});

	test('isValidUtilityWeights: false for negative weights or weights not summing to 1', () => {
		assert.ok(!isValidUtilityWeights({ success: -0.1, quality: 0.5, latency: 0.4, cost: 0.2 }));
		assert.ok(!isValidUtilityWeights({ success: 0.5, quality: 0.2, latency: 0.1, cost: 0.1 }));
		assert.ok(!isValidUtilityWeights({ success: 0, quality: 0, latency: 0, cost: 0 }));
	});

	test('minimal LabRun fixture compiles and fields read back', () => {
		const scope: LabScope = { workspaceId: 'ws-fixtures', tenantId: 'tenant-fixtures' };
		const worldModel: WorldModelVersion = {
			worldId: 'world-software-engineering',
			version: '1.0.0',
			domain: 'software-engineering',
			seedPolicy: 'fixed',
			evidenceLevel: 'fixture',
			provenance: 'LAB-001 static fixture world model',
		};
		const run: LabRun = {
			scope,
			contractVersion: LAB_CONTRACTS_VERSION,
			id: 'run-0001',
			spec: { workloadId: 'workload-fixtures', taskTypeId: 'task-type-fixtures', scenarioId: 'scenario-fixtures', ladderLevel: 0, seeds: [42] },
			status: 'draft',
			worldModel,
			createdAt: '2026-10-01T00:00:00.000Z',
		};
		assert.strictEqual(run.scope.workspaceId, 'ws-fixtures');
		assert.strictEqual(run.scope.tenantId, 'tenant-fixtures');
		assert.strictEqual(run.contractVersion, LAB_CONTRACTS_VERSION);
		assert.strictEqual(run.id, 'run-0001');
		assert.strictEqual(run.spec.workloadId, 'workload-fixtures');
		assert.strictEqual(run.spec.ladderLevel, 0);
		assert.deepStrictEqual(run.spec.seeds, [42]);
		assert.strictEqual(run.status, 'draft');
		assert.strictEqual(run.worldModel.evidenceLevel, 'fixture');
		assert.strictEqual(run.completedAt, undefined);
		assert.strictEqual(run.error, undefined);
		assert.ok(isVersionedLabRecord(run));
	});

	test('BaselineComparison delta orientation: positive always means better', () => {
		// quality/success: candidate - baseline; latency/cost: baseline - candidate.
		const quality: BaselineComparison = { dimension: 'quality', candidateValue: 0.9, baselineValue: 0.7, delta: 0.2 };
		const latency: BaselineComparison = { dimension: 'latency', candidateValue: 1200, baselineValue: 1500, delta: 300 };
		assert.ok(quality.delta > 0);
		assert.ok(latency.delta > 0);
	});
});
