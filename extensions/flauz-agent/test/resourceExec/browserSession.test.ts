/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The browserSession adapter tests (the PIN-1 read-only adapter). Covers
 * every happy + refusal path: existence, non-closed, the human/agent
 * separation law (TRUST_REFUSED for an agent acquiring a human-initiator
 * session), the surface snapshot AT acquisition, idempotent release of an
 * already-closed session.
 */
import { test } from 'node:test';
import { ok, strictEqual, deepStrictEqual } from 'node:assert';
import { readFileSync } from 'node:fs';
import {
        BrowserSessionAdapter,
        parseJournalLine,
        readSessionJournal,
        browserSurfaceOf,
        type JournalRecord,
} from '../../src/resourceExec/browserSession.ts';
import { canonicalJson } from '../../src/resourceExec/types.ts';
import { copyGoodWorkspace, fixturePath } from './helpers.ts';

test('parseJournalLine: a canonical line parses', () => {
        const line = '{"actor":"agent","descriptor":{"agentId":"worker-1","createdAt":"2026-10-01T12:00:00.000Z","initiator":"agent","partition":"persist:flauz-0123456789abcdef-worker-1","policySourceRef":"flauz:browser-policy/v0@workspace-file#0123456789abcdef","schemaVersion":0,"sessionId":"flauz:browser:0123456789abcdef","state":"active","tabs":[{"openedAt":"2026-10-01T12:00:00.000Z","state":"active","tabId":"flauz:tab:0000000000000001","targetId":"fixture-target-1","url":"about:blank"}]},"event":"opened","schema":"flauz.browser-session-journal/v0","schemaVersion":0,"ts":1760000000000}';
        const result = parseJournalLine(line);
        ok(result.ok);
        strictEqual(result.record.descriptor.sessionId, 'flauz:browser:0123456789abcdef');
});

test('parseJournalLine: a non-canonical line is a typed skip (the bytes must equal the canonical JSON of the parsed record)', () => {
        // same record but with a different key order (canonical sorts keys recursively)
        const line = '{"ts":1760000000000,"schemaVersion":0,"schema":"flauz.browser-session-journal/v0","actor":"agent","event":"opened","descriptor":{"schemaVersion":0,"sessionId":"flauz:browser:0123456789abcdef","initiator":"agent","agentId":"worker-1","partition":"persist:flauz-0123456789abcdef-worker-1","policySourceRef":"flauz:browser-policy/v0@workspace-file#0123456789abcdef","createdAt":"2026-10-01T12:00:00.000Z","state":"active","tabs":[{"tabId":"flauz:tab:0000000000000001","targetId":"fixture-target-1","url":"about:blank","state":"active","openedAt":"2026-10-01T12:00:00.000Z"}]}}';
        const result = parseJournalLine(line);
        ok(!result.ok);
        ok(/not canonical/.test(result.reason));
});

test('parseJournalLine: an invalid-JSON line is a typed skip', () => {
        const result = parseJournalLine('{not-json');
        ok(!result.ok);
        ok(/not valid JSON/.test(result.reason));
});

test('parseJournalLine: a missing-actor line is a typed skip (the actor is MANDATORY)', () => {
        const badRecord = {
                schemaVersion: 0,
                schema: 'flauz.browser-session-journal/v0',
                ts: 1760000000000,
                // actor: missing
                event: 'opened',
                descriptor: {
                        schemaVersion: 0,
                        sessionId: 'flauz:browser:0123456789abcdef',
                        initiator: 'agent',
                        partition: 'p',
                        policySourceRef: 'r',
                        createdAt: '2026-10-01T12:00:00.000Z',
                        state: 'active',
                        tabs: [],
                },
        };
        const line = JSON.stringify(badRecord);
        const result = parseJournalLine(line);
        ok(!result.ok);
        ok(/actor/.test(result.reason), `the reason mentions the actor (got: ${result.reason})`);
});

test('readSessionJournal: an absent journal reads as empty (never an error)', () => {
        const result = readSessionJournal(undefined);
        deepStrictEqual(result.records, []);
        deepStrictEqual(result.skipped, []);
        const empty = readSessionJournal('');
        deepStrictEqual(empty.records, []);
});

