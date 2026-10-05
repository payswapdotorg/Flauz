/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * ZC-001 family 5: Persistent agent memory projection contracts. Versioned data
 * contracts, constants, and pure guards for scoped persistent agent memory.
 * Zero-dependency by law: this module imports nothing.
 *
 * DETERMINISM LAW: no `Math.random`, no `Date.now`, no `new Date()` inside this module.
 * Timestamps are plain ISO strings set only at persistence edges.
 *
 * SCOPING LAW: every persisted record carries `scope: ZcodeScope` and
 * `contractVersion: string`.
 *
 * PROJECTION LAW (subordination law): this module is a READ-MODEL over the existing
 * memory authority (extensions/flauz-memory MemoryStore), never a new authority. The
 * projection carries enablement/retention/provenance/secret-exclusion fields ONLY:
 * no storage, no content, no retrieval logic. Memory stays subordinate to Workspace
 * OS and tenant policy. The source-kind vocabulary is closed here (the projection's
 * own vocabulary) because the zero-import law plus the station's scoped gate posture
 * make cross-extension pins impossible, and an unpinned duplicate of the authority's
 * MEMORY_ORIGINS would drift silently.
 *
 * FAIL-CLOSED TYPING: `enablementRequired` is the literal `true` (the only
 * representable value: memory persistence requires explicit enablement) and
 * `secretExclusion` is the literal `'enforced'` (the only legal value: secrets are
 * never persisted). The exported guards re-check both laws at boundaries.
 */

/**
 * Version of the ZC-001 pattern contract set; a record is current only when its
 * `contractVersion` matches exactly. Re-declared in every zcode-patterns contract
 * module because the zero-import law forbids a shared base module; tests pin all
 * declarations to this exact value.
 */
export const ZCODE_PATTERNS_CONTRACTS_VERSION = '1.0.0';

/**
 * Workspace/tenant scoping tuple attached to every persisted zcode-patterns record.
 */
export interface ZcodeScope {
	workspaceId: string;
	tenantId: string;
}

/**
 * The memory scope levels of the projection: user (tenant-scoped, crosses
 * workspaces), project (workspace-bound), workspace-local (the most restricted).
 */
export const MEMORY_SCOPE_LEVELS = ['user', 'project', 'workspace-local'] as const;
export type MemoryScopeLevel = (typeof MEMORY_SCOPE_LEVELS)[number];

/**
 * The closed set of source kinds a memory entry may be derived from.
 */
export const MEMORY_ENTRY_SOURCE_KINDS = [
	'user-note',
	'agent-observation',
	'task-outcome',
	'workflow-summary',
	'context-compilation',
] as const;
export type MemoryEntrySourceKind = (typeof MEMORY_ENTRY_SOURCE_KINDS)[number];

/**
 * Provenance of one memory entry: the source kind plus the ISO stamp of when the
 * source was retrieved. No fabricated memory: an entry exists only when a real
 * source produced it.
 */
export interface MemoryEntryProvenance {
	readonly sourceKind: MemoryEntrySourceKind;
	readonly retrievedAtIso: string;
}

/**
 * The only legal secret-exclusion value.
 */
export const MEMORY_SECRET_EXCLUSION = 'enforced' as const;

/**
 * Read-model of one persistent memory entry. `enablementRequired: true` and
 * `secretExclusion: 'enforced'` are literal types: the illegal values are
 * unrepresentable. The record carries policy fields ONLY (enablement, retention,
 * provenance, secret exclusion) plus identity: no storage, no content, no tags,
 * no retrieval state.
 */
export interface MemoryEntryRecord {
	scope: ZcodeScope;
	contractVersion: string;
	entryId: string;
	level: MemoryScopeLevel;
	enablementRequired: true;
	retentionDays: number;
	provenance: MemoryEntryProvenance;
	secretExclusion: 'enforced';
}

/**
 * Guard (fail-closed): true iff the entry is exportable. Requires the current
 * contract version, a legal scope level, a legal source kind, a non-empty
 * retrieval stamp, a positive integer retention window, the enforced
 * secret-exclusion value, and the enablement marker. Anything else is refused.
 */
export function isExportableMemoryEntry(entry: MemoryEntryRecord): boolean {
	if (entry.contractVersion !== ZCODE_PATTERNS_CONTRACTS_VERSION) {
		return false;
	}
	if (typeof entry.level !== 'string' || !(MEMORY_SCOPE_LEVELS as readonly string[]).includes(entry.level)) {
		return false;
	}
	if (typeof entry.enablementRequired !== 'boolean' || entry.enablementRequired !== true) {
		return false;
	}
	if (typeof entry.retentionDays !== 'number' || !Number.isInteger(entry.retentionDays) || entry.retentionDays <= 0) {
		return false;
	}
	if (typeof entry.provenance !== 'object' || entry.provenance === null || Array.isArray(entry.provenance)) {
		return false;
	}
	if (typeof entry.provenance.sourceKind !== 'string' || !(MEMORY_ENTRY_SOURCE_KINDS as readonly string[]).includes(entry.provenance.sourceKind)) {
		return false;
	}
	if (typeof entry.provenance.retrievedAtIso !== 'string' || entry.provenance.retrievedAtIso === '') {
		return false;
	}
	return entry.secretExclusion === MEMORY_SECRET_EXCLUSION;
}

/**
 * Guard (fail-closed): reports whether persistence is allowed for one memory scope
 * level under the given scope ids. Tenant policy always governs: an empty tenantId
 * forbids persistence at every level. The `user` level is tenant-scoped, not
 * workspace-bound (its records may carry an empty workspaceId as the creation
 * scope); `project` and `workspace-local` are workspace-bound and require a
 * non-empty workspaceId. Memory stays subordinate to Workspace OS and tenant policy.
 */
export function memoryScopeAllowsPersistence(level: MemoryScopeLevel, workspaceId: string, tenantId: string): boolean {
	if (tenantId === '') {
		return false;
	}
	if (level === 'user') {
		return true;
	}
	return workspaceId !== '';
}

/**
 * Guard: true iff the record pins the exact current ZCODE_PATTERNS_CONTRACTS_VERSION.
 */
export function isVersionedMemoryEntryRecord(record: { contractVersion?: string }): boolean {
	return record.contractVersion === ZCODE_PATTERNS_CONTRACTS_VERSION;
}
