/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Repo task-resource fixture matrix tests (test/fixtures/task-resources/):
 * the good workspace pins the cross-adapter integration target + the new
 * `task-resources.jsonl` ledger; EVERY bad fixture is rejected with a
 * `flauz.task-resources/v0:`-prefixed typed error (each ledger parser rule
 * violated at least once). The good workspace is also loaded end-to-end by
 * every adapter test in this suite (the `copyGoodWorkspace` helper).
 */
import { test } from 'node:test';
import { ok, strictEqual, deepStrictEqual, throws } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
        parseLedger,
        parseLedgerRecord,
        serializeLedgerRecord,
        deriveIndex,
        type TaskResourceLedgerRecord,
} from '../../src/resourceExec/store.ts';
import {
        BrowserSessionAdapter,
        parseJournalLine,
        readSessionJournal,
        latestBySession,
} from '../../src/resourceExec/browserSession.ts';
import {
        EnvironmentAdapter,
        parseLifecycleEnvelope,
        parseOpsLedger as parseEnvironmentOpsLedger,
        parseEnvironmentsEnvelope,
} from '../../src/resourceExec/environment.ts';
import {
        ResourceRefAdapter,
        parseResourcesEnvelope,
        parseResourceRef,
} from '../../src/resourceExec/resourceRef.ts';
import {
        ContinuityAdapter,
        parseBundleManifest,
        parseOpsLedger as parseContinuityOpsLedger,
} from '../../src/resourceExec/continuity.ts';
import { canonicalJson } from '../../src/resourceExec/types.ts';
import { fixturePath, nodeFsPort } from './helpers.ts';

const PREFIX = /flauz\.task-resources\/v0:/;

function goodWorkspacePath(...segments: readonly string[]): string {
        return fixturePath('good', 'workspace', ...segments);
}

test('the good task-resources.jsonl fixture parses and pins every ledger-record shape (lease + hand-off)', () => {
        const raw = readFileSync(goodWorkspacePath('.flauz', 'task-resources.jsonl'), 'utf-8');
        const records = parseLedger(raw);
        strictEqual(records.length, 5, 'the good fixture carries 5 records (3 acquires + 1 release + 1 hand-off export)');
        // every line round-trips through canonical single-line serialization
        const lines = raw.split('\n');
        for (let i = 0; i < records.length; i++) {
                strictEqual(lines[i], serializeLedgerRecord(records[i]!), `line ${i + 1} is canonical`);
        }
        // the actor coverage pins the provenance surface (every record carries the actor)
        for (const record of records) {
                ok(['agent', 'human', 'tool'].includes(record.actor), `record ${record.kind} carries an actor`);
        }
});

test('the good fixture derives the expected lease index (3 tasks, 1 active + 1 released + 1 hand-off export)', () => {
        const raw = readFileSync(goodWorkspacePath('.flauz', 'task-resources.jsonl'), 'utf-8');
        const records = parseLedger(raw);
        const index = deriveIndex(records);
        // 3 distinct lease ids (1 active env lease for T-001; 1 released browser lease for T-001; 1 active file lease for T-002)
        strictEqual(index.leases.size, 3);
        // T-001 has 1 active lease (the env lease; the browser lease was released)
        const t001Active = index.activeByTask.get('T-001') ?? [];
        strictEqual(t001Active.length, 1);
        strictEqual(t001Active[0]!.resourceKind, 'environment');
        // T-002 has 1 active lease (the file ref lease)
        const t002Active = index.activeByTask.get('T-002') ?? [];
        strictEqual(t002Active.length, 1);
        strictEqual(t002Active[0]!.resourceKind, 'resource-ref');
        // the hand-off for T-001 is recorded
        strictEqual((index.handOffs.get('T-001') ?? []).length, 1);
        strictEqual(index.handOffs.get('T-001')![0]!.kind, 'export');
});

test('the good browser-sessions.jsonl fixture parses (3 records, no skips) and resolves the latest per session', () => {
        const raw = readFileSync(goodWorkspacePath('.flauz', 'browser-sessions.jsonl'), 'utf-8');
        const result = readSessionJournal(raw);
        strictEqual(result.records.length, 3);
        strictEqual(result.skipped.length, 0);
        const latest = latestBySession(result.records);
        strictEqual(latest.size, 3);
        // every line is canonical
        const lines = raw.split('\n');
        for (let i = 0; i < result.records.length; i++) {
                strictEqual(lines[i], canonicalJson(result.records[i]!), `line ${i + 1} is canonical`);
        }
});

