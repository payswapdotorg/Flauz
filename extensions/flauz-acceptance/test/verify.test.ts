/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The closing-receipt suite (A-PROD-006-W2, DL-87 law 3): the re-run of
 * the named owning checks against the released state, the typed disclosure
 * rows, the product-state pin (pass + the drift failures), and the
 * append-only journal (pass AND fail both banked). Evidence level:
 * local-real over seeded workspace records.
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { AcceptanceError, readVerificationJournal, parseVerificationRow } from '../src/api.ts';
import { verifyAcceptance, parseVerifyArgs, comparePin, verificationJournalPath } from '../src/verify.ts';
import { launchAcceptance, parseLaunchArgs } from '../src/launch.ts';
import { nodeAcceptanceFs, steppingClock, tempRoot, plantEvidenceBodies, plantChecklistArtifact, plantTasksEnvelope, plantIncidentsLedger, acceptanceIdOfSeed, SEEDED_INCIDENT_ID } from './helpers.ts';

async function launchSeeded(root: string, seed: string, opts: { incident?: { incidentId: string; regressionTestId: string; regressionReceiptRef?: string } } = {}): Promise<string> {
        await plantEvidenceBodies(root);
        await plantChecklistArtifact(root, 'GO');
        const result = await launchAcceptance({ root, fs: nodeAcceptanceFs(), clock: steppingClock() }, parseLaunchArgs({ seed, actor: 'operator', ...(opts.incident !== undefined ? { incident: opts.incident } : {}) }));
        return result.acceptanceId;
}

async function verify(root: string, acceptanceId: string): Promise<ReturnType<typeof verifyAcceptance>> {
        return await verifyAcceptance({ root, fs: nodeAcceptanceFs(), clock: steppingClock(1_740_200_000_000) }, parseVerifyArgs({ acceptanceId, actor: 'verifier' }));
}

suite('verify -- the closing receipt over a healthy released state', () => {
        test('the pass receipt: the self-evaluable named check genuinely re-run, the rest TYPED DISCLOSURE rows naming their owning surfaces, the product-state pin passing', async () => {
                const { root, cleanup } = await tempRoot('flauz-acc-vpass-');
                try {
                        const acceptanceId = await launchSeeded(root, 'the-healthy-launch');
                        const result = await verify(root, acceptanceId);
                        assert.equal(result.verdict, 'pass');
                        assert.equal(result.evidenceLabel, 'local-real', 'the receipt\'s evidence label comes from the frozen ladder (workspace-state re-reads)');
                        const rows = result.row.checks;
                        assert.equal(rows.length, 11, 'the ten named owning checks + the product-state pin');
                        // the checklistArtifact row: the ONE genuinely re-run named check
                        const artifactRow = rows.find(row => row.checkId === 'checklistArtifact');
                        assert.ok(artifactRow !== undefined);
                        assert.equal(artifactRow.verdict, 'pass');
                        assert.equal(artifactRow.evidenceLabel, 'local-real');
                        assert.ok(artifactRow.detail.includes('checklistId re-derives'));
                        // the other nine checklist rows: typed disclosure rows naming the owning command, NO evidence label
                        const disclosureRows = rows.filter(row => row.verdict === 'disclosure');
                        assert.equal(disclosureRows.length, 9);
                        for (const row of disclosureRows) {
                                assert.equal(row.evidenceLabel, undefined, 'a disclosure row carries NO evidence label (a disclosure is not evidence -- never a fabricated label)');
                                assert.ok(row.owningSurface.startsWith('flauz.owner.'), 'the disclosure names the owning surface');
                                assert.ok(row.detail.includes('boundary law') || row.detail.includes('cannot'), 'the disclosure states the honest-scope carve-out');
                        }
                        // the product-state pin: this plane's own check over the released state
                        const pinRow = rows.find(row => row.source === 'product-state-pin');
                        assert.ok(pinRow !== undefined);
                        assert.equal(pinRow.verdict, 'pass');
                        assert.equal(pinRow.evidenceLabel, 'local-real');
                        assert.ok(pinRow.detail.includes('growth disclosure'), 'the launch\'s own banking growth is DISCLOSED, never failed');
                        // the counts coherence
                        assert.deepEqual(result.row.counts, { total: 11, pass: 2, fail: 0, disclosure: 9 });
                } finally {
                        await cleanup();
                }
        });

        test('the append-only journal: pass AND the next receipt both banked, one row per verify run, seq 1 then 2', async () => {
                const { root, cleanup } = await tempRoot('flauz-acc-vjour-');
                try {
                        const acceptanceId = await launchSeeded(root, 'the-journaled-launch');
                        await verify(root, acceptanceId);
                        await verify(root, acceptanceId);
                        const journal = await readVerificationJournal(root, nodeAcceptanceFs(), acceptanceId);
                        if (journal.state !== 'resolved') {
                                assert.fail('the journal must resolve');
                        }
                        assert.equal(journal.rows.length, 2, 'two verify runs = two rows');
                        assert.equal(journal.rows[0]?.seq, 1);
                        assert.equal(journal.rows[1]?.seq, 2);
                        assert.equal(journal.rows[0]?.verdict, 'pass');
                        assert.equal(journal.rows[1]?.verdict, 'pass');
                        // the journal path convention
                        assert.equal(verificationJournalPath(acceptanceId), `.flauz/acceptance/verify-${acceptanceId}.jsonl`);
                        // the census-visible banking: the evidence ledger carries the launch + BOTH receipts
                        const ledgerText = await fs.readFile(path.join(root, '.flauz', 'evidence', 'ledger.jsonl'), 'utf-8');
                        assert.equal(ledgerText.split('\n').filter(line => line !== '').length, 3, 'launch + receipt 1 + receipt 2');
                } finally {
                        await cleanup();
                }
        });

        test('the named regression test row: a TYPED DISCLOSURE naming the repo test lane; the pinned receipt ref integrity re-read in the pin row', async () => {
                const { root, cleanup } = await tempRoot('flauz-acc-vreg-');
                try {
                        await fs.mkdir(path.join(root, '.flauz', 'incidents'), { recursive: true });
                        await fs.writeFile(path.join(root, '.flauz', 'regression-receipts', 'receipt.jsonl'), '', 'utf-8').catch(() => undefined);
                        await fs.mkdir(path.join(root, '.flauz', 'regression-receipts'), { recursive: true });
                        await fs.writeFile(path.join(root, '.flauz', 'regression-receipts', 'receipt.jsonl'), '{"receipt":"the named regression test passing receipt"}\n', 'utf-8');
                        await plantIncidentsLedger(root, SEEDED_INCIDENT_ID);
                        const acceptanceId = await launchSeeded(root, 'the-regression-launch', { incident: { incidentId: SEEDED_INCIDENT_ID, regressionTestId: 'test/regression/named.test.ts', regressionReceiptRef: '.flauz/regression-receipts/receipt.jsonl' } });
                        const result = await verify(root, acceptanceId);
                        assert.equal(result.verdict, 'pass');
                        const regressionRow = result.row.checks.find(row => row.source === 'regression-test');
                        assert.ok(regressionRow !== undefined);
                        assert.equal(regressionRow.verdict, 'disclosure');
                        assert.ok(regressionRow.owningSurface.includes('repo test lane'));
                        assert.equal(regressionRow.evidenceLabel, undefined);
                        assert.equal(result.row.counts.total, 12, 'ten checklist rows + the regression test + the pin');
                } finally {
                        await cleanup();
                }
        });
});

