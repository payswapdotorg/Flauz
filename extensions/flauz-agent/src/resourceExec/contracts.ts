/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-S2 -- the lease state machine + acquire/release/rollback pure logic.
 *
 * PURE MODULE: zero vscode API dependency, zero filesystem side effects, zero
 * clock reads from the wall. The Clock and IdMinter are INJECTED (the TL3
 * pattern, verbatim from `extensions/flauz-resources/src/api.ts` -- `now` is
 * always injected, never read from the wall; tests drive deterministic time,
 * the host injects `Date.now`). Every transition returns a typed result;
 * every record carries the actor; an unknown actor FAILS LOUDLY
 * (PRE-FLIGHT `TaskResourceError` -- the PIN-1 journal law, applied to the
 * task boundary).
 *
 * THE LAYER-SEPARATION LAW (state it once, live by it): a task lease is the
 * TASK-GRAPH-LEVEL obligation binding a task to a logical resource id; the
 * ACTUAL lifecycle effects (browser open/navigate, environment start/attach,
 * resource access) remain OWNED by the TL3 managers. The lease references
 * the op port -- it never re-implements it, never calls CDP, never spawns a
 * process, never writes TL3-owned state.
 *
 * This module is importable by tests AND by the future TL2-A orchestrator:
 * the orchestrator will compose it with the adapters (`browserSession.ts`,
 * `environment.ts`, `resourceRef.ts`, `continuity.ts`) and the store
 * (`store.ts`). None of those imports live here -- contracts.ts is the
 * pure core that any consumer can wire up against their own port set.
 */
import {
        LEASE_HELD_STATES,
        LEASE_STATES,
        LEASE_TERMINAL_STATES,
        LEASE_TRANSITIONS,
        TASK_RESOURCES_SCHEMA_ID,
        TASK_RESOURCES_SCHEMA_VERSION,
        TASK_RESOURCE_ACTORS,
        TaskResourceError,
        canonicalJson,
        hasKey,
        isBoundedString,
        isLeaseId,
        isLeaseOp,
        isLeaseState,
        isPlainObject,
        isPositiveEpochMs,
        isTaskId,
        isTaskResourceActor,
        isTaskResourceKind,
        hasOnlyKeys,
        type AcquireResult,
        type Clock,
        type IdMinter,
        type LeaseOpName,
        type LeaseState,
        type ReleaseResult,
        type RollbackResult,
        type TaskResourceActor,
        type TaskResourceFailure,
        type TaskResourceKind,
        type TaskResourceLease,
        type TaskResourceOpPort,
        type TaskResourceProvenance,
        type TaskResourceSurfaceSnapshot,
} from './types.ts';

// ---------------------------------------------------------------------------
// Provenance validation (PRE-FLIGHT: missing/unknown actor throws loudly)
// ---------------------------------------------------------------------------

/**
 * Validates a provenance object. Fail-closed: the actor check comes FIRST --
 * a missing or unknown actor is never buried under a generic shape error.
 * (Verbatim posture from `extensions/flauz-resources/src/api.ts:validateProvenance`.)
 */
