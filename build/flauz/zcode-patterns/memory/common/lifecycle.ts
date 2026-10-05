/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * Flauz ZC-005 - Scoped Persistent Agent Memory contracts (Phase C): retention, export, delete.
 *
 * Part of the SCOPED_MEMORY_CONTRACTS_VERSION '1.0.0' contract set: per-level retention with
 * an injected clock, the integrity-pinned ExportBundle (gated on explicit enablement), and
 * typed per-entry deletion evidence.
 *
 * SUBORDINATION LAW: memory is subordinate to Workspace OS and tenant policy. Retention is a
 * projection (the caller executes it); export and delete are REQUEST/READ-MODEL shapes the
 * tenant may always tighten from above. No store, no engine, no index: records, constants,
 * pure guards, and pure transitions only.
 *
 * ZERO-IMPORT LAW: this module imports nothing (exactly like build/flauz/lab/common/
 * labContracts.ts). The entry and enablement record shapes are restated here as structural
 * mirrors (MemoryEntryRecord, MemoryEnablementRecord); structural typing keeps records from
 * the sibling modules interchangeable with the mirrors - pinned by the cross-contract tests.
 * See memory/README.md.
 *
 * DETERMINISM LAW: Math.random, Date.now, and new Date(...) are forbidden in this module; every timestamp
 * is a plain ISO-8601 UTC string supplied by the caller, retention works on an injected clock
 * delta (days since the ISO epoch), and every exported function is a pure mapping over its
 * inputs.
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

/** The timestamp law of this contract set: plain ISO-8601 UTC strings with a Z suffix. */
export function isIsoTimestamp(value: unknown): value is string {
    return typeof value === 'string' && ISO_TIMESTAMP_PATTERN.test(value);
}

/*
 * Deterministic dependency-free digest: FNV-1a 32-bit over a length-prefixed canonical part
 * list, computed on two seeded lanes and rendered as 'fnv1a64:' + 16 hex characters. NOT
 * cryptographic: it pins integrity within this contract set, not adversarial security.
 * Identical construction to the entry contract's digest (a structural mirror).
 */
const FNV1A_OFFSET_BASIS = 0x811c9dc5;
const FNV1A_PRIME = 0x01000193;

