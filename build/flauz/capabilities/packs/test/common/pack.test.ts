/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

// ZC-006 -- tests for the capability pack contract (mocha tdd, mirroring the
// style of build/flauz/lab/test/common/labContracts.test.ts).
//
// SEAM: TEST-IMPORTS -- the assert import line below follows the order's test
// style ('assert', '.js' import suffixes, mocha tdd). If the lab suite uses a
// different import line or a file-level pragma, transcribe it verbatim.
//
// SEAM: MOCHA-RUNNER -- these suites assume the repository's existing
// mocha + TypeScript pipeline (the one that runs the lab suites) resolves
// '../../common/pack.js' beside this file.

import assert from 'assert';
import {
    CAPABILITY_PACKS_CONTRACTS_VERSION,
    PACK_ARTIFACT_KINDS,
    PACK_CONFIGURATION_FIELD_TYPES,
    PACK_PERMISSION_IDS,
    PACK_PERMISSION_TABLE,
    PACK_PLATFORMS,
    PACK_REJECTION_CODES,
    PACK_SOURCE_TYPES,
    PERMISSION_RISK_TIERS,
    REQUIRED_CAPABILITY_REF_KINDS,
    compatibilityFor,
    configurationDefaultGrantsUndeclaredPermission,
    highestPermissionRiskTier,
    isCapabilityPack,
    isDeclaredPermissions,
    isIso8601String,
    isPackArtifact,
    isPackArtifactKind,
    isPackConfiguration,
    isPackIdString,
    isPackPermissionId,
    isPackProvenance,
    isPackScope,
    isPackSourceType,
    isPackPlatform,
    isPlatformCompatibility,
    isPermissionRiskTier,
    isRequiredCapabilityRef,
    isSemverString,
    isSha256Digest,
    packArtifactDigestOrder,
    packIntegrityPreimage,
    permissionRiskTier,
    permissionRiskTierAtLeast,
    validateCapabilityPack
} from '../../common/pack.js';
import type {
    CapabilityPack,
    DeclaredPermissions,
    PackArtifact,
    PackArtifactKind,
    PackConfiguration,
    PermissionRiskTier,
    RequiredCapabilityRef
} from '../../common/pack.js';

function digestOf(char: string): string {
    return char.repeat(64);
}

function makeArtifact(kind: PackArtifactKind, digestChar: string, entrypointRef: string): PackArtifact {
    return { kind, artifactDigest: digestOf(digestChar), byteSize: 256, entrypointRef };
}

function makeBasePack(): CapabilityPack {
    return {
        scope: { workspaceId: 'ws-alpha', tenantId: 'tenant-alpha' },
        contractVersion: CAPABILITY_PACKS_CONTRACTS_VERSION,
        packId: 'flauz.pack.example',
        version: '1.2.3',
        nameDigest: digestOf('a'),
        descriptionDigest: digestOf('b'),
        artifacts: [makeArtifact('cli', 'c', './bin/cli'), makeArtifact('skill-instructions', 'd', './skills/main.md')],
        requiredCapabilities: [{ kind: REQUIRED_CAPABILITY_REF_KINDS[0], refId: 'flauz.cap.example' }],
        declaredPermissions: ['read-files', 'write-workspace'],
        configuration: {
            fields: [{ name: 'verbosity', type: 'string', required: false }],
            defaults: { verbosity: 'normal' }
        },
        provenance: {
            origin: 'flauz-internal',
            sourceType: 'flauz-native',
            capturedAtIso: '2026-01-15T09:30:00Z',
            licenseSpdxId: 'MIT',
            licenseDigest: digestOf('e')
        },
        platformCompatibility: ['darwin-arm64', 'linux-x64'],
        integrity: { contentDigest: digestOf('f') }
    };
}

function packWith(overrides: Partial<CapabilityPack>): CapabilityPack {
    return { ...makeBasePack(), ...overrides };
}

function rejectionCodeOf(value: unknown): string | null {
    const result = validateCapabilityPack(value);
    return result.ok ? null : result.code;
}

