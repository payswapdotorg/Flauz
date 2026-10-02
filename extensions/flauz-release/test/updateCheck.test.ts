/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * A-PROD-004-W5 -- the UPDATE-CHECK suite (local-real): the
 * migration-readiness matrix (identity / transform / refusal per surface
 * version pair), the anchor dry-run, the torn refusal, and the never-writes
 * law.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { checkUpdateReadiness, classifySurface, PRODUCTION_TRANSFORMS, renderUpdateReadiness, type TransformSpec } from '../src/updateCheck.ts';
import { SURFACES } from '../src/api.ts';
import { readSurfaceVersions } from '../src/versionInventory.ts';
import { bootFixtureProduct, bootFixtureWorkspace, plantTornMarker, writeFutureVersionedTasks, type FixtureWorkspace } from './helpers.ts';

function readinessOf(rows: readonly { surface: string; readiness: string }[], surface: string): string | undefined {
        return rows.find(row => row.surface === surface)?.readiness;
}

async function writeVersionedTasks(root: string, schema: string): Promise<void> {
        const tasksPath = path.join(root, '.flauz', 'tasks.json');
        const tasksText = await fs.readFile(tasksPath, 'utf-8');
        const parsed = JSON.parse(tasksText) as Record<string, unknown>;
        parsed.$schema = schema;
        await fs.writeFile(tasksPath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');
}

suite('A-PROD-004-W5 update check: the clean fixture is READY (identity/absent, anchor feasible, nothing written)', () => {
        let fixture: FixtureWorkspace;

        suiteSetup(async () => {
                fixture = await bootFixtureWorkspace();
        });
        suiteTeardown(async () => {
                await fixture.cleanup();
        });

        test('the readiness matrix: the present surfaces are identity, the absent surface is absent (the honest watermark-less base fixture)', async () => {
                const readiness = await checkUpdateReadiness({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: { productVersion: '0.1.0', productName: 'Flauz', extensions: [] } });
                assert.equal(readiness.ok, true);
                assert.equal(readiness.surfaces.length, 10);
                assert.equal(readiness.surfaces.filter(row => row.readiness === 'identity').length, 9);
                assert.deepEqual(readiness.surfaces.filter(row => row.readiness === 'absent').map(row => row.surface), ['evidenceWatermark']);
                assert.deepEqual(readiness.refusalReasons, []);
        });

        test('the anchor dry-run: feasible, enumerates every present surface + file + byte', async () => {
                const readiness = await checkUpdateReadiness({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: { productVersion: '0.1.0', productName: 'Flauz', extensions: [] } });
                assert.equal(readiness.anchor.feasible, true);
                assert.equal(readiness.anchor.surfaceCount, 10);
                assert.equal(readiness.anchor.presentSurfaceCount, 9);
                assert.ok(readiness.anchor.plannedFileCount > 0);
                assert.ok(readiness.anchor.plannedBytes > 0);
                assert.deepEqual(readiness.anchor.existingAnchors, []);
        });

        test('the read-only law: the update check writes NOTHING', async () => {
                const filesBefore = new Set((await walk(path.join(fixture.root, '.flauz'))).map(file => file.rel));
                await checkUpdateReadiness({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: { productVersion: '0.1.0', productName: 'Flauz', extensions: [] } });
                const filesAfter = new Set((await walk(path.join(fixture.root, '.flauz'))).map(file => file.rel));
                assert.deepEqual([...filesAfter].sort(), [...filesBefore].sort());
                assert.equal(await fs.stat(path.join(fixture.root, '.flauz-exports')).then(() => true, () => false), false, 'the update check must not cut an anchor');
                assert.equal(await fs.stat(path.join(fixture.root, '.flauz', 'migration')).then(() => true, () => false), false, 'the update check must not touch the migration home');
        });

        test('the render carries the verdict + the never-updates law + the matrix', async () => {
                const readiness = await checkUpdateReadiness({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: { productVersion: '0.1.0', productName: 'Flauz', extensions: [] } });
                const lines = renderUpdateReadiness(readiness);
                assert.ok(lines.some(line => line.includes('verdict READY')));
                assert.ok(lines.some(line => line.includes('NEVER performs the update')));
                assert.ok(lines.some(line => line.includes('identity') && line.includes('tasks')));
                assert.ok(lines.some(line => line.includes('absent') && line.includes('evidenceWatermark')));
                assert.ok(lines.some(line => line.includes('anchor dry-run') && line.includes('FEASIBLE')));
        });
});

async function walk(dir: string, prefix = ''): Promise<{ rel: string }[]> {
        let entries;
        try {
                entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
                return [];
        }
        const out: { rel: string }[] = [];
        for (const entry of entries) {
                const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
                if (entry.isDirectory()) {
                        out.push(...await walk(path.join(dir, entry.name), rel));
                } else {
                        out.push({ rel });
                }
        }
        return out;
}

suite('A-PROD-004-W5 update check: the migration-readiness matrix per surface version pair', () => {
        let fixture: FixtureWorkspace;

        suiteSetup(async () => {
                fixture = await bootFixtureWorkspace();
        });
        suiteTeardown(async () => {
                await fixture.cleanup();
        });

        test('an unrecognized (future) version is a REFUSAL naming the exact surface + file', async () => {
                const fixture = await bootFixtureWorkspace();
                try {
                        await writeVersionedTasks(fixture.root, 'flauz.tasks/v99');
                        const readiness = await checkUpdateReadiness({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: { productVersion: '0.1.0', productName: 'Flauz', extensions: [] } });
                        assert.equal(readiness.ok, false);
                        assert.equal(readinessOf(readiness.surfaces, 'tasks'), 'refusal');
                        const tasksRow = readiness.surfaces.find(row => row.surface === 'tasks');
                        assert.ok(tasksRow);
                        assert.ok(tasksRow.reasons.some(reason => reason.includes('no bridging transform exists') && reason.includes('flauz.tasks/v99')));
                        assert.ok(readiness.refusalReasons.some(reason => reason.includes('tasks cannot migrate safely')));
                } finally {
                        await fixture.cleanup();
                }
        });

        test('a torn surface file (lost trailing newline) is a REFUSAL with the torn problem', async () => {
                const fixture = await bootFixtureWorkspace();
                try {
                        const journalPath = path.join(fixture.root, '.flauz', 'orchestration', 'journal.jsonl');
                        const text = await fs.readFile(journalPath, 'utf-8');
                        await fs.writeFile(journalPath, text.slice(0, -1), 'utf-8'); // drop the trailing newline
                        const readiness = await checkUpdateReadiness({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: { productVersion: '0.1.0', productName: 'Flauz', extensions: [] } });
                        assert.equal(readiness.ok, false);
                        assert.equal(readinessOf(readiness.surfaces, 'orchestration'), 'refusal');
                        const orchestrationRow = readiness.surfaces.find(row => row.surface === 'orchestration');
                        assert.ok(orchestrationRow);
                        assert.ok(orchestrationRow.reasons.some(reason => reason.includes('torn') || reason.includes('does not end with a newline')));
                } finally {
                        await fixture.cleanup();
                }
        });

        test('a version with a bridging transform is a TRANSFORM (from -> to); without one it is a REFUSAL (the honest production scope)', async () => {
                const fixture = await bootFixtureWorkspace();
                try {
                        await writeVersionedTasks(fixture.root, 'flauz.tasks/v1');
                        const readings = await readSurfaceVersions(fixture.root, fixture.fs);
                        const tasksReading = readings.find(reading => reading.surface === 'tasks');
                        assert.ok(tasksReading);
                        const tasksDef = SURFACES.find(def => def.id === 'tasks');
                        assert.ok(tasksDef);
                        // the production registry is EMPTY (the W3 law mirrored) -> refusal
                        assert.equal(PRODUCTION_TRANSFORMS.length, 0);
                        assert.equal(classifySurface(tasksDef, tasksReading, PRODUCTION_TRANSFORMS).readiness, 'refusal');
                        // an injected bridge -> transform with from/to
                        const bridge: readonly TransformSpec[] = [{ surface: 'tasks', fromVersion: 'flauz.tasks/v1', toVersion: 'flauz.tasks/v0' }];
                        const classified = classifySurface(tasksDef, tasksReading, bridge);
                        assert.equal(classified.readiness, 'transform');
                        assert.equal(classified.fromVersion, 'flauz.tasks/v1');
                        assert.equal(classified.toVersion, 'flauz.tasks/v0');
                        // and the whole gate turns READY with the bridge
                        const readiness = await checkUpdateReadiness({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: { productVersion: '0.1.0', productName: 'Flauz', extensions: [] }, transforms: bridge });
                        assert.equal(readiness.ok, true);
                        assert.equal(readinessOf(readiness.surfaces, 'tasks'), 'transform');
                } finally {
                        await fixture.cleanup();
                }
        });

        test('a mixed-version surface is a REFUSAL (one step must bridge ONE declared version)', async () => {
                const fixture = await bootFixtureWorkspace();
                try {
                        // the provider lanes family: two files carried to DIFFERENT future versions (a genuinely mixed surface)
                        const policyPath = path.join(fixture.root, '.flauz', 'models', 'routing-policy.json');
                        const policyText = await fs.readFile(policyPath, 'utf-8');
                        const parsed = JSON.parse(policyText) as Record<string, unknown>;
                        parsed.schema = 'flauz.model-routing-policy/v9';
                        await fs.writeFile(policyPath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');
                        const switchesPath = path.join(fixture.root, '.flauz', 'models', 'provider-switches.jsonl');
                        const switchesText = await fs.readFile(switchesPath, 'utf-8');
                        const switchLines = switchesText.split('\n').filter(line => line !== '').map(line => {
                                const row = JSON.parse(line) as Record<string, unknown>;
                                row.$schema = 'flauz.model-provider-switch/v8';
                                return JSON.stringify(row);
                        });
                        await fs.writeFile(switchesPath, `${switchLines.join('\n')}\n`, 'utf-8');
                        const readings = await readSurfaceVersions(fixture.root, fixture.fs);
                        const lanesReading = readings.find(reading => reading.surface === 'providerLanesState');
                        assert.ok(lanesReading);
                        const lanesDef = SURFACES.find(def => def.id === 'providerLanesState');
                        assert.ok(lanesDef);
                        const classified = classifySurface(lanesDef, lanesReading, [{ surface: 'providerLanesState', fromVersion: 'flauz.model-routing-policy/v9', toVersion: lanesDef.formatVersion }]);
                        assert.equal(classified.readiness, 'refusal');
                        assert.ok(classified.reasons.some(reason => reason.includes('mix format versions')));
                } finally {
                        await fixture.cleanup();
                }
        });
});

suite('A-PROD-004-W5 update check: the torn refusal + the anchor inventory', () => {
        test('a torn migration state refuses the whole gate (the W3 plan semantics; nothing is classified)', async () => {
                const fixture = await bootFixtureWorkspace();
                try {
                        await plantTornMarker(fixture.root, 'export-2100-01-01T00-00-00-000Z');
                        const readiness = await checkUpdateReadiness({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: { productVersion: '0.1.0', productName: 'Flauz', extensions: [] } });
                        assert.equal(readiness.ok, false);
                        assert.equal(readiness.torn.torn, true);
                        assert.deepEqual(readiness.surfaces, []);
                        assert.equal(readiness.anchor.feasible, false);
                        assert.ok(readiness.refusalReasons.some(reason => reason.includes('TORN migration state')));
                        assert.ok(readiness.refusalReasons.some(reason => reason.includes('evidenceLedger')));
                        const lines = renderUpdateReadiness(readiness);
                        assert.ok(lines.some(line => line.includes('NOT-READY')));
                        assert.ok(lines.some(line => line.includes('TORN MIGRATION DETECTED')));
                        assert.ok(lines.some(line => line.includes('flauz.migration.rollback')));
                } finally {
                        await fixture.cleanup();
                }
        });

        test('the anchor dry-run lists the existing anchors (the W2 inventory)', async () => {
                const fixture = await bootFixtureWorkspace();
                try {
                        // a self-export cut earlier is an existing anchor for the dry-run to list
                        const { createSelfExport } = await import('../src/selfExport.ts');
                        await createSelfExport({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: { productVersion: '0.1.0', productName: 'Flauz', extensions: [] } }, 'flauz.release.verify');
                        const readiness = await checkUpdateReadiness({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: { productVersion: '0.1.0', productName: 'Flauz', extensions: [] } });
                        assert.equal(readiness.anchor.existingAnchors.length, 1);
                        assert.ok(readiness.anchor.existingAnchors[0]?.startsWith('export-'));
                        assert.equal(readiness.ok, true);
                } finally {
                        await fixture.cleanup();
                }
        });

        test('a future-versioned surface keeps the census-clean class honest (parse-clean, unrecognized)', async () => {
                const fixture = await bootFixtureWorkspace();
                try {
                        await writeFutureVersionedTasks(fixture.root);
                        const { collectDurableStateCensus, censusProblems } = await import('../src/census.ts');
                        const census = await collectDurableStateCensus(fixture.root, fixture.fs);
                        assert.deepEqual(censusProblems(census), [], 'a future-versioned surface still parses -- the census stays clean; the version reader owns the refusal');
                        const readiness = await checkUpdateReadiness({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: { productVersion: '0.1.0', productName: 'Flauz', extensions: [] } });
                        assert.equal(readinessOf(readiness.surfaces, 'tasks'), 'refusal');
                } finally {
                        await fixture.cleanup();
                }
        });
});
