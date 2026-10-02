/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Unit tests for runEngine. NOTE: this file is authored in the worker B3 sandbox
 * but NOT executed here - the TL runs the real gate against the in-repo paths.
 * The depth-identical import '../../common/runEngine.js' resolves correctly in repo.
 */

import assert from 'assert';
import { FIXTURE_RESPONSE_MODEL, runLadder, type CandidateScorer, type EvaluationRequest } from '../../common/runEngine.js';

// Helpers ---------------------------------------------------------------------

const DEFAULT_WEIGHTS = { success: 0.25, quality: 0.25, latency: 0.25, cost: 0.25 };

function makeCandidate(
	id: string,
	nodeCount: number,
	topology: 'single' | 'pipeline' | 'hierarchical' | 'hub-and-spoke' = 'pipeline',
) {
	const nodes: { id: string; bodyId: string; role: string; reportsTo?: string }[] = [];
	for (let i = 0; i < nodeCount; i++) {
		nodes.push({
			id: `n${i}`,
			bodyId: `b${i}`,
			role: 'worker',
			reportsTo: i > 0 ? `n${i - 1}` : undefined,
		});
	}
	const edges: { from: string; to: string; kind: 'delegation' | 'review' | 'handoff' }[] = [];
	for (let i = 1; i < nodeCount; i++) {
		edges.push({ from: `n${i - 1}`, to: `n${i}`, kind: 'delegation' });
	}
	return {
		scope: { workspaceId: 'lab-fixtures', tenantId: 'lab-fixtures' },
		contractVersion: '1.0.0',
		id,
		name: id,
		topology,
		nodes,
		edges,
		occupancy: nodes.map((n) => ({ nodeId: n.id, modelId: 'm1' })),
		capabilities: nodes.map((n) => ({ nodeId: n.id, toolIds: [] as string[] })),
	};
}

function makeRequest(overrides: Partial<EvaluationRequest> = {}): EvaluationRequest {
	return {
		scope: { workspaceId: 'lab-fixtures', tenantId: 'lab-fixtures' },
		runId: 'run-1',
		taskScenarioId: 'scenario-se-bugfix-regression',
		ladderLevel: 0,
		seeds: [42],
		instanceCount: 0,
		utilityWeights: { ...DEFAULT_WEIGHTS },
		candidates: [makeCandidate('baseline', 3)],
		...overrides,
	};
}

function makeInstance(difficulty: number): any {
	return {
		scenarioId: 'scenario-se-bugfix-regression',
		seed: 1,
		instanceIndex: 0,
		brief: '',
		contextFiles: [],
		obstacles: [],
		acceptanceCriteria: [],
		difficulty,
		evidenceLevel: 'fixture',
	};
}

function findScore(scores: { dimension: string; value: number }[], dim: string): number {
	return scores.find((s) => s.dimension === dim)!.value;
}

// Tests -----------------------------------------------------------------------

