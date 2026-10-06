/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The ledger-verdict suite (A-PROD-006-W2): the status plane over seeded
 * acceptance records -- the verdict table, the honest-scope disclosure, the
 * torn-ledger honesty. Evidence level: local-real over seeded workspace
 * records.
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { runStatus, renderStatus, BOUNDARY_DISCLOSURE } from '../src/status.ts';
import { launchAcceptance, parseLaunchArgs } from '../src/launch.ts';
import { verifyAcceptance, parseVerifyArgs } from '../src/verify.ts';
import { nodeAcceptanceFs, steppingClock, tempRoot, plantEvidenceBodies, plantChecklistArtifact, plantIncidentsLedger, plantTasksEnvelope, acceptanceIdOfSeed, SEEDED_INCIDENT_ID } from './helpers.ts';

async function launchSeeded(root: string, seed: string, incident?: { incidentId: string; regressionTestId: string }): Promise<string> {
        await plantEvidenceBodies(root);
        await plantChecklistArtifact(root, 'GO');
        const result = await launchAcceptance({ root, fs: nodeAcceptanceFs(), clock: steppingClock() }, parseLaunchArgs({ seed, actor: 'operator', ...(incident !== undefined ? { incident } : {}) }));
        return result.acceptanceId;
}

suite('status -- the verdict table over seeded workspace records', () => {
        test('the empty ledger: the honest absent state (zero acceptances, never a guessed summary)', async () => {
                const { root, cleanup } = await tempRoot('flauz-acc-sempty-');
                try {
                        await plantEvidenceBodies(root);
                        const result = await runStatus({ root, fs: nodeAcceptanceFs(), clock: steppingClock() });
                        assert.equal(result.record.ledgerState, 'absent');
                        assert.equal(result.record.counts.acceptances, 0);
                        assert.equal(result.record.counts.withReceipts, 0);
                        // the record persisted + banked census-visible
                        assert.ok(result.persisted.recordPath.endsWith('.json'));
                        const ledgerText = await fs.readFile(path.join(root, '.flauz', 'evidence', 'ledger.jsonl'), 'utf-8');
                        assert.ok(ledgerText.includes('"taskId":"flauz-acceptance"'));
                } finally {
                        await cleanup();
                }
        });

        test('the launched + verified acceptance: the verdict table carries the bound identity + the latest receipt verdict', async () => {
                const { root, cleanup } = await tempRoot('flauz-acc-sverdict-');
                try {
                        const acceptanceId = await launchSeeded(root, 'the-status-launch');
                        await verifyAcceptance({ root, fs: nodeAcceptanceFs(), clock: steppingClock(1_740_200_000_000) }, parseVerifyArgs({ acceptanceId, actor: 'verifier' }));
                        const result = await runStatus({ root, fs: nodeAcceptanceFs(), clock: steppingClock(1_740_300_000_000) });
                        assert.equal(result.record.ledgerState, 'resolved');
                        assert.equal(result.record.counts.acceptances, 1);
                        assert.equal(result.record.counts.withReceipts, 1);
                        assert.equal(result.record.counts.latestPass, 1);
                        assert.equal(result.record.counts.latestFail, 0);
                        const row = result.record.acceptances[0];
                        assert.equal(row?.acceptanceId, acceptanceId);
                        assert.equal(row?.checklistPath, '.flauz/release/checklist-2026-10-05T120000.000Z.json');
                        assert.ok(/^[0-9a-f]{64}$/.test(row?.checklistId ?? ''));
                        assert.equal(row?.revisionCount, 1);
                        assert.equal(row?.owningCheckCount, 10);
                        assert.equal(row?.receipts, 1);
                        assert.equal(row?.latestReceiptVerdict, 'pass');
                        assert.equal(row?.latestReceiptDisclosures, 9);
                        assert.equal(row?.latestReceiptFails, 0);
                        // the honest-scope disclosure is verbatim in every record + render
                        assert.equal(row === undefined ? undefined : result.record.boundaryDisclosure, BOUNDARY_DISCLOSURE);
                        const rendered = renderStatus(result).join('\n');
                        assert.ok(rendered.includes(BOUNDARY_DISCLOSURE));
                        assert.ok(rendered.includes(acceptanceId));
                        assert.ok(rendered.includes('latest receipt pass'));
                } finally {
                        await cleanup();
                }
        });

        test('the incident-bound acceptance: the binding state renders (the two-registry separation link)', async () => {
                const { root, cleanup } = await tempRoot('flauz-acc-sinc-');
                try {
                        await plantIncidentsLedger(root, SEEDED_INCIDENT_ID);
                        const acceptanceId = await launchSeeded(root, 'the-bound-launch', { incidentId: SEEDED_INCIDENT_ID, regressionTestId: 'test/regression/named.test.ts' });
                        const result = await runStatus({ root, fs: nodeAcceptanceFs(), clock: steppingClock() });
                        const row = result.record.acceptances[0];
                        assert.equal(row?.incidentBindingState, 'resolved');
                        assert.equal(row?.incidentId, SEEDED_INCIDENT_ID);
                        assert.equal(row?.regressionTestId, 'test/regression/named.test.ts');
                        assert.equal(result.record.counts.incidentBound, 1);
                } finally {
                        await cleanup();
                }
        });

        test('the failed receipt surfaces as the latest-fail verdict (the typed failure record the incidents reopen law consumes)', async () => {
                const { root, cleanup } = await tempRoot('flauz-acc-sfail-');
                try {
                        await plantTasksEnvelope(root);
                        const acceptanceId = await launchSeeded(root, 'the-failing-launch');
                        await fs.rm(path.join(root, '.flauz', 'tasks.json'));
                        await verifyAcceptance({ root, fs: nodeAcceptanceFs(), clock: steppingClock(1_740_200_000_000) }, parseVerifyArgs({ acceptanceId, actor: 'verifier' }));
                        const result = await runStatus({ root, fs: nodeAcceptanceFs(), clock: steppingClock(1_740_300_000_000) });
                        const row = result.record.acceptances[0];
                        assert.equal(row?.latestReceiptVerdict, 'fail');
                        assert.ok((row?.latestReceiptFails ?? 0) >= 1);
                        assert.equal(result.record.counts.latestFail, 1);
                        const rendered = renderStatus(result).join('\n');
                        assert.ok(rendered.includes('LATEST RECEIPT FAIL'));
                } finally {
                        await cleanup();
                }
        });

        test('the revision history: the re-launch appends (revisionCount 2), the latest revision is the table\'s subject', async () => {
                const { root, cleanup } = await tempRoot('flauz-acc-srev-');
                try {
                        await launchSeeded(root, 'the-revision-seed');
                        await launchSeeded(root, 'the-revision-seed');
                        const result = await runStatus({ root, fs: nodeAcceptanceFs(), clock: steppingClock() });
                        assert.equal(result.record.counts.acceptances, 1);
                        assert.equal(result.record.acceptances[0]?.revisionCount, 2);
                } finally {
                        await cleanup();
                }
        });

        test('the torn ledger: the honest typed degradation (the reason carried, never a guessed summary)', async () => {
                const { root, cleanup } = await tempRoot('flauz-acc-storn-');
                try {
                        await fs.mkdir(path.join(root, '.flauz', 'acceptance'), { recursive: true });
                        await fs.writeFile(path.join(root, '.flauz', 'acceptance', 'acceptances.json'), '{torn', 'utf-8');
                        const result = await runStatus({ root, fs: nodeAcceptanceFs(), clock: steppingClock() });
                        assert.equal(result.record.ledgerState, 'torn');
                        assert.ok(result.record.tornReason !== undefined);
                        assert.equal(result.record.counts.acceptances, 0);
                        const rendered = renderStatus(result).join('\n');
                        assert.ok(rendered.includes('torn'));
                } finally {
                        await cleanup();
                }
        });

        test('the status record is swept + banked census-visible (taskId flauz-acceptance)', async () => {
                const { root, cleanup } = await tempRoot('flauz-acc-sbank-');
                try {
                        await launchSeeded(root, 'the-banked-launch');
                        const result = await runStatus({ root, fs: nodeAcceptanceFs(), clock: steppingClock() });
                        assert.ok(result.persisted.recordPath.includes('status-'));
                        const ledgerText = await fs.readFile(path.join(root, '.flauz', 'evidence', 'ledger.jsonl'), 'utf-8');
                        const rows = ledgerText.split('\n').filter(line => line !== '');
                        assert.ok(rows.length >= 2, 'the launch row + the status row');
                        assert.ok(ledgerText.includes('"uri":".flauz/acceptance/status-'));
                        assert.ok(ledgerText.includes('"taskId":"flauz-acceptance"'));
                } finally {
                        await cleanup();
                }
        });
});
