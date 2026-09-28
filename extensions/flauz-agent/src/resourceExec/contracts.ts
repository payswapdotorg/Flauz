/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-S2 -- the acquisition/release/rollback state machine (pure logic,
 * zero vscode API dependency -- importable by tests AND by the future TL2-A
 * orchestrator).
 *
 * LAYER-SEPARATION LAW (binding; see types.ts for the full statement): a
 * task lease is the TASK-GRAPH-LEVEL obligation binding a task to a logical
 * resource id. The ACTUAL lifecycle effects (browser open/navigate, browser
 * close, environment start/attach/detach/stop, resource access) remain
 * OWNED by the TL3 managers. The lease references the op port -- it never
 * re-implements it, never calls CDP, never spawns a process, never writes
 * TL3-owned state. The adapters in this module (browserSession.ts,
 * environment.ts, resourceRef.ts) are READ-ONLY consumers of the canonical
 * TL3 state files; every runtime effect they name is executed by the TL3
 * manager that owns it.
 *
 * Determinism: the Clock is ALWAYS injected (the TL3 pattern -- `now` is
 * never read from the wall), and lease ids are minted by an injectable
 * factory. Every operation returns a typed result; nothing throws across
 * the op boundary. Every record carries MANDATORY provenance; an unknown
 * actor FAILS LOUDLY and can never be recorded (the PIN-1 journal law).
 *
 * Durability ordering: the ledger append comes BEFORE the in-memory book
 * update -- the append-only `.flauz/task-resources.jsonl` is the durable
 * truth, and after a restart the task graph rebuilds its lease obligations
 * from it (TaskLeaseBook.replay / TaskResourceLedger.rebuildBook).
 *
 * State machine (the TL3-003 typed-illegal-transition pattern):
 *
 *   acquiring --acquire-commit--> active
 *   acquiring --acquire-fail------> failed
 *   active    --release---------> released
 *   active    --expire----------> expired
 *   active    --rollback--------> rolled-back
 *   active    --fail------------> failed
 *
 * `acquiring` is the in-operation transient; the ledger persists
 * acquisitions only in `active` (event `acquired`) and failed attempts as
 * event `acquire-failed`. Releasing an already-`released` lease is the one
 * documented idempotent no-op (the obligation is discharged; no second
 * ledger line, no fabricated teardown); every other event from a non-source
 * state is a typed LEASE_ILLEGAL_TRANSITION listing the allowed source
 * states.
 */
import {
	TASK_RESOURCES_SCHEMA_ID,
	TASK_RESOURCES_SCHEMA_VERSION,
	TaskResourceError,
	findSecretShapedValue,
	isContinuityBundleId,
	isEnvironmentId,
	isLeaseId,
	isTaskId,
	isTaskResourceKind,
	mintLeaseId,
	validateLeaseProvenance,
	type Clock,
	type FileSystemPort,
	type HandOffExportedRecord,
	type HandOffRestoredRecord,
	type LeaseAcquireFailedRecord,
	type LeaseAcquiredRecord,
	type LeaseActor,
	type LeaseEvent,
	type LeaseExpiredRecord,
	type LeaseFailedRecord,
	type LeaseProvenance,
	type LeaseReleaseOutcome,
	type LeaseReleasedRecord,
	type LeaseRolledBackRecord,
	type LeaseState,
	type LeaseSurfaceSnapshot,
	type TaskResourceErrorPayload,
	type TaskResourceFailure,
	type TaskResourceKind,
	type TaskResourceLedgerRecord,
	type TaskResourceLease,
} from './types.ts';

// re-exported for consumers (single import site)
export type { LeaseSurfaceSnapshot };

// ---------------------------------------------------------------------------
// The typed illegal-transition error (the TL3-003 state-machine pattern)
// ---------------------------------------------------------------------------

/** One legal transition rule of the lease state machine. */
export interface LeaseTransitionRule {
	readonly event: LeaseEvent;
	readonly from: readonly LeaseState[];
	readonly to: LeaseState;
}

export const LEASE_TRANSITIONS: readonly LeaseTransitionRule[] = [
	{ event: 'acquire-commit', from: ['acquiring'], to: 'active' },
	{ event: 'acquire-fail', from: ['acquiring'], to: 'failed' },
	{ event: 'release', from: ['active'], to: 'released' },
	{ event: 'expire', from: ['active'], to: 'expired' },
	{ event: 'rollback', from: ['active'], to: 'rolled-back' },
	{ event: 'fail', from: ['active'], to: 'failed' },
];

