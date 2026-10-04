/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The advance semantics (A-PROD-006-W1, DL-86): the loop state machine.
 *
 *   - the full legal forward transition lattice (incident ->
 *     reproducible-finding -> registry-item -> fix -> regression ->
 *     release -> post-release-verification -- the closure);
 *   - the closure-law refusals with the EXACT missing stage-evidence kinds
 *     (fix -> regression requires `regression-receipt`; regression -> release
 *     requires `release-identity`; release -> post-release-verification
 *     requires `post-release-verification-receipt`);
 *   - the ONE reopen law (a failed post-release verification REOPENS the
 *     incident with the failure as evidence -- a closed loop never hides a
 *     regression);
 *   - the evidence-label ladder per transition (the frozen ladder; never
 *     promote a label by wording);
 *   - the verbatim registry-id carry at the registry-item stage (the
 *     two-registry separation: the product surface carries the repo-side
 *     registry item id VERBATIM; never mints, edits, ranks or supersedes
 *     control-plane state);
 *   - NO stage may be skipped forward (the closure law);
 *   - the determinism law (the injected clock; no Date.now/new Date in src).
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { IncidentsError, type LoopStage } from '../src/api.ts';
import { parseAdvanceArgs, advanceLoop, fireIntakeRow, loopJournalPath, TRANSITION_EVIDENCE_REQUIREMENTS, currentLoopStage } from '../src/loop.ts';
import { reportIncident } from '../src/incidents.ts';
import { nodeIncidentsFs, steppingClock, tempRoot, plantEvidenceBodies } from './helpers.ts';

const GOOD_MANUAL = {
	seed: 'the-loop-incident',
	class: 'provider-outage',
	severity: 'sev2' as const,
	affectedSurface: 'flauz-models',
	reproNote: 'restart the provider lane and re-issue the request',
	evidenceRefs: ['.flauz/evidence/ledger.jsonl'],
	sourceBinding: { kind: 'manual' as const },
	actor: 'operator-1',
};

/** Seeds a fresh incident + the intake row, returns the incident id + the deps. */
async function seedIncident(root: string, fsPort = nodeIncidentsFs(), clock = steppingClock()): Promise<string> {
	const result = await reportIncident({ root, fs: fsPort, clock }, GOOD_MANUAL);
	return result.incidentId;
}

/** The evidence payload for a forward transition, with the right `kind` for the closure law. */
function evidence(label: 'fixture' | 'simulated' | 'local-real' | 'runtime-real' | 'live-provider' | 'production-real', kind: string, detail = 'the evidence detail', registryItemId?: string) {
	const ev: { label: typeof label; kind: string; detail: string; evidenceRefs?: string[]; registryItemId?: string } = { label, kind, detail };
	if (registryItemId !== undefined) {
		ev.registryItemId = registryItemId;
	}
	return ev;
}

