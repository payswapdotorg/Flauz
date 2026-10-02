/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * A-PROD-004-W3 -- the PRIVACY suite (the canary sweep): durable-state
 * CONTENTS legitimately transit (the migration's job -- the canaries ARE in
 * the state transit: the anchor's state/ copy + the transformed files); the
 * METADATA surfaces (plan.json, the in-progress marker, the migration +
 * rollback records, every command render) NEVER carry a secret-shaped value
 * -- swept before a single byte is written, fail-closed.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { MigrationError, PLAN_PATH, MIGRATION_LOG_PATH, ROLLBACK_LOG_PATH, MARKER_PATH } from '../src/api.ts';
import { looksSecretShaped } from '../src/privacy.ts';
import { planMigration, renderPlan, parsePersistedPlan } from '../src/plan.ts';
import { executeMigration, renderExecuteResult } from '../src/execute.ts';
import { rollbackMigration, renderRollbackResult } from '../src/rollback.ts';
import { bootFixtureWorkspace, readAllFiles, saboteurFs, fixtureVersions, type FixtureWorkspace } from './helpers.ts';

/** Assembles the canary tokens from fragments (the flauz-resources discipline: no complete secret shape in source). */
const GITHUB_TOKEN = ['ghp_', '0123456789abcdef', 'ABCDEF0123456789'].join('');
const OPENAI_KEY = ['sk-', 'ant-', '0123456789abcdef', 'XYZ987'].join('');

suite('privacy: the canary sweep over a full migration + rollback cycle', () => {
        let fixture: FixtureWorkspace;
        let anchorDirName: string;

        suiteSetup(async () => {
                fixture = await bootFixtureWorkspace({ canaries: [GITHUB_TOKEN, OPENAI_KEY] });
                const plan = await planMigration({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions() });
                const executed = await executeMigration({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions() });
                anchorDirName = executed.anchor.exportDirName;
                await rollbackMigration({ root: fixture.root, fs: fixture.fs, clock: fixture.clock }, { overwrite: true, anchor: anchorDirName });
                void plan;
        });

        suiteTeardown(async () => {
                await fixture.cleanup();
        });

        test('the canaries ARE in the state transit (the anchor\'s state/ copy -- a migration\'s honesty)', async () => {
                const anchorStateDir = path.join(fixture.root, '.flauz-exports', anchorDirName, 'state');
                const files = await readAllFiles(anchorStateDir);
                const joined = files.map(file => file.text).join('\n');
                assert.ok(joined.includes(GITHUB_TOKEN), 'the GitHub-shaped canary rides the anchored tasks envelope (contents are the job)');
                assert.ok(joined.includes(OPENAI_KEY), 'the sk-shaped canary rides the anchored orchestration journal (contents are the job)');
        });

        test('the canaries are NEVER in any metadata surface (plan, records, renders)', async () => {
                const metadataFiles = [
                        path.join(fixture.root, PLAN_PATH),
                        path.join(fixture.root, MIGRATION_LOG_PATH),
                        path.join(fixture.root, ROLLBACK_LOG_PATH),
                ];
                for (const target of metadataFiles) {
                        const text = await fs.readFile(target, 'utf-8').catch(() => undefined);
                        if (text === undefined) {
                                continue;
                        }
                        assert.ok(!text.includes(GITHUB_TOKEN), `${target} carries no GitHub-shaped canary`);
                        assert.ok(!text.includes(OPENAI_KEY), `${target} carries no sk-shaped canary`);
                }
                // the anchor's metadata class (export.json / MANIFEST.json / integrity.json) is swept by the anchor builder
                const anchorDir = path.join(fixture.root, '.flauz-exports', anchorDirName);
                for (const file of await readAllFiles(anchorDir)) {
                        if (file.path.includes(`${path.sep}state${path.sep}`)) {
                                continue; // the state copy legitimately carries contents
                        }
                        assert.ok(!file.text.includes(GITHUB_TOKEN), `${path.relative(fixture.root, file.path)} carries no GitHub-shaped canary`);
                        assert.ok(!file.text.includes(OPENAI_KEY), `${path.relative(fixture.root, file.path)} carries no sk-shaped canary`);
                }
        });

        test('the renders never carry the canaries (the channel surfaces are metadata)', async () => {
                const planText = await fs.readFile(path.join(fixture.root, PLAN_PATH), 'utf-8').catch(() => undefined);
                if (planText !== undefined) {
                        const rendered = renderPlan(parsePersistedPlan(planText)).join('\n');
                        assert.ok(!rendered.includes(GITHUB_TOKEN) && !rendered.includes(OPENAI_KEY), 'the plan render is canary-free');
                }
                // the execute + rollback renders over a FRESH cycle (the suite's own fixture is post-rollback)
                const fresh = await bootFixtureWorkspace({ canaries: [GITHUB_TOKEN, OPENAI_KEY] });
                try {
                        await planMigration({ root: fresh.root, fs: fresh.fs, clock: fresh.clock, versions: fixtureVersions() });
                        const executed = await executeMigration({ root: fresh.root, fs: fresh.fs, clock: fresh.clock, versions: fixtureVersions() });
                        const executeRender = renderExecuteResult(executed).join('\n');
                        assert.ok(!executeRender.includes(GITHUB_TOKEN) && !executeRender.includes(OPENAI_KEY), 'the execute render is canary-free');
                        const rolledBack = await rollbackMigration({ root: fresh.root, fs: fresh.fs, clock: fresh.clock }, { overwrite: true, anchor: executed.anchor.exportDirName });
                        const rollbackRender = renderRollbackResult(rolledBack).join('\n');
                        assert.ok(!rollbackRender.includes(GITHUB_TOKEN) && !rollbackRender.includes(OPENAI_KEY), 'the rollback render is canary-free');
                } finally {
                        await fresh.cleanup();
                }
        });

        test('the in-progress marker (transient metadata) is canary-free when it exists', async () => {
                const fresh = await bootFixtureWorkspace({ canaries: [GITHUB_TOKEN, OPENAI_KEY] });
                try {
                        await planMigration({ root: fresh.root, fs: fresh.fs, clock: fresh.clock, versions: fixtureVersions() });
                        // plant a marker via a sabotaged execute (crash mid-rename keeps the marker)
                        const sabotaged = saboteurFs(fresh.fs, { failRenameFor: '.flauz/tasks.json' });
                        await assert.rejects(
                                executeMigration({ root: fresh.root, fs: sabotaged, clock: fresh.clock, versions: fixtureVersions() }),
                                (err: unknown) => err instanceof MigrationError,
                        );
                        const markerText = await fs.readFile(path.join(fresh.root, MARKER_PATH), 'utf-8');
                        assert.ok(!markerText.includes(GITHUB_TOKEN) && !markerText.includes(OPENAI_KEY), 'the marker is canary-free');
                } finally {
                        await fresh.cleanup();
                }
        });
});

suite('privacy: the fail-closed backstop', () => {
        test('looksSecretShaped recognizes the canary shapes (the pattern table works)', () => {
                assert.strictEqual(looksSecretShaped(GITHUB_TOKEN), true);
                assert.strictEqual(looksSecretShaped(OPENAI_KEY), true);
                assert.strictEqual(looksSecretShaped('an ordinary path/.flauz/tasks.json'), false);
                assert.strictEqual(looksSecretShaped('{"counts":{"rowCount":3}}'), false);
        });

        test('a SECRET-SHAPED workspace root refuses the plan typed (the root path would ride plan.json)', async () => {
                // boot a REAL fixture, then re-root the plan call at a secret-shaped path containing the same state
                const fixture = await bootFixtureWorkspace();
                try {
                        const secretAlias = `${fixture.root}/${GITHUB_TOKEN}`;
                        await assert.rejects(
                                planMigration({ root: secretAlias, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions() }),
                                (err: unknown) => {
                                        assert.ok(err instanceof MigrationError);
                                        assert.strictEqual(err.code, 'FLAUZ_MIGRATION_SECRET_SHAPED');
                                        assert.ok(err.message.includes('secret-shaped literal refused'), 'the refusal states the metadata law');
                                        return true;
                                },
                        );
                } finally {
                        await fixture.cleanup();
                }
        });
});
