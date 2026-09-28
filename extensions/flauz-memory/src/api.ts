/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Flauz memory api (TL2-003, Worker C - M1 tiered memory).
 *
 * The durable memory substrate under `.flauz/memory/`:
 *
 *   session.jsonl        the live-task working tier (scope: taskId + agentId)
 *   tasks/T-NNN.jsonl    the per-task tier (persisted per task id)
 *   project.jsonl        the long-term cross-task tier (retrievable)
 *   promotions.jsonl     the WRITE-POLICY log (promote/demote/compact/pin)
 *   shares.jsonl         explicit cross-agent share records (M4 private context)
 *   index.json           the retrieval index envelope (derived, rebuildable)
 *
 * House discipline (mirrors flauz-workspace api.ts):
 *   - versioned envelopes with strict unknown-keys-rejected parsing;
 *   - canonical serialization (DL-9 git-diffability: sorted keys, 2-space
 *     indent, one trailing newline for envelopes; canonical compact JSON for
 *     journal lines);
 *   - every memory record carries PROVENANCE (actor, origin, content hash,
 *     time, evidence row when applicable) - a record exists only when a real
 *     event produced it (no fabricated memory);
 *   - node-free core: IO goes through FileSystemPort / Clock ports only.
 *
 * Record ids are journal-scoped and self-describing (derivable by re-scanning
 * the journals, so the index is REBUILDABLE after any crash):
 *   MEM-S-NNNNNN    session journal seq N
 *   MEM-T-001-NNNNNN  task journal of T-001, seq N
 *   MEM-P-NNNNNN    project journal seq N
 */

import { type Actor, canonicalJson, deepSorted, joinPath } from '../../flauz-workspace/src/api.ts';

/** Schema pinned into the retrieval index envelope. */
export const MEMORY_INDEX_SCHEMA = 'flauz.memory.index/v1';

/** Directory (relative to the workspace root) holding all memory state. */
export const MEMORY_DIR = '.flauz/memory';

/** Directory (relative to the workspace root) holding per-task tier journals. */
export const MEMORY_TASKS_DIR = '.flauz/memory/tasks';

/** Session (working) tier journal, relative to the workspace root. */
export const SESSION_JOURNAL_PATH = '.flauz/memory/session.jsonl';

/** Project (long-term) tier journal, relative to the workspace root. */
export const PROJECT_JOURNAL_PATH = '.flauz/memory/project.jsonl';

/** Write-policy log (promote/demote/compact/pin), relative to the workspace root. */
export const PROMOTIONS_PATH = '.flauz/memory/promotions.jsonl';

/** Cross-agent share records, relative to the workspace root. */
export const SHARES_PATH = '.flauz/memory/shares.jsonl';

/** Retrieval index envelope, relative to the workspace root. */
export const INDEX_PATH = '.flauz/memory/index.json';

/** Per-task tier journal path of a task id. */
export function taskJournalPath(taskId: string): string {
	return joinPath(MEMORY_TASKS_DIR, `${taskId}.jsonl`);
}

export const MEMORY_TIERS = ['session', 'task', 'project'] as const;
export type MemoryTier = (typeof MEMORY_TIERS)[number];

/** Journal ids embedded in record ids ('S', 'P', or a task id). */
export const MEMORY_KINDS = ['observation', 'instruction', 'summary', 'decision-ref', 'evidence-ref', 'authorization'] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

/** Where a memory record came from - the no-fabrication ledger. */
export const MEMORY_ORIGINS = ['task-event', 'ledger-row', 'a2a-message', 'human-note', 'context-compilation', 'workflow-run', 'recovery', 'promotion'] as const;
export type MemoryOrigin = (typeof MEMORY_ORIGINS)[number];