export function validateProvenance(value: unknown, where = 'provenance'): TaskResourceProvenance {
        if (!isPlainObject(value)) {
                throw new TaskResourceError('PROVENANCE_INVALID', `${where}: provenance must be an object { actor, actorId?, sessionId?, taskId, cause? }`);
        }
        if (!hasKey(value, 'actor')) {
                throw new TaskResourceError(
                        'PROVENANCE_INVALID',
                        `${where}: provenance.actor is MISSING -- the actor is MANDATORY on every lease op (fail-closed provenance)`,
                );
        }
        if (!isTaskResourceActor(value.actor)) {
                throw new TaskResourceError(
                        'PROVENANCE_INVALID',
                        `${where}: provenance.actor must be one of agent|human|tool (got ${JSON.stringify(value.actor)}) -- the actor is MANDATORY on every lease op (fail-closed provenance)`,
                );
        }
        if (!hasOnlyKeys(value, ['actor', 'taskId'], ['actorId', 'sessionId', 'cause'])) {
                throw new TaskResourceError('PROVENANCE_INVALID', `${where}: provenance must have the keys [actor, taskId] + optional [actorId, sessionId, cause] (got [${Object.keys(value).sort().join(', ')}])`);
        }
        const actor: TaskResourceActor = value.actor;
        if (!isTaskId(value.taskId)) {
                throw new TaskResourceError(
                        'TASK_ID_INVALID',
                        `${where}.taskId must match the flauz-workspace task-id pattern 'T-<3+ digits>' (got ${JSON.stringify(value.taskId)})`,
                );
        }
        const taskId: string = value.taskId;
        const result: { actor: TaskResourceActor; taskId: string; actorId?: string; sessionId?: string; cause?: string } = { actor, taskId };
        if (value.actorId !== undefined) {
                if (!isBoundedString(value.actorId, 200)) {
                        throw new TaskResourceError('PROVENANCE_INVALID', `${where}: provenance.actorId must be a non-empty string of at most 200 chars`);
                }
                result.actorId = value.actorId;
        }
        if (value.sessionId !== undefined) {
                if (!isBoundedString(value.sessionId, 200)) {
                        throw new TaskResourceError('PROVENANCE_INVALID', `${where}: provenance.sessionId must be a non-empty string of at most 200 chars`);
                }
                result.sessionId = value.sessionId;
        }
        if (value.cause !== undefined) {
                if (!isBoundedString(value.cause, 500)) {
                        throw new TaskResourceError('PROVENANCE_INVALID', `${where}: provenance.cause must be a non-empty string of at most 500 chars`);
                }
                result.cause = value.cause;
        }
        return result;
}

// ---------------------------------------------------------------------------
// State machine (typed transitions; illegal => typed error listing allowed sources)
// ---------------------------------------------------------------------------

/** The transition rules that apply to `op` from `state`. */
export function transitionsFor(state: LeaseState, op: LeaseOpName): readonly { readonly from: readonly LeaseState[]; readonly to: LeaseState; readonly op: LeaseOpName }[] {
        return LEASE_TRANSITIONS.filter(rule => rule.op === op && rule.from.includes(state));
}

/** `true` when `op` is legal from `state`. */
export function canApplyOp(state: LeaseState, op: LeaseOpName): boolean {
        return transitionsFor(state, op).length > 0;
}

/** The allowed source states for `op` (for typed error messages). */
export function allowedSourceStates(op: LeaseOpName): readonly LeaseState[] {
        const set = new Set<LeaseState>();
        for (const rule of LEASE_TRANSITIONS) {
                if (rule.op === op) {
                        for (const s of rule.from) {
                                set.add(s);
                        }
                }
        }
        return [...set].sort();
}

/**
 * Applies `op` to `state`, returning the new state. PRE-FLIGHT: an illegal
 * transition throws `TaskResourceError('OP_INVALID', ...)` listing the
 * allowed source states. (The TL3-003 state-machine pattern.)
 */
export function applyLeaseOp(state: LeaseState, op: LeaseOpName): LeaseState {
        if (!isLeaseState(state)) {
                throw new TaskResourceError('OP_INVALID', `unknown lease state '${state}' (allowed: ${LEASE_STATES.join(', ')})`);
        }
        if (!isLeaseOp(op)) {
                throw new TaskResourceError('OP_INVALID', `unknown lease op '${op}' (allowed: ${LEASE_OPS_STR})`);
        }
        const rules = transitionsFor(state, op);
        if (rules.length === 0) {
                throw new TaskResourceError(
                        'OP_INVALID',
                        `lease op '${op}' is illegal from state '${state}' (legal source states for '${op}': ${allowedSourceStates(op).join(', ') || 'none'})`,
                );
        }
        // the first matching rule wins (LEASE_TRANSITIONS is ordered so the
        // specific transition precedes the idempotent one for `release`)
        return rules[0]!.to;
}

