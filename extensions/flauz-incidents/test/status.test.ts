/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The status semantics (A-PROD-006-W1): the ledger verdict.
 *
 *   - the verdict table over every incident (per-incident loop stage,
 *     source-binding state resolved | disclosed-unresolvable | manual-disclosed,
 *     closure readiness -- the exact list of missing stage-evidence kinds,
 *     typed, and the loop verdict closed | open | reopened | refused-evidence);
 *   - the three source-binding states;
 *   - the verdict law (closed on post-release verification evidence; open
 *     mid-progress; reopened by a failed post-release verification;
 *     refused-evidence on a missing-evidence refusal);
 *   - the honest-scope disclosure (machinery COMPLETE, production usage EMPTY
 *     by design -- the launch has not happened);
 *   - the torn-ledger honesty (a torn ledger persists the honest typed
 *     record, never a guessed summary).
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { runStatus, loopVerdictOf, closureReadinessOf, registryItemIdOf, BOUNDARY_DISCLOSURE } from '../src/status.ts';
import { currentLoopStage } from '../src/loop.ts';
import { reportIncident, INCIDENTS_LEDGER_PATH } from '../src/incidents.ts';
import { advanceLoop } from '../src/loop.ts';
import { nodeIncidentsFs, steppingClock, tempRoot, plantEvidenceBodies, plantTelemetryFailureCensus, plantDurabilityHeartbeat, plantDogfoodFrictionLog, plantIncidentsLedger, plantLoopJournal, journalRowBody } from './helpers.ts';
import { LOOP_STAGES, type LoopJournalRow } from '../src/api.ts';

const GOOD_MANUAL = {
	seed: 'the-status-incident',
	class: 'provider-outage',
	severity: 'sev2' as const,
	affectedSurface: 'flauz-models',
	reproNote: 'restart the provider lane and re-issue the request',
	evidenceRefs: ['.flauz/evidence/ledger.jsonl'],
	sourceBinding: { kind: 'manual' as const },
	actor: 'operator-1',
};

function evidence(label: 'local-real', kind: string, detail = 'the evidence detail', registryItemId?: string) {
	const ev: { label: typeof label; kind: string; detail: string; registryItemId?: string } = { label, kind, detail };
	if (registryItemId !== undefined) {
		ev.registryItemId = registryItemId;
	}
	return ev;
}

/** Drives one incident through the full forward lattice to closure. */
async function closeIncident(root: string, fsPort: ReturnType<typeof nodeIncidentsFs>, clock: ReturnType<typeof steppingClock>, incidentId: string, registryItemId = 'A-PROD-006-W1-REG-001'): Promise<void> {
	await advanceLoop({ root, fs: fsPort, clock }, { incidentId, actor: 'operator-1', transition: 'forward', evidence: evidence('local-real', 'reproducible-finding-evidence') });
	await advanceLoop({ root, fs: fsPort, clock }, { incidentId, actor: 'operator-1', transition: 'forward', evidence: evidence('local-real', 'registry-item-id', 'the id', registryItemId) });
	await advanceLoop({ root, fs: fsPort, clock }, { incidentId, actor: 'operator-1', transition: 'forward', evidence: evidence('local-real', 'fix-evidence', 'the fix') });
	await advanceLoop({ root, fs: fsPort, clock }, { incidentId, actor: 'operator-1', transition: 'forward', evidence: evidence('local-real', 'regression-receipt', 'the regression test passed') });
	await advanceLoop({ root, fs: fsPort, clock }, { incidentId, actor: 'operator-1', transition: 'forward', evidence: evidence('local-real', 'release-identity', 'the release record pointer') });
	await advanceLoop({ root, fs: fsPort, clock }, { incidentId, actor: 'operator-1', transition: 'forward', evidence: evidence('local-real', 'post-release-verification-receipt', 'the post-release verification passed') });
}