export interface MemoryProvenance {
	readonly actor: Actor;
	readonly origin: MemoryOrigin;
	/** sha256 over the canonical content - tamper-evident content binding. */
	readonly contentHash: string;
	readonly ts: number;
	/** The evidence row this record derived from (required for origin 'ledger-row'). */
	readonly evidenceId: string | null;
}

export interface MemoryRecord {
	readonly id: string;
	readonly tier: MemoryTier;
	/** Task scope: REQUIRED on session/task tiers, null on project. */
	readonly taskId: string | null;
	/** Agent scope: REQUIRED on session tier (the live task's agent); private-context boundary for M4. */
	readonly agentId: string | null;
	readonly kind: MemoryKind;
	readonly content: string;
	readonly tags: readonly string[];
	readonly pinned: boolean;
	readonly timing: { readonly created: number; readonly updatedAt: number };
	readonly provenance: MemoryProvenance;
}

/** Caller-facing input (id/timing minted by the store; provenance contentHash minted). */
export interface MemoryRecordInput {
	readonly kind: MemoryKind;
	readonly content: string;
	readonly tags?: readonly string[];
	readonly pinned?: boolean;
	readonly taskId?: string | null;
	readonly agentId?: string | null;
	readonly provenance: {
		readonly actor: Actor;
		readonly origin: MemoryOrigin;
		readonly ts: number;
		readonly evidenceId?: string | null;
	};
}

// ---------------------------------------------------------------------------
// Promotion / write-policy records
// ---------------------------------------------------------------------------

export const PROMOTION_ACTIONS = ['promote', 'demote', 'compact', 'pin', 'unpin'] as const;
export type PromotionAction = (typeof PROMOTION_ACTIONS)[number];

/** Journal id a compact record names ('session' | 'project' | 'task:T-NNN'). */
export const PROMOTION_JOURNAL_PATTERN = /^(session|project|task:T-\d{3,})$/;

export interface PromotionRecord {
	readonly id: string;
	readonly action: PromotionAction;
	readonly ts: number;
	readonly actor: Actor;
	/** REQUIRED true on promote/demote of authorization-bearing records (human gate). */
	readonly humanApproved: boolean;
	/** The source record (compact: null). */
	readonly recordId: string | null;
	/** The record minted in the target journal (promote/demote only; else null). */
	readonly resultRecordId: string | null;
	/** The journal a compact record compacted ('session'|'project'|'task:T-NNN'). */
	readonly journal: string | null;
	readonly fromTier: MemoryTier | null;
	readonly toTier: MemoryTier | null;
	readonly reason: string;
	/** compact only: the evicted record ids (the audit trail of the rewrite). */
	readonly droppedRecordIds: readonly string[];
}

// ---------------------------------------------------------------------------
// Share records (M4 private-context boundary; defined here so the memory
// substrate owns the shape it enforces)
// ---------------------------------------------------------------------------

export const SHARE_ACTIONS = ['grant', 'revoke'] as const;
export type ShareAction = (typeof SHARE_ACTIONS)[number];

export interface ShareRecord {
	readonly id: string;
	readonly action: ShareAction;
	readonly recordId: string;
	/** The owning agent of the private record. */
	readonly fromAgent: string;
	/** The peer the record becomes readable by. */
	readonly toAgent: string;
	readonly actor: Actor;
	readonly ts: number;
	readonly reason: string;
}

// ---------------------------------------------------------------------------
// The retrieval index (M2 input; derived from the journals, rebuildable)
// ---------------------------------------------------------------------------

export interface MemoryIndexEntry {
	readonly id: string;
	readonly tier: MemoryTier;
	readonly taskId: string | null;
	readonly agentId: string | null;
	readonly kind: MemoryKind;
	readonly tags: readonly string[];
	readonly tokens: number;
	readonly created: number;
	readonly updatedAt: number;
	readonly pinned: boolean;
	readonly evidenceId: string | null;
}

