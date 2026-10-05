/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

// ZC-006 -- the Capability Pack contract (Phase C, TL-B partition B2).
//
// A Capability Pack is a versioned DESCRIPTION of agent-facing artifacts (CLI,
// skill/instructions, MCP server, commands) in the sense of
// docs/FLAUZ-PROGRAM/ARCHITECTURE-LOCK.md section 11: imported entries become
// Flauz-owned records with hashes, licenses, declared permissions/endpoints and
// verification status. This module exports types, frozen vocabularies, pure
// guards, typed rejection records and pure digest-order functions. It is NOT a
// loader, installer, executor, downloader or hash-verifier runtime: any
// runtime pack loader/installer is out of scope by law.
//
// Zero-dependency law (labContracts discipline): this module declares no module
// dependencies of any kind.
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
// Module-local shape helpers.
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

export function isSha256Digest(value: unknown): value is string {
    return typeof value === 'string' && SHA256_DIGEST_PATTERN.test(value);
}

export function isSemverString(value: unknown): value is string {
    return typeof value === 'string' && SEMVER_PATTERN.test(value);
}

export function isIso8601String(value: unknown): value is string {
    return typeof value === 'string' && ISO_8601_PATTERN.test(value);
}

export function isPackIdString(value: unknown): value is string {
    return typeof value === 'string' && PACK_ID_PATTERN.test(value);
}

// ---------------------------------------------------------------------------
// Scope: every persisted record in this contract set carries one.
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
// Artifacts: the frozen artifact-kind table and the artifact entries.
// ---------------------------------------------------------------------------

export const PACK_ARTIFACT_KINDS = ['cli', 'skill-instructions', 'mcp-server', 'commands'] as const;
export type PackArtifactKind = (typeof PACK_ARTIFACT_KINDS)[number];

export function isPackArtifactKind(value: unknown): value is PackArtifactKind {
    return typeof value === 'string' && (PACK_ARTIFACT_KINDS as readonly string[]).includes(value);
}

export interface PackArtifact {
    kind: PackArtifactKind;
    artifactDigest: string;
    byteSize: number;
    entrypointRef: string;
}

export type PackArtifacts = readonly PackArtifact[];

export function isPackArtifact(value: unknown): value is PackArtifact {
    if (!isPlainObject(value)) {
        return false;
    }
    return (
        isPackArtifactKind(value.kind) &&
        isSha256Digest(value.artifactDigest) &&
        typeof value.byteSize === 'number' &&
        Number.isSafeInteger(value.byteSize) &&
        value.byteSize >= 0 &&
        isNonEmptyString(value.entrypointRef)
    );
}

// ---------------------------------------------------------------------------
// Required capabilities: what the pack NEEDS to run -- declared, not resolved.
// ---------------------------------------------------------------------------

/**
 * SEAM: EXECUTION_RESOURCE_REF_KINDS (ZC-006).
 *
 * RequiredCapabilities projects the resource/capability reference vocabulary
 * of ExecutionResourceRef, whose authority is
 * extensions/flauz-execution/src/contracts.ts (read-only; this wave may not
 * edit it). The dispatch order names the two reference families as
 * "resource/capability references"; the list below transcribes that naming as
 * an explicit PLACEHOLDER, not as a fabricated authority.
 *
 * Repo-side completion instruction (Tech Lead):
 *   1. Read ExecutionResourceRef in extensions/flauz-execution/src/contracts.ts.
 *   2. Transcribe the exact discriminant literals it uses for resource and
 *      capability references into REQUIRED_CAPABILITY_REF_KINDS below,
 *      verbatim, preserving member names, order and casing.
 *   3. Complete the verbatim pin marked SEAM in test/common/pack.test.ts.
 *
 * The seam tests are written against the exported constant (never against
 * hardcoded literals), so transcription cannot silently invalidate them; until
 * the seam is completed they assert structural invariants only.
 */
export const REQUIRED_CAPABILITY_REF_KINDS = ['resource', 'capability'] as const;
export type RequiredCapabilityRefKind = (typeof REQUIRED_CAPABILITY_REF_KINDS)[number];

export interface RequiredCapabilityRef {
    kind: RequiredCapabilityRefKind;
    refId: string;
}

export type RequiredCapabilities = readonly RequiredCapabilityRef[];

