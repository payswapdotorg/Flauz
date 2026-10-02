/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * A-PROD-004-W3 -- the CONTRACT-PIN suite: the duplicated contract shapes
 * (DL-32) are pinned byte-equal against the OWNING modules, node:crypto, the
 * flauz-diagnostics census this wave builds on, and -- this wave's own law --
 * the ANCHOR machinery is pinned CROSS-RECOGNIZABLE with the REAL
 * flauz-backup export/verify in BOTH directions: an anchor the migration
 * creates verifies GREEN under the real flauz.backup verify, and a real
 * flauz.backup export verifies GREEN under the migration's anchor verify.
 * The duplication is the point (a migration's verify must not depend on any
 * verified code being importable); these pins keep it honest.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { SURFACES, canonicalJson, serializeArtifact, sha256Hex, joinPath, type MigrationFsPort } from '../src/api.ts';
import { ledgerRowHash, opsRecordHash, parseLedgerLine, parseOpsLine, collectIntegrity } from '../src/verify.ts';
import { countSurface } from '../src/surfaces.ts';
import { expectedFileVersion, readSurfaceVersions } from '../src/versionInventory.ts';
import { createAnchorExport, verifyAnchorExport } from '../src/anchor.ts';
import { canonicalJson as workspaceCanonicalJson, sha256Hex as workspaceSha256Hex, SCHEMA_ID as TASKS_SCHEMA } from '../../flauz-workspace/src/api.ts';
import { canonicalJson as resourcesCanonicalJson, sha256Hex as resourcesSha256Hex, SCHEMA_ID as RESOURCES_SCHEMA, OPS_SCHEMA_ID } from '../../flauz-resources/src/api.ts';
import { rowHash as workspaceRowHash, rowLine } from '../../flauz-workspace/src/ledger.ts';
import { opRecordHash as resourcesOpRecordHash, opLine } from '../../flauz-resources/src/provenance.ts';
import { SIZE_SCHEMA, serializeWatermark as owningSerializeWatermark, parseWatermark, type LedgerWatermark } from '../../flauz-workspace/src/hardening.ts';
import { WORKFLOW_SCHEMA } from '../../flauz-workflow/src/envelope.ts';
import { BROWSER_SESSION_JOURNAL_SCHEMA_ID } from '../../flauz-browser/src/runtime/journal.ts';
import { ORCH_GRAPHS_SCHEMA } from '../../flauz-agent/core/orchestration.mjs';
import { PROVIDERS_SCHEMA_ID } from '../../flauz-models/src/discovery/configs.ts';
import { ROUTING_POLICY_SCHEMA_ID, ROUTING_DECISION_SCHEMA_ID } from '../../flauz-models/src/routing/policy.ts';
import { PROVIDER_SWITCH_SCHEMA_ID } from '../../flauz-models/src/routing/switch.ts';
import { collectDiagnostics } from '../../flauz-diagnostics/src/census.ts';
import { collectIntegrity as diagnosticsCollectIntegrity } from '../../flauz-diagnostics/src/verify.ts';
import { createExport as realBackupCreateExport, type ExportDeps as RealExportDeps } from '../../flauz-backup/src/export.ts';
import { verifyExport as realBackupVerifyExport } from '../../flauz-backup/src/inspect.ts';
import { bootFixtureWorkspace, nodeMigrationFs, fixtureVersions, steppingClock, type FixtureWorkspace } from './helpers.ts';
import { serializeWatermark } from '../src/banking.ts';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');

