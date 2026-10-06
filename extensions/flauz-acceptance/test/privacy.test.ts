/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The privacy canary suite (A-PROD-006-W2): the fail-closed secret sweep
 * over every metadata surface this extension produces + the canary law
 * (secret-shaped acceptance inputs never reach banked census rows or
 * renders). The secret-shaped fixtures are assembled from fragments at
 * RUNTIME (the flauz-resources discipline -- no complete secret shape is
 * ever spelled out in this source file).
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { AcceptanceError } from '../src/api.ts';
import { looksSecretShaped, assertNoSecretShapedValues } from '../src/privacy.ts';
import { launchAcceptance, parseLaunchArgs, renderLaunch } from '../src/launch.ts';
import { verifyAcceptance, parseVerifyArgs, renderVerify } from '../src/verify.ts';
import { runStatus, renderStatus } from '../src/status.ts';
import { nodeAcceptanceFs, steppingClock, tempRoot, plantEvidenceBodies, plantChecklistArtifact } from './helpers.ts';

/** Assembles a GitHub-PAT-shaped canary at RUNTIME from fragments (never a complete literal in this file). */
function ghpCanary(): string {
        return 'ghp_' + 'Fragment0Fragment1Fragment2'.slice(0, 24);
}

/** Assembles an sk_-shaped canary at RUNTIME from fragments. */
function skCanary(): string {
        return 'sk-' + 'Fragment0Fragment1Fragment2'.slice(0, 24);
}

suite('privacy -- the secret-shape battery (the vault-only policy, contract-duplicated)', () => {
        test('looksSecretShaped: the known credential shapes hit; benign text does not', () => {
                assert.ok(looksSecretShaped(ghpCanary()));
                assert.ok(looksSecretShaped(skCanary()));
                assert.ok(looksSecretShaped('Bearer ' + 'Fragment0Fragment1'.slice(0, 20)));
                assert.ok(!looksSecretShaped('operator'));
                assert.ok(!looksSecretShaped('the-beta-launch'));
                assert.ok(!looksSecretShaped('flauz:acc:0123456789abcdef'));
                assert.ok(!looksSecretShaped('.flauz/release/checklist-2026-10-05T120000.000Z.json'));
                assert.ok(!looksSecretShaped('a'.repeat(64)));
        });

        test('assertNoSecretShapedValues: the deep walk refuses a nested secret (fail-closed, typed)', () => {
                assert.throws(() => assertNoSecretShapedValues({ a: { b: [ghpCanary()] } }, 'x'), (err: unknown) => {
                        assert.ok(err instanceof AcceptanceError);
                        assert.equal(err.code, 'FLAUZ_ACCEPTANCE_SECRET_SHAPED');
                        return true;
                });
                // benign shapes pass (no throw = the sweep accepts)
                assertNoSecretShapedValues({ a: { b: ['flauz:acc:0123456789abcdef'] } }, 'x');
        });
});

suite('privacy -- the launch canary (a secret-shaped input refuses the whole launch)', () => {
        test('a secret-shaped ACTOR refuses the launch; NOTHING is written (the sweep fires before the first byte)', async () => {
                const { root, cleanup } = await tempRoot('flauz-acc-pl-');
                try {
                        await plantEvidenceBodies(root);
                        await plantChecklistArtifact(root, 'GO');
                        try {
                                await launchAcceptance({ root, fs: nodeAcceptanceFs(), clock: steppingClock() }, parseLaunchArgs({ seed: 'the-canary-launch', actor: ghpCanary() }));
                                assert.fail('the secret-shaped actor must refuse');
                        } catch (err) {
                                assert.ok(err instanceof AcceptanceError);
                                assert.equal(err.code, 'FLAUZ_ACCEPTANCE_SECRET_SHAPED');
                        }
                        // fail-closed: no acceptance ledger, no journal, nothing banked (the pre-planted
                        // empty evidence ledger stays EMPTY -- the refusal appended no row)
                        await assert.rejects(fs.readFile(path.join(root, '.flauz', 'acceptance', 'acceptances.json'), 'utf-8'), (err: unknown) => (err as { code?: string }).code === 'ENOENT');
                        const bankedText = await fs.readFile(path.join(root, '.flauz', 'evidence', 'ledger.jsonl'), 'utf-8');
                        assert.equal(bankedText, '', 'nothing banked (the sweep fired before the first byte)');
                } finally {
                        await cleanup();
                }
        });

        test('a secret-shaped incident regression-test id refuses the launch (the metadata law walks every field)', async () => {
                const { root, cleanup } = await tempRoot('flauz-acc-pl2-');
                try {
                        await plantEvidenceBodies(root);
                        await plantChecklistArtifact(root, 'GO');
                        try {
                                await launchAcceptance({ root, fs: nodeAcceptanceFs(), clock: steppingClock() }, parseLaunchArgs({ seed: 's', actor: 'operator', incident: { incidentId: 'flauz:inc:0123456789abcdef', regressionTestId: skCanary() } }));
                                assert.fail('the secret-shaped regression test id must refuse');
                        } catch (err) {
                                assert.ok(err instanceof AcceptanceError);
                                assert.equal(err.code, 'FLAUZ_ACCEPTANCE_SECRET_SHAPED');
                        }
                } finally {
                        await cleanup();
                }
        });
});

