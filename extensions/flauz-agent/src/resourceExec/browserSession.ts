/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-S2 -- the PIN-1 browser-session journal reader (the task-boundary
 * adapter over flauz-browser's `.flauz/browser-sessions.jsonl`).
 *
 * Design law (DL-32, verbatim from
 * `extensions/flauz-resources/src/journalBridge.ts`): the journal record shape,
 * the actor/event enums, the session/tab state vocabularies and the id
 * grammars are DUPLICATED HERE AS TYPES and pinned by the EXISTING repo-root
 * fixtures at `test/fixtures/browser-session-journal/` (valid + the three
 * invalid samples -- consumed READ-ONLY, never modified). This module NEVER
 * imports from `extensions/flauz-browser/*` -- the contract is duplicated.
 *
 * Reader semantics (fail-closed per line, never a crash): every line is
 * validated against the pinned contract INCLUDING canonicality (the bytes
 * must equal the canonical JSON serialization of the parsed record -- a
 * non-canonical line is a contract deviation). An invalid line becomes a
 * TYPED SKIP `{line, reason}`; valid lines keep flowing. A journal with zero
 * valid lines yields zero resolvable sessions (never an error).
 *
 * Acquisition semantics (the task-boundary layer on top of the reader):
 *   - the session MUST exist in the journal (latest descriptor per session
 *     id -- max ts, tie-break by file order);
 *   - the session MUST be non-closed (`state !== 'closed'` and
 *     `state !== 'failed'`);
 *   - the session MUST be agent-initiated for an agent actor
 *     (`descriptor.initiator === 'agent'` for `actor.actor === 'agent'`);
 *     an agent actor acquiring a human-initiator session is `TRUST_REFUSED`
 *     (the human/agent separation law, pinned BOTH directions by TL3 tests);
 *   - the snapshot is the browser surface `{kind:'browser', partition,
 *     tabIds}` AT acquisition -- versioned so a SURFACE_MISMATCH is
 *     detectable at release/hand-off.
 *
 * Release semantics: the typed obligation is recorded; a session already
 * closed in the journal releases CLEANLY and idempotently (the obligation
 * is discharged -- the record states what the journal showed, never fakes
 * a teardown). The actual `flauz.browser.close` op is issued by the
 * orchestrator through the op port -- the adapter only records the verdict.
 */
import {
	BROWSER_SESSION_ID_PATTERN,
	TaskResourceError,
	canonicalJson,
	hasExactKeys,
	hasKey,
	hasOnlyKeys,
	isBoundedString,
	isPlainObject,
	isPositiveEpochMs,
	joinPath,
	type Clock,
	type FileSystemPort,
	type TaskResourceActor,
	type TaskResourceFailure,
	type TaskResourceSurfaceSnapshot,
} from './types.ts';
import {
	failure,
} from './contracts.ts';

// ---------------------------------------------------------------------------
// The PIN-1 contract, duplicated as types (DL-32; pinned by the repo fixtures)
// ---------------------------------------------------------------------------

/** Journal path relative to the workspace root (PIN-1). */
export const BROWSER_SESSION_JOURNAL_PATH = '.flauz/browser-sessions.jsonl';

/** Schema id pinned into every journal record (PIN-1). */
export const JOURNAL_SCHEMA_ID = 'flauz.browser-session-journal/v0';

/** The only journal schemaVersion this reader understands. */
export const JOURNAL_SCHEMA_VERSION = 0;

/** The actor enum (PIN-1, MANDATORY -- a missing actor is a typed skip). */
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

function skipReason(line: number, reason: string): JournalSkip {
	return { line, reason };
}

/**
 * Validates ONE journal line against the pinned PIN-1 contract (shape +
 * enums + descriptor + CANONICALITY). Returns the record or a typed reason
 * -- never throws.
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
		return { ok: false, reason: `actor must be one of ${JOURNAL_ACTORS.join(', ')} (got ${JSON.stringify(parsed.actor)}) -- the journal actor is MANDATORY` };
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
	if (typeof value.sessionId !== 'string' || !BROWSER_SESSION_ID_PATTERN.test(value.sessionId)) {
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
 * An absent journal reads as empty (never an error). TRAILING blank lines
 * are tolerated (file-end artifact); an INTERIOR blank line is a typed skip.
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

/** The latest record per session (max ts; ties broken by file order -- the last wins). */
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
// The acquisition snapshot
// ---------------------------------------------------------------------------

/** Derives the browser-surface snapshot from a journal descriptor. */
export function browserSurfaceOf(descriptor: JournalSessionDescriptor): TaskResourceSurfaceSnapshot {
	const tabIds = [...new Set(descriptor.tabs.map(tab => tab.tabId))].sort();
	return {
		kind: 'browser',
		partition: descriptor.partition,
		...(tabIds.length > 0 ? { tabIds } : {}),
	};
}

// ---------------------------------------------------------------------------
// The acquire/release result types (typed results, never raw throws at the
// boundary; PRE-FLIGHT `TaskResourceError` for programmer mistakes only)
// ---------------------------------------------------------------------------

export type BrowserAcquireResult =
	| { readonly ok: true; readonly descriptor: JournalSessionDescriptor; readonly snapshot: TaskResourceSurfaceSnapshot }
	| { readonly ok: false; readonly error: TaskResourceFailure };

export type BrowserReleaseResult =
	| { readonly ok: true; readonly journalState: JournalSessionState | 'absent'; readonly idempotent: boolean }
	| { readonly ok: false; readonly error: TaskResourceFailure };

// ---------------------------------------------------------------------------
// The read-only adapter
// ---------------------------------------------------------------------------

export interface BrowserSessionAdapterOptions {
	readonly workspaceRoot: string;
	readonly fs: FileSystemPort;
	readonly clock?: Clock;
}

/**
 * The PIN-1 read-only adapter. Owns:
 *   - journal loading + strict line validation (canonicality enforced);
 *   - latest-per-session resolution;
 *   - acquire (existence + non-closed + initiator-vs-actor trust gate);
 *   - release (idempotent; clean discharge if the session is already closed).
 *
 * NEVER calls CDP; NEVER writes to `.flauz/browser-sessions.jsonl`; NEVER
 * weakens the human/agent separation law.
 */
export class BrowserSessionAdapter {
	private readonly workspaceRoot: string;
	private readonly fs: FileSystemPort;
	private readonly clock: Clock;

	constructor(options: BrowserSessionAdapterOptions) {
		this.workspaceRoot = options.workspaceRoot;
		this.fs = options.fs;
		this.clock = options.clock ?? (() => Date.now());
	}

	get journalPath(): string {
		return joinPath(this.workspaceRoot, BROWSER_SESSION_JOURNAL_PATH);
	}

	/** Reads + validates the journal (fail-closed per line; never crashes). */
	async readJournal(): Promise<JournalReadResult> {
		const raw = await this.fs.readFileUtf8(this.journalPath);
		return readSessionJournal(raw);
	}

	/** The latest descriptor for `sessionId`, or `undefined` if absent. */
	async latestDescriptor(sessionId: string): Promise<JournalSessionDescriptor | undefined> {
		const { records } = await this.readJournal();
		const latest = latestBySession(records);
		return latest.get(sessionId)?.descriptor;
	}

	/**
	 * Acquire: the session MUST exist, be non-closed, and be agent-initiated
	 * for an agent actor (TRUST_REFUSED otherwise). Returns the descriptor +
	 * the surface snapshot AT acquisition.
	 */
	async acquire(sessionId: string, actor: TaskResourceActor): Promise<BrowserAcquireResult> {
		if (typeof sessionId !== 'string' || !BROWSER_SESSION_ID_PATTERN.test(sessionId)) {
			return { ok: false, error: failure('RESOURCE_ABSENT', `sessionId must be a logical flauz:browser:<16-hex> id (got ${JSON.stringify(sessionId)})`) };
		}
		if (actor !== 'agent' && actor !== 'human' && actor !== 'tool') {
			throw new TaskResourceError('PROVENANCE_INVALID', `acquire: actor must be one of agent|human|tool (got ${JSON.stringify(actor)})`);
		}
		const descriptor = await this.latestDescriptor(sessionId);
		if (descriptor === undefined) {
			return { ok: false, error: failure('RESOURCE_ABSENT', `session ${sessionId} not found in the browser-session journal (the canonical TL3 state has no such id)`) };
		}
		if (descriptor.state === 'closed' || descriptor.state === 'failed') {
			return { ok: false, error: failure('RESOURCE_ABSENT', `session ${sessionId} is in state '${descriptor.state}' (non-usable; the journal recorded its terminal state)`) };
		}
		// the human/agent separation law, pinned BOTH directions:
		// an agent actor acquiring a human-initiator session is TRUST_REFUSED
		if (actor === 'agent' && descriptor.initiator !== 'agent') {
			return {
				ok: false,
				error: failure(
					'TRUST_REFUSED',
					`session ${sessionId} is initiator '${descriptor.initiator}' (human-initiated); an agent actor cannot acquire it (the human/agent separation law, pinned BOTH directions by TL3 tests)`,
				),
			};
		}
		// a human actor CAN acquire an agent-initiator session (taking it
		// over is the documented human-takeover path; the journal records
		// both initiators)
		const snapshot = browserSurfaceOf(descriptor);
		return { ok: true, descriptor, snapshot };
	}

	/**
	 * Release: idempotent. A session already closed in the journal releases
	 * CLEANLY and idempotently (the obligation is discharged -- the record
	 * states what the journal showed, never fakes a teardown). Returns the
	 * journal state at release time so the orchestrator can record it.
	 */
	async release(sessionId: string): Promise<BrowserReleaseResult> {
		if (typeof sessionId !== 'string' || !BROWSER_SESSION_ID_PATTERN.test(sessionId)) {
			return { ok: false, error: failure('RESOURCE_ABSENT', `sessionId must be a logical flauz:browser:<16-hex> id (got ${JSON.stringify(sessionId)})`) };
		}
		const descriptor = await this.latestDescriptor(sessionId);
		if (descriptor === undefined) {
			// the session is absent in the journal -- release is idempotent
			// (the obligation is discharged; the journal never knew of it,
			// so nothing to tear down -- the record states exactly that)
			return { ok: true, journalState: 'absent', idempotent: true };
		}
		const idempotent = descriptor.state === 'closed' || descriptor.state === 'failed';
		return { ok: true, journalState: descriptor.state, idempotent };
	}
}

// Re-export the surface helpers + types for the orchestrator + tests.
export { isPlainObject, isPositiveEpochMs, isBoundedString, hasKey, hasOnlyKeys, hasExactKeys };
