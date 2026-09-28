/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL3-006 — the browser-session journal bridge suite: the strict PIN-1
 * reader (pinned by the EXISTING repo-root fixtures at
 * test/fixtures/browser-session-journal/ — consumed READ-ONLY), ResourceRef
 * minting (identity from the journal's LOGICAL sessionId, never tab ids or
 * paths), surface versioning (prior retained), edges ONLY from explicit
 * provenance-carrying attribution (never fabricated), and the ops-ledger
 * provenance of every mutation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { OPS_PATH } from '../src/api.ts';
import {
	BROWSER_SESSION_JOURNAL_PATH,
	BrowserSessionBridge,
	latestBySession,
	parseJournalLine,
	readSessionJournal,
} from '../src/journalBridge.ts';
import { AGENT, HUMAN, bootGraph, steppingClock } from './helpers.ts';

// ---------------------------------------------------------------------------
// The EXISTING repo-root PIN-1 fixtures (READ-ONLY — never modified)
// ---------------------------------------------------------------------------

function journalFixturePath(name: string): string {
	// test/ -> flauz-resources/ -> extensions/ -> repo root
	return path.join(path.resolve(import.meta.dirname, '..', '..', '..'), 'test', 'fixtures', 'browser-session-journal', name);
}

async function readJournalFixture(name: string): Promise<string> {
	return await fs.readFile(journalFixturePath(name), 'utf-8');
}

const SESSION_A = 'flauz:browser:0123456789abcdef';
const SESSION_B = 'flauz:browser:fedcba9876543210';

test('reader: the valid fixture parses to 4 records / 2 sessions; the latest snapshot per session wins', async () => {
	const raw = await readJournalFixture('valid.jsonl');
	const { records, skipped } = readSessionJournal(raw);
	assert.equal(skipped.length, 0, 'the pinned fixture (incl. its trailing blank line) reads clean');
	assert.equal(records.length, 4);
	assert.equal(records[0]!.event, 'opened');
	assert.equal(records[0]!.actor, 'agent');
	assert.equal(records[3]!.event, 'closed');
	assert.equal(records[3]!.actor, 'tool');
	const latest = latestBySession(records);
	assert.equal(latest.size, 2);
	assert.equal(latest.get(SESSION_A)!.ts, 1760000100000, 'the failed record is the latest for session A');
	assert.equal(latest.get(SESSION_A)!.descriptor.state, 'failed');
	assert.equal(latest.get(SESSION_B)!.ts, 1760000150000);
	assert.equal(latest.get(SESSION_B)!.descriptor.state, 'suspended');
});

test('reader: every invalid fixture is a TYPED SKIP with the bad line recorded — never a crash', async () => {
	const missingActor = readSessionJournal(await readJournalFixture('invalid-missing-actor.jsonl'));
	assert.equal(missingActor.records.length, 0);
	assert.equal(missingActor.skipped.length, 1);
	assert.equal(missingActor.skipped[0]!.line, 1);
	// the actor key is REQUIRED — a record without it fails the pinned key-set
	// check (the browser lane's own fixture test accepts /actor|key set/)
	assert.match(missingActor.skipped[0]!.reason, /actor|key set/);

	const wrongSchema = readSessionJournal(await readJournalFixture('invalid-wrong-schema.jsonl'));
	assert.equal(wrongSchema.records.length, 0);
	assert.equal(wrongSchema.skipped.length, 1);
	assert.match(wrongSchema.skipped[0]!.reason, /schema must be "flauz.browser-session-journal\/v0"/);

	const nonCanonical = readSessionJournal(await readJournalFixture('invalid-non-canonical.jsonl'));
	assert.equal(nonCanonical.records.length, 0);
	assert.equal(nonCanonical.skipped.length, 1);
	assert.match(nonCanonical.skipped[0]!.reason, /not canonical/);
});

test('reader: parseJournalLine pins the contract (shape, enums, descriptor, canonicality)', () => {
	const notJson = parseJournalLine('nope');
	assert.equal(notJson.ok, false);
	assert.match((notJson as { reason: string }).reason, /not valid JSON/);
	// a structurally valid but non-canonical line is rejected
	const parsed = JSON.parse('{"schemaVersion":0,"schema":"flauz.browser-session-journal/v0","ts":1,"actor":"agent","event":"opened","descriptor":{"schemaVersion":0,"sessionId":"flauz:browser:0123456789abcdef","initiator":"agent","partition":"p","policySourceRef":"r","createdAt":"2026-01-01T00:00:00.000Z","state":"active","tabs":[]}}') as Record<string, unknown>;
	const reordered = JSON.stringify({ event: parsed.event, actor: parsed.actor, descriptor: parsed.descriptor, schema: parsed.schema, ts: parsed.ts, schemaVersion: parsed.schemaVersion });
	const result = parseJournalLine(reordered);
	assert.equal(result.ok, false, 'key order in the bytes must be canonical');
	assert.match((result as { reason: string }).reason, /not canonical/);
	// an absent journal reads as empty
	assert.deepEqual(readSessionJournal(undefined), { records: [], skipped: [] });
	assert.deepEqual(readSessionJournal(''), { records: [], skipped: [] });
});

