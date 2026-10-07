/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * CR-005 -- THE LIVE SCOPED-MEMORY RUNTIME (Phase C-R, B1, wave 4).
 *
 * LAWS:
 * - OVER THE REAL STORE, ONLY: the runtime binds a REAL MemoryStore
 *   (extensions/flauz-memory/src/memory.ts) constructed through
 *   MemoryStoreOptions with the runtime's injected clock + fs port (the
 *   store's own hermetic test discipline). The store's journals +
 *   promotions.jsonl are the ONLY write authorities: the runtime adds no
 *   persistence engine, no retrieval index, and no embedding surface -- it
 *   is a typed gate/projection layer over the store's own surfaces
 *   (record/move/setPinned/compact/share). Memory remains subordinate to
 *   Workspace OS and tenant policy.
 * - THE CONTRACT IS THE COMPOSITION AUTHORITY: enablement transitions ride
 *   enablement.ts (enableLevel/disableLevel/canUseMemory/requestMemoryUse),
 *   admission + revision ride entry.ts (canAdmitEntry/admitEntry/
 *   reviseEntry/verifyRevisionChain), reads route through scoping.ts
 *   (resolveScope/mayRead/visibleLevels), retention + export ride
 *   lifecycle.ts (retentionVerdict/applyRetention/exportLevel/
 *   verifyExportBundle). This module never re-implements a frozen table it
 *   can call instead; the two digest constructions it restates (the
 *   genesis/chained revision digests, which entry.ts keeps private) are
 *   structural mirrors pinned by the suite against the contract's own
 *   admitEntry/reviseEntry outputs.
 * - DEFAULT-OFF: every public operation that touches a memory level first
 *   routes through requestMemoryUse; a disabled level is a typed refusal
 *   carrying the level and the enablement state -- never a silent empty
 *   result, never an exception. Enablement transitions persist durably at
 *   <root>/.flauz/memory-runtime/enablement/changes.jsonl (the audit-trail
 *   journal); the current state is the contract-law fold of that journal,
 *   re-derived from disk on every operation (a fresh runtime over the same
 *   root re-derives the identical record).
 * - THE SCOPE-TIER BRIDGE (disclosed, never silent): the frozen table below
 *   maps the contract's three levels onto the store's three tiers
 *   (user->session, project->task, workspace->project) preserving each
 *   vocabulary's audience ordering (user-only/private -> task-anchored ->
 *   cross-cutting). Every bridged write/read discloses its
 *   MemoryScopeAddress AND the store tier it landed on via a
 *   bridgeProvenance field naming the table row. The bridge is a
 *   REQUEST/READ-MODEL projection -- it never mutates or extends the
 *   store's own tier law; a tier move through the store therefore moves the
 *   derived level with it (disclosed by the chain-verification verdict).
 * - SECRET-EXCLUSION (fail-closed): writes and revisions route through
 *   admitEntry/reviseEntry FIRST; a secret-shaped payload is a typed
 *   refusal naming the violated pattern family and pattern id -- never the
 *   matched text -- and nothing is appended to any journal.
 * - PROVENANCE-REQUIRED (no fabricated memory): only admitted entries map
 *   onto the store's record() with caller-supplied provenance composed onto
 *   MemoryRecordInput; the store's own validator remains the final
 *   authority and its origin-specific linkage refusals pass through as
 *   typed errors, never swallowed.
 * - HUMAN AUTHORIZATION PRESERVED: promote/demote rides the store's move(),
 *   whose authorization-bearing human gate (humanApproved + actor 'human')
 *   passes through typed; the runtime adds no bypass.
 * - HONEST GAPS: where the real store lacks a surface a contract describes
 *   -- the store has NO per-record delete surface, and its only eviction
 *   lane is cap-driven compaction -- the runtime emits a typed refusal with
 *   the disclosed reason. Never fake success, never silently pass.
 * - FAIL TYPED, NEVER SILENTLY: operations throw typed MemoryRuntimeError
 *   codes naming the violated law; no silent successes, no partial effects
 *   (a refused admission leaves every journal untouched).
 * - DETERMINISM BY INJECTION: an injected clock (epoch-ms numbers) drives
 *   every runtime timestamp; epoch-ms <-> ISO conversion is pure civil
 *   calendar arithmetic. No Math.random, no Date.now, and no new Date(...)
 *   appear anywhere in this module (the law-comment greps in the suite pin
 *   this: matches live in comment lines only).
 */

import { type Actor, canonicalJson, type Clock, type FileSystemPort, joinPath } from '../../../../../extensions/flauz-workspace/src/api.ts';
import { MemoryStore } from '../../../../../extensions/flauz-memory/src/memory.ts';
import { type MemoryKind, type MemoryOrigin, type MemoryRecord, type MemoryRecordInput, type MemoryTier, type PromotionRecord } from '../../../../../extensions/flauz-memory/src/api.ts';
import * as ScopingContract from '../common/scoping.ts';
import * as EnablementContract from '../common/enablement.ts';
import * as EntryContract from '../common/entry.ts';
import * as LifecycleContract from '../common/lifecycle.ts';

// ---------------------------------------------------------------------------
// Version + own durable root (the .flauz house style; runtime constants only)
// ---------------------------------------------------------------------------

/** Schema pinned into every enablement audit-trail journal line. */
export const MEMORY_RUNTIME_SCHEMA = 'flauz.memory-runtime/v1';

/** Directory (relative to the workspace root) holding the runtime's own durable records. */
export const MEMORY_RUNTIME_DIR = '.flauz/memory-runtime';

/** Directory (relative to the workspace root) holding the enablement audit-trail journal. */
export const MEMORY_RUNTIME_ENABLEMENT_DIR = '.flauz/memory-runtime/enablement';

/**
 * The all-off default record's updatedAtIso: the pinned ISO epoch. The fold
 * of an empty (or absent) enablement journal is therefore identical for
 * every runtime bound to the same root -- deterministic re-derivation, no
 * clock read at bind time.
 */
export const ENABLEMENT_EPOCH_ISO = '1970-01-01T00:00:00Z';

function enablementChangesPath(root: string): string {
    return joinPath(root, MEMORY_RUNTIME_ENABLEMENT_DIR, 'changes.jsonl');
}

// ---------------------------------------------------------------------------
// Pure epoch-ms <-> ISO conversion (civil-calendar arithmetic; no calendar
// object is constructed anywhere in this module -- the hookBus discipline)
// ---------------------------------------------------------------------------

function pad2(value: number): string {
    return value < 10 ? `0${String(value)}` : String(value);
}

function pad4(value: number): string {
    const text = String(value);
    return text.length >= 4 ? text : '0'.repeat(4 - text.length) + text;
}

/**
 * Pure epoch-ms -> ISO-8601 UTC conversion. Emits exactly
 * YYYY-MM-DDTHH:MM:SSZ -- the contract set's ISO timestamp shape; sub-second
 * precision is truncated by design (the bridge's timestamp law).
 */
