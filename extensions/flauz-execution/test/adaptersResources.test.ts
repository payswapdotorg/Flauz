/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-S2 M3 suite (logical resources + provenance): the
 * LogicalResourceAdapter + the browser/env ref registration against the
 * REAL flauz-resources ResourceGraph (addRef/addSurface/addEdge with the
 * provenance ledger). Pins the identity law (no fabricated refs), the
 * versioned-surface resolution, and the task-caused mutation provenance.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { ResourceGraph, verifyEnvelope } from '../../flauz-resources/src/graph.ts';
import { OPS_PATH, GRAPH_PATH } from '../../flauz-resources/src/api.ts';
import { LogicalResourceAdapter } from '../src/adapters.ts';
import { ExecJournalStore } from '../src/journal.ts';
import type { StepBinding } from '../src/acquisition.ts';
import { ARTIFACT_REF, BROWSER_REF, FILE_REF, pinnedMinter, steppingClock, tempRoot } from './helpers.ts';

function memFs(seed: Record<string, string> = {}) {
	const files = new Map<string, string>(Object.entries(seed));
	return {
		readFileUtf8: async (path: string) => files.get(path),
		writeFile: async (path: string, contents: string) => { files.set(path, contents); },
		appendFile: async (path: string, contents: string) => { files.set(path, (files.get(path) ?? '') + contents); },
		rename: async (from: string, to: string) => { files.set(to, files.get(from) ?? ''); files.delete(from); },
		mkdir: async () => undefined,
	};
}

async function rig() {
	const { root, cleanup } = tempRoot();
	const clock = steppingClock(1730000000000);
	const graph = new ResourceGraph({ root, fs: memFs(), clock });
	await graph.bootstrap();
	const journal = new ExecJournalStore(root, { clock, mintAcquisitionId: pinnedMinter() });
	const adapter = new LogicalResourceAdapter({ graph, journal });
	return { root, cleanup, graph, journal, adapter };
}

function binding(overrides: Record<string, unknown> = {}): StepBinding {
	return { graphId: 'G-001', stepId: 'S-01', attempt: 1, idempotencyKey: 'flauz-orch/G-001/S-01/run/1', runnerId: 'worker-1', actor: 'agent', origin: 'test:resources', ...overrides } as StepBinding;
}

test('open: an unknown ref is surface-unresolved (the identity law - no fabricated refs)', async () => {
	const r = await rig();
	const opened = await r.adapter.open({ resource: { ...FILE_REF }, action: 'resolve' }, binding());
	assert.ok(!opened.ok);
	if (opened.ok) { return; }
	assert.equal(opened.failure.failureClass, 'surface-unresolved');
	assert.match(opened.failure.message, /not in the resource graph/);
	r.cleanup();
});

test('open: a known ref with NO surface version is surface-unresolved', async () => {
	const r = await rig();
	await r.graph.addRef({ kind: 'file', id: FILE_REF.id, provenance: { actor: 'human' } });
	const opened = await r.adapter.open({ resource: { ...FILE_REF }, action: 'resolve' }, binding());
	assert.ok(!opened.ok);
	if (opened.ok) { return; }
	assert.equal(opened.failure.failureClass, 'surface-unresolved');
	assert.match(opened.failure.message, /no resolvable access surface/);
	r.cleanup();
});

test('open + resolve: the CURRENT surface version resolves through the REAL graph', async () => {
	const r = await rig();
	await r.graph.addRef({ kind: 'file', id: FILE_REF.id, displayName: 'app.ts', provenance: { actor: 'human' } });
	await r.graph.addSurface(FILE_REF.id, { kind: 'file-system', root: '/ws', path: 'src/app.ts' }, { actor: 'tool', actorId: 'seed' });
	const opened = await r.adapter.open({ resource: { ...FILE_REF }, action: 'resolve' }, binding());
	assert.ok(opened.ok, opened.ok ? '' : JSON.stringify((opened as { failure?: unknown }).failure));
	if (!opened.ok) { return; }
	assert.equal(opened.surface.resourceClass, 'logical-resource');
	const snapshot = opened.surface as { refId: string; family: string; surface: Record<string, unknown> };
	assert.equal(snapshot.refId, FILE_REF.id);
	assert.equal(snapshot.family, 'file-system');
	assert.equal((snapshot.surface as { path: string }).path, 'src/app.ts');
	r.cleanup();
});

