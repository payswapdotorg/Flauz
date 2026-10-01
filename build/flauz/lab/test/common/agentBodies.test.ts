/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Unit tests for build/flauz/lab/common/agentBodies.ts (LAB-004, Flauz, TL-B lane).
 *
 * Evidence honesty: the real gate is the Flauz repo test harness (mocha-shaped suite/test
 * globals plus the final in-repo import path '../../common/agentBodies.js'), which this
 * authoring pod cannot run. At most a local shim smoke-run was used while authoring, and
 * that is not gate evidence. TL-B runs the real gate.
 */

import assert from 'assert';

import {
	AGENT_BODY_CATALOG,
	BODY_BENCHMARKS,
	assembleOrganization,
	capabilityCoverage,
	getBody,
	instantiateBody,
	listBodiesByArchetype,
	type BodyInstantiation,
} from '../../common/agentBodies.js';

// The Flauz repo harness provides mocha-shaped suite/test globals; these ambient declarations
// keep this file dependency-free. Nothing executes here without that harness.
declare function suite(name: string, fn: () => void): void;
declare function test(name: string, fn: () => void): void;

const SCOPE = { workspaceId: 'lab-fixtures', tenantId: 'lab-fixtures' };

const CATALOG_IDS = new Set([
	'body-solo-generalist',
	'body-planner-lead',
	'body-implementer',
	'body-code-reviewer',
	'body-verifier',
	'body-researcher',
	'body-integrator',
	'body-oncall-triager',
	'body-refactor-sweeper',
]);

function seat(bodyId: string, nodeId: string): BodyInstantiation {
	return instantiateBody(bodyId, { nodeId, modelId: `model-${nodeId}`, toolIds: [] })!;
}