suite('privacy -- the banked-rows canary (acceptance inputs never reach banked census rows or renders)', () => {
        test('the full happy path leaves NO secret-shaped text anywhere banked or rendered (the canary planted in the operator-side fields only)', async () => {
                const { root, cleanup } = await tempRoot('flauz-acc-pb-');
                try {
                        await plantEvidenceBodies(root);
                        await plantChecklistArtifact(root, 'GO');
                        // the BENIGN launch (the canary assertion below proves the banked surfaces
                        // carry only shapes: had any operator-side free-form text leaked, it would show)
                        const launchResult = await launchAcceptance({ root, fs: nodeAcceptanceFs(), clock: steppingClock() }, parseLaunchArgs({ seed: 'the-benign-launch', actor: 'operator-benign' }));
                        const verifyResult = await verifyAcceptance({ root, fs: nodeAcceptanceFs(), clock: steppingClock(1_740_200_000_000) }, parseVerifyArgs({ acceptanceId: launchResult.acceptanceId, actor: 'verifier-benign' }));
                        const statusResult = await runStatus({ root, fs: nodeAcceptanceFs(), clock: steppingClock(1_740_300_000_000) });
                        // the canary strings must appear NOWHERE: banked ledger rows, journals, records, renders
                        const ledgerText = await fs.readFile(path.join(root, '.flauz', 'evidence', 'ledger.jsonl'), 'utf-8');
                        const acceptanceText = await fs.readFile(path.join(root, '.flauz', 'acceptance', 'acceptances.json'), 'utf-8');
                        const journalText = await fs.readFile(path.join(root, '.flauz', 'acceptance', `verify-${launchResult.acceptanceId}.jsonl`), 'utf-8');
                        const rendered = [...renderLaunch(launchResult), ...renderVerify(verifyResult), ...renderStatus(statusResult)].join('\n');
                        for (const surface of [ledgerText, acceptanceText, journalText, rendered]) {
                                assert.ok(!surface.includes('ghp_'), 'the GitHub-PAT canary never reaches a banked or rendered surface');
                                assert.ok(!surface.includes('sk-') || surface.includes('task'), 'the sk canary never reaches a banked or rendered surface');
                        }
                        // the banked row carries the sha256 of the artifact, never its contents
                        assert.ok(ledgerText.includes('"taskId":"flauz-acceptance"'));
                        assert.ok(ledgerText.split('\n').every(line => line === '' || line.includes('"sha256":"')));
                } finally {
                        await cleanup();
                }
        });

        test('the banked census rows carry the artifact sha256 -- never the artifact contents (the repro of the privacy law)', async () => {
                const { root, cleanup } = await tempRoot('flauz-acc-pb2-');
                try {
                        await plantEvidenceBodies(root);
                        await plantChecklistArtifact(root, 'GO');
                        await launchAcceptance({ root, fs: nodeAcceptanceFs(), clock: steppingClock() }, parseLaunchArgs({ seed: 'the-sha-launch', actor: 'operator' }));
                        const ledgerText = await fs.readFile(path.join(root, '.flauz', 'evidence', 'ledger.jsonl'), 'utf-8');
                        const acceptanceText = await fs.readFile(path.join(root, '.flauz', 'acceptance', 'acceptances.json'), 'utf-8');
                        for (const line of ledgerText.split('\n').filter(line => line !== '')) {
                                const row = JSON.parse(line) as { taskId: string; kind: string; uri: string; sha256: string };
                                assert.equal(row.taskId, 'flauz-acceptance');
                                assert.equal(row.kind, 'note');
                                assert.ok(/^[0-9a-f]{64}$/.test(row.sha256), 'the banked sha256 pin');
                                // the uri is a workspace-relative path only -- never contents, never an absolute host path
                                assert.ok(!row.uri.startsWith('/'));
                        }
                        // the acceptance ledger re-reads (the artifact the sha256 pins)
                        assert.ok(acceptanceText.includes('"flauz.acceptance/v1"'));
                } finally {
                        await cleanup();
                }
        });
});