const LEASE_OPS_STR = 'acquire, release, expire, rollback, fail';

// ---------------------------------------------------------------------------
// Lease record construction + validation
// ---------------------------------------------------------------------------

/** Constructs a lease record at acquisition time. */
export function buildLease(params: {
        readonly leaseId: string;
        readonly taskId: string;
        readonly resourceKind: TaskResourceKind;
        readonly resourceId: string;
        readonly actor: TaskResourceProvenance;
        readonly now: number;
        readonly expiresAt?: number;
        readonly surfaceSnapshot?: TaskResourceSurfaceSnapshot;
        readonly continuityBundleId?: string;
        readonly opPort?: TaskResourceOpPort;
}): TaskResourceLease {
        if (!isLeaseId(params.leaseId)) {
                throw new TaskResourceError('LEASE_ID_INVALID', `leaseId must be 'flauz:lease:<16-hex>' (got ${JSON.stringify(params.leaseId)})`);
        }
        if (!isTaskResourceKind(params.resourceKind)) {
                throw new TaskResourceError('OP_INVALID', `resourceKind must be one of ${TASK_RESOURCE_KINDS_STR} (got ${JSON.stringify(params.resourceKind)})`);
        }
        if (!isPositiveEpochMs(params.now)) {
                throw new TaskResourceError('OP_INVALID', `now must be a positive epoch-ms integer (got ${JSON.stringify(params.now)})`);
        }
        const lease: TaskResourceLease = {
                schemaVersion: TASK_RESOURCES_SCHEMA_VERSION,
                schema: TASK_RESOURCES_SCHEMA_ID,
                leaseId: params.leaseId,
                taskId: params.taskId,
                resourceKind: params.resourceKind,
                resourceId: params.resourceId,
                actor: params.actor,
                state: 'acquiring',
                acquiredAt: params.now,
                ...(params.expiresAt !== undefined ? { expiresAt: params.expiresAt } : {}),
                ...(params.surfaceSnapshot !== undefined ? { surfaceSnapshot: params.surfaceSnapshot } : {}),
                ...(params.continuityBundleId !== undefined ? { continuityBundleId: params.continuityBundleId } : {}),
                ...(params.opPort !== undefined ? { opPort: params.opPort } : {}),
        };
        return lease;
}

const TASK_RESOURCE_KINDS_STR = 'browser-session, environment, resource-ref';