test('the good environments-lifecycle.json + ops.jsonl fixtures parse (PIN-2 strict)', () => {
        const lifecycleRaw = readFileSync(goodWorkspacePath('.flauz', 'environments-lifecycle.json'), 'utf-8');
        const envelope = parseLifecycleEnvelope(lifecycleRaw);
        strictEqual(envelope.schema, 'flauz.environments-lifecycle/v0');
        strictEqual(Object.keys(envelope.entries).length, 5);

        const opsRaw = readFileSync(goodWorkspacePath('.flauz', 'environments-ops.jsonl'), 'utf-8');
        const ops = parseEnvironmentOpsLedger(opsRaw);
        strictEqual(ops.length, 5);
        strictEqual(ops[0]!.op, 'start');
        strictEqual(ops[3]!.result, 'error'); // the failed env
});

test('the good environments.json registry fixture parses (sibling envelope, read-only consumption)', () => {
        const raw = readFileSync(goodWorkspacePath('.flauz', 'environments.json'), 'utf-8');
        const envelope = parseEnvironmentsEnvelope(raw);
        strictEqual(envelope.$schema, 'flauz.environments/v0');
        strictEqual(envelope.environments.length, 6);
        const untrusted = envelope.environments.find(env => env.id === 'env-fixture-untrusted');
        ok(untrusted !== undefined);
        strictEqual(untrusted!.trust.posture, 'untrusted');
});

test('the good resources.json fixture parses (4 nodes, 1 edge, 1 surface record)', () => {
        const raw = readFileSync(goodWorkspacePath('.flauz', 'resources.json'), 'utf-8');
        const envelope = parseResourcesEnvelope(raw);
        strictEqual(envelope.$schema, 'flauz.resources/v0');
        strictEqual(envelope.nodes.length, 4);
        strictEqual(envelope.edges.length, 1);
        strictEqual(envelope.surfaces.length, 1);
});

test('the good continuity manifest + ops fixtures parse (1 carried bundle)', () => {
        const manifestRaw = readFileSync(goodWorkspacePath('.flauz', 'continuity-bundles', 'flauz:continuity:0123456789abcdef', 'manifest.json'), 'utf-8');
        const manifest = parseBundleManifest(manifestRaw);
        strictEqual(manifest.schema, 'flauz.continuity-bundle/v0');
        strictEqual(manifest.bundleId, 'flauz:continuity:0123456789abcdef');
        strictEqual(Object.keys(manifest.surfaces).length, 6);
        const carried = Object.values(manifest.surfaces).filter(s => s.status === 'carried');
        const redacted = Object.values(manifest.surfaces).filter(s => s.status === 'redacted');
        const lost = Object.values(manifest.surfaces).filter(s => s.status === 'lost');
        strictEqual(carried.length, 4);
        strictEqual(redacted.length, 1);
        strictEqual(lost.length, 1);

        const opsRaw = readFileSync(goodWorkspacePath('.flauz', 'continuity-ops.jsonl'), 'utf-8');
        const ops = parseContinuityOpsLedger(opsRaw);
        strictEqual(ops.length, 1);
        strictEqual(ops[0]!.op, 'export');
        strictEqual(ops[0]!.result, 'ok');
});

test('every bad task-resources.jsonl fixture is rejected with a schema-prefixed typed error', () => {
        const badDir = fixturePath('bad');
        const files = readdirSync(badDir).sort();
        ok(files.length >= 25, `bad matrix covers all rules (found ${files.length} files)`);
        for (const file of files) {
                const raw = readFileSync(join(badDir, file), 'utf-8');
                throws(
                        () => parseLedger(raw),
                        PREFIX,
                        `${file} must be rejected by parseLedger with a flauz.task-resources/v0: prefix`,
                );
        }
});

test('end-to-end: the good workspace loads through every adapter (no throws at the boundary)', async () => {
        const root = goodWorkspacePath();
        const fsPort = nodeFsPort();

        const browserAdapter = new BrowserSessionAdapter({ workspaceRoot: root, fs: fsPort });
        const journal = await browserAdapter.readJournal();
        strictEqual(journal.records.length, 3);
        strictEqual(journal.skipped.length, 0);

        const envAdapter = new EnvironmentAdapter({ workspaceRoot: root, fs: fsPort });
        const lifecycle = await envAdapter.loadLifecycle();
        strictEqual(Object.keys(lifecycle.entries).length, 5);

        const refAdapter = new ResourceRefAdapter({ workspaceRoot: root, fs: fsPort });
        const graph = await refAdapter.loadGraph();
        strictEqual(graph.nodes.length, 4);

        const continuityAdapter = new ContinuityAdapter({ workspaceRoot: root, fs: fsPort });
        const manifest = await continuityAdapter.loadManifest('flauz:continuity:0123456789abcdef');
        ok(manifest !== undefined);
        strictEqual(manifest!.bundleId, 'flauz:continuity:0123456789abcdef');
});
