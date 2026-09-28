/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-S2 -- the PIN-1 read-only browser-session lease adapter.
 *
 * Imitates `extensions/flauz-resources/src/journalBridge.ts` EXACTLY (the
 * DL-32 no-cross-extension-imports precedent): the PIN-1 journal record
 * shape, the actor/event enums, the session/tab state vocabularies and the
 * id grammars are DUPLICATED HERE AS TYPES and pinned by the repo-root
 * fixture families (`test/fixtures/browser-session-journal/` and
 * `test/fixtures/task-resources/` -- consumed READ-ONLY, never modified).
 * flauz-browser's session manager OWNS the journal; this adapter only
 * reads it. It never calls CDP, never opens or closes a session, never
 * writes a journal line -- `flauz.browser.navigate` /
 * `flauz.browser.close` (the referenced op ports) are the TL3 manager's
 * calls at runtime.
 *
 * Reader semantics (fail-closed per line, never a crash -- the journalBridge
 * law): every line is validated against the pinned contract INCLUDING
 * canonicality (the bytes must equal the canonical JSON of the parsed
 * record); an invalid line becomes a TYPED SKIP `{line, reason}` and valid
 * lines keep flowing. The latest descriptor per session (max ts, tie-break
 * by file order) is the acquisition truth. TRAILING blank lines are
 * tolerated (the PIN-1 writer emits exactly one record + one `\n` per
 * append); an INTERIOR blank line is a typed skip.
 *
 * HUMAN vs AGENT SEPARATION (the flauz-browser law, pinned both directions
 * by TL3 tests): the session's `initiator` selects the policy class
 * ('agent' -> 'agent-tool', 'human' -> 'user'; the agent allowlist never
 * gates humans). An AGENT (or TOOL -- machine-attributed) actor acquiring a
 * HUMAN-initiator session is TRUST_REFUSED: machine-class operations must
 * never run through a user-class policy gate. A human actor may lease
 * either initiator class (the stricter session policy still applies).
 *
 * Operability: a session in state 'closed' or 'failed' is not operable and
 * cannot be acquired (TRUST_REFUSED; 'opening' | 'active' | 'suspended'
 * are acquirable). A lease released while the journal already shows the
 * session closed releases CLEANLY and idempotently -- the record states
 * what the journal showed, never a faked teardown.
 */
import {
	BROWSER_SESSION_ID_PATTERN,
	canonicalJson,
	isBrowserSessionId,
	isPlainObject,
	joinPath,
	type Clock,
	type FileSystemPort,
	type LeaseProvenance,
	type LeaseReleaseOutcome,
	type LeaseSurfaceSnapshot,
} from './types.ts';
import type { AcquisitionVerdict, ReleaseVerdict, ResourceLeaseAdapter, SurfaceCheckVerdict } from './contracts.ts';

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
// The strict line reader (typed skips, never a crash -- the journalBridge law)
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

