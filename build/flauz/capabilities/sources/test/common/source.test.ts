/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

// Tests for build/flauz/capabilities/sources/common/source.ts (ZC-007).
// Style: mocha tdd (suite/test), assert, .js import suffixes.

import assert from 'assert';
import * as sourceContracts from '../../common/source.js';
import * as adapterContracts from '../../common/adapter.js';
import * as importContracts from '../../common/import.js';

const SCOPE_A: sourceContracts.SourceScope = { workspaceId: 'ws-1', tenantId: 'tenant-1' };
const SCOPE_B: sourceContracts.SourceScope = { workspaceId: 'ws-2', tenantId: 'tenant-2' };
const AT_ISO = '2025-06-01T12:00:00.000Z';
const AT_ISO_LATER = '2025-06-02T12:00:00.000Z';

function makeDescriptor(
    overrides: Partial<sourceContracts.SourceDescriptor> = {}
): sourceContracts.SourceDescriptor {
    return {
        scope: SCOPE_A,
        contractVersion: sourceContracts.SOURCE_ADAPTERS_CONTRACTS_VERSION,
        sourceId: 'source-printing-press-1',
        kind: 'printing-press',
        endpointRef: 'https://press.example.test/feed',
        sourceVersion: '1.2.3',
        discoveredAtIso: AT_ISO,
        healthState: 'unknown',
        ...overrides
    };
}

suite('zc007 source contracts: vocabulary', () => {
    test('SOURCE_KINDS is the frozen nine-kind vocabulary in canonical order', () => {
        assert.deepStrictEqual(sourceContracts.SOURCE_KINDS, [
            'printing-press',
            'printing-press-library',
            'composio',
            'mcp-catalog',
            'skill-catalog',
            'user-spec',
            'api-spec',
            'site-spec',
            'community-project'
        ]);
    });

    test('isSourceKind accepts every frozen kind and rejects unknown values', () => {
        for (const kind of sourceContracts.SOURCE_KINDS) {
            assert.strictEqual(sourceContracts.isSourceKind(kind), true, kind);
        }
        assert.strictEqual(sourceContracts.isSourceKind('not-a-kind'), false);
        assert.strictEqual(sourceContracts.isSourceKind(42), false);
    });

    test('SOURCE_HEALTH_STATES is the unknown/reachable/unreachable projection vocabulary', () => {
        assert.deepStrictEqual(sourceContracts.SOURCE_HEALTH_STATES, [
            'unknown',
            'reachable',
            'unreachable'
        ]);
        assert.strictEqual(sourceContracts.isSourceHealthState('reachable'), true);
        assert.strictEqual(sourceContracts.isSourceHealthState('flaky'), false);
    });

    test('SOURCE_RETIRE_REASONS is the typed retire vocabulary', () => {
        assert.deepStrictEqual(sourceContracts.SOURCE_RETIRE_REASONS, [
            'operator-decision',
            'persistently-unreachable',
            'upstream-deprecated',
            'superseded',
            'policy'
        ]);
        assert.strictEqual(sourceContracts.isSourceRetireReason('policy'), true);
        assert.strictEqual(sourceContracts.isSourceRetireReason('whatever'), false);
    });
});