suite('runEngine', () => {

	test('invalid weights (negative) returns undefined', () => {
		const req = makeRequest({ utilityWeights: { success: -0.1, quality: 0.4, latency: 0.3, cost: 0.4 } });
		assert.strictEqual(runLadder(req), undefined);
	});

	test('invalid weights (sum not 1) returns undefined', () => {
		const req = makeRequest({ utilityWeights: { success: 0.5, quality: 0.5, latency: 0.5, cost: 0.5 } });
		assert.strictEqual(runLadder(req), undefined);
	});

	test('empty candidates returns undefined', () => {
		const req = makeRequest({ candidates: [] as any });
		assert.strictEqual(runLadder(req), undefined);
	});

	test('unknown taskScenarioId returns undefined', () => {
		const req = makeRequest({ taskScenarioId: 'no-such-scenario' });
		assert.strictEqual(runLadder(req), undefined);
	});

	test('L2 with < 2 seeds returns undefined', () => {
		const req = makeRequest({ ladderLevel: 2, seeds: [1], instanceCount: 4 });
		assert.strictEqual(runLadder(req), undefined);
	});

	test('instanceCount <= 0 at L1 returns undefined', () => {
		const req = makeRequest({ ladderLevel: 1, seeds: [1], instanceCount: 0 });
		assert.strictEqual(runLadder(req), undefined);
	});

	test('valid request accepted (returns result)', () => {
		const req = makeRequest();
		const result = runLadder(req);
		assert.ok(result);
		assert.strictEqual(result!.runId, 'run-1');
	});

	test('baseline law: reports[0] === baselineReport; baseline deltas all 0', () => {
		const req = makeRequest({ candidates: [makeCandidate('baseline', 3), makeCandidate('other', 5)] });
		const result = runLadder(req);
		assert.ok(result);
		assert.strictEqual(result!.baselineReport, result!.reports[0]);
		for (const c of result!.baselineReport.comparison) {
			assert.strictEqual(c.delta, 0);
		}
	});

	test('L0: zero instance generation (counting scorer seam)', () => {
		let lastInstances: any[] | undefined;
		let callCount = 0;
		const countingScorer: CandidateScorer = {
			engineId: 'test-count',
			engineVersion: '1.0.0',
			evidenceLevel: 'fixture',
			scoreCandidate(_c, instances, _d) {
				lastInstances = instances;
				callCount++;
				return [
					{ dimension: 'success', value: 0.5, unit: '' },
					{ dimension: 'quality', value: 0.5, unit: '' },
					{ dimension: 'latency', value: 0.5, unit: '' },
					{ dimension: 'cost', value: 0.5, unit: '' },
				];
			},
		};
		const req = makeRequest({ ladderLevel: 0, scorer: countingScorer });
		const result = runLadder(req);
		assert.ok(result);
		assert.strictEqual(callCount, 1);
		assert.deepStrictEqual(lastInstances, []);
	});

	test('L0: reproducible uses seeds[0] with an artifactHash (extra seeds ignored)', () => {
		const req = makeRequest({ ladderLevel: 0, seeds: [42, 100] });
		const result = runLadder(req);
		assert.ok(result);
		assert.strictEqual(result!.reports[0].reproducible.length, 1);
		assert.strictEqual(result!.reports[0].reproducible[0].seed, 42);
		assert.ok(result!.reports[0].reproducible[0].artifactHash);
		assert.strictEqual(result!.reports[0].reproducible[0].artifactHash!.length, 8);
	});

	test('L1: instance simulation - instances.length === instanceCount (counting scorer seam)', () => {
		let lastInstances: any[] | undefined;
		const countingScorer: CandidateScorer = {
			engineId: 'test-count',
			engineVersion: '1.0.0',
			evidenceLevel: 'fixture',
			scoreCandidate(_c, instances, _d) {
				lastInstances = instances;
				return [
					{ dimension: 'success', value: 0.5, unit: '' },
					{ dimension: 'quality', value: 0.5, unit: '' },
					{ dimension: 'latency', value: 0.5, unit: '' },
					{ dimension: 'cost', value: 0.5, unit: '' },
				];
			},
		};
		const req = makeRequest({ ladderLevel: 1, seeds: [7], instanceCount: 5, scorer: countingScorer });
		const result = runLadder(req);
		assert.ok(result);
		assert.ok(lastInstances);
		assert.strictEqual(lastInstances!.length, 5);
	});

	test('L1: byte-identical (same request twice -> deepStrictEqual)', () => {
		const req = makeRequest({ ladderLevel: 1, seeds: [7], instanceCount: 4 });
		const a = runLadder(req);
		const b = runLadder(req);
		assert.deepStrictEqual(a, b);
	});

	test('L2: robustness present; seedsEvaluated === seeds.length; per-dimension variance/worst/uncertainty; low <= high; confidence in 0..1', () => {
		const req = makeRequest({
			ladderLevel: 2,
			seeds: [1, 2, 3],
			instanceCount: 4,
			candidates: [makeCandidate('baseline', 3)],
		});
		const result = runLadder(req);
		assert.ok(result);
		const r = result!.reports[0];
		assert.ok(r.robustness);
		assert.strictEqual(r.robustness!.seedsEvaluated, 3);
		assert.strictEqual(r.robustness!.seedVariance.length, 4);
		assert.strictEqual(r.robustness!.worstCase.length, 4);
		assert.strictEqual(r.robustness!.uncertainty.length, 4);
		for (const u of r.robustness!.uncertainty) {
			assert.ok(u.low <= u.high, `low <= high for ${u.dimension}`);
			assert.ok(u.confidence >= 0 && u.confidence <= 1, `confidence in 0..1 for ${u.dimension}`);
		}
	});

	test('L2 only: L0 and L1 reports have no robustness', () => {
		const l0 = runLadder(makeRequest({ ladderLevel: 0 }))!;
		const l1 = runLadder(makeRequest({ ladderLevel: 1, seeds: [1], instanceCount: 3 }))!;
		const l2 = runLadder(makeRequest({ ladderLevel: 2, seeds: [1, 2], instanceCount: 3 }))!;
		assert.strictEqual(l0.reports[0].robustness, undefined);
		assert.strictEqual(l1.reports[0].robustness, undefined);
		assert.ok(l2.reports[0].robustness);
	});

	test('comparison direction: candidate beats baseline on all 4 -> all deltas > 0', () => {
		const fixedScorer: CandidateScorer = {
			engineId: 'test-fixed',
			engineVersion: '1.0.0',
			evidenceLevel: 'fixture',
			scoreCandidate(candidate, _instances, _d) {
				if (candidate.id === 'baseline') {
					return [
						{ dimension: 'success', value: 0.5, unit: '' },
						{ dimension: 'quality', value: 0.5, unit: '' },
						{ dimension: 'latency', value: 0.5, unit: '' },
						{ dimension: 'cost', value: 0.5, unit: '' },
					];
				}
				return [
					{ dimension: 'success', value: 0.8, unit: '' },
					{ dimension: 'quality', value: 0.8, unit: '' },
					{ dimension: 'latency', value: 0.2, unit: '' },
					{ dimension: 'cost', value: 0.2, unit: '' },
				];
			},
		};
		const req = makeRequest({
			candidates: [makeCandidate('baseline', 3), makeCandidate('better', 3)],
			scorer: fixedScorer,
		});
		const result = runLadder(req);
		assert.ok(result);
		const better = result!.reports[1];
		for (const c of better.comparison) {
			assert.ok(c.delta > 0, `delta > 0 for ${c.dimension}`);
		}
	});

	test('utility law: hand-computed utility for baseline at L0 (fixture model)', () => {
		// 3-node pipeline, d=0.45, L0 (instances=[]), weights 0.25 each.
		// success=0.445, quality=0.46, latency=0.6275, cost=0.585.
		// utility = 0.25 * (0.445 + 0.46 + (1-0.6275) + (1-0.585)) = 0.423125.
		const req = makeRequest({
			ladderLevel: 0,
			candidates: [makeCandidate('baseline', 3)],
		});
		const result = runLadder(req);
		assert.ok(result);
		assert.ok(Math.abs(result!.reports[0].utility - 0.423125) < 1e-9);
	});

	test('replaceable seam: custom stub scorer changes scores; evidenceLevel propagates', () => {
		const stubScorer: CandidateScorer = {
			engineId: 'test-stub',
			engineVersion: '9.9.9',
			evidenceLevel: 'simulated',
			scoreCandidate(_c, _i, _d) {
				return [
					{ dimension: 'success', value: 0.7, unit: '' },
					{ dimension: 'quality', value: 0.7, unit: '' },
					{ dimension: 'latency', value: 0.3, unit: '' },
					{ dimension: 'cost', value: 0.3, unit: '' },
				];
			},
		};
		const req = makeRequest({ scorer: stubScorer });
		const result = runLadder(req);
		assert.ok(result);
		assert.strictEqual(findScore(result!.reports[0].scores, 'success'), 0.7);
		assert.strictEqual(result!.reports[0].evidenceLevel, 'simulated');
	});

	test('reproducible hashes: same scores -> same hash; distinct seeds may hash differently', () => {
		// Same request twice -> same hash.
		const req = makeRequest({ ladderLevel: 0, seeds: [42] });
		const a = runLadder(req)!;
		const b = runLadder(req)!;
		assert.strictEqual(a.reports[0].reproducible[0].artifactHash, b.reports[0].reproducible[0].artifactHash);

		// Distinct seeds -> different hashes (with a seed-varying scorer at L2).
		const seedVaryingScorer: CandidateScorer = {
			engineId: 'test-seed-varying',
			engineVersion: '1.0.0',
			evidenceLevel: 'fixture',
			scoreCandidate(_c, instances, _d) {
				const seed = instances.length > 0 ? instances[0].seed : 0;
				const v = 0.5 + 0.01 * seed;
				return [
					{ dimension: 'success', value: v, unit: '' },
					{ dimension: 'quality', value: v, unit: '' },
					{ dimension: 'latency', value: 0.5, unit: '' },
					{ dimension: 'cost', value: 0.5, unit: '' },
				];
			},
		};
		const l2req = makeRequest({
			ladderLevel: 2,
			seeds: [1, 2],
			instanceCount: 3,
			scorer: seedVaryingScorer,
		});
		const l2result = runLadder(l2req)!;
		const hash1 = l2result.reports[0].reproducible[0].artifactHash;
		const hash2 = l2result.reports[0].reproducible[1].artifactHash;
		assert.ok(hash1);
		assert.ok(hash2);
		assert.notStrictEqual(hash1, hash2);
	});

	test('safetyCompliance: 3 checks all passed; contractVersion pinned; scope verbatim; evidenceLevel fixture (default scorer)', () => {
		const scope = { workspaceId: 'lab-fixtures', tenantId: 'lab-fixtures' };
		const req = makeRequest({ scope });
		const result = runLadder(req)!;
		const r = result.reports[0];
		assert.strictEqual(r.safetyCompliance.length, 3);
		for (const c of r.safetyCompliance) {
			assert.strictEqual(c.passed, true);
		}
		assert.strictEqual(result.contractVersion, '1.0.0');
		assert.strictEqual(r.contractVersion, '1.0.0');
		assert.strictEqual(result.scope, scope);
		assert.strictEqual(r.scope, scope);
		assert.strictEqual(r.evidenceLevel, 'fixture');
	});

	test('fixture model: hand-computed success/quality/latency/cost on fixed candidate + difficulty (L0 exact)', () => {
		// 3-node pipeline, d=0.45, L0 (instances=[]).
		// success = 0.445, quality = 0.46, latency = 0.6275, cost = 0.585.
		const candidate = makeCandidate('baseline', 3);
		const scores = FIXTURE_RESPONSE_MODEL.scoreCandidate(candidate, [], 0.45);
		assert.ok(Math.abs(findScore(scores, 'success') - 0.445) < 1e-9);
		assert.ok(Math.abs(findScore(scores, 'quality') - 0.46) < 1e-9);
		assert.ok(Math.abs(findScore(scores, 'latency') - 0.6275) < 1e-9);
		assert.ok(Math.abs(findScore(scores, 'cost') - 0.585) < 1e-9);
	});

	test('fixture model: avgInstanceDifficulty path with fabricated instances', () => {
		// 3-node pipeline, d=0.45, instances with difficulties [0.3, 0.5, 0.7] (avg=0.5).
		// success = 0.53 - 0.135 + 0.1*(1-0.5) = 0.445
		// latency = 0.2 + 0.36 + 0.0675 + 0.1*0.5 = 0.6775
		const candidate = makeCandidate('baseline', 3);
		const instances = [makeInstance(0.3), makeInstance(0.5), makeInstance(0.7)];
		const scores = FIXTURE_RESPONSE_MODEL.scoreCandidate(candidate, instances as any, 0.45);
		assert.ok(Math.abs(findScore(scores, 'success') - 0.445) < 1e-9);
		assert.ok(Math.abs(findScore(scores, 'latency') - 0.6775) < 1e-9);
	});

	test('trace: dense 1-based; ladder -> candidate* -> aggregate order; aggregate names best', () => {
		const req = makeRequest({
			candidates: [makeCandidate('a', 3), makeCandidate('b', 5)],
		});
		const result = runLadder(req)!;
		// 1 ladder + 2 candidate + 1 aggregate = 4 steps.
		assert.strictEqual(result.trace.length, 4);
		assert.strictEqual(result.trace[0].step, 1);
		assert.strictEqual(result.trace[0].kind, 'ladder');
		assert.strictEqual(result.trace[1].step, 2);
		assert.strictEqual(result.trace[1].kind, 'candidate');
		assert.strictEqual(result.trace[2].step, 3);
		assert.strictEqual(result.trace[2].kind, 'candidate');
		assert.strictEqual(result.trace[3].step, 4);
		assert.strictEqual(result.trace[3].kind, 'aggregate');
		// Aggregate detail mentions the best id.
		assert.ok(result.trace[3].detail.includes(result.bestReport.candidate.id));
	});

	test('bestReport: max utility, ties resolved by request order (fabricate a tie)', () => {
		const tieScorer: CandidateScorer = {
			engineId: 'test-tie',
			engineVersion: '1.0.0',
			evidenceLevel: 'fixture',
			scoreCandidate(_c, _i, _d) {
				return [
					{ dimension: 'success', value: 0.5, unit: '' },
					{ dimension: 'quality', value: 0.5, unit: '' },
					{ dimension: 'latency', value: 0.5, unit: '' },
					{ dimension: 'cost', value: 0.5, unit: '' },
				];
			},
		};
		const req = makeRequest({
			candidates: [makeCandidate('first', 3), makeCandidate('second', 5)],
			scorer: tieScorer,
		});
		const result = runLadder(req)!;
		// Same scores -> same utility -> ties resolved by request order -> 'first' wins.
		assert.strictEqual(result.reports[0].utility, result.reports[1].utility);
		assert.strictEqual(result.bestReport.candidate.id, 'first');
	});
});
