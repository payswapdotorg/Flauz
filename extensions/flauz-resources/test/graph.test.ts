/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Graph suite: add/update/remove ref; surface VERSIONING (identity survives a
 * path move / endpoint swap -- THE acceptance test of "unification without
 * flattening"); edge legality + remove-with-edges refusal; queries + lineage;
 * persistence round-trip + stable serialization; the bad-fixture matrix.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
	GRAPH_PATH,
	OPS_PATH,
	ResourceGraphError,
	serializeEnvelope,
	type ResourceProvenance,
	type ResourcesEnvelope,
	type Surface,
} from '../src/api.ts';
import { ResourceGraph, toDot, verifyEnvelope, verifyWorkspace } from '../src/graph.ts';
import { AGENT, HUMAN, TOOL, bootGraph, fixedClock, listFixtureFiles, readFixture, runtimeSecretFixture, steppingClock } from './helpers.ts';

const FILE = 'flauz:file:4d5e6f708192a3b4';
const TASK = 'flauz:task:T-001';
const ARTIFACT = 'flauz:artifact:a1b2c3d4e5f60718';
const WORKSPACE = 'flauz:workspace:acme-main';
const ENVIRONMENT = 'flauz:environment:env-staging';
const BROWSER = 'flauz:browser:9c8d7e6f5a4b3c2d';
const MODEL = 'flauz:model:glm-4-7';

async function seededGraph() {
	const t = await bootGraph({ clock: steppingClock() });
	await t.graph.addRef({ kind: 'workspace', id: WORKSPACE, displayName: 'acme', provenance: HUMAN });
	await t.graph.addRef({ kind: 'task', id: TASK, displayName: 'Fix login flow', provenance: AGENT });
	await t.graph.addRef({ kind: 'file', id: FILE, displayName: 'login-form.tsx', provenance: AGENT });
	await t.graph.addRef({ kind: 'artifact', id: ARTIFACT, provenance: TOOL });
	return t;
}

test('bootstrap creates the empty envelope + ops ledger and is idempotent', async () => {
	const t = await bootGraph({ clock: fixedClock() });
	const raw = await t.fs.readFileUtf8(path.join(t.root, GRAPH_PATH));
	assert.ok(raw !== undefined);
	assert.equal(raw, serializeEnvelope({ $schema: 'flauz.resources/v0', nodes: [], edges: [], surfaces: [] }));
	const ops = await t.fs.readFileUtf8(path.join(t.root, OPS_PATH));
	assert.equal(ops, '');
	const again = await t.graph.bootstrap();
	assert.equal(again.nodes.length, 0);
	await t.cleanup();
});

test('addRef mints createdAt from the clock, persists canonically, rejects duplicates', async () => {
	const t = await bootGraph({ clock: steppingClock() });
	const ref = await t.graph.addRef({ kind: 'file', id: FILE, displayName: 'app.ts', provenance: AGENT });
	assert.equal(ref.createdAt, 1000);
	assert.equal(ref.kind, 'file');
	await t.graph.addRef({ kind: 'task', id: TASK, provenance: HUMAN });
	await assert.rejects(
		() => t.graph.addRef({ kind: 'file', id: FILE, provenance: AGENT }),
		(err: unknown) => err instanceof ResourceGraphError && err.code === 'FLAUZ_RESOURCES_DUPLICATE',
	);
	// persisted bytes are canonical + stable-sorted (nodes by id)
	const raw = await t.fs.readFileUtf8(path.join(t.root, GRAPH_PATH));
	assert.ok(raw !== undefined);
	assert.ok(raw.indexOf(`"id": "${FILE}"`) < raw.indexOf(`"id": "${TASK}"`), 'nodes sorted by id');
	await t.cleanup();
});

