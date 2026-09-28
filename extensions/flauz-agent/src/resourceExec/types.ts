/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-S2 -- the task-boundary resource lease vocabulary (envelope
 * `flauz.task-resources/v0`).
 *
 * THE LAYER-SEPARATION LAW (TL2-HANDOFF "Resource / Execution Ports"; stated
 * here because every record of this envelope is bound by it): a task resource
 * lease is the TASK-GRAPH-LEVEL obligation binding a durable task
 * (`.flauz/tasks.json`, envelope `flauz.tasks/v0`) to a LOGICAL resource id.
 * The ACTUAL lifecycle effects -- browser open/navigate/close, environment
 * create/start/attach/detach/stop, resource graph mutations -- remain OWNED
 * by the TL3 managers (flauz-browser session manager, flauz-environments
 * lifecycle manager, flauz-resources graph). A lease REFERENCES the owning
 * command port (`opPort`, e.g. `flauz.env.start`); it never re-implements
 * it, never calls CDP, never spawns a process, and never writes TL3-owned
 * state. This module is the additive TL2-side consumer of the landed TL3
 * contracts, not a second implementation of them.
 *
 * Design law (no cross-extension imports -- DL-32): every consumed TL3
 * contract surface is DUPLICATED HERE AS TYPES/vocabularies and pinned by the
 * repo-root fixture family at `test/fixtures/task-resources/` (consumed
 * READ-ONLY, never modified):
 *   - flauz-workspace task ids are exactly `T-<3+ digits>`;
 *   - flauz-browser session ids are exactly `flauz:browser:<16-hex>`
 *     (the PIN-1 journal descriptor id);
 *   - flauz-environments logical ids are the registry descriptor ids
 *     `env-<slug>` (keyed by the registry AND the PIN-2 lifecycle envelope);
 *   - flauz-resources ResourceRef ids are URNs
 *     `flauz:<kind-namespace>:<16-hex-or-slug>`;
 *   - flauz-environments continuity bundle ids are exactly
 *     `flauz:continuity:<16-hex>` (`flauz.continuity-bundle/v0`).
 * A lease `resourceId` is ALWAYS one of those LOGICAL ids -- never a path,
 * never a URL, never an endpoint.
 *
 * Persistence (the sibling-envelope discipline, DL-9/DL-32): the durable
 * truth of this envelope is the append-only ledger
 * `.flauz/task-resources.jsonl` -- one canonical-JSON record (recursively
 * sorted keys, compact single line) + exactly one `\n` per
 * acquisition/release/rollback/hand-off/failure/expiry. Canonical
 * serialization, sha256 and the POSIX join are duplicated verbatim from the
 * sibling lanes (zero dependencies, identical code path under `node --test`
 * type stripping and the extension host).
 *
 * vscode-free, zero deps, ports injected (FileSystemPort/Clock). Pure
 * TypeScript with erasable-only syntax.
 */

/** Schema identifier of the task-resources envelope family. */
export const TASK_RESOURCES_SCHEMA_ID = 'flauz.task-resources/v0';

/** The only schemaVersion this envelope understands. */
export const TASK_RESOURCES_SCHEMA_VERSION = 0;

/** Directory (relative to the workspace root) holding all Flauz state. */
export const FLAUZ_DIR = '.flauz';

/** Ledger path, relative to the workspace root (append-only JSONL). */
export const TASK_RESOURCES_PATH = '.flauz/task-resources.jsonl';

// ---------------------------------------------------------------------------
// Contract-duplicated vocabularies (DL-32; pinned by the fixture family)
// ---------------------------------------------------------------------------

/** The actor enum (the PIN-1/PIN-2 provenance law: MANDATORY, fail-closed). */
export const LEASE_ACTORS = ['agent', 'human', 'tool'] as const;
export type LeaseActor = (typeof LEASE_ACTORS)[number];

/** The resource families a task lease can bind (one per TL3 contract). */
export const TASK_RESOURCE_KINDS = ['browser-session', 'environment', 'resource-ref'] as const;
export type TaskResourceKind = (typeof TASK_RESOURCE_KINDS)[number];

/**
 * Lease lifecycle states: `acquiring -> active -> released | expired |
 * rolled-back | failed`. `acquiring` is the in-operation transient (minted id,
 * not yet committed); the ledger only ever persists leases in `active` or a
 * terminal state.
 */
export const LEASE_STATES = ['acquiring', 'active', 'released', 'expired', 'rolled-back', 'failed'] as const;
export type LeaseState = (typeof LEASE_STATES)[number];

/** The state-machine events (see contracts.ts LEASE_TRANSITIONS). */
export const LEASE_EVENTS = ['acquire-commit', 'acquire-fail', 'release', 'expire', 'rollback', 'fail'] as const;
export type LeaseEvent = (typeof LEASE_EVENTS)[number];

/** Ledger event names (one canonical line per event; the store owns them). */
export const LEDGER_EVENTS = [
	'acquired', 'acquire-failed', 'released', 'expired', 'rolled-back', 'failed', 'hand-off-exported', 'hand-off-restored',
] as const;
export type TaskResourceEventName = (typeof LEDGER_EVENTS)[number];

/** Release outcomes. `closed-elsewhere` = the source state already discharged the obligation. */
export const LEASE_RELEASE_OUTCOMES = ['clean', 'closed-elsewhere', 'surface-mismatch', 'error'] as const;
export type LeaseReleaseOutcome = (typeof LEASE_RELEASE_OUTCOMES)[number];

/**
 * The TL3 command ports a lease may reference (closed vocabulary; the lease
 * references the port that OWNS the runtime effect -- it never calls it).
 */
export const LEASE_OP_PORTS = [
	'flauz.browser.navigate',
	'flauz.browser.close',
	'flauz.env.create',
	'flauz.env.start',
	'flauz.env.attach',
	'flauz.env.detach',
	'flauz.env.stop',
] as const;
export type LeaseOpPort = (typeof LEASE_OP_PORTS)[number];

/** The flauz-resources surface families (contract-duplicated, DL-32). */
export const SURFACE_FAMILIES = ['file-system', 'browser', 'environment', 'model', 'task', 'artifact', 'workspace'] as const;
export type SurfaceFamily = (typeof SURFACE_FAMILIES)[number];

