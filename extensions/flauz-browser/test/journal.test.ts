/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Session journal tests (TL3-002 item 3.6 — CROSS-WORKER CONTRACT PIN-1):
 *
 *   - the append-only `.flauz/browser-sessions.jsonl` writer emits canonical
 *     JSON records + `\n` (sorted keys, no insignificant whitespace), one
 *     single O_APPEND write per record;
 *   - every open / state transition / close / failure appends a record with
 *     the full descriptor snapshot;
 *   - the actor is MANDATORY and fail-closed: an unknown initiator makes the
 *     write fail LOUDLY with the typed error (and a journal failure at OPEN
 *     fails the session — never a half-open, unjournaled session);
 *   - the fixture test/fixtures/browser-session-journal/ pins the contract:
 *     the valid sample validates line-by-line; the invalid samples (missing
 *     actor, wrong schema, non-canonical) are rejected;
 *   - the read-side validator is the contract checker for the lane that
 *     consumes this journal READ-ONLY.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserPolicyEngine } from '../src/policy.ts';
import { CdpEndpointHost } from '../src/runtime/host.ts';
import { isSessionError, BrowserSessionManager, isNavigationOutcome } from '../src/runtime/sessionManager.ts';
import { FakeBrowserState, FakeCdpTransport } from '../src/cdp/fake.ts';
import {
	BROWSER_SESSION_JOURNAL_ACTORS,
	BROWSER_SESSION_JOURNAL_EVENTS,
	BROWSER_SESSION_JOURNAL_PATH,
	BROWSER_SESSION_JOURNAL_SCHEMA_ID,
	BROWSER_SESSION_JOURNAL_SCHEMA_VERSION,
	BrowserSessionJournalError,
	FailingSessionJournal,
	FileSystemSessionJournal,
	InMemorySessionJournal,
	buildSessionJournalRecord,
	journalActorOf,
	sessionJournalLine,
	validateSessionJournalLine,
	type SessionJournalPort,
	type SessionJournalRecord,
} from '../src/runtime/journal.ts';
import type { BrowserSessionDescriptor } from '../src/runtime/session.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FIXTURES = path.join(REPO_ROOT, 'test', 'fixtures', 'browser-session-journal');

/**
 * Splits a .jsonl fixture into RECORD LINES, each INCLUDING its terminating
 * newline (the record's byte form — the validator is byte-strict by design).
 */
function fixtureLines(file: string): string[] {
	return readFileSync(path.join(FIXTURES, file), 'utf-8')
		.split('\n')
		.filter(line => line !== '')
		.map(line => `${line}\n`);
}

const WORKSPACE_ROOT = '/ws/acme';

const JOURNAL_POLICY = JSON.stringify({
	schemaVersion: 0,
	driver: { allow: ['*.example.com'] },
	webRequest: { allow: ['*.example.com'] },
	willNavigate: { allow: ['*.example.com'] },
	partitions: { scope: 'persist', perAgent: true },
});

interface JournalRig {
	state: FakeBrowserState;
	manager: BrowserSessionManager;
	journal: InMemorySessionJournal;
	transports: FakeCdpTransport[];
	factoryFailures: number;
}

function rig(policyText: string = JOURNAL_POLICY): JournalRig {
	const state = new FakeBrowserState();
	const journal = new InMemorySessionJournal();
	const transports: FakeCdpTransport[] = [];
	const rigInstance: JournalRig = {
		state,
		journal,
		transports,
		factoryFailures: 0,
		manager: undefined as unknown as BrowserSessionManager,
	};
	const host = new CdpEndpointHost('ws://127.0.0.1:9222/devtools/browser/fake', {
		transportFactory: () => {
			if (rigInstance.factoryFailures > 0) {
				throw new Error('endpoint gone (scripted reconnect failure)');
			}
			const transport = new FakeCdpTransport({ state, commandTimeoutMs: 500 });
			transports.push(transport);
			return transport;
		},
	});
	rigInstance.manager = new BrowserSessionManager({
		engine: () => BrowserPolicyEngine.fromPolicyText(policyText),
		host,
		workspaceRoot: WORKSPACE_ROOT,
		journal,
		commandTimeoutMs: 150,
		navigationTimeoutMs: 300,
	});
	return rigInstance;
}

function fixtureDescriptor(initiator: 'agent' | 'human'): BrowserSessionDescriptor {
	return {
		schemaVersion: 0,
		sessionId: 'flauz:browser:0123456789abcdef',
		initiator,
		agentId: initiator === 'agent' ? 'worker-1' : undefined,
		partition: 'persist:flauz-0123456789abcdef',
		policySourceRef: 'flauz:browser-policy/v0@workspace-file#0123456789abcdef',
		createdAt: '2026-10-01T12:00:00.000Z',
		state: 'active',
		tabs: [],
	};
}

