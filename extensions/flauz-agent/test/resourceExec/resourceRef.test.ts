/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The resourceRef adapter tests. Covers the no-flattening law (secret-kind
 * refs are VAULT-ONLY -- the lease carries the ref id + surface version,
 * never any secret payload), existence, surface-version retrieval, edge
 * minting (PURE -- the graph WRITE stays with flauz-resources), idempotent
 * release.
 */
import { test } from 'node:test';
import { ok, strictEqual, throws } from 'node:assert';
import { ResourceRefAdapter, parseResourceRef, parseResourcesEnvelope, edgeFor, SECRET_KINDS } from '../../src/resourceExec/resourceRef.ts';
import { TaskResourceError } from '../../src/resourceExec/types.ts';
import { copyGoodWorkspace } from './helpers.ts';

test('acquire: a file ResourceRef returns the ref + a non-secret-shaped snapshot', async () => {
        const { root, fs, cleanup } = await copyGoodWorkspace();
        try {
                const adapter = new ResourceRefAdapter({ workspaceRoot: root, fs });
                const result = await adapter.acquire('flauz:file:4d5e6f708192a3b4', 'agent');
                ok(result.ok);
                strictEqual(result.ref.kind, 'file');
                strictEqual(result.secretShaped, false);
                strictEqual(result.snapshot.kind, 'resource-ref');
                const snap = result.snapshot as { kind: 'resource-ref'; refKind: string; surfaceVersion?: number; secretShaped?: boolean };
                strictEqual(snap.refKind, 'file');
                ok(snap.surfaceVersion !== undefined, 'the surface version is carried (versioned snapshot)');
        } finally {
                await cleanup();
        }
});

test('acquire: an evidence ResourceRef is SECRET-KIND (VAULT-ONLY) -- the lease carries presence only, never the payload', async () => {
        const { root, fs, cleanup } = await copyGoodWorkspace();
        try {
                const adapter = new ResourceRefAdapter({ workspaceRoot: root, fs });
                const result = await adapter.acquire('flauz:evidence:abcdef0123456789', 'agent');
                ok(result.ok);
                strictEqual(result.ref.kind, 'evidence');
                strictEqual(result.secretShaped, true);
                const snap = result.snapshot as { kind: 'resource-ref'; refKind: string; secretShaped?: boolean };
                strictEqual(snap.secretShaped, true, 'the snapshot marks the secret shape (presence only, never the payload)');
        } finally {
                await cleanup();
        }
});

test('SECRET_KINDS covers evidence + artifact (the kinds whose surfaces carry secret-shaped material)', () => {
        ok(SECRET_KINDS.includes('evidence'));
        ok(SECRET_KINDS.includes('artifact'));
        ok(!SECRET_KINDS.includes('file'));
});

test('acquire: RESOURCE_ABSENT -- a ResourceRef not in the graph', async () => {
        const { root, fs, cleanup } = await copyGoodWorkspace();
        try {
                const adapter = new ResourceRefAdapter({ workspaceRoot: root, fs });
                const result = await adapter.acquire('flauz:file:9999999999999999', 'agent');
                ok(!result.ok);
                strictEqual(result.error.code, 'RESOURCE_ABSENT');
        } finally {
                await cleanup();
        }
});

test('acquire: RESOURCE_ABSENT -- a malformed ref id', async () => {
        const { root, fs, cleanup } = await copyGoodWorkspace();
        try {
                const adapter = new ResourceRefAdapter({ workspaceRoot: root, fs });
                const result = await adapter.acquire('not-a-ref-id', 'agent');
                ok(!result.ok);
                strictEqual(result.error.code, 'RESOURCE_ABSENT');
        } finally {
                await cleanup();
        }
});

test('release: idempotent (the obligation is at the task-graph level only; the ResourceRef itself is never torn down by the lease)', async () => {
        const { root, fs, cleanup } = await copyGoodWorkspace();
        try {
                const adapter = new ResourceRefAdapter({ workspaceRoot: root, fs });
                const result = await adapter.release('flauz:file:4d5e6f708192a3b4');
                ok(result.ok);
                ok(result.idempotent);
        } finally {
                await cleanup();
        }
});

