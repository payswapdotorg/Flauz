/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * A-PROD-004-W3 -- the PLAN suite: the plan shape (the census inventory, the
 * per-surface step kinds, the absent surfaces), the compat matrix (identity
 * for same-format, the explicit transform via the registry), and the typed
 * incompatibility refusals (the plan NEVER proceeds past an incompatible
 * version -- it reports the exact surface + version pair and persists
 * nothing).
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { MigrationError, PLAN_PATH, PRODUCTION_TRANSFORMS, type TransformSpec } from '../src/api.ts';
import { planMigration, parsePersistedPlan, renderPlan, planIdOf } from '../src/plan.ts';
import { bootFixtureWorkspace, plantTornMarker, saboteurFs, writeWatermarkFor, fixtureVersions, type FixtureWorkspace } from './helpers.ts';

suite('plan: the pre-flight over the real durable state', () => {
        let fixture: FixtureWorkspace;

        suiteSetup(async () => {
                fixture = await bootFixtureWorkspace();
        });

        suiteTeardown(async () => {
                await fixture.cleanup();
        });

        test('a plan over the all-current fixture is ALL IDENTITY steps (the pinned base reality)', async () => {
                const result = await planMigration({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions() });
                assert.strictEqual(result.surfaceCount, 10, 'the census enumeration: 10 surfaces');
                assert.strictEqual(result.identityStepCount, 9, 'the fixture carries 9 present surfaces, all at this build\'s formats');
                assert.strictEqual(result.transformStepCount, 0, 'no cross-format transform is registered at the pinned base');
                assert.strictEqual(result.absentSurfaceCount, 1, 'the hardening watermark is honestly absent');
                // the persisted plan parses + its id re-derives
                const planText = await fs.readFile(path.join(fixture.root, PLAN_PATH), 'utf-8');
                const plan = parsePersistedPlan(planText);
                assert.strictEqual(plan.planId, result.planId);
                const { planId: recomputedFrom, ...planBody } = plan;
                void recomputedFrom;
                assert.strictEqual(planIdOf(planBody), plan.planId, 'the planId is self-consistent');
                // the steps carry the per-file digests
                for (const step of plan.steps) {
                        assert.ok(step.files.length > 0);
                        for (const file of step.files) {
                                assert.match(file.sha256, /^[0-9a-f]{64}$/);
                                assert.ok(file.bytes > 0);
                        }
                }
        });

        test('the absent surface is listed absent + produces no step (never faked)', async () => {
                await planMigration({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions() });
                const planText = await fs.readFile(path.join(fixture.root, PLAN_PATH), 'utf-8');
                const plan = parsePersistedPlan(planText);
                const watermark = plan.surfaces.find(row => row.surface === 'evidenceWatermark');
                assert.ok(watermark !== undefined);
                assert.strictEqual(watermark.present, false);
                assert.strictEqual(watermark.stepKind, 'absent');
                assert.strictEqual(plan.steps.some(step => step.surface === 'evidenceWatermark'), false, 'an absent surface produces no step');
        });

        test('a watermark written by the owner becomes a PRESENT identity surface', async () => {
                await writeWatermarkFor(fixture.root, fixture.clock);
                const result = await planMigration({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions() });
                assert.strictEqual(result.identityStepCount, 10, 'the watermark now plans as an identity surface');
                assert.strictEqual(result.absentSurfaceCount, 0);
        });

        test('the render carries the whole plan (the disclosure law)', async () => {
                const result = await planMigration({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions() });
                const planText = await fs.readFile(path.join(fixture.root, PLAN_PATH), 'utf-8');
                const lines = renderPlan(parsePersistedPlan(planText));
                const rendered = lines.join('\n');
                assert.ok(rendered.includes('flauz.migration.plan: the workspace migration plan'), 'the render names the command');
                assert.ok(rendered.includes('anchor requirement'), 'the render states the anchor requirement');
                assert.ok(rendered.includes('[identity] tasks'), 'the render shows the identity steps');
                assert.ok(rendered.includes('will not move'), 'absent surfaces render as not moving');
                assert.ok(rendered.includes('privacy law'), 'the render states the privacy law');
                assert.strictEqual(result.planId.length, 64);
        });

        test('a stale state after the plan = the typed STALE refusal at execute time (the currency law)', async () => {
                // plan, then mutate one surface's bytes
                const planResult = await planMigration({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions() });
                const tasksPath = path.join(fixture.root, '.flauz', 'tasks.json');
                const tasksText = await fs.readFile(tasksPath, 'utf-8');
                await fs.writeFile(tasksPath, tasksText.replace('Diagnose the flaky provider lane', 'Diagnose the drifted provider lane'), 'utf-8');
                // execute is in the execute suite; here assert the drift detector through a second plan:
                // a NEW plan succeeds (it re-reads), and its digests differ
                const second = await planMigration({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions() });
                assert.notStrictEqual(second.planId, planResult.planId, 'a re-plan over drifted state produces a different plan');
                // restore
                await fs.writeFile(tasksPath, tasksText, 'utf-8');
        });
});