// #region The pinned contract: constants + canonical bytes

test('the journal contract constants are pinned (schema id/version/path/actors/events; P2-FIX-105 adds navigated)', () => {
	assert.equal(BROWSER_SESSION_JOURNAL_SCHEMA_ID, 'flauz.browser-session-journal/v0');
	assert.equal(BROWSER_SESSION_JOURNAL_SCHEMA_VERSION, 0, 'the envelope STAYS v0: the additive event + optional navigation field is the compatible evolution for pinned v0 readers (see the module docblock)');
	assert.equal(BROWSER_SESSION_JOURNAL_PATH, '.flauz/browser-sessions.jsonl');
	assert.deepEqual(BROWSER_SESSION_JOURNAL_ACTORS, ['agent', 'human', 'tool']);
	assert.deepEqual(BROWSER_SESSION_JOURNAL_EVENTS, ['opened', 'state-changed', 'closed', 'failed', 'navigated']);
});

test('sessionJournalLine emits CANONICAL bytes + exactly one newline (sorted keys, no whitespace)', () => {
	const record = buildSessionJournalRecord('agent', 'opened', fixtureDescriptor('agent'), 1760000000000);
	const line = sessionJournalLine(record);
	assert.ok(line.endsWith('\n') && !line.endsWith('\n\n'));
	assert.ok(line.startsWith('{"actor":'), 'keys sorted: actor < descriptor < event < schema < schemaVersion < ts');
	assert.doesNotMatch(line, /,\s/);
	assert.equal(line, line.trimEnd() + '\n');
	// and it round-trips through the validator:
	const validation = validateSessionJournalLine(line);
	assert.equal(validation.ok, true);
});

// #endregion

// #region The MANDATORY actor (fail-closed)

test('journalActorOf maps session initiators and fails LOUDLY on unknown initiators (typed error)', () => {
	assert.equal(journalActorOf('agent'), 'agent');
	assert.equal(journalActorOf('human'), 'human');
	assert.throws(() => journalActorOf('tool'), (err: unknown) => err instanceof BrowserSessionJournalError && /MANDATORY/.test(err.message), 'tool is a journal ACTOR for other lanes, not a session initiator');
	assert.throws(() => journalActorOf('robot'), (err: unknown) => err instanceof BrowserSessionJournalError && /unknown session initiator/.test(err.message));
	assert.throws(() => journalActorOf(''), (err: unknown) => err instanceof BrowserSessionJournalError);
});

test('buildSessionJournalRecord validates actor/event/ts/descriptor (typed errors, never a silent drop)', () => {
	const descriptor = fixtureDescriptor('human');
	// 'tool' IS a valid journal actor (tool-attributed rows from other lanes):
	assert.equal(buildSessionJournalRecord('tool', 'closed', descriptor, 5).actor, 'tool');
	assert.throws(() => buildSessionJournalRecord('robot', 'opened', descriptor, 5), (err: unknown) => err instanceof BrowserSessionJournalError && /unknown journal actor/.test(err.message));
	assert.throws(() => buildSessionJournalRecord('agent', 'exploded', descriptor, 5), (err: unknown) => err instanceof BrowserSessionJournalError && /unknown journal event/.test(err.message));
	assert.throws(() => buildSessionJournalRecord('agent', 'opened', descriptor, -1), (err: unknown) => err instanceof BrowserSessionJournalError && /ts/.test(err.message));
	assert.throws(() => buildSessionJournalRecord('agent', 'opened', fixtureDescriptor('agent'), 5.5), (err: unknown) => err instanceof BrowserSessionJournalError);
	// a malformed descriptor is rejected (the record carries a FULL snapshot):
	const broken = { ...fixtureDescriptor('agent'), sessionId: 'https://not-a-logical-id.example.com/' } as BrowserSessionDescriptor;
	assert.throws(() => buildSessionJournalRecord('agent', 'opened', broken, 5), (err: unknown) => err instanceof BrowserSessionJournalError && /sessionId/.test(err.message));
});

// #endregion

// #region Manager wiring: every open / state transition / close / failure journals