// ---------------------------------------------------------------------------
// Id grammars (contract-duplicated, DL-32; logical ids only -- never paths)
// ---------------------------------------------------------------------------

/** Lease ids: `flauz:lease:<16-hex>` (logical, minted per acquisition attempt). */
export const LEASE_ID_PATTERN = /^flauz:lease:[0-9a-f]{16}$/;

/** flauz-workspace task-id pattern (contract-duplicated). */
export const TASK_ID_PATTERN = /^T-\d{3,}$/;

/** flauz-browser session-id pattern (PIN-1 descriptor id). */
export const BROWSER_SESSION_ID_PATTERN = /^flauz:browser:[0-9a-f]{16}$/;

/** flauz-environments descriptor-id pattern (registry + PIN-2 key). */
export const ENVIRONMENT_ID_PATTERN = /^env-[a-z0-9][a-z0-9-]{0,47}$/;

/** flauz-environments continuity bundle-id pattern. */
export const CONTINUITY_BUNDLE_ID_PATTERN = /^flauz:continuity:[0-9a-f]{16}$/;

/** flauz-resources ResourceRef URN pattern (contract-duplicated). */
export const RESOURCE_URN_PATTERN = /^flauz:([a-z][a-z0-9-]*):([0-9a-f]{16}|[A-Za-z0-9][A-Za-z0-9._-]{0,63})$/;

export function isLeaseActor(value: unknown): value is LeaseActor {
	return typeof value === 'string' && (LEASE_ACTORS as readonly string[]).includes(value);
}

export function isTaskResourceKind(value: unknown): value is TaskResourceKind {
	return typeof value === 'string' && (TASK_RESOURCE_KINDS as readonly string[]).includes(value);
}

export function isLeaseState(value: unknown): value is LeaseState {
	return typeof value === 'string' && (LEASE_STATES as readonly string[]).includes(value);
}

export function isLeaseReleaseOutcome(value: unknown): value is LeaseReleaseOutcome {
	return typeof value === 'string' && (LEASE_RELEASE_OUTCOMES as readonly string[]).includes(value);
}

export function isLeaseOpPort(value: unknown): value is LeaseOpPort {
	return typeof value === 'string' && (LEASE_OP_PORTS as readonly string[]).includes(value);
}

export function isSurfaceFamily(value: unknown): value is SurfaceFamily {
	return typeof value === 'string' && (SURFACE_FAMILIES as readonly string[]).includes(value);
}

export function isLeaseId(value: unknown): value is string {
	return typeof value === 'string' && LEASE_ID_PATTERN.test(value);
}

export function isTaskId(value: unknown): value is string {
	return typeof value === 'string' && TASK_ID_PATTERN.test(value);
}

export function isBrowserSessionId(value: unknown): value is string {
	return typeof value === 'string' && BROWSER_SESSION_ID_PATTERN.test(value);
}

export function isEnvironmentId(value: unknown): value is string {
	return typeof value === 'string' && ENVIRONMENT_ID_PATTERN.test(value);
}

export function isContinuityBundleId(value: unknown): value is string {
	return typeof value === 'string' && CONTINUITY_BUNDLE_ID_PATTERN.test(value);
}

/** Parses `flauz:<namespace>:<local>`; undefined when not URN-shaped. */
export function parseResourceUrn(value: string): { namespace: string; local: string } | undefined {
	const match = RESOURCE_URN_PATTERN.exec(value);
	if (match === null) {
		return undefined;
	}
	return { namespace: match[1] ?? '', local: match[2] ?? '' };
}

// ---------------------------------------------------------------------------
// Typed failures (fail-closed; typed results at the op boundary, typed throws
// from the pure parse helpers -- the sibling-lane precedent)
// ---------------------------------------------------------------------------

/**
 * Machine-checkable failure codes. The first seven are the mission's semantic
 * failure classes; the remainder are this module's infrastructure codes
 * (state-machine, no-flattening, consumed-state and ledger integrity).
 */
export const TASK_RESOURCE_ERROR_CODES = [
	'RESOURCE_ABSENT',      // no such logical id in the canonical TL3 state
	'TRUST_REFUSED',        // untrusted posture / not agent-operable / policy denies
	'PROVENANCE_INVALID',   // missing or unknown actor (fail-closed provenance)
	'SURFACE_MISMATCH',     // surface changed identity since acquisition
	'CONTINUITY_INVALID',   // bundle absent/incomplete/failed verify
	'LEASE_CONFLICT',       // task already holds an active lease for the id
	'TIMEOUT',              // acquisition deadline exceeded (injectable clock)
	'LEASE_ILLEGAL_TRANSITION', // illegal lease-state event (allowed source states listed)
	'SECRET_IN_LEASE',      // the no-flattening law: a lease may never carry secret payloads
	'STATE_UNREADABLE',     // a consumed TL3 state file is present but corrupt
	'REQUEST_INVALID',      // argument-shape failure at the op boundary
	'LEDGER_CORRUPT',       // the task-resources ledger is malformed
	'LEDGER_WRITE_FAILED',  // fail-closed ledger write failure
] as const;
export type TaskResourceErrorCode = (typeof TASK_RESOURCE_ERROR_CODES)[number];

/** Typed error payload carried by outcomes and ledger failure lines. */
export interface TaskResourceErrorPayload {
	readonly code: string;
	readonly message: string;
}

/** Typed error (fail-closed surfaces carry a stable code). */
export class TaskResourceError extends Error {
	readonly code: TaskResourceErrorCode;
	readonly details: Record<string, unknown> | undefined;

	constructor(code: TaskResourceErrorCode, message: string, details?: Record<string, unknown>) {
		super(`${TASK_RESOURCES_SCHEMA_ID}: ${message}`);
		this.name = 'TaskResourceError';
		this.code = code;
		this.details = details;
	}
}

/** The typed failure half of every op outcome. */
export interface TaskResourceFailure {
	readonly ok: false;
	readonly error: TaskResourceErrorPayload;
	/** The ledger line minted for this failure, when one was recorded. */
	readonly record?: TaskResourceLedgerRecord;
}