export function isRequiredCapabilityRef(value: unknown): value is RequiredCapabilityRef {
    if (!isPlainObject(value)) {
        return false;
    }
    return (
        typeof value.kind === 'string' &&
        (REQUIRED_CAPABILITY_REF_KINDS as readonly string[]).includes(value.kind) &&
        isNonEmptyString(value.refId)
    );
}

// ---------------------------------------------------------------------------
// Declared permissions: a CLOSED table. A pack cannot invent permissions.
// ---------------------------------------------------------------------------

export const PACK_PERMISSION_IDS = ['read-files', 'execute-command', 'network-access', 'write-workspace'] as const;
export type PackPermissionId = (typeof PACK_PERMISSION_IDS)[number];

export const PERMISSION_RISK_TIERS = ['low', 'moderate', 'high'] as const;
export type PermissionRiskTier = (typeof PERMISSION_RISK_TIERS)[number];

/**
 * The frozen permission table: every permission id carries exactly one risk
 * tier. The tier assignment is Flauz-owned contract design (the dispatch order
 * pins the permission ids and requires a risk tier per id; it does not project
 * tiers from a read-only authority).
 */
export const PACK_PERMISSION_TABLE: Readonly<Record<PackPermissionId, PermissionRiskTier>> = {
    'read-files': 'low',
    'execute-command': 'high',
    'network-access': 'high',
    'write-workspace': 'moderate'
};

const PERMISSION_RISK_TIER_RANK: Readonly<Record<PermissionRiskTier, number>> = {
    'low': 0,
    'moderate': 1,
    'high': 2
};

export function isPackPermissionId(value: unknown): value is PackPermissionId {
    return typeof value === 'string' && (PACK_PERMISSION_IDS as readonly string[]).includes(value);
}

export function isPermissionRiskTier(value: unknown): value is PermissionRiskTier {
    return typeof value === 'string' && (PERMISSION_RISK_TIERS as readonly string[]).includes(value);
}

export type DeclaredPermissions = readonly PackPermissionId[];

export function isDeclaredPermissions(value: unknown): value is DeclaredPermissions {
    if (!Array.isArray(value)) {
        return false;
    }
    const seen: Set<string> = new Set();
    for (const entry of value) {
        if (!isPackPermissionId(entry)) {
            return false;
        }
        if (seen.has(entry)) {
            return false;
        }
        seen.add(entry);
    }
    return true;
}

export function permissionRiskTier(permission: PackPermissionId): PermissionRiskTier {
    return PACK_PERMISSION_TABLE[permission];
}

export function highestPermissionRiskTier(permissions: DeclaredPermissions): PermissionRiskTier | null {
    if (permissions.length === 0) {
        return null;
    }
    let highest: PermissionRiskTier | null = null;
    let highestRank: number = -1;
    for (const permission of permissions) {
        const tier: PermissionRiskTier = PACK_PERMISSION_TABLE[permission];
        const rank: number = PERMISSION_RISK_TIER_RANK[tier];
        if (rank > highestRank) {
            highestRank = rank;
            highest = tier;
        }
    }
    return highest;
}

export function permissionRiskTierAtLeast(permissions: DeclaredPermissions, tier: PermissionRiskTier): boolean {
    for (const permission of permissions) {
        if (PERMISSION_RISK_TIER_RANK[PACK_PERMISSION_TABLE[permission]] >= PERMISSION_RISK_TIER_RANK[tier]) {
            return true;
        }
    }
    return false;
}

// ---------------------------------------------------------------------------
// Pack configuration: typed schema triplets plus plain-valued defaults.
// ---------------------------------------------------------------------------

export const PACK_CONFIGURATION_FIELD_TYPES = ['string', 'number', 'boolean'] as const;
export type PackConfigurationFieldType = (typeof PACK_CONFIGURATION_FIELD_TYPES)[number];

export interface PackConfigurationField {
    name: string;
    type: PackConfigurationFieldType;
    required: boolean;
}

export type PackConfigurationValue = string | number | boolean | null;

export interface PackConfiguration {
    fields: readonly PackConfigurationField[];
    defaults: Readonly<Record<string, PackConfigurationValue>>;
}

export function isPackConfigurationFieldType(value: unknown): value is PackConfigurationFieldType {
    return typeof value === 'string' && (PACK_CONFIGURATION_FIELD_TYPES as readonly string[]).includes(value);
}

