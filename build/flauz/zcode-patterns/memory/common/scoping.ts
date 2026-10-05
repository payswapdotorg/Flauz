/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * Flauz ZC-005 - Scoped Persistent Agent Memory contracts (Phase C): scoping.
 *
 * Part of the SCOPED_MEMORY_CONTRACTS_VERSION '1.0.0' contract set: the three frozen memory
 * levels, the record scope every persisted memory record carries, the pure scope-address
 * resolution law, and the read-visibility lattice.
 *
 * SUBORDINATION LAW: memory is subordinate to Workspace OS and tenant policy. Everything here
 * is a REQUEST/READ-MODEL shape or a pure law projected over the existing workspace isolation
 * boundaries (extensions/flauz-isolation) and the flauz-agent task/evidence vocabulary
 * (extensions/flauz-agent/src/types.ts). No memory store, persistence engine, retrieval
 * index, or embedding surface exists in this set: types, constants, pure guards, and pure
 * transitions only.
 *
 * ZERO-IMPORT LAW: this module imports nothing (exactly like build/flauz/lab/common/
 * labContracts.ts). Foundations shared with the sibling modules of this set are restated
 * locally; structural typing keeps the restatements interchangeable. See memory/README.md.
 *
 * DETERMINISM LAW: Math.random, Date.now, and new Date(...) are forbidden in this module; every timestamp
 * is a plain ISO-8601 UTC string supplied by the caller, and every exported function is a
 * pure mapping over its inputs.
 */

export const SCOPED_MEMORY_CONTRACTS_VERSION = '1.0.0';

/** The three frozen memory levels (as const; the union is derived, never hand-written). */
export const MEMORY_LEVELS = ['user', 'project', 'workspace'] as const;
export type MemoryLevel = (typeof MEMORY_LEVELS)[number];

/** Pure guard: exactly the three frozen levels. */
export function isMemoryLevel(value: unknown): value is MemoryLevel {
    return typeof value === 'string' && (MEMORY_LEVELS as readonly string[]).includes(value);
}

/**
 * The tenant/workspace anchor every persisted memory record carries. This projects the
 * workspace isolation boundaries (extensions/flauz-isolation): memory is workspace-local to
 * exactly the tenant and workspace this scope names.
 */
export interface MemoryRecordScope {
    readonly tenantId: string;
    readonly workspaceId: string;
}

export function isMemoryRecordScope(value: unknown): value is MemoryRecordScope {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as { tenantId?: unknown; workspaceId?: unknown };
    return (
        typeof candidate.tenantId === 'string' &&
        candidate.tenantId.length > 0 &&
        typeof candidate.workspaceId === 'string' &&
        candidate.workspaceId.length > 0
    );
}

/** Pure structural equality over record scopes. */
export function recordScopesEqual(left: MemoryRecordScope, right: MemoryRecordScope): boolean {
    return left.tenantId === right.tenantId && left.workspaceId === right.workspaceId;
}

/**
 * The resolved memory scope address: the record scope plus the memory level and, at the
 * project level, the project anchor. This is the minimal persisted record of the set:
 * scope + contractVersion + level (plus the level-dependent projectRef).
 */
export interface MemoryScopeAddress {
    readonly scope: MemoryRecordScope;
    readonly contractVersion: string;
    readonly level: MemoryLevel;
    readonly projectRef: string | undefined;
}

export function isMemoryScopeAddress(value: unknown): value is MemoryScopeAddress {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as { scope?: unknown; contractVersion?: unknown; level?: unknown; projectRef?: unknown };
    if (!isMemoryRecordScope(candidate.scope)) {
        return false;
    }
    if (candidate.contractVersion !== SCOPED_MEMORY_CONTRACTS_VERSION) {
        return false;
    }
    if (!isMemoryLevel(candidate.level)) {
        return false;
    }
    if (candidate.level === 'project') {
        return typeof candidate.projectRef === 'string' && candidate.projectRef.length > 0;
    }
    return candidate.projectRef === undefined;
}

/** The context a memory request arises from. The vocabulary is the three frozen levels. */
export const MEMORY_QUERY_CONTEXTS = ['user', 'project', 'workspace'] as const;
export type MemoryQueryContext = (typeof MEMORY_QUERY_CONTEXTS)[number];

export function isMemoryQueryContext(value: unknown): value is MemoryQueryContext {
    return typeof value === 'string' && (MEMORY_QUERY_CONTEXTS as readonly string[]).includes(value);
}

