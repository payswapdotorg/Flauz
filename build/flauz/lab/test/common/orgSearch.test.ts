/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * LAB-005 unit tests for the organization search module (fixture lane).
 *
 * These tests are authored against the final in-repo layout
 * (build/flauz/lab/test/common/orgSearch.test.ts importing ../../common/orgSearch.js).
 * The Flauz siblings (labContracts.js / agentBodies.js) are not present in the authoring
 * pod, so this suite is AUTHORED BUT NOT EXECUTED there  -  the TL runs the real gate.
 */

import assert from 'assert';
import { FIXTURE_MODEL_ID, FIXTURE_SCENARIO_DIFFICULTY, FIXTURE_REQUIRED_CAPABILITIES, searchOrganizations, type OrgSearchRequest, type ScoredCandidate } from '../../common/orgSearch.js';

// The repo test harness provides suite/test; declared locally so this file also typechecks
// standalone in the authoring pod where the harness type surface is absent.
declare const suite: (name: string, fn: () => void) => void;
declare const test: (name: string, fn: () => void) => void;

/** Frozen LAB-004 catalog body ids in catalog order (LAB-005 packet appendix). */
const CATALOG_BODY_IDS: readonly string[] = [
	'body-solo-generalist',
	'body-planner-lead',
	'body-implementer',
	'body-code-reviewer',
	'body-verifier',
	'body-researcher',
	'body-integrator',
	'body-oncall-triager',
	'body-refactor-sweeper',
];

/** Fixed fixture request: bugfix scenario (difficulty 0.45), bugfix task type (3 required capabilities). */
function makeRequest(overrides?: Partial<OrgSearchRequest>): OrgSearchRequest {
	return {
		scope: { workspaceId: 'lab-fixtures', tenantId: 'lab-fixtures' },
		scenarioId: 'scenario-se-bugfix-regression',
		taskTypeId: 'tt-bugfix-regression',
		utilityWeights: { success: 0.4, quality: 0.3, latency: 0.2, cost: 0.1 },
		ladderLevel: 0,
		seeds: [1, 2, 3],
		maxAgents: 2,
		...overrides,
	};
}