suite('capability pack contracts (zc006)', () => {

    suite('contract version', () => {
        test('pins the contract set version at 1.0.0', () => {
            assert.strictEqual(CAPABILITY_PACKS_CONTRACTS_VERSION, '1.0.0');
        });
    });

    suite('frozen vocabularies', () => {
        test('pins the artifact kind table', () => {
            assert.deepStrictEqual([...PACK_ARTIFACT_KINDS], ['cli', 'skill-instructions', 'mcp-server', 'commands']);
        });
        test('the artifact kind guard accepts exactly the table', () => {
            for (const kind of PACK_ARTIFACT_KINDS) {
                assert.strictEqual(isPackArtifactKind(kind), true, kind);
            }
            for (const value of ['plugin', 'CLI', '', null, undefined, 0]) {
                assert.strictEqual(isPackArtifactKind(value), false, String(value));
            }
        });
        test('pins the permission id table', () => {
            assert.deepStrictEqual([...PACK_PERMISSION_IDS], ['read-files', 'execute-command', 'network-access', 'write-workspace']);
        });
        test('the permission guard accepts exactly the table', () => {
            for (const permission of PACK_PERMISSION_IDS) {
                assert.strictEqual(isPackPermissionId(permission), true, permission);
            }
            for (const value of ['root-access', 'READ-FILES', '', null, 1]) {
                assert.strictEqual(isPackPermissionId(value), false, String(value));
            }
        });
        test('pins the risk tiers', () => {
            assert.deepStrictEqual([...PERMISSION_RISK_TIERS], ['low', 'moderate', 'high']);
        });
        test('the permission table covers every permission with a valid tier', () => {
            assert.deepStrictEqual([...PACK_PERMISSION_IDS].sort(), Object.keys(PACK_PERMISSION_TABLE).sort());
            for (const permission of PACK_PERMISSION_IDS) {
                assert.strictEqual(isPermissionRiskTier(PACK_PERMISSION_TABLE[permission]), true, permission);
            }
        });
        test('pins the permission risk tiers', () => {
            assert.strictEqual(PACK_PERMISSION_TABLE['read-files'], 'low');
            assert.strictEqual(PACK_PERMISSION_TABLE['execute-command'], 'high');
            assert.strictEqual(PACK_PERMISSION_TABLE['network-access'], 'high');
            assert.strictEqual(PACK_PERMISSION_TABLE['write-workspace'], 'moderate');
        });
        test('pins the source types and their guard', () => {
            assert.deepStrictEqual([...PACK_SOURCE_TYPES], ['flauz-native', 'imported']);
            for (const sourceType of PACK_SOURCE_TYPES) {
                assert.strictEqual(isPackSourceType(sourceType), true, sourceType);
            }
            assert.strictEqual(isPackSourceType('vendor'), false);
        });
        test('pins the platform list', () => {
            assert.deepStrictEqual([...PACK_PLATFORMS], ['darwin-x64', 'darwin-arm64', 'linux-x64', 'linux-arm64', 'windows-x64']);
        });
        test('the platform guard accepts exactly the list', () => {
            for (const platform of PACK_PLATFORMS) {
                assert.strictEqual(isPackPlatform(platform), true, platform);
            }
            for (const value of ['plan9', 'darwin', 'LINUX-X64', '', null]) {
                assert.strictEqual(isPackPlatform(value), false, String(value));
            }
        });
        test('pins the configuration field types', () => {
            assert.deepStrictEqual([...PACK_CONFIGURATION_FIELD_TYPES], ['string', 'number', 'boolean']);
        });
        test('pins the rejection codes', () => {
            assert.deepStrictEqual([...PACK_REJECTION_CODES], [
                'pack-malformed',
                'pack-scope-invalid',
                'pack-contract-version-mismatch',
                'pack-id-invalid',
                'pack-version-invalid',
                'pack-name-digest-invalid',
                'pack-description-digest-invalid',
                'pack-artifacts-empty',
                'pack-artifact-invalid',
                'pack-required-capability-invalid',
                'pack-permission-unknown',
                'pack-permission-duplicate',
                'pack-configuration-invalid',
                'pack-configuration-grants-undeclared-permission',
                'pack-provenance-invalid',
                'pack-platform-invalid',
                'pack-integrity-invalid'
            ]);
        });
        test('required capability ref kinds are frozen, unique and non-empty (SEAM: see common/pack.ts)', () => {
            assert.ok(Array.isArray(REQUIRED_CAPABILITY_REF_KINDS));
            assert.ok(REQUIRED_CAPABILITY_REF_KINDS.length > 0);
            const seen: Set<string> = new Set();
            for (const kind of REQUIRED_CAPABILITY_REF_KINDS) {
                assert.strictEqual(typeof kind, 'string', 'ref kinds must be strings');
                assert.ok(kind.length > 0, 'ref kinds must be non-empty');
                assert.strictEqual(seen.has(kind), false, `duplicate ref kind '${kind}'`);
                seen.add(kind);
                assert.strictEqual(isRequiredCapabilityRef({ kind, refId: 'flauz.cap.example' }), true, kind);
            }
            assert.strictEqual(isRequiredCapabilityRef({ kind: 'not-a-ref-kind', refId: 'flauz.cap.example' }), false);
        });
    });

    suite('shape guards', () => {
        test('sha-256 digests are 64 lowercase hex characters', () => {
            assert.strictEqual(isSha256Digest(digestOf('a')), true);
            assert.strictEqual(isSha256Digest(digestOf('0')), true);
            assert.strictEqual(isSha256Digest(digestOf('f')), true);
            assert.strictEqual(isSha256Digest('a'.repeat(63)), false);
            assert.strictEqual(isSha256Digest('a'.repeat(65)), false);
            assert.strictEqual(isSha256Digest('A'.repeat(64)), false);
            assert.strictEqual(isSha256Digest('g'.repeat(64)), false);
            assert.strictEqual(isSha256Digest(64), false);
        });
        test('semver strings follow the plain semver shape', () => {
            assert.strictEqual(isSemverString('1.2.3'), true);
            assert.strictEqual(isSemverString('0.0.0'), true);
            assert.strictEqual(isSemverString('1.2.3-beta.1'), true);
            assert.strictEqual(isSemverString('1.2.3+build.7'), true);
            assert.strictEqual(isSemverString('1.2.3-rc.1+build.2'), true);
            assert.strictEqual(isSemverString('1.2'), false);
            assert.strictEqual(isSemverString('v1.2.3'), false);
            assert.strictEqual(isSemverString('01.2.3'), false);
            assert.strictEqual(isSemverString('1.2.3-'), false);
            assert.strictEqual(isSemverString(''), false);
        });
        test('iso-8601 strings are plain timestamp shapes', () => {
            assert.strictEqual(isIso8601String('2026-01-15T09:30:00Z'), true);
            assert.strictEqual(isIso8601String('2026-01-15T09:30:00.123Z'), true);
            assert.strictEqual(isIso8601String('2026-01-15T09:30:00+02:00'), true);
            assert.strictEqual(isIso8601String('2026-01-15'), false);
            assert.strictEqual(isIso8601String('2026-1-15T09:30:00Z'), false);
            assert.strictEqual(isIso8601String('2026-01-15 09:30:00Z'), false);
            assert.strictEqual(isIso8601String('2026-01-15T09:30Z'), false);
            // the guard pins the timestamp SHAPE, not calendar validity
            assert.strictEqual(isIso8601String('2026-13-45T99:99:99Z'), true);
        });
        test('pack ids follow the pack id pattern', () => {
            assert.strictEqual(isPackIdString('flauz.pack.example'), true);
            assert.strictEqual(isPackIdString('a'), true);
            assert.strictEqual(isPackIdString('a-b_c.d'), true);
            assert.strictEqual(isPackIdString('.hidden'), false);
            assert.strictEqual(isPackIdString('-dash'), false);
            assert.strictEqual(isPackIdString('with space'), false);
            assert.strictEqual(isPackIdString(''), false);
        });
        test('pack scope carries a workspace and a tenant', () => {
            assert.strictEqual(isPackScope({ workspaceId: 'ws-1', tenantId: 'tenant-1' }), true);
            assert.strictEqual(isPackScope({ workspaceId: '', tenantId: 'tenant-1' }), false);
            assert.strictEqual(isPackScope({ workspaceId: 'ws-1' }), false);
            assert.strictEqual(isPackScope(null), false);
            assert.strictEqual(isPackScope('ws-1/tenant-1'), false);
        });
    });

    suite('artifacts', () => {
        test('accepts a valid artifact', () => {
            assert.strictEqual(isPackArtifact(makeArtifact('cli', 'c', './bin/cli')), true);
        });
        test('rejects an unknown kind', () => {
            assert.strictEqual(isPackArtifact({ ...makeArtifact('cli', 'c', './bin/cli'), kind: 'plugin' }), false);
        });
        test('rejects a malformed digest', () => {
            assert.strictEqual(isPackArtifact({ ...makeArtifact('cli', 'c', './bin/cli'), artifactDigest: 'not-a-digest' }), false);
        });
        test('rejects a negative or fractional byte size', () => {
            assert.strictEqual(isPackArtifact({ ...makeArtifact('cli', 'c', './bin/cli'), byteSize: -1 }), false);
            assert.strictEqual(isPackArtifact({ ...makeArtifact('cli', 'c', './bin/cli'), byteSize: 1.5 }), false);
            assert.strictEqual(isPackArtifact({ ...makeArtifact('cli', 'c', './bin/cli'), byteSize: 0 }), true);
        });
        test('rejects an empty entrypoint reference', () => {
            assert.strictEqual(isPackArtifact({ ...makeArtifact('cli', 'c', './bin/cli'), entrypointRef: '' }), false);
        });
    });

    suite('required capabilities', () => {
        test('accepts every frozen reference kind (SEAM-safe)', () => {
            for (const kind of REQUIRED_CAPABILITY_REF_KINDS) {
                const ref: RequiredCapabilityRef = { kind, refId: 'flauz.cap.example' };
                assert.strictEqual(isRequiredCapabilityRef(ref), true, kind);
            }
        });
        test('rejects malformed references', () => {
            assert.strictEqual(isRequiredCapabilityRef({ kind: REQUIRED_CAPABILITY_REF_KINDS[0], refId: '' }), false);
            assert.strictEqual(isRequiredCapabilityRef({ kind: REQUIRED_CAPABILITY_REF_KINDS[0] }), false);
            assert.strictEqual(isRequiredCapabilityRef(null), false);
        });
    });

    suite('permissions', () => {
        test('accepts a declaration list and the empty declaration', () => {
            assert.strictEqual(isDeclaredPermissions(['read-files', 'network-access']), true);
            assert.strictEqual(isDeclaredPermissions([]), true);
        });
        test('rejects unknown and duplicate permissions', () => {
            assert.strictEqual(isDeclaredPermissions(['root-access']), false);
            assert.strictEqual(isDeclaredPermissions(['read-files', 'read-files']), false);
            assert.strictEqual(isDeclaredPermissions('read-files'), false);
        });
        test('reads the risk tier from the table', () => {
            assert.strictEqual(permissionRiskTier('read-files'), 'low');
            assert.strictEqual(permissionRiskTier('write-workspace'), 'moderate');
            assert.strictEqual(permissionRiskTier('execute-command'), 'high');
        });
        test('returns null when no permission is declared', () => {
            const none: DeclaredPermissions = [];
            assert.strictEqual(highestPermissionRiskTier(none), null);
        });
        test('returns the highest declared tier', () => {
            const mixed: DeclaredPermissions = ['read-files', 'write-workspace'];
            const highest: PermissionRiskTier | null = highestPermissionRiskTier(mixed);
            assert.strictEqual(highest, 'moderate');
            assert.strictEqual(highestPermissionRiskTier(['read-files']), 'low');
        });
        test('answers tier thresholds', () => {
            assert.strictEqual(permissionRiskTierAtLeast(['read-files'], 'low'), true);
            assert.strictEqual(permissionRiskTierAtLeast(['read-files'], 'moderate'), false);
            assert.strictEqual(permissionRiskTierAtLeast(['read-files', 'execute-command'], 'high'), true);
            assert.strictEqual(permissionRiskTierAtLeast([], 'low'), false);
        });
    });

    suite('configuration', () => {
        test('accepts a valid schema', () => {
            const configuration: PackConfiguration = {
                fields: [
                    { name: 'verbosity', type: 'string', required: false },
                    { name: 'retries', type: 'number', required: true },
                    { name: 'verbose', type: 'boolean', required: false }
                ],
                defaults: { verbosity: 'normal', retries: 3, verbose: null }
            };
            assert.strictEqual(isPackConfiguration(configuration), true);
        });
        test('rejects duplicate field names', () => {
            assert.strictEqual(isPackConfiguration({
                fields: [
                    { name: 'verbosity', type: 'string', required: false },
                    { name: 'verbosity', type: 'string', required: false }
                ],
                defaults: {}
            }), false);
        });
        test('rejects unknown field types', () => {
            assert.strictEqual(isPackConfiguration({
                fields: [{ name: 'retries', type: 'integer', required: false }],
                defaults: {}
            }), false);
        });
        test('rejects defaults outside the field set', () => {
            assert.strictEqual(isPackConfiguration({
                fields: [{ name: 'verbosity', type: 'string', required: false }],
                defaults: { unknown: 'value' }
            }), false);
        });
        test('rejects defaults with the wrong value type', () => {
            assert.strictEqual(isPackConfiguration({
                fields: [{ name: 'retries', type: 'number', required: false }],
                defaults: { retries: 'three' }
            }), false);
        });
        test('accepts null defaults for any field type', () => {
            assert.strictEqual(isPackConfiguration({
                fields: [{ name: 'verbose', type: 'boolean', required: false }],
                defaults: { verbose: null }
            }), true);
        });
        test('the default-permission law flags a default granting an undeclared permission', () => {
            const configuration: PackConfiguration = {
                fields: [{ name: 'network-access', type: 'boolean', required: false }],
                defaults: { 'network-access': true }
            };
            assert.strictEqual(configurationDefaultGrantsUndeclaredPermission(configuration, ['read-files']), true);
        });
        test('the default-permission law allows a default granting a declared permission', () => {
            const configuration: PackConfiguration = {
                fields: [{ name: 'network-access', type: 'boolean', required: false }],
                defaults: { 'network-access': true }
            };
            assert.strictEqual(configurationDefaultGrantsUndeclaredPermission(configuration, ['read-files', 'network-access']), false);
        });
        test('the default-permission law ignores non-granting and non-permission defaults', () => {
            const configuration: PackConfiguration = {
                fields: [
                    { name: 'network-access', type: 'boolean', required: false },
                    { name: 'verbosity', type: 'string', required: false }
                ],
                defaults: { 'network-access': false, verbosity: 'loud' }
            };
            assert.strictEqual(configurationDefaultGrantsUndeclaredPermission(configuration, ['read-files']), false);
        });
    });

    suite('provenance', () => {
        test('accepts valid provenance', () => {
            assert.strictEqual(isPackProvenance({
                origin: 'flauz-internal',
                sourceType: 'flauz-native',
                capturedAtIso: '2026-01-15T09:30:00Z',
                licenseSpdxId: 'MIT',
                licenseDigest: digestOf('e')
            }), true);
            assert.strictEqual(isPackProvenance({
                origin: 'github.com/example/upstream',
                sourceType: 'imported',
                capturedAtIso: '2026-02-01T00:00:00+00:00',
                licenseSpdxId: 'Apache-2.0',
                licenseDigest: digestOf('e')
            }), true);
        });
        test('rejects malformed spdx identifiers', () => {
            const base = makeBasePack().provenance;
            assert.strictEqual(isPackProvenance({ ...base, licenseSpdxId: '' }), false);
            assert.strictEqual(isPackProvenance({ ...base, licenseSpdxId: '-MIT' }), false);
            assert.strictEqual(isPackProvenance({ ...base, licenseSpdxId: 'MIT License' }), false);
        });
        test('rejects invalid timestamps and digests', () => {
            const base = makeBasePack().provenance;
            assert.strictEqual(isPackProvenance({ ...base, capturedAtIso: '2026-01-15' }), false);
            assert.strictEqual(isPackProvenance({ ...base, licenseDigest: 'short' }), false);
        });
        test('rejects unknown source types and empty origins', () => {
            const base = makeBasePack().provenance;
            assert.strictEqual(isPackProvenance({ ...base, sourceType: 'vendor' }), false);
            assert.strictEqual(isPackProvenance({ ...base, origin: '' }), false);
        });
    });

    suite('platform compatibility', () => {
        test('accepts a unique platform list (the empty list is a guard-level shape)', () => {
            assert.strictEqual(isPlatformCompatibility(['darwin-arm64', 'linux-x64']), true);
            assert.strictEqual(isPlatformCompatibility([]), true);
        });
        test('rejects duplicates and unknown platforms', () => {
            assert.strictEqual(isPlatformCompatibility(['linux-x64', 'linux-x64']), false);
            assert.strictEqual(isPlatformCompatibility(['linux-x64', 'plan9']), false);
        });
    });

    suite('integrity digest order', () => {
        test('orders artifact digests by kind, then digest, then entrypoint', () => {
            const pack = packWith({
                artifacts: [
                    makeArtifact('skill-instructions', 'f', './skills/main.md'),
                    makeArtifact('cli', 'e', './bin/cli'),
                    makeArtifact('commands', 'd', './commands')
                ]
            });
            assert.deepStrictEqual([...packArtifactDigestOrder(pack)], [digestOf('e'), digestOf('d'), digestOf('f')]);
        });
        test('breaks ties within a kind by artifact digest value', () => {
            const pack = packWith({
                artifacts: [
                    makeArtifact('cli', 'b', './bin/first'),
                    makeArtifact('cli', 'a', './bin/second')
                ]
            });
            assert.deepStrictEqual([...packArtifactDigestOrder(pack)], [digestOf('a'), digestOf('b')]);
        });
        test('is stable and joins the ordered digests into the preimage', () => {
            const pack = makeBasePack();
            assert.deepStrictEqual([...packArtifactDigestOrder(pack)], [...packArtifactDigestOrder(pack)]);
            assert.strictEqual(packIntegrityPreimage(pack), packArtifactDigestOrder(pack).join('\n'));
        });
    });

    suite('validateCapabilityPack', () => {
        test('accepts the base fixture', () => {
            const result = validateCapabilityPack(makeBasePack());
            assert.strictEqual(result.ok, true);
        });
        test('rejects an invalid scope', () => {
            assert.strictEqual(rejectionCodeOf(packWith({ scope: { workspaceId: '', tenantId: 'tenant-alpha' } })), 'pack-scope-invalid');
        });
        test('rejects a contract version mismatch', () => {
            assert.strictEqual(rejectionCodeOf(packWith({ contractVersion: '0.9.0' })), 'pack-contract-version-mismatch');
        });
        test('rejects an invalid pack id', () => {
            assert.strictEqual(rejectionCodeOf(packWith({ packId: '.bad-start' })), 'pack-id-invalid');
        });
        test('rejects a non-semver version', () => {
            assert.strictEqual(rejectionCodeOf(packWith({ version: 'v1' })), 'pack-version-invalid');
        });
        test('rejects malformed name and description digests', () => {
            assert.strictEqual(rejectionCodeOf(packWith({ nameDigest: 'short' })), 'pack-name-digest-invalid');
            assert.strictEqual(rejectionCodeOf(packWith({ descriptionDigest: 'short' })), 'pack-description-digest-invalid');
        });
        test('rejects an empty or missing artifact list', () => {
            assert.strictEqual(rejectionCodeOf(packWith({ artifacts: [] })), 'pack-artifacts-empty');
            assert.strictEqual(rejectionCodeOf(packWith({ artifacts: undefined })), 'pack-artifacts-empty');
        });
        test('rejects an invalid artifact entry', () => {
            assert.strictEqual(rejectionCodeOf(packWith({ artifacts: [{ kind: 'cli', artifactDigest: 'nope', byteSize: 1, entrypointRef: './x' }] })), 'pack-artifact-invalid');
        });
        test('rejects invalid required capabilities', () => {
            assert.strictEqual(rejectionCodeOf(packWith({ requiredCapabilities: [{ kind: 'nope' as unknown as RequiredCapabilityRef['kind'], refId: 'x' }] })), 'pack-required-capability-invalid');
            assert.strictEqual(rejectionCodeOf(packWith({ requiredCapabilities: 'flauz.cap.example' as unknown as CapabilityPack['requiredCapabilities'] })), 'pack-required-capability-invalid');
        });
        test('rejects an invented permission (the table is closed)', () => {
            assert.strictEqual(rejectionCodeOf(packWith({ declaredPermissions: ['read-files', 'root-access' as unknown as (typeof PACK_PERMISSION_IDS)[number]] })), 'pack-permission-unknown');
        });
        test('rejects a duplicated permission', () => {
            assert.strictEqual(rejectionCodeOf(packWith({ declaredPermissions: ['read-files', 'read-files'] })), 'pack-permission-duplicate');
        });
        test('rejects an invalid configuration', () => {
            assert.strictEqual(rejectionCodeOf(packWith({ configuration: { fields: [{ name: 'x', type: 'integer' as unknown as PackConfiguration['fields'][number]['type'], required: false }], defaults: {} } })), 'pack-configuration-invalid');
        });
        test('rejects a default granting an undeclared permission', () => {
            const configuration: PackConfiguration = {
                fields: [{ name: 'network-access', type: 'boolean', required: false }],
                defaults: { 'network-access': true }
            };
            assert.strictEqual(rejectionCodeOf(packWith({ configuration, declaredPermissions: ['read-files'] })), 'pack-configuration-grants-undeclared-permission');
        });
        test('rejects invalid provenance', () => {
            assert.strictEqual(rejectionCodeOf(packWith({ provenance: { ...makeBasePack().provenance, licenseSpdxId: '' } })), 'pack-provenance-invalid');
        });
        test('rejects an empty, unknown or duplicated platform list', () => {
            assert.strictEqual(rejectionCodeOf(packWith({ platformCompatibility: [] })), 'pack-platform-invalid');
            assert.strictEqual(rejectionCodeOf(packWith({ platformCompatibility: ['plan9' as unknown as (typeof PACK_PLATFORMS)[number]] })), 'pack-platform-invalid');
            assert.strictEqual(rejectionCodeOf(packWith({ platformCompatibility: ['linux-x64', 'linux-x64'] })), 'pack-platform-invalid');
        });
        test('rejects an invalid integrity digest', () => {
            assert.strictEqual(rejectionCodeOf(packWith({ integrity: { contentDigest: 'short' } })), 'pack-integrity-invalid');
        });
        test('checks the scope before the version (fixed order)', () => {
            const pack = packWith({ scope: { workspaceId: '', tenantId: '' }, contractVersion: '0.9.0' });
            assert.strictEqual(rejectionCodeOf(pack), 'pack-scope-invalid');
        });
        test('rejects a non-object with pack-malformed', () => {
            assert.strictEqual(rejectionCodeOf(null), 'pack-malformed');
            assert.strictEqual(rejectionCodeOf('pack'), 'pack-malformed');
        });
    });

    suite('isCapabilityPack and compatibilityFor', () => {
        test('isCapabilityPack mirrors validateCapabilityPack', () => {
            assert.strictEqual(isCapabilityPack(makeBasePack()), true);
            assert.strictEqual(isCapabilityPack(packWith({ version: 'v1' })), false);
            assert.strictEqual(isCapabilityPack(null), false);
        });
        test('compatibilityFor answers declared platforms only', () => {
            const pack = makeBasePack();
            assert.strictEqual(compatibilityFor(pack, 'darwin-arm64'), true);
            assert.strictEqual(compatibilityFor(pack, 'linux-x64'), true);
            assert.strictEqual(compatibilityFor(pack, 'windows-x64'), false);
            assert.strictEqual(compatibilityFor(pack, 'plan9'), false);
        });
    });
});
