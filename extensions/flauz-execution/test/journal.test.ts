/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-S2 M1/M2 suite: the execution journal store - strict load (only the
 * final line may be a torn tail), byte canonicity, the hash chain, the
 * append-only write path with full-replay validation (illegal transitions
 * and wrong actor gates throw BEFORE any byte is written), the acquisition
 * replay projection, and the repo fixture pinning (test/fixtures/execution).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ExecJournalStore } from '../src/journal.ts';
import { canonicalJson, execJournalLine, execRowHashOf, execSha256Hex } from '../src/contracts.ts';
import { BROWSER_REF, ENVIRONMENT_REF, FILE_REF, pinnedMinter, readFixture, steppingClock, tempRoot, tempStore } from './helpers.ts';

const JOURNAL_PATH = '.flauz/execution/journal.jsonl';

const BROWSER_SURFACE = {
	resourceClass: 'browser-session',
	sessionId: 'flauz:browser:9c8d7e6f5a4b3c2d',
	initiator: 'agent',
	partition: 'persist:flauz-0123456789abcdef-worker-1',
	state: 'active',
	tabIds: ['flauz:tab:0123456789abcdef'],
	policySourceRef: 'flauz:browser-policy/v0@workspace-file#0123456789abcdef',
} as const;

function acquireBrowser(store: ExecJournalStore, idempotencyKey: string, acquisitionId: string) {
	return store.appendRow('resource-acquired', {
		graphId: 'G-001',
		stepId: 'S-01',
		attempt: 1,
		idempotencyKey,
		acquisitionId,
		actor: 'agent',
		origin: 'test:journal',
		payload: { purpose: 'drive the docs task', resource: { ...BROWSER_REF } },
	});
}

test('store: fresh root bootstraps empty; the journal appears only on first append', () => {
	const { store, root, cleanup } = tempStore();
	assert.equal(store.rowsAll().length, 0);
	assert.equal(store.tornTail, null);
	acquireBrowser(store, 'flauz-orch/G-001/S-01/run/1', 'flauz:exec:0000000000000001');
	const raw = readFileSync(join(root, JOURNAL_PATH), 'utf-8');
	assert.ok(raw.endsWith('\n'), 'one trailing newline per row');
	assert.equal(raw.split('\n').filter((line) => line.length > 0).length, 1);
	cleanup();
});

test('store: rows are canonical bytes and the hash chain links', () => {
	const { store, cleanup } = tempStore();
	const a = acquireBrowser(store, 'flauz-orch/G-001/S-01/run/1', 'flauz:exec:0000000000000001');
	const b = store.appendRow('handoff-recorded', {
		graphId: 'G-001',
		stepId: 'S-01',
		attempt: 1,
		idempotencyKey: 'flauz-orch/G-001/S-01/run/1',
		acquisitionId: 'flauz:exec:0000000000000001',
		actor: 'tool',
		origin: 'test:journal',
		payload: { surface: { ...BROWSER_SURFACE }, surfaceDigest: execSha256Hex(canonicalJson(BROWSER_SURFACE)) },
	});
	assert.equal(b.prev, execRowHashOf(a));
	assert.equal(b.seq, 2);
	assert.equal(b.rowId, 'X-000002');
	assert.ok(store.verifyJournal().ok);
	cleanup();
});

test('store: reload is strict and byte-identical (the reload sees the same rows)', () => {
	const { store, root, cleanup } = tempStore();
	acquireBrowser(store, 'flauz-orch/G-001/S-01/run/1', 'flauz:exec:0000000000000001');
	const reopened = new ExecJournalStore(root, { clock: steppingClock(1730000000000), mintAcquisitionId: pinnedMinter() });
	assert.equal(reopened.rowsAll().length, 1);
	assert.deepEqual(reopened.rowsAll()[0], store.rowsAll()[0]);
	cleanup();
});

test('store: only the FINAL line may be a torn tail (dropped + surfaced); a torn middle line is corrupt', () => {
	const { store, root, cleanup } = tempStore();
	acquireBrowser(store, 'flauz-orch/G-001/S-01/run/1', 'flauz:exec:0000000000000001');
	appendFileSync(join(root, JOURNAL_PATH), '{"torn":'); // crash-torn final line
	const reopened = new ExecJournalStore(root, { clock: steppingClock(1730000000000), mintAcquisitionId: pinnedMinter() });
	assert.equal(reopened.rowsAll().length, 1);
	assert.notEqual(reopened.tornTail, null);
	assert.match(reopened.tornTail?.reason ?? '', /not valid JSON/);
	// a torn MIDDLE line fails loudly
	const { store: s2, root: r2, cleanup: c2 } = tempStore();
	acquireBrowser(s2, 'flauz-orch/G-001/S-01/run/1', 'flauz:exec:0000000000000001');
	s2.appendRow('resource-released', {
		graphId: 'G-001', stepId: 'S-01', attempt: 1, idempotencyKey: null, acquisitionId: 'flauz:exec:0000000000000001',
		actor: 'service', origin: 'test:journal', payload: { releaseKind: 'completion' },
	});
	const lines = readFileSync(join(r2, JOURNAL_PATH), 'utf-8').split('\n').filter((line) => line.length > 0);
	lines.splice(1, 0, '{"torn":');
	writeFileSync(join(r2, JOURNAL_PATH), lines.join('\n') + '\n');
	assert.throws(() => new ExecJournalStore(r2, { clock: steppingClock(1), mintAcquisitionId: pinnedMinter() }), /only the FINAL line/);
	c2();
	cleanup();
});