suite('zc007 source contracts: guards', () => {
    test('isSourceScope accepts workspace+tenant scopes and rejects others', () => {
        assert.strictEqual(sourceContracts.isSourceScope(SCOPE_A), true);
        assert.strictEqual(sourceContracts.isSourceScope({ workspaceId: 'ws-1' }), false);
        assert.strictEqual(sourceContracts.isSourceScope(null), false);
        assert.strictEqual(sourceContracts.isSourceScope('ws-1'), false);
    });

    test('isIsoTimestamp accepts plain ISO strings and rejects non-ISO values', () => {
        assert.strictEqual(sourceContracts.isIsoTimestamp('2025-06-01T12:00:00.000Z'), true);
        assert.strictEqual(sourceContracts.isIsoTimestamp('2025-06-01T12:00:00Z'), true);
        assert.strictEqual(sourceContracts.isIsoTimestamp('2025-06-01T12:00:00+02:00'), true);
        assert.strictEqual(sourceContracts.isIsoTimestamp('2025-06-01'), false);
        assert.strictEqual(sourceContracts.isIsoTimestamp('yesterday'), false);
        assert.strictEqual(sourceContracts.isIsoTimestamp(123), false);
    });

    test('isSourceDescriptor validates a well-formed descriptor and rejects malformed ones', () => {
        assert.strictEqual(sourceContracts.isSourceDescriptor(makeDescriptor()), true);
        assert.strictEqual(
            sourceContracts.isSourceDescriptor({ ...makeDescriptor(), sourceId: '' }),
            false
        );
        assert.strictEqual(
            sourceContracts.isSourceDescriptor({ ...makeDescriptor(), kind: 'not-a-kind' }),
            false
        );
        assert.strictEqual(
            sourceContracts.isSourceDescriptor({ ...makeDescriptor(), discoveredAtIso: 'nope' }),
            false
        );
        assert.strictEqual(sourceContracts.isSourceDescriptor(null), false);
    });

    test('isSourceRegistry validates the live source set and the revision log', () => {
        const registry = sourceContracts.createSourceRegistry(SCOPE_A);
        const registered = sourceContracts.registerSource(registry, makeDescriptor(), AT_ISO);
        assert.strictEqual(sourceContracts.isSourceRegistry(registered.registry), true);
        assert.strictEqual(
            sourceContracts.isSourceRegistry(
                { ...registry, sources: 'nope' } as unknown as sourceContracts.SourceRegistry
            ),
            false
        );
        assert.strictEqual(sourceContracts.isSourceRegistry(null), false);
    });
});

suite('zc007 source contracts: registerSource', () => {
    test('registers a source and appends a register revision (revision-append law)', () => {
        const registry = sourceContracts.createSourceRegistry(SCOPE_A);
        const result = sourceContracts.registerSource(registry, makeDescriptor(), AT_ISO);
        assert.strictEqual(result.outcome, 'registered');
        assert.strictEqual(result.registry.sources.length, 1);
        assert.strictEqual(result.registry.sources[0].sourceId, 'source-printing-press-1');
        assert.strictEqual(result.registry.revisions.length, 1);
        if (result.outcome === 'registered') {
            assert.strictEqual(result.revision.kind, 'register');
            assert.strictEqual(result.revision.revisionId, 'rev-1');
            assert.strictEqual(result.revision.atIso, AT_ISO);
            assert.deepStrictEqual(result.revision.scope, SCOPE_A);
            assert.strictEqual(
                result.revision.contractVersion,
                sourceContracts.SOURCE_ADAPTERS_CONTRACTS_VERSION
            );
        }
    });

    test('registration is idempotent-guarded: a live sourceId never registers twice', () => {
        const registry = sourceContracts.createSourceRegistry(SCOPE_A);
        const first = sourceContracts.registerSource(registry, makeDescriptor(), AT_ISO);
        assert.strictEqual(first.outcome, 'registered');
        const second = sourceContracts.registerSource(first.registry, makeDescriptor(), AT_ISO_LATER);
        assert.strictEqual(second.outcome, 'already-registered');
        assert.strictEqual(second.registry, first.registry);
        assert.strictEqual(second.registry.revisions.length, 1);
    });

    test('prior revisions are never rewritten when later sources register', () => {
        const registry = sourceContracts.createSourceRegistry(SCOPE_A);
        const first = sourceContracts.registerSource(registry, makeDescriptor(), AT_ISO);
        const second = sourceContracts.registerSource(
            first.registry,
            makeDescriptor({
                sourceId: 'source-composio-1',
                kind: 'composio',
                endpointRef: 'https://composio.example.test/toolset'
            }),
            AT_ISO_LATER
        );
        assert.strictEqual(second.outcome, 'registered');
        assert.strictEqual(second.registry.revisions.length, 2);
        if (first.outcome === 'registered') {
            assert.deepStrictEqual(second.registry.revisions[0], first.revision);
        }
        assert.strictEqual(second.registry.sources.length, 2);
    });

    test('rejects invalid descriptors, timestamps, versions and scopes with typed disclosures', () => {
        const registry = sourceContracts.createSourceRegistry(SCOPE_A);
        const broken = {
            ...makeDescriptor({ contractVersion: '9.9.9' }),
            sourceId: 123
        } as unknown as sourceContracts.SourceDescriptor;
        assert.strictEqual(
            sourceContracts.registerSource(registry, broken, AT_ISO).outcome,
            'invalid-descriptor'
        );
        assert.strictEqual(
            sourceContracts.registerSource(registry, makeDescriptor(), 'not-a-timestamp').outcome,
            'invalid-timestamp'
        );
        const versionResult = sourceContracts.registerSource(
            registry,
            makeDescriptor({ contractVersion: '0.9.0' }),
            AT_ISO
        );
        assert.strictEqual(versionResult.outcome, 'version-mismatch');
        if (versionResult.outcome === 'version-mismatch') {
            assert.strictEqual(
                versionResult.expected,
                sourceContracts.SOURCE_ADAPTERS_CONTRACTS_VERSION
            );
            assert.strictEqual(versionResult.found, '0.9.0');
        }
        assert.strictEqual(
            sourceContracts.registerSource(registry, makeDescriptor({ scope: SCOPE_B }), AT_ISO).outcome,
            'scope-mismatch'
        );
        assert.strictEqual(registry.sources.length, 0);
    });
});