export type TransitionVerdict =
	| { readonly ok: true; readonly state: LeaseState }
	| { readonly ok: false; readonly error: TaskResourceErrorPayload };

export function ruleFor(event: LeaseEvent): LeaseTransitionRule | undefined {
	return LEASE_TRANSITIONS.find(rule => rule.event === event);
}

/** The allowed source states of an event (in table order). */
export function allowedSourceStates(event: LeaseEvent): readonly LeaseState[] {
	return ruleFor(event)?.from ?? [];
}

/**
 * Applies one transition. Illegal transitions return a TYPED
 * LEASE_ILLEGAL_TRANSITION error that lists the allowed source states --
 * never a raw throw, never a silent no-op.
 */
export function applyLeaseTransition(state: LeaseState, event: LeaseEvent): TransitionVerdict {
	const rule = ruleFor(event);
	if (rule === undefined || !rule.from.includes(state)) {
		const legal = LEASE_TRANSITIONS.filter(candidate => candidate.from.includes(state)).map(candidate => candidate.event);
		return {
			ok: false,
			error: {
				code: 'LEASE_ILLEGAL_TRANSITION',
				message: `event '${event}' is not allowed from lease state '${state}' (allowed source states: ${allowedSourceStates(event).join(', ') || 'none'}; legal events from '${state}': ${legal.join(', ') || 'none'})`,
			},
		};
	}
	return { ok: true, state: rule.to };
}

// ---------------------------------------------------------------------------
// The read-only adapter port (implemented by browserSession.ts,
// environment.ts and resourceRef.ts; the runtime effect stays with TL3)
// ---------------------------------------------------------------------------

/** The acquisition verdict of a read-only adapter. */
export type AcquisitionVerdict =
	| { readonly ok: true; readonly surfaceSnapshot: LeaseSurfaceSnapshot; readonly opPort?: string; readonly notes?: readonly string[] }
	| { readonly ok: false; readonly code: 'RESOURCE_ABSENT' | 'TRUST_REFUSED' | 'SURFACE_MISMATCH' | 'STATE_UNREADABLE'; readonly message: string };

/** The release verdict of a read-only adapter (what the source state showed). */
export type ReleaseVerdict =
	| { readonly ok: true; readonly outcome: LeaseReleaseOutcome; readonly observed: string; readonly opPort?: string }
	| { readonly ok: false; readonly code: 'RESOURCE_ABSENT' | 'TRUST_REFUSED' | 'STATE_UNREADABLE'; readonly message: string };

/** The surface-identity verdict of a read-only adapter. */
export type SurfaceCheckVerdict =
	| { readonly ok: true; readonly current: LeaseSurfaceSnapshot }
	| { readonly ok: false; readonly code: 'RESOURCE_ABSENT' | 'SURFACE_MISMATCH' | 'STATE_UNREADABLE'; readonly message: string };

/**
 * The task-side resource port. Implementations are READ-ONLY over the
 * canonical TL3 state; they never perform and never record runtime effects.
 */
export interface ResourceLeaseAdapter {
	readonly kind: TaskResourceKind;
	acquire(taskId: string, resourceId: string, actor: LeaseProvenance): Promise<AcquisitionVerdict>;
	release(taskId: string, resourceId: string, actor: LeaseProvenance): Promise<ReleaseVerdict>;
	verifySurface(taskId: string, resourceId: string, snapshot: LeaseSurfaceSnapshot): Promise<SurfaceCheckVerdict>;
}

// ---------------------------------------------------------------------------
// The lease book (the pure in-memory projection of the ledger)
// ---------------------------------------------------------------------------

/** The current derived view of one lease. */
export interface BookLeaseView {
	readonly lease: TaskResourceLease;
	readonly state: LeaseState;
	readonly release?: { readonly outcome: LeaseReleaseOutcome; readonly releasedAt: number; readonly observed?: string; readonly opPort?: string };
	/** The continuity bundle of the latest hand-off export that carried this lease. */
	readonly carriedBundleId?: string;
	/** The continuity bundle of the latest hand-off restore that re-bound this lease. */
	readonly reboundBundleId?: string;
}

/** One replay/verify problem (line-numbered; the ledger is the durable truth). */
export interface BookProblem {
	readonly line: number;
	readonly message: string;
}

export type ReplayVerdict =
	| { readonly ok: true; readonly records: number }
	| { readonly ok: false; readonly problems: readonly BookProblem[] };