suite('flauz.incidents.status -- the verdict table over seeded workspace records', () => {
	test('an absent ledger persists the honest typed record (zero incidents, never a guessed summary)', async () => {
		const { root, cleanup } = await tempRoot('flauz-inc-st-');
		try {
			await plantEvidenceBodies(root);
			const result = await runStatus({ root, fs: nodeIncidentsFs(), clock: steppingClock() });
			assert.equal(result.ok, true);
			assert.equal(result.record.ledgerState, 'absent');
			assert.equal(result.record.incidents.length, 0, 'an absent ledger carries zero incidents');
			assert.equal(result.record.counts.incidents, 0);
		} finally {
			await cleanup();
		}
	});

	test('one incident, open verdict, manual-disclosed source binding, closure readiness names the next forward transition\'s requirement', async () => {
		const { root, cleanup } = await tempRoot('flauz-inc-st-');
		try {
			const fsPort = nodeIncidentsFs();
			const clock = steppingClock();
			await plantEvidenceBodies(root);
			const reportResult = await reportIncident({ root, fs: fsPort, clock }, GOOD_MANUAL);
			const result = await runStatus({ root, fs: fsPort, clock });
			assert.equal(result.record.incidents.length, 1);
			const row = result.record.incidents[0];
			assert.equal(row?.incidentId, reportResult.incidentId);
			assert.equal(row?.loopStage, 'incident');
			assert.equal(row?.sourceBindingKind, 'manual');
			assert.equal(row?.sourceBindingState, 'manual-disclosed');
			assert.equal(row?.verdict, 'open');
			assert.deepEqual([...row?.missingEvidence ?? []], ['reproducible-finding-evidence'], 'the closure readiness names the next forward transition\'s requirement');
			assert.equal(row?.registryItemId, undefined, 'no registry-item id yet (the incident is at the incident stage)');
		} finally {
			await cleanup();
		}
	});

	test('a closed incident: post-release-verification stage, closed verdict, empty closure readiness', async () => {
		const { root, cleanup } = await tempRoot('flauz-inc-st-');
		try {
			const fsPort = nodeIncidentsFs();
			const clock = steppingClock();
			await plantEvidenceBodies(root);
			const reportResult = await reportIncident({ root, fs: fsPort, clock }, GOOD_MANUAL);
			await closeIncident(root, fsPort, clock, reportResult.incidentId);
			const result = await runStatus({ root, fs: fsPort, clock });
			const row = result.record.incidents[0];
			assert.equal(row?.loopStage, 'post-release-verification');
			assert.equal(row?.verdict, 'closed');
			assert.deepEqual([...row?.missingEvidence ?? []], [], 'a closed loop has nothing missing');
			assert.equal(row?.registryItemId, 'A-PROD-006-W1-REG-001', 'the registry-item id is carried VERBATIM at the registry-item stage (the two-registry separation)');
		} finally {
			await cleanup();
		}
	});

	test('a reopened incident: reopened verdict after a failed post-release verification', async () => {
		const { root, cleanup } = await tempRoot('flauz-inc-st-');
		try {
			const fsPort = nodeIncidentsFs();
			const clock = steppingClock();
			await plantEvidenceBodies(root);
			const reportResult = await reportIncident({ root, fs: fsPort, clock }, GOOD_MANUAL);
			await closeIncident(root, fsPort, clock, reportResult.incidentId);
			// reopen
			await advanceLoop({ root, fs: fsPort, clock }, { incidentId: reportResult.incidentId, actor: 'operator-1', transition: 'reopen', evidence: evidence('local-real', 'reopen-evidence', 'the post-release verification FAILED') });
			const result = await runStatus({ root, fs: fsPort, clock });
			const row = result.record.incidents[0];
			assert.equal(row?.verdict, 'reopened');
			assert.equal(row?.loopStage, 'fix', 'the reopen moves the incident back to fix');
		} finally {
			await cleanup();
		}
	});

	test('a refused-evidence incident: refused-evidence verdict, the exact missing stage-evidence kind in the closure readiness', async () => {
		const { root, cleanup } = await tempRoot('flauz-inc-st-');
		try {
			const fsPort = nodeIncidentsFs();
			const clock = steppingClock();
			await plantEvidenceBodies(root);
			const reportResult = await reportIncident({ root, fs: fsPort, clock }, GOOD_MANUAL);
			// a refusal: the incident -> reproducible-finding transition with the wrong evidence kind
			await advanceLoop({ root, fs: fsPort, clock }, { incidentId: reportResult.incidentId, actor: 'operator-1', transition: 'forward', evidence: evidence('local-real', 'wrong-kind') });
			const result = await runStatus({ root, fs: fsPort, clock });
			const row = result.record.incidents[0];
			assert.equal(row?.verdict, 'refused-evidence');
			assert.equal(row?.loopStage, 'incident', 'the incident stays at the refused stage');
			assert.deepEqual([...row?.missingEvidence ?? []], ['reproducible-finding-evidence'], 'the closure readiness names the exact missing stage-evidence kind');
		} finally {
			await cleanup();
		}
	});
});

