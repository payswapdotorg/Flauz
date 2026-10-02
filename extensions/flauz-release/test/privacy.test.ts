/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * A-PROD-004-W5 -- the PRIVACY suite (the canary sweep): secret-shaped
 * values planted in durable-state CONTENTS never leak into any metadata
 * surface this extension produces (the verification record, the checklist
 * artifact, the banked ledger rows, the command renders). The state copy of
 * the fresh self-export legitimately carries contents (the W2 split-sided
 * law) -- everything else must stay clean (fail-closed backstop included).
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { ReleaseError } from '../src/api.ts';
import { looksSecretShaped, sweepArtifact } from '../src/privacy.ts';
import { persistInstallVerification, verifyInstall } from '../src/verifyInstall.ts';
import { runChecklist } from '../src/checklist.ts';
import { collectIntegrity } from '../src/verify.ts';
import { bootFixtureProduct, bootFixtureWorkspace, fixtureVersions, readAllFiles, type FixtureProduct, type FixtureWorkspace } from './helpers.ts';

/** Assembles a secret-shaped GitHub token from fragments at runtime (the flauz-resources discipline -- never a complete literal in source). */
function githubToken(): string {
        return ['ghp_', 'Fragment', 'Zero', 'One', 'Two', 'Three', 'Four', 'Five99'].join('');
}

/** Assembles a secret-shaped OpenAI-style key from fragments. */
function providerKey(): string {
        return ['sk-', 'frag', 'mentA', 'gmentB', 'gmentC', '12345'].join('');
}

suite('A-PROD-004-W5 privacy: the canary sweep over every metadata surface', () => {
        let fixture: FixtureWorkspace;
        let product: FixtureProduct;
        let lines: string[];

        suiteSetup(async () => {
                fixture = await bootFixtureWorkspace({ canaries: [githubToken(), providerKey()] });
                product = await bootFixtureProduct();
        });
        suiteTeardown(async () => {
                await fixture.cleanup();
                await product.cleanup();
        });

        test('the canaries ARE secret-shaped and ARE planted in the durable state (the delivery vehicle works)', async () => {
                assert.ok(looksSecretShaped(githubToken()));
                assert.ok(looksSecretShaped(providerKey()));
                const tasksText = await fs.readFile(path.join(fixture.root, '.flauz', 'tasks.json'), 'utf-8');
                assert.ok(tasksText.includes(githubToken()));
                const journalText = await fs.readFile(path.join(fixture.root, '.flauz', 'orchestration', 'journal.jsonl'), 'utf-8');
                assert.ok(journalText.includes(providerKey()));
        });

        test('the verification record + the banked rows + the render never carry the canaries', async () => {
                const result = await verifyInstall({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions(), productRoot: product.root });
                lines = [];
                const persisted = await persistInstallVerification({ root: fixture.root, fs: fixture.fs, clock: fixture.clock }, fixtureVersions(), result);
                // the record + the ledger rows + the watermark are clean
                for (const file of await readAllFiles(path.join(fixture.root, '.flauz', 'release'))) {
                        assert.ok(!file.text.includes(githubToken()), `the canary leaked into ${file.path}`);
                        assert.ok(!file.text.includes(providerKey()), `the canary leaked into ${file.path}`);
                }
                const ledgerText = await fs.readFile(path.join(fixture.root, '.flauz', 'evidence', 'ledger.jsonl'), 'utf-8');
                assert.ok(!ledgerText.includes(githubToken()));
                assert.ok(!ledgerText.includes(providerKey()));
                // the ledger note row pins the record (census-visible) while staying clean
                assert.ok(ledgerText.includes('flauz-release'));
                assert.ok(ledgerText.includes('.flauz/release/verify-'));
        });

        test('the fresh self-export\'s STATE copy legitimately carries the canaries; its METADATA artifacts never do', async () => {
                const result = await verifyInstall({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions(), productRoot: product.root });
                const exportDir = path.join(fixture.root, '.flauz-exports', result.selfExport.exportDirName);
                const stateTasks = await fs.readFile(path.join(exportDir, 'state', '.flauz', 'tasks.json'), 'utf-8');
                assert.ok(stateTasks.includes(githubToken()), 'the state copy is the backup -- it legitimately carries contents');
                for (const artifact of ['export.json', 'MANIFEST.json', 'integrity.json']) {
                        const text = await fs.readFile(path.join(exportDir, artifact), 'utf-8');
                        assert.ok(!text.includes(githubToken()), `the canary leaked into the self-export's ${artifact}`);
                        assert.ok(!text.includes(providerKey()), `the canary leaked into the self-export's ${artifact}`);
                }
        });

        test('the checklist artifact + the render + the banked rows never carry the canaries', async () => {
                const channel: string[] = [];
                const result = await runChecklist({
                        root: fixture.root,
                        fs: fixture.fs,
                        clock: fixture.clock,
                        versions: fixtureVersions(),
                        productRoot: product.root,
                });
                assert.ok(result.artifactPath);
                const artifactText = await fs.readFile(result.artifactPath, 'utf-8');
                assert.ok(!artifactText.includes(githubToken()), 'the canary leaked into the checklist artifact');
                assert.ok(!artifactText.includes(providerKey()), 'the canary leaked into the checklist artifact');
                for (const file of await readAllFiles(path.join(fixture.root, '.flauz', 'release'))) {
                        assert.ok(!file.text.includes(githubToken()), `the canary leaked into ${file.path}`);
                        assert.ok(!file.text.includes(providerKey()), `the canary leaked into ${file.path}`);
                }
                // a checklist over canary-carrying state can still GO (the contents are the backup's business);
                // the metadata surfaces stayed clean either way
                assert.ok(result.verdict === 'GO' || result.verdict === 'NO-GO');
                for (const line of channel) {
                        assert.ok(!line.includes(githubToken()));
                }
                // the chains stayed GREEN after the banking
                const verdicts = await collectIntegrity(fixture.root, fixture.fs);
                assert.equal(verdicts.evidenceLedger.ok, true);
        });
});