test('open -> "opened", close -> "closed" (full descriptor snapshots, actor from the initiator)', async () => {
	const journalRig = rig();
	const opened = await journalRig.manager.open({ initiator: 'agent', agentId: 'worker-1' });
	const sessionId = opened.descriptor.sessionId;
	assert.equal(journalRig.journal.records.length, 1);
	assert.equal(journalRig.journal.records[0]?.event, 'opened');
	assert.equal(journalRig.journal.records[0]?.actor, 'agent');
	assert.equal(journalRig.journal.records[0]?.descriptor.sessionId, sessionId);
	assert.equal(journalRig.journal.records[0]?.descriptor.state, 'active');
	assert.equal(typeof journalRig.journal.records[0]?.ts, 'number');

	await journalRig.manager.open({ initiator: 'human' });
	assert.equal(journalRig.journal.records[1]?.actor, 'human', 'the actor follows the session initiator');

	await journalRig.manager.close(sessionId);
	const closedRecord = journalRig.journal.records.find(record => record.event === 'closed');
	assert.ok(closedRecord !== undefined);
	assert.equal(closedRecord.descriptor.sessionId, sessionId);
	assert.equal(closedRecord.descriptor.state, 'closed');
	await journalRig.manager.dispose();
});

test('open FAILURE -> "failed" (denied startUrl, before any host interaction)', async () => {
	const journalRig = rig();
	const failed = await journalRig.manager.open({ initiator: 'agent', agentId: 'worker-1', startUrl: 'https://evil.org/pay' });
	assert.equal(failed.descriptor.state, 'failed');
	assert.equal(journalRig.journal.records.length, 1);
	assert.equal(journalRig.journal.records[0]?.event, 'failed');
	assert.equal(journalRig.journal.records[0]?.actor, 'agent');
	assert.equal(journalRig.journal.records[0]?.descriptor.error?.code, 'flauz.browser.policy.deny');
	await journalRig.manager.dispose();
});

test('drop + reconnect -> "state-changed" (suspended) then "state-changed" (active); failed reconnect -> "failed"', async () => {
	// reconnect succeeds:
	const recovering = rig();
	await recovering.manager.open({ initiator: 'agent', agentId: 'worker-1' });
	recovering.transports[0]?.drop();
	const verdict = await recovering.manager.awaitRecovery();
	assert.equal(verdict?.reconnected, true);
	assert.deepEqual(recovering.journal.records.map(record => record.event), ['opened', 'state-changed', 'state-changed']);
	assert.equal(recovering.journal.records[1]?.descriptor.state, 'suspended');
	assert.equal(recovering.journal.records[2]?.descriptor.state, 'active');
	await recovering.manager.dispose();

	// reconnect fails: the session fails and the journal records it:
	const failing = rig();
	await failing.manager.open({ initiator: 'agent', agentId: 'worker-1' });
	failing.factoryFailures = 1;
	failing.transports[0]?.drop();
	await failing.manager.awaitRecovery();
	assert.deepEqual(failing.journal.records.map(record => record.event), ['opened', 'state-changed', 'failed']);
	assert.equal(failing.journal.records[2]?.descriptor.state, 'failed');
	assert.equal(failing.journal.records[2]?.descriptor.error?.code, 'flauz.browser.transport-drop');
	await failing.manager.dispose();
});

// #endregion

// #region Fail-closed journal wiring

test('a journal failure at OPEN fails the session (typed error; never a half-open, unjournaled session)', async () => {
	const state = new FakeBrowserState();
	const journal = new FailingSessionJournal();
	const host = new CdpEndpointHost('ws://127.0.0.1:9222/devtools/browser/fake', {
		transportFactory: () => new FakeCdpTransport({ state, commandTimeoutMs: 500 }),
	});
	const manager = new BrowserSessionManager({
		engine: () => BrowserPolicyEngine.fromPolicyText(JOURNAL_POLICY),
		host,
		workspaceRoot: WORKSPACE_ROOT,
		journal,
		commandTimeoutMs: 150,
		navigationTimeoutMs: 300,
	});
	const opened = await manager.open({ initiator: 'agent', agentId: 'worker-1' });
	assert.equal(opened.descriptor.state, 'failed', 'the session never opens half-way');
	assert.equal(opened.error?.code, 'flauz.browser.journal');
	assert.match(opened.error?.message ?? '', /journal unavailable/);
	assert.ok(journal.attempts.length >= 1, 'the opened record was attempted');
	// navigation on the failed session is a typed error (never a silent reopen):
	const outcome = await manager.navigate(opened.descriptor.sessionId, 'https://docs.example.com/x');
	assert.ok(!isNavigationOutcome(outcome));
	await manager.dispose();
});