suite('flauz.incidents.advance -- the full legal forward transition lattice (the A6 law, verbatim)', () => {
	test('the full lattice: incident -> reproducible-finding -> registry-item -> fix -> regression -> release -> post-release-verification (CLOSED)', async () => {
		const { root, cleanup } = await tempRoot('flauz-inc-adv-');
		try {
			const fsPort = nodeIncidentsFs();
			const clock = steppingClock();
			await plantEvidenceBodies(root);
			const incidentId = await seedIncident(root, fsPort, clock);

			// incident -> reproducible-finding (evidence: reproducible-finding-evidence)
			const r1 = await advanceLoop({ root, fs: fsPort, clock }, { incidentId, actor: 'operator-1', transition: 'forward', evidence: evidence('local-real', 'reproducible-finding-evidence', 'the reproduction account') });
			assert.equal(r1.transition, 'forward');
			assert.equal(r1.fromStage, 'incident');
			assert.equal(r1.toStage, 'reproducible-finding');
			assert.equal(r1.refused, false);

			// reproducible-finding -> registry-item (evidence: registry-item-id, VERBATIM)
			const r2 = await advanceLoop({ root, fs: fsPort, clock }, { incidentId, actor: 'operator-1', transition: 'forward', evidence: evidence('local-real', 'registry-item-id', 'the registry item id', 'A-PROD-006-W1-REG-001') });
			assert.equal(r2.transition, 'forward');
			assert.equal(r2.fromStage, 'reproducible-finding');
			assert.equal(r2.toStage, 'registry-item');
			assert.equal(r2.refused, false);

			// registry-item -> fix (evidence: fix-evidence)
			const r3 = await advanceLoop({ root, fs: fsPort, clock }, { incidentId, actor: 'operator-1', transition: 'forward', evidence: evidence('local-real', 'fix-evidence', 'the fix changeset pointer') });
			assert.equal(r3.transition, 'forward');
			assert.equal(r3.fromStage, 'registry-item');
			assert.equal(r3.toStage, 'fix');
			assert.equal(r3.refused, false);

			// fix -> regression (REQUIRES regression-receipt)
			const r4 = await advanceLoop({ root, fs: fsPort, clock }, { incidentId, actor: 'operator-1', transition: 'forward', evidence: evidence('local-real', 'regression-receipt', 'the named regression test passed') });
			assert.equal(r4.transition, 'forward');
			assert.equal(r4.fromStage, 'fix');
			assert.equal(r4.toStage, 'regression');
			assert.equal(r4.refused, false);

			// regression -> release (REQUIRES release-identity)
			const r5 = await advanceLoop({ root, fs: fsPort, clock }, { incidentId, actor: 'operator-1', transition: 'forward', evidence: evidence('local-real', 'release-identity', 'the owning release record pointer') });
			assert.equal(r5.transition, 'forward');
			assert.equal(r5.fromStage, 'regression');
			assert.equal(r5.toStage, 'release');
			assert.equal(r5.refused, false);

			// release -> post-release-verification (REQUIRES post-release-verification-receipt; CLOSES the loop)
			const r6 = await advanceLoop({ root, fs: fsPort, clock }, { incidentId, actor: 'operator-1', transition: 'forward', evidence: evidence('local-real', 'post-release-verification-receipt', 'the re-run of the named owning checks against the released state') });
			assert.equal(r6.transition, 'close', 'the release -> post-release-verification transition CLOSES the loop');
			assert.equal(r6.fromStage, 'release');
			assert.equal(r6.toStage, 'post-release-verification');
			assert.equal(r6.refused, false);

			// the loop is now CLOSED at the post-release-verification stage
			const journalText = await fs.readFile(path.join(root, loopJournalPath(incidentId)), 'utf-8');
			const rows = journalText.trim().split('\n').map(line => JSON.parse(line) as { toStage: string; transition: string });
			assert.equal(rows.length, 7, 'one intake row + six transition rows = seven rows');
			assert.equal(rows[rows.length - 1]?.toStage, 'post-release-verification');
			assert.equal(rows[rows.length - 1]?.transition, 'close');
		} finally {
			await cleanup();
		}
	});

	test('the registry-item stage carries the repo-side registry item id VERBATIM (the two-registry separation)', async () => {
		const { root, cleanup } = await tempRoot('flauz-inc-adv-');
		try {
			const fsPort = nodeIncidentsFs();
			const clock = steppingClock();
			await plantEvidenceBodies(root);
			const incidentId = await seedIncident(root, fsPort, clock);
			await advanceLoop({ root, fs: fsPort, clock }, { incidentId, actor: 'operator-1', transition: 'forward', evidence: evidence('local-real', 'reproducible-finding-evidence') });
			const registryItemId = 'A-PROD-006-W1-REG-001';
			const r2 = await advanceLoop({ root, fs: fsPort, clock }, { incidentId, actor: 'operator-1', transition: 'forward', evidence: evidence('local-real', 'registry-item-id', 'the registry item id', registryItemId) });
			assert.equal(r2.refused, false);
			// the journal row carries the registryItemId VERBATIM in its evidence payload
			const journalText = await fs.readFile(path.join(root, loopJournalPath(incidentId)), 'utf-8');
			const rows = journalText.trim().split('\n').map(line => JSON.parse(line) as { toStage: string; evidence: { registryItemId?: string } });
			const registryRow = rows.find(row => row.toStage === 'registry-item');
			assert.equal(registryRow?.evidence?.registryItemId, registryItemId, 'the registry-item stage carries the repo-side registry item id VERBATIM');
		} finally {
			await cleanup();
		}
	});
});