export interface MemoryIndex {
	readonly $schema: string;
	/** The journal registry ('S', 'P', task ids) - the discovery source of truth (the FileSystemPort has no readdir; the workflows index.json pattern). */
	readonly journals: readonly string[];
	readonly entries: readonly MemoryIndexEntry[];
	readonly generatedAt: number;
}

/** Journal registry id shape ('S' | 'P' | 'T-NNN'). */
export const JOURNAL_ID_PATTERN = /^(S|P|T-\d{3,})$/;

// ---------------------------------------------------------------------------
// Validation (strict, mirrors flauz.tasks/v0: exact key sets, loud errors)
// ---------------------------------------------------------------------------

const SESSION_JOURNAL_ID = 'S';
const PROJECT_JOURNAL_ID = 'P';
const RECORD_ID_PATTERN = /^MEM-(S|P|T-\d{3,})-(\d{6,})$/;
const PROMOTION_ID_PATTERN = /^P-(\d{6,})$/;
const SHARE_ID_PATTERN = /^SH-(\d{6,})$/;
const TASK_ID_PATTERN = /^T-\d{3,}$/;
const EVIDENCE_ID_PATTERN = /^E-\d{6,}$/;
const AGENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const TAG_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Own-property presence check (the eslint-blessed replacement for the `in` operator). */
export function hasKey(obj: object, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(obj, key);
}

function hasKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
	const actual = Object.keys(value);
	if (actual.length !== required.length + optional.length) {
		return false;
	}
	for (const key of required) {
		if (!hasKey(value, key)) {
			return false;
		}
	}
	for (const key of actual) {
		if (!required.includes(key) && !optional.includes(key)) {
			return false;
		}
	}
	return true;
}

function isPositiveInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}

function isActor(value: unknown): value is Actor {
	return value === 'agent' || value === 'human' || value === 'tool';
}

export function isMemoryTier(value: unknown): value is MemoryTier {
	return typeof value === 'string' && (MEMORY_TIERS as readonly string[]).includes(value);
}

export function isMemoryKind(value: unknown): value is MemoryKind {
	return typeof value === 'string' && (MEMORY_KINDS as readonly string[]).includes(value);
}

export function isMemoryOrigin(value: unknown): value is MemoryOrigin {
	return typeof value === 'string' && (MEMORY_ORIGINS as readonly string[]).includes(value);
}

export function isEvidenceIdRef(value: unknown): value is string {
	return typeof value === 'string' && EVIDENCE_ID_PATTERN.test(value);
}

export function isAgentIdRef(value: unknown): value is string {
	return typeof value === 'string' && AGENT_ID_PATTERN.test(value);
}

export function isMemoryRecordId(value: unknown): value is string {
	return typeof value === 'string' && RECORD_ID_PATTERN.test(value);
}

/** Journal id embedded in a record id ('S' | 'P' | 'T-NNN'). */
export function journalIdOf(recordId: string): string | undefined {
	const match = RECORD_ID_PATTERN.exec(recordId);
	return match === null ? undefined : (match[1] as string);
}

/** Sequence number embedded in a record id (minted from the journal's max seq at append; compaction rewrites create gaps, so this is NOT the line position). */
export function journalSeqOf(recordId: string): number | undefined {
	const match = RECORD_ID_PATTERN.exec(recordId);
	return match === null ? undefined : Number.parseInt(match[2] ?? '0', 10);
}

/** Record id of a journal-scoped sequence number (minted at append time; uniqueness within the journal is the law). */
export function memoryRecordId(journalId: string, seq: number): string {
	return `MEM-${journalId}-${String(seq).padStart(6, '0')}`;
}

/** Journal id of a tier + task scope ('S' for session, 'P' for project, the task id for task tier). */
export function journalIdFor(tier: MemoryTier, taskId: string | null): string {
	if (tier === 'session') {
		return SESSION_JOURNAL_ID;
	}
	if (tier === 'project') {
		return PROJECT_JOURNAL_ID;
	}
	if (taskId === null) {
		throw new Error('flauz.memory/v1: task tier requires a task-scoped journal id (taskId must not be null)');
	}
	return taskId;
}