suite('contract pins: the duplication is byte-equal with the owning modules', () => {

        test('sha256Hex + canonicalJson are byte-identical to the owning implementations and node:crypto', () => {
                const samples = ['', 'flauz', '{"a":1,"b":[2,3]}', '{"z":1,"a":{"y":true,"n":null}}', 'x'.repeat(1000), 'ünïcödé ✓'];
                for (const sample of samples) {
                        const nodeCrypto = createHash('sha256').update(sample, 'utf8').digest('hex');
                        assert.strictEqual(sha256Hex(sample), nodeCrypto, `sha256Hex matches node:crypto on ${JSON.stringify(sample.slice(0, 20))}`);
                        assert.strictEqual(sha256Hex(sample), workspaceSha256Hex(sample), 'sha256Hex matches flauz-workspace');
                        assert.strictEqual(sha256Hex(sample), resourcesSha256Hex(sample), 'sha256Hex matches flauz-resources');
                }
                const value = { b: 2, a: [3, { d: null, c: 'x' }] };
                assert.strictEqual(canonicalJson(value), workspaceCanonicalJson(value), 'canonicalJson matches flauz-workspace');
                assert.strictEqual(canonicalJson(value), resourcesCanonicalJson(value), 'canonicalJson matches flauz-resources');
                assert.strictEqual(canonicalJson(value), '{"a":[3,{"c":"x","d":null}],"b":2}');
                // the artifact serializer discipline: sorted keys, 2-space, exactly one trailing newline
                assert.strictEqual(serializeArtifact({ b: 1, a: 2 }), '{\n  "a": 2,\n  "b": 1\n}\n');
        });

        test('the ledger row hash re-derives exactly like the owning flauz-workspace rowHash', () => {
                const ledgerLine = '{"kind":"note","prev":null,"seq":1,"sha256":"5d41402abc4b2a76b9719d911017c592a8c8bbf84e34c1e9d70e2f3d2e1f0c3a","taskId":"T-001","ts":1740000000000,"uri":".flauz/artifacts/T-001/note.txt"}';
                const mine = parseLedgerLine(ledgerLine, 1);
                assert.ok(mine.ok, 'the duplicated parser accepts a real owning-format row');
                const owningRow = JSON.parse(ledgerLine) as Record<string, unknown>;
                assert.strictEqual(
                        ledgerRowHash(mine.ok ? mine.row : null as never),
                        workspaceRowHash(owningRow as never),
                        'the chain link value is byte-identical to the owning rowHash',
                );
                assert.strictEqual(ledgerRowHash(mine.ok ? mine.row : null as never), workspaceSha256Hex(rowLine(owningRow as never)));
        });

        test('the ops record hash re-derives exactly like the owning flauz-resources opRecordHash', () => {
                const opsLineText = '{"actor":"human","actorId":"test-driver","afterDigest":"5d41402abc4b2a76b9719d911017c592a8c8bbf84e34c1e9d70e2f3d2e1f0c3a","beforeDigest":"5d41402abc4b2a76b9719d911017c592a8c8bbf84e34c1e9d70e2f3d2e1f0c3a","cause":"fixture","op":"add-ref","prev":null,"refId":"flauz:task:T-001","seq":1,"ts":1740000000000}';
                const mine = parseOpsLine(opsLineText, 1);
                assert.ok(mine.ok, 'the duplicated parser accepts a real owning-format record');
                const owningRecord = JSON.parse(opsLineText) as Record<string, unknown>;
                assert.strictEqual(
                        opsRecordHash(mine.ok ? mine.row : null as never),
                        resourcesOpRecordHash(owningRecord as never),
                        'the chain link value is byte-identical to the owning opRecordHash',
                );
                assert.strictEqual(opsRecordHash(mine.ok ? mine.row : null as never), resourcesSha256Hex(opLine(owningRecord as never)));
        });

        test('the watermark serialization matches the owning serializeWatermark byte-for-byte', () => {
                const watermark: LedgerWatermark = {
                        $schema: SIZE_SCHEMA,
                        rowCount: 3,
                        bytes: 420,
                        headSha256: '5d41402abc4b2a76b9719d911017c592a8c8bbf84e34c1e9d70e2f3d2e1f0c3a',
                        lastCheckpointSeq: null,
                        updatedAt: 1_740_000_000_000,
                };
                assert.strictEqual(serializeWatermark(watermark), owningSerializeWatermark(watermark));
                // and the owning strict parser accepts our bytes round-trip
                assert.deepStrictEqual(parseWatermark(JSON.parse(serializeWatermark(watermark))), watermark);
        });

        test('the surface registry covers EXACTLY the W1 diagnostics census rows (ids identical, same order)', () => {
                // the census row keys, in census order (DurableStateCensus's own field order)
                const censusRows = ['tasks', 'evidenceLedger', 'evidenceWatermark', 'resourcesGraph', 'opsChain', 'environmentsRegistry', 'browserSessions', 'workflows', 'orchestration', 'providerLanesState'];
                assert.deepStrictEqual(SURFACES.map(def => def.id), censusRows, 'one SurfaceDef per census row, ids identical, census order');
                // every surface carries its format version + at least one fixed file
                for (const def of SURFACES) {
                        assert.ok(def.formatVersion.length > 0, `${def.id} pins a format version`);
                        assert.ok(def.fixedFiles.length > 0, `${def.id} enumerates at least one fixed file`);
                }
        });

        test('the format versions are the OWNING modules\' schema constants (never invented)', () => {
                const byId = new Map(SURFACES.map(def => [def.id, def]));
                assert.strictEqual(byId.get('tasks')?.formatVersion, TASKS_SCHEMA);
                assert.strictEqual(byId.get('evidenceWatermark')?.formatVersion, SIZE_SCHEMA);
                assert.strictEqual(byId.get('resourcesGraph')?.formatVersion, RESOURCES_SCHEMA);
                assert.strictEqual(byId.get('opsChain')?.formatVersion, OPS_SCHEMA_ID);
                assert.strictEqual(byId.get('browserSessions')?.formatVersion, BROWSER_SESSION_JOURNAL_SCHEMA_ID);
                assert.strictEqual(byId.get('workflows')?.formatVersion, WORKFLOW_SCHEMA);
                // orchestration + providerLanes are multi-file surfaces: every owning schema id appears
                const orch = byId.get('orchestration')?.formatVersion ?? '';
                assert.ok(orch.includes(ORCH_GRAPHS_SCHEMA), 'the orchestration format pins flauz.orch.graphs/v1');
                assert.ok(orch.includes('flauz.orch.journal/v1'), 'the orchestration format pins flauz.orch.journal/v1 (the owning journal $schema)');
                const lanes = byId.get('providerLanesState')?.formatVersion ?? '';
                assert.ok(lanes.includes(PROVIDERS_SCHEMA_ID), 'the provider-lanes format pins the providers schema');
                assert.ok(lanes.includes(ROUTING_POLICY_SCHEMA_ID), 'the provider-lanes format pins the routing-policy schema');
                assert.ok(lanes.includes(ROUTING_DECISION_SCHEMA_ID), 'the provider-lanes format pins the routing-decision schema');
                assert.ok(lanes.includes(PROVIDER_SWITCH_SCHEMA_ID), 'the provider-lanes format pins the provider-switch schema');
                // the environments registry: the shared contract fixture's self-declared schema
                const environments = byId.get('environmentsRegistry')?.formatVersion ?? '';
                assert.strictEqual(environments, 'flauz.environments/v0', 'the environments registry format is the owning registry\'s pinned schema');
                // the ledger row shape: the owning ledger self-declares no schema; the row contract IS the version
                assert.strictEqual(byId.get('evidenceLedger')?.formatVersion, 'flauz.evidence.rows/v0');
        });

        test('the per-file expected versions align with the owning schema constants (the version-source law)', () => {
                const byId = new Map(SURFACES.map(def => [def.id, def]));
                assert.strictEqual(expectedFileVersion(byId.get('tasks') as never, '.flauz/tasks.json'), TASKS_SCHEMA);
                assert.strictEqual(expectedFileVersion(byId.get('evidenceLedger') as never, '.flauz/evidence/ledger.jsonl'), 'flauz.evidence.rows/v0');
                assert.strictEqual(expectedFileVersion(byId.get('evidenceWatermark') as never, '.flauz/evidence/size.json'), SIZE_SCHEMA);
                assert.strictEqual(expectedFileVersion(byId.get('resourcesGraph') as never, '.flauz/resources.json'), RESOURCES_SCHEMA);
                assert.strictEqual(expectedFileVersion(byId.get('opsChain') as never, '.flauz/resources-ops.jsonl'), OPS_SCHEMA_ID);
                assert.strictEqual(expectedFileVersion(byId.get('browserSessions') as never, '.flauz/browser-sessions.jsonl'), BROWSER_SESSION_JOURNAL_SCHEMA_ID);
                assert.strictEqual(expectedFileVersion(byId.get('workflows') as never, '.flauz/workflows/index.json'), WORKFLOW_SCHEMA);
                assert.strictEqual(expectedFileVersion(byId.get('workflows') as never, '.flauz/workflows/W-001.json'), WORKFLOW_SCHEMA);
                assert.strictEqual(expectedFileVersion(byId.get('orchestration') as never, '.flauz/orchestration/graphs.json'), ORCH_GRAPHS_SCHEMA);
                assert.strictEqual(expectedFileVersion(byId.get('orchestration') as never, '.flauz/orchestration/journal.jsonl'), 'flauz.orch.journal/v1');
                assert.strictEqual(expectedFileVersion(byId.get('providerLanesState') as never, '.flauz/models/providers.json'), PROVIDERS_SCHEMA_ID);
                assert.strictEqual(expectedFileVersion(byId.get('providerLanesState') as never, '.flauz/models/routing-policy.json'), ROUTING_POLICY_SCHEMA_ID);
                assert.strictEqual(expectedFileVersion(byId.get('providerLanesState') as never, '.flauz/models/routing-decisions.jsonl'), ROUTING_DECISION_SCHEMA_ID);
                assert.strictEqual(expectedFileVersion(byId.get('providerLanesState') as never, '.flauz/models/provider-switches.jsonl'), PROVIDER_SWITCH_SCHEMA_ID);
        });

        test('the shared format module is byte-identical with the sibling extensions (the PU6 verbatim-copy law)', async () => {
                const mine = await fs.readFile(path.join(REPO_ROOT, 'extensions/flauz-migration/src/format.ts'), 'utf-8');
                const backup = await fs.readFile(path.join(REPO_ROOT, 'extensions/flauz-backup/src/format.ts'), 'utf-8');
                const diagnostics = await fs.readFile(path.join(REPO_ROOT, 'extensions/flauz-diagnostics/src/format.ts'), 'utf-8');
                assert.strictEqual(mine, backup, 'format.ts is byte-identical with flauz-backup');
                assert.strictEqual(mine, diagnostics, 'format.ts is byte-identical with flauz-diagnostics');
        });
});