/**
 * Validates ONE journal line against the pinned PIN-1 contract (shape +
 * enums + descriptor + CANONICALITY). Returns the record or a typed skip
 * reason -- never throws.
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
	if (parsed['schemaVersion'] !== JOURNAL_SCHEMA_VERSION) {
		return { ok: false, reason: `schemaVersion must be ${JOURNAL_SCHEMA_VERSION} (got ${JSON.stringify(parsed['schemaVersion'])})` };
	}
	if (parsed['schema'] !== JOURNAL_SCHEMA_ID) {
		return { ok: false, reason: `schema must be ${JSON.stringify(JOURNAL_SCHEMA_ID)} (got ${JSON.stringify(parsed['schema'])})` };
	}
	if (typeof parsed['ts'] !== 'number' || !Number.isInteger(parsed['ts']) || parsed['ts'] < 0) {
		return { ok: false, reason: `ts must be a non-negative integer epoch-ms (got ${JSON.stringify(parsed['ts'])})` };
	}
	if (typeof parsed['actor'] !== 'string' || !(JOURNAL_ACTORS as readonly string[]).includes(parsed['actor'])) {
		return { ok: false, reason: `actor must be one of ${JOURNAL_ACTORS.join(', ')} (got ${JSON.stringify(parsed['actor'])}) -- the journal actor is MANDATORY` };
	}
	if (typeof parsed['event'] !== 'string' || !(JOURNAL_EVENTS as readonly string[]).includes(parsed['event'])) {
		return { ok: false, reason: `event must be one of ${JOURNAL_EVENTS.join(', ')} (got ${JSON.stringify(parsed['event'])})` };
	}
	const descriptorError = validateDescriptorShape(parsed['descriptor']);
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
	if (value['schemaVersion'] !== JOURNAL_SCHEMA_VERSION) {
		return `descriptor.schemaVersion must be ${JOURNAL_SCHEMA_VERSION} (got ${JSON.stringify(value['schemaVersion'])})`;
	}
	if (typeof value['sessionId'] !== 'string' || !BROWSER_SESSION_ID_PATTERN.test(value['sessionId'])) {
		return `descriptor.sessionId must be a logical flauz:browser:<16-hex> id (got ${JSON.stringify(value['sessionId'])})`;
	}
	if (value['initiator'] !== 'human' && value['initiator'] !== 'agent') {
		return `descriptor.initiator must be 'human' or 'agent' (got ${JSON.stringify(value['initiator'])})`;
	}
	if (value['agentId'] !== undefined && typeof value['agentId'] !== 'string') {
		return 'descriptor.agentId must be a string when present';
	}
	if (typeof value['partition'] !== 'string' || value['partition'].length === 0) {
		return 'descriptor.partition must be a non-empty string';
	}
	if (typeof value['policySourceRef'] !== 'string' || value['policySourceRef'].length === 0) {
		return 'descriptor.policySourceRef must be a non-empty string';
	}
	if (typeof value['createdAt'] !== 'string' || value['createdAt'].length === 0) {
		return 'descriptor.createdAt must be an ISO timestamp string';
	}
	if (typeof value['state'] !== 'string' || !(JOURNAL_SESSION_STATES as readonly string[]).includes(value['state'])) {
		return `descriptor.state must be one of ${JOURNAL_SESSION_STATES.join(', ')} (got ${JSON.stringify(value['state'])})`;
	}
	if (!Array.isArray(value['tabs'])) {
		return 'descriptor.tabs must be an array of tab records';
	}
	for (const [index, tab] of (value['tabs'] as readonly unknown[]).entries()) {
		if (!isPlainObject(tab)) {
			return `descriptor.tabs[${index}] must be an object`;
		}
		if (typeof tab['tabId'] !== 'string' || !TAB_ID_PATTERN.test(tab['tabId'])) {
			return `descriptor.tabs[${index}].tabId must be a logical flauz:tab:<16-hex> id`;
		}
		if (typeof tab['targetId'] !== 'string' || tab['targetId'].length === 0) {
			return `descriptor.tabs[${index}].targetId must be a non-empty string`;
		}
		if (typeof tab['url'] !== 'string') {
			return `descriptor.tabs[${index}].url must be a string`;
		}
		if (typeof tab['state'] !== 'string' || !(JOURNAL_TAB_STATES as readonly string[]).includes(tab['state'])) {
			return `descriptor.tabs[${index}].state must be one of ${JOURNAL_TAB_STATES.join(', ')}`;
		}
		if (typeof tab['openedAt'] !== 'string' || tab['openedAt'].length === 0) {
			return `descriptor.tabs[${index}].openedAt must be a non-empty string`;
		}
	}
	if (value['error'] !== undefined && (!isPlainObject(value['error']) || typeof value['error']['code'] !== 'string' || typeof value['error']['message'] !== 'string' || typeof value['error']['at'] !== 'string')) {
		return 'descriptor.error must be { code, message, at } when present';
	}
	return undefined;
}

/**
 * Reads the whole journal: every line validated; invalid lines become typed
 * skips (with the bad line number recorded), valid records keep file order.
 * An absent journal reads as empty (never an error). TRAILING blank lines
 * are tolerated; an INTERIOR blank line is a typed skip.
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
			skipped.push({ line: lineNo, reason: 'empty line (a well-formed journal holds one complete record per line)' });
			continue;
		}
		const parsed = parseJournalLine(line);
		if (parsed.ok) {
			records.push(parsed.record);
		} else {
			skipped.push({ line: lineNo, reason: parsed.reason });
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

/** The browser surface of a descriptor (identity = sessionId, never tab ids -- the journalBridge derivation). */
function surfaceOf(descriptor: JournalSessionDescriptor): Record<string, unknown> {
	const tabIds = [...new Set(descriptor.tabs.map(tab => tab.tabId))].sort();
	return {
		kind: 'browser',
		partition: descriptor.partition,
		...(tabIds.length > 0 ? { tabIds } : {}),
	};
}

/** The acquisition snapshot for a latest-record (version marker = the record ts). */
function snapshotOf(record: JournalRecord): LeaseSurfaceSnapshot {
	return { surfaces: [{ family: 'browser', version: record.ts, surface: surfaceOf(record.descriptor) }] };
}

// ---------------------------------------------------------------------------
// The adapter (read-only over the canonical PIN-1 state)
// ---------------------------------------------------------------------------

export interface BrowserSessionLeaseAdapterOptions {
	readonly root: string;
	readonly fs: FileSystemPort;
	readonly clock?: Clock;
}

/**
 * The browser-session lease adapter. Reads `.flauz/browser-sessions.jsonl`
 * READ-ONLY; acquires/releases are typed verdicts over the journal truth.
 */
export class BrowserSessionLeaseAdapter implements ResourceLeaseAdapter {
	readonly kind = 'browser-session' as const;

	private readonly root: string;
	private readonly fs: FileSystemPort;

	constructor(options: BrowserSessionLeaseAdapterOptions) {
		this.root = options.root;
		this.fs = options.fs;
	}

