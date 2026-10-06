/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The launch-act law (A-PROD-006-W2, DL-87): the fail-closed matrix + the
 * GREEN-fresh minting. UNVERIFIED-BY-ME: the station runs the battery.
 */

import * as assert from 'node:assert/strict';

import { AcceptanceError, acceptanceIdFromContent, isAcceptanceId, canonicalJson } from '../src/api.ts';
import { launchReleaseAcceptance, parseLaunchArgs } from '../src/acceptance.ts';
import { nodeAcceptanceFs, steppingClock, tempRoot, plantEvidenceBodies, plantChecklist, plantLoopJournalAtRelease, INCIDENT_ID } from './helpers.ts';

const GOOD_ARGS = { actor: 'operator-1' };

suite('flauz.acceptance.launch -- the fail-closed matrix', () => {
	test('REFUSES typed when no checklist artifact exists (ABSENT)', async () => {
		const { root, cleanup } = await tempRoot('flauz-acc-launch-');
		try {
			await plantEvidenceBodies(root);
			await assert.rejects(
				launchReleaseAcceptance({ root, fs: nodeAcceptanceFs(), clock: steppingClock() }, GOOD_ARGS),
				(err: unknown) => err instanceof AcceptanceError && err.code === 'FLAUZ_ACCEPTANCE_CHECKLIST_ABSENT',
			);
		} finally {
			await cleanup();
		}
	});

	test('REFUSES typed when the named artifact does not exist (ABSENT)', async () => {
		const { root, cleanup } = await tempRoot('flauz-acc-launch-');
		try {
			await plantEvidenceBodies(root);
			await assert.rejects(
				launchReleaseAcceptance({ root, fs: nodeAcceptanceFs(), clock: steppingClock() }, { ...GOOD_ARGS, checklistArtifactPath: '.flauz/release/checklist-does-not-exist.json' }),
				(err: unknown) => err instanceof AcceptanceError && err.code === 'FLAUZ_ACCEPTANCE_CHECKLIST_ABSENT',
			);
		} finally {
			await cleanup();
		}
	});

	test('REFUSES typed when the artifact is torn JSON (TORN)', async () => {
		const { root, cleanup } = await tempRoot('flauz-acc-launch-');
		try {
			await plantEvidenceBodies(root);
			const artifactPath = await plantChecklist(root, root, { rawBody: '{"broken": ' });
			await assert.rejects(
				launchReleaseAcceptance({ root, fs: nodeAcceptanceFs(), clock: steppingClock() }, { ...GOOD_ARGS, checklistArtifactPath: artifactPath }),
				(err: unknown) => err instanceof AcceptanceError && err.code === 'FLAUZ_ACCEPTANCE_CHECKLIST_TORN',
			);
		} finally {
			await cleanup();
		}
	});

	test('REFUSES typed when the checklistId does not re-derive over the re-read bytes (TORN)', async () => {
		const { root, cleanup } = await tempRoot('flauz-acc-launch-');
		try {
			await plantEvidenceBodies(root);
			const artifactPath = await plantChecklist(root, root);
			// tamper the artifact in place (the id no longer re-derives)
			const { readFile, writeFile } = await import('node:fs/promises');
			const tampered = JSON.parse(await readFile(`${root}/${artifactPath}`, 'utf-8'));
			tampered.productVersion = '9.9.9';
			await writeFile(`${root}/${artifactPath}`, JSON.stringify(tampered, null, 2));
			await assert.rejects(
				launchReleaseAcceptance({ root, fs: nodeAcceptanceFs(), clock: steppingClock() }, { ...GOOD_ARGS, checklistArtifactPath: artifactPath }),
				(err: unknown) => err instanceof AcceptanceError && err.code === 'FLAUZ_ACCEPTANCE_CHECKLIST_TORN',
			);
		} finally {
			await cleanup();
		}
	});

	test('REFUSES typed when the artifact verdict is NO-GO (RED -- the gate is READ, never redefined)', async () => {
		const { root, cleanup } = await tempRoot('flauz-acc-launch-');
		try {
			await plantEvidenceBodies(root);
			const artifactPath = await plantChecklist(root, root, { verdict: 'NO-GO', redRow: true });
			await assert.rejects(
				launchReleaseAcceptance({ root, fs: nodeAcceptanceFs(), clock: steppingClock() }, { ...GOOD_ARGS, checklistArtifactPath: artifactPath }),
				(err: unknown) => err instanceof AcceptanceError && err.code === 'FLAUZ_ACCEPTANCE_CHECKLIST_RED' && err.message.includes('prove-item-5'),
			);
		} finally {
			await cleanup();
		}
	});

	test('REFUSES typed when the artifact is older than the freshness window (STALE)', async () => {
		const { root, cleanup } = await tempRoot('flauz-acc-launch-');
		try {
			await plantEvidenceBodies(root);
			// the clock starts 25h after the artifact's createdAt
			const artifactPath = await plantChecklist(root, root, { createdAt: 1_740_100_000_000 });
			await assert.rejects(
				launchReleaseAcceptance({ root, fs: nodeAcceptanceFs(), clock: steppingClock(1_740_100_000_000 + 25 * 60 * 60 * 1000) }, { ...GOOD_ARGS, checklistArtifactPath: artifactPath }),
				(err: unknown) => err instanceof AcceptanceError && err.code === 'FLAUZ_ACCEPTANCE_CHECKLIST_STALE',
			);
		} finally {
			await cleanup();
		}
	});

	test('REFUSES typed when an incident-bound launch binds an incident not at the release stage', async () => {
		const { root, cleanup } = await tempRoot('flauz-acc-launch-');
		try {
			await plantEvidenceBodies(root);
			await plantChecklist(root, root);
			await assert.rejects(
				launchReleaseAcceptance({ root, fs: nodeAcceptanceFs(), clock: steppingClock() }, { ...GOOD_ARGS, incidentBinding: { incidentId: INCIDENT_ID, regressionTestName: 'regression-test-alpha' } }),
				(err: unknown) => err instanceof AcceptanceError && err.code === 'FLAUZ_ACCEPTANCE_INCIDENT_ABSENT',
			);
		} finally {
			await cleanup();
		}
	});
});