suite('plan: the typed refusals', () => {
        let fixture: FixtureWorkspace;

        setup(async () => {
                fixture = await bootFixtureWorkspace();
        });

        teardown(async () => {
                await fixture.cleanup();
        });

        test('a torn migration refuses the plan typed (TORN) with the exact surface', async () => {
                await plantTornMarker(fixture.root, 'export-nonexistent', [
                        { surface: 'tasks', stepKind: 'identity', done: true },
                        { surface: 'evidenceLedger', stepKind: 'identity', done: false },
                ]);
                await assert.rejects(
                        planMigration({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions() }),
                        (err: unknown) => {
                                assert.ok(err instanceof MigrationError);
                                assert.strictEqual(err.code, 'FLAUZ_MIGRATION_TORN');
                                assert.ok(err.message.includes('evidenceLedger'), 'the refusal names the exact surface in flight');
                                return true;
                        },
                );
                // nothing was persisted
                assert.strictEqual(await fs.readFile(path.join(fixture.root, PLAN_PATH), 'utf-8').then(() => 'present', () => 'absent'), 'absent');
        });

        test('an incompatible surface version refuses the plan typed (INCOMPATIBLE) with the exact surface + version pair, persisting NOTHING', async () => {
                // rewrite the environments registry's declared version to a future id (an honestly-constructed fixture)
                const environmentsPath = path.join(fixture.root, '.flauz', 'environments.json');
                const environmentsText = await fs.readFile(environmentsPath, 'utf-8');
                await fs.writeFile(environmentsPath, environmentsText.replace('"flauz.environments/v0"', '"flauz.environments/v9"'), 'utf-8');
                await assert.rejects(
                        planMigration({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions() }),
                        (err: unknown) => {
                                assert.ok(err instanceof MigrationError);
                                assert.strictEqual(err.code, 'FLAUZ_MIGRATION_INCOMPATIBLE');
                                assert.ok(err.message.includes('environmentsRegistry'), 'the refusal names the exact surface');
                                assert.ok(err.message.includes('flauz.environments/v9'), 'the refusal names the detected version');
                                assert.ok(err.message.includes('flauz.environments/v0'), 'the refusal names this build\'s target version');
                                return true;
                        },
                );
                assert.strictEqual(await fs.readFile(path.join(fixture.root, PLAN_PATH), 'utf-8').then(() => 'present', () => 'absent'), 'absent', 'a refused plan persists nothing');
        });

        test('a MIXED-version surface refuses typed with the conflicting versions', async () => {
                // the orchestration surface's two files declare different future versions
                const graphsPath = path.join(fixture.root, '.flauz', 'orchestration', 'graphs.json');
                const journalPath = path.join(fixture.root, '.flauz', 'orchestration', 'journal.jsonl');
                const graphsText = await fs.readFile(graphsPath, 'utf-8');
                const journalText = await fs.readFile(journalPath, 'utf-8');
                await fs.writeFile(graphsPath, graphsText.replace('"flauz.orch.graphs/v1"', '"flauz.orch.graphs/v8"'), 'utf-8');
                await fs.writeFile(journalPath, journalText.replaceAll('"flauz.orch.journal/v1"', '"flauz.orch.journal/v7"'), 'utf-8');
                await assert.rejects(
                        planMigration({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions() }),
                        (err: unknown) => {
                                assert.ok(err instanceof MigrationError);
                                assert.strictEqual(err.code, 'FLAUZ_MIGRATION_INCOMPATIBLE');
                                assert.ok(err.message.includes('orchestration'), 'the refusal names the exact surface');
                                assert.ok(err.message.includes('MIXED'), 'the refusal names the mixed-version class');
                                return true;
                        },
                );
        });

        test('corrupted surface CONTENT refuses the plan typed with the exact surface + parse problem', async () => {
                // the content-torn class: tasks.json truncated mid-JSON (an interrupted write of the owning service)
                const tasksPath = path.join(fixture.root, '.flauz', 'tasks.json');
                const tasksText = await fs.readFile(tasksPath, 'utf-8');
                await fs.writeFile(tasksPath, tasksText.slice(0, Math.floor(tasksText.length / 2)), 'utf-8');
                await assert.rejects(
                        planMigration({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions() }),
                        (err: unknown) => {
                                assert.ok(err instanceof MigrationError);
                                assert.strictEqual(err.code, 'FLAUZ_MIGRATION_INCOMPATIBLE');
                                assert.ok(err.message.includes('tasks'), 'the refusal names the exact surface');
                                assert.ok(err.message.includes('does not parse'), 'the refusal carries the parse problem');
                                return true;
                        },
                );
        });

        test('a ledger that does not parse refuses the plan typed (the pinned row contract is the version)', async () => {
                const ledgerPath = path.join(fixture.root, '.flauz', 'evidence', 'ledger.jsonl');
                const ledgerText = await fs.readFile(ledgerPath, 'utf-8');
                const lines = ledgerText.split('\n').filter(line => line !== '');
                const last = lines.pop() ?? '';
                await fs.writeFile(ledgerPath, `${lines.join('\n')}${lines.length > 0 ? '\n' : ''}${last.slice(0, Math.floor(last.length / 2))}`, 'utf-8');
                await assert.rejects(
                        planMigration({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions() }),
                        (err: unknown) => {
                                assert.ok(err instanceof MigrationError);
                                assert.strictEqual(err.code, 'FLAUZ_MIGRATION_INCOMPATIBLE');
                                assert.ok(err.message.includes('evidenceLedger'), 'the refusal names the exact surface');
                                return true;
                        },
                );
        });
});