suite('A-PROD-004-W5 privacy: the fail-closed backstop', () => {

        test('sweepArtifact refuses a secret-shaped value anywhere in a metadata artifact (typed, fail-closed)', () => {
                assert.throws(() => sweepArtifact({ note: `token ${githubToken()}` }, 'test-artifact'), (err: unknown) => {
                        assert.ok(err instanceof ReleaseError);
                        assert.equal(err.code, 'FLAUZ_RELEASE_SECRET_SHAPED');
                        assert.ok(err.message.includes('never credential-shaped values'));
                        return true;
                });
                assert.throws(() => sweepArtifact({ nested: [{ deep: [providerKey()] }] }, 'test-artifact'), /secret-shaped literal refused/);
                // clean values pass
                sweepArtifact({ counts: { rowCount: 3 }, path: '.flauz/tasks.json', verdict: 'green' }, 'test-artifact');
        });

        test('the sweep pattern set covers the known credential shapes (fragment-assembled probes)', () => {
                assert.ok(looksSecretShaped(['github_pat_', 'FragmentAAA', 'BBB', 'CCC123'].join('')));
                assert.ok(looksSecretShaped(['AKIA', 'ABCDEFGHIJKLMNOP'].join('')));
                assert.ok(looksSecretShaped(['xoxb-', 'Fragment-AAAAAAAA'].join('')));
                assert.ok(looksSecretShaped(['-----BEGIN RSA ', 'PRIVATE KEY-----'].join('')));
                assert.ok(looksSecretShaped(['Bearer ', 'FragmentToken123456'].join('')));
                assert.ok(looksSecretShaped(['eyJ', 'fragmentAAA', '.', 'frag', '.', 'ment1234567890abcd'].join('')));
                // ordinary text never trips
                assert.ok(!looksSecretShaped('ordinary note'));
                assert.ok(!looksSecretShaped('.flauz/tasks.json'));
                assert.ok(!looksSecretShaped('flauz.release-verify/v1'));
        });
});
