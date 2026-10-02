/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * A-PROD-004-W2 -- the CONTRACT-PIN suite: the duplicated contract shapes
 * (DL-32) are pinned byte-equal against the OWNING modules, node:crypto, and
 * the flauz-diagnostics surface this wave builds on. The duplication is the
 * point (a backup's verify must not depend on any verified code being
 * importable); these pins keep it honest.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { SURFACES, canonicalJson, serializeArtifact, sha256Hex } from '../src/api.ts';
import { ledgerRowHash, opsRecordHash, parseLedgerLine, parseOpsLine, collectIntegrity } from '../src/verify.ts';
import { countSurface } from '../src/surfaces.ts';
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
import { bootFixtureWorkspace, nodeBackupFs, fixtureVersions, steppingClock, type FixtureWorkspace } from './helpers.ts';
import { serializeWatermark } from '../src/restore.ts';

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
});

suite('contract pins: the census mapping over the real durable state', () => {
        let fixture: FixtureWorkspace;

        suiteSetup(async () => {
                fixture = await bootFixtureWorkspace();
        });

        suiteTeardown(async () => {
                await fixture.cleanup();
        });

        test('the manifest\'s per-surface presence + counts agree with the REAL flauz-diagnostics census on the same workspace', async () => {
                const snapshot = await collectDiagnostics({
                        root: fixture.root,
                        fs: { readFileUtf8: async p => fixture.fs.readFileUtf8(p), readdir: async p => fixture.fs.readdir(p), mkdir: async p => fixture.fs.mkdir(p), writeFile: async (p, c) => fixture.fs.writeFile(p, c) },
                        clock: fixture.clock,
                        versions: fixtureVersions(),
                        environment: { nodeVersion: '24.21.0', platform: 'linux', arch: 'x64' },
                });
                const census = snapshot.durableState as unknown as Record<string, { present: boolean; path: string }>;
                // read every surface file through the backup port + count with the backup counting laws
                const fs = nodeBackupFs();
                for (const def of SURFACES) {
                        const texts = new Map<string, string>();
                        let anyPresent = false;
                        for (const file of def.fixedFiles) {
                                const text = await fs.readFileUtf8(`${fixture.root}/${file}`);
                                if (text !== undefined) {
                                        texts.set(file, text);
                                        anyPresent = true;
                                }
                        }
                        if (def.dirFile !== undefined) {
                                const entries = await fs.readdir(`${fixture.root}/${def.dirFile.dir}`);
                                if (entries !== undefined) {
                                        for (const name of entries.filter(entry => def.dirFile !== undefined && def.dirFile.pattern.test(entry)).sort()) {
                                                const text = await fs.readFileUtf8(`${fixture.root}/${def.dirFile.dir}/${name}`);
                                                if (text !== undefined) {
                                                        texts.set(`${def.dirFile.dir}/${name}`, text);
                                                        anyPresent = true;
                                                }
                                        }
                                }
                        }
                        const row = census[def.id];
                        assert.ok(row !== undefined, `the census carries the ${def.id} row`);
                        // census-present implies manifest-present (the census probes are a subset of the
                        // surface's file set; the backup's presence is the superset direction)
                        if (row.present) {
                                assert.strictEqual(anyPresent, true, `census-present ${def.id} implies backup-present`);
                        }
                        // the count fields agree field-by-field on the shared vocabulary
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

        test('the export-time integrity verdicts are THE SAME verdicts the diagnostics surface reports', async () => {
                const mine = await collectIntegrity(fixture.root, nodeBackupFs());
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
