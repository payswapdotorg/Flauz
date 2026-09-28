/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The tiered memory store (TL2-003 M1).
 *
 * Tiers (work order TL2-003): session/working memory (the live task), task
 * memory (persisted per task id), project/long-term memory (cross-task,
 * retrievable). Write policies are EXPLICIT and RECORDED: every promote /
 * demote / compact / pin appends a row to promotions.jsonl - the write-policy
 * log is the audit trail of every tier movement and of the ONLY sanctioned
 * journal rewrites (compaction + moves).
 *
 * NO FABRICATED MEMORY: a record exists only when a real event produced it -
 * record() requires caller-supplied provenance (actor, origin, event ts, the
 * evidence row when applicable) and the validator enforces origin-specific
 * linkage (ledger-row => evidenceId; task-event => taskId; authorization =>
 * task-event origin only).
 *
 * HUMAN AUTHORIZATION PRESERVED: authorization-bearing records never
 * auto-promote - promote/demote of kind 'authorization' requires an explicit
 * human approval row (humanApproved + actor 'human'); compaction never evicts
 * them.
 *
 * Node-free core: IO through FileSystemPort/Clock only.
 */

import {
	type Actor,
	type Clock,
	type FileSystemPort,
	canonicalJson,
	joinPath,
	sha256Hex,
} from '../../flauz-workspace/src/api.ts';
import {
	INDEX_PATH,
	type MemoryIndex,
	type MemoryIndexEntry,
	MEMORY_DIR,
	MEMORY_TASKS_DIR,
	type MemoryRecord,
	type MemoryRecordInput,
	type MemoryTier,
	PROMOTIONS_PATH,
	PROJECT_JOURNAL_PATH,
	type PromotionRecord,
	SESSION_JOURNAL_PATH,
	type ShareRecord,
	SHARES_PATH,
	estimateTokens,
	hasKey,
	journalSeqOf,
	isAgentIdRef,
	isEvidenceIdRef,
	isMemoryKind,
	isMemoryOrigin,
	isMemoryRecordId,
	isMemoryTier,
	journalIdFor,
	journalIdOf,
	memoryRecordId,
	memoryRecordLine,
	promotionLine,
	promotionRecordId,
	serializeMemoryIndex,
	shareLine,
	shareRecordId,
	taskJournalPath,
	validateMemoryIndex,
	validateMemoryRecord,
	validatePromotionRecord,
	validateShareRecord,
} from './api.ts';

/** Retention caps (the compaction thresholds; records above the cap are evicted oldest-first, pinned/authorization exempt). */
export interface RetentionCaps {
	readonly session?: number;
	readonly task?: number;
	readonly project?: number;
}

const DEFAULT_CAPS: { readonly session: number; readonly task: number; readonly project: number } = {
	session: 200,
	task: 500,
	project: 2000,
};

export interface MemoryStoreOptions {
	readonly root: string;
	readonly fs: FileSystemPort;
	readonly clock?: Clock;
	readonly caps?: RetentionCaps;
}

export interface RecordOutcome {
	readonly record: MemoryRecord;
	/** Compaction rows minted by this append's retention pass (usually none). */
	readonly compaction?: PromotionRecord;
}

export interface MoveOutcome {
	readonly promotion: PromotionRecord;
	readonly record: MemoryRecord;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}

function journalPathOf(journalId: string): string {
	if (journalId === 'S') {
		return SESSION_JOURNAL_PATH;
	}
	if (journalId === 'P') {
		return PROJECT_JOURNAL_PATH;
	}
	return taskJournalPath(journalId);
}

