/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * Flauz ZC-005 - Scoped Persistent Agent Memory contracts (Phase C): explicit enablement.
 *
 * Part of the SCOPED_MEMORY_CONTRACTS_VERSION '1.0.0' contract set: the DEFAULT-OFF law.
 * Every memory level is disabled unless explicitly enabled; a memory request against a
 * disabled level is a typed refusal carrying the level and the enablement state - never a
 * silent empty result, never an exception.
 *
 * SUBORDINATION LAW: memory is subordinate to Workspace OS and tenant policy. An enablement
 * record is a REQUEST/READ-MODEL the tenant may always tighten from above; nothing here can
 * loosen a tenant policy. No store, no engine, no index: records, pure guards, and pure
 * record-to-record transitions only.
 *
 * ZERO-IMPORT LAW: this module imports nothing (exactly like build/flauz/lab/common/
 * labContracts.ts). Shared foundations are restated locally; structural typing keeps the
 * restatements interchangeable with the sibling modules. See memory/README.md.
 *
 * DETERMINISM LAW: Math.random, Date.now, and new Date(...) are forbidden in this module; every timestamp
 * is a plain ISO-8601 UTC string supplied by the caller, and every exported function is a
 * pure mapping over its inputs.
 */

export const SCOPED_MEMORY_CONTRACTS_VERSION = '1.0.0';

/** The three frozen memory levels (as const; the union is derived, never hand-written). */
export const MEMORY_LEVELS = ['user', 'project', 'workspace'] as const;
export type MemoryLevel = (typeof MEMORY_LEVELS)[number];

export function isMemoryLevel(value: unknown): value is MemoryLevel {
    return typeof value === 'string' && (MEMORY_LEVELS as readonly string[]).includes(value);
}

/** The tenant/workspace anchor every persisted memory record carries. */
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

const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/**
 * The timestamp law of this contract set: plain ISO-8601 UTC strings with a Z suffix
 * (optional 1-3 digit millisecond part). No other timestamp shape is representable.
 */
export function isIsoTimestamp(value: unknown): value is string {
    return typeof value === 'string' && ISO_TIMESTAMP_PATTERN.test(value);
}

/**
 * DEFAULT-OFF LAW: every memory level is disabled unless explicitly enabled. enabledLevels is
 * stored in canonical MEMORY_LEVELS order by the transitions below and is empty unless a
 * level was explicitly turned on. The record is subordinate to tenant policy: it can only
 * ever be tightened from above, never loosened from here.
 */
export interface MemoryEnablement {
    readonly scope: MemoryRecordScope;
    readonly contractVersion: string;
    readonly enabledLevels: readonly MemoryLevel[];
    readonly updatedAtIso: string;
}

export function isMemoryEnablement(value: unknown): value is MemoryEnablement {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as { scope?: unknown; contractVersion?: unknown; enabledLevels?: unknown; updatedAtIso?: unknown };
    if (!isMemoryRecordScope(candidate.scope)) {
        return false;
    }
    if (candidate.contractVersion !== SCOPED_MEMORY_CONTRACTS_VERSION) {
        return false;
    }
    if (!Array.isArray(candidate.enabledLevels)) {
        return false;
    }
    const seen: string[] = [];
    for (const level of candidate.enabledLevels) {
        if (!isMemoryLevel(level) || seen.includes(level)) {
            return false;
        }
        seen.push(level);
    }
    return isIsoTimestamp(candidate.updatedAtIso);
}

/** The all-off record: the default state of memory enablement (DEFAULT-OFF LAW). */
export function defaultEnablement(scope: MemoryRecordScope, createdAtIso: string): MemoryEnablement {
    return {
        scope,
        contractVersion: SCOPED_MEMORY_CONTRACTS_VERSION,
        enabledLevels: [],
        updatedAtIso: createdAtIso
    };
}

/** One typed audit-trail entry: a single enablement state change attempt. */
export interface EnablementChange {
    readonly scope: MemoryRecordScope;
    readonly contractVersion: string;
    readonly level: MemoryLevel;
    readonly from: boolean;
    readonly to: boolean;
    readonly changedAtIso: string;
}

export interface EnablementTransition {
    readonly enablement: MemoryEnablement;
    readonly change: EnablementChange;
}

function canonicalLevels(levels: readonly MemoryLevel[]): readonly MemoryLevel[] {
    return MEMORY_LEVELS.filter((level) => levels.includes(level));
}

/**
 * Pure record-to-record transition: enable a level. A real change returns a fresh record with
 * the level added in canonical order and updatedAtIso = changedAtIso; a no-op (level already
 * enabled) returns the input record unchanged and records from === to in the audit trail.
 * Transitions never mutate their input.
 */
export function enableLevel(enablement: MemoryEnablement, level: MemoryLevel, changedAtIso: string): EnablementTransition {
    const from = enablement.enabledLevels.includes(level);
    const to = true;
    const nextEnablement: MemoryEnablement = from
        ? enablement
        : {
                scope: enablement.scope,
                contractVersion: SCOPED_MEMORY_CONTRACTS_VERSION,
                enabledLevels: canonicalLevels([...enablement.enabledLevels, level]),
                updatedAtIso: changedAtIso
            };
    return {
        enablement: nextEnablement,
        change: {
            scope: enablement.scope,
            contractVersion: SCOPED_MEMORY_CONTRACTS_VERSION,
            level,
            from,
            to,
            changedAtIso
        }
    };
}

/** Pure record-to-record transition: disable a level (same laws as enableLevel). */
export function disableLevel(enablement: MemoryEnablement, level: MemoryLevel, changedAtIso: string): EnablementTransition {
    const from = enablement.enabledLevels.includes(level);
    const to = false;
    const nextEnablement: MemoryEnablement = from
        ? {
                scope: enablement.scope,
                contractVersion: SCOPED_MEMORY_CONTRACTS_VERSION,
                enabledLevels: enablement.enabledLevels.filter((enabled) => enabled !== level),
                updatedAtIso: changedAtIso
            }
        : enablement;
    return {
        enablement: nextEnablement,
        change: {
            scope: enablement.scope,
            contractVersion: SCOPED_MEMORY_CONTRACTS_VERSION,
            level,
            from,
            to,
            changedAtIso
        }
    };
}

/** Pure guard: is this level explicitly enabled in this enablement record? */
export function canUseMemory(level: MemoryLevel, enablement: MemoryEnablement): boolean {
    return enablement.enabledLevels.includes(level);
}

/** Typed authorization for a memory request. Disabled levels are typed refusals, never silent. */
export type MemoryUseRequestResult =
    | { readonly kind: 'authorized'; readonly level: MemoryLevel; readonly enablement: MemoryEnablement }
    | { readonly kind: 'refusal'; readonly reason: 'level-not-enabled'; readonly level: MemoryLevel; readonly enablement: MemoryEnablement };

export function requestMemoryUse(level: MemoryLevel, enablement: MemoryEnablement): MemoryUseRequestResult {
    if (canUseMemory(level, enablement)) {
        return { kind: 'authorized', level, enablement };
    }
    return { kind: 'refusal', reason: 'level-not-enabled', level, enablement };
}
