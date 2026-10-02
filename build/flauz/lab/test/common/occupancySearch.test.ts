/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// NOTE (evidence honesty): these tests are AUTHORED in the worker pod and are NOT executed there  - 
// the sibling modules build/flauz/lab/common/labContracts.ts and agentBodies.ts are not present in
// the pod. The TL runs the real gate on Flauz main.

import assert from 'assert';
import {
	MODEL_FIXTURES,
	TOOL_CAPABILITY_FIXTURES,
	OCCUPANCY_REQUIRED_CAPABILITIES,
	OCCUPANCY_SCENARIO_DIFFICULTY,
	searchOccupancies,
	type OccupancySearchRequest,
	type ScoredAssignment,
} from '../../common/occupancySearch.js';

/** Build a fixed valid request with optional overrides. */
function makeRequest(overrides?: Partial<OccupancySearchRequest>): OccupancySearchRequest {
	return {
		scope: { workspaceId: 'lab-fixtures', tenantId: 'lab-fixtures' },
		scenarioId: 'scenario-se-bugfix-regression',
		taskTypeId: 'tt-bugfix-regression-tests',
		utilityWeights: { success: 0.25, quality: 0.25, latency: 0.25, cost: 0.25 },
		bodyIds: ['body-implementer'],
		modelIds: ['model-fixture-l'],
		toolModes: ['all'],
		...overrides,
	};
}

/** Extract one dimension's value from a scored assignment's scores. */
function scoreValue(assignment: ScoredAssignment, dimension: 'success' | 'quality' | 'latency' | 'cost'): number {
	const entry = assignment.scores.find((candidate) => candidate.dimension === dimension);
	assert.ok(entry, `missing ${dimension} score`);
	return entry.value;
}

/** Assignment signature: model ids joined '+' then the tool mode. */
function signatureOf(assignment: ScoredAssignment): string {
	return `${assignment.models.map((occupancy) => occupancy.modelId).join('+')}+${assignment.toolMode}`;
}

