/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The post-release-acceptance law (A-PROD-006-W2, DL-87). UNVERIFIED-BY-ME:
 * the station runs the battery.
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { AcceptanceError, isReceiptId } from '../src/api.ts';
import { launchReleaseAcceptance } from '../src/acceptance.ts';
import { verifyPostRelease, parseVerifyArgs } from '../src/verify.ts';
import { nodeAcceptanceFs, steppingClock, tempRoot, plantEvidenceBodies, plantChecklist, plantLoopJournalAtRelease, INCIDENT_ID } from './helpers.ts';

async function launchOverGreen(root: string): Promise<string> {
	await plantEvidenceBodies(root);
	await plantChecklist(root, root);
	const result = await launchReleaseAcceptance({ root, fs: nodeAcceptanceFs(), clock: steppingClock() }, { actor: 'operator-1' });
	return result.acceptanceId;
}

suite('flauz.acceptance.verify -- the closing receipt', () => {
	test('REFUSES typed when the acceptance record is absent', async () => {
		const { root, cleanup } = await tempRoot('flauz-acc-verify-');
		try {
			await assert.rejects(
				verifyPostRelease({ root, fs: nodeAcceptanceFs(), clock: steppingClock() }, { acceptanceId: 'flauz:acc:0000000000000000', actor: 'operator-1' }),
				(err: unknown) => err instanceof AcceptanceError && err.code === 'FLAUZ_ACCEPTANCE_RECORD_ABSENT',
			);
		} finally {
			await cleanup();
		}
	});

	test('REFUSES typed when the acceptance record is torn', async () => {
		const { root, cleanup } = await tempRoot('flauz-acc-verify-');
		try {
			const acceptanceId = await launchOverGreen(root);
			const recordPath = path.join(root, '.flauz', 'acceptance', `acceptance-${acceptanceId}.json`);
			await fs.writeFile(recordPath, '{"broken": ', 'utf-8');
			await assert.rejects(
				verifyPostRelease({ root, fs: nodeAcceptanceFs(), clock: steppingClock() }, { acceptanceId, actor: 'operator-1' }),
				(err: unknown) => err instanceof AcceptanceError && err.code === 'FLAUZ_ACCEPTANCE_RECORD_TORN',
			);
		} finally {
			await cleanup();
		}
	});

	test('a PASS receipt is banked: evaluable rows pass local-real, checklist rows are typed disclosure rows naming flauz-release', async () => {
		const { root, cleanup } = await tempRoot('flauz-acc-verify-');
		try {
			const acceptanceId = await launchOverGreen(root);
			const result = await verifyPostRelease({ root, fs: nodeAcceptanceFs(), clock: steppingClock() }, { acceptanceId, actor: 'operator-1' });
			assert.equal(result.ok, true);
			assert.equal(result.receipt.verdict, 'pass');
			assert.equal(result.reopenConsumable, false);
			assert.ok(isReceiptId(result.receipt.receiptId));
			// the three evaluable binding checks pass with the local-real label
			for (const name of ['binding-checklist-re-read', 'product-inventory', 'census-integrity']) {
				const row = result.receipt.rows.find(candidate => candidate.check === name);
				assert.ok(row !== undefined);
				assert.equal(row.verdict, 'pass');
				assert.equal(row.evidenceLabel, 'local-real'); // the frozen ladder, never promoted by wording
			}
			// the ten checklist rows are TYPED DISCLOSURE rows naming the owning surface, never silent greens
			const disclosures = result.receipt.rows.filter(row => row.verdict === 'disclosure');
			assert.equal(disclosures.length, 10);
			for (const row of disclosures) {
				assert.equal(row.owningSurface, 'flauz-release');
				assert.ok(row.detail.includes('honest-scope law'));
			}
			// counts are honest
			assert.equal(result.receipt.counts.checks, 13);
			assert.equal(result.receipt.counts.pass, 3);
			assert.equal(result.receipt.counts.fail, 0);
			assert.equal(result.receipt.counts.disclosure, 10);
			// the receipt is banked at the durable home + census-visible
			assert.ok(result.persisted.recordPath.includes('.flauz/acceptance/receipt-'));
			assert.equal(result.persisted.banking.recordAppended, true);
		} finally {
			await cleanup();
		}
	});

	test('a FAIL receipt is banked too (the reopen-consumable record): a vanished checklist artifact fails the binding row', async () => {
		const { root, cleanup } = await tempRoot('flauz-acc-verify-');
		try {
			const acceptanceId = await launchOverGreen(root);
			// delete the bound checklist artifact: the release identity is gone
			const dir = path.join(root, '.flauz', 'release');
			for (const entry of await fs.readdir(dir)) {
				await fs.rm(path.join(dir, entry));
			}
			const result = await verifyPostRelease({ root, fs: nodeAcceptanceFs(), clock: steppingClock() }, { acceptanceId, actor: 'operator-1' });
			assert.equal(result.receipt.verdict, 'fail');
			assert.equal(result.reopenConsumable, true); // the typed failure record the incidents reopen law consumes
			const bindingRow = result.receipt.rows.find(row => row.check === 'binding-checklist-re-read');
			assert.ok(bindingRow !== undefined);
			assert.equal(bindingRow.verdict, 'fail');
			assert.equal(bindingRow.evidenceLabel, 'local-real');
			assert.ok(bindingRow.detail.includes('no longer exists'));
			assert.ok(result.receipt.counts.fail >= 1);
			// the FAILED receipt is banked (pass or FAIL, both typed, both banked)
			assert.ok(result.persisted.recordPath.includes('.flauz/acceptance/receipt-'));
			assert.equal(result.persisted.banking.recordAppended, true);
			const banked = JSON.parse(await fs.readFile(result.persisted.recordPath, 'utf-8'));
			assert.equal(banked.verdict, 'fail');
		} finally {
			await cleanup();
		}
	});

	test('the evidence ladder is never promoted: every disclosure row carries the lowest rung, every evaluable row local-real', async () => {
		const { root, cleanup } = await tempRoot('flauz-acc-verify-');
		try {
			const acceptanceId = await launchOverGreen(root);
			const result = await verifyPostRelease({ root, fs: nodeAcceptanceFs(), clock: steppingClock() }, { acceptanceId, actor: 'operator-1' });
			for (const row of result.receipt.rows) {
				if (row.verdict === 'disclosure') {
					assert.equal(row.evidenceLabel, 'fixture');
					assert.notEqual(row.evidenceLabel, 'local-real');
				} else {
					assert.equal(row.evidenceLabel, 'local-real');
					assert.notEqual(row.evidenceLabel, 'runtime-real');
					assert.notEqual(row.evidenceLabel, 'live-provider');
					assert.notEqual(row.evidenceLabel, 'production-real');
				}
			}
		} finally {
			await cleanup();
		}
	});

	test('the incident-bound verify: the regression test renders a disclosure row naming flauz-incidents; the journal binding passes', async () => {
		const { root, cleanup } = await tempRoot('flauz-acc-verify-');
		try {
			await plantEvidenceBodies(root);
			await plantChecklist(root, root);
			await plantLoopJournalAtRelease(root);
			const launched = await launchReleaseAcceptance({ root, fs: nodeAcceptanceFs(), clock: steppingClock() }, { actor: 'operator-1', incidentBinding: { incidentId: INCIDENT_ID, regressionTestName: 'regression-test-alpha' } });
			const result = await verifyPostRelease({ root, fs: nodeAcceptanceFs(), clock: steppingClock() }, { acceptanceId: launched.acceptanceId, actor: 'operator-1' });
			assert.equal(result.receipt.verdict, 'pass');
			const regressionRow = result.receipt.rows.find(row => row.check === 'regression-test-alpha');
			assert.ok(regressionRow !== undefined);
			assert.equal(regressionRow.verdict, 'disclosure');
			assert.equal(regressionRow.owningSurface, 'flauz-incidents');
			const journalRow = result.receipt.rows.find(row => row.check === 'binding-incident-journal');
			assert.ok(journalRow !== undefined);
			assert.equal(journalRow.verdict, 'pass');
		} finally {
			await cleanup();
		}
	});

	test('parseVerifyArgs refuses bad args typed', () => {
		assert.throws(() => parseVerifyArgs(undefined), (err: unknown) => err instanceof AcceptanceError && err.code === 'FLAUZ_ACCEPTANCE_BAD_ARGS');
		assert.throws(() => parseVerifyArgs({ acceptanceId: 'nope', actor: 'operator-1' }), (err: unknown) => err instanceof AcceptanceError && err.code === 'FLAUZ_ACCEPTANCE_BAD_ARGS');
		assert.throws(() => parseVerifyArgs({ acceptanceId: 'flauz:acc:0000000000000000', actor: '' }), (err: unknown) => err instanceof AcceptanceError && err.code === 'FLAUZ_ACCEPTANCE_BAD_ARGS');
	});
});
