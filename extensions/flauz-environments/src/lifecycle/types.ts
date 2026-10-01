/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL3-003 — environment lifecycle core types.
 *
 * The registry (src/registry.ts) owns DESCRIPTORS; this module owns the
 * LIFECYCLE state that turns descriptors into a real create/start/stop/
 * attach/detach/snapshot/destroy machine behind executors.
 *
 * Persistence (the PIN-2 sibling-envelope contract, implemented exactly —
 * another lane consumes these READ-ONLY):
 *   - `.flauz/environments-lifecycle.json` — envelope
 *     `flauz.environments-lifecycle/v0`:
 *     `{schemaVersion, schema, updatedAt, entries: {<envId>: {state, updatedAt,
 *     executorKind, lastOpRef}}}`.
 *   - `.flauz/environments-ops.jsonl` — append-only, one JSON line per op:
 *     `{schemaVersion, schema, ts, actor, op, environmentId, result,
 *     fromState, toState, error?}`.
 *
 * Discipline (DL-9/DL-32): the pinned key SETS are law. The connection
 * substate (attach/detach) is carried INSIDE the `state` string as a
 * `/attached` suffix (`running`, `running/attached`, ...) so the entry keys
 * stay exactly `{state, updatedAt, executorKind, lastOpRef}` — no fifth key,
 * no semantic mutation of the pinned shapes. `lastOpRef` is the 1-based line
 * number of the environment's most recent record in the ops ledger.
 *
 * vscode-free, zero deps, Node stdlib only. Ports are injected (FileSystemPort
 * / Clock from src/api.ts; Process/Hash ports in localProcess.ts).
 */
import type { EnvironmentKind, TrustPosture } from '../api.ts';

/** Envelope schema id pinned into `.flauz/environments-lifecycle.json`. */
export const LIFECYCLE_SCHEMA_ID = 'flauz.environments-lifecycle/v0';

/** Line schema id pinned into `.flauz/environments-ops.jsonl`. */
export const OPS_SCHEMA_ID = 'flauz.environments-ops/v0';

/** Both PIN-2 envelopes carry schemaVersion 0. */
export const LIFECYCLE_SCHEMA_VERSION = 0;

/** Lifecycle file paths, relative to the workspace root (DL-32 siblings). */
export const LIFECYCLE_PATH = '.flauz/environments-lifecycle.json';
export const OPS_PATH = '.flauz/environments-ops.jsonl';

// ---------------------------------------------------------------------------
// Provenance (MANDATORY on every operation — missing actor is a schema rejection)
// ---------------------------------------------------------------------------

export const PROVENANCE_ACTORS = ['agent', 'human', 'tool'] as const;
export type ProvenanceActor = (typeof PROVENANCE_ACTORS)[number];

// ---------------------------------------------------------------------------
// The lifecycle operations (ledger-recorded mutating ops; `describe` is a
// read-only probe and never appends a line)
// ---------------------------------------------------------------------------

export const ENVIRONMENT_OPS = ['create', 'start', 'stop', 'attach', 'detach', 'snapshot', 'destroy'] as const;
export type EnvironmentOpName = (typeof ENVIRONMENT_OPS)[number];

// ---------------------------------------------------------------------------
// Lifecycle states
// ---------------------------------------------------------------------------

/**
 * Base phases of the lifecycle state machine:
 * `registered -> created -> starting -> running <-> stopping -> stopped -> destroyed`
 * (plus `failed` with an error record).
 *
 * `registered` is the implicit pre-entry state (a descriptor exists in the
 * registry; no lifecycle entry has been minted yet).
 */
export const LIFECYCLE_PHASES = ['registered', 'created', 'starting', 'running', 'stopping', 'stopped', 'destroyed', 'failed'] as const;
export type LifecyclePhase = (typeof LIFECYCLE_PHASES)[number];

/**
 * Full lifecycle state: a phase, optionally carrying the attach/detach
 * connection substate (`running/attached`, `stopped/attached`). The substate
 * composes with the pinned entry shape instead of adding a key (see the
 * module doc).
 */
export const ATTACHED_STATES: readonly string[] = ['running/attached', 'stopped/attached'];

/** `true` for `running` / `running/attached`. */
export function isRunningState(state: string): boolean {
	return state === 'running' || state === 'running/attached';
}

/** `true` for any `/attached` composite. */
export function isAttachedState(state: string): boolean {
	return state.endsWith('/attached');
}

/** The base phase of a composite state. */
export function phaseOf(state: string): LifecyclePhase {
	const base = state.endsWith('/attached') ? state.slice(0, -'/attached'.length) : state;
	return base as LifecyclePhase;
}

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

/** Machine-checkable lifecycle error codes. */
export const LIFECYCLE_ERROR_CODES = [
	'ACTOR_REQUIRED',
	'ACTOR_INVALID',
	'OP_UNKNOWN',
	'OP_INVALID',
	'ENVIRONMENT_UNKNOWN',
	'ENVIRONMENT_DISABLED',
	'NO_EXECUTOR',
	'SIMULATED_NOT_OPTED_IN',
	'ILLEGAL_TRANSITION',
	'TRUST_POSTURE_REJECTED',
	'STORE_CORRUPT',
	// TL2-F2B (additive): an invalid providerRetry manager-options config
	// is a typed fail-closed constructor throw — never a silent default.
	'RETRY_CONFIG_INVALID',
	// TL3-PB audit (additive): a second mutating op issued on an environment
	// while one is already in flight is a typed PRE-FLIGHT rejection —
	// interleaved commits could otherwise resurrect a destroyed envelope and
	// record an impossible ledger sequence (the interleaving law).
	'OP_IN_FLIGHT',
] as const;
export type LifecycleErrorCode = (typeof LIFECYCLE_ERROR_CODES)[number];