	private async latest(): Promise<{ latest: ReadonlyMap<string, JournalRecord>; skipped: readonly JournalSkip[] }> {
		const raw = await this.fs.readFileUtf8(joinPath(this.root, BROWSER_SESSION_JOURNAL_PATH));
		const { records, skipped } = readSessionJournal(raw);
		return { latest: latestBySession(records), skipped };
	}

	async acquire(taskId: string, sessionId: string, actor: LeaseProvenance): Promise<AcquisitionVerdict> {
		if (!isBrowserSessionId(sessionId)) {
			return { ok: false, code: 'RESOURCE_ABSENT', message: `sessionId must be a logical flauz:browser:<16-hex> id (got ${JSON.stringify(sessionId)}) -- never a path, never a URL` };
		}
		const { latest, skipped } = await this.latest();
		const record = latest.get(sessionId);
		if (record === undefined) {
			return { ok: false, code: 'RESOURCE_ABSENT', message: `no browser session '${sessionId}' exists in the PIN-1 journal (the journal holds ${latest.size} session(s); ${skipped.length} line(s) were skipped as invalid -- the canonical journal is the acquisition truth)` };
		}
		const descriptor = record.descriptor;
		if (descriptor.state === 'closed' || descriptor.state === 'failed') {
			return { ok: false, code: 'TRUST_REFUSED', message: `browser session '${sessionId}' is in state '${descriptor.state}' (journal ts ${record.ts}, event ${record.event}) -- it is not operable and cannot be acquired` };
		}
		// the human/agent separation law: machine-class actors never lease human sessions
		if ((actor.actor === 'agent' || actor.actor === 'tool') && descriptor.initiator === 'human') {
			return { ok: false, code: 'TRUST_REFUSED', message: `browser session '${sessionId}' is human-initiated and cannot be acquired by a '${actor.actor}' actor (the human/agent separation law: machine-class operations must never run through a user-class policy gate)` };
		}
		return {
			ok: true,
			surfaceSnapshot: snapshotOf(record),
			opPort: 'flauz.browser.navigate',
			...(skipped.length > 0 ? { notes: [`${skipped.length} invalid journal line(s) were skipped (typed skips; the valid lines govern)`] } : {}),
		};
	}

	async release(taskId: string, sessionId: string, actor: LeaseProvenance): Promise<ReleaseVerdict> {
		if (!isBrowserSessionId(sessionId)) {
			return { ok: false, code: 'RESOURCE_ABSENT', message: `sessionId must be a logical flauz:browser:<16-hex> id (got ${JSON.stringify(sessionId)})` };
		}
		const { latest } = await this.latest();
		const record = latest.get(sessionId);
		if (record === undefined) {
			return { ok: false, code: 'RESOURCE_ABSENT', message: `no browser session '${sessionId}' exists in the PIN-1 journal (the obligation cannot be discharged against an absent session)` };
		}
		if (record.descriptor.state === 'closed') {
			// the obligation is discharged: the record states what the journal showed, never a faked teardown
			return { ok: true, outcome: 'closed-elsewhere', observed: `journal shows session '${sessionId}' closed (state '${record.descriptor.state}', event '${record.event}', actor '${record.actor}', ts ${record.ts}) -- the obligation is discharged; no teardown is claimed`, opPort: 'flauz.browser.close' };
		}
		if (record.descriptor.state === 'failed') {
			return { ok: true, outcome: 'closed-elsewhere', observed: `journal shows session '${sessionId}' failed (state '${record.descriptor.state}', event '${record.event}', ts ${record.ts}) -- the session is not operable; the obligation is discharged without a teardown claim`, opPort: 'flauz.browser.close' };
		}
		return { ok: true, outcome: 'clean', observed: `journal shows session '${sessionId}' in state '${record.descriptor.state}' at release -- closing it via flauz.browser.close is the TL3 session manager's call at runtime (this adapter claims no teardown)`, opPort: 'flauz.browser.close' };
	}

	async verifySurface(taskId: string, sessionId: string, snapshot: LeaseSurfaceSnapshot): Promise<SurfaceCheckVerdict> {
		if (!isBrowserSessionId(sessionId)) {
			return { ok: false, code: 'RESOURCE_ABSENT', message: `sessionId must be a logical flauz:browser:<16-hex> id (got ${JSON.stringify(sessionId)})` };
		}
		const { latest } = await this.latest();
		const record = latest.get(sessionId);
		if (record === undefined) {
			return { ok: false, code: 'RESOURCE_ABSENT', message: `no browser session '${sessionId}' exists in the PIN-1 journal` };
		}
		const current = snapshotOf(record);
		const pinned = snapshot.surfaces.find(entry => entry.family === 'browser');
		const currentSurface = current.surfaces[0]!.surface;
		if (pinned === undefined || canonicalJson(pinned.surface) !== canonicalJson(currentSurface)) {
			return { ok: false, code: 'SURFACE_MISMATCH', message: `browser session '${sessionId}' changed surface identity since acquisition (pinned ${pinned === undefined ? '(no browser surface pinned)' : canonicalJson(pinned.surface)}, current ${canonicalJson(currentSurface)}) -- the partition/tab identity of the leased session changed` };
		}
		return { ok: true, current };
	}
}