suite('flauz.incidents.status -- the three source-binding states (resolved | disclosed-unresolvable | manual-disclosed)', () => {
	test('a manual binding -- manual-disclosed', async () => {
		const { root, cleanup } = await tempRoot('flauz-inc-st-');
		try {
			const fsPort = nodeIncidentsFs();
			const clock = steppingClock();
			await plantEvidenceBodies(root);
			await reportIncident({ root, fs: fsPort, clock }, GOOD_MANUAL);
			const result = await runStatus({ root, fs: fsPort, clock });
			assert.equal(result.record.incidents[0]?.sourceBindingState, 'manual-disclosed');
			assert.equal(result.record.counts.manualDisclosed, 1);
			assert.equal(result.record.counts.resolved, 0);
			assert.equal(result.record.counts.disclosedUnresolvable, 0);
		} finally {
			await cleanup();
		}
	});

	test('a resolved telemetry-census binding -- resolved', async () => {
		const { root, cleanup } = await tempRoot('flauz-inc-st-');
		try {
			const fsPort = nodeIncidentsFs();
			const clock = steppingClock();
			await plantEvidenceBodies(root);
			const censusPath = await plantTelemetryFailureCensus(root, 'provider-unreachable', 3);
			await reportIncident({ root, fs: fsPort, clock }, { ...GOOD_MANUAL, seed: 'the-telemetry-incident', sourceBinding: { kind: 'telemetry-census', failureClass: 'provider-unreachable', censusPath } });
			const result = await runStatus({ root, fs: fsPort, clock });
			assert.equal(result.record.incidents[0]?.sourceBindingState, 'resolved');
			assert.equal(result.record.incidents[0]?.sourceBindingKind, 'telemetry-census');
			assert.equal(result.record.counts.resolved, 1);
		} finally {
			await cleanup();
		}
	});

	test('a disclosed-unresolvable durability-escalation binding (absent heartbeat) -- disclosed-unresolvable', async () => {
		const { root, cleanup } = await tempRoot('flauz-inc-st-');
		try {
			const fsPort = nodeIncidentsFs();
			const clock = steppingClock();
			await plantEvidenceBodies(root);
			await reportIncident({ root, fs: fsPort, clock }, { ...GOOD_MANUAL, seed: 'the-durability-incident', sourceBinding: { kind: 'durability-escalation', laneId: 'lane-alpha', heartbeatPath: '.flauz/durability/heartbeat-absent.json', policy: 'notify' } });
			const result = await runStatus({ root, fs: fsPort, clock });
			assert.equal(result.record.incidents[0]?.sourceBindingState, 'disclosed-unresolvable');
			assert.equal(result.record.incidents[0]?.sourceBindingKind, 'durability-escalation');
			assert.equal(result.record.counts.disclosedUnresolvable, 1);
		} finally {
			await cleanup();
		}
	});

	test('a resolved dogfood-friction binding -- resolved', async () => {
		const { root, cleanup } = await tempRoot('flauz-inc-st-');
		try {
			const fsPort = nodeIncidentsFs();
			const clock = steppingClock();
			await plantEvidenceBodies(root);
			const frictionLogPath = await plantDogfoodFrictionLog(root, 'failed-task', 'build');
			await reportIncident({ root, fs: fsPort, clock }, { ...GOOD_MANUAL, seed: 'the-dogfood-incident', sourceBinding: { kind: 'dogfood-friction', frictionKind: 'failed-task', phase: 'build', frictionLogPath } });
			const result = await runStatus({ root, fs: fsPort, clock });
			assert.equal(result.record.incidents[0]?.sourceBindingState, 'resolved');
			assert.equal(result.record.incidents[0]?.sourceBindingKind, 'dogfood-friction');
		} finally {
			await cleanup();
		}
	});
});

