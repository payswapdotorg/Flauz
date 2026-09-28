/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Unit tests for the PIN-1 read-only browser-session lease adapter
 * (src/resourceExec/browserSession.ts): strict line validation incl.
 * canonicality with typed skips, latest-descriptor resolution, the happy
 * acquire, every refusal path (absent / closed / failed / the human-agent
 * separation law), the snapshot, the closed-elsewhere idempotent release
 * and the partition SURFACE_MISMATCH.
 */
import { test } from 'node:test';
import { deepStrictEqual, match, ok, strictEqual } from 'node:assert';
import { BrowserSessionLeaseAdapter, latestBySession, parseJournalLine, readSessionJournal } from '../../src/resourceExec/browserSession.ts';
import { AGENT, AGENT_SESSION, HUMAN, HUMAN_SESSION, TOOL, browserJournalLine, goodJournal, memoryFs } from './helpers.ts';

const ROOT = 'workspace';

function adapterWith(journal: string): BrowserSessionLeaseAdapter {
	const mem = memoryFs({ 'workspace/.flauz/browser-sessions.jsonl': journal });
	return new BrowserSessionLeaseAdapter({ root: ROOT, fs: mem.port });
}

test('parseJournalLine validates shape + enums + CANONICALITY (a non-canonical line is a typed skip)', () => {
	const canonical = browserJournalLine({ ts: 1730000100000, actor: 'agent', event: 'opened', sessionId: AGENT_SESSION, initiator: 'agent', partition: 'persist:p', state: 'active' });
	const okLine = parseJournalLine(canonical);
	ok(okLine.ok, 'the canonical line parses');
	strictEqual(okLine.ok && okLine.record.descriptor.sessionId, AGENT_SESSION);
	// non-canonical: same JSON, key order reversed
	const reversed = JSON.parse(canonical, (key, value) => value);
	const nonCanonical = JSON.stringify(Object.fromEntries(Object.entries(reversed).reverse()));
	const skipped = parseJournalLine(nonCanonical);
	ok(!skipped.ok, 'a non-canonical line is rejected');
	match(skipped.reason, /not canonical/);
	// missing actor: the MANDATORY provenance skip (surfaces through the pinned key set)
	const missingActor = JSON.parse(canonical);
	delete missingActor.actor;
	const actorSkip = parseJournalLine(JSON.stringify(missingActor));
	ok(!actorSkip.ok);
	match(actorSkip.reason, /key set must be exactly \{actor, descriptor/);
	// unknown actor: the enum check
	const unknownActor = JSON.parse(canonical);
	unknownActor.actor = 'system';
	const enumSkip = parseJournalLine(JSON.stringify(unknownActor));
	ok(!enumSkip.ok);
	match(enumSkip.reason, /actor must be one of agent, human, tool/);
	// wrong schema
	const wrongSchema = JSON.parse(canonical);
	wrongSchema.schema = 'flauz.browser-session-journal/v1';
	const schemaSkip = parseJournalLine(JSON.stringify(wrongSchema));
	ok(!schemaSkip.ok);
	match(schemaSkip.reason, /schema must be/);
});

test('readSessionJournal tolerates trailing blanks, skips interior blanks, and reads absent as empty', () => {
	const result = readSessionJournal(goodJournal() + '\n');
	strictEqual(result.records.length, 2, 'the trailing blank (file-end artifact) is tolerated');
	strictEqual(result.skipped.length, 0);
	const interior = readSessionJournal(browserJournalLine({ ts: 1, actor: 'agent', event: 'opened', sessionId: AGENT_SESSION, initiator: 'agent', partition: 'p', state: 'active' }) + '\n\n' + browserJournalLine({ ts: 2, actor: 'agent', event: 'opened', sessionId: HUMAN_SESSION, initiator: 'human', partition: 'p', state: 'active' }));
	strictEqual(interior.records.length, 2, 'both valid records flow around the interior blank');
	strictEqual(interior.skipped.length, 1, 'the interior blank is a typed skip');
	match(interior.skipped[0]!.reason, /empty line/);
	deepStrictEqual(readSessionJournal(undefined), { records: [], skipped: [] });
	deepStrictEqual(readSessionJournal(''), { records: [], skipped: [] });
});

test('latestBySession resolves the max-ts record with file-order tie-breaking', () => {
	const line = (ts: number, state: string) => browserJournalLine({ ts, actor: 'agent' as const, event: 'state-changed' as const, sessionId: AGENT_SESSION, initiator: 'agent' as const, partition: 'persist:p', state });
	const { records } = readSessionJournal([line(5, 'active'), line(9, 'suspended'), line(9, 'active')].join('\n') + '\n');
	const latest = latestBySession(records);
	strictEqual(latest.size, 1);
	strictEqual(latest.get(AGENT_SESSION)!.descriptor.state, 'active', 'ties break by file order (the last wins)');
	const earlier = readSessionJournal([line(9, 'active'), line(5, 'suspended')].join('\n') + '\n');
	strictEqual(latestBySession(earlier.records).get(AGENT_SESSION)!.descriptor.state, 'active', 'max ts wins regardless of order');
});

test('acquire happy path: agent actor + agent session -> browser surface snapshot + navigate op port', async () => {
	const adapter = adapterWith(goodJournal());
	const verdict = await adapter.acquire('T-001', AGENT_SESSION, AGENT);
	ok(verdict.ok, 'the agent acquires the agent-initiated session');
	deepStrictEqual(verdict.ok && verdict.surfaceSnapshot.surfaces[0]!.surface, { kind: 'browser', partition: 'persist:flauz-0123456789abcdef-worker-1', tabIds: ['flauz:tab:0000000000000001'] });
	strictEqual(verdict.ok && verdict.opPort, 'flauz.browser.navigate');
	strictEqual(verdict.ok && verdict.surfaceSnapshot.surfaces[0]!.version, 1730000100000, 'the version marker is the journal record ts');
});

test('a human actor may lease an agent-initiator session (the stricter session policy still applies)', async () => {
	const adapter = adapterWith(goodJournal());
	const verdict = await adapter.acquire('T-001', AGENT_SESSION, HUMAN);
	ok(verdict.ok, 'the human authority may lease the agent session (pinned: only the machine-on-human direction is refused)');
});

test('RESOURCE_ABSENT: an unknown session (or an all-skipped journal) cannot be acquired', async () => {
	const adapter = adapterWith(goodJournal());
	const verdict = await adapter.acquire('T-001', 'flauz:browser:aaaaaaaaaaaaaaaa', AGENT);
	ok(!verdict.ok && verdict.code === 'RESOURCE_ABSENT');
	match(verdict.message, /no browser session/);
	const empty = adapterWith('');
	const absentJournal = await empty.acquire('T-001', AGENT_SESSION, AGENT);
	ok(!absentJournal.ok && absentJournal.code === 'RESOURCE_ABSENT');
	// a session whose ONLY line is a typed skip is absent (fail-closed per line)
	const skippedOnly = adapterWith(JSON.stringify({ schemaVersion: 0, schema: 'flauz.browser-session-journal/v0', ts: 1, actor: 'agent', event: 'opened', descriptor: { schemaVersion: 0, sessionId: AGENT_SESSION, initiator: 'agent', partition: 'p', policySourceRef: 'r', createdAt: 't', state: 'active', tabs: [] } }));
	const skipVerdict = await skippedOnly.acquire('T-001', AGENT_SESSION, AGENT);
	ok(!skipVerdict.ok && skipVerdict.code === 'RESOURCE_ABSENT');
	match(skipVerdict.message, /skipped as invalid/);
});

test('TRUST_REFUSED: closed and failed sessions are not operable', async () => {
	const closed = browserJournalLine({ ts: 1730000100000, actor: 'agent', event: 'opened', sessionId: AGENT_SESSION, initiator: 'agent', partition: 'p', state: 'active' }) + '\n'
		+ browserJournalLine({ ts: 1730000200000, actor: 'tool', event: 'closed', sessionId: AGENT_SESSION, initiator: 'agent', partition: 'p', state: 'closed' }) + '\n';
	const closedVerdict = await adapterWith(closed).acquire('T-001', AGENT_SESSION, AGENT);
	ok(!closedVerdict.ok && closedVerdict.code === 'TRUST_REFUSED');
	match(closedVerdict.message, /state 'closed'/);
	const failed = browserJournalLine({ ts: 1730000100000, actor: 'agent', event: 'opened', sessionId: AGENT_SESSION, initiator: 'agent', partition: 'p', state: 'active' }) + '\n'
		+ browserJournalLine({ ts: 1730000200000, actor: 'agent', event: 'failed', sessionId: AGENT_SESSION, initiator: 'agent', partition: 'p', state: 'failed' }) + '\n';
	const failedVerdict = await adapterWith(failed).acquire('T-001', AGENT_SESSION, AGENT);
	ok(!failedVerdict.ok && failedVerdict.code === 'TRUST_REFUSED');
	match(failedVerdict.message, /state 'failed'/);
});

test('TRUST_REFUSED (the human/agent separation law): agent and tool actors cannot lease a human-initiator session', async () => {
	const adapter = adapterWith(goodJournal());
	const agentOnHuman = await adapter.acquire('T-001', HUMAN_SESSION, AGENT);
	ok(!agentOnHuman.ok && agentOnHuman.code === 'TRUST_REFUSED');
	match(agentOnHuman.message, /human\/agent separation law/);
	const toolOnHuman = await adapter.acquire('T-001', HUMAN_SESSION, TOOL);
	ok(!toolOnHuman.ok && toolOnHuman.code === 'TRUST_REFUSED', 'tool rows are machine-attributed like agent rows (fail-closed)');
	// the human acquires the human session cleanly
	const humanOnHuman = await adapter.acquire('T-001', HUMAN_SESSION, HUMAN);
	ok(humanOnHuman.ok);
});

test('release: an active session releases clean with the close op port and NO teardown claim', async () => {
	const adapter = adapterWith(goodJournal());
	const verdict = await adapter.release('T-001', AGENT_SESSION, AGENT);
	ok(verdict.ok);
	strictEqual(verdict.outcome, 'clean');
	strictEqual(verdict.opPort, 'flauz.browser.close');
	match(verdict.observed, /TL3 session manager's call at runtime/);
	match(verdict.observed, /claims no teardown/);
});

test('release: a session already closed in the journal releases CLEANLY and idempotently (the record states what the journal showed)', async () => {
	const closed = browserJournalLine({ ts: 1730000100000, actor: 'agent', event: 'opened', sessionId: AGENT_SESSION, initiator: 'agent', partition: 'p', state: 'active' }) + '\n'
		+ browserJournalLine({ ts: 1730000200000, actor: 'tool', event: 'closed', sessionId: AGENT_SESSION, initiator: 'agent', partition: 'p', state: 'closed' }) + '\n';
	const verdict = await adapterWith(closed).release('T-001', AGENT_SESSION, AGENT);
	ok(verdict.ok);
	strictEqual(verdict.outcome, 'closed-elsewhere', 'the obligation is discharged');
	match(verdict.observed, /journal shows session .* closed/);
	match(verdict.observed, /no teardown is claimed/, 'the record never fakes a teardown');
	// idempotent: the same verdict repeats (nothing to discharge twice)
	const again = await adapterWith(closed).release('T-001', AGENT_SESSION, AGENT);
	ok(again.ok && again.outcome === 'closed-elsewhere');
});

test('release of an absent session is a typed refusal (the obligation cannot be discharged against nothing)', async () => {
	const adapter = adapterWith(goodJournal());
	const verdict = await adapter.release('T-001', 'flauz:browser:aaaaaaaaaaaaaaaa', AGENT);
	ok(!verdict.ok && verdict.code === 'RESOURCE_ABSENT');
});

test('SURFACE_MISMATCH: a partition re-minted under the same session id is an identity change', async () => {
	const changed = browserJournalLine({ ts: 1730000100000, actor: 'agent', event: 'opened', sessionId: AGENT_SESSION, initiator: 'agent', partition: 'persist:original', state: 'active' }) + '\n'
		+ browserJournalLine({ ts: 1730000200000, actor: 'agent', event: 'state-changed', sessionId: AGENT_SESSION, initiator: 'agent', partition: 'persist:re-minted', state: 'active' }) + '\n';
	const adapter = adapterWith(changed);
	const pinned = { surfaces: [{ family: 'browser' as const, version: 1730000100000, surface: { kind: 'browser', partition: 'persist:original' } }] };
	const verdict = await adapter.verifySurface('T-001', AGENT_SESSION, pinned);
	ok(!verdict.ok && verdict.code === 'SURFACE_MISMATCH');
	match(verdict.message, /partition\/tab identity of the leased session changed/);
	// the same identity (a tab-set version advance) verifies
	const same = await adapter.verifySurface('T-001', AGENT_SESSION, { surfaces: [{ family: 'browser', version: 1730000200000, surface: { kind: 'browser', partition: 'persist:re-minted', tabIds: ['flauz:tab:0000000000000001'] } }] });
	ok(same.ok);
});