suite('contract pins: the census + version mapping over the real durable state', () => {
        let fixture: FixtureWorkspace;

        suiteSetup(async () => {
                fixture = await bootFixtureWorkspace();
        });

        suiteTeardown(async () => {
                await fixture.cleanup();
        });

        test('the version inventory agrees with the REAL flauz-diagnostics census on the same workspace', async () => {
                const snapshot = await collectDiagnostics({
                        root: fixture.root,
                        fs: { readFileUtf8: async p => fixture.fs.readFileUtf8(p), readdir: async p => fixture.fs.readdir(p), mkdir: async p => fixture.fs.mkdir(p), writeFile: async (p, c) => fixture.fs.writeFile(p, c) },
                        clock: fixture.clock,
                        versions: fixtureVersions(),
                        environment: { nodeVersion: '24.21.0', platform: 'linux', arch: 'x64' },
                });
                const census = snapshot.durableState as unknown as Record<string, { present: boolean; path: string }>;
                const readings = await readSurfaceVersions(fixture.root, nodeMigrationFs());
                for (const def of SURFACES) {
                        const reading = readings.find(entry => entry.surface === def.id);
                        assert.ok(reading !== undefined, `the inventory carries the ${def.id} row`);
                        const row = census[def.id];
                        assert.ok(row !== undefined, `the census carries the ${def.id} row`);
                        assert.strictEqual(reading.present, row.present, `the ${def.id} presence agrees with the census`);
                }
        });

        test('every PRESENT surface version-reads as its expected version (the real durable state is all-current)', async () => {
                const readings = await readSurfaceVersions(fixture.root, nodeMigrationFs());
                for (const reading of readings) {
                        if (!reading.present) {
                                continue; // absent surfaces are listed absent, never faked
                        }
                        for (const file of reading.files.filter(file => file.present)) {
                                assert.strictEqual(file.detectedVersion, expectedFileVersion(SURFACES.find(def => def.id === reading.surface) as never, file.sourcePath), `${file.sourcePath} version-reads as the owning schema`);
                                assert.strictEqual(file.problem, undefined, `${file.sourcePath} carries no version problem`);
                        }
                }
                // the absent surface in the default fixture: the hardening watermark (the owner never wrote one)
                const watermark = readings.find(entry => entry.surface === 'evidenceWatermark');
                assert.ok(watermark !== undefined);
                assert.strictEqual(watermark.present, false, 'the default fixture carries no size watermark -- honestly absent');
        });

        test('the count fields agree with the REAL flauz-diagnostics census on the same workspace', async () => {
                const snapshot = await collectDiagnostics({
                        root: fixture.root,
                        fs: { readFileUtf8: async p => fixture.fs.readFileUtf8(p), readdir: async p => fixture.fs.readdir(p), mkdir: async p => fixture.fs.mkdir(p), writeFile: async (p, c) => fixture.fs.writeFile(p, c) },
                        clock: fixture.clock,
                        versions: fixtureVersions(),
                        environment: { nodeVersion: '24.21.0', platform: 'linux', arch: 'x64' },
                });
                const census = snapshot.durableState as unknown as Record<string, Record<string, unknown>>;
                const fsPort = nodeMigrationFs();
                for (const def of SURFACES) {
                        const texts = new Map<string, string>();
                        for (const file of def.fixedFiles) {
                                const text = await fsPort.readFileUtf8(joinPath(fixture.root, file));
                                if (text !== undefined) {
                                        texts.set(file, text);
                                }
                        }
                        if (def.dirFile !== undefined) {
                                const dirEntries = await fsPort.readdir(joinPath(fixture.root, def.dirFile.dir));
                                if (dirEntries !== undefined) {
                                        for (const name of dirEntries.filter(entry => def.dirFile !== undefined && def.dirFile.pattern.test(entry)).sort()) {
                                                const text = await fsPort.readFileUtf8(joinPath(fixture.root, joinPath(def.dirFile.dir, name)));
                                                if (text !== undefined) {
                                                        texts.set(joinPath(def.dirFile.dir, name), text);
                                                }
                                        }
                                }
                        }
                        const counts = countSurface(def.id, texts) as Record<string, unknown>;
                        const censusRow = census[def.id] as unknown as Record<string, unknown>;
                        for (const [key, value] of Object.entries(counts)) {
                                if (key === 'parseError' || key === 'providersFilePresent') {
                                        continue;
                                }
                                assert.deepStrictEqual(censusRow[key], value, `the ${def.id} count field ${key} matches the census`);
                        }
                }
        });

        test('the pre-flight integrity verdicts are THE SAME verdicts the diagnostics surface reports', async () => {
                const mine = await collectIntegrity(fixture.root, nodeMigrationFs());
                const diagnostics = await diagnosticsCollectIntegrity(fixture.root, {
                        readFileUtf8: async p => fixture.fs.readFileUtf8(p),
                        readdir: async p => fixture.fs.readdir(p),
                        mkdir: async p => fixture.fs.mkdir(p),
                        writeFile: async (p, c) => fixture.fs.writeFile(p, c),
                });
                // the verdict shapes are shared: rows/head/kindCount-level equality on the ledger,
                // ok/records equality on the ops chain (the checkpoints deferral wording is ours)
                assert.strictEqual(mine.evidenceLedger.ok, diagnostics.evidenceLedger.ok);
                assert.strictEqual(mine.evidenceLedger.rows, diagnostics.evidenceLedger.rows);
                assert.strictEqual(mine.evidenceLedger.headSha256, diagnostics.evidenceLedger.headSha256);
                assert.strictEqual(mine.evidenceLedger.watermark?.status, diagnostics.evidenceLedger.watermark?.status);
                assert.strictEqual(mine.opsChain.ok, diagnostics.opsChain.ok);
                assert.strictEqual(mine.opsChain.records, diagnostics.opsChain.records);
                assert.deepStrictEqual(mine.opsChain.problems, diagnostics.opsChain.problems);
        });

        test('a second stepping clock starting at the same epoch is deterministic (fixture reproducibility)', () => {
                const a = steppingClock();
                const b = steppingClock();
                assert.deepStrictEqual([a(), a(), a()], [b(), b(), b()]);
        });
});

