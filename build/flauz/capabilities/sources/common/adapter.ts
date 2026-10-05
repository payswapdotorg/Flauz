/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

// ---------------------------------------------------------------------------
// ZC-007 - external capability-source adapter contracts (Phase C, TL-B lane).
// Module 2 of 3: the adapter contract (interface shape, registry, replacement
// law, discovery/fetch/normalize message contracts).
// Contract set version: SOURCE_ADAPTERS_CONTRACTS_VERSION 1.0.0.
// ---------------------------------------------------------------------------
//
// DETERMINISM LAW: no Math.random, no Date.now, no new Date(...) may be used
// in this module. All timestamps are plain ISO-8601 strings supplied by
// callers. This module contains pure types, constants and functions only.
//
// ZERO-DEPENDENCY LAW: this contract module contains no import statements,
// mirroring build/flauz/lab/common/labContracts.ts. The shared source
// vocabulary below is a VERBATIM PROJECTION of ./source.ts (the authority);
// test/common/adapter.test.ts cross-pins the copies so drift fails.
//
// IMPORT-SOURCE LAW (ARCHITECTURE-LOCK section 11): adapters for external
// sources are REPLACEABLE IMPORT SOURCES ONLY. An adapter transports
// discoverable artifacts into Flauz-shaped contracts; it never verifies,
// executes or ranks anything. Flauz remains the verification and execution
// authority.
//
// REPLACEMENT LAW: at most one ACTIVE adapter per source kind at all times.
// adapterFor resolves the active adapter for a kind; a kind without an
// active adapter is the typed no-adapter disclosure, never a silent skip.
// supersedeAdapter is the only way to swap an active adapter: the old one
// moves to retired, the new one becomes active for the same kind.
//
// FETCH CONTRACT LAW: FetchResult is the CONTRACT about bytes (their digest
// and byte size). It never carries the bytes themselves; there is
// deliberately no payload field. Byte movement is runtime adapter work and
// out of scope for this wave by law.
//
// RECORD LAW: every persisted record carries scope: SourceScope and
// contractVersion: string, with plain-string ISO-8601 timestamps.

export const SOURCE_ADAPTERS_CONTRACTS_VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// VERBATIM PROJECTION from ./source.ts (ZC-007 source vocabulary).
// Import statements are forbidden in common/** contract modules (the
// zero-dependency law), so the shared vocabulary is duplicated here.
// ./source.ts is the authority; this copy MUST stay identical, and
// test/common/adapter.test.ts cross-pins version, kind list and health
// states so any drift fails the gate.
// ---------------------------------------------------------------------------

export interface SourceScope {
    workspaceId: string;
    tenantId: string;
}

export function isSourceScope(value: unknown): value is SourceScope {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    return (
        typeof candidate.workspaceId === 'string' &&
        typeof candidate.tenantId === 'string'
    );
}

export function sourceScopesEqual(a: SourceScope, b: SourceScope): boolean {
    return a.workspaceId === b.workspaceId && a.tenantId === b.tenantId;
}

export const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function isIsoTimestamp(value: unknown): value is string {
    return typeof value === 'string' && ISO_TIMESTAMP_PATTERN.test(value);
}

export const SOURCE_KINDS = [
    'printing-press',
    'printing-press-library',
    'composio',
    'mcp-catalog',
    'skill-catalog',
    'user-spec',
    'api-spec',
    'site-spec',
    'community-project'
] as const;

export type SourceKind = (typeof SOURCE_KINDS)[number];

export function isSourceKind(value: unknown): value is SourceKind {
    return (
        typeof value === 'string' &&
        (SOURCE_KINDS as readonly string[]).includes(value)
    );
}

export const SOURCE_HEALTH_STATES = ['unknown', 'reachable', 'unreachable'] as const;

export type SourceHealthState = (typeof SOURCE_HEALTH_STATES)[number];

export function isSourceHealthState(value: unknown): value is SourceHealthState {
    return (
        typeof value === 'string' &&
        (SOURCE_HEALTH_STATES as readonly string[]).includes(value)
    );
}

export interface SourceDescriptor {
    scope: SourceScope;
    contractVersion: string;
    sourceId: string;
    kind: SourceKind;
    endpointRef: string;
    sourceVersion: string;
    discoveredAtIso: string;
    healthState: SourceHealthState;
}