suite('plan: the explicit-transform path (the registry machinery over real surface files)', () => {
        let fixture: FixtureWorkspace;

        setup(async () => {
                fixture = await bootFixtureWorkspace();
        });

        teardown(async () => {
                await fixture.cleanup();
        });

        test('a cross-format surface with a REGISTERED transform plans as an explicit transform step', async () => {
                // the fixture honestly carries a future-version environments registry
                const environmentsPath = path.join(fixture.root, '.flauz', 'environments.json');
                const environmentsText = await fs.readFile(environmentsPath, 'utf-8');
                await fs.writeFile(environmentsPath, environmentsText.replace('"flauz.environments/v0"', '"flauz.environments/v0.test-upgrade"'), 'utf-8');

                const upgrade: TransformSpec = {
                        surface: 'environmentsRegistry',
                        fromVersion: 'flauz.environments/v0.test-upgrade',
                        toVersion: 'flauz.environments/v0',
                        apply: (sourcePath, text) => text.replaceAll('flauz.environments/v0.test-upgrade', 'flauz.environments/v0'),
                };
                const result = await planMigration({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions(), transforms: [upgrade] });
                assert.strictEqual(result.transformStepCount, 1, 'the cross-format surface plans as a transform step');
                assert.strictEqual(result.identityStepCount, 8, 'the other present surfaces stay identity');
                const plan = parsePersistedPlan(await fs.readFile(path.join(fixture.root, PLAN_PATH), 'utf-8'));
                const step = plan.steps.find(candidate => candidate.surface === 'environmentsRegistry');
                assert.ok(step !== undefined);
                assert.strictEqual(step.stepKind, 'transform');
                assert.strictEqual(step.fromVersion, 'flauz.environments/v0.test-upgrade');
                assert.strictEqual(step.toVersion, 'flauz.environments/v0');
                const rendered = renderPlan(plan).join('\n');
                assert.ok(rendered.includes('[xform') || rendered.includes('xform'), 'the render shows the explicit transform');
        });

        test('the same cross-format surface WITHOUT a registered transform refuses typed (the registry is the only bridge)', async () => {
                const environmentsPath = path.join(fixture.root, '.flauz', 'environments.json');
                const environmentsText = await fs.readFile(environmentsPath, 'utf-8');
                await fs.writeFile(environmentsPath, environmentsText.replace('"flauz.environments/v0"', '"flauz.environments/v0.test-upgrade"'), 'utf-8');
                await assert.rejects(
                        planMigration({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions() }),
                        (err: unknown) => {
                                assert.ok(err instanceof MigrationError);
                                assert.strictEqual(err.code, 'FLAUZ_MIGRATION_INCOMPATIBLE');
                                assert.ok(err.message.includes('NO registered transform'), 'the refusal names the missing bridge');
                                return true;
                        },
                );
        });

        test('the production registry is identity-only at the pinned base (the honest scope)', async () => {
                assert.strictEqual(PRODUCTION_TRANSFORMS.length, 0, 'zero production transforms are registered -- disclosed in the README + the report');
        });
});
