/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The store tests: the append-only `.flauz/task-resources.jsonl` ledger
 * (canonical JSON byte law, MANDATORY actor, fail-closed writes) + crash
 * recovery (verify() re-derives the lease-state chain from the ledger) +
 * the hand-off round-trip through the store (export -> restore with the
 * lease ids + bundle id surviving).
 */
import { test } from 'node:test';
import { ok, strictEqual, deepStrictEqual, throws } from 'node:assert';
import {
        TaskResourceStore,
        parseLedger,
        parseLedgerRecord,
        serializeLedgerRecord,
        deriveIndex,
        latestLease,
        activeLeasesFor,
        hasConflict,
        type TaskResourceLedgerRecord,
} from '../../src/resourceExec/store.ts';
import {
        applyLeaseOp,
        buildLease,
        activateLease,
        releaseLease,
        rollbackLease,
        rollbackAllActive,
        validateProvenance,
        type TaskResourceLease,
        type TaskResourceProvenance,
} from '../../src/resourceExec/contracts.ts';
import { canonicalJson, TaskResourceError } from '../../src/resourceExec/types.ts';
import { bootTempWorkspace, deterministicLeaseMinter, deterministicHandOffMinter, steppingClock, failingFsPort, memoryFsPort } from './helpers.ts';

const actor: TaskResourceProvenance = { actor: 'agent', actorId: 'flauz-agent', taskId: 'T-001' };

function makeLease(leaseId: string, taskId: string, resourceId: string, kind: 'browser-session' | 'environment' | 'resource-ref', state: 'acquiring' | 'active' | 'released' = 'active'): TaskResourceLease {
        const base = buildLease({
                leaseId,
                taskId,
                resourceKind: kind,
                resourceId,
                actor: { actor: 'agent', actorId: 'flauz-agent', taskId },
                now: 1730000000000,
        });
        if (state === 'active') {
                return activateLease(base, 1730000000001);
        }
        if (state === 'released') {
                const active = activateLease(base, 1730000000001);
                return releaseLease(active, 1730000000002);
        }
        return base;
}

test('appendLease: writes ONE canonical-JSON record + exactly one \\n per call', async () => {
        const { root, fs, cleanup } = await bootTempWorkspace();
        try {
                const store = new TaskResourceStore({
                        workspaceRoot: root,
                        fs,
                        clock: steppingClock(1730000000000),
                        leaseMinter: deterministicLeaseMinter(),
                });
                const lease = makeLease('flauz:lease:0000000000000001', 'T-001', 'flauz:browser:0123456789abcdef', 'browser-session');
                const result = await store.appendLease(lease);
                ok(result.ok);
                const raw = await fs.readFileUtf8(`${root}/.flauz/task-resources.jsonl`);
                ok(raw !== undefined);
                strictEqual(raw, serializeLedgerRecord({
                        schemaVersion: 0,
                        schema: 'flauz.task-resources/v0',
                        kind: 'lease',
                        ts: 1730000000000,
                        actor: 'agent',
                        taskId: 'T-001',
                        lease,
                }) + '\n');
        } finally {
                await cleanup();
        }
});

test('appendLease: MANDATORY actor (a lease missing the actor fails closed with OP_INVALID)', async () => {
        const { root, fs, cleanup } = await bootTempWorkspace();
        try {
                const store = new TaskResourceStore({
                        workspaceRoot: root,
                        fs,
                        clock: steppingClock(1730000000000),
                        leaseMinter: deterministicLeaseMinter(),
                });
                const bad = {
                        schemaVersion: 0,
                        schema: 'flauz.task-resources/v0',
                        leaseId: 'flauz:lease:0000000000000001',
                        taskId: 'T-001',
                        resourceKind: 'browser-session',
                        resourceId: 'flauz:browser:0123456789abcdef',
                        actor: { taskId: 'T-001' }, // missing actor field
                        state: 'active',
                        acquiredAt: 1730000000000,
                };
                const result = await store.appendLease(bad);
                ok(!result.ok);
                strictEqual(result.error.code, 'OP_INVALID');
                ok(/PROVENANCE_INVALID/.test(result.error.message) || /actor/.test(result.error.message));
        } finally {
                await cleanup();
        }
});

test('appendLease: STORE_FAILED on a write failure (fail-closed; in-memory state rolled back)', async () => {
        const store = new TaskResourceStore({
                workspaceRoot: '/nonexistent',
                fs: failingFsPort('disk full'),
                clock: steppingClock(1730000000000),
                leaseMinter: deterministicLeaseMinter(),
        });
        const lease = makeLease('flauz:lease:0000000000000001', 'T-001', 'flauz:browser:0123456789abcdef', 'browser-session');
        const result = await store.appendLease(lease);
        ok(!result.ok);
        strictEqual(result.error.code, 'STORE_FAILED');
        ok(/disk full/.test(result.error.message));
});

