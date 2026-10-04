/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The report semantics (A-PROD-006-W1): the typed incident intake.
 *
 *   - the source-binding typing (manual | telemetry-census |
 *     durability-escalation | dogfood-friction -- the four sources);
 *   - the unresolvable-binding disclosure (a binding that cannot resolve is
 *     a TYPED DISCLOSURE record, never a dropped row and never a
 *     fabricated/inferred incident);
 *   - the unique-id law (re-reporting an id appends a NEW revision, never
 *     duplicates);
 *   - the revision-append law (the revision number is 1, 2, 3... in order);
 *   - the evidence-ref scoping law (paths under .flauz/ only);
 *   - the privacy canary (a secret-shaped repro note refuses the whole
 *     report; the banked census row carries the sha256 of the artifact,
 *     never the repro note text -- the canary proves repro notes never reach
 *     banked census rows);
 *   - the determinism law (identical seeds produce identical ids; identical
 *     inputs through the injected clock produce byte-identical ledgers).
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { IncidentsError, INCIDENTS_TASK_ID } from '../src/api.ts';
import { parseReportArgs, reportIncident, INCIDENTS_LEDGER_PATH } from '../src/incidents.ts';
import { nodeIncidentsFs, steppingClock, tempRoot, plantEvidenceBodies, plantTelemetryFailureCensus, plantDurabilityHeartbeat, plantDogfoodFrictionLog } from './helpers.ts';

const GOOD_MANUAL = {
	seed: 'the-alpha-incident',
	class: 'provider-outage',
	severity: 'sev2' as const,
	affectedSurface: 'flauz-models',
	reproNote: 'restart the provider lane and re-issue the request',
	evidenceRefs: ['.flauz/evidence/ledger.jsonl'],
	sourceBinding: { kind: 'manual' as const },
	actor: 'operator-1',
};

suite('flauz.incidents.report -- the source-binding typing (the four sources)', () => {
	test('a manual binding reports the incident, disclosed as manual-disclosed', async () => {
		const { root, cleanup } = await tempRoot('flauz-inc-rep-');
		try {
			const result = await reportIncident({ root, fs: nodeIncidentsFs(), clock: steppingClock() }, GOOD_MANUAL);
			assert.equal(result.ok, true);
			assert.equal(result.revised, false);
			assert.equal(result.sourceBindingState, 'manual-disclosed');
			assert.equal(result.revision, 1);
		} finally {
			await cleanup();
		}
	});

	test('a telemetry-census binding resolves when the census carries the failure class', async () => {
		const { root, cleanup } = await tempRoot('flauz-inc-rep-');
		try {
			await plantEvidenceBodies(root);
			const censusPath = await plantTelemetryFailureCensus(root, 'provider-unreachable', 3);
			const result = await reportIncident({ root, fs: nodeIncidentsFs(), clock: steppingClock() }, {
				...GOOD_MANUAL,
				seed: 'the-telemetry-incident',
				sourceBinding: { kind: 'telemetry-census', failureClass: 'provider-unreachable', censusPath },
			});
			assert.equal(result.sourceBindingState, 'resolved');
		} finally {
			await cleanup();
		}
	});

	test('a durability-escalation binding resolves when the heartbeat carries the escalation policy', async () => {
		const { root, cleanup } = await tempRoot('flauz-inc-rep-');
		try {
			await plantEvidenceBodies(root);
			const heartbeatPath = await plantDurabilityHeartbeat(root, 'lane-alpha', 'checkpoint-and-restart');
			const result = await reportIncident({ root, fs: nodeIncidentsFs(), clock: steppingClock() }, {
				...GOOD_MANUAL,
				seed: 'the-durability-incident',
				sourceBinding: { kind: 'durability-escalation', laneId: 'lane-alpha', heartbeatPath, policy: 'checkpoint-and-restart' },
			});
			assert.equal(result.sourceBindingState, 'resolved');
		} finally {
			await cleanup();
		}
	});

	test('a dogfood-friction binding resolves when the friction log carries the friction row', async () => {
		const { root, cleanup } = await tempRoot('flauz-inc-rep-');
		try {
			await plantEvidenceBodies(root);
			const frictionLogPath = await plantDogfoodFrictionLog(root, 'failed-task', 'build');
			const result = await reportIncident({ root, fs: nodeIncidentsFs(), clock: steppingClock() }, {
				...GOOD_MANUAL,
				seed: 'the-dogfood-incident',
				sourceBinding: { kind: 'dogfood-friction', frictionKind: 'failed-task', phase: 'build', frictionLogPath },
			});
			assert.equal(result.sourceBindingState, 'resolved');
		} finally {
			await cleanup();
		}
	});
});

