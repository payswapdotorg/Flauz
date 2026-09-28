/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-S2 (TL3 Worker C seconded to TL2) -- the task-boundary resource/execution
 * vocabulary (types only; pure, vscode-free, zero deps).
 *
 * THE LAYER-SEPARATION LAW (read this before touching anything in this dir):
 *
 *   A `TaskResourceLease` is the TASK-GRAPH-LEVEL obligation binding a durable
 *   task to a LOGICAL resource id. The ACTUAL lifecycle effects (browser open
 *   / navigate, environment start / attach, resource access) remain OWNED by
 *   the TL3 managers:
 *
 *     - flauz-browser sessionManager.ts owns CDP, tabs, navigation policy;
 *     - flauz-environments lifecycle/manager.ts owns the typed state machine,
 *       the trust gate, the process snapshot, the attach lease;
 *     - flauz-resources graph.ts owns ResourceRef identity, surfaces, edges.
 *
 *   A lease REFERENCES the op port that owns the runtime effect
 *   (`opPort: 'flauz.env.start' | 'flauz.browser.navigate' | ...`) -- it
 *   NEVER re-implements it, never calls CDP, never spawns a process, never
 *   writes TL3-owned state. The lease is the task graph saying "this task is
 *   bound to that logical id for this duration, provenance X"; the TL3 manager
 *   is the one that actually starts / stops / navigates the underlying truth.
 *
 *   This separation is what lets TL2-A's orchestrator consume the lease
 *   vocabulary without dragging TL3 runtime internals into the task graph, and
 *   what lets TL3 evolve browser / environment / resource internals without
 *   touching Agent OS semantics.
 *
 * The vocabulary (envelope `flauz.task-resources/v0`):
 *   - `TaskResourceLease`    : one task <-> one logical resource id binding;
 *   - `TaskHandOffRecord`   : export-point (suspend / planSwitch) and
 *                              restore-point (rebind after restart) carrying
 *                              the continuity bundle id + the active lease ids;
 *   - typed failure classes  : every adapter returns a typed result, never a
 *                              raw throw at the boundary (PRE-FLIGHT typed
 *                              `TaskResourceError` throws ARE allowed for
 *                              programmer mistakes like a missing actor --
 *                              following the ContinuityManager precedent).
 *
 * Cross-worker contracts (TL3 orchestrator pins) are DUPLICATED HERE AS TYPES
 * and pinned by repo-root fixtures at `test/fixtures/task-resources/` (the
 * `fixtures-continuity.test.ts` pattern, applied to the task-resource layer):
 * the journal record shape, the lifecycle envelope, the ResourceRef shape and
 * the continuity bundle manifest are NEVER imported from sibling extensions
 * (DL-32); they are duplicated as types and pinned by the fixtures.
 */
/**
 * Envelope schema id pinned into every persisted lease/hand-off record.
 */
export const TASK_RESOURCES_SCHEMA_ID = 'flauz.task-resources/v0';

/**
 * The only envelope schemaVersion this module understands.
 */
export const TASK_RESOURCES_SCHEMA_VERSION = 0;

/**
 * Ledger path, relative to the workspace root (append-only JSONL).
 */
export const TASK_RESOURCES_LEDGER_PATH = '.flauz/task-resources.jsonl';

// ---------------------------------------------------------------------------
// Closed vocabularies (v0)
// ---------------------------------------------------------------------------

/**
 * The three resource kinds a task lease can bind. The id is ALWAYS a TL3
 * LOGICAL id (URN) -- never a path, never a URL, never an endpoint:
 *
 *   - 'browser-session' : `flauz:browser:<16-hex>` (Worker A's pin);
 *   - 'environment'      : the registry descriptor id `env-<slug>` carried as
 *                          the URN local part of `flauz:environment:<id>`;
 *   - 'resource-ref'    : a ResourceRef URN `flauz:<kind-namespace>:<local>`.
 */