/** Assert two numbers are equal within 1e-9 (float dust from identically-ordered arithmetic). */
function closeTo(actual: number, expected: number, epsilon = 1e-9): void {
	assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} to be within ${epsilon} of ${expected}`);
}

/** Read one dimension's score value out of a ScoredCandidate. */
function scoreValue(scored: ScoredCandidate, dimension: 'success' | 'quality' | 'latency' | 'cost'): number {
	const score = scored.scores.find((entry) => entry.dimension === dimension);
	assert.ok(score, `missing ${dimension} score on ${scored.candidate.id}`);
	return score.value;
}

suite('orgSearch', () => {

	test('request validation: a negative weight yields undefined', () => {
		const result = searchOrganizations(makeRequest({ utilityWeights: { success: -0.1, quality: 0.4, latency: 0.4, cost: 0.3 } }));
		assert.strictEqual(result, undefined);
	});

	test('request validation: weights not summing to 1 yield undefined', () => {
		assert.strictEqual(searchOrganizations(makeRequest({ utilityWeights: { success: 0.4, quality: 0.3, latency: 0.2, cost: 0.2 } })), undefined);
		assert.strictEqual(searchOrganizations(makeRequest({ utilityWeights: { success: 0.25, quality: 0.25, latency: 0.25, cost: 0.24 } })), undefined);
	});

	test('request validation: valid weights are accepted, including within the 1e-9 tolerance', () => {
		assert.notStrictEqual(searchOrganizations(makeRequest()), undefined);
		assert.notStrictEqual(searchOrganizations(makeRequest({ utilityWeights: { success: 0.4 + 5e-10, quality: 0.3, latency: 0.2, cost: 0.1 } })), undefined);
	});

	test('baseline law: the single-agent baseline is always present, generalist, single, and enumerated first', () => {
		const result = searchOrganizations(makeRequest());
		assert.ok(result);
		const baselineId = 'org-scenario-se-bugfix-regression-n1-single-0';
		assert.strictEqual(result.baseline.candidate.id, baselineId);
		assert.strictEqual(result.baseline.candidate.topology, 'single');
		assert.strictEqual(result.baseline.candidate.nodes.length, 1);
		assert.strictEqual(result.trace[0].kind, 'enumerate');
		assert.strictEqual(result.trace[0].detail, `${baselineId} | bodies: body-solo-generalist`);
		assert.ok(result.candidates.includes(result.baseline), 'baseline must be present in candidates');
		assert.strictEqual(result.best, result.candidates[0]);
	});

	test('baseline law: the baseline survives the tightest bound (maxAgents = 1)', () => {
		const result = searchOrganizations(makeRequest({ maxAgents: 1 }));
		assert.ok(result);
		assert.strictEqual(result.baseline.candidate.id, 'org-scenario-se-bugfix-regression-n1-single-0');
		assert.strictEqual(result.candidates.length, 9);
		for (const scored of result.candidates) {
			assert.strictEqual(scored.candidate.nodes.length, 1);
			assert.strictEqual(scored.candidate.topology, 'single');
		}
	});

	test('determinism: two identical requests yield deep-equal results', () => {
		const first = searchOrganizations(makeRequest());
		const second = searchOrganizations(makeRequest());
		assert.ok(first && second);
		assert.deepStrictEqual(second, first);
	});

	test('determinism: the caller request object is not mutated', () => {
		const request = makeRequest();
		const before = {
			scope: { ...request.scope },
			scenarioId: request.scenarioId,
			taskTypeId: request.taskTypeId,
			utilityWeights: { ...request.utilityWeights },
			ladderLevel: request.ladderLevel,
			seeds: [...request.seeds],
			maxAgents: request.maxAgents,
		};
		searchOrganizations(request);
		assert.deepStrictEqual(request, before);
	});

	test('enumeration law: maxAgents = 2 yields 9 single-agent plus 36 pairs x 3 topologies, all with unique ids', () => {
		const result = searchOrganizations(makeRequest({ maxAgents: 2 }));
		assert.ok(result);
		assert.strictEqual(result.candidates.length, 117);
		const ids = new Set(result.candidates.map((scored) => scored.candidate.id));
		assert.strictEqual(ids.size, 117);
		const counts = new Map<string, number>();
		for (const scored of result.candidates) {
			assert.ok(scored.candidate.id.startsWith('org-scenario-se-bugfix-regression-'));
			const n = scored.candidate.nodes.length;
			assert.ok(n === 1 || n === 2, `expected org size 1 or 2, got ${n}`);
			if (n === 1) {
				assert.strictEqual(scored.candidate.topology, 'single');
			} else {
				assert.ok(scored.candidate.topology === 'pipeline' || scored.candidate.topology === 'hierarchical' || scored.candidate.topology === 'hub-and-spoke');
			}
			counts.set(scored.candidate.topology, (counts.get(scored.candidate.topology) ?? 0) + 1);
		}
		assert.deepStrictEqual([...counts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)), [
			['hierarchical', 36],
			['hub-and-spoke', 36],
			['pipeline', 36],
			['single', 9],
		]);
	});

	test('enumeration law: body sets follow canonical catalog-order combinations with dense combo indices', () => {
		const result = searchOrganizations(makeRequest({ maxAgents: 2 }));
		assert.ok(result);
		const details = result.trace.filter((step) => step.kind === 'enumerate').map((step) => step.detail);
		assert.strictEqual(details.length, 117);
		for (let i = 0; i < 9; i++) {
			assert.strictEqual(details[i], `org-scenario-se-bugfix-regression-n1-single-${i} | bodies: ${CATALOG_BODY_IDS[i]}`);
		}
		const expectedPairs: string[][] = [];
		for (let i = 0; i < 9; i++) {
			for (let j = i + 1; j < 9; j++) {
				expectedPairs.push([CATALOG_BODY_IDS[i], CATALOG_BODY_IDS[j]]);
			}
		}
		assert.strictEqual(expectedPairs.length, 36);
		for (let k = 0; k < expectedPairs.length; k++) {
			assert.strictEqual(details[9 + k], `org-scenario-se-bugfix-regression-n2-pipeline-${k} | bodies: ${expectedPairs[k].join(', ')}`);
		}
	});

	test('bounds: maxAgents = 0 is clamped to 1', () => {
		const result = searchOrganizations(makeRequest({ maxAgents: 0 }));
		assert.ok(result);
		assert.strictEqual(result.candidates.length, 9);
		for (const scored of result.candidates) {
			assert.strictEqual(scored.candidate.nodes.length, 1);
		}
	});

	test('bounds: maxAgents = 99 is clamped to 5', () => {
		const result = searchOrganizations(makeRequest({ maxAgents: 99 }));
		assert.ok(result);
		assert.strictEqual(result.candidates.length, 1125);
		let maxSize = 0;
		for (const scored of result.candidates) {
			maxSize = Math.max(maxSize, scored.candidate.nodes.length);
		}
		assert.strictEqual(maxSize, 5);
	});

	test('scoring law: baseline scores follow the frozen formulas with inverted (lower-better) latency and cost', () => {
		const result = searchOrganizations(makeRequest({ maxAgents: 1 }));
		assert.ok(result);
		const baseline = result.baseline;
		const difficulty = 0.45;
		const requiredCount = 3;
		const covered = baseline.coveredCapabilities;
		assert.ok(covered >= 0 && covered <= requiredCount, `covered count ${covered} out of range`);
		assert.deepStrictEqual(baseline.scores.map((score) => score.dimension), ['success', 'quality', 'latency', 'cost']);
		for (const score of baseline.scores) {
			assert.ok(score.value >= 0 && score.value <= 1, `${score.dimension} must be within 0..1`);
		}
		const success = scoreValue(baseline, 'success');
		const quality = scoreValue(baseline, 'quality');
		const latency = scoreValue(baseline, 'latency');
		const cost = scoreValue(baseline, 'cost');
		closeTo(latency, 0.2 + 0.12 * 1 + 0.1 * difficulty);
		closeTo(latency, 0.365);
		closeTo(cost, 0.15 + 0.15 * 1 + 0.1 * difficulty);
		closeTo(cost, 0.345);
		closeTo(success, 0.35 + 0.5 * (covered / requiredCount) + 0.15 * 0 - 0.25 * difficulty);
		closeTo(quality, 0.3 + 0.4 * (covered / requiredCount) + 0.2 * 0 - 0.15 * difficulty);
		closeTo(baseline.utility, 0.4 * success + 0.3 * quality + 0.2 * (1 - latency) + 0.1 * (1 - cost));
		assert.ok(baseline.utility > 0.4 * success + 0.3 * quality + 0.2 * latency + 0.1 * cost, 'latency and cost must enter utility inverted (both are < 0.5 here, so inversion raises the utility above the raw-weighted sum)');
	});

	test('coverage influence: at equal size and topology, covering more required capabilities yields strictly higher success', () => {
		const result = searchOrganizations(makeRequest({ maxAgents: 2, taskTypeId: 'tt-feature-addition' }));
		assert.ok(result);
		const groups = new Map<string, ScoredCandidate[]>();
		for (const scored of result.candidates) {
			const key = `${scored.candidate.nodes.length}:${scored.candidate.topology}`;
			const group = groups.get(key) ?? [];
			group.push(scored);
			groups.set(key, group);
		}
		let found = false;
		outer: for (const group of groups.values()) {
			for (let i = 0; i < group.length && !found; i++) {
				for (let j = 0; j < group.length; j++) {
					if (group[i].coveredCapabilities > group[j].coveredCapabilities) {
						const successI = scoreValue(group[i], 'success');
						const successJ = scoreValue(group[j], 'success');
						assert.ok(successI > successJ, `expected success ${successI} > ${successJ} for coverage ${group[i].coveredCapabilities} > ${group[j].coveredCapabilities}`);
						found = true;
						continue outer;
					}
				}
			}
		}
		assert.ok(found, 'fixture catalog yielded no coverage variation within any (size, topology) group');
	});

	test('ranking law: candidates are sorted by utility desc with candidate-id asc tie-break', () => {
		const result = searchOrganizations(makeRequest({ maxAgents: 2 }));
		assert.ok(result);
		const candidates = result.candidates;
		let ties = 0;
		for (let i = 0; i + 1 < candidates.length; i++) {
			const current = candidates[i];
			const next = candidates[i + 1];
			if (current.utility === next.utility) {
				ties += 1;
				assert.ok(current.candidate.id < next.candidate.id, `tie must break by id asc: ${current.candidate.id} before ${next.candidate.id}`);
			} else {
				assert.ok(current.utility > next.utility, `utilities must strictly descend (index ${i})`);
			}
		}
		assert.ok(ties > 0, 'expected at least one utility tie to exercise the id tie-break');
	});

	test('trace law: dense 1-based steps, all enumerate then all score then one final rank naming the best', () => {
		const result = searchOrganizations(makeRequest({ maxAgents: 1 }));
		assert.ok(result);
		const trace = result.trace;
		assert.strictEqual(trace.length, 2 * 9 + 1);
		for (let i = 0; i < trace.length; i++) {
			assert.strictEqual(trace[i].step, i + 1, `step ${i} must be dense 1-based`);
		}
		for (let i = 0; i < 9; i++) {
			assert.strictEqual(trace[i].kind, 'enumerate');
			assert.ok(trace[i].detail.includes(' | bodies: '), trace[i].detail);
		}
		for (let i = 9; i < 18; i++) {
			assert.strictEqual(trace[i].kind, 'score');
			assert.ok(trace[i].detail.includes(' | utility: '), trace[i].detail);
		}
		assert.strictEqual(trace[18].kind, 'rank');
		assert.ok(trace[18].detail.includes('enumerated: 9'), trace[18].detail);
		assert.ok(trace[18].detail.includes(`best: ${result.best.candidate.id}`), trace[18].detail);
	});

	test('contract law: contractVersion pinned, scope and request echoed verbatim, fixture evidence everywhere', () => {
		const request = makeRequest();
		const result = searchOrganizations(request);
		assert.ok(result);
		assert.strictEqual(result.contractVersion, '1.0.0');
		assert.deepStrictEqual(result.scope, { workspaceId: 'lab-fixtures', tenantId: 'lab-fixtures' });
		assert.deepStrictEqual(result.request, request);
		assert.strictEqual(result.request.ladderLevel, request.ladderLevel);
		assert.deepStrictEqual(result.request.seeds, [1, 2, 3]);
		for (const scored of result.candidates) {
			assert.strictEqual(scored.evidenceLevel, 'fixture');
		}
		assert.strictEqual(result.baseline.evidenceLevel, 'fixture');
		assert.strictEqual(result.best.evidenceLevel, 'fixture');
	});

	test('fixture tables: scenario difficulty covers the 3 fixture scenarios plus _default 0.5', () => {
		assert.deepStrictEqual(FIXTURE_SCENARIO_DIFFICULTY, {
			'scenario-se-bugfix-regression': 0.45,
			'scenario-se-feature-addition': 0.6,
			'scenario-se-flaky-investigation': 0.5,
			'_default': 0.5,
		});
	});

	test('fixture tables: required capabilities have 2-4 in-range entries and the frozen bugfix set', () => {
		assert.ok(FIXTURE_REQUIRED_CAPABILITIES['_default']);
		for (const entries of Object.values(FIXTURE_REQUIRED_CAPABILITIES)) {
			assert.ok(entries.length >= 2 && entries.length <= 4, `expected 2-4 entries, got ${entries.length}`);
			for (const entry of entries) {
				assert.ok(entry.capabilityId.length > 0);
				assert.ok(entry.requiredLevel >= 0 && entry.requiredLevel <= 1, `requiredLevel ${entry.requiredLevel} out of 0..1`);
			}
		}
		assert.deepStrictEqual(FIXTURE_REQUIRED_CAPABILITIES['tt-bugfix-regression'], [
			{ capabilityId: 'code-writing', requiredLevel: 0.6 },
			{ capabilityId: 'debugging', requiredLevel: 0.7 },
			{ capabilityId: 'test-design', requiredLevel: 0.4 },
		]);
	});

	test('fixture model law: every occupancy in every candidate seats the fixed fixture model id', () => {
		const result = searchOrganizations(makeRequest({ maxAgents: 2 }));
		assert.ok(result);
		assert.strictEqual(FIXTURE_MODEL_ID, 'model-fixture-m');
		for (const scored of result.candidates) {
			assert.ok(scored.candidate.occupancy.length > 0, `candidate ${scored.candidate.id} must have occupancy`);
			for (const occupancy of scored.candidate.occupancy) {
				assert.strictEqual((occupancy as { modelId?: unknown }).modelId, FIXTURE_MODEL_ID, `occupancy in ${scored.candidate.id} must carry ${FIXTURE_MODEL_ID}`);
			}
		}
	});

	test('level-agnostic search: ladderLevel and seeds are recorded but never influence the search', () => {
		const base = searchOrganizations(makeRequest({ ladderLevel: 0, seeds: [1] }));
		const variant = searchOrganizations(makeRequest({ ladderLevel: 2, seeds: [7, 9] }));
		assert.ok(base && variant);
		assert.strictEqual(variant.request.ladderLevel, 2);
		assert.deepStrictEqual(variant.request.seeds, [7, 9]);
		assert.deepStrictEqual(variant.candidates, base.candidates);
		assert.deepStrictEqual(variant.trace, base.trace);
	});

	test('fixture seams: unknown scenario and task type fall back to the _default entries', () => {
		const result = searchOrganizations(makeRequest({ scenarioId: 'scenario-se-unknown-thing', taskTypeId: 'tt-unknown-thing' }));
		assert.ok(result);
		closeTo(scoreValue(result.baseline, 'latency'), 0.2 + 0.12 * 1 + 0.1 * 0.5);
		closeTo(scoreValue(result.baseline, 'cost'), 0.15 + 0.15 * 1 + 0.1 * 0.5);
		for (const scored of result.candidates) {
			assert.ok(scored.coveredCapabilities <= 2, 'default task type has only 2 required capabilities');
		}
	});
});
