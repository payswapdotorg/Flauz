/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Unit tests for the append-only task-resources ledger
 * (src/resourceExec/store.ts): the byte law (one canonical line + exactly
 * one \n per event; appends preserve history), the strict parse incl.
 * canonicality, every corruption class, the fail-closed append paths and
 * the crash-recovery rebuild.
 */
import { test } from 'node:test';
import { deepStrictEqual, match, ok, rejects, strictEqual, throws } from 'node:assert';
import { TASK_RESOURCES_PATH, canonicalJson, parseTaskResourceRecord, type TaskResourceLedgerRecord } from '../../src/resourceExec/types.ts';
import { TaskLeaseBook, acquireLease } from '../../src/resourceExec/contracts.ts';
import { TaskResourceLedger } from '../../src/resourceExec/store.ts';
import { AGENT, counterMintIds, failingWriteOnce, fixedClock, memoryFs, runtimeSecretFixture } from './helpers.ts';

const ROOT = 'workspace';
const LEDGER_KEY = `workspace/${TASK_RESOURCES_PATH}`;

/** A well-formed acquired record (the canonical construction). */
function acquiredRecord(leaseId = 'flauz:lease:0000000000000001', ts = 1730000200000): TaskResourceLedgerRecord {
	return {
		schemaVersion: 0,
		schema: 'flauz.task-resources/v0',
		ts,
		actor: 'agent',
		event: 'acquired',
		taskId: 'T-001',
		leaseId,
		resourceId: 'flauz:browser:0123456789abcdef',
		resourceKind: 'browser-session',
		lease: {
			schemaVersion: 0,
			leaseId,
			taskId: 'T-001',
			resourceKind: 'browser-session',
			resourceId: 'flauz:browser:0123456789abcdef',
			actor: AGENT,
			state: 'active',
			acquiredAt: ts,
			opPort: 'flauz.browser.navigate',
			surfaceSnapshot: { surfaces: [{ family: 'browser', version: 1730000100000, surface: { kind: 'browser', partition: 'persist:fixture' } }] },
		},
	};
}

test('append writes one canonical line + exactly one newline per event and preserves history byte-for-byte', async () => {
	const mem = memoryFs();
	const ledger = new TaskResourceLedger({ root: ROOT, fs: mem.port, clock: fixedClock() });
	await ledger.bootstrap();
	const first = acquiredRecord('flauz:lease:0000000000000001', 1730000200000);
	const second = acquiredRecord('flauz:lease:0000000000000002', 1730000210000);
	const line1 = await ledger.append(first);
	const line2 = await ledger.append(second);
	strictEqual(line1, 1, 'the 1-based line number');
	strictEqual(line2, 2);
	const raw = mem.files.get(LEDGER_KEY)!;
	const lines = raw.split('\n');
	strictEqual(lines.length, 3, 'two records + the trailing newline');
	strictEqual(lines[2], '');
	strictEqual(lines[0], canonicalJson(first), 'the first line is canonical and preserved');
	strictEqual(lines[1], canonicalJson(second));
	strictEqual(ledger.records().length, 2);
});

test('parseLedger enforces the trailing newline + no blank lines + canonical bytes', () => {
	const good = canonicalJson(acquiredRecord()) + '\n';
	strictEqual(TaskResourceLedger.parseLedger(good).length, 1);
	throws(() => TaskResourceLedger.parseLedger(canonicalJson(acquiredRecord())), /must end with a newline/);
	throws(() => TaskResourceLedger.parseLedger(canonicalJson(acquiredRecord()) + '\n\n'), /is empty/);
	throws(() => TaskResourceLedger.parseLedger(JSON.stringify(acquiredRecord()) + '\n'), /not canonical/);
});

test('parseTaskResourceRecord: unknown actor, wrong schema, bad key sets, bad ids are typed LEDGER_CORRUPT', () => {
	throws(() => parseTaskResourceRecord({ ...JSON.parse(JSON.stringify(acquiredRecord())), actor: 'system' }, 'line 1'), /actor must be one of agent\|human\|tool/);
	throws(() => parseTaskResourceRecord({ ...JSON.parse(JSON.stringify(acquiredRecord())), schema: 'flauz.task-resources/v1' }, 'line 1'), /schema must be exactly/);
	const extra = JSON.parse(JSON.stringify(acquiredRecord()));
	extra.note = 'extra key';
	throws(() => parseTaskResourceRecord(extra, 'line 1'), /must have the keys/);
	const badLeaseId = JSON.parse(JSON.stringify(acquiredRecord()));
	badLeaseId.leaseId = 'lease-1';
	badLeaseId.lease.leaseId = 'lease-1';
	throws(() => parseTaskResourceRecord(badLeaseId, 'line 1'), /flauz:lease:<16-hex>/);
	const embeddedDisagreement = JSON.parse(JSON.stringify(acquiredRecord()));
	embeddedDisagreement.lease.taskId = 'T-002';
	throws(() => parseTaskResourceRecord(embeddedDisagreement, 'line 1'), /embedded lease must agree/);
	const notActive = JSON.parse(JSON.stringify(acquiredRecord()));
	notActive.lease.state = 'acquiring';
	throws(() => parseTaskResourceRecord(notActive, 'line 1'), /state 'active'/);
});

