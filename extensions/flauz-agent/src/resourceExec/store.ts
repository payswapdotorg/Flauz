/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-S2 -- the append-only `.flauz/task-resources.jsonl` ledger (the
 * durable truth for task-boundary resource leases + hand-offs).
 *
 * PERSISTENCE LAW (PIN-1/PIN-2 byte law, verbatim):
 *   - one canonical-JSON record + exactly one `\n` per acquisition/release/
 *     rollback/hand-off/failure/expiry;
 *   - canonical form: `canonicalJson(record)` (recursively sorted keys,
 *     compact single line -- the same discipline as the PIN-1 browser-session
 *     journal and the PIN-2 environments ops ledger; match it byte-for-byte);
 *   - append-only: the existing content is fully re-validated (the ledger
 *     parser fail-closes on any corruption) and preserved byte-for-byte
 *     before extension; history is NEVER rewritten.
 *
 * MANDATORY actor: every record carries the actor; a record missing the
 * actor is a typed `TaskResourceError` and the write fails closed.
 *
 * Fail-closed: a ledger write failure fails the operation (the lease
 * acquire/release/rollback returns a typed STORE_FAILED outcome; the
 * in-memory state is rolled back to the pre-write state).
 *
 * Crash recovery: `verify()` re-derives the lease-state chain from the
 * ledger. After a restart the task graph rebuilds its lease obligations
 * from the ledger (the ledger is the durable truth; an unflushed in-memory
 * state never survives). Tested by the `crash recovery` test case.
 *
 * DL-32: this module NEVER imports from sibling extensions; the
 * TaskResourceLease + TaskHandOffRecord shapes are the vocabulary defined
 * in `./types.ts` and validated by `./contracts.ts`.
 */
import {
        LEASE_HELD_STATES,
        LEASE_TERMINAL_STATES,
        TASK_RESOURCES_SCHEMA_ID,
        TASK_RESOURCES_SCHEMA_VERSION,
        TASK_RESOURCES_LEDGER_PATH,
        TaskResourceError,
        canonicalJson,
        hasExactKeys,
        hasKey,
        hasOnlyKeys,
        isBoundedString,
        isHandOffId,
        isLeaseId,
        isLeaseState,
        isPlainObject,
        isPositiveEpochMs,
        isTaskId,
        joinPath,
        type Clock,
        type FileSystemPort,
        type IdMinter,
        type TaskHandOffRecord,
        type TaskResourceFailure,
        type TaskResourceLease,
} from './types.ts';
import {
        applyLeaseOp,
        failure,
        mintHandOffId,
        mintLeaseId,
        validateLease,
        validateProvenance,
} from './contracts.ts';

// ---------------------------------------------------------------------------
// The ledger record (one per line; the persisted shape)
// ---------------------------------------------------------------------------

/** The op kinds recorded in the ledger. */
export const LEDGER_RECORD_KINDS = [
        'lease',         // a lease-state record (acquire/active/release/expire/rollback/fail)
        'hand-off',      // an export-point or restore-point record
] as const;
export type LedgerRecordKind = (typeof LEDGER_RECORD_KINDS)[number];

/** One ledger record (envelope `flauz.task-resources/v0`). */
export interface TaskResourceLedgerRecord {
        readonly schemaVersion: typeof TASK_RESOURCES_SCHEMA_VERSION;
        readonly schema: typeof TASK_RESOURCES_SCHEMA_ID;
        readonly kind: LedgerRecordKind;
        readonly ts: number;
        readonly actor: string; // MANDATORY (agent|human|tool)
        readonly taskId: string;
        readonly lease?: TaskResourceLease;       // present for kind 'lease'
        readonly handOff?: TaskHandOffRecord;     // present for kind 'hand-off'
}

// ---------------------------------------------------------------------------
// Strict parsers (fail-closed: typed TaskResourceError on shape violations)
// ---------------------------------------------------------------------------

function parseError(message: string): TaskResourceError {
        return new TaskResourceError('OP_INVALID', `task-resources ledger parse: ${message}`);
}