test('addRef rejects an invalid ref BEFORE persisting (fail-closed)', async () => {
	const t = await bootGraph();
	await assert.rejects(
		() => t.graph.addRef({ kind: 'file', id: '/tmp/path.ts', provenance: AGENT }),
		ResourceGraphError,
	);
	await assert.rejects(
		() => t.graph.addRef({ kind: 'file', id: FILE, provenance: { } as unknown as ResourceProvenance }),
		(err: unknown) => err instanceof ResourceGraphError && err.code === 'FLAUZ_RESOURCES_PROVENANCE',
	);
	assert.equal(t.graph.envelope().nodes.length, 0);
	await t.cleanup();
});

test('updateRef patches displayName only; identity fields are immutable', async () => {
	const t = await seededGraph();
	const before = t.graph.get(FILE);
	const updated = await t.graph.updateRef(FILE, { displayName: 'renamed.tsx' }, HUMAN);
	assert.equal(updated.displayName, 'renamed.tsx');
	assert.equal(updated.id, FILE);
	assert.equal(updated.createdAt, before?.createdAt, 'createdAt is immutable');
	await assert.rejects(() => t.graph.updateRef(FILE, { displayName: 'x', extra: 1 } as unknown as { displayName: string }, HUMAN), /exactly \{ displayName \}/);
	await assert.rejects(() => t.graph.updateRef(FILE, { displayName: '' }, HUMAN), /displayName/);
	await assert.rejects(
		() => t.graph.updateRef('flauz:file:0000000000000000', { displayName: 'x' }, HUMAN),
		(err: unknown) => err instanceof ResourceGraphError && err.code === 'FLAUZ_RESOURCES_NOT_FOUND',
	);
	await t.cleanup();
});

test('THE acceptance test: identity survives an access-surface change (path move)', async () => {
	const t = await seededGraph();
	const v1 = await t.graph.addSurface(FILE, { kind: 'file-system', root: '/work/acme', path: 'src/login.tsx' }, AGENT);
	assert.equal(v1.versions.length, 1);
	// the file MOVES on disk; the same logical resource gets a new access surface
	const v2 = await t.graph.addSurface(FILE, { kind: 'file-system', root: '/work/acme', path: 'src/auth/login-form.tsx' }, AGENT);
	assert.equal(v2.versions.length, 2, 'the prior surface is retained (versioned)');
	assert.equal(v2.refId, FILE, 'the ref identity is unchanged');
	const current = v2.versions[v2.versions.length - 1];
	assert.equal(current?.surface.kind, 'file-system');
	if (current?.surface.kind === 'file-system') {
		assert.equal(current.surface.path, 'src/auth/login-form.tsx');
	}
	const prior = v2.versions[0];
	assert.equal(prior?.surface.kind, 'file-system');
	if (prior?.surface.kind === 'file-system') {
		assert.equal(prior.surface.path, 'src/login.tsx', 'the PRIOR surface is still recorded');
	}
	await t.cleanup();
});

test('THE acceptance test: identity survives an endpoint swap (browser surface)', async () => {
	const t = await seededGraph();
	await t.graph.addRef({ kind: 'browser-session', id: BROWSER, provenance: AGENT });
	await t.graph.addSurface(BROWSER, { kind: 'browser', cdpEndpoint: 'ws://127.0.0.1:9222/devtools/browser/aaa', partition: 'persist:flauz-0123456789abcdef' }, AGENT);
	// the browser restarts on a different port: endpoint swap, same session identity
	const r2 = await t.graph.addSurface(BROWSER, { kind: 'browser', cdpEndpoint: 'ws://127.0.0.1:9333/devtools/browser/bbb', partition: 'persist:flauz-0123456789abcdef' }, TOOL);
	assert.equal(r2.refId, BROWSER);
	assert.equal(r2.versions.length, 2);
	const record = t.graph.surfaceRecord(BROWSER, 'browser');
	assert.equal(record?.versions.length, 2);
	// an identical-to-current surface is a rejected no-op
	await assert.rejects(
		() => t.graph.addSurface(BROWSER, { kind: 'browser', cdpEndpoint: 'ws://127.0.0.1:9333/devtools/browser/bbb', partition: 'persist:flauz-0123456789abcdef' }, AGENT),
		(err: unknown) => err instanceof ResourceGraphError && err.code === 'FLAUZ_RESOURCES_DUPLICATE' && /no-op/.test(err.message),
	);
	await t.cleanup();
});

