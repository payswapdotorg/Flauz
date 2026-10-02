/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * A-PROD-004-W1 -- the support-bundle SHAPE suite (local-real).
 *
 * The fixture workspace is constructed by the REAL owning services
 * (test/helpers.ts); every assertion runs against the bundle the extension's
 * own builder wrote to disk.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { BUNDLE_SCHEMA_ID, joinPath } from '../src/api.ts';
import { ARTIFACT_CLASS_DISCLOSURE, createSupportBundle } from '../src/bundle.ts';
import { bootFixtureWorkspace, readAllFiles, type FixtureWorkspace } from './helpers.ts';

suite('support bundle: the shape over the real durable state', () => {
        let fixture: FixtureWorkspace;

        suiteSetup(async () => {
                fixture = await bootFixtureWorkspace();
        });

        suiteTeardown(async () => {
                await fixture.cleanup();
        });

        test('the default bundle creates every artifact class file under .flauz/support-bundle-<stamp>/', async () => {
                const result = await createSupportBundle({
                        root: fixture.root,
                        fs: fixture.fs,
                        clock: fixture.clock,
                        versions: { productVersion: '0.1.0', productName: 'Flauz', extensions: [{ id: 'flauz.flauz-diagnostics', version: '0.1.0' }] },
                        environment: { nodeVersion: '24.21.0', platform: 'linux', arch: 'x64' },
                });
                assert.match(result.bundleDirName, /^support-bundle-\d{4}-\d{2}-\d{2}T\d{6}\.\d{3}Z$/);
                const dirEntries = (await fs.readdir(result.bundleDir)).sort();
                assert.deepStrictEqual(dirEntries, ['MANIFEST.json', 'diagnostics.json', 'integrity.json', 'provider-lanes.json', 'recent-events.json']);
                const writtenClasses = result.files.map(file => file.artifactClass).sort();
                assert.deepStrictEqual(writtenClasses, ['diagnostics', 'integrity', 'manifest', 'provider-lanes', 'recent-events']);
                // the receipts are honest: every sha256 re-derives from the bytes on disk
                for (const receipt of result.files) {
                        const text = await fs.readFile(joinPath(result.bundleDir, receipt.file), 'utf-8');
                        const { createHash } = await import('node:crypto');
                        assert.strictEqual(createHash('sha256').update(text).digest('hex'), receipt.sha256, `${String(receipt.file)} receipt sha256`);
                }
        });

        test('MANIFEST.json enumerates exactly the artifact classes the bundle contains + the refused classes', async () => {
                const result = await createSupportBundle({
                        root: fixture.root,
                        fs: fixture.fs,
                        clock: fixture.clock,
                        versions: { productVersion: '0.1.0', productName: 'Flauz', extensions: [] },
                        environment: { nodeVersion: '24.21.0', platform: 'linux', arch: 'x64' },
                });
                const manifest = JSON.parse(await fs.readFile(path.join(result.bundleDir, 'MANIFEST.json'), 'utf-8')) as Record<string, unknown>;
                assert.strictEqual(manifest.$schema, BUNDLE_SCHEMA_ID);
                assert.strictEqual(manifest.schemaVersion, 0);
                const classes = (manifest.artifactClasses as Array<{ artifactClass: string }>).map(entry => entry.artifactClass).sort();
                assert.deepStrictEqual(classes, ['diagnostics', 'integrity', 'manifest', 'provider-lanes', 'recent-events']);
                // every enumerated class carries a `contains` disclosure (the MANIFEST law)
                for (const entry of manifest.artifactClasses as Array<{ artifactClass: string; contains: string; file: string }>) {
                        assert.ok(typeof entry.contains === 'string' && entry.contains.length > 30, `class ${String(entry.artifactClass)} documents what it contains`);
                        const onDisk = ARTIFACT_CLASS_DISCLOSURE.find(disclosure => disclosure.artifactClass === entry.artifactClass);
                        assert.ok(onDisk !== undefined && onDisk.contains === entry.contains);
                }
                // the refused classes are enumerated in every bundle (the privacy law, stated up front)
                const refused = manifest.refusedClasses as Array<{ artifactClass: string; requiresFutureDecision: string[] }>;
                assert.deepStrictEqual(refused.map(entry => entry.artifactClass), ['contents']);
                assert.ok(refused[0]?.requiresFutureDecision.length >= 3, 'the contents refusal lists the future-decision requirements');
        });

        test('diagnostics.json census counts match the real constructed durable state', async () => {
                const result = await createSupportBundle({
                        root: fixture.root,
                        fs: fixture.fs,
                        clock: fixture.clock,
                        versions: { productVersion: '0.1.0', productName: 'Flauz', extensions: [] },
                        environment: { nodeVersion: '24.21.0', platform: 'linux', arch: 'x64' },
                });
                const diagnostics = JSON.parse(await fs.readFile(path.join(result.bundleDir, 'diagnostics.json'), 'utf-8')) as {
                        durableState: Record<string, Record<string, unknown>>;
                };
                const census = diagnostics.durableState;
                assert.strictEqual(census.tasks?.taskCount, 2, 'two real tasks were created');
                assert.deepStrictEqual(census.tasks?.statusCounts, { plan: 2 }, 'both real tasks are still in plan');
                assert.ok((census.tasks?.eventCount as number) >= 1, 'the appended custom event is counted');
                assert.strictEqual(census.evidenceLedger?.rowCount, 2, 'two real ledger rows were appended');
                assert.match(String(census.evidenceLedger?.headSha256), /^[0-9a-f]{64}$/, 'the chain-head hash is a real digest');
                assert.deepStrictEqual(census.evidenceLedger?.kindCounts, { 'command-output': 1, note: 1 });
                assert.strictEqual(census.resourcesGraph?.refCount, 2, 'two refs were added to the real graph');
                assert.strictEqual(census.resourcesGraph?.edgeCount, 1);
                assert.strictEqual(census.resourcesGraph?.surfaceCount, 2);
                assert.ok((census.opsChain?.recordCount as number) >= 3, 'every graph mutation was recorded in the real ops chain');
                assert.strictEqual(census.environmentsRegistry?.environmentCount, 2, 'the shared environments contract fixture carries two descriptors');
                assert.strictEqual(census.browserSessions?.recordCount, 2, 'two real session-journal records were appended');
                assert.strictEqual(census.workflows?.envelopeCount, 1, 'one real workflow envelope was saved');
                assert.deepStrictEqual(census.workflows?.envelopeIds, ['W-001']);
                assert.strictEqual(census.orchestration?.graphCount, 1, 'one real graph was submitted');
                assert.ok((census.orchestration?.journalRowCount as number) >= 4, 'submit/approve/start/finish rows are in the real journal');
                assert.strictEqual(census.providerLanesState?.decisionRowCount, 2, 'both lane switches probed a durable decision');
                assert.strictEqual(census.evidenceWatermark?.present, false, 'the plain ledger carries no watermark');
        });

        test('provider-lanes.json carries lane/model ids + decision counts by lane -- and never endpoints or credential references', async () => {
                const result = await createSupportBundle({
                        root: fixture.root,
                        fs: fixture.fs,
                        clock: fixture.clock,
                        versions: { productVersion: '0.1.0', productName: 'Flauz', extensions: [] },
                        environment: { nodeVersion: '24.21.0', platform: 'linux', arch: 'x64' },
                });
                const lanes = JSON.parse(await fs.readFile(path.join(result.bundleDir, 'provider-lanes.json'), 'utf-8')) as {
                        lanes: Array<{ providerId: string; enabled: boolean | undefined; modelIds: string[] }>;
                        routingPolicy: { present: boolean; ruleIds: Array<{ id: string }> };
                        decisions: { count: number; byLane: Record<string, number> };
                        providerSwitchCount: number;
                };
                // the final lane set after the two real switches: lane-c enabled, others disabled
                const laneIds = lanes.lanes.map(lane => lane.providerId).sort();
                assert.deepStrictEqual(laneIds, ['flauz-mock', 'lane-b', 'lane-c']);
                const laneC = lanes.lanes.find(lane => lane.providerId === 'lane-c');
                assert.deepStrictEqual(laneC?.modelIds, ['lane-c-model']);
                assert.strictEqual(laneC?.enabled, true);
                assert.strictEqual(lanes.routingPolicy.present, true);
                assert.deepStrictEqual(lanes.routingPolicy.ruleIds.map(rule => rule.id), ['lane-primary']);
                assert.strictEqual(lanes.decisions.count, 2);
                assert.deepStrictEqual(lanes.decisions.byLane, { 'lane-b': 1, 'lane-c': 1 }, 'each real switch probe selected its own switched-to lane');
                assert.strictEqual(lanes.providerSwitchCount, 2, 'both P2-FIX-116 linking events are counted');
                // the summary law: no endpoints, no credential references, anywhere in the artifact
                // (the exclusion LIST names the excluded fields as disclosure -- no field carries a VALUE)
                const text = await fs.readFile(path.join(result.bundleDir, 'provider-lanes.json'), 'utf-8');
                assert.ok(!text.includes('"baseUrl"'), 'no baseUrl field in the lane summary');
                assert.ok(!text.includes('"credentialRef"'), 'no credentialRef field in the lane summary');
                assert.ok(!text.includes('http://127.0.0.1'), 'no endpoint literals in the lane summary');
        });

        test('recent-events.json carries the redacted tails of all three typed event surfaces', async () => {
                const result = await createSupportBundle({
                        root: fixture.root,
                        fs: fixture.fs,
                        clock: fixture.clock,
                        versions: { productVersion: '0.1.0', productName: 'Flauz', extensions: [] },
                        environment: { nodeVersion: '24.21.0', platform: 'linux', arch: 'x64' },
                });
                const events = JSON.parse(await fs.readFile(path.join(result.bundleDir, 'recent-events.json'), 'utf-8')) as {
                        executionJournal: { present: boolean; totalRows: number; tail: Array<Record<string, unknown>> };
                        opsChain: { present: boolean; totalRecords: number; tail: Array<Record<string, unknown>> };
                        providerSwitches: { present: boolean; totalRows: number; tail: Array<Record<string, unknown>> };
                };
                assert.strictEqual(events.executionJournal.present, true);
                assert.ok(events.executionJournal.totalRows >= 4);
                for (const row of events.executionJournal.tail) {
                        assert.deepStrictEqual(row.payload, { redacted: 'contents-class' }, 'journal payloads are dropped (contents class)');
                        assert.match(String(row.contentHash), /^[0-9a-f]{64}$/, 'the tamper-evidence digest survives the redaction');
                }
                assert.strictEqual(events.opsChain.present, true);
                for (const record of events.opsChain.tail) {
                        assert.strictEqual(record.freeTextRedacted, true);
                        assert.ok(!('cause' in record) && !('note' in record), 'ops free-form fields are dropped');
                }
                assert.strictEqual(events.providerSwitches.present, true);
                assert.strictEqual(events.providerSwitches.totalRows, 2);
                for (const switchEvent of events.providerSwitches.tail) {
                        assert.strictEqual(switchEvent.explanationRedacted, true, 'switch explanations are dropped');
                        assert.ok(!('explanation' in switchEvent), 'no explanation text rides the tail');
                        assert.ok(typeof switchEvent.routingDecision === 'object' && switchEvent.routingDecision !== null, 'the linking event keeps its three-artifact references');
                }
        });

        test('integrity.json carries both chain verdicts and both are ok over the real chains', async () => {
                const result = await createSupportBundle({
                        root: fixture.root,
                        fs: fixture.fs,
                        clock: fixture.clock,
                        versions: { productVersion: '0.1.0', productName: 'Flauz', extensions: [] },
                        environment: { nodeVersion: '24.21.0', platform: 'linux', arch: 'x64' },
                });
                const integrity = JSON.parse(await fs.readFile(path.join(result.bundleDir, 'integrity.json'), 'utf-8')) as {
                        evidenceLedger: { ok: boolean; rows: number; headSha256: string };
                        opsChain: { ok: boolean; records: number; problems: unknown[] };
                };
                assert.strictEqual(integrity.evidenceLedger.ok, true);
                assert.strictEqual(integrity.evidenceLedger.rows, 2);
                assert.match(integrity.evidenceLedger.headSha256, /^[0-9a-f]{64}$/);
                assert.strictEqual(integrity.opsChain.ok, true);
                assert.deepStrictEqual(integrity.opsChain.problems, []);
                assert.ok(integrity.opsChain.records >= 3, `the real ops chain carries its mutation records (got ${String(integrity.opsChain.records)})`);
        });

        test('the bundle never escapes .flauz/ and every file is canonical (sorted keys, one trailing newline)', async () => {
                const result = await createSupportBundle({
                        root: fixture.root,
                        fs: fixture.fs,
                        clock: fixture.clock,
                        versions: { productVersion: '0.1.0', productName: 'Flauz', extensions: [] },
                        environment: { nodeVersion: '24.21.0', platform: 'linux', arch: 'x64' },
                });
                assert.ok(path.relative(path.join(fixture.root, '.flauz'), result.bundleDir).startsWith('support-bundle-'));
                for (const receipt of result.files) {
                        const text = await fs.readFile(joinPath(result.bundleDir, receipt.file), 'utf-8');
                        assert.ok(text.endsWith('\n') && !text.endsWith('\n\n'), `${String(receipt.file)} carries exactly one trailing newline`);
                        const roundTrip = JSON.stringify(JSON.parse(text), null, 2) + '\n';
                        assert.strictEqual(text, roundTrip, `${String(receipt.file)} is canonically serialized (sorted keys, 2-space)`);
                }
        });
});