export function parseLedgerRecord(value: unknown, lineNo: number): TaskResourceLedgerRecord {
        const where = `ledger line ${lineNo}`;
        if (!isPlainObject(value)) {
                throw parseError(`${where} must be a JSON object`);
        }
        if (!hasOnlyKeys(value, ['schemaVersion', 'schema', 'kind', 'ts', 'actor', 'taskId'], ['lease', 'handOff'])) {
                throw parseError(`${where} must have the keys [schemaVersion, schema, kind, ts, actor, taskId] + optional [lease, handOff] (got [${Object.keys(value).sort().join(', ')}])`);
        }
        if (value.schemaVersion !== TASK_RESOURCES_SCHEMA_VERSION) {
                throw parseError(`${where} schemaVersion must be exactly ${TASK_RESOURCES_SCHEMA_VERSION} (got ${JSON.stringify(value.schemaVersion)})`);
        }
        if (value.schema !== TASK_RESOURCES_SCHEMA_ID) {
                throw parseError(`${where} schema must be exactly '${TASK_RESOURCES_SCHEMA_ID}' (got ${JSON.stringify(value.schema)})`);
        }
        if (typeof value.kind !== 'string' || !(LEDGER_RECORD_KINDS as readonly string[]).includes(value.kind)) {
                throw parseError(`${where} kind must be one of ${LEDGER_RECORD_KINDS.join('|')} (got ${JSON.stringify(value.kind)})`);
        }
        if (!isPositiveEpochMs(value.ts)) {
                throw parseError(`${where} ts must be a positive epoch-ms integer`);
        }
        if (typeof value.actor !== 'string' || !['agent', 'human', 'tool'].includes(value.actor)) {
                throw parseError(`${where} actor must be one of agent|human|tool (got ${JSON.stringify(value.actor)}) -- MANDATORY on every record`);
        }
        if (typeof value.taskId !== 'string' || !isTaskId(value.taskId)) {
                throw parseError(`${where} taskId must match 'T-<3+ digits>' (got ${JSON.stringify(value.taskId)})`);
        }
        if (value.kind === 'lease') {
                if (value.lease === undefined) {
                        throw parseError(`${where} kind 'lease' requires the lease payload`);
                }
                if (value.handOff !== undefined) {
                        throw parseError(`${where} kind 'lease' must not carry a handOff payload`);
                }
                // deep-validate the lease record (reuses contracts.validateLease)
                validateLease(value.lease);
        } else if (value.kind === 'hand-off') {
                if (value.handOff === undefined) {
                        throw parseError(`${where} kind 'hand-off' requires the handOff payload`);
                }
                if (value.lease !== undefined) {
                        throw parseError(`${where} kind 'hand-off' must not carry a lease payload`);
                }
                validateHandOff(value.handOff, where);
        }
        return value as unknown as TaskResourceLedgerRecord;
}

function validateHandOff(value: unknown, where: string): asserts value is TaskHandOffRecord {
        if (!isPlainObject(value)) {
                throw parseError(`${where}.handOff must be a plain object`);
        }
        if (!hasOnlyKeys(value, ['schemaVersion', 'schema', 'kind', 'handOffId', 'taskId', 'actor', 'ts', 'leaseIds'], ['continuityBundleId', 'rebind'])) {
                throw parseError(`${where}.handOff must have the keys [schemaVersion, schema, kind, handOffId, taskId, actor, ts, leaseIds] + optional [continuityBundleId, rebind]`);
        }
        if (value.schemaVersion !== TASK_RESOURCES_SCHEMA_VERSION) {
                throw parseError(`${where}.handOff.schemaVersion must be exactly ${TASK_RESOURCES_SCHEMA_VERSION}`);
        }
        if (value.schema !== TASK_RESOURCES_SCHEMA_ID) {
                throw parseError(`${where}.handOff.schema must be exactly '${TASK_RESOURCES_SCHEMA_ID}'`);
        }
        if (value.kind !== 'export' && value.kind !== 'restore') {
                throw parseError(`${where}.handOff.kind must be 'export' or 'restore'`);
        }
        if (typeof value.handOffId !== 'string' || !isHandOffId(value.handOffId)) {
                throw parseError(`${where}.handOff.handOffId must be 'flauz:handoff:<16-hex>'`);
        }
        if (typeof value.taskId !== 'string' || !isTaskId(value.taskId)) {
                throw parseError(`${where}.handOff.taskId must match 'T-<3+ digits>'`);
        }
        validateProvenance(value.actor, `${where}.handOff.actor`);
        if (!isPositiveEpochMs(value.ts)) {
                throw parseError(`${where}.handOff.ts must be a positive epoch-ms integer`);
        }
        if (value.continuityBundleId !== undefined) {
                if (typeof value.continuityBundleId !== 'string' || !/^flauz:continuity:[0-9a-f]{16}$/.test(value.continuityBundleId)) {
                        throw parseError(`${where}.handOff.continuityBundleId must be 'flauz:continuity:<16-hex>'`);
                }
        }
        if (!Array.isArray(value.leaseIds) || value.leaseIds.some(id => typeof id !== 'string' || !isLeaseId(id))) {
                throw parseError(`${where}.handOff.leaseIds must be an array of lease ids`);
        }
}