// ---------------------------------------------------------------------------
// Provenance (MANDATORY on every record -- the PIN-1 journal law)
// ---------------------------------------------------------------------------

/** Provenance of a lease mutation. The actor is MANDATORY (fail-closed). */
export interface LeaseProvenance {
	readonly actor: LeaseActor;
	readonly actorId?: string;
	readonly sessionId?: string;
	readonly cause?: string;
}

export type ProvenanceVerdict =
	| { readonly ok: true; readonly provenance: LeaseProvenance }
	| { readonly ok: false; readonly error: TaskResourceErrorPayload };

/**
 * Validates provenance (typed result for the op boundary). An unknown or
 * missing actor FAILS LOUDLY with PROVENANCE_INVALID -- and can never be
 * recorded (a ledger record itself requires a valid actor), so provenance
 * failures are returned unrecorded by design.
 */
export function validateLeaseProvenance(value: unknown): ProvenanceVerdict {
	const refuse = (message: string): ProvenanceVerdict => ({
		ok: false,
		error: { code: 'PROVENANCE_INVALID', message },
	});
	if (!isPlainObject(value)) {
		return refuse('provenance must be an object { actor, actorId?, sessionId?, cause? }');
	}
	const keys = Object.keys(value).sort();
	const allowed = ['actor', 'actorId', 'cause', 'sessionId'];
	if (keys.length > allowed.length || keys.some((key, index) => key !== allowed[index])) {
		return refuse(`provenance must have the key [actor] plus at most [actorId, sessionId, cause] (got [${keys.join(', ')}])`);
	}
	if (!hasKey(value, 'actor')) {
		return refuse('provenance.actor is MISSING -- the actor is MANDATORY on every lease record (fail-closed provenance)');
	}
	if (!isLeaseActor(value['actor'])) {
		return refuse(`provenance.actor must be one of ${LEASE_ACTORS.join('|')} (got ${JSON.stringify(value['actor'])}) -- the actor is MANDATORY on every lease record`);
	}
	const provenance: { actor: LeaseActor; actorId?: string; sessionId?: string; cause?: string } = { actor: value['actor'] };
	for (const key of ['actorId', 'sessionId', 'cause'] as const) {
		const raw = value[key];
		if (raw !== undefined) {
			if (typeof raw !== 'string' || raw.length === 0 || raw.length > 500) {
				return refuse(`provenance.${key} must be a non-empty string of at most 500 chars when present`);
			}
			provenance[key] = raw;
		}
	}
	return { ok: true, provenance };
}

// ---------------------------------------------------------------------------
// Surface snapshots (the access surface AT acquisition -- versioned)
// ---------------------------------------------------------------------------

/**
 * One pinned access surface. `version` is the version marker of the SOURCE
 * state the snapshot was taken from: the PIN-1 journal record `ts` for
 * browser sessions, the PIN-2 lifecycle entry `updatedAt` for environments,
 * and the graph's surface version index (`versions.length`) for resource
 * refs. `surface` is the contract-duplicated surface record (JSON-safe; it
 * NEVER carries secret payloads -- the no-flattening law).
 */
export interface LeaseSurfaceEntry {
	readonly family: SurfaceFamily;
	readonly version: number;
	readonly surface: Readonly<Record<string, unknown>>;
}

/** The versioned surface snapshot pinned by a lease at acquisition. */
export interface LeaseSurfaceSnapshot {
	readonly surfaces: readonly LeaseSurfaceEntry[];
}

// ---------------------------------------------------------------------------
// The lease record (envelope flauz.task-resources/v0)
// ---------------------------------------------------------------------------

/** The discharge block stamped on release. */
export interface LeaseReleaseBlock {
	readonly outcome: LeaseReleaseOutcome;
	readonly releasedAt: number;
	readonly observed?: string;
	readonly opPort?: string;
}

/**
 * One task resource lease: the TASK-GRAPH-LEVEL obligation binding a durable
 * task to a LOGICAL resource id. `resourceId` is always the TL3 logical id
 * (`flauz:browser:<16-hex>` / environment registry id / ResourceRef URN) --
 * never a path, never a URL.
 */
export interface TaskResourceLease {
	readonly schemaVersion: 0;
	readonly leaseId: string;
	readonly taskId: string;
	readonly resourceKind: TaskResourceKind;
	readonly resourceId: string;
	readonly actor: LeaseProvenance;
	readonly state: LeaseState;
	readonly acquiredAt: number;
	readonly expiresAt?: number;
	readonly release?: LeaseReleaseBlock;
	readonly surfaceSnapshot?: LeaseSurfaceSnapshot;
	readonly continuityBundleId?: string;
	readonly opPort?: string;
}

// ---------------------------------------------------------------------------
// Hand-off metadata (task suspend / planSwitch -- the additive
// `planSwitch.continuityBundleId?` field is the TL3-006 precedent)
// ---------------------------------------------------------------------------

/** The export-point record: what a task carries across an execution hand-off. */
export interface TaskHandOffExportRecord {
	readonly schemaVersion: 0;
	readonly taskId: string;
	readonly ts: number;
	readonly actor: LeaseProvenance;
	readonly continuityBundleId?: string;
	readonly leaseIds: readonly string[];
}

/** The restore-point record: the bundle verified, the leases re-bound. */
export interface TaskHandOffRestoreRecord {
	readonly schemaVersion: 0;
	readonly taskId: string;
	readonly ts: number;
	readonly actor: LeaseProvenance;
	readonly continuityBundleId?: string;
	readonly reboundLeaseIds: readonly string[];
	/** Leases from the export that were NOT re-bound (discharged before the switch) -- typed, never silently dropped. */
	readonly skippedLeaseIds: readonly string[];
	readonly targetEnvironmentId?: string;
}

/** Union hand-off metadata type. */
export type TaskHandOffRecord = TaskHandOffExportRecord | TaskHandOffRestoreRecord;

// ---------------------------------------------------------------------------
// The ledger records (one canonical line per event; the exact key sets)
// ---------------------------------------------------------------------------

