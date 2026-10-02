/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * A-PROD-004-W3 -- the EXECUTE suite: the anchor-first law (no verified
 * anchor = the typed refusal, ZERO transforms run), the plan-currency law
 * (stale/tampered plans refuse typed), the atomic per-surface transforms
 * (identity = byte-identical re-commit; the explicit transform lands the
 * target version), the post-flight verification, and the migration record
 * banking (the census-visible ledger row + the watermark resync).
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { MigrationError, PLAN_PATH, MIGRATION_LOG_PATH, MARKER_PATH, SURFACES, type TransformSpec } from '../src/api.ts';
import { planMigration } from '../src/plan.ts';
import { executeMigration, renderExecuteResult } from '../src/execute.ts';
import { verifyAnchorExport } from '../src/anchor.ts';
import { collectIntegrity } from '../src/verify.ts';
import { readSurfaceVersions } from '../src/versionInventory.ts';
import { bootFixtureWorkspace, saboteurFs, writeWatermarkFor, onDiskLedgerRowCount, onDiskLedgerKindCounts, fixtureVersions, listExportsOnDisk, type FixtureWorkspace } from './helpers.ts';

async function planOnly(fixture: FixtureWorkspace, transforms?: readonly TransformSpec[]): Promise<string> {
        const result = await planMigration({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions(), ...(transforms !== undefined ? { transforms } : {}) });
        return result.planId;
}

suite('execute: the anchor-first law', () => {
        let fixture: FixtureWorkspace;

        setup(async () => {
                fixture = await bootFixtureWorkspace();
        });

        teardown(async () => {
                await fixture.cleanup();
        });

        test('no plan = the typed NO_PLAN refusal', async () => {
                await assert.rejects(
                        executeMigration({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions() }),
                        (err: unknown) => {
                                assert.ok(err instanceof MigrationError);
                                assert.strictEqual(err.code, 'FLAUZ_MIGRATION_NO_PLAN');
                                return true;
                        },
                );
        });

        test('an anchor that does not VERIFY = the typed ANCHOR_UNVERIFIED refusal, ZERO transforms run', async () => {
                await planOnly(fixture);
                const before = await snapshotState(fixture.root);
                // sabotage: every write under .flauz-exports/ gets a byte appended -- the anchor's own
                // verification must catch the corrupted copy and refuse BEFORE any transform
                const sabotaged = saboteurFs(fixture.fs, { corruptWritesUnder: 'state/.flauz' });
                await assert.rejects(
                        executeMigration({ root: fixture.root, fs: sabotaged, clock: fixture.clock, versions: fixtureVersions() }),
                        (err: unknown) => {
                                assert.ok(err instanceof MigrationError);
                                assert.strictEqual(err.code, 'FLAUZ_MIGRATION_ANCHOR_UNVERIFIED');
                                assert.ok(err.message.includes('NO transform ran'), 'the refusal states the anchor-first law');
                                return true;
                        },
                );
                // zero transforms: the durable state is byte-identical, no marker, no record
                const after = await snapshotState(fixture.root);
                assert.deepStrictEqual(after, before, 'zero transforms ran -- the durable state is untouched');
                assert.strictEqual(await exists(path.join(fixture.root, MARKER_PATH)), false, 'no in-progress marker was written');
                assert.strictEqual(await exists(path.join(fixture.root, MIGRATION_LOG_PATH)), false, 'no migration record was banked');
        });

        test('a tampered persisted plan (the planId does not re-derive) = the typed PLAN_STALE refusal', async () => {
                await planOnly(fixture);
                const planPath = path.join(fixture.root, PLAN_PATH);
                const planText = await fs.readFile(planPath, 'utf-8');
                await fs.writeFile(planPath, planText.replace('"productName": "Flauz"', '"productName": "Flauz!"'), 'utf-8');
                await assert.rejects(
                        executeMigration({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions() }),
                        (err: unknown) => {
                                assert.ok(err instanceof MigrationError);
                                assert.strictEqual(err.code, 'FLAUZ_MIGRATION_PLAN_STALE');
                                assert.ok(err.message.includes('does not re-derive'), 'the refusal names the tamper class');
                                return true;
                        },
                );
        });

        test('state drift after the plan = the typed PLAN_STALE refusal (the currency law)', async () => {
                await planOnly(fixture);
                const tasksPath = path.join(fixture.root, '.flauz', 'tasks.json');
                const tasksText = await fs.readFile(tasksPath, 'utf-8');
                await fs.writeFile(tasksPath, tasksText.replace('Diagnose the flaky provider lane', 'Drifted title'), 'utf-8');
                await assert.rejects(
                        executeMigration({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions() }),
                        (err: unknown) => {
                                assert.ok(err instanceof MigrationError);
                                assert.strictEqual(err.code, 'FLAUZ_MIGRATION_PLAN_STALE');
                                assert.ok(err.message.includes('stale'), 'the refusal names the staleness');
                                return true;
                        },
                );
        });
});