/**
 * The pure lease projection. `replay` rebuilds the full lease-state chain
 * from ledger records (crash recovery); the live ops apply one committed
 * record at a time (the append always precedes the apply).
 */
export class TaskLeaseBook {
	private readonly leases = new Map<string, BookLeaseView>();
	private readonly mintedIds = new Set<string>();
	private readonly order: string[] = [];

	/** Replays a full ledger (records in file order) into a fresh projection. */
	replay(records: readonly TaskResourceLedgerRecord[]): ReplayVerdict {
		const problems: BookProblem[] = [];
		for (const [index, record] of records.entries()) {
			const line = index + 1;
			const problem = this.apply(record, line);
			if (problem !== undefined) {
				problems.push({ line, message: problem });
			}
		}
		return problems.length === 0 ? { ok: true, records: records.length } : { ok: false, problems };
	}

	/** Applies ONE committed record; returns the invariant problem, if any. */
	apply(record: TaskResourceLedgerRecord, line: number): string | undefined {
		switch (record.event) {
			case 'acquired': {
				if (this.mintedIds.has(record.leaseId)) {
					return `lease '${record.leaseId}' is minted more than once (line ${line})`;
				}
				this.mintedIds.add(record.leaseId);
				this.leases.set(record.leaseId, { lease: record.lease, state: 'active' });
				this.order.push(record.leaseId);
				return undefined;
			}
			case 'acquire-failed': {
				if (this.mintedIds.has(record.leaseId)) {
					return `lease '${record.leaseId}' is minted more than once (line ${line})`;
				}
				this.mintedIds.add(record.leaseId);
				return undefined;
			}
			case 'released':
			case 'expired':
			case 'rolled-back':
			case 'failed': {
				const view = this.leases.get(record.leaseId);
				if (view === undefined) {
					return `${record.event} references lease '${record.leaseId}' which was never acquired (line ${line})`;
				}
				if (view.state !== 'active') {
					return `${record.event} references lease '${record.leaseId}' in state '${view.state}' (allowed source state: active; line ${line})`;
				}
				const next: BookLeaseView = record.event === 'released'
					? { ...view, state: 'released', release: { outcome: record.outcome, releasedAt: record.ts, ...(record.observed !== undefined ? { observed: record.observed } : {}), ...(record.opPort !== undefined ? { opPort: record.opPort } : {}) } }
					: { ...view, state: record.event === 'expired' ? 'expired' : record.event === 'rolled-back' ? 'rolled-back' : 'failed' };
				this.leases.set(record.leaseId, next);
				return undefined;
			}
			case 'hand-off-exported': {
				for (const leaseId of record.leaseIds) {
					const view = this.leases.get(leaseId);
					if (view === undefined || view.state !== 'active') {
						return `hand-off-exported carries lease '${leaseId}' which is not active (line ${line})`;
					}
					this.leases.set(leaseId, { ...view, ...(record.continuityBundleId !== undefined ? { carriedBundleId: record.continuityBundleId } : {}) });
				}
				return undefined;
			}
			case 'hand-off-restored': {
				for (const leaseId of record.reboundLeaseIds) {
					const view = this.leases.get(leaseId);
					if (view === undefined || view.state !== 'active') {
						return `hand-off-restored re-binds lease '${leaseId}' which is not active (line ${line})`;
					}
					this.leases.set(leaseId, { ...view, ...(record.continuityBundleId !== undefined ? { reboundBundleId: record.continuityBundleId } : {}) });
				}
				return undefined;
			}
		}
	}

	/** The derived view of one lease (undefined = unknown id). */
	view(leaseId: string): BookLeaseView | undefined {
		return this.leases.get(leaseId);
	}

	/** The active lease a task holds for a logical resource id, if any. */
	activeLease(taskId: string, resourceId: string): BookLeaseView | undefined {
		for (const leaseId of this.order) {
			const view = this.leases.get(leaseId);
			if (view !== undefined && view.state === 'active' && view.lease.taskId === taskId && view.lease.resourceId === resourceId) {
				return view;
			}
		}
		return undefined;
	}

	/** Every active lease of a task, in acquisition order (rollback completeness). */
	activeLeasesOf(taskId: string): BookLeaseView[] {
		const result: BookLeaseView[] = [];
		for (const leaseId of this.order) {
			const view = this.leases.get(leaseId);
			if (view !== undefined && view.state === 'active' && view.lease.taskId === taskId) {
				result.push(view);
			}
		}
		return result;
	}