function isPackConfigurationValue(value: unknown): value is PackConfigurationValue {
    return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function configurationValueMatchesType(value: PackConfigurationValue, type: PackConfigurationFieldType): boolean {
    if (value === null) {
        return true;
    }
    if (type === 'string') {
        return typeof value === 'string';
    }
    if (type === 'number') {
        return typeof value === 'number';
    }
    return typeof value === 'boolean';
}

export function isPackConfiguration(value: unknown): value is PackConfiguration {
    if (!isPlainObject(value)) {
        return false;
    }
    const fields = value.fields;
    if (!Array.isArray(fields)) {
        return false;
    }
    const fieldTypeByName: Map<string, PackConfigurationFieldType> = new Map();
    for (const field of fields) {
        if (!isPlainObject(field)) {
            return false;
        }
        const name = field.name;
        const type = field.type;
        const required = field.required;
        if (!isNonEmptyString(name)) {
            return false;
        }
        if (!isPackConfigurationFieldType(type)) {
            return false;
        }
        if (typeof required !== 'boolean') {
            return false;
        }
        if (fieldTypeByName.has(name)) {
            return false;
        }
        fieldTypeByName.set(name, type);
    }
    const defaults = value.defaults;
    if (!isPlainObject(defaults)) {
        return false;
    }
    for (const key of Object.keys(defaults)) {
        const fieldType = fieldTypeByName.get(key);
        if (fieldType === undefined) {
            return false;
        }
        const defaultValue = defaults[key];
        if (!isPackConfigurationValue(defaultValue)) {
            return false;
        }
        if (!configurationValueMatchesType(defaultValue, fieldType)) {
            return false;
        }
    }
    return true;
}

/**
 * The configuration-default permission law: NO default may grant a permission
 * the pack did not declare. A field whose name is a permission-table id is a
 * permission-flag field; a grant is a boolean true default on such a field.
 * Defaults for declared permissions may grant; defaults for undeclared
 * permissions must not.
 */
export function configurationDefaultGrantsUndeclaredPermission(
    configuration: PackConfiguration,
    declaredPermissions: DeclaredPermissions
): boolean {
    for (const field of configuration.fields) {
        if (!isPackPermissionId(field.name)) {
            continue;
        }
        if (declaredPermissions.includes(field.name)) {
            continue;
        }
        if (configuration.defaults[field.name] === true) {
            return true;
        }
    }
    return false;
}

// ---------------------------------------------------------------------------
// Provenance.
// ---------------------------------------------------------------------------

export const PACK_SOURCE_TYPES = ['flauz-native', 'imported'] as const;
export type PackSourceType = (typeof PACK_SOURCE_TYPES)[number];

const SPDX_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.\-+]*$/;

export interface PackProvenance {
    origin: string;
    sourceType: PackSourceType;
    capturedAtIso: string;
    licenseSpdxId: string;
    licenseDigest: string;
}

export function isPackSourceType(value: unknown): value is PackSourceType {
    return typeof value === 'string' && (PACK_SOURCE_TYPES as readonly string[]).includes(value);
}

export function isPackProvenance(value: unknown): value is PackProvenance {
    if (!isPlainObject(value)) {
        return false;
    }
    const origin = value.origin;
    const sourceType = value.sourceType;
    const capturedAtIso = value.capturedAtIso;
    const licenseSpdxId = value.licenseSpdxId;
    const licenseDigest = value.licenseDigest;
    return (
        isNonEmptyString(origin) &&
        isPackSourceType(sourceType) &&
        isIso8601String(capturedAtIso) &&
        typeof licenseSpdxId === 'string' &&
        SPDX_IDENTIFIER_PATTERN.test(licenseSpdxId) &&
        isSha256Digest(licenseDigest)
    );
}

// ---------------------------------------------------------------------------
// Platform compatibility.
// ---------------------------------------------------------------------------

export const PACK_PLATFORMS = ['darwin-x64', 'darwin-arm64', 'linux-x64', 'linux-arm64', 'windows-x64'] as const;
export type PackPlatform = (typeof PACK_PLATFORMS)[number];

export type PlatformCompatibility = readonly PackPlatform[];

export function isPackPlatform(value: unknown): value is PackPlatform {
    return typeof value === 'string' && (PACK_PLATFORMS as readonly string[]).includes(value);
}