suite('flauz.incidents.report -- the unresolvable-binding disclosure (typed, never dropped, never fabricated)', () => {
	test('a telemetry-census binding with an absent census record is disclosed as disclosed-unresolvable (the incident is still recorded)', async () => {
		const { root, cleanup } = await tempRoot('flauz-inc-rep-');
		try {
			const result = await reportIncident({ root, fs: nodeIncidentsFs(), clock: steppingClock() }, {
				...GOOD_MANUAL,
				seed: 'the-absent-census-incident',
				sourceBinding: { kind: 'telemetry-census', failureClass: 'provider-unreachable', censusPath: '.flauz/telemetry/absent.json' },
			});
			assert.equal(result.sourceBindingState, 'disclosed-unresolvable');
			assert.equal(result.revised, false, 'the incident is still recorded (never a dropped row)');
			// the ledger carries the incident with the disclosed-unresolvable binding
			const text = await fs.readFile(path.join(root, INCIDENTS_LEDGER_PATH), 'utf-8');
			const parsed = JSON.parse(text) as { incidents: { revisions: { sourceBinding: { resolved: boolean; disclosed: string } }[] }[] };
			const binding = parsed.incidents[0]?.revisions[0]?.sourceBinding;
			assert.equal(binding?.resolved, false);
			assert.equal(binding?.disclosed, 'disclosed-unresolvable');
		} finally {
			await cleanup();
		}
	});

	test('a telemetry-census binding with a census that does not carry the failure class is disclosed-unresolvable', async () => {
		const { root, cleanup } = await tempRoot('flauz-inc-rep-');
		try {
			await plantEvidenceBodies(root);
			const censusPath = await plantTelemetryFailureCensus(root, 'provider-unreachable', 3);
			const result = await reportIncident({ root, fs: nodeIncidentsFs(), clock: steppingClock() }, {
				...GOOD_MANUAL,
				seed: 'the-mismatched-census-incident',
				sourceBinding: { kind: 'telemetry-census', failureClass: 'model-timeout', censusPath },
			});
			assert.equal(result.sourceBindingState, 'disclosed-unresolvable');
		} finally {
			await cleanup();
		}
	});

	test('a durability-escalation binding with an absent heartbeat is disclosed-unresolvable', async () => {
		const { root, cleanup } = await tempRoot('flauz-inc-rep-');
		try {
			const result = await reportIncident({ root, fs: nodeIncidentsFs(), clock: steppingClock() }, {
				...GOOD_MANUAL,
				seed: 'the-absent-heartbeat-incident',
				sourceBinding: { kind: 'durability-escalation', laneId: 'lane-alpha', heartbeatPath: '.flauz/durability/heartbeat-absent.json', policy: 'notify' },
			});
			assert.equal(result.sourceBindingState, 'disclosed-unresolvable');
		} finally {
			await cleanup();
		}
	});

	test('a dogfood-friction binding with an absent friction log is disclosed-unresolvable', async () => {
		const { root, cleanup } = await tempRoot('flauz-inc-rep-');
		try {
			const result = await reportIncident({ root, fs: nodeIncidentsFs(), clock: steppingClock() }, {
				...GOOD_MANUAL,
				seed: 'the-absent-friction-incident',
				sourceBinding: { kind: 'dogfood-friction', frictionKind: 'failed-task', phase: 'build', frictionLogPath: '.flauz/dogfood/absent.friction.jsonl' },
			});
			assert.equal(result.sourceBindingState, 'disclosed-unresolvable');
		} finally {
			await cleanup();
		}
	});
});