	/** Every active lease with a due expiry (the sweep set). */
	expiredLeases(now: number): BookLeaseView[] {
		const result: BookLeaseView[] = [];
		for (const leaseId of this.order) {
			const view = this.leases.get(leaseId);
			if (view !== undefined && view.state === 'active' && view.lease.expiresAt !== undefined && view.lease.expiresAt < now) {
				result.push(view);
			}
		}
		return result;
	}
}

// ---------------------------------------------------------------------------
// The op environment + the coordinator operations
// ---------------------------------------------------------------------------

/** The ledger port the ops drive (store.ts implements it). */
export interface TaskResourceLedgerPort {
	/** Validates + appends one record; returns its 1-based line number. Fail-closed. */
	append(record: TaskResourceLedgerRecord): Promise<number>;
	/** The committed records, in file order. */
	records(): readonly TaskResourceLedgerRecord[];
}

/** Everything an op needs injected (all deterministic; `now` is never read from the wall). */
export interface LeaseEnv {
	readonly book: TaskLeaseBook;
	readonly ledger: TaskResourceLedgerPort;
	readonly clock: Clock;
	/** Injectable lease-id factory (deterministic tests). */
	readonly mintLeaseId?: () => string;
}

export type LeaseOpOutcome =
	| ({ readonly ok: true } & Record<string, unknown>)
	| TaskResourceFailure;

function failure(error: TaskResourceErrorPayload, record?: TaskResourceLedgerRecord): TaskResourceFailure {
	return record === undefined ? { ok: false, error } : { ok: false, error, record };
}

function requestInvalid(message: string): TaskResourceErrorPayload {
	return { code: 'REQUEST_INVALID', message };
}

function mapLedgerError(err: unknown): TaskResourceErrorPayload {
	if (err instanceof TaskResourceError) {
		return { code: err.code, message: err.message.startsWith(`${TASK_RESOURCES_SCHEMA_ID}: `) ? err.message.slice(`${TASK_RESOURCES_SCHEMA_ID}: `.length) : err.message };
	}
	return { code: 'LEDGER_WRITE_FAILED', message: `the task-resources ledger write failed: ${err instanceof Error ? err.message : String(err)}` };
}

const RESOURCE_ID_GUARDS: Readonly<Record<TaskResourceKind, (value: unknown) => boolean>> = {
	'browser-session': (value): boolean => typeof value === 'string' && /^flauz:browser:[0-9a-f]{16}$/.test(value),
	'environment': isEnvironmentId,
	'resource-ref': (value): boolean => typeof value === 'string' && /^flauz:([a-z][a-z0-9-]*):([0-9a-f]{16}|[A-Za-z0-9][A-Za-z0-9._-]{0,63})$/.test(value),
};

export interface AcquireLeaseRequest {
	readonly taskId: string;
	readonly resourceId: string;
	readonly actor: LeaseProvenance;
	readonly adapter: ResourceLeaseAdapter;
	/** Deadline (epoch ms, compared against the INJECTED clock) -- exceeding it is a typed TIMEOUT. */
	readonly deadlineAt?: number;
	/** Time-to-live in ms -- stamps `expiresAt` on the lease (the expiry sweep consumes it). */
	readonly ttlMs?: number;
	/** A continuity bundle this lease is acquired under (grammar-checked; hand-off validation lives in continuity.ts). */
	readonly continuityBundleId?: string;
}

export type AcquireOutcome =
	| { readonly ok: true; readonly lease: TaskResourceLease; readonly line: number }
	| TaskResourceFailure;

/**
 * Acquires one task lease: validates provenance (fail-closed, unrecordable),
 * refuses conflicts, consults the READ-ONLY adapter, enforces the deadline
 * against the INJECTED clock, scans the lease for secret-shaped payloads
 * (the no-flattening law), appends the `acquired` line and only then updates
 * the book. Acquisition refusals the adapter returns are recorded as
 * `acquire-failed` lines (auditable fail-closed attempts).
 */
