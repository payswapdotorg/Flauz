/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import {
    MEMORY_LEVELS,
    MEMORY_QUERY_CONTEXTS,
    SCOPED_MEMORY_CONTRACTS_VERSION,
    SCOPE_VISIBILITY_LATTICE,
    isMemoryLevel,
    isMemoryQueryContext,
    isMemoryRecordScope,
    isMemoryScopeAddress,
    isMemoryScopeQuery,
    mayRead,
    recordScopesEqual,
    resolveScope,
    visibleLevels
} from '../../common/scoping.js';
import type { MemoryLevel, MemoryRecordScope, MemoryScopeAddress, MemoryScopeQuery, ScopeResolution } from '../../common/scoping.js';

const SCOPE: MemoryRecordScope = { tenantId: 'tenant-1', workspaceId: 'ws-1' };
const OTHER_SCOPE: MemoryRecordScope = { tenantId: 'tenant-2', workspaceId: 'ws-2' };

function makeAddress(level: MemoryLevel, projectRef: string | undefined): MemoryScopeAddress {
    return { scope: SCOPE, contractVersion: SCOPED_MEMORY_CONTRACTS_VERSION, level, projectRef };
}

function makeQuery(context: MemoryLevel, projectRef?: string): MemoryScopeQuery {
    return { scope: SCOPE, context, projectRef };
}

const FULL_ADDRESS_SET: readonly MemoryScopeAddress[] = [
    makeAddress('user', undefined),
    makeAddress('project', 'proj-1'),
    makeAddress('workspace', undefined)
];

function expectResolvedAddress(resolution: ScopeResolution): MemoryScopeAddress {
    if (resolution.kind === 'resolved') {
        return resolution.address;
    }
    throw new Error(`expected a resolved address, received refusal: ${JSON.stringify(resolution)}`);
}

function expectResolutionRefusal(resolution: ScopeResolution): Exclude<ScopeResolution, { kind: 'resolved' }> {
    if (resolution.kind === 'refusal') {
        return resolution;
    }
    throw new Error(`expected a resolution refusal, received: ${JSON.stringify(resolution)}`);
}

suite('zc005 scoping: frozen levels', () => {
    test('MEMORY_LEVELS is exactly the three frozen levels in canonical order', () => {
        assert.deepEqual(MEMORY_LEVELS, ['user', 'project', 'workspace']);
    });

    test('isMemoryLevel accepts exactly the three frozen levels', () => {
        for (const level of MEMORY_LEVELS) {
            assert.ok(isMemoryLevel(level), level);
            assert.strictEqual(typeof level, 'string');
        }
        assert.ok(!isMemoryLevel('team'));
        assert.ok(!isMemoryLevel(''));
        assert.ok(!isMemoryLevel(7));
        assert.ok(!isMemoryLevel(null));
        assert.ok(!isMemoryLevel(undefined));
    });

    test('MEMORY_QUERY_CONTEXTS shares the level vocabulary: resolution is total over the three levels', () => {
        assert.deepEqual(MEMORY_QUERY_CONTEXTS, MEMORY_LEVELS);
        for (const context of MEMORY_QUERY_CONTEXTS) {
            assert.ok(isMemoryQueryContext(context), context);
        }
        assert.ok(!isMemoryQueryContext('team'));
    });
});

suite('zc005 scoping: record scope', () => {
    test('isMemoryRecordScope accepts tenant- and workspace-anchored scopes', () => {
        assert.ok(isMemoryRecordScope(SCOPE));
        assert.ok(isMemoryRecordScope({ tenantId: 't', workspaceId: 'w' }));
    });

    test('isMemoryRecordScope rejects malformed scopes', () => {
        assert.ok(!isMemoryRecordScope(null));
        assert.ok(!isMemoryRecordScope('tenant-1/ws-1'));
        assert.ok(!isMemoryRecordScope({ tenantId: '', workspaceId: 'ws-1' }));
        assert.ok(!isMemoryRecordScope({ tenantId: 'tenant-1', workspaceId: '' }));
        assert.ok(!isMemoryRecordScope({ tenantId: 'tenant-1' }));
        assert.ok(!isMemoryRecordScope({ tenantId: 7, workspaceId: 'ws-1' }));
    });

    test('recordScopesEqual is pure structural equality', () => {
        assert.ok(recordScopesEqual(SCOPE, { tenantId: 'tenant-1', workspaceId: 'ws-1' }));
        assert.ok(!recordScopesEqual(SCOPE, OTHER_SCOPE));
        assert.ok(!recordScopesEqual(SCOPE, { tenantId: 'tenant-1', workspaceId: 'ws-9' }));
    });
});

