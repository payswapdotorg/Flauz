/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * A-PROD-004-W3 -- the ROLLBACK suite: the verify-first law (a tampered
 * anchor = the typed refusal; rollback NEVER proceeds from an unverified
 * anchor), the byte-identical recovery (a CORRUPTED mid-migration fixture
 * recovers byte-identically from the anchor -- non-ledger surfaces
 * byte-equal, the ledger prefix-identical + the banked rollback row), the
 * consent law (non-empty targets without `overwrite: true` refuse typed
 * before any byte is written), the banking (the migration + rollback PAIR
 * visible in the census), and the fresh-plan law (rollback deletes the
 * persisted plan; a resume requires a fresh plan, never a blind continue).
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { MigrationError, PLAN_PATH, MIGRATION_LOG_PATH, ROLLBACK_LOG_PATH, MARKER_PATH } from '../src/api.ts';
import { planMigration } from '../src/plan.ts';
import { executeMigration } from '../src/execute.ts';
import { rollbackMigration, renderRollbackResult } from '../src/rollback.ts';
import { detectTornState } from '../src/torn.ts';
import { collectIntegrity } from '../src/verify.ts';
import { bootFixtureWorkspace, saboteurFs, corruptSurfaces, onDiskLedgerRowCount, onDiskLedgerKindCounts, fixtureVersions, type FixtureWorkspace } from './helpers.ts';

const OVERWRITE = { overwrite: true } as const;

/** Reads one census file's bytes (undefined when absent). */
async function readSurface(root: string, file: string): Promise<string | undefined> {
        return fs.readFile(path.join(root, file), 'utf-8').catch(() => undefined);
}

suite('rollback: the verify-first law', () => {
        let fixture: FixtureWorkspace;
        let anchorDirName: string;

        setup(async () => {
                fixture = await bootFixtureWorkspace();
                const plan = await planMigration({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions() });
                const executed = await executeMigration({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions() });
                anchorDirName = executed.anchor.exportDirName;
                void plan;
        });

        teardown(async () => {
                await fixture.cleanup();
        });

        test('no migration record + no argument = the typed NO_MIGRATION refusal', async () => {
                // a fresh fixture carries no migration record
                const fresh = await bootFixtureWorkspace();
                try {
                        await assert.rejects(
                                rollbackMigration({ root: fresh.root, fs: fresh.fs, clock: fresh.clock }, OVERWRITE),
                                (err: unknown) => {
                                        assert.ok(err instanceof MigrationError);
                                        assert.strictEqual(err.code, 'FLAUZ_MIGRATION_NO_MIGRATION');
                                        return true;
                                },
                        );
                } finally {
                        await fresh.cleanup();
                }
        });

        test('a TAMPERED anchor = the typed TAMPERED refusal; rollback NEVER proceeds from an unverified anchor', async () => {
                // tamper the anchor's state copy: edit one byte of the anchored tasks file
                const anchoredTasks = path.join(fixture.root, '.flauz-exports', anchorDirName, 'state', '.flauz', 'tasks.json');
                const text = await fs.readFile(anchoredTasks, 'utf-8');
                await fs.writeFile(anchoredTasks, text.replace('Diagnose the flaky provider lane', 'Tampered lane title'), 'utf-8');
                const tasksBefore = await readSurface(fixture.root, '.flauz/tasks.json');
                await assert.rejects(
                        rollbackMigration({ root: fixture.root, fs: fixture.fs, clock: fixture.clock }, { ...OVERWRITE, anchor: anchorDirName }),
                        (err: unknown) => {
                                assert.ok(err instanceof MigrationError);
                                assert.strictEqual(err.code, 'FLAUZ_MIGRATION_TAMPERED');
                                assert.ok(err.message.includes('NEVER proceeds from an unverified anchor'), 'the refusal states the verify-first law');
                                return true;
                        },
                );
                // nothing was restored: the workspace state is untouched
                assert.strictEqual(await readSurface(fixture.root, '.flauz/tasks.json'), tasksBefore, 'nothing was written to the workspace');
        });

        test('non-empty targets without the explicit overwrite consent = the typed TARGET_NOT_EMPTY refusal, before any byte', async () => {
                const tasksBefore = await readSurface(fixture.root, '.flauz/tasks.json');
                await assert.rejects(
                        rollbackMigration({ root: fixture.root, fs: fixture.fs, clock: fixture.clock }, { anchor: anchorDirName }),
                        (err: unknown) => {
                                assert.ok(err instanceof MigrationError);
                                assert.strictEqual(err.code, 'FLAUZ_MIGRATION_TARGET_NOT_EMPTY');
                                assert.ok(err.message.includes('nothing has been written'), 'the refusal states the consent law');
                                return true;
                        },
                );
                assert.strictEqual(await readSurface(fixture.root, '.flauz/tasks.json'), tasksBefore, 'nothing was written');
        });
});