test('store: byte drift (non-canonical rewrite) is rejected, never silently normalized', () => {
	const { store, root, cleanup } = tempStore();
	acquireBrowser(store, 'flauz-orch/G-001/S-01/run/1', 'flauz:exec:0000000000000001');
	const second = store.appendRow('resource-released', {
		graphId: 'G-001', stepId: 'S-01', attempt: 1, idempotencyKey: null, acquisitionId: 'flauz:exec:0000000000000001',
		actor: 'service', origin: 'test:journal', payload: { releaseKind: 'completion' },
	});
	const row = store.rowsAll()[0];
	const drifted = JSON.stringify(row) + '\n';
	assert.notEqual(drifted.trim(), execJournalLine(row), 'insertion-order keys differ from the canonical sorted form');
	writeFileSync(join(root, JOURNAL_PATH), drifted + execJournalLine(second) + '\n');
	assert.throws(() => new ExecJournalStore(root, { clock: steppingClock(1), mintAcquisitionId: pinnedMinter() }), /not canonical/);
	cleanup();
});

test('store: a broken hash chain fails the reload', () => {
	const { store, root, cleanup } = tempStore();
	acquireBrowser(store, 'flauz-orch/G-001/S-01/run/1', 'flauz:exec:0000000000000001');
	store.appendRow('handoff-recorded', {
		graphId: 'G-001', stepId: 'S-01', attempt: 1, idempotencyKey: 'flauz-orch/G-001/S-01/run/1', acquisitionId: 'flauz:exec:0000000000000001',
		actor: 'tool', origin: 'test:journal', payload: { surface: { ...BROWSER_SURFACE }, surfaceDigest: execSha256Hex(canonicalJson(BROWSER_SURFACE)) },
	});
	const third = store.appendRow('resource-released', {
		graphId: 'G-001', stepId: 'S-01', attempt: 1, idempotencyKey: null, acquisitionId: 'flauz:exec:0000000000000001',
		actor: 'service', origin: 'test:journal', payload: { releaseKind: 'completion' },
	});
	const row = store.rowsAll()[0];
	const doctored = JSON.parse(execJournalLine(row));
	doctored.payload.purpose = 'tampered';
	const doctoredLine = canonicalJson({ ...doctored, contentHash: execSha256Hex(canonicalJson(doctored.payload)) });
	writeFileSync(join(root, JOURNAL_PATH), doctoredLine + '\n' + execJournalLine(store.rowsAll()[1]) + '\n' + execJournalLine(third) + '\n');
	assert.throws(() => new ExecJournalStore(root, { clock: steppingClock(1), mintAcquisitionId: pinnedMinter() }), /broken hash chain/);
	cleanup();
});

test('projection: the acquisition lifecycle replays (acquired -> lost -> reattached -> released)', () => {
	const { store, cleanup } = tempStore();
	const key = 'flauz-orch/G-001/S-01/run/1';
	acquireBrowser(store, key, 'flauz:exec:0000000000000001');
	store.appendRow('handoff-recorded', {
		graphId: 'G-001', stepId: 'S-01', attempt: 1, idempotencyKey: key, acquisitionId: 'flauz:exec:0000000000000001',
		actor: 'tool', origin: 'test:journal', payload: { surface: { ...BROWSER_SURFACE }, surfaceDigest: execSha256Hex(canonicalJson(BROWSER_SURFACE)) },
	});
	store.appendRow('resource-lost', {
		graphId: 'G-001', stepId: 'S-01', attempt: 1, idempotencyKey: key, acquisitionId: 'flauz:exec:0000000000000001',
		actor: 'service', origin: 'test:journal', payload: { detectedBy: 'manager-report', failureClass: 'resource-lost', message: 'tab died' },
	});
	assert.equal(store.acquisitionOf('flauz:exec:0000000000000001').state, 'lost');
	store.appendRow('session-reattached', {
		graphId: 'G-001', stepId: 'S-01', attempt: 1, idempotencyKey: key, acquisitionId: 'flauz:exec:0000000000000001',
		actor: 'service', origin: 'test:journal',
		payload: { policyRecheck: 'pass', surface: { ...BROWSER_SURFACE }, surfaceDigest: execSha256Hex(canonicalJson(BROWSER_SURFACE)) },
	});
	assert.equal(store.acquisitionOf('flauz:exec:0000000000000001').state, 'acquired');
	assert.equal(store.acquisitionOf('flauz:exec:0000000000000001').surfaceDigests.length, 2, 'hand-off + reattach surfaces recorded');
	store.appendRow('resource-released', {
		graphId: 'G-001', stepId: 'S-01', attempt: 1, idempotencyKey: null, acquisitionId: 'flauz:exec:0000000000000001',
		actor: 'service', origin: 'test:journal', payload: { releaseKind: 'completion' },
	});
	assert.equal(store.acquisitionOf('flauz:exec:0000000000000001').state, 'released');
	cleanup();
});