export function isSourceDescriptor(value: unknown): value is SourceDescriptor {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    return (
        isSourceScope(candidate.scope) &&
        typeof candidate.contractVersion === 'string' &&
        typeof candidate.sourceId === 'string' &&
        candidate.sourceId.length > 0 &&
        isSourceKind(candidate.kind) &&
        typeof candidate.endpointRef === 'string' &&
        typeof candidate.sourceVersion === 'string' &&
        isIsoTimestamp(candidate.discoveredAtIso) &&
        isSourceHealthState(candidate.healthState)
    );
}

// ---------------------------------------------------------------------------
// SEAM(zc006-permission-table) - TWIN COPY A of 2 (this file and
// common/import.ts).
// The ZC-006 wave owns the frozen permission-table vocabulary
// (build/flauz/capabilities/packs/** at dispatch time; in flight and not
// readable from this lane). DO NOT fabricate authority values: the list below
// is an EXPLICIT PLACEHOLDER.
// TRANSCRIPTION INSTRUCTION (harvest time): copy the frozen permission-table
// list VERBATIM from the ZC-006 authority - same identifiers, same order,
// same casing - into CAPABILITY_PERMISSIONS here AND into the twin copy in
// common/import.ts, keeping both identical. Keep the exported names
// CAPABILITY_PERMISSIONS, CapabilityPermission and isCapabilityPermission
// unchanged. The tests use CAPABILITY_PERMISSIONS[0] for in-table cases (they
// are seam-agnostic and keep passing); do not add tests that pin the
// placeholder VALUES - after transcription, pin the authority verbatim per
// house law. test/common/adapter.test.ts cross-pins the twin copies.
// ---------------------------------------------------------------------------

export const CAPABILITY_PERMISSIONS = [
    'read-files',
    'execute-command',
    'network-access',
    'write-workspace'
] as const;

export type CapabilityPermission = (typeof CAPABILITY_PERMISSIONS)[number];

export function isCapabilityPermission(value: unknown): value is CapabilityPermission {
    return (
        typeof value === 'string' &&
        (CAPABILITY_PERMISSIONS as readonly string[]).includes(value)
    );
}

// The adapter descriptor: the versioned identity of a replaceable adapter
// serving exactly one source kind.
export interface AdapterDescriptor {
    scope: SourceScope;
    contractVersion: string;
    adapterId: string;
    sourceKind: SourceKind;
    adapterVersion: string;
    supportedSourceVersions: readonly string[];
}

export function isAdapterDescriptor(value: unknown): value is AdapterDescriptor {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    return (
        isSourceScope(candidate.scope) &&
        typeof candidate.contractVersion === 'string' &&
        typeof candidate.adapterId === 'string' &&
        candidate.adapterId.length > 0 &&
        isSourceKind(candidate.sourceKind) &&
        typeof candidate.adapterVersion === 'string' &&
        Array.isArray(candidate.supportedSourceVersions) &&
        (candidate.supportedSourceVersions as unknown[]).every(
            (entry) => typeof entry === 'string'
        )
    );
}

export const ADAPTER_LIFECYCLE_STATES = ['active', 'retired'] as const;

export type AdapterLifecycleState = (typeof ADAPTER_LIFECYCLE_STATES)[number];

export function isAdapterLifecycleState(value: unknown): value is AdapterLifecycleState {
    return (
        typeof value === 'string' &&
        (ADAPTER_LIFECYCLE_STATES as readonly string[]).includes(value)
    );
}

// A registry entry: the stamped descriptor plus its lifecycle state. The
// scope and contractVersion stamps deliberately repeat the embedded
// descriptor's (record law); transitions keep them consistent.
export interface AdapterRegistration {
    scope: SourceScope;
    contractVersion: string;
    descriptor: AdapterDescriptor;
    state: AdapterLifecycleState;
}

export function isAdapterRegistration(value: unknown): value is AdapterRegistration {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    if (
        !isSourceScope(candidate.scope) ||
        typeof candidate.contractVersion !== 'string' ||
        !isAdapterDescriptor(candidate.descriptor) ||
        !isAdapterLifecycleState(candidate.state)
    ) {
        return false;
    }
    return (
        sourceScopesEqual(candidate.scope, candidate.descriptor.scope) &&
        candidate.contractVersion === candidate.descriptor.contractVersion
    );
}