suite('rollback: the byte-identical recovery (the completed-migration case)', () => {
        let fixture: FixtureWorkspace;
        let preMigrationState: Map<string, string>;
        let anchorDirName: string;

        suiteSetup(async () => {
                fixture = await bootFixtureWorkspace();
                preMigrationState = await snapshotAll(fixture.root);
                const plan = await planMigration({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions() });
                void plan;
                const executed = await executeMigration({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions() });
                anchorDirName = executed.anchor.exportDirName;
        });

        suiteTeardown(async () => {
                await fixture.cleanup();
        });

        test('rollback restores every surface byte-identically from the anchor (non-ledger byte-equal; the ledger gains the disclosed rollback row)', async () => {
                const result = await rollbackMigration({ root: fixture.root, fs: fixture.fs, clock: fixture.clock }, { ...OVERWRITE, anchor: anchorDirName });
                assert.strictEqual(result.anchor.exportDirName, anchorDirName);
                assert.ok(result.rolledBack !== undefined, 'the rollback record links the migration it reversed (the pair)');
                // non-ledger surfaces: byte-identical with the PRE-migration state
                const postState = await snapshotAll(fixture.root);
                for (const [file, text] of preMigrationState) {
                        if (file === '.flauz/evidence/ledger.jsonl') {
                                continue; // the banking law: prefix + the rollback note row (asserted below)
                        }
                        assert.strictEqual(postState.get(file), text, `${file} restored byte-identically from the anchor`);
                }
                // the ledger: the anchor's bytes (prefix) + exactly one banked rollback note row
                const anchorLedger = await fs.readFile(path.join(fixture.root, '.flauz-exports', anchorDirName, 'state', '.flauz', 'evidence', 'ledger.jsonl'), 'utf-8');
                const nowLedger = await fs.readFile(path.join(fixture.root, '.flauz', 'evidence', 'ledger.jsonl'), 'utf-8');
                assert.ok(nowLedger.startsWith(anchorLedger), 'the ledger is the anchor\'s bytes + the banked pair (prefix-identity)');
                const bankedLines = nowLedger.slice(anchorLedger.length).split('\n').filter(line => line !== '');
                // THE PAIR LAW: the reversed migration's record is re-banked (its original row was rolled
                // back with the ledger) + the rollback record -- the census sees BOTH events
                assert.strictEqual(bankedLines.length, 2, 'exactly the banked pair: the re-banked migration row + the rollback row');
                const migrationRow = JSON.parse(bankedLines[0] as string) as Record<string, unknown>;
                assert.strictEqual(migrationRow.taskId, 'flauz-migration');
                assert.strictEqual(migrationRow.uri, MIGRATION_LOG_PATH, 'the pair\'s first half pins the migration record');
                const rollbackRow = JSON.parse(bankedLines[1] as string) as Record<string, unknown>;
                assert.strictEqual(rollbackRow.taskId, 'flauz-migration');
                assert.strictEqual(rollbackRow.uri, ROLLBACK_LOG_PATH, 'the pair\'s second half pins the rollback record');
                assert.strictEqual(rollbackRow.kind, 'note');
                // the census-visible pair: rowCount 2 (fixture) + 2 (the pair) = 4; note kind = 3
                assert.strictEqual(await onDiskLedgerRowCount(fixture.root), 4);
                assert.strictEqual((await onDiskLedgerKindCounts(fixture.root)).note, 3);
                // the chain still verifies green post-banking
                const verdicts = await collectIntegrity(fixture.root, fixture.fs);
                assert.strictEqual(verdicts.evidenceLedger.ok, true, 'the chain continues green through the banked rollback row');
        });

        test('the migration artifacts are cleaned: the plan is DELETED (the fresh-plan law) + the marker gone', async () => {
                assert.strictEqual(await fs.access(path.join(fixture.root, PLAN_PATH)).then(() => 'present', () => 'absent'), 'absent', 'the persisted plan is deleted by rollback');
                assert.strictEqual(await fs.access(path.join(fixture.root, MARKER_PATH)).then(() => 'present', () => 'absent'), 'absent');
                // a resume-after-rollback is a fresh plan: execute without a plan refuses typed
                await assert.rejects(
                        executeMigration({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions() }),
                        (err: unknown) => {
                                assert.ok(err instanceof MigrationError);
                                assert.strictEqual(err.code, 'FLAUZ_MIGRATION_NO_PLAN', 'never a blind continue');
                                return true;
                        },
                );
                // and the fresh plan succeeds (the state is back to the anchor's bytes + the pair rows)
                const fresh = await planMigration({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions() });
                assert.ok(fresh.planId.length === 64);
        });

        test('the rollback record banked + the render', async () => {
                // roll back the second migration (the fresh plan above was never executed: roll back via the same anchor again)
                const result = await rollbackMigration({ root: fixture.root, fs: fixture.fs, clock: fixture.clock }, { ...OVERWRITE, anchor: anchorDirName });
                const recordText = await fs.readFile(path.join(fixture.root, ROLLBACK_LOG_PATH), 'utf-8');
                const lines = recordText.split('\n').filter(line => line !== '');
                assert.ok(lines.length >= 2, 'two rollback records banked (one per rollback)');
                const rendered = renderRollbackResult(result).join('\n');
                assert.ok(rendered.includes('flauz.migration.rollback: rolled back to the anchor'), 'the render names the command');
                assert.ok(rendered.includes('verified before any restore'), 'the render states the verify-first law');
                assert.ok(rendered.includes('plan cleared'), 'the render states the fresh-plan law');
                const record = JSON.parse(lines[lines.length - 1] as string) as Record<string, unknown>;
                assert.strictEqual(record.commandLine, 'flauz.migration.rollback');
                assert.strictEqual((record.anchor as Record<string, unknown>).exportDirName, anchorDirName);
        });
});