suite('zc007 source contracts: retireSource', () => {
    test('retires a live source with a typed reason and appends a retire revision', () => {
        const registry = sourceContracts.createSourceRegistry(SCOPE_A);
        const registered = sourceContracts.registerSource(registry, makeDescriptor(), AT_ISO);
        const retired = sourceContracts.retireSource(
            registered.registry,
            'source-printing-press-1',
            'upstream-deprecated',
            AT_ISO_LATER
        );
        assert.strictEqual(retired.outcome, 'retired');
        assert.strictEqual(retired.registry.sources.length, 0);
        assert.strictEqual(retired.registry.revisions.length, 2);
        if (retired.outcome === 'retired') {
            assert.strictEqual(retired.revision.kind, 'retire');
            assert.strictEqual(retired.revision.reason, 'upstream-deprecated');
            assert.strictEqual(retired.revision.revisionId, 'rev-2');
        }
    });

    test('retire of an unknown sourceId is the unknown-source disclosure', () => {
        const registry = sourceContracts.createSourceRegistry(SCOPE_A);
        const result = sourceContracts.retireSource(registry, 'source-nope', 'policy', AT_ISO);
        assert.strictEqual(result.outcome, 'unknown-source');
        assert.strictEqual(result.registry, registry);
    });

    test('retire of an already-retired sourceId is the already-retired disclosure', () => {
        const registry = sourceContracts.createSourceRegistry(SCOPE_A);
        const registered = sourceContracts.registerSource(registry, makeDescriptor(), AT_ISO);
        const retired = sourceContracts.retireSource(
            registered.registry,
            'source-printing-press-1',
            'policy',
            AT_ISO_LATER
        );
        assert.strictEqual(retired.outcome, 'retired');
        const again = sourceContracts.retireSource(
            retired.registry,
            'source-printing-press-1',
            'policy',
            AT_ISO_LATER
        );
        assert.strictEqual(again.outcome, 'already-retired');
    });

    test('rejects out-of-vocabulary reasons and invalid ids with typed disclosures', () => {
        const registry = sourceContracts.createSourceRegistry(SCOPE_A);
        const registered = sourceContracts.registerSource(registry, makeDescriptor(), AT_ISO);
        assert.strictEqual(
            sourceContracts.retireSource(
                registered.registry,
                'source-printing-press-1',
                'just-because' as sourceContracts.SourceRetireReason,
                AT_ISO_LATER
            ).outcome,
            'invalid-reason'
        );
        assert.strictEqual(
            sourceContracts.retireSource(registered.registry, '', 'policy', AT_ISO_LATER).outcome,
            'invalid-source-id'
        );
        assert.strictEqual(
            sourceContracts.retireSource(
                registered.registry,
                'source-printing-press-1',
                'policy',
                'nope'
            ).outcome,
            'invalid-timestamp'
        );
    });

    test('a retired sourceId may re-register; the revision log keeps every event', () => {
        const registry = sourceContracts.createSourceRegistry(SCOPE_A);
        const registered = sourceContracts.registerSource(registry, makeDescriptor(), AT_ISO);
        const retired = sourceContracts.retireSource(
            registered.registry,
            'source-printing-press-1',
            'superseded',
            AT_ISO_LATER
        );
        const reRegistered = sourceContracts.registerSource(
            retired.registry,
            makeDescriptor({ sourceVersion: '2.0.0' }),
            AT_ISO_LATER
        );
        assert.strictEqual(reRegistered.outcome, 'registered');
        assert.strictEqual(reRegistered.registry.sources.length, 1);
        assert.strictEqual(reRegistered.registry.sources[0].sourceVersion, '2.0.0');
        assert.strictEqual(reRegistered.registry.revisions.length, 3);
        assert.strictEqual(reRegistered.registry.revisions[1].kind, 'retire');
        assert.strictEqual(reRegistered.registry.revisions[2].kind, 'register');
    });
});