export function isPlatformCompatibility(value: unknown): value is PlatformCompatibility {
    if (!Array.isArray(value)) {
        return false;
    }
    const seen: Set<string> = new Set();
    for (const platform of value) {
        if (!isPackPlatform(platform)) {
            return false;
        }
        if (seen.has(platform)) {
            return false;
        }
        seen.add(platform);
    }
    return true;
}

// ---------------------------------------------------------------------------
// Pack integrity: a content digest over the artifact digests.
// ---------------------------------------------------------------------------

export interface PackIntegrity {
    contentDigest: string;
}

interface ArtifactOrderRow {
    kind: PackArtifactKind;
    artifactDigest: string;
    entrypointRef: string;
}

function compareArtifactOrderRows(left: ArtifactOrderRow, right: ArtifactOrderRow): number {
    if (left.kind !== right.kind) {
        return left.kind < right.kind ? -1 : 1;
    }
    if (left.artifactDigest !== right.artifactDigest) {
        return left.artifactDigest < right.artifactDigest ? -1 : 1;
    }
    if (left.entrypointRef !== right.entrypointRef) {
        return left.entrypointRef < right.entrypointRef ? -1 : 1;
    }
    return 0;
}

/**
 * The exported pure digest-order function: the artifact digests ordered by
 * ASCII-lexical (kind, artifactDigest, entrypointRef). Recipe (pinned):
 * integrity.contentDigest is the SHA-256 hex digest of the UTF-8 encoding of
 * packIntegrityPreimage(pack). The digest itself is computed outside this
 * module (descriptions, not executors); this contract pins only the
 * deterministic order and preimage.
 */
export function packArtifactDigestOrder(pack: CapabilityPack): readonly string[] {
    const rows: ArtifactOrderRow[] = pack.artifacts.map((artifact) => ({
        kind: artifact.kind,
        artifactDigest: artifact.artifactDigest,
        entrypointRef: artifact.entrypointRef
    }));
    rows.sort(compareArtifactOrderRows);
    return rows.map((row) => row.artifactDigest);
}

export function packIntegrityPreimage(pack: CapabilityPack): string {
    return packArtifactDigestOrder(pack).join('\n');
}

// ---------------------------------------------------------------------------
// The pack record.
// ---------------------------------------------------------------------------

export interface CapabilityPack {
    scope: PackScope;
    contractVersion: string;
    packId: string;
    version: string;
    nameDigest: string;
    descriptionDigest: string;
    artifacts: PackArtifacts;
    requiredCapabilities: RequiredCapabilities;
    declaredPermissions: DeclaredPermissions;
    configuration: PackConfiguration;
    provenance: PackProvenance;
    platformCompatibility: PlatformCompatibility;
    integrity: PackIntegrity;
}

// ---------------------------------------------------------------------------
// Typed rejections and the validator.
// ---------------------------------------------------------------------------

export const PACK_REJECTION_CODES = [
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
] as const;
export type PackRejectionCode = (typeof PACK_REJECTION_CODES)[number];

export interface PackRejection {
    ok: false;
    code: PackRejectionCode;
    message: string;
}

export type PackValidationResult = { ok: true; pack: CapabilityPack } | PackRejection;

export function isPackRejectionCode(value: unknown): value is PackRejectionCode {
    return typeof value === 'string' && (PACK_REJECTION_CODES as readonly string[]).includes(value);
}

function packRejection(code: PackRejectionCode, message: string): PackRejection {
    return { ok: false, code, message };
}

/**
 * Validates a candidate pack record. The check order is fixed and
 * deterministic: scope, contractVersion, packId, version, name digest,
 * description digest, artifacts, required capabilities, declared permissions,
 * configuration (structure, then the permission-default law), provenance,
 * platform compatibility, integrity. A permission outside the frozen table is
 * the typed rejection 'pack-permission-unknown'.
 */
