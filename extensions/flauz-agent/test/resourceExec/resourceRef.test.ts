/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Unit tests for the flauz-resources graph read-only lease adapter
 * (src/resourceExec/resourceRef.ts): the graph parse + corruption refusal,
 * the happy acquire (identity + surface VERSION, never payloads), the
 * absent ref, the family-set SURFACE_MISMATCH, the same-family version
 * advance (legal), the vault-only law (a lease never carries payloads) and
 * the PURE edge minting (the graph write stays with flauz-resources).
 */
import { test } from 'node:test';
import { deepStrictEqual, match, ok, strictEqual, throws } from 'node:assert';
import { ResourceRefLeaseAdapter, parseResourceOpsLine, parseResourcesGraph, taskResourceEdge } from '../../src/resourceExec/resourceRef.ts';
import { acquireLease } from '../../src/resourceExec/contracts.ts';
import { AGENT, FILE_REF, bootLeaseEnv, jsonlLine, memoryFs, resourcesGraph, runtimeSecretFixture } from './helpers.ts';

const ROOT = 'workspace';

function adapterWith(graph?: string): ResourceRefLeaseAdapter {
	const seed: Record<string, string> = { 'workspace/.flauz/resources.json': graph ?? resourcesGraph() };
	const mem = memoryFs(seed);
	return new ResourceRefLeaseAdapter({ root: ROOT, fs: mem.port });
}

test('parseResourcesGraph accepts the canonical graph and refuses corruption', () => {
	const graph = parseResourcesGraph(resourcesGraph());
	strictEqual(graph.$schema, 'flauz.resources/v0');
	strictEqual(graph.nodes.length, 2);
	strictEqual(graph.surfaces.length, 1);
	strictEqual(graph.surfaces[0]!.versions.length, 1);
	throws(() => parseResourcesGraph(JSON.stringify({ ...JSON.parse(resourcesGraph()), $schema: 'flauz.resources/v9' })), /flauz\.resources\/v0/);
	throws(() => parseResourcesGraph('not json'), /not valid JSON/);
	const pathId = JSON.parse(resourcesGraph());
	pathId.nodes[1].id = '/etc/passwd';
	throws(() => parseResourcesGraph(JSON.stringify(pathId)), /NEVER carries a filesystem path/);
});

test('parseResourceOpsLine validates advisory lines with typed skips', () => {
	const good = jsonlLine({ seq: 1, ts: 1730000051000, op: 'add-ref', refId: FILE_REF, actor: 'agent', beforeDigest: '0'.repeat(64), afterDigest: '1'.repeat(64), schema: 'flauz.resources-ops/v0', schemaVersion: 0 });
	ok(parseResourceOpsLine(good).ok);
	const badActor = JSON.parse(good);
	badActor.actor = 'system';
	ok(!parseResourceOpsLine(JSON.stringify(badActor)).ok);
	const badOp = JSON.parse(good);
	badOp.op = 'explode';
	ok(!parseResourceOpsLine(JSON.stringify(badOp)).ok);
	ok(!parseResourceOpsLine('not json').ok);
});

test('acquire happy path: the lease pins the ref id + surface version, never any payload', async () => {
	const adapter = adapterWith();
	const verdict = await adapter.acquire('T-001', FILE_REF, AGENT);
	ok(verdict.ok, 'the existing ref is acquirable');
	strictEqual(verdict.ok && verdict.surfaceSnapshot.surfaces.length, 1);
	const entry = verdict.ok && verdict.surfaceSnapshot.surfaces[0]!;
	strictEqual(entry.family, 'file-system');
	strictEqual(entry.version, 1, 'the version marker is the graph surface version index');
	deepStrictEqual(entry.surface, { kind: 'file-system', root: 'workspace', path: 'notes.md' });
	strictEqual(verdict.ok && verdict.opPort, undefined, 'resource access has no single command port in v0');
	match(verdict.ok && (verdict.notes?.[0] ?? ''), /ref kind 'file'/);
});

test('RESOURCE_ABSENT: a ref not in the graph (or no graph at all)', async () => {
	const adapter = adapterWith(resourcesGraph({ fileRef: false }));
	const verdict = await adapter.acquire('T-001', FILE_REF, AGENT);
	ok(!verdict.ok && verdict.code === 'RESOURCE_ABSENT');
	match(verdict.message, /no ResourceRef/);
	const empty = new ResourceRefLeaseAdapter({ root: ROOT, fs: memoryFs().port });
	const noGraph = await empty.acquire('T-001', FILE_REF, AGENT);
	ok(!noGraph.ok && noGraph.code === 'RESOURCE_ABSENT');
});