suite('flauz.acceptance.launch -- the GREEN-fresh minting', () => {
	test('mints the acceptance record over a GREEN FRESH artifact (id determinism, verbatim path carry, product-state pinning, owning checks)', async () => {
		const { root, cleanup } = await tempRoot('flauz-acc-launch-');
		try {
			await plantEvidenceBodies(root);
			const artifactPath = await plantChecklist(root, root);
			const result = await launchReleaseAcceptance({ root, fs: nodeAcceptanceFs(), clock: steppingClock() }, GOOD_ARGS);
			assert.equal(result.ok, true);
			assert.ok(isAcceptanceId(result.acceptanceId));
			// the bound checklist artifact path VERBATIM (the release identity carry)
			assert.equal(result.record.checklist.artifactPath, artifactPath);
			assert.equal(result.record.checklist.verdict, 'GO');
			assert.equal(result.record.checklist.rowCount, 10);
			// the pinned product state (the version-inventory shapes; a bare temp root carries no product -> the honest torn pins)
			assert.equal(result.record.productStatePin.parity.present, false);
			assert.equal(result.record.productStatePin.sbom.present, false);
			// the named owning checks: 10 checklist rows + the 3 binding checks (no incident binding)
			assert.equal(result.record.owningChecks.length, 13);
			assert.ok(result.record.owningChecks.some(check => check.name === 'binding-checklist-re-read' && check.evaluableByPlane));
			assert.ok(result.record.owningChecks.some(check => check.name === 'product-inventory' && check.evaluableByPlane));
			assert.ok(result.record.owningChecks.some(check => check.name === 'census-integrity' && check.evaluableByPlane));
			assert.equal(result.record.incidentBinding, undefined);
			// the record is banked at the durable home + census-visible
			assert.ok(result.persisted.recordPath.includes('.flauz/acceptance/'));
			assert.equal(result.persisted.banking.recordAppended, true);
		} finally {
			await cleanup();
		}
	});

	test('id determinism: identical bound content + identical clock produce the identical acceptance id', async () => {
		const a = await tempRoot('flauz-acc-det-a-');
		const b = await tempRoot('flauz-acc-det-b-');
		const rootA = a.root; const cleanupA = a.cleanup;
		const rootB = b.root; const cleanupB = b.cleanup;
		try {
			await plantEvidenceBodies(rootA);
			await plantEvidenceBodies(rootB);
			const pathA = await plantChecklist(rootA, '/workspace/determinism-pin', { stamp: '2026-10-04T210000.000Z' });
			const pathB = await plantChecklist(rootB, '/workspace/determinism-pin', { stamp: '2026-10-04T210000.000Z' });
			const a = await launchReleaseAcceptance({ root: rootA, fs: nodeAcceptanceFs(), clock: steppingClock() }, GOOD_ARGS);
			const b = await launchReleaseAcceptance({ root: rootB, fs: nodeAcceptanceFs(), clock: steppingClock() }, GOOD_ARGS);
			assert.equal(a.acceptanceId, b.acceptanceId);
			assert.equal(a.record.checklist.artifactPath, pathA);
			assert.equal(b.record.checklist.artifactPath, pathB);
			assert.equal(pathA, pathB);
			// the derivation itself is pure arithmetic
			assert.equal(acceptanceIdFromContent(canonicalJson({ bound: 'content' })), acceptanceIdFromContent(canonicalJson({ bound: 'content' })));
		} finally {
			await cleanupA();
			await cleanupB();
		}
	});

	test('the incident-bound launch carries the named regression test as an owning check', async () => {
		const { root, cleanup } = await tempRoot('flauz-acc-launch-');
		try {
			await plantEvidenceBodies(root);
			await plantChecklist(root, root);
			await plantLoopJournalAtRelease(root);
			const result = await launchReleaseAcceptance({ root, fs: nodeAcceptanceFs(), clock: steppingClock() }, { ...GOOD_ARGS, incidentBinding: { incidentId: INCIDENT_ID, regressionTestName: 'regression-test-alpha' } });
			assert.ok(result.record.incidentBinding !== undefined);
			assert.equal(result.record.incidentBinding.incidentId, INCIDENT_ID);
			assert.equal(result.record.incidentBinding.stage, 'release');
			assert.equal(result.record.incidentBinding.regressionTestName, 'regression-test-alpha');
			// the named regression test + the incident-journal binding join the owning checks
			const regressionCheck = result.record.owningChecks.find(check => check.kind === 'incident-regression-test');
			assert.ok(regressionCheck !== undefined);
			assert.equal(regressionCheck.name, 'regression-test-alpha');
			assert.equal(regressionCheck.owner, 'flauz-incidents');
			assert.equal(regressionCheck.evaluableByPlane, false); // the honest-scope law: a disclosure row at verify time
			assert.ok(result.record.owningChecks.some(check => check.kind === 'binding-incident-journal' && check.evaluableByPlane));
		} finally {
			await cleanup();
		}
	});

	test('the newest artifact under .flauz/release/ is bound when no path is named', async () => {
		const { root, cleanup } = await tempRoot('flauz-acc-launch-');
		try {
			await plantEvidenceBodies(root);
			await plantChecklist(root, root, { stamp: '2026-10-04T200000.000Z' });
			const newest = await plantChecklist(root, root, { stamp: '2026-10-04T220000.000Z' });
			const result = await launchReleaseAcceptance({ root, fs: nodeAcceptanceFs(), clock: steppingClock() }, GOOD_ARGS);
			assert.equal(result.record.checklist.artifactPath, newest);
		} finally {
			await cleanup();
		}
	});

	test('parseLaunchArgs refuses bad args typed (bad actor, bad path scope, bad incident shape)', () => {
		assert.throws(() => parseLaunchArgs(undefined), (err: unknown) => err instanceof AcceptanceError && err.code === 'FLAUZ_ACCEPTANCE_BAD_ARGS');
		assert.throws(() => parseLaunchArgs({ actor: '' }), (err: unknown) => err instanceof AcceptanceError && err.code === 'FLAUZ_ACCEPTANCE_BAD_ARGS');
		assert.throws(() => parseLaunchArgs({ ...GOOD_ARGS, checklistArtifactPath: 'outside/.flauz/checklist.json' }), (err: unknown) => err instanceof AcceptanceError && err.code === 'FLAUZ_ACCEPTANCE_BAD_ARGS');
		assert.throws(() => parseLaunchArgs({ ...GOOD_ARGS, checklistArtifactPath: '.flauz/other/checklist.json' }), (err: unknown) => err instanceof AcceptanceError && err.code === 'FLAUZ_ACCEPTANCE_BAD_ARGS');
		assert.throws(() => parseLaunchArgs({ ...GOOD_ARGS, incidentBinding: { incidentId: 'not-an-id', regressionTestName: 'x' } }), (err: unknown) => err instanceof AcceptanceError && err.code === 'FLAUZ_ACCEPTANCE_BAD_ARGS');
	});
});