test('appendLease: corruption fails closed BEFORE extending (history is never silently mutated)', async () => {
        const { root, fs, cleanup } = await bootTempWorkspace();
        try {
                // pre-write a corrupt ledger
                await fs.writeFile(`${root}/.flauz/task-resources.jsonl`, '{not-valid-json\n');
                const store = new TaskResourceStore({
                        workspaceRoot: root,
                        fs,
                        clock: steppingClock(1730000000000),
                        leaseMinter: deterministicLeaseMinter(),
                });
                const lease = makeLease('flauz:lease:0000000000000001', 'T-001', 'flauz:browser:0123456789abcdef', 'browser-session');
                const result = await store.appendLease(lease);
                ok(!result.ok);
                strictEqual(result.error.code, 'STORE_FAILED');
                ok(/corrupt/.test(result.error.message));
                // the corrupt ledger is preserved byte-for-byte (no extension)
                const raw = await fs.readFileUtf8(`${root}/.flauz/task-resources.jsonl`);
                strictEqual(raw, '{not-valid-json\n');
        } finally {
                await cleanup();
        }
});

test('appendLease: appends preserve every existing byte (history is never rewritten)', async () => {
        const { root, fs, cleanup } = await bootTempWorkspace();
        try {
                const store = new TaskResourceStore({
                        workspaceRoot: root,
                        fs,
                        clock: steppingClock(1730000000000),
                        leaseMinter: deterministicLeaseMinter(),
                });
                const lease1 = makeLease('flauz:lease:0000000000000001', 'T-001', 'flauz:browser:0123456789abcdef', 'browser-session');
                const lease2 = makeLease('flauz:lease:0000000000000002', 'T-001', 'flauz:environment:env-fixture-attached', 'environment');
                await store.appendLease(lease1);
                const raw1 = await fs.readFileUtf8(`${root}/.flauz/task-resources.jsonl`);
                await store.appendLease(lease2);
                const raw2 = await fs.readFileUtf8(`${root}/.flauz/task-resources.jsonl`);
                ok(raw2!.startsWith(raw1!), 'the prior bytes are preserved byte-for-byte (append-only)');
                strictEqual(raw2!.split('\n').length - 1, 2, 'two records = two lines');
        } finally {
                await cleanup();
        }
});

test('verify(): re-derives the lease-state chain from the ledger (the ledger is the durable truth)', async () => {
        const { root, fs, cleanup } = await bootTempWorkspace();
        try {
                const clock = steppingClock(1730000000000);
                const store = new TaskResourceStore({
                        workspaceRoot: root,
                        fs,
                        clock,
                        leaseMinter: deterministicLeaseMinter(),
                });
                const lease1 = makeLease('flauz:lease:0000000000000001', 'T-001', 'flauz:browser:0123456789abcdef', 'browser-session');
                const lease2 = makeLease('flauz:lease:0000000000000002', 'T-001', 'flauz:environment:env-fixture-attached', 'environment');
                await store.appendLease(lease1);
                await store.appendLease(lease2);
                // release lease1
                const released = releaseLease({ ...lease1, state: 'active' }, 1730000000100);
                await store.appendLease(released);

                const index = await store.verify();
                strictEqual(index.leases.size, 2, 'two distinct lease ids');
                strictEqual(index.leases.get('flauz:lease:0000000000000001')!.state, 'released');
                strictEqual(index.leases.get('flauz:lease:0000000000000002')!.state, 'active');
                // activeByTask: T-001 has 1 active lease (lease2; lease1 was released)
                strictEqual((index.activeByTask.get('T-001') ?? []).length, 1);
                strictEqual(index.activeByTask.get('T-001')![0]!.leaseId, 'flauz:lease:0000000000000002');
        } finally {
                await cleanup();
        }
});

test('crash recovery: a fresh store boots from the existing ledger (no in-memory state survives)', async () => {
        const { root, fs, cleanup } = await bootTempWorkspace();
        try {
                const clock = steppingClock(1730000000000);
                const store1 = new TaskResourceStore({
                        workspaceRoot: root,
                        fs,
                        clock,
                        leaseMinter: deterministicLeaseMinter(),
                });
                const lease1 = makeLease('flauz:lease:0000000000000001', 'T-001', 'flauz:browser:0123456789abcdef', 'browser-session');
                const lease2 = makeLease('flauz:lease:0000000000000002', 'T-002', 'flauz:file:4d5e6f708192a3b4', 'resource-ref');
                await store1.appendLease(lease1);
                await store1.appendLease(lease2);

                // CRASH: drop the in-memory state (simulated by constructing a new store)
                const store2 = new TaskResourceStore({
                        workspaceRoot: root,
                        fs,
                        clock,
                        leaseMinter: deterministicLeaseMinter(),
                });
                const index = await store2.verify();
                strictEqual(index.leases.size, 2, 'the new store rebuilds the lease obligations from the ledger');
                strictEqual(index.leases.get('flauz:lease:0000000000000001')!.state, 'active');
                strictEqual(index.leases.get('flauz:lease:0000000000000002')!.state, 'active');
        } finally {
                await cleanup();
        }
});

