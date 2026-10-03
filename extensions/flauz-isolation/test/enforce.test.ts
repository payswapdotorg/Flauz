/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The enforcement semantics (A-PROD-005-W3): the one-tree law, the
 * export-dir shape, the telemetry local-only law, the memory-tier +
 * migration-state containment, the banked-record taskId law -- each with
 * the typed verdict table green/violation/unknown/absent (absent surfaces
 * degrade typed, never a silent green); the persistence + banking; the
 * determinism law.
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { ENFORCE_SCHEMA_ID, ISOLATION_TASK_ID, parseLedgerLine } from '../src/api.ts';
import { runEnforce, persistEnforce, enforceStamp } from '../src/enforce.ts';
import { ENFORCE_PREFIX } from '../src/api.ts';
import {
        nodeIsolationFs,
        steppingClock,
        tempRoot,
        plantFixtureProduct,
        plantFixtureWorkspace,
        plantNestedFlauzTree,
        plantStrayExport,
        plantExportsDirAsFile,
        plantAnonymousLedgerRow,
        plantTornLedgerLine,
        plantSymlinkIntoBoundary,
} from './helpers.ts';

const fsPort = nodeIsolationFs();

const CHECK_IDS = ['crossWorkspaceCensus', 'exportDirShape', 'telemetryLocalOnly', 'memoryTierContainment', 'migrationStateContainment', 'bankedRecordTaskId'];

/** Boots an enforce fixture (the registry rides along so the walk sees a real-shaped tree). */
async function bootEnforceFixture(options: Parameters<typeof plantFixtureWorkspace>[1] = {}, withProduct = true) {
        const { root, cleanup } = await tempRoot('flauz-iso-enf-');
        if (withProduct) {
                await plantFixtureProduct(root);
        }
        await plantFixtureWorkspace(root, options, steppingClock());
        return { root, cleanup };
}