export const TASK_RESOURCE_KINDS = [
	'browser-session',
	'environment',
	'resource-ref',
] as const;
export type TaskResourceKind = (typeof TASK_RESOURCE_KINDS)[number];

/**
 * The actor enum -- MANDATORY provenance on every lease/hand-off record.
 * Mirrors the TL3 provenance actor vocabulary (DL-32: duplicated, never
 * imported across extension boundaries).
 */
export const TASK_RESOURCE_ACTORS = ['agent', 'human', 'tool'] as const;
export type TaskResourceActor = (typeof TASK_RESOURCE_ACTORS)[number];

/**
 * Lease states (the TL3-003 state-machine pattern, applied to the task
 * boundary). Acquire goes `acquiring -> active`; release goes
 * `active -> released`; an expired lease (`active -> expired`) is observed by
 * the periodic sweeper (the injected clock is the source of truth, never the
 * wall). A rolled-back lease (`active -> rolled-back`) records that the task
 * failed and the obligation was discharged by rollback (the TL3 manager is
 * the one that actually tears down the underlying truth; the lease records
 * the verdict). A failed lease (`acquiring|active -> failed`) records that
 * the lease itself could not be established or maintained (the underlying
 * truth may or may not exist -- the typed failure code states which).
 */
export const LEASE_STATES = [
	'acquiring',
	'active',
	'released',
	'expired',
	'rolled-back',
	'failed',
] as const;
export type LeaseState = (typeof LEASE_STATES)[number];

/** States where the task HOLDS the lease (the obligation is live). */
export const LEASE_HELD_STATES: readonly LeaseState[] = ['acquiring', 'active'];

/** States where the obligation is discharged (no longer live). */
export const LEASE_TERMINAL_STATES: readonly LeaseState[] = [
	'released',
	'expired',
	'rolled-back',
	'failed',
];

/**
 * The legal transitions of the lease state machine. Every transition returns
 * a typed result; an illegal transition is a typed `LEASE_ILLEGAL_TRANSITION`
 * error listing the allowed source states (the TL3-003 pattern, verbatim from
 * `extensions/flauz-environments/src/lifecycle/stateMachine.ts`).
 */
export const LEASE_TRANSITIONS: readonly { readonly from: readonly LeaseState[]; readonly to: LeaseState; readonly op: LeaseOpName }[] = [
	{ op: 'acquire', from: ['acquiring'], to: 'active' },
	{ op: 'release', from: ['active'], to: 'released' },
	{ op: 'expire', from: ['active'], to: 'expired' },
	{ op: 'rollback', from: ['active'], to: 'rolled-back' },
	{ op: 'fail', from: ['acquiring', 'active'], to: 'failed' },
	// idempotent release: a lease already in a terminal state stays released
	{ op: 'release', from: ['released', 'expired', 'rolled-back', 'failed'], to: 'released' },
];

/** The ops the state machine knows. */
export const LEASE_OPS = ['acquire', 'release', 'expire', 'rollback', 'fail'] as const;
export type LeaseOpName = (typeof LEASE_OPS)[number];

/**
 * The op-port vocabulary -- the TL3 command port that owns the runtime
 * effect. The lease REFERENCEES this port; it never re-implements it.
 * (Documented here so a future TL2-A orchestrator can dispatch through one
 * typed surface; the actual command is issued by the orchestrator, not by
 * the lease.)
 */
export const TASK_RESOURCE_OP_PORTS = [
	'flauz.browser.navigate',
	'flauz.browser.close',
	'flauz.env.start',
	'flauz.env.attach',
	'flauz.env.detach',
	'flauz.env.stop',
	'flauz.resource.access',
] as const;
export type TaskResourceOpPort = (typeof TASK_RESOURCE_OP_PORTS)[number];

// ---------------------------------------------------------------------------
// Provenance (MANDATORY on every lease record -- missing actor is a typed
// PROVENANCE_INVALID failure, never a silent skip)
// ---------------------------------------------------------------------------

