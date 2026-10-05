/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import {
    MEMORY_LEVELS,
    SCOPED_MEMORY_CONTRACTS_VERSION,
    canUseMemory,
    defaultEnablement,
    disableLevel,
    enableLevel,
    isIsoTimestamp,
    isMemoryEnablement,
    requestMemoryUse
} from '../../common/enablement.js';
import type { MemoryEnablement, MemoryLevel, MemoryRecordScope, MemoryUseRequestResult } from '../../common/enablement.js';

const SCOPE: MemoryRecordScope = { tenantId: 'tenant-1', workspaceId: 'ws-1' };
const T0 = '2025-01-01T00:00:00Z';
const T1 = '2025-01-02T00:00:00Z';
const T2 = '2025-01-03T00:00:00Z';

function expectAuthorizedUse(result: MemoryUseRequestResult): MemoryEnablement {
    if (result.kind === 'authorized') {
        return result.enablement;
    }
    throw new Error(`expected an authorized use, received refusal: ${JSON.stringify(result)}`);
}

function expectUseRefusal(result: MemoryUseRequestResult): Exclude<MemoryUseRequestResult, { kind: 'authorized' }> {
    if (result.kind === 'refusal') {
        return result;
    }
    throw new Error(`expected a use refusal, received: ${JSON.stringify(result)}`);
}

suite('zc005 enablement: the default-off law', () => {
    test('defaultEnablement produces the all-off record: no level is enabled', () => {
        const enablement = defaultEnablement(SCOPE, T0);
        assert.deepEqual(enablement, {
            scope: SCOPE,
            contractVersion: SCOPED_MEMORY_CONTRACTS_VERSION,
            enabledLevels: [],
            updatedAtIso: T0
        });
        assert.ok(isMemoryEnablement(enablement));
    });

    test('canUseMemory is false for every level on the default record (iterated)', () => {
        const enablement = defaultEnablement(SCOPE, T0);
        for (const level of MEMORY_LEVELS) {
            assert.strictEqual(canUseMemory(level, enablement), false, level);
        }
    });

    test('requestMemoryUse refuses every level on the default record with a typed refusal (iterated)', () => {
        const enablement = defaultEnablement(SCOPE, T0);
        for (const level of MEMORY_LEVELS) {
            const refusal = expectUseRefusal(requestMemoryUse(level, enablement));
            assert.strictEqual(refusal.reason, 'level-not-enabled', level);
            assert.strictEqual(refusal.level, level);
            assert.deepEqual(refusal.enablement, enablement);
        }
    });
});

suite('zc005 enablement: record shape', () => {
    test('isMemoryEnablement accepts a well-formed enablement record', () => {
        const enablement = enableLevel(defaultEnablement(SCOPE, T0), 'user', T1).enablement;
        assert.ok(isMemoryEnablement(enablement));
    });

    test('isMemoryEnablement rejects malformed records', () => {
        assert.ok(!isMemoryEnablement(null));
        assert.ok(!isMemoryEnablement('enabled'));
        assert.ok(!isMemoryEnablement({ scope: null, contractVersion: SCOPED_MEMORY_CONTRACTS_VERSION, enabledLevels: [], updatedAtIso: T0 }));
        assert.ok(!isMemoryEnablement({ scope: SCOPE, contractVersion: '0.9.9', enabledLevels: [], updatedAtIso: T0 }));
        assert.ok(!isMemoryEnablement({ scope: SCOPE, contractVersion: SCOPED_MEMORY_CONTRACTS_VERSION, enabledLevels: 'user', updatedAtIso: T0 }));
        assert.ok(!isMemoryEnablement({ scope: SCOPE, contractVersion: SCOPED_MEMORY_CONTRACTS_VERSION, enabledLevels: ['user', 'user'], updatedAtIso: T0 }));
        assert.ok(!isMemoryEnablement({ scope: SCOPE, contractVersion: SCOPED_MEMORY_CONTRACTS_VERSION, enabledLevels: ['team'], updatedAtIso: T0 }));
        assert.ok(!isMemoryEnablement({ scope: SCOPE, contractVersion: SCOPED_MEMORY_CONTRACTS_VERSION, enabledLevels: [], updatedAtIso: 'yesterday' }));
    });

    test('isIsoTimestamp accepts canonical UTC stamps and rejects everything else', () => {
        assert.ok(isIsoTimestamp('2025-01-01T00:00:00Z'));
        assert.ok(isIsoTimestamp('2024-12-31T23:59:59.999Z'));
        assert.ok(!isIsoTimestamp('2025-01-01 00:00:00Z'));
        assert.ok(!isIsoTimestamp('2025-01-01T00:00:00'));
        assert.ok(!isIsoTimestamp('2025-01-01T00:00:00+00:00'));
        assert.ok(!isIsoTimestamp('2025-01-01'));
        assert.ok(!isIsoTimestamp('2025-01-01T00:00:00.1234Z'));
        assert.ok(!isIsoTimestamp(''));
        assert.ok(!isIsoTimestamp(42));
        assert.ok(!isIsoTimestamp(null));
    });
});

