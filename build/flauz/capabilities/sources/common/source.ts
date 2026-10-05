/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

// ---------------------------------------------------------------------------
// ZC-007 - external capability-source adapter contracts (Phase C, TL-B lane).
// Module 1 of 3: source descriptors and the source registry.
// Contract set version: SOURCE_ADAPTERS_CONTRACTS_VERSION 1.0.0.
// ---------------------------------------------------------------------------
//
// DETERMINISM LAW: no Math.random, no Date.now, no new Date(...) may be used
// in this module. All timestamps are plain ISO-8601 strings supplied by
// callers. This module contains pure types, constants and functions only.
//
// ZERO-DEPENDENCY LAW: this contract module contains no import statements,
// mirroring build/flauz/lab/common/labContracts.ts. Shapes shared with the
// sibling modules common/adapter.ts and common/import.ts are duplicated
// verbatim there; the test suites cross-pin the copies so drift fails.
//
// IMPORT-SOURCE LAW (docs/FLAUZ-PROGRAM/ARCHITECTURE-LOCK.md section 11):
// external sources such as Printing Press / Printing Press Library, Composio,
// MCP/skill catalogues and user-supplied API/site/community definitions are
// REPLACEABLE IMPORT SOURCES ONLY. A source provides discoverable artifacts;
// it never verifies, executes or ranks anything. Flauz remains the
// verification and execution authority.
//
// PROJECTION LAW: SourceDescriptor.healthState is a carried projection
// reported elsewhere. This contract never probes, pings or measures a source;
// runtime discovery and health probing are out of scope for this wave by law.
//
// RECORD LAW: every persisted record in this contract set carries
// scope: SourceScope and contractVersion: string, and every timestamp is a
// plain-string ISO-8601 value.

export const SOURCE_ADAPTERS_CONTRACTS_VERSION = '1.0.0';

// The scope carried by every persisted record in this contract set. Projects
// the stable cross-TL scope discipline (ARCHITECTURE-LOCK section 5).
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

// Plain-string ISO-8601 timestamp shape: YYYY-MM-DDTHH:mm:ss with optional
// fractional seconds and a UTC 'Z' or numeric +/-HH:MM offset. This is a
// shape check, not a calendar validation.
export const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function isIsoTimestamp(value: unknown): value is string {
    return typeof value === 'string' && ISO_TIMESTAMP_PATTERN.test(value);
}

// The frozen source-kind vocabulary (ZC-007). The list is the authority and
// the union is derived from it; tests pin the list verbatim.
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

// healthState is a PROJECTION (reported elsewhere), never probed here.
export const SOURCE_HEALTH_STATES = ['unknown', 'reachable', 'unreachable'] as const;

export type SourceHealthState = (typeof SOURCE_HEALTH_STATES)[number];

export function isSourceHealthState(value: unknown): value is SourceHealthState {
    return (
        typeof value === 'string' &&
        (SOURCE_HEALTH_STATES as readonly string[]).includes(value)
    );
}

// A discovered external source. endpointRef is a plain string (URL, handle
// or path); this contract never dereferences it.
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

// Typed retire reasons: retireSource requires one of these.
export const SOURCE_RETIRE_REASONS = [
    'operator-decision',
    'persistently-unreachable',
    'upstream-deprecated',
    'superseded',
    'policy'
] as const;

export type SourceRetireReason = (typeof SOURCE_RETIRE_REASONS)[number];

export function isSourceRetireReason(value: unknown): value is SourceRetireReason {
    return (
        typeof value === 'string' &&
        (SOURCE_RETIRE_REASONS as readonly string[]).includes(value)
    );
}

export const SOURCE_REGISTRY_REVISION_KINDS = ['register', 'retire'] as const;

export type SourceRegistryRevisionKind = (typeof SOURCE_REGISTRY_REVISION_KINDS)[number];

export interface SourceRegisterRevision {
    scope: SourceScope;
    contractVersion: string;
    revisionId: string;
    sourceId: string;
    kind: 'register';
    atIso: string;
}

export interface SourceRetireRevision {
    scope: SourceScope;
    contractVersion: string;
    revisionId: string;
    sourceId: string;
    kind: 'retire';
    atIso: string;
    reason: SourceRetireReason;
}

export type SourceRegistryRevision = SourceRegisterRevision | SourceRetireRevision;

export function isSourceRegistryRevision(value: unknown): value is SourceRegistryRevision {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    if (
        !isSourceScope(candidate.scope) ||
        typeof candidate.contractVersion !== 'string' ||
        typeof candidate.revisionId !== 'string' ||
        typeof candidate.sourceId !== 'string' ||
        !isIsoTimestamp(candidate.atIso)
    ) {
        return false;
    }
    if (candidate.kind === 'register') {
        return true;
    }
    if (candidate.kind === 'retire') {
        return isSourceRetireReason(candidate.reason);
    }
    return false;
}

// The registered source set. 'sources' holds the LIVE descriptors only;
// 'revisions' is the append-only history. REVISION-APPEND LAW: transitions
// append revisions and never rewrite or drop prior entries.
export interface SourceRegistry {
    scope: SourceScope;
    contractVersion: string;
    sources: readonly SourceDescriptor[];
    revisions: readonly SourceRegistryRevision[];
}

