/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

// Tests for build/flauz/capabilities/sources/common/adapter.ts (ZC-007).
// Style: mocha tdd (suite/test), assert, .js import suffixes.

import assert from 'assert';
import * as adapterContracts from '../../common/adapter.js';
import * as sourceContracts from '../../common/source.js';
import * as importContracts from '../../common/import.js';

const SCOPE_A: adapterContracts.SourceScope = { workspaceId: 'ws-1', tenantId: 'tenant-1' };
const SCOPE_B: adapterContracts.SourceScope = { workspaceId: 'ws-2', tenantId: 'tenant-2' };

function makeAdapterDescriptor(
    overrides: Partial<adapterContracts.AdapterDescriptor> = {}
): adapterContracts.AdapterDescriptor {
    return {
        scope: SCOPE_A,
        contractVersion: adapterContracts.SOURCE_ADAPTERS_CONTRACTS_VERSION,
        adapterId: 'adapter-composio-1',
        sourceKind: 'composio',
        adapterVersion: '1.0.0',
        supportedSourceVersions: ['1.x'],
        ...overrides
    };
}

function makeArtifact(
    overrides: Partial<adapterContracts.DiscoveredArtifact> = {}
): adapterContracts.DiscoveredArtifact {
    return {
        scope: SCOPE_A,
        contractVersion: adapterContracts.SOURCE_ADAPTERS_CONTRACTS_VERSION,
        artifactId: 'artifact-1',
        sourceDescriptorRef: 'source-printing-press-1',
        artifactDigest: 'sha256-artifact-1',
        licenseSpdxId: 'MIT',
        declaredPermissions: [adapterContracts.CAPABILITY_PERMISSIONS[0]],
        declaredEndpoints: ['https://press.example.test/api/v1'],
        rawMetadataDigest: 'sha256-metadata-1',
        ...overrides
    };
}

suite('zc007 adapter contracts: cross-module parity', () => {
    test('the duplicated version constant does not drift from source.ts', () => {
        assert.strictEqual(adapterContracts.SOURCE_ADAPTERS_CONTRACTS_VERSION, '1.0.0');
        assert.strictEqual(
            adapterContracts.SOURCE_ADAPTERS_CONTRACTS_VERSION,
            sourceContracts.SOURCE_ADAPTERS_CONTRACTS_VERSION
        );
    });

    test('the duplicated SOURCE_KINDS projection matches the source.ts authority verbatim', () => {
        assert.deepStrictEqual(adapterContracts.SOURCE_KINDS, sourceContracts.SOURCE_KINDS);
    });

    test('SourceKind projections are mutually assignable (type-level pin)', () => {
        const fromSource: sourceContracts.SourceKind = 'mcp-catalog';
        const inAdapter: adapterContracts.SourceKind = fromSource;
        const backInSource: sourceContracts.SourceKind = inAdapter;
        assert.strictEqual(backInSource, 'mcp-catalog');
    });

    test('the zc006 permission-table seam twin copies are identical in adapter.ts and import.ts', () => {
        assert.deepStrictEqual(
            adapterContracts.CAPABILITY_PERMISSIONS,
            importContracts.CAPABILITY_PERMISSIONS
        );
    });

    test('CAPABILITY_PERMISSIONS is non-empty and self-consistent (seam-agnostic pin)', () => {
        assert.ok(adapterContracts.CAPABILITY_PERMISSIONS.length > 0);
        for (const permission of adapterContracts.CAPABILITY_PERMISSIONS) {
            assert.strictEqual(adapterContracts.isCapabilityPermission(permission), true, permission);
        }
        assert.strictEqual(adapterContracts.isCapabilityPermission('definitely-not-in-table'), false);
    });
});

