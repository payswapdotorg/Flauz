/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import {
    isDigest,
    PROJECT_MEMORY_TTL_DAYS,
    SCOPED_MEMORY_CONTRACTS_VERSION,
    USER_MEMORY_TTL_DAYS,
    WORKSPACE_MEMORY_TTL_DAYS,
    applyRetention,
    defaultRetentionPolicy,
    deleteEntry,
    epochDaysToIsoUtc,
    exportLevel,
    isDeleteReceipt,
    isMemoryEnablementRecord,
    isMemoryEntryRecord,
    isRetentionPolicy,
    isoToEpochDays,
    retentionVerdict,
    verifyExportBundle
} from '../../common/lifecycle.js';
import type {
    DeleteReceipt,
    DeleteResult,
    ExportBundle,
    ExportRequest,
    ExportResult,
    MemoryEnablementRecord,
    MemoryEntryRecord,
    MemoryLevel,
    MemoryRecordScope,
    RetentionApplication,
    RetentionApplicationResult,
    RetentionPolicy
} from '../../common/lifecycle.js';
import { admitEntry } from '../../common/entry.js';
import type { MemoryProvenance } from '../../common/entry.js';
import { defaultEnablement, disableLevel, enableLevel } from '../../common/enablement.js';

const SCOPE: MemoryRecordScope = { tenantId: 'tenant-1', workspaceId: 'ws-1' };
const T0 = '2025-01-01T00:00:00Z';
const T1 = '2025-01-02T00:00:00Z';
const T2 = '2025-01-03T00:00:00Z';
const BASE_DAY = 20089;

function admitRealEntry(entryId: string, level: MemoryLevel, createdAtIso: string, scope: MemoryRecordScope = SCOPE, provenance?: MemoryProvenance): MemoryEntryRecord {
    const outcome = admitEntry({
        scope,
        level,
        projectRef: level === 'project' ? 'proj-1' : undefined,
        entryId,
        kind: 'fact',
        content: `Scoped memory content for ${entryId}.`,
        provenance: provenance ?? { origin: 'operator-entry', capturedAtIso: createdAtIso },
        admittedAtIso: createdAtIso
    });
    if (outcome.kind !== 'admitted') {
        throw new Error(`expected an admitted entry, received: ${JSON.stringify(outcome)}`);
    }
    return outcome.entry;
}

const POLICY: RetentionPolicy = defaultRetentionPolicy(SCOPE, T0);
const REAL_USER_ENTRY: MemoryEntryRecord = admitRealEntry('real-user-entry', 'user', T0);
const REAL_ENABLED_USER: MemoryEnablementRecord = enableLevel(defaultEnablement(SCOPE, T0), 'user', T1).enablement;

function expectApplied(result: RetentionApplicationResult): RetentionApplication {
    if (result.kind === 'applied') {
        return result.application;
    }
    throw new Error(`expected an applied retention, received refusal: ${JSON.stringify(result)}`);
}

function expectRetentionRefusal(result: RetentionApplicationResult): Exclude<RetentionApplicationResult, { kind: 'applied' }> {
    if (result.kind === 'refusal') {
        return result;
    }
    throw new Error(`expected a retention refusal, received: ${JSON.stringify(result)}`);
}

function expectDeleted(result: DeleteResult): DeleteReceipt {
    if (result.kind === 'deleted') {
        return result.receipt;
    }
    throw new Error(`expected a deleted receipt, received refusal: ${JSON.stringify(result)}`);
}

function expectDeleteRefusal(result: DeleteResult): Exclude<DeleteResult, { kind: 'deleted' }> {
    if (result.kind === 'refusal') {
        return result;
    }
    throw new Error(`expected a delete refusal, received: ${JSON.stringify(result)}`);
}

function expectExported(result: ExportResult): ExportBundle {
    if (result.kind === 'exported') {
        return result.bundle;
    }
    throw new Error(`expected an exported bundle, received refusal: ${JSON.stringify(result)}`);
}

function expectExportRefusal(result: ExportResult): Exclude<ExportResult, { kind: 'exported' }> {
    if (result.kind === 'refusal') {
        return result;
    }
    throw new Error(`expected an export refusal, received: ${JSON.stringify(result)}`);
}