test('projection: aggregate rows (recovery scan / rollback / continuity export) change no acquisition state', () => {
	const { store, cleanup } = tempStore();
	store.appendRow('recovery-scan', { graphId: 'G-001', actor: 'service', origin: 'test:journal', payload: { actions: [], clean: true } });
	store.appendRow('rollback-recorded', { graphId: 'G-001', actor: 'service', origin: 'test:journal', payload: { cause: 'user-cancel', releasedAcquisitionIds: [], coherent: true } });
	assert.equal(store.acquisitions().size, 0);
	cleanup();
});

test('law: releasing an UNKNOWN acquisition throws before any byte is written', () => {
	const { store, root, cleanup } = tempStore();
	assert.throws(() => store.appendRow('resource-released', {
		graphId: 'G-001', stepId: 'S-01', acquisitionId: 'flauz:exec:0000000000000009',
		actor: 'service', origin: 'test:journal', payload: { releaseKind: 'rollback' },
	}), /unknown acquisition/);
	assert.equal(store.rowsAll().length, 0);
	assert.ok(!existsSync(join(root, JOURNAL_PATH)));
	cleanup();
});

test('law: an illegal transition (released -> lost) throws with the allowed source states listed', () => {
	const { store, cleanup } = tempStore();
	const key = 'flauz-orch/G-001/S-01/run/1';
	acquireBrowser(store, key, 'flauz:exec:0000000000000001');
	store.appendRow('resource-released', {
		graphId: 'G-001', stepId: 'S-01', acquisitionId: 'flauz:exec:0000000000000001',
		actor: 'service', origin: 'test:journal', payload: { releaseKind: 'completion' },
	});
	assert.throws(() => store.appendRow('resource-lost', {
		graphId: 'G-001', stepId: 'S-01', acquisitionId: 'flauz:exec:0000000000000001',
		actor: 'service', origin: 'test:journal', payload: { detectedBy: 'probe', failureClass: 'resource-lost', message: 'x' },
	}), /allowed source states: \[acquired\]/);
	assert.equal(store.rowsAll().length, 2);
	cleanup();
});

test('law: the actor gate fires (a human cannot record resource-lost; only service expires)', () => {
	const { store, cleanup } = tempStore();
	const key = 'flauz-orch/G-001/S-01/run/1';
	acquireBrowser(store, key, 'flauz:exec:0000000000000001');
	assert.throws(() => store.appendRow('resource-lost', {
		graphId: 'G-001', stepId: 'S-01', acquisitionId: 'flauz:exec:0000000000000001',
		actor: 'human', origin: 'test:journal', payload: { detectedBy: 'probe', failureClass: 'resource-lost', message: 'x' },
	}), /actor 'human' is not allowed/);
	assert.throws(() => store.appendRow('resource-expired', {
		graphId: 'G-001', stepId: 'S-01', acquisitionId: 'flauz:exec:0000000000000001',
		actor: 'agent', origin: 'test:journal', payload: { expiresAt: 1, expiredAt: 2 },
	}), /actor 'agent' is not allowed/);
	cleanup();
});

test('law: re-acquire after a DENIAL is the next attempt; re-acquire while acquired is illegal', () => {
	const { store, cleanup } = tempStore();
	const key = 'flauz-orch/G-001/S-01/run/1';
	store.appendRow('acquire-denied', {
		graphId: 'G-001', stepId: 'S-01', attempt: 1, idempotencyKey: key, acquisitionId: 'flauz:exec:0000000000000001',
		actor: 'agent', origin: 'test:journal',
		payload: { gate: 'browser-policy', failureClass: 'acquire-denied', message: 'deny', resource: { ...BROWSER_REF } },
	});
	assert.equal(store.acquisitionOf('flauz:exec:0000000000000001').state, 'denied');
	acquireBrowser(store, key, 'flauz:exec:0000000000000001');
	assert.equal(store.acquisitionOf('flauz:exec:0000000000000001').state, 'acquired');
	assert.throws(() => acquireBrowser(store, 'flauz-orch/G-001/S-01/run/2', 'flauz:exec:0000000000000001'), /already in state 'acquired'/);
	cleanup();
});