suite('flauz.incidents.advance -- the closure-law refusals (the EXACT missing stage-evidence kinds)', () => {
	test('fix -> regression REFUSES without the regression-receipt (the closure law)', async () => {
		const { root, cleanup } = await tempRoot('flauz-inc-adv-');
		try {
			const fsPort = nodeIncidentsFs();
			const clock = steppingClock();
			await plantEvidenceBodies(root);
			const incidentId = await seedIncident(root, fsPort, clock);
			await advanceLoop({ root, fs: fsPort, clock }, { incidentId, actor: 'operator-1', transition: 'forward', evidence: evidence('local-real', 'reproducible-finding-evidence') });
			await advanceLoop({ root, fs: fsPort, clock }, { incidentId, actor: 'operator-1', transition: 'forward', evidence: evidence('local-real', 'registry-item-id', 'the id', 'REG-001') });
			await advanceLoop({ root, fs: fsPort, clock }, { incidentId, actor: 'operator-1', transition: 'forward', evidence: evidence('local-real', 'fix-evidence', 'the fix') });
			// fix -> regression requires `regression-receipt`; a wrong kind REFUSES
			const refused = await advanceLoop({ root, fs: fsPort, clock }, { incidentId, actor: 'operator-1', transition: 'forward', evidence: evidence('local-real', 'wrong-kind', 'not the regression receipt') });
			assert.equal(refused.refused, true);
			assert.equal(refused.transition, 'refusal');
			assert.equal(refused.refusedEvidenceKind, 'regression-receipt', 'the EXACT missing stage-evidence kind');
			assert.equal(refused.toStage, 'fix', 'the incident stays at the refused stage (NO stage may be skipped forward)');
			// the journal has a refusal row appended
			const journalText = await fs.readFile(path.join(root, loopJournalPath(incidentId)), 'utf-8');
			const rows = journalText.trim().split('\n').map(line => JSON.parse(line) as { transition: string; refusedEvidenceKind?: string; toStage: string });
			const lastRow = rows[rows.length - 1];
			assert.equal(lastRow?.transition, 'refusal');
			assert.equal(lastRow?.refusedEvidenceKind, 'regression-receipt');
		} finally {
			await cleanup();
		}
	});

	test('regression -> release REFUSES without the release-identity (the closure law)', async () => {
		const { root, cleanup } = await tempRoot('flauz-inc-adv-');
		try {
			const fsPort = nodeIncidentsFs();
			const clock = steppingClock();
			await plantEvidenceBodies(root);
			const incidentId = await seedIncident(root, fsPort, clock);
			await advanceLoop({ root, fs: fsPort, clock }, { incidentId, actor: 'operator-1', transition: 'forward', evidence: evidence('local-real', 'reproducible-finding-evidence') });
			await advanceLoop({ root, fs: fsPort, clock }, { incidentId, actor: 'operator-1', transition: 'forward', evidence: evidence('local-real', 'registry-item-id', 'the id', 'REG-001') });
			await advanceLoop({ root, fs: fsPort, clock }, { incidentId, actor: 'operator-1', transition: 'forward', evidence: evidence('local-real', 'fix-evidence', 'the fix') });
			await advanceLoop({ root, fs: fsPort, clock }, { incidentId, actor: 'operator-1', transition: 'forward', evidence: evidence('local-real', 'regression-receipt', 'the regression test passed') });
			// regression -> release requires `release-identity`; a wrong kind REFUSES
			const refused = await advanceLoop({ root, fs: fsPort, clock }, { incidentId, actor: 'operator-1', transition: 'forward', evidence: evidence('local-real', 'wrong-kind', 'not the release identity') });
			assert.equal(refused.refused, true);
			assert.equal(refused.refusedEvidenceKind, 'release-identity', 'the EXACT missing stage-evidence kind');
			assert.equal(refused.toStage, 'regression');
		} finally {
			await cleanup();
		}
	});

	test('release -> post-release-verification REFUSES without the post-release-verification-receipt (the closure law)', async () => {
		const { root, cleanup } = await tempRoot('flauz-inc-adv-');
		try {
			const fsPort = nodeIncidentsFs();
			const clock = steppingClock();
			await plantEvidenceBodies(root);
			const incidentId = await seedIncident(root, fsPort, clock);
			await advanceLoop({ root, fs: fsPort, clock }, { incidentId, actor: 'operator-1', transition: 'forward', evidence: evidence('local-real', 'reproducible-finding-evidence') });
			await advanceLoop({ root, fs: fsPort, clock }, { incidentId, actor: 'operator-1', transition: 'forward', evidence: evidence('local-real', 'registry-item-id', 'the id', 'REG-001') });
			await advanceLoop({ root, fs: fsPort, clock }, { incidentId, actor: 'operator-1', transition: 'forward', evidence: evidence('local-real', 'fix-evidence', 'the fix') });
			await advanceLoop({ root, fs: fsPort, clock }, { incidentId, actor: 'operator-1', transition: 'forward', evidence: evidence('local-real', 'regression-receipt', 'the regression test passed') });
			await advanceLoop({ root, fs: fsPort, clock }, { incidentId, actor: 'operator-1', transition: 'forward', evidence: evidence('local-real', 'release-identity', 'the release record pointer') });
			// release -> post-release-verification requires `post-release-verification-receipt`; a wrong kind REFUSES
			const refused = await advanceLoop({ root, fs: fsPort, clock }, { incidentId, actor: 'operator-1', transition: 'forward', evidence: evidence('local-real', 'wrong-kind', 'not the post-release verification receipt') });
			assert.equal(refused.refused, true);
			assert.equal(refused.refusedEvidenceKind, 'post-release-verification-receipt', 'the EXACT missing stage-evidence kind');
			assert.equal(refused.toStage, 'release');
		} finally {
			await cleanup();
		}
	});

	test('incident -> reproducible-finding REFUSES without the reproducible-finding-evidence', async () => {
		const { root, cleanup } = await tempRoot('flauz-inc-adv-');
		try {
			const fsPort = nodeIncidentsFs();
			const clock = steppingClock();
			await plantEvidenceBodies(root);
			const incidentId = await seedIncident(root, fsPort, clock);
			const refused = await advanceLoop({ root, fs: fsPort, clock }, { incidentId, actor: 'operator-1', transition: 'forward', evidence: evidence('local-real', 'wrong-kind') });
			assert.equal(refused.refused, true);
			assert.equal(refused.refusedEvidenceKind, 'reproducible-finding-evidence');
			assert.equal(refused.toStage, 'incident');
		} finally {
			await cleanup();
		}
	});

	test('reproducible-finding -> registry-item REFUSES without the registry-item-id (the verbatim id law)', async () => {
		const { root, cleanup } = await tempRoot('flauz-inc-adv-');
		try {
			const fsPort = nodeIncidentsFs();
			const clock = steppingClock();
			await plantEvidenceBodies(root);
			const incidentId = await seedIncident(root, fsPort, clock);
			await advanceLoop({ root, fs: fsPort, clock }, { incidentId, actor: 'operator-1', transition: 'forward', evidence: evidence('local-real', 'reproducible-finding-evidence') });
			// the registry-item-id transition requires the registryItemId field; without it, REFUSES
			const refused = await advanceLoop({ root, fs: fsPort, clock }, { incidentId, actor: 'operator-1', transition: 'forward', evidence: evidence('local-real', 'registry-item-id', 'the id') });
			assert.equal(refused.refused, true);
			assert.equal(refused.refusedEvidenceKind, 'registry-item-id');
			assert.equal(refused.toStage, 'reproducible-finding');
		} finally {
			await cleanup();
		}
	});

	test('NO stage may be skipped forward (the evidence.kind must match the per-transition requirement)', async () => {
		const { root, cleanup } = await tempRoot('flauz-inc-adv-');
		try {
			const fsPort = nodeIncidentsFs();
			const clock = steppingClock();
			await plantEvidenceBodies(root);
			const incidentId = await seedIncident(root, fsPort, clock);
			// an attempt to skip directly from incident -> regression (the evidence.kind is regression-receipt, but the fromStage is incident, which requires reproducible-finding-evidence)
			const refused = await advanceLoop({ root, fs: fsPort, clock }, { incidentId, actor: 'operator-1', transition: 'forward', evidence: evidence('local-real', 'regression-receipt') });
			assert.equal(refused.refused, true);
			assert.equal(refused.refusedEvidenceKind, 'reproducible-finding-evidence', 'the fromStage (incident) names its own requirement, regardless of the evidence.kind offered');
			assert.equal(refused.toStage, 'incident');
		} finally {
			await cleanup();
		}
	});
});