test('a ref can carry MULTIPLE surface families at once (no flattening)', async () => {
	const t = await seededGraph();
	await t.graph.addSurface(FILE, { kind: 'file-system', root: '/work/acme', path: 'src/app.ts' }, AGENT);
	await t.graph.addSurface(FILE, { kind: 'artifact', uri: '.flauz/artifacts/T-001/app.ts.bak', sha256: '5d41402abc4b2a76b9719d911017c592a8c8bbf84e34c1e9d70e2f3d2e1f0c3a' }, TOOL);
	const surfaces = t.graph.surfacesFor(FILE);
	assert.equal(surfaces.length, 2);
	const families = surfaces.map(s => s.family).sort();
	assert.deepEqual(families, ['artifact', 'file-system']);
	await t.cleanup();
});

test('addSurface rejects unknown refs and secret-shaped literals', async () => {
	const t = await seededGraph();
	await assert.rejects(
		() => t.graph.addSurface('flauz:file:0000000000000000', { kind: 'workspace', root: '/w' } as Surface, AGENT),
		(err: unknown) => err instanceof ResourceGraphError && err.code === 'FLAUZ_RESOURCES_NOT_FOUND',
	);
	const secret = runtimeSecretFixture('github-pat');
	await assert.rejects(
		() => t.graph.addSurface(FILE, { kind: 'file-system', root: '/w', path: secret }, AGENT),
		(err: unknown) => err instanceof ResourceGraphError && err.code === 'FLAUZ_RESOURCES_SECRET',
	);
	await t.cleanup();
});

test('addEdge validates endpoints, legality matrix, self-edges and duplicates', async () => {
	const t = await seededGraph();
	await t.graph.addRef({ kind: 'browser-session', id: BROWSER, provenance: AGENT });
	await t.graph.addRef({ kind: 'environment', id: ENVIRONMENT, provenance: HUMAN });
	const edge = await t.graph.addEdge({ kind: 'produced', from: TASK, to: ARTIFACT }, AGENT);
	assert.equal(edge.kind, 'produced');
	await assert.rejects(
		() => t.graph.addEdge({ kind: 'produced', from: TASK, to: ARTIFACT }, AGENT),
		(err: unknown) => err instanceof ResourceGraphError && err.code === 'FLAUZ_RESOURCES_DUPLICATE',
	);
	await assert.rejects(
		() => t.graph.addEdge({ kind: 'produced', from: 'flauz:file:0000000000000000', to: ARTIFACT }, AGENT),
		(err: unknown) => err instanceof ResourceGraphError && err.code === 'FLAUZ_RESOURCES_EDGE_ILLEGAL' && /does not exist/.test(err.message),
	);
	await assert.rejects(
		() => t.graph.addEdge({ kind: 'produced', from: TASK, to: TASK }, AGENT),
		(err: unknown) => err instanceof ResourceGraphError && err.code === 'FLAUZ_RESOURCES_EDGE_ILLEGAL' && /self-edge/.test(err.message),
	);
	// bound-to: browser-session -> environment is legal; artifact -> task is not
	await t.graph.addEdge({ kind: 'bound-to', from: BROWSER, to: ENVIRONMENT }, AGENT);
	await assert.rejects(
		() => t.graph.addEdge({ kind: 'bound-to', from: ARTIFACT, to: TASK }, AGENT),
		(err: unknown) => err instanceof ResourceGraphError && err.code === 'FLAUZ_RESOURCES_EDGE_ILLEGAL' && /not legal for endpoint kinds/.test(err.message),
	);
	await t.cleanup();
});

