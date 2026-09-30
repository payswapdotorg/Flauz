/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The Flauz browser-session journal (TL3-002 item 3.6, CROSS-WORKER
 * CONTRACT PIN-1 -- implement exactly):
 *
 *   Append-only `.flauz/browser-sessions.jsonl` at the workspace root; one
 *   canonical-JSON record + `\n` per session lifecycle fact:
 *
 *     {"schemaVersion":0,"schema":"flauz.browser-session-journal/v0","ts":<epochMs>,
 *      "actor":"agent"|"human"|"tool",
 *      "event":"opened"|"state-changed"|"closed"|"failed",
 *      "descriptor":{<full BrowserSessionDescriptor snapshot>}}
 *
 *   (Field order above is the SCHEMA; the BYTE form is the repo canonicalJson
 *   discipline -- recursively sorted keys, no insignificant whitespace --
 *   followed by exactly one `\n`. The fixture
 *   test/fixtures/browser-session-journal/ pins the byte form.)
 *
 *   P2-FIX-105 (navigation events as durable session evidence): the event
 *   vocabulary is EXTENDED additively with `navigated` -- one row per
 *   navigation attempt driven through the session manager's navigation
 *   surfaces (open startUrl / navigate / forced reset), written from the
 *   DECISION-path outcome (never from a wire-command observation: a deny
 *   verdict sends ZERO wire commands, so there is nothing on the wire to
 *   observe -- the deny row's `sent:false` IS the J3 fail-closed fact). A
 *   `navigated` row carries the SAME six envelope keys PLUS one additive
 *   `navigation` object:
 *
 *     "navigation":{"decision":"allow"|"deny","requestedUrl":"<url>",
 *                  "committedUrl":"<url>"?,"sent":<bool>}
 *
 *   Lifecycle rows are BYTE-IDENTICAL to the pre-P2-FIX-105 form (six keys,
 *   same canonical serialization). The envelope STAYS at
 *   `flauz.browser-session-journal/v0` / schemaVersion 0 on purpose: the
 *   additive event type + additive optional field is the compatible
 *   evolution for the pinned v0 readers (journalBridge.ts -- THE reader
 *   precedent -- validates fail-closed PER LINE with TYPED SKIPs, so a v0
 *   reader skips navigation rows it does not know and keeps consuming the
 *   lifecycle rows it does; a version bump would instead make EVERY row
 *   unreadable by every pinned v0 reader, breaking the continuity seam).
 *
 * Every open / state transition / close / failure appends a record; every
 * navigation attempt appends a `navigated` record. The actor
 * is MANDATORY and fail-closed: an unknown initiator makes the journal write
 * fail LOUDLY with the typed {@link BrowserSessionJournalError}.
 *
 * Consumption contract: this journal is the forensic/continuity seam another
 * lane consumes READ-ONLY. Writers: the session manager (events for sessions
 * it owns). Readers: use {@link validateSessionJournalLine} -- it enforces
 * the pinned record shape AND canonicality (a non-canonical line is a
 * contract deviation, rejected).
 *
 * Atomicity: the file-system writer appends each record with a single
 * O_APPEND write (fs.appendFile), creating `.flauz/` when absent -- one
 * complete line per write, never a torn record from this writer.
 */

import { appendFile, mkdir } from 'node:fs/promises';
import * as path from 'node:path';
import { canonicalJson } from '../policy.ts';
import {
	BROWSER_SESSION_SCHEMA_VERSION,
	BROWSER_SESSION_STATES,
	BROWSER_TAB_STATES,
	isSessionId,
	isTabId,
	snapshotDescriptor,
	type BrowserSessionDescriptor,
	type BrowserSessionState,
	type BrowserTabRecord,
	type SessionInitiator,
} from './session.ts';

/** Schema id pinned into every journal record (the cross-worker contract name). */
export const BROWSER_SESSION_JOURNAL_SCHEMA_ID = 'flauz.browser-session-journal/v0';

/**
 * The only journal schemaVersion this writer/validator understands.
 *
 * SCHEMA-VERSION DECISION (P2-FIX-105, explicit): KEPT at 0. The navigation
 * event is an ADDITIVE event value + an ADDITIVE optional `navigation` key;
 * lifecycle rows stay byte-identical. A v0-pinned reader that does not know
 * the `navigated` event rejects those lines through its designed
 * fail-closed-per-line path (a TYPED SKIP) and keeps consuming lifecycle
 * rows; bumping the envelope version would orphan EVERY row (lifecycle
 * included) at every pinned v0 reader. See the module docblock.
 */
export const BROWSER_SESSION_JOURNAL_SCHEMA_VERSION = 0;

/** Journal path relative to the workspace root. */
export const BROWSER_SESSION_JOURNAL_PATH = '.flauz/browser-sessions.jsonl';

/** The actor enum (PIN-1): who the record is attributable to. 'tool' is accepted for tool-attributed rows from other lanes. */
export const BROWSER_SESSION_JOURNAL_ACTORS = ['agent', 'human', 'tool'] as const;
export type SessionJournalActor = (typeof BROWSER_SESSION_JOURNAL_ACTORS)[number];

/**
 * The event enum (PIN-1; P2-FIX-105 adds `navigated` additively -- one row per
 * navigation attempt, carrying the policy decision + requested/committed
 * URLs + the zero-wire-commands fact; see {@link SessionJournalNavigation}).
 */
export const BROWSER_SESSION_JOURNAL_EVENTS = ['opened', 'state-changed', 'closed', 'failed', 'navigated'] as const;
export type SessionJournalEvent = (typeof BROWSER_SESSION_JOURNAL_EVENTS)[number];

/** The navigation decision vocabulary (mirrors the policy engine's PolicyDecision). */
export const BROWSER_SESSION_JOURNAL_NAVIGATION_DECISIONS = ['allow', 'deny'] as const;

/**
 * The navigation facts one `navigated` row carries (P2-FIX-105 -- the finding's
 * proposed vocabulary: decision allow/deny, target URL, committed URL,
 * whether any wire command was sent):
 *   - `decision` -- the AUTHORITATIVE gate verdict for the requested URL;
 *   - `requestedUrl` -- the target URL of the attempt;
 *   - `committedUrl` -- the URL that actually committed (allow path only);
 *   - `sent` -- false iff ZERO wire commands were sent. A DENY verdict sends
 *     zero commands BY CONSTRUCTION (fail-closed), so a deny row always
 *     carries `sent:false` and NO `committedUrl` (the J3 fail-closed row is
 *     self-certifying: the validator REJECTS a deny row that claims a commit
 *     or a sent command -- such a row cannot be produced by the decision
 *     path and must never be accepted as evidence).
 */
export interface SessionJournalNavigation {
	readonly decision: (typeof BROWSER_SESSION_JOURNAL_NAVIGATION_DECISIONS)[number];
	readonly requestedUrl: string;
	/** Present iff the navigation committed; ABSENT on deny (nothing was sent, nothing loaded). */
	readonly committedUrl?: string;
	/** False iff ZERO wire commands were sent (always false on deny). */
	readonly sent: boolean;
}

/** One journal record (the pinned shape; `navigation` rides ONLY `navigated` rows). */
export interface SessionJournalRecord {
	readonly schemaVersion: typeof BROWSER_SESSION_JOURNAL_SCHEMA_VERSION;
	readonly schema: typeof BROWSER_SESSION_JOURNAL_SCHEMA_ID;
	/** Epoch milliseconds. */
	readonly ts: number;
	readonly actor: SessionJournalActor;
	readonly event: SessionJournalEvent;
	/** Full descriptor snapshot at the moment of the event. */
	readonly descriptor: BrowserSessionDescriptor;
	/** The navigation facts; present iff `event` is 'navigated' (P2-FIX-105). */
	readonly navigation?: SessionJournalNavigation;
}

/** Typed journal error (fail-closed surface; `code` is stable for logs/audit). */
export class BrowserSessionJournalError extends Error {
	readonly code: 'flauz.browser.journal';
	constructor(message: string) {
		super(`flauz.browser-session-journal: ${message}`);
		this.name = 'BrowserSessionJournalError';
		this.code = 'flauz.browser.journal';
	}
}

// #region Record construction + validation

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Maps a session initiator onto the journal actor enum. FAIL-CLOSED: an
 * unknown initiator throws {@link BrowserSessionJournalError} -- the journal
 * write fails loudly, never silently mis-attributed.
 */
export function journalActorOf(initiator: SessionInitiator | string): SessionJournalActor {
	if (initiator === 'agent' || initiator === 'human') {
		return initiator;
	}
	throw new BrowserSessionJournalError(`unknown session initiator ${JSON.stringify(initiator)}: the journal actor is MANDATORY (allowed: ${BROWSER_SESSION_JOURNAL_ACTORS.join(', ')})`);
}

function validateDescriptorShape(value: unknown): BrowserSessionDescriptor {
	if (!isPlainObject(value)) {
		throw new BrowserSessionJournalError('descriptor must be an object (BrowserSessionDescriptor snapshot)');
	}
	if (value.schemaVersion !== BROWSER_SESSION_SCHEMA_VERSION) {
		throw new BrowserSessionJournalError(`descriptor.schemaVersion must be ${BROWSER_SESSION_SCHEMA_VERSION} (got ${JSON.stringify(value.schemaVersion)})`);
	}
	if (typeof value.sessionId !== 'string' || !isSessionId(value.sessionId)) {
		throw new BrowserSessionJournalError(`descriptor.sessionId must be a logical flauz:browser:<16-hex> id (got ${JSON.stringify(value.sessionId)})`);
	}
	if (value.initiator !== 'human' && value.initiator !== 'agent') {
		throw new BrowserSessionJournalError(`descriptor.initiator must be 'human' or 'agent' (got ${JSON.stringify(value.initiator)})`);
	}
	if (value.initiator === 'agent' && value.agentId !== undefined && typeof value.agentId !== 'string') {
		throw new BrowserSessionJournalError('descriptor.agentId must be a string when present');
	}
	if (typeof value.partition !== 'string') {
		throw new BrowserSessionJournalError('descriptor.partition must be a string');
	}
	if (typeof value.policySourceRef !== 'string') {
		throw new BrowserSessionJournalError('descriptor.policySourceRef must be a string');
	}
	if (typeof value.createdAt !== 'string') {
		throw new BrowserSessionJournalError('descriptor.createdAt must be an ISO timestamp string');
	}
	if (typeof value.state !== 'string' || !BROWSER_SESSION_STATES.includes(value.state as BrowserSessionState)) {
		throw new BrowserSessionJournalError(`descriptor.state must be one of ${BROWSER_SESSION_STATES.join(', ')} (got ${JSON.stringify(value.state)})`);
	}
	if (!Array.isArray(value.tabs)) {
		throw new BrowserSessionJournalError('descriptor.tabs must be an array of BrowserTabRecord');
	}
	for (const [index, tab] of value.tabs.entries()) {
		if (!isPlainObject(tab)) {
			throw new BrowserSessionJournalError(`descriptor.tabs[${index}] must be an object`);
		}
		if (typeof tab.tabId !== 'string' || !isTabId(tab.tabId)) {
			throw new BrowserSessionJournalError(`descriptor.tabs[${index}].tabId must be a logical flauz:tab:<16-hex> id`);
		}
		if (typeof tab.targetId !== 'string') {
			throw new BrowserSessionJournalError(`descriptor.tabs[${index}].targetId must be a string`);
		}
		if (typeof tab.url !== 'string') {
			throw new BrowserSessionJournalError(`descriptor.tabs[${index}].url must be a string`);
		}
		if (typeof tab.state !== 'string' || !BROWSER_TAB_STATES.includes(tab.state as BrowserTabRecord['state'])) {
			throw new BrowserSessionJournalError(`descriptor.tabs[${index}].state must be one of ${BROWSER_TAB_STATES.join(', ')}`);
		}
		if (typeof tab.openedAt !== 'string') {
			throw new BrowserSessionJournalError(`descriptor.tabs[${index}].openedAt must be a string`);
		}
	}
	if (value.error !== undefined && (!isPlainObject(value.error) || typeof value.error.code !== 'string' || typeof value.error.message !== 'string' || typeof value.error.at !== 'string')) {
		throw new BrowserSessionJournalError('descriptor.error must be { code, message, at } when present');
	}
	return value as unknown as BrowserSessionDescriptor;
}

/**
 * Validates the navigation facts of one `navigated` row (P2-FIX-105).
 * FAIL-CLOSED on the J3 invariant: a DENY row must record that ZERO wire
 * commands were sent (`sent:false`) and must NOT claim a committed URL —
 * the decision path never sends anything on deny, so a deny row claiming a
 * commit or a sent command cannot be evidence. An ALLOW row records
 * `committedUrl` when the navigation committed (absent on operational
 * failures — commit timeout / transport loss / wedged-tab replacement —
 * which are honest facts, not contract deviations).
 */
function validateNavigationShape(value: unknown): SessionJournalNavigation {
	if (!isPlainObject(value)) {
		throw new BrowserSessionJournalError('navigation must be an object { decision, requestedUrl, committedUrl?, sent } on a \'navigated\' record');
	}
	if (value.decision !== 'allow' && value.decision !== 'deny') {
		throw new BrowserSessionJournalError(`navigation.decision must be 'allow' or 'deny' (got ${JSON.stringify(value.decision)})`);
	}
	if (typeof value.requestedUrl !== 'string') {
		throw new BrowserSessionJournalError('navigation.requestedUrl must be a string');
	}
	if (typeof value.sent !== 'boolean') {
		throw new BrowserSessionJournalError('navigation.sent must be a boolean (false iff ZERO wire commands were sent)');
	}
	if (value.committedUrl !== undefined && typeof value.committedUrl !== 'string') {
		throw new BrowserSessionJournalError('navigation.committedUrl must be a string when present');
	}
	if (value.decision === 'deny' && value.sent !== false) {
		throw new BrowserSessionJournalError('navigation: a DENY verdict sends ZERO wire commands by construction — a deny row must carry sent:false (J3 fail-closed)');
	}
	if (value.decision === 'deny' && value.committedUrl !== undefined) {
		throw new BrowserSessionJournalError('navigation: a DENY verdict never commits a URL — a deny row must NOT carry committedUrl (J3 fail-closed)');
	}
	return value as unknown as SessionJournalNavigation;
}

/**
 * Builds (and validates) one journal record. The actor must be one of the
 * contract actors ({@link BROWSER_SESSION_JOURNAL_ACTORS} — sessions produce
 * 'agent'/'human' via {@link journalActorOf}; 'tool' is accepted for
 * tool-attributed rows from other lanes). The `navigation` facts are legal
 * ONLY on a 'navigated' row (a lifecycle row carrying navigation facts — or
 * a navigation row without them — is a contract deviation, fail-closed).
 * Throws {@link BrowserSessionJournalError} on any contract violation -- the
 * caller surfaces it (fail-closed), never drops the record silently.
 */
export function buildSessionJournalRecord(actor: SessionJournalActor | string, event: SessionJournalEvent | string, descriptor: BrowserSessionDescriptor, ts: number, navigation?: SessionJournalNavigation): SessionJournalRecord {
	if (!BROWSER_SESSION_JOURNAL_ACTORS.includes(actor as SessionJournalActor)) {
		throw new BrowserSessionJournalError(`unknown journal actor ${JSON.stringify(actor)} (allowed: ${BROWSER_SESSION_JOURNAL_ACTORS.join(', ')})`);
	}
	if (!BROWSER_SESSION_JOURNAL_EVENTS.includes(event as SessionJournalEvent)) {
		throw new BrowserSessionJournalError(`unknown journal event ${JSON.stringify(event)} (allowed: ${BROWSER_SESSION_JOURNAL_EVENTS.join(', ')})`);
	}
	if (typeof ts !== 'number' || !Number.isInteger(ts) || ts < 0) {
		throw new BrowserSessionJournalError(`ts must be a non-negative integer epoch-ms (got ${JSON.stringify(ts)})`);
	}
	validateDescriptorShape(descriptor);
	if (event === 'navigated' && navigation === undefined) {
		throw new BrowserSessionJournalError("a 'navigated' record must carry its navigation facts { decision, requestedUrl, committedUrl?, sent }");
	}
	if (event !== 'navigated' && navigation !== undefined) {
		throw new BrowserSessionJournalError(`navigation facts ride ONLY 'navigated' records (got event ${JSON.stringify(event)})`);
	}
	if (navigation !== undefined) {
		validateNavigationShape(navigation);
	}
	return {
		schemaVersion: BROWSER_SESSION_JOURNAL_SCHEMA_VERSION,
		schema: BROWSER_SESSION_JOURNAL_SCHEMA_ID,
		ts,
		actor: actor as SessionJournalActor,
		event: event as SessionJournalEvent,
		descriptor: snapshotDescriptor(descriptor),
		...(navigation === undefined ? {} : { navigation }),
	};
}

/** The canonical byte form of one record: canonicalJson + exactly one trailing `\n`. */
export function sessionJournalLine(record: SessionJournalRecord): string {
	return canonicalJson(record) + '\n';
}

export type JournalLineValidation =
	| { readonly ok: true; readonly record: SessionJournalRecord }
	| { readonly ok: false; readonly error: BrowserSessionJournalError };

/**
 * Validates ONE journal line against the pinned contract (shape + enum +
 * descriptor + CANONICALITY: the line must be byte-identical to the canonical
 * serialization of its parsed record). The read-side contract checker for the
 * lane that consumes this journal READ-ONLY.
 */
export function validateSessionJournalLine(line: string): JournalLineValidation {
	if (!line.endsWith('\n')) {
		return { ok: false, error: new BrowserSessionJournalError('record must end with exactly one newline') };
	}
	if (line.length > 1 && line.endsWith('\n\n')) {
		return { ok: false, error: new BrowserSessionJournalError('record must end with exactly one newline (got a blank line)') };
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch (err) {
		return { ok: false, error: new BrowserSessionJournalError(`record is not valid JSON: ${err instanceof Error ? err.message : String(err)}`) };
	}
	if (!isPlainObject(parsed)) {
		return { ok: false, error: new BrowserSessionJournalError('record must be a JSON object') };
	}
	// P2-FIX-105: the key set is the SIX pinned envelope keys, PLUS exactly
	// one additive 'navigation' key on a 'navigated' row (and only there — a
	// lifecycle row carrying a 7th key, or a navigation row missing its facts,
	// is a contract deviation).
	const expectedNavigationKeySet = ['actor', 'descriptor', 'event', 'navigation', 'schema', 'schemaVersion', 'ts'];
	const expectedLifecycleKeySet = ['actor', 'descriptor', 'event', 'schema', 'schemaVersion', 'ts'];
	const expected = parsed.event === 'navigated' ? expectedNavigationKeySet : expectedLifecycleKeySet;
	const keys = Object.keys(parsed).sort();
	if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
		return { ok: false, error: new BrowserSessionJournalError(`record key set must be exactly {${expected.join(', ')}} (got {${Object.keys(parsed).sort().join(', ')}})`) };
	}
	if (parsed.schemaVersion !== BROWSER_SESSION_JOURNAL_SCHEMA_VERSION) {
		return { ok: false, error: new BrowserSessionJournalError(`schemaVersion must be ${BROWSER_SESSION_JOURNAL_SCHEMA_VERSION} (got ${JSON.stringify(parsed.schemaVersion)})`) };
	}
	if (parsed.schema !== BROWSER_SESSION_JOURNAL_SCHEMA_ID) {
		return { ok: false, error: new BrowserSessionJournalError(`schema must be ${JSON.stringify(BROWSER_SESSION_JOURNAL_SCHEMA_ID)} (got ${JSON.stringify(parsed.schema)})`) };
	}
	if (typeof parsed.ts !== 'number' || !Number.isInteger(parsed.ts) || parsed.ts < 0) {
		return { ok: false, error: new BrowserSessionJournalError(`ts must be a non-negative integer epoch-ms (got ${JSON.stringify(parsed.ts)})`) };
	}
	if (!BROWSER_SESSION_JOURNAL_ACTORS.includes(parsed.actor as SessionJournalActor)) {
		return { ok: false, error: new BrowserSessionJournalError(`actor must be one of ${BROWSER_SESSION_JOURNAL_ACTORS.join(', ')} (got ${JSON.stringify(parsed.actor)})`) };
	}
	if (!BROWSER_SESSION_JOURNAL_EVENTS.includes(parsed.event as SessionJournalEvent)) {
		return { ok: false, error: new BrowserSessionJournalError(`event must be one of ${BROWSER_SESSION_JOURNAL_EVENTS.join(', ')} (got ${JSON.stringify(parsed.event)})`) };
	}
	try {
		validateDescriptorShape(parsed.descriptor);
	} catch (err) {
		return { ok: false, error: err instanceof BrowserSessionJournalError ? err : new BrowserSessionJournalError(String(err)) };
	}
	if (parsed.event === 'navigated') {
		try {
			validateNavigationShape(parsed.navigation);
		} catch (err) {
			return { ok: false, error: err instanceof BrowserSessionJournalError ? err : new BrowserSessionJournalError(String(err)) };
		}
	}
	const record = parsed as unknown as SessionJournalRecord;
	if (line !== sessionJournalLine(record)) {
		return { ok: false, error: new BrowserSessionJournalError('record is not canonical: bytes must equal the canonical JSON serialization (sorted keys, no insignificant whitespace) of the record') };
	}
	return { ok: true, record };
}

// #endregion

// #region Writer ports

/** The journal writer port (injected: file-system in production, in-memory in tests). */
export interface SessionJournalPort {
	append(record: SessionJournalRecord): Promise<void>;
}

/**
 * Production writer: `<workspaceRoot>/.flauz/browser-sessions.jsonl`,
 * append-only. One O_APPEND write per record (atomic single-line append);
 * `.flauz/` is created when absent.
 */
export class FileSystemSessionJournal implements SessionJournalPort {
	private readonly rootDir: string;

	constructor(rootDir: string) {
		this.rootDir = rootDir;
	}

	/** The absolute journal file path. */
	get journalPath(): string {
		return path.join(this.rootDir, ...BROWSER_SESSION_JOURNAL_PATH.split('/'));
	}

	async append(record: SessionJournalRecord): Promise<void> {
		// Re-validate on the write path: the writer is fail-closed even
		// when called directly (a malformed record never reaches disk).
		validateSessionJournalLine(sessionJournalLine(record));
		await mkdir(path.dirname(this.journalPath), { recursive: true });
		await appendFile(this.journalPath, sessionJournalLine(record), 'utf-8');
	}
}

/** Test/in-memory writer: records + the exact lines that would hit disk. */
export class InMemorySessionJournal implements SessionJournalPort {
	readonly records: SessionJournalRecord[] = [];
	readonly lines: string[] = [];

	async append(record: SessionJournalRecord): Promise<void> {
		validateSessionJournalLine(sessionJournalLine(record));
		this.records.push(record);
		this.lines.push(sessionJournalLine(record));
	}
}

/** A journal port whose every write fails (fail-closed drills). */
export class FailingSessionJournal implements SessionJournalPort {
	readonly attempts: SessionJournalRecord[] = [];
	private readonly reason: string;

	constructor(reason = 'journal unavailable (scripted failure)') {
		this.reason = reason;
	}

	async append(record: SessionJournalRecord): Promise<void> {
		this.attempts.push(record);
		throw new BrowserSessionJournalError(this.reason);
	}
}

// #endregion