/** Validates + parses a lease record from a parsed JSON value. */
export function validateLease(value: unknown): TaskResourceLease {
        if (!isPlainObject(value)) {
                throw new TaskResourceError('OP_INVALID', 'lease must be a plain object');
        }
        if (!hasOnlyKeys(
                value,
                ['schemaVersion', 'schema', 'leaseId', 'taskId', 'resourceKind', 'resourceId', 'actor', 'state', 'acquiredAt'],
                ['expiresAt', 'release', 'surfaceSnapshot', 'continuityBundleId', 'opPort'],
        )) {
                throw new TaskResourceError('OP_INVALID', `lease must have the keys [schemaVersion, schema, leaseId, taskId, resourceKind, resourceId, actor, state, acquiredAt] + optional [expiresAt, release, surfaceSnapshot, continuityBundleId, opPort] (got [${Object.keys(value).sort().join(', ')}])`);
        }
        if (value.schemaVersion !== TASK_RESOURCES_SCHEMA_VERSION) {
                throw new TaskResourceError('OP_INVALID', `lease.schemaVersion must be exactly ${TASK_RESOURCES_SCHEMA_VERSION} (got ${JSON.stringify(value.schemaVersion)})`);
        }
        if (value.schema !== TASK_RESOURCES_SCHEMA_ID) {
                throw new TaskResourceError('OP_INVALID', `lease.schema must be ${JSON.stringify(TASK_RESOURCES_SCHEMA_ID)} (got ${JSON.stringify(value.schema)})`);
        }
        if (!isLeaseId(value.leaseId)) {
                throw new TaskResourceError('LEASE_ID_INVALID', `lease.leaseId must be 'flauz:lease:<16-hex>' (got ${JSON.stringify(value.leaseId)})`);
        }
        if (!isTaskId(value.taskId)) {
                throw new TaskResourceError('TASK_ID_INVALID', `lease.taskId must match 'T-<3+ digits>' (got ${JSON.stringify(value.taskId)})`);
        }
        if (!isTaskResourceKind(value.resourceKind)) {
                throw new TaskResourceError('OP_INVALID', `lease.resourceKind must be one of ${TASK_RESOURCE_KINDS_STR} (got ${JSON.stringify(value.resourceKind)})`);
        }
        if (typeof value.resourceId !== 'string' || value.resourceId.length === 0) {
                throw new TaskResourceError('OP_INVALID', 'lease.resourceId must be a non-empty string (the TL3 LOGICAL id)');
        }
        const actor = validateProvenance(value.actor, 'lease.actor');
        if (!isLeaseState(value.state)) {
                throw new TaskResourceError('OP_INVALID', `lease.state must be one of ${LEASE_STATES.join(', ')} (got ${JSON.stringify(value.state)})`);
        }
        if (!isPositiveEpochMs(value.acquiredAt)) {
                throw new TaskResourceError('OP_INVALID', 'lease.acquiredAt must be a positive epoch-ms integer');
        }
        if (value.expiresAt !== undefined && !isPositiveEpochMs(value.expiresAt)) {
                throw new TaskResourceError('OP_INVALID', 'lease.expiresAt must be a positive epoch-ms integer when present');
        }
        if (value.release !== undefined) {
                const release = value.release as Record<string, unknown>;
                if (!isPlainObject(release) || !hasOnlyKeys(release, ['outcome', 'releasedAt'], ['reason'])) {
                        throw new TaskResourceError('OP_INVALID', 'lease.release must have the keys [outcome, releasedAt] + optional [reason]');
                }
                if (typeof release.outcome !== 'string' || !['released', 'rolled-back', 'failed', 'expired'].includes(release.outcome)) {
                        throw new TaskResourceError('OP_INVALID', `lease.release.outcome must be one of released|rolled-back|failed|expired (got ${JSON.stringify(release.outcome)})`);
                }
                if (!isPositiveEpochMs(release.releasedAt)) {
                        throw new TaskResourceError('OP_INVALID', 'lease.release.releasedAt must be a positive epoch-ms integer');
                }
                if (release.reason !== undefined && !isBoundedString(release.reason, 500)) {
                        throw new TaskResourceError('OP_INVALID', 'lease.release.reason must be a non-empty string of at most 500 chars when present');
                }
        }
        // surfaceSnapshot shape is validated per-kind by the adapter; here we
        // only check the discriminated kind is one we know
        if (value.surfaceSnapshot !== undefined) {
                const snap = value.surfaceSnapshot as Record<string, unknown>;
                if (!isPlainObject(snap) || typeof snap.kind !== 'string' || !['browser', 'environment', 'resource-ref'].includes(snap.kind)) {
                        throw new TaskResourceError('OP_INVALID', `lease.surfaceSnapshot.kind must be one of browser|environment|resource-ref (got ${JSON.stringify(snap.kind)})`);
                }
        }
        if (value.continuityBundleId !== undefined) {
                const re = /^flauz:continuity:[0-9a-f]{16}$/;
                if (typeof value.continuityBundleId !== 'string' || !re.test(value.continuityBundleId)) {
                        throw new TaskResourceError('OP_INVALID', `lease.continuityBundleId must be 'flauz:continuity:<16-hex>' (got ${JSON.stringify(value.continuityBundleId)})`);
                }
        }
        if (value.opPort !== undefined) {
                if (typeof value.opPort !== 'string' || !['flauz.browser.navigate', 'flauz.browser.close', 'flauz.env.start', 'flauz.env.attach', 'flauz.env.detach', 'flauz.env.stop', 'flauz.resource.access'].includes(value.opPort)) {
                        throw new TaskResourceError('OP_INVALID', `lease.opPort must be a known TL3 command port (got ${JSON.stringify(value.opPort)})`);
                }
        }
        // round-trip the lease through canonicalJson to ensure no secret-shaped
        // payload sneaks in (defense-in-depth, mirroring the resources/continuity
        // law -- secret-kind refs carry only presence + version, never payloads)
        const canonical = canonicalJson(value);
        if (looksSecretShaped(canonical)) {
                throw new TaskResourceError(
                        'OP_INVALID',
                        'lease payload contains secret-shaped text -- leases may carry only the LOGICAL id + surface version + presence flag for secret-kind refs, never literal credentials (the no-flattening law)',
                );
        }
        return value as unknown as TaskResourceLease;
}