suite('flauz.incidents.status -- the verdict law (closed | open | reopened | refused-evidence)', () => {
	test('the verdict is derived from the loop journal\'s last transition row + the current stage', () => {
		// closed: the last row is a close transition to post-release-verification
		assert.equal(loopVerdictOf([{ $schema: 'flauz.incidents-loop/v1', schemaVersion: 0, kind: 'flauz-incidents-loop', extensionId: 'flauz.flauz-incidents', incidentId: 'flauz:inc:0', seq: 7, timestampEpoch: 1, timestampIso: 'x', actor: 'a', transition: 'close', fromStage: 'release', toStage: 'post-release-verification', evidence: { label: 'local-real', kind: 'post-release-verification-receipt', detail: 'x' } }]), 'closed');
		// reopened: the last row is a reopen transition
		assert.equal(loopVerdictOf([{ $schema: 'flauz.incidents-loop/v1', schemaVersion: 0, kind: 'flauz-incidents-loop', extensionId: 'flauz.flauz-incidents', incidentId: 'flauz:inc:0', seq: 8, timestampEpoch: 1, timestampIso: 'x', actor: 'a', transition: 'reopen', fromStage: 'post-release-verification', toStage: 'fix', evidence: { label: 'local-real', kind: 'reopen-evidence', detail: 'x' } }]), 'reopened');
		// refused-evidence: the last row is a refusal
		assert.equal(loopVerdictOf([{ $schema: 'flauz.incidents-loop/v1', schemaVersion: 0, kind: 'flauz-incidents-loop', extensionId: 'flauz.flauz-incidents', incidentId: 'flauz:inc:0', seq: 2, timestampEpoch: 1, timestampIso: 'x', actor: 'a', transition: 'refusal', fromStage: 'incident', toStage: 'incident', evidence: { label: 'local-real', kind: 'wrong', detail: 'x' }, refusedEvidenceKind: 'reproducible-finding-evidence' }]), 'refused-evidence');
		// open: any other (a forward transition mid-progress)
		assert.equal(loopVerdictOf([{ $schema: 'flauz.incidents-loop/v1', schemaVersion: 0, kind: 'flauz-incidents-loop', extensionId: 'flauz.flauz-incidents', incidentId: 'flauz:inc:0', seq: 2, timestampEpoch: 1, timestampIso: 'x', actor: 'a', transition: 'forward', fromStage: 'incident', toStage: 'reproducible-finding', evidence: { label: 'local-real', kind: 'reproducible-finding-evidence', detail: 'x' } }]), 'open');
		// open: an empty journal (no transitions)
		assert.equal(loopVerdictOf([]), 'open');
	});

	test('the closure readiness is empty at the closed stage; names the next requirement mid-progress; names the refusal\'s missing kind when refused', () => {
		assert.deepEqual([...closureReadinessOf([], 'post-release-verification')], [], 'closed stage: nothing missing');
		assert.deepEqual([...closureReadinessOf([], 'incident')], ['reproducible-finding-evidence']);
		assert.deepEqual([...closureReadinessOf([], 'fix')], ['regression-receipt']);
		assert.deepEqual([...closureReadinessOf([{ $schema: 'flauz.incidents-loop/v1', schemaVersion: 0, kind: 'flauz-incidents-loop', extensionId: 'flauz.flauz-incidents', incidentId: 'flauz:inc:0', seq: 2, timestampEpoch: 1, timestampIso: 'x', actor: 'a', transition: 'refusal', fromStage: 'incident', toStage: 'incident', evidence: { label: 'local-real', kind: 'wrong', detail: 'x' }, refusedEvidenceKind: 'reproducible-finding-evidence' }], 'incident')], ['reproducible-finding-evidence'], 'the refusal\'s missing kind surfaces in the closure readiness');
	});

	test('the registry-item id is read VERBATIM from the registry-item transition row', () => {
		const rows: readonly LoopJournalRow[] = [
			{ $schema: 'flauz.incidents-loop/v1', schemaVersion: 0, kind: 'flauz-incidents-loop', extensionId: 'flauz.flauz-incidents', incidentId: 'flauz:inc:0', seq: 1, timestampEpoch: 1, timestampIso: 'x', actor: 'a', transition: 'forward', toStage: 'incident' },
			{ $schema: 'flauz.incidents-loop/v1', schemaVersion: 0, kind: 'flauz-incidents-loop', extensionId: 'flauz.flauz-incidents', incidentId: 'flauz:inc:0', seq: 2, timestampEpoch: 2, timestampIso: 'x', actor: 'a', transition: 'forward', fromStage: 'incident', toStage: 'reproducible-finding', evidence: { label: 'local-real', kind: 'reproducible-finding-evidence', detail: 'x' } },
			{ $schema: 'flauz.incidents-loop/v1', schemaVersion: 0, kind: 'flauz-incidents-loop', extensionId: 'flauz.flauz-incidents', incidentId: 'flauz:inc:0', seq: 3, timestampEpoch: 3, timestampIso: 'x', actor: 'a', transition: 'forward', fromStage: 'reproducible-finding', toStage: 'registry-item', evidence: { label: 'local-real', kind: 'registry-item-id', detail: 'x', registryItemId: 'A-PROD-006-W1-REG-042' } },
		];
		assert.equal(registryItemIdOf(rows), 'A-PROD-006-W1-REG-042', 'the registry-item id is carried VERBATIM');
		assert.equal(registryItemIdOf([rows[0] as LoopJournalRow]), undefined, 'no registry-item id before the registry-item transition');
	});
});