suite('flauz.incidents.report -- the unique-id law + the revision-append law', () => {
	test('re-reporting an id appends a NEW revision, never duplicates (the unique-id law)', async () => {
		const { root, cleanup } = await tempRoot('flauz-inc-rep-');
		try {
			const fsPort = nodeIncidentsFs();
			const clock = steppingClock();
			const first = await reportIncident({ root, fs: fsPort, clock }, GOOD_MANUAL);
			const second = await reportIncident({ root, fs: fsPort, clock }, { ...GOOD_MANUAL, reproNote: 'an updated reproduction account', severity: 'sev1' as const });
			assert.equal(first.incidentId, second.incidentId, 'the id is stable across revisions');
			assert.equal(second.revised, true);
			assert.equal(second.revision, 2);
			assert.equal(second.incidentCount, 1, 'one incident, two revisions -- never a duplicate');
			const text = await fs.readFile(path.join(root, INCIDENTS_LEDGER_PATH), 'utf-8');
			const parsed = JSON.parse(text) as { incidents: { revisions: { revision: number; severity: string; reproNote: string }[] }[] };
			assert.equal(parsed.incidents[0]?.revisions.length, 2);
			assert.deepEqual(parsed.incidents[0]?.revisions.map(r => r.revision), [1, 2]);
			assert.equal(parsed.incidents[0]?.revisions[1]?.severity, 'sev1');
			assert.equal(parsed.incidents[0]?.revisions[1]?.reproNote, 'an updated reproduction account');
		} finally {
			await cleanup();
		}
	});

	test('two distinct seeds produce two distinct incidents (sorted by id in the ledger)', async () => {
		const { root, cleanup } = await tempRoot('flauz-inc-rep-');
		try {
			const fsPort = nodeIncidentsFs();
			const clock = steppingClock();
			await reportIncident({ root, fs: fsPort, clock }, { ...GOOD_MANUAL, seed: 'the-alpha-incident' });
			await reportIncident({ root, fs: fsPort, clock }, { ...GOOD_MANUAL, seed: 'the-beta-incident' });
			const text = await fs.readFile(path.join(root, INCIDENTS_LEDGER_PATH), 'utf-8');
			const parsed = JSON.parse(text) as { incidents: { incidentId: string }[] };
			assert.equal(parsed.incidents.length, 2);
			assert.equal(parsed.incidents[0]?.incidentId < parsed.incidents[1]?.incidentId, true, 'sorted by id');
		} finally {
			await cleanup();
		}
	});

	test('the first report fires the loop journal intake row (toStage incident); a revision does NOT fire another intake row', async () => {
		const { root, cleanup } = await tempRoot('flauz-inc-rep-');
		try {
			const fsPort = nodeIncidentsFs();
			const clock = steppingClock();
			const first = await reportIncident({ root, fs: fsPort, clock }, GOOD_MANUAL);
			assert.ok(first.intakeJournal !== undefined, 'the first report fires the intake row');
			assert.equal(first.intakeJournal?.row.toStage, 'incident');
			assert.equal(first.intakeJournal?.row.transition, 'forward');
			// the journal file exists with one row
			const journalPath = path.join(root, '.flauz', 'incidents', `loop-${first.incidentId}.jsonl`);
			const journalText = await fs.readFile(journalPath, 'utf-8');
			assert.equal(journalText.trim().split('\n').length, 1, 'one intake row');
			// a revision does NOT fire another intake row
			const second = await reportIncident({ root, fs: fsPort, clock }, { ...GOOD_MANUAL, reproNote: 'updated' });
			assert.ok(second.intakeJournal === undefined, 'a revision does NOT fire another intake row');
			const journalText2 = await fs.readFile(journalPath, 'utf-8');
			assert.equal(journalText2.trim().split('\n').length, 1, 'still one intake row after the revision');
		} finally {
			await cleanup();
		}
	});

	test('determinism: identical seeds + identical inputs through the injected clock produce byte-identical ledgers', async () => {
		const runs: string[] = [];
		for (let index = 0; index < 2; index++) {
			const { root, cleanup } = await tempRoot('flauz-inc-det-');
			try {
				await reportIncident({ root, fs: nodeIncidentsFs(), clock: steppingClock() }, GOOD_MANUAL);
				runs.push(await fs.readFile(path.join(root, INCIDENTS_LEDGER_PATH), 'utf-8'));
			} finally {
				await cleanup();
			}
		}
		assert.equal(runs[0], runs[1]);
	});
});

