/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

// ZC-006 -- tests for the capability pack catalog contract (mocha tdd,
// mirroring the style of build/flauz/lab/test/common/labContracts.test.ts).
//
// This suite also carries the CROSS-MODULE PINS: catalog.ts restates its
// sibling vocabularies as pinned mirrors (the zero-import law forbids sharing
// them through imports), so these tests pin every mirror set-equal and
// behaviorally equal to its authority module.
//
// SEAM: TEST-IMPORTS -- the assert import line below follows the order's test
// style. If the lab suite uses a different import line or a file-level
// pragma, transcribe it verbatim.
//
// SEAM: MOCHA-RUNNER -- these suites assume the repository's existing
// mocha + TypeScript pipeline (the one that runs the lab suites) resolves
// '../../common/catalog.js' beside this file.

import assert from 'assert';
import {
    CAPABILITY_PACKS_CONTRACTS_VERSION,
    CATALOG_ARTIFACT_KINDS,
    CATALOG_DEPRECATION_REASONS,
    CATALOG_PERMISSION_FACT_TIERS,
    CATALOG_PERMISSION_IDS,
    CATALOG_PERMISSION_RISK_TIERS,
    CATALOG_PERMISSION_TABLE,
    CATALOG_PLATFORMS,
    CATALOG_REJECTION_CODES,
    CATALOG_VERIFICATION_MISMATCH_KINDS,
    CATALOG_VERIFICATION_STATUSES,
    andEntryPredicates,
    deprecatePack,
    deriveCatalogEntryStatus,
    emptyCatalog,
    entryHasArtifactKind,
    entryIsDeprecated,
    entryMatchesVerificationStatus,
    entryPermissionTier,
    entryPermissionTierAtLeast,
    entrySupportsPlatform,
    highestCatalogPermissionFactTier,
    isCatalogDeprecationReason,
    isCatalogEntry,
    isCatalogPackFacts,
    isCatalogPermissionFactTier,
    isCatalogRejectionCode,
    isCatalogRecord,
    isCatalogVerificationReceipt,
    latestEntryFor,
    orEntryPredicates,
    packFactsFromProjection,
    queryCatalog,
    registerPack,
    validateCatalogPackProjection,
    verifyPack
} from '../../common/catalog.js';
import type {
    CatalogDeprecation,
    CatalogEntry,
    CatalogEntryPredicate,
    CatalogPackProjection,
    CatalogQueryResult,
    CatalogRecord,
    CatalogRejection,
    CatalogSubjectIdentity,
    CatalogTransitionResult,
    CatalogVerificationCheck,
    CatalogVerificationReceipt,
    CatalogVerificationStatus
} from '../../common/catalog.js';
import {
    CAPABILITY_PACKS_CONTRACTS_VERSION as VERIFICATION_VERSION,
    VERIFICATION_MISMATCH_KINDS,
    VERIFICATION_STATUSES,
    canAdmitToCatalog,
    validateVerificationReceipt,
    verificationStatusFor
} from '../../common/verification.js';
import {
    CAPABILITY_PACKS_CONTRACTS_VERSION as PACK_VERSION,
    PACK_ARTIFACT_KINDS,
    PACK_PERMISSION_IDS,
    PACK_PERMISSION_TABLE,
    PACK_PLATFORMS,
    PERMISSION_RISK_TIERS,
    REQUIRED_CAPABILITY_REF_KINDS,
    isCapabilityPack
} from '../../common/pack.js';
import type { CapabilityPack } from '../../common/pack.js';

const ISO_A = '2026-03-01T10:00:00Z';
const ISO_B = '2026-03-02T10:00:00Z';

const DEPRECATION: CatalogDeprecation = {
    reason: 'deprecated-superseded',
    note: 'replaced by 2.0.0',
    deprecatedAtIso: ISO_B
};

function digestOf(char: string): string {
    return char.repeat(64);
}

function sorted(values: readonly string[]): string[] {
    return [...values].sort();
}

function makeScope(): { workspaceId: string; tenantId: string } {
    return { workspaceId: 'ws-alpha', tenantId: 'tenant-alpha' };
}

function makeCatalog(): CatalogRecord {
    return emptyCatalog(makeScope(), 'catalog-1');
}

function makePack(): CatalogPackProjection {
    return {
        scope: makeScope(),
        contractVersion: CAPABILITY_PACKS_CONTRACTS_VERSION,
        packId: 'flauz.pack.example',
        version: '1.2.3',
        nameDigest: digestOf('a'),
        artifacts: [{ kind: 'cli' }, { kind: 'skill-instructions' }],
        platformCompatibility: ['darwin-arm64', 'linux-x64'],
        declaredPermissions: ['read-files', 'write-workspace']
    };
}

function packWith(overrides: Partial<CatalogPackProjection>): CatalogPackProjection {
    return { ...makePack(), ...overrides };
}

function packVariant(overrides: Record<string, unknown>): unknown {
    return { ...makePack(), ...overrides };
}

function check(name: string, passed: boolean): CatalogVerificationCheck {
    return { name, passed, evidenceDigest: digestOf('a') };
}

function receiptFor(packId: string, version: string, status: CatalogVerificationStatus, checks: CatalogVerificationCheck[]): CatalogVerificationReceipt {
    return {
        scope: makeScope(),
        contractVersion: CAPABILITY_PACKS_CONTRACTS_VERSION,
        packId,
        version,
        status,
        checks
    };
}

function makeReceipt(): CatalogVerificationReceipt {
    return receiptFor('flauz.pack.example', '1.2.3', 'verified', [check('integrity', true)]);
}

function receiptWith(overrides: Partial<CatalogVerificationReceipt>): CatalogVerificationReceipt {
    return { ...makeReceipt(), ...overrides };
}

function receiptVariant(overrides: Record<string, unknown>): unknown {
    return { ...makeReceipt(), ...overrides };
}

function catalogVariant(overrides: Record<string, unknown>): unknown {
    return { ...makeCatalog(), ...overrides };
}

function entryVariant(base: CatalogEntry, overrides: Record<string, unknown>): unknown {
    return { ...base, ...overrides };
}