suite('zc005 scoping: addresses', () => {
    test('isMemoryScopeAddress accepts user and workspace addresses without a projectRef', () => {
        assert.ok(isMemoryScopeAddress(makeAddress('user', undefined)));
        assert.ok(isMemoryScopeAddress(makeAddress('workspace', undefined)));
    });

    test('isMemoryScopeAddress accepts a project address carrying its projectRef', () => {
        assert.ok(isMemoryScopeAddress(makeAddress('project', 'proj-1')));
    });

    test('isMemoryScopeAddress rejects level/projectRef mismatches', () => {
        assert.ok(!isMemoryScopeAddress(makeAddress('project', undefined)));
        assert.ok(!isMemoryScopeAddress(makeAddress('project', '')));
        assert.ok(!isMemoryScopeAddress(makeAddress('user', 'proj-1')));
        assert.ok(!isMemoryScopeAddress(makeAddress('workspace', 'proj-1')));
        assert.ok(!isMemoryScopeAddress(null));
    });

    test('isMemoryScopeAddress is version-strict', () => {
        const stale = { scope: SCOPE, contractVersion: '0.9.9', level: 'user' as MemoryLevel, projectRef: undefined };
        assert.ok(!isMemoryScopeAddress(stale));
    });
});

suite('zc005 scoping: the resolution law', () => {
    test('resolution is total over the three levels: each context resolves exactly one address (iterated)', () => {
        for (const context of MEMORY_QUERY_CONTEXTS) {
            const query = makeQuery(context, context === 'project' ? 'proj-1' : undefined);
            const address = expectResolvedAddress(resolveScope(query, FULL_ADDRESS_SET));
            assert.strictEqual(address.level, context, context);
            if (context === 'project') {
                assert.strictEqual(address.projectRef, 'proj-1');
            } else {
                assert.strictEqual(address.projectRef, undefined);
            }
        }
    });

    test('workspace-level wins for workspace-context queries even when user and project addresses exist', () => {
        const address = expectResolvedAddress(resolveScope(makeQuery('workspace'), FULL_ADDRESS_SET));
        assert.strictEqual(address.level, 'workspace');
        assert.strictEqual(address.projectRef, undefined);
    });

    test('resolveScope is deterministic: identical inputs resolve to the identical address', () => {
        const first = resolveScope(makeQuery('user'), FULL_ADDRESS_SET);
        const second = resolveScope(makeQuery('user'), FULL_ADDRESS_SET);
        assert.strictEqual(expectResolvedAddress(first), expectResolvedAddress(second));
    });

    test('addresses from other tenants or workspaces are never candidates', () => {
        const foreign: MemoryScopeAddress = { scope: OTHER_SCOPE, contractVersion: SCOPED_MEMORY_CONTRACTS_VERSION, level: 'user', projectRef: undefined };
        const resolution = resolveScope(makeQuery('user'), [foreign]);
        const refusal = expectResolutionRefusal(resolution);
        assert.strictEqual(refusal.reason, 'no-address-at-level');
    });

    test('invalid addresses are ignored, never selected', () => {
        const mixed = [
            null as unknown as MemoryScopeAddress,
            'garbage' as unknown as MemoryScopeAddress,
            makeAddress('user', undefined)
        ];
        const address = expectResolvedAddress(resolveScope(makeQuery('user'), mixed));
        assert.strictEqual(address.level, 'user');
        const allInvalid = [null as unknown as MemoryScopeAddress, 42 as unknown as MemoryScopeAddress];
        const refusal = expectResolutionRefusal(resolveScope(makeQuery('user'), allInvalid));
        assert.strictEqual(refusal.reason, 'no-address-at-level');
    });

    test('project-context queries without a projectRef are typed refusals, never guesses', () => {
        const refusal = expectResolutionRefusal(resolveScope(makeQuery('project'), FULL_ADDRESS_SET));
        if (refusal.reason !== 'project-ref-required') {
            assert.fail(`expected project-ref-required, received: ${refusal.reason}`);
        } else {
            assert.strictEqual(refusal.context, 'project');
        }
    });

    test('project-context queries resolve by exact projectRef match', () => {
        const addresses: readonly MemoryScopeAddress[] = [makeAddress('project', 'proj-1'), makeAddress('project', 'proj-2')];
        const second = expectResolvedAddress(resolveScope(makeQuery('project', 'proj-2'), addresses));
        assert.strictEqual(second.level, 'project');
        assert.strictEqual(second.projectRef, 'proj-2');
        const missing = expectResolutionRefusal(resolveScope(makeQuery('project', 'proj-9'), addresses));
        assert.strictEqual(missing.reason, 'no-address-at-level');
    });

    test('a missing address at the context level is a typed no-address-at-level refusal', () => {
        const onlyUser: readonly MemoryScopeAddress[] = [makeAddress('user', undefined)];
        const refusal = expectResolutionRefusal(resolveScope(makeQuery('workspace'), onlyUser));
        if (refusal.reason !== 'no-address-at-level') {
            assert.fail(`expected no-address-at-level, received: ${refusal.reason}`);
        } else {
            assert.strictEqual(refusal.context, 'workspace');
            assert.strictEqual(refusal.level, 'workspace');
        }
    });

    test('a malformed query is a typed invalid-query refusal', () => {
        const badScope = resolveScope({ scope: null, context: 'user', projectRef: undefined } as unknown as MemoryScopeQuery, FULL_ADDRESS_SET);
        assert.strictEqual(expectResolutionRefusal(badScope).reason, 'invalid-query');
        const badContext = resolveScope({ scope: SCOPE, context: 'team', projectRef: undefined } as unknown as MemoryScopeQuery, FULL_ADDRESS_SET);
        assert.strictEqual(expectResolutionRefusal(badContext).reason, 'invalid-query');
        const strayProjectRef = resolveScope(makeQuery('user', 'proj-1'), FULL_ADDRESS_SET);
        assert.strictEqual(expectResolutionRefusal(strayProjectRef).reason, 'invalid-query');
    });
});

