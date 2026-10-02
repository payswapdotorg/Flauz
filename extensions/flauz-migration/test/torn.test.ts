/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * A-PROD-004-W3 -- the TORN suite: each torn fixture reports the RIGHT
 * SURFACE (the exact-surface law). The three signal classes:
 *
 *   1. the in-progress marker (an interrupted migration: unchecked steps);
 *   2. the stage-file scan (an interrupted stage+rename: a
 *      `<file>.flauz-migration.tmp` leftover);
 *   3. the content readers (a surface corrupted mid-structure: the plan's
 *      version readers + the chain verifiers + the counting laws name the
 *      surface + the parse problem).
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { MigrationError } from '../src/api.ts';
import { detectTornState, renderTornReport } from '../src/torn.ts';
import { planMigration } from '../src/plan.ts';
import { executeMigration } from '../src/execute.ts';
import { collectIntegrity } from '../src/verify.ts';
import { countSurface } from '../src/surfaces.ts';
import { bootFixtureWorkspace, plantTornMarker, plantStageLeftover, corruptSurfaces, fixtureVersions, type FixtureWorkspace } from './helpers.ts';

suite('torn: the in-progress marker signal (the exact surface)', () => {
        let fixture: FixtureWorkspace;

        setup(async () => {
                fixture = await bootFixtureWorkspace();
        });

        teardown(async () => {
                await fixture.cleanup();
        });

        test('a marker with the FIRST step unchecked reports that surface as in flight', async () => {
                await plantTornMarker(fixture.root, 'export-2026-10-02T000000000Z', [
                        { surface: 'tasks', stepKind: 'identity', done: false },
                        { surface: 'evidenceLedger', stepKind: 'identity', done: false },
                ]);
                const torn = await detectTornState(fixture.root, fixture.fs);
                assert.strictEqual(torn.torn, true);
                assert.deepStrictEqual(torn.inFlightSurfaces, ['tasks', 'evidenceLedger']);
                const rendered = renderTornReport(torn).join('\n');
                assert.ok(rendered.includes('tasks was in flight'), 'the report names the first unchecked surface');
                assert.ok(rendered.includes('flauz.migration.rollback'), 'the report names the recovery path');
        });

        test('a marker mid-checklist reports the first UNCHECKED surface (completed steps are not in flight)', async () => {
                await plantTornMarker(fixture.root, 'export-2026-10-02T000000000Z', [
                        { surface: 'tasks', stepKind: 'identity', done: true },
                        { surface: 'evidenceLedger', stepKind: 'identity', done: true },
                        { surface: 'resourcesGraph', stepKind: 'identity', done: false },
                        { surface: 'opsChain', stepKind: 'identity', done: false },
                ]);
                const torn = await detectTornState(fixture.root, fixture.fs);
                assert.deepStrictEqual(torn.inFlightSurfaces, ['resourcesGraph', 'opsChain']);
                assert.ok(torn.reasons.join(' ').includes('resourcesGraph was in flight'), 'the first unchecked surface leads the report');
        });

        test('a marker with EVERY step checked reports the banking-interrupted class', async () => {
                await plantTornMarker(fixture.root, 'export-2026-10-02T000000000Z', [
                        { surface: 'tasks', stepKind: 'identity', done: true },
                        { surface: 'evidenceLedger', stepKind: 'identity', done: true },
                ]);
                const torn = await detectTornState(fixture.root, fixture.fs);
                assert.strictEqual(torn.torn, true);
                assert.ok(torn.reasons.join(' ').includes('between post-flight and record banking'), 'the all-checked marker reports the banking interruption');
        });

        test('a MALFORMED marker still reports torn (fail-closed, never a silent pass)', async () => {
                await fs.mkdir(path.join(fixture.root, '.flauz', 'migration'), { recursive: true });
                await fs.writeFile(path.join(fixture.root, '.flauz', 'migration', 'in-progress.json'), 'not json at all', 'utf-8');
                const torn = await detectTornState(fixture.root, fixture.fs);
                assert.strictEqual(torn.torn, true);
                assert.ok(torn.marker === undefined && torn.markerProblem !== undefined, 'the malformed marker surfaces its problem');
                assert.ok(renderTornReport(torn).join('\n').includes('unreadable'), 'the report says the marker is unreadable');
        });

        test('plan + execute REFUSE while torn; rollback is the only path', async () => {
                await plantTornMarker(fixture.root, 'export-2026-10-02T000000000Z', [{ surface: 'tasks', stepKind: 'identity', done: false }]);
                await assert.rejects(
                        planMigration({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions() }),
                        (err: unknown) => err instanceof MigrationError && err.code === 'FLAUZ_MIGRATION_TORN',
                );
                await assert.rejects(
                        executeMigration({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions() }),
                        (err: unknown) => err instanceof MigrationError && err.code === 'FLAUZ_MIGRATION_TORN',
                );
        });
});