// The adapter registry. REPLACEMENT LAW: at most one ACTIVE adapter per
// source kind at all times; isAdapterRegistry enforces the invariant and the
// transitions preserve it.
export interface AdapterRegistry {
    scope: SourceScope;
    contractVersion: string;
    registrations: readonly AdapterRegistration[];
}

export function isAdapterRegistry(value: unknown): value is AdapterRegistry {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    if (
        !isSourceScope(candidate.scope) ||
        typeof candidate.contractVersion !== 'string' ||
        !Array.isArray(candidate.registrations) ||
        !(candidate.registrations as unknown[]).every((entry) => isAdapterRegistration(entry))
    ) {
        return false;
    }
    const activeKinds = new Set<string>();
    for (const entry of candidate.registrations as unknown[]) {
        const registration = entry as AdapterRegistration;
        if (registration.state === 'active') {
            if (activeKinds.has(registration.descriptor.sourceKind)) {
                return false;
            }
            activeKinds.add(registration.descriptor.sourceKind);
        }
    }
    return true;
}

export function createAdapterRegistry(scope: SourceScope): AdapterRegistry {
    return {
        scope,
        contractVersion: SOURCE_ADAPTERS_CONTRACTS_VERSION,
        registrations: []
    };
}

export type RegisterAdapterResult =
    | { outcome: 'registered'; registry: AdapterRegistry; registration: AdapterRegistration }
    | { outcome: 'already-registered'; registry: AdapterRegistry }
    | { outcome: 'kind-occupied'; registry: AdapterRegistry; activeAdapterId: string }
    | { outcome: 'invalid-registry'; registry: AdapterRegistry }
    | { outcome: 'invalid-descriptor'; registry: AdapterRegistry }
    | { outcome: 'version-mismatch'; registry: AdapterRegistry; expected: string; found: string }
    | { outcome: 'scope-mismatch'; registry: AdapterRegistry };

// registerAdapter: installs an adapter as the single ACTIVE adapter for its
// kind. Idempotent-guarded by adapterId (an adapterId registers once per
// registry lineage; a retired id cannot re-register, a new id must supersede
// it). A kind that already has an active adapter discloses kind-occupied:
// use supersedeAdapter. Check order is fixed: invalid-registry,
// invalid-descriptor, version-mismatch, scope-mismatch, already-registered,
// kind-occupied, registered.
export function registerAdapter(
    registry: AdapterRegistry,
    descriptor: AdapterDescriptor
): RegisterAdapterResult {
    if (!isAdapterRegistry(registry)) {
        return { outcome: 'invalid-registry', registry };
    }
    if (!isAdapterDescriptor(descriptor)) {
        return { outcome: 'invalid-descriptor', registry };
    }
    if (descriptor.contractVersion !== registry.contractVersion) {
        return {
            outcome: 'version-mismatch',
            registry,
            expected: registry.contractVersion,
            found: descriptor.contractVersion
        };
    }
    if (!sourceScopesEqual(registry.scope, descriptor.scope)) {
        return { outcome: 'scope-mismatch', registry };
    }
    if (findRegistration(registry, descriptor.adapterId) !== undefined) {
        return { outcome: 'already-registered', registry };
    }
    const activeForKind = findActiveForKind(registry, descriptor.sourceKind);
    if (activeForKind !== undefined) {
        return {
            outcome: 'kind-occupied',
            registry,
            activeAdapterId: activeForKind.descriptor.adapterId
        };
    }
    const registration: AdapterRegistration = {
        scope: registry.scope,
        contractVersion: registry.contractVersion,
        descriptor,
        state: 'active'
    };
    return {
        outcome: 'registered',
        registry: {
            scope: registry.scope,
            contractVersion: registry.contractVersion,
            registrations: [...registry.registrations, registration]
        },
        registration
    };
}

export type SupersedeAdapterResult =
    | { outcome: 'superseded'; registry: AdapterRegistry; retired: AdapterRegistration; activated: AdapterRegistration }
    | { outcome: 'unknown-adapter'; registry: AdapterRegistry }
    | { outcome: 'invalid-adapter-id'; registry: AdapterRegistry }
    | { outcome: 'not-active'; registry: AdapterRegistry; state: AdapterLifecycleState }
    | { outcome: 'kind-mismatch'; registry: AdapterRegistry; expected: SourceKind; found: SourceKind }
    | { outcome: 'already-registered'; registry: AdapterRegistry }
    | { outcome: 'kind-occupied'; registry: AdapterRegistry; activeAdapterId: string }
    | { outcome: 'invalid-registry'; registry: AdapterRegistry }
    | { outcome: 'invalid-descriptor'; registry: AdapterRegistry }
    | { outcome: 'version-mismatch'; registry: AdapterRegistry; expected: string; found: string }
    | { outcome: 'scope-mismatch'; registry: AdapterRegistry };