test('hasConflict: detects a task already holding an active lease for the resource id (LEASE_CONFLICT detection)', async () => {
        const { root, fs, cleanup } = await bootTempWorkspace();
        try {
                const store = new TaskResourceStore({
                        workspaceRoot: root,
                        fs,
                        clock: steppingClock(1730000000000),
                        leaseMinter: deterministicLeaseMinter(),
                });
                const lease1 = makeLease('flauz:lease:0000000000000001', 'T-001', 'flauz:browser:0123456789abcdef', 'browser-session');
                await store.appendLease(lease1);
                const index = await store.verify();
                ok(hasConflict(index, 'T-001', 'flauz:browser:0123456789abcdef'), 'T-001 already holds an active lease for the browser session');
                ok(!hasConflict(index, 'T-002', 'flauz:browser:0123456789abcdef'), 'T-002 does not hold a lease for it');
                ok(!hasConflict(index, 'T-001', 'flauz:browser:9999999999999999'), 'T-001 does not hold a lease for a different resource');
        } finally {
                await cleanup();
        }
});

test('rollback completeness through the store: 3 active leases that fail produce 3 typed release records -- none silently dropped', async () => {
        const { root, fs, cleanup } = await bootTempWorkspace();
        try {
                const store = new TaskResourceStore({
                        workspaceRoot: root,
                        fs,
                        clock: steppingClock(1730000000000),
                        leaseMinter: deterministicLeaseMinter(),
                });
                const lease1 = makeLease('flauz:lease:0000000000000001', 'T-001', 'flauz:browser:0123456789abcdef', 'browser-session');
                const lease2 = makeLease('flauz:lease:0000000000000002', 'T-001', 'flauz:environment:env-fixture-attached', 'environment');
                const lease3 = makeLease('flauz:lease:0000000000000003', 'T-001', 'flauz:file:4d5e6f708192a3b4', 'resource-ref');
                await store.appendLease(lease1);
                await store.appendLease(lease2);
                await store.appendLease(lease3);
                const index = await store.verify();
                const active = activeLeasesFor(index, 'T-001');
                strictEqual(active.length, 3);

                // rollback all 3
                const rolled = rollbackAllActive(active, 1730000000100, 'task failed');
                strictEqual(rolled.released.length, 3);
                strictEqual(rolled.failed.length, 0);
                // persist each rolled-back lease
                for (const lease of rolled.released) {
                        await store.appendLease(lease);
                }
                // verify the store now sees all 3 as rolled-back
                const index2 = await store.verify();
                strictEqual((index2.activeByTask.get('T-001') ?? []).length, 0, 'no active leases remain');
                const all3 = [lease1, lease2, lease3].map(l => latestLease(index2, l.leaseId)!);
                for (const l of all3) {
                        strictEqual(l.state, 'rolled-back');
                        strictEqual(l.release!.outcome, 'rolled-back');
                }
        } finally {
                await cleanup();
        }
});