test('a secret-shaped ledger record never parses (the no-flattening law at the parse layer)', () => {
	const secret = runtimeSecretFixture('jwt');
	const record = JSON.parse(JSON.stringify(acquiredRecord()));
	record.lease.surfaceSnapshot.surfaces[0].surface.partition = `persist:${secret}`;
	throws(() => parseTaskResourceRecord(record, 'line 1'), /secret-shaped literal/);
});

test('verify: the clean chain passes; canonicality + chain invariants produce line-numbered problems', async () => {
	const mem = memoryFs({ [LEDGER_KEY]: canonicalJson(acquiredRecord('flauz:lease:0000000000000001', 1730000200000)) + '\n' + canonicalJson(acquiredRecord('flauz:lease:0000000000000002', 1730000210000)) + '\n' });
	const ledger = new TaskResourceLedger({ root: ROOT, fs: mem.port, clock: fixedClock() });
	const report = await ledger.verify();
	ok(report.ok, 'two clean acquisitions verify');
	strictEqual(report.records, 2);
	// non-canonical line
	const nonCanonical = memoryFs({ [LEDGER_KEY]: JSON.stringify(acquiredRecord()) + '\n' });
	const nonCanonicalReport = await new TaskResourceLedger({ root: ROOT, fs: nonCanonical.port }).verify();
	ok(!nonCanonicalReport.ok);
	strictEqual(nonCanonicalReport.problems[0]!.line, 1);
	match(nonCanonicalReport.problems[0]!.message, /not canonical/);
	// double-acquire: the chain invariant lands on the second line
	const doubled = memoryFs({ [LEDGER_KEY]: canonicalJson(acquiredRecord()) + '\n' + canonicalJson(acquiredRecord()) + '\n' });
	const doubledReport = await new TaskResourceLedger({ root: ROOT, fs: doubled.port }).verify();
	ok(!doubledReport.ok);
	strictEqual(doubledReport.problems[0]!.line, 2);
	match(doubledReport.problems[0]!.message, /minted more than once/);
	// terminal event for an unacquired lease
	const orphan: TaskResourceLedgerRecord = { schemaVersion: 0, schema: 'flauz.task-resources/v0', ts: 1730000210000, actor: 'agent', event: 'released', taskId: 'T-001', leaseId: 'flauz:lease:ffffffffffffffff', resourceId: 'flauz:browser:0123456789abcdef', resourceKind: 'browser-session', outcome: 'clean' };
	const orphanMem = memoryFs({ [LEDGER_KEY]: canonicalJson(orphan) + '\n' });
	const orphanReport = await new TaskResourceLedger({ root: ROOT, fs: orphanMem.port }).verify();
	ok(!orphanReport.ok);
	match(orphanReport.problems[0]!.message, /never acquired/);
	// a hand-off export referencing an inactive lease
	const exportRecord: TaskResourceLedgerRecord = { schemaVersion: 0, schema: 'flauz.task-resources/v0', ts: 1730000220000, actor: 'agent', event: 'hand-off-exported', taskId: 'T-001', leaseIds: ['flauz:lease:ffffffffffffffff'] };
	const handOffMem = memoryFs({ [LEDGER_KEY]: canonicalJson(acquiredRecord()) + '\n' + canonicalJson(exportRecord) + '\n' });
	const handOffReport = await new TaskResourceLedger({ root: ROOT, fs: handOffMem.port }).verify();
	ok(!handOffReport.ok);
	match(handOffReport.problems[0]!.message, /hand-off-exported carries lease .* which is not active/);
	// missing trailing newline
	const noNewline = memoryFs({ [LEDGER_KEY]: canonicalJson(acquiredRecord()) });
	const noNewlineReport = await new TaskResourceLedger({ root: ROOT, fs: noNewline.port }).verify();
	ok(!noNewlineReport.ok);
	match(noNewlineReport.problems[0]!.message, /must end with exactly one newline/);
});