export function epochMsToIsoUtc(epochMs: number): string {
    const secondsTotal = Math.floor(epochMs / 1000);
    const days = Math.floor(secondsTotal / 86400);
    let secondsOfDay = secondsTotal - days * 86400;
    const hours = Math.floor(secondsOfDay / 3600);
    secondsOfDay -= hours * 3600;
    const minutes = Math.floor(secondsOfDay / 60);
    const seconds = secondsOfDay - minutes * 60;
    const z = days + 719468;
    const era = Math.floor(z / 146097);
    const dayOfEra = z - era * 146097;
    const yearOfEra = Math.floor(
        (dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365,
    );
    const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
    const monthPattern = Math.floor((5 * dayOfYear + 2) / 153);
    const day = dayOfYear - Math.floor((153 * monthPattern + 2) / 5) + 1;
    const month = monthPattern < 10 ? monthPattern + 3 : monthPattern - 9;
    let year = yearOfEra + era * 400;
    if (month <= 2) {
        year += 1;
    }
    return `${pad4(year)}-${pad2(month)}-${pad2(day)}T${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}Z`;
}

const ISO_PARSE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/;

function daysFromCivil(year: number, month: number, day: number): number {
    let y = year;
    y -= month <= 2 ? 1 : 0;
    const era = Math.floor(y / 400);
    const yoe = y - era * 400;
    const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
    const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
    return era * 146097 + doe - 719468;
}

/**
 * Pure ISO-8601 UTC -> epoch-ms conversion (the inverse of epochMsToIsoUtc;
 * milliseconds are preserved exactly). Returns NaN for unparseable stamps or
 * fields outside their basic ranges -- callers fail closed on NaN.
 */
export function isoToEpochMs(iso: string): number {
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
    const millis = match[7] === undefined ? 0 : Number(match[7]);
    return (daysFromCivil(year, month, day) * 86400 + secondsOfDay) * 1000 + millis;
}

/** Splits a canonical-compact journal into lines (trailing newline tolerated). */
function splitLines(text: string): string[] {
    if (text === '') {
        return [];
    }
    const lines = text.split('\n');
    if (lines[lines.length - 1] === '') {
        lines.pop();
    }
    return lines;
}

// ---------------------------------------------------------------------------
// Typed errors (the BgAgentError/HookBusError discipline, in TypeScript)
// ---------------------------------------------------------------------------

export type MemoryRuntimeErrorCode =
    | 'DISPOSED'
    | 'INVALID-PARAMS'
    | 'INVALID-LEVEL'
    | 'SCOPE-MISMATCH'
    | 'LEVEL-NOT-ENABLED'
    | 'SECRET-SHAPED-CONTENT'
    | 'ADMISSION-REFUSED'
    | 'BRIDGE-REFUSED'
    | 'DUPLICATE-ENTRY-ID'
    | 'RESOLUTION-REFUSED'
    | 'NOT-READABLE'
    | 'NOT-FOUND'
    | 'STORE-REFUSED'
    | 'RETENTION-REFUSED'
    | 'EXPORT-REFUSED'
    | 'HONEST-GAP'
    | 'ENABLEMENT-CORRUPT'
    | 'ENABLEMENT-WRITE-FAILED';

/** A typed refusal: the code names the violated law; details carry the contract's own refusal records. */
export class MemoryRuntimeError extends Error {
    readonly code: MemoryRuntimeErrorCode;
    readonly level?: ScopingContract.MemoryLevel;
    readonly enablement?: EnablementContract.MemoryEnablement;
    readonly family?: EntryContract.SecretPatternFamily;
    readonly matchedPattern?: string;
    readonly refusal?: unknown;

    constructor(
        code: MemoryRuntimeErrorCode,
        message: string,
        details?: {
            level?: ScopingContract.MemoryLevel;
            enablement?: EnablementContract.MemoryEnablement;
            family?: EntryContract.SecretPatternFamily;
            matchedPattern?: string;
            refusal?: unknown;
        },
    ) {
        super(message);
        this.name = 'MemoryRuntimeError';
        this.code = code;
        this.level = details?.level;
        this.enablement = details?.enablement;
        this.family = details?.family;
        this.matchedPattern = details?.matchedPattern;
        this.refusal = details?.refusal;
    }
}

/** The typed assertion helper: throws MemoryRuntimeError when the condition fails (and narrows when it holds). */
function need(condition: unknown, code: MemoryRuntimeErrorCode, message: string, details?: ConstructorParameters<typeof MemoryRuntimeError>[2]): asserts condition {
    if (!condition) {
        throw new MemoryRuntimeError(code, message, details);
    }
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

// ---------------------------------------------------------------------------
// THE SCOPE-TIER BRIDGE (the frozen, disclosed table)
// ---------------------------------------------------------------------------

export type MemoryLevel = ScopingContract.MemoryLevel;
export type MemoryRecordScope = ScopingContract.MemoryRecordScope;
export type MemoryScopeAddress = ScopingContract.MemoryScopeAddress;
export type MemoryScopeQuery = ScopingContract.MemoryScopeQuery;
export type MemoryEnablement = EnablementContract.MemoryEnablement;
export type EnablementChange = EnablementContract.EnablementChange;
export type EnablementTransition = EnablementContract.EnablementTransition;
export type MemoryEntry = EntryContract.MemoryEntry;
export type MemoryEntryKind = EntryContract.MemoryEntryKind;
export type MemoryProvenance = EntryContract.MemoryProvenance;

export interface ScopeTierBridgeRow {
    readonly level: MemoryLevel;
    readonly tier: MemoryTier;
    readonly rowId: string;
    readonly rationale: string;
}

/**
 * THE SCOPE-TIER BRIDGE: the frozen table mapping the contract's three
 * levels onto the store's three tiers. RATIONALE: the mapping preserves
 * each vocabulary's ordering by audience width -- the contract's
 * SCOPE_VISIBILITY_LATTICE orders user (user-only) < project < workspace,
 * and the store's tiers order session (the live agent's private working
 * tier, the M4 private-context boundary) < task (persisted per task id) <
 * project (cross-task, the widest tier). The narrowest contract level
 * lands on the store's private tier; the widest lands on the store's
 * cross-task tier. DISCLOSED GAP: the contract's TTL ordering (user 365d >
 * project 180d > workspace 90d) is thereby inverted against the store's
 * durability ordering -- retention is enforced through the contract's TTL
 * verdicts and the store's sanctioned lanes (pin/compact), never through
 * tier placement.
 */
export const SCOPE_TIER_BRIDGE: readonly ScopeTierBridgeRow[] = [
    {
        level: 'user',
        tier: 'session',
        rowId: 'user->session',
        rationale: "the user-only-visibility level lands on the live private-context session tier (taskId + agentId scoped; the M4 private boundary)",
    },
    {
        level: 'project',
        tier: 'task',
        rowId: 'project->task',
        rationale: "the project level lands on the per-task persisted tier; the level's projectRef names the task journal (T-NNN) the entry persists under",
    },
    {
        level: 'workspace',
        tier: 'project',
        rowId: 'workspace->project',
        rationale: "the full-lattice-visibility level lands on the store's widest tier: the cross-task long-term project journal (taskId null)",
    },
];

function bridgeRowOf(level: MemoryLevel): ScopeTierBridgeRow {
    const row = SCOPE_TIER_BRIDGE.find((candidate) => candidate.level === level);
    if (row === undefined) {
        throw new MemoryRuntimeError('INVALID-LEVEL', `bridgeRowOf: '${String(level)}' is not one of the three frozen memory levels`);
    }
    return row;
}

function tierOfLevel(level: MemoryLevel): MemoryTier {
    return bridgeRowOf(level).tier;
}

function levelOfTier(tier: MemoryTier): MemoryLevel {
    const row = SCOPE_TIER_BRIDGE.find((candidate) => candidate.tier === tier);
    if (row === undefined) {
        throw new MemoryRuntimeError('BRIDGE-REFUSED', `levelOfTier: store tier '${String(tier)}' has no bridge row (the bridge maps exactly the three frozen levels)`);
    }
    return row.level;
}

// ---------------------------------------------------------------------------
// The provenance + kind bridges (the store vocabulary <-> the contract vocabulary)
// ---------------------------------------------------------------------------

/**
 * The frozen contract-entry-kind -> store-kind table (the write-side
 * mapping; the contract kind rides the k- tag durably, so the read side is
 * lossless). 'authorization' is deliberately absent: authorization-bearing
 * records are store-native (their human gate is the store's own law); the
 * bridge never fabricates one.
 */
const ENTRY_KIND_TO_STORE_KIND: Readonly<Record<MemoryEntryKind, MemoryKind>> = {
    fact: 'observation',
    preference: 'instruction',
    procedure: 'summary',
    reference: 'evidence-ref',
};

/**
 * The frozen contract-provenance-origin -> store-origin table. task-evidence
 * cites a real ledger row (the store's no-fabrication law for origin
 * 'ledger-row'); operator-entry is disclosed as a human note; derived lands
 * as a context compilation. The store's own validator remains the final
 * authority over the composed record.
 */
const PROVENANCE_ORIGIN_TO_STORE_ORIGIN: Readonly<Record<EntryContract.MemoryProvenanceOrigin, MemoryOrigin>> = {
    'task-evidence': 'ledger-row',
    'operator-entry': 'human-note',
    derived: 'context-compilation',
};

// ---------------------------------------------------------------------------
// The tag conventions (the durable carrier of the contract vocabulary)
// ---------------------------------------------------------------------------

/**
 * The bridge's tag lane: every bridged store record carries the marker tag
 * plus the entry/kind tags (and, per provenance origin, the evidence-kind
 * tag or the derived-input digest tags). Tags are the store's own durable
 * vocabulary ([a-z0-9][a-z0-9-]{0,31}), so the bridge constrains the shapes
 * it can carry and refuses typedly what it cannot (never silently mutates).
 */
export const BRIDGE_MARKER_TAG = 'memrt';
export const ENTRY_TAG_PREFIX = 'e-';
export const KIND_TAG_PREFIX = 'k-';
export const EVIDENCE_KIND_TAG_PREFIX = 'ek-';
export const DERIVED_INPUT_TAG_PREFIX = 'di-';

/** The store's own tag law (restated for the bridge's shape refusals). */
const TAG_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

function tagRest(record: MemoryRecord, prefix: string): string | undefined {
    const tag = record.tags.find((candidate) => candidate.startsWith(prefix));
    return tag === undefined ? undefined : tag.slice(prefix.length);
}

function isBridgedRecord(record: MemoryRecord): boolean {
    return record.tags.includes(BRIDGE_MARKER_TAG);
}

// ---------------------------------------------------------------------------
// The revision-digest mirror (entry.ts keeps the constructions private; the
// runtime restates them over the exported primitives -- pinned by the suite
// against admitEntry/reviseEntry outputs)
// ---------------------------------------------------------------------------

function mirrorGenesisDigest(
    entryId: string,
    level: MemoryLevel,
    projectRef: string | undefined,
    kind: MemoryEntryKind,
    contentDigest: string,
    provenance: MemoryProvenance,
    createdAtIso: string,
): string {
    return EntryContract.digestOf('revision', EntryContract.REVISION_CHAIN_GENESIS, entryId, level, projectRef ?? '', kind, contentDigest, EntryContract.provenanceDigestPart(provenance), createdAtIso);
}

function mirrorChainedDigest(priorRevisionDigest: string, contentDigest: string, provenance: MemoryProvenance, createdAtIso: string): string {
    return EntryContract.digestOf('revision', priorRevisionDigest, contentDigest, EntryContract.provenanceDigestPart(provenance), createdAtIso);
}

// ---------------------------------------------------------------------------
// Public request/result shapes
// ---------------------------------------------------------------------------

/** The live-task anchor a user-level (session-tier) write requires. */
export interface MemoryRuntimeSessionAnchor {
    readonly taskId: string;
    readonly agentId: string;
}

/**
 * A bridged write request. The caller supplies BOTH provenances: the
 * contract provenance (the disclosure) and the store provenance's actor.
 * BRIDGE INSTANT LAW: the provenance capture instant must equal the
 * canonical (second-truncated) admission instant -- the bridged record's
 * one durable event instant -- and it becomes the store's provenance ts.
 */
export interface MemoryRuntimeWriteRequest {
    readonly level: MemoryLevel;
    readonly projectRef?: string;
    readonly entryId: string;
    readonly kind: MemoryEntryKind;
    readonly content: string;
    readonly provenance: MemoryProvenance;
    readonly actor: Actor;
    readonly admittedAtIso: string;
    readonly sessionAnchor?: MemoryRuntimeSessionAnchor;
}

/** A bridged revision request (same instant law, against the revision instant). */
export interface MemoryRuntimeRevisionRequest {
    readonly content: string;
    readonly provenance: MemoryProvenance;
    readonly actor: Actor;
    readonly revisedAtIso: string;
}

export interface MemoryRuntimeWriteResult {
    readonly entry: MemoryEntry;
    readonly storeRecord: MemoryRecord;
    readonly address: MemoryScopeAddress;
    readonly tier: MemoryTier;
    readonly bridgeProvenance: string;
}

export interface MemoryRuntimeReviseResult extends MemoryRuntimeWriteResult {
    readonly prior: MemoryEntry;
    readonly chain: readonly MemoryEntry[];
    readonly chainVerified: boolean;
}

export interface MemoryRuntimeReadEntry {
    readonly entry: MemoryEntry;
    readonly level: MemoryLevel;
    readonly tier: MemoryTier;
    readonly bridgeProvenance: string;
    readonly storeRecordId: string;
    readonly revisions: number;
    readonly chainVerified: boolean;
}

/** A visible-but-disabled level: the requestMemoryUse refusal, disclosed (never a silent empty level). */
export interface MemoryRuntimeRefusedLevel {
    readonly level: MemoryLevel;
    readonly refusal: Extract<EnablementContract.MemoryUseRequestResult, { kind: 'refusal' }>;
}

export interface MemoryRuntimeListResult {
    readonly address: MemoryScopeAddress;
    readonly tier: MemoryTier;
    readonly bridgeProvenance: string;
    readonly visibleLevels: readonly MemoryLevel[];
    readonly entries: readonly MemoryRuntimeReadEntry[];
    readonly refusedLevels: readonly MemoryRuntimeRefusedLevel[];
    readonly derivationProblems: readonly string[];
}

export interface MemoryRuntimeMoveResult {
    readonly promotion: PromotionRecord;
    readonly record: MemoryRecord;
    readonly fromLevel: MemoryLevel;
    readonly toLevel: MemoryLevel;
    readonly fromTier: MemoryTier;
    readonly toTier: MemoryTier;
    readonly bridgeProvenance: string;
}

export interface MemoryRuntimeRetentionVerdictRow {
    readonly entry: LifecycleContract.MemoryEntryRecord;
    readonly storeRecordId: string;
    readonly verdict: LifecycleContract.RetentionVerdict;
}

export interface MemoryRuntimeRetentionVerdicts {
    readonly policy: LifecycleContract.RetentionPolicy;
    readonly nowIso: string;
    readonly clockDelta: number;
    readonly verdicts: readonly MemoryRuntimeRetentionVerdictRow[];
}

export interface MemoryRuntimeRetentionExecution {
    readonly pinnedRecordIds: readonly string[];
    readonly compactions: readonly PromotionRecord[];
    readonly evictedRecordIds: readonly string[];
}

export interface MemoryRuntimeRetentionResult {
    readonly application: LifecycleContract.RetentionApplication;
    readonly execution: MemoryRuntimeRetentionExecution;
    /** The expired records still present after the sanctioned lanes ran: the disclosed honest gap. */
    readonly residualExpiredRecordIds: readonly string[];
    readonly honestGap: string | undefined;
}

export interface MemoryRuntimeExportResult {
    readonly bundle: LifecycleContract.ExportBundle;
    readonly verified: boolean;
}

export interface MemoryRuntimeVerifyResult {
    readonly ok: boolean;
    readonly records: number;
    readonly problems: readonly string[];
    readonly disclosure: {
        readonly enabledLevels: readonly MemoryLevel[];
        readonly bridgedCounts: Readonly<Record<MemoryLevel, number>>;
    };
}

export interface MemoryRuntimeOptions {
    readonly root: string;
    readonly fs: FileSystemPort;
    readonly clock: Clock;
    readonly scope: MemoryRecordScope;
    readonly caps?: { readonly session?: number; readonly task?: number; readonly project?: number };
}

// ---------------------------------------------------------------------------
// THE RUNTIME
// ---------------------------------------------------------------------------

export class MemoryRuntime {
    readonly root: string;
    readonly scope: MemoryRecordScope;
    /** The bound REAL store (the hook-bus binding-disclosure pattern; seeding goes through its own public APIs). */
    readonly store: MemoryStore;

    private readonly fs: FileSystemPort;
    private readonly clock: Clock;
    private readonly changesPath: string;
    private disposed = false;
    private ensured = false;

    constructor(options: MemoryRuntimeOptions) {
        need(isRecord(options), 'INVALID-PARAMS', 'MemoryRuntime: options {root, fs, clock, scope, caps?} are required');
        need(isNonEmptyString(options.root), 'INVALID-PARAMS', 'MemoryRuntime: a non-empty workspace root is required');
        need(
            isRecord(options.fs) && ['readFileUtf8', 'writeFile', 'appendFile', 'rename', 'mkdir'].every((method) => typeof options.fs[method as keyof FileSystemPort] === 'function'),
            'INVALID-PARAMS',
            'MemoryRuntime: an fs port implementing FileSystemPort {readFileUtf8, writeFile, appendFile, rename, mkdir} is required',
        );
        need(typeof options.clock === 'function', 'INVALID-PARAMS', 'MemoryRuntime: an injected clock (() => epoch-ms number) is required: the runtime never reads a wall clock');
        need(ScopingContract.isMemoryRecordScope(options.scope), 'INVALID-PARAMS', 'MemoryRuntime: the scope must be {tenantId, workspaceId} with non-empty strings (isMemoryRecordScope)');
        this.root = options.root;
        this.scope = options.scope;
        this.fs = options.fs;
        this.clock = options.clock;
        this.changesPath = enablementChangesPath(this.root);
        this.store = new MemoryStore({
            root: this.root,
            fs: this.fs,
            clock: this.clock,
            ...(options.caps !== undefined ? { caps: options.caps } : {}),
        });
    }

    /** The frozen scope-tier bridge table (disclosed; the runtime never invents a row). */
    get bridge(): readonly ScopeTierBridgeRow[] {
        return SCOPE_TIER_BRIDGE;
    }

    /**
     * Creates the memory tree (the store's own ensure) + the runtime's
     * enablement directory. Idempotent; every public operation ensures lazily.
     */
    async ensure(): Promise<void> {
        if (this.ensured) {
            return;
        }
        try {
            await this.fs.mkdir(joinPath(this.root, MEMORY_RUNTIME_ENABLEMENT_DIR));
            await this.store.ensure();
        } catch (error) {
            throw new MemoryRuntimeError('STORE-REFUSED', `MemoryRuntime.ensure failed: ${describeError(error)}`);
        }
        this.ensured = true;
    }

    private assertLive(): void {
        need(!this.disposed, 'DISPOSED', 'the memory runtime has been disposed');
    }

    private async ensureReady(): Promise<void> {
        await this.ensure();
    }

    // ---------------------------------------------------------------------------
    // Enablement: the DEFAULT-OFF gate + the durable audit trail
    // ---------------------------------------------------------------------------

    /** The current enablement record: the contract-law fold of the durable audit-trail journal. */
    async enablement(): Promise<MemoryEnablement> {
        this.assertLive();
        await this.ensureReady();
        return this.loadEnablement();
    }

    /** Every persisted audit-trail row, in journal order. */
    async enablementChanges(): Promise<readonly EnablementChange[]> {
        this.assertLive();
        await this.ensureReady();
        const text = await this.readEnablementJournal();
        if (text === undefined) {
            return [];
        }
        return splitLines(text).map((line, index) => this.parseEnablementChangeLine(line, index + 1));
    }

    /** Enables a level: the contract's enableLevel transition, persisted durably (the audit trail). */
    async enableLevel(level: MemoryLevel): Promise<EnablementTransition> {
        return this.applyEnablementTransition(level, 'enable');
    }

    /** Disables a level: the contract's disableLevel transition, persisted durably (the audit trail). */
    async disableLevel(level: MemoryLevel): Promise<EnablementTransition> {
        return this.applyEnablementTransition(level, 'disable');
    }

    private async applyEnablementTransition(level: MemoryLevel, direction: 'enable' | 'disable'): Promise<EnablementTransition> {
        this.assertLive();
        await this.ensureReady();
        need(EnablementContract.isMemoryLevel(level), 'INVALID-LEVEL', `enable/disable: '${String(level)}' is not one of the three frozen memory levels`);
        const current = await this.loadEnablement();
        const changedAtIso = epochMsToIsoUtc(this.clock());
        const transition = direction === 'enable'
            ? EnablementContract.enableLevel(current, level, changedAtIso)
            : EnablementContract.disableLevel(current, level, changedAtIso);
        await this.appendEnablementChange(transition.change);
        return transition;
    }

    private async readEnablementJournal(): Promise<string | undefined> {
        try {
            return await this.fs.readFileUtf8(this.changesPath);
        } catch (error) {
            throw new MemoryRuntimeError('ENABLEMENT-CORRUPT', `the enablement audit-trail journal could not be read: ${describeError(error)}`);
        }
    }

    private parseEnablementChangeLine(line: string, lineNo: number): EnablementChange {
        let parsed: unknown;
        try {
            parsed = JSON.parse(line);
        } catch (error) {
            throw new MemoryRuntimeError('ENABLEMENT-CORRUPT', `the enablement audit-trail journal line ${String(lineNo)} is not valid JSON: ${describeError(error)}`);
        }
        if (!isRecord(parsed) || parsed.$schema !== MEMORY_RUNTIME_SCHEMA || !isRecord(parsed.change)) {
            throw new MemoryRuntimeError('ENABLEMENT-CORRUPT', `the enablement audit-trail journal line ${String(lineNo)} must be the envelope {'$schema': '${MEMORY_RUNTIME_SCHEMA}', change: {scope, contractVersion, level, from, to, changedAtIso}}`);
        }
        const change = parsed.change;
        if (
            !ScopingContract.isMemoryRecordScope(change.scope) ||
            change.contractVersion !== EnablementContract.SCOPED_MEMORY_CONTRACTS_VERSION ||
            !EnablementContract.isMemoryLevel(change.level) ||
            typeof change.from !== 'boolean' ||
            typeof change.to !== 'boolean' ||
            !EnablementContract.isIsoTimestamp(change.changedAtIso)
        ) {
            throw new MemoryRuntimeError('ENABLEMENT-CORRUPT', `the enablement audit-trail journal line ${String(lineNo)} is not a valid EnablementChange record`);
        }
        const scope = change.scope;
        if (!ScopingContract.recordScopesEqual(scope, this.scope)) {
            throw new MemoryRuntimeError(
                'ENABLEMENT-CORRUPT',
                `the enablement audit-trail journal line ${String(lineNo)} belongs to another scope {tenantId: '${scope.tenantId}', workspaceId: '${scope.workspaceId}'} (the runtime is bound to {tenantId: '${this.scope.tenantId}', workspaceId: '${this.scope.workspaceId}'})`,
            );
        }
        return {
            scope,
            contractVersion: change.contractVersion,
            level: change.level,
            from: change.from,
            to: change.to,
            changedAtIso: change.changedAtIso,
        };
    }

    /**
     * THE DURABLE RE-DERIVATION: the current enablement record is folded from
     * the audit-trail journal using the contract's own transitions. A fresh
     * runtime over the same root re-derives the identical record; an empty or
     * absent journal folds to the all-off default (DEFAULT-OFF LAW).
     */
    private async loadEnablement(): Promise<MemoryEnablement> {
        const text = await this.readEnablementJournal();
        let enablement = EnablementContract.defaultEnablement(this.scope, ENABLEMENT_EPOCH_ISO);
        if (text === undefined) {
            return enablement;
        }
        for (const [index, line] of splitLines(text).entries()) {
            const change = this.parseEnablementChangeLine(line, index + 1);
            enablement = change.to
                ? EnablementContract.enableLevel(enablement, change.level, change.changedAtIso).enablement
                : EnablementContract.disableLevel(enablement, change.level, change.changedAtIso).enablement;
        }
        return enablement;
    }

    private async appendEnablementChange(change: EnablementChange): Promise<void> {
        try {
            const line = canonicalJson({ $schema: MEMORY_RUNTIME_SCHEMA, change });
            await this.fs.appendFile(this.changesPath, `${line}\n`);
        } catch (error) {
            throw new MemoryRuntimeError('ENABLEMENT-WRITE-FAILED', `the enablement audit-trail change could not be persisted: ${describeError(error)}`);
        }
    }

    /** THE DEFAULT-OFF GATE: every level-touching operation routes through the contract's requestMemoryUse. */
    private async requireLevelEnabled(level: MemoryLevel): Promise<MemoryEnablement> {
        const enablement = await this.loadEnablement();
        const verdict = EnablementContract.requestMemoryUse(level, enablement);
        if (verdict.kind === 'refusal') {
            throw new MemoryRuntimeError(
                'LEVEL-NOT-ENABLED',
                `memory level '${level}' is not enabled (the DEFAULT-OFF law): the request is a typed refusal carrying the level and the enablement state {enabledLevels: [${enablement.enabledLevels.join(', ')}], updatedAtIso: '${enablement.updatedAtIso}'} -- never a silent empty result, never an exception`,
                { level, enablement },
            );
        }
        return enablement;
    }

    // ---------------------------------------------------------------------------
    // Writes: admission (secret-exclusion, fail-closed) onto the real store
    // ---------------------------------------------------------------------------

    async write(request: MemoryRuntimeWriteRequest): Promise<MemoryRuntimeWriteResult> {
        this.assertLive();
        await this.ensureReady();
        const validated = this.validateWriteRequest(request);
        const level = request.level;
        const projectRef = validated.projectRef;
        // 1. THE DEFAULT-OFF GATE (first, after shape validation).
        await this.requireLevelEnabled(level);
        // 2. The duplicate-entry law: an entryId with live records refuses typedly.
        const { chains } = await this.readBackChains();
        need(chains.every((chain) => chain.entryId !== request.entryId), 'DUPLICATE-ENTRY-ID', `write: entry id '${request.entryId}' already has live records (a second genesis would break the revision chain)`);
        // 3. THE CONTRACT ADMISSION (secret-exclusion first; the contract is the composition authority).
        const admission = EntryContract.admitEntry({
            scope: this.scope,
            level,
            projectRef,
            entryId: request.entryId,
            kind: request.kind,
            content: request.content,
            provenance: request.provenance,
            admittedAtIso: validated.canonicalAdmitted,
        });
        if (admission.kind === 'refusal') {
            this.throwAdmissionRefusal(admission);
        }
        // 4. Compose onto the store's record() with caller-supplied provenance.
        const storeInput = this.composeStoreRecordInput(
            request.entryId,
            request.kind,
            request.content,
            request.provenance,
            request.actor,
            validated.canonicalAdmitted,
            validated.taskId,
            validated.agentId,
        );
        const outcome = await this.callStore(() => this.store.record(tierOfLevel(level), storeInput), `record into tier '${tierOfLevel(level)}'`);
        const row = bridgeRowOf(level);
        return {
            entry: admission.entry,
            storeRecord: outcome.record,
            address: { scope: this.scope, contractVersion: ScopingContract.SCOPED_MEMORY_CONTRACTS_VERSION, level, projectRef },
            tier: row.tier,
            bridgeProvenance: row.rowId,
        };
    }

    private validateWriteRequest(request: MemoryRuntimeWriteRequest): { projectRef: string | undefined; canonicalAdmitted: string; taskId: string | null; agentId: string | null } {
        need(isRecord(request), 'INVALID-PARAMS', 'write: a request {level, projectRef?, entryId, kind, content, provenance, actor, admittedAtIso, sessionAnchor?} is required');
        need(EnablementContract.isMemoryLevel(request.level), 'INVALID-LEVEL', `write: '${String(request.level)}' is not one of the three frozen memory levels`);
        let projectRef: string | undefined;
        let taskId: string | null = null;
        if (request.level === 'project') {
            need(isNonEmptyString(request.projectRef), 'INVALID-PARAMS', 'write: the project level requires a projectRef (the task journal anchor)');
            projectRef = request.projectRef;
            // The projectRef names the task journal (the bridge's disclosed row).
            taskId = projectRef;
        } else {
            need(request.projectRef === undefined, 'INVALID-PARAMS', `write: the '${request.level}' level carries no projectRef (only the project level anchors one)`);
        }
        need(isNonEmptyString(request.entryId), 'INVALID-PARAMS', 'write: entryId must be a non-empty string');
        need(
            TAG_PATTERN.test(`${ENTRY_TAG_PREFIX}${request.entryId}`),
            'BRIDGE-REFUSED',
            `write: entryId '${request.entryId}' is not bridge-shaped: the store's tag lane carries it as '${ENTRY_TAG_PREFIX}<entryId>' and tags must match [a-z0-9][a-z0-9-]{0,31} (lowercase, <= 30 chars after the 'e-' prefix)`,
        );
        need(EntryContract.isMemoryEntryKind(request.kind), 'INVALID-PARAMS', `write: '${String(request.kind)}' is not one of the four frozen entry kinds`);
        need(typeof request.content === 'string', 'INVALID-PARAMS', 'write: content must be a string');
        need(EntryContract.isMemoryProvenance(request.provenance), 'INVALID-PARAMS', 'write: provenance must be a valid MemoryProvenance record (task-evidence | operator-entry | derived)');
        need(request.actor === 'agent' || request.actor === 'human' || request.actor === 'tool', 'INVALID-PARAMS', 'write: actor must be one of agent|human|tool');
        need(EnablementContract.isIsoTimestamp(request.admittedAtIso), 'INVALID-PARAMS', `write: admittedAtIso must be a plain ISO-8601 UTC string with a Z suffix (got ${JSON.stringify(request.admittedAtIso)})`);
        const epochMs = isoToEpochMs(request.admittedAtIso);
        need(Number.isFinite(epochMs), 'INVALID-PARAMS', `write: admittedAtIso is not a representable instant (got ${JSON.stringify(request.admittedAtIso)})`);
        const canonicalAdmitted = epochMsToIsoUtc(epochMs);
        // THE BRIDGE INSTANT LAW: one durable event instant per record.
        need(
            request.provenance.capturedAtIso === canonicalAdmitted,
            'BRIDGE-REFUSED',
            `write: the bridge pins the provenance capture instant to the admission instant: provenance.capturedAtIso must equal the canonical (second-truncated) admittedAtIso '${canonicalAdmitted}' (got ${JSON.stringify(request.provenance.capturedAtIso)})`,
        );
        this.validateBridgeCarriableProvenance(request.provenance);
        let agentId: string | null = null;
        if (request.level === 'user') {
            const anchor = request.sessionAnchor;
            if (anchor === undefined || !isNonEmptyString(anchor.taskId) || !isNonEmptyString(anchor.agentId)) {
                throw new MemoryRuntimeError(
                    'BRIDGE-REFUSED',
                    "write: the user level lands on the store's session tier, which requires the live-task anchor {taskId, agentId} (sessionAnchor is required for user-level writes)",
                );
            }
            taskId = anchor.taskId;
            agentId = anchor.agentId;
        }
        return { projectRef, canonicalAdmitted, taskId, agentId };
    }

    /** The tag lane can carry only digest-shaped derived inputs; anything else is a typed refusal (never silently dropped). */
    private validateBridgeCarriableProvenance(provenance: MemoryProvenance): void {
        if (provenance.origin === 'derived') {
            for (const digest of provenance.inputDigests) {
                need(
                    EntryContract.isDigest(digest),
                    'BRIDGE-REFUSED',
                    `write/revise: derived provenance input digests must be contract digests ('fnv1a64:' + 16 hex chars) -- the store's tag lane carries exactly the 16-hex tail (got ${JSON.stringify(digest)})`,
                );
            }
        }
    }

    private throwAdmissionRefusal(refusal: EntryContract.EntryRefusal): never {
        if (refusal.reason === 'secret-shaped-content') {
            throw new MemoryRuntimeError(
                'SECRET-SHAPED-CONTENT',
                `admission refused: the content is secret-shaped (family '${refusal.family}', pattern '${refusal.matchedPattern}') -- the SECRET-EXCLUSION law is fail-closed and nothing was appended to any journal`,
                { family: refusal.family, matchedPattern: refusal.matchedPattern },
            );
        }
        throw new MemoryRuntimeError('ADMISSION-REFUSED', `admission refused: the admission request is invalid (${refusal.reason})`, { refusal });
    }

    private composeStoreRecordInput(
        entryId: string,
        kind: MemoryEntryKind,
        content: string,
        provenance: MemoryProvenance,
        actor: Actor,
        canonicalInstant: string,
        taskId: string | null,
        agentId: string | null,
    ): MemoryRecordInput {
        const tags: string[] = [BRIDGE_MARKER_TAG, `${ENTRY_TAG_PREFIX}${entryId}`, `${KIND_TAG_PREFIX}${kind}`];
        if (provenance.origin === 'task-evidence') {
            tags.push(`${EVIDENCE_KIND_TAG_PREFIX}${provenance.evidenceKind}`);
        } else if (provenance.origin === 'derived') {
            for (const digest of provenance.inputDigests) {
                tags.push(`${DERIVED_INPUT_TAG_PREFIX}${digest.slice('fnv1a64:'.length)}`);
            }
        }
        const storeOrigin = PROVENANCE_ORIGIN_TO_STORE_ORIGIN[provenance.origin];
        return {
            kind: ENTRY_KIND_TO_STORE_KIND[kind],
            content,
            tags,
            taskId,
            agentId,
            provenance: {
                actor,
                origin: storeOrigin,
                ts: isoToEpochMs(canonicalInstant),
                evidenceId: provenance.origin === 'task-evidence' ? provenance.evidenceRef : null,
            },
        };
    }

    // ---------------------------------------------------------------------------
    // Revisions: the revision-append law onto the store's journal appends
    // ---------------------------------------------------------------------------

    async revise(entryId: string, request: MemoryRuntimeRevisionRequest): Promise<MemoryRuntimeReviseResult> {
        this.assertLive();
        await this.ensureReady();
        need(isNonEmptyString(entryId), 'INVALID-PARAMS', 'revise: entryId must be a non-empty string');
        const canonicalRevised = this.validateRevisionRequest(request);
        const { chains } = await this.readBackChains();
        const chain = chains.find((candidate) => candidate.entryId === entryId);
        need(chain !== undefined, 'NOT-FOUND', `revise: no live records for entry id '${entryId}'`);
        const prior = chain.entries[chain.entries.length - 1];
        const latestRecord = chain.records[chain.records.length - 1];
        // THE DEFAULT-OFF GATE over the entry's (derived) level.
        await this.requireLevelEnabled(prior.level);
        // THE CONTRACT REVISION (secret-exclusion on the new content + the chained digest).
        const revision = EntryContract.reviseEntry(prior, {
            content: request.content,
            provenance: request.provenance,
            revisedAtIso: canonicalRevised,
        });
        if (revision.kind === 'refusal') {
            this.throwAdmissionRefusal(revision);
        }
        // Land as the store's own journal append (history never mutated: the prior record stays).
        const tier = latestRecord.tier;
        const storeInput = this.composeStoreRecordInput(
            entryId,
            prior.kind,
            request.content,
            request.provenance,
            request.actor,
            canonicalRevised,
            latestRecord.taskId,
            latestRecord.agentId,
        );
        const outcome = await this.callStore(() => this.store.record(tier, storeInput), `record revision into tier '${tier}'`);
        const reRead = await this.readBackChains();
        const updated = reRead.chains.find((candidate) => candidate.entryId === entryId);
        const chainVerified = updated === undefined ? false : EntryContract.verifyRevisionChain(updated.entries);
        const row = bridgeRowOf(prior.level);
        return {
            entry: revision.entry,
            storeRecord: outcome.record,
            address: { scope: this.scope, contractVersion: ScopingContract.SCOPED_MEMORY_CONTRACTS_VERSION, level: prior.level, projectRef: prior.projectRef },
            tier,
            bridgeProvenance: row.rowId,
            prior,
            chain: updated === undefined ? [revision.entry] : updated.entries,
            chainVerified,
        };
    }

    private validateRevisionRequest(request: MemoryRuntimeRevisionRequest): string {
        need(isRecord(request), 'INVALID-PARAMS', 'revise: a request {content, provenance, actor, revisedAtIso} is required');
        need(typeof request.content === 'string', 'INVALID-PARAMS', 'revise: content must be a string');
        need(EntryContract.isMemoryProvenance(request.provenance), 'INVALID-PARAMS', 'revise: provenance must be a valid MemoryProvenance record');
        need(request.actor === 'agent' || request.actor === 'human' || request.actor === 'tool', 'INVALID-PARAMS', 'revise: actor must be one of agent|human|tool');
        need(EnablementContract.isIsoTimestamp(request.revisedAtIso), 'INVALID-PARAMS', `revise: revisedAtIso must be a plain ISO-8601 UTC string with a Z suffix (got ${JSON.stringify(request.revisedAtIso)})`);
        const epochMs = isoToEpochMs(request.revisedAtIso);
        need(Number.isFinite(epochMs), 'INVALID-PARAMS', `revise: revisedAtIso is not a representable instant (got ${JSON.stringify(request.revisedAtIso)})`);
        const canonicalRevised = epochMsToIsoUtc(epochMs);
        need(
            request.provenance.capturedAtIso === canonicalRevised,
            'BRIDGE-REFUSED',
            `revise: the bridge pins the provenance capture instant to the revision instant: provenance.capturedAtIso must equal the canonical (second-truncated) revisedAtIso '${canonicalRevised}' (got ${JSON.stringify(request.provenance.capturedAtIso)})`,
        );
        this.validateBridgeCarriableProvenance(request.provenance);
        return canonicalRevised;
    }

    // ---------------------------------------------------------------------------
    // Reads: resolveScope + the visibility lattice + the enablement gate
    // ---------------------------------------------------------------------------

    async list(query: MemoryScopeQuery): Promise<MemoryRuntimeListResult> {
        this.assertLive();
        await this.ensureReady();
        this.validateQuery(query);
        // THE DEFAULT-OFF GATE on the requested (context) level, first.
        await this.requireLevelEnabled(query.context);
        const { chains, problems } = await this.readBackChains();
        const candidates = this.candidateAddresses(chains);
        const resolution = ScopingContract.resolveScope(query, candidates);
        if (resolution.kind === 'refusal') {
            throw new MemoryRuntimeError(
                'RESOLUTION-REFUSED',
                `list: the scope resolution refused (${resolution.reason}) -- the resolution law is total over the three levels and never guesses`,
                { refusal: resolution },
            );
        }
        const address = resolution.address;
        const row = bridgeRowOf(address.level);
        const visible = ScopingContract.visibleLevels(address.level);
        const enablement = await this.loadEnablement();
        const entries: MemoryRuntimeReadEntry[] = [];
        const refusedLevels: MemoryRuntimeRefusedLevel[] = [];
        for (const level of visible) {
            const verdict = EnablementContract.requestMemoryUse(level, enablement);
            if (verdict.kind === 'refusal') {
                // Disclosed per-level refusal (never a silent empty level).
                refusedLevels.push({ level, refusal: verdict });
                continue;
            }
            for (const chain of chains) {
                const latest = chain.entries[chain.entries.length - 1];
                if (latest.level !== level) {
                    continue;
                }
                if (level === 'project' && address.level === 'project' && latest.projectRef !== address.projectRef) {
                    continue;
                }
                entries.push({
                    entry: latest,
                    level,
                    tier: tierOfLevel(level),
                    bridgeProvenance: bridgeRowOf(level).rowId,
                    storeRecordId: chain.records[chain.records.length - 1].id,
                    revisions: chain.entries.length,
                    chainVerified: EntryContract.verifyRevisionChain(chain.entries),
                });
            }
        }
        return {
            address,
            tier: row.tier,
            bridgeProvenance: row.rowId,
            visibleLevels: visible,
            entries,
            refusedLevels,
            derivationProblems: problems,
        };
    }

    async get(entryId: string, query: MemoryScopeQuery): Promise<MemoryRuntimeReadEntry> {
        this.assertLive();
        await this.ensureReady();
        need(isNonEmptyString(entryId), 'INVALID-PARAMS', 'get: entryId must be a non-empty string');
        this.validateQuery(query);
        await this.requireLevelEnabled(query.context);
        const { chains } = await this.readBackChains();
        const candidates = this.candidateAddresses(chains);
        const resolution = ScopingContract.resolveScope(query, candidates);
        if (resolution.kind === 'refusal') {
            throw new MemoryRuntimeError('RESOLUTION-REFUSED', `get: the scope resolution refused (${resolution.reason})`, { refusal: resolution });
        }
        const address = resolution.address;
        const chain = chains.find((candidate) => candidate.entryId === entryId);
        need(chain !== undefined, 'NOT-FOUND', `get: no live records for entry id '${entryId}'`);
        const latest = chain.entries[chain.entries.length - 1];
        // THE VISIBILITY LATTICE: reading never widens upward.
        need(
            ScopingContract.mayRead(address.level, latest.level),
            'NOT-READABLE',
            `get: a '${address.level}'-context reader may read [${ScopingContract.visibleLevels(address.level).join(', ')}] -- the entry '${entryId}' lives at the '${latest.level}' level (reading never widens upward: the SCOPE_VISIBILITY_LATTICE law)`,
            { level: latest.level },
        );
        await this.requireLevelEnabled(latest.level);
        return {
            entry: latest,
            level: latest.level,
            tier: tierOfLevel(latest.level),
            bridgeProvenance: bridgeRowOf(latest.level).rowId,
            storeRecordId: chain.records[chain.records.length - 1].id,
            revisions: chain.entries.length,
            chainVerified: EntryContract.verifyRevisionChain(chain.entries),
        };
    }

    private validateQuery(query: MemoryScopeQuery): void {
        need(ScopingContract.isMemoryScopeQuery(query), 'INVALID-PARAMS', 'the query must be a valid MemoryScopeQuery {scope, context, projectRef?} (isMemoryScopeQuery)');
        need(
            ScopingContract.recordScopesEqual(query.scope, this.scope),
            'SCOPE-MISMATCH',
            `the query scope {tenantId: '${query.scope.tenantId}', workspaceId: '${query.scope.workspaceId}'} does not match the runtime's bound scope {tenantId: '${this.scope.tenantId}', workspaceId: '${this.scope.workspaceId}'} (memory is workspace-local to exactly the bound scope)`,
        );
    }

    /**
     * The candidate addresses are derived from the REAL bridged records: a
     * user address exists iff session-tier bridged records exist; project
     * addresses are the distinct bridged task-journal anchors; a workspace
     * address exists iff project-tier bridged records exist. The disk is the
     * truth -- an empty level has no address (the contract's typed refusal).
     */
    private candidateAddresses(chains: readonly BridgedChain[]): MemoryScopeAddress[] {
        const records = chains.flatMap((chain) => chain.records);
        const addresses: MemoryScopeAddress[] = [];
        if (records.some((record) => record.tier === 'session')) {
            addresses.push({ scope: this.scope, contractVersion: ScopingContract.SCOPED_MEMORY_CONTRACTS_VERSION, level: 'user', projectRef: undefined });
        }
        const taskIds = [...new Set(records.filter((record) => record.tier === 'task').map((record) => record.taskId as string))].sort();
        for (const taskId of taskIds) {
            addresses.push({ scope: this.scope, contractVersion: ScopingContract.SCOPED_MEMORY_CONTRACTS_VERSION, level: 'project', projectRef: taskId });
        }
        if (records.some((record) => record.tier === 'project')) {
            addresses.push({ scope: this.scope, contractVersion: ScopingContract.SCOPED_MEMORY_CONTRACTS_VERSION, level: 'workspace', projectRef: undefined });
        }
        return addresses;
    }

    // ---------------------------------------------------------------------------
    // Promote/demote: the store's own move lane, typed + gated both ends
    // ---------------------------------------------------------------------------

    async move(recordId: string, toLevel: MemoryLevel, options: { reason: string; actor: Actor; humanApproved: boolean }): Promise<MemoryRuntimeMoveResult> {
        this.assertLive();
        await this.ensureReady();
        need(isNonEmptyString(recordId), 'INVALID-PARAMS', 'move: recordId must be a non-empty string');
        need(EnablementContract.isMemoryLevel(toLevel), 'INVALID-LEVEL', `move: '${String(toLevel)}' is not one of the three frozen memory levels`);
        need(isRecord(options) && isNonEmptyString(options.reason), 'INVALID-PARAMS', 'move: options {reason, actor, humanApproved} with a non-empty reason are required (write policies are explicit and recorded)');
        need(options.actor === 'agent' || options.actor === 'human' || options.actor === 'tool', 'INVALID-PARAMS', 'move: actor must be one of agent|human|tool');
        const source = await this.callStore(() => this.store.get(recordId), `load record '${recordId}'`);
        need(source !== undefined, 'NOT-FOUND', `move: unknown record '${recordId}'`);
        const fromLevel = levelOfTier(source.tier);
        const toTier = tierOfLevel(toLevel);
        // The move touches BOTH levels: gate both (DEFAULT-OFF over each).
        await this.requireLevelEnabled(fromLevel);
        await this.requireLevelEnabled(toLevel);
        const outcome = await this.callStore(
            () => this.store.move(recordId, toTier, { reason: options.reason, actor: options.actor, humanApproved: options.humanApproved }),
            `move '${recordId}' to tier '${toTier}'`,
        );
        return {
            promotion: outcome.promotion,
            record: outcome.record,
            fromLevel,
            toLevel,
            fromTier: source.tier,
            toTier,
            bridgeProvenance: bridgeRowOf(toLevel).rowId,
        };
    }

    // ---------------------------------------------------------------------------
    // Retention: the contract TTL verdicts over REAL records + the sanctioned lanes
    // ---------------------------------------------------------------------------

    async retentionVerdicts(level: MemoryLevel, options?: { policy?: LifecycleContract.RetentionPolicy }): Promise<MemoryRuntimeRetentionVerdicts> {
        this.assertLive();
        await this.ensureReady();
        need(EnablementContract.isMemoryLevel(level), 'INVALID-LEVEL', `retentionVerdicts: '${String(level)}' is not one of the three frozen memory levels`);
        this.validateRetentionPolicyOption(options);
        await this.requireLevelEnabled(level);
        const nowIso = epochMsToIsoUtc(this.clock());
        const policy = options?.policy ?? LifecycleContract.defaultRetentionPolicy(this.scope, nowIso);
        const clockDelta = LifecycleContract.isoToEpochDays(nowIso);
        const rows = await this.levelEntryRows(level);
        return {
            policy,
            nowIso,
            clockDelta,
            verdicts: rows.map((row) => ({ entry: row.entry, storeRecordId: row.storeRecordId, verdict: LifecycleContract.retentionVerdict(row.entry, policy, clockDelta) })),
        };
    }

    async applyRetention(level: MemoryLevel, options?: { policy?: LifecycleContract.RetentionPolicy }): Promise<MemoryRuntimeRetentionResult> {
        this.assertLive();
        await this.ensureReady();
        need(EnablementContract.isMemoryLevel(level), 'INVALID-LEVEL', `applyRetention: '${String(level)}' is not one of the three frozen memory levels`);
        this.validateRetentionPolicyOption(options);
        await this.requireLevelEnabled(level);
        const nowIso = epochMsToIsoUtc(this.clock());
        const policy = options?.policy ?? LifecycleContract.defaultRetentionPolicy(this.scope, nowIso);
        const clockDelta = LifecycleContract.isoToEpochDays(nowIso);
        const rows = await this.levelEntryRows(level);
        const result = LifecycleContract.applyRetention(
            rows.map((row) => row.entry),
            policy,
            clockDelta,
        );
        if (result.kind === 'refusal') {
            throw new MemoryRuntimeError('RETENTION-REFUSED', `applyRetention: the contract refused the retention application (${result.reason})`, { refusal: result });
        }
        const application = result.application;
        const expiredEntryIds = new Set(application.expireReceipts.map((receipt) => receipt.entryId));
        // EXECUTE through the store's sanctioned lanes only: pin the retained
        // (compaction-exempt), then compact each bridged journal of this level.
        const pinnedRecordIds: string[] = [];
        for (const row of rows) {
            if (row.record.pinned || LifecycleContract.retentionVerdict(row.entry, policy, clockDelta) !== 'retain') {
                continue;
            }
            await this.callStore(
                () => this.store.setPinned(row.storeRecordId, true, { reason: 'memory-runtime retention: pinned as retained under the contract TTL policy', actor: 'tool' }),
                `pin retained record '${row.storeRecordId}'`,
            );
            pinnedRecordIds.push(row.storeRecordId);
        }
        const journalIds = [...new Set(rows.map((row) => journalIdOfRecord(row.record)))].sort();
        const compactions: PromotionRecord[] = [];
        for (const journalId of journalIds) {
            const compaction = await this.callStore(() => this.store.compact(journalId), `compact journal '${journalId}'`);
            if (compaction !== undefined) {
                compactions.push(compaction);
            }
        }
        const evictedRecordIds = compactions.flatMap((compaction) => compaction.droppedRecordIds);
        // The honest gap: what the receipts name but the sanctioned lanes could not evict.
        const reRead = await this.levelEntryRows(level);
        const residualExpiredRecordIds = reRead.filter((row) => expiredEntryIds.has(row.entry.entryId)).map((row) => row.storeRecordId);
        const honestGap = residualExpiredRecordIds.length === 0 ? undefined : `the store's only eviction lane is cap-driven compaction (compact): ${String(residualExpiredRecordIds.length)} expired record(s) [${residualExpiredRecordIds.join(', ')}] remain present because their journal is within its retention cap -- the expire-receipts are the typed evidence and the residual is disclosed, never faked`;
        return {
            application,
            execution: { pinnedRecordIds, compactions, evictedRecordIds },
            residualExpiredRecordIds,
            honestGap,
        };
    }

    private validateRetentionPolicyOption(options?: { policy?: LifecycleContract.RetentionPolicy }): void {
        if (options?.policy !== undefined) {
            need(LifecycleContract.isRetentionPolicy(options.policy), 'INVALID-PARAMS', 'retention: the supplied policy must be a valid RetentionPolicy record (isRetentionPolicy)');
        }
    }

    private async levelEntryRows(level: MemoryLevel): Promise<readonly { entry: LifecycleContract.MemoryEntryRecord; record: MemoryRecord; storeRecordId: string }[]> {
        const { chains } = await this.readBackChains();
        const tier = tierOfLevel(level);
        const rows: { entry: LifecycleContract.MemoryEntryRecord; record: MemoryRecord; storeRecordId: string }[] = [];
        for (const chain of chains) {
            for (let index = 0; index < chain.entries.length; index++) {
                const entry = chain.entries[index];
                const record = chain.records[index];
                if (record.tier !== tier) {
                    continue;
                }
                rows.push({ entry, record, storeRecordId: record.id });
            }
        }
        return rows;
    }

    // ---------------------------------------------------------------------------
    // Export: the level-enabled gated bundle over real records
    // ---------------------------------------------------------------------------

    async exportLevel(level: MemoryLevel, projectRef?: string): Promise<MemoryRuntimeExportResult> {
        this.assertLive();
        await this.ensureReady();
        need(EnablementContract.isMemoryLevel(level), 'INVALID-LEVEL', `exportLevel: '${String(level)}' is not one of the three frozen memory levels`);
        if (level === 'project') {
            need(isNonEmptyString(projectRef), 'INVALID-PARAMS', 'exportLevel: the project level exports per projectRef (the task journal anchor) -- supply one');
        } else {
            need(projectRef === undefined, 'INVALID-PARAMS', `exportLevel: the '${level}' level carries no projectRef`);
        }
        // THE DEFAULT-OFF EXPORT GATE (the runtime's own gate first).
        const enablement = await this.requireLevelEnabled(level);
        const { chains } = await this.readBackChains();
        const tier = tierOfLevel(level);
        const entries: MemoryEntry[] = [];
        for (const chain of chains) {
            const latest = chain.entries[chain.entries.length - 1];
            const latestRecord = chain.records[chain.records.length - 1];
            if (latestRecord.tier !== tier) {
                continue;
            }
            if (level === 'project' && latest.projectRef !== projectRef) {
                continue;
            }
            entries.push(latest);
        }
        const exportedAtIso = epochMsToIsoUtc(this.clock());
        const result = LifecycleContract.exportLevel({
            scope: this.scope,
            level,
            projectRef,
            enablement,
            entries,
            exportedAtIso,
        });
        if (result.kind === 'refusal') {
            throw new MemoryRuntimeError('EXPORT-REFUSED', `exportLevel: the contract refused the export (${result.reason})`, { refusal: result });
        }
        return { bundle: result.bundle, verified: LifecycleContract.verifyExportBundle(result.bundle) };
    }

    // ---------------------------------------------------------------------------
    // Deletion: THE HONEST GAP (the store has no per-record delete surface)
    // ---------------------------------------------------------------------------

    /**
     * The contract's deleteEntry composes typed DeleteReceipt evidence for a
     * caller who would execute the deletion. The real store exposes NO
     * per-record delete surface (its only sanctioned lanes are record, move,
     * setPinned, compact, and share; compaction is cap-driven, never
     * per-record) -- so the runtime refuses typedly with the disclosed
     * reason. Never fake success, never silently pass.
     */
    async deleteEntry(request: { level?: MemoryLevel; entryId?: string; deletedAtIso?: string }): Promise<never> {
        this.assertLive();
        void request;
        throw new MemoryRuntimeError(
            'HONEST-GAP',
            "deleteEntry refused: the real tiered store (extensions/flauz-memory/src/memory.ts) exposes NO per-record delete surface -- its only sanctioned lanes are record/move/setPinned/compact/share, and its compaction is cap-driven, never per-record. The contract's DeleteReceipt would be fabricated evidence: the honest gap is disclosed instead of faking success",
        );
    }

    // ---------------------------------------------------------------------------
    // Consistency: the store's verify pass-through + the enablement-vs-store check
    // ---------------------------------------------------------------------------

    async verify(): Promise<MemoryRuntimeVerifyResult> {
        this.assertLive();
        await this.ensureReady();
        const problems: string[] = [];
        let records = 0;
        try {
            const storeVerdict = await this.store.verify();
            records = storeVerdict.records;
            problems.push(...storeVerdict.problems);
        } catch (error) {
            problems.push(`store.verify failed: ${describeError(error)}`);
        }
        // The enablement-vs-store consistency check: the audit-trail journal
        // re-derives (scope-coherent, contract-versioned, foldable); the
        // derived record is disclosed alongside the bridged census.
        let enabledLevels: readonly MemoryLevel[] = [];
        try {
            const enablement = await this.loadEnablement();
            enabledLevels = enablement.enabledLevels;
        } catch (error) {
            problems.push(error instanceof MemoryRuntimeError ? error.message : `the enablement audit-trail journal could not be re-derived: ${describeError(error)}`);
        }
        let chains: readonly BridgedChain[] = [];
        try {
            const readBack = await this.readBackChains();
            chains = readBack.chains;
            problems.push(...readBack.problems);
        } catch (error) {
            problems.push(`the bridged read-back failed: ${describeError(error)}`);
        }
        const bridgedCounts: Record<MemoryLevel, number> = { user: 0, project: 0, workspace: 0 };
        for (const chain of chains) {
            const latest = chain.entries[chain.entries.length - 1];
            bridgedCounts[latest.level] += 1;
            if (!EntryContract.verifyRevisionChain(chain.entries)) {
                problems.push(`entry '${chain.entryId}': the revision chain does not verify (identity drift across revisions -- a tier move changes the derived level -- or an incoherent record)`);
            }
        }
        return {
            ok: problems.length === 0,
            records,
            problems,
            disclosure: { enabledLevels, bridgedCounts },
        };
    }

    // ---------------------------------------------------------------------------
    // Dispose (the bgAgent law: every later operation rejects typedly)
    // ---------------------------------------------------------------------------

    dispose(): void {
        this.disposed = true;
    }

    // ---------------------------------------------------------------------------
    // The read-back derivation core (the disk is the truth)
    // ---------------------------------------------------------------------------

    private async callStore<T>(operation: () => Promise<T>, label: string): Promise<T> {
        try {
            return await operation();
        } catch (error) {
            throw new MemoryRuntimeError('STORE-REFUSED', `the store refused (${label}): ${describeError(error)} -- the store's own validator is the final authority and its law passes through verbatim`);
        }
    }

    private async readBackChains(): Promise<{ chains: readonly BridgedChain[]; problems: readonly string[] }> {
        const all = await this.callStore(() => this.store.listAll(), 'listAll');
        const problems: string[] = [];
        const bridged = all
            .filter((record) => isBridgedRecord(record))
            .sort((left, right) => (left.timing.created === right.timing.created ? (left.id < right.id ? -1 : 1) : left.timing.created - right.timing.created));
        const chainsById = new Map<string, { entries: MemoryEntry[]; records: MemoryRecord[] }>();
        for (const record of bridged) {
            const entryId = tagRest(record, ENTRY_TAG_PREFIX);
            if (entryId === undefined || entryId.length === 0) {
                problems.push(`record '${record.id}': marked bridged ('${BRIDGE_MARKER_TAG}') but carries no '${ENTRY_TAG_PREFIX}*' entry tag -- not derivable, skipped`);
                continue;
            }
            const bucket = chainsById.get(entryId) ?? { entries: [], records: [] };
            const prior = bucket.entries.length === 0 ? undefined : bucket.entries[bucket.entries.length - 1];
            const derivation = this.deriveEntry(record, prior);
            if (!derivation.ok) {
                problems.push(`record '${record.id}' (entry '${entryId}'): ${derivation.problem}`);
                continue;
            }
            bucket.entries.push(derivation.entry);
            bucket.records.push(record);
            chainsById.set(entryId, bucket);
        }
        const chains: BridgedChain[] = [...chainsById.entries()]
            .map(([entryId, bucket]) => ({ entryId, entries: bucket.entries, records: bucket.records }))
            .sort((left, right) => (left.entryId < right.entryId ? -1 : 1));
        return { chains, problems };
    }

    /**
     * The pure store-record -> contract-entry derivation: the identity fields
     * ride the tags, the level/projectRef ride the tier bridge (inverse), the
     * provenance rides the inverse origin table, the instant rides the
     * record's own provenance ts, and the revision digest chains from the
     * predecessor (the mirror construction, re-derived -- never persisted as
     * a second authority).
     */
    private deriveEntry(record: MemoryRecord, prior: MemoryEntry | undefined): DerivationOutcome {
        const entryId = tagRest(record, ENTRY_TAG_PREFIX);
        const kind = tagRest(record, KIND_TAG_PREFIX);
        if (entryId === undefined || entryId.length === 0) {
            return { ok: false, problem: "no 'e-*' entry tag" };
        }
        if (kind === undefined || !EntryContract.isMemoryEntryKind(kind)) {
            return { ok: false, problem: `no valid 'k-*' entry-kind tag (got ${JSON.stringify(kind)})` };
        }
        const level = levelOfTier(record.tier);
        const projectRef = record.tier === 'task' ? (record.taskId ?? undefined) : undefined;
        const provenance = this.deriveProvenance(record);
        if (!provenance.ok) {
            return { ok: false, problem: provenance.problem };
        }
        const contentDigest = EntryContract.contentDigestOf(record.content);
        const createdAtIso = epochMsToIsoUtc(record.provenance.ts);
        const revisionDigest = prior === undefined
            ? mirrorGenesisDigest(entryId, level, projectRef, kind, contentDigest, provenance.provenance, createdAtIso)
            : mirrorChainedDigest(prior.revisionDigest, contentDigest, provenance.provenance, createdAtIso);
        const entry: MemoryEntry = {
            scope: this.scope,
            contractVersion: EntryContract.SCOPED_MEMORY_CONTRACTS_VERSION,
            entryId,
            level,
            projectRef,
            kind,
            contentDigest,
            provenance: provenance.provenance,
            createdAtIso,
            revisionDigest,
        };
        return { ok: true, entry };
    }

    /**
     * The INVERSE provenance bridge: ledger-row reads back as task-evidence
     * (the evidenceKind rides the ek- tag; the evidenceRef is the store's own
     * evidence row id); human-note reads back as operator-entry;
     * context-compilation reads back as derived (the input digests ride the
     * di- tags). Every other store origin (task-event, a2a-message,
     * workflow-run, recovery, promotion -- including records minted by the
     * store's own move lane) reads back CONSERVATIVELY as derived over the
     * record's content hash: nothing presents as original evidence that is
     * not, and under-claiming is the honest direction.
     */
    private deriveProvenance(record: MemoryRecord): { ok: true; provenance: MemoryProvenance } | { ok: false; problem: string } {
        const capturedAtIso = epochMsToIsoUtc(record.provenance.ts);
        switch (record.provenance.origin) {
            case 'ledger-row': {
                const evidenceKind = tagRest(record, EVIDENCE_KIND_TAG_PREFIX);
                if (evidenceKind === undefined || !EntryContract.isEvidenceKind(evidenceKind)) {
                    return { ok: false, problem: `origin 'ledger-row' without a valid '${EVIDENCE_KIND_TAG_PREFIX}*' evidence-kind tag (got ${JSON.stringify(evidenceKind)})` };
                }
                if (record.provenance.evidenceId === null) {
                    return { ok: false, problem: "origin 'ledger-row' without its evidence row (the store's no-fabrication law is broken on disk)" };
                }
                return { ok: true, provenance: { origin: 'task-evidence', evidenceKind, evidenceRef: record.provenance.evidenceId, capturedAtIso } };
            }
            case 'human-note': {
                return { ok: true, provenance: { origin: 'operator-entry', capturedAtIso } };
            }
            case 'context-compilation': {
                const inputDigests = record.tags
                    .filter((tag) => tag.startsWith(DERIVED_INPUT_TAG_PREFIX))
                    .map((tag) => `fnv1a64:${tag.slice(DERIVED_INPUT_TAG_PREFIX.length)}`);
                if (inputDigests.length === 0) {
                    return { ok: false, problem: `origin 'context-compilation' without '${DERIVED_INPUT_TAG_PREFIX}*' derived-input tags` };
                }
                return { ok: true, provenance: { origin: 'derived', inputDigests, capturedAtIso } };
            }
            default: {
                return { ok: true, provenance: { origin: 'derived', inputDigests: [record.provenance.contentHash], capturedAtIso } };
            }
        }
    }
}

// ---------------------------------------------------------------------------
// The internal derivation types
// ---------------------------------------------------------------------------

type DerivationOutcome = { ok: true; entry: MemoryEntry } | { ok: false; problem: string };

interface BridgedChain {
    readonly entryId: string;
    readonly entries: readonly MemoryEntry[];
    readonly records: readonly MemoryRecord[];
}

/** Journal id of a store record ('S' | 'P' | 'T-NNN', derived from the record's own scope). */
function journalIdOfRecord(record: MemoryRecord): string {
    if (record.tier === 'session') {
        return 'S';
    }
    if (record.tier === 'project') {
        return 'P';
    }
    if (record.taskId === null) {
        throw new MemoryRuntimeError('STORE-REFUSED', `record '${record.id}' is task-tier without a taskId (the store's own scope law is broken on disk)`);
    }
    return record.taskId;
}
