/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

// ZC-006 -- the capability pack catalog contract (Phase C, TL-B partition B2).
//
// The catalog is an append-only record of pack entries with pure record ->
// record transitions: registerPack, deprecatePack, verifyPack, plus the pure
// query surface (queryCatalog and the predicate builders). It is a DESCRIPTION
// surface: no loader, no installer, no executor, no downloader, no
// hash-verifier runtime.
//
// Zero-dependency law (labContracts discipline): this module declares no module
// dependencies of any kind. Everything it consumes from its sibling contract
// modules is restated here as a PINNED MIRROR (a projection, never a second
// authority):
//   - PackScope, the digest/semver/iso/packId shapes, the artifact kinds, the
//     platforms, the permission table and its risk tiers mirror pack.ts;
//   - the verification statuses, the receipt shape, the mismatch kinds and the
//     derived-status law mirror verification.ts (deriveCatalogEntryStatus is
//     the mirror of verificationStatusFor, plus the catalog-only null-receipt
//     'unverified' path).
// The cross-module suites pin every mirror set-equal and behaviorally equal to
// its authority module.
//
// Pinned semantics, each traceable to the work order:
//   - registerPack takes registeredAtIso and deprecatePack takes the whole
//     deprecation record (reason, note, deprecatedAtIso) as explicit
//     caller-supplied arguments: the determinism law forbids a clock inside
//     common/.
//   - The typed deprecation reason and its note land on the entry
//     (deprecationReason, deprecationNote) because deprecation is never silent;
//     the three deprecation fields are all-or-nothing.
//   - Each entry carries packFacts, the frozen query projection of its pack at
//     registration time, because queryCatalog filters by artifact kind,
//     platform, permission tier and verification status.
//   - A duplicate ACTIVE packId+version registration is the typed rejection
//     'catalog-rejected-duplicate-pack'. Re-registering a DEPRECATED
//     packId+version appends a NEW revision entry and never mutates history.
//   - A pack may register carrying a receipt that does not match it: the entry
//     then carries the derived 'verification-failed' status (the mismatch is
//     named by the derivation, which is exported for exactly that). The
//     catalog never upgrades a status without a matching receipt: verifyPack
//     rejects any receipt whose identity does not match the entry exactly.
//
// Determinism law: this module is pure and clock-free. It contains no
// Math.random, no Date.now and no new Date() invocation; the only occurrences
// of those tokens are inside this law comment. Every timestamp on every record
// is a plain ISO-8601 string supplied by the caller.
//
// Record law: every persisted record carries scope: PackScope and
// contractVersion: string.

export const CAPABILITY_PACKS_CONTRACTS_VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// Module-local shape helpers (pinned mirrors of pack.ts's shapes).
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

const SHA256_DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const SEMVER_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const ISO_8601_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const PACK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function isSha256Digest(value: unknown): value is string {
    return typeof value === 'string' && SHA256_DIGEST_PATTERN.test(value);
}

function isSemverString(value: unknown): value is string {
    return typeof value === 'string' && SEMVER_PATTERN.test(value);
}

function isIso8601String(value: unknown): value is string {
    return typeof value === 'string' && ISO_8601_PATTERN.test(value);
}

function isPackIdString(value: unknown): value is string {
    return typeof value === 'string' && PACK_ID_PATTERN.test(value);
}

function sameScope(left: PackScope, right: PackScope): boolean {
    return left.workspaceId === right.workspaceId && left.tenantId === right.tenantId;
}

// ---------------------------------------------------------------------------
// Scope: pinned mirror of pack.ts's PackScope.
// ---------------------------------------------------------------------------

export interface PackScope {
    workspaceId: string;
    tenantId: string;
}

export function isPackScope(value: unknown): value is PackScope {
    if (!isPlainObject(value)) {
        return false;
    }
    return isNonEmptyString(value.workspaceId) && isNonEmptyString(value.tenantId);
}

// ---------------------------------------------------------------------------
// Subject identity: the minimal structural projection a receipt must match.
// A CatalogPackProjection (below) is structurally assignable to it; the
// cross-module tests also pin verification.ts's VerificationSubject equivalent.
// ---------------------------------------------------------------------------

export interface CatalogSubjectIdentity {
    scope: PackScope;
    contractVersion: string;
    packId: string;
    version: string;
}

export function isCatalogSubjectIdentity(value: unknown): value is CatalogSubjectIdentity {
    if (!isPlainObject(value)) {
        return false;
    }
    return (
        isPackScope(value.scope) &&
        isNonEmptyString(value.contractVersion) &&
        isPackIdString(value.packId) &&
        isSemverString(value.version)
    );
}