suite('zc005 lifecycle: retention policy constants', () => {
    test('the per-level TTLs are the exported plain-number constants; defaultRetentionPolicy assembles them', () => {
        assert.strictEqual(USER_MEMORY_TTL_DAYS, 365);
        assert.strictEqual(PROJECT_MEMORY_TTL_DAYS, 180);
        assert.strictEqual(WORKSPACE_MEMORY_TTL_DAYS, 90);
        const policy = defaultRetentionPolicy(SCOPE, T0);
        assert.deepEqual(policy, {
            scope: SCOPE,
            contractVersion: SCOPED_MEMORY_CONTRACTS_VERSION,
            ttlDays: { user: 365, project: 180, workspace: 90 },
            declaredAtIso: T0
        });
        assert.ok(isRetentionPolicy(policy));
    });

    test('isRetentionPolicy accepts the default policy and rejects malformed ones (battery)', () => {
        assert.ok(!isRetentionPolicy(null));
        assert.ok(!isRetentionPolicy({ scope: null, contractVersion: SCOPED_MEMORY_CONTRACTS_VERSION, ttlDays: { user: 365, project: 180, workspace: 90 }, declaredAtIso: T0 }));
        assert.ok(!isRetentionPolicy({ scope: SCOPE, contractVersion: '0.9.9', ttlDays: { user: 365, project: 180, workspace: 90 }, declaredAtIso: T0 }));
        assert.ok(!isRetentionPolicy({ scope: SCOPE, contractVersion: SCOPED_MEMORY_CONTRACTS_VERSION, ttlDays: { user: -1, project: 180, workspace: 90 }, declaredAtIso: T0 }));
        assert.ok(!isRetentionPolicy({ scope: SCOPE, contractVersion: SCOPED_MEMORY_CONTRACTS_VERSION, ttlDays: { user: 1.5, project: 180, workspace: 90 }, declaredAtIso: T0 }));
        assert.ok(!isRetentionPolicy({ scope: SCOPE, contractVersion: SCOPED_MEMORY_CONTRACTS_VERSION, ttlDays: { user: '365', project: 180, workspace: 90 }, declaredAtIso: T0 }));
        assert.ok(!isRetentionPolicy({ scope: SCOPE, contractVersion: SCOPED_MEMORY_CONTRACTS_VERSION, declaredAtIso: T0 }));
        assert.ok(!isRetentionPolicy({ scope: SCOPE, contractVersion: SCOPED_MEMORY_CONTRACTS_VERSION, ttlDays: { user: 365, project: 180, workspace: 90 }, declaredAtIso: 'today' }));
    });
});