export async function acquireLease(env: LeaseEnv, request: AcquireLeaseRequest): Promise<AcquireOutcome> {
	const provenance = validateLeaseProvenance(request.actor);
	if (!provenance.ok) {
		return failure(provenance.error);
	}
	if (!isTaskId(request.taskId)) {
		return failure(requestInvalid(`taskId must match the flauz-workspace task-id pattern 'T-<3+ digits>' (got ${JSON.stringify(request.taskId)})`));
	}
	if (!isTaskResourceKind(request.adapter.kind)) {
		return failure(requestInvalid(`the adapter declares an unknown resource kind ${JSON.stringify(request.adapter.kind)}`));
	}
	if (!RESOURCE_ID_GUARDS[request.adapter.kind](request.resourceId)) {
		return failure(requestInvalid(`resourceId must be the TL3 LOGICAL id for kind '${request.adapter.kind}' (got ${JSON.stringify(request.resourceId)}) -- never a path, never a URL`));
	}
	if (request.continuityBundleId !== undefined && !isContinuityBundleId(request.continuityBundleId)) {
		return failure(requestInvalid(`continuityBundleId must be a logical id 'flauz:continuity:<16-hex>' (got ${JSON.stringify(request.continuityBundleId)})`));
	}
	if (request.deadlineAt !== undefined && (typeof request.deadlineAt !== 'number' || !Number.isFinite(request.deadlineAt))) {
		return failure(requestInvalid('deadlineAt must be a finite epoch-ms number when present'));
	}
	if (request.ttlMs !== undefined && (typeof request.ttlMs !== 'number' || !Number.isSafeInteger(request.ttlMs) || request.ttlMs <= 0)) {
		return failure(requestInvalid('ttlMs must be a positive integer of epoch-ms when present'));
	}
	const conflict = env.book.activeLease(request.taskId, request.resourceId);
	if (conflict !== undefined) {
		const leaseId = (env.mintLeaseId ?? mintLeaseId)();
		const error: TaskResourceErrorPayload = { code: 'LEASE_CONFLICT', message: `task '${request.taskId}' already holds active lease '${conflict.lease.leaseId}' for '${request.resourceId}' (one active lease per task and resource id; release or roll it back first)` };
		const record: LeaseAcquireFailedRecord = { schemaVersion: TASK_RESOURCES_SCHEMA_VERSION, schema: TASK_RESOURCES_SCHEMA_ID, ts: env.clock(), actor: provenance.provenance.actor, event: 'acquire-failed', taskId: request.taskId, leaseId, resourceId: request.resourceId, resourceKind: request.adapter.kind, error };
		try {
			await env.ledger.append(record);
			env.book.apply(record, env.ledger.records().length);
		} catch {
			return failure(error); // the conflict stands regardless of the audit line
		}
		return failure(error, record);
	}
	const leaseId = (env.mintLeaseId ?? mintLeaseId)();
	const verdict = await request.adapter.acquire(request.taskId, request.resourceId, provenance.provenance);
	if (!verdict.ok) {
		const error: TaskResourceErrorPayload = { code: verdict.code, message: verdict.message };
		const record: LeaseAcquireFailedRecord = { schemaVersion: TASK_RESOURCES_SCHEMA_VERSION, schema: TASK_RESOURCES_SCHEMA_ID, ts: env.clock(), actor: provenance.provenance.actor, event: 'acquire-failed', taskId: request.taskId, leaseId, resourceId: request.resourceId, resourceKind: request.adapter.kind, error };
		try {
			await env.ledger.append(record);
			env.book.apply(record, env.ledger.records().length);
		} catch {
			return failure(error);
		}
		return failure(error, record);
	}
	const now = env.clock();
	if (request.deadlineAt !== undefined && now > request.deadlineAt) {
		const error: TaskResourceErrorPayload = { code: 'TIMEOUT', message: `acquisition of '${request.resourceId}' for task '${request.taskId}' exceeded its deadline (deadline ${request.deadlineAt}, now ${now} on the injected clock)` };
		const record: LeaseAcquireFailedRecord = { schemaVersion: TASK_RESOURCES_SCHEMA_VERSION, schema: TASK_RESOURCES_SCHEMA_ID, ts: now, actor: provenance.provenance.actor, event: 'acquire-failed', taskId: request.taskId, leaseId, resourceId: request.resourceId, resourceKind: request.adapter.kind, error };
		try {
			await env.ledger.append(record);
			env.book.apply(record, env.ledger.records().length);
		} catch {
			return failure(error);
		}
		return failure(error, record);
	}
	const lease: TaskResourceLease = {
		schemaVersion: TASK_RESOURCES_SCHEMA_VERSION,
		leaseId,
		taskId: request.taskId,
		resourceKind: request.adapter.kind,
		resourceId: request.resourceId,
		actor: provenance.provenance,
		state: 'active',
		acquiredAt: now,
		...(request.ttlMs !== undefined ? { expiresAt: now + request.ttlMs } : {}),
		surfaceSnapshot: verdict.surfaceSnapshot,
		...(request.continuityBundleId !== undefined ? { continuityBundleId: request.continuityBundleId } : {}),
		...(verdict.opPort !== undefined ? { opPort: verdict.opPort } : {}),
	};
	if (findSecretShapedValue(lease, 'lease') !== undefined) {
		const error: TaskResourceErrorPayload = { code: 'SECRET_IN_LEASE', message: 'the lease record carries a secret-shaped literal -- leases may carry only logical ids and vault-style references, never payloads (the no-flattening law)' };
		const record: LeaseAcquireFailedRecord = { schemaVersion: TASK_RESOURCES_SCHEMA_VERSION, schema: TASK_RESOURCES_SCHEMA_ID, ts: now, actor: provenance.provenance.actor, event: 'acquire-failed', taskId: request.taskId, leaseId, resourceId: request.resourceId, resourceKind: request.adapter.kind, error };
		try {
			await env.ledger.append(record);
			env.book.apply(record, env.ledger.records().length);
		} catch {
			return failure(error);
		}
		return failure(error, record);
	}
	const record: LeaseAcquiredRecord = { schemaVersion: TASK_RESOURCES_SCHEMA_VERSION, schema: TASK_RESOURCES_SCHEMA_ID, ts: now, actor: provenance.provenance.actor, event: 'acquired', taskId: request.taskId, leaseId, resourceId: request.resourceId, resourceKind: request.adapter.kind, lease };
	try {
		const line = await env.ledger.append(record);
		env.book.apply(record, line);
		return { ok: true, lease, line };
	} catch (err) {
		return failure(mapLedgerError(err));
	}
}