suite('zc007 adapter contracts: guards', () => {
    test('isAdapterDescriptor validates a well-formed descriptor and rejects malformed ones', () => {
        assert.strictEqual(adapterContracts.isAdapterDescriptor(makeAdapterDescriptor()), true);
        assert.strictEqual(
            adapterContracts.isAdapterDescriptor({ ...makeAdapterDescriptor(), adapterId: '' }),
            false
        );
        assert.strictEqual(
            adapterContracts.isAdapterDescriptor({ ...makeAdapterDescriptor(), sourceKind: 'nope' }),
            false
        );
        assert.strictEqual(
            adapterContracts.isAdapterDescriptor({
                ...makeAdapterDescriptor(),
                supportedSourceVersions: '1.x'
            }),
            false
        );
        assert.strictEqual(adapterContracts.isAdapterDescriptor(null), false);
    });

    test('isAdapterRegistry enforces the exactly-one-active-per-kind invariant', () => {
        const registry = adapterContracts.createAdapterRegistry(SCOPE_A);
        const registered = adapterContracts.registerAdapter(registry, makeAdapterDescriptor());
        assert.strictEqual(registered.outcome, 'registered');
        assert.strictEqual(adapterContracts.isAdapterRegistry(registered.registry), true);
        const doublyOccupied = {
            scope: SCOPE_A,
            contractVersion: adapterContracts.SOURCE_ADAPTERS_CONTRACTS_VERSION,
            registrations: [
                {
                    scope: SCOPE_A,
                    contractVersion: adapterContracts.SOURCE_ADAPTERS_CONTRACTS_VERSION,
                    descriptor: makeAdapterDescriptor(),
                    state: 'active'
                },
                {
                    scope: SCOPE_A,
                    contractVersion: adapterContracts.SOURCE_ADAPTERS_CONTRACTS_VERSION,
                    descriptor: makeAdapterDescriptor({ adapterId: 'adapter-composio-2' }),
                    state: 'active'
                }
            ]
        };
        assert.strictEqual(adapterContracts.isAdapterRegistry(doublyOccupied), false);
    });

    test('isDiscoveredArtifact validates structure and enforces the permission vocabulary', () => {
        assert.strictEqual(adapterContracts.isDiscoveredArtifact(makeArtifact()), true);
        assert.strictEqual(
            adapterContracts.isDiscoveredArtifact(
                makeArtifact({
                    declaredPermissions: [
                        'bogus-permission'
                    ] as unknown as readonly adapterContracts.CapabilityPermission[]
                })
            ),
            false
        );
        assert.strictEqual(
            adapterContracts.isDiscoveredArtifact({
                ...makeArtifact(),
                rawMetadataDigest: 7
            } as unknown as adapterContracts.DiscoveredArtifact),
            false
        );
        assert.strictEqual(adapterContracts.isDiscoveredArtifact(null), false);
    });

    test('isFetchResult validates the digest-and-size contract shape', () => {
        const result: adapterContracts.FetchResult = {
            scope: SCOPE_A,
            contractVersion: adapterContracts.SOURCE_ADAPTERS_CONTRACTS_VERSION,
            sourceDescriptorRef: 'source-printing-press-1',
            artifactId: 'artifact-1',
            artifactDigest: 'sha256-artifact-1',
            byteSize: 2048
        };
        assert.strictEqual(adapterContracts.isFetchResult(result), true);
        assert.strictEqual(adapterContracts.isFetchResult({ ...result, byteSize: -1 }), false);
        assert.strictEqual(adapterContracts.isFetchResult({ ...result, byteSize: 1.5 }), false);
        assert.strictEqual(
            adapterContracts.isFetchResult({ ...result, byteSize: '2048' } as unknown as adapterContracts.FetchResult),
            false
        );
    });

    test('isNormalizeResult validates the Flauz-owned projection shape', () => {
        const result: adapterContracts.NormalizeResult = {
            scope: SCOPE_A,
            contractVersion: adapterContracts.SOURCE_ADAPTERS_CONTRACTS_VERSION,
            artifactId: 'artifact-1',
            artifactDigest: 'sha256-artifact-1',
            licenseSpdxId: 'MIT',
            licenseDigest: 'sha256-license-1',
            declaredPermissions: [adapterContracts.CAPABILITY_PERMISSIONS[0]],
            declaredEndpoints: ['https://press.example.test/api/v1'],
            rawMetadataDigest: 'sha256-metadata-1'
        };
        assert.strictEqual(adapterContracts.isNormalizeResult(result), true);
        assert.strictEqual(result.licenseDigest, 'sha256-license-1');
        assert.strictEqual(
            adapterContracts.isNormalizeResult({
                ...result,
                declaredPermissions: ['bogus']
            } as unknown as adapterContracts.NormalizeResult),
            false
        );
    });

    test('isCapabilitySourceAdapter validates the adapter interface shape (a type, never a runtime here)', () => {
        // The stub is never executed: the adapter contract is a shape only,
        // execution is out of scope by law.
        const stub: adapterContracts.CapabilitySourceAdapter = {
            descriptor: makeAdapterDescriptor(),
            discover: () =>
                Promise.resolve(null as unknown as adapterContracts.DiscoveryResult),
            fetch: () => Promise.resolve(null as unknown as adapterContracts.FetchResult),
            normalize: () => Promise.resolve(null as unknown as adapterContracts.NormalizeResult)
        };
        assert.strictEqual(adapterContracts.isCapabilitySourceAdapter(stub), true);
        assert.strictEqual(
            adapterContracts.isCapabilitySourceAdapter({
                ...stub,
                fetch: 'not-a-function'
            } as unknown as adapterContracts.CapabilitySourceAdapter),
            false
        );
        assert.strictEqual(adapterContracts.isCapabilitySourceAdapter(null), false);
    });
});