test('readSessionJournal: a trailing blank line is tolerated; an interior blank line is a typed skip', () => {
        const rec = {
                schemaVersion: 0,
                schema: 'flauz.browser-session-journal/v0',
                ts: 1760000000000,
                actor: 'agent',
                event: 'opened',
                descriptor: {
                        schemaVersion: 0,
                        sessionId: 'flauz:browser:0123456789abcdef',
                        initiator: 'agent',
                        partition: 'p',
                        policySourceRef: 'r',
                        createdAt: '2026-10-01T12:00:00.000Z',
                        state: 'active',
                        tabs: [],
                },
        };
        const canonical = canonicalJson(rec);
        // trailing blank line tolerated
        const result = readSessionJournal(`${canonical}\n\n`);
        strictEqual(result.records.length, 1);
        strictEqual(result.skipped.length, 0);
        // interior blank line skipped
        const interior = readSessionJournal(`${canonical}\n\n${canonical}\n`);
        strictEqual(interior.records.length, 2);
        strictEqual(interior.skipped.length, 1);
});

test('browserSurfaceOf: derives the browser-surface snapshot from a descriptor (identity = sessionId, never tab ids)', () => {
        const rec = {
                schemaVersion: 0,
                schema: 'flauz.browser-session-journal/v0',
                ts: 1760000000000,
                actor: 'agent',
                event: 'opened',
                descriptor: {
                        schemaVersion: 0,
                        sessionId: 'flauz:browser:0123456789abcdef',
                        initiator: 'agent',
                        partition: 'persist:flauz-0123456789abcdef-worker-1',
                        policySourceRef: 'r',
                        createdAt: '2026-10-01T12:00:00.000Z',
                        state: 'active',
                        tabs: [
                                { tabId: 'flauz:tab:0000000000000002', targetId: 't2', url: 'about:blank', state: 'active' as const, openedAt: '2026-10-01T12:00:00.000Z' },
                                { tabId: 'flauz:tab:0000000000000001', targetId: 't1', url: 'about:blank', state: 'active' as const, openedAt: '2026-10-01T12:00:00.000Z' },
                        ],
                },
        } as unknown as JournalRecord;
        const surface = browserSurfaceOf(rec.descriptor);
        strictEqual(surface.kind, 'browser');
        const snap = surface as { kind: 'browser'; partition: string; tabIds?: readonly string[] };
        strictEqual(snap.partition, 'persist:flauz-0123456789abcdef-worker-1');
        // tabIds are sorted + deduped (identity is the session id, never the tab ids)
        deepStrictEqual(snap.tabIds, ['flauz:tab:0000000000000001', 'flauz:tab:0000000000000002']);
});

test('acquire: an agent actor acquiring an agent-initiator active session returns the descriptor + snapshot', async () => {
        const { root, fs, cleanup } = await copyGoodWorkspace();
        try {
                const adapter = new BrowserSessionAdapter({ workspaceRoot: root, fs });
                const result = await adapter.acquire('flauz:browser:0123456789abcdef', 'agent');
                ok(result.ok);
                strictEqual(result.descriptor.sessionId, 'flauz:browser:0123456789abcdef');
                strictEqual(result.descriptor.initiator, 'agent');
                strictEqual(result.snapshot.kind, 'browser');
        } finally {
                await cleanup();
        }
});

test('acquire: TRUST_REFUSED -- an agent actor acquiring a human-initiator session (the human/agent separation law, pinned BOTH directions)', async () => {
        const { root, fs, cleanup } = await copyGoodWorkspace();
        try {
                const adapter = new BrowserSessionAdapter({ workspaceRoot: root, fs });
                const result = await adapter.acquire('flauz:browser:fedcba9876543210', 'agent');
                ok(!result.ok);
                strictEqual(result.error.code, 'TRUST_REFUSED');
                ok(/human\/agent separation law/.test(result.error.message));
        } finally {
                await cleanup();
        }
});

test('acquire: a human actor CAN acquire an agent-initiator session (taking it over is the documented human-takeover path)', async () => {
        const { root, fs, cleanup } = await copyGoodWorkspace();
        try {
                const adapter = new BrowserSessionAdapter({ workspaceRoot: root, fs });
                const result = await adapter.acquire('flauz:browser:0123456789abcdef', 'human');
                ok(result.ok);
        } finally {
                await cleanup();
        }
});

test('acquire: RESOURCE_ABSENT -- a session not in the journal', async () => {
        const { root, fs, cleanup } = await copyGoodWorkspace();
        try {
                const adapter = new BrowserSessionAdapter({ workspaceRoot: root, fs });
                const result = await adapter.acquire('flauz:browser:9999999999999999', 'agent');
                ok(!result.ok);
                strictEqual(result.error.code, 'RESOURCE_ABSENT');
        } finally {
                await cleanup();
        }
});