suite('rollback: the torn-migration recovery (the CORRUPTED mid-migration fixture)', () => {
        let fixture: FixtureWorkspace;
        let preMigrationState: Map<string, string>;
        let anchorDirName: string;

        setup(async () => {
                fixture = await bootFixtureWorkspace();
                preMigrationState = await snapshotAll(fixture.root);
                await planMigration({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions() });
        });

        teardown(async () => {
                await fixture.cleanup();
        });

        test('a crash mid-rename (torn) + CORRUPTED surfaces recover byte-identically from the anchor', async () => {
                // phase 1: crash the migration mid-rename (the first surface's rename throws)
                const sabotaged = saboteurFs(fixture.fs, { failRenameFor: '.flauz/tasks.json' });
                await assert.rejects(
                        executeMigration({ root: fixture.root, fs: sabotaged, clock: fixture.clock, versions: fixtureVersions() }),
                        (err: unknown) => err instanceof MigrationError && err.code === 'FLAUZ_MIGRATION_TORN',
                );
                // phase 2: the corrupted mid-migration fixture: the owning state itself is damaged post-torn
                await corruptSurfaces(fixture.root);
                const torn = await detectTornState(fixture.root, fixture.fs);
                assert.strictEqual(torn.torn, true, 'the torn state is detectable');
                // resolve the anchor from the marker (the torn state's own record)
                assert.ok(torn.marker !== undefined);
                anchorDirName = torn.marker.anchorDirName;
                // phase 3: ROLLBACK recovers byte-identically
                const result = await rollbackMigration({ root: fixture.root, fs: fixture.fs, clock: fixture.clock }, { ...OVERWRITE, anchor: anchorDirName });
                const postState = await snapshotAll(fixture.root);
                for (const [file, text] of preMigrationState) {
                        if (file === '.flauz/evidence/ledger.jsonl') {
                                continue; // prefix + the banked rollback row (asserted below)
                        }
                        assert.strictEqual(postState.get(file), text, `${file} recovered byte-identically from the anchor despite the corruption`);
                }
                const anchorLedger = await fs.readFile(path.join(fixture.root, '.flauz-exports', anchorDirName, 'state', '.flauz', 'evidence', 'ledger.jsonl'), 'utf-8');
                const nowLedger = await fs.readFile(path.join(fixture.root, '.flauz', 'evidence', 'ledger.jsonl'), 'utf-8');
                assert.ok(nowLedger.startsWith(anchorLedger), 'the ledger recovered as the anchor bytes + the rollback row');
                assert.strictEqual(nowLedger.slice(anchorLedger.length).split('\n').filter(line => line !== '').length, 1, 'exactly one banked rollback row');
                // the torn state is fully cleaned
                const after = await detectTornState(fixture.root, fixture.fs);
                assert.strictEqual(after.torn, false, 'the marker + leftovers are cleaned by rollback');
                assert.strictEqual(result.tornCleanedUp.torn, true, 'the result reports the torn state it cleaned');
                // a resume-after-rollback is a fresh plan (the plan was deleted)
                assert.strictEqual(await fs.access(path.join(fixture.root, PLAN_PATH)).then(() => 'present', () => 'absent'), 'absent');
                await assert.rejects(
                        executeMigration({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions() }),
                        (err: unknown) => err instanceof MigrationError && err.code === 'FLAUZ_MIGRATION_NO_PLAN',
                );
                const fresh = await planMigration({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions() });
                void fresh;
        });

        test('a torn state WITHOUT a banked migration record rolls back via the explicit anchor argument', async () => {
                // crash mid-rename again (fresh setup), then execute the recovery through the argument
                const sabotaged = saboteurFs(fixture.fs, { failRenameFor: '.flauz/tasks.json' });
                await assert.rejects(
                        executeMigration({ root: fixture.root, fs: sabotaged, clock: fixture.clock, versions: fixtureVersions() }),
                        (err: unknown) => err instanceof MigrationError && err.code === 'FLAUZ_MIGRATION_TORN',
                );
                const torn = await detectTornState(fixture.root, fixture.fs);
                assert.ok(torn.marker !== undefined);
                const result = await rollbackMigration({ root: fixture.root, fs: fixture.fs, clock: fixture.clock }, { ...OVERWRITE, anchor: torn.marker.anchorDirName });
                assert.ok(result.rolledBack === undefined, 'a torn migration has no banked record to pair -- the rollback record stands alone');
                const postState = await snapshotAll(fixture.root);
                for (const [file, text] of preMigrationState) {
                        if (file === '.flauz/evidence/ledger.jsonl') {
                                continue;
                        }
                        assert.strictEqual(postState.get(file), text, `${file} recovered byte-identically`);
                }
                const verdicts = await collectIntegrity(fixture.root, fixture.fs);
                assert.strictEqual(verdicts.evidenceLedger.ok, true);
                assert.strictEqual(verdicts.opsChain.ok, true);
        });
});

