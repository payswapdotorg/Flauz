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
import { BrowserSessionManager, isNavigationOutcome } from '../src/runtime/sessionManager.ts';
import { FakeBrowserState, FakeCdpTransport } from '../src/cdp/fake.ts';
import {
        BROWSER_SESSION_JOURNAL_ACTORS,
        BROWSER_SESSION_JOURNAL_EVENTS,
        BROWSER_SESSION_JOURNAL_PATH,
        BROWSER_SESSION_JOURNAL_SCHEMA_ID,
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

test('the journal contract constants are pinned (schema id/version/path/actors/events)', () => {
        assert.equal(BROWSER_SESSION_JOURNAL_SCHEMA_ID, 'flauz.browser-session-journal/v0');
        assert.equal(BROWSER_SESSION_JOURNAL_PATH, '.flauz/browser-sessions.jsonl');
        assert.deepEqual(BROWSER_SESSION_JOURNAL_ACTORS, ['agent', 'human', 'tool']);
        assert.deepEqual(BROWSER_SESSION_JOURNAL_EVENTS, ['opened', 'state-changed', 'closed', 'failed']);
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
        assert.ok(!('error' in closed), 'the close itself completes (its tabs are closed — the fail-closed direction)');
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

test('FIXTURE valid.jsonl: every line validates against the pinned contract (all four events; the tool actor is legal)', () => {
        const lines = fixtureLines('valid.jsonl');
        assert.ok(lines.length >= 4, 'the sample covers the event enum');
        const events: string[] = [];
        for (const line of lines) {
                const validation = validateSessionJournalLine(line);
                assert.equal(validation.ok, true, line);
                events.push(validation.ok ? validation.record.event : '');
        }
        for (const event of BROWSER_SESSION_JOURNAL_EVENTS) {
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
                assert.equal(parsed['schema'], BROWSER_SESSION_JOURNAL_SCHEMA_ID);
                assert.equal(Object.keys(parsed)[0], 'schemaVersion', 'the fixture is the non-canonical key order');
                const validation = validateSessionJournalLine(line);
                assert.equal(validation.ok, false, 'a non-canonical record is a contract deviation');
                if (!validation.ok) {
                        assert.match(validation.error.message, /not canonical/);
                }
        }
});

// #endregion