suite('zc007 adapter contracts: registerAdapter', () => {
    test('registers an active adapter for a kind', () => {
        const registry = adapterContracts.createAdapterRegistry(SCOPE_A);
        const result = adapterContracts.registerAdapter(registry, makeAdapterDescriptor());
        assert.strictEqual(result.outcome, 'registered');
        assert.strictEqual(result.registry.registrations.length, 1);
        if (result.outcome === 'registered') {
            assert.strictEqual(result.registration.state, 'active');
            assert.strictEqual(result.registration.descriptor.adapterId, 'adapter-composio-1');
            assert.deepStrictEqual(result.registration.scope, SCOPE_A);
        }
        assert.strictEqual(adapterContracts.isAdapterRegistry(result.registry), true);
    });

    test('a second active adapter for the same kind is the kind-occupied disclosure', () => {
        const registry = adapterContracts.createAdapterRegistry(SCOPE_A);
        const first = adapterContracts.registerAdapter(registry, makeAdapterDescriptor()).registry;
        const second = adapterContracts.registerAdapter(
            first,
            makeAdapterDescriptor({ adapterId: 'adapter-composio-2' })
        );
        assert.strictEqual(second.outcome, 'kind-occupied');
        if (second.outcome === 'kind-occupied') {
            assert.strictEqual(second.activeAdapterId, 'adapter-composio-1');
        }
        assert.strictEqual(second.registry, first);
    });

    test('re-registering an existing adapterId is idempotent-guarded', () => {
        const registry = adapterContracts.createAdapterRegistry(SCOPE_A);
        const first = adapterContracts.registerAdapter(registry, makeAdapterDescriptor());
        const second = adapterContracts.registerAdapter(
            first.registry,
            makeAdapterDescriptor({ adapterVersion: '2.0.0' })
        );
        assert.strictEqual(second.outcome, 'already-registered');
        assert.strictEqual(second.registry, first.registry);
        assert.strictEqual(second.registry.registrations.length, 1);
    });

    test('rejects version and scope mismatches with typed disclosures', () => {
        const registry = adapterContracts.createAdapterRegistry(SCOPE_A);
        const versionResult = adapterContracts.registerAdapter(
            registry,
            makeAdapterDescriptor({ contractVersion: '0.9.0' })
        );
        assert.strictEqual(versionResult.outcome, 'version-mismatch');
        if (versionResult.outcome === 'version-mismatch') {
            assert.strictEqual(versionResult.expected, '1.0.0');
            assert.strictEqual(versionResult.found, '0.9.0');
        }
        assert.strictEqual(
            adapterContracts.registerAdapter(
                registry,
                makeAdapterDescriptor({ scope: SCOPE_B })
            ).outcome,
            'scope-mismatch'
        );
        assert.strictEqual(
            adapterContracts.registerAdapter(
                registry,
                { garbage: true } as unknown as adapterContracts.AdapterDescriptor
            ).outcome,
            'invalid-descriptor'
        );
    });
});