export interface ReleaseLeaseRequest {
	readonly leaseId: string;
	readonly actor: LeaseProvenance;
	/** The adapter consults the CURRENT source state (absent = no teardown claim). */
	readonly adapter?: ResourceLeaseAdapter;
}

export type ReleaseOutcome =
	| { readonly ok: true; readonly lease: TaskResourceLease; readonly state: LeaseState; readonly outcome: LeaseReleaseOutcome; readonly observed?: string; readonly opPort?: string; readonly idempotent: boolean; readonly line?: number }
	| TaskResourceFailure;

/**
 * Releases one lease. Releasing an already-released lease is the documented
 * idempotent no-op (no second line, no fabricated teardown). Releasing an
 * expired/rolled-back/failed lease is a typed LEASE_ILLEGAL_TRANSITION. A
 * source state that already discharged the obligation (e.g. a browser
 * session closed in the journal) releases CLEANLY with the record stating
 * exactly what the source state showed -- never a faked teardown.
 */
export async function releaseLease(env: LeaseEnv, request: ReleaseLeaseRequest): Promise<ReleaseOutcome> {
	const provenance = validateLeaseProvenance(request.actor);
	if (!provenance.ok) {
		return failure(provenance.error);
	}
	if (!isLeaseId(request.leaseId)) {
		return failure(requestInvalid(`leaseId must be a logical id 'flauz:lease:<16-hex>' (got ${JSON.stringify(request.leaseId)})`));
	}
	const view = env.book.view(request.leaseId);
	if (view === undefined) {
		return failure({ code: 'RESOURCE_ABSENT', message: `no lease '${request.leaseId}' exists in the lease book (the ledger holds no acquisition for it)` });
	}
	if (view.state === 'released') {
		return { ok: true, lease: view.lease, state: view.state, outcome: view.release?.outcome ?? 'clean', observed: view.release?.observed, opPort: view.release?.opPort ?? view.lease.opPort, idempotent: true };
	}
	if (view.state !== 'active') {
		const transition = applyLeaseTransition(view.state, 'release');
		return failure(transition.ok ? requestInvalid('unreachable') : transition.error);
	}
	const now = env.clock();
	let outcome: LeaseReleaseOutcome = 'clean';
	let observed = 'released without adapter consultation (no runtime effect claimed; the TL3 manager owns the teardown)';
	let opPort: string | undefined = view.lease.opPort;
	if (request.adapter !== undefined) {
		const verdict = await request.adapter.release(view.lease.taskId, view.lease.resourceId, provenance.provenance);
		if (!verdict.ok) {
			return failure({ code: verdict.code, message: `release of lease '${request.leaseId}' was refused by the '${request.adapter.kind}' adapter -- the lease stays active (fail-closed): ${verdict.message}` });
		}
		outcome = verdict.outcome;
		observed = verdict.observed;
		opPort = verdict.opPort;
	}
	const record: LeaseReleasedRecord = {
		schemaVersion: TASK_RESOURCES_SCHEMA_VERSION, schema: TASK_RESOURCES_SCHEMA_ID, ts: now, actor: provenance.provenance.actor, event: 'released', taskId: view.lease.taskId,
		leaseId: view.lease.leaseId, resourceId: view.lease.resourceId, resourceKind: view.lease.resourceKind, outcome,
		...(opPort !== undefined ? { opPort } : {}), ...(outcome !== 'clean' || observed.length > 0 ? { observed } : {}),
	};
	try {
		const line = await env.ledger.append(record);
		env.book.apply(record, line);
		return { ok: true, lease: view.lease, state: 'released', outcome, observed, opPort, idempotent: false, line };
	} catch (err) {
		return failure(mapLedgerError(err));
	}
}