/** Typed lifecycle error (fail-closed surfaces carry a stable code). */
export class EnvironmentLifecycleError extends Error {
	readonly code: LifecycleErrorCode;
	constructor(code: LifecycleErrorCode, message: string) {
		super(`flauz.environments-lifecycle/v0: ${message}`);
		this.name = 'EnvironmentLifecycleError';
		this.code = code;
	}
}

// ---------------------------------------------------------------------------
// The PIN-2 record shapes (persisted exactly; canonical JSON on the wire)
// ---------------------------------------------------------------------------

/** Typed error payload carried by error records (ops lines + results). */
export interface EnvironmentOpError {
	readonly code: string;
	readonly message: string;
}

// ---------------------------------------------------------------------------
// TL2-F2B — the bounded provider-retry hint (ADDITIVE, EPHEMERAL)
// ---------------------------------------------------------------------------

/**
 * The structured, EPHEMERAL provider-retry hint an executor MAY attach to a
 * failed effect error (TL2-F2B): the HTTP status the provider surfaced plus
 * an optional Retry-After-style wait hint in ms. The hint NEVER reaches the
 * PIN-2 lines — the manager records exactly the pinned {code, message}
 * payload; the hint is the executor's typed retryability classification for
 * the manager's bounded retry window (src/lifecycle/providerRetry.ts).
 */
export interface ProviderRetryHint {
	/** The HTTP status the provider surfaced on the failed call. */
	readonly status: number;
	/** The provider's Retry-After-style wait hint, when it surfaced one. */
	readonly retryAfterMs?: number;
}

/**
 * The failed-effect error payload an executor surfaces to the MANAGER: the
 * pinned {code, message} shape plus the optional ephemeral retry hint. The
 * manager drops the hint before any persistence (the ledger payload stays
 * exactly {code, message}).
 */
export interface ExecutorEffectError extends EnvironmentOpError {
	readonly providerRetryHint?: ProviderRetryHint;
}

/** One ops-ledger line: `flauz.environments-ops/v0` (the exact PIN-2 key set). */
export interface EnvironmentOpRecord {
	readonly schemaVersion: number;
	readonly schema: string;
	readonly ts: number;
	readonly actor: ProvenanceActor;
	readonly op: EnvironmentOpName;
	readonly environmentId: string;
	readonly result: 'ok' | 'error';
	readonly fromState: string;
	readonly toState: string;
	readonly error?: EnvironmentOpError;
}

/** One entry of the lifecycle envelope: the exact PIN-2 key set. */
export interface LifecycleEntry {
	readonly state: string;
	readonly updatedAt: number;
	readonly executorKind: string;
	readonly lastOpRef: number;
}

/** The `.flauz/environments-lifecycle.json` envelope (the exact PIN-2 key set). */
export interface LifecycleEnvelope {
	readonly schemaVersion: number;
	readonly schema: string;
	readonly updatedAt: number;
	readonly entries: Readonly<Record<string, LifecycleEntry>>;
}

// ---------------------------------------------------------------------------
// Executor op details (typed result payloads — ephemeral, never persisted in
// the PIN-2 lines; commands return them to callers)
// ---------------------------------------------------------------------------

export type ExecutorOpDetail =
	| { readonly type: 'create'; readonly stateDir: string }
	| { readonly type: 'start'; readonly pid: number }
	| { readonly type: 'stop'; readonly pid: number | null; readonly forcedSignal: 'SIGTERM' | 'SIGKILL' | null }
	| { readonly type: 'attach'; readonly leaseId: string; readonly heldSince: number }
	| { readonly type: 'detach'; readonly leaseId: string }
	| { readonly type: 'snapshot'; readonly snapshotDir: string; readonly fileCount: number; readonly manifestPath: string }
	| { readonly type: 'destroy'; readonly pid: number | null };

/** Effect outcome of one executor op. */
export type ExecutorEffectResult =
	| { readonly ok: true; readonly detail?: ExecutorOpDetail }
	| { readonly ok: false; readonly error: ExecutorEffectError };

// ---------------------------------------------------------------------------
// Describe (health/state probe) — never silently healthy
// ---------------------------------------------------------------------------

/**
 * Health verdict of a `describe` probe. `stale` = the persisted lifecycle
 * state claims liveness but the backing truth is gone (crash reconciliation);
 * `orphan` = the backing pid is alive but not ours (pid reuse / external
 * spawn — never treated as healthy).
 */
export const HEALTH_VERDICTS = ['healthy', 'stale', 'orphan', 'not-running', 'not-created', 'destroyed'] as const;
export type HealthVerdict = (typeof HEALTH_VERDICTS)[number];

export interface DescribeVerdict {
	readonly health: HealthVerdict;
	readonly state: string;
	readonly pid: number | null;
	readonly message: string;
	/** Present when a connection lease is held (attach/detach substate). */
	readonly lease?: { readonly leaseId: string; readonly heldSince: number };
}

/** The full `describe` report the commands/view surface. */
export interface DescribeReport {
	readonly environmentId: string;
	readonly kind: EnvironmentKind;
	readonly trust: TrustPosture;
	readonly state: string;
	readonly executorKind: string;
	readonly verdict: DescribeVerdict;
	/** The most recent ledger record for this environment (when one exists). */
	readonly lastOp?: EnvironmentOpRecord;
}

// ---------------------------------------------------------------------------
// The outcome envelope every manager op returns (typed results, never raw throws)
// ---------------------------------------------------------------------------

export type EnvironmentOpOutcome =
	| { readonly ok: true; readonly record: EnvironmentOpRecord; readonly detail?: ExecutorOpDetail }
	| { readonly ok: false; readonly record: EnvironmentOpRecord; readonly error: EnvironmentOpError };