test('a journal failure on the close path is captured, never silent (journalErrors audit surface)', async () => {
	// A journal that succeeds for the 'opened' record and breaks before the
	// 'closed' record (scripted mid-flight failure):
	class BreakAfterFirstAppend implements SessionJournalPort {
		readonly records: SessionJournalRecord[] = [];
		async append(record: SessionJournalRecord): Promise<void> {
			if (this.records.length >= 1) {
				throw new BrowserSessionJournalError('journal broke mid-flight (scripted)');
			}
			this.records.push(record);
		}
	}
	const state = new FakeBrowserState();
	const journal = new BreakAfterFirstAppend();
	const host = new CdpEndpointHost('ws://127.0.0.1:9222/devtools/browser/fake', {
		transportFactory: () => new FakeCdpTransport({ state, commandTimeoutMs: 500 }),
	});
	const manager = new BrowserSessionManager({
		engine: () => BrowserPolicyEngine.fromPolicyText(JOURNAL_POLICY),
		host,
		workspaceRoot: WORKSPACE_ROOT,
		journal,
		commandTimeoutMs: 150,
		navigationTimeoutMs: 300,
	});
	const opened = await manager.open({ initiator: 'human' });
	assert.equal(opened.descriptor.state, 'active', 'the open journaled fine (first append succeeds)');
	const closed = await manager.close(opened.descriptor.sessionId);
	assert.ok(!isSessionError(closed), 'the close itself completes (its tabs are closed — the fail-closed direction)');
	assert.equal(closed.state, 'closed');
	const errors = manager.journalErrors();
	assert.equal(errors.length, 1, 'the close-path journal failure is captured (never silent)');
	assert.equal(errors[0]?.code, 'flauz.browser.journal');
	assert.match(errors[0]?.message ?? '', /journal closed event/);
	await manager.dispose();
});

// #endregion

// #region The file-system writer (atomic single-write appends)

test('FileSystemSessionJournal appends canonical lines to <root>/.flauz/browser-sessions.jsonl (dir created)', async () => {
	const root = mkdtempSync(path.join(tmpdir(), 'flauz-journal-'));
	const journal = new FileSystemSessionJournal(root);
	const first = buildSessionJournalRecord('agent', 'opened', fixtureDescriptor('agent'), 1760000000000);
	const second = buildSessionJournalRecord('human', 'closed', fixtureDescriptor('human'), 1760000050000);
	await journal.append(first);
	await journal.append(second);
	const onDisk = readFileSync(path.join(root, '.flauz', 'browser-sessions.jsonl'), 'utf-8');
	assert.equal(onDisk, sessionJournalLine(first) + sessionJournalLine(second), 'append-only: both records, in order, canonical bytes');
	for (const line of onDisk.split('\n').filter(entry => entry !== '').map(entry => `${entry}\n`)) {
		assert.equal(validateSessionJournalLine(line).ok, true);
	}
	// a third append extends the file (append-only, never rewritten):
	const third = buildSessionJournalRecord('agent', 'state-changed', fixtureDescriptor('agent'), 1760000100000);
	await journal.append(third);
	const extended = readFileSync(journal.journalPath, 'utf-8');
	assert.equal(extended, onDisk + sessionJournalLine(third));
});

// #endregion

// #region The fixture matrix (test/fixtures/browser-session-journal)

test('FIXTURE valid.jsonl: every line validates against the pinned contract (the four PIN-1 lifecycle events; the tool actor is legal)', () => {
	const lines = fixtureLines('valid.jsonl');
	assert.ok(lines.length >= 4, 'the sample covers the lifecycle event enum');
	const events: string[] = [];
	for (const line of lines) {
		const validation = validateSessionJournalLine(line);
		assert.equal(validation.ok, true, line);
		events.push(validation.ok ? validation.record.event : '');
	}
	// The pinned fixture predates P2-FIX-105 and covers the four PIN-1
	// LIFECYCLE events (byte form unchanged by the additive navigation
	// event); the 'navigated' row shape is pinned by the navigation tests
	// below, not by this fixture (the fixtures are consumed READ-ONLY by
	// other lanes and are never modified).
	for (const event of ['opened', 'state-changed', 'closed', 'failed'] as const) {
		assert.ok(events.includes(event), `the sample covers the '${event}' event`);
	}
	const actors = new Set(lines.map(line => (JSON.parse(line) as { actor: string }).actor));
	assert.ok(actors.has('tool'), 'the pinned actor enum includes tool-attributed rows (other lanes)');
});

test('FIXTURE invalid-missing-actor.jsonl: rejected (the actor is MANDATORY)', () => {
	for (const line of fixtureLines('invalid-missing-actor.jsonl')) {
		const validation = validateSessionJournalLine(line);
		assert.equal(validation.ok, false, 'a record without an actor never validates');
		if (!validation.ok) {
			assert.match(validation.error.message, /actor|key set/);
		}
	}
});

