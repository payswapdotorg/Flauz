/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * CR-005 -- the live scoped-memory runtime suite (mocha tdd, 66 tests).
 *
 * Coverage: the frozen scope-tier bridge table + its disclosure on every
 * write/read; the DEFAULT-OFF refusal on every operation class (read/
 * write/revision/retention/export while disabled); enablement transitions
 * with the audit trail and the durable re-derivation (a fresh runtime over
 * the same root recovers the state); secret-exclusion both directions
 * (secret-shaped refused with the pattern family named; non-secret
 * admitted); the provenance-required pass-through (the store's own
 * validator linkage laws arrive as typed errors, verbatim); the bridge's
 * own shape laws (the instant pin, the tag lane, the session anchor); the
 * scoping resolution matrix (all three levels + the workspace-wins rule +
 * the visibility lattice); the human-authorization law (an
 * authorization-bearing record's promote requires the human approval row);
 * retention verdicts + expire-receipts over REAL records with the
 * sanctioned-lane execution and the honest-gap disclosure; export gating +
 * the bundle digest verify round-trip; the revision chain + the digest
 * mirror pin against the contract's own admitEntry/reviseEntry; the
 * honest-gap typed refusals for delete-shaped requests; the dispose law;
 * determinism (the injected clock, the law-comment greps, two-root byte
 * identity); and the consistency verify lane.
 *
 * The store is REAL: every test drives an actual MemoryStore over an
 * mkdtemp root through the runtime (seeding goes through the runtime or
 * the bound store's own public APIs only). The clock ticks 1000 ms per
 * call. No wall-clock reads, no randomness.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    BRIDGE_MARKER_TAG,
    ENTRY_TAG_PREFIX,
    ENABLEMENT_EPOCH_ISO,
    epochMsToIsoUtc,
    isoToEpochMs,
    KIND_TAG_PREFIX,
    MEMORY_RUNTIME_ENABLEMENT_DIR,
    MEMORY_RUNTIME_SCHEMA,
    MemoryRuntime,
    MemoryRuntimeError,
    type MemoryRuntimeErrorCode,
    SCOPE_TIER_BRIDGE,
    type MemoryRuntimeWriteRequest,
} from './memoryRuntime.ts';
import type { Actor, FileSystemPort } from '../../../../../extensions/flauz-workspace/src/api.ts';
import { PROJECT_JOURNAL_PATH } from '../../../../../extensions/flauz-memory/src/api.ts';
import * as EntryContract from '../common/entry.ts';
import * as EnablementContract from '../common/enablement.ts';
import * as LifecycleContract from '../common/lifecycle.ts';

const RUNTIME_DIR = dirname(fileURLToPath(import.meta.url));

const SCOPE = { tenantId: 'tenant-local', workspaceId: 'memrt-test-workspace' };
const OTHER_SCOPE = { tenantId: 'tenant-foreign', workspaceId: 'other-workspace' };
const ANCHOR = { taskId: 'T-001', agentId: 'agent-alpha' };
const NOW = '2026-10-07T04:00:00Z';
const NOW_LATER = '2026-10-07T05:00:00Z';
const DAY1 = '1970-01-02T00:00:00Z';
const DAY400_MS = 400 * 86_400_000;

/** The injected clock: +1000 ms per call (each stamped second is distinct). */
function makeClock(start = 1_000_000) {
    let t = start;
    let calls = 0;
    return {
        now: (): number => {
            calls += 1;
            return (t += 1000);
        },
        calls: (): number => calls,
        current: (): number => t,
    };
}

/** The node-backed fs port (the store's own hermetic test discipline, restated). */
function nodeFsPort(): FileSystemPort {
    return {
        readFileUtf8: async (target) => {
            try {
                return await fsPromises.readFile(target, { encoding: 'utf-8' });
            } catch (err) {
                if ((err as { code?: string }).code === 'ENOENT') {
                    return undefined;
                }
                throw err;
            }
        },
        writeFile: (target, contents) => fsPromises.writeFile(target, contents, { encoding: 'utf-8' }),
        appendFile: (target, contents) => fsPromises.appendFile(target, contents, { encoding: 'utf-8' }),
        rename: (from, to) => fsPromises.rename(from, to),
        mkdir: async (target) => {
            await fsPromises.mkdir(target, { recursive: true });
        },
    };
}

interface Env {
    readonly runtime: MemoryRuntime;
    readonly root: string;
    readonly clock: ReturnType<typeof makeClock>;
    cleanup(): Promise<void>;
}

async function freshRuntime(options?: { clockStart?: number }): Promise<Env> {
    const root = await fsPromises.mkdtemp(join(tmpdir(), 'flauz-memrt-'));
    const clock = makeClock(options?.clockStart ?? 1_000_000);
    const runtime = new MemoryRuntime({ root, fs: nodeFsPort(), clock: clock.now, scope: SCOPE });
    await runtime.ensure();
    return {
        runtime,
        root,
        clock,
        cleanup: async () => {
            await fsPromises.rm(root, { recursive: true, force: true });
        },
    };
}

async function enableAll(runtime: MemoryRuntime): Promise<void> {
    await runtime.enableLevel('user');
    await runtime.enableLevel('project');
    await runtime.enableLevel('workspace');
}

type ProvenanceSeed = EntryContract.MemoryProvenance;

function operatorEntry(instant: string): ProvenanceSeed {
    return { origin: 'operator-entry', capturedAtIso: instant };
}

function taskEvidence(instant: string, evidenceRef = 'E-000001'): ProvenanceSeed {
    return { origin: 'task-evidence', evidenceKind: 'note', evidenceRef, capturedAtIso: instant };
}

function derivedProvenance(instant: string, inputDigests: readonly string[] = [EntryContract.digestOf('input', 'a')]): ProvenanceSeed {
    return { origin: 'derived', inputDigests: [...inputDigests], capturedAtIso: instant };
}

interface SeedEntry {
    readonly level: 'user' | 'project' | 'workspace';
    readonly entryId: string;
    readonly content?: string;
    readonly instant?: string;
    readonly kind?: EntryContract.MemoryEntryKind;
    readonly provenance?: ProvenanceSeed;
    readonly actor?: Actor;
    readonly projectRef?: string;
}

function seedRequest(seed: SeedEntry): MemoryRuntimeWriteRequest {
    const instant = seed.instant ?? NOW;
    return {
        level: seed.level,
        projectRef: seed.projectRef,
        entryId: seed.entryId,
        kind: seed.kind ?? 'fact',
        content: seed.content ?? `the ${seed.level} memory content for ${seed.entryId}`,
        provenance: seed.provenance ?? operatorEntry(instant),
        actor: seed.actor ?? 'human',
        admittedAtIso: instant,
        sessionAnchor: seed.level === 'user' ? ANCHOR : undefined,
    };
}

async function seedWrite(runtime: MemoryRuntime, seed: SeedEntry) {
    return runtime.write(seedRequest(seed));
}

function describeErr(error: unknown): string {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** The typed-refusal assertion: every refusal names its violated law through a MemoryRuntimeError code. */
async function expectTypedError(code: MemoryRuntimeErrorCode, run: () => Promise<unknown>, check?: (err: MemoryRuntimeError) => void): Promise<void> {
    let caught: unknown;
    let completed = false;
    try {
        await run();
        completed = true;
    } catch (error) {
        caught = error;
    }
    assert.ok(!completed, `expected a typed MemoryRuntimeError ('${code}') but the operation completed`);
    assert.ok(caught instanceof MemoryRuntimeError, `expected MemoryRuntimeError, got ${describeErr(caught)}`);
    assert.strictEqual(caught.code, code, `expected code '${code}', got '${caught.code}' (${caught.message})`);
    if (check !== undefined) {
        check(caught);
    }
}

function userQuery() {
    return { scope: SCOPE, context: 'user' as const, projectRef: undefined };
}

function projectQuery(projectRef: string | undefined) {
    return { scope: SCOPE, context: 'project' as const, projectRef };
}

function workspaceQuery() {
    return { scope: SCOPE, context: 'workspace' as const, projectRef: undefined };
}

suite('CR-005 scoped-memory runtime', function () {

    suite('the scope-tier bridge table', function () {
        let env: Env;
        setup(async function () {
            env = await freshRuntime();
            await enableAll(env.runtime);
        });
        teardown(async function () {
            await env.cleanup();
        });

        test('the frozen table maps exactly the three levels onto the three store tiers', function () {
            assert.deepEqual(
                SCOPE_TIER_BRIDGE.map((row) => [row.level, row.tier]),
                [['user', 'session'], ['project', 'task'], ['workspace', 'project']],
            );
            assert.deepEqual(env.runtime.bridge.map((row) => row.rowId), ['user->session', 'project->task', 'workspace->project']);
        });

        test('every bridge row carries a non-empty rationale (the disclosed mapping)', function () {
            for (const row of SCOPE_TIER_BRIDGE) {
                assert.ok(row.rationale.length > 0, `the ${row.rowId} row must carry its rationale`);
            }
        });

        test('a user-level write discloses address + tier session + bridgeProvenance user->session', async function () {
            const result = await seedWrite(env.runtime, { level: 'user', entryId: 'bridge-user-1' });
            assert.strictEqual(result.tier, 'session');
            assert.strictEqual(result.bridgeProvenance, 'user->session');
            assert.deepEqual(result.address, { scope: SCOPE, contractVersion: '1.0.0', level: 'user', projectRef: undefined });
            assert.strictEqual(result.storeRecord.tier, 'session');
            assert.strictEqual(result.storeRecord.taskId, 'T-001');
            assert.strictEqual(result.storeRecord.agentId, 'agent-alpha');
        });

        test('a project-level write discloses address + tier task + bridgeProvenance project->task', async function () {
            const result = await seedWrite(env.runtime, { level: 'project', entryId: 'bridge-proj-1', projectRef: 'T-002' });
            assert.strictEqual(result.tier, 'task');
            assert.strictEqual(result.bridgeProvenance, 'project->task');
            assert.deepEqual(result.address, { scope: SCOPE, contractVersion: '1.0.0', level: 'project', projectRef: 'T-002' });
            assert.strictEqual(result.storeRecord.tier, 'task');
            assert.strictEqual(result.storeRecord.taskId, 'T-002');
        });

        test('a workspace-level write discloses address + tier project + bridgeProvenance workspace->project', async function () {
            const result = await seedWrite(env.runtime, { level: 'workspace', entryId: 'bridge-ws-1' });
            assert.strictEqual(result.tier, 'project');
            assert.strictEqual(result.bridgeProvenance, 'workspace->project');
            assert.deepEqual(result.address, { scope: SCOPE, contractVersion: '1.0.0', level: 'workspace', projectRef: undefined });
            assert.strictEqual(result.storeRecord.tier, 'project');
            assert.strictEqual(result.storeRecord.taskId, null);
        });
    });

    suite('the DEFAULT-OFF law (every operation class)', function () {
        let env: Env;
        setup(async function () {
            env = await freshRuntime();
        });
        teardown(async function () {
            await env.cleanup();
        });

        test('a fresh runtime is all-off (the default enablement fold)', async function () {
            const enablement = await env.runtime.enablement();
            assert.deepEqual(enablement.enabledLevels, []);
            assert.strictEqual(enablement.updatedAtIso, ENABLEMENT_EPOCH_ISO);
            assert.strictEqual(enablement.contractVersion, '1.0.0');
        });

        test('write is refused while the level is disabled (carrying the level + the enablement state)', async function () {
            await expectTypedError('LEVEL-NOT-ENABLED', () => seedWrite(env.runtime, { level: 'user', entryId: 'never-1' }), (err) => {
                assert.strictEqual(err.level, 'user');
                assert.ok(err.enablement !== undefined);
                assert.deepEqual(err.enablement?.enabledLevels, []);
                assert.match(err.message, /DEFAULT-OFF/);
            });
        });

        test('list is refused while the context level is disabled', async function () {
            await expectTypedError('LEVEL-NOT-ENABLED', () => env.runtime.list(userQuery()));
        });

        test('revise is refused while the entry\'s level is disabled', async function () {
            await env.runtime.enableLevel('workspace');
            await seedWrite(env.runtime, { level: 'workspace', entryId: 'doomed-1' });
            await env.runtime.disableLevel('workspace');
            await expectTypedError('LEVEL-NOT-ENABLED', () => env.runtime.revise('doomed-1', { content: 'the revision', provenance: operatorEntry(NOW_LATER), actor: 'human', revisedAtIso: NOW_LATER }));
        });

        test('retentionVerdicts is refused while the level is disabled', async function () {
            await expectTypedError('LEVEL-NOT-ENABLED', () => env.runtime.retentionVerdicts('user'));
        });

        test('exportLevel is refused while the level is disabled', async function () {
            await expectTypedError('LEVEL-NOT-ENABLED', () => env.runtime.exportLevel('user'));
        });
    });

    suite('enablement transitions + the durable audit trail', function () {
        let env: Env;
        setup(async function () {
            env = await freshRuntime();
        });
        teardown(async function () {
            await env.cleanup();
        });

        test('enableLevel returns the transition + the audit change row', async function () {
            const transition = await env.runtime.enableLevel('user');
            assert.strictEqual(transition.change.from, false);
            assert.strictEqual(transition.change.to, true);
            assert.strictEqual(transition.change.level, 'user');
            assert.strictEqual(transition.change.contractVersion, '1.0.0');
            assert.deepEqual(transition.change.scope, SCOPE);
            assert.deepEqual(transition.enablement.enabledLevels, ['user']);
        });

        test('the audit trail persists durably at the disclosed path', async function () {
            await env.runtime.enableLevel('user');
            await env.runtime.enableLevel('project');
            const changesPath = join(env.root, MEMORY_RUNTIME_ENABLEMENT_DIR, 'changes.jsonl');
            const text = await fsPromises.readFile(changesPath, 'utf-8');
            const lines = text.split('\n').filter((line) => line.length > 0);
            assert.strictEqual(lines.length, 2);
            const first = JSON.parse(lines[0]) as { $schema: string; change: { level: string; to: boolean } };
            assert.strictEqual(first.$schema, MEMORY_RUNTIME_SCHEMA);
            assert.strictEqual(first.change.level, 'user');
            assert.strictEqual(first.change.to, true);
            const listed = await env.runtime.enablementChanges();
            assert.deepEqual(listed.map((change) => change.level), ['user', 'project']);
        });

        test('the fold reflects enabled levels in canonical MEMORY_LEVELS order', async function () {
            await env.runtime.enableLevel('workspace');
            await env.runtime.enableLevel('user');
            await env.runtime.enableLevel('project');
            const enablement = await env.runtime.enablement();
            assert.deepEqual(enablement.enabledLevels, ['user', 'project', 'workspace']);
        });

        test('disableLevel transitions and the fold drops the level', async function () {
            await env.runtime.enableLevel('user');
            await env.runtime.enableLevel('project');
            const transition = await env.runtime.disableLevel('user');
            assert.strictEqual(transition.change.from, true);
            assert.strictEqual(transition.change.to, false);
            const enablement = await env.runtime.enablement();
            assert.deepEqual(enablement.enabledLevels, ['project']);
        });

        test('a no-op enable records from === to in the audit trail (the contract\'s law)', async function () {
            await env.runtime.enableLevel('user');
            const before = await env.runtime.enablement();
            const noOp = await env.runtime.enableLevel('user');
            assert.strictEqual(noOp.change.from, true);
            assert.strictEqual(noOp.change.to, true);
            const after = await env.runtime.enablement();
            assert.strictEqual(after.updatedAtIso, before.updatedAtIso);
            assert.strictEqual((await env.runtime.enablementChanges()).length, 2);
        });

        test('durable re-derivation: a fresh runtime over the same root recovers the state', async function () {
            await env.runtime.enableLevel('user');
            await env.runtime.enableLevel('project');
            await env.runtime.disableLevel('user');
            env.runtime.dispose();
            const revived = new MemoryRuntime({ root: env.root, fs: nodeFsPort(), clock: makeClock(5_000_000).now, scope: SCOPE });
            const enablement = await revived.enablement();
            assert.deepEqual(enablement.enabledLevels, ['project']);
            const changes = await revived.enablementChanges();
            assert.deepEqual(changes.map((change) => [change.level, change.to]), [['user', true], ['project', true], ['user', false]]);
            revived.dispose();
        });
    });

    suite('secret-exclusion (fail-closed, both directions)', function () {
        let env: Env;
        setup(async function () {
            env = await freshRuntime();
            await enableAll(env.runtime);
        });
        teardown(async function () {
            await env.cleanup();
        });

        test('credential-shaped content is refused with the family named and nothing appended', async function () {
            await expectTypedError('SECRET-SHAPED-CONTENT', () => env.runtime.write({
                ...seedRequest({ level: 'workspace', entryId: 'leak-1' }),
                content: 'the database password = "hunter2" for the staging env',
            }), (err) => {
                assert.strictEqual(err.family, 'credential-shaped-key');
                assert.strictEqual(err.matchedPattern, 'credential-key-assignment');
                assert.doesNotMatch(err.message, /hunter2/);
            });
            assert.strictEqual((await env.runtime.store.listAll()).length, 0);
        });

        test('token-shaped (JWT) content is refused with the family named', async function () {
            await expectTypedError('SECRET-SHAPED-CONTENT', () => env.runtime.write({
                ...seedRequest({ level: 'workspace', entryId: 'leak-2' }),
                content: 'bearer eyJshorttoken.12345678abcdef.abcdefghij across services',
            }), (err) => {
                assert.strictEqual(err.family, 'token-shaped-value');
                assert.strictEqual(err.matchedPattern, 'jwt-value');
            });
        });

        test('a PEM private-key header is refused with the family named', async function () {
            await expectTypedError('SECRET-SHAPED-CONTENT', () => env.runtime.write({
                ...seedRequest({ level: 'workspace', entryId: 'leak-3' }),
                // The PEM-shaped fixture is composed at runtime (joined parts) so the
                // suite's own source never carries a contiguous key-block literal; the
                // composed string still triggers the contract's fail-closed detector.
                content: `${['-----BEGIN', ' TEST PRIVATE KEY', '-----'].join('')} the key material`,
            }), (err) => {
                assert.strictEqual(err.family, 'private-key-header');
                assert.strictEqual(err.matchedPattern, 'pem-private-key-header');
            });
        });

        test('non-secret content is admitted and reads back', async function () {
            const result = await seedWrite(env.runtime, { level: 'workspace', entryId: 'clean-1', content: 'the agent prefers concise summaries with pinned commands' });
            assert.match(result.storeRecord.id, /^MEM-P-\d{6,}$/);
            const listed = await env.runtime.list(workspaceQuery());
            assert.strictEqual(listed.entries.length, 1);
            assert.strictEqual(listed.entries[0].entry.entryId, 'clean-1');
        });
    });

    suite('provenance-required + the store validator pass-through', function () {
        let env: Env;
        setup(async function () {
            env = await freshRuntime();
            await enableAll(env.runtime);
        });
        teardown(async function () {
            await env.cleanup();
        });

        test('the store\'s ledger-row evidence law passes through typed (no fabricated memory)', async function () {
            await expectTypedError('STORE-REFUSED', () => env.runtime.write({
                ...seedRequest({ level: 'project', entryId: 'prov-1', projectRef: 'T-002', provenance: taskEvidence(NOW, 'NOT-AN-E-ID') }),
            }), (err) => {
                assert.match(err.message, /flauz\.memory/);
                assert.match(err.message, /no fabricated memory/);
            });
        });

        test('the store\'s task-id law passes through typed for a bad projectRef', async function () {
            await expectTypedError('STORE-REFUSED', () => env.runtime.write({
                ...seedRequest({ level: 'project', entryId: 'prov-2', projectRef: 'not-a-task' }),
            }), (err) => {
                assert.match(err.message, /flauz\.memory/);
            });
        });

        test('the bridge instant pin refuses mismatched capture/admission instants', async function () {
            await expectTypedError('BRIDGE-REFUSED', () => env.runtime.write({
                ...seedRequest({ level: 'workspace', entryId: 'prov-3', instant: NOW }),
                provenance: operatorEntry('2026-10-07T03:00:00Z'),
            }), (err) => {
                assert.match(err.message, /pins the provenance capture instant/);
            });
        });

        test('derived input digests must be tag-carriable (typed refusal)', async function () {
            await expectTypedError('BRIDGE-REFUSED', () => env.runtime.write({
                ...seedRequest({ level: 'workspace', entryId: 'prov-4', provenance: derivedProvenance(NOW, ['not-a-digest']) }),
            }), (err) => {
                assert.match(err.message, /fnv1a64/);
            });
        });

        test('a user-level write without the session anchor is refused typedly', async function () {
            await expectTypedError('BRIDGE-REFUSED', () => env.runtime.write({
                level: 'user',
                projectRef: undefined,
                entryId: 'prov-5',
                kind: 'fact',
                content: 'the content',
                provenance: operatorEntry(NOW),
                actor: 'human',
                admittedAtIso: NOW,
                sessionAnchor: undefined,
            }), (err) => {
                assert.match(err.message, /session tier/);
            });
        });
    });

    suite('the bridge disclosure on reads', function () {
        let env: Env;
        setup(async function () {
            env = await freshRuntime();
            await enableAll(env.runtime);
        });
        teardown(async function () {
            await env.cleanup();
        });

        test('list carries the resolved address + tier + bridgeProvenance', async function () {
            await seedWrite(env.runtime, { level: 'user', entryId: 'disc-user-1' });
            const listed = await env.runtime.list(userQuery());
            assert.deepEqual(listed.address, { scope: SCOPE, contractVersion: '1.0.0', level: 'user', projectRef: undefined });
            assert.strictEqual(listed.tier, 'session');
            assert.strictEqual(listed.bridgeProvenance, 'user->session');
            assert.deepEqual(listed.visibleLevels, ['user']);
        });

        test('every surfaced entry carries its level\'s tier + bridge row', async function () {
            await seedWrite(env.runtime, { level: 'user', entryId: 'disc-user-1' });
            await seedWrite(env.runtime, { level: 'workspace', entryId: 'disc-ws-1' });
            const listed = await env.runtime.list(workspaceQuery());
            const byLevel = new Map(listed.entries.map((entry) => [entry.level, entry] as const));
            assert.strictEqual(byLevel.get('user')?.tier, 'session');
            assert.strictEqual(byLevel.get('user')?.bridgeProvenance, 'user->session');
            assert.strictEqual(byLevel.get('workspace')?.tier, 'project');
            assert.strictEqual(byLevel.get('workspace')?.bridgeProvenance, 'workspace->project');
        });

        test('get carries the disclosure', async function () {
            await seedWrite(env.runtime, { level: 'workspace', entryId: 'disc-ws-1' });
            const got = await env.runtime.get('disc-ws-1', workspaceQuery());
            assert.strictEqual(got.tier, 'project');
            assert.strictEqual(got.bridgeProvenance, 'workspace->project');
            assert.strictEqual(got.level, 'workspace');
            assert.strictEqual(got.revisions, 1);
            assert.strictEqual(got.chainVerified, true);
        });
    });

    suite('the scoping resolution matrix', function () {
        let env: Env;
        setup(async function () {
            env = await freshRuntime();
            await enableAll(env.runtime);
            await seedWrite(env.runtime, { level: 'user', entryId: 'matrix-user-1' });
            await seedWrite(env.runtime, { level: 'project', entryId: 'matrix-proj-2', projectRef: 'T-002' });
            await seedWrite(env.runtime, { level: 'project', entryId: 'matrix-proj-4', projectRef: 'T-004' });
            await seedWrite(env.runtime, { level: 'workspace', entryId: 'matrix-ws-1' });
        });
        teardown(async function () {
            await env.cleanup();
        });

        test('a user-context query resolves to the user address and sees only user entries', async function () {
            const listed = await env.runtime.list(userQuery());
            assert.strictEqual(listed.address.level, 'user');
            assert.deepEqual(listed.visibleLevels, ['user']);
            assert.deepEqual(listed.entries.map((entry) => entry.level), ['user']);
        });

        test('a project-context query resolves to the project address and filters by projectRef', async function () {
            const listed = await env.runtime.list(projectQuery('T-002'));
            assert.strictEqual(listed.address.level, 'project');
            assert.strictEqual(listed.address.projectRef, 'T-002');
            assert.deepEqual(listed.visibleLevels, ['user', 'project']);
            const projectEntries = listed.entries.filter((entry) => entry.level === 'project');
            assert.deepEqual(projectEntries.map((entry) => entry.entry.entryId), ['matrix-proj-2']);
            assert.ok(listed.entries.some((entry) => entry.level === 'user'));
        });

        test('the workspace-wins rule: a workspace-context query resolves to the workspace address over user+project candidates', async function () {
            const listed = await env.runtime.list(workspaceQuery());
            assert.strictEqual(listed.address.level, 'workspace');
            assert.strictEqual(listed.address.projectRef, undefined);
            assert.strictEqual(listed.tier, 'project');
            assert.strictEqual(listed.bridgeProvenance, 'workspace->project');
            assert.deepEqual(listed.visibleLevels, ['user', 'project', 'workspace']);
            assert.strictEqual(listed.entries.length, 4);
        });

        test('a project-context query without a projectRef is refused typedly (project-ref-required)', async function () {
            await expectTypedError('RESOLUTION-REFUSED', () => env.runtime.list(projectQuery(undefined)), (err) => {
                const refusal = err.refusal as { reason: string };
                assert.strictEqual(refusal.reason, 'project-ref-required');
            });
        });

        test('a project-context query for an unknown projectRef is refused typedly (no-address-at-level)', async function () {
            await expectTypedError('RESOLUTION-REFUSED', () => env.runtime.list(projectQuery('T-999')), (err) => {
                const refusal = err.refusal as { reason: string };
                assert.strictEqual(refusal.reason, 'no-address-at-level');
            });
        });

        test('the visibility lattice: a user-context reader cannot read a workspace-level entry', async function () {
            await expectTypedError('NOT-READABLE', () => env.runtime.get('matrix-ws-1', userQuery()), (err) => {
                assert.match(err.message, /reading never widens upward/);
            });
        });
    });

    suite('the human-authorization law', function () {
        let env: Env;
        let authorizationRecordId: string;
        setup(async function () {
            env = await freshRuntime();
            await env.runtime.enableLevel('project');
            await env.runtime.enableLevel('workspace');
            const seeded = await env.runtime.store.record('task', {
                kind: 'authorization',
                content: 'the standing approval for the payments lane',
                taskId: 'T-003',
                provenance: { actor: 'human', origin: 'task-event', ts: 86_400_000 },
            });
            authorizationRecordId = seeded.record.id;
        });
        teardown(async function () {
            await env.cleanup();
        });

        test('an authorization-bearing record\'s promote without the human approval row is refused with the store\'s law verbatim', async function () {
            await expectTypedError('STORE-REFUSED', () => env.runtime.move(authorizationRecordId, 'workspace', { reason: 'promote the standing approval', actor: 'agent', humanApproved: false }), (err) => {
                assert.match(err.message, /never auto-promote/);
                assert.match(err.message, /humanApproved=true with actor 'human'/);
            });
        });

        test('with humanApproved + actor \'human\' the move lands and the promotion row is recorded', async function () {
            const moved = await env.runtime.move(authorizationRecordId, 'workspace', { reason: 'promote the standing approval', actor: 'human', humanApproved: true });
            assert.strictEqual(moved.promotion.action, 'promote');
            assert.strictEqual(moved.fromLevel, 'project');
            assert.strictEqual(moved.toLevel, 'workspace');
            assert.strictEqual(moved.fromTier, 'task');
            assert.strictEqual(moved.toTier, 'project');
            assert.strictEqual(moved.record.tier, 'project');
            assert.strictEqual(moved.bridgeProvenance, 'workspace->project');
            const promotions = await env.runtime.store.promotions();
            assert.ok(promotions.some((promotion) => promotion.recordId === authorizationRecordId && promotion.action === 'promote'));
        });

        test('the move gates both levels (disabled target level -> typed refusal)', async function () {
            await env.runtime.disableLevel('workspace');
            await expectTypedError('LEVEL-NOT-ENABLED', () => env.runtime.move(authorizationRecordId, 'workspace', { reason: 'promote the standing approval', actor: 'human', humanApproved: true }), (err) => {
                assert.strictEqual(err.level, 'workspace');
            });
        });
    });

    suite('retention verdicts + expire-receipts over real records', function () {
        let env: Env;
        setup(async function () {
            env = await freshRuntime({ clockStart: DAY400_MS });
            await enableAll(env.runtime);
        });
        teardown(async function () {
            await env.cleanup();
        });

        test('verdicts: the day-1 entry expires at the level TTL; a future-dated entry retains (fail-closed)', async function () {
            await seedWrite(env.runtime, { level: 'workspace', entryId: 'ret-old-1', instant: DAY1 });
            await seedWrite(env.runtime, { level: 'workspace', entryId: 'ret-new-1', instant: NOW });
            const verdicts = await env.runtime.retentionVerdicts('workspace');
            assert.strictEqual(verdicts.policy.ttlDays.workspace, LifecycleContract.WORKSPACE_MEMORY_TTL_DAYS);
            const byId = new Map(verdicts.verdicts.map((row) => [row.entry.entryId, row.verdict] as const));
            assert.strictEqual(byId.get('ret-old-1'), 'expire');
            assert.strictEqual(byId.get('ret-new-1'), 'retain');
        });

        test('applyRetention composes expire-receipts + pins the retained through the sanctioned lanes', async function () {
            await seedWrite(env.runtime, { level: 'workspace', entryId: 'ret-old-1', instant: DAY1 });
            const fresh = await seedWrite(env.runtime, { level: 'workspace', entryId: 'ret-new-1', instant: NOW });
            const result = await env.runtime.applyRetention('workspace');
            assert.strictEqual(result.application.expireReceipts.length, 1);
            const receipt = result.application.expireReceipts[0];
            assert.strictEqual(receipt.entryId, 'ret-old-1');
            assert.strictEqual(receipt.level, 'workspace');
            assert.strictEqual(receipt.ttlDays, LifecycleContract.WORKSPACE_MEMORY_TTL_DAYS);
            assert.match(receipt.expireDigest, /^fnv1a64:[0-9a-f]{16}$/);
            assert.ok(EnablementContract.isIsoTimestamp(receipt.expiredAtIso));
            assert.ok(receipt.expiredAtIso.startsWith('1971-02-05T'), `the expire instant is the injected day-400 clock (got ${receipt.expiredAtIso})`);
            assert.deepEqual(result.execution.pinnedRecordIds, [fresh.storeRecord.id]);
            const promotions = await env.runtime.store.promotions();
            assert.ok(promotions.some((promotion) => promotion.action === 'pin' && promotion.recordId === fresh.storeRecord.id));
        });

        test('the honest gap: un-evictable expired records are disclosed, never faked', async function () {
            const old = await seedWrite(env.runtime, { level: 'workspace', entryId: 'ret-old-1', instant: DAY1 });
            const result = await env.runtime.applyRetention('workspace');
            assert.deepEqual(result.residualExpiredRecordIds, [old.storeRecord.id]);
            assert.ok(result.honestGap !== undefined);
            assert.match(result.honestGap, /cap-driven compaction/);
            assert.ok(result.honestGap.includes(old.storeRecord.id), 'the honest gap names the residual record id');
            assert.strictEqual(result.execution.evictedRecordIds.length, 0);
        });

        test('an invalid policy is a typed refusal', async function () {
            await seedWrite(env.runtime, { level: 'workspace', entryId: 'ret-old-1', instant: DAY1 });
            const badPolicy = {
                scope: SCOPE,
                contractVersion: '1.0.0',
                ttlDays: { user: -1, project: 180, workspace: 90 },
                declaredAtIso: NOW,
            };
            await expectTypedError('INVALID-PARAMS', () => env.runtime.applyRetention('workspace', { policy: badPolicy }));
            await expectTypedError('INVALID-PARAMS', () => env.runtime.retentionVerdicts('workspace', { policy: badPolicy }));
        });
    });

    suite('export gating + the bundle digest round-trip', function () {
        let env: Env;
        setup(async function () {
            env = await freshRuntime();
            await enableAll(env.runtime);
        });
        teardown(async function () {
            await env.cleanup();
        });

        test('the project level exports per projectRef only (typed refusal without one)', async function () {
            await seedWrite(env.runtime, { level: 'project', entryId: 'exp-proj-1', projectRef: 'T-002' });
            await expectTypedError('INVALID-PARAMS', () => env.runtime.exportLevel('project'));
        });

        test('the bundle carries the level\'s latest entries and verifies (the contract round-trip)', async function () {
            const written = await seedWrite(env.runtime, { level: 'user', entryId: 'exp-user-1', content: 'the first content' });
            await env.runtime.revise('exp-user-1', { content: 'the revised content', provenance: operatorEntry(NOW_LATER), actor: 'human', revisedAtIso: NOW_LATER });
            await seedWrite(env.runtime, { level: 'user', entryId: 'exp-user-2' });
            const result = await env.runtime.exportLevel('user');
            assert.strictEqual(result.bundle.level, 'user');
            assert.strictEqual(result.bundle.entries.length, 2);
            const revised = result.bundle.entries.find((entry) => entry.entryId === 'exp-user-1');
            assert.strictEqual(revised?.contentDigest, EntryContract.contentDigestOf('the revised content'));
            assert.notStrictEqual(revised?.contentDigest, written.entry.contentDigest);
            assert.ok(result.bundle.enablement.enabledLevels.includes('user'));
            assert.strictEqual(result.verified, true);
            assert.strictEqual(LifecycleContract.verifyExportBundle(result.bundle), true);
        });

        test('a tampered bundle fails verifyExportBundle', async function () {
            await seedWrite(env.runtime, { level: 'user', entryId: 'exp-user-1' });
            const result = await env.runtime.exportLevel('user');
            const tampered = {
                ...result.bundle,
                entries: result.bundle.entries.map((entry) => ({ ...entry, revisionDigest: 'fnv1a64:0000000000000000' })),
            };
            assert.strictEqual(LifecycleContract.verifyExportBundle(tampered), false);
        });

        test('the project-level export filters to the named projectRef', async function () {
            await seedWrite(env.runtime, { level: 'project', entryId: 'exp-proj-2', projectRef: 'T-002' });
            await seedWrite(env.runtime, { level: 'project', entryId: 'exp-proj-4', projectRef: 'T-004' });
            const result = await env.runtime.exportLevel('project', 'T-002');
            assert.deepEqual(result.bundle.entries.map((entry) => entry.entryId), ['exp-proj-2']);
            assert.strictEqual(result.bundle.projectRef, 'T-002');
            assert.strictEqual(LifecycleContract.verifyExportBundle(result.bundle), true);
        });
    });

    suite('the revision chain', function () {
        let env: Env;
        setup(async function () {
            env = await freshRuntime();
            await env.runtime.enableLevel('workspace');
        });
        teardown(async function () {
            await env.cleanup();
        });

        test('revise appends a new store record and leaves the prior record untouched (history never mutated)', async function () {
            const written = await seedWrite(env.runtime, { level: 'workspace', entryId: 'rev-1', content: 'the original content' });
            const revision = await env.runtime.revise('rev-1', { content: 'the revised content', provenance: operatorEntry(NOW_LATER), actor: 'human', revisedAtIso: NOW_LATER });
            assert.notStrictEqual(revision.storeRecord.id, written.storeRecord.id);
            const prior = await env.runtime.store.get(written.storeRecord.id);
            assert.ok(prior !== undefined, 'the prior record must still exist (the revision-append law)');
            assert.strictEqual(prior?.content, 'the original content');
            const listed = await env.runtime.list(workspaceQuery());
            assert.strictEqual(listed.entries[0].revisions, 2);
        });

        test('the derived chain verifies (verifyRevisionChain) and the revision digest chains', async function () {
            const written = await seedWrite(env.runtime, { level: 'workspace', entryId: 'rev-1', content: 'the original content' });
            const revision = await env.runtime.revise('rev-1', { content: 'the revised content', provenance: operatorEntry(NOW_LATER), actor: 'human', revisedAtIso: NOW_LATER });
            assert.strictEqual(revision.chain.length, 2);
            assert.strictEqual(revision.chainVerified, true);
            assert.strictEqual(EntryContract.verifyRevisionChain(revision.chain), true);
            assert.strictEqual(revision.chain[1].revisionDigest, revision.entry.revisionDigest);
            assert.notStrictEqual(revision.entry.revisionDigest, written.entry.revisionDigest);
            assert.strictEqual(revision.entry.contentDigest, EntryContract.contentDigestOf('the revised content'));
            assert.strictEqual(revision.prior.revisionDigest, written.entry.revisionDigest);
        });

        test('the mirror pin: the runtime\'s derived genesis digest equals the contract\'s admitEntry digest', async function () {
            const content = 'the mirror pin content';
            const written = await env.runtime.write({
                level: 'workspace',
                projectRef: undefined,
                entryId: 'mirror-1',
                kind: 'fact',
                content,
                provenance: operatorEntry(NOW),
                actor: 'human',
                admittedAtIso: NOW,
            });
            const admission = EntryContract.admitEntry({
                scope: SCOPE,
                level: 'workspace',
                projectRef: undefined,
                entryId: 'mirror-1',
                kind: 'fact',
                content,
                provenance: operatorEntry(NOW),
                admittedAtIso: NOW,
            });
            assert.strictEqual(admission.kind, 'admitted');
            assert.strictEqual(admission.entry.revisionDigest, written.entry.revisionDigest);
            const listed = await env.runtime.list(workspaceQuery());
            assert.strictEqual(listed.entries[0].entry.revisionDigest, written.entry.revisionDigest);
            assert.strictEqual(listed.entries[0].entry.contentDigest, EntryContract.contentDigestOf(content));
            assert.strictEqual(listed.entries[0].entry.provenance.origin, 'operator-entry');
            assert.strictEqual(listed.entries[0].entry.createdAtIso, NOW);
        });

        test('a secret-shaped revision is refused and the chain is not extended', async function () {
            await seedWrite(env.runtime, { level: 'workspace', entryId: 'rev-2', content: 'the original content' });
            await expectTypedError('SECRET-SHAPED-CONTENT', () => env.runtime.revise('rev-2', { content: 'the api_key = "short" leak', provenance: operatorEntry(NOW_LATER), actor: 'human', revisedAtIso: NOW_LATER }), (err) => {
                assert.strictEqual(err.family, 'credential-shaped-key');
            });
            const listed = await env.runtime.list(workspaceQuery());
            assert.strictEqual(listed.entries[0].revisions, 1);
        });

        test('revising an unknown entry is a typed NOT-FOUND', async function () {
            await expectTypedError('NOT-FOUND', () => env.runtime.revise('missing-entry', { content: 'the revised content', provenance: operatorEntry(NOW_LATER), actor: 'human', revisedAtIso: NOW_LATER }));
        });
    });

    suite('honest-gap typed refusals (delete-shaped requests)', function () {
        let env: Env;
        setup(async function () {
            env = await freshRuntime();
            await enableAll(env.runtime);
            await seedWrite(env.runtime, { level: 'user', entryId: 'del-1' });
        });
        teardown(async function () {
            await env.cleanup();
        });

        test('deleteEntry is refused typedly with the disclosed reason', async function () {
            await expectTypedError('HONEST-GAP', () => env.runtime.deleteEntry({ level: 'user', entryId: 'del-1', deletedAtIso: NOW_LATER }), (err) => {
                assert.match(err.message, /per-record delete surface/);
                assert.match(err.message, /fabricated evidence/);
            });
        });

        test('the refusal is universal (any delete-shaped request, whatever the shape)', async function () {
            await expectTypedError('HONEST-GAP', () => env.runtime.deleteEntry({}));
            await expectTypedError('HONEST-GAP', () => env.runtime.deleteEntry({ level: 'workspace', entryId: 'anything', deletedAtIso: '2026-10-07T06:00:00Z' }));
        });
    });

    suite('dispose law', function () {
        let env: Env;
        setup(async function () {
            env = await freshRuntime();
            await enableAll(env.runtime);
            await seedWrite(env.runtime, { level: 'workspace', entryId: 'dispose-1' });
        });
        teardown(async function () {
            await env.cleanup();
        });

        test('every operation class rejects with DISPOSED after dispose', async function () {
            env.runtime.dispose();
            await expectTypedError('DISPOSED', () => seedWrite(env.runtime, { level: 'workspace', entryId: 'after-dispose' }));
            await expectTypedError('DISPOSED', () => env.runtime.list(workspaceQuery()));
            await expectTypedError('DISPOSED', () => env.runtime.get('dispose-1', workspaceQuery()));
            await expectTypedError('DISPOSED', () => env.runtime.revise('dispose-1', { content: 'x', provenance: operatorEntry(NOW_LATER), actor: 'human', revisedAtIso: NOW_LATER }));
            await expectTypedError('DISPOSED', () => env.runtime.enablement());
            await expectTypedError('DISPOSED', () => env.runtime.enableLevel('user'));
            await expectTypedError('DISPOSED', () => env.runtime.retentionVerdicts('user'));
            await expectTypedError('DISPOSED', () => env.runtime.applyRetention('user'));
            await expectTypedError('DISPOSED', () => env.runtime.exportLevel('user'));
            await expectTypedError('DISPOSED', () => env.runtime.verify());
            await expectTypedError('DISPOSED', () => env.runtime.deleteEntry({}));
            await expectTypedError('DISPOSED', () => env.runtime.move('MEM-P-000001', 'user', { reason: 'r', actor: 'human', humanApproved: true }));
        });

        test('dispose is idempotent', function () {
            env.runtime.dispose();
            env.runtime.dispose();
        });
    });

    suite('determinism', function () {
        let env: Env;
        setup(async function () {
            env = await freshRuntime();
            await enableAll(env.runtime);
        });
        teardown(async function () {
            await env.cleanup();
        });

        test('the law-comment grep: banned tokens live in comment lines only (runtime + suite)', function () {
            const banned = /Date\.now|Math\.random|new Date\(/;
            for (const file of ['memoryRuntime.ts', 'memoryRuntime.test.ts']) {
                const source = readFileSync(join(RUNTIME_DIR, file), 'utf-8');
                for (const [index, line] of source.split('\n').entries()) {
                    if (!banned.test(line)) {
                        continue;
                    }
                    const trimmed = line.trim();
                    assert.ok(
                        trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*'),
                        `${file} line ${String(index + 1)}: the determinism-law token appears outside a comment: ${trimmed}`,
                    );
                }
            }
        });

        test('the pure ISO converters: anchors + round-trips (no calendar objects)', function () {
            assert.strictEqual(epochMsToIsoUtc(0), '1970-01-01T00:00:00Z');
            for (const instant of ['1970-01-01T00:00:00Z', '2000-02-29T12:34:56Z', '2026-10-07T04:00:00Z', '1999-12-31T23:59:59Z']) {
                assert.strictEqual(epochMsToIsoUtc(isoToEpochMs(instant)), instant, `round-trip ${instant}`);
            }
            assert.strictEqual(isoToEpochMs('not-a-date'), Number.NaN);
            assert.strictEqual(epochMsToIsoUtc(isoToEpochMs('2026-10-07T04:00:00.500Z')), '2026-10-07T04:00:00Z');
        });

        test('two-root byte equality: identical roots + op sequences produce identical journals', async function () {
            const runs: { enablement: string; session: string; project: string }[] = [];
            for (let index = 0; index < 2; index++) {
                const root = await fsPromises.mkdtemp(join(tmpdir(), 'flauz-memrt-det-'));
                try {
                    const runtime = new MemoryRuntime({ root, fs: nodeFsPort(), clock: makeClock(2_000_000).now, scope: SCOPE });
                    await runtime.ensure();
                    await runtime.enableLevel('user');
                    await runtime.enableLevel('workspace');
                    await seedWrite(runtime, { level: 'user', entryId: 'det-user-1' });
                    await seedWrite(runtime, { level: 'workspace', entryId: 'det-ws-1' });
                    runs.push({
                        enablement: await fsPromises.readFile(join(root, MEMORY_RUNTIME_ENABLEMENT_DIR, 'changes.jsonl'), 'utf-8'),
                        session: await fsPromises.readFile(join(root, '.flauz/memory/session.jsonl'), 'utf-8'),
                        project: await fsPromises.readFile(join(root, '.flauz/memory/project.jsonl'), 'utf-8'),
                    });
                    runtime.dispose();
                } finally {
                    await fsPromises.rm(root, { recursive: true, force: true });
                }
            }
            assert.strictEqual(runs[0].enablement, runs[1].enablement);
            assert.strictEqual(runs[0].session, runs[1].session);
            assert.strictEqual(runs[0].project, runs[1].project);
        });

        test('the read-back derivation is stable across repeated reads', async function () {
            await seedWrite(env.runtime, { level: 'workspace', entryId: 'stable-1' });
            const first = await env.runtime.list(workspaceQuery());
            const second = await env.runtime.list(workspaceQuery());
            assert.deepEqual(JSON.parse(JSON.stringify(second)), JSON.parse(JSON.stringify(first)));
        });
    });

    suite('consistency (verify)', function () {
        let env: Env;
        setup(async function () {
            env = await freshRuntime();
            await enableAll(env.runtime);
            await seedWrite(env.runtime, { level: 'user', entryId: 'ver-user-1' });
            await seedWrite(env.runtime, { level: 'project', entryId: 'ver-proj-1', projectRef: 'T-002' });
            await seedWrite(env.runtime, { level: 'workspace', entryId: 'ver-ws-1' });
        });
        teardown(async function () {
            await env.cleanup();
        });

        test('verify passes on a clean seeded state with the enablement + bridged disclosure', async function () {
            const verdict = await env.runtime.verify();
            assert.strictEqual(verdict.ok, true);
            assert.deepEqual(verdict.problems, []);
            assert.strictEqual(verdict.records, 3);
            assert.deepEqual(verdict.disclosure.enabledLevels, ['user', 'project', 'workspace']);
            assert.deepEqual(verdict.disclosure.bridgedCounts, { user: 1, project: 1, workspace: 1 });
        });

        test('a corrupted enablement journal line is a verify problem (fail-closed)', async function () {
            await fsPromises.appendFile(join(env.root, MEMORY_RUNTIME_ENABLEMENT_DIR, 'changes.jsonl'), 'garbage\n', 'utf-8');
            const verdict = await env.runtime.verify();
            assert.strictEqual(verdict.ok, false);
            assert.ok(verdict.problems.some((problem) => problem.includes('enablement audit-trail journal line')));
        });

        test('a corrupted store journal line surfaces through the store pass-through', async function () {
            await fsPromises.appendFile(join(env.root, PROJECT_JOURNAL_PATH), 'garbage\n', 'utf-8');
            const verdict = await env.runtime.verify();
            assert.strictEqual(verdict.ok, false);
            assert.ok(verdict.problems.some((problem) => problem.includes('project.jsonl')));
        });
    });

    test('a foreign-scope query is refused typedly (the runtime is scope-bound)', async function () {
        const env = await freshRuntime();
        try {
            await enableAll(env.runtime);
            await seedWrite(env.runtime, { level: 'user', entryId: 'scope-1' });
            await expectTypedError('SCOPE-MISMATCH', () => env.runtime.list({ scope: OTHER_SCOPE, context: 'user', projectRef: undefined }));
        } finally {
            await env.cleanup();
        }
    });

    test('a duplicate entryId write is refused typedly (a second genesis would break the chain)', async function () {
        const env = await freshRuntime();
        try {
            await enableAll(env.runtime);
            await seedWrite(env.runtime, { level: 'workspace', entryId: 'dup-1' });
            await expectTypedError('DUPLICATE-ENTRY-ID', () => seedWrite(env.runtime, { level: 'workspace', entryId: 'dup-1' }));
        } finally {
            await env.cleanup();
        }
    });

    test('the provenance origins round-trip through the bridge (task-evidence, operator-entry, derived)', async function () {
        const env = await freshRuntime();
        try {
            await enableAll(env.runtime);
            await seedWrite(env.runtime, { level: 'workspace', entryId: 'rt-evidence-1', provenance: taskEvidence(NOW, 'E-000042') });
            await seedWrite(env.runtime, { level: 'workspace', entryId: 'rt-operator-1', provenance: operatorEntry(NOW) });
            const digest = EntryContract.digestOf('input', 'x');
            await seedWrite(env.runtime, { level: 'workspace', entryId: 'rt-derived-1', provenance: derivedProvenance(NOW, [digest]) });
            const listed = await env.runtime.list(workspaceQuery());
            const byId = new Map(listed.entries.map((entry) => [entry.entry.entryId, entry.entry.provenance] as const));
            assert.deepEqual(byId.get('rt-evidence-1'), { origin: 'task-evidence', evidenceKind: 'note', evidenceRef: 'E-000042', capturedAtIso: NOW });
            assert.deepEqual(byId.get('rt-operator-1'), { origin: 'operator-entry', capturedAtIso: NOW });
            assert.deepEqual(byId.get('rt-derived-1'), { origin: 'derived', inputDigests: [digest], capturedAtIso: NOW });
            const records = await env.runtime.store.listAll();
            const evidenceRecord = records.find((record) => record.tags.includes('e-rt-evidence-1'));
            assert.strictEqual(evidenceRecord?.provenance.origin, 'ledger-row');
            assert.strictEqual(evidenceRecord?.provenance.evidenceId, 'E-000042');
            assert.ok(evidenceRecord?.tags.includes('ek-note'));
            assert.ok(evidenceRecord?.tags.includes('k-fact'));
            assert.ok(evidenceRecord?.tags.includes(BRIDGE_MARKER_TAG));
            assert.ok(evidenceRecord?.tags.includes(`${ENTRY_TAG_PREFIX}rt-evidence-1`));
            assert.ok(evidenceRecord?.tags.includes(`${KIND_TAG_PREFIX}fact`));
        } finally {
            await env.cleanup();
        }
    });

    test('task-evidence content with a screenshot evidence kind rides the ek- tag (lossless round-trip)', async function () {
        const env = await freshRuntime();
        try {
            await enableAll(env.runtime);
            await env.runtime.write({
                level: 'workspace',
                projectRef: undefined,
                entryId: 'shot-1',
                kind: 'reference',
                content: 'the dashboard screenshot reference',
                provenance: { origin: 'task-evidence', evidenceKind: 'screenshot', evidenceRef: 'E-000043', capturedAtIso: NOW },
                actor: 'agent',
                admittedAtIso: NOW,
            });
            const listed = await env.runtime.list(workspaceQuery());
            assert.deepEqual(listed.entries[0].entry.provenance, { origin: 'task-evidence', evidenceKind: 'screenshot', evidenceRef: 'E-000043', capturedAtIso: NOW });
            const records = await env.runtime.store.listAll();
            assert.ok(records.some((record) => record.tags.includes('ek-screenshot') && record.tags.includes('k-reference')));
        } finally {
            await env.cleanup();
        }
    });
});