// ---------------------------------------------------------------------------
// Lease state transitions (pure; the store + adapters compose them with ports)
// ---------------------------------------------------------------------------

/**
 * Marks a lease `active`. PRE-FLIGHT: the lease MUST be in state `acquiring`;
 * any other state is a typed `OP_INVALID` error.
 */
export function activateLease(lease: TaskResourceLease, now: number): TaskResourceLease {
        if (!isPositiveEpochMs(now)) {
                throw new TaskResourceError('OP_INVALID', `now must be a positive epoch-ms integer (got ${JSON.stringify(now)})`);
        }
        const newState = applyLeaseOp(lease.state, 'acquire');
        return { ...lease, state: newState };
}

/**
 * Releases a lease. IDEMPOTENT: a lease already in a terminal state stays
 * released (the obligation is discharged -- the record states what the
 * journal showed, never fakes a teardown). The `outcome` field records
 * which terminal state was reached.
 */
export function releaseLease(lease: TaskResourceLease, now: number, reason?: string): TaskResourceLease {
        if (!isPositiveEpochMs(now)) {
                throw new TaskResourceError('OP_INVALID', `now must be a positive epoch-ms integer (got ${JSON.stringify(now)})`);
        }
        const terminal = LEASE_TERMINAL_STATES.includes(lease.state);
        if (terminal) {
                // idempotent release -- keep the original release record if any,
                // never overwrite history
                return lease.release !== undefined ? lease : { ...lease, release: { outcome: 'released', releasedAt: now, ...(reason !== undefined ? { reason } : {}) } };
        }
        const newState = applyLeaseOp(lease.state, 'release');
        return {
                ...lease,
                state: newState,
                release: { outcome: 'released', releasedAt: now, ...(reason !== undefined ? { reason } : {}) },
        };
}

/**
 * Rolls a lease back (the task failed; the obligation is discharged by
 * rollback -- the TL3 manager is the one that actually tears down the
 * underlying truth). PRE-FLIGHT: the lease MUST be `active`.
 */
export function rollbackLease(lease: TaskResourceLease, now: number, reason?: string): TaskResourceLease {
        if (!isPositiveEpochMs(now)) {
                throw new TaskResourceError('OP_INVALID', `now must be a positive epoch-ms integer (got ${JSON.stringify(now)})`);
        }
        const newState = applyLeaseOp(lease.state, 'rollback');
        return {
                ...lease,
                state: newState,
                release: { outcome: 'rolled-back', releasedAt: now, ...(reason !== undefined ? { reason } : {}) },
        };
}