test('FIXTURE invalid-wrong-schema.jsonl: rejected (the schema id is pinned)', () => {
	for (const line of fixtureLines('invalid-wrong-schema.jsonl')) {
		const validation = validateSessionJournalLine(line);
		assert.equal(validation.ok, false);
		if (!validation.ok) {
			assert.match(validation.error.message, /schema must be/);
		}
	}
});

test('FIXTURE invalid-non-canonical.jsonl: rejected (bytes must be the canonical serialization)', () => {
	for (const line of fixtureLines('invalid-non-canonical.jsonl')) {
		// the payload is semantically fine — only the BYTE FORM deviates
		// (schema-order keys instead of the canonical sorted order):
		const parsed = JSON.parse(line) as Record<string, unknown>;
		assert.equal(parsed.schema, BROWSER_SESSION_JOURNAL_SCHEMA_ID);
		assert.equal(Object.keys(parsed)[0], 'schemaVersion', 'the fixture is the non-canonical key order');
		const validation = validateSessionJournalLine(line);
		assert.equal(validation.ok, false, 'a non-canonical record is a contract deviation');
		if (!validation.ok) {
			assert.match(validation.error.message, /not canonical/);
		}
	}
});

// #endregion

// #region P2-FIX-105 — navigation events as durable on-disk session evidence

/**
 * THE TARGETED REGRESSION TEST (P2-FIX-105): the acceptance journey scene
 * `open -> navigate(allowed) -> navigate(denied) -> close` journals FOUR
 * records — the two navigation rows in addition to opened/closed: the ALLOW
 * row with its committed URL, and the DENY row recording that ZERO wire
 * commands were sent (the J3 fail-closed row). On the pre-fix base this test
 * FAILS at the census assertion (the journal carries exactly 2 rows:
 * opened + closed — the finding).
 */
test('open -> navigate(allowed) -> navigate(denied) -> close journals FOUR records (allow row + committed URL; deny row + zero wire commands)', async () => {
	const journalRig = rig();
	const opened = await journalRig.manager.open({ initiator: 'agent', agentId: 'worker-1' });
	const sessionId = opened.descriptor.sessionId;

	const allowed = await journalRig.manager.navigate(sessionId, 'https://docs.example.com/x');
	assert.ok(isNavigationOutcome(allowed));
	assert.equal(allowed.verdict.decision, 'allow');
	assert.equal(allowed.committedUrl, 'https://docs.example.com/x');

	const denied = await journalRig.manager.navigate(sessionId, 'https://evil.org/pay');
	assert.ok(isNavigationOutcome(denied));
	assert.equal(denied.verdict.decision, 'deny');
	assert.equal(denied.sent, false, 'the deny path sends ZERO wire commands');

	await journalRig.manager.close(sessionId);

	// THE JOURNAL CENSUS IS 4 (was 2 on the base — the failing evidence):
	assert.equal(journalRig.journal.records.length, 4, 'opened + navigated(allow) + navigated(deny) + closed');
	assert.deepEqual(journalRig.journal.records.map(record => record.event), ['opened', 'navigated', 'navigated', 'closed']);

	// The ALLOW row: decision + requested URL + COMMITTED URL + sent.
	const allowRow = journalRig.journal.records[1];
	assert.ok(allowRow !== undefined);
	assert.equal(allowRow.actor, 'agent');
	assert.equal(allowRow.descriptor.sessionId, sessionId);
	assert.deepEqual(allowRow.navigation, {
		decision: 'allow',
		requestedUrl: 'https://docs.example.com/x',
		committedUrl: 'https://docs.example.com/x',
		sent: true,
	});
	assert.equal(allowRow.descriptor.tabs.find(tab => tab.tabId === allowed.tabId)?.url, 'https://docs.example.com/x', 'the snapshot shows the post-commit state');

	// The DENY row (the J3 fail-closed row): decision + requested URL +
	// sent:false + NO committed URL — written from the decision path.
	const denyRow = journalRig.journal.records[2];
	assert.ok(denyRow !== undefined);
	assert.equal(denyRow.actor, 'agent');
	assert.equal(denyRow.descriptor.sessionId, sessionId);
	assert.deepEqual(denyRow.navigation, {
		decision: 'deny',
		requestedUrl: 'https://evil.org/pay',
		sent: false,
	});
	assert.equal('committedUrl' in (denyRow.navigation ?? {}), false, 'a deny row never claims a commit');
	assert.equal(denyRow.descriptor.tabs.find(tab => tab.tabId === denied.tabId)?.url, 'https://docs.example.com/x', 'the deny mutated nothing: the tab still shows the previously committed URL');

	// The J3 fact cross-checked at the unit level: exactly ONE
	// Page.navigate hit the (fake) wire — the denied navigation sent ZERO.
	const wireDrives = journalRig.transports.flatMap(transport => transport.pageNavigateCommands());
	assert.equal(wireDrives.length, 1);
	assert.equal(wireDrives[0]?.params?.url, 'https://docs.example.com/x');

	// Every row is a canonical, contract-valid line (including both
	// navigation rows — the append path re-validates byte-strictly).
	for (const line of journalRig.journal.lines) {
		assert.equal(validateSessionJournalLine(line).ok, true, line);
	}
	await journalRig.manager.dispose();
});