suite('flauz.isolation.enforce — the six typed checks', () => {
        test('the verdict table vocabulary + the six check ids (the order\'s law, verbatim)', async () => {
                const { root, cleanup } = await bootEnforceFixture({});
                try {
                        const result = await runEnforce({ root, fs: fsPort, clock: steppingClock() });
                        assert.equal(result.record.$schema, ENFORCE_SCHEMA_ID);
                        assert.equal(result.record.kind, 'flauz-isolation-enforce');
                        assert.deepEqual(result.record.checks.map(check => check.id), CHECK_IDS);
                        for (const check of result.record.checks) {
                                assert.ok(['green', 'violation', 'unknown', 'absent'].includes(check.verdict), `${check.id} carries a typed verdict`);
                        }
                        assert.equal(result.record.counts.green + result.record.counts.violation + result.record.counts.unknown + result.record.counts.absent, 6);
                } finally {
                        await cleanup();
                }
        });

        test('the full lawful workspace: every check green, ok=true (the never-silent-green aggregate)', async () => {
                const { root, cleanup } = await bootEnforceFixture({ withEvidence: true, withTelemetry: true, withMemory: true, withMigration: true, withExport: true });
                try {
                        const result = await runEnforce({ root, fs: fsPort, clock: steppingClock() });
                        for (const check of result.record.checks) {
                                assert.equal(check.verdict, 'green', `${check.id}: ${check.reasons.join('; ')}`);
                        }
                        assert.equal(result.record.ok, true);
                        assert.equal(result.ok, true);
                } finally {
                        await cleanup();
                }
        });

        test('the one-tree law: exactly ONE .flauz tree by law', async () => {
                const { root, cleanup } = await bootEnforceFixture({ withEvidence: true });
                try {
                        const result = await runEnforce({ root, fs: fsPort, clock: steppingClock() });
                        const census = result.record.checks.find(check => check.id === 'crossWorkspaceCensus');
                        assert.equal(census?.verdict, 'green');
                } finally {
                        await cleanup();
                }
        });

        test('the multi-tree violation: a second .flauz tree = typed violation with the paths + the containment degradations to unknown', async () => {
                const { root, cleanup } = await bootEnforceFixture({ withEvidence: true, withTelemetry: true, withMemory: true, withMigration: true });
                const nested = await plantNestedFlauzTree(root);
                try {
                        const result = await runEnforce({ root, fs: fsPort, clock: steppingClock() });
                        const census = result.record.checks.find(check => check.id === 'crossWorkspaceCensus');
                        assert.equal(census?.verdict, 'violation');
                        assert.match(census?.reasons[0] ?? '', new RegExp(nested.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
                        assert.ok((census?.details.flauzTrees as string[]).includes('.flauz') && (census?.details.flauzTrees as string[]).includes(nested), 'the violation carries BOTH paths');
                        // the containment checks degrade typed -- containment is unprovable while a second tree exists
                        for (const id of ['telemetryLocalOnly', 'memoryTierContainment', 'migrationStateContainment']) {
                                const check = result.record.checks.find(candidate => candidate.id === id);
                                assert.equal(check?.verdict, 'unknown', `${id} degrades to unknown (never a silent green)`);
                        }
                        assert.equal(result.record.ok, false);
                        assert.equal(result.record.counts.violation, 1);
                        assert.equal(result.record.counts.unknown, 3);
                } finally {
                        await cleanup();
                }
        });

        test('a workspace whose ONLY .flauz tree is a NESTED one = violation, never a green (the lawful tree is the root\'s own)', async () => {
                const { root, cleanup } = await tempRoot('flauz-iso-enf-');
                try {
                        await plantFixtureProduct(root);
                        const nested = await plantNestedFlauzTree(root);
                        const result = await runEnforce({ root, fs: fsPort, clock: steppingClock() });
                        const census = result.record.checks.find(check => check.id === 'crossWorkspaceCensus');
                        assert.equal(census?.verdict, 'violation', 'a lone nested tree is the cross-workspace bleed');
                        assert.ok((census?.reasons[0] ?? '').includes(nested));
                        assert.equal(result.record.ok, false);
                } finally {
                        await cleanup();
                }
        });

        test('the fresh workspace: zero trees = the typed absent degradations (never a silent green)', async () => {
                const { root, cleanup } = await bootEnforceFixture({});
                try {
                        const result = await runEnforce({ root, fs: fsPort, clock: steppingClock() });
                        for (const check of result.record.checks) {
                                assert.equal(check.verdict, 'absent', `${check.id} degrades absent on the fresh workspace`);
                        }
                        assert.equal(result.record.ok, false, 'an all-absent verdict table is NOT ok (the honest fresh-workspace truth)');
                        assert.equal(result.record.counts.absent, 6);
                } finally {
                        await cleanup();
                }
        });
});

suite('flauz.isolation.enforce — the export-dir shape', () => {
        test('green: the exports dir present, every export-shaped dir directly under it', async () => {
                const { root, cleanup } = await bootEnforceFixture({ withExport: true });
                try {
                        const result = await runEnforce({ root, fs: fsPort, clock: steppingClock() });
                        assert.equal(result.record.checks.find(check => check.id === 'exportDirShape')?.verdict, 'green');
                } finally {
                        await cleanup();
                }
        });

        test('violation: an export banked outside the exports dir (the exact path in the row)', async () => {
                const { root, cleanup } = await bootEnforceFixture({ withExport: true });
                const stray = await plantStrayExport(root);
                try {
                        const result = await runEnforce({ root, fs: fsPort, clock: steppingClock() });
                        const check = result.record.checks.find(candidate => candidate.id === 'exportDirShape');
                        assert.equal(check?.verdict, 'violation');
                        assert.ok((check?.reasons.join('; ') ?? '').includes(stray), 'the exact path rides the row');
                } finally {
                        await cleanup();
                }
        });

        test('unknown: a FILE where the exports dir belongs (unresolvable, degraded typed)', async () => {
                const { root, cleanup } = await bootEnforceFixture({});
                await plantExportsDirAsFile(root);
                try {
                        const result = await runEnforce({ root, fs: fsPort, clock: steppingClock() });
                        assert.equal(result.record.checks.find(check => check.id === 'exportDirShape')?.verdict, 'unknown');
                } finally {
                        await cleanup();
                }
        });
});

suite('flauz.isolation.enforce — the banked-record taskId law', () => {
        test('green: every banked row names its owning extension (rows through the real banking writer)', async () => {
                const { root, cleanup } = await bootEnforceFixture({ withEvidence: true });
                try {
                        const result = await runEnforce({ root, fs: fsPort, clock: steppingClock() });
                        const check = result.record.checks.find(candidate => candidate.id === 'bankedRecordTaskId');
                        assert.equal(check?.verdict, 'green');
                        assert.match(check?.reasons[0] ?? '', new RegExp(ISOLATION_TASK_ID));
                } finally {
                        await cleanup();
                }
        });

        test('violation: an anonymous banked row (no taskId) = typed violation with the line number', async () => {
                const { root, cleanup } = await bootEnforceFixture({ withEvidence: true });
                const lineNo = await plantAnonymousLedgerRow(root);
                try {
                        const result = await runEnforce({ root, fs: fsPort, clock: steppingClock() });
                        const check = result.record.checks.find(candidate => candidate.id === 'bankedRecordTaskId');
                        assert.equal(check?.verdict, 'violation');
                        assert.deepEqual((check?.details.anonymousLines as number[]), [lineNo]);
                        assert.ok((check?.reasons[0] ?? '').includes(String(lineNo)), 'the offending line number rides the reason');
                } finally {
                        await cleanup();
                }
        });

        test('unknown: a torn banked row (unparseable) = typed unknown with the line number', async () => {
                const { root, cleanup } = await bootEnforceFixture({ withEvidence: true });
                const lineNo = await plantTornLedgerLine(root);
                try {
                        const result = await runEnforce({ root, fs: fsPort, clock: steppingClock() });
                        const check = result.record.checks.find(candidate => candidate.id === 'bankedRecordTaskId');
                        assert.equal(check?.verdict, 'unknown');
                        assert.deepEqual((check?.details.tornLines as number[]), [lineNo]);
                } finally {
                        await cleanup();
                }
        });

        test('absent: no ledger exists (nothing banked in this workspace)', async () => {
                const { root, cleanup } = await bootEnforceFixture({});
                try {
                        const result = await runEnforce({ root, fs: fsPort, clock: steppingClock() });
                        assert.equal(result.record.checks.find(check => check.id === 'bankedRecordTaskId')?.verdict, 'absent');
                } finally {
                        await cleanup();
                }
        });
});

suite('flauz.isolation.enforce — the containment laws', () => {
        test('violation: a symlink leak targeting the telemetry surface', async () => {
                const { root, cleanup } = await bootEnforceFixture({ withTelemetry: true });
                await plantSymlinkIntoBoundary(root, 'repo/leaked-telemetry.json', '.flauz/telemetry/config.json');
                try {
                        const result = await runEnforce({ root, fs: fsPort, clock: steppingClock() });
                        const check = result.record.checks.find(candidate => candidate.id === 'telemetryLocalOnly');
                        assert.equal(check?.verdict, 'violation');
                        assert.ok((check?.reasons.join('; ') ?? '').includes('repo/leaked-telemetry.json'));
                } finally {
                        await cleanup();
                }
        });

        test('green: a leak targeting ANOTHER surface never flags the telemetry law (no false positive)', async () => {
                const { root, cleanup } = await bootEnforceFixture({ withTelemetry: true, withEvidence: true });
                await plantSymlinkIntoBoundary(root, 'repo/leaked-ledger.jsonl', '.flauz/evidence/ledger.jsonl');
                try {
                        const result = await runEnforce({ root, fs: fsPort, clock: steppingClock() });
                        assert.equal(result.record.checks.find(check => check.id === 'telemetryLocalOnly')?.verdict, 'green');
                        // the leak is still disclosed by the census-class machinery through the audit plane (the
                        // boundary scan's findings ride the audit record; the enforce containment rows only claim
                        // their own surfaces)
                } finally {
                        await cleanup();
                }
        });
});

suite('flauz.isolation.enforce — persistence, banking, determinism', () => {
        test('the record persists at .flauz/isolation/enforce-<stamp>.json + banks census-visible, whatever the verdict', async () => {
                const { root, cleanup } = await bootEnforceFixture({ withEvidence: true, withTelemetry: true, withMemory: true, withMigration: true, withExport: true });
                const clock = steppingClock();
                try {
                        const result = await runEnforce({ root, fs: fsPort, clock });
                        assert.equal(result.record.ok, true, 'the full lawful fixture is ok (every check green)');
                        const persisted = await persistEnforce({ root, fs: fsPort, clock }, result.record);
                        const expectedPath = path.join(root, '.flauz', 'isolation', `${ENFORCE_PREFIX}${enforceStamp(result.record.createdAt)}.json`);
                        assert.equal(persisted.recordPath, expectedPath);
                        const onDisk = await fs.readFile(expectedPath, 'utf-8');
                        assert.ok(onDisk.includes('"flauz-isolation-enforce/v1"'));
                        // the census-visible banking
                        const ledger = await fs.readFile(path.join(root, '.flauz', 'evidence', 'ledger.jsonl'), 'utf-8');
                        const lines = ledger.split('\n').filter(line => line !== '');
                        const rows = lines.map((line, index) => parseLedgerLine(line, index + 1)).filter(row => row.ok).map(row => row.row);
                        const recordRows = rows.filter(row => row.uri === '.flauz/isolation/' + path.basename(expectedPath));
                        assert.equal(recordRows.length, 1, 'exactly one row banks THIS enforce record');
                        assert.equal(recordRows[0]?.taskId, ISOLATION_TASK_ID);
                        assert.ok(rows.some(row => row.taskId === 'flauz-workspace'), 'the seeded owning-extension row still names its owner');
                } finally {
                        await cleanup();
                }
        });

        test('a NOT-OK verdict still persists (never a silent green, never a swallowed verdict)', async () => {
                const { root, cleanup } = await bootEnforceFixture({});
                const clock = steppingClock();
                try {
                        const result = await runEnforce({ root, fs: fsPort, clock });
                        assert.equal(result.record.ok, false);
                        const persisted = await persistEnforce({ root, fs: fsPort, clock }, result.record);
                        const onDisk = await fs.readFile(persisted.recordPath, 'utf-8');
                        assert.ok(onDisk.includes('"ok": false'), 'the not-ok verdict rides the record');
                } finally {
                        await cleanup();
                }
        });

        test('the determinism law: identical fixtures + identical clock = byte-identical records', async () => {
                const bootA = await tempRoot('flauz-iso-ene-a-');
                const bootB = await tempRoot('flauz-iso-ene-b-');
                try {
                        for (const root of [bootA.root, bootB.root]) {
                                await plantFixtureProduct(root);
                                await plantFixtureWorkspace(root, { withEvidence: true, withExport: true }, steppingClock());
                        }
                        const a = await persistEnforce({ root: bootA.root, fs: fsPort, clock: steppingClock() }, (await runEnforce({ root: bootA.root, fs: fsPort, clock: steppingClock() })).record);
                        const b = await persistEnforce({ root: bootB.root, fs: fsPort, clock: steppingClock() }, (await runEnforce({ root: bootB.root, fs: fsPort, clock: steppingClock() })).record);
                        const bytesA = await fs.readFile(a.recordPath);
                        const bytesB = await fs.readFile(b.recordPath);
                        assert.deepEqual(new Uint8Array(bytesA), new Uint8Array(bytesB), 'the two enforce records are byte-identical');
                } finally {
                        await bootA.cleanup();
                        await bootB.cleanup();
                }
        });
});