test('acquire: RESOURCE_ABSENT -- a closed session (the journal recorded its terminal state)', async () => {
        const { root, fs, cleanup } = await copyGoodWorkspace();
        try {
                const adapter = new BrowserSessionAdapter({ workspaceRoot: root, fs });
                const result = await adapter.acquire('flauz:browser:1111111111111111', 'agent');
                ok(!result.ok);
                strictEqual(result.error.code, 'RESOURCE_ABSENT');
                ok(/closed/.test(result.error.message));
        } finally {
                await cleanup();
        }
});

test('acquire: RESOURCE_ABSENT -- a malformed session id', async () => {
        const { root, fs, cleanup } = await copyGoodWorkspace();
        try {
                const adapter = new BrowserSessionAdapter({ workspaceRoot: root, fs });
                const result = await adapter.acquire('not-a-session-id', 'agent');
                ok(!result.ok);
                strictEqual(result.error.code, 'RESOURCE_ABSENT');
        } finally {
                await cleanup();
        }
});

test('acquire: PRE-FLIGHT TaskResourceError -- a missing actor (fail-closed provenance)', async () => {
        const { root, fs, cleanup } = await copyGoodWorkspace();
        try {
                const adapter = new BrowserSessionAdapter({ workspaceRoot: root, fs });
                try {
                        await adapter.acquire('flauz:browser:0123456789abcdef', 'ai' as never);
                        ok(false, 'should have thrown');
                } catch (err) {
                        ok(err instanceof Error);
                        ok(/actor must be one of agent\|human\|tool/.test((err as Error).message));
                }
        } finally {
                await cleanup();
        }
});

test('release: idempotent -- a session already closed in the journal releases CLEANLY (the obligation is discharged; the record states what the journal showed, never fakes a teardown)', async () => {
        const { root, fs, cleanup } = await copyGoodWorkspace();
        try {
                const adapter = new BrowserSessionAdapter({ workspaceRoot: root, fs });
                const result = await adapter.release('flauz:browser:1111111111111111');
                ok(result.ok);
                ok(result.idempotent);
                strictEqual(result.journalState, 'closed');
        } finally {
                await cleanup();
        }
});

test('release: idempotent -- a session absent from the journal (the journal never knew of it; nothing to tear down)', async () => {
        const { root, fs, cleanup } = await copyGoodWorkspace();
        try {
                const adapter = new BrowserSessionAdapter({ workspaceRoot: root, fs });
                const result = await adapter.release('flauz:browser:9999999999999999');
                ok(result.ok);
                ok(result.idempotent);
                strictEqual(result.journalState, 'absent');
        } finally {
                await cleanup();
        }
});

test('release: an active session releases with idempotent=false (the orchestrator dispatches flauz.browser.close)', async () => {
        const { root, fs, cleanup } = await copyGoodWorkspace();
        try {
                const adapter = new BrowserSessionAdapter({ workspaceRoot: root, fs });
                const result = await adapter.release('flauz:browser:0123456789abcdef');
                ok(result.ok);
                ok(!result.idempotent);
                strictEqual(result.journalState, 'active');
        } finally {
                await cleanup();
        }
});

test('the repo-root browser-session-journal fixtures still parse (no regression on the existing fixture family)', () => {
        // the existing repo-root family at test/fixtures/browser-session-journal/
        const validRaw = readFileSync(fixturePath('..', 'browser-session-journal', 'valid.jsonl'), 'utf-8');
        const result = readSessionJournal(validRaw);
        strictEqual(result.records.length, 4);
        strictEqual(result.skipped.length, 0);

        const missingActorRaw = readFileSync(fixturePath('..', 'browser-session-journal', 'invalid-missing-actor.jsonl'), 'utf-8');
        const missingActor = readSessionJournal(missingActorRaw);
        strictEqual(missingActor.records.length, 0);
        strictEqual(missingActor.skipped.length, 1);
        ok(/actor/.test(missingActor.skipped[0]!.reason));

        const nonCanonicalRaw = readFileSync(fixturePath('..', 'browser-session-journal', 'invalid-non-canonical.jsonl'), 'utf-8');
        const nonCanonical = readSessionJournal(nonCanonicalRaw);
        strictEqual(nonCanonical.records.length, 0);
        strictEqual(nonCanonical.skipped.length, 1);
        ok(/not canonical/.test(nonCanonical.skipped[0]!.reason));

        const wrongSchemaRaw = readFileSync(fixturePath('..', 'browser-session-journal', 'invalid-wrong-schema.jsonl'), 'utf-8');
        const wrongSchema = readSessionJournal(wrongSchemaRaw);
        strictEqual(wrongSchema.records.length, 0);
        strictEqual(wrongSchema.skipped.length, 1);
        ok(/schema must be/.test(wrongSchema.skipped[0]!.reason));
});