suite('zc007 source contracts: queries and parity', () => {
    test('sourcesForKind returns only live sources of the requested kind', () => {
        const registry = sourceContracts.createSourceRegistry(SCOPE_A);
        const withPress = sourceContracts.registerSource(registry, makeDescriptor(), AT_ISO).registry;
        const withComposio = sourceContracts.registerSource(
            withPress,
            makeDescriptor({ sourceId: 'source-composio-1', kind: 'composio' }),
            AT_ISO
        ).registry;
        const withSecondPress = sourceContracts.registerSource(
            withComposio,
            makeDescriptor({ sourceId: 'source-printing-press-2' }),
            AT_ISO
        ).registry;
        const presses = sourceContracts.sourcesForKind(withSecondPress, 'printing-press');
        assert.strictEqual(presses.length, 2);
        assert.deepStrictEqual(
            presses.map((source) => source.sourceId),
            ['source-printing-press-1', 'source-printing-press-2']
        );
        assert.strictEqual(sourceContracts.sourcesForKind(withSecondPress, 'composio').length, 1);
        assert.strictEqual(sourceContracts.sourcesForKind(withSecondPress, 'site-spec').length, 0);
    });

    test('retired sources disappear from the live set and from queries', () => {
        const registry = sourceContracts.createSourceRegistry(SCOPE_A);
        const registered = sourceContracts.registerSource(registry, makeDescriptor(), AT_ISO);
        const retired = sourceContracts.retireSource(
            registered.registry,
            'source-printing-press-1',
            'policy',
            AT_ISO_LATER
        );
        assert.strictEqual(retired.registry.sources.length, 0);
        assert.strictEqual(
            sourceContracts.sourcesForKind(retired.registry, 'printing-press').length,
            0
        );
    });

    test('SOURCE_ADAPTERS_CONTRACTS_VERSION is 1.0.0 in every contract module', () => {
        assert.strictEqual(sourceContracts.SOURCE_ADAPTERS_CONTRACTS_VERSION, '1.0.0');
        assert.strictEqual(
            adapterContracts.SOURCE_ADAPTERS_CONTRACTS_VERSION,
            sourceContracts.SOURCE_ADAPTERS_CONTRACTS_VERSION
        );
        assert.strictEqual(
            importContracts.SOURCE_ADAPTERS_CONTRACTS_VERSION,
            sourceContracts.SOURCE_ADAPTERS_CONTRACTS_VERSION
        );
    });
});