suite('contract pins: the ANCHOR is cross-recognizable with the REAL flauz-backup (both directions)', () => {
        let fixture: FixtureWorkspace;
        let anchorDirName: string;

        suiteSetup(async () => {
                fixture = await bootFixtureWorkspace();
                const anchor = await createAnchorExport({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions() });
                anchorDirName = anchor.exportDirName;
        });

        suiteTeardown(async () => {
                await fixture.cleanup();
        });

        test('an anchor the MIGRATION creates verifies GREEN under the REAL flauz.backup verify', async () => {
                const verification = await realBackupVerifyExport({ root: fixture.root, fs: realBackupFsOf(fixture) }, anchorDirName);
                assert.strictEqual(verification.ok, true, `the migration's anchor is a genuine W2 export (metadata ${String(verification.metadata.verdict)}; ${verification.surfaces.filter(surface => surface.verdict !== 'green').map(surface => `${String(surface.surface)}=${surface.verdict}`).join(', ')})`);
        });

        test('a REAL flauz.backup export verifies GREEN under the MIGRATION\'s anchor verify', async () => {
                const exportResult = await realBackupCreateExport({
                        root: fixture.root,
                        fs: realBackupFsOf(fixture),
                        clock: fixture.clock,
                        versions: fixtureVersions(),
                } as RealExportDeps);
                const verification = await verifyAnchorExport({ root: fixture.root, fs: fixture.fs }, exportResult.exportDirName);
                assert.strictEqual(verification.ok, true, `the real flauz.backup export verifies as an anchor (metadata ${String(verification.metadata.verdict)})`);
        });

        test('the anchor artifact set carries the W2 schema ids + the migration provenance', async () => {
                const exportDir = joinPath(fixture.root, '.flauz-exports', anchorDirName);
                const exportMeta = JSON.parse(await fs.readFile(path.join(exportDir, 'export.json'), 'utf-8')) as Record<string, unknown>;
                assert.strictEqual(exportMeta.$schema, 'flauz.backup-export/v1');
                assert.strictEqual(exportMeta.formatVersion, 1);
                assert.strictEqual(exportMeta.commandLine, 'flauz.migration.execute');
                assert.strictEqual(exportMeta.extensionId, 'flauz.flauz-migration');
                const manifest = JSON.parse(await fs.readFile(path.join(exportDir, 'MANIFEST.json'), 'utf-8')) as Record<string, unknown>;
                assert.strictEqual(manifest.$schema, 'flauz.backup-manifest/v1');
                const integrity = JSON.parse(await fs.readFile(path.join(exportDir, 'integrity.json'), 'utf-8')) as Record<string, unknown>;
                assert.strictEqual(integrity.$schema, 'flauz.integrity/v0');
        });
});

/** The flauz-backup BackupFsPort over the fixture's MigrationFsPort (the shape-compatible shim). */
function realBackupFsOf(fixture: FixtureWorkspace): MigrationFsPort {
        // structural compatibility: BackupFsPort is MigrationFsPort minus `remove`
        return fixture.fs;
}