test('removeEdge removes exactly the (kind, from, to) triple', async () => {
	const t = await seededGraph();
	await t.graph.addEdge({ kind: 'produced', from: TASK, to: ARTIFACT }, AGENT);
	await t.graph.addEdge({ kind: 'depends-on', from: TASK, to: FILE }, AGENT);
	await t.graph.removeEdge('produced', TASK, ARTIFACT, HUMAN);
	assert.equal(t.graph.envelope().edges.length, 1);
	await assert.rejects(
		() => t.graph.removeEdge('produced', TASK, ARTIFACT, HUMAN),
		(err: unknown) => err instanceof ResourceGraphError && err.code === 'FLAUZ_RESOURCES_NOT_FOUND',
	);
	await t.cleanup();
});

test('removeRef refuses while edges reference the node, with a typed error listing the edges', async () => {
	const t = await seededGraph();
	await t.graph.addEdge({ kind: 'produced', from: TASK, to: ARTIFACT }, AGENT);
	await t.graph.addEdge({ kind: 'depends-on', from: TASK, to: FILE }, AGENT);
	await assert.rejects(
		() => t.graph.removeRef(ARTIFACT, HUMAN),
		(err: unknown) => {
			assert.ok(err instanceof ResourceGraphError, 'typed error');
			assert.equal(err.code, 'FLAUZ_RESOURCES_REF_IN_USE');
			const details = err.details as { edges: Array<{ kind: string; from: string; to: string }> };
			assert.deepEqual(details.edges, [{ kind: 'produced', from: TASK, to: ARTIFACT }]);
			return true;
		},
	);
	// after removing the edge, the removal succeeds
	await t.graph.removeEdge('produced', TASK, ARTIFACT, HUMAN);
	await t.graph.removeRef(ARTIFACT, HUMAN);
	assert.equal(t.graph.get(ARTIFACT), undefined);
	await t.cleanup();
});

test('removeRef also refuses while surfaces are bound (no orphan surfaces)', async () => {
	const t = await seededGraph();
	await t.graph.addSurface(FILE, { kind: 'file-system', root: '/work/acme', path: 'src/app.ts' }, AGENT);
	await assert.rejects(
		() => t.graph.removeRef(FILE, HUMAN),
		(err: unknown) => {
			assert.ok(err instanceof ResourceGraphError);
			assert.equal(err.code, 'FLAUZ_RESOURCES_REF_IN_USE');
			const details = err.details as { edges: unknown[]; surfaces: string[] };
			assert.deepEqual(details.edges, []);
			assert.deepEqual(details.surfaces, ['file-system']);
			return true;
		},
	);
	await t.cleanup();
});

test('queries: byKind, neighbors (direction + optional edge filter), surfacesFor', async () => {
	const t = await seededGraph();
	await t.graph.addRef({ kind: 'environment', id: ENVIRONMENT, provenance: HUMAN });
	await t.graph.addRef({ kind: 'browser-session', id: BROWSER, provenance: AGENT });
	await t.graph.addEdge({ kind: 'produced', from: TASK, to: ARTIFACT }, AGENT);
	await t.graph.addEdge({ kind: 'depends-on', from: TASK, to: FILE }, AGENT);
	await t.graph.addEdge({ kind: 'bound-to', from: BROWSER, to: ENVIRONMENT }, AGENT);
	assert.deepEqual(t.graph.byKind('file').map(r => r.id), [FILE]);
	assert.deepEqual(t.graph.byKind('environment').map(r => r.id), [ENVIRONMENT]);
	const taskNeighbors = t.graph.neighbors(TASK);
	assert.equal(taskNeighbors.length, 2);
	const producedOnly = t.graph.neighbors(TASK, 'produced');
	assert.deepEqual(producedOnly.map(l => l.ref.id), [ARTIFACT]);
	assert.equal(producedOnly[0]?.direction, 'out');
	const artifactNeighbors = t.graph.neighbors(ARTIFACT, 'produced');
	assert.deepEqual(artifactNeighbors.map(l => l.ref.id), [TASK]);
	assert.equal(artifactNeighbors[0]?.direction, 'in');
	const envNeighbors = t.graph.neighbors(ENVIRONMENT, 'bound-to');
	assert.deepEqual(envNeighbors.map(l => l.ref.id), [BROWSER]);
	assert.equal(envNeighbors[0]?.direction, 'in');
	assert.throws(() => t.graph.lineage('flauz:file:0000000000000000'), ResourceGraphError);
	await t.cleanup();
});