suite('flauz.incidents.report -- the evidence-ref scoping law (paths under .flauz/ only)', () => {
	test('evidence refs under .flauz/ are accepted; absolute/parent-escape refs refuse the report', async () => {
		const { root, cleanup } = await tempRoot('flauz-inc-rep-');
		try {
			// good refs are accepted
			const good = await reportIncident({ root, fs: nodeIncidentsFs(), clock: steppingClock() }, { ...GOOD_MANUAL, seed: 'good-refs', evidenceRefs: ['.flauz/evidence/ledger.jsonl', '.flauz/incidents/incidents.json'] });
			assert.equal(good.ok, true);
			// absolute refs refuse
			assert.throws(
				() => parseReportArgs({ ...GOOD_MANUAL, evidenceRefs: ['/etc/passwd'] }),
				(err: unknown) => err instanceof IncidentsError && err.code === 'FLAUZ_INCIDENTS_BAD_ARGS',
			);
			// parent-escape refs refuse
			assert.throws(
				() => parseReportArgs({ ...GOOD_MANUAL, evidenceRefs: ['../secret'] }),
				(err: unknown) => err instanceof IncidentsError && err.code === 'FLAUZ_INCIDENTS_BAD_ARGS',
			);
			// refs outside .flauz/ refuse
			assert.throws(
				() => parseReportArgs({ ...GOOD_MANUAL, evidenceRefs: ['other/path.txt'] }),
				(err: unknown) => err instanceof IncidentsError && err.code === 'FLAUZ_INCIDENTS_BAD_ARGS',
			);
		} finally {
			await cleanup();
		}
	});
});