suite('zc005 scoping: the visibility lattice', () => {
    test('the read lattice is the pure table', () => {
        assert.deepEqual(SCOPE_VISIBILITY_LATTICE, [
            { level: 'user', mayRead: ['user'] },
            { level: 'project', mayRead: ['user', 'project'] },
            { level: 'workspace', mayRead: ['user', 'project', 'workspace'] }
        ]);
    });

    test('mayRead answers every reader-target pair exactly as the lattice says (iterated)', () => {
        for (const reader of MEMORY_LEVELS) {
            for (const target of MEMORY_LEVELS) {
                assert.strictEqual(mayRead(reader, target), visibleLevels(reader).includes(target), `${reader}->${target}`);
            }
        }
        assert.strictEqual(mayRead('user', 'workspace'), false);
        assert.strictEqual(mayRead('project', 'workspace'), false);
        assert.strictEqual(mayRead('workspace', 'user'), true);
    });

    test('the lattice is an increasing chain: each level reads a superset of the previous', () => {
        const userRow = visibleLevels('user');
        const projectRow = visibleLevels('project');
        const workspaceRow = visibleLevels('workspace');
        for (const level of userRow) {
            assert.ok(projectRow.includes(level), level);
        }
        for (const level of projectRow) {
            assert.ok(workspaceRow.includes(level), level);
        }
    });

    test('an unknown reader reads nothing (fail-closed)', () => {
        assert.deepEqual(visibleLevels('bogus' as unknown as MemoryLevel), []);
        assert.strictEqual(mayRead('bogus' as unknown as MemoryLevel, 'user'), false);
    });
});