/**
 * A memory scope query: the record scope, the requesting context, and - only for the project
 * context - the project anchor. A project-context query may carry an undefined projectRef at
 * the shape level; the resolution law then refuses it typedly instead of guessing.
 */
export interface MemoryScopeQuery {
    readonly scope: MemoryRecordScope;
    readonly context: MemoryQueryContext;
    readonly projectRef: string | undefined;
}

export function isMemoryScopeQuery(value: unknown): value is MemoryScopeQuery {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as { scope?: unknown; context?: unknown; projectRef?: unknown };
    if (!isMemoryRecordScope(candidate.scope)) {
        return false;
    }
    if (!isMemoryQueryContext(candidate.context)) {
        return false;
    }
    if (candidate.context === 'project') {
        return candidate.projectRef === undefined || typeof candidate.projectRef === 'string';
    }
    return candidate.projectRef === undefined;
}

/** Typed resolution outcomes: exactly one address, or a typed refusal. Never an exception. */
export type ScopeResolution =
    | { readonly kind: 'resolved'; readonly address: MemoryScopeAddress }
    | { readonly kind: 'refusal'; readonly reason: 'invalid-query' }
    | { readonly kind: 'refusal'; readonly reason: 'project-ref-required'; readonly context: MemoryQueryContext }
    | { readonly kind: 'refusal'; readonly reason: 'no-address-at-level'; readonly context: MemoryQueryContext; readonly level: MemoryLevel };

/**
 * RESOLUTION LAW (pure, total over the three levels):
 * 1. Addresses that fail isMemoryScopeAddress are ignored, never selected.
 * 2. Only addresses whose record scope equals the query scope are candidates.
 * 3. A query resolves to exactly ONE address: the candidate at the query context's own level.
 *    Workspace-level wins for workspace-context queries even when user and project candidates
 *    exist; a project-context query requires a matching projectRef. When several candidates
 *    match, the first in the given order wins (the caller owns address ordering).
 * 4. A missing address is a typed refusal - never a silent empty result, never an exception.
 */
export function resolveScope(query: MemoryScopeQuery, addresses: readonly MemoryScopeAddress[]): ScopeResolution {
    if (!isMemoryScopeQuery(query)) {
        return { kind: 'refusal', reason: 'invalid-query' };
    }
    const candidates = addresses
        .filter((address): address is MemoryScopeAddress => isMemoryScopeAddress(address))
        .filter((address) => recordScopesEqual(address.scope, query.scope));
    if (query.context === 'project') {
        if (typeof query.projectRef !== 'string' || query.projectRef.length === 0) {
            return { kind: 'refusal', reason: 'project-ref-required', context: query.context };
        }
        const projectAddress = candidates.find(
            (address) => address.level === 'project' && address.projectRef === query.projectRef
        );
        if (projectAddress === undefined) {
            return { kind: 'refusal', reason: 'no-address-at-level', context: query.context, level: 'project' };
        }
        return { kind: 'resolved', address: projectAddress };
    }
    const targetLevel: MemoryLevel = query.context;
    const address = candidates.find((candidate) => candidate.level === targetLevel);
    if (address === undefined) {
        return { kind: 'refusal', reason: 'no-address-at-level', context: query.context, level: targetLevel };
    }
    return { kind: 'resolved', address };
}

/** One row of the read lattice: what a reader at `level` may read. */
export interface ScopeVisibility {
    readonly level: MemoryLevel;
    readonly mayRead: readonly MemoryLevel[];
}

/**
 * The read lattice as a pure table: user sees user; project sees user+project; workspace
 * sees user+project+workspace. Reading never widens upward: a user-level reader can never
 * read project or workspace memory.
 */
export const SCOPE_VISIBILITY_LATTICE: readonly ScopeVisibility[] = [
    { level: 'user', mayRead: ['user'] },
    { level: 'project', mayRead: ['user', 'project'] },
    { level: 'workspace', mayRead: ['user', 'project', 'workspace'] }
];

/** The levels a reader at `level` may read. An unknown level reads nothing (fail-closed). */
export function visibleLevels(level: MemoryLevel): readonly MemoryLevel[] {
    const row = SCOPE_VISIBILITY_LATTICE.find((visibility) => visibility.level === level);
    return row === undefined ? [] : row.mayRead;
}

/** Pure lattice guard: may a reader at `reader` read memory anchored at `target`? */
export function mayRead(reader: MemoryLevel, target: MemoryLevel): boolean {
    return visibleLevels(reader).includes(target);
}