test('the navigated record contract: navigation facts ride ONLY navigated rows (typed errors, never silent)', () => {
	const descriptor = fixtureDescriptor('agent');
	const allowNavigation = { decision: 'allow', requestedUrl: 'https://docs.example.com/x', committedUrl: 'https://docs.example.com/x', sent: true } as const;
	const record = buildSessionJournalRecord('agent', 'navigated', descriptor, 1760000000000, allowNavigation);
	assert.deepEqual(record.navigation, allowNavigation);
	// the byte form: SEVEN sorted keys, navigation between event and schema:
	const line = sessionJournalLine(record);
	assert.ok(line.startsWith('{"actor":'));
	assert.deepEqual(Object.keys(JSON.parse(line)).sort(), ['actor', 'descriptor', 'event', 'navigation', 'schema', 'schemaVersion', 'ts']);
	assert.equal(validateSessionJournalLine(line).ok, true, 'a canonical navigated line round-trips');
	// the J3 deny row: sent:false and NO committedUrl in the BYTES:
	const denyRecord = buildSessionJournalRecord('agent', 'navigated', descriptor, 1760000000001, { decision: 'deny', requestedUrl: 'https://evil.org/pay', sent: false });
	const denyLine = sessionJournalLine(denyRecord);
	assert.ok(!denyLine.includes('committedUrl'), 'a deny row carries no committedUrl key at all');
	assert.ok(denyLine.includes('"sent":false'));
	assert.equal(validateSessionJournalLine(denyLine).ok, true);
	// an allow row WITHOUT a committed URL is legal (operational failures:
	// commit timeout / transport loss / wedged replacement — honest facts):
	const allowNoCommit = buildSessionJournalRecord('agent', 'navigated', descriptor, 1760000000002, { decision: 'allow', requestedUrl: 'https://docs.example.com/x', sent: true });
	assert.equal(allowNoCommit.navigation?.committedUrl, undefined, 'an allow row without a commit is an honest operational fact, not a deviation');
	assert.equal(validateSessionJournalLine(sessionJournalLine(allowNoCommit)).ok, true);
	// the fail-closed deviations (malformed inputs cast to the contract
	// type — the runtime validation is the guard, mirroring untrusted JSON):
	assert.throws(() => buildSessionJournalRecord('agent', 'navigated', descriptor, 5), (err: unknown) => err instanceof BrowserSessionJournalError && /must carry its navigation facts/.test(err.message), 'a navigated row without facts');
	assert.throws(() => buildSessionJournalRecord('agent', 'opened', descriptor, 5, allowNavigation), (err: unknown) => err instanceof BrowserSessionJournalError && /ONLY 'navigated'/.test(err.message), 'a lifecycle row cannot carry navigation facts');
	assert.throws(() => buildSessionJournalRecord('agent', 'navigated', descriptor, 5, { decision: 'deny', requestedUrl: 'https://evil.org/pay', sent: true }), (err: unknown) => err instanceof BrowserSessionJournalError && /J3 fail-closed/.test(err.message), 'a deny row claiming a sent command');
	assert.throws(() => buildSessionJournalRecord('agent', 'navigated', descriptor, 5, { decision: 'deny', requestedUrl: 'https://evil.org/pay', sent: false, committedUrl: 'https://evil.org/pay' }), (err: unknown) => err instanceof BrowserSessionJournalError && /J3 fail-closed/.test(err.message), 'a deny row claiming a commit');
	assert.throws(() => buildSessionJournalRecord('agent', 'navigated', descriptor, 5, { decision: 'block', requestedUrl: 'https://evil.org/pay', sent: false } as unknown as Parameters<typeof buildSessionJournalRecord>[4]), (err: unknown) => err instanceof BrowserSessionJournalError && /decision/.test(err.message));
	assert.throws(() => buildSessionJournalRecord('agent', 'navigated', descriptor, 5, { decision: 'deny', requestedUrl: 42, sent: false } as unknown as Parameters<typeof buildSessionJournalRecord>[4]), (err: unknown) => err instanceof BrowserSessionJournalError && /requestedUrl/.test(err.message));
	assert.throws(() => buildSessionJournalRecord('agent', 'navigated', descriptor, 5, { decision: 'deny', requestedUrl: 'https://evil.org/pay', sent: 'no' } as unknown as Parameters<typeof buildSessionJournalRecord>[4]), (err: unknown) => err instanceof BrowserSessionJournalError && /sent/.test(err.message));
});