test('hand-off round-trip through the store: export (with bundle id + lease ids) -> restore (re-bind)', async () => {
        const { root, fs, cleanup } = await bootTempWorkspace();
        try {
                const clock = steppingClock(1730000000000);
                const store = new TaskResourceStore({
                        workspaceRoot: root,
                        fs,
                        clock,
                        leaseMinter: deterministicLeaseMinter(),
                        handOffMinter: deterministicHandOffMinter(),
                });
                const lease1 = makeLease('flauz:lease:0000000000000001', 'T-001', 'flauz:browser:0123456789abcdef', 'browser-session');
                const lease2 = makeLease('flauz:lease:0000000000000002', 'T-001', 'flauz:environment:env-fixture-attached', 'environment');
                await store.appendLease(lease1);
                await store.appendLease(lease2);

                // export-point hand-off: carry both lease ids + the bundle id
                const exportRecord = {
                        schemaVersion: 0 as const,
                        schema: 'flauz.task-resources/v0' as const,
                        kind: 'export' as const,
                        handOffId: store.mintHandOffId(),
                        taskId: 'T-001',
                        actor: { actor: 'agent' as const, actorId: 'flauz-agent', taskId: 'T-001' },
                        ts: clock(),
                        continuityBundleId: 'flauz:continuity:0123456789abcdef',
                        leaseIds: ['flauz:lease:0000000000000001', 'flauz:lease:0000000000000002'],
                };
                const exportResult = await store.appendHandOff(exportRecord);
                ok(exportResult.ok);

                // restore-point hand-off: re-bind the lease ids; the bundle id survives
                const restoreRecord = {
                        schemaVersion: 0 as const,
                        schema: 'flauz.task-resources/v0' as const,
                        kind: 'restore' as const,
                        handOffId: store.mintHandOffId(),
                        taskId: 'T-001',
                        actor: { actor: 'agent' as const, actorId: 'flauz-agent', taskId: 'T-001' },
                        ts: clock(),
                        continuityBundleId: 'flauz:continuity:0123456789abcdef', // survived the round-trip
                        leaseIds: ['flauz:lease:0000000000000001', 'flauz:lease:0000000000000002'],
                        rebind: {
                                'flauz:lease:0000000000000001': { outcome: 're-bound' as const },
                                'flauz:lease:0000000000000002': { outcome: 're-bound' as const },
                        },
                };
                const restoreResult = await store.appendHandOff(restoreRecord);
                ok(restoreResult.ok);

                // verify the index sees both hand-offs
                const index = await store.verify();
                const handOffs = index.handOffs.get('T-001') ?? [];
                strictEqual(handOffs.length, 2);
                strictEqual(handOffs[0]!.kind, 'export');
                strictEqual(handOffs[1]!.kind, 'restore');
                strictEqual(handOffs[0]!.continuityBundleId, 'flauz:continuity:0123456789abcdef');
                strictEqual(handOffs[1]!.continuityBundleId, 'flauz:continuity:0123456789abcdef', 'the bundle id survived the round-trip');
                deepStrictEqual([...handOffs[1]!.leaseIds], ['flauz:lease:0000000000000001', 'flauz:lease:0000000000000002']);
        } finally {
                await cleanup();
        }
});

test('the ledger byte law: every record is canonical (sorted keys, no insignificant whitespace)', async () => {
        const { root, fs, cleanup } = await bootTempWorkspace();
        try {
                const store = new TaskResourceStore({
                        workspaceRoot: root,
                        fs,
                        clock: steppingClock(1730000000000),
                        leaseMinter: deterministicLeaseMinter(),
                });
                const lease = makeLease('flauz:lease:0000000000000001', 'T-001', 'flauz:browser:0123456789abcdef', 'browser-session');
                await store.appendLease(lease);
                const raw = await fs.readFileUtf8(`${root}/.flauz/task-resources.jsonl`);
                const line = raw!.split('\n')[0]!;
                // re-derive the canonical form and compare bytes
                const parsed = JSON.parse(line);
                strictEqual(line, canonicalJson(parsed), 'the line is byte-identical to its canonical serialization');
                strictEqual(raw!.endsWith('\n'), true, 'exactly one trailing newline');
                strictEqual(raw!.endsWith('\n\n'), false, 'no double trailing newline');
        } finally {
                await cleanup();
        }
});

test('parseLedgerRecord: rejects a record with an extra key (the closed key set)', () => {
        const bad = {
                schemaVersion: 0,
                schema: 'flauz.task-resources/v0',
                kind: 'lease',
                ts: 1730000000000,
                actor: 'agent',
                taskId: 'T-001',
                lease: makeLease('flauz:lease:0000000000000001', 'T-001', 'flauz:browser:0123456789abcdef', 'browser-session'),
                unexpected: 'no',
        };
        throws(
                () => parseLedgerRecord(bad, 1),
                (err: unknown) => err instanceof TaskResourceError && err.code === 'OP_INVALID',
        );
});

test('serializeLedgerRecord: round-trips (parse(serialize(r)) === r)', () => {
        const record: TaskResourceLedgerRecord = {
                schemaVersion: 0,
                schema: 'flauz.task-resources/v0',
                kind: 'lease',
                ts: 1730000000000,
                actor: 'agent',
                taskId: 'T-001',
                lease: makeLease('flauz:lease:0000000000000001', 'T-001', 'flauz:browser:0123456789abcdef', 'browser-session'),
        };
        const serialized = serializeLedgerRecord(record);
        const parsed = JSON.parse(serialized);
        deepStrictEqual(parsed, record);
});

test('memoryFsPort: in-memory fs round-trips (no disk touched; deterministic + fast)', async () => {
        const fs = memoryFsPort();
        const store = new TaskResourceStore({
                workspaceRoot: '/workspace',
                fs,
                clock: steppingClock(1730000000000),
                leaseMinter: deterministicLeaseMinter(),
        });
        const lease = makeLease('flauz:lease:0000000000000001', 'T-001', 'flauz:browser:0123456789abcdef', 'browser-session');
        const result = await store.appendLease(lease);
        ok(result.ok);
        const files = fs.files as Map<string, string>;
        const written = files.get('/workspace/.flauz/task-resources.jsonl');
        ok(written !== undefined, 'the ledger file was written');
        strictEqual(written!.endsWith('\n'), true);
});