suite('zc007 adapter contracts: supersedeAdapter (replacement law)', () => {
    test('superseding retires the old adapter and activates the new one for the kind', () => {
        const registry = adapterContracts.createAdapterRegistry(SCOPE_A);
        const registered = adapterContracts.registerAdapter(registry, makeAdapterDescriptor()).registry;
        const superseded = adapterContracts.supersedeAdapter(
            registered,
            'adapter-composio-1',
            makeAdapterDescriptor({
                adapterId: 'adapter-composio-2',
                adapterVersion: '2.0.0',
                supportedSourceVersions: ['1.x', '2.x']
            })
        );
        assert.strictEqual(superseded.outcome, 'superseded');
        if (superseded.outcome === 'superseded') {
            assert.strictEqual(superseded.retired.state, 'retired');
            assert.strictEqual(superseded.activated.state, 'active');
            assert.strictEqual(superseded.activated.descriptor.adapterVersion, '2.0.0');
        }
        assert.strictEqual(superseded.registry.registrations.length, 2);
        assert.strictEqual(adapterContracts.isAdapterRegistry(superseded.registry), true);
        const oldEntry = superseded.registry.registrations.find(
            (entry) => entry.descriptor.adapterId === 'adapter-composio-1'
        );
        assert.strictEqual(oldEntry?.state, 'retired');
    });

    test('after supersede, adapterFor resolves the new adapter (replaceable adapters)', () => {
        const registry = adapterContracts.createAdapterRegistry(SCOPE_A);
        const registered = adapterContracts.registerAdapter(registry, makeAdapterDescriptor()).registry;
        const superseded = adapterContracts.supersedeAdapter(
            registered,
            'adapter-composio-1',
            makeAdapterDescriptor({ adapterId: 'adapter-composio-2' })
        );
        const resolution = adapterContracts.adapterFor(superseded.registry, 'composio');
        assert.strictEqual(resolution.outcome, 'resolved');
        if (resolution.outcome === 'resolved') {
            assert.strictEqual(resolution.descriptor.adapterId, 'adapter-composio-2');
        }
    });

    test('supersede of an unknown or invalid adapterId is a typed disclosure', () => {
        const registry = adapterContracts.createAdapterRegistry(SCOPE_A);
        const registered = adapterContracts.registerAdapter(registry, makeAdapterDescriptor()).registry;
        assert.strictEqual(
            adapterContracts.supersedeAdapter(
                registered,
                'adapter-nope',
                makeAdapterDescriptor({ adapterId: 'adapter-composio-2' })
            ).outcome,
            'unknown-adapter'
        );
        assert.strictEqual(
            adapterContracts.supersedeAdapter(
                registered,
                '',
                makeAdapterDescriptor({ adapterId: 'adapter-composio-2' })
            ).outcome,
            'invalid-adapter-id'
        );
    });

    test('supersede of a retired adapter is the not-active disclosure', () => {
        const registry = adapterContracts.createAdapterRegistry(SCOPE_A);
        const registered = adapterContracts.registerAdapter(registry, makeAdapterDescriptor()).registry;
        const superseded = adapterContracts.supersedeAdapter(
            registered,
            'adapter-composio-1',
            makeAdapterDescriptor({ adapterId: 'adapter-composio-2' })
        );
        const again = adapterContracts.supersedeAdapter(
            superseded.registry,
            'adapter-composio-1',
            makeAdapterDescriptor({ adapterId: 'adapter-composio-3' })
        );
        assert.strictEqual(again.outcome, 'not-active');
        if (again.outcome === 'not-active') {
            assert.strictEqual(again.state, 'retired');
        }
    });

    test('supersede requires the new descriptor to serve the same sourceKind', () => {
        const registry = adapterContracts.createAdapterRegistry(SCOPE_A);
        const registered = adapterContracts.registerAdapter(registry, makeAdapterDescriptor()).registry;
        const result = adapterContracts.supersedeAdapter(
            registered,
            'adapter-composio-1',
            makeAdapterDescriptor({ adapterId: 'adapter-mcp-1', sourceKind: 'mcp-catalog' })
        );
        assert.strictEqual(result.outcome, 'kind-mismatch');
        if (result.outcome === 'kind-mismatch') {
            assert.strictEqual(result.expected, 'composio');
            assert.strictEqual(result.found, 'mcp-catalog');
        }
    });
});

suite('zc007 adapter contracts: adapterFor (resolution law)', () => {
    test('resolves the single active adapter for a kind', () => {
        const registry = adapterContracts.createAdapterRegistry(SCOPE_A);
        const registered = adapterContracts.registerAdapter(registry, makeAdapterDescriptor()).registry;
        const resolution = adapterContracts.adapterFor(registered, 'composio');
        assert.strictEqual(resolution.outcome, 'resolved');
        if (resolution.outcome === 'resolved') {
            assert.strictEqual(resolution.descriptor.sourceKind, 'composio');
            assert.strictEqual(resolution.descriptor.adapterId, 'adapter-composio-1');
        }
    });

    test('a kind without an adapter is the typed no-adapter disclosure, never a silent skip', () => {
        const registry = adapterContracts.createAdapterRegistry(SCOPE_A);
        const resolution = adapterContracts.adapterFor(registry, 'skill-catalog');
        assert.strictEqual(resolution.outcome, 'no-adapter');
        if (resolution.outcome === 'no-adapter') {
            assert.strictEqual(resolution.sourceKind, 'skill-catalog');
        }
    });

    test('a retired-only kind resolves to no-adapter (retired adapters never serve)', () => {
        const registry: adapterContracts.AdapterRegistry = {
            scope: SCOPE_A,
            contractVersion: adapterContracts.SOURCE_ADAPTERS_CONTRACTS_VERSION,
            registrations: [
                {
                    scope: SCOPE_A,
                    contractVersion: adapterContracts.SOURCE_ADAPTERS_CONTRACTS_VERSION,
                    descriptor: makeAdapterDescriptor(),
                    state: 'retired'
                }
            ]
        };
        assert.strictEqual(adapterContracts.adapterFor(registry, 'composio').outcome, 'no-adapter');
    });
});