// supersedeAdapter(registry, old, new): the replacement law. 'old' is the
// adapterId of the currently active adapter; 'new' is the replacement
// descriptor and MUST serve the same source kind. The old registration moves
// to retired, the new one is appended active. Check order is fixed:
// invalid-registry, invalid-adapter-id, invalid-descriptor, version-mismatch,
// scope-mismatch, unknown-adapter, not-active, already-registered,
// kind-mismatch, kind-occupied, superseded.
export function supersedeAdapter(
    registry: AdapterRegistry,
    oldAdapterId: string,
    newDescriptor: AdapterDescriptor
): SupersedeAdapterResult {
    if (!isAdapterRegistry(registry)) {
        return { outcome: 'invalid-registry', registry };
    }
    if (typeof oldAdapterId !== 'string' || oldAdapterId.length === 0) {
        return { outcome: 'invalid-adapter-id', registry };
    }
    if (!isAdapterDescriptor(newDescriptor)) {
        return { outcome: 'invalid-descriptor', registry };
    }
    if (newDescriptor.contractVersion !== registry.contractVersion) {
        return {
            outcome: 'version-mismatch',
            registry,
            expected: registry.contractVersion,
            found: newDescriptor.contractVersion
        };
    }
    if (!sourceScopesEqual(registry.scope, newDescriptor.scope)) {
        return { outcome: 'scope-mismatch', registry };
    }
    const oldRegistration = findRegistration(registry, oldAdapterId);
    if (oldRegistration === undefined) {
        return { outcome: 'unknown-adapter', registry };
    }
    if (oldRegistration.state !== 'active') {
        return { outcome: 'not-active', registry, state: oldRegistration.state };
    }
    if (findRegistration(registry, newDescriptor.adapterId) !== undefined) {
        return { outcome: 'already-registered', registry };
    }
    if (newDescriptor.sourceKind !== oldRegistration.descriptor.sourceKind) {
        return {
            outcome: 'kind-mismatch',
            registry,
            expected: oldRegistration.descriptor.sourceKind,
            found: newDescriptor.sourceKind
        };
    }
    const otherActive = findActiveForKind(registry, newDescriptor.sourceKind);
    if (otherActive !== undefined && otherActive.descriptor.adapterId !== oldAdapterId) {
        return {
            outcome: 'kind-occupied',
            registry,
            activeAdapterId: otherActive.descriptor.adapterId
        };
    }
    const retired: AdapterRegistration = {
        scope: oldRegistration.scope,
        contractVersion: oldRegistration.contractVersion,
        descriptor: oldRegistration.descriptor,
        state: 'retired'
    };
    const activated: AdapterRegistration = {
        scope: registry.scope,
        contractVersion: registry.contractVersion,
        descriptor: newDescriptor,
        state: 'active'
    };
    return {
        outcome: 'superseded',
        registry: {
            scope: registry.scope,
            contractVersion: registry.contractVersion,
            registrations: registry.registrations
                .map((registration) =>
                    registration.descriptor.adapterId === oldAdapterId ? retired : registration
                )
                .concat([activated])
        },
        retired,
        activated
    };
}

export type AdapterResolution =
    | { outcome: 'resolved'; descriptor: AdapterDescriptor }
    | { outcome: 'no-adapter'; sourceKind: SourceKind }
    | { outcome: 'ambiguous'; sourceKind: SourceKind; activeCount: number }
    | { outcome: 'invalid-registry'; sourceKind: SourceKind };

// adapterFor: pure resolution of the active adapter for a kind. A kind
// without an active adapter is the typed no-adapter disclosure, never a
// silent skip. 'ambiguous' is the defensive disclosure for a registry that
// violates the exactly-one-active-per-kind invariant (guarded registries
// can never produce it).
export function adapterFor(
    registry: AdapterRegistry,
    sourceKind: SourceKind
): AdapterResolution {
    if (!isAdapterRegistry(registry)) {
        return { outcome: 'invalid-registry', sourceKind };
    }
    const active = registry.registrations.filter(
        (registration) =>
            registration.state === 'active' &&
            registration.descriptor.sourceKind === sourceKind
    );
    if (active.length === 0) {
        return { outcome: 'no-adapter', sourceKind };
    }
    if (active.length > 1) {
        return { outcome: 'ambiguous', sourceKind, activeCount: active.length };
    }
    return { outcome: 'resolved', descriptor: active[0].descriptor };
}