test('validateSessionJournalLine: the navigated row shape is enforced on the read side (key set + invariants + canonicality)', () => {
	const descriptor = fixtureDescriptor('human');
	const record = buildSessionJournalRecord('human', 'navigated', descriptor, 1760000000000, { decision: 'allow', requestedUrl: 'https://docs.example.com/x', committedUrl: 'https://docs.example.com/x', sent: true });
	const line = sessionJournalLine(record);
	// canonical navigated line -> ok, with the navigation facts read back:
	const ok = validateSessionJournalLine(line);
	assert.equal(ok.ok, true);
	if (ok.ok) {
		assert.deepEqual(ok.record.navigation, { decision: 'allow', requestedUrl: 'https://docs.example.com/x', committedUrl: 'https://docs.example.com/x', sent: true });
	}
	// a navigated row WITHOUT the navigation key -> key-set deviation:
	const missingFacts = line.replace(',"navigation":{"committedUrl":"https://docs.example.com/x","decision":"allow","requestedUrl":"https://docs.example.com/x","sent":true}', '');
	assert.equal(validateSessionJournalLine(missingFacts + '\n').ok, false, 'a navigated row missing its facts never validates');
	// a LIFECYCLE row carrying a navigation key -> key-set deviation:
	const lifecycle = buildSessionJournalRecord('human', 'closed', descriptor, 1760000000001);
	const polluted = JSON.parse(sessionJournalLine(lifecycle));
	polluted.navigation = { decision: 'allow', requestedUrl: 'https://docs.example.com/x', sent: true };
	const pollutedLine = `${JSON.stringify(polluted)}\n`;
	const pollutedValidation = validateSessionJournalLine(pollutedLine);
	assert.equal(pollutedValidation.ok, false, 'a lifecycle row cannot carry navigation facts');
	if (!pollutedValidation.ok) {
		assert.match(pollutedValidation.error.message, /key set/);
	}
	// a NON-CANONICAL navigated line (keys in schema order) -> rejected:
	const reordered = JSON.stringify({ schemaVersion: 0, schema: BROWSER_SESSION_JOURNAL_SCHEMA_ID, ts: 1760000000000, actor: 'human', event: 'navigated', navigation: { sent: true, requestedUrl: 'https://docs.example.com/x', decision: 'allow', committedUrl: 'https://docs.example.com/x' }, descriptor });
	const reorderedValidation = validateSessionJournalLine(`${reordered}\n`);
	assert.equal(reorderedValidation.ok, false, 'byte form is the contract');
	if (!reorderedValidation.ok) {
		assert.match(reorderedValidation.error.message, /not canonical/);
	}
	// a deny row violating the J3 invariant on the READ side -> rejected:
	const denyViolation = buildSessionJournalRecord('human', 'navigated', descriptor, 1760000000002, { decision: 'deny', requestedUrl: 'https://evil.org/pay', sent: false });
	const parsed = JSON.parse(sessionJournalLine(denyViolation));
	parsed.navigation.sent = true; // the forged J3 violation
	const forged = validateSessionJournalLine(`${JSON.stringify(parsed)}\n`);
	assert.equal(forged.ok, false, 'a deny row claiming a sent command cannot be evidence');
	if (!forged.ok) {
		assert.match(forged.error.message, /J3 fail-closed/);
	}
});

test('lifecycle rows are BYTE-IDENTICAL to the pre-P2-FIX-105 form (six keys; reader compatibility)', () => {
	const descriptor = fixtureDescriptor('agent');
	for (const event of ['opened', 'state-changed', 'closed', 'failed'] as const) {
		const record = buildSessionJournalRecord('agent', event, descriptor, 1760000000000);
		const line = sessionJournalLine(record);
		assert.deepEqual(Object.keys(JSON.parse(line)).sort(), ['actor', 'descriptor', 'event', 'schema', 'schemaVersion', 'ts'], `${event} keeps the six pinned envelope keys`);
		assert.ok(!line.includes('navigation'), `${event} carries no navigation facts`);
		assert.equal(validateSessionJournalLine(line).ok, true);
	}
});