suite('flauz.incidents.report -- the privacy canary (repro notes never reach banked census rows)', () => {
	test('a secret-shaped repro note REFUSES the whole report (the sweep is fail-closed)', async () => {
		const { root, cleanup } = await tempRoot('flauz-inc-canary-');
		try {
			// the secret-shaped repro note is assembled from fragments (the flauz-resources discipline; never spell out a complete secret in source)
			const secretNote = `ghp_${'a'.repeat(36)}`;
			await assert.rejects(
				() => reportIncident({ root, fs: nodeIncidentsFs(), clock: steppingClock() }, { ...GOOD_MANUAL, seed: 'secret-incident', reproNote: secretNote }),
				(err: unknown) => err instanceof IncidentsError && err.code === 'FLAUZ_INCIDENTS_SECRET_SHAPED',
			);
			// the refused report writes nothing (the ledger is absent)
			const ledgerExists = await fs.readFile(path.join(root, INCIDENTS_LEDGER_PATH), 'utf-8').then(() => true, () => false);
			assert.equal(ledgerExists, false, 'a refused report writes nothing (the sweep fires BEFORE the write)');
		} finally {
			await cleanup();
		}
	});

	test('a non-secret repro note lands in the incident record, but the banked census row carries the sha256 -- never the repro note text', async () => {
		const { root, cleanup } = await tempRoot('flauz-inc-canary-');
		try {
			const reproNote = 'restart the provider lane and re-issue the request -- the lane went silent after the third retry';
			await reportIncident({ root, fs: nodeIncidentsFs(), clock: steppingClock() }, { ...GOOD_MANUAL, seed: 'canary-incident', reproNote });
			// the incident record carries the repro note
			const ledgerText = await fs.readFile(path.join(root, INCIDENTS_LEDGER_PATH), 'utf-8');
			assert.ok(ledgerText.includes(reproNote), 'the incident record carries the repro note');
			// the banked census rows (the evidence-ledger note rows) do NOT carry the repro note -- only the sha256 of the artifacts
			const evidenceText = await fs.readFile(path.join(root, '.flauz', 'evidence', 'ledger.jsonl'), 'utf-8');
			const evidenceLines = evidenceText.trim().split('\n');
			assert.ok(evidenceLines.length >= 1, 'at least one banked census row (the incident ledger + the intake row)');
			// every banked row is a canonical JSON line; none carries the repro note text
			assert.ok(!evidenceText.includes(reproNote), 'the banked census rows carry the sha256 of the artifacts -- never the repro note text');
			// the first banked row (the incident ledger banking) carries the INCIDENTS_LEDGER_PATH uri + the INCIDENTS_TASK_ID taskId
			const firstRow = JSON.parse(evidenceLines[0] as string) as { taskId: string; uri: string; sha256: string; kind: string };
			assert.equal(firstRow.taskId, INCIDENTS_TASK_ID);
			assert.equal(firstRow.uri, INCIDENTS_LEDGER_PATH);
			assert.equal(firstRow.kind, 'note');
			// the sha256 is 64 hex chars (the artifact's canonical bytes, not the repro note)
			assert.match(firstRow.sha256, /^[0-9a-f]{64}$/);
		} finally {
			await cleanup();
		}
	});
});

suite('flauz.incidents.report -- the typed refusals', () => {
	test('bad args refuse the whole report (the ledger is never partially written)', () => {
		for (const bad of [
			undefined, null, 'incident', 42, {},
			{ ...GOOD_MANUAL, seed: '' },
			{ ...GOOD_MANUAL, class: '' },
			{ ...GOOD_MANUAL, severity: 'sev5' },
			{ ...GOOD_MANUAL, affectedSurface: '' },
			{ ...GOOD_MANUAL, reproNote: 42 },
			{ ...GOOD_MANUAL, evidenceRefs: ['not-under-flauz'] },
			{ ...GOOD_MANUAL, actor: '' },
			{ ...GOOD_MANUAL, sourceBinding: { kind: 'unknown' } },
			{ ...GOOD_MANUAL, sourceBinding: { kind: 'telemetry-census', failureClass: '', censusPath: '.flauz/x.json' } },
			{ ...GOOD_MANUAL, sourceBinding: { kind: 'telemetry-census', failureClass: 'x', censusPath: '/abs' } },
			{ ...GOOD_MANUAL, sourceBinding: { kind: 'durability-escalation', laneId: '', heartbeatPath: '.flauz/x.json', policy: 'notify' } },
			{ ...GOOD_MANUAL, sourceBinding: { kind: 'durability-escalation', laneId: 'x', heartbeatPath: '/abs', policy: 'notify' } },
			{ ...GOOD_MANUAL, sourceBinding: { kind: 'dogfood-friction', frictionKind: '', phase: 'build', frictionLogPath: '.flauz/x.jsonl' } },
			{ ...GOOD_MANUAL, sourceBinding: { kind: 'dogfood-friction', frictionKind: 'failed-task', phase: '', frictionLogPath: '.flauz/x.jsonl' } },
		]) {
			assert.throws(
				() => parseReportArgs(bad),
				(err: unknown) => err instanceof IncidentsError && err.code === 'FLAUZ_INCIDENTS_BAD_ARGS',
				`the bad arg ${JSON.stringify(bad) ?? String(bad)} refuses typed`,
			);
		}
	});
});