/** Marks a lease `failed` (the lease itself could not be established/maintained). */
export function failLease(lease: TaskResourceLease, now: number, reason?: string): TaskResourceLease {
        if (!isPositiveEpochMs(now)) {
                throw new TaskResourceError('OP_INVALID', `now must be a positive epoch-ms integer (got ${JSON.stringify(now)})`);
        }
        const newState = applyLeaseOp(lease.state, 'fail');
        return {
                ...lease,
                state: newState,
                release: { outcome: 'failed', releasedAt: now, ...(reason !== undefined ? { reason } : {}) },
        };
}

/**
 * Marks a lease `expired` (the periodic sweeper observed the expiry). The
 * clock is INJECTED -- never reads the wall. PRE-FLIGHT: the lease MUST be
 * `active` and MUST carry an `expiresAt`.
 */
export function expireLease(lease: TaskResourceLease, now: number): TaskResourceLease {
        if (!isPositiveEpochMs(now)) {
                throw new TaskResourceError('OP_INVALID', `now must be a positive epoch-ms integer (got ${JSON.stringify(now)})`);
        }
        if (lease.expiresAt === undefined) {
                throw new TaskResourceError('OP_INVALID', `cannot expire lease ${lease.leaseId}: no expiresAt set (only expiring leases can be expired)`);
        }
        if (now < lease.expiresAt) {
                throw new TaskResourceError('OP_INVALID', `cannot expire lease ${lease.leaseId} at now=${now}: expiresAt=${lease.expiresAt} is still in the future (the sweeper must respect the clock)`);
        }
        const newState = applyLeaseOp(lease.state, 'expire');
        return {
                ...lease,
                state: newState,
                release: { outcome: 'expired', releasedAt: now, reason: `expired at ${lease.expiresAt}` },
        };
}

/**
 * `true` when `lease` is past its expiry (the sweeper's predicate). A lease
 * with no `expiresAt` never expires.
 */
export function isExpired(lease: TaskResourceLease, now: number): boolean {
        return lease.expiresAt !== undefined && now >= lease.expiresAt && LEASE_HELD_STATES.includes(lease.state);
}

// ---------------------------------------------------------------------------
// Rollback completeness (a task with N active leases that fails produces N
// typed release records -- none silently dropped)
// ---------------------------------------------------------------------------

/**
 * Rolls back ALL active leases for a task. Each active lease produces a
 * typed `rolled-back` release record; leases already in a terminal state
 * are left untouched. The result carries `released` (the leases rolled
 * back) and `failed` (the leases that could not be rolled back -- e.g.
 * because the state machine rejected the op). NONE are silently dropped.
 */
export function rollbackAllActive(leases: readonly TaskResourceLease[], now: number, reason?: string): {
        readonly released: readonly TaskResourceLease[];
        readonly failed: readonly TaskResourceLease[];
} {
        const released: TaskResourceLease[] = [];
        const failed: TaskResourceLease[] = [];
        for (const lease of leases) {
                if (!LEASE_HELD_STATES.includes(lease.state)) {
                        continue;
                }
                try {
                        released.push(rollbackLease(lease, now, reason));
                } catch (err) {
                        failed.push(failLease(lease, now, err instanceof Error ? err.message : String(err)));
                }
        }
        return { released, failed };
}

// ---------------------------------------------------------------------------
// Surface-mismatch detection (a SURFACE_MISMATCH is detectable at release)
// ---------------------------------------------------------------------------

/**
 * `true` when `current` differs from `snapshot` in identity-relevant fields
 * (browser: partition + tabIds set; environment: descriptorId + providerKind;
 * resource-ref: refKind + surfaceVersion). A SURFACE_MISMATCH is a typed
 * failure at release/hand-off -- the lease is still released (the obligation
 * is discharged) but the mismatch is recorded in the release `reason` so the
 * orchestrator can act on it.
 */