test('sync: mints browser-session refs from the journal (identity = the LOGICAL sessionId; tab ids live only in the surface)', async () => {
	const journal = await readJournalFixture('valid.jsonl');
	const t = await bootGraph({ clock: steppingClock(), seedFiles: { [BROWSER_SESSION_JOURNAL_PATH]: journal } });
	const bridge = new BrowserSessionBridge({ graph: t.graph });
	const report = await bridge.sync({ provenance: AGENT });
	assert.equal(report.journalRecords, 4);
	assert.equal(report.sessions, 2);
	assert.deepEqual([...report.refsMinted].sort(), [SESSION_A, SESSION_B]);
	assert.equal(report.surfacesRefreshed.length, 2);
	assert.equal(report.edgesMinted.length, 0, 'no attribution -> no edges (never fabricated)');
	assert.equal(report.skippedJournalLines.length, 0);
	// the refs: kind reuse (browser-session), identity from the journal sessionId
	const refA = t.graph.get(SESSION_A)!;
	assert.equal(refA.kind, 'browser-session');
	assert.equal(refA.id, SESSION_A);
	assert.equal(refA.provenance.actor, 'agent', 'the sync provenance rides the ref');
	// the surface carries the partition + tab ids (access, not identity)
	const surfaceRecord = t.graph.surfaceRecord(SESSION_A, 'browser')!;
	assert.equal(surfaceRecord.versions.length, 1);
	assert.equal(surfaceRecord.versions[0]!.surface.kind, 'browser');
	assert.equal((surfaceRecord.versions[0]!.surface as { partition?: string }).partition, 'persist:flauz-0123456789abcdef-worker-1');
	assert.deepEqual((surfaceRecord.versions[0]!.surface as { tabIds?: string[] }).tabIds, ['flauz:tab:0000000000000001']);
	// every mutation is provenance-recorded in the EXISTING ops ledger
	const ops = await t.graph.ops();
	assert.equal(ops.filter(op => op.op === 'add-ref').length, 2);
	assert.equal(ops.filter(op => op.op === 'add-surface').length, 2);
	assert.ok(ops.every(op => op.actor === 'agent'));
	await t.cleanup();
});

test('sync is idempotent and refreshes surfaces only on real change (prior version retained)', async () => {
	const journal = await readJournalFixture('valid.jsonl');
	const t = await bootGraph({ clock: steppingClock(), seedFiles: { [BROWSER_SESSION_JOURNAL_PATH]: journal } });
	const bridge = new BrowserSessionBridge({ graph: t.graph });
	await bridge.sync({ provenance: HUMAN });
	// second sync: nothing changed -> no new refs, no new surface versions
	const again = await bridge.sync({ provenance: HUMAN });
	assert.equal(again.refsMinted.length, 0);
	assert.equal(again.surfacesRefreshed.length, 0);
	// append a state-changed record with a NEW tab -> the surface versions (prior retained)
	const extra = {
		schemaVersion: 0,
		schema: 'flauz.browser-session-journal/v0',
		ts: 1760000200000,
		actor: 'agent',
		event: 'state-changed',
		descriptor: {
			schemaVersion: 0,
			sessionId: SESSION_A,
			initiator: 'agent',
			agentId: 'worker-1',
			partition: 'persist:flauz-0123456789abcdef-worker-1',
			policySourceRef: 'flauz:browser-policy/v0@workspace-file#0123456789abcdef',
			createdAt: '2026-10-01T12:00:00.000Z',
			state: 'suspended',
			tabs: [
				{ tabId: 'flauz:tab:0000000000000001', targetId: 'fixture-target-1', url: 'about:blank', state: 'active', openedAt: '2026-10-01T12:00:00.000Z' },
				{ tabId: 'flauz:tab:0000000000000002', targetId: 'fixture-target-2', url: 'https://example.internal/work', state: 'active', openedAt: '2026-10-01T12:30:00.000Z' },
			],
		},
	};
	await fs.writeFile(path.join(t.root, BROWSER_SESSION_JOURNAL_PATH), journal + JSON.stringify(sortKeys(extra)) + '\n', 'utf-8');
	const refreshed = await bridge.sync({ provenance: AGENT });
	assert.equal(refreshed.refsMinted.length, 0, 'the ref identity is stable');
	assert.deepEqual(refreshed.surfacesRefreshed, [SESSION_A], 'only the changed session re-versions');
	const record = t.graph.surfaceRecord(SESSION_A, 'browser')!;
	assert.equal(record.versions.length, 2, 'prior surface retained');
	assert.deepEqual((record.versions[1]!.surface as { tabIds?: string[] }).tabIds, ['flauz:tab:0000000000000001', 'flauz:tab:0000000000000002']);
	assert.equal(t.graph.get(SESSION_A)!.createdAt, 1000, 'the ref createdAt never changes (identity survives surface change)');
	await t.cleanup();
});