suite('torn: the stage-file scan signal (the exact surface)', () => {
        let fixture: FixtureWorkspace;

        setup(async () => {
                fixture = await bootFixtureWorkspace();
        });

        teardown(async () => {
                await fixture.cleanup();
        });

        test('a leftover stage file names its surface exactly', async () => {
                await plantStageLeftover(fixture.root, '.flauz/tasks.json');
                const torn = await detectTornState(fixture.root, fixture.fs);
                assert.strictEqual(torn.torn, true);
                assert.strictEqual(torn.stageLeftovers.length, 1);
                assert.strictEqual(torn.stageLeftovers[0]?.surface, 'tasks', 'the leftover names the exact surface');
                assert.ok(renderTornReport(torn).join('\n').includes('.flauz/tasks.json.flauz-migration.tmp'), 'the report names the leftover path');
        });

        test('leftovers across surfaces each name their own surface', async () => {
                await plantStageLeftover(fixture.root, '.flauz/tasks.json');
                await plantStageLeftover(fixture.root, '.flauz/models/providers.json');
                await plantStageLeftover(fixture.root, '.flauz/orchestration/graphs.json');
                const torn = await detectTornState(fixture.root, fixture.fs);
                assert.deepStrictEqual([...torn.inFlightSurfaces].sort(), ['orchestration', 'providerLanesState', 'tasks']);
        });

        test('a NON-surface file (not census-enumerated) is a leftover without a surface -- still torn', async () => {
                await plantStageLeftover(fixture.root, '.flauz/migration/plan.json');
                const torn = await detectTornState(fixture.root, fixture.fs);
                assert.strictEqual(torn.torn, true, 'a stray migration tmp file is torn (fail-closed)');
                assert.strictEqual(torn.stageLeftovers[0]?.surface, undefined);
        });

        test('a clean workspace is not torn', async () => {
                const torn = await detectTornState(fixture.root, fixture.fs);
                assert.strictEqual(torn.torn, false);
                assert.deepStrictEqual(torn.inFlightSurfaces, []);
                assert.deepStrictEqual(torn.stageLeftovers, []);
        });
});

suite('torn: the content-reader signal (the exact surface + the parse problem)', () => {
        let fixture: FixtureWorkspace;

        setup(async () => {
                fixture = await bootFixtureWorkspace();
        });

        teardown(async () => {
                await fixture.cleanup();
        });

        test('a truncated tasks.json reports the tasks surface (the counting law carries the parse error)', async () => {
                const tasksPath = path.join(fixture.root, '.flauz', 'tasks.json');
                const text = await fs.readFile(tasksPath, 'utf-8');
                await fs.writeFile(tasksPath, text.slice(0, Math.floor(text.length / 2)), 'utf-8');
                const counts = countSurface('tasks', new Map([['.flauz/tasks.json', await fs.readFile(tasksPath, 'utf-8')]])) as Record<string, unknown>;
                assert.ok(typeof counts.parseError === 'string', 'the counting law surfaces the parse error');
                // and the plan refuses typed naming the surface
                await assert.rejects(
                        planMigration({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions() }),
                        (err: unknown) => {
                                assert.ok(err instanceof MigrationError);
                                assert.strictEqual(err.code, 'FLAUZ_MIGRATION_INCOMPATIBLE');
                                assert.ok(err.message.includes('tasks'));
                                return true;
                        },
                );
        });

        test('a torn ledger reports the evidenceLedger surface (the chain verifier carries the class)', async () => {
                const ledgerPath = path.join(fixture.root, '.flauz', 'evidence', 'ledger.jsonl');
                const text = await fs.readFile(ledgerPath, 'utf-8');
                const lines = text.split('\n').filter(line => line !== '');
                const last = lines.pop() ?? '';
                await fs.writeFile(ledgerPath, `${lines.join('\n')}${lines.length > 0 ? '\n' : ''}${last.slice(0, Math.floor(last.length / 2))}`, 'utf-8');
                const verdicts = await collectIntegrity(fixture.root, fixture.fs);
                assert.strictEqual(verdicts.evidenceLedger.ok, false, 'the torn tail breaks the chain verdict');
                assert.ok(verdicts.evidenceLedger.reason !== undefined);
                // and the plan refuses typed naming the surface
                await assert.rejects(
                        planMigration({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions() }),
                        (err: unknown) => {
                                assert.ok(err instanceof MigrationError);
                                assert.strictEqual(err.code, 'FLAUZ_MIGRATION_INCOMPATIBLE');
                                assert.ok(err.message.includes('evidenceLedger'));
                                return true;
                        },
                );
        });

        test('the full crash fixture (W2 corruptSurfaces: tasks + ledger) reports BOTH surfaces through their readers', async () => {
                await corruptSurfaces(fixture.root);
                await assert.rejects(
                        planMigration({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions() }),
                        (err: unknown) => {
                                assert.ok(err instanceof MigrationError);
                                assert.strictEqual(err.code, 'FLAUZ_MIGRATION_INCOMPATIBLE');
                                // the first surface in census order that cannot be version-read leads the refusal
                                assert.ok(err.message.includes('tasks'));
                                return true;
                        },
                );
                const verdicts = await collectIntegrity(fixture.root, fixture.fs);
                assert.strictEqual(verdicts.evidenceLedger.ok, false, 'the ledger reader names the evidenceLedger surface');
        });

        test('a torn ops chain (missing trailing newline) reports the opsChain surface', async () => {
                const opsPath = path.join(fixture.root, '.flauz', 'resources-ops.jsonl');
                const text = await fs.readFile(opsPath, 'utf-8');
                await fs.writeFile(opsPath, text.trimEnd(), 'utf-8'); // drop the trailing newline: the interrupted-append signature
                const verdicts = await collectIntegrity(fixture.root, fixture.fs);
                assert.strictEqual(verdicts.opsChain.ok, false);
                assert.ok(verdicts.opsChain.problems.some(problem => problem.message.includes('does not end with a newline')), 'the torn signature is reported');
                await assert.rejects(
                        planMigration({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions() }),
                        (err: unknown) => {
                                assert.ok(err instanceof MigrationError);
                                assert.strictEqual(err.code, 'FLAUZ_MIGRATION_INCOMPATIBLE');
                                assert.ok(err.message.includes('opsChain'));
                                return true;
                        },
                );
        });
});