/** Canonical single-line serialization of a ledger record (sorted keys, compact). */
export function serializeLedgerRecord(record: TaskResourceLedgerRecord): string {
        const canonical = canonicalJson(record);
        if (canonical.includes('\n')) {
                throw new TaskResourceError('OP_INVALID', 'a ledger record must serialize to a single line (no embedded newlines)');
        }
        return canonical;
}

/** Parses a full ledger (strict; one record per line; one trailing newline). */
export function parseLedger(raw: string): TaskResourceLedgerRecord[] {
        const lines = raw.split('\n');
        if (lines[lines.length - 1] !== '') {
                throw parseError('ledger must end with a newline');
        }
        const records: TaskResourceLedgerRecord[] = [];
        for (let i = 0; i < lines.length - 1; i++) {
                const line = lines[i]!;
                if (line.trim().length === 0) {
                        throw parseError(`ledger line ${i + 1} is empty (one JSON object per line; no blank lines)`);
                }
                let parsed: unknown;
                try {
                        parsed = JSON.parse(line);
                } catch (err) {
                        throw parseError(`ledger line ${i + 1} is not valid JSON -- ${err instanceof Error ? err.message : String(err)}`);
                }
                records.push(parseLedgerRecord(parsed, i + 1));
        }
        return records;
}

// ---------------------------------------------------------------------------
// The lease index (the in-memory state derived from the ledger; the source
// of truth for active leases, conflict detection, and rollback completeness)
// ---------------------------------------------------------------------------

/**
 * The lease-state chain derived from the ledger. The latest record per lease
 * id is the current state; the chain preserves the full history (audit).
 */
export interface LeaseIndex {
        /** The latest lease record per lease id (the current state). */
        readonly leases: ReadonlyMap<string, TaskResourceLease>;
        /** The full history per lease id (in ledger order). */
        readonly history: ReadonlyMap<string, readonly TaskResourceLease[]>;
        /** The hand-off records per task id (export + restore). */
        readonly handOffs: ReadonlyMap<string, readonly TaskHandOffRecord[]>;
        /** Active (held) leases per task id. */
        readonly activeByTask: ReadonlyMap<string, readonly TaskResourceLease[]>;
        /** Active lease per (taskId, resourceId) -- the conflict key. */
        readonly activeByResource: ReadonlyMap<string, ReadonlyMap<string, TaskResourceLease>>;
}

/** Derives the lease index from the ledger (the verify() core). */
export function deriveIndex(records: readonly TaskResourceLedgerRecord[]): LeaseIndex {
        const leases = new Map<string, TaskResourceLease>();
        const history = new Map<string, TaskResourceLease[]>();
        const handOffs = new Map<string, TaskHandOffRecord[]>();
        const activeByTask = new Map<string, TaskResourceLease[]>();
        const activeByResource = new Map<string, Map<string, TaskResourceLease>>();

        for (const record of records) {
                if (record.kind === 'lease' && record.lease !== undefined) {
                        const lease = record.lease;
                        leases.set(lease.leaseId, lease);
                        const hist = history.get(lease.leaseId) ?? [];
                        hist.push(lease);
                        history.set(lease.leaseId, hist);
                        // maintain the active indexes
                        const isHeld = LEASE_HELD_STATES.includes(lease.state);
                        const taskActive = activeByTask.get(lease.taskId) ?? [];
                        const taskFiltered = taskActive.filter(l => l.leaseId !== lease.leaseId);
                        const resMap = activeByResource.get(lease.taskId) ?? new Map<string, TaskResourceLease>();
                        resMap.delete(lease.resourceId);
                        if (isHeld) {
                                taskFiltered.push(lease);
                                activeByTask.set(lease.taskId, taskFiltered);
                                resMap.set(lease.resourceId, lease);
                                activeByResource.set(lease.taskId, resMap);
                        } else {
                                if (taskFiltered.length > 0) {
                                        activeByTask.set(lease.taskId, taskFiltered);
                                } else {
                                        activeByTask.delete(lease.taskId);
                                }
                                if (resMap.size > 0) {
                                        activeByResource.set(lease.taskId, resMap);
                                } else {
                                        activeByResource.delete(lease.taskId);
                                }
                        }
                } else if (record.kind === 'hand-off' && record.handOff !== undefined) {
                        const ho = record.handOff;
                        const list = handOffs.get(ho.taskId) ?? [];
                        list.push(ho);
                        handOffs.set(ho.taskId, list);
                }
        }
        return { leases, history, handOffs, activeByTask, activeByResource };
}