test('edgeFor: mints the attribution-carrying task->resource edge record (PURE; the graph WRITE stays with flauz-resources at runtime)', () => {
        const provenance = { actor: 'agent' as const, actorId: 'flauz-agent', taskId: 'T-001' };
        const edge = edgeFor('T-001', 'flauz:file:4d5e6f708192a3b4', provenance, 1730000040000);
        strictEqual(edge.kind, 'depends-on');
        strictEqual(edge.from, 'flauz:task:T-001');
        strictEqual(edge.to, 'flauz:file:4d5e6f708192a3b4');
        strictEqual(edge.provenance.actor, 'agent');
        strictEqual(edge.createdAt, 1730000040000);
});

test('edgeFor: PRE-FLIGHT TASK_ID_INVALID for a bad task id', () => {
        throws(
                () => edgeFor('T-1', 'flauz:file:4d5e6f708192a3b4', { actor: 'agent', taskId: 'T-1' }, 1730000040000),
                (err: unknown) => err instanceof TaskResourceError && err.code === 'TASK_ID_INVALID',
        );
});

test('edgeFor: PRE-FLIGHT OP_INVALID for a bad ref id', () => {
        throws(
                () => edgeFor('T-001', 'not-a-ref', { actor: 'agent', taskId: 'T-001' }, 1730000040000),
                (err: unknown) => err instanceof TaskResourceError && err.code === 'OP_INVALID',
        );
});

test('edgeFor: PRE-FLIGHT PROVENANCE_INVALID for a missing actor', () => {
        throws(
                () => edgeFor('T-001', 'flauz:file:4d5e6f708192a3b4', { actor: 'ai' as never, taskId: 'T-001' }, 1730000040000),
                (err: unknown) => err instanceof TaskResourceError && err.code === 'PROVENANCE_INVALID',
        );
});

test('parseResourceRef: validates the URN namespace matches the kind (a file ref must have flauz:file:...)', () => {
        const ref = {
                schemaVersion: 0,
                kind: 'file',
                id: 'flauz:file:4d5e6f708192a3b4',
                provenance: { actor: 'human', actorId: 'user-1' },
                createdAt: 1730000000000,
        };
        const parsed = parseResourceRef(ref);
        strictEqual(parsed.kind, 'file');
        strictEqual(parsed.id, 'flauz:file:4d5e6f708192a3b4');
});

test('parseResourceRef: rejects a URN whose namespace does not match the kind', () => {
        const bad = {
                schemaVersion: 0,
                kind: 'file',
                id: 'flauz:environment:env-staging', // mismatch: kind=file but namespace=environment
                provenance: { actor: 'human', actorId: 'user-1' },
                createdAt: 1730000000000,
        };
        throws(
                () => parseResourceRef(bad),
                (err: unknown) => err instanceof TaskResourceError && err.code === 'OP_INVALID' && /namespace does not match kind/.test(err.message),
        );
});

test('parseResourcesEnvelope: parses the good fixture (4 nodes, 1 edge, 1 surface)', async () => {
        const { root, fs, cleanup } = await copyGoodWorkspace();
        try {
                const adapter = new ResourceRefAdapter({ workspaceRoot: root, fs });
                const graph = await adapter.loadGraph();
                strictEqual(graph.nodes.length, 4);
                strictEqual(graph.edges.length, 1);
                strictEqual(graph.surfaces.length, 1);
        } finally {
                await cleanup();
        }
});

test('surfaceFor: returns the latest surface version for a ref id + family', async () => {
        const { root, fs, cleanup } = await copyGoodWorkspace();
        try {
                const adapter = new ResourceRefAdapter({ workspaceRoot: root, fs });
                const surface = await adapter.surfaceFor('flauz:file:4d5e6f708192a3b4', 'file-system');
                ok(surface !== undefined);
                strictEqual(surface!.surface.kind, 'file-system');
        } finally {
                await cleanup();
        }
});