/** Promotion record id of a promotions-journal position (1-based). */
export function promotionRecordId(seq: number): string {
	return `P-${String(seq).padStart(6, '0')}`;
}

/** Share record id of a shares-journal position (1-based). */
export function shareRecordId(seq: number): string {
	return `SH-${String(seq).padStart(6, '0')}`;
}

function validateProvenance(value: unknown, label: string): MemoryProvenance {
	if (!isPlainObject(value) || !hasKeys(value, ['actor', 'origin', 'contentHash', 'ts', 'evidenceId'])) {
		throw new Error(`${label}: provenance must have exactly the keys [actor, contentHash, evidenceId, origin, ts]`);
	}
	if (!isActor(value.actor)) {
		throw new Error(`${label}: provenance.actor must be one of agent|human|tool (got ${JSON.stringify(value.actor)})`);
	}
	if (!isMemoryOrigin(value.origin)) {
		throw new Error(`${label}: provenance.origin must be one of ${MEMORY_ORIGINS.join('|')} (got ${JSON.stringify(value.origin)})`);
	}
	if (!isNonEmptyString(value.contentHash) || !/^[0-9a-f]{64}$/.test(value.contentHash)) {
		throw new Error(`${label}: provenance.contentHash must be 64 lowercase hex chars`);
	}
	if (!isPositiveInteger(value.ts)) {
		throw new Error(`${label}: provenance.ts must be a positive integer (epoch ms)`);
	}
	if (value.evidenceId !== null && !isEvidenceIdRef(value.evidenceId)) {
		throw new Error(`${label}: provenance.evidenceId must match /^E-\\d{6,}$/ or be null (got ${JSON.stringify(value.evidenceId)})`);
	}
	if (value.origin === 'ledger-row' && value.evidenceId === null) {
		throw new Error(`${label}: origin 'ledger-row' requires the evidence row it derived from (no fabricated memory - provenance.evidenceId must be the E-NNNNNN id)`);
	}
	return { actor: value.actor, origin: value.origin, contentHash: value.contentHash, ts: value.ts, evidenceId: value.evidenceId };
}