export function isSourceRegistry(value: unknown): value is SourceRegistry {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    if (
        !isSourceScope(candidate.scope) ||
        typeof candidate.contractVersion !== 'string' ||
        !Array.isArray(candidate.sources) ||
        !Array.isArray(candidate.revisions)
    ) {
        return false;
    }
    return (
        (candidate.sources as unknown[]).every((entry) => isSourceDescriptor(entry)) &&
        (candidate.revisions as unknown[]).every((entry) => isSourceRegistryRevision(entry))
    );
}

export function createSourceRegistry(scope: SourceScope): SourceRegistry {
    return {
        scope,
        contractVersion: SOURCE_ADAPTERS_CONTRACTS_VERSION,
        sources: [],
        revisions: []
    };
}

export type RegisterSourceResult =
    | { outcome: 'registered'; registry: SourceRegistry; revision: SourceRegisterRevision }
    | { outcome: 'already-registered'; registry: SourceRegistry }
    | { outcome: 'invalid-registry'; registry: SourceRegistry }
    | { outcome: 'invalid-descriptor'; registry: SourceRegistry }
    | { outcome: 'invalid-timestamp'; registry: SourceRegistry }
    | { outcome: 'version-mismatch'; registry: SourceRegistry; expected: string; found: string }
    | { outcome: 'scope-mismatch'; registry: SourceRegistry };

// registerSource: idempotent-guarded (a live sourceId never registers twice)
// and revision-appending. The check order is fixed and part of the contract:
// invalid-registry, invalid-descriptor, invalid-timestamp, version-mismatch,
// scope-mismatch, already-registered, registered.
export function registerSource(
    registry: SourceRegistry,
    descriptor: SourceDescriptor,
    atIso: string
): RegisterSourceResult {
    if (!isSourceRegistry(registry)) {
        return { outcome: 'invalid-registry', registry };
    }
    if (!isSourceDescriptor(descriptor)) {
        return { outcome: 'invalid-descriptor', registry };
    }
    if (!isIsoTimestamp(atIso)) {
        return { outcome: 'invalid-timestamp', registry };
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
    if (registry.sources.some((existing) => existing.sourceId === descriptor.sourceId)) {
        return { outcome: 'already-registered', registry };
    }
    const revision: SourceRegisterRevision = {
        scope: registry.scope,
        contractVersion: registry.contractVersion,
        revisionId: nextRevisionId(registry),
        sourceId: descriptor.sourceId,
        kind: 'register',
        atIso
    };
    return {
        outcome: 'registered',
        registry: {
            scope: registry.scope,
            contractVersion: registry.contractVersion,
            sources: [...registry.sources, descriptor],
            revisions: [...registry.revisions, revision]
        },
        revision
    };
}

export type RetireSourceResult =
    | { outcome: 'retired'; registry: SourceRegistry; revision: SourceRetireRevision }
    | { outcome: 'unknown-source'; registry: SourceRegistry }
    | { outcome: 'already-retired'; registry: SourceRegistry }
    | { outcome: 'invalid-registry'; registry: SourceRegistry }
    | { outcome: 'invalid-source-id'; registry: SourceRegistry }
    | { outcome: 'invalid-reason'; registry: SourceRegistry }
    | { outcome: 'invalid-timestamp'; registry: SourceRegistry };

// retireSource: removes a live source from the registry and appends a retire
// revision carrying the typed reason. The check order is fixed:
// invalid-registry, invalid-source-id, invalid-reason, invalid-timestamp,
// then, for a non-live sourceId, already-retired when the history holds a
// prior retire revision for it, otherwise unknown-source, then retired. A
// retired sourceId may be re-registered later; the append-only revision log
// keeps every event.
export function retireSource(
    registry: SourceRegistry,
    sourceId: string,
    reason: SourceRetireReason,
    atIso: string
): RetireSourceResult {
    if (!isSourceRegistry(registry)) {
        return { outcome: 'invalid-registry', registry };
    }
    if (typeof sourceId !== 'string' || sourceId.length === 0) {
        return { outcome: 'invalid-source-id', registry };
    }
    if (!isSourceRetireReason(reason)) {
        return { outcome: 'invalid-reason', registry };
    }
    if (!isIsoTimestamp(atIso)) {
        return { outcome: 'invalid-timestamp', registry };
    }
    const isLive = registry.sources.some((existing) => existing.sourceId === sourceId);
    if (!isLive) {
        const previouslyRetired = registry.revisions.some(
            (revision) => revision.kind === 'retire' && revision.sourceId === sourceId
        );
        return previouslyRetired
            ? { outcome: 'already-retired', registry }
            : { outcome: 'unknown-source', registry };
    }
    const revision: SourceRetireRevision = {
        scope: registry.scope,
        contractVersion: registry.contractVersion,
        revisionId: nextRevisionId(registry),
        sourceId,
        kind: 'retire',
        atIso,
        reason
    };
    return {
        outcome: 'retired',
        registry: {
            scope: registry.scope,
            contractVersion: registry.contractVersion,
            sources: registry.sources.filter((existing) => existing.sourceId !== sourceId),
            revisions: [...registry.revisions, revision]
        },
        revision
    };
}

// sourcesForKind: pure query over the live source set.
export function sourcesForKind(
    registry: SourceRegistry,
    kind: SourceKind
): readonly SourceDescriptor[] {
    return registry.sources.filter((source) => source.kind === kind);
}

// revisionId is the 1-based position of the revision in the append-only log;
// uniqueness follows from the revision-append law (length only ever grows).
function nextRevisionId(registry: SourceRegistry): string {
    return 'rev-' + String(registry.revisions.length + 1);
}