interface LedgerCommon {
	readonly schemaVersion: 0;
	readonly schema: typeof TASK_RESOURCES_SCHEMA_ID;
	readonly ts: number;
	readonly actor: LeaseActor;
	readonly taskId: string;
}

export interface LeaseAcquiredRecord extends LedgerCommon {
	readonly event: 'acquired';
	readonly leaseId: string;
	readonly resourceId: string;
	readonly resourceKind: TaskResourceKind;
	readonly lease: TaskResourceLease;
}

export interface LeaseAcquireFailedRecord extends LedgerCommon {
	readonly event: 'acquire-failed';
	readonly leaseId: string;
	readonly resourceId: string;
	readonly resourceKind: TaskResourceKind;
	readonly error: TaskResourceErrorPayload;
}

export interface LeaseReleasedRecord extends LedgerCommon {
	readonly event: 'released';
	readonly leaseId: string;
	readonly resourceId: string;
	readonly resourceKind: TaskResourceKind;
	readonly outcome: LeaseReleaseOutcome;
	readonly opPort?: string;
	readonly observed?: string;
}

export interface LeaseExpiredRecord extends LedgerCommon {
	readonly event: 'expired';
	readonly leaseId: string;
	readonly resourceId: string;
	readonly resourceKind: TaskResourceKind;
	readonly expiresAt: number;
}

export interface LeaseRolledBackRecord extends LedgerCommon {
	readonly event: 'rolled-back';
	readonly leaseId: string;
	readonly resourceId: string;
	readonly resourceKind: TaskResourceKind;
	readonly reason: string;
}

export interface LeaseFailedRecord extends LedgerCommon {
	readonly event: 'failed';
	readonly leaseId: string;
	readonly resourceId: string;
	readonly resourceKind: TaskResourceKind;
	readonly error: TaskResourceErrorPayload;
}

export interface HandOffExportedRecord extends LedgerCommon {
	readonly event: 'hand-off-exported';
	readonly continuityBundleId?: string;
	readonly leaseIds: readonly string[];
}

export interface HandOffRestoredRecord extends LedgerCommon {
	readonly event: 'hand-off-restored';
	readonly continuityBundleId?: string;
	readonly reboundLeaseIds: readonly string[];
	readonly targetEnvironmentId?: string;
}

export type TaskResourceLedgerRecord =
	| LeaseAcquiredRecord
	| LeaseAcquireFailedRecord
	| LeaseReleasedRecord
	| LeaseExpiredRecord
	| LeaseRolledBackRecord
	| LeaseFailedRecord
	| HandOffExportedRecord
	| HandOffRestoredRecord;

// ---------------------------------------------------------------------------
// Small shared helpers (duplicated verbatim from the sibling lanes, DL-32)
// ---------------------------------------------------------------------------

export function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Own-property presence check (the eslint-blessed replacement for the `in` operator). */
export function hasKey(obj: object, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(obj, key);
}

/** Every key must be known (required present, optional allowed, unknown rejected). */
export function hasOnlyKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[]): boolean {
	const allowed = new Set([...required, ...optional]);
	for (const key of Object.keys(value)) {
		if (!allowed.has(key)) {
			return false;
		}
	}
	return required.every(key => hasKey(value, key));
}

export function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}

function isBoundedString(value: unknown, max: number): value is string {
	return isNonEmptyString(value) && value.length <= max;
}