suite('zc007 adapter contracts: discovery, fetch and normalize shapes', () => {
    test('DiscoveryRequest carries the source descriptor snapshot plus query filters', () => {
        const source: adapterContracts.SourceDescriptor = {
            scope: SCOPE_A,
            contractVersion: adapterContracts.SOURCE_ADAPTERS_CONTRACTS_VERSION,
            sourceId: 'source-printing-press-1',
            kind: 'printing-press',
            endpointRef: 'https://press.example.test/feed',
            sourceVersion: '1.2.3',
            discoveredAtIso: '2025-06-01T12:00:00.000Z',
            healthState: 'unknown'
        };
        const request: adapterContracts.DiscoveryRequest = {
            scope: SCOPE_A,
            contractVersion: adapterContracts.SOURCE_ADAPTERS_CONTRACTS_VERSION,
            source,
            queryFilters: [{ field: 'kind', value: 'tool' }]
        };
        assert.strictEqual(adapterContracts.isDiscoveryRequest(request), true);
        assert.strictEqual(request.source.kind, 'printing-press');
        assert.deepStrictEqual(request.queryFilters, [{ field: 'kind', value: 'tool' }]);
        assert.strictEqual(
            adapterContracts.isDiscoveryRequest({
                ...request,
                queryFilters: 'all'
            } as unknown as adapterContracts.DiscoveryRequest),
            false
        );
        const discovery: adapterContracts.DiscoveryResult = {
            scope: SCOPE_A,
            contractVersion: adapterContracts.SOURCE_ADAPTERS_CONTRACTS_VERSION,
            artifacts: [makeArtifact()]
        };
        assert.strictEqual(adapterContracts.isDiscoveryResult(discovery), true);
    });

    test('FetchResult is the contract about bytes - digest and byteSize, never the bytes', () => {
        const request: adapterContracts.FetchRequest = {
            scope: SCOPE_A,
            contractVersion: adapterContracts.SOURCE_ADAPTERS_CONTRACTS_VERSION,
            sourceDescriptorRef: 'source-printing-press-1',
            artifactId: 'artifact-1',
            artifactDigest: 'sha256-artifact-1'
        };
        assert.strictEqual(adapterContracts.isFetchRequest(request), true);
        const result: adapterContracts.FetchResult = {
            scope: SCOPE_A,
            contractVersion: adapterContracts.SOURCE_ADAPTERS_CONTRACTS_VERSION,
            sourceDescriptorRef: 'source-printing-press-1',
            artifactId: 'artifact-1',
            artifactDigest: 'sha256-artifact-1',
            byteSize: 2048
        };
        assert.strictEqual(adapterContracts.isFetchResult(result), true);
        // The contract shape carries no payload field: there is deliberately
        // no bytes/body/content property on FetchResult.
        assert.deepStrictEqual(Object.keys(result).sort(), [
            'artifactDigest',
            'artifactId',
            'byteSize',
            'contractVersion',
            'scope',
            'sourceDescriptorRef'
        ]);
    });

    test('NormalizeResult carries the Flauz-owned projection of one artifact', () => {
        const request: adapterContracts.NormalizeRequest = {
            scope: SCOPE_A,
            contractVersion: adapterContracts.SOURCE_ADAPTERS_CONTRACTS_VERSION,
            sourceDescriptorRef: 'source-printing-press-1',
            artifactId: 'artifact-1',
            artifactDigest: 'sha256-artifact-1',
            sourceNativeDigest: 'sha256-native-1'
        };
        assert.strictEqual(adapterContracts.isNormalizeRequest(request), true);
        const result: adapterContracts.NormalizeResult = {
            scope: SCOPE_A,
            contractVersion: adapterContracts.SOURCE_ADAPTERS_CONTRACTS_VERSION,
            artifactId: 'artifact-1',
            artifactDigest: 'sha256-artifact-1',
            licenseSpdxId: 'MIT',
            licenseDigest: 'sha256-license-1',
            declaredPermissions: [adapterContracts.CAPABILITY_PERMISSIONS[0]],
            declaredEndpoints: ['https://press.example.test/api/v1'],
            rawMetadataDigest: 'sha256-metadata-1'
        };
        assert.strictEqual(adapterContracts.isNormalizeResult(result), true);
        assert.strictEqual(result.licenseDigest, 'sha256-license-1');
    });
});