suite('execute: the upgrade path over the real durable state', () => {
        let fixture: FixtureWorkspace;
        let planId: string;
        let preState: Map<string, string>;

        suiteSetup(async () => {
                fixture = await bootFixtureWorkspace();
                await writeWatermarkFor(fixture.root, fixture.clock);
                planId = await planOnly(fixture);
                preState = await snapshotState(fixture.root);
        });

        suiteTeardown(async () => {
                await fixture.cleanup();
        });

        test('the migration executes: anchor verified first, every identity step byte-identical, the record banked', async () => {
                const result = await executeMigration({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions() });
                assert.strictEqual(result.planId, planId);
                assert.strictEqual(result.executedSteps.length, 10, 'all 10 present surfaces planned + executed');
                assert.ok(result.executedSteps.every(step => step.stepKind === 'identity'));
                // byte-identical: every surface file's sha is unchanged (identity = re-commit, not rewrite)
                for (const step of result.executedSteps) {
                        assert.deepStrictEqual(step.sha256After, step.sha256Before, `${String(step.surface)} is byte-identical through the identity step`);
                }
                const postState = await snapshotState(fixture.root);
                for (const [file, text] of preState) {
                        if (file === '.flauz/evidence/ledger.jsonl' || file === '.flauz/evidence/size.json') {
                                continue; // the banking law: the ledger gains the disclosed note row + the watermark resyncs (asserted below)
                        }
                        assert.strictEqual(postState.get(file), text, `${file} is byte-identical post-migration`);
                }
                // the anchor exists + verifies green
                assert.strictEqual((await listExportsOnDisk(fixture.root)).length, 1, 'exactly one anchor was created');
                const verification = await verifyAnchorExport({ root: fixture.root, fs: fixture.fs }, result.anchor.exportDirName);
                assert.strictEqual(verification.ok, true, 'the anchor still verifies green post-migration');
                // the census-visible banking: ledger row + note kind + watermark resync
                const rowCount = await onDiskLedgerRowCount(fixture.root);
                const kindCounts = await onDiskLedgerKindCounts(fixture.root);
                assert.strictEqual(rowCount, 3, 'the fixture ledger carried 2 rows; the migration record banked a third (rowCount + 1)');
                assert.strictEqual(kindCounts.note, 2, 'kindCounts.note + 1 (the fixture note + the migration note)');
                assert.ok(result.banked.ledgerRowSeq !== undefined, 'the ledger row was banked');
                assert.strictEqual(result.banked.watermarkUpdated, true, 'the watermark was resynced post-banking');
                // the chain still verifies GREEN post-banking (the watermark matches the banked ledger)
                const verdicts = await collectIntegrity(fixture.root, fixture.fs);
                assert.strictEqual(verdicts.evidenceLedger.ok, true, 'the ledger chain is green post-banking');
                assert.strictEqual(verdicts.evidenceLedger.watermark?.status, 'ok', 'the resynced watermark matches');
                // the marker is cleared at full success
                assert.strictEqual(await exists(path.join(fixture.root, MARKER_PATH)), false, 'the in-progress marker is cleared at full success');
                // the record banked + carries what/when/which-plan/which-anchor
                const recordText = await fs.readFile(path.join(fixture.root, MIGRATION_LOG_PATH), 'utf-8');
                const record = JSON.parse(recordText.split('\n').filter(line => line !== '')[0] as string) as Record<string, unknown>;
                assert.strictEqual(record.planId, planId, 'which-plan');
                assert.strictEqual(record.commandLine, 'flauz.migration.execute', 'what');
                assert.strictEqual((record.anchor as Record<string, unknown>).exportDirName, result.anchor.exportDirName, 'which-anchor');
                assert.strictEqual(typeof record.at, 'number', 'when');
        });

        test('a re-execute after a completed migration refuses typed (the plan is stale: the banking moved the ledger)', async () => {
                await assert.rejects(
                        executeMigration({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions() }),
                        (err: unknown) => {
                                assert.ok(err instanceof MigrationError);
                                assert.strictEqual(err.code, 'FLAUZ_MIGRATION_PLAN_STALE', 'the banked ledger row + resynced watermark make the old plan stale -- re-plan');
                                return true;
                        },
                );
        });

        test('the render carries the anchor, the steps, the post-flight + the banking', async () => {
                // re-plan + re-execute on the already-migrated state (a second, fresh migration)
                const secondPlan = await planMigration({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions() });
                const second = await executeMigration({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions() });
                const lines = renderExecuteResult(second).join('\n');
                assert.ok(lines.includes('flauz.migration.execute: migration complete'), 'the render names the command');
                assert.ok(lines.includes(secondPlan.planId.slice(0, 12)), 'the render pins the plan');
                assert.ok(lines.includes(second.anchor.exportDirName), 'the render pins the anchor');
                assert.ok(lines.includes('banked'), 'the render reports the banking');
        });
});