suite('zc005 lifecycle: the injected clock (pure epoch-day conversion)', () => {
    test('isoToEpochDays pins the known day numbers', () => {
        assert.strictEqual(isoToEpochDays('1970-01-01T00:00:00Z'), 0);
        assert.strictEqual(isoToEpochDays('2024-01-01T00:00:00Z'), 19723);
        assert.strictEqual(isoToEpochDays('2024-02-29T00:00:00Z'), 19782);
        assert.strictEqual(isoToEpochDays('2025-01-01T00:00:00Z'), 20089);
        assert.strictEqual(isoToEpochDays('2025-01-01T12:00:00Z'), 20089.5);
        assert.strictEqual(isoToEpochDays('1969-07-20T00:00:00Z'), -165);
    });

    test('isoToEpochDays returns NaN for unparseable or out-of-range stamps (battery)', () => {
        assert.ok(Number.isNaN(isoToEpochDays('not a stamp')));
        assert.ok(Number.isNaN(isoToEpochDays('2025-01-01')));
        assert.ok(Number.isNaN(isoToEpochDays('2025-13-01T00:00:00Z')));
        assert.ok(Number.isNaN(isoToEpochDays('2025-01-32T00:00:00Z')));
        assert.ok(Number.isNaN(isoToEpochDays('2025-01-01T24:00:00Z')));
        assert.ok(Number.isNaN(isoToEpochDays('2025-01-01T00:60:00Z')));
        assert.ok(Number.isNaN(isoToEpochDays('')));
    });

    test('epochDaysToIsoUtc inverts isoToEpochDays over the stamp battery (iterated)', () => {
        const stamps: readonly string[] = [
            '1970-01-01T00:00:00Z',
            '2024-01-01T00:00:00Z',
            '2024-02-29T12:34:56Z',
            '2025-01-01T00:00:00Z',
            '1969-07-20T20:17:40Z',
            '1999-12-31T23:59:59Z',
            '2000-02-29T00:00:00Z'
        ];
        for (const stamp of stamps) {
            assert.strictEqual(epochDaysToIsoUtc(isoToEpochDays(stamp)), stamp, stamp);
        }
    });

    test('epochDaysToIsoUtc renders fractional days with time-of-day and refuses the unrepresentable', () => {
        assert.strictEqual(epochDaysToIsoUtc(0.5), '1970-01-01T12:00:00Z');
        assert.strictEqual(epochDaysToIsoUtc(1.25), '1970-01-02T06:00:00Z');
        assert.strictEqual(epochDaysToIsoUtc(20089.5), '2025-01-01T12:00:00Z');
        assert.strictEqual(epochDaysToIsoUtc(-165), '1969-07-20T00:00:00Z');
        assert.strictEqual(epochDaysToIsoUtc(Number.NaN), '');
        assert.strictEqual(epochDaysToIsoUtc(Number.POSITIVE_INFINITY), '');
        assert.strictEqual(epochDaysToIsoUtc(4000000), '');
    });
});

suite('zc005 lifecycle: cross-contract interchange (the zero-import mirrors)', () => {
    test('a real entry.ts record passes the lifecycle mirror and flows through retention and delete', () => {
        assert.ok(isMemoryEntryRecord(REAL_USER_ENTRY));
        assert.strictEqual(retentionVerdict(REAL_USER_ENTRY, POLICY, isoToEpochDays('2025-06-01T00:00:00Z')), 'retain');
        const deleted = deleteEntry(REAL_USER_ENTRY, T1);
        assert.strictEqual(deleted.kind, 'deleted');
        if (deleted.kind === 'deleted') {
            assert.strictEqual(deleted.receipt.entryId, 'real-user-entry');
            assert.strictEqual(deleted.receipt.level, 'user');
        }
    });

    test('a real enablement.ts record passes the lifecycle mirror and gates export', () => {
        assert.ok(isMemoryEnablementRecord(REAL_ENABLED_USER));
        const exported = exportLevel({ scope: SCOPE, level: 'user', projectRef: undefined, enablement: REAL_ENABLED_USER, entries: [REAL_USER_ENTRY], exportedAtIso: T2 });
        assert.strictEqual(exported.kind, 'exported');
        const disabled = disableLevel(REAL_ENABLED_USER, 'user', T2).enablement;
        const refused = exportLevel({ scope: SCOPE, level: 'user', projectRef: undefined, enablement: disabled, entries: [REAL_USER_ENTRY], exportedAtIso: T2 });
        const refusal = expectExportRefusal(refused);
        assert.strictEqual(refusal.reason, 'level-not-enabled');
    });
});