// A plain field/value filter token. The contract transports filters; it never
// interprets them (adapters are replaceable, interpretation is runtime and
// out of scope by law).
export interface DiscoveryQueryFilter {
    field: string;
    value: string;
}

export function isDiscoveryQueryFilter(value: unknown): value is DiscoveryQueryFilter {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    return typeof candidate.field === 'string' && typeof candidate.value === 'string';
}

// The discovery request: the source descriptor snapshot plus query filters.
export interface DiscoveryRequest {
    scope: SourceScope;
    contractVersion: string;
    source: SourceDescriptor;
    queryFilters: readonly DiscoveryQueryFilter[];
}

export function isDiscoveryRequest(value: unknown): value is DiscoveryRequest {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    return (
        isSourceScope(candidate.scope) &&
        typeof candidate.contractVersion === 'string' &&
        isSourceDescriptor(candidate.source) &&
        Array.isArray(candidate.queryFilters) &&
        (candidate.queryFilters as unknown[]).every((entry) => isDiscoveryQueryFilter(entry))
    );
}

// A discovered artifact: a source-native claim projected into Flauz-shaped
// fields. declaredPermissions use the frozen permission-table vocabulary (the
// typed view); runtime admission (common/import.ts canImport) is the
// fail-closed gate that re-checks the table on untrusted data.
export interface DiscoveredArtifact {
    scope: SourceScope;
    contractVersion: string;
    artifactId: string;
    sourceDescriptorRef: string;
    artifactDigest: string;
    licenseSpdxId: string;
    declaredPermissions: readonly CapabilityPermission[];
    declaredEndpoints: readonly string[];
    rawMetadataDigest: string;
}

export function isDiscoveredArtifact(value: unknown): value is DiscoveredArtifact {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    return (
        isSourceScope(candidate.scope) &&
        typeof candidate.contractVersion === 'string' &&
        typeof candidate.artifactId === 'string' &&
        candidate.artifactId.length > 0 &&
        typeof candidate.sourceDescriptorRef === 'string' &&
        typeof candidate.artifactDigest === 'string' &&
        typeof candidate.licenseSpdxId === 'string' &&
        typeof candidate.rawMetadataDigest === 'string' &&
        Array.isArray(candidate.declaredPermissions) &&
        (candidate.declaredPermissions as unknown[]).every((permission) =>
            isCapabilityPermission(permission)
        ) &&
        Array.isArray(candidate.declaredEndpoints) &&
        (candidate.declaredEndpoints as unknown[]).every(
            (endpoint) => typeof endpoint === 'string'
        )
    );
}

export interface DiscoveryResult {
    scope: SourceScope;
    contractVersion: string;
    artifacts: readonly DiscoveredArtifact[];
}

export function isDiscoveryResult(value: unknown): value is DiscoveryResult {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    return (
        isSourceScope(candidate.scope) &&
        typeof candidate.contractVersion === 'string' &&
        Array.isArray(candidate.artifacts) &&
        (candidate.artifacts as unknown[]).every((entry) => isDiscoveredArtifact(entry))
    );
}

// The fetch request: artifact-by-digest.
export interface FetchRequest {
    scope: SourceScope;
    contractVersion: string;
    sourceDescriptorRef: string;
    artifactId: string;
    artifactDigest: string;
}

export function isFetchRequest(value: unknown): value is FetchRequest {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    return (
        isSourceScope(candidate.scope) &&
        typeof candidate.contractVersion === 'string' &&
        typeof candidate.sourceDescriptorRef === 'string' &&
        typeof candidate.artifactId === 'string' &&
        candidate.artifactId.length > 0 &&
        typeof candidate.artifactDigest === 'string'
    );
}