export interface TaskResourceProvenance {
	/** Who caused the lease op. Mandatory. */
	readonly actor: TaskResourceActor;
	/** Stable id of the acting agent/human/tool (e.g. `flauz-agent`, `user-42`). */
	readonly actorId?: string;
	/** The agent session the lease op happened in, when applicable. */
	readonly sessionId?: string;
	/** The flauz task the lease is for (the binding key). */
	readonly taskId: string;
	/** Free-form human-readable cause. */
	readonly cause?: string;
}

// ---------------------------------------------------------------------------
// The lease record (the persisted shape)
// ---------------------------------------------------------------------------

/**
 * One task <-> resource binding (envelope `flauz.task-resources/v0`).
 *
 * The `resourceId` is ALWAYS the TL3 LOGICAL id:
 *   - browser-session: `flauz:browser:<16-hex>` (Worker A's pin);
 *   - environment: `flauz:environment:env-<slug>` (the URN form, never the
 *     raw descriptor id -- a lease never carries a path or a connection
 *     endpoint);
 *   - resource-ref: the ResourceRef URN `flauz:<kind-namespace>:<local>`.
 *
 * The `surfaceSnapshot` is the access surface AT acquisition -- versioned so
 * a SURFACE_MISMATCH (the surface changed identity since acquisition) is
 * detectable at release / hand-off. For secret-kind resource refs the
 * snapshot carries only the surface version + the presence flag, NEVER any
 * secret payload (the no-flattening law, DL-32).
 *
 * The `continuityBundleId` is the bundle the lease was carried in if the
 * lease survived a hand-off (additive, optional -- absent for fresh leases).
 */
export interface TaskResourceLease {
	readonly schemaVersion: typeof TASK_RESOURCES_SCHEMA_VERSION;
	readonly schema: typeof TASK_RESOURCES_SCHEMA_ID;
	/** Logical id `flauz:lease:<16-hex>` -- minted by the lease store. */
	readonly leaseId: string;
	/** The flauz task the lease binds (`T-<3+ digits>`, contract-duplicated). */
	readonly taskId: string;
	readonly resourceKind: TaskResourceKind;
	/** The TL3 LOGICAL id (URN) -- never a path, never a URL. */
	readonly resourceId: string;
	readonly actor: TaskResourceProvenance;
	readonly state: LeaseState;
	readonly acquiredAt: number;
	/** Optional expiry (epoch-ms). Absent = no expiry (held until released). */
	readonly expiresAt?: number;
	/** Present once the lease has been released / rolled back / failed. */
	readonly release?: {
		readonly outcome: 'released' | 'rolled-back' | 'failed' | 'expired';
		readonly releasedAt: number;
		readonly reason?: string;
	};
	/** The access surface AT acquisition (versioned; typed per kind). */
	readonly surfaceSnapshot?: TaskResourceSurfaceSnapshot;
	/** The bundle the lease was carried in (additive; absent for fresh leases). */
	readonly continuityBundleId?: string;
	/** The TL3 command port that owns the runtime effect (referenced, never re-implemented). */
	readonly opPort?: TaskResourceOpPort;
}

/**
 * The access surface AT acquisition -- versioned so a SURFACE_MISMATCH is
 * detectable at release / hand-off. The shape mirrors the TL3 surface
 * vocabulary (DL-32: duplicated as types, pinned by fixtures).
 */
export type TaskResourceSurfaceSnapshot =
	| { readonly kind: 'browser'; readonly partition: string; readonly tabIds?: readonly string[] }
	| { readonly kind: 'environment'; readonly descriptorId: string; readonly providerKind: string; readonly attachTarget?: string }
	| { readonly kind: 'resource-ref'; readonly refKind: string; readonly surfaceVersion?: number; readonly secretShaped?: boolean };