suite('zc005 lifecycle: retentionVerdict', () => {
    test('a fresh entry within its TTL is retained at every level (iterated)', () => {
        for (const level of ['user', 'project', 'workspace'] as const) {
            const ttl = POLICY.ttlDays[level];
            const entry = admitRealEntry(`fresh-${level}`, level, epochDaysToIsoUtc(BASE_DAY));
            assert.strictEqual(retentionVerdict(entry, POLICY, BASE_DAY + ttl - 1), 'retain', level);
        }
    });

    test('an entry at exactly its TTL expires; the per-level TTLs differ', () => {
        const userEntry = admitRealEntry('age-user', 'user', T0);
        const projectEntry = admitRealEntry('age-project', 'project', T0);
        const workspaceEntry = admitRealEntry('age-workspace', 'workspace', T0);
        assert.strictEqual(retentionVerdict(userEntry, POLICY, BASE_DAY + 365), 'expire');
        assert.strictEqual(retentionVerdict(projectEntry, POLICY, BASE_DAY + 180), 'expire');
        assert.strictEqual(retentionVerdict(workspaceEntry, POLICY, BASE_DAY + 90), 'expire');
        assert.strictEqual(retentionVerdict(userEntry, POLICY, BASE_DAY + 100), 'retain');
        assert.strictEqual(retentionVerdict(projectEntry, POLICY, BASE_DAY + 100), 'retain');
        assert.strictEqual(retentionVerdict(workspaceEntry, POLICY, BASE_DAY + 100), 'expire');
    });

    test('retentionVerdict fails closed toward retention (battery)', () => {
        assert.strictEqual(retentionVerdict(admitRealEntry('future', 'user', '2030-01-01T00:00:00Z'), POLICY, BASE_DAY), 'retain');
        assert.strictEqual(retentionVerdict(REAL_USER_ENTRY, POLICY, Number.NaN), 'retain');
        assert.strictEqual(retentionVerdict(REAL_USER_ENTRY, POLICY, Number.POSITIVE_INFINITY), 'retain');
        assert.strictEqual(retentionVerdict({} as unknown as MemoryEntryRecord, POLICY, BASE_DAY), 'retain');
        assert.strictEqual(retentionVerdict(REAL_USER_ENTRY, null as unknown as RetentionPolicy, BASE_DAY), 'retain');
    });

    test('custom policies override the constants', () => {
        const zeroTtl: RetentionPolicy = { scope: SCOPE, contractVersion: SCOPED_MEMORY_CONTRACTS_VERSION, ttlDays: { user: 0, project: 0, workspace: 0 }, declaredAtIso: T0 };
        assert.strictEqual(retentionVerdict(REAL_USER_ENTRY, zeroTtl, BASE_DAY), 'expire');
        const eternalTtl: RetentionPolicy = { scope: SCOPE, contractVersion: SCOPED_MEMORY_CONTRACTS_VERSION, ttlDays: { user: 1000000, project: 1000000, workspace: 1000000 }, declaredAtIso: T0 };
        assert.strictEqual(retentionVerdict(admitRealEntry('ancient', 'user', '1971-01-01T00:00:00Z'), eternalTtl, BASE_DAY), 'retain');
    });
});