test('STATE_UNREADABLE: a corrupt graph refuses the acquire', async () => {
	const adapter = adapterWith(JSON.stringify({ $schema: 'flauz.resources/v9' }));
	const verdict = await adapter.acquire('T-001', FILE_REF, AGENT);
	ok(!verdict.ok && verdict.code === 'STATE_UNREADABLE');
});

test('SURFACE_MISMATCH: the family set changing since acquisition is an identity change; a version advance is legal', async () => {
	const changed = adapterWith(resourcesGraph({ fileSurfaceFamily: 'model' }));
	const pinned = { surfaces: [{ family: 'file-system' as const, version: 1, surface: { kind: 'file-system', root: 'workspace', path: 'notes.md' } }] };
	const verdict = await changed.verifySurface('T-001', FILE_REF, pinned);
	ok(!verdict.ok && verdict.code === 'SURFACE_MISMATCH');
	match(verdict.message, /family set of the leased ref changed/);
	// a same-family version advance (v2) is a legal access-surface change
	const advancedGraph = JSON.parse(resourcesGraph()) as { surfaces: Array<{ refId: string; family: string; versions: unknown[] }> };
	advancedGraph.surfaces[0]!.versions.push({ surface: { kind: 'file-system', root: 'workspace', path: 'notes-v2.md' }, provenance: AGENT, updatedAt: 1730000060000 });
	const advanced = adapterWith(JSON.stringify(advancedGraph));
	const okVerdict = await advanced.verifySurface('T-001', FILE_REF, pinned);
	ok(okVerdict.ok, 'identity survives access-surface change');
	strictEqual(okVerdict.ok && okVerdict.current.surfaces[0]!.version, 2);
});

test('release: a removed ref discharges closed-elsewhere; a present ref releases clean claiming no graph mutation', async () => {
	const removed = adapterWith(resourcesGraph({ fileRef: false }));
	const removedVerdict = await removed.release('T-001', FILE_REF, AGENT);
	ok(removedVerdict.ok && removedVerdict.outcome === 'closed-elsewhere');
	match(removedVerdict.observed, /no longer exists in the graph/);
	const present = adapterWith();
	const presentVerdict = await present.release('T-001', FILE_REF, AGENT);
	ok(presentVerdict.ok && presentVerdict.outcome === 'clean');
	match(presentVerdict.observed, /belong to flauz-resources at runtime/);
});

test('the vault-only law: SECRET-KIND material never enters a lease (the coordinator refuses secret-shaped leases)', async () => {
	const secret = runtimeSecretFixture('api-key');
	const surfaceWithSecret = { kind: 'file-system', root: 'workspace', path: `notes?token=${secret}` };
	const graph = JSON.parse(resourcesGraph()) as { surfaces: Array<{ refId: string; family: string; versions: Array<{ surface: Record<string, unknown>; provenance: unknown; updatedAt: number }> }> };
	graph.surfaces[0]!.versions[0]!.surface = surfaceWithSecret;
	const mem = memoryFs({ 'workspace/.flauz/resources.json': JSON.stringify(graph) });
	const { env, ledger } = await bootLeaseEnv(mem.port, () => 1730001000000);
	const outcome = await acquireLease(env, { taskId: 'T-001', resourceId: FILE_REF, actor: AGENT, adapter: new ResourceRefLeaseAdapter({ root: ROOT, fs: mem.port }) });
	ok(!outcome.ok && outcome.error.code === 'SECRET_IN_LEASE', 'the no-flattening law refuses the lease');
	ok(!JSON.stringify(ledger.records()).includes(secret), 'the secret never reaches the ledger');
});

test('edge minting: taskResourceEdge is PURE -- the attribution-carrying depends-on record, no graph write', () => {
	const edge = taskResourceEdge({ taskId: 'T-001', refId: FILE_REF, provenance: AGENT });
	ok(!('error' in edge), 'the happy path mints an edge record');
	if (!('error' in edge)) {
		strictEqual(edge.kind, 'depends-on');
		strictEqual(edge.from, 'flauz:task:T-001', 'the task graph ref id');
		strictEqual(edge.to, FILE_REF);
		deepStrictEqual(edge.provenance, AGENT);
	}
	const badTask = taskResourceEdge({ taskId: 'task-1', refId: FILE_REF, provenance: AGENT });
	ok('error' in badTask && /task-id pattern/.test(badTask.error));
	const badRef = taskResourceEdge({ taskId: 'T-001', refId: '/etc/passwd', provenance: AGENT });
	ok('error' in badRef && /never a path, never a URL/.test(badRef.error));
});