function fnv1a32Lane(input: string, seed: number): string {
    let hash = seed >>> 0;
    for (let index = 0; index < input.length; index++) {
        hash = (hash ^ input.charCodeAt(index)) >>> 0;
        hash = Math.imul(hash, FNV1A_PRIME) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}

export function digestOf(...parts: string[]): string {
    let canonical = '';
    for (const part of parts) {
        canonical += `${part.length}:${part};`;
    }
    const laneA = fnv1a32Lane(canonical, FNV1A_OFFSET_BASIS);
    const laneB = fnv1a32Lane(canonical, (FNV1A_OFFSET_BASIS ^ 0x9e3779b9) >>> 0);
    return `fnv1a64:${laneA}${laneB}`;
}

const DIGEST_PATTERN = /^fnv1a64:[0-9a-f]{16}$/;

/** Pure shape guard for digests produced by digestOf. */
export function isDigest(value: unknown): value is string {
    return typeof value === 'string' && DIGEST_PATTERN.test(value);
}

/*
 * PROJECTION (read-only authority: extensions/flauz-agent/src/types.ts): the EvidenceKind
 * vocabulary, restated because contract modules import nothing.
 */
export const EVIDENCE_KINDS = ['changeset', 'screenshot', 'command-output', 'note'] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export function isEvidenceKind(value: unknown): value is EvidenceKind {
    return typeof value === 'string' && (EVIDENCE_KINDS as readonly string[]).includes(value);
}

/** The frozen entry kinds (as const; the union is derived, never hand-written). */
export const MEMORY_ENTRY_KINDS = ['fact', 'preference', 'procedure', 'reference'] as const;
export type MemoryEntryKind = (typeof MEMORY_ENTRY_KINDS)[number];

export function isMemoryEntryKind(value: unknown): value is MemoryEntryKind {
    return typeof value === 'string' && (MEMORY_ENTRY_KINDS as readonly string[]).includes(value);
}

export const MEMORY_PROVENANCE_ORIGINS = ['task-evidence', 'operator-entry', 'derived'] as const;
export type MemoryProvenanceOrigin = (typeof MEMORY_PROVENANCE_ORIGINS)[number];

export interface TaskEvidenceProvenanceRecord {
    readonly origin: 'task-evidence';
    readonly evidenceKind: EvidenceKind;
    readonly evidenceRef: string;
    readonly capturedAtIso: string;
}

export interface OperatorEntryProvenanceRecord {
    readonly origin: 'operator-entry';
    readonly capturedAtIso: string;
}

export interface DerivedProvenanceRecord {
    readonly origin: 'derived';
    readonly inputDigests: readonly string[];
    readonly capturedAtIso: string;
}

/**
 * PROVENANCE DISCLOSURE LAW (structural mirror of the entry contract's MemoryProvenance):
 * task-evidence cites the projected evidence vocabulary; operator-entry is disclosed as
 * manual; derived carries its derivation inputs' digests and is disclosed as derived.
 */
export type MemoryProvenanceRecord = TaskEvidenceProvenanceRecord | OperatorEntryProvenanceRecord | DerivedProvenanceRecord;

export function isMemoryProvenanceRecord(value: unknown): value is MemoryProvenanceRecord {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as {
        origin?: unknown;
        evidenceKind?: unknown;
        evidenceRef?: unknown;
        inputDigests?: unknown;
        capturedAtIso?: unknown;
    };
    if (typeof candidate.origin !== 'string' || !(MEMORY_PROVENANCE_ORIGINS as readonly string[]).includes(candidate.origin)) {
        return false;
    }
    if (!isIsoTimestamp(candidate.capturedAtIso)) {
        return false;
    }
    if (candidate.origin === 'task-evidence') {
        return isEvidenceKind(candidate.evidenceKind) && typeof candidate.evidenceRef === 'string' && candidate.evidenceRef.length > 0;
    }
    if (candidate.origin === 'derived') {
        if (!Array.isArray(candidate.inputDigests) || candidate.inputDigests.length === 0) {
            return false;
        }
        return candidate.inputDigests.every((digest) => typeof digest === 'string' && digest.length > 0);
    }
    return true;
}

function projectRefMatchesLevel(level: MemoryLevel, projectRef: unknown): boolean {
    if (level === 'project') {
        return typeof projectRef === 'string' && projectRef.length > 0;
    }
    return projectRef === undefined;
}

/**
 * One immutable revision of a logical memory entry (structural mirror of the entry
 * contract's MemoryEntry). Carries the every-record law: scope + contractVersion + plain
 * ISO timestamps, plus the memory-level scope (level and, at the project level, projectRef).
 */
export interface MemoryEntryRecord {
    readonly scope: MemoryRecordScope;
    readonly contractVersion: string;
    readonly entryId: string;
    readonly level: MemoryLevel;
    readonly projectRef: string | undefined;
    readonly kind: MemoryEntryKind;
    readonly contentDigest: string;
    readonly provenance: MemoryProvenanceRecord;
    readonly createdAtIso: string;
    readonly revisionDigest: string;
}

export function isMemoryEntryRecord(value: unknown): value is MemoryEntryRecord {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as {
        scope?: unknown;
        contractVersion?: unknown;
        entryId?: unknown;
        level?: unknown;
        projectRef?: unknown;
        kind?: unknown;
        contentDigest?: unknown;
        provenance?: unknown;
        createdAtIso?: unknown;
        revisionDigest?: unknown;
    };
    return (
        isMemoryRecordScope(candidate.scope) &&
        candidate.contractVersion === SCOPED_MEMORY_CONTRACTS_VERSION &&
        typeof candidate.entryId === 'string' &&
        candidate.entryId.length > 0 &&
        isMemoryLevel(candidate.level) &&
        projectRefMatchesLevel(candidate.level, candidate.projectRef) &&
        isMemoryEntryKind(candidate.kind) &&
        isDigest(candidate.contentDigest) &&
        isMemoryProvenanceRecord(candidate.provenance) &&
        isIsoTimestamp(candidate.createdAtIso) &&
        isDigest(candidate.revisionDigest)
    );
}

/**
 * Per-level opt-in state (structural mirror of the enablement contract's MemoryEnablement).
 * DEFAULT-OFF LAW: enabledLevels is empty unless a level was explicitly turned on.
 */
export interface MemoryEnablementRecord {
    readonly scope: MemoryRecordScope;
    readonly contractVersion: string;
    readonly enabledLevels: readonly MemoryLevel[];
    readonly updatedAtIso: string;
}

export function isMemoryEnablementRecord(value: unknown): value is MemoryEnablementRecord {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as {
        scope?: unknown;
        contractVersion?: unknown;
        enabledLevels?: unknown;
        updatedAtIso?: unknown;
    };
    if (!isMemoryRecordScope(candidate.scope) || candidate.contractVersion !== SCOPED_MEMORY_CONTRACTS_VERSION) {
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

/*
 * RETENTION: per-level TTLs as exported plain-number constants (days), assembled into a
 * RetentionPolicy record by defaultRetentionPolicy. The clock is always injected: the caller
 * derives the clock delta (days since the ISO epoch) from their own clock with
 * isoToEpochDays - no clock is ever read here.
 */
export const USER_MEMORY_TTL_DAYS = 365;
export const PROJECT_MEMORY_TTL_DAYS = 180;
export const WORKSPACE_MEMORY_TTL_DAYS = 90;

export interface RetentionPolicyTtlDays {
    readonly user: number;
    readonly project: number;
    readonly workspace: number;
}

/** The retention policy record: per-level TTL days (non-negative integers). */
export interface RetentionPolicy {
    readonly scope: MemoryRecordScope;
    readonly contractVersion: string;
    readonly ttlDays: RetentionPolicyTtlDays;
    readonly declaredAtIso: string;
}

function isTtlDays(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

export function isRetentionPolicy(value: unknown): value is RetentionPolicy {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as {
        scope?: unknown;
        contractVersion?: unknown;
        ttlDays?: unknown;
        declaredAtIso?: unknown;
    };
    if (!isMemoryRecordScope(candidate.scope) || candidate.contractVersion !== SCOPED_MEMORY_CONTRACTS_VERSION) {
        return false;
    }
    if (!isIsoTimestamp(candidate.declaredAtIso)) {
        return false;
    }
    if (typeof candidate.ttlDays !== 'object' || candidate.ttlDays === null) {
        return false;
    }
    const ttlDays = candidate.ttlDays as { user?: unknown; project?: unknown; workspace?: unknown };
    return isTtlDays(ttlDays.user) && isTtlDays(ttlDays.project) && isTtlDays(ttlDays.workspace);
}

/** The default policy: the exported per-level TTL constants. */
export function defaultRetentionPolicy(scope: MemoryRecordScope, declaredAtIso: string): RetentionPolicy {
    return {
        scope,
        contractVersion: SCOPED_MEMORY_CONTRACTS_VERSION,
        ttlDays: { user: USER_MEMORY_TTL_DAYS, project: PROJECT_MEMORY_TTL_DAYS, workspace: WORKSPACE_MEMORY_TTL_DAYS },
        declaredAtIso
    };
}

/*
 * THE INJECTED CLOCK: pure civil-calendar arithmetic (days-from-civil / civil-from-days), no
 * Date object anywhere. Days are counted since 1970-01-01T00:00:00Z.
 */
const ISO_PARSE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/;

interface CivilDate {
    readonly year: number;
    readonly month: number;
    readonly day: number;
}

function daysFromCivil(year: number, month: number, day: number): number {
    let y = year;
    y -= month <= 2 ? 1 : 0;
    const era = Math.floor(y / 400);
    const yoe = y - era * 400;
    const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
    const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
    return era * 146097 + doe - 719468;
}

function civilFromDays(days: number): CivilDate {
    const z = days + 719468;
    const era = Math.floor(z / 146097);
    const doe = z - era * 146097;
    const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
    let year = yoe + era * 400;
    const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
    const mp = Math.floor((5 * doy + 2) / 153);
    const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
    const month = mp + (mp < 10 ? 3 : -9);
    year += month <= 2 ? 1 : 0;
    return { year, month, day };
}

/**
 * Pure converter: a plain ISO-8601 UTC timestamp to days since 1970-01-01T00:00:00Z
 * (fractional days carry the time of day). Returns NaN for unparseable stamps or fields
 * outside their basic ranges. THE INJECTED CLOCK LAW: the caller derives the clock delta
 * from their own clock with this function; no clock is read here.
 */
export function isoToEpochDays(iso: string): number {
    const match = ISO_PARSE_PATTERN.exec(iso);
    if (match === null) {
        return Number.NaN;
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hours = Number(match[4]);
    const minutes = Number(match[5]);
    const seconds = Number(match[6]);
    if (month < 1 || month > 12 || day < 1 || day > 31 || hours > 23 || minutes > 59 || seconds > 59) {
        return Number.NaN;
    }
    const secondsOfDay = hours * 3600 + minutes * 60 + seconds;
    return daysFromCivil(year, month, day) + secondsOfDay / 86400;
}

/**
 * Pure inverse of isoToEpochDays: renders a day count (integer or fractional; the fractional
 * part is the time of day, floored to whole seconds) as an ISO-8601 UTC stamp. Returns ''
 * when the input is non-finite or the year falls outside 0000-9999 (unrepresentable under
 * the four-digit-year timestamp law).
 */
export function epochDaysToIsoUtc(days: number): string {
    if (!Number.isFinite(days)) {
        return '';
    }
    // 2026-10-05 TL review fix: Math.floor on the fractional-day seconds
    // loses a second to floating-point representation (19782.52425925926
    // * 86400 = 45295.999... -> floor 45295). Math.round recovers the exact
    // second; the 86400 carry handles the .999999-of-a-day boundary.
    let dayPart = Math.floor(days);
    let secondsOfDay = Math.round((days - dayPart) * 86400);
    if (secondsOfDay === 86400) {
        dayPart += 1;
        secondsOfDay = 0;
    }
    const civil = civilFromDays(dayPart);
    if (civil.year < 0 || civil.year > 9999) {
        return '';
    }
    const hours = Math.floor(secondsOfDay / 3600);
    const minutes = Math.floor((secondsOfDay % 3600) / 60);
    const seconds = secondsOfDay % 60;
    const yearText = civil.year.toString().padStart(4, '0');
    const monthText = civil.month.toString().padStart(2, '0');
    const dayText = civil.day.toString().padStart(2, '0');
    const hoursText = hours.toString().padStart(2, '0');
    const minutesText = minutes.toString().padStart(2, '0');
    const secondsText = seconds.toString().padStart(2, '0');
    return `${yearText}-${monthText}-${dayText}T${hoursText}:${minutesText}:${secondsText}Z`;
}

export type RetentionVerdict = 'retain' | 'expire';

/**
 * Pure verdict for one entry against a policy and an injected clock delta (days since the
 * ISO epoch, e.g. isoToEpochDays(nowIso)). The entry expires when its age (clockDelta minus
 * its createdAtIso day) reaches its level's TTL. FAIL-CLOSED TOWARD RETENTION: invalid
 * inputs, unparseable stamps, negative ages (future-dated entries), and non-finite clock
 * deltas all retain - the destructive action never happens on doubt.
 */
export function retentionVerdict(entry: MemoryEntryRecord, policy: RetentionPolicy, clockDelta: number): RetentionVerdict {
    if (!isMemoryEntryRecord(entry) || !isRetentionPolicy(policy) || !Number.isFinite(clockDelta)) {
        return 'retain';
    }
    const createdDay = isoToEpochDays(entry.createdAtIso);
    if (Number.isNaN(createdDay)) {
        return 'retain';
    }
    const ageInDays = clockDelta - createdDay;
    if (Number.isNaN(ageInDays) || ageInDays < 0) {
        return 'retain';
    }
    return ageInDays >= policy.ttlDays[entry.level] ? 'expire' : 'retain';
}

/** Typed per-entry expiry evidence produced by applyRetention (a persisted record). */
export interface RetentionExpireReceipt {
    readonly scope: MemoryRecordScope;
    readonly contractVersion: string;
    readonly entryId: string;
    readonly level: MemoryLevel;
    readonly ttlDays: number;
    readonly expiredAtIso: string;
    readonly expireDigest: string;
}

export interface RetentionApplication {
    readonly retained: readonly MemoryEntryRecord[];
    readonly expireReceipts: readonly RetentionExpireReceipt[];
}

export type RetentionApplicationResult =
    | { readonly kind: 'applied'; readonly application: RetentionApplication }
    | { readonly kind: 'refusal'; readonly reason: 'invalid-policy' }
    | { readonly kind: 'refusal'; readonly reason: 'invalid-clock-delta' }
    | { readonly kind: 'refusal'; readonly reason: 'invalid-entries' }
    | { readonly kind: 'refusal'; readonly reason: 'invalid-entry'; readonly entryIndex: number }
    | { readonly kind: 'refusal'; readonly reason: 'entry-scope-mismatch'; readonly entryIndex: number };

/**
 * Pure retention application: partitions entries into the retained set and the expire
 * receipts. RETENTION IS A PROJECTION - the caller executes the deletions; this function
 * never mutates its inputs and never deletes anything itself. Check order: policy shape,
 * clock delta, entries array, per-entry record shape, per-entry scope coherence (entries
 * from another tenant or workspace are refused typedly, never expired under this policy),
 * then the partition.
 */
export function applyRetention(entries: readonly MemoryEntryRecord[], policy: RetentionPolicy, clockDelta: number): RetentionApplicationResult {
    if (!isRetentionPolicy(policy)) {
        return { kind: 'refusal', reason: 'invalid-policy' };
    }
    if (!Number.isFinite(clockDelta)) {
        return { kind: 'refusal', reason: 'invalid-clock-delta' };
    }
    if (!Array.isArray(entries)) {
        return { kind: 'refusal', reason: 'invalid-entries' };
    }
    const recordEntries = entries as readonly MemoryEntryRecord[];
    for (let index = 0; index < recordEntries.length; index++) {
        if (!isMemoryEntryRecord(recordEntries[index])) {
            return { kind: 'refusal', reason: 'invalid-entry', entryIndex: index };
        }
    }
    for (let index = 0; index < recordEntries.length; index++) {
        const entry = recordEntries[index];
        if (entry.scope.tenantId !== policy.scope.tenantId || entry.scope.workspaceId !== policy.scope.workspaceId) {
            return { kind: 'refusal', reason: 'entry-scope-mismatch', entryIndex: index };
        }
    }
    const expiredAtIso = epochDaysToIsoUtc(clockDelta);
    if (expiredAtIso === '') {
        return { kind: 'refusal', reason: 'invalid-clock-delta' };
    }
    const retained: MemoryEntryRecord[] = [];
    const expireReceipts: RetentionExpireReceipt[] = [];
    for (const entry of recordEntries) {
        if (retentionVerdict(entry, policy, clockDelta) === 'expire') {
            expireReceipts.push({
                scope: entry.scope,
                contractVersion: SCOPED_MEMORY_CONTRACTS_VERSION,
                entryId: entry.entryId,
                level: entry.level,
                ttlDays: policy.ttlDays[entry.level],
                expiredAtIso,
                expireDigest: digestOf('retention-expire', entry.scope.tenantId, entry.scope.workspaceId, entry.entryId, entry.level, String(policy.ttlDays[entry.level]), expiredAtIso)
            });
        } else {
            retained.push(entry);
        }
    }
    return { kind: 'applied', application: { retained, expireReceipts } };
}

/** Typed per-entry deletion evidence (a persisted record): the caller executes the delete. */
export interface DeleteReceipt {
    readonly scope: MemoryRecordScope;
    readonly contractVersion: string;
    readonly entryId: string;
    readonly level: MemoryLevel;
    readonly deletedAtIso: string;
    readonly deletionDigest: string;
}

export function isDeleteReceipt(value: unknown): value is DeleteReceipt {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as {
        scope?: unknown;
        contractVersion?: unknown;
        entryId?: unknown;
        level?: unknown;
        deletedAtIso?: unknown;
        deletionDigest?: unknown;
    };
    return (
        isMemoryRecordScope(candidate.scope) &&
        candidate.contractVersion === SCOPED_MEMORY_CONTRACTS_VERSION &&
        typeof candidate.entryId === 'string' &&
        candidate.entryId.length > 0 &&
        isMemoryLevel(candidate.level) &&
        isIsoTimestamp(candidate.deletedAtIso) &&
        isDigest(candidate.deletionDigest)
    );
}

export type DeleteResult =
    | { readonly kind: 'deleted'; readonly receipt: DeleteReceipt }
    | { readonly kind: 'refusal'; readonly reason: 'invalid-entry' }
    | { readonly kind: 'refusal'; readonly reason: 'invalid-timestamp' };

/**
 * Pure transition: the typed deletion evidence for one entry. Deletion is not gated on
 * enablement (a tenant may purge a disabled level); the receipt is the evidence, the caller
 * executes. Typed refusals - never silent, never thrown.
 */
export function deleteEntry(entry: MemoryEntryRecord, deletedAtIso: string): DeleteResult {
    if (!isMemoryEntryRecord(entry)) {
        return { kind: 'refusal', reason: 'invalid-entry' };
    }
    if (!isIsoTimestamp(deletedAtIso)) {
        return { kind: 'refusal', reason: 'invalid-timestamp' };
    }
    const receipt: DeleteReceipt = {
        scope: entry.scope,
        contractVersion: SCOPED_MEMORY_CONTRACTS_VERSION,
        entryId: entry.entryId,
        level: entry.level,
        deletedAtIso,
        deletionDigest: digestOf('delete', entry.scope.tenantId, entry.scope.workspaceId, entry.entryId, entry.level, deletedAtIso)
    };
    return { kind: 'deleted', receipt };
}

/** The export request for one memory level (a REQUEST shape, not itself persisted). */
export interface ExportRequest {
    readonly scope: MemoryRecordScope;
    readonly level: MemoryLevel;
    readonly projectRef: string | undefined;
    readonly enablement: MemoryEnablementRecord;
    readonly entries: readonly MemoryEntryRecord[];
    readonly exportedAtIso: string;
}

/**
 * The exportable record set for one memory level: the entries (provenance included on
 * each), the enablement state that authorized the export, and the evaluation instant, all
 * integrity-pinned by the bundle digest. Export REQUIRES the level enabled: a disabled
 * level is a typed refusal, never a partial silent bundle.
 */
export interface ExportBundle {
    readonly scope: MemoryRecordScope;
    readonly contractVersion: string;
    readonly level: MemoryLevel;
    readonly projectRef: string | undefined;
    readonly exportedAtIso: string;
    readonly enablement: MemoryEnablementRecord;
    readonly entries: readonly MemoryEntryRecord[];
    readonly bundleDigest: string;
}

export type ExportResult =
    | { readonly kind: 'exported'; readonly bundle: ExportBundle }
    | { readonly kind: 'refusal'; readonly reason: 'level-not-enabled'; readonly level: MemoryLevel; readonly enablement: MemoryEnablementRecord }
    | { readonly kind: 'refusal'; readonly reason: 'invalid-request' }
    | { readonly kind: 'refusal'; readonly reason: 'invalid-entry'; readonly entryIndex: number }
    | { readonly kind: 'refusal'; readonly reason: 'entry-scope-mismatch'; readonly entryIndex: number };

function enablementStateDigestPart(enablement: MemoryEnablementRecord): string {
    return `${enablement.enabledLevels.join(',')}@${enablement.updatedAtIso}`;
}

function exportBundleDigest(
    scope: MemoryRecordScope,
    level: MemoryLevel,
    projectRef: string | undefined,
    exportedAtIso: string,
    enablement: MemoryEnablementRecord,
    entries: readonly MemoryEntryRecord[]
): string {
    return digestOf('export-bundle', scope.tenantId, scope.workspaceId, level, projectRef ?? '', exportedAtIso, enablementStateDigestPart(enablement), ...entries.map((entry) => entry.revisionDigest));
}

/**
 * Pure export transition. Check order: request shape (scope, level/projectRef coherence,
 * enablement record, entries array, exportedAtIso, and the enablement scope matching the
 * request scope), then THE DEFAULT-OFF EXPORT GATE (the level must be enabled - a disabled
 * level is a typed refusal carrying the level and the enablement state), then per-entry
 * shape, then per-entry scope/level/projectRef coherence (a foreign or wrong-level entry is
 * a typed refusal, never a leaky bundle).
 */
export function exportLevel(request: ExportRequest): ExportResult {
    if (
        !isMemoryRecordScope(request.scope) ||
        !isMemoryLevel(request.level) ||
        !projectRefMatchesLevel(request.level, request.projectRef) ||
        !isMemoryEnablementRecord(request.enablement) ||
        !isIsoTimestamp(request.exportedAtIso) ||
        !Array.isArray(request.entries)
    ) {
        return { kind: 'refusal', reason: 'invalid-request' };
    }
    if (request.enablement.scope.tenantId !== request.scope.tenantId || request.enablement.scope.workspaceId !== request.scope.workspaceId) {
        return { kind: 'refusal', reason: 'invalid-request' };
    }
    const entries = request.entries as readonly MemoryEntryRecord[];
    for (let index = 0; index < entries.length; index++) {
        if (!isMemoryEntryRecord(entries[index])) {
            return { kind: 'refusal', reason: 'invalid-entry', entryIndex: index };
        }
    }
    if (!request.enablement.enabledLevels.includes(request.level)) {
        return { kind: 'refusal', reason: 'level-not-enabled', level: request.level, enablement: request.enablement };
    }
    for (let index = 0; index < entries.length; index++) {
        const entry = entries[index];
        const scopeMatches = entry.scope.tenantId === request.scope.tenantId && entry.scope.workspaceId === request.scope.workspaceId;
        const levelMatches = entry.level === request.level && (request.level !== 'project' || entry.projectRef === request.projectRef);
        if (!scopeMatches || !levelMatches) {
            return { kind: 'refusal', reason: 'entry-scope-mismatch', entryIndex: index };
        }
    }
    const bundle: ExportBundle = {
        scope: request.scope,
        contractVersion: SCOPED_MEMORY_CONTRACTS_VERSION,
        level: request.level,
        projectRef: request.projectRef,
        exportedAtIso: request.exportedAtIso,
        enablement: request.enablement,
        entries,
        bundleDigest: exportBundleDigest(request.scope, request.level, request.projectRef, request.exportedAtIso, request.enablement, entries)
    };
    return { kind: 'exported', bundle };
}

/**
 * Pure read-side verification: re-derives the bundle digest from the bundle's own fields
 * (including every entry's revisionDigest, in order) and compares. Also rejects bundles
 * whose shape or entry scope/level coherence is broken. Returns false on any break - never
 * throws.
 */
export function verifyExportBundle(bundle: unknown): boolean {
    if (typeof bundle !== 'object' || bundle === null) {
        return false;
    }
    const candidate = bundle as {
        scope?: unknown;
        contractVersion?: unknown;
        level?: unknown;
        projectRef?: unknown;
        exportedAtIso?: unknown;
        enablement?: unknown;
        entries?: unknown;
        bundleDigest?: unknown;
    };
    if (!isMemoryRecordScope(candidate.scope) || candidate.contractVersion !== SCOPED_MEMORY_CONTRACTS_VERSION) {
        return false;
    }
    if (!isMemoryLevel(candidate.level) || !projectRefMatchesLevel(candidate.level, candidate.projectRef)) {
        return false;
    }
    if (!isIsoTimestamp(candidate.exportedAtIso) || !isMemoryEnablementRecord(candidate.enablement) || !isDigest(candidate.bundleDigest)) {
        return false;
    }
    if (!Array.isArray(candidate.entries) || !candidate.entries.every((entry) => isMemoryEntryRecord(entry))) {
        return false;
    }
    const entries = candidate.entries as readonly MemoryEntryRecord[];
    for (const entry of entries) {
        if (entry.scope.tenantId !== candidate.scope.tenantId || entry.scope.workspaceId !== candidate.scope.workspaceId || entry.level !== candidate.level) {
            return false;
        }
        if (candidate.level === 'project' && entry.projectRef !== candidate.projectRef) {
            return false;
        }
    }
    const expected = exportBundleDigest(
        candidate.scope,
        candidate.level,
        typeof candidate.projectRef === 'string' ? candidate.projectRef : undefined,
        candidate.exportedAtIso,
        candidate.enablement,
        entries
    );
    return expected === candidate.bundleDigest;
}