suite('verify -- the drift failures (a FAILED receipt is the typed failure record the incidents reopen law consumes)', () => {
        test('the destroyed release identity: the bound checklist artifact deleted after the launch = the FAIL receipt', async () => {
                const { root, cleanup } = await tempRoot('flauz-acc-vdest-');
                try {
                        const acceptanceId = await launchSeeded(root, 'the-destroyed-identity');
                        await fs.rm(path.join(root, '.flauz', 'release', 'checklist-2026-10-05T120000.000Z.json'));
                        const result = await verify(root, acceptanceId);
                        assert.equal(result.verdict, 'fail');
                        const artifactRow = result.row.checks.find(row => row.checkId === 'checklistArtifact');
                        assert.equal(artifactRow?.verdict, 'fail');
                        assert.ok(artifactRow?.detail.includes('ABSENT'));
                        // the FAIL receipt is banked (both typed, both banked)
                        const journal = await readVerificationJournal(root, nodeAcceptanceFs(), acceptanceId);
                        if (journal.state !== 'resolved') {
                                assert.fail('the journal must resolve');
                        }
                        assert.equal(journal.rows[journal.rows.length - 1]?.verdict, 'fail');
                } finally {
                        await cleanup();
                }
        });

        test('the tampered release identity: the bound artifact\'s bytes rewritten (a different checklistId) = the FAIL receipt', async () => {
                const { root, cleanup } = await tempRoot('flauz-acc-vtamp-');
                try {
                        const acceptanceId = await launchSeeded(root, 'the-tampered-identity');
                        const artifactPath = path.join(root, '.flauz', 'release', 'checklist-2026-10-05T120000.000Z.json');
                        const text = await fs.readFile(artifactPath, 'utf-8');
                        const tampered = JSON.parse(text) as { productName: string };
                        tampered.productName = 'Flauz-Tampered';
                        await fs.writeFile(artifactPath, `${JSON.stringify(tampered, null, 2)}\n`, 'utf-8');
                        const result = await verify(root, acceptanceId);
                        assert.equal(result.verdict, 'fail');
                        const artifactRow = result.row.checks.find(row => row.checkId === 'checklistArtifact');
                        assert.equal(artifactRow?.verdict, 'fail');
                        assert.ok(artifactRow?.detail.includes('no longer verifies'), 'the tampered bytes surface as a torn gate identity (the id re-derivation law)');
                } finally {
                        await cleanup();
                }
        });

        test('the pinned surface version drift: the tasks envelope migrated under the acceptance = the FAIL receipt', async () => {
                const { root, cleanup } = await tempRoot('flauz-acc-vdrift-');
                try {
                        await plantTasksEnvelope(root);
                        const acceptanceId = await launchSeeded(root, 'the-drifted-launch');
                        await fs.writeFile(path.join(root, '.flauz', 'tasks.json'), `${JSON.stringify({ $schema: 'flauz.tasks/v9', tasks: [] }, null, 2)}\n`, 'utf-8');
                        const result = await verify(root, acceptanceId);
                        assert.equal(result.verdict, 'fail');
                        const pinRow = result.row.checks.find(row => row.source === 'product-state-pin');
                        assert.equal(pinRow?.verdict, 'fail');
                        assert.ok(pinRow?.reasons.some(reason => reason.includes('detected format version changed')));
                } finally {
                        await cleanup();
                }
        });

        test('the pinned surface destroyed: a present-at-launch file gone absent = the FAIL receipt', async () => {
                const { root, cleanup } = await tempRoot('flauz-acc-vlost-');
                try {
                        await plantTasksEnvelope(root);
                        const acceptanceId = await launchSeeded(root, 'the-lost-surface-launch');
                        await fs.rm(path.join(root, '.flauz', 'tasks.json'));
                        const result = await verify(root, acceptanceId);
                        assert.equal(result.verdict, 'fail');
                        const pinRow = result.row.checks.find(row => row.source === 'product-state-pin');
                        assert.ok(pinRow?.reasons.some(reason => reason.includes('ABSENT in the released state')));
                } finally {
                        await cleanup();
                }
        });

        test('the pinned surface torn: a clean-at-launch ledger file truncated mid-append = the FAIL receipt', async () => {
                const { root, cleanup } = await tempRoot('flauz-acc-vtorn-');
                try {
                        const acceptanceId = await launchSeeded(root, 'the-torn-surface-launch');
                        const ledgerPath = path.join(root, '.flauz', 'evidence', 'ledger.jsonl');
                        const text = await fs.readFile(ledgerPath, 'utf-8');
                        await fs.writeFile(ledgerPath, text.slice(0, Math.max(0, text.length - 1)), 'utf-8'); // strip the trailing newline: a torn append
                        const result = await verify(root, acceptanceId);
                        assert.equal(result.verdict, 'fail');
                        const pinRow = result.row.checks.find(row => row.source === 'product-state-pin');
                        assert.ok(pinRow?.reasons.some(reason => reason.includes('TORN now')));
                } finally {
                        await cleanup();
                }
        });

        test('the destroyed regression receipt ref = the FAIL receipt (the named regression test\'s banked receipt was destroyed)', async () => {
                const { root, cleanup } = await tempRoot('flauz-acc-vreceipt-');
                try {
                        await fs.mkdir(path.join(root, '.flauz', 'regression-receipts'), { recursive: true });
                        await fs.writeFile(path.join(root, '.flauz', 'regression-receipts', 'receipt.jsonl'), '{"receipt":"x"}\n', 'utf-8');
                        await plantIncidentsLedger(root, SEEDED_INCIDENT_ID);
                        const acceptanceId = await launchSeeded(root, 'the-receipt-launch', { incident: { incidentId: SEEDED_INCIDENT_ID, regressionTestId: 'test/regression/named.test.ts', regressionReceiptRef: '.flauz/regression-receipts/receipt.jsonl' } });
                        await fs.rm(path.join(root, '.flauz', 'regression-receipts', 'receipt.jsonl'));
                        const result = await verify(root, acceptanceId);
                        assert.equal(result.verdict, 'fail');
                        const pinRow = result.row.checks.find(row => row.source === 'product-state-pin');
                        assert.ok(pinRow?.reasons.some(reason => reason.includes('regression receipt ref is ABSENT')));
                } finally {
                        await cleanup();
                }
        });
});

