/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * A-PROD-004-W2 -- the EXPORT-SHAPE suite (local-real).
 *
 * The fixture workspace is constructed by the REAL owning services
 * (test/helpers.ts); every assertion runs against the export the extension's
 * own builder wrote to disk.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

import { EXPORTS_DIR, EXPORT_FORMAT_VERSION, MANIFEST_SCHEMA_ID, EXPORT_SCHEMA_ID, INTEGRITY_SCHEMA_ID, SURFACES, joinPath, utf8ByteLength } from '../src/api.ts';
import { createExport, exportStamp } from '../src/export.ts';
import { bootFixtureWorkspace, fixtureVersions, readAllFiles, type FixtureWorkspace } from './helpers.ts';

function depsFor(fixture: FixtureWorkspace) {
        return {
                root: fixture.root,
                fs: fixture.fs,
                clock: fixture.clock,
                versions: fixtureVersions(),
        };
}

suite('export: the shape over the real durable state', () => {
        let fixture: FixtureWorkspace;

        suiteSetup(async () => {
                fixture = await bootFixtureWorkspace();
        });

        suiteTeardown(async () => {
                await fixture.cleanup();
        });

        test('the export lands at .flauz-exports/export-<stamp>/ with the four-part layout (metadata + state mirror)', async () => {
                const before = fixture.clock();
                const result = await createExport(depsFor(fixture));
                const after = fixture.clock();
                assert.match(result.exportDirName, /^export-\d{4}-\d{2}-\d{2}T\d{6}\.\d{3}Z$/);
                // the stamp is the createdAt between the clock probes (the PU6 toIsoStamp discipline, colons stripped)
                assert.ok(before <= result.createdAt && result.createdAt <= after, 'createdAt comes from the injected clock');
                assert.strictEqual(result.exportDir, joinPath(fixture.root, EXPORTS_DIR, result.exportDirName));
                const topEntries = (await fs.readdir(result.exportDir)).sort();
                assert.deepStrictEqual(topEntries, ['MANIFEST.json', 'export.json', 'integrity.json', 'state']);
                // the state mirror preserves the workspace .flauz/ layout exactly
                const stateFiles = (await readAllFiles(path.join(result.exportDir, 'state'))).map(file => path.relative(path.join(result.exportDir, 'state'), file.path).split(path.sep).join('/')).sort();
                for (const expected of ['.flauz/tasks.json', '.flauz/evidence/ledger.jsonl', '.flauz/resources.json', '.flauz/resources-ops.jsonl', '.flauz/environments.json', '.flauz/browser-sessions.jsonl', '.flauz/workflows/index.json', '.flauz/workflows/W-001.json', '.flauz/orchestration/graphs.json', '.flauz/orchestration/journal.jsonl', '.flauz/models/providers.json', '.flauz/models/routing-policy.json', '.flauz/models/routing-decisions.jsonl', '.flauz/models/provider-switches.jsonl']) {
                        assert.ok(stateFiles.includes(expected), `the state mirror carries ${expected}`);
                }
        });

        test('every present surface file is copied BYTE-IDENTICAL (the backup honesty)', async () => {
                const result = await createExport(depsFor(fixture));
                const manifest = JSON.parse(await fs.readFile(path.join(result.exportDir, 'MANIFEST.json'), 'utf-8')) as { files: { sourcePath: string; exportPath: string; present: boolean }[] };
                let checked = 0;
                for (const file of manifest.files) {
                        if (!file.present) {
                                continue;
                        }
                        const original = await fs.readFile(path.join(fixture.root, file.sourcePath), 'utf-8');
                        const copy = await fs.readFile(path.join(result.exportDir, file.exportPath), 'utf-8');
                        assert.strictEqual(copy, original, `${file.sourcePath} is byte-identical in the state copy`);
                        checked += 1;
                }
                assert.ok(checked >= 14, `every present file was compared (${String(checked)} checked)`);
        });

        test('MANIFEST.json is the per-surface inventory: receipts re-derive, counts are real, format versions pinned, absent surfaces listed', async () => {
                const result = await createExport(depsFor(fixture));
                const manifest = JSON.parse(await fs.readFile(path.join(result.exportDir, 'MANIFEST.json'), 'utf-8')) as {
                        $schema: string; schemaVersion: number; formatVersion: number;
                        surfaces: { surface: string; present: boolean; formatVersion: string; counts: Record<string, unknown>; files: { sourcePath: string; present: boolean; sha256?: string; bytes?: number }[] }[];
                        files: { sourcePath: string; exportPath: string; present: boolean; sha256?: string; bytes?: number }[];
                        fileCount: number; totalBytes: number;
                };
                assert.strictEqual(manifest.$schema, MANIFEST_SCHEMA_ID);
                assert.strictEqual(manifest.schemaVersion, 0);
                assert.strictEqual(manifest.formatVersion, EXPORT_FORMAT_VERSION);
                // one inventory row per census surface, census order
                assert.deepStrictEqual(manifest.surfaces.map(surface => surface.surface), SURFACES.map(def => def.id));
                // every receipt re-derives from the bytes on disk
                for (const file of manifest.files) {
                        if (!file.present) {
                                continue;
                        }
                        const text = await fs.readFile(path.join(result.exportDir, file.exportPath), 'utf-8');
                        assert.strictEqual(createHash('sha256').update(text).digest('hex'), file.sha256, `${file.sourcePath} receipt sha256`);
                        assert.strictEqual(utf8ByteLength(text), file.bytes, `${file.sourcePath} receipt bytes`);
                }
                // the counts are the real constructed state (the census counting laws)
                const bySurface = new Map(manifest.surfaces.map(surface => [surface.surface, surface]));
                assert.strictEqual((bySurface.get('tasks')?.counts.taskCount as number | undefined), 2, 'two real tasks');
                assert.ok(Number(bySurface.get('tasks')?.counts.eventCount ?? 0) >= 1, 'the appended event counted');
                assert.deepStrictEqual(bySurface.get('tasks')?.counts.statusCounts, { plan: 2 });
                assert.strictEqual(bySurface.get('evidenceLedger')?.counts.rowCount, 2, 'two real ledger rows');
                assert.deepStrictEqual(bySurface.get('evidenceLedger')?.counts.kindCounts, { 'command-output': 1, note: 1 });
                assert.strictEqual(bySurface.get('resourcesGraph')?.counts.refCount, 2, 'two refs in the real graph');
                assert.strictEqual(bySurface.get('resourcesGraph')?.counts.edgeCount, 1);
                assert.strictEqual(bySurface.get('resourcesGraph')?.counts.surfaceCount, 2);
                assert.ok(Number(bySurface.get('opsChain')?.counts.recordCount ?? 0) >= 3, 'graph mutations recorded in the ops chain');
                assert.strictEqual(bySurface.get('environmentsRegistry')?.counts.environmentCount, 2, 'the shared environments fixture');
                assert.strictEqual(bySurface.get('browserSessions')?.counts.recordCount, 2, 'two session-journal records');
                assert.strictEqual(bySurface.get('workflows')?.counts.envelopeCount, 1, 'one workflow envelope');
                assert.deepStrictEqual(bySurface.get('workflows')?.counts.envelopeIds, ['W-001']);
                assert.strictEqual(bySurface.get('workflows')?.counts.indexPresent, true);
                assert.strictEqual(bySurface.get('orchestration')?.counts.graphCount, 1, 'one real graph');
                assert.ok(Number(bySurface.get('orchestration')?.counts.journalRowCount ?? 0) >= 4, 'submit/approve/start/finish rows');
                assert.strictEqual(bySurface.get('providerLanesState')?.counts.decisionRowCount, 2, 'both lane switches probed a decision');
                assert.strictEqual(bySurface.get('providerLanesState')?.counts.providersFilePresent, true);
                // the evidence watermark is honestly ABSENT (the plain fixture ledger carries none) -- listed, never faked
                assert.strictEqual(bySurface.get('evidenceWatermark')?.present, false);
                assert.deepStrictEqual(bySurface.get('evidenceWatermark')?.counts, {});
                assert.strictEqual(manifest.fileCount, manifest.files.filter(file => file.present).length);
        });

        test('export.json is the metadata: versions, timestamp, workspace identity, format version, command line, artifact receipts', async () => {
                const result = await createExport(depsFor(fixture));
                const metadata = JSON.parse(await fs.readFile(path.join(result.exportDir, 'export.json'), 'utf-8')) as {
                        $schema: string; schemaVersion: number; formatVersion: number; createdAt: number;
                        productName: string; productVersion: string; extensionId: string; extensionVersion: string;
                        workspaceRoot: string; commandLine: string;
                        surfaces: { surface: string; present: boolean }[];
                        artifacts: { file: string; sha256: string; bytes: number }[];
                };
                assert.strictEqual(metadata.$schema, EXPORT_SCHEMA_ID);
                assert.strictEqual(metadata.formatVersion, EXPORT_FORMAT_VERSION);
                assert.strictEqual(metadata.productName, 'Flauz');
                assert.strictEqual(metadata.productVersion, '0.1.0');
                assert.strictEqual(metadata.extensionId, 'flauz.flauz-backup');
                assert.strictEqual(metadata.extensionVersion, '0.1.0');
                assert.strictEqual(metadata.workspaceRoot, fixture.root, 'the workspace identity is the root path (paths are metadata)');
                assert.strictEqual(metadata.commandLine, 'flauz.backup.export');
                assert.strictEqual(metadata.createdAt, result.createdAt);
                assert.deepStrictEqual(metadata.surfaces.map(surface => surface.surface), SURFACES.map(def => def.id));
                // the artifact receipts pin the other metadata files
                for (const artifact of metadata.artifacts) {
                        const text = await fs.readFile(path.join(result.exportDir, artifact.file), 'utf-8');
                        assert.strictEqual(createHash('sha256').update(text).digest('hex'), artifact.sha256, `${artifact.file} receipt`);
                }
                assert.ok(metadata.artifacts.some(artifact => artifact.file === 'MANIFEST.json'));
                assert.ok(metadata.artifacts.some(artifact => artifact.file === 'integrity.json'));
        });

        test('integrity.json re-runs the tamper-evidence verdicts at export time (the same verdicts the diagnostics surface reports)', async () => {
                const result = await createExport(depsFor(fixture));
                const integrity = JSON.parse(await fs.readFile(path.join(result.exportDir, 'integrity.json'), 'utf-8')) as {
                        $schema: string; schemaVersion: number; createdAt: number; scope: string;
                        evidenceLedger: { ok: boolean; rows: number; headSha256: string };
                        opsChain: { ok: boolean; records: number; problems: unknown[] };
                };
                assert.strictEqual(integrity.$schema, INTEGRITY_SCHEMA_ID);
                assert.strictEqual(integrity.createdAt, result.createdAt);
                assert.match(integrity.scope, /export-time re-run/);
                assert.strictEqual(integrity.evidenceLedger.ok, true, 'the fixture ledger chains clean');
                assert.strictEqual(integrity.evidenceLedger.rows, 2);
                assert.match(integrity.evidenceLedger.headSha256, /^[0-9a-f]{64}$/);
                assert.strictEqual(integrity.opsChain.ok, true, 'the fixture ops chain is clean');
                assert.ok(integrity.opsChain.records >= 3);
        });

        test('an absent surface exports as ABSENT (listed, never faked) -- a workspace without browser sessions or workflows envelopes', async () => {
                // remove two surfaces from a SECOND fixture workspace
                const second = await bootFixtureWorkspace();
                try {
                        await fs.rm(path.join(second.root, '.flauz', 'browser-sessions.jsonl'));
                        await fs.rm(path.join(second.root, '.flauz', 'workflows'), { recursive: true });
                        const result = await createExport({ root: second.root, fs: second.fs, clock: second.clock, versions: fixtureVersions() });
                        const manifest = JSON.parse(await fs.readFile(path.join(result.exportDir, 'MANIFEST.json'), 'utf-8')) as { surfaces: { surface: string; present: boolean; files: { present: boolean }[] }[] };
                        const bySurface = new Map(manifest.surfaces.map(surface => [surface.surface, surface]));
                        assert.strictEqual(bySurface.get('browserSessions')?.present, false);
                        assert.deepStrictEqual(bySurface.get('browserSessions')?.files.map(file => file.present), [false]);
                        assert.strictEqual(bySurface.get('workflows')?.present, false);
                        // the workflows row lists BOTH the absent index and the (vacuously) absent envelopes
                        assert.ok((bySurface.get('workflows')?.files ?? []).every(file => file.present === false));
                        // and nothing was faked on disk: the state mirror carries no browser-sessions copy
                        const stateFiles = (await readAllFiles(path.join(result.exportDir, 'state'))).map(file => path.relative(path.join(result.exportDir, 'state'), file.path));
                        assert.ok(!stateFiles.some(file => file.includes('browser-sessions')), 'no faked browser-sessions copy');
                        assert.ok(!stateFiles.some(file => file.includes('workflows')), 'no faked workflows copies');
                } finally {
                        await second.cleanup();
                }
        });

        test('exportStamp strips the path-hostile colons and sorts lexicographically with time', () => {
                const earlier = exportStamp(1_740_000_000_000);
                const later = exportStamp(1_740_000_001_000);
                assert.ok(!earlier.includes(':'), 'no colons (Windows-safe)');
                assert.ok(earlier < later, 'ISO stamps sort with time');
                assert.strictEqual(earlier, '2025-02-19T212000.000Z'.replaceAll(':', ''), 'the PU6 toIsoStamp serialization (new Date(1_740_000_000_000).toISOString())');
        });
});