/** The latest lease state for `leaseId`, or `undefined` if absent. */
export function latestLease(index: LeaseIndex, leaseId: string): TaskResourceLease | undefined {
        return index.leases.get(leaseId);
}

/** All active leases for `taskId`. */
export function activeLeasesFor(index: LeaseIndex, taskId: string): readonly TaskResourceLease[] {
        return index.activeByTask.get(taskId) ?? [];
}

/** `true` when `taskId` already holds an active lease for `resourceId`. */
export function hasConflict(index: LeaseIndex, taskId: string, resourceId: string): boolean {
        const resMap = index.activeByResource.get(taskId);
        return resMap !== undefined && resMap.has(resourceId);
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

export interface TaskResourceStoreOptions {
        readonly workspaceRoot: string;
        readonly fs: FileSystemPort;
        readonly clock?: Clock;
        readonly leaseMinter?: IdMinter;
        readonly handOffMinter?: IdMinter;
}

/**
 * The append-only ledger owner. The ledger is the durable truth -- after a
 * restart the task graph rebuilds its lease obligations from it (tested by
 * the `crash recovery` test case).
 *
 * `verify()` re-derives the lease-state chain from the ledger; the chain is
 * the auditable truth. `appendLease()` / `appendHandOff()` write ONE record
 * per call; the existing content is fully re-validated and preserved byte-
 * for-byte before extension (history is never rewritten).
 */
export class TaskResourceStore {
        private readonly workspaceRoot: string;
        private readonly fs: FileSystemPort;
        private readonly clock: Clock;
        private readonly leaseMinter: IdMinter;
        private readonly handOffMinter: IdMinter;
        private readonly ledgerPath: string;

        constructor(options: TaskResourceStoreOptions) {
                this.workspaceRoot = options.workspaceRoot;
                this.fs = options.fs;
                this.clock = options.clock ?? (() => Date.now());
                this.leaseMinter = options.leaseMinter ?? mintLeaseId;
                this.handOffMinter = options.handOffMinter ?? mintHandOffId;
                this.ledgerPath = joinPath(options.workspaceRoot, TASK_RESOURCES_LEDGER_PATH);
        }

        get path(): string {
                return this.ledgerPath;
        }

        /** Loads + validates the ledger; missing file => empty array. */
        async load(): Promise<TaskResourceLedgerRecord[]> {
                const raw = await this.fs.readFileUtf8(this.ledgerPath);
                if (raw === undefined || raw.trim().length === 0) {
                        return [];
                }
                return parseLedger(raw);
        }

        /** Re-derives the lease-state chain from the ledger (the verify() core). */
        async verify(): Promise<LeaseIndex> {
                const records = await this.load();
                return deriveIndex(records);
        }

        /**
         * Appends ONE lease record. The existing content is fully re-validated
         * (corruption fails closed BEFORE we extend); appends preserve every
         * existing byte. Returns the typed outcome (STORE_FAILED on a write
         * failure -- the in-memory state is rolled back to the pre-write state).
         */
        async appendLease(lease: TaskResourceLease): Promise<{ readonly ok: true; readonly lease: TaskResourceLease } | { readonly ok: false; readonly error: TaskResourceFailure }>;
        async appendLease(lease: unknown): Promise<{ readonly ok: true; readonly lease: TaskResourceLease } | { readonly ok: false; readonly error: TaskResourceFailure }>;
        async appendLease(lease: unknown): Promise<{ readonly ok: true; readonly lease: TaskResourceLease } | { readonly ok: false; readonly error: TaskResourceFailure }>;
        async appendLease(lease: TaskResourceLease | unknown): Promise<{ readonly ok: true; readonly lease: TaskResourceLease } | { readonly ok: false; readonly error: TaskResourceFailure }> {
                // deep-validate (PRE-FLIGHT: typed TaskResourceError -> caught + typed outcome)
                let validated: TaskResourceLease;
                try {
                        validated = validateLease(lease);
                } catch (err) {
                        return { ok: false, error: failure('OP_INVALID', err instanceof Error ? err.message : String(err)) };
                }
                // build the ledger record
                const record: TaskResourceLedgerRecord = {
                        schemaVersion: TASK_RESOURCES_SCHEMA_VERSION,
                        schema: TASK_RESOURCES_SCHEMA_ID,
                        kind: 'lease',
                        ts: this.clock(),
                        actor: validated.actor.actor,
                        taskId: validated.taskId,
                        lease: validated,
                };
                return this.appendRaw(record, validated);
        }

        /**
         * Appends ONE hand-off record. Returns the typed outcome.
         */
        async appendHandOff(handOff: TaskHandOffRecord): Promise<{ readonly ok: true; readonly record: TaskHandOffRecord } | { readonly ok: false; readonly error: TaskResourceFailure }>;
        async appendHandOff(handOff: unknown): Promise<{ readonly ok: true; readonly record: TaskHandOffRecord } | { readonly ok: false; readonly error: TaskResourceFailure }>;
        async appendHandOff(handOff: TaskHandOffRecord | unknown): Promise<{ readonly ok: true; readonly record: TaskHandOffRecord } | { readonly ok: false; readonly error: TaskResourceFailure }> {
                // deep-validate (PRE-FLIGHT)
                let validated: TaskHandOffRecord;
                try {
                        validateHandOff(handOff, 'handOff');
                        validated = handOff as TaskHandOffRecord;
                } catch (err) {
                        return { ok: false, error: failure('OP_INVALID', err instanceof Error ? err.message : String(err)) };
                }
                const record: TaskResourceLedgerRecord = {
                        schemaVersion: TASK_RESOURCES_SCHEMA_VERSION,
                        schema: TASK_RESOURCES_SCHEMA_ID,
                        kind: 'hand-off',
                        ts: this.clock(),
                        actor: validated.actor.actor,
                        taskId: validated.taskId,
                        handOff: validated,
                };
                const result = await this.appendRaw(record, validated);
                if (result.ok) {
                        return { ok: true, record: validated };
                }
                return result;
        }

        /** Mints a fresh lease id (the deterministic minter is injectable). */
        mintLeaseId(): string {
                return this.leaseMinter();
        }

        /** Mints a fresh hand-off id (the deterministic minter is injectable). */
        mintHandOffId(): string {
                return this.handOffMinter();
        }

        /**
         * The internal append: re-validates the existing content, extends it,
         * writes atomically (tmp + rename; the same discipline as the PIN-2
         * store). Fail-closed: any IO error => STORE_FAILED.
         */
        private async appendRaw<T>(record: TaskResourceLedgerRecord, payload: T): Promise<{ readonly ok: true; readonly lease: T } | { readonly ok: false; readonly error: TaskResourceFailure }> {
                let line: string;
                try {
                        line = serializeLedgerRecord(record);
                } catch (err) {
                        return { ok: false, error: failure('OP_INVALID', err instanceof Error ? err.message : String(err)) };
                }
                const raw = await this.fs.readFileUtf8(this.ledgerPath);
                const existing = raw === undefined || raw.trim().length === 0 ? '' : raw;
                // re-validate the existing content (corruption fails closed BEFORE we extend)
                if (existing.length > 0) {
                        try {
                                parseLedger(existing);
                        } catch (err) {
                                return { ok: false, error: failure('STORE_FAILED', `the existing ledger is corrupt and cannot be extended: ${err instanceof Error ? err.message : String(err)}`) };
                        }
                }
                const contents = `${existing}${line}\n`;
                try {
                        // ensure the .flauz directory exists (mkdir -p)
                        const flauzDir = joinPath(this.workspaceRoot, '.flauz');
                        await this.fs.mkdir(flauzDir);
                        // atomic write: tmp + rename (the PIN-2 discipline)
                        const tmp = `${this.ledgerPath}.tmp`;
                        await this.fs.writeFile(tmp, contents);
                        await this.fs.rename(tmp, this.ledgerPath);
                } catch (err) {
                        return { ok: false, error: failure('STORE_FAILED', `ledger write failed: ${err instanceof Error ? err.message : String(err)}`) };
                }
                return { ok: true, lease: payload };
        }
}

// ---------------------------------------------------------------------------
// Re-exports (the orchestrator + tests need them)
// ---------------------------------------------------------------------------

export {
        LEASE_HELD_STATES,
        LEASE_TERMINAL_STATES,
        TASK_RESOURCES_LEDGER_PATH,
        TASK_RESOURCES_SCHEMA_ID,
        TASK_RESOURCES_SCHEMA_VERSION,
        type Clock,
        type FileSystemPort,
        type IdMinter,
        type TaskResourceLease,
        type TaskHandOffRecord,
        type TaskResourceFailure,
};