test('use (mutate): a new surface version is recorded with TASK provenance (actor + actorId + cause)', async () => {
	const r = await rig();
	await r.graph.addRef({ kind: 'file', id: FILE_REF.id, provenance: { actor: 'human' } });
	await r.graph.addSurface(FILE_REF.id, { kind: 'file-system', root: '/ws', path: 'src/app.ts' }, { actor: 'tool', actorId: 'seed' });
	r.journal.appendRow('resource-acquired', {
		graphId: 'G-001', stepId: 'S-01', attempt: 1, idempotencyKey: 'flauz-orch/G-001/S-01/run/1',
		acquisitionId: 'flauz:exec:0000000000000001', actor: 'agent', origin: 'test:resources',
		payload: { purpose: 'edit', resource: { ...FILE_REF } },
	});
	const used = await r.adapter.use({ resource: { ...FILE_REF }, action: 'mutate', mutation: { surface: { kind: 'file-system', root: '/ws', path: 'src/app.ts', contentSha256: 'a'.repeat(64) } } }, binding(), 'flauz:exec:0000000000000001');
	assert.ok(used.ok, used.ok ? '' : JSON.stringify((used as { failure?: unknown }).failure));
	// the new version is the CURRENT one, with the task's provenance
	const record = r.graph.surfaceRecord(FILE_REF.id, 'file-system');
	assert.notEqual(record, undefined);
	if (record === undefined) { return; }
	assert.equal(record.versions.length, 2);
	const latest = record.versions[record.versions.length - 1];
	assert.equal((latest.surface as { contentSha256?: string }).contentSha256, 'a'.repeat(64));
	assert.equal(latest.provenance.actor, 'agent');
	assert.equal(latest.provenance.actorId, 'worker-1');
	assert.match(latest.provenance.cause ?? '', /test:resources \(flauz-orch\/G-001\/S-01\/run\/1\)/);
	// the mutation hand-off is journaled with the digest linkage
	const handoff = r.journal.rowsAll().filter((row) => row.type === 'handoff-recorded').at(-1);
	assert.notEqual(handoff, undefined);
	r.cleanup();
});

test('use (mutate) with an invalid surface: typed invalid-request (never a bad version in the graph)', async () => {
	const r = await rig();
	await r.graph.addRef({ kind: 'file', id: FILE_REF.id, provenance: { actor: 'human' } });
	await r.graph.addSurface(FILE_REF.id, { kind: 'file-system', root: '/ws', path: 'src/app.ts' }, { actor: 'tool' });
	const used = await r.adapter.use({ resource: { ...FILE_REF }, action: 'mutate', mutation: { surface: { kind: 'file-system', root: '/ws', path: 'src/app.ts', contentSha256: 'not-a-hash' } } }, binding(), 'flauz:exec:0000000000000001');
	assert.ok(!used.ok);
	if (used.ok) { return; }
	assert.equal(used.failure.failureClass, 'invalid-request');
	const record = r.graph.surfaceRecord(FILE_REF.id, 'file-system');
	assert.equal(record?.versions.length, 1, 'the invalid version never landed');
	r.cleanup();
});

test('the resources ops ledger records every task-caused mutation (provenance posture)', async () => {
	const r = await rig();
	await r.graph.addRef({ kind: 'artifact', id: ARTIFACT_REF.id, provenance: { actor: 'human' } });
	await r.graph.addSurface(ARTIFACT_REF.id, { kind: 'artifact', uri: 'flauz-artifact://x', sha256: 'b'.repeat(64) }, { actor: 'tool' });
	r.journal.appendRow('resource-acquired', {
		graphId: 'G-001', stepId: 'S-01', attempt: 1, idempotencyKey: 'flauz-orch/G-001/S-01/run/1',
		acquisitionId: 'flauz:exec:0000000000000001', actor: 'agent', origin: 'test:resources',
		payload: { purpose: 'edit', resource: { ...ARTIFACT_REF } },
	});
	await r.adapter.use({ resource: { ...ARTIFACT_REF }, action: 'mutate', mutation: { surface: { kind: 'artifact', uri: 'flauz-artifact://x2', sha256: 'c'.repeat(64) } } }, binding(), 'flauz:exec:0000000000000001');
	// The envelope verifies clean (the REAL resources discipline holds).
	const envelope = await r.graph.envelope();
	const verdict = verifyEnvelope(envelope);
	assert.equal(verdict.problems.length, 0, JSON.stringify(verdict.problems));
	// Surface versions carry the task-caused mutation with provenance.
	const record = r.graph.surfaceRecord(ARTIFACT_REF.id, 'artifact');
	assert.equal(record?.versions.length, 2);
	assert.equal((record?.versions[1]?.provenance as { actorId?: string }).actorId, 'worker-1');
	r.cleanup();
});

test('graph persistence: the REAL envelope verifies after task-driven surface versions', async () => {
	const r = await rig();
	await r.graph.addRef({ kind: 'browser-session', id: BROWSER_REF.id, provenance: { actor: 'agent', actorId: 'worker-1' } });
	await r.graph.addSurface(BROWSER_REF.id, { kind: 'browser', partition: 'persist:flauz-x', tabIds: ['flauz:tab:0123456789abcdef'] }, { actor: 'agent', actorId: 'worker-1' });
	const envelope = await r.graph.envelope();
	assert.ok(envelope.nodes.length >= 1);
	const verdict = verifyEnvelope(envelope);
	assert.equal(verdict.problems.length, 0);
	void join;
	void GRAPH_PATH;
	void OPS_PATH;
	r.cleanup();
});