test('append fails closed on corrupt existing content (nothing is extended)', async () => {
	const mem = memoryFs({ [LEDGER_KEY]: JSON.stringify(acquiredRecord()) + '\n' }); // non-canonical
	const ledger = new TaskResourceLedger({ root: ROOT, fs: mem.port, clock: fixedClock() });
	await ledger.bootstrap().catch(() => undefined);
	await rejects(() => ledger.append(acquiredRecord('flauz:lease:0000000000000009')), /not canonical/);
	strictEqual(mem.files.get(LEDGER_KEY)!.split('\n').length, 2, 'the corrupt file was not extended');
});

test('append fails closed on a write failure (LEDGER_WRITE_FAILED surfaces through the ops)', async () => {
	const failing = failingWriteOnce(memoryFs().port);
	const ledger = new TaskResourceLedger({ root: ROOT, fs: failing, clock: fixedClock() });
	const book = new TaskLeaseBook();
	const env = { book, ledger, clock: fixedClock(), mintLeaseId: counterMintIds() };
	const outcome = await acquireLease(env, { taskId: 'T-001', resourceId: 'flauz:browser:0123456789abcdef', actor: AGENT, adapter: { kind: 'browser-session', acquire: async () => ({ ok: true, surfaceSnapshot: { surfaces: [{ family: 'browser', version: 1, surface: { kind: 'browser', partition: 'p' } }] }, opPort: 'flauz.browser.navigate' }), release: async () => ({ ok: true, outcome: 'clean', observed: 'o', opPort: 'flauz.browser.close' }), verifySurface: async () => ({ ok: true, current: { surfaces: [] } }) } });
	ok(!outcome.ok && outcome.error.code === 'LEDGER_WRITE_FAILED', 'the injected write failure surfaces typed');
	match(outcome.error.message, /injected write failure/);
});

test('bootstrap: a missing ledger loads empty; rebuildBook reproduces identical obligations (crash recovery)', async () => {
	const empty = new TaskResourceLedger({ root: ROOT, fs: memoryFs().port, clock: fixedClock() });
	await empty.bootstrap();
	strictEqual(empty.records().length, 0);
	const report = await empty.verify();
	ok(report.ok && report.records === 0);
	// seed a durable ledger, then boot TWO fresh instances over the same bytes
	const mem = memoryFs({ [LEDGER_KEY]: canonicalJson(acquiredRecord('flauz:lease:0000000000000001', 1730000200000)) + '\n' });
	const a = await new TaskResourceLedger({ root: ROOT, fs: mem.port, clock: fixedClock() }).rebuildBook();
	const b = await new TaskResourceLedger({ root: ROOT, fs: mem.port, clock: fixedClock() }).rebuildBook();
	ok(a.ok && b.ok);
	const activeA = a.book.activeLeasesOf('T-001');
	const activeB = b.book.activeLeasesOf('T-001');
	strictEqual(activeA.length, 1);
	deepStrictEqual(activeA[0]!.lease, activeB[0]!.lease, 'both rebuilds derive the identical obligation');
	strictEqual(activeA[0]!.lease.leaseId, 'flauz:lease:0000000000000001');
	// a corrupt ledger refuses the rebuild (fail-closed, never best-effort)
	const corrupt = memoryFs({ [LEDGER_KEY]: 'not json\n' });
	const refused = await new TaskResourceLedger({ root: ROOT, fs: corrupt.port, clock: fixedClock() }).rebuildBook();
	ok(!refused.ok && refused.problems.length > 0);
});

test('the ledger tolerates a released lease followed by a fresh re-acquire of the same resource', async () => {
	const released: TaskResourceLedgerRecord = { schemaVersion: 0, schema: 'flauz.task-resources/v0', ts: 1730000210000, actor: 'agent', event: 'released', taskId: 'T-001', leaseId: 'flauz:lease:0000000000000001', resourceId: 'flauz:browser:0123456789abcdef', resourceKind: 'browser-session', outcome: 'clean' };
	const reacquired = acquiredRecord('flauz:lease:0000000000000002', 1730000220000);
	const mem = memoryFs({ [LEDGER_KEY]: canonicalJson(acquiredRecord()) + '\n' + canonicalJson(released) + '\n' + canonicalJson(reacquired) + '\n' });
	const rebuilt = await new TaskResourceLedger({ root: ROOT, fs: mem.port, clock: fixedClock() }).rebuildBook();
	ok(rebuilt.ok);
	strictEqual(rebuilt.book.activeLeasesOf('T-001').length, 1, 'the fresh lease is the surviving obligation');
	strictEqual(rebuilt.book.view('flauz:lease:0000000000000001')!.state, 'released');
	const report = await new TaskResourceLedger({ root: ROOT, fs: mem.port, clock: fixedClock() }).verify();
	ok(report.ok);
	strictEqual(report.records, 3);
});