suite('agentBodies', () => {

	test('catalog law: exactly 9 bodies with unique ids from the fixed id set', () => {
		assert.strictEqual(AGENT_BODY_CATALOG.length, 9);
		const ids = AGENT_BODY_CATALOG.map(body => body.id);
		assert.strictEqual(new Set(ids).size, 9);
		assert.deepStrictEqual(new Set(ids), CATALOG_IDS);
	});

	test('catalog law: every body is modelAgnostic, contractVersion pinned, scope fixed', () => {
		for (const body of AGENT_BODY_CATALOG) {
			assert.strictEqual(body.modelAgnostic, true, body.id);
			assert.strictEqual(body.contractVersion, '1.0.0', body.id);
			assert.deepStrictEqual(body.scope, { workspaceId: 'lab-fixtures', tenantId: 'lab-fixtures' }, body.id);
		}
	});

	test('catalog law: capabilities, budgets, hooks and protocols stay inside spec bounds', () => {
		for (const body of AGENT_BODY_CATALOG) {
			const scores = Object.values(body.capabilities);
			assert.ok(scores.length >= 4 && scores.length <= 6, `${body.id}: capability count`);
			for (const score of scores) {
				assert.ok(score >= 0 && score <= 1, `${body.id}: capability score bounds`);
			}
			assert.ok(body.budget.maxCostUsd >= 0.2 && body.budget.maxCostUsd <= 2.0, `${body.id}: cost budget`);
			assert.ok(body.budget.maxLatencyMs >= 15_000 && body.budget.maxLatencyMs <= 600_000, `${body.id}: latency budget`);
			assert.ok(body.evaluationHooks.length >= 1 && body.evaluationHooks.length <= 3, `${body.id}: evaluation hook count`);
			assert.ok(body.communication.length >= 1 && body.communication.length <= 3, `${body.id}: communication count`);
			assert.ok(body.tools.length > 0 && body.permissions.length > 0, `${body.id}: tools and permissions non-empty`);
		}
	});

	test('archetype coverage: all 6 archetypes present and coder has >= 2 bodies', () => {
		const archetypes = new Set(AGENT_BODY_CATALOG.map(body => body.archetype));
		assert.deepStrictEqual(archetypes, new Set(['planner', 'coder', 'reviewer', 'verifier', 'researcher', 'integrator']));
		assert.ok(listBodiesByArchetype('coder').length >= 2);
	});

	test('archetype coverage: the two coder bodies are implementer and refactor-sweeper', () => {
		const coderIds = listBodiesByArchetype('coder').map(body => body.id);
		assert.deepStrictEqual(new Set(coderIds), new Set(['body-implementer', 'body-refactor-sweeper']));
	});

	test('getBody: hit returns the matching descriptor, miss returns undefined', () => {
		const body = getBody('body-verifier');
		assert.strictEqual(body?.id, 'body-verifier');
		assert.strictEqual(getBody('body-does-not-exist'), undefined);
	});

	test('listBodiesByArchetype: returns only that archetype, in catalog order', () => {
		const archetypes = ['planner', 'coder', 'reviewer', 'verifier', 'researcher', 'integrator'] as const;
		for (const archetype of archetypes) {
			const bodies = listBodiesByArchetype(archetype);
			assert.ok(bodies.length >= 1, archetype);
			const positions = bodies.map(body => AGENT_BODY_CATALOG.indexOf(body));
			for (let i = 0; i < bodies.length; i++) {
				assert.strictEqual(bodies[i].archetype, archetype);
				if (i > 0) {
					assert.ok(positions[i] > positions[i - 1], `${archetype}: catalog order`);
				}
			}
		}
	});

	test('instantiateBody: sets body, occupancy and capability fields for the node', () => {
		const instantiation = instantiateBody('body-implementer', {
			nodeId: 'node-impl',
			modelId: 'model-fixture-a',
			toolIds: ['tool:fs.read', 'tool:fs.write'],
		});
		assert.ok(instantiation);
		assert.strictEqual(instantiation.body.id, 'body-implementer');
		assert.deepStrictEqual(instantiation.occupancy, { nodeId: 'node-impl', modelId: 'model-fixture-a' });
		assert.deepStrictEqual(instantiation.capabilities, { nodeId: 'node-impl', toolIds: ['tool:fs.read', 'tool:fs.write'] });
	});

	test('instantiateBody: unknown bodyId yields undefined', () => {
		assert.strictEqual(instantiateBody('body-ghost', { nodeId: 'node-x', modelId: 'model-x', toolIds: ['tool:fs.read'] }), undefined);
	});

	test('instantiateBody: allow-list filtering drops non-allowed tools', () => {
		const instantiation = instantiateBody('body-implementer', {
			nodeId: 'node-x',
			modelId: 'model-x',
			toolIds: ['tool:fs.read', 'tool:fs.write', 'tool:shell.exec'],
			allowedToolIds: ['tool:fs.read'],
		});
		assert.deepStrictEqual(instantiation?.capabilities.toolIds, ['tool:fs.read']);
	});

	test('instantiateBody: body.tools is the ceiling even when the allow-list is wider', () => {
		const instantiation = instantiateBody('body-code-reviewer', {
			nodeId: 'node-x',
			modelId: 'model-x',
			toolIds: ['tool:fs.read', 'tool:git.diff', 'tool:shell.exec'],
			allowedToolIds: ['tool:fs.read', 'tool:git.diff', 'tool:shell.exec'],
		});
		// body-code-reviewer.tools has no 'tool:shell.exec', so not even an explicit allow-list grants it
		assert.deepStrictEqual(instantiation?.capabilities.toolIds, ['tool:fs.read', 'tool:git.diff']);
	});

	test('instantiateBody: without an allow-list the body own tools are the grant set', () => {
		const instantiation = instantiateBody('body-verifier', {
			nodeId: 'node-x',
			modelId: 'model-x',
			toolIds: ['tool:fs.read', 'tool:web.search'],
		});
		// 'tool:web.search' is not part of body-verifier.tools, so it is dropped
		assert.deepStrictEqual(instantiation?.capabilities.toolIds, ['tool:fs.read']);
	});

	test('assembleOrganization: single topology from one instantiation has no edges', () => {
		const solo = seat('body-solo-generalist', 'node-solo');
		const org = assembleOrganization(SCOPE, 'org-single', 'Solo fixture', 'single', [solo])!;
		assert.strictEqual(org.topology, 'single');
		assert.strictEqual(org.nodes.length, 1);
		assert.strictEqual(org.nodes[0].id, 'node-solo');
		assert.strictEqual(org.nodes[0].bodyId, 'body-solo-generalist');
		assert.strictEqual(org.nodes[0].reportsTo, undefined);
		assert.deepStrictEqual(org.edges, []);
		assert.deepStrictEqual(org.occupancy, [{ nodeId: 'node-solo', modelId: 'model-node-solo' }]);
	});

	test('assembleOrganization: pipeline chains in lead order with handoff edges', () => {
		const research = seat('body-researcher', 'node-research');
		const impl = seat('body-implementer', 'node-impl');
		const verify = seat('body-verifier', 'node-verify');
		const org = assembleOrganization(SCOPE, 'org-pipeline', 'Pipeline fixture', 'pipeline', [research, impl, verify], undefined, 'node-impl')!;
		assert.deepStrictEqual(org.edges, [
			{ from: 'node-impl', to: 'node-research', kind: 'handoff' },
			{ from: 'node-research', to: 'node-verify', kind: 'handoff' },
		]);
		for (const node of org.nodes) {
			assert.strictEqual(node.reportsTo, undefined);
		}
	});

	test('assembleOrganization: pipeline uses provided edges verbatim instead of synthesizing', () => {
		const research = seat('body-researcher', 'node-research');
		const impl = seat('body-implementer', 'node-impl');
		const org = assembleOrganization(SCOPE, 'org-pipeline-explicit', 'Pipeline explicit edges', 'pipeline', [research, impl], [
			{ fromNodeId: 'node-research', toNodeId: 'node-impl', kind: 'handoff' },
		])!;
		assert.deepStrictEqual(org.edges, [{ from: 'node-research', to: 'node-impl', kind: 'handoff' }]);
	});

	test('assembleOrganization: hierarchical sets reportsTo from leadNodeId', () => {
		const lead = seat('body-planner-lead', 'node-lead');
		const impl = seat('body-implementer', 'node-impl');
		const review = seat('body-code-reviewer', 'node-review');
		const org = assembleOrganization(SCOPE, 'org-hierarchical', 'Hierarchical fixture', 'hierarchical', [lead, impl, review], undefined, 'node-lead')!;
		assert.strictEqual(org.nodes.find(node => node.id === 'node-lead')?.reportsTo, undefined);
		assert.strictEqual(org.nodes.find(node => node.id === 'node-impl')?.reportsTo, 'node-lead');
		assert.strictEqual(org.nodes.find(node => node.id === 'node-review')?.reportsTo, 'node-lead');
		assert.deepStrictEqual(org.edges, [
			{ from: 'node-lead', to: 'node-impl', kind: 'delegation' },
			{ from: 'node-lead', to: 'node-review', kind: 'delegation' },
		]);
	});

	test('assembleOrganization: hub-and-spoke gets edges from lead to all spokes and back', () => {
		const hub = seat('body-planner-lead', 'node-hub');
		const impl = seat('body-implementer', 'node-impl');
		const verify = seat('body-verifier', 'node-verify');
		const org = assembleOrganization(SCOPE, 'org-hub', 'Hub fixture', 'hub-and-spoke', [hub, impl, verify], undefined, 'node-hub')!;
		const spokeTargets = org.edges.filter(edge => edge.from === 'node-hub').map(edge => edge.to);
		assert.deepStrictEqual(spokeTargets, ['node-impl', 'node-verify']);
		for (const spoke of ['node-impl', 'node-verify']) {
			assert.ok(org.edges.some(edge => edge.from === spoke && edge.to === 'node-hub' && edge.kind === 'handoff'), spoke);
		}
		assert.strictEqual(org.nodes.find(node => node.id === 'node-impl')?.reportsTo, 'node-hub');
	});

	test('assembleOrganization: duplicate node ids yield undefined', () => {
		const first = seat('body-implementer', 'node-dup');
		const second = seat('body-refactor-sweeper', 'node-dup');
		assert.strictEqual(assembleOrganization(SCOPE, 'org-dup', 'Duplicate ids', 'single', [first, second]), undefined);
	});

	test('assembleOrganization: empty instantiations yield undefined', () => {
		assert.strictEqual(assembleOrganization(SCOPE, 'org-empty', 'Empty', 'pipeline', []), undefined);
	});

	test('assembleOrganization: an edge referencing an unknown node yields undefined', () => {
		const impl = seat('body-implementer', 'node-impl');
		const org = assembleOrganization(SCOPE, 'org-bad-edge', 'Bad edge', 'pipeline', [impl], [
			{ fromNodeId: 'node-impl', toNodeId: 'node-ghost', kind: 'handoff' },
		]);
		assert.strictEqual(org, undefined);
	});

	test('assembleOrganization: candidate carries the pinned contractVersion and the given scope', () => {
		const solo = seat('body-solo-generalist', 'node-solo');
		const org = assembleOrganization(SCOPE, 'org-meta', 'Meta fixture', 'single', [solo])!;
		assert.strictEqual(org.contractVersion, '1.0.0');
		assert.deepStrictEqual(org.scope, SCOPE);
		assert.deepStrictEqual(org.capabilities, [{ nodeId: 'node-solo', toolIds: [] }]);
	});

	test('capabilityCoverage: covered, uncovered and zero-coverage rows with implied gap', () => {
		const impl = seat('body-implementer', 'node-impl');
		const review = seat('body-code-reviewer', 'node-review');
		const org = assembleOrganization(SCOPE, 'org-coverage', 'Coverage fixture', 'hierarchical', [impl, review], undefined, 'node-impl')!;
		const coverage = capabilityCoverage(org, [
			{ capabilityId: 'code-writing', requiredLevel: 0.8 },
			{ capabilityId: 'review-rigor', requiredLevel: 0.95 },
			{ capabilityId: 'exploration', requiredLevel: 0.5 },
		]);
		assert.deepStrictEqual(coverage[0], { capabilityId: 'code-writing', requiredLevel: 0.8, bestNodeId: 'node-impl', bestScore: 0.9, covered: true });
		// body-code-reviewer tops review-rigor at 0.9; the gap to 0.95 is implied (0.05)
		assert.deepStrictEqual(coverage[1], { capabilityId: 'review-rigor', requiredLevel: 0.95, bestNodeId: 'node-review', bestScore: 0.9, covered: false });
		// neither body carries exploration: best score is 0 and the row is uncovered
		assert.deepStrictEqual(coverage[2], { capabilityId: 'exploration', requiredLevel: 0.5, bestNodeId: 'node-impl', bestScore: 0, covered: false });
	});

	test('capabilityCoverage: bestNodeId picks the max-score node across the org', () => {
		const solo = seat('body-solo-generalist', 'node-solo');
		const impl = seat('body-implementer', 'node-impl');
		const sweeper = seat('body-refactor-sweeper', 'node-sweep');
		const org = assembleOrganization(SCOPE, 'org-best', 'Best node fixture', 'pipeline', [solo, impl, sweeper])!;
		const coverage = capabilityCoverage(org, [{ capabilityId: 'code-writing', requiredLevel: 0.6 }]);
		assert.strictEqual(coverage[0].bestNodeId, 'node-impl');
		assert.strictEqual(coverage[0].bestScore, 0.9);
		assert.strictEqual(coverage[0].covered, true);
	});

	test('BODY_BENCHMARKS: every row scores at or below the body capability map value', () => {
		for (const row of BODY_BENCHMARKS) {
			const body = getBody(row.bodyId);
			assert.ok(body, `unknown bodyId: ${row.bodyId}`);
			const mapScore: number | undefined = body!.capabilities[row.capabilityId];
			assert.ok(mapScore !== undefined, `${row.bodyId} lacks capability: ${row.capabilityId}`);
			assert.ok(row.score <= mapScore!, `${row.bodyId}/${row.capabilityId}: ${row.score} exceeds map value ${mapScore}`);
			assert.ok(row.score >= 0 && row.score <= 1, `${row.bodyId}/${row.capabilityId}: score bounds`);
			assert.ok(row.samples > 0, `${row.bodyId}/${row.capabilityId}: samples`);
		}
	});

	test('BODY_BENCHMARKS: every catalog body has 2-3 rows and only known body ids', () => {
		const rowsPerBody = new Map<string, number>();
		for (const row of BODY_BENCHMARKS) {
			assert.ok(CATALOG_IDS.has(row.bodyId), `benchmark body not in catalog: ${row.bodyId}`);
			rowsPerBody.set(row.bodyId, (rowsPerBody.get(row.bodyId) ?? 0) + 1);
		}
		for (const body of AGENT_BODY_CATALOG) {
			const rows = rowsPerBody.get(body.id) ?? 0;
			assert.ok(rows >= 2 && rows <= 3, `${body.id}: ${rows} rows`);
		}
	});
});