/** Strict validation of a stored memory record (throws with the offending rule). */
export function validateMemoryRecord(value: unknown): MemoryRecord {
	if (!isPlainObject(value) || !hasKeys(value, ['id', 'tier', 'taskId', 'agentId', 'kind', 'content', 'tags', 'pinned', 'timing', 'provenance'])) {
		throw new Error('flauz.memory/v1: record validation failed: expected exactly the keys [agentId, content, id, kind, pinned, provenance, tags, taskId, tier, timing]');
	}
	const id = value.id;
	if (!isMemoryRecordId(id)) {
		throw new Error(`flauz.memory/v1: record ${String(id)}: id must match /^MEM-(S|P|T-\d{3,})-\d{6,}$/ (got ${JSON.stringify(id)})`);
	}
	const label = `flauz.memory/v1: record ${id}`;
	const tier = value.tier;
	if (!isMemoryTier(tier)) {
		throw new Error(`${label}: tier must be one of session|task|project (got ${JSON.stringify(tier)})`);
	}
	const kind = value.kind;
	if (!isMemoryKind(kind)) {
		throw new Error(`${label}: kind must be one of ${MEMORY_KINDS.join('|')} (got ${JSON.stringify(kind)})`);
	}
	const content = value.content;
	if (typeof content !== 'string' || content.length === 0) {
		throw new Error(`${label}: content must be a non-empty string`);
	}
	const tags = value.tags;
	if (!Array.isArray(tags) || !tags.every(tag => typeof tag === 'string' && TAG_PATTERN.test(tag))) {
		throw new Error(`${label}: tags must be an array of [a-z0-9][a-z0-9-]{0,31} strings`);
	}
	const pinned = value.pinned;
	if (typeof pinned !== 'boolean') {
		throw new Error(`${label}: pinned must be a boolean`);
	}
	const taskId = value.taskId;
	if (taskId !== null && typeof taskId !== 'string') {
		throw new Error(`${label}: taskId must be a string or null (got ${JSON.stringify(taskId)})`);
	}
	if (typeof taskId === 'string' && !TASK_ID_PATTERN.test(taskId)) {
		throw new Error(`${label}: taskId must match /^T-\d{3,}$/ or be null (got ${JSON.stringify(taskId)})`);
	}
	const agentId = value.agentId;
	if (agentId !== null && !isAgentIdRef(agentId)) {
		throw new Error(`${label}: agentId must be an agent id [A-Za-z0-9][A-Za-z0-9._-]{0,63} or null (got ${JSON.stringify(agentId)})`);
	}
	if (tier === 'session' && (taskId === null || agentId === null)) {
		throw new Error(`${label}: session tier is the LIVE task tier - taskId and agentId are both required`);
	}
	if (tier === 'task' && taskId === null) {
		throw new Error(`${label}: task tier requires taskId (records persist per task id)`);
	}
	if (tier === 'project' && taskId !== null) {
		throw new Error(`${label}: project tier is cross-task - taskId must be null`);
	}
	const journalId = journalIdOf(id);
	const expectedJournal = tier === 'session' ? SESSION_JOURNAL_ID : tier === 'project' ? PROJECT_JOURNAL_ID : taskId;
	if (journalId !== expectedJournal) {
		throw new Error(`${label}: id journal '${journalId}' does not match its tier${tier === 'task' ? '/taskId' : ''} scope '${String(expectedJournal)}' (ids are journal-scoped and derivable)`);
	}
	const provenanceRaw = value.provenance;
	if (kind === 'authorization' && (!isPlainObject(provenanceRaw) || (provenanceRaw.origin !== 'task-event' && provenanceRaw.origin !== 'promotion'))) {
		throw new Error(`${label}: authorization-bearing records may only be minted from real task timeline events or moved by a recorded promotion (origin must be 'task-event' or 'promotion'; never fabricated from thin air)`);
	}
	const timing = value.timing;
	if (!isPlainObject(timing) || !hasKeys(timing, ['created', 'updatedAt'])) {
		throw new Error(`${label}: timing must have exactly the keys [created, updatedAt]`);
	}
	if (!isPositiveInteger(timing.created) || !isPositiveInteger(timing.updatedAt)) {
		throw new Error(`${label}: timing.created/updatedAt must be positive integers (epoch ms)`);
	}
	const provenance = validateProvenance(provenanceRaw, label);
	if (provenance.origin === 'task-event' && taskId === null) {
		throw new Error(`${label}: origin 'task-event' requires the taskId the event belongs to`);
	}
	return {
		id,
		tier,
		taskId,
		agentId,
		kind,
		content,
		tags,
		pinned,
		timing: { created: timing.created, updatedAt: timing.updatedAt },
		provenance,
	};
}