export interface SweepRequest {
	readonly actor: LeaseProvenance;
	/** Override for the injected clock (the sweep is deterministic in tests). */
	readonly now?: number;
}

export type ExpireOutcome =
	| { readonly ok: true; readonly records: readonly LeaseExpiredRecord[]; readonly lines: readonly number[] }
	| TaskResourceFailure;

/** Expires every active lease whose `expiresAt` is due (the injected-clock sweep). */
export async function expireDueLeases(env: LeaseEnv, request: SweepRequest): Promise<ExpireOutcome> {
	const provenance = validateLeaseProvenance(request.actor);
	if (!provenance.ok) {
		return failure(provenance.error);
	}
	const now = request.now ?? env.clock();
	const due = env.book.expiredLeases(now);
	const records: LeaseExpiredRecord[] = [];
	const lines: number[] = [];
	for (const view of due) {
		records.push({ schemaVersion: TASK_RESOURCES_SCHEMA_VERSION, schema: TASK_RESOURCES_SCHEMA_ID, ts: now, actor: provenance.provenance.actor, event: 'expired', taskId: view.lease.taskId, leaseId: view.lease.leaseId, resourceId: view.lease.resourceId, resourceKind: view.lease.resourceKind, expiresAt: view.lease.expiresAt! });
	}
	for (const record of records) {
		try {
			const line = await env.ledger.append(record);
			env.book.apply(record, line);
			lines.push(line);
		} catch (err) {
			return failure(mapLedgerError(err));
		}
	}
	return { ok: true, records, lines };
}

export interface RollbackRequest {
	readonly taskId: string;
	readonly actor: LeaseProvenance;
	readonly reason: string;
}

export type RollbackOutcome =
	| { readonly ok: true; readonly records: readonly LeaseRolledBackRecord[]; readonly lines: readonly number[] }
	| (TaskResourceFailure & { readonly records?: readonly LeaseRolledBackRecord[]; readonly lines?: readonly number[] });

/**
 * Rolls back every ACTIVE lease of a task -- one typed `rolled-back` record
 * per lease, NONE silently dropped. A ledger write failure fails the whole
 * operation with the records that DID land reported honestly (fail-closed).
 */
export async function rollbackTask(env: LeaseEnv, request: RollbackRequest): Promise<RollbackOutcome> {
	const provenance = validateLeaseProvenance(request.actor);
	if (!provenance.ok) {
		return failure(provenance.error);
	}
	if (!isTaskId(request.taskId)) {
		return failure(requestInvalid(`taskId must match the flauz-workspace task-id pattern 'T-<3+ digits>' (got ${JSON.stringify(request.taskId)})`));
	}
	if (typeof request.reason !== 'string' || request.reason.length === 0 || request.reason.length > 500) {
		return failure(requestInvalid('reason must be a non-empty string of at most 500 chars'));
	}
	const now = env.clock();
	const active = env.book.activeLeasesOf(request.taskId);
	const records: LeaseRolledBackRecord[] = active.map(view => ({ schemaVersion: TASK_RESOURCES_SCHEMA_VERSION, schema: TASK_RESOURCES_SCHEMA_ID, ts: now, actor: provenance.provenance.actor, event: 'rolled-back', taskId: request.taskId, leaseId: view.lease.leaseId, resourceId: view.lease.resourceId, resourceKind: view.lease.resourceKind, reason: request.reason }));
	const lines: number[] = [];
	for (const record of records) {
		try {
			const line = await env.ledger.append(record);
			env.book.apply(record, line);
			lines.push(line);
		} catch (err) {
			return { ...failure(mapLedgerError(err)), records, lines };
		}
	}
	return { ok: true, records, lines };
}