export function surfaceMismatch(
        snapshot: TaskResourceSurfaceSnapshot | undefined,
        current: TaskResourceSurfaceSnapshot | undefined,
): boolean {
        if (snapshot === undefined && current === undefined) {
                return false;
        }
        if (snapshot === undefined || current === undefined) {
                return true;
        }
        if (snapshot.kind !== current.kind) {
                return true;
        }
        switch (snapshot.kind) {
                case 'browser': {
                        const cur = current as Extract<TaskResourceSurfaceSnapshot, { kind: 'browser' }>;
                        if (snapshot.partition !== cur.partition) {
                                return true;
                        }
                        const a = snapshot.tabIds === undefined ? [] : [...snapshot.tabIds].sort();
                        const b = cur.tabIds === undefined ? [] : [...cur.tabIds].sort();
                        return a.length !== b.length || a.some((id, i) => id !== b[i]);
                }
                case 'environment': {
                        const cur = current as Extract<TaskResourceSurfaceSnapshot, { kind: 'environment' }>;
                        return snapshot.descriptorId !== cur.descriptorId || snapshot.providerKind !== cur.providerKind;
                }
                case 'resource-ref': {
                        const cur = current as Extract<TaskResourceSurfaceSnapshot, { kind: 'resource-ref' }>;
                        return snapshot.refKind !== cur.refKind || snapshot.surfaceVersion !== cur.surfaceVersion;
                }
        }
}

// ---------------------------------------------------------------------------
// Secret-shape detection (vault-only policy, mirror of resources/api.ts)
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

// ---------------------------------------------------------------------------
// Id minting (deterministic in tests; WebCrypto in the host)
// ---------------------------------------------------------------------------

interface RandomSource {
        getRandomValues(view: Uint8Array): Uint8Array;
}

/** Mints a logical lease id `flauz:lease:<16-hex>`. */
export function mintLeaseId(): string {
        const bytes = new Uint8Array(8);
        const source = (globalThis as { crypto?: RandomSource }).crypto;
        if (source !== undefined) {
                source.getRandomValues(bytes);
        } else {
                for (let i = 0; i < bytes.length; i++) {
                        bytes[i] = Math.floor(Math.random() * 256);
                }
        }
        return 'flauz:lease:' + Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Mints a logical hand-off id `flauz:handoff:<16-hex>`. */
export function mintHandOffId(): string {
        const bytes = new Uint8Array(8);
        const source = (globalThis as { crypto?: RandomSource }).crypto;
        if (source !== undefined) {
                source.getRandomValues(bytes);
        } else {
                for (let i = 0; i < bytes.length; i++) {
                        bytes[i] = Math.floor(Math.random() * 256);
                }
        }
        return 'flauz:handoff:' + Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Default injectable ports (Date.now for the host; tests pass their own)
// ---------------------------------------------------------------------------

export const defaultClock: Clock = () => Date.now();

export const defaultLeaseMinter: IdMinter = mintLeaseId;

export const defaultHandOffMinter: IdMinter = mintHandOffId;

// ---------------------------------------------------------------------------
// Failure helpers (typed outcomes for adapters)
// ---------------------------------------------------------------------------

export function failure(code: TaskResourceFailure['code'], message: string, details?: Record<string, unknown>): TaskResourceFailure {
        return { code, message, ...(details !== undefined ? { details } : {}) };
}

// ---------------------------------------------------------------------------
// Re-export the vocabulary (so a single `import` from `./contracts.ts` works)
// ---------------------------------------------------------------------------

export {
        LEASE_HELD_STATES,
        LEASE_TERMINAL_STATES,
        LEASE_STATES,
        TASK_RESOURCE_ACTORS,
        TaskResourceError,
        type Clock,
        type IdMinter,
        type TaskResourceLease,
        type TaskResourceProvenance,
        type TaskResourceKind,
        type TaskResourceOpPort,
        type TaskResourceSurfaceSnapshot,
        type AcquireResult,
        type ReleaseResult,
        type RollbackResult,
};