suite('verify -- the pin comparison semantics + the typed refusals', () => {
        test('comparePin: growth is DISCLOSED (never failed); absence/version-change/tearing FAIL', async () => {
                const launchState = await import('../src/productState.ts').then(mod => mod.readProductState);
                const { root, cleanup } = await tempRoot('flauz-acc-vpin-');
                try {
                        await plantEvidenceBodies(root);
                        await plantTasksEnvelope(root);
                        const pin = await launchState(root, nodeAcceptanceFs());
                        const fresh = await launchState(root, nodeAcceptanceFs());
                        const identical = comparePin(pin, fresh);
                        assert.equal(identical.reasons.length, 0);
                        assert.equal(identical.growthDisclosed.length, 0);
                        // growth: append a row to the evidence ledger
                        await fs.appendFile(path.join(root, '.flauz', 'evidence', 'ledger.jsonl'), '{"seq":1,"ts":1,"taskId":"t","kind":"note","uri":"x","sha256":"' + 'a'.repeat(64) + '","prev":null}\n', 'utf-8');
                        const grown = await launchState(root, nodeAcceptanceFs());
                        const growth = comparePin(pin, grown);
                        assert.equal(growth.reasons.length, 0, 'append-only growth never fails the pin');
                        assert.equal(growth.growthDisclosed.length, 1);
                        assert.ok(growth.growthDisclosed[0]?.includes('append-only growth'));
                } finally {
                        await cleanup();
                }
        });

        test('the typed refusals: the unknown acceptance id + the bad args', async () => {
                const { root, cleanup } = await tempRoot('flauz-acc-vref-');
                try {
                        await plantEvidenceBodies(root);
                        await plantChecklistArtifact(root, 'GO');
                        try {
                                await verify(root, acceptanceIdOfSeed('never-launched'));
                                assert.fail('the unknown id must refuse');
                        } catch (err) {
                                assert.ok(err instanceof AcceptanceError);
                                assert.equal(err.code, 'FLAUZ_ACCEPTANCE_UNKNOWN_ACCEPTANCE');
                        }
                        try {
                                parseVerifyArgs({ acceptanceId: 'not-an-id', actor: 'a' });
                                assert.fail('the bad id shape must refuse');
                        } catch (err) {
                                assert.ok(err instanceof AcceptanceError);
                                assert.equal(err.code, 'FLAUZ_ACCEPTANCE_BAD_ARGS');
                        }
                        try {
                                parseVerifyArgs({ acceptanceId: acceptanceIdOfSeed('x'), actor: '' });
                                assert.fail('the empty actor must refuse');
                        } catch (err) {
                                assert.ok(err instanceof AcceptanceError);
                                assert.equal(err.code, 'FLAUZ_ACCEPTANCE_BAD_ARGS');
                        }
                } finally {
                        await cleanup();
                }
        });

        test('parseVerificationRow: the count-coherence + verdict-coherence + never-fabricate laws (a torn journal row is refused)', () => {
                const base = {
                        $schema: 'flauz.acceptance-verification/v1',
                        schemaVersion: 0,
                        kind: 'flauz-acceptance-verification',
                        extensionId: 'flauz.flauz-acceptance',
                        acceptanceId: 'flauz:acc:0123456789abcdef',
                        seq: 1,
                        timestampEpoch: 1,
                        timestampIso: '2026-10-05T12:00:00.000Z',
                        actor: 'verifier',
                        verdict: 'pass',
                        evidenceLabel: 'local-real',
                        checks: [{ checkId: 'checklistArtifact', source: 'checklist-row', verdict: 'pass', evidenceLabel: 'local-real', owningSurface: 'flauz.acceptance.verify', detail: 'd', reasons: [] }],
                        counts: { total: 1, pass: 1, fail: 0, disclosure: 0 },
                };
                assert.ok(parseVerificationRow(base) !== undefined);
                // the count incoherence is refused
                assert.equal(parseVerificationRow({ ...base, counts: { total: 1, pass: 2, fail: 0, disclosure: 0 } }), undefined);
                // the verdict incoherence is refused (a fail check under a pass verdict)
                assert.equal(parseVerificationRow({ ...base, checks: [...base.checks, { checkId: 'x', source: 'checklist-row', verdict: 'fail', evidenceLabel: 'local-real', owningSurface: 'o', detail: 'd', reasons: [] }], counts: { total: 2, pass: 1, fail: 1, disclosure: 0 }, verdict: 'pass' }), undefined);
                // the never-fabricate law: a disclosure row carrying an evidence label is refused
                assert.equal(parseVerificationRow({ ...base, checks: [...base.checks, { checkId: 'x', source: 'checklist-row', verdict: 'disclosure', evidenceLabel: 'local-real', owningSurface: 'o', detail: 'd', reasons: [] }], counts: { total: 2, pass: 1, fail: 0, disclosure: 1 } }), undefined);
                // a pass row without an evidence label is refused
                assert.equal(parseVerificationRow({ ...base, checks: [{ checkId: 'x', source: 'checklist-row', verdict: 'pass', owningSurface: 'o', detail: 'd', reasons: [] }], counts: { total: 1, pass: 1, fail: 0, disclosure: 0 } }), undefined);
        });
});