function makeFullPack(): CapabilityPack {
    return {
        scope: makeScope(),
        contractVersion: PACK_VERSION,
        packId: 'flauz.pack.example',
        version: '1.2.3',
        nameDigest: digestOf('a'),
        descriptionDigest: digestOf('b'),
        artifacts: [
            { kind: 'cli', artifactDigest: digestOf('c'), byteSize: 256, entrypointRef: './bin/cli' },
            { kind: 'skill-instructions', artifactDigest: digestOf('d'), byteSize: 128, entrypointRef: './skills/main.md' }
        ],
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

function makeSubject(): CatalogSubjectIdentity {
    return {
        scope: makeScope(),
        contractVersion: CAPABILITY_PACKS_CONTRACTS_VERSION,
        packId: 'flauz.pack.example',
        version: '1.2.3'
    };
}

function subjectWith(overrides: Partial<CatalogSubjectIdentity>): CatalogSubjectIdentity {
    return { ...makeSubject(), ...overrides };
}

interface DerivationRow {
    name: string;
    subject: unknown;
    receipt: unknown;
}

function derivationBattery(): DerivationRow[] {
    return [
        { name: 'all checks pass, claim verified', subject: makeSubject(), receipt: receiptWith({ checks: [check('integrity', true), check('permissions', true)] }) },
        { name: 'one check failed, claim verified-partial', subject: makeSubject(), receipt: receiptWith({ status: 'verified-partial', checks: [check('integrity', true), check('permissions', false)] }) },
        { name: 'scope mismatch, claim verification-failed', subject: makeSubject(), receipt: receiptWith({ scope: { workspaceId: 'ws-beta', tenantId: 'tenant-beta' }, status: 'verification-failed' }) },
        { name: 'contract version mismatch, claim verification-failed', subject: subjectWith({ contractVersion: '2.0.0' }), receipt: receiptWith({ status: 'verification-failed' }) },
        { name: 'packId mismatch, claim verification-failed', subject: makeSubject(), receipt: receiptWith({ packId: 'flauz.pack.other', status: 'verification-failed' }) },
        { name: 'version mismatch, claim verification-failed', subject: makeSubject(), receipt: receiptWith({ version: '2.0.0', status: 'verification-failed' }) },
        { name: 'no checks, claim verification-failed', subject: makeSubject(), receipt: receiptWith({ status: 'verification-failed', checks: [] }) },
        { name: 'no checks, claim verified', subject: makeSubject(), receipt: receiptWith({ checks: [] }) },
        { name: 'all checks pass, claim verified-partial', subject: makeSubject(), receipt: receiptWith({ status: 'verified-partial' }) },
        { name: 'one check failed, claim verified', subject: makeSubject(), receipt: receiptWith({ checks: [check('integrity', true), check('permissions', false)] }) },
        { name: 'scope and packId mismatch, claim verification-failed', subject: makeSubject(), receipt: receiptWith({ scope: { workspaceId: 'ws-beta', tenantId: 'tenant-beta' }, packId: 'flauz.pack.other', status: 'verification-failed' }) },
        { name: 'malformed subject', subject: { packId: 'x' }, receipt: makeReceipt() },
        { name: 'malformed receipt', subject: makeSubject(), receipt: { status: 'verified' } }
    ];
}

interface AdmissionRow {
    name: string;
    pack: unknown;
    receipt: unknown;
}

function admissionRows(): AdmissionRow[] {
    return [
        { name: 'no receipt', pack: makePack(), receipt: null },
        { name: 'matching verified receipt', pack: makePack(), receipt: makeReceipt() },
        { name: 'matching partial receipt', pack: makePack(), receipt: receiptWith({ status: 'verified-partial', checks: [check('integrity', true), check('permissions', false)] }) },
        { name: 'receipt for another pack', pack: makePack(), receipt: receiptWith({ packId: 'flauz.pack.other', status: 'verification-failed' }) },
        { name: 'receipt with no checks', pack: makePack(), receipt: receiptWith({ status: 'verification-failed', checks: [] }) },
        { name: 'claim above the evidence', pack: makePack(), receipt: receiptWith({ checks: [check('integrity', false)] }) },
        { name: 'malformed pack', pack: { packId: 'x' }, receipt: null },
        { name: 'pack from another contract version', pack: { ...makePack(), contractVersion: '2.0.0' }, receipt: null },
        { name: 'malformed receipt', pack: makePack(), receipt: { status: 'verified' } }
    ];
}

function expectOk(result: CatalogTransitionResult): { catalog: CatalogRecord; entry: CatalogEntry } {
    assert.strictEqual(result.ok, true, result.ok ? undefined : `${result.code}: ${result.message}`);
    if (result.ok) {
        return result;
    }
    throw new Error('unreachable: the transition was expected to succeed');
}

function expectRejection(result: CatalogTransitionResult): CatalogRejection {
    assert.strictEqual(result.ok, false, 'the transition was expected to be rejected');
    if (!result.ok) {
        return result;
    }
    throw new Error('unreachable: the transition was expected to be rejected');
}

function expectEntries(result: CatalogQueryResult): readonly CatalogEntry[] {
    assert.strictEqual(result.ok, true, result.ok ? undefined : `${result.code}: ${result.message}`);
    if (result.ok) {
        return result.entries;
    }
    throw new Error('unreachable: the query was expected to succeed');
}

function rejectionCode(result: CatalogTransitionResult | CatalogQueryResult): string | null {
    if (result.ok) {
        return null;
    }
    return result.code;
}

function projectionCode(value: unknown): string | null {
    const result = validateCatalogPackProjection(value);
    return result.ok ? null : result.code;
}

function packIdsOf(entries: readonly CatalogEntry[]): string[] {
    return entries.map((entry) => entry.packId);
}

function buildQueryCatalog(): CatalogRecord {
    let catalog = emptyCatalog(makeScope(), 'catalog-queries');
    const low = expectOk(registerPack(catalog, packWith({
        packId: 'flauz.pack.low',
        version: '1.0.0',
        artifacts: [{ kind: 'cli' }],
        platformCompatibility: ['darwin-arm64'],
        declaredPermissions: ['read-files']
    }), null, ISO_A)).catalog;
    const high = expectOk(registerPack(low, packWith({
        packId: 'flauz.pack.high',
        version: '2.0.0',
        artifacts: [{ kind: 'mcp-server' }],
        platformCompatibility: ['linux-x64'],
        declaredPermissions: ['execute-command']
    }), receiptFor('flauz.pack.high', '2.0.0', 'verified', [check('integrity', true)]), ISO_A)).catalog;
    return expectOk(registerPack(high, packWith({
        packId: 'flauz.pack.none',
        version: '3.0.0',
        artifacts: [{ kind: 'commands' }],
        platformCompatibility: ['windows-x64'],
        declaredPermissions: []
    }), receiptFor('flauz.pack.none', '3.0.0', 'verified-partial', [check('integrity', true), check('permissions', false)]), ISO_A)).catalog;
}

suite('capability pack catalog contracts (zc006)', () => {

    suite('catalog record guards', () => {
        test('emptyCatalog builds a valid empty catalog with the pinned contract version', () => {
            const catalog = emptyCatalog(makeScope(), 'catalog-1');
            assert.strictEqual(isCatalogRecord(catalog), true);
            assert.strictEqual(catalog.contractVersion, CAPABILITY_PACKS_CONTRACTS_VERSION);
            assert.deepStrictEqual([...catalog.entries], []);
        });
        test('isCatalogRecord rejects a malformed catalog', () => {
            assert.strictEqual(isCatalogRecord(null), false);
            assert.strictEqual(isCatalogRecord('catalog'), false);
            assert.strictEqual(isCatalogRecord(catalogVariant({ scope: { workspaceId: '', tenantId: 't' } })), false);
            assert.strictEqual(isCatalogRecord(catalogVariant({ contractVersion: '0.9.0' })), false);
            assert.strictEqual(isCatalogRecord(catalogVariant({ catalogId: '' })), false);
            assert.strictEqual(isCatalogRecord(catalogVariant({ entries: 'nope' })), false);
            assert.strictEqual(isCatalogRecord(catalogVariant({ entries: [{}] })), false);
        });
        test('isCatalogRecord rejects duplicate active packId+version entries', () => {
            const entry = expectOk(registerPack(makeCatalog(), makePack(), null, ISO_A)).entry;
            assert.strictEqual(isCatalogRecord(catalogVariant({ entries: [entry, entry] })), false);
        });
        test('isCatalogRecord allows repeated deprecated revisions of the same packId+version', () => {
            let catalog = makeCatalog();
            catalog = expectOk(registerPack(catalog, makePack(), null, ISO_A)).catalog;
            catalog = expectOk(deprecatePack(catalog, 'flauz.pack.example', '1.2.3', DEPRECATION)).catalog;
            catalog = expectOk(registerPack(catalog, makePack(), null, ISO_A)).catalog;
            catalog = expectOk(deprecatePack(catalog, 'flauz.pack.example', '1.2.3', DEPRECATION)).catalog;
            assert.strictEqual(catalog.entries.length, 2);
            assert.strictEqual(entryIsDeprecated(catalog.entries[0]), true);
            assert.strictEqual(entryIsDeprecated(catalog.entries[1]), true);
            assert.strictEqual(isCatalogRecord(catalog), true);
            const activeAgain = expectOk(registerPack(catalog, makePack(), null, ISO_A)).catalog;
            assert.strictEqual(isCatalogRecord(activeAgain), true);
        });
        test('isCatalogEntry enforces the deprecation all-or-nothing invariant', () => {
            const base = expectOk(registerPack(makeCatalog(), makePack(), null, ISO_A)).entry;
            assert.strictEqual(isCatalogEntry(base), true);
            assert.strictEqual(isCatalogEntry(entryVariant(base, { deprecatedAtIso: ISO_B })), false);
            assert.strictEqual(isCatalogEntry(entryVariant(base, { deprecationReason: 'deprecated-broken' })), false);
            assert.strictEqual(isCatalogEntry(entryVariant(base, { deprecationNote: 'note' })), false);
            assert.strictEqual(isCatalogEntry(entryVariant(base, { deprecatedAtIso: ISO_B, deprecationReason: 'deprecated-broken', deprecationNote: 'note' })), true);
        });
        test('isCatalogEntry rejects a malformed entry', () => {
            const base = expectOk(registerPack(makeCatalog(), makePack(), null, ISO_A)).entry;
            assert.strictEqual(isCatalogEntry(entryVariant(base, { packId: '.bad' })), false);
            assert.strictEqual(isCatalogEntry(entryVariant(base, { version: 'v1' })), false);
            assert.strictEqual(isCatalogEntry(entryVariant(base, { verificationStatus: 'unknown' })), false);
            assert.strictEqual(isCatalogEntry(entryVariant(base, { registeredAtIso: '2026-03-01' })), false);
            assert.strictEqual(isCatalogEntry(entryVariant(base, { packFacts: { ...base.packFacts, permissionRiskTier: 'high' } })), false);
        });
    });

    suite('frozen vocabularies', () => {
        test('pins the deprecation reasons', () => {
            assert.deepStrictEqual([...CATALOG_DEPRECATION_REASONS], ['deprecated-superseded', 'deprecated-security', 'deprecated-license', 'deprecated-broken', 'deprecated-unmaintained']);
            for (const reason of CATALOG_DEPRECATION_REASONS) {
                assert.strictEqual(isCatalogDeprecationReason(reason), true, reason);
            }
            assert.strictEqual(isCatalogDeprecationReason('because'), false);
        });
        test('pins the rejection codes', () => {
            assert.deepStrictEqual([...CATALOG_REJECTION_CODES], [
                'catalog-rejected-catalog-invalid',
                'catalog-rejected-pack-invalid',
                'catalog-rejected-receipt-invalid',
                'catalog-rejected-scope-mismatch',
                'catalog-rejected-timestamp-invalid',
                'catalog-rejected-duplicate-pack',
                'catalog-rejected-entry-not-found',
                'catalog-rejected-entry-already-deprecated',
                'catalog-rejected-entry-deprecated',
                'catalog-rejected-deprecation-invalid',
                'catalog-rejected-receipt-mismatch',
                'catalog-rejected-predicate-invalid'
            ]);
            for (const code of CATALOG_REJECTION_CODES) {
                assert.strictEqual(isCatalogRejectionCode(code), true, code);
            }
            assert.strictEqual(isCatalogRejectionCode('nope'), false);
        });
        test('pins the permission fact tiers', () => {
            assert.deepStrictEqual([...CATALOG_PERMISSION_FACT_TIERS], ['none', 'low', 'moderate', 'high']);
            for (const tier of CATALOG_PERMISSION_FACT_TIERS) {
                assert.strictEqual(isCatalogPermissionFactTier(tier), true, tier);
            }
            assert.strictEqual(isCatalogPermissionFactTier('extreme'), false);
            assert.strictEqual(highestCatalogPermissionFactTier([]), 'none');
            assert.strictEqual(highestCatalogPermissionFactTier(['read-files', 'write-workspace']), 'moderate');
            assert.strictEqual(highestCatalogPermissionFactTier(['execute-command']), 'high');
        });
    });

    suite('pack projection', () => {
        test('accepts the projection fixture', () => {
            const result = validateCatalogPackProjection(makePack());
            assert.strictEqual(result.ok, true);
            if (result.ok) {
                assert.strictEqual(result.pack.packId, 'flauz.pack.example');
            }
        });
        test('a full pack.ts record passes the projection validation (structural pin)', () => {
            const fullPack = makeFullPack();
            assert.strictEqual(isCapabilityPack(fullPack), true);
            assert.strictEqual(validateCatalogPackProjection(fullPack).ok, true);
        });
        test('rejects a malformed pack', () => {
            assert.strictEqual(projectionCode(null), 'catalog-rejected-pack-invalid');
            assert.strictEqual(projectionCode('pack'), 'catalog-rejected-pack-invalid');
            assert.strictEqual(projectionCode({}), 'catalog-rejected-pack-invalid');
            assert.strictEqual(projectionCode(packWith({ scope: { workspaceId: '', tenantId: 't' } })), 'catalog-rejected-pack-invalid');
        });
        test('rejects a contract version mismatch', () => {
            assert.strictEqual(projectionCode(packWith({ contractVersion: '0.9.0' })), 'catalog-rejected-pack-invalid');
        });
        test('rejects unknown and duplicated permissions', () => {
            assert.strictEqual(validateCatalogPackProjection(packVariant({ declaredPermissions: ['root-access'] })).ok, false);
            assert.strictEqual(projectionCode(packWith({ declaredPermissions: ['read-files', 'read-files'] })), 'catalog-rejected-pack-invalid');
            assert.strictEqual(validateCatalogPackProjection(packVariant({ declaredPermissions: 'read-files' })).ok, false);
        });
        test('rejects unknown, duplicated and empty platforms', () => {
            assert.strictEqual(validateCatalogPackProjection(packVariant({ platformCompatibility: ['plan9'] })).ok, false);
            assert.strictEqual(projectionCode(packWith({ platformCompatibility: ['linux-x64', 'linux-x64'] })), 'catalog-rejected-pack-invalid');
            assert.strictEqual(projectionCode(packWith({ platformCompatibility: [] })), 'catalog-rejected-pack-invalid');
        });
        test('rejects an empty artifact list and unknown artifact kinds', () => {
            assert.strictEqual(projectionCode(packWith({ artifacts: [] })), 'catalog-rejected-pack-invalid');
            assert.strictEqual(validateCatalogPackProjection(packVariant({ artifacts: [{ kind: 'plugin' }] })).ok, false);
        });
    });

    suite('pack facts', () => {
        test('freezes the query projection at registration shape', () => {
            const pack = makePack();
            const facts = packFactsFromProjection(pack);
            assert.strictEqual(facts.nameDigest, pack.nameDigest);
            assert.deepStrictEqual([...facts.artifactKinds], ['cli', 'skill-instructions']);
            assert.deepStrictEqual([...facts.platforms], ['darwin-arm64', 'linux-x64']);
            assert.deepStrictEqual([...facts.declaredPermissions], ['read-files', 'write-workspace']);
            assert.strictEqual(facts.permissionRiskTier, 'moderate');
            assert.strictEqual(isCatalogPackFacts(facts), true);
        });
        test('dedupes artifact kinds preserving first appearance', () => {
            const pack = packWith({ artifacts: [{ kind: 'commands' }, { kind: 'cli' }, { kind: 'commands' }] });
            const facts = packFactsFromProjection(pack);
            assert.deepStrictEqual([...facts.artifactKinds], ['commands', 'cli']);
        });
        test('ranks an empty permission declaration as none', () => {
            const facts = packFactsFromProjection(packWith({ declaredPermissions: [] }));
            assert.strictEqual(facts.permissionRiskTier, 'none');
        });
        test('isCatalogPackFacts rejects a tier that disagrees with the permissions', () => {
            const facts = packFactsFromProjection(packWith({ declaredPermissions: ['read-files'] }));
            assert.strictEqual(facts.permissionRiskTier, 'low');
            assert.strictEqual(isCatalogPackFacts(facts), true);
            assert.strictEqual(isCatalogPackFacts({ ...facts, permissionRiskTier: 'high' }), false);
        });
    });

    suite('registerPack', () => {
        test('registers a pack unverified when no receipt is present', () => {
            const result = expectOk(registerPack(makeCatalog(), makePack(), null, ISO_A));
            assert.strictEqual(result.entry.packId, 'flauz.pack.example');
            assert.strictEqual(result.entry.version, '1.2.3');
            assert.strictEqual(result.entry.verificationStatus, 'unverified');
            assert.strictEqual(result.entry.deprecatedAtIso, null);
            assert.strictEqual(result.entry.deprecationReason, null);
            assert.strictEqual(result.entry.deprecationNote, null);
            assert.deepStrictEqual([...result.entry.packFacts.artifactKinds], ['cli', 'skill-instructions']);
            assert.strictEqual(isCatalogRecord(result.catalog), true);
        });
        test('registers a pack with the status its matching receipt derives', () => {
            const verified = expectOk(registerPack(makeCatalog(), makePack(), makeReceipt(), ISO_A));
            assert.strictEqual(verified.entry.verificationStatus, 'verified');
            const partialReceipt = receiptWith({ status: 'verified-partial', checks: [check('integrity', true), check('permissions', false)] });
            const partial = expectOk(registerPack(makeCatalog(), makePack(), partialReceipt, ISO_A));
            assert.strictEqual(partial.entry.verificationStatus, 'verified-partial');
        });
        test('registers a pack as verification-failed when the receipt does not match it', () => {
            const mismatched = receiptWith({ packId: 'flauz.pack.other', status: 'verification-failed' });
            const result = expectOk(registerPack(makeCatalog(), makePack(), mismatched, ISO_A));
            assert.strictEqual(result.entry.verificationStatus, 'verification-failed');
            const derivation = deriveCatalogEntryStatus(makePack(), mismatched);
            assert.deepStrictEqual(derivation.mismatches.map((mismatch) => mismatch.kind), ['receipt-pack-id-mismatch']);
        });
        test('registers a receipt with no checks as verification-failed', () => {
            const emptyChecks = receiptWith({ status: 'verification-failed', checks: [] });
            const result = expectOk(registerPack(makeCatalog(), makePack(), emptyChecks, ISO_A));
            assert.strictEqual(result.entry.verificationStatus, 'verification-failed');
        });
        test('lands registeredAtIso verbatim', () => {
            const result = expectOk(registerPack(makeCatalog(), makePack(), null, '2026-04-01T12:34:56Z'));
            assert.strictEqual(result.entry.registeredAtIso, '2026-04-01T12:34:56Z');
        });
        test('never mutates the input catalog', () => {
            const catalog = makeCatalog();
            const first = expectOk(registerPack(catalog, makePack(), null, ISO_A));
            assert.strictEqual(catalog.entries.length, 0);
            assert.strictEqual(first.catalog.entries.length, 1);
            const second = expectOk(registerPack(catalog, packWith({ packId: 'flauz.pack.other' }), null, ISO_A));
            assert.strictEqual(catalog.entries.length, 0);
            assert.strictEqual(second.catalog.entries.length, 1);
        });
        test('rejects a duplicate active packId+version', () => {
            const first = expectOk(registerPack(makeCatalog(), makePack(), null, ISO_A)).catalog;
            const second = registerPack(first, makePack(), null, ISO_A);
            assert.strictEqual(rejectionCode(second), 'catalog-rejected-duplicate-pack');
            const otherVersion = expectOk(registerPack(first, packWith({ version: '1.3.0' }), null, ISO_A));
            assert.strictEqual(otherVersion.catalog.entries.length, 2);
        });
        test('appends a new revision after deprecation instead of mutating history', () => {
            let catalog = makeCatalog();
            catalog = expectOk(registerPack(catalog, makePack(), null, ISO_A)).catalog;
            catalog = expectOk(deprecatePack(catalog, 'flauz.pack.example', '1.2.3', DEPRECATION)).catalog;
            const revision = expectOk(registerPack(catalog, makePack(), null, ISO_A));
            assert.strictEqual(revision.catalog.entries.length, 2);
            assert.strictEqual(entryIsDeprecated(revision.catalog.entries[0]), true);
            assert.strictEqual(entryIsDeprecated(revision.catalog.entries[1]), false);
            assert.strictEqual(latestEntryFor(revision.catalog, 'flauz.pack.example', '1.2.3'), revision.catalog.entries[1]);
        });
        test('rejects an invalid catalog', () => {
            const broken = catalogVariant({ contractVersion: '0.9.0' }) as unknown as CatalogRecord;
            assert.strictEqual(rejectionCode(registerPack(broken, makePack(), null, ISO_A)), 'catalog-rejected-catalog-invalid');
        });
        test('rejects an invalid pack', () => {
            assert.strictEqual(rejectionCode(registerPack(makeCatalog(), null as unknown as CatalogPackProjection, null, ISO_A)), 'catalog-rejected-pack-invalid');
            assert.strictEqual(rejectionCode(registerPack(makeCatalog(), packVariant({ declaredPermissions: ['root-access'] }) as unknown as CatalogPackProjection, null, ISO_A)), 'catalog-rejected-pack-invalid');
        });
        test('rejects a pack from another scope', () => {
            const foreign = packWith({ scope: { workspaceId: 'ws-beta', tenantId: 'tenant-beta' } });
            assert.strictEqual(rejectionCode(registerPack(makeCatalog(), foreign, null, ISO_A)), 'catalog-rejected-scope-mismatch');
        });
        test('rejects an invalid receipt', () => {
            const broken = receiptVariant({ checks: 'nope' }) as unknown as CatalogVerificationReceipt;
            assert.strictEqual(rejectionCode(registerPack(makeCatalog(), makePack(), broken, ISO_A)), 'catalog-rejected-receipt-invalid');
        });
        test('rejects a receipt from another scope', () => {
            const foreign = receiptWith({ scope: { workspaceId: 'ws-beta', tenantId: 'tenant-beta' } });
            assert.strictEqual(rejectionCode(registerPack(makeCatalog(), makePack(), foreign, ISO_A)), 'catalog-rejected-scope-mismatch');
        });
        test('rejects a malformed registeredAtIso', () => {
            assert.strictEqual(rejectionCode(registerPack(makeCatalog(), makePack(), null, '2026-03-01')), 'catalog-rejected-timestamp-invalid');
        });
    });

    suite('deprecatePack', () => {
        test('marks the latest entry deprecated with the typed reason and note', () => {
            const registered = expectOk(registerPack(makeCatalog(), makePack(), null, ISO_A)).catalog;
            const result = expectOk(deprecatePack(registered, 'flauz.pack.example', '1.2.3', DEPRECATION));
            assert.strictEqual(result.entry.deprecatedAtIso, ISO_B);
            assert.strictEqual(result.entry.deprecationReason, 'deprecated-superseded');
            assert.strictEqual(result.entry.deprecationNote, 'replaced by 2.0.0');
            assert.strictEqual(isCatalogEntry(result.entry), true);
            assert.strictEqual(isCatalogRecord(result.catalog), true);
        });
        test('never mutates the input catalog', () => {
            const registered = expectOk(registerPack(makeCatalog(), makePack(), null, ISO_A)).catalog;
            const originalEntry = registered.entries[0];
            const result = expectOk(deprecatePack(registered, 'flauz.pack.example', '1.2.3', DEPRECATION));
            assert.strictEqual(originalEntry.deprecatedAtIso, null);
            assert.strictEqual(result.entry.deprecatedAtIso, ISO_B);
            assert.notStrictEqual(result.catalog.entries[0], originalEntry);
            assert.strictEqual(entryIsDeprecated(registered.entries[0]), false);
        });
        test('rejects an unknown packId+version', () => {
            const registered = expectOk(registerPack(makeCatalog(), makePack(), null, ISO_A)).catalog;
            assert.strictEqual(rejectionCode(deprecatePack(registered, 'flauz.pack.other', '1.2.3', DEPRECATION)), 'catalog-rejected-entry-not-found');
        });
        test('rejects a second deprecation of the same entry', () => {
            const once = expectOk(deprecatePack(expectOk(registerPack(makeCatalog(), makePack(), null, ISO_A)).catalog, 'flauz.pack.example', '1.2.3', DEPRECATION)).catalog;
            assert.strictEqual(rejectionCode(deprecatePack(once, 'flauz.pack.example', '1.2.3', DEPRECATION)), 'catalog-rejected-entry-already-deprecated');
        });
        test('rejects an invalid deprecation record', () => {
            const registered = expectOk(registerPack(makeCatalog(), makePack(), null, ISO_A)).catalog;
            const badReason = { reason: 'because', note: 'n', deprecatedAtIso: ISO_B } as unknown as CatalogDeprecation;
            assert.strictEqual(rejectionCode(deprecatePack(registered, 'flauz.pack.example', '1.2.3', badReason)), 'catalog-rejected-deprecation-invalid');
            const emptyNote = { reason: 'deprecated-superseded', note: '', deprecatedAtIso: ISO_B } as unknown as CatalogDeprecation;
            assert.strictEqual(rejectionCode(deprecatePack(registered, 'flauz.pack.example', '1.2.3', emptyNote)), 'catalog-rejected-deprecation-invalid');
        });
        test('rejects a malformed deprecatedAtIso', () => {
            const registered = expectOk(registerPack(makeCatalog(), makePack(), null, ISO_A)).catalog;
            const badTimestamp = { reason: 'deprecated-superseded', note: 'n', deprecatedAtIso: '2026-03-02' } as unknown as CatalogDeprecation;
            assert.strictEqual(rejectionCode(deprecatePack(registered, 'flauz.pack.example', '1.2.3', badTimestamp)), 'catalog-rejected-timestamp-invalid');
        });
        test('rejects an invalid catalog', () => {
            const broken = catalogVariant({ catalogId: '' }) as unknown as CatalogRecord;
            assert.strictEqual(rejectionCode(deprecatePack(broken, 'flauz.pack.example', '1.2.3', DEPRECATION)), 'catalog-rejected-catalog-invalid');
        });
        test('entryIsDeprecated flips on the new entry only', () => {
            let catalog = expectOk(registerPack(makeCatalog(), makePack(), null, ISO_A)).catalog;
            catalog = expectOk(registerPack(catalog, packWith({ packId: 'flauz.pack.other' }), null, ISO_A)).catalog;
            const result = expectOk(deprecatePack(catalog, 'flauz.pack.example', '1.2.3', DEPRECATION));
            assert.strictEqual(entryIsDeprecated(result.catalog.entries[0]), true);
            assert.strictEqual(entryIsDeprecated(result.catalog.entries[1]), false);
        });
    });

    suite('verifyPack: the authority gate', () => {
        test('upgrades an unverified entry to verified on a matching receipt', () => {
            const registered = expectOk(registerPack(makeCatalog(), makePack(), null, ISO_A)).catalog;
            const before = latestEntryFor(registered, 'flauz.pack.example', '1.2.3');
            assert.notStrictEqual(before, null);
            assert.strictEqual(before?.verificationStatus, 'unverified');
            const result = expectOk(verifyPack(registered, 'flauz.pack.example', '1.2.3', makeReceipt()));
            assert.strictEqual(result.entry.verificationStatus, 'verified');
            assert.strictEqual(result.catalog.entries.length, 1);
            assert.strictEqual(isCatalogRecord(result.catalog), true);
        });
        test('follows the receipt evidence even when it downgrades', () => {
            const registered = expectOk(registerPack(makeCatalog(), makePack(), makeReceipt(), ISO_A)).catalog;
            assert.strictEqual(latestEntryFor(registered, 'flauz.pack.example', '1.2.3')?.verificationStatus, 'verified');
            const partial = receiptWith({ status: 'verified-partial', checks: [check('integrity', true), check('permissions', false)] });
            const result = expectOk(verifyPack(registered, 'flauz.pack.example', '1.2.3', partial));
            assert.strictEqual(result.entry.verificationStatus, 'verified-partial');
        });
        test('rejects a receipt for another pack (named mismatch)', () => {
            const registered = expectOk(registerPack(makeCatalog(), makePack(), null, ISO_A)).catalog;
            const foreign = receiptWith({ packId: 'flauz.pack.other' });
            const rejection = expectRejection(verifyPack(registered, 'flauz.pack.example', '1.2.3', foreign));
            assert.strictEqual(rejection.code, 'catalog-rejected-receipt-mismatch');
            assert.strictEqual(rejection.message.includes('packId'), true);
        });
        test('rejects a receipt for another version (named mismatch)', () => {
            const registered = expectOk(registerPack(makeCatalog(), makePack(), null, ISO_A)).catalog;
            const foreign = receiptWith({ version: '2.0.0' });
            const rejection = expectRejection(verifyPack(registered, 'flauz.pack.example', '1.2.3', foreign));
            assert.strictEqual(rejection.code, 'catalog-rejected-receipt-mismatch');
            assert.strictEqual(rejection.message.includes('version'), true);
        });
        test('rejects a receipt from another scope', () => {
            const registered = expectOk(registerPack(makeCatalog(), makePack(), null, ISO_A)).catalog;
            const foreign = receiptWith({ scope: { workspaceId: 'ws-beta', tenantId: 'tenant-beta' } });
            assert.strictEqual(rejectionCode(verifyPack(registered, 'flauz.pack.example', '1.2.3', foreign)), 'catalog-rejected-scope-mismatch');
        });
        test('rejects verification of a deprecated entry', () => {
            const deprecated = expectOk(deprecatePack(expectOk(registerPack(makeCatalog(), makePack(), null, ISO_A)).catalog, 'flauz.pack.example', '1.2.3', DEPRECATION)).catalog;
            assert.strictEqual(rejectionCode(verifyPack(deprecated, 'flauz.pack.example', '1.2.3', makeReceipt())), 'catalog-rejected-entry-deprecated');
        });
        test('rejects an unknown packId+version', () => {
            const registered = expectOk(registerPack(makeCatalog(), makePack(), null, ISO_A)).catalog;
            assert.strictEqual(rejectionCode(verifyPack(registered, 'flauz.pack.missing', '1.2.3', makeReceipt())), 'catalog-rejected-entry-not-found');
        });
        test('rejects an invalid receipt', () => {
            const registered = expectOk(registerPack(makeCatalog(), makePack(), null, ISO_A)).catalog;
            const broken = receiptVariant({ status: 'unknown' }) as unknown as CatalogVerificationReceipt;
            assert.strictEqual(rejectionCode(verifyPack(registered, 'flauz.pack.example', '1.2.3', broken)), 'catalog-rejected-receipt-invalid');
        });
        test('rejects an invalid catalog', () => {
            const broken = catalogVariant({ entries: 'nope' }) as unknown as CatalogRecord;
            assert.strictEqual(rejectionCode(verifyPack(broken, 'flauz.pack.example', '1.2.3', makeReceipt())), 'catalog-rejected-catalog-invalid');
        });
        test('never mutates the input catalog', () => {
            const registered = expectOk(registerPack(makeCatalog(), makePack(), null, ISO_A)).catalog;
            const originalEntry = registered.entries[0];
            const result = expectOk(verifyPack(registered, 'flauz.pack.example', '1.2.3', makeReceipt()));
            assert.strictEqual(originalEntry.verificationStatus, 'unverified');
            assert.strictEqual(result.entry.verificationStatus, 'verified');
            assert.notStrictEqual(result.catalog.entries[0], originalEntry);
        });
        test('a rejected verification leaves the entry untouched', () => {
            const registered = expectOk(registerPack(makeCatalog(), makePack(), null, ISO_A)).catalog;
            const foreign = receiptWith({ packId: 'flauz.pack.other' });
            expectRejection(verifyPack(registered, 'flauz.pack.example', '1.2.3', foreign));
            const entry = latestEntryFor(registered, 'flauz.pack.example', '1.2.3');
            assert.notStrictEqual(entry, null);
            assert.strictEqual(entry?.verificationStatus, 'unverified');
            const verified = expectOk(verifyPack(registered, 'flauz.pack.example', '1.2.3', makeReceipt()));
            assert.strictEqual(verified.entry.verificationStatus, 'verified');
        });
    });

    suite('queryCatalog and predicates', () => {
        test('filters entries with a predicate', () => {
            const catalog = buildQueryCatalog();
            const all = expectEntries(queryCatalog(catalog, (entry) => entry.registeredAtIso === ISO_A));
            assert.deepStrictEqual(packIdsOf(all), ['flauz.pack.low', 'flauz.pack.high', 'flauz.pack.none']);
            const none = expectEntries(queryCatalog(catalog, (entry) => entry.packFacts.declaredPermissions.length === 0));
            assert.deepStrictEqual(packIdsOf(none), ['flauz.pack.none']);
        });
        test('rejects a non-function predicate', () => {
            const result = queryCatalog(makeCatalog(), undefined as unknown as CatalogEntryPredicate);
            assert.strictEqual(rejectionCode(result), 'catalog-rejected-predicate-invalid');
        });
        test('rejects an invalid catalog', () => {
            const broken = catalogVariant({ scope: { workspaceId: '', tenantId: 't' } }) as unknown as CatalogRecord;
            assert.strictEqual(rejectionCode(queryCatalog(broken, (entry) => true)), 'catalog-rejected-catalog-invalid');
        });
        test('entryMatchesVerificationStatus selects by status', () => {
            const catalog = buildQueryCatalog();
            assert.deepStrictEqual(packIdsOf(expectEntries(queryCatalog(catalog, entryMatchesVerificationStatus('verified')))), ['flauz.pack.high']);
            assert.deepStrictEqual(packIdsOf(expectEntries(queryCatalog(catalog, entryMatchesVerificationStatus('unverified')))), ['flauz.pack.low']);
            assert.deepStrictEqual(packIdsOf(expectEntries(queryCatalog(catalog, entryMatchesVerificationStatus('verified-partial')))), ['flauz.pack.none']);
        });
        test('entryHasArtifactKind selects by artifact kind', () => {
            const catalog = buildQueryCatalog();
            assert.deepStrictEqual(packIdsOf(expectEntries(queryCatalog(catalog, entryHasArtifactKind('mcp-server')))), ['flauz.pack.high']);
            assert.deepStrictEqual(packIdsOf(expectEntries(queryCatalog(catalog, entryHasArtifactKind('cli')))), ['flauz.pack.low']);
        });
        test('entrySupportsPlatform selects by platform', () => {
            const catalog = buildQueryCatalog();
            assert.deepStrictEqual(packIdsOf(expectEntries(queryCatalog(catalog, entrySupportsPlatform('windows-x64')))), ['flauz.pack.none']);
            assert.deepStrictEqual(packIdsOf(expectEntries(queryCatalog(catalog, entrySupportsPlatform('darwin-x64')))), []);
        });
        test('entryPermissionTierAtLeast selects by risk threshold', () => {
            const catalog = buildQueryCatalog();
            assert.deepStrictEqual(packIdsOf(expectEntries(queryCatalog(catalog, entryPermissionTierAtLeast('moderate')))), ['flauz.pack.high']);
            assert.deepStrictEqual(packIdsOf(expectEntries(queryCatalog(catalog, entryPermissionTierAtLeast('low')))), ['flauz.pack.low', 'flauz.pack.high']);
        });
        test('entryPermissionTier selects by exact tier', () => {
            const catalog = buildQueryCatalog();
            assert.deepStrictEqual(packIdsOf(expectEntries(queryCatalog(catalog, entryPermissionTier('high')))), ['flauz.pack.high']);
            assert.deepStrictEqual(packIdsOf(expectEntries(queryCatalog(catalog, entryPermissionTier('low')))), ['flauz.pack.low']);
            assert.deepStrictEqual(packIdsOf(expectEntries(queryCatalog(catalog, entryPermissionTier('moderate')))), []);
        });
        test('andEntryPredicates conjoins', () => {
            const catalog = buildQueryCatalog();
            const predicate = andEntryPredicates(entryHasArtifactKind('cli'), entryMatchesVerificationStatus('unverified'));
            assert.deepStrictEqual(packIdsOf(expectEntries(queryCatalog(catalog, predicate))), ['flauz.pack.low']);
        });
        test('orEntryPredicates disjoins', () => {
            const catalog = buildQueryCatalog();
            const predicate = orEntryPredicates(entryMatchesVerificationStatus('verified'), entryMatchesVerificationStatus('verified-partial'));
            assert.deepStrictEqual(packIdsOf(expectEntries(queryCatalog(catalog, predicate))), ['flauz.pack.high', 'flauz.pack.none']);
        });
    });

    suite('pinned mirrors of the sibling contract modules', () => {
        test('the version constant mirrors pack.ts and verification.ts', () => {
            assert.strictEqual(CAPABILITY_PACKS_CONTRACTS_VERSION, '1.0.0');
            assert.strictEqual(CAPABILITY_PACKS_CONTRACTS_VERSION, PACK_VERSION);
            assert.strictEqual(CAPABILITY_PACKS_CONTRACTS_VERSION, VERIFICATION_VERSION);
        });
        test('the artifact kinds mirror pack.ts', () => {
            assert.deepStrictEqual(sorted(CATALOG_ARTIFACT_KINDS), sorted(PACK_ARTIFACT_KINDS));
        });
        test('the platforms mirror pack.ts', () => {
            assert.deepStrictEqual(sorted(CATALOG_PLATFORMS), sorted(PACK_PLATFORMS));
        });
        test('the permission ids, tiers and table mirror pack.ts', () => {
            assert.deepStrictEqual(sorted(CATALOG_PERMISSION_IDS), sorted(PACK_PERMISSION_IDS));
            assert.deepStrictEqual(sorted(CATALOG_PERMISSION_RISK_TIERS), sorted(PERMISSION_RISK_TIERS));
            assert.deepStrictEqual(CATALOG_PERMISSION_TABLE, PACK_PERMISSION_TABLE);
        });
        test('the verification statuses mirror verification.ts', () => {
            assert.deepStrictEqual(sorted(CATALOG_VERIFICATION_STATUSES), sorted(VERIFICATION_STATUSES));
        });
        test('the mismatch kinds mirror verification.ts', () => {
            assert.deepStrictEqual(sorted(CATALOG_VERIFICATION_MISMATCH_KINDS), sorted(VERIFICATION_MISMATCH_KINDS));
        });
        test('isCatalogVerificationReceipt agrees with validateVerificationReceipt over the battery', () => {
            const receipts: unknown[] = [
                makeReceipt(),
                receiptWith({ status: 'verified-partial', checks: [check('integrity', false)] }),
                receiptWith({ checks: [] }),
                receiptVariant({ checks: 'nope' }),
                receiptVariant({ status: 'unknown' }),
                receiptVariant({ contractVersion: '0.9.0' }),
                receiptVariant({ packId: '.bad' }),
                receiptVariant({ version: 'v1' }),
                receiptVariant({ scope: { workspaceId: '', tenantId: 't' } }),
                receiptVariant({ checks: [check('a', true), check('a', false)] }),
                receiptVariant({ checks: [{ name: 'a', passed: true, evidenceDigest: 'short' }] }),
                null,
                'receipt'
            ];
            for (const receipt of receipts) {
                assert.strictEqual(isCatalogVerificationReceipt(receipt), validateVerificationReceipt(receipt).ok, 'the catalog mirror and the verification authority must agree');
            }
        });
        test('deriveCatalogEntryStatus agrees with verificationStatusFor for every non-null receipt', () => {
            for (const row of derivationBattery()) {
                const mirror = deriveCatalogEntryStatus(row.subject, row.receipt);
                const authority = verificationStatusFor(row.subject, row.receipt);
                assert.strictEqual(mirror.status, authority.status, row.name);
                assert.strictEqual(mirror.claimedStatus, authority.claimedStatus, row.name);
                assert.deepStrictEqual([...mirror.passedCheckNames], [...authority.passedCheckNames], row.name);
                assert.deepStrictEqual([...mirror.failedCheckNames], [...authority.failedCheckNames], row.name);
                assert.deepStrictEqual(mirror.mismatches.map((mismatch) => mismatch.kind), authority.mismatches.map((mismatch) => mismatch.kind), row.name);
            }
        });
        test('the null-receipt path derives unverified in the catalog only (pinned difference)', () => {
            const mirror = deriveCatalogEntryStatus(makeSubject(), null);
            assert.strictEqual(mirror.status, 'unverified');
            const authority = verificationStatusFor(makeSubject(), null);
            assert.strictEqual(authority.status, 'verification-failed');
            assert.deepStrictEqual(authority.mismatches.map((mismatch) => mismatch.kind), ['verification-receipt-malformed']);
        });
        test('the projection and the pack authority agree on the closed permission law', () => {
            const invented: unknown = { ...makeFullPack(), declaredPermissions: ['read-files', 'root-access'] };
            assert.strictEqual(validateCatalogPackProjection(invented).ok, false);
            assert.strictEqual(isCapabilityPack(invented), false);
            const valid = makeFullPack();
            assert.strictEqual(validateCatalogPackProjection(valid).ok, true);
            assert.strictEqual(isCapabilityPack(valid), true);
        });
        test('registerPack entries carry the status canAdmitToCatalog derives (agreement over the battery)', () => {
            for (const row of admissionRows()) {
                const registration = registerPack(makeCatalog(), row.pack as CatalogPackProjection, row.receipt as CatalogVerificationReceipt | null, ISO_A);
                const admission = canAdmitToCatalog(row.pack, row.receipt);
                if (registration.ok) {
                    assert.strictEqual(registration.entry.verificationStatus, admission.status, row.name);
                } else {
                    assert.strictEqual(admission.admitted, false, row.name);
                }
            }
        });
        test('registerPack is stricter than the admission guard on receipt scope (pinned difference)', () => {
            const foreign = receiptWith({ scope: { workspaceId: 'ws-beta', tenantId: 'tenant-beta' }, status: 'verification-failed' });
            assert.strictEqual(rejectionCode(registerPack(makeCatalog(), makePack(), foreign, ISO_A)), 'catalog-rejected-scope-mismatch');
            const admission = canAdmitToCatalog(makePack(), foreign);
            assert.strictEqual(admission.admitted, true);
            assert.strictEqual(admission.quarantined, true);
            assert.strictEqual(admission.status, 'verification-failed');
        });
    });
});