// ---------------------------------------------------------------------------
// Hand-off metadata (export-point / restore-point)
// ---------------------------------------------------------------------------

/**
 * One hand-off record -- the export-point (task suspend / planSwitch) and the
 * restore-point (rebind after restart). Carries the continuity bundle id
 * (the bundle the task's leases were exported into) + the active lease ids
 * (so the restore-point can re-bind them after re-hydration).
 *
 * The `kind` discriminates export vs restore (one record per direction; the
 * ledger is the durable truth -- after a restart the task graph rebuilds its
 * lease obligations from it).
 */
export const HANDOFF_KINDS = ['export', 'restore'] as const;
export type HandOffKind = (typeof HANDOFF_KINDS)[number];

export interface TaskHandOffRecord {
	readonly schemaVersion: typeof TASK_RESOURCES_SCHEMA_VERSION;
	readonly schema: typeof TASK_RESOURCES_SCHEMA_ID;
	readonly kind: HandOffKind;
	/** Logical id `flauz:handoff:<16-hex>`. */
	readonly handOffId: string;
	readonly taskId: string;
	readonly actor: TaskResourceProvenance;
	readonly ts: number;
	/** The bundle the leases were carried in (`flauz:continuity:<16-hex>`). */
	readonly continuityBundleId?: string;
	/** The active lease ids at export time (re-bound at restore time). */
	readonly leaseIds: readonly string[];
	/** Present at restore: per-lease rebind verdict (re-bound / failed / skipped). */
	readonly rebind?: Readonly<Record<string, { readonly outcome: 're-bound' | 'failed' | 'skipped'; readonly reason?: string }>>;
}

// ---------------------------------------------------------------------------
// Typed failure classes (never raw throws at the boundary)
// ---------------------------------------------------------------------------

/**
 * Machine-checkable failure codes for the task-resource layer. Every adapter
 * returns a typed `{ ok: false, error }` outcome carrying one of these; the
 * ledger records the outcome verbatim (every attempt is auditable, including
 * the destructive-class rollback/fail).
 *
 * PRE-FLIGHT failures (typed `TaskResourceError` throws -- nothing recorded,
 * nothing mutated):
 *   - PROVENANCE_INVALID    : missing/unknown actor (fail-closed provenance);
 *   - OP_INVALID            : unknown op / illegal state-machine transition;
 *   - LEASE_ID_INVALID      : malformed lease/hand-off id;
 *   - TASK_ID_INVALID       : malformed task id.
 *
 * RECORDED failures (ledger-recorded `{ ok: false, error }` outcomes -- every
 * attempt is auditable):
 *   - RESOURCE_ABSENT       : no such id in the canonical TL3 state;
 *   - TRUST_REFUSED         : env untrusted / browser not agent-operable /
 *                              policy posture denies;
 *   - SURFACE_MISMATCH      : surface changed identity since acquisition;
 *   - CONTINUITY_INVALID    : bundle absent/incomplete/failed verify;
 *   - LEASE_CONFLICT        : task already holds an active lease for the id;
 *   - TIMEOUT               : acquisition deadline exceeded (injectable clock);
 *   - STORE_FAILED          : ledger write failure (fail-closed).
 */
export const TASK_RESOURCE_ERROR_CODES = [
	// pre-flight
	'PROVENANCE_INVALID',
	'OP_INVALID',
	'LEASE_ID_INVALID',
	'TASK_ID_INVALID',
	// recorded
	'RESOURCE_ABSENT',
	'TRUST_REFUSED',
	'SURFACE_MISMATCH',
	'CONTINUITY_INVALID',
	'LEASE_CONFLICT',
	'TIMEOUT',
	'STORE_FAILED',
] as const;
export type TaskResourceErrorCode = (typeof TASK_RESOURCE_ERROR_CODES)[number];

/** Typed task-resource error (fail-closed surface; `code` is stable for logs/audit). */
export class TaskResourceError extends Error {
	readonly code: TaskResourceErrorCode;
	readonly details: Record<string, unknown> | undefined;