test('lineage walks the produced / restored-from / snapshot-of chain (cycle-safe)', async () => {
	const t = await bootGraph({ clock: steppingClock() });
	const session1 = 'flauz:browser:1111111111111111';
	const session2 = 'flauz:browser:2222222222222222';
	await t.graph.addRef({ kind: 'browser-session', id: session1, provenance: AGENT });
	await t.graph.addRef({ kind: 'browser-session', id: session2, provenance: AGENT });
	await t.graph.addRef({ kind: 'artifact', id: ARTIFACT, provenance: TOOL });
	await t.graph.addRef({ kind: 'task', id: TASK, provenance: AGENT });
	// task produced artifact; artifact snapshots session1; session2 restored-from session1
	await t.graph.addEdge({ kind: 'produced', from: TASK, to: ARTIFACT }, AGENT);
	await t.graph.addEdge({ kind: 'snapshot-of', from: ARTIFACT, to: session1 }, TOOL);
	await t.graph.addEdge({ kind: 'restored-from', from: session2, to: session1 }, AGENT);
	const lineage = t.graph.lineage(ARTIFACT);
	assert.deepEqual(lineage.map(r => r.id), [ARTIFACT, TASK, session1]);
	// session2's lineage: restored-from session1
	assert.deepEqual(t.graph.lineage(session2).map(r => r.id), [session2, session1]);
	// a produced edge does not contribute from the producer side
	assert.deepEqual(t.graph.lineage(TASK).map(r => r.id), [TASK]);
	// cycle safety: lineage is defensive, but mutual restored-from edges are
	// FORBIDDEN at append (C2: ancestry kinds stay acyclic per kind)
	await assert.rejects(
		() => t.graph.addEdge({ kind: 'restored-from', from: session1, to: session2 }, AGENT),
		(err: unknown) => err instanceof ResourceGraphError && err.code === 'FLAUZ_RESOURCES_EDGE_ILLEGAL' && /closes a 'restored-from' cycle/.test(err.message),
	);
	// and the graph state is unchanged by the rejected edge
	assert.deepEqual(t.graph.lineage(session1).map(r => r.id), [session1]);
	await t.cleanup();
});

test('persistence round-trip: reload a graph from disk and query identically', async () => {
	const t = await seededGraph();
	await t.graph.addRef({ kind: 'browser-session', id: BROWSER, provenance: AGENT });
	await t.graph.addSurface(BROWSER, { kind: 'browser', partition: 'persist:flauz-0123456789abcdef' }, AGENT);
	await t.graph.addEdge({ kind: 'depends-on', from: TASK, to: FILE }, AGENT);
	const raw = await t.fs.readFileUtf8(path.join(t.root, GRAPH_PATH));
	assert.ok(raw !== undefined);
	const reloaded = new ResourceGraph({ root: t.root, fs: t.fs, clock: fixedClock() });
	const envelope = await reloaded.bootstrap();
	assert.equal(envelope.nodes.length, t.graph.envelope().nodes.length);
	assert.equal(envelope.edges.length, 1);
	assert.equal(reloaded.surfaceRecord(BROWSER, 'browser')?.versions.length, 1);
	assert.equal(raw, serializeEnvelope(envelope), 'logically identical states serialize to identical bytes');
	await t.cleanup();
});

test('parseEnvelope rejects a corrupted graph file with a typed persist error', async () => {
	const t = await bootGraph();
	await fs.writeFile(path.join(t.root, '.flauz', 'resources.json'), '{"$schema": "flauz.resources/v0", "nodes": "not-an-array"}', { encoding: 'utf-8' });
	const broken = new ResourceGraph({ root: t.root, fs: t.fs, clock: fixedClock() });
	await assert.rejects(
		() => broken.bootstrap(),
		(err: unknown) => {
			assert.ok(err instanceof ResourceGraphError);
			assert.equal(err.code, 'FLAUZ_RESOURCES_PERSIST');
			assert.match(err.message, /flauz\.resources\/v0:/);
			return true;
		},
	);
	await t.cleanup();
});