suite('zc005 enablement: pure transitions', () => {
    test('enableLevel turns a level on and stamps updatedAtIso', () => {
        const base = defaultEnablement(SCOPE, T0);
        const transition = enableLevel(base, 'user', T1);
        assert.deepEqual(transition.enablement, {
            scope: SCOPE,
            contractVersion: SCOPED_MEMORY_CONTRACTS_VERSION,
            enabledLevels: ['user'],
            updatedAtIso: T1
        });
        assert.deepEqual(transition.change, {
            scope: SCOPE,
            contractVersion: SCOPED_MEMORY_CONTRACTS_VERSION,
            level: 'user',
            from: false,
            to: true,
            changedAtIso: T1
        });
    });

    test('enableLevel stores enabled levels in canonical order regardless of call order', () => {
        const once = enableLevel(defaultEnablement(SCOPE, T0), 'workspace', T1).enablement;
        const twice = enableLevel(once, 'user', T1).enablement;
        assert.deepEqual(twice.enabledLevels, ['user', 'workspace']);
    });

    test('enableLevel on an already-enabled level is a no-op: the record is returned unchanged', () => {
        const once = enableLevel(defaultEnablement(SCOPE, T0), 'user', T1);
        const twice = enableLevel(once.enablement, 'user', T2);
        assert.strictEqual(twice.enablement, once.enablement);
        assert.strictEqual(twice.change.from, true);
        assert.strictEqual(twice.change.to, true);
        assert.strictEqual(twice.change.changedAtIso, T2);
    });

    test('disableLevel turns a level off and records the change', () => {
        const enabled = enableLevel(defaultEnablement(SCOPE, T0), 'user', T1).enablement;
        const transition = disableLevel(enabled, 'user', T2);
        assert.deepEqual(transition.enablement, {
            scope: SCOPE,
            contractVersion: SCOPED_MEMORY_CONTRACTS_VERSION,
            enabledLevels: [],
            updatedAtIso: T2
        });
        assert.deepEqual(transition.change, {
            scope: SCOPE,
            contractVersion: SCOPED_MEMORY_CONTRACTS_VERSION,
            level: 'user',
            from: true,
            to: false,
            changedAtIso: T2
        });
    });

    test('disableLevel on a disabled level is a no-op with from=false to=false', () => {
        const base = defaultEnablement(SCOPE, T0);
        const transition = disableLevel(base, 'project', T1);
        assert.strictEqual(transition.enablement, base);
        assert.strictEqual(transition.change.from, false);
        assert.strictEqual(transition.change.to, false);
    });

    test('transitions never mutate their input record (purity)', () => {
        const base = enableLevel(defaultEnablement(SCOPE, T0), 'user', T1).enablement;
        const before = JSON.stringify(base);
        enableLevel(base, 'project', T2);
        disableLevel(base, 'user', T2);
        assert.strictEqual(JSON.stringify(base), before);
    });

    test('a full enable/disable round trip returns to the default state', () => {
        let enablement = defaultEnablement(SCOPE, T0);
        for (const level of ['workspace', 'project', 'user'] as readonly MemoryLevel[]) {
            enablement = enableLevel(enablement, level, T1).enablement;
        }
        assert.deepEqual(enablement.enabledLevels, ['user', 'project', 'workspace']);
        for (const level of ['project', 'workspace', 'user'] as readonly MemoryLevel[]) {
            enablement = disableLevel(enablement, level, T2).enablement;
        }
        assert.deepEqual(enablement.enabledLevels, []);
    });
});

suite('zc005 enablement: typed authorization', () => {
    test('requestMemoryUse authorizes an enabled level and echoes the enablement state', () => {
        const enablement = enableLevel(defaultEnablement(SCOPE, T0), 'user', T1).enablement;
        const echoed = expectAuthorizedUse(requestMemoryUse('user', enablement));
        assert.deepEqual(echoed, enablement);
    });

    test('requestMemoryUse refuses a disabled level even when other levels are enabled', () => {
        let enablement = defaultEnablement(SCOPE, T0);
        enablement = enableLevel(enablement, 'user', T1).enablement;
        enablement = enableLevel(enablement, 'workspace', T1).enablement;
        const refusal = expectUseRefusal(requestMemoryUse('project', enablement));
        assert.strictEqual(refusal.reason, 'level-not-enabled');
        assert.strictEqual(refusal.level, 'project');
        assert.deepEqual(refusal.enablement, enablement);
    });

    test('canUseMemory tracks the enable/disable transitions', () => {
        const base = defaultEnablement(SCOPE, T0);
        assert.strictEqual(canUseMemory('user', base), false);
        const enabled = enableLevel(base, 'user', T1).enablement;
        assert.strictEqual(canUseMemory('user', enabled), true);
        const disabled = disableLevel(enabled, 'user', T2).enablement;
        assert.strictEqual(canUseMemory('user', disabled), false);
    });
});