test('open(startUrl allowed) journals opened THEN navigated; a DENIED startUrl stays the fail-closed failed row (no navigated row)', async () => {
	// allowed startUrl: 'opened' first (the forensic birth certificate),
	// then the startUrl navigation row:
	const allowedRig = rig();
	const opened = await allowedRig.manager.open({ initiator: 'agent', agentId: 'worker-1', startUrl: 'https://docs.example.com/start' });
	assert.equal(opened.descriptor.state, 'active');
	assert.deepEqual(allowedRig.journal.records.map(record => record.event), ['opened', 'navigated']);
	assert.deepEqual(allowedRig.journal.records[1]?.navigation, { decision: 'allow', requestedUrl: 'https://docs.example.com/start', committedUrl: 'https://docs.example.com/start', sent: true });
	await allowedRig.manager.close(opened.descriptor.sessionId);
	assert.deepEqual(allowedRig.journal.records.map(record => record.event), ['opened', 'navigated', 'closed']);
	await allowedRig.manager.dispose();

	// denied startUrl: the gate fails the session BEFORE the pipeline —
	// the durable trace is the 'failed' row (descriptor.error carries the
	// policy deny); no navigation ran, so no navigation row exists:
	const deniedRig = rig();
	const failed = await deniedRig.manager.open({ initiator: 'agent', agentId: 'worker-1', startUrl: 'https://evil.org/pay' });
	assert.equal(failed.descriptor.state, 'failed');
	assert.deepEqual(deniedRig.journal.records.map(record => record.event), ['failed']);
	assert.equal(deniedRig.journal.records[0]?.descriptor.error?.code, 'flauz.browser.policy.deny');
	await deniedRig.manager.dispose();
});

test('resetTab journals its about:blank navigation (a forced reset IS a pipeline navigation)', async () => {
	const journalRig = rig();
	const opened = await journalRig.manager.open({ initiator: 'agent', agentId: 'worker-1', startUrl: 'https://docs.example.com/x' });
	const reset = await journalRig.manager.resetTab(opened.descriptor.sessionId);
	assert.ok(isNavigationOutcome(reset));
	assert.deepEqual(journalRig.journal.records.map(record => record.event), ['opened', 'navigated', 'navigated']);
	assert.deepEqual(journalRig.journal.records[2]?.navigation, { decision: 'allow', requestedUrl: 'about:blank', committedUrl: 'about:blank', sent: true });
	await journalRig.manager.dispose();
});

test('a navigation journal write failure is CAPTURED, never silent — the outcome itself stays truthful (journalErrors audit surface)', async () => {
	// A journal that succeeds for 'opened' and breaks on every later
	// append (scripted mid-flight failure on the navigation path):
	class BreakAfterFirstAppend implements SessionJournalPort {
		readonly records: SessionJournalRecord[] = [];
		async append(record: SessionJournalRecord): Promise<void> {
			if (this.records.length >= 1) {
				throw new BrowserSessionJournalError('journal broke mid-flight (scripted)');
			}
			this.records.push(record);
		}
	}
	const state = new FakeBrowserState();
	const journal = new BreakAfterFirstAppend();
	const host = new CdpEndpointHost('ws://127.0.0.1:9222/devtools/browser/fake', {
		transportFactory: () => new FakeCdpTransport({ state, commandTimeoutMs: 500 }),
	});
	const manager = new BrowserSessionManager({
		engine: () => BrowserPolicyEngine.fromPolicyText(JOURNAL_POLICY),
		host,
		workspaceRoot: WORKSPACE_ROOT,
		journal,
		commandTimeoutMs: 150,
		navigationTimeoutMs: 300,
	});
	const opened = await manager.open({ initiator: 'agent', agentId: 'worker-1' });
	assert.equal(opened.descriptor.state, 'active', 'the open journaled fine (first append succeeds)');
	// the allowed navigation STILL COMMITS (its outcome is truthful) and
	// the journal failure is captured, never silent, never a fabricated
	// navigation failure:
	const allowed = await manager.navigate(opened.descriptor.sessionId, 'https://docs.example.com/x');
	assert.ok(isNavigationOutcome(allowed));
	assert.equal(allowed.committedUrl, 'https://docs.example.com/x');
	// the denied navigation STILL records its deny verdict to the caller:
	const denied = await manager.navigate(opened.descriptor.sessionId, 'https://evil.org/pay');
	assert.ok(isNavigationOutcome(denied));
	assert.equal(denied.verdict.decision, 'deny');
	assert.equal(denied.sent, false);
	const errors = manager.journalErrors();
	assert.equal(errors.length, 2, 'both navigation-path journal failures are captured');
	assert.equal(errors[0]?.code, 'flauz.browser.journal');
	assert.match(errors[0]?.message ?? '', /journal navigated event/);
	assert.match(errors[1]?.message ?? '', /journal navigated event/);
	await manager.dispose();
});

// #endregion