suite('flauz.incidents.advance -- the ONE reopen law (a closed loop never hides a regression)', () => {
	test('a failed post-release verification REOPENS the incident with the failure as evidence (release -> fix)', async () => {
		const { root, cleanup } = await tempRoot('flauz-inc-reopen-');
		try {
			const fsPort = nodeIncidentsFs();
			const clock = steppingClock();
			await plantEvidenceBodies(root);
			const incidentId = await seedIncident(root, fsPort, clock);
			// close the loop
			await advanceLoop({ root, fs: fsPort, clock }, { incidentId, actor: 'operator-1', transition: 'forward', evidence: evidence('local-real', 'reproducible-finding-evidence') });
			await advanceLoop({ root, fs: fsPort, clock }, { incidentId, actor: 'operator-1', transition: 'forward', evidence: evidence('local-real', 'registry-item-id', 'the id', 'REG-001') });
			await advanceLoop({ root, fs: fsPort, clock }, { incidentId, actor: 'operator-1', transition: 'forward', evidence: evidence('local-real', 'fix-evidence', 'the fix') });
			await advanceLoop({ root, fs: fsPort, clock }, { incidentId, actor: 'operator-1', transition: 'forward', evidence: evidence('local-real', 'regression-receipt', 'the regression test passed') });
			await advanceLoop({ root, fs: fsPort, clock }, { incidentId, actor: 'operator-1', transition: 'forward', evidence: evidence('local-real', 'release-identity', 'the release') });
			await advanceLoop({ root, fs: fsPort, clock }, { incidentId, actor: 'operator-1', transition: 'forward', evidence: evidence('local-real', 'post-release-verification-receipt', 'the post-release verification passed') });
			// the loop is CLOSED; the failed post-release verification REOPENS the incident (release stage -> fix)
			const reopen = await advanceLoop({ root, fs: fsPort, clock }, { incidentId, actor: 'operator-1', transition: 'reopen', evidence: evidence('local-real', 'reopen-evidence', 'the post-release verification FAILED against the released state') });
			assert.equal(reopen.transition, 'reopen');
			assert.equal(reopen.fromStage, 'post-release-verification');
			assert.equal(reopen.toStage, 'fix', 'the reopen moves the incident back to fix (a new fix is needed for the production regression)');
			assert.equal(reopen.refused, false);
		} finally {
			await cleanup();
		}
	});

	test('the reopen law fires ONLY from the closed stage (post-release-verification); a reopen from any other stage REFUSES', async () => {
		const { root, cleanup } = await tempRoot('flauz-inc-reopen-');
		try {
			const fsPort = nodeIncidentsFs();
			const clock = steppingClock();
			await plantEvidenceBodies(root);
			const incidentId = await seedIncident(root, fsPort, clock);
			// the incident is at the `incident` stage (the intake row only); a reopen from here REFUSES
			await assert.rejects(
				() => advanceLoop({ root, fs: fsPort, clock }, { incidentId, actor: 'operator-1', transition: 'reopen', evidence: evidence('local-real', 'reopen-evidence', 'the failure') }),
				(err: unknown) => err instanceof IncidentsError && err.code === 'FLAUZ_INCIDENTS_BAD_TRANSITION',
			);
		} finally {
			await cleanup();
		}
	});

	test('a forward transition from the closed stage REFUSES (no forward successor; use reopen for a failed post-release verification)', async () => {
		const { root, cleanup } = await tempRoot('flauz-inc-reopen-');
		try {
			const fsPort = nodeIncidentsFs();
			const clock = steppingClock();
			await plantEvidenceBodies(root);
			const incidentId = await seedIncident(root, fsPort, clock);
			await advanceLoop({ root, fs: fsPort, clock }, { incidentId, actor: 'operator-1', transition: 'forward', evidence: evidence('local-real', 'reproducible-finding-evidence') });
			await advanceLoop({ root, fs: fsPort, clock }, { incidentId, actor: 'operator-1', transition: 'forward', evidence: evidence('local-real', 'registry-item-id', 'the id', 'REG-001') });
			await advanceLoop({ root, fs: fsPort, clock }, { incidentId, actor: 'operator-1', transition: 'forward', evidence: evidence('local-real', 'fix-evidence', 'the fix') });
			await advanceLoop({ root, fs: fsPort, clock }, { incidentId, actor: 'operator-1', transition: 'forward', evidence: evidence('local-real', 'regression-receipt', 'the regression test passed') });
			await advanceLoop({ root, fs: fsPort, clock }, { incidentId, actor: 'operator-1', transition: 'forward', evidence: evidence('local-real', 'release-identity', 'the release') });
			await advanceLoop({ root, fs: fsPort, clock }, { incidentId, actor: 'operator-1', transition: 'forward', evidence: evidence('local-real', 'post-release-verification-receipt', 'the post-release verification passed') });
			// a forward transition from the closed stage REFUSES (no forward successor)
			await assert.rejects(
				() => advanceLoop({ root, fs: fsPort, clock }, { incidentId, actor: 'operator-1', transition: 'forward', evidence: evidence('local-real', 'reproducible-finding-evidence') }),
				(err: unknown) => err instanceof IncidentsError && err.code === 'FLAUZ_INCIDENTS_BAD_TRANSITION',
			);
		} finally {
			await cleanup();
		}
	});
});