/** Strict validation of a promotion (write-policy) record. */
export function validatePromotionRecord(value: unknown): PromotionRecord {
	if (!isPlainObject(value) || !hasKeys(value, ['id', 'action', 'ts', 'actor', 'humanApproved', 'recordId', 'resultRecordId', 'journal', 'fromTier', 'toTier', 'reason', 'droppedRecordIds'])) {
		throw new Error('flauz.memory.promotions/v1: record validation failed: expected exactly the keys [action, actor, droppedRecordIds, fromTier, humanApproved, id, journal, reason, recordId, resultRecordId, toTier, ts]');
	}
	const id = value.id;
	if (typeof id !== 'string' || !PROMOTION_ID_PATTERN.test(id)) {
		throw new Error(`flauz.memory.promotions/v1: record ${String(id)}: id must match /^P-\d{6,}$/`);
	}
	const label = `flauz.memory.promotions/v1: record ${id}`;
	const action = value.action;
	if (!(PROMOTION_ACTIONS as readonly string[]).includes(action as string)) {
		throw new Error(`${label}: action must be one of ${PROMOTION_ACTIONS.join('|')} (got ${JSON.stringify(action)})`);
	}
	const ts = value.ts;
	if (!isPositiveInteger(ts)) {
		throw new Error(`${label}: ts must be a positive integer (epoch ms)`);
	}
	const actor = value.actor;
	if (!isActor(actor)) {
		throw new Error(`${label}: actor must be one of agent|human|tool (got ${JSON.stringify(actor)})`);
	}
	const humanApproved = value.humanApproved;
	if (typeof humanApproved !== 'boolean') {
		throw new Error(`${label}: humanApproved must be a boolean`);
	}
	const reason = value.reason;
	if (!isNonEmptyString(reason)) {
		throw new Error(`${label}: reason must be a non-empty string (write policies are explicit and recorded)`);
	}
	const fromTier = value.fromTier;
	if (fromTier !== null && !isMemoryTier(fromTier)) {
		throw new Error(`${label}: fromTier must be one of session|task|project or null (got ${JSON.stringify(fromTier)})`);
	}
	const toTier = value.toTier;
	if (toTier !== null && !isMemoryTier(toTier)) {
		throw new Error(`${label}: toTier must be one of session|task|project or null (got ${JSON.stringify(toTier)})`);
	}
	const droppedRecordIds = value.droppedRecordIds;
	if (!Array.isArray(droppedRecordIds) || !droppedRecordIds.every(candidate => isMemoryRecordId(candidate))) {
		throw new Error(`${label}: droppedRecordIds must be an array of MEM- record ids`);
	}
	const recordId = value.recordId;
	const resultRecordId = value.resultRecordId;
	const journal = value.journal;
	if (action === 'promote' || action === 'demote') {
		if (!isMemoryRecordId(recordId) || !isMemoryRecordId(resultRecordId)) {
			throw new Error(`${label}: ${action} requires recordId AND resultRecordId (the source and the minted target record)`);
		}
		if (fromTier === null || toTier === null) {
			throw new Error(`${label}: ${action} requires fromTier and toTier`);
		}
		if (journal !== null || droppedRecordIds.length > 0) {
			throw new Error(`${label}: ${action} must not carry journal/droppedRecordIds (those are compact-only fields)`);
		}
	} else if (action === 'compact') {
		if (typeof journal !== 'string' || !PROMOTION_JOURNAL_PATTERN.test(journal)) {
			throw new Error(`${label}: compact requires journal matching /^(session|project|task:T-\d{3,})$/ (got ${JSON.stringify(journal)})`);
		}
		if (droppedRecordIds.length === 0) {
			throw new Error(`${label}: compact must list the droppedRecordIds (the audit trail of the only journal rewrite)`);
		}
		if (recordId !== null || resultRecordId !== null || fromTier !== null || toTier !== null) {
			throw new Error(`${label}: compact must not carry recordId/resultRecordId/fromTier/toTier`);
		}
	} else {
		if (!isMemoryRecordId(recordId)) {
			throw new Error(`${label}: ${String(action)} requires recordId`);
		}
		if (resultRecordId !== null || journal !== null || fromTier !== null || toTier !== null || droppedRecordIds.length > 0) {
			throw new Error(`${label}: ${String(action)} must not carry resultRecordId/journal/fromTier/toTier/droppedRecordIds`);
		}
	}
	return {
		id,
		action: action as PromotionAction,
		ts,
		actor,
		humanApproved,
		recordId,
		resultRecordId,
		journal,
		fromTier,
		toTier,
		reason,
		droppedRecordIds,
	};
}

