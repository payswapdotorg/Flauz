/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL3-006 — the browser-session journal bridge (the PIN-1 READ-ONLY consumer).
 *
 * flauz-browser appends session lifecycle facts to
 * `.flauz/browser-sessions.jsonl` (envelope `flauz.browser-session-journal/v0`,
 * CROSS-WORKER CONTRACT PIN-1: one canonical-JSON record + `\n` per
 * open/state-transition/close/failure, MANDATORY actor, full descriptor
 * snapshots). THIS MODULE is the read-only consumer that contract was built
 * for: it turns journaled browser sessions into first-class continuable
 * resources of the flauz-resources graph.
 *
 * Design law (no cross-extension imports — DL-32): the journal record shape,
 * the actor/event enums, the session/tab state vocabularies and the id
 * grammars are DUPLICATED HERE AS TYPES and pinned by the EXISTING repo-root
 * fixtures at `test/fixtures/browser-session-journal/` (valid + the three
 * invalid samples — consumed READ-ONLY, never modified).
 *
 * Reader semantics (fail-closed per line, never a crash): every line is
 * validated against the pinned contract INCLUDING canonicality (the bytes
 * must equal the canonical JSON serialization of the parsed record — a
 * non-canonical line is a contract deviation). An invalid line becomes a
 * TYPED SKIP `{line, reason}`; valid lines keep flowing. A journal with zero
 * valid lines syncs zero sessions (never an error).
 *
 * Graph semantics:
 *   - ResourceRef identity derives from the journal's LOGICAL `sessionId`
 *     (exactly `flauz:browser:<16-hex>` — already the pinned browser-session
 *     ref id grammar); NEVER from tab ids, target ids or paths.
 *   - Kind reuse: kind `browser-session` (the existing vocabulary — no
 *     parallel kind is invented).
 *   - The latest descriptor per session (max ts, tie-break by file order)
 *     drives a versioned browser surface `{kind:'browser', partition,
 *     tabIds}` — addSurface retains the prior version (identity survives
 *     access-surface change). An unchanged surface is a no-op.
 *   - Edges are minted ONLY from EXPLICIT caller attribution (a provenance-
 *     carrying assertion): `bound-to` session -> environment and
 *     `depends-on` session -> task. The v0 journal carries NO environment or
 *     task attribution fields, so an unattributed sync mints NO edges —
 *     never fabricated. Attribution targets must exist as graph refs
 *     (typed NOT_FOUND otherwise — no dangling endpoints).
 *   - Every mutation flows through ResourceGraph (fail-closed provenance;
 *     each mutation is recorded in the existing `.flauz/resources-ops.jsonl`
 *     with the sync caller's actor).
 */
import {
	canonicalJson,
	joinPath,
	validateProvenance,
	type BrowserSurface,
	type GraphEdge,
	type ResourceProvenance,
	type Surface,
} from './api.ts';
import type { ResourceGraph } from './graph.ts';

// ---------------------------------------------------------------------------
// The PIN-1 contract, duplicated as types (DL-32; pinned by the repo fixtures)
// ---------------------------------------------------------------------------

/** Journal path relative to the workspace root (PIN-1). */
export const BROWSER_SESSION_JOURNAL_PATH = '.flauz/browser-sessions.jsonl';

/** Schema id pinned into every journal record (PIN-1). */
export const JOURNAL_SCHEMA_ID = 'flauz.browser-session-journal/v0';

/** The only journal schemaVersion this reader understands. */
export const JOURNAL_SCHEMA_VERSION = 0;

/** The actor enum (PIN-1, MANDATORY — a missing actor is a typed skip). */
export const JOURNAL_ACTORS = ['agent', 'human', 'tool'] as const;
export type JournalActor = (typeof JOURNAL_ACTORS)[number];

/** The event enum (PIN-1). */
export const JOURNAL_EVENTS = ['opened', 'state-changed', 'closed', 'failed'] as const;
export type JournalEvent = (typeof JOURNAL_EVENTS)[number];

/** Session lifecycle states (flauz-browser BROWSER_SESSION_STATES, contract-duplicated). */
export const JOURNAL_SESSION_STATES = ['opening', 'active', 'suspended', 'closed', 'failed'] as const;
export type JournalSessionState = (typeof JOURNAL_SESSION_STATES)[number];

/** Tab lifecycle states (flauz-browser BROWSER_TAB_STATES, contract-duplicated). */
export const JOURNAL_TAB_STATES = ['opening', 'active', 'suspended', 'closed', 'failed', 'lost'] as const;
export type JournalTabState = (typeof JOURNAL_TAB_STATES)[number];

const SESSION_ID_PATTERN = /^flauz:browser:[0-9a-f]{16}$/;
const TAB_ID_PATTERN = /^flauz:tab:[0-9a-f]{16}$/;

/** One journal tab record (the pinned shape). */
export interface JournalTabRecord {
	readonly tabId: string;
	readonly targetId: string;
	readonly url: string;
	readonly state: JournalTabState;
	readonly openedAt: string;
}

/** One journal descriptor snapshot (the pinned shape). */
export interface JournalSessionDescriptor {
	readonly schemaVersion: number;
	readonly sessionId: string;
	readonly initiator: 'human' | 'agent';
	readonly agentId?: string;
	readonly partition: string;
	readonly policySourceRef: string;
	readonly createdAt: string;
	readonly state: JournalSessionState;
	readonly tabs: readonly JournalTabRecord[];
	readonly error?: { readonly code: string; readonly message: string; readonly at: string };
}

/** One journal record (the pinned shape). */
export interface JournalRecord {
	readonly schemaVersion: number;
	readonly schema: string;
	readonly ts: number;
	readonly actor: JournalActor;
	readonly event: JournalEvent;
	readonly descriptor: JournalSessionDescriptor;
}

// ---------------------------------------------------------------------------
// The strict line reader (typed skips, never a crash)
// ---------------------------------------------------------------------------

/** One skipped journal line: the 1-based line number + the typed reason. */
export interface JournalSkip {
	readonly line: number;
	readonly reason: string;
}

/** The read result: valid records (file order) + typed skips. */
export interface JournalReadResult {
	readonly records: readonly JournalRecord[];
	readonly skipped: readonly JournalSkip[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function skipReason(line: number, reason: string): JournalSkip {
	return { line, reason };
}

/**
 * Validates ONE journal line against the pinned PIN-1 contract (shape +
 * enums + descriptor + CANONICALITY: the bytes must equal the canonical
 * serialization of the parsed record). Returns the record or a typed skip
 * reason — never throws.
 */
export function parseJournalLine(line: string): { ok: true; record: JournalRecord } | { ok: false; reason: string } {
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch (err) {
		return { ok: false, reason: `not valid JSON -- ${err instanceof Error ? err.message : String(err)}` };
	}
	if (!isPlainObject(parsed)) {
		return { ok: false, reason: 'record must be a JSON object' };
	}
	const keys = Object.keys(parsed).sort();
	const expected = ['actor', 'descriptor', 'event', 'schema', 'schemaVersion', 'ts'];
	if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
		return { ok: false, reason: `record key set must be exactly {${expected.join(', ')}} (got {${Object.keys(parsed).sort().join(', ')}})` };
	}
	if (parsed.schemaVersion !== JOURNAL_SCHEMA_VERSION) {
		return { ok: false, reason: `schemaVersion must be ${JOURNAL_SCHEMA_VERSION} (got ${JSON.stringify(parsed.schemaVersion)})` };
	}
	if (parsed.schema !== JOURNAL_SCHEMA_ID) {
		return { ok: false, reason: `schema must be ${JSON.stringify(JOURNAL_SCHEMA_ID)} (got ${JSON.stringify(parsed.schema)})` };
	}
	if (typeof parsed.ts !== 'number' || !Number.isInteger(parsed.ts) || parsed.ts < 0) {
		return { ok: false, reason: `ts must be a non-negative integer epoch-ms (got ${JSON.stringify(parsed.ts)})` };
	}
	if (typeof parsed.actor !== 'string' || !(JOURNAL_ACTORS as readonly string[]).includes(parsed.actor)) {
		return { ok: false, reason: `actor must be one of ${JOURNAL_ACTORS.join(', ')} (got ${JSON.stringify(parsed.actor)}) — the journal actor is MANDATORY` };
	}
	if (typeof parsed.event !== 'string' || !(JOURNAL_EVENTS as readonly string[]).includes(parsed.event)) {
		return { ok: false, reason: `event must be one of ${JOURNAL_EVENTS.join(', ')} (got ${JSON.stringify(parsed.event)})` };
	}
	const descriptorError = validateDescriptorShape(parsed.descriptor);
	if (descriptorError !== undefined) {
		return { ok: false, reason: descriptorError };
	}
	const record = parsed as unknown as JournalRecord;
	if (line !== canonicalJson(record)) {
		return { ok: false, reason: 'record is not canonical: bytes must equal the canonical JSON serialization (sorted keys, no insignificant whitespace) of the record' };
	}
	return { ok: true, record };
}

function validateDescriptorShape(value: unknown): string | undefined {
	if (!isPlainObject(value)) {
		return 'descriptor must be an object (BrowserSessionDescriptor snapshot)';
	}
	if (value.schemaVersion !== JOURNAL_SCHEMA_VERSION) {
		return `descriptor.schemaVersion must be ${JOURNAL_SCHEMA_VERSION} (got ${JSON.stringify(value.schemaVersion)})`;
	}
	if (typeof value.sessionId !== 'string' || !SESSION_ID_PATTERN.test(value.sessionId)) {
		return `descriptor.sessionId must be a logical flauz:browser:<16-hex> id (got ${JSON.stringify(value.sessionId)})`;
	}
	if (value.initiator !== 'human' && value.initiator !== 'agent') {
		return `descriptor.initiator must be 'human' or 'agent' (got ${JSON.stringify(value.initiator)})`;
	}
	if (value.agentId !== undefined && typeof value.agentId !== 'string') {
		return 'descriptor.agentId must be a string when present';
	}
	if (typeof value.partition !== 'string' || value.partition.length === 0) {
		return 'descriptor.partition must be a non-empty string';
	}
	if (typeof value.policySourceRef !== 'string' || value.policySourceRef.length === 0) {
		return 'descriptor.policySourceRef must be a non-empty string';
	}
	if (typeof value.createdAt !== 'string' || value.createdAt.length === 0) {
		return 'descriptor.createdAt must be an ISO timestamp string';
	}
	if (typeof value.state !== 'string' || !(JOURNAL_SESSION_STATES as readonly string[]).includes(value.state)) {
		return `descriptor.state must be one of ${JOURNAL_SESSION_STATES.join(', ')} (got ${JSON.stringify(value.state)})`;
	}
	if (!Array.isArray(value.tabs)) {
		return 'descriptor.tabs must be an array of tab records';
	}
	for (const [index, tab] of (value.tabs as readonly unknown[]).entries()) {
		if (!isPlainObject(tab)) {
			return `descriptor.tabs[${index}] must be an object`;
		}
		if (typeof tab.tabId !== 'string' || !TAB_ID_PATTERN.test(tab.tabId)) {
			return `descriptor.tabs[${index}].tabId must be a logical flauz:tab:<16-hex> id`;
		}
		if (typeof tab.targetId !== 'string' || tab.targetId.length === 0) {
			return `descriptor.tabs[${index}].targetId must be a non-empty string`;
		}
		if (typeof tab.url !== 'string') {
			return `descriptor.tabs[${index}].url must be a string`;
		}
		if (typeof tab.state !== 'string' || !(JOURNAL_TAB_STATES as readonly string[]).includes(tab.state)) {
			return `descriptor.tabs[${index}].state must be one of ${JOURNAL_TAB_STATES.join(', ')}`;
		}
		if (typeof tab.openedAt !== 'string' || tab.openedAt.length === 0) {
			return `descriptor.tabs[${index}].openedAt must be a non-empty string`;
		}
	}
	if (value.error !== undefined && (!isPlainObject(value.error) || typeof value.error.code !== 'string' || typeof value.error.message !== 'string' || typeof value.error.at !== 'string')) {
		return 'descriptor.error must be { code, message, at } when present';
	}
	return undefined;
}

/**
 * Reads the whole journal: every line validated; invalid lines become typed
 * skips (with the bad line number recorded), valid records keep file order.
 * An absent journal reads as empty (never an error). TRAILING blank lines are
 * tolerated (file-end artifact — the pinned fixture carries one; the PIN-1
 * writer emits exactly one record + one `\n` per append); an INTERIOR blank
 * line is a typed skip (a torn record is an anomaly worth recording).
 */
export function readSessionJournal(raw: string | undefined): JournalReadResult {
	if (raw === undefined || raw.length === 0) {
		return { records: [], skipped: [] };
	}
	const lines = raw.split('\n');
	while (lines.length > 0 && lines[lines.length - 1] === '') {
		lines.pop();
	}
	const records: JournalRecord[] = [];
	const skipped: JournalSkip[] = [];
	for (const [index, line] of lines.entries()) {
		const lineNo = index + 1;
		if (line.length === 0) {
			skipped.push(skipReason(lineNo, 'empty line (a well-formed journal holds one complete record per line)'));
			continue;
		}
		const parsed = parseJournalLine(line);
		if (parsed.ok) {
			records.push(parsed.record);
		} else {
			skipped.push(skipReason(lineNo, parsed.reason));
		}
	}
	return { records, skipped };
}

/** The latest record per session (max ts; ties broken by file order — the last wins). */
export function latestBySession(records: readonly JournalRecord[]): ReadonlyMap<string, JournalRecord> {
	const latest = new Map<string, JournalRecord>();
	for (const record of records) {
		const current = latest.get(record.descriptor.sessionId);
		if (current === undefined || record.ts >= current.ts) {
			latest.set(record.descriptor.sessionId, record);
		}
	}
	return latest;
}

// ---------------------------------------------------------------------------
// The sync (journal -> graph reconciliation, provenance-recorded)
// ---------------------------------------------------------------------------

export interface BrowserSessionBridgeOptions {
	/** The bootstrapped resource graph (mutations flow through it). */
	readonly graph: ResourceGraph;
}

/** Sync options: MANDATORY provenance + optional EXPLICIT attribution. */
export interface SyncOptions {
	/** Fail-closed provenance: the actor is MANDATORY on every recorded mutation. */
	readonly provenance: ResourceProvenance;
	/**
	 * EXPLICIT attribution: the environment ref id the synced sessions are
	 * bound to (`bound-to` edges). The v0 journal carries no environment
	 * fields — edges exist only when a provenance-carrying caller asserts
	 * the binding (never fabricated from the active-environment guess).
	 */
	readonly bindEnvironmentRefId?: string;
	/** EXPLICIT attribution: the task ref id the synced sessions served (`depends-on` edges). */
	readonly bindTaskRefId?: string;
}

/** The typed sync report. */
export interface SyncReport {
	/** Valid journal records read. */
	readonly journalRecords: number;
	/** Distinct sessions in the journal. */
	readonly sessions: number;
	/** Session ids whose refs were MINTED this run. */
	readonly refsMinted: readonly string[];
	/** Session ids whose browser surface was versioned this run. */
	readonly surfacesRefreshed: readonly string[];
	/** Edge descriptions minted this run (`kind from -> to`). */
	readonly edgesMinted: readonly string[];
	/** The typed skips (invalid journal lines; the bad line numbers recorded). */
	readonly skippedJournalLines: readonly JournalSkip[];
}

/** The browser-surface derivation from a journal descriptor (identity = sessionId, never tab ids). */
function surfaceOf(descriptor: JournalSessionDescriptor): BrowserSurface {
	const tabIds = [...new Set(descriptor.tabs.map(tab => tab.tabId))].sort();
	return {
		kind: 'browser',
		partition: descriptor.partition,
		...(tabIds.length > 0 ? { tabIds } : {}),
	};
}

function currentSurfaceOf(graph: ResourceGraph, refId: string): Surface | undefined {
	const record = graph.surfaceRecord(refId, 'browser');
	if (record === undefined) {
		return undefined;
	}
	const last = record.versions[record.versions.length - 1];
	return last === undefined ? undefined : last.surface;
}

/** Reconciles the graph from the journal (mint/refresh refs + surfaces; edges only from explicit attribution). */
export class BrowserSessionBridge {
	private readonly graph: ResourceGraph;

	constructor(options: BrowserSessionBridgeOptions) {
		this.graph = options.graph;
	}

	/** Reads the journal READ-ONLY and reconciles the graph. Never throws for bad journal lines. */
	async sync(options: SyncOptions): Promise<SyncReport> {
		const provenance = validateProvenance(options.provenance, 'sync.provenance');
		const syncProvenance: ResourceProvenance = {
			...provenance,
			...(provenance.cause === undefined ? { cause: 'browser-session journal sync (flauz.browser-session-journal/v0, read-only consumption)' } : {}),
		};
		// explicit attribution targets must exist (typed NOT_FOUND; no dangling endpoints)
		if (options.bindEnvironmentRefId !== undefined && this.graph.get(options.bindEnvironmentRefId) === undefined) {
			throw new Error(`flauz.resources/v0: sync rejected: bindEnvironmentRefId '${options.bindEnvironmentRefId}' is not a graph ref (explicit attribution must name an existing environment ref — no dangling endpoints)`);
		}
		if (options.bindTaskRefId !== undefined && this.graph.get(options.bindTaskRefId) === undefined) {
			throw new Error(`flauz.resources/v0: sync rejected: bindTaskRefId '${options.bindTaskRefId}' is not a graph ref (explicit attribution must name an existing task ref — no dangling endpoints)`);
		}
		const raw = await this.graph.port.readFileUtf8(joinPath(this.graph.workspaceRoot, BROWSER_SESSION_JOURNAL_PATH));
		const { records, skipped } = readSessionJournal(raw);
		const latest = latestBySession(records);
		const refsMinted: string[] = [];
		const surfacesRefreshed: string[] = [];
		const edgesMinted: string[] = [];
		// deterministic order: sessions sorted by id
		for (const sessionId of [...latest.keys()].sort()) {
			const record = latest.get(sessionId)!;
			// identity derives from the journal's LOGICAL sessionId — never tab ids/paths
			if (this.graph.get(sessionId) === undefined) {
				await this.graph.addRef({ kind: 'browser-session', id: sessionId, provenance: syncProvenance });
				refsMinted.push(sessionId);
			}
			const desired = surfaceOf(record.descriptor);
			const current = currentSurfaceOf(this.graph, sessionId);
			if (current === undefined || canonicalJson(current) !== canonicalJson(desired)) {
				await this.graph.addSurface(sessionId, desired, syncProvenance);
				surfacesRefreshed.push(sessionId);
			}
			// edges ONLY from explicit, provenance-recorded attribution
			if (options.bindEnvironmentRefId !== undefined) {
				const edge = await this.ensureEdge({ kind: 'bound-to', from: sessionId, to: options.bindEnvironmentRefId }, syncProvenance);
				if (edge !== undefined) {
					edgesMinted.push(`bound-to ${sessionId} -> ${options.bindEnvironmentRefId}`);
				}
			}
			if (options.bindTaskRefId !== undefined) {
				const edge = await this.ensureEdge({ kind: 'depends-on', from: sessionId, to: options.bindTaskRefId }, syncProvenance);
				if (edge !== undefined) {
					edgesMinted.push(`depends-on ${sessionId} -> ${options.bindTaskRefId}`);
				}
			}
		}
		return {
			journalRecords: records.length,
			sessions: latest.size,
			refsMinted,
			surfacesRefreshed,
			edgesMinted,
			skippedJournalLines: skipped,
		};
	}

	/** Adds an edge unless an identical one exists (idempotent syncs). */
	private async ensureEdge(input: { kind: 'bound-to' | 'depends-on'; from: string; to: string }, provenance: ResourceProvenance): Promise<GraphEdge | undefined> {
		const exists = this.graph.envelope().edges.some(edge => edge.kind === input.kind && edge.from === input.from && edge.to === input.to);
		if (exists) {
			return undefined;
		}
		return await this.graph.addEdge(input, provenance);
	}
}