test('projection: effect settlement binds to the idempotency key (replay detection)', () => {
	const { store, cleanup } = tempStore();
	const key = 'flauz-orch/G-001/S-01/run/1';
	acquireBrowser(store, key, 'flauz:exec:0000000000000001');
	store.appendRow('effect-settled', {
		graphId: 'G-001', stepId: 'S-01', attempt: 1, idempotencyKey: key, acquisitionId: 'flauz:exec:0000000000000001',
		actor: 'tool', origin: 'test:journal', payload: { outcome: 'ok', valueDigest: 'd'.repeat(64) },
	});
	const settled = store.settledRowFor(key);
	assert.notEqual(settled, undefined);
	assert.equal(settled?.type, 'effect-settled');
	assert.equal(store.acquisitionOf('flauz:exec:0000000000000001').settled?.outcome, 'ok');
	cleanup();
});

test('held acquisitions filter by graph/step/key', () => {
	const { store, cleanup } = tempStore();
	const key = 'flauz-orch/G-001/S-01/run/1';
	acquireBrowser(store, key, 'flauz:exec:0000000000000001');
	assert.equal(store.heldAcquisitions({ graphId: 'G-001' }).length, 1);
	assert.equal(store.heldAcquisitions({ stepId: 'S-02' }).length, 0);
	store.appendRow('resource-released', {
		graphId: 'G-001', stepId: 'S-01', acquisitionId: 'flauz:exec:0000000000000001',
		actor: 'service', origin: 'test:journal', payload: { releaseKind: 'completion' },
	});
	assert.equal(store.heldAcquisitions({ graphId: 'G-001' }).length, 0);
	cleanup();
});

// ---------------------------------------------------------------------------
// The repo fixtures (test/fixtures/execution)
// ---------------------------------------------------------------------------

test('fixture: good/journal.jsonl loads strictly and replays a full lifecycle', () => {
	const { root, cleanup } = tempRoot();
	mkdirSync(join(root, '.flauz/execution'), { recursive: true });
	writeFileSync(join(root, JOURNAL_PATH), readFixture('good/journal.jsonl'));
	const store = new ExecJournalStore(root, { clock: steppingClock(1), mintAcquisitionId: pinnedMinter() });
	assert.equal(store.tornTail, null);
	assert.ok(store.verifyJournal().ok);
	const acquisitions = [...store.acquisitions().values()];
	assert.ok(acquisitions.length >= 3, 'browser + environment + logical acquisitions present');
	const byId = new Map(acquisitions.map((acquisition) => [acquisition.acquisitionId, acquisition]));
	assert.equal(byId.get('flauz:exec:0000000000000001')?.state, 'released');
	assert.equal(byId.get('flauz:exec:0000000000000002')?.state, 'lost');
	assert.equal(byId.get('flauz:exec:0000000000000003')?.state, 'acquired');
	cleanup();
});

test('fixture: every bad/ file fails the strict load with a typed reason', () => {
	const cases: readonly [string, RegExp][] = [
		['bad/01-bad-schema.jsonl', /journal row \$schema must be/],
		['bad/02-unknown-key.jsonl', /exactly the 15 keys/],
		['bad/03-bad-rowid.jsonl', /journal row id must be/],
		['bad/04-bad-contenthash.jsonl', /content-hash linkage broken/],
		['bad/05-bad-actor.jsonl', /actor must be one of/],
		['bad/06-unknown-event.jsonl', /unknown event type/],
		['bad/07-bad-acquisition-level.jsonl', /acquisition-level|aggregate/],
		['bad/08-broken-chain.jsonl', /broken hash chain/],
		['bad/09-non-canonical.jsonl', /not canonical/],
		['bad/10-not-json.jsonl', /not valid JSON/],
		['bad/11-bad-lease-id.jsonl', /lease\.leaseId must match/],
		['bad/12-illegal-transition.jsonl', /unknown acquisition|allowed source states/],
		['bad/13-bad-surface-digest.jsonl', /surfaceDigest/],
		['bad/14-bad-idempotency-key.jsonl', /flauz-orch/],
	];
	for (const [file, pattern] of cases) {
		const { root, cleanup } = tempRoot();
		mkdirSync(join(root, '.flauz/execution'), { recursive: true });
		writeFileSync(join(root, JOURNAL_PATH), readFixture(file));
		assert.throws(() => {
			const store = new ExecJournalStore(root, { clock: steppingClock(1), mintAcquisitionId: pinnedMinter() });
			store.acquisitions(); // the transition/actor laws fire at replay
		}, pattern, file);
		cleanup();
	}
});