suite('zc005 lifecycle: applyRetention', () => {
    test('applyRetention partitions entries into the retained set and expire receipts', () => {
        const userOld = admitRealEntry('user-old', 'user', epochDaysToIsoUtc(BASE_DAY));
        const projectMid = admitRealEntry('project-mid', 'project', epochDaysToIsoUtc(BASE_DAY + 300));
        const workspaceOld = admitRealEntry('workspace-old', 'workspace', epochDaysToIsoUtc(BASE_DAY));
        const userFresh = admitRealEntry('user-fresh', 'user', epochDaysToIsoUtc(BASE_DAY + 400));
        const application = expectApplied(applyRetention([userOld, projectMid, workspaceOld, userFresh], POLICY, BASE_DAY + 400));
        assert.deepEqual(application.retained, [projectMid, userFresh]);
        assert.strictEqual(application.expireReceipts.length, 2);
        assert.strictEqual(application.expireReceipts[0].entryId, 'user-old');
        assert.strictEqual(application.expireReceipts[1].entryId, 'workspace-old');
    });

    test('expire receipts carry the every-record law, the level TTL, and the derived evaluation instant', () => {
        const userOld = admitRealEntry('user-old', 'user', epochDaysToIsoUtc(BASE_DAY));
        const workspaceOld = admitRealEntry('workspace-old', 'workspace', epochDaysToIsoUtc(BASE_DAY));
        const application = expectApplied(applyRetention([userOld, workspaceOld], POLICY, BASE_DAY + 400));
        const userReceipt = application.expireReceipts[0];
        assert.deepEqual(userReceipt.scope, SCOPE);
        assert.strictEqual(userReceipt.contractVersion, SCOPED_MEMORY_CONTRACTS_VERSION);
        assert.strictEqual(userReceipt.entryId, 'user-old');
        assert.strictEqual(userReceipt.level, 'user');
        assert.strictEqual(userReceipt.ttlDays, 365);
        assert.strictEqual(userReceipt.expiredAtIso, epochDaysToIsoUtc(BASE_DAY + 400));
        assert.ok(isDigest(userReceipt.expireDigest));
        const workspaceReceipt = application.expireReceipts[1];
        assert.strictEqual(workspaceReceipt.level, 'workspace');
        assert.strictEqual(workspaceReceipt.ttlDays, 90);
    });

    test('applyRetention refuses foreign-scope entries typedly - never another tenant\'s expiry', () => {
        const foreignEntry = admitRealEntry('foreign', 'user', T0, { tenantId: 'tenant-2', workspaceId: 'ws-2' });
        const refusal = expectRetentionRefusal(applyRetention([foreignEntry], POLICY, BASE_DAY));
        if (refusal.reason !== 'entry-scope-mismatch') {
            assert.fail(`expected entry-scope-mismatch, received: ${refusal.reason}`);
        } else {
            assert.strictEqual(refusal.entryIndex, 0);
        }
    });

    test('applyRetention refuses invalid policies, clock deltas, and entries typedly (battery)', () => {
        const stalePolicy: RetentionPolicy = { scope: SCOPE, contractVersion: '0.9.9', ttlDays: POLICY.ttlDays, declaredAtIso: T0 };
        assert.strictEqual(expectRetentionRefusal(applyRetention([], stalePolicy, 0)).reason, 'invalid-policy');
        assert.strictEqual(expectRetentionRefusal(applyRetention([], POLICY, Number.NaN)).reason, 'invalid-clock-delta');
        const invalidEntryRefusal = expectRetentionRefusal(applyRetention([{} as unknown as MemoryEntryRecord], POLICY, 0));
        if (invalidEntryRefusal.reason !== 'invalid-entry') {
            assert.fail(`expected invalid-entry, received: ${invalidEntryRefusal.reason}`);
        } else {
            assert.strictEqual(invalidEntryRefusal.entryIndex, 0);
        }
        assert.strictEqual(expectRetentionRefusal(applyRetention('nope' as unknown as readonly MemoryEntryRecord[], POLICY, 0)).reason, 'invalid-entries');
    });

    test('applyRetention is a pure deterministic projection: same references in, identical application out', () => {
        const userOld = admitRealEntry('user-old', 'user', epochDaysToIsoUtc(BASE_DAY));
        const projectMid = admitRealEntry('project-mid', 'project', epochDaysToIsoUtc(BASE_DAY + 300));
        const input: readonly MemoryEntryRecord[] = [userOld, projectMid];
        const snapshot = JSON.stringify(input);
        const first = applyRetention(input, POLICY, BASE_DAY + 400);
        const second = applyRetention(input, POLICY, BASE_DAY + 400);
        assert.deepStrictEqual(first, second);
        assert.strictEqual(JSON.stringify(input), snapshot);
        const application = expectApplied(first);
        assert.strictEqual(application.retained[0], projectMid);
    });
});

suite('zc005 lifecycle: delete', () => {
    test('deleteEntry produces a typed per-entry DeleteReceipt with a deterministic deletion digest', () => {
        const first = deleteEntry(REAL_USER_ENTRY, T2);
        const receipt = expectDeleted(first);
        assert.deepEqual(receipt.scope, SCOPE);
        assert.strictEqual(receipt.contractVersion, SCOPED_MEMORY_CONTRACTS_VERSION);
        assert.strictEqual(receipt.entryId, 'real-user-entry');
        assert.strictEqual(receipt.level, 'user');
        assert.strictEqual(receipt.deletedAtIso, T2);
        assert.ok(isDigest(receipt.deletionDigest));
        assert.ok(isDeleteReceipt(receipt));
        const second = deleteEntry(REAL_USER_ENTRY, T2);
        assert.deepStrictEqual(second, first);
    });

    test('isDeleteReceipt rejects malformed receipts (battery)', () => {
        const receipt = expectDeleted(deleteEntry(REAL_USER_ENTRY, T2));
        assert.ok(!isDeleteReceipt(null));
        assert.ok(!isDeleteReceipt({ ...receipt, scope: null }));
        assert.ok(!isDeleteReceipt({ ...receipt, contractVersion: '0.9.9' }));
        assert.ok(!isDeleteReceipt({ ...receipt, entryId: '' }));
        assert.ok(!isDeleteReceipt({ ...receipt, level: 'team' }));
        assert.ok(!isDeleteReceipt({ ...receipt, deletedAtIso: 'soon' }));
        assert.ok(!isDeleteReceipt({ ...receipt, deletionDigest: 'not-a-digest' }));
    });

    test('deleteEntry refuses invalid entries and timestamps typedly', () => {
        assert.strictEqual(expectDeleteRefusal(deleteEntry({} as unknown as MemoryEntryRecord, T2)).reason, 'invalid-entry');
        assert.strictEqual(expectDeleteRefusal(deleteEntry(REAL_USER_ENTRY, 'yesterday')).reason, 'invalid-timestamp');
        assert.strictEqual(expectDeleteRefusal(deleteEntry(REAL_USER_ENTRY, '')).reason, 'invalid-timestamp');
    });
});