suite('execute: the explicit transform machinery over real surface files', () => {
        let fixture: FixtureWorkspace;

        setup(async () => {
                fixture = await bootFixtureWorkspace();
        });

        teardown(async () => {
                await fixture.cleanup();
        });

        test('a registered transform step lands the TARGET version + banks the record', async () => {
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
                await planOnly(fixture, [upgrade]);
                const result = await executeMigration({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions(), transforms: [upgrade] });
                const transformed = result.executedSteps.find(step => step.surface === 'environmentsRegistry');
                assert.ok(transformed !== undefined);
                assert.strictEqual(transformed.stepKind, 'transform');
                assert.notStrictEqual(transformed.sha256After[0], transformed.sha256Before[0], 'the transform changed the file (the version rewrite)');
                // the post-flight version inventory: the file now declares the target version
                const readings = await readSurfaceVersions(fixture.root, fixture.fs);
                const environments = readings.find(reading => reading.surface === 'environmentsRegistry');
                assert.ok(environments !== undefined);
                const file = environments.files.find(candidate => candidate.sourcePath === '.flauz/environments.json');
                assert.ok(file !== undefined && file.detectedVersion === 'flauz.environments/v0', 'the transformed file carries the target version');
        });

        test('a transform spec that FAILS mid-flight surfaces as the typed TORN refusal with the exact surface', async () => {
                const environmentsPath = path.join(fixture.root, '.flauz', 'environments.json');
                const environmentsText = await fs.readFile(environmentsPath, 'utf-8');
                await fs.writeFile(environmentsPath, environmentsText.replace('"flauz.environments/v0"', '"flauz.environments/v0.test-upgrade"'), 'utf-8');
                const failing: TransformSpec = {
                        surface: 'environmentsRegistry',
                        fromVersion: 'flauz.environments/v0.test-upgrade',
                        toVersion: 'flauz.environments/v0',
                        apply: () => {
                                throw new Error('the transform cannot convert this content');
                        },
                };
                await planOnly(fixture, [failing]);
                await assert.rejects(
                        executeMigration({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions(), transforms: [failing] }),
                        (err: unknown) => {
                                assert.ok(err instanceof MigrationError);
                                assert.strictEqual(err.code, 'FLAUZ_MIGRATION_TORN');
                                assert.ok(err.message.includes('environmentsRegistry'), 'the torn refusal names the exact surface');
                                return true;
                        },
                );
                // the marker stays (torn) -- the recovery path is rollback
                assert.strictEqual(await exists(path.join(fixture.root, MARKER_PATH)), true, 'the marker stays after a torn transform');
        });

        test('a crash mid-rename (the sabotage wrapper) surfaces as the typed TORN refusal + a stage leftover', async () => {
                await planOnly(fixture);
                const firstStep = SURFACES[0] as { id: string };
                const firstFile = '.flauz/tasks.json';
                assert.strictEqual(firstStep.id, 'tasks');
                const sabotaged = saboteurFs(fixture.fs, { failRenameFor: firstFile });
                await assert.rejects(
                        executeMigration({ root: fixture.root, fs: sabotaged, clock: fixture.clock, versions: fixtureVersions() }),
                        (err: unknown) => {
                                assert.ok(err instanceof MigrationError);
                                assert.strictEqual(err.code, 'FLAUZ_MIGRATION_TORN');
                                assert.ok(err.message.includes('tasks'), 'the torn refusal names the exact surface');
                                return true;
                        },
                );
                assert.strictEqual(await exists(path.join(fixture.root, MARKER_PATH)), true, 'the marker stays');
        });
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function exists(target: string): Promise<boolean> {
        try {
                await fs.access(target);
                return true;
        } catch {
                return false;
        }
}

/** Snapshots every census-surface file's bytes (the zero-transform assert vehicle). */
async function snapshotState(root: string): Promise<Map<string, string>> {
        const out = new Map<string, string>();
        const SURFACE_FILES = [
                '.flauz/tasks.json',
                '.flauz/evidence/ledger.jsonl',
                '.flauz/evidence/size.json',
                '.flauz/resources.json',
                '.flauz/resources-ops.jsonl',
                '.flauz/environments.json',
                '.flauz/browser-sessions.jsonl',
                '.flauz/orchestration/graphs.json',
                '.flauz/orchestration/journal.jsonl',
                '.flauz/models/providers.json',
                '.flauz/models/routing-policy.json',
                '.flauz/models/routing-decisions.jsonl',
                '.flauz/models/provider-switches.jsonl',
                '.flauz/workflows/index.json',
        ];
        for (const file of SURFACE_FILES) {
                const text = await fs.readFile(path.join(root, file), 'utf-8').catch(() => undefined);
                if (text !== undefined) {
                        out.set(file, text);
                }
        }
        const workflowsDir = path.join(root, '.flauz', 'workflows');
        const entries = await fs.readdir(workflowsDir).catch(() => [] as string[]);
        for (const name of entries.filter(entry => /^W-\d{3,}\.json$/.test(entry)).sort()) {
                const text = await fs.readFile(path.join(workflowsDir, name), 'utf-8').catch(() => undefined);
                if (text !== undefined) {
                        out.set(`.flauz/workflows/${name}`, text);
                }
        }
        return out;
}