test('sync: edges ONLY from explicit attribution — and the targets must exist (typed rejection)', async () => {
	const journal = await readJournalFixture('valid.jsonl');
	const t = await bootGraph({ clock: steppingClock(), seedFiles: { [BROWSER_SESSION_JOURNAL_PATH]: journal } });
	const bridge = new BrowserSessionBridge({ graph: t.graph });
	// attribution to a non-existent ref: typed rejection, nothing minted
	await assert.rejects(() => bridge.sync({ provenance: AGENT, bindEnvironmentRefId: 'flauz:environment:env-staging' }), /bindEnvironmentRefId .* is not a graph ref/);
	assert.equal(t.graph.byKind('browser-session').length, 0, 'the rejected sync minted nothing');
	// seed the environment + task refs, then attribute
	await t.graph.addRef({ kind: 'environment', id: 'flauz:environment:env-staging', provenance: HUMAN });
	await t.graph.addRef({ kind: 'task', id: 'flauz:task:T-001', provenance: HUMAN });
	const attributed = await bridge.sync({ provenance: AGENT, bindEnvironmentRefId: 'flauz:environment:env-staging', bindTaskRefId: 'flauz:task:T-001' });
	assert.equal(attributed.edgesMinted.length, 4, '2 sessions x (bound-to + depends-on)');
	const edges = t.graph.envelope().edges;
	assert.ok(edges.some(edge => edge.kind === 'bound-to' && edge.from === SESSION_A && edge.to === 'flauz:environment:env-staging'));
	assert.ok(edges.some(edge => edge.kind === 'depends-on' && edge.from === SESSION_B && edge.to === 'flauz:task:T-001'));
	// re-sync with the same attribution: idempotent (no duplicate edges)
	const resync = await bridge.sync({ provenance: AGENT, bindEnvironmentRefId: 'flauz:environment:env-staging', bindTaskRefId: 'flauz:task:T-001' });
	assert.equal(resync.edgesMinted.length, 0);
	assert.equal(t.graph.envelope().edges.length, 4);
	await t.cleanup();
});

test('sync: invalid journal lines are typed skips; the valid sessions still sync (never a crash)', async () => {
	const valid = await readJournalFixture('valid.jsonl');
	const bad = await readJournalFixture('invalid-missing-actor.jsonl');
	const mixed = `${valid.trim()}\n${bad.trim()}\n`;
	const t = await bootGraph({ clock: steppingClock(), seedFiles: { [BROWSER_SESSION_JOURNAL_PATH]: mixed } });
	const bridge = new BrowserSessionBridge({ graph: t.graph });
	const report = await bridge.sync({ provenance: HUMAN });
	assert.equal(report.journalRecords, 4);
	assert.equal(report.skippedJournalLines.length, 1);
	assert.equal(report.skippedJournalLines[0]!.line, 5, 'the bad line number is recorded');
	assert.equal(report.sessions, 2);
	assert.equal(t.graph.byKind('browser-session').length, 2, 'the valid sessions still became refs');
	await t.cleanup();
});

test('sync: an absent journal is an empty report (no crash, no mutations)', async () => {
	const t = await bootGraph({ clock: steppingClock() });
	const bridge = new BrowserSessionBridge({ graph: t.graph });
	const report = await bridge.sync({ provenance: AGENT });
	assert.equal(report.journalRecords, 0);
	assert.equal(report.sessions, 0);
	assert.equal(report.refsMinted.length, 0);
	const ops = await t.graph.ops();
	assert.equal(ops.length, 0, 'the empty sync mutated nothing');
	await t.cleanup();
});

test('sync: provenance is MANDATORY (fail-closed — a missing actor is a schema rejection)', async () => {
	const journal = await readJournalFixture('valid.jsonl');
	const t = await bootGraph({ clock: steppingClock(), seedFiles: { [BROWSER_SESSION_JOURNAL_PATH]: journal } });
	const bridge = new BrowserSessionBridge({ graph: t.graph });
	await assert.rejects(() => bridge.sync({ provenance: { actor: 'daemon' } as never }), /actor must be one of agent\|human\|tool/);
	await assert.rejects(() => bridge.sync({ provenance: {} as never }), /provenance\.actor is MISSING/);
	const opsRaw = await t.fs.readFileUtf8(path.join(t.root, OPS_PATH));
	assert.equal(opsRaw, '', 'nothing recorded for rejected syncs');
	await t.cleanup();
});

/** Deep-sorted canonical form (so the appended record serializes canonically). */
function sortKeys(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(sortKeys);
	}
	if (value !== null && typeof value === 'object') {
		const record = value as Record<string, unknown>;
		const result: Record<string, unknown> = {};
		for (const key of Object.keys(record).sort()) {
			result[key] = sortKeys(record[key]);
		}
		return result;
	}
	return value;
}