test('verifyEnvelope: the good fixture is clean; tampered states produce typed problems', async () => {
	const good = ResourceGraph.parseEnvelope(await readFixture('good', 'graph.json'));
	const report = verifyEnvelope(good);
	assert.deepEqual(report.problems, []);
	assert.equal(report.ok, true);
	assert.equal(report.nodes, 10);

	const orphan: ResourcesEnvelope = {
		...good,
		surfaces: [...good.surfaces, { refId: 'flauz:file:ffffffffffffffff', family: 'workspace', versions: [{ surface: { kind: 'workspace', root: '/w' }, provenance: { actor: 'human' }, updatedAt: 1 }] }],
	};
	assert.equal(verifyEnvelope(orphan).problems.some(p => p.code === 'orphan-surface'), true);

	const missingEndpoint: ResourcesEnvelope = {
		...good,
		edges: [...good.edges, { kind: 'depends-on', from: 'flauz:task:T-999', to: 'flauz:task:T-001', provenance: { actor: 'agent' }, createdAt: 1 }],
	};
	assert.equal(verifyEnvelope(missingEndpoint).problems.some(p => p.code === 'edge-endpoint-missing'), true);
});

test('verifyWorkspace on a freshly-mutated workspace: envelope clean + ops chain green', async () => {
	const t = await seededGraph();
	await t.graph.addEdge({ kind: 'produced', from: TASK, to: ARTIFACT }, AGENT);
	const report = await verifyWorkspace(t.root, t.fs);
	assert.equal(report.envelope.ok, true);
	assert.equal(report.ops !== undefined && report.ops.ok, true);
	assert.equal(report.ops?.records, 5); // 4 add-ref (seededGraph) + 1 add-edge
	await t.cleanup();
});

test('the entire bad-fixture matrix is rejected by parseEnvelope (one defect per file)', async () => {
	const files = await listFixtureFiles('bad');
	assert.ok(files.length >= 40, `expected a full bad matrix, got ${files.length}`);
	for (const file of files) {
		const raw = await readFixture('bad', file);
		assert.throws(
			() => ResourceGraph.parseEnvelope(raw),
			(err: unknown) => {
				assert.ok(err instanceof Error, `${file}: must throw Error`);
				assert.match(err.message, /flauz\.resources\/v0:/, `${file}: error must carry the schema prefix`);
				return true;
			},
			`${file} must be rejected`,
		);
	}
});

test('toDot renders a deterministic DOT document of nodes and edges', async () => {
	const envelope = ResourceGraph.parseEnvelope(await readFixture('good', 'graph.json'));
	const dot = toDot(envelope);
	assert.match(dot, /^digraph flauz_resources \{/);
	assert.match(dot, /\t"flauz:task:T-001" -> "flauz:artifact:a1b2c3d4e5f60718" \[label="produced"\];/);
	assert.match(dot, /\[file-system\]/); // surface families annotated on node labels
	assert.equal(dot.endsWith('}\n'), true);
	const again = toDot(envelope);
	assert.equal(dot, again, 'deterministic');
});

test('mutations are visible to a second graph instance only after reload (no shared state)', async () => {
	const t = await seededGraph();
	const other = new ResourceGraph({ root: t.root, fs: t.fs, clock: fixedClock() });
	await other.bootstrap();
	assert.equal(other.envelope().nodes.length, t.graph.envelope().nodes.length);
	await t.graph.addRef({ kind: 'model', id: MODEL, provenance: AGENT });
	assert.equal(other.envelope().nodes.length, 4); // stale in-memory copy is isolated
	const fresh = new ResourceGraph({ root: t.root, fs: t.fs, clock: fixedClock() });
	assert.equal((await fresh.bootstrap()).nodes.length, 5);
	await t.cleanup();
});