	constructor(code: TaskResourceErrorCode, message: string, details?: Record<string, unknown>) {
		super(`flauz.task-resources/v0: ${message}`);
		this.name = 'TaskResourceError';
		this.code = code;
		this.details = details;
	}
}

/** One typed failure outcome (the `error` field of an adapter result). */
export interface TaskResourceFailure {
	readonly code: TaskResourceErrorCode;
	readonly message: string;
	readonly details?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Id grammars (DL-32: contract-duplicated patterns, pinned by fixtures)
// ---------------------------------------------------------------------------

/** Lease id: `flauz:lease:<16-hex>`. */
export const LEASE_ID_PATTERN = /^flauz:lease:[0-9a-f]{16}$/;

/** Hand-off id: `flauz:handoff:<16-hex>`. */
export const HANDOFF_ID_PATTERN = /^flauz:handoff:[0-9a-f]{16}$/;

/** Continuity bundle id: `flauz:continuity:<16-hex>` (TL3-006 pin). */
export const CONTINUITY_BUNDLE_ID_PATTERN = /^flauz:continuity:[0-9a-f]{16}$/;

/** Task id: `T-<3+ digits>` (flauz-workspace pin, DL-32). */
export const TASK_ID_PATTERN = /^T-\d{3,}$/;

/** Browser-session id: `flauz:browser:<16-hex>` (Worker A pin). */
export const BROWSER_SESSION_ID_PATTERN = /^flauz:browser:[0-9a-f]{16}$/;

/** Environment id: `env-<slug>` (flauz-environments pin, DL-32). */
export const ENVIRONMENT_ID_PATTERN = /^env-[a-z0-9][a-z0-9-]{0,47}$/;

/** ResourceRef URN: `flauz:<kind-namespace>:<16-hex-or-slug>` (DL-32). */
export const RESOURCE_REF_ID_PATTERN = /^flauz:[a-z][a-z0-9-]*:(?:[0-9a-f]{16}|[A-Za-z0-9][A-Za-z0-9._-]{0,63})$/;

/** `true` when `value` is a well-formed lease id. */
export function isLeaseId(value: unknown): value is string {
	return typeof value === 'string' && LEASE_ID_PATTERN.test(value);
}

/** `true` when `value` is a well-formed hand-off id. */
export function isHandOffId(value: unknown): value is string {
	return typeof value === 'string' && HANDOFF_ID_PATTERN.test(value);
}

/** `true` when `value` is a well-formed continuity bundle id. */
export function isContinuityBundleId(value: unknown): value is string {
	return typeof value === 'string' && CONTINUITY_BUNDLE_ID_PATTERN.test(value);
}

/** `true` when `value` is a well-formed task id. */
export function isTaskId(value: unknown): value is string {
	return typeof value === 'string' && TASK_ID_PATTERN.test(value);
}

/** `true` when `value` is a well-formed browser-session id. */
export function isBrowserSessionId(value: unknown): value is string {
	return typeof value === 'string' && BROWSER_SESSION_ID_PATTERN.test(value);
}

/** `true` when `value` is a well-formed environment id. */
export function isEnvironmentId(value: unknown): value is string {
	return typeof value === 'string' && ENVIRONMENT_ID_PATTERN.test(value);
}

/** `true` when `value` is a well-formed ResourceRef URN. */
export function isResourceRefId(value: unknown): value is string {
	return typeof value === 'string' && RESOURCE_REF_ID_PATTERN.test(value);
}

// ---------------------------------------------------------------------------
// Predicates / guards
// ---------------------------------------------------------------------------

export function isTaskResourceKind(value: unknown): value is TaskResourceKind {
	return typeof value === 'string' && (TASK_RESOURCE_KINDS as readonly string[]).includes(value);
}

export function isTaskResourceActor(value: unknown): value is TaskResourceActor {
	return typeof value === 'string' && (TASK_RESOURCE_ACTORS as readonly string[]).includes(value);
}

export function isLeaseState(value: unknown): value is LeaseState {
	return typeof value === 'string' && (LEASE_STATES as readonly string[]).includes(value);
}

export function isLeaseOp(value: unknown): value is LeaseOpName {
	return typeof value === 'string' && (LEASE_OPS as readonly string[]).includes(value);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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

export function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
	const actual = Object.keys(value);
	if (actual.length !== expected.length) {
		return false;
	}
	return expected.every(key => hasKey(value, key));
}

export function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}