export function validateCapabilityPack(value: unknown): PackValidationResult {
    if (!isPlainObject(value)) {
        return packRejection('pack-malformed', 'a capability pack must be a plain object');
    }
    if (!isPackScope(value.scope)) {
        return packRejection('pack-scope-invalid', 'scope must carry non-empty workspaceId and tenantId strings');
    }
    if (value.contractVersion !== CAPABILITY_PACKS_CONTRACTS_VERSION) {
        return packRejection('pack-contract-version-mismatch', `contractVersion must be '${CAPABILITY_PACKS_CONTRACTS_VERSION}'`);
    }
    if (!isPackIdString(value.packId)) {
        return packRejection('pack-id-invalid', 'packId must match the pack id pattern');
    }
    if (!isSemverString(value.version)) {
        return packRejection('pack-version-invalid', 'version must be a semver-shaped plain string');
    }
    if (!isSha256Digest(value.nameDigest)) {
        return packRejection('pack-name-digest-invalid', 'nameDigest must be a sha-256 shaped digest');
    }
    if (!isSha256Digest(value.descriptionDigest)) {
        return packRejection('pack-description-digest-invalid', 'descriptionDigest must be a sha-256 shaped digest');
    }
    const artifacts = value.artifacts;
    if (!Array.isArray(artifacts) || artifacts.length === 0) {
        return packRejection('pack-artifacts-empty', 'a pack must declare at least one artifact');
    }
    for (const artifact of artifacts) {
        if (!isPackArtifact(artifact)) {
            return packRejection('pack-artifact-invalid', 'each artifact needs a known kind, a sha-256 artifactDigest, a non-negative integer byteSize and a non-empty entrypointRef');
        }
    }
    const requiredCapabilities = value.requiredCapabilities;
    if (!Array.isArray(requiredCapabilities)) {
        return packRejection('pack-required-capability-invalid', 'requiredCapabilities must be an array of capability references');
    }
    for (const requiredCapability of requiredCapabilities) {
        if (!isRequiredCapabilityRef(requiredCapability)) {
            return packRejection('pack-required-capability-invalid', 'each required capability reference needs a known kind and a non-empty refId');
        }
    }
    const declaredPermissions = value.declaredPermissions;
    if (!Array.isArray(declaredPermissions)) {
        return packRejection('pack-permission-unknown', 'declaredPermissions must be an array of known permission ids');
    }
    const seenPermissions: Set<string> = new Set();
    for (const permission of declaredPermissions) {
        if (!isPackPermissionId(permission)) {
            return packRejection('pack-permission-unknown', `unknown permission '${String(permission)}': the permission table is closed (read-files, execute-command, network-access, write-workspace)`);
        }
        if (seenPermissions.has(permission)) {
            return packRejection('pack-permission-duplicate', `permission '${String(permission)}' is declared more than once`);
        }
        seenPermissions.add(permission);
    }
    const configuration = value.configuration;
    if (!isPackConfiguration(configuration)) {
        return packRejection('pack-configuration-invalid', 'configuration must carry name/type/required field triplets and plain-valued defaults keyed by field name');
    }
    if (configurationDefaultGrantsUndeclaredPermission(configuration, declaredPermissions)) {
        return packRejection('pack-configuration-grants-undeclared-permission', 'a configuration default grants a permission the pack did not declare');
    }
    if (!isPackProvenance(value.provenance)) {
        return packRejection('pack-provenance-invalid', 'provenance must carry origin, sourceType, capturedAtIso, licenseSpdxId and licenseDigest');
    }
    const platforms = value.platformCompatibility;
    if (!Array.isArray(platforms) || platforms.length === 0) {
        return packRejection('pack-platform-invalid', 'platformCompatibility must list at least one known platform');
    }
    const seenPlatforms: Set<string> = new Set();
    for (const platform of platforms) {
        if (!isPackPlatform(platform)) {
            return packRejection('pack-platform-invalid', `unknown platform '${String(platform)}'`);
        }
        if (seenPlatforms.has(platform)) {
            return packRejection('pack-platform-invalid', `platform '${String(platform)}' is listed more than once`);
        }
        seenPlatforms.add(platform);
    }
    const integrity = value.integrity;
    if (!isPlainObject(integrity) || !isSha256Digest(integrity.contentDigest)) {
        return packRejection('pack-integrity-invalid', 'integrity.contentDigest must be a sha-256 shaped digest over the ordered artifact digests');
    }
    return { ok: true, pack: value as unknown as CapabilityPack };
}

export function isCapabilityPack(value: unknown): value is CapabilityPack {
    return validateCapabilityPack(value).ok;
}

/**
 * The pure platform compatibility guard: true only when the platform is a
 * known platform id AND the pack declares it.
 */
export function compatibilityFor(pack: CapabilityPack, platform: string): boolean {
    if (!isPackPlatform(platform)) {
        return false;
    }
    return pack.platformCompatibility.includes(platform);
}