export function isPositiveEpochMs(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/** POSIX-style join (v0 targets POSIX workspace roots; documented in the sibling READMEs). */
export function joinPath(...parts: readonly string[]): string {
	return parts.filter(part => part.length > 0).join('/').replace(/\/{2,}/g, '/');
}

/**
 * Canonical JSON: keys sorted recursively, no insignificant whitespace,
 * `undefined` values dropped. This is the exact byte form of every
 * task-resources ledger line (the PIN-1/PIN-2 JSONL byte law).
 */
export function canonicalJson(value: unknown): string {
	if (value === null || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return '[' + value.map(canonicalJson).join(',') + ']';
	}
	if (typeof value === 'object') {
		const record = value as Record<string, unknown>;
		const keys = Object.keys(record).filter(key => record[key] !== undefined).sort();
		return '{' + keys.map(key => JSON.stringify(key) + ':' + canonicalJson(record[key])).join(',') + '}';
	}
	throw new TaskResourceError('REQUEST_INVALID', `cannot canonicalize value of type ${typeof value} (lease payloads must be JSON-safe)`);
}

// ---------------------------------------------------------------------------
// sha256 (pure TypeScript, zero deps -- verbatim the sibling-lane copy)
// ---------------------------------------------------------------------------

const SHA256_K = new Uint32Array([
	0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
	0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0xbdc06a7, 0xc19bf174,
	0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
	0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
	0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
	0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
	0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
	0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
	return ((x >>> n) | (x << (32 - n))) >>> 0;
}

/**
 * Hand-rolled UTF-8 encoder. The flauz-agent shims declare no TextEncoder
 * (and this module must not touch the existing shim file), so the encoder
 * is local -- one code path for the extension host and `node --test`.
 */
function utf8Bytes(input: string): Uint8Array {
	const bytes: number[] = [];
	for (let i = 0; i < input.length; i++) {
		let code = input.charCodeAt(i);
		if (code >= 0xd800 && code <= 0xdbff && i + 1 < input.length) {
			const next = input.charCodeAt(i + 1);
			if (next >= 0xdc00 && next <= 0xdfff) {
				code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
				i++;
			}
		}
		if (code < 0x80) {
			bytes.push(code);
		} else if (code < 0x800) {
			bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
		} else if (code < 0x10000) {
			bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
		} else {
			bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
		}
	}
	return new Uint8Array(bytes);
}

/** sha256 over the UTF-8 bytes of `input`, hex-encoded (used for bundle integrity checks). */
export function sha256Hex(input: string): string {
	const bytes = utf8Bytes(input);
	const bitLength = bytes.length * 8;
	const paddedLength = (((bytes.length + 8) >> 6) + 1) << 6;
	const padded = new Uint8Array(paddedLength);
	padded.set(bytes);
	padded[bytes.length] = 0x80;
	const view = new DataView(padded.buffer);
	view.setUint32(paddedLength - 8, Math.floor(bitLength / 4294967296), false);
	view.setUint32(paddedLength - 4, bitLength >>> 0, false);

	let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
	let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

	const w = new Uint32Array(64);
	for (let block = 0; block < paddedLength; block += 64) {
		for (let i = 0; i < 16; i++) {
			w[i] = view.getUint32(block + i * 4, false);
		}
		for (let i = 16; i < 64; i++) {
			const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
			const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
			w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
		}
		let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
		for (let i = 0; i < 64; i++) {
			const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
			const ch = (e & f) ^ (~e & g);
			const t1 = (h + S1 + ch + SHA256_K[i]! + w[i]!) >>> 0;
			const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
			const maj = (a & b) ^ (a & c) ^ (b & c);
			const t2 = (S0 + maj) >>> 0;
			h = g; g = f; f = e; e = (d + t1) >>> 0;
			d = c; c = b; b = a; a = (t1 + t2) >>> 0;
		}
		h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
		h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
	}

	return [h0, h1, h2, h3, h4, h5, h6, h7]
		.map(word => word.toString(16).padStart(8, '0'))
		.join('');
}

// ---------------------------------------------------------------------------
// Secret-shape detection (the no-flattening law; pattern text only -- no
// complete secret shape is ever spelled out in this source file)
// ---------------------------------------------------------------------------

const SECRET_SHAPED_PATTERNS: readonly RegExp[] = [
	/\bghp_[A-Za-z0-9]{20,}\b/,
	/\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
	/\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}\b/,
	/\bAKIA[0-9A-Z]{16}\b/,
	/\bASIA[0-9A-Z]{16}\b/,
	/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
	/-----BEGIN [A-Z ]*PRIVATE KEY-----/,
	/\bBearer [A-Za-z0-9._-]{16,}\b/,
	/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{16,}\b/,
];

export function looksSecretShaped(value: string): boolean {
	return SECRET_SHAPED_PATTERNS.some(pattern => pattern.test(value));
}

/** The JSON-path-ish location of the first secret-shaped string found, or undefined. */
export function findSecretShapedValue(value: unknown, path: string): string | undefined {
	if (typeof value === 'string') {
		return looksSecretShaped(value) ? path : undefined;
	}
	if (Array.isArray(value)) {
		for (const [index, item] of value.entries()) {
			const found = findSecretShapedValue(item, `${path}[${index}]`);
			if (found !== undefined) {
				return found;
			}
		}
		return undefined;
	}
	if (isPlainObject(value)) {
		for (const key of Object.keys(value).sort()) {
			const found = findSecretShapedValue(value[key], `${path}.${key}`);
			if (found !== undefined) {
				return found;
			}
		}
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// Ports (injected; the core stays free of node typings and runtime deps)
// ---------------------------------------------------------------------------

/**
 * Filesystem port consumed by the lease layer. The extension host wires a
 * vscode.workspace.fs-backed implementation; tests wire in-memory or node:fs
 * ports. Keeping this a port is what lets the core typecheck without
 * @types/node and run under plain `node --test` type stripping.
 */
export interface FileSystemPort {
	readFileUtf8(path: string): Promise<string | undefined>;
	writeFile(path: string, contents: string): Promise<void>;
	rename(fromPath: string, toPath: string): Promise<void>;
	mkdir(path: string): Promise<void>;
}

/** Injectable clock (deterministic fixtures in tests; Date.now in the host). `now` is ALWAYS injected, never read from the wall. */
export type Clock = () => number;

/** Mints a logical lease id `flauz:lease:<16-hex>` (WebCrypto when available). */
export function mintLeaseId(): string {
	const bytes = new Uint8Array(8);
	const source = (globalThis as { crypto?: { getRandomValues(view: Uint8Array): Uint8Array } }).crypto;
	if (source !== undefined) {
		source.getRandomValues(bytes);
	} else {
		for (let i = 0; i < bytes.length; i++) {
			bytes[i] = Math.floor(Math.random() * 256);
		}
	}
	return 'flauz:lease:' + Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Strict record validation (typed throws -- the sibling parse precedent)
// ---------------------------------------------------------------------------

const ERROR_CODE_MAX = 64;
const ERROR_MESSAGE_MAX = 300;
const OBSERVED_MAX = 500;
const REASON_MAX = 500;

function invalid(message: string): TaskResourceError {
	return new TaskResourceError('LEDGER_CORRUPT', message);
}

function parseErrorPayload(value: unknown, where: string): TaskResourceErrorPayload {
	if (!isPlainObject(value) || !hasOnlyKeys(value, ['code', 'message'], [])) {
		throw invalid(`${where}.error must have exactly the keys [code, message]`);
	}
	if (!isBoundedString(value['code'], ERROR_CODE_MAX)) {
		throw invalid(`${where}.error.code must be a non-empty string of at most ${ERROR_CODE_MAX} chars`);
	}
	if (!isBoundedString(value['message'], ERROR_MESSAGE_MAX)) {
		throw invalid(`${where}.error.message must be a non-empty string of at most ${ERROR_MESSAGE_MAX} chars`);
	}
	return { code: value['code'], message: value['message'] };
}

function parseSurfaceEntry(value: unknown, where: string): LeaseSurfaceEntry {
	if (!isPlainObject(value) || !hasOnlyKeys(value, ['family', 'version', 'surface'], [])) {
		throw invalid(`${where} must have exactly the keys [family, version, surface]`);
	}
	if (!isSurfaceFamily(value['family'])) {
		throw invalid(`${where}.family must be one of ${SURFACE_FAMILIES.join('|')} (got ${JSON.stringify(value['family'])})`);
	}
	if (typeof value['version'] !== 'number' || !Number.isSafeInteger(value['version']) || value['version'] < 1) {
		throw invalid(`${where}.version must be a positive integer (the source-state version marker)`);
	}
	if (!isPlainObject(value['surface'])) {
		throw invalid(`${where}.surface must be a plain object (the contract-duplicated surface record)`);
	}
	if (findSecretShapedValue(value['surface'], `${where}.surface`) !== undefined) {
		throw invalid(`${where}.surface carries a secret-shaped literal -- lease surfaces may carry only vault-style references, never payloads (the no-flattening law)`);
	}
	return { family: value['family'], version: value['version'], surface: value['surface'] as Readonly<Record<string, unknown>> };
}

function parseSurfaceSnapshot(value: unknown, where: string): LeaseSurfaceSnapshot {
	if (!isPlainObject(value) || !hasOnlyKeys(value, ['surfaces'], [])) {
		throw invalid(`${where} must have exactly the keys [surfaces]`);
	}
	if (!Array.isArray(value['surfaces'])) {
		throw invalid(`${where}.surfaces must be an array of surface entries`);
	}
	const surfaces: LeaseSurfaceEntry[] = [];
	for (const [index, entry] of (value['surfaces'] as readonly unknown[]).entries()) {
		surfaces.push(parseSurfaceEntry(entry, `${where}.surfaces[${index}]`));
	}
	return { surfaces };
}

function parseProvenanceRecord(value: unknown, where: string): LeaseProvenance {
	const verdict = validateLeaseProvenance(value);
	if (!verdict.ok) {
		throw invalid(`${where}: ${verdict.error.message}`);
	}
	return verdict.provenance;
}

function parseReleaseBlock(value: unknown, where: string): LeaseReleaseBlock {
	if (!isPlainObject(value) || !hasOnlyKeys(value, ['outcome', 'releasedAt'], ['observed', 'opPort'])) {
		throw invalid(`${where} must have exactly the keys [outcome, releasedAt] + optional [observed, opPort]`);
	}
	if (!isLeaseReleaseOutcome(value['outcome'])) {
		throw invalid(`${where}.outcome must be one of ${LEASE_RELEASE_OUTCOMES.join('|')} (got ${JSON.stringify(value['outcome'])})`);
	}
	if (!isPositiveEpochMs(value['releasedAt'])) {
		throw invalid(`${where}.releasedAt must be a positive epoch-ms integer`);
	}
	if (value['observed'] !== undefined && !isBoundedString(value['observed'], OBSERVED_MAX)) {
		throw invalid(`${where}.observed must be a non-empty string of at most ${OBSERVED_MAX} chars when present`);
	}
	if (value['opPort'] !== undefined && !isLeaseOpPort(value['opPort'])) {
		throw invalid(`${where}.opPort must be a known TL3 command port when present (got ${JSON.stringify(value['opPort'])})`);
	}
	const block: { outcome: LeaseReleaseOutcome; releasedAt: number; observed?: string; opPort?: string } = { outcome: value['outcome'], releasedAt: value['releasedAt'] };
	if (value['observed'] !== undefined) {
		block.observed = value['observed'];
	}
	if (value['opPort'] !== undefined) {
		block.opPort = value['opPort'];
	}
	return block;
}

/** Validates + parses one lease record (strict, exact key set; typed LEDGER_CORRUPT throws). */
export function parseTaskResourceLease(value: unknown, where: string): TaskResourceLease {
	if (!isPlainObject(value)) {
		throw invalid(`${where} must be a plain object (TaskResourceLease)`);
	}
	if (!hasOnlyKeys(value, ['schemaVersion', 'leaseId', 'taskId', 'resourceKind', 'resourceId', 'actor', 'state', 'acquiredAt'], ['expiresAt', 'release', 'surfaceSnapshot', 'continuityBundleId', 'opPort'])) {
		throw invalid(`${where} must have exactly the keys [schemaVersion, leaseId, taskId, resourceKind, resourceId, actor, state, acquiredAt] + optional [expiresAt, release, surfaceSnapshot, continuityBundleId, opPort] (got [${Object.keys(value).sort().join(', ')}])`);
	}
	if (value['schemaVersion'] !== TASK_RESOURCES_SCHEMA_VERSION) {
		throw invalid(`${where}.schemaVersion must be exactly ${TASK_RESOURCES_SCHEMA_VERSION} (got ${JSON.stringify(value['schemaVersion'])})`);
	}
	if (!isLeaseId(value['leaseId'])) {
		throw invalid(`${where}.leaseId must be a logical id 'flauz:lease:<16-hex>' (got ${JSON.stringify(value['leaseId'])})`);
	}
	if (!isTaskId(value['taskId'])) {
		throw invalid(`${where}.taskId must match the flauz-workspace task-id pattern 'T-<3+ digits>' (got ${JSON.stringify(value['taskId'])})`);
	}
	if (!isTaskResourceKind(value['resourceKind'])) {
		throw invalid(`${where}.resourceKind must be one of ${TASK_RESOURCE_KINDS.join('|')} (got ${JSON.stringify(value['resourceKind'])})`);
	}
	if (!isNonEmptyString(value['resourceId'])) {
		throw invalid(`${where}.resourceId must be a non-empty string`);
	}
	if (!isLeaseState(value['state'])) {
		throw invalid(`${where}.state must be one of ${LEASE_STATES.join('|')} (got ${JSON.stringify(value['state'])})`);
	}
	if (!isPositiveEpochMs(value['acquiredAt'])) {
		throw invalid(`${where}.acquiredAt must be a positive epoch-ms integer`);
	}
	if (value['expiresAt'] !== undefined && !isPositiveEpochMs(value['expiresAt'])) {
		throw invalid(`${where}.expiresAt must be a positive epoch-ms integer when present`);
	}
	if (value['continuityBundleId'] !== undefined && !isContinuityBundleId(value['continuityBundleId'])) {
		throw invalid(`${where}.continuityBundleId must be a logical id 'flauz:continuity:<16-hex>' when present (got ${JSON.stringify(value['continuityBundleId'])})`);
	}
	if (value['opPort'] !== undefined && !isLeaseOpPort(value['opPort'])) {
		throw invalid(`${where}.opPort must be a known TL3 command port when present (got ${JSON.stringify(value['opPort'])}) -- the lease references the port, it never calls it`);
	}
	const actor = parseProvenanceRecord(value['actor'], `${where}.actor`);
	const release = value['release'] === undefined ? undefined : parseReleaseBlock(value['release'], `${where}.release`);
	const surfaceSnapshot = value['surfaceSnapshot'] === undefined ? undefined : parseSurfaceSnapshot(value['surfaceSnapshot'], `${where}.surfaceSnapshot`);
	if (findSecretShapedValue(value, where) !== undefined) {
		throw invalid(`${where} carries a secret-shaped literal -- lease records may carry only logical ids and vault-style references, never payloads (the no-flattening law)`);
	}
	const lease: {
		schemaVersion: 0; leaseId: string; taskId: string; resourceKind: TaskResourceKind; resourceId: string;
		actor: LeaseProvenance; state: LeaseState; acquiredAt: number; expiresAt?: number;
		release?: LeaseReleaseBlock; surfaceSnapshot?: LeaseSurfaceSnapshot; continuityBundleId?: string; opPort?: string;
	} = {
		schemaVersion: TASK_RESOURCES_SCHEMA_VERSION,
		leaseId: value['leaseId'],
		taskId: value['taskId'],
		resourceKind: value['resourceKind'],
		resourceId: value['resourceId'],
		actor,
		state: value['state'],
		acquiredAt: value['acquiredAt'],
	};
	if (value['expiresAt'] !== undefined) {
		lease.expiresAt = value['expiresAt'];
	}
	if (release !== undefined) {
		lease.release = release;
	}
	if (surfaceSnapshot !== undefined) {
		lease.surfaceSnapshot = surfaceSnapshot;
	}
	if (value['continuityBundleId'] !== undefined) {
		lease.continuityBundleId = value['continuityBundleId'];
	}
	if (value['opPort'] !== undefined) {
		lease.opPort = value['opPort'];
	}
	return lease;
}

function parseIdList(value: unknown, where: string): readonly string[] {
	if (!Array.isArray(value)) {
		throw invalid(`${where} must be an array of lease ids`);
	}
	const ids: string[] = [];
	for (const [index, item] of (value as readonly unknown[]).entries()) {
		if (!isLeaseId(item)) {
			throw invalid(`${where}[${index}] must be a logical id 'flauz:lease:<16-hex>'`);
		}
		ids.push(item);
	}
	return ids;
}

/**
 * Validates + parses one ledger record (strict, exact per-event key set;
 * typed LEDGER_CORRUPT throws). The record's bytes are NOT checked here --
 * canonicality is a verify()-level byte law (see store.ts).
 */
export function parseTaskResourceRecord(value: unknown, where: string): TaskResourceLedgerRecord {
	if (!isPlainObject(value)) {
		throw invalid(`${where} must be a plain object`);
	}
	if (value['schemaVersion'] !== TASK_RESOURCES_SCHEMA_VERSION) {
		throw invalid(`${where} schemaVersion must be exactly ${TASK_RESOURCES_SCHEMA_VERSION} (got ${JSON.stringify(value['schemaVersion'])})`);
	}
	if (value['schema'] !== TASK_RESOURCES_SCHEMA_ID) {
		throw invalid(`${where} schema must be exactly '${TASK_RESOURCES_SCHEMA_ID}' (got ${JSON.stringify(value['schema'])})`);
	}
	if (!isPositiveEpochMs(value['ts'])) {
		throw invalid(`${where} ts must be a positive epoch-ms integer`);
	}
	if (!isLeaseActor(value['actor'])) {
		throw invalid(`${where} actor must be one of ${LEASE_ACTORS.join('|')} (got ${JSON.stringify(value['actor'])}) -- the actor is MANDATORY on every ledger record`);
	}
	if (!isTaskId(value['taskId'])) {
		throw invalid(`${where} taskId must match the flauz-workspace task-id pattern 'T-<3+ digits>'`);
	}
	if (typeof value['event'] !== 'string' || !(LEDGER_EVENTS as readonly string[]).includes(value['event'])) {
		throw invalid(`${where} event must be one of ${LEDGER_EVENTS.join('|')} (got ${JSON.stringify(value['event'])})`);
	}
	const event = value['event'];
	const common = { schemaVersion: TASK_RESOURCES_SCHEMA_VERSION as 0, schema: TASK_RESOURCES_SCHEMA_ID as typeof TASK_RESOURCES_SCHEMA_ID, ts: value['ts'], actor: value['actor'], taskId: value['taskId'] };
	const requireKeys = (required: readonly string[], optional: readonly string[]): void => {
		if (!hasOnlyKeys(value, [...required, 'schemaVersion', 'schema', 'ts', 'actor', 'event', 'taskId'], optional)) {
			throw invalid(`${where} (${event}) must have the keys [${[...required, 'event', 'taskId'].sort().join(', ')}] over the common set [event, schema, schemaVersion, taskId, ts, actor] plus at most [${optional.join(', ')}] (got [${Object.keys(value).sort().join(', ')}])`);
		}
	};
	const leaseIdOf = (): string => {
		if (!isLeaseId(value['leaseId'])) {
			throw invalid(`${where} (${event}) leaseId must be a logical id 'flauz:lease:<16-hex>' (got ${JSON.stringify(value['leaseId'])})`);
		}
		return value['leaseId'];
	};
	const resourceIdOf = (): string => {
		if (!isNonEmptyString(value['resourceId'])) {
			throw invalid(`${where} (${event}) resourceId must be a non-empty logical id`);
		}
		return value['resourceId'];
	};
	const kindOf = (): TaskResourceKind => {
		if (!isTaskResourceKind(value['resourceKind'])) {
			throw invalid(`${where} (${event}) resourceKind must be one of ${TASK_RESOURCE_KINDS.join('|')}`);
		}
		return value['resourceKind'];
	};
	switch (event) {
		case 'acquired': {
			requireKeys(['leaseId', 'resourceId', 'resourceKind', 'lease'], []);
			const lease = parseTaskResourceLease(value['lease'], `${where} (${event}).lease`);
			if (lease.leaseId !== value['leaseId'] || lease.taskId !== value['taskId'] || lease.resourceId !== value['resourceId'] || lease.resourceKind !== value['resourceKind']) {
				throw invalid(`${where} (${event}): the embedded lease must agree with the record's leaseId/taskId/resourceId/resourceKind`);
			}
			if (lease.state !== 'active') {
				throw invalid(`${where} (${event}): the embedded lease must be committed in state 'active' (got '${lease.state}')`);
			}
			if (lease.acquiredAt !== value['ts']) {
				throw invalid(`${where} (${event}): the embedded lease acquiredAt must equal the record ts`);
			}
			if (lease.actor.actor !== value['actor']) {
				throw invalid(`${where} (${event}): the embedded lease actor must agree with the record actor`);
			}
			return { ...common, event, leaseId: lease.leaseId, resourceId: lease.resourceId, resourceKind: lease.resourceKind, lease };
		}
		case 'acquire-failed': {
			requireKeys(['leaseId', 'resourceId', 'resourceKind', 'error'], []);
			return { ...common, event: 'acquire-failed' as const, leaseId: leaseIdOf(), resourceId: resourceIdOf(), resourceKind: kindOf(), error: parseErrorPayload(value['error'], `${where} (acquire-failed)`) };
		}
		case 'failed': {
			requireKeys(['leaseId', 'resourceId', 'resourceKind', 'error'], []);
			return { ...common, event: 'failed' as const, leaseId: leaseIdOf(), resourceId: resourceIdOf(), resourceKind: kindOf(), error: parseErrorPayload(value['error'], `${where} (failed)`) };
		}
		case 'released': {
			requireKeys(['leaseId', 'resourceId', 'resourceKind', 'outcome'], ['opPort', 'observed']);
			if (!isLeaseReleaseOutcome(value['outcome'])) {
				throw invalid(`${where} (released) outcome must be one of ${LEASE_RELEASE_OUTCOMES.join('|')} (got ${JSON.stringify(value['outcome'])})`);
			}
			if (value['opPort'] !== undefined && !isLeaseOpPort(value['opPort'])) {
				throw invalid(`${where} (released) opPort must be a known TL3 command port when present`);
			}
			if (value['observed'] !== undefined && !isBoundedString(value['observed'], OBSERVED_MAX)) {
				throw invalid(`${where} (released) observed must be a non-empty string of at most ${OBSERVED_MAX} chars when present`);
			}
			const record: { schemaVersion: 0; schema: typeof TASK_RESOURCES_SCHEMA_ID; ts: number; actor: LeaseActor; taskId: string; event: 'released'; leaseId: string; resourceId: string; resourceKind: TaskResourceKind; outcome: LeaseReleaseOutcome; opPort?: string; observed?: string } = {
				...common, event, leaseId: leaseIdOf(), resourceId: resourceIdOf(), resourceKind: kindOf(), outcome: value['outcome'],
			};
			if (value['opPort'] !== undefined) {
				record.opPort = value['opPort'];
			}
			if (value['observed'] !== undefined) {
				record.observed = value['observed'];
			}
			return record;
		}
		case 'expired': {
			requireKeys(['leaseId', 'resourceId', 'resourceKind', 'expiresAt'], []);
			if (!isPositiveEpochMs(value['expiresAt'])) {
				throw invalid(`${where} (expired) expiresAt must be a positive epoch-ms integer`);
			}
			return { ...common, event, leaseId: leaseIdOf(), resourceId: resourceIdOf(), resourceKind: kindOf(), expiresAt: value['expiresAt'] };
		}
		case 'rolled-back': {
			requireKeys(['leaseId', 'resourceId', 'resourceKind', 'reason'], []);
			if (!isBoundedString(value['reason'], REASON_MAX)) {
				throw invalid(`${where} (rolled-back) reason must be a non-empty string of at most ${REASON_MAX} chars`);
			}
			return { ...common, event, leaseId: leaseIdOf(), resourceId: resourceIdOf(), resourceKind: kindOf(), reason: value['reason'] };
		}
		case 'hand-off-exported': {
			requireKeys(['leaseIds'], ['continuityBundleId']);
			if (value['continuityBundleId'] !== undefined && !isContinuityBundleId(value['continuityBundleId'])) {
				throw invalid(`${where} (hand-off-exported) continuityBundleId must be a logical id 'flauz:continuity:<16-hex>' when present`);
			}
			const leaseIds = parseIdList(value['leaseIds'], `${where} (hand-off-exported) leaseIds`);
			const record: { schemaVersion: 0; schema: typeof TASK_RESOURCES_SCHEMA_ID; ts: number; actor: LeaseActor; taskId: string; event: 'hand-off-exported'; leaseIds: readonly string[]; continuityBundleId?: string } = { ...common, event, leaseIds };
			if (value['continuityBundleId'] !== undefined) {
				record.continuityBundleId = value['continuityBundleId'];
			}
			return record;
		}
		case 'hand-off-restored': {
			requireKeys(['reboundLeaseIds'], ['continuityBundleId', 'targetEnvironmentId']);
			if (value['continuityBundleId'] !== undefined && !isContinuityBundleId(value['continuityBundleId'])) {
				throw invalid(`${where} (hand-off-restored) continuityBundleId must be a logical id 'flauz:continuity:<16-hex>' when present`);
			}
			if (value['targetEnvironmentId'] !== undefined && !isEnvironmentId(value['targetEnvironmentId'])) {
				throw invalid(`${where} (hand-off-restored) targetEnvironmentId must be a registry environment id 'env-<slug>' when present`);
			}
			const record: { schemaVersion: 0; schema: typeof TASK_RESOURCES_SCHEMA_ID; ts: number; actor: LeaseActor; taskId: string; event: 'hand-off-restored'; reboundLeaseIds: readonly string[]; continuityBundleId?: string; targetEnvironmentId?: string } = {
				...common, event: 'hand-off-restored' as const, reboundLeaseIds: parseIdList(value['reboundLeaseIds'], `${where} (hand-off-restored) reboundLeaseIds`),
			};
			if (value['continuityBundleId'] !== undefined) {
				record.continuityBundleId = value['continuityBundleId'];
			}
			if (value['targetEnvironmentId'] !== undefined) {
				record.targetEnvironmentId = value['targetEnvironmentId'];
			}
			return record;
		}
		default:
			throw invalid(`${where} event '${JSON.stringify(event)}' is not a task-resources ledger event`);
	}
}