export function isBoundedString(value: unknown, max: number): value is string {
	return isNonEmptyString(value) && value.length <= max;
}

export function isPositiveEpochMs(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

// ---------------------------------------------------------------------------
// Canonical serialization (DL-9/DL-32 sibling-envelope discipline, verbatim
// from extensions/flauz-resources/src/api.ts -- duplicated by convention, no
// cross-extension import. Same byte law as PIN-1/PIN-2.)
// ---------------------------------------------------------------------------

/**
 * Canonical JSON: keys sorted recursively, no insignificant whitespace,
 * `undefined` values dropped. Same byte law as the PIN-1 / PIN-2 / resources
 * envelope writers -- the ledger byte form is byte-identical for logically
 * identical lease states.
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
	throw new TaskResourceError(
		'OP_INVALID',
		`cannot canonicalize value of type ${typeof value} (payloads must be JSON-safe)`,
	);
}

/** POSIX-style join (v0 targets POSIX workspace roots; documented in README). */
export function joinPath(...parts: readonly string[]): string {
	return parts.filter(part => part.length > 0).join('/').replace(/\/{2,}/g, '/');
}

// ---------------------------------------------------------------------------
// Injectable ports (DL-32 sibling: FileSystemPort + Clock, duplicated as
// types so the core typechecks without @types/node and runs under plain
// `node --test` -- the same posture as the TL3 modules it consumes.)
// ---------------------------------------------------------------------------

export interface FileSystemPort {
	readFileUtf8(path: string): Promise<string | undefined>;
	writeFile(path: string, contents: string): Promise<void>;
	appendFile(path: string, contents: string): Promise<void>;
	rename(fromPath: string, toPath: string): Promise<void>;
	mkdir(path: string): Promise<void>;
}

/** Injectable clock (deterministic fixtures in tests; Date.now in the host). */
export type Clock = () => number;

/** Injectable id minter (deterministic fixtures in tests; crypto in the host). */
export type IdMinter = () => string;

// ---------------------------------------------------------------------------
// Result helpers (typed results, never raw throws at the boundary)
// ---------------------------------------------------------------------------

export type AcquireResult =
	| { readonly ok: true; readonly lease: TaskResourceLease }
	| { readonly ok: false; readonly error: TaskResourceFailure; readonly partial?: TaskResourceLease };

export type ReleaseResult =
	| { readonly ok: true; readonly lease: TaskResourceLease }
	| { readonly ok: false; readonly error: TaskResourceFailure; readonly lease?: TaskResourceLease };

export type RollbackResult =
	| { readonly ok: true; readonly released: readonly TaskResourceLease[]; readonly failed: readonly TaskResourceLease[] }
	| { readonly ok: false; readonly error: TaskResourceFailure; readonly released?: readonly TaskResourceLease[]; readonly failed?: readonly TaskResourceLease[] };

export type HandOffExportResult =
	| { readonly ok: true; readonly record: TaskHandOffRecord }
	| { readonly ok: false; readonly error: TaskResourceFailure };

export type HandOffRestoreResult =
	| { readonly ok: true; readonly record: TaskHandOffRecord; readonly leases: readonly TaskResourceLease[] }
	| { readonly ok: false; readonly error: TaskResourceFailure; readonly record?: TaskHandOffRecord };