/** Strict validation of a share record. */
export function validateShareRecord(value: unknown): ShareRecord {
	if (!isPlainObject(value) || !hasKeys(value, ['id', 'action', 'recordId', 'fromAgent', 'toAgent', 'actor', 'ts', 'reason'])) {
		throw new Error('flauz.memory.shares/v1: record validation failed: expected exactly the keys [action, actor, fromAgent, id, reason, recordId, toAgent, ts]');
	}
	const id = value.id;
	if (typeof id !== 'string' || !SHARE_ID_PATTERN.test(id)) {
		throw new Error(`flauz.memory.shares/v1: record ${String(id)}: id must match /^SH-\d{6,}$/`);
	}
	const label = `flauz.memory.shares/v1: record ${id}`;
	const action = value.action;
	if (!(SHARE_ACTIONS as readonly string[]).includes(action as string)) {
		throw new Error(`${label}: action must be one of ${SHARE_ACTIONS.join('|')} (got ${JSON.stringify(action)})`);
	}
	const recordId = value.recordId;
	if (!isMemoryRecordId(recordId)) {
		throw new Error(`${label}: recordId must be a MEM- record id`);
	}
	const fromAgent = value.fromAgent;
	const toAgent = value.toAgent;
	if (!isAgentIdRef(fromAgent) || !isAgentIdRef(toAgent)) {
		throw new Error(`${label}: fromAgent/toAgent must be agent ids`);
	}
	if (fromAgent === toAgent) {
		throw new Error(`${label}: fromAgent and toAgent must differ (an agent does not share with itself)`);
	}
	const actor = value.actor;
	if (!isActor(actor)) {
		throw new Error(`${label}: actor must be one of agent|human|tool`);
	}
	const ts = value.ts;
	if (!isPositiveInteger(ts)) {
		throw new Error(`${label}: ts must be a positive integer (epoch ms)`);
	}
	const reason = value.reason;
	if (!isNonEmptyString(reason)) {
		throw new Error(`${label}: reason must be a non-empty string`);
	}
	return { id, action: action as ShareAction, recordId, fromAgent, toAgent, actor, ts, reason };
}