function compactJournalLabel(journalId: string): string {
	if (journalId === 'S') {
		return 'session';
	}
	if (journalId === 'P') {
		return 'project';
	}
	return `task:${journalId}`;
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

export class MemoryStore {
	private readonly root: string;
	private readonly fs: FileSystemPort;
	private readonly clock: Clock;
	private readonly caps: { readonly session: number; readonly task: number; readonly project: number };

	constructor(options: MemoryStoreOptions) {
		this.root = options.root;
		this.fs = options.fs;
		this.clock = options.clock ?? (() => Date.now());
		this.caps = {
			session: options.caps?.session ?? DEFAULT_CAPS.session,
			task: options.caps?.task ?? DEFAULT_CAPS.task,
			project: options.caps?.project ?? DEFAULT_CAPS.project,
		};
	}

	private abs(relative: string): string {
		return joinPath(this.root, relative);
	}

	/** Creates the memory tree + empty journals + the empty index. Idempotent. */
	async ensure(): Promise<void> {
		await this.fs.mkdir(this.abs(MEMORY_DIR));
		await this.fs.mkdir(this.abs(MEMORY_TASKS_DIR));
		for (const path of [SESSION_JOURNAL_PATH, PROJECT_JOURNAL_PATH, PROMOTIONS_PATH, SHARES_PATH]) {
			if (await this.fs.readFileUtf8(this.abs(path)) === undefined) {
				await this.fs.writeFile(this.abs(path), '');
			}
		}
		if (await this.fs.readFileUtf8(this.abs(INDEX_PATH)) === undefined) {
			await this.persistIndex({ $schema: 'flauz.memory.index/v1', journals: ['S', 'P'], entries: [], generatedAt: this.clock() });
		}
	}

	// ---------------------------------------------------------------------------
	// Recording (the only way records come to exist)
	// ---------------------------------------------------------------------------

	/** Appends a record to a tier journal with caller-supplied provenance (the no-fabrication gate). */
	async record(tier: MemoryTier, input: MemoryRecordInput): Promise<RecordOutcome> {
		if (!isMemoryTier(tier)) {
			throw new Error(`flauz.memory: record tier must be one of session|task|project (got ${JSON.stringify(tier)})`);
		}
		const provenance = input.provenance;
		if (!isPlainObject(provenance) || !hasKey(provenance, 'actor') || !hasKey(provenance, 'origin') || !hasKey(provenance, 'ts')) {
			throw new Error('flauz.memory: record requires provenance {actor, origin, ts, evidenceId?} - the real event that produced this record');
		}
		if (!isMemoryKind(input.kind)) {
			throw new Error(`flauz.memory: record kind must be one of observation|instruction|summary|decision-ref|evidence-ref|authorization (got ${JSON.stringify(input.kind)})`);
		}
		if (!isNonEmptyString(input.content)) {
			throw new Error('flauz.memory: record content must be a non-empty string');
		}
		if (!isMemoryOrigin(provenance.origin)) {
			throw new Error(`flauz.memory: provenance.origin must be one of task-event|ledger-row|a2a-message|human-note|context-compilation|workflow-run|recovery|promotion (got ${JSON.stringify(provenance.origin)})`);
		}
		const taskId = input.taskId ?? null;
		const agentId = input.agentId ?? null;
		if (tier === 'session' && (taskId === null || agentId === null)) {
			throw new Error('flauz.memory: session tier records require taskId AND agentId (the live task scope)');
		}
		if (tier === 'task' && taskId === null) {
			throw new Error('flauz.memory: task tier records require taskId (records persist per task id)');
		}
		if (tier === 'project' && taskId !== null) {
			throw new Error('flauz.memory: project tier records are cross-task (taskId must be null)');
		}
		if (provenance.origin === 'ledger-row' && !isEvidenceIdRef(provenance.evidenceId ?? null)) {
			throw new Error('flauz.memory: origin \'ledger-row\' requires provenance.evidenceId (the E-NNNNNN row this record derived from - no fabricated memory)');
		}
		if (provenance.origin === 'task-event' && taskId === null) {
			throw new Error('flauz.memory: origin \'task-event\' requires the taskId the event belongs to');
		}
		const evidenceId = provenance.evidenceId ?? null;
		if (evidenceId !== null && !isEvidenceIdRef(evidenceId)) {
			throw new Error('flauz.memory: provenance.evidenceId must match /^E-\\d{6,}$/ or be null');
		}
		const tags = input.tags === undefined ? [] : [...input.tags];
		for (const tag of tags) {
			if (typeof tag !== 'string' || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(tag)) {
				throw new Error(`flauz.memory: record tags must match [a-z0-9][a-z0-9-]{0,31} (got ${JSON.stringify(tag)})`);
			}
		}
		const journalId = journalIdFor(tier, taskId);
		const journalRel = journalPathOf(journalId);
		if (tier === 'task') {
			await this.fs.mkdir(this.abs(MEMORY_TASKS_DIR));
			// Register the journal BEFORE the append (a crash between the two
			// leaves an empty registered journal - harmless; the reverse would
			// orphan a populated journal).
			await this.ensureJournalRegistered(journalId);
		}
		const existingText = await this.fs.readFileUtf8(this.abs(journalRel)) ?? '';
		// Ids are minted from the max existing seq + 1 (compaction rewrites
		// create gaps, so line count is NOT the sequence - uniqueness is the
		// law, not contiguity).
		const existing = this.parseJournal(existingText, journalRel);
		const seq = existing.length === 0 ? 1 : Math.max(...existing.map(record => journalSeqOf(record.id) ?? 0)) + 1;
		const id = memoryRecordId(journalId, seq);
		const now = this.clock();
		const record: MemoryRecord = {
			id,
			tier,
			taskId,
			agentId,
			kind: input.kind,
			content: input.content,
			tags,
			pinned: input.pinned ?? false,
			timing: { created: now, updatedAt: now },
			provenance: {
				actor: provenance.actor,
				origin: provenance.origin,
				contentHash: sha256Hex(input.content),
				ts: provenance.ts,
				evidenceId,
			},
		};
		// Validate BEFORE persisting (strict unknown-keys + origin-linkage law).
		validateMemoryRecord(record);
		await this.fs.appendFile(this.abs(journalRel), `${memoryRecordLine(record)}\n`);
		await this.rebuildIndex();
		let compaction: PromotionRecord | undefined;
		try {
			compaction = await this.applyRetention(journalId);
		} catch (err) {
			// The append already persisted (data preservation beats the cap);
			// an impossible compaction surfaces through verify() as an over-cap
			// problem row instead of failing the caller post-write.
			void err;
		}
		if (compaction !== undefined) {
			await this.rebuildIndex();
		}
		return compaction === undefined ? { record } : { record, compaction };
	}

	// ---------------------------------------------------------------------------
	// Reading
	// ---------------------------------------------------------------------------

	/** Loads a record by id (journal derived from the id - ids are journal-scoped). */
	async get(recordId: string): Promise<MemoryRecord | undefined> {
		if (!isMemoryRecordId(recordId)) {
			return undefined;
		}
		const journalId = journalIdForId(recordId);
		const text = await this.fs.readFileUtf8(this.abs(journalPathOf(journalId))) ?? '';
		const records = this.parseJournal(text, journalPathOf(journalId));
		return records.find(candidate => candidate.id === recordId);
	}

	/** Lists records of one tier (task tier lists ALL task journals). */
	async list(tier: MemoryTier): Promise<MemoryRecord[]> {
		const journals = await this.rawKnownJournals();
		const out: MemoryRecord[] = [];
		for (const journalId of journals) {
			if (tierOfJournal(journalId) !== tier) {
				continue;
			}
			const text = await this.fs.readFileUtf8(this.abs(journalPathOf(journalId))) ?? '';
			out.push(...this.parseJournal(text, journalPathOf(journalId)));
		}
		return out.sort((a, b) => (a.id < b.id ? -1 : 1));
	}

	/** Lists every record across every journal (index-driven discovery). */
	async listAll(): Promise<MemoryRecord[]> {
		const journals = await this.rawKnownJournals();
		const out: MemoryRecord[] = [];
		for (const journalId of journals) {
			const text = await this.fs.readFileUtf8(this.abs(journalPathOf(journalId))) ?? '';
			out.push(...this.parseJournal(text, journalPathOf(journalId)));
		}
		return out.sort((a, b) => (a.id < b.id ? -1 : 1));
	}

	/** The persisted retrieval index (validated; the M2 input). */
	async index(): Promise<MemoryIndex> {
		const raw = await this.fs.readFileUtf8(this.abs(INDEX_PATH));
		if (raw === undefined) {
			throw new Error('flauz.memory: index.json not found at .flauz/memory/index.json (ensure() required)');
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch (err) {
			throw new Error(`flauz.memory: index.json is not valid JSON: ${(err as Error).message}`);
		}
		return validateMemoryIndex(parsed);
	}

	private parseJournal(text: string, journalRel: string): MemoryRecord[] {
		const records: MemoryRecord[] = [];
		const lines = splitLines(text);
		for (const [index, line] of lines.entries()) {
			const lineNo = index + 1;
			let parsed: unknown;
			try {
				parsed = JSON.parse(line);
			} catch (err) {
				throw new Error(`flauz.memory: journal ${journalRel} line ${String(lineNo)} is not valid JSON: ${(err as Error).message}`);
			}
			try {
				records.push(validateMemoryRecord(parsed));
			} catch (err) {
				throw new Error(`flauz.memory: journal ${journalRel} line ${String(lineNo)}: ${(err as Error).message}`);
			}
		}
		return records;
	}

	// ---------------------------------------------------------------------------
	// Write policies: promote / demote / pin / unpin / compact
	// ---------------------------------------------------------------------------

	/**
	 * Moves a record between tiers (the explicit write policy). The move is
	 * recorded in promotions.jsonl; authorization-bearing records require an
	 * explicit human approval (humanApproved=true + actor 'human') - they
	 * NEVER auto-promote.
	 */
	async move(recordId: string, toTier: MemoryTier, options: { reason: string; actor: Actor; humanApproved: boolean }): Promise<MoveOutcome> {
		const source = await this.get(recordId);
		if (source === undefined) {
			throw new Error(`flauz.memory: cannot promote - unknown record '${recordId}'`);
		}
		if (!isMemoryTier(toTier)) {
			throw new Error(`flauz.memory: target tier must be one of session|task|project (got ${JSON.stringify(toTier)})`);
		}
		if (!isNonEmptyString(options.reason)) {
			throw new Error('flauz.memory: move requires a non-empty reason (write policies are explicit and recorded)');
		}
		if (source.tier === toTier) {
			throw new Error(`flauz.memory: record '${recordId}' is already in tier '${toTier}'`);
		}
		if (source.kind === 'authorization' && !(options.humanApproved && options.actor === 'human')) {
			throw new Error(`flauz.memory: authorization-bearing records never auto-promote - moving '${recordId}' requires humanApproved=true with actor 'human' (the existing human gate stays human-gated)`);
		}
		const targetTaskId = toTier === 'project' ? null : source.taskId;
		if (toTier === 'session' && (targetTaskId === null || source.agentId === null)) {
			throw new Error(`flauz.memory: session tier requires taskId + agentId scope; '${recordId}' cannot demote into session without both`);
		}
		if (toTier === 'task' && targetTaskId === null) {
			throw new Error(`flauz.memory: task tier requires taskId; '${recordId}' has no task scope to persist into`);
		}
		const now = this.clock();
		const sourceJournalId = journalIdFor(source.tier, source.taskId);
		const targetJournalId = journalIdFor(toTier, targetTaskId);
		// Mint the target record (created preserved; provenance origin 'promotion').
		const targetJournalRel = journalPathOf(targetJournalId);
		if (toTier === 'task') {
			await this.fs.mkdir(this.abs(MEMORY_TASKS_DIR));
			await this.ensureJournalRegistered(targetJournalId);
		}
		const targetText = await this.fs.readFileUtf8(this.abs(targetJournalRel)) ?? '';
		const targetExisting = this.parseJournal(targetText, targetJournalRel);
		const targetSeq = targetExisting.length === 0 ? 1 : Math.max(...targetExisting.map(record => journalSeqOf(record.id) ?? 0)) + 1;
		const moved: MemoryRecord = {
			id: memoryRecordId(targetJournalId, targetSeq),
			tier: toTier,
			taskId: targetTaskId,
			agentId: source.agentId,
			kind: source.kind,
			content: source.content,
			tags: [...source.tags],
			pinned: source.pinned,
			timing: { created: source.timing.created, updatedAt: now },
			provenance: {
				actor: options.actor,
				origin: 'promotion',
				contentHash: source.provenance.contentHash,
				ts: now,
				evidenceId: source.provenance.evidenceId,
			},
		};
		validateMemoryRecord(moved);
		// Remove from the source journal (the recorded move is the audit trail).
		const sourceJournalRel = journalPathOf(sourceJournalId);
		const sourceText = await this.fs.readFileUtf8(this.abs(sourceJournalRel)) ?? '';
		const remaining = this.parseJournal(sourceText, sourceJournalRel).filter(candidate => candidate.id !== recordId);
		await this.rewriteJournal(sourceJournalRel, remaining);
		await this.fs.appendFile(this.abs(targetJournalRel), `${memoryRecordLine(moved)}\n`);
		const promotion = await this.appendPromotion({
			action: toTier === 'project' || (source.tier === 'session' && toTier === 'task') ? 'promote' : 'demote',
			ts: now,
			actor: options.actor,
			humanApproved: options.humanApproved,
			recordId,
			resultRecordId: moved.id,
			journal: null,
			fromTier: source.tier,
			toTier,
			reason: options.reason,
			droppedRecordIds: [],
		});
		await this.rebuildIndex();
		return { promotion, record: moved };
	}

	/** Pins/unpins a record (pinned records are compaction-exempt). */
	async setPinned(recordId: string, pinned: boolean, options: { reason: string; actor: Actor }): Promise<PromotionRecord> {
		const record = await this.get(recordId);
		if (record === undefined) {
			throw new Error(`flauz.memory: cannot pin - unknown record '${recordId}'`);
		}
		const journalId = journalIdFor(record.tier, record.taskId);
		const journalRel = journalPathOf(journalId);
		const text = await this.fs.readFileUtf8(this.abs(journalRel)) ?? '';
		const records = this.parseJournal(text, journalRel);
		const target = records.find(candidate => candidate.id === recordId);
		if (target === undefined) {
			throw new Error(`flauz.memory: record '${recordId}' not found in its journal`);
		}
		const now = this.clock();
		const updated: MemoryRecord = { ...target, pinned, timing: { ...target.timing, updatedAt: now } };
		validateMemoryRecord(updated);
		const replaced = records.map(candidate => candidate.id === recordId ? updated : candidate);
		await this.rewriteJournal(journalRel, replaced);
		const promotion = await this.appendPromotion({
			action: pinned ? 'pin' : 'unpin',
			ts: now,
			actor: options.actor,
			humanApproved: false,
			recordId,
			resultRecordId: null,
			journal: null,
			fromTier: null,
			toTier: null,
			reason: options.reason,
			droppedRecordIds: [],
		});
		await this.rebuildIndex();
		return promotion;
	}

	/**
	 * Retention pass over one journal: evicts oldest-first unpinned records
	 * (authorization-bearing records are NEVER evicted) until the journal is
	 * within its cap. Returns the compact promotion record, or undefined when
	 * already within cap. THE only other sanctioned journal rewrite.
	 */
	async compact(journalId: string): Promise<PromotionRecord | undefined> {
		const cap = this.capOf(journalId);
		const journalRel = journalPathOf(journalId);
		const text = await this.fs.readFileUtf8(this.abs(journalRel)) ?? '';
		const records = this.parseJournal(text, journalRel);
		if (records.length <= cap) {
			return undefined;
		}
		const evictable = records.filter(record => !record.pinned && record.kind !== 'authorization');
		const excess = records.length - cap;
		if (evictable.length === 0) {
			throw new Error(`flauz.memory: journal '${journalId}' is over its cap (${String(records.length)}/${String(cap)}) but every record is pinned or authorization-bearing - refusing to evict; raise the cap or unpin explicitly`);
		}
		// Oldest first (by created, then journal position).
		const ordered = [...evictable].sort((a, b) => a.timing.created === b.timing.created ? (a.id < b.id ? -1 : 1) : (a.timing.created - b.timing.created));
		const dropped = ordered.slice(0, Math.min(excess, evictable.length));
		const droppedIds = new Set(dropped.map(record => record.id));
		const kept = records.filter(record => !droppedIds.has(record.id));
		await this.rewriteJournal(journalRel, kept);
		const promotion = await this.appendPromotion({
			action: 'compact',
			ts: this.clock(),
			actor: 'tool',
			humanApproved: false,
			recordId: null,
			resultRecordId: null,
			journal: compactJournalLabel(journalId),
			fromTier: null,
			toTier: null,
			reason: `retention cap ${String(cap)} exceeded (${String(records.length)} records); evicted ${String(dropped.length)} oldest unpinned non-authorization records`,
			droppedRecordIds: dropped.map(record => record.id),
		});
		await this.rebuildIndex();
		return promotion;
	}

	private capOf(journalId: string): number {
		if (journalId === 'S') {
			return this.caps.session;
		}
		if (journalId === 'P') {
			return this.caps.project;
		}
		return this.caps.task;
	}

	private async applyRetention(journalId: string): Promise<PromotionRecord | undefined> {
		return this.compact(journalId);
	}

	// ---------------------------------------------------------------------------
	// Share records (the M4 private-context boundary enforcement data)
	// ---------------------------------------------------------------------------

	/** Grants a peer read access to one private record (explicit share record). */
	async share(recordId: string, toAgent: string, options: { reason: string; actor: Actor }): Promise<ShareRecord> {
		return this.appendShare('grant', recordId, toAgent, options);
	}

	/** Revokes a previously granted share (last record wins). */
	async revokeShare(recordId: string, toAgent: string, options: { reason: string; actor: Actor }): Promise<ShareRecord> {
		return this.appendShare('revoke', recordId, toAgent, options);
	}

	private async appendShare(action: 'grant' | 'revoke', recordId: string, toAgent: string, options: { reason: string; actor: Actor }): Promise<ShareRecord> {
		const record = await this.get(recordId);
		if (record === undefined) {
			throw new Error(`flauz.memory: cannot ${action} share - unknown record '${recordId}'`);
		}
		if (record.agentId === null) {
			throw new Error(`flauz.memory: record '${recordId}' is not agent-private (agentId null) - nothing to share`);
		}
		if (!isAgentIdRef(toAgent)) {
			throw new Error(`flauz.memory: toAgent must be an agent id (got ${JSON.stringify(toAgent)})`);
		}
		if (toAgent === record.agentId) {
			throw new Error(`flauz.memory: record '${recordId}' is already owned by '${toAgent}' (no self-share)`);
		}
		const text = await this.fs.readFileUtf8(this.abs(SHARES_PATH)) ?? '';
		const seq = splitLines(text).length + 1;
		const row: ShareRecord = {
			id: shareRecordId(seq),
			action,
			recordId,
			fromAgent: record.agentId,
			toAgent,
			actor: options.actor,
			ts: this.clock(),
			reason: options.reason,
		};
		validateShareRecord(row);
		await this.fs.appendFile(this.abs(SHARES_PATH), `${shareLine(row)}\n`);
		return row;
	}

	/** Every share record (the private-context read gate input). */
	async shares(): Promise<ShareRecord[]> {
		const text = await this.fs.readFileUtf8(this.abs(SHARES_PATH)) ?? '';
		return splitLines(text).map((line, index) => {
			const lineNo = index + 1;
			try {
				return validateShareRecord(JSON.parse(line));
			} catch (err) {
				throw new Error(`flauz.memory: shares journal line ${String(lineNo)}: ${(err as Error).message}`);
			}
		});
	}

	/** The promotion (write-policy) log. */
	async promotions(): Promise<PromotionRecord[]> {
		const text = await this.fs.readFileUtf8(this.abs(PROMOTIONS_PATH)) ?? '';
		return splitLines(text).map((line, index) => {
			const lineNo = index + 1;
			try {
				return validatePromotionRecord(JSON.parse(line));
			} catch (err) {
				throw new Error(`flauz.memory: promotions journal line ${String(lineNo)}: ${(err as Error).message}`);
			}
		});
	}

	// ---------------------------------------------------------------------------
	// Index + verification
	// ---------------------------------------------------------------------------

	/** Registers a journal in the index registry when absent (idempotent, atomic). */
	private async ensureJournalRegistered(journalId: string): Promise<void> {
		const index = await this.index();
		if (index.journals.includes(journalId)) {
			return;
		}
		const journals = [...index.journals, journalId].sort();
		const updated: MemoryIndex = { ...index, journals };
		await this.persistIndex(updated);
	}

	/** Rebuilds the index from the journals (the recovery pass primitive) and persists it atomically. */
	async rebuildIndex(journalHint?: string): Promise<MemoryIndex> {
		const journals = await this.rawKnownJournals(journalHint);
		const entries: MemoryIndexEntry[] = [];
		for (const journalId of journals) {
			const text = await this.fs.readFileUtf8(this.abs(journalPathOf(journalId))) ?? '';
			for (const record of this.parseJournal(text, journalPathOf(journalId))) {
				entries.push(this.indexEntryOf(record));
			}
		}
		entries.sort((a, b) => (a.id < b.id ? -1 : 1));
		const registry = [...journals].sort();
		const index: MemoryIndex = { $schema: 'flauz.memory.index/v1', journals: registry, entries, generatedAt: this.clock() };
		await this.persistIndex(index);
		return index;
	}

	/**
	 * Journal discovery: the index journals REGISTRY is the source of truth
	 * (registered before any task-journal append); the promotions log is the
	 * fallback for a corrupt/absent index. `journalHint` covers the in-flight
	 * journal during registry updates.
	 */
	private async rawKnownJournals(journalHint?: string): Promise<string[]> {
		const ids = new Set<string>(['S', 'P']);
		if (journalHint !== undefined && journalHint !== 'S' && journalHint !== 'P') {
			ids.add(journalHint);
		}
		const indexRaw = await this.fs.readFileUtf8(this.abs(INDEX_PATH));
		if (indexRaw !== undefined) {
			try {
				const index = validateMemoryIndex(JSON.parse(indexRaw));
				for (const journal of index.journals) {
					ids.add(journal);
				}
			} catch {
				// Corrupt index: fall through to the promotions log scan.
			}
		}
		const promotionsRaw = await this.fs.readFileUtf8(this.abs(PROMOTIONS_PATH)) ?? '';
		for (const line of splitLines(promotionsRaw)) {
			try {
				const promotion = validatePromotionRecord(JSON.parse(line));
				for (const id of [promotion.recordId, promotion.resultRecordId]) {
					const journalId = id === null ? undefined : journalIdForId(id);
					if (journalId !== undefined && journalId !== 'S' && journalId !== 'P') {
						ids.add(journalId);
					}
				}
				if (promotion.journal !== null && promotion.journal.startsWith('task:')) {
					ids.add(promotion.journal.slice('task:'.length));
				}
			} catch {
				// A malformed promotions line fails verify(); discovery skips it here.
			}
		}
		return [...ids].sort();
	}

	private indexEntryOf(record: MemoryRecord): MemoryIndexEntry {
		return {
			id: record.id,
			tier: record.tier,
			taskId: record.taskId,
			agentId: record.agentId,
			kind: record.kind,
			tags: [...record.tags],
			tokens: estimateTokens(record.content),
			created: record.timing.created,
			updatedAt: record.timing.updatedAt,
			pinned: record.pinned,
			evidenceId: record.provenance.evidenceId,
		};
	}

	private async persistIndex(index: MemoryIndex): Promise<void> {
		const target = this.abs(INDEX_PATH);
		const tmp = `${target}.tmp`;
		await this.fs.writeFile(tmp, serializeMemoryIndex(index));
		await this.fs.rename(tmp, target);
	}

	private async rewriteJournal(journalRel: string, records: readonly MemoryRecord[]): Promise<void> {
		const target = this.abs(journalRel);
		const tmp = `${target}.tmp`;
		await this.fs.writeFile(tmp, records.map(record => `${memoryRecordLine(record)}\n`).join(''));
		await this.fs.rename(tmp, target);
	}

	private async appendPromotion(input: Omit<PromotionRecord, 'id'>): Promise<PromotionRecord> {
		const text = await this.fs.readFileUtf8(this.abs(PROMOTIONS_PATH)) ?? '';
		const seq = splitLines(text).length + 1;
		const record: PromotionRecord = { ...input, id: promotionRecordId(seq) };
		validatePromotionRecord(record);
		await this.fs.appendFile(this.abs(PROMOTIONS_PATH), `${promotionLine(record)}\n`);
		return record;
	}

	/**
	 * Integrity verdict: every journal parses + validates, record ids match
	 * their journal positions, provenance contentHashes recompute, and the
	 * persisted index equals the rebuilt index (parity - a stale/drifted index
	 * is a verdict, not a silent success).
	 */
	async verify(): Promise<{ ok: boolean; records: number; problems: readonly string[] }> {
		const problems: string[] = [];
		const journals = await this.rawKnownJournals();
		const seenIds = new Map<string, Set<string>>();
		let count = 0;
		for (const journalId of journals) {
			const journalRel = journalPathOf(journalId);
			const text = await this.fs.readFileUtf8(this.abs(journalRel)) ?? '';
			const lines = splitLines(text);
			for (const [index, line] of lines.entries()) {
				const lineNo = index + 1;
				let record: MemoryRecord;
				try {
					record = validateMemoryRecord(JSON.parse(line));
				} catch (err) {
					problems.push(`${journalRel} line ${String(lineNo)}: ${(err as Error).message}`);
					continue;
				}
				const idJournal = journalIdOf(record.id);
				if (idJournal !== journalId) {
					problems.push(`${journalRel} line ${String(lineNo)}: id '${record.id}' belongs to journal '${String(idJournal)}' (the id/journal scope law)`);
				}
				const seen = seenIds.get(journalId) ?? new Set<string>();
				if (seen.has(record.id)) {
					problems.push(`${journalRel} line ${String(lineNo)}: duplicate record id '${record.id}' (ids are minted from the journal's max seq - a duplicate means an id collision)`);
				}
				seen.add(record.id);
				seenIds.set(journalId, seen);
				if (record.provenance.contentHash !== sha256Hex(record.content)) {
					problems.push(`${journalRel} line ${String(lineNo)}: provenance.contentHash does not match sha256(content) - record content mutated after the fact`);
				}
				count += 1;
			}
		}
		// Index parity (entries + journals registry).
		try {
			const persisted = await this.index();
			const rebuilt: MemoryIndexEntry[] = [];
			for (const journalId of journals) {
				const text = await this.fs.readFileUtf8(this.abs(journalPathOf(journalId))) ?? '';
				for (const record of this.parseJournal(text, journalPathOf(journalId))) {
					rebuilt.push(this.indexEntryOf(record));
				}
			}
			rebuilt.sort((a, b) => (a.id < b.id ? -1 : 1));
			const persistedEntries = [...persisted.entries].sort((a, b) => (a.id < b.id ? -1 : 1));
			if (canonicalJson(persistedEntries) !== canonicalJson(rebuilt)) {
				problems.push('index.json does not match the journals (stale or drifted index - rebuildIndex() restores parity)');
			}
			const taskJournalsOfEntries = rebuilt
				.map(entry => entry.tier === 'task' && entry.taskId !== null ? entry.taskId : '')
				.filter(id => id.length > 0);
			const expectedRegistry = [...new Set([...journals, ...taskJournalsOfEntries])].sort();
			if (canonicalJson([...persisted.journals].sort()) !== canonicalJson(expectedRegistry)) {
				problems.push('index.json journals registry does not match the discovered journals (stale registry - rebuildIndex() restores parity)');
			}
		} catch (err) {
			problems.push(`index.json: ${(err as Error).message}`);
		}
		// Retention: over-cap journals are verdicts (caps are the recorded rule).
		for (const journalId of journals) {
			const text = await this.fs.readFileUtf8(this.abs(journalPathOf(journalId))) ?? '';
			const records = this.parseJournal(text, journalPathOf(journalId));
			const evictable = records.filter(record => !record.pinned && record.kind !== 'authorization').length;
			if (records.length > this.capOf(journalId) && evictable < records.length - this.capOf(journalId)) {
				problems.push(`journal '${journalId}' is over its retention cap (${String(records.length)}/${String(this.capOf(journalId))}) and compaction cannot recover it (${String(evictable)} evictable of ${String(records.length - this.capOf(journalId))} needed) - raise the cap or unpin records explicitly`);
			}
		}
		// Write-policy + shares journals parse.
		for (const [path, validate] of [[PROMOTIONS_PATH, validatePromotionRecord] as const, [SHARES_PATH, validateShareRecord] as const]) {
			const text = await this.fs.readFileUtf8(this.abs(path)) ?? '';
			for (const [index, line] of splitLines(text).entries()) {
				try {
					validate(JSON.parse(line));
				} catch (err) {
					problems.push(`${path} line ${String(index + 1)}: ${(err as Error).message}`);
				}
			}
		}
		return { ok: problems.length === 0, records: count, problems };
	}
}

function journalIdForId(recordId: string): string {
	const match = /^MEM-(S|P|T-\d{3,})-/.exec(recordId);
	if (match === null) {
		throw new Error(`flauz.memory: '${recordId}' is not a record id`);
	}
	return match[1] as string;
}

function tierOfJournal(journalId: string): MemoryTier {
	if (journalId === 'S') {
		return 'session';
	}
	if (journalId === 'P') {
		return 'project';
	}
	return 'task';
}