export interface FailLeaseRequest {
	readonly leaseId: string;
	readonly actor: LeaseProvenance;
	readonly error: TaskResourceErrorPayload;
}

export type FailLeaseOpOutcome =
	| { readonly ok: true; readonly record: LeaseFailedRecord; readonly line: number }
	| TaskResourceFailure;

/** Fails one ACTIVE lease (a runtime failure of the underlying resource; typed payload). */
export async function failLease(env: LeaseEnv, request: FailLeaseRequest): Promise<FailLeaseOpOutcome> {
	const provenance = validateLeaseProvenance(request.actor);
	if (!provenance.ok) {
		return failure(provenance.error);
	}
	if (!isLeaseId(request.leaseId)) {
		return failure(requestInvalid(`leaseId must be a logical id 'flauz:lease:<16-hex>' (got ${JSON.stringify(request.leaseId)})`));
	}
	if (request.error === undefined || request.error === null || typeof request.error.code !== 'string' || request.error.code.length === 0 || request.error.code.length > 64 || typeof request.error.message !== 'string' || request.error.message.length === 0 || request.error.message.length > 300) {
		return failure(requestInvalid('error must be {code (<=64 chars), message (<=300 chars)}'));
	}
	const view = env.book.view(request.leaseId);
	if (view === undefined) {
		return failure({ code: 'RESOURCE_ABSENT', message: `no lease '${request.leaseId}' exists in the lease book` });
	}
	if (view.state !== 'active') {
		const transition = applyLeaseTransition(view.state, 'fail');
		return failure(transition.ok ? requestInvalid('unreachable') : transition.error);
	}
	const record: LeaseFailedRecord = { schemaVersion: TASK_RESOURCES_SCHEMA_VERSION, schema: TASK_RESOURCES_SCHEMA_ID, ts: env.clock(), actor: provenance.provenance.actor, event: 'failed', taskId: view.lease.taskId, leaseId: view.lease.leaseId, resourceId: view.lease.resourceId, resourceKind: view.lease.resourceKind, error: request.error };
	try {
		const line = await env.ledger.append(record);
		env.book.apply(record, line);
		return { ok: true, record, line };
	} catch (err) {
		return failure(mapLedgerError(err));
	}
}

export interface VerifySurfaceRequest {
	readonly leaseId: string;
	readonly adapter: ResourceLeaseAdapter;
}

export type VerifySurfaceOpOutcome =
	| { readonly ok: true; readonly current: LeaseSurfaceSnapshot }
	| TaskResourceFailure;

/**
 * Re-checks a lease's pinned surface snapshot against the CURRENT source
 * state. A surface that changed IDENTITY since acquisition (browser
 * partition re-minted, environment provider kind changed, resource-ref
 * surface family set changed) is a typed SURFACE_MISMATCH -- never a silent
 * pass. A new VERSION of the same-identity surface is legal (identity
 * survives access-surface change).
 */
export async function verifyLeaseSurface(env: LeaseEnv, request: VerifySurfaceRequest): Promise<VerifySurfaceOpOutcome> {
	if (!isLeaseId(request.leaseId)) {
		return failure(requestInvalid(`leaseId must be a logical id 'flauz:lease:<16-hex>' (got ${JSON.stringify(request.leaseId)})`));
	}
	const view = env.book.view(request.leaseId);
	if (view === undefined) {
		return failure({ code: 'RESOURCE_ABSENT', message: `no lease '${request.leaseId}' exists in the lease book` });
	}
	const snapshot = view.lease.surfaceSnapshot;
	if (snapshot === undefined) {
		return failure(requestInvalid(`lease '${request.leaseId}' carries no surface snapshot (identity-only lease); surface verification is not applicable`));
	}
	const verdict = await request.adapter.verifySurface(view.lease.taskId, view.lease.resourceId, snapshot);
	if (!verdict.ok) {
		return failure({ code: verdict.code, message: verdict.message });
	}
	return { ok: true, current: verdict.current };
}

// re-exported record types (the orchestrator's import surface)
export type { LeaseAcquiredRecord, LeaseAcquireFailedRecord, LeaseReleasedRecord, LeaseExpiredRecord, LeaseRolledBackRecord, LeaseFailedRecord, HandOffExportedRecord, HandOffRestoredRecord, LeaseActor, LeaseProvenance, TaskResourceKind, TaskResourceLease, TaskResourceLedgerRecord, FileSystemPort };