/** Strict validation of the index envelope. */
export function validateMemoryIndex(value: unknown): MemoryIndex {
	if (!isPlainObject(value) || !hasKeys(value, ['$schema', 'journals', 'entries', 'generatedAt'])) {
		throw new Error('flauz.memory.index/v1: envelope validation failed: expected exactly the keys [$schema, entries, generatedAt, journals]');
	}
	if (value.$schema !== MEMORY_INDEX_SCHEMA) {
		throw new Error(`flauz.memory.index/v1: envelope validation failed: $schema must be '${MEMORY_INDEX_SCHEMA}' (got ${JSON.stringify(value.$schema)})`);
	}
	if (!Array.isArray(value.journals) || !value.journals.every(journal => typeof journal === 'string' && JOURNAL_ID_PATTERN.test(journal))) {
		throw new Error('flauz.memory.index/v1: envelope validation failed: journals must be an array of journal ids (S | P | T-NNN)');
	}
	if (new Set(value.journals).size !== value.journals.length) {
		throw new Error('flauz.memory.index/v1: envelope validation failed: journals must not contain duplicates');
	}
	if (!Array.isArray(value.entries)) {
		throw new Error('flauz.memory.index/v1: envelope validation failed: entries must be an array');
	}
	if (!isPositiveInteger(value.generatedAt)) {
		throw new Error('flauz.memory.index/v1: envelope validation failed: generatedAt must be a positive integer (epoch ms)');
	}
	for (const entry of value.entries) {
		if (entry.tier === 'task' && entry.taskId !== null && !value.journals.includes(entry.taskId)) {
			throw new Error(`flauz.memory.index/v1: envelope validation failed: task-tier entry ${String(entry.id)} names taskId '${entry.taskId}' which is not in the journals registry`);
		}
	}
	const entries = value.entries.map((entry, index) => {
		const label = `flauz.memory.index/v1: entry #${String(index)}`;
		if (!isPlainObject(entry) || !hasKeys(entry, ['id', 'tier', 'taskId', 'agentId', 'kind', 'tags', 'tokens', 'created', 'updatedAt', 'pinned', 'evidenceId'])) {
			throw new Error(`${label}: must have exactly the keys [agentId, created, evidenceId, id, kind, pinned, tags, taskId, tier, tokens, updatedAt]`);
		}
		if (!isMemoryRecordId(entry.id) || !isMemoryTier(entry.tier) || !isMemoryKind(entry.kind)) {
			throw new Error(`${label}: id/tier/kind must be memory shapes`);
		}
		if (!Array.isArray(entry.tags) || !entry.tags.every(tag => typeof tag === 'string' && TAG_PATTERN.test(tag))) {
			throw new Error(`${label}: tags must be an array of [a-z0-9][a-z0-9-]{0,31} strings`);
		}
		const tokens = entry.tokens;
		if (typeof tokens !== 'number' || !Number.isSafeInteger(tokens) || tokens < 1) {
			throw new Error(`${label}: tokens must be a positive integer (the deterministic estimate)`);
		}
		if (!isPositiveInteger(entry.created) || !isPositiveInteger(entry.updatedAt)) {
			throw new Error(`${label}: created/updatedAt must be positive integers`);
		}
		if (typeof entry.pinned !== 'boolean') {
			throw new Error(`${label}: pinned must be a boolean`);
		}
		if (entry.evidenceId !== null && !isEvidenceIdRef(entry.evidenceId)) {
			throw new Error(`${label}: evidenceId must be E-NNNNNN or null`);
		}
		const entryTaskId = entry.taskId;
		if (entryTaskId !== null && typeof entryTaskId !== 'string') {
			throw new Error(`${label}: taskId must be T-NNN or null`);
		}
		if (typeof entryTaskId === 'string' && !TASK_ID_PATTERN.test(entryTaskId)) {
			throw new Error(`${label}: taskId must be T-NNN or null`);
		}
		if (entry.agentId !== null && !isAgentIdRef(entry.agentId)) {
			throw new Error(`${label}: agentId must be an agent id or null`);
		}
		const typed = entry as unknown as MemoryIndexEntry;
		return { ...typed, tags: [...typed.tags] };
	});
	return { $schema: MEMORY_INDEX_SCHEMA, journals: [...value.journals], entries, generatedAt: value.generatedAt };
}

// ---------------------------------------------------------------------------
// Serialization (DL-9 discipline)
// ---------------------------------------------------------------------------

/** Canonical compact journal line of a memory record. */
export function memoryRecordLine(record: MemoryRecord): string {
	return canonicalJson(record);
}

/** Canonical compact journal line of a promotion record. */
export function promotionLine(record: PromotionRecord): string {
	return canonicalJson(record);
}

/** Canonical compact journal line of a share record. */
export function shareLine(record: ShareRecord): string {
	return canonicalJson(record);
}

/** Canonical envelope serialization of the index (sorted keys, 2-space, one trailing newline). */
export function serializeMemoryIndex(index: MemoryIndex): string {
	return JSON.stringify(deepSorted(index), null, 2) + '\n';
}

/**
 * Deterministic token estimate used by the index and the context compiler
 * (M2). Model-agnostic BY DESIGN (no vendor coupling): words + punctuation
 * tokens, clamped to >= 1 - the budget seam carries real model budgets as
 * data; this estimate only ranks/charges memory content consistently.
 */
export function estimateTokens(text: string): number {
	const words = text.split(/\s+/).filter(part => part.length > 0).length;
	const punctuation = (text.match(/[,;:!?()[\]{}>"'=|/\\]+/g) ?? []).length;
	return Math.max(1, words + punctuation);
}