// ---------------------------------------------------------------------------
// Artifact kinds: pinned mirror of pack.ts's PACK_ARTIFACT_KINDS.
// ---------------------------------------------------------------------------

export const CATALOG_ARTIFACT_KINDS = ['cli', 'skill-instructions', 'mcp-server', 'commands'] as const;
export type CatalogArtifactKind = (typeof CATALOG_ARTIFACT_KINDS)[number];

export function isCatalogArtifactKind(value: unknown): value is CatalogArtifactKind {
    return typeof value === 'string' && (CATALOG_ARTIFACT_KINDS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Platforms: pinned mirror of pack.ts's PACK_PLATFORMS.
// ---------------------------------------------------------------------------

export const CATALOG_PLATFORMS = ['darwin-x64', 'darwin-arm64', 'linux-x64', 'linux-arm64', 'windows-x64'] as const;
export type CatalogPlatform = (typeof CATALOG_PLATFORMS)[number];

export function isCatalogPlatform(value: unknown): value is CatalogPlatform {
    return typeof value === 'string' && (CATALOG_PLATFORMS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Permissions: pinned mirror of pack.ts's closed permission table. A pack
// cannot invent permissions; out-of-table declarations are typed rejections.
// ---------------------------------------------------------------------------

export const CATALOG_PERMISSION_IDS = ['read-files', 'execute-command', 'network-access', 'write-workspace'] as const;
export type CatalogPermissionId = (typeof CATALOG_PERMISSION_IDS)[number];

export const CATALOG_PERMISSION_RISK_TIERS = ['low', 'moderate', 'high'] as const;
export type CatalogPermissionRiskTier = (typeof CATALOG_PERMISSION_RISK_TIERS)[number];

export const CATALOG_PERMISSION_TABLE: Readonly<Record<CatalogPermissionId, CatalogPermissionRiskTier>> = {
    'read-files': 'low',
    'execute-command': 'high',
    'network-access': 'high',
    'write-workspace': 'moderate'
};

export function isCatalogPermissionId(value: unknown): value is CatalogPermissionId {
    return typeof value === 'string' && (CATALOG_PERMISSION_IDS as readonly string[]).includes(value);
}

export function isCatalogPermissionRiskTier(value: unknown): value is CatalogPermissionRiskTier {
    return typeof value === 'string' && (CATALOG_PERMISSION_RISK_TIERS as readonly string[]).includes(value);
}

// The fact tier adds 'none' for packs that declare no permissions at all.
export const CATALOG_PERMISSION_FACT_TIERS = ['none', 'low', 'moderate', 'high'] as const;
export type CatalogPermissionFactTier = (typeof CATALOG_PERMISSION_FACT_TIERS)[number];

const CATALOG_PERMISSION_FACT_TIER_RANK: Readonly<Record<CatalogPermissionFactTier, number>> = {
    'none': 0,
    'low': 1,
    'moderate': 2,
    'high': 3
};

export function isCatalogPermissionFactTier(value: unknown): value is CatalogPermissionFactTier {
    return typeof value === 'string' && (CATALOG_PERMISSION_FACT_TIERS as readonly string[]).includes(value);
}

export function highestCatalogPermissionFactTier(permissions: readonly CatalogPermissionId[]): CatalogPermissionFactTier {
    let highest: CatalogPermissionFactTier = 'none';
    for (const permission of permissions) {
        const tier: CatalogPermissionRiskTier = CATALOG_PERMISSION_TABLE[permission];
        if (CATALOG_PERMISSION_FACT_TIER_RANK[tier] > CATALOG_PERMISSION_FACT_TIER_RANK[highest]) {
            highest = tier;
        }
    }
    return highest;
}

// ---------------------------------------------------------------------------
// Verification statuses: pinned mirror of verification.ts's vocabulary.
// ---------------------------------------------------------------------------

export const CATALOG_VERIFICATION_STATUSES = ['unverified', 'verified', 'verified-partial', 'verification-failed'] as const;
export type CatalogVerificationStatus = (typeof CATALOG_VERIFICATION_STATUSES)[number];

export function isCatalogVerificationStatus(value: unknown): value is CatalogVerificationStatus {
    return typeof value === 'string' && (CATALOG_VERIFICATION_STATUSES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Receipts: pinned mirror of verification.ts's VerificationReceipt. A mirror,
// not a second authority -- the cross-module tests pin a receipt valid here if
// and only if it passes verification.ts's validateVerificationReceipt.
// ---------------------------------------------------------------------------

export interface CatalogVerificationCheck {
    name: string;
    passed: boolean;
    evidenceDigest: string;
}

export interface CatalogVerificationReceipt {
    scope: PackScope;
    contractVersion: string;
    packId: string;
    version: string;
    status: CatalogVerificationStatus;
    checks: readonly CatalogVerificationCheck[];
}

function isCatalogVerificationCheck(value: unknown): value is CatalogVerificationCheck {
    if (!isPlainObject(value)) {
        return false;
    }
    return (
        isNonEmptyString(value.name) &&
        typeof value.passed === 'boolean' &&
        isSha256Digest(value.evidenceDigest)
    );
}

export function isCatalogVerificationReceipt(value: unknown): value is CatalogVerificationReceipt {
    if (!isPlainObject(value)) {
        return false;
    }
    if (!isPackScope(value.scope)) {
        return false;
    }
    if (value.contractVersion !== CAPABILITY_PACKS_CONTRACTS_VERSION) {
        return false;
    }
    if (!isPackIdString(value.packId)) {
        return false;
    }
    if (!isSemverString(value.version)) {
        return false;
    }
    if (!isCatalogVerificationStatus(value.status)) {
        return false;
    }
    const checks = value.checks;
    if (!Array.isArray(checks)) {
        return false;
    }
    const seen: Set<string> = new Set();
    for (const check of checks) {
        if (!isCatalogVerificationCheck(check)) {
            return false;
        }
        if (seen.has(check.name)) {
            return false;
        }
        seen.add(check.name);
    }
    return true;
}

// ---------------------------------------------------------------------------
// The derived-status law: pinned mirror of verification.ts's
// verificationStatusFor (same mismatch kinds, same outcomes, same order of
// checks), plus the catalog-only null-receipt path that derives 'unverified'.
// The cross-module tests pin behavioral agreement for every non-null receipt.
// ---------------------------------------------------------------------------

export const CATALOG_VERIFICATION_MISMATCH_KINDS = [
    'verification-subject-malformed',
    'verification-receipt-malformed',
    'receipt-scope-mismatch',
    'receipt-contract-version-mismatch',
    'receipt-pack-id-mismatch',
    'receipt-version-mismatch',
    'receipt-checks-empty',
    'receipt-status-claim-mismatch'
] as const;
export type CatalogVerificationMismatchKind = (typeof CATALOG_VERIFICATION_MISMATCH_KINDS)[number];

export interface CatalogVerificationMismatch {
    kind: CatalogVerificationMismatchKind;
    expected: string;
    actual: string;
    message: string;
}

export interface CatalogStatusDerivation {
    status: CatalogVerificationStatus;
    claimedStatus: CatalogVerificationStatus | null;
    mismatches: readonly CatalogVerificationMismatch[];
    passedCheckNames: readonly string[];
    failedCheckNames: readonly string[];
}

function catalogMismatch(kind: CatalogVerificationMismatchKind, expected: string, actual: string, message: string): CatalogVerificationMismatch {
    return { kind, expected, actual, message };
}

export function deriveCatalogEntryStatus(subject: unknown, receipt: unknown): CatalogStatusDerivation {
    if (!isCatalogSubjectIdentity(subject)) {
        return {
            status: 'verification-failed',
            claimedStatus: null,
            mismatches: [
                catalogMismatch('verification-subject-malformed', 'a catalog subject', 'a malformed value', 'the subject must carry scope, contractVersion, packId and version')
            ],
            passedCheckNames: [],
            failedCheckNames: []
        };
    }
    if (receipt === null || receipt === undefined) {
        // Catalog-only path: no receipt means the entry is simply unverified.
        return { status: 'unverified', claimedStatus: null, mismatches: [], passedCheckNames: [], failedCheckNames: [] };
    }
    if (!isCatalogVerificationReceipt(receipt)) {
        return {
            status: 'verification-failed',
            claimedStatus: null,
            mismatches: [
                catalogMismatch('verification-receipt-malformed', 'a verification receipt', 'a malformed value', 'the verification receipt must pass structural validation')
            ],
            passedCheckNames: [],
            failedCheckNames: []
        };
    }
    const mismatches: CatalogVerificationMismatch[] = [];
    if (!sameScope(subject.scope, receipt.scope)) {
        mismatches.push(catalogMismatch('receipt-scope-mismatch', `${subject.scope.workspaceId}/${subject.scope.tenantId}`, `${receipt.scope.workspaceId}/${receipt.scope.tenantId}`, 'the receipt was issued for a different scope'));
    }
    if (subject.contractVersion !== receipt.contractVersion) {
        mismatches.push(catalogMismatch('receipt-contract-version-mismatch', subject.contractVersion, receipt.contractVersion, 'the receipt was issued for a different contract version'));
    }
    if (subject.packId !== receipt.packId) {
        mismatches.push(catalogMismatch('receipt-pack-id-mismatch', subject.packId, receipt.packId, 'the receipt was issued for a different pack'));
    }
    if (subject.version !== receipt.version) {
        mismatches.push(catalogMismatch('receipt-version-mismatch', subject.version, receipt.version, 'the receipt was issued for a different pack version'));
    }
    const passedCheckNames: string[] = [];
    const failedCheckNames: string[] = [];
    for (const check of receipt.checks) {
        if (check.passed) {
            passedCheckNames.push(check.name);
        } else {
            failedCheckNames.push(check.name);
        }
    }
    if (receipt.checks.length === 0) {
        mismatches.push(catalogMismatch('receipt-checks-empty', 'at least one check', '0 checks', 'a receipt with no checks proves nothing'));
    }
    let status: CatalogVerificationStatus;
    if (mismatches.length > 0) {
        status = 'verification-failed';
    } else if (failedCheckNames.length === 0) {
        status = 'verified';
    } else {
        status = 'verified-partial';
    }
    if (receipt.status !== status) {
        mismatches.push(catalogMismatch('receipt-status-claim-mismatch', status, receipt.status, `the receipt claims '${receipt.status}' but its evidence derives '${status}'`));
        status = 'verification-failed';
    }
    return { status, claimedStatus: receipt.status, mismatches, passedCheckNames, failedCheckNames };
}

// ---------------------------------------------------------------------------
// Deprecation: a typed reason from the frozen table plus a non-empty note.
// Deprecation is never silent, so both land on the entry.
// ---------------------------------------------------------------------------

export const CATALOG_DEPRECATION_REASONS = [
    'deprecated-superseded',
    'deprecated-security',
    'deprecated-license',
    'deprecated-broken',
    'deprecated-unmaintained'
] as const;
export type CatalogDeprecationReason = (typeof CATALOG_DEPRECATION_REASONS)[number];

export function isCatalogDeprecationReason(value: unknown): value is CatalogDeprecationReason {
    return typeof value === 'string' && (CATALOG_DEPRECATION_REASONS as readonly string[]).includes(value);
}

export interface CatalogDeprecation {
    reason: CatalogDeprecationReason;
    note: string;
    deprecatedAtIso: string;
}

export function isCatalogDeprecation(value: unknown): value is CatalogDeprecation {
    if (!isPlainObject(value)) {
        return false;
    }
    return (
        isCatalogDeprecationReason(value.reason) &&
        isNonEmptyString(value.note) &&
        isIso8601String(value.deprecatedAtIso)
    );
}

// ---------------------------------------------------------------------------
// Typed rejections shared by every catalog transition and query.
// ---------------------------------------------------------------------------

export const CATALOG_REJECTION_CODES = [
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
] as const;
export type CatalogRejectionCode = (typeof CATALOG_REJECTION_CODES)[number];

export interface CatalogRejection {
    ok: false;
    code: CatalogRejectionCode;
    message: string;
}

export type CatalogTransitionResult = { ok: true; catalog: CatalogRecord; entry: CatalogEntry } | CatalogRejection;
export type CatalogQueryResult = { ok: true; entries: readonly CatalogEntry[] } | CatalogRejection;

export function isCatalogRejectionCode(value: unknown): value is CatalogRejectionCode {
    return typeof value === 'string' && (CATALOG_REJECTION_CODES as readonly string[]).includes(value);
}

function catalogRejection(code: CatalogRejectionCode, message: string): CatalogRejection {
    return { ok: false, code, message };
}

// ---------------------------------------------------------------------------
// The pack projection: the minimal structural subset of pack.ts's
// CapabilityPack that the catalog consumes. A pack that passes pack.ts's
// validateCapabilityPack is structurally assignable to it (pinned by test);
// pack.ts remains the full pack authority.
// ---------------------------------------------------------------------------

export interface CatalogArtifactProjection {
    kind: CatalogArtifactKind;
}

export interface CatalogPackProjection {
    scope: PackScope;
    contractVersion: string;
    packId: string;
    version: string;
    nameDigest: string;
    artifacts: readonly CatalogArtifactProjection[];
    platformCompatibility: readonly CatalogPlatform[];
    declaredPermissions: readonly CatalogPermissionId[];
}

export type CatalogPackProjectionValidationResult = { ok: true; pack: CatalogPackProjection } | CatalogRejection;

export function validateCatalogPackProjection(value: unknown): CatalogPackProjectionValidationResult {
    if (!isPlainObject(value)) {
        return catalogRejection('catalog-rejected-pack-invalid', 'a pack must be a plain object');
    }
    if (!isPackScope(value.scope)) {
        return catalogRejection('catalog-rejected-pack-invalid', 'the pack scope must carry non-empty workspaceId and tenantId strings');
    }
    if (value.contractVersion !== CAPABILITY_PACKS_CONTRACTS_VERSION) {
        return catalogRejection('catalog-rejected-pack-invalid', `the pack contractVersion must be '${CAPABILITY_PACKS_CONTRACTS_VERSION}'`);
    }
    if (!isPackIdString(value.packId)) {
        return catalogRejection('catalog-rejected-pack-invalid', 'packId must match the pack id pattern');
    }
    if (!isSemverString(value.version)) {
        return catalogRejection('catalog-rejected-pack-invalid', 'version must be a semver-shaped plain string');
    }
    if (!isSha256Digest(value.nameDigest)) {
        return catalogRejection('catalog-rejected-pack-invalid', 'nameDigest must be a sha-256 shaped digest');
    }
    const artifacts = value.artifacts;
    if (!Array.isArray(artifacts) || artifacts.length === 0) {
        return catalogRejection('catalog-rejected-pack-invalid', 'a pack must declare at least one artifact');
    }
    for (const artifact of artifacts) {
        if (!isPlainObject(artifact) || !isCatalogArtifactKind(artifact.kind)) {
            return catalogRejection('catalog-rejected-pack-invalid', 'each artifact must carry a known artifact kind');
        }
    }
    const platforms = value.platformCompatibility;
    if (!Array.isArray(platforms) || platforms.length === 0) {
        return catalogRejection('catalog-rejected-pack-invalid', 'platformCompatibility must list at least one known platform');
    }
    const seenPlatforms: Set<string> = new Set();
    for (const platform of platforms) {
        if (!isCatalogPlatform(platform)) {
            return catalogRejection('catalog-rejected-pack-invalid', `unknown platform '${String(platform)}'`);
        }
        if (seenPlatforms.has(platform)) {
            return catalogRejection('catalog-rejected-pack-invalid', `platform '${String(platform)}' is listed more than once`);
        }
        seenPlatforms.add(platform);
    }
    const permissions = value.declaredPermissions;
    if (!Array.isArray(permissions)) {
        return catalogRejection('catalog-rejected-pack-invalid', 'declaredPermissions must be an array of known permission ids');
    }
    const seenPermissions: Set<string> = new Set();
    for (const permission of permissions) {
        if (!isCatalogPermissionId(permission)) {
            return catalogRejection('catalog-rejected-pack-invalid', `unknown permission '${String(permission)}': the permission table is closed (read-files, execute-command, network-access, write-workspace)`);
        }
        if (seenPermissions.has(permission)) {
            return catalogRejection('catalog-rejected-pack-invalid', `permission '${String(permission)}' is declared more than once`);
        }
        seenPermissions.add(permission);
    }
    return { ok: true, pack: value as unknown as CatalogPackProjection };
}

// ---------------------------------------------------------------------------
// Pack facts: the frozen query projection of a pack at registration time.
// artifactKinds keeps first-appearance order and drops duplicates; platforms
// and declaredPermissions keep the pack's declared order (already validated
// unique); permissionRiskTier is the highest declared tier or 'none'.
// ---------------------------------------------------------------------------

export interface CatalogPackFacts {
    nameDigest: string;
    artifactKinds: readonly CatalogArtifactKind[];
    platforms: readonly CatalogPlatform[];
    declaredPermissions: readonly CatalogPermissionId[];
    permissionRiskTier: CatalogPermissionFactTier;
}

export function packFactsFromProjection(pack: CatalogPackProjection): CatalogPackFacts {
    const kinds: CatalogArtifactKind[] = [];
    for (const artifact of pack.artifacts) {
        if (!kinds.includes(artifact.kind)) {
            kinds.push(artifact.kind);
        }
    }
    return {
        nameDigest: pack.nameDigest,
        artifactKinds: kinds,
        platforms: [...pack.platformCompatibility],
        declaredPermissions: [...pack.declaredPermissions],
        permissionRiskTier: highestCatalogPermissionFactTier(pack.declaredPermissions)
    };
}

export function isCatalogPackFacts(value: unknown): value is CatalogPackFacts {
    if (!isPlainObject(value)) {
        return false;
    }
    if (!isSha256Digest(value.nameDigest)) {
        return false;
    }
    const kinds = value.artifactKinds;
    if (!Array.isArray(kinds) || kinds.length === 0) {
        return false;
    }
    const seenKinds: Set<string> = new Set();
    for (const kind of kinds) {
        if (!isCatalogArtifactKind(kind) || seenKinds.has(kind)) {
            return false;
        }
        seenKinds.add(kind);
    }
    const platforms = value.platforms;
    if (!Array.isArray(platforms) || platforms.length === 0) {
        return false;
    }
    const seenPlatforms: Set<string> = new Set();
    for (const platform of platforms) {
        if (!isCatalogPlatform(platform) || seenPlatforms.has(platform)) {
            return false;
        }
        seenPlatforms.add(platform);
    }
    const permissions = value.declaredPermissions;
    if (!Array.isArray(permissions)) {
        return false;
    }
    const seenPermissions: Set<string> = new Set();
    for (const permission of permissions) {
        if (!isCatalogPermissionId(permission) || seenPermissions.has(permission)) {
            return false;
        }
        seenPermissions.add(permission);
    }
    if (!isCatalogPermissionFactTier(value.permissionRiskTier)) {
        return false;
    }
    if (value.permissionRiskTier !== highestCatalogPermissionFactTier(permissions)) {
        return false;
    }
    return true;
}

// ---------------------------------------------------------------------------
// Entries and the catalog record.
// ---------------------------------------------------------------------------

export interface CatalogEntry {
    packId: string;
    version: string;
    verificationStatus: CatalogVerificationStatus;
    registeredAtIso: string;
    deprecatedAtIso: string | null;
    deprecationReason: CatalogDeprecationReason | null;
    deprecationNote: string | null;
    packFacts: CatalogPackFacts;
}

export function isCatalogEntry(value: unknown): value is CatalogEntry {
    if (!isPlainObject(value)) {
        return false;
    }
    if (!isPackIdString(value.packId)) {
        return false;
    }
    if (!isSemverString(value.version)) {
        return false;
    }
    if (!isCatalogVerificationStatus(value.verificationStatus)) {
        return false;
    }
    if (!isIso8601String(value.registeredAtIso)) {
        return false;
    }
    const deprecatedAtIso = value.deprecatedAtIso;
    if (deprecatedAtIso !== null && !isIso8601String(deprecatedAtIso)) {
        return false;
    }
    const reason = value.deprecationReason;
    if (reason !== null && !isCatalogDeprecationReason(reason)) {
        return false;
    }
    const note = value.deprecationNote;
    if (note !== null && !isNonEmptyString(note)) {
        return false;
    }
    // Never-silent invariant: deprecation is all-or-nothing.
    const deprecated = deprecatedAtIso !== null;
    if (deprecated !== (reason !== null)) {
        return false;
    }
    if (deprecated !== (note !== null)) {
        return false;
    }
    if (!isCatalogPackFacts(value.packFacts)) {
        return false;
    }
    return true;
}

export interface CatalogRecord {
    scope: PackScope;
    contractVersion: string;
    catalogId: string;
    entries: readonly CatalogEntry[];
}

export function isCatalogRecord(value: unknown): value is CatalogRecord {
    if (!isPlainObject(value)) {
        return false;
    }
    if (!isPackScope(value.scope)) {
        return false;
    }
    if (value.contractVersion !== CAPABILITY_PACKS_CONTRACTS_VERSION) {
        return false;
    }
    if (!isNonEmptyString(value.catalogId)) {
        return false;
    }
    const entries = value.entries;
    if (!Array.isArray(entries)) {
        return false;
    }
    const activeKeys: Set<string> = new Set();
    for (const entry of entries) {
        if (!isCatalogEntry(entry)) {
            return false;
        }
        if (entry.deprecatedAtIso === null) {
            const key = `${entry.packId}@${entry.version}`;
            if (activeKeys.has(key)) {
                return false;
            }
            activeKeys.add(key);
        }
    }
    return true;
}

// ---------------------------------------------------------------------------
// Pure constructors and lookups.
// ---------------------------------------------------------------------------

/**
 * Pure constructor for an empty catalog. It does not validate its arguments;
 * use isCatalogRecord to check the result.
 */
export function emptyCatalog(scope: PackScope, catalogId: string): CatalogRecord {
    return { scope, contractVersion: CAPABILITY_PACKS_CONTRACTS_VERSION, catalogId, entries: [] };
}

function latestEntryIndexFor(catalog: CatalogRecord, packId: string, version: string): number {
    for (let index = catalog.entries.length - 1; index >= 0; index -= 1) {
        const entry = catalog.entries[index];
        if (entry.packId === packId && entry.version === version) {
            return index;
        }
    }
    return -1;
}

export function latestEntryFor(catalog: CatalogRecord, packId: string, version: string): CatalogEntry | null {
    const index = latestEntryIndexFor(catalog, packId, version);
    return index === -1 ? null : catalog.entries[index];
}

export function entryIsDeprecated(entry: CatalogEntry): boolean {
    return entry.deprecatedAtIso !== null;
}

// ---------------------------------------------------------------------------
// registerPack: a pack enters the catalog carrying its verification status.
//
// A duplicate ACTIVE packId+version is the typed rejection
// 'catalog-rejected-duplicate-pack'. Re-registering a DEPRECATED packId+version
// appends a NEW revision entry and never mutates history (the old revision
// stays in the entries list). registeredAtIso is caller-supplied.
// ---------------------------------------------------------------------------

export function registerPack(
    catalog: CatalogRecord,
    pack: CatalogPackProjection,
    verificationReceipt: CatalogVerificationReceipt | null,
    registeredAtIso: string
): CatalogTransitionResult {
    if (!isCatalogRecord(catalog)) {
        return catalogRejection('catalog-rejected-catalog-invalid', 'the catalog must be a valid catalog record');
    }
    const packValidation = validateCatalogPackProjection(pack);
    if (!packValidation.ok) {
        return packValidation;
    }
    if (!sameScope(pack.scope, catalog.scope)) {
        return catalogRejection('catalog-rejected-scope-mismatch', `the pack scope ('${pack.scope.workspaceId}/${pack.scope.tenantId}') does not match the catalog scope ('${catalog.scope.workspaceId}/${catalog.scope.tenantId}')`);
    }
    if (verificationReceipt !== null && verificationReceipt !== undefined) {
        if (!isCatalogVerificationReceipt(verificationReceipt)) {
            return catalogRejection('catalog-rejected-receipt-invalid', 'the receipt must carry scope, contractVersion, packId, version, a known status and named checks with sha-256 evidence digests');
        }
        if (!sameScope(verificationReceipt.scope, catalog.scope)) {
            return catalogRejection('catalog-rejected-scope-mismatch', 'the receipt scope does not match the catalog scope');
        }
    }
    if (!isIso8601String(registeredAtIso)) {
        return catalogRejection('catalog-rejected-timestamp-invalid', 'registeredAtIso must be an ISO-8601 string supplied by the caller');
    }
    for (const existing of catalog.entries) {
        if (existing.packId === pack.packId && existing.version === pack.version && existing.deprecatedAtIso === null) {
            return catalogRejection('catalog-rejected-duplicate-pack', `pack '${pack.packId}@${pack.version}' is already registered and active; deprecate it first or register a new version`);
        }
    }
    const derivation = deriveCatalogEntryStatus(pack, verificationReceipt === undefined ? null : verificationReceipt);
    const entry: CatalogEntry = {
        packId: pack.packId,
        version: pack.version,
        verificationStatus: derivation.status,
        registeredAtIso,
        deprecatedAtIso: null,
        deprecationReason: null,
        deprecationNote: null,
        packFacts: packFactsFromProjection(pack)
    };
    const nextCatalog: CatalogRecord = { ...catalog, entries: [...catalog.entries, entry] };
    return { ok: true, catalog: nextCatalog, entry };
}

// ---------------------------------------------------------------------------
// deprecatePack: marks the latest entry for (packId, version) deprecated.
// The typed reason and the note are required and land on the entry; the
// transition replaces the entry with an immutable copy and never mutates the
// input records.
// ---------------------------------------------------------------------------

export function deprecatePack(
    catalog: CatalogRecord,
    packId: string,
    version: string,
    deprecation: CatalogDeprecation
): CatalogTransitionResult {
    if (!isCatalogRecord(catalog)) {
        return catalogRejection('catalog-rejected-catalog-invalid', 'the catalog must be a valid catalog record');
    }
    if (
        !isPlainObject(deprecation) ||
        !isCatalogDeprecationReason(deprecation.reason) ||
        typeof deprecation.note !== 'string' ||
        deprecation.note.length === 0
    ) {
        return catalogRejection('catalog-rejected-deprecation-invalid', 'deprecation requires a reason from the frozen table and a non-empty note (deprecation is never silent)');
    }
    if (!isIso8601String(deprecation.deprecatedAtIso)) {
        return catalogRejection('catalog-rejected-timestamp-invalid', 'deprecatedAtIso must be an ISO-8601 string supplied by the caller');
    }
    const index = latestEntryIndexFor(catalog, packId, version);
    if (index === -1) {
        return catalogRejection('catalog-rejected-entry-not-found', `no catalog entry for pack '${packId}@${version}'`);
    }
    const existing = catalog.entries[index];
    if (existing.deprecatedAtIso !== null) {
        return catalogRejection('catalog-rejected-entry-already-deprecated', `pack '${packId}@${version}' is already deprecated`);
    }
    const entry: CatalogEntry = {
        ...existing,
        deprecatedAtIso: deprecation.deprecatedAtIso,
        deprecationReason: deprecation.reason,
        deprecationNote: deprecation.note
    };
    const entries = [...catalog.entries];
    entries[index] = entry;
    return { ok: true, catalog: { ...catalog, entries }, entry };
}

// ---------------------------------------------------------------------------
// verifyPack: the status-change gate. The catalog never upgrades (or
// downgrades) an entry's status without a receipt matching the entry's
// identity exactly; a mismatched receipt is a typed rejection with every
// mismatch named, and the entry is left untouched.
// ---------------------------------------------------------------------------

export function verifyPack(
    catalog: CatalogRecord,
    packId: string,
    version: string,
    receipt: CatalogVerificationReceipt
): CatalogTransitionResult {
    if (!isCatalogRecord(catalog)) {
        return catalogRejection('catalog-rejected-catalog-invalid', 'the catalog must be a valid catalog record');
    }
    if (!isCatalogVerificationReceipt(receipt)) {
        return catalogRejection('catalog-rejected-receipt-invalid', 'the receipt must carry scope, contractVersion, packId, version, a known status and named checks with sha-256 evidence digests');
    }
    if (!sameScope(receipt.scope, catalog.scope)) {
        return catalogRejection('catalog-rejected-scope-mismatch', 'the receipt scope does not match the catalog scope');
    }
    const index = latestEntryIndexFor(catalog, packId, version);
    if (index === -1) {
        return catalogRejection('catalog-rejected-entry-not-found', `no catalog entry for pack '${packId}@${version}'`);
    }
    const existing = catalog.entries[index];
    if (existing.deprecatedAtIso !== null) {
        return catalogRejection('catalog-rejected-entry-deprecated', `pack '${packId}@${version}' is deprecated; verification applies to active entries only`);
    }
    const mismatched: string[] = [];
    if (receipt.packId !== existing.packId) {
        mismatched.push(`packId (receipt '${receipt.packId}', entry '${existing.packId}')`);
    }
    if (receipt.version !== existing.version) {
        mismatched.push(`version (receipt '${receipt.version}', entry '${existing.version}')`);
    }
    if (receipt.contractVersion !== catalog.contractVersion) {
        mismatched.push(`contractVersion (receipt '${receipt.contractVersion}', catalog '${catalog.contractVersion}')`);
    }
    if (mismatched.length > 0) {
        return catalogRejection('catalog-rejected-receipt-mismatch', `the receipt does not match the catalog entry: ${mismatched.join('; ')}`);
    }
    const subject: CatalogSubjectIdentity = {
        scope: catalog.scope,
        contractVersion: catalog.contractVersion,
        packId: existing.packId,
        version: existing.version
    };
    const derivation = deriveCatalogEntryStatus(subject, receipt);
    const entry: CatalogEntry = { ...existing, verificationStatus: derivation.status };
    const entries = [...catalog.entries];
    entries[index] = entry;
    return { ok: true, catalog: { ...catalog, entries }, entry };
}

// ---------------------------------------------------------------------------
// queryCatalog and the pure predicate builders.
// ---------------------------------------------------------------------------

export type CatalogEntryPredicate = (entry: CatalogEntry) => boolean;

export function queryCatalog(catalog: CatalogRecord, predicate: CatalogEntryPredicate): CatalogQueryResult {
    if (!isCatalogRecord(catalog)) {
        return catalogRejection('catalog-rejected-catalog-invalid', 'the catalog must be a valid catalog record');
    }
    if (typeof predicate !== 'function') {
        return catalogRejection('catalog-rejected-predicate-invalid', 'the predicate must be a function from catalog entries to booleans');
    }
    return { ok: true, entries: catalog.entries.filter(predicate) };
}

export function entryMatchesVerificationStatus(status: CatalogVerificationStatus): CatalogEntryPredicate {
    return (entry) => entry.verificationStatus === status;
}

export function entryHasArtifactKind(kind: CatalogArtifactKind): CatalogEntryPredicate {
    return (entry) => entry.packFacts.artifactKinds.includes(kind);
}

export function entrySupportsPlatform(platform: CatalogPlatform): CatalogEntryPredicate {
    return (entry) => entry.packFacts.platforms.includes(platform);
}

export function entryPermissionTierAtLeast(tier: CatalogPermissionRiskTier): CatalogEntryPredicate {
    return (entry) => CATALOG_PERMISSION_FACT_TIER_RANK[entry.packFacts.permissionRiskTier] >= CATALOG_PERMISSION_FACT_TIER_RANK[tier];
}

export function entryPermissionTier(tier: CatalogPermissionRiskTier): CatalogEntryPredicate {
    return (entry) => entry.packFacts.permissionRiskTier === tier;
}

export function andEntryPredicates(...predicates: CatalogEntryPredicate[]): CatalogEntryPredicate {
    return (entry) => predicates.every((predicate) => predicate(entry));
}

export function orEntryPredicates(...predicates: CatalogEntryPredicate[]): CatalogEntryPredicate {
    return (entry) => predicates.some((predicate) => predicate(entry));
}