/** Snapshots every census-surface file's bytes. */
async function snapshotAll(root: string): Promise<Map<string, string>> {
        const out = new Map<string, string>();
        const files = [
                '.flauz/tasks.json', '.flauz/evidence/ledger.jsonl', '.flauz/evidence/size.json',
                '.flauz/resources.json', '.flauz/resources-ops.jsonl', '.flauz/environments.json',
                '.flauz/browser-sessions.jsonl', '.flauz/orchestration/graphs.json', '.flauz/orchestration/journal.jsonl',
                '.flauz/models/providers.json', '.flauz/models/routing-policy.json', '.flauz/models/routing-decisions.jsonl',
                '.flauz/models/provider-switches.jsonl', '.flauz/workflows/index.json',
        ];
        for (const file of files) {
                const text = await readSurface(root, file);
                if (text !== undefined) {
                        out.set(file, text);
                }
        }
        const workflowsDir = path.join(root, '.flauz', 'workflows');
        const entries = await fs.readdir(workflowsDir).catch(() => [] as string[]);
        for (const name of entries.filter(entry => /^W-\d{3,}\.json$/.test(entry)).sort()) {
                const text = await readSurface(root, `.flauz/workflows/${name}`);
                if (text !== undefined) {
                        out.set(`.flauz/workflows/${name}`, text);
                }
        }
        return out;
}