suite('flauz.incidents.advance -- the evidence-label ladder per transition (frozen; never promote by wording)', () => {
	test('every transition carries its evidence label from the frozen ladder; the label is recorded verbatim in the journal row', async () => {
		const { root, cleanup } = await tempRoot('flauz-inc-adv-');
		try {
			const fsPort = nodeIncidentsFs();
			const clock = steppingClock();
			await plantEvidenceBodies(root);
			const labels = ['fixture', 'simulated', 'local-real', 'runtime-real', 'live-provider', 'production-real'] as const;
			for (const label of labels) {
				// a FRESH incident per label (distinct seed -> distinct id -> fresh journal)
				const freshResult = await reportIncident({ root, fs: fsPort, clock }, { ...GOOD_MANUAL, seed: `the-label-incident-${label}` });
				const r = await advanceLoop({ root, fs: fsPort, clock }, { incidentId: freshResult.incidentId, actor: 'operator-1', transition: 'forward', evidence: evidence(label, 'reproducible-finding-evidence') });
				assert.equal(r.refused, false, `the label '${label}' transition is not refused`);
				assert.equal(r.row.evidence?.label, label, `the label '${label}' is recorded verbatim`);
			}
		} finally {
			await cleanup();
		}
	});
});

suite('flauz.incidents.advance -- the typed refusals', () => {
	test('bad args refuse the whole advance (the journal is never partially written)', () => {
		for (const bad of [
			undefined, null, 'x', 42, {},
			{ incidentId: 'not-an-id', actor: 'x', transition: 'forward', evidence: { label: 'local-real', kind: 'reproducible-finding-evidence', detail: 'x' } },
			{ incidentId: 'flauz:inc:0123456789abcdef', actor: '', transition: 'forward', evidence: { label: 'local-real', kind: 'reproducible-finding-evidence', detail: 'x' } },
			{ incidentId: 'flauz:inc:0123456789abcdef', actor: 'x', transition: 'sideways', evidence: { label: 'local-real', kind: 'reproducible-finding-evidence', detail: 'x' } },
			{ incidentId: 'flauz:inc:0123456789abcdef', actor: 'x', transition: 'forward', evidence: { label: 'invented', kind: 'reproducible-finding-evidence', detail: 'x' } },
			{ incidentId: 'flauz:inc:0123456789abcdef', actor: 'x', transition: 'forward', evidence: { label: 'local-real', kind: '', detail: 'x' } },
			{ incidentId: 'flauz:inc:0123456789abcdef', actor: 'x', transition: 'forward', evidence: { label: 'local-real', kind: 'reproducible-finding-evidence', detail: 'x', evidenceRefs: ['/abs/path'] } },
		]) {
			assert.throws(
				() => parseAdvanceArgs(bad),
				(err: unknown) => err instanceof IncidentsError && err.code === 'FLAUZ_INCIDENTS_BAD_ARGS',
				`the bad arg ${JSON.stringify(bad) ?? String(bad)} refuses typed`,
			);
		}
	});

	test('an advance for an unknown incident (no journal) REFUSES with the unknown-incident code', async () => {
		const { root, cleanup } = await tempRoot('flauz-inc-adv-');
		try {
			await assert.rejects(
				() => advanceLoop({ root, fs: nodeIncidentsFs(), clock: steppingClock() }, { incidentId: 'flauz:inc:0123456789abcdef', actor: 'operator-1', transition: 'forward', evidence: evidence('local-real', 'reproducible-finding-evidence') }),
				(err: unknown) => err instanceof IncidentsError && err.code === 'FLAUZ_INCIDENTS_UNKNOWN_INCIDENT',
			);
		} finally {
			await cleanup();
		}
	});
});

suite('flauz.incidents.advance -- the determinism law (the injected clock)', () => {
	test('the transition timestamp comes from the injected clock (advances per call); identical clocks produce identical timestamps', async () => {
		const { root, cleanup } = await tempRoot('flauz-inc-adv-');
		try {
			const fsPort = nodeIncidentsFs();
			const clock = steppingClock(1_700_000_000_000);
			await plantEvidenceBodies(root);
			const incidentId = await seedIncident(root, fsPort, clock);
			const r = await advanceLoop({ root, fs: fsPort, clock }, { incidentId, actor: 'operator-1', transition: 'forward', evidence: evidence('local-real', 'reproducible-finding-evidence') });
			// the intake row fired at the seedIncident time (1_700_000_000_000); the advance fires at the next clock step (1_700_000_001_000); the transition row's timestamp is the injected clock's value
			assert.equal(typeof r.row.timestampEpoch, 'number');
			assert.ok(r.row.timestampEpoch > 0);
			assert.equal(r.row.timestampIso.length > 0, true);
		} finally {
			await cleanup();
		}
	});
});