suite('zc005 lifecycle: export', () => {
    test('exportLevel produces an integrity-pinned bundle of entries, provenance, and enablement state', () => {
        const entryA = admitRealEntry('export-a', 'user', T0);
        const entryB = admitRealEntry('export-b', 'user', T1, SCOPE, { origin: 'task-evidence', evidenceKind: 'changeset', evidenceRef: 'task-3/changeset-1', capturedAtIso: T1 });
        const bundle = expectExported(exportLevel({ scope: SCOPE, level: 'user', projectRef: undefined, enablement: REAL_ENABLED_USER, entries: [entryA, entryB], exportedAtIso: T2 }));
        assert.deepEqual(bundle.scope, SCOPE);
        assert.strictEqual(bundle.contractVersion, SCOPED_MEMORY_CONTRACTS_VERSION);
        assert.strictEqual(bundle.level, 'user');
        assert.strictEqual(bundle.projectRef, undefined);
        assert.strictEqual(bundle.exportedAtIso, T2);
        assert.deepEqual(bundle.enablement, REAL_ENABLED_USER);
        assert.deepEqual(bundle.entries, [entryA, entryB]);
        assert.strictEqual(bundle.entries[1].provenance.origin, 'task-evidence');
        assert.ok(isDigest(bundle.bundleDigest));
        assert.strictEqual(verifyExportBundle(bundle), true);
    });

    test('a disabled level exports a typed refusal carrying the level and enablement state - never a partial bundle', () => {
        const allOff = defaultEnablement(SCOPE, T0);
        const refusal = expectExportRefusal(exportLevel({ scope: SCOPE, level: 'user', projectRef: undefined, enablement: allOff, entries: [REAL_USER_ENTRY], exportedAtIso: T2 }));
        if (refusal.reason !== 'level-not-enabled') {
            assert.fail(`expected level-not-enabled, received: ${refusal.reason}`);
        } else {
            assert.strictEqual(refusal.level, 'user');
            assert.deepEqual(refusal.enablement, allOff);
        }
        const projectOnly = enableLevel(defaultEnablement(SCOPE, T0), 'project', T1).enablement;
        const mismatchedLevel = expectExportRefusal(exportLevel({ scope: SCOPE, level: 'user', projectRef: undefined, enablement: projectOnly, entries: [REAL_USER_ENTRY], exportedAtIso: T2 }));
        assert.strictEqual(mismatchedLevel.reason, 'level-not-enabled');
    });

    test('export refuses foreign-scope, wrong-level, and wrong-project entries typedly', () => {
        const entryA = admitRealEntry('export-a', 'user', T0);
        const foreignEntry = admitRealEntry('foreign', 'user', T0, { tenantId: 'tenant-2', workspaceId: 'ws-2' });
        const foreignRefusal = expectExportRefusal(exportLevel({ scope: SCOPE, level: 'user', projectRef: undefined, enablement: REAL_ENABLED_USER, entries: [entryA, foreignEntry], exportedAtIso: T2 }));
        if (foreignRefusal.reason !== 'entry-scope-mismatch') {
            assert.fail(`expected entry-scope-mismatch, received: ${foreignRefusal.reason}`);
        } else {
            assert.strictEqual(foreignRefusal.entryIndex, 1);
        }
        const projectEntry = admitRealEntry('proj-entry', 'project', T0);
        const wrongLevelRefusal = expectExportRefusal(exportLevel({ scope: SCOPE, level: 'user', projectRef: undefined, enablement: REAL_ENABLED_USER, entries: [projectEntry], exportedAtIso: T2 }));
        assert.strictEqual(wrongLevelRefusal.reason, 'entry-scope-mismatch');
        const projectEnabled = enableLevel(defaultEnablement(SCOPE, T0), 'project', T1).enablement;
        assert.strictEqual(exportLevel({ scope: SCOPE, level: 'project', projectRef: 'proj-1', enablement: projectEnabled, entries: [projectEntry], exportedAtIso: T2 }).kind, 'exported');
        const otherRefOutcome = admitEntry({ scope: SCOPE, level: 'project', projectRef: 'proj-2', entryId: 'proj-other', kind: 'fact', content: 'Other project memory.', provenance: { origin: 'operator-entry', capturedAtIso: T0 }, admittedAtIso: T0 });
        if (otherRefOutcome.kind !== 'admitted') {
            throw new Error('expected admission');
        }
        const wrongProjectRefusal = expectExportRefusal(exportLevel({ scope: SCOPE, level: 'project', projectRef: 'proj-1', enablement: projectEnabled, entries: [otherRefOutcome.entry], exportedAtIso: T2 }));
        assert.strictEqual(wrongProjectRefusal.reason, 'entry-scope-mismatch');
    });

    test('the bundle digest is deterministic and tamper-evident', () => {
        const entryA = admitRealEntry('export-a', 'user', T0);
        const entryB = admitRealEntry('export-b', 'user', T1);
        const request: ExportRequest = { scope: SCOPE, level: 'user', projectRef: undefined, enablement: REAL_ENABLED_USER, entries: [entryA, entryB], exportedAtIso: T2 };
        const first = expectExported(exportLevel(request));
        const second = expectExported(exportLevel(request));
        assert.strictEqual(first.bundleDigest, second.bundleDigest);
        const reordered = expectExported(exportLevel({ ...request, entries: [entryB, entryA] }));
        assert.notStrictEqual(reordered.bundleDigest, first.bundleDigest);
        assert.strictEqual(verifyExportBundle(reordered), true);
        assert.strictEqual(verifyExportBundle({ ...first, exportedAtIso: '2025-01-09T00:00:00Z' }), false);
        assert.strictEqual(verifyExportBundle({ ...first, entries: [entryB, entryA] }), false);
    });

    test('export refuses invalid requests typedly (battery)', () => {
        const base: ExportRequest = { scope: SCOPE, level: 'user', projectRef: undefined, enablement: REAL_ENABLED_USER, entries: [REAL_USER_ENTRY], exportedAtIso: T2 };
        assert.strictEqual(expectExportRefusal(exportLevel({ ...base, exportedAtIso: 'soon' })).reason, 'invalid-request');
        assert.strictEqual(expectExportRefusal(exportLevel({ ...base, enablement: { ...REAL_ENABLED_USER, contractVersion: '0.9.9' } })).reason, 'invalid-request');
        assert.strictEqual(expectExportRefusal(exportLevel({ ...base, scope: { tenantId: 'tenant-2', workspaceId: 'ws-2' } })).reason, 'invalid-request');
        assert.strictEqual(expectExportRefusal(exportLevel({ ...base, level: 'project' })).reason, 'invalid-request');
        const invalidEntryRefusal = expectExportRefusal(exportLevel({ ...base, entries: [{} as unknown as MemoryEntryRecord] }));
        if (invalidEntryRefusal.reason !== 'invalid-entry') {
            assert.fail(`expected invalid-entry, received: ${invalidEntryRefusal.reason}`);
        } else {
            assert.strictEqual(invalidEntryRefusal.entryIndex, 0);
        }
    });
});