// FETCH CONTRACT LAW: FetchResult is the CONTRACT about the fetched bytes
// (their digest and byte size). It NEVER carries the bytes themselves; there
// is deliberately no payload field. Flauz verifies bytes against
// artifactDigest through its own receipt path (ZC-006).
export interface FetchResult {
    scope: SourceScope;
    contractVersion: string;
    sourceDescriptorRef: string;
    artifactId: string;
    artifactDigest: string;
    byteSize: number;
}

export function isFetchResult(value: unknown): value is FetchResult {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    return (
        isSourceScope(candidate.scope) &&
        typeof candidate.contractVersion === 'string' &&
        typeof candidate.sourceDescriptorRef === 'string' &&
        typeof candidate.artifactId === 'string' &&
        candidate.artifactId.length > 0 &&
        typeof candidate.artifactDigest === 'string' &&
        typeof candidate.byteSize === 'number' &&
        Number.isInteger(candidate.byteSize) &&
        candidate.byteSize >= 0
    );
}

// The normalize request: references the fetched artifact by digest plus the
// digest of its source-native form.
export interface NormalizeRequest {
    scope: SourceScope;
    contractVersion: string;
    sourceDescriptorRef: string;
    artifactId: string;
    artifactDigest: string;
    sourceNativeDigest: string;
}

export function isNormalizeRequest(value: unknown): value is NormalizeRequest {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    return (
        isSourceScope(candidate.scope) &&
        typeof candidate.contractVersion === 'string' &&
        typeof candidate.sourceDescriptorRef === 'string' &&
        typeof candidate.artifactId === 'string' &&
        candidate.artifactId.length > 0 &&
        typeof candidate.artifactDigest === 'string' &&
        typeof candidate.sourceNativeDigest === 'string'
    );
}

// NormalizeResult: the Flauz-owned projection of one source-native artifact,
// the fields an ImportedEntry is built from. The projection is a CONTRACT
// here; executing it is runtime adapter work, out of scope by law.
export interface NormalizeResult {
    scope: SourceScope;
    contractVersion: string;
    artifactId: string;
    artifactDigest: string;
    licenseSpdxId: string;
    licenseDigest: string;
    declaredPermissions: readonly CapabilityPermission[];
    declaredEndpoints: readonly string[];
    rawMetadataDigest: string;
}

export function isNormalizeResult(value: unknown): value is NormalizeResult {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    return (
        isSourceScope(candidate.scope) &&
        typeof candidate.contractVersion === 'string' &&
        typeof candidate.artifactId === 'string' &&
        candidate.artifactId.length > 0 &&
        typeof candidate.artifactDigest === 'string' &&
        typeof candidate.licenseSpdxId === 'string' &&
        typeof candidate.licenseDigest === 'string' &&
        typeof candidate.rawMetadataDigest === 'string' &&
        Array.isArray(candidate.declaredPermissions) &&
        (candidate.declaredPermissions as unknown[]).every((permission) =>
            isCapabilityPermission(permission)
        ) &&
        Array.isArray(candidate.declaredEndpoints) &&
        (candidate.declaredEndpoints as unknown[]).every(
            (endpoint) => typeof endpoint === 'string'
        )
    );
}

// The adapter interface SHAPE - a type only, never implemented in this wave.
// A concrete adapter is a replaceable import-source plugin satisfying this
// shape. Execution (network calls, discovery probing, byte fetching) is out
// of scope by law; Flauz remains the verification and execution authority.
export interface CapabilitySourceAdapter {
    descriptor: AdapterDescriptor;
    discover(request: DiscoveryRequest): Promise<DiscoveryResult>;
    fetch(request: FetchRequest): Promise<FetchResult>;
    normalize(request: NormalizeRequest): Promise<NormalizeResult>;
}

export function isCapabilitySourceAdapter(value: unknown): value is CapabilitySourceAdapter {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    return (
        isAdapterDescriptor(candidate.descriptor) &&
        typeof candidate.discover === 'function' &&
        typeof candidate.fetch === 'function' &&
        typeof candidate.normalize === 'function'
    );
}

function findRegistration(
    registry: AdapterRegistry,
    adapterId: string
): AdapterRegistration | undefined {
    return registry.registrations.find(
        (registration) => registration.descriptor.adapterId === adapterId
    );
}

function findActiveForKind(
    registry: AdapterRegistry,
    sourceKind: SourceKind
): AdapterRegistration | undefined {
    return registry.registrations.find(
        (registration) =>
            registration.state === 'active' &&
            registration.descriptor.sourceKind === sourceKind
    );
}