suite('flauz.incidents.status -- the honest-scope disclosure + the torn-ledger honesty', () => {
	test('the honest-scope disclosure is carried verbatim in every status record (machinery COMPLETE, production usage EMPTY by design)', async () => {
		const { root, cleanup } = await tempRoot('flauz-inc-st-');
		try {
			await plantEvidenceBodies(root);
			const result = await runStatus({ root, fs: nodeIncidentsFs(), clock: steppingClock() });
			assert.equal(result.record.boundaryDisclosure, BOUNDARY_DISCLOSURE);
			assert.ok(result.record.boundaryDisclosure.includes('MACHINERY'));
			assert.ok(result.record.boundaryDisclosure.includes('EMPTY'));
		} finally {
			await cleanup();
		}
	});

	test('a torn ledger persists the honest typed record (the ledgerState is torn + the reason; zero incidents -- never a guessed summary)', async () => {
		const { root, cleanup } = await tempRoot('flauz-inc-st-');
		try {
			await plantEvidenceBodies(root);
			// write a torn incidents.json (not the flauz.incidents/v1 shape)
			await fs.mkdir(path.join(root, '.flauz', 'incidents'), { recursive: true });
			await fs.writeFile(path.join(root, INCIDENTS_LEDGER_PATH), '{not valid json', 'utf-8');
			const result = await runStatus({ root, fs: nodeIncidentsFs(), clock: steppingClock() });
			assert.equal(result.record.ledgerState, 'torn');
			assert.ok(result.record.tornReason !== undefined);
			assert.equal(result.record.incidents.length, 0, 'a torn ledger carries zero incidents (the honest typed degradation, never a guessed summary)');
		} finally {
			await cleanup();
		}
	});
});

suite('flauz.incidents.status -- the seeded-workspace verdicts (the contract-suite helpers)', () => {
	test('the seeded incident ledger + a seeded loop journal produce the expected verdict', async () => {
		const { root, cleanup } = await tempRoot('flauz-inc-st-seed-');
		try {
			await plantEvidenceBodies(root);
			const incidentId = 'flauz:inc:0123456789abcdef';
			await plantIncidentsLedger(root, incidentId, { class: 'provider-outage', severity: 'sev2', affectedSurface: 'flauz-models', reproNote: 'the repro note', evidenceRefs: ['.flauz/evidence/ledger.jsonl'], sourceBinding: { kind: 'manual', resolved: true, disclosed: 'manual-disclosed' } });
			await plantLoopJournal(root, incidentId, [
				journalRowBody(1, 1_740_100_000_000, 'operator-1', 'forward', 'incident'),
			]);
			const result = await runStatus({ root, fs: nodeIncidentsFs(), clock: steppingClock() });
			assert.equal(result.record.incidents.length, 1);
			const row = result.record.incidents[0];
			assert.equal(row?.incidentId, incidentId);
			assert.equal(row?.loopStage, 'incident');
			assert.equal(row?.verdict, 'open');
			assert.equal(row?.sourceBindingState, 'manual-disclosed');
		} finally {
			await cleanup();
		}
	});

	test('a seeded closed loop journal produces the closed verdict', async () => {
		const { root, cleanup } = await tempRoot('flauz-inc-st-seed-');
		try {
			await plantEvidenceBodies(root);
			const incidentId = 'flauz:inc:0123456789abcdef';
			await plantIncidentsLedger(root, incidentId, { class: 'x', severity: 'sev1', affectedSurface: 'flauz-models', reproNote: 'n', evidenceRefs: [], sourceBinding: { kind: 'manual', resolved: true, disclosed: 'manual-disclosed' } });
			const stages: readonly string[] = LOOP_STAGES;
			const rows: Record<string, unknown>[] = [];
			let seq = 1;
			let from: string | undefined;
			for (let i = 0; i < stages.length; i++) {
				const to = stages[i] as string;
				const transition = i === stages.length - 1 ? 'close' : 'forward';
				rows.push(journalRowBody(seq, 1_740_100_000_000 + seq * 1000, 'operator-1', transition as 'forward' | 'close', to, from, { label: 'local-real', kind: i === 0 ? 'intake' : 'evidence', detail: 'x' }));
				from = to;
				seq++;
			}
			await plantLoopJournal(root, incidentId, rows);
			const result = await runStatus({ root, fs: nodeIncidentsFs(), clock: steppingClock() });
			const row = result.record.incidents[0];
			assert.equal(row?.verdict, 'closed');
			assert.equal(row?.loopStage, 'post-release-verification');
		} finally {
			await cleanup();
		}
	});
});