suite('occupancySearch', () => {

	test('validation: rejects invalid utility weights, accepts valid ones', () => {
		assert.strictEqual(searchOccupancies(makeRequest({ utilityWeights: { success: -0.25, quality: 0.5, latency: 0.4, cost: 0.35 } })), undefined);
		assert.strictEqual(searchOccupancies(makeRequest({ utilityWeights: { success: 0.4, quality: 0.4, latency: 0.4, cost: 0.2 } })), undefined);
		assert.ok(searchOccupancies(makeRequest({ utilityWeights: { success: 0.3, quality: 0.2, latency: 0.3, cost: 0.2 } })));
		assert.ok(searchOccupancies(makeRequest({ utilityWeights: { success: 0.25, quality: 0.25, latency: 0.25, cost: 0.2499999995 } })));
	});

	test('validation: rejects invalid bodyIds, accepts valid ones', () => {
		assert.strictEqual(searchOccupancies(makeRequest({ bodyIds: [] })), undefined);
		assert.strictEqual(searchOccupancies(makeRequest({ bodyIds: ['body-implementer', 'body-verifier', 'body-researcher', 'body-integrator'] })), undefined);
		assert.strictEqual(searchOccupancies(makeRequest({ bodyIds: ['body-implementer', 'body-not-in-library'] })), undefined);
		assert.ok(searchOccupancies(makeRequest({ bodyIds: ['body-implementer', 'body-verifier', 'body-researcher'] })));
	});

	test('validation: rejects invalid modelIds, accepts valid ones', () => {
		assert.strictEqual(searchOccupancies(makeRequest({ modelIds: [] })), undefined);
		assert.strictEqual(searchOccupancies(makeRequest({ modelIds: ['model-fixture-l', 'model-fixture-l'] })), undefined);
		assert.strictEqual(searchOccupancies(makeRequest({ modelIds: ['model-fixture-l', 'model-fixture-turbo'] })), undefined);
		assert.strictEqual(searchOccupancies(makeRequest({ modelIds: ['model-fixture-m', 'model-fixture-s', 'model-fixture-l', 'model-fixture-xl', 'model-fixture-m'] })), undefined);
		assert.ok(searchOccupancies(makeRequest({ modelIds: ['model-fixture-m', 'model-fixture-s', 'model-fixture-l', 'model-fixture-xl'] })));
	});

	test('validation: rejects invalid toolModes, accepts valid ones', () => {
		assert.strictEqual(searchOccupancies(makeRequest({ toolModes: [] })), undefined);
		assert.strictEqual(searchOccupancies(makeRequest({ toolModes: ['all', 'all'] })), undefined);
		assert.strictEqual(searchOccupancies(makeRequest({ toolModes: ['lean', 'lean'] })), undefined);
		assert.ok(searchOccupancies(makeRequest({ toolModes: ['lean'] })));
		assert.ok(searchOccupancies(makeRequest({ toolModes: ['lean', 'all'] })));
	});

	test('baseline law: all nodes on modelIds[0], toolMode all when requested, always in candidates', () => {
		const result = searchOccupancies(makeRequest({
			bodyIds: ['body-implementer', 'body-verifier'],
			modelIds: ['model-fixture-l', 'model-fixture-m'],
			toolModes: ['lean', 'all'],
		}));
		assert.ok(result);
		assert.strictEqual(result.baseline.toolMode, 'all');
		assert.deepStrictEqual(result.baseline.models.map((occupancy) => occupancy.modelId), ['model-fixture-l', 'model-fixture-l']);
		assert.ok(result.candidates.includes(result.baseline));
		const leanOnly = searchOccupancies(makeRequest({ toolModes: ['lean'] }));
		assert.ok(leanOnly);
		assert.strictEqual(leanOnly.baseline.toolMode, 'lean');
	});

	test('determinism: identical requests yield deep-identical results and the request is not mutated', () => {
		const request = makeRequest({
			bodyIds: ['body-implementer', 'body-verifier'],
			modelIds: ['model-fixture-m', 'model-fixture-l'],
			toolModes: ['all', 'lean'],
		});
		const snapshot = JSON.parse(JSON.stringify(request)) as OccupancySearchRequest;
		const first = searchOccupancies(request);
		const second = searchOccupancies(request);
		assert.ok(first);
		assert.ok(second);
		assert.deepStrictEqual(first, second);
		assert.deepStrictEqual(request, snapshot);
		assert.notStrictEqual(first.request, request);
	});

	test('enumeration law: 1 body x 2 models x 2 modes = 4 unique candidates including the baseline', () => {
		const result = searchOccupancies(makeRequest({
			bodyIds: ['body-implementer'],
			modelIds: ['model-fixture-m', 'model-fixture-l'],
			toolModes: ['all', 'lean'],
		}));
		assert.ok(result);
		assert.strictEqual(result.candidates.length, 4);
		const signatures = result.candidates.map(signatureOf);
		assert.strictEqual(new Set(signatures).size, 4);
		for (const expected of ['model-fixture-m+all', 'model-fixture-m+lean', 'model-fixture-l+all', 'model-fixture-l+lean']) {
			assert.ok(signatures.includes(expected), `missing candidate ${expected}`);
		}
	});

	test('enumeration law: node-major lexicographic model tuples on MODEL_FIXTURES order, baseline enumerated first', () => {
		const result = searchOccupancies(makeRequest({
			bodyIds: ['body-implementer', 'body-verifier'],
			modelIds: ['model-fixture-s', 'model-fixture-m'],
			toolModes: ['lean', 'all'],
		}));
		assert.ok(result);
		const enumerateDetails = result.trace.filter((step) => step.kind === 'enumerate').map((step) => step.detail);
		assert.deepStrictEqual(enumerateDetails, [
			'model-fixture-s+model-fixture-s+all',
			'model-fixture-m+model-fixture-m+lean',
			'model-fixture-m+model-fixture-m+all',
			'model-fixture-m+model-fixture-s+lean',
			'model-fixture-m+model-fixture-s+all',
			'model-fixture-s+model-fixture-m+lean',
			'model-fixture-s+model-fixture-m+all',
			'model-fixture-s+model-fixture-s+lean',
		]);
	});

	test('roadmap lane (a): same body with different models yields per-model comparisons with different scores', () => {
		const result = searchOccupancies(makeRequest({
			bodyIds: ['body-implementer'],
			modelIds: ['model-fixture-m', 'model-fixture-l'],
			toolModes: ['all'],
		}));
		assert.ok(result);
		assert.strictEqual(result.candidates.length, 2);
		const mini = result.candidates.find((candidate) => signatureOf(candidate) === 'model-fixture-m+all');
		const large = result.candidates.find((candidate) => signatureOf(candidate) === 'model-fixture-l+all');
		assert.ok(mini);
		assert.ok(large);
		assert.notDeepStrictEqual(mini.scores, large.scores);
		assert.notStrictEqual(mini.utility, large.utility);
		// cost and latency are pure model-fixture formulas (body-independent): exact values, lower-better
		assert.strictEqual(scoreValue(mini, 'cost'), 0.05 / 2.4);
		assert.strictEqual(scoreValue(large, 'cost'), 0.35 / 2.4);
		assert.strictEqual(scoreValue(mini, 'latency'), 0.15 + 0.15 * 1 + 0.25 * (0.7 - 0.7) + 0.1 * 0.45);
		assert.strictEqual(scoreValue(large, 'latency'), 0.15 + 0.15 * 1 + 0.25 * (1.15 - 0.7) + 0.1 * 0.45);
	});

	test('roadmap lane (b): different bodies with the same model yield different coverage; the mixed org is enumerated', () => {
		const implementer = searchOccupancies(makeRequest({ bodyIds: ['body-implementer'], modelIds: ['model-fixture-l'] }));
		const researcher = searchOccupancies(makeRequest({ bodyIds: ['body-researcher'], modelIds: ['model-fixture-l'] }));
		const duo = searchOccupancies(makeRequest({ bodyIds: ['body-implementer', 'body-researcher'], modelIds: ['model-fixture-l'] }));
		assert.ok(implementer);
		assert.ok(researcher);
		assert.ok(duo);
		assert.notDeepStrictEqual(implementer.baseline.gaps, researcher.baseline.gaps);
		assert.notDeepStrictEqual(duo.baseline.gaps, researcher.baseline.gaps);
		// org capability = max over nodes: the duo can only cover more, so its gaps are a subset of each solo's gaps
		for (const gap of duo.baseline.gaps) {
			assert.ok(implementer.baseline.gaps.some((row) => row.capabilityId === gap.capabilityId), `unexpected new gap in duo: ${gap.capabilityId}`);
			assert.ok(researcher.baseline.gaps.some((row) => row.capabilityId === gap.capabilityId), `unexpected new gap in duo: ${gap.capabilityId}`);
		}
	});

	test('roadmap lane (c): mixed model assignments within one organization are enumerated', () => {
		const result = searchOccupancies(makeRequest({
			bodyIds: ['body-implementer', 'body-verifier'],
			modelIds: ['model-fixture-m', 'model-fixture-l'],
			toolModes: ['all'],
		}));
		assert.ok(result);
		assert.strictEqual(result.candidates.length, 4);
		const signatures = result.candidates.map(signatureOf);
		for (const expected of ['model-fixture-m+model-fixture-m+all', 'model-fixture-m+model-fixture-l+all', 'model-fixture-l+model-fixture-m+all', 'model-fixture-l+model-fixture-l+all']) {
			assert.ok(signatures.includes(expected), `missing mixed org assignment ${expected}`);
		}
		for (const candidate of result.candidates) {
			assert.deepStrictEqual(candidate.bodyIds, ['body-implementer', 'body-verifier']);
			assert.deepStrictEqual(candidate.models.map((occupancy) => occupancy.nodeId), ['node-0', 'node-1']);
		}
	});

	test('scoring law: hand-computed utility for the baseline; latency and cost are lower-better and inverted in utility', () => {
		const weights = { success: 0.3, quality: 0.2, latency: 0.3, cost: 0.2 };
		const result = searchOccupancies(makeRequest({
			utilityWeights: weights,
			bodyIds: ['body-implementer'],
			modelIds: ['model-fixture-l'],
			toolModes: ['all'],
		}));
		assert.ok(result);
		const baseline = result.baseline;
		const success = scoreValue(baseline, 'success');
		const quality = scoreValue(baseline, 'quality');
		const latency = scoreValue(baseline, 'latency');
		const cost = scoreValue(baseline, 'cost');
		// body-independent formulas: exact latency and cost per the scoring law
		assert.strictEqual(latency, 0.15 + 0.15 * 1 + 0.25 * (1.15 - 0.7) + 0.1 * 0.45);
		assert.strictEqual(cost, 0.35 / 2.4);
		// exact utility identity recomputed from the reported scores (same arithmetic as the module)
		assert.strictEqual(baseline.utility, weights.success * success + weights.quality * quality + weights.latency * (1 - latency) + weights.cost * (1 - cost));
		assert.ok(success >= 0 && success <= 1);
		assert.ok(quality >= 0 && quality <= 1);
		// lower-better inversion: the faster, cheaper model contributes more (1 - x) to utility
		const pair = searchOccupancies(makeRequest({
			utilityWeights: weights,
			bodyIds: ['body-implementer'],
			modelIds: ['model-fixture-m', 'model-fixture-l'],
			toolModes: ['all'],
		}));
		assert.ok(pair);
		const mini = pair.candidates.find((candidate) => signatureOf(candidate) === 'model-fixture-m+all');
		const large = pair.candidates.find((candidate) => signatureOf(candidate) === 'model-fixture-l+all');
		assert.ok(mini);
		assert.ok(large);
		assert.ok(scoreValue(mini, 'latency') < scoreValue(large, 'latency'));
		assert.ok(1 - scoreValue(mini, 'latency') > 1 - scoreValue(large, 'latency'));
		assert.ok(scoreValue(mini, 'cost') < scoreValue(large, 'cost'));
		assert.ok(1 - scoreValue(mini, 'cost') > 1 - scoreValue(large, 'cost'));
	});

	test('gap law: missing required capabilities emit explicit CapabilityRequirement rows', () => {
		const scenarioId = 'scenario-se-feature-addition';
		const taskTypeId = 'tt-feature-addition-tests';
		const result = searchOccupancies(makeRequest({
			scenarioId,
			taskTypeId,
			bodyIds: ['body-oncall-triager'],
			modelIds: ['model-fixture-m'],
			toolModes: ['all'],
		}));
		assert.ok(result);
		assert.ok(result.baseline.gaps.length >= 1, 'expected the triager body to lack at least one feature-addition capability');
		const required = OCCUPANCY_REQUIRED_CAPABILITIES[taskTypeId] ?? [];
		for (const gap of result.baseline.gaps) {
			assert.strictEqual(gap.id, `req-${scenarioId}-${gap.capabilityId}`);
			assert.strictEqual(gap.status, 'unavailable');
			assert.strictEqual(gap.grantRequiresApproval, true);
			assert.deepStrictEqual(gap.scope, { workspaceId: 'lab-fixtures', tenantId: 'lab-fixtures' });
			assert.strictEqual(gap.contractVersion, '1.0.0');
			const requirement = required.find((entry) => entry.capabilityId === gap.capabilityId);
			assert.ok(requirement, `gap references unknown capability ${gap.capabilityId}`);
			assert.strictEqual(gap.requiredLevel, requirement?.requiredLevel);
		}
	});

	test('gap law: a fully-covering organization emits zero gaps', () => {
		const result = searchOccupancies(makeRequest({
			bodyIds: ['body-implementer', 'body-oncall-triager', 'body-verifier'],
			modelIds: ['model-fixture-xl'],
			toolModes: ['all'],
		}));
		assert.ok(result);
		assert.deepStrictEqual(result.baseline.gaps, []);
		for (const candidate of result.candidates) {
			assert.deepStrictEqual(candidate.gaps, []);
		}
	});

	test('lean mode: grants ceil(tools/2) tools per body in body order', () => {
		const result = searchOccupancies(makeRequest({
			bodyIds: ['body-implementer', 'body-researcher'],
			modelIds: ['model-fixture-l'],
			toolModes: ['all', 'lean'],
		}));
		assert.ok(result);
		const allMode = result.candidates.find((candidate) => candidate.toolMode === 'all');
		const leanMode = result.candidates.find((candidate) => candidate.toolMode === 'lean');
		assert.ok(allMode);
		assert.ok(leanMode);
		assert.strictEqual(allMode.tools.length, 2);
		assert.strictEqual(leanMode.tools.length, 2);
		assert.deepStrictEqual(allMode.tools.map((allocation) => allocation.nodeId), ['node-0', 'node-1']);
		assert.deepStrictEqual(leanMode.tools.map((allocation) => allocation.nodeId), ['node-0', 'node-1']);
		// per node: the lean grant is exactly the first ceil(n/2) tools of the full grant, in body order
		assert.deepStrictEqual(
			leanMode.tools.map((allocation) => allocation.toolIds),
			allMode.tools.map((allocation) => allocation.toolIds.slice(0, Math.ceil(allocation.toolIds.length / 2))),
		);
	});

	test('ranking law: utility desc with the signature ASC tie-break', () => {
		const result = searchOccupancies(makeRequest({
			bodyIds: ['body-implementer', 'body-implementer'],
			modelIds: ['model-fixture-l', 'model-fixture-m'],
			toolModes: ['all'],
		}));
		assert.ok(result);
		assert.strictEqual(result.candidates.length, 4);
		// utilities are non-increasing down the ranked list
		for (let index = 1; index < result.candidates.length; index++) {
			const previous = result.candidates[index - 1];
			const current = result.candidates[index];
			assert.ok(previous);
			assert.ok(current);
			assert.ok(previous.utility >= current.utility, `ranking broken at index ${index}`);
		}
		// the same body on both nodes: swapping the two models is an exact utility tie -> signature ASC tie-break
		const forward = result.candidates.find((candidate) => signatureOf(candidate) === 'model-fixture-l+model-fixture-m+all');
		const swapped = result.candidates.find((candidate) => signatureOf(candidate) === 'model-fixture-m+model-fixture-l+all');
		assert.ok(forward);
		assert.ok(swapped);
		assert.strictEqual(forward.utility, swapped.utility);
		assert.ok(result.candidates.indexOf(forward) < result.candidates.indexOf(swapped), 'signature tie-break must order l+m before m+l');
	});

	test('trace law: dense 1-based steps, kinds in order, final rank step names the best signature', () => {
		const result = searchOccupancies(makeRequest({
			bodyIds: ['body-implementer'],
			modelIds: ['model-fixture-l'],
			toolModes: ['all'],
		}));
		assert.ok(result);
		assert.strictEqual(result.trace.length, 3);
		assert.deepStrictEqual(result.trace.map((step) => step.kind), ['enumerate', 'score', 'rank']);
		assert.deepStrictEqual(result.trace.map((step) => step.step), [1, 2, 3]);
		const signature = 'model-fixture-l+all';
		assert.strictEqual(result.trace[0]?.detail, signature);
		const expectedUtility = 0.25 * scoreValue(result.baseline, 'success') + 0.25 * scoreValue(result.baseline, 'quality') + 0.25 * (1 - scoreValue(result.baseline, 'latency')) + 0.25 * (1 - scoreValue(result.baseline, 'cost'));
		assert.strictEqual(result.trace[1]?.detail, `${signature} utility=${expectedUtility}`);
		assert.strictEqual(result.trace[2]?.detail, `candidates=1 best=${signature}`);
		// a bigger request keeps the steps dense with enumerate -> score -> rank kinds in order
		const bigger = searchOccupancies(makeRequest({
			bodyIds: ['body-implementer'],
			modelIds: ['model-fixture-m', 'model-fixture-l'],
			toolModes: ['all', 'lean'],
		}));
		assert.ok(bigger);
		assert.strictEqual(bigger.trace.length, 9);
		assert.deepStrictEqual(bigger.trace.map((step) => step.kind), ['enumerate', 'enumerate', 'enumerate', 'enumerate', 'score', 'score', 'score', 'score', 'rank']);
		for (let index = 0; index < bigger.trace.length; index++) {
			assert.strictEqual(bigger.trace[index]?.step, index + 1);
		}
		assert.ok(bigger.trace[8]?.detail.includes(signatureOf(bigger.best)));
	});

	test('fixture tables: 4 coherent model fixtures, the exact 9 tool ids, required levels within 0..1', () => {
		assert.strictEqual(MODEL_FIXTURES.length, 4);
		assert.deepStrictEqual(MODEL_FIXTURES.map((fixture) => fixture.id), ['model-fixture-m', 'model-fixture-s', 'model-fixture-l', 'model-fixture-xl']);
		for (const fixture of MODEL_FIXTURES) {
			assert.ok(fixture.name.length > 0);
			assert.ok(fixture.description.length > 0);
			assert.ok(fixture.qualityMultiplier >= 0.8 && fixture.qualityMultiplier <= 1.3, `${fixture.id} qualityMultiplier out of 0.8..1.3`);
			assert.ok(fixture.latencyMultiplier >= 0.7 && fixture.latencyMultiplier <= 1.5, `${fixture.id} latencyMultiplier out of 0.7..1.5`);
			assert.ok(fixture.costUsdPerTask >= 0.05 && fixture.costUsdPerTask <= 0.8, `${fixture.id} costUsdPerTask out of 0.05..0.8`);
			for (const bonus of Object.values(fixture.capabilityBonus)) {
				assert.ok(bonus >= 0 && bonus <= 0.25, `${fixture.id} capabilityBonus out of 0..0.25`);
			}
		}
		assert.deepStrictEqual(Object.keys(TOOL_CAPABILITY_FIXTURES).sort(), ['tool:code.search', 'tool:fs.read', 'tool:fs.write', 'tool:git.diff', 'tool:logs.tail', 'tool:shell.exec', 'tool:test.run', 'tool:web.fetch', 'tool:web.search']);
		assert.deepStrictEqual(TOOL_CAPABILITY_FIXTURES['tool:fs.read'], ['context-synthesis', 'exploration']);
		assert.deepStrictEqual(TOOL_CAPABILITY_FIXTURES['tool:fs.write'], ['code-writing']);
		assert.deepStrictEqual(TOOL_CAPABILITY_FIXTURES['tool:code.search'], ['context-synthesis', 'exploration']);
		assert.deepStrictEqual(TOOL_CAPABILITY_FIXTURES['tool:shell.exec'], ['tool-use', 'debugging']);
		assert.deepStrictEqual(TOOL_CAPABILITY_FIXTURES['tool:test.run'], ['test-design', 'tool-use']);
		assert.deepStrictEqual(TOOL_CAPABILITY_FIXTURES['tool:git.diff'], ['review-rigor', 'context-synthesis']);
		assert.deepStrictEqual(TOOL_CAPABILITY_FIXTURES['tool:logs.tail'], ['debugging', 'context-synthesis']);
		assert.deepStrictEqual(TOOL_CAPABILITY_FIXTURES['tool:web.search'], ['exploration', 'planning-depth']);
		assert.deepStrictEqual(TOOL_CAPABILITY_FIXTURES['tool:web.fetch'], ['exploration', 'tool-use']);
		assert.deepStrictEqual(OCCUPANCY_REQUIRED_CAPABILITIES['tt-bugfix-regression-tests'], [
			{ capabilityId: 'code-writing', requiredLevel: 0.6 },
			{ capabilityId: 'debugging', requiredLevel: 0.7 },
			{ capabilityId: 'test-design', requiredLevel: 0.4 },
		]);
		for (const taskTypeId of ['tt-bugfix-regression-tests', 'tt-feature-addition-tests', 'tt-flaky-investigation-runtime-check', '_default']) {
			const required = OCCUPANCY_REQUIRED_CAPABILITIES[taskTypeId];
			assert.ok(required, `missing required-capability table for ${taskTypeId}`);
			assert.ok(required.length >= 2 && required.length <= 4, `${taskTypeId} must have 2..4 entries`);
			for (const entry of required) {
				assert.ok(entry.requiredLevel >= 0 && entry.requiredLevel <= 1, `${taskTypeId}.${entry.capabilityId} level out of 0..1`);
			}
		}
		assert.deepStrictEqual(OCCUPANCY_SCENARIO_DIFFICULTY, {
			'scenario-se-bugfix-regression': 0.45,
			'scenario-se-feature-addition': 0.6,
			'scenario-se-flaky-investigation': 0.5,
			'_default': 0.5,
		});
	});

	test('contract law: pinned contract version, copied scope, fixture evidence on every candidate', () => {
		const request = makeRequest({
			bodyIds: ['body-implementer', 'body-verifier'],
			modelIds: ['model-fixture-m', 'model-fixture-l'],
			toolModes: ['all', 'lean'],
		});
		const result = searchOccupancies(request);
		assert.ok(result);
		assert.strictEqual(result.contractVersion, '1.0.0');
		assert.deepStrictEqual(result.scope, request.scope);
		assert.notStrictEqual(result.scope, request.scope);
		assert.deepStrictEqual(result.request, request);
		assert.notStrictEqual(result.request, request);
		assert.strictEqual(result.best, result.candidates[0]);
		for (const candidate of result.candidates) {
			assert.strictEqual(candidate.evidenceLevel, 'fixture');
			assert.deepStrictEqual(candidate.models.map((occupancy) => occupancy.nodeId), request.bodyIds.map((_, index) => `node-${index}`));
			assert.deepStrictEqual(candidate.tools.map((allocation) => allocation.nodeId), request.bodyIds.map((_, index) => `node-${index}`));
		}
	});
});
