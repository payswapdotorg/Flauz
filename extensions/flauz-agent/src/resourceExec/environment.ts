/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-S2 -- the PIN-2 environment lifecycle read-only adapter (the task-
 * boundary layer over flauz-environments' `.flauz/environments-lifecycle.json`
 * + `.flauz/environments-ops.jsonl`).
 *
 * Design law (DL-32, verbatim from `journalBridge.ts`): the lifecycle
 * envelope shape, the ops record shape, the actor/op/state enums and the
 * id grammars are DUPLICATED HERE AS TYPES and pinned by the EXISTING
 * repo-root fixtures at `test/fixtures/environments-lifecycle/` (valid + the
 * 21 invalid samples -- consumed READ-ONLY, never modified). This module
 * NEVER imports from `extensions/flauz-environments/*` -- the contract is
 * duplicated.
 *
 * Acquisition semantics (the trust gate is the TL3 manager's; the adapter
 * enforces the SAME verdict READ-ONLY and never weakens it):
 *   - the environment MUST exist in the lifecycle envelope;
 *   - the environment's lifecycle state must permit use (running or
 *     running/attached -- a stopped/destroyed/failed environment is
 *     `RESOURCE_ABSENT` from the lease's perspective: the canonical truth
 *     says it cannot be operated);
 *   - the trust posture is READ-ONLY from the registry
 *     (`.flauz/environments.json` -- a SIBLING envelope, also consumed
 *     READ-ONLY, never modified): `untrusted` => `TRUST_REFUSED` (the
 *     fail-closed gate belongs to the TL3 manager; the adapter enforces the
 *     SAME verdict).
 *
 * Surface snapshot = the environment's access-surface record (descriptorId
 * + providerKind + attachTarget when attached). Release = the typed
 * obligation + the op-port reference (`flauz.env.detach` when attached,
 * `flauz.env.stop` otherwise -- the TL3 manager's call at runtime).
 */
import {
        ENVIRONMENT_ID_PATTERN,
        TaskResourceError,
        canonicalJson,
        hasExactKeys,
        hasKey,
        hasOnlyKeys,
        isBoundedString,
        isEnvironmentId,
        isPlainObject,
        isPositiveEpochMs,
        joinPath,
        type Clock,
        type FileSystemPort,
        type TaskResourceActor,
        type TaskResourceFailure,
        type TaskResourceOpPort,
        type TaskResourceSurfaceSnapshot,
} from './types.ts';
import { failure } from './contracts.ts';

// ---------------------------------------------------------------------------
// The PIN-2 contracts, duplicated as types (DL-32; pinned by repo fixtures)
// ---------------------------------------------------------------------------

/** Envelope schema id pinned into `.flauz/environments-lifecycle.json`. */
export const LIFECYCLE_SCHEMA_ID = 'flauz.environments-lifecycle/v0';

/** Line schema id pinned into `.flauz/environments-ops.jsonl`. */
export const OPS_SCHEMA_ID = 'flauz.environments-ops/v0';

/** Both PIN-2 envelopes carry schemaVersion 0. */
export const LIFECYCLE_SCHEMA_VERSION = 0;

/** Lifecycle file paths, relative to the workspace root (DL-32 siblings). */
export const LIFECYCLE_PATH = '.flauz/environments-lifecycle.json';
export const ENVIRONMENTS_OPS_PATH = '.flauz/environments-ops.jsonl';

/** The environments registry path (sibling envelope, read-only consumption). */
export const ENVIRONMENTS_REGISTRY_PATH = '.flauz/environments.json';

/** Registry schema id (DL-32 sibling). */
export const ENVIRONMENTS_REGISTRY_SCHEMA_ID = 'flauz.environments/v0';

/** The registry's TRUST_POSTURES vocabulary (DL-32). */
export const TRUST_POSTURES = ['trusted', 'untrusted', 'unknown'] as const;
export type TrustPosture = (typeof TRUST_POSTURES)[number];

/** The lifecycle actor enum (PIN-2: MANDATORY on every op). */
export const PROVENANCE_ACTORS = ['agent', 'human', 'tool'] as const;
export type ProvenanceActor = (typeof PROVENANCE_ACTORS)[number];

/** The lifecycle operations (PIN-2). */
export const ENVIRONMENT_OPS = ['create', 'start', 'stop', 'attach', 'detach', 'snapshot', 'destroy'] as const;
export type EnvironmentOpName = (typeof ENVIRONMENT_OPS)[number];

/** Lifecycle phases (PIN-2). */
export const LIFECYCLE_PHASES = ['registered', 'created', 'starting', 'running', 'stopping', 'stopped', 'destroyed', 'failed'] as const;
export type LifecyclePhase = (typeof LIFECYCLE_PHASES)[number];

/** Composite states (the `/attached` substate composes with the pinned entry shape). */
export const ATTACHED_STATES: readonly string[] = ['running/attached', 'stopped/attached'];

/** `true` for `running` / `running/attached`. */
export function isRunningState(state: string): boolean {
        return state === 'running' || state === 'running/attached';
}

/** `true` for any `/attached` composite. */
export function isAttachedState(state: string): boolean {
        return state.endsWith('/attached');
}

/** `true` when `state` is a known lifecycle state (base or composite). */
export function isLifecycleState(state: unknown): state is string {
        if (typeof state !== 'string') {
                return false;
        }
        if ((LIFECYCLE_PHASES as readonly string[]).includes(state)) {
                return true;
        }
        return ATTACHED_STATES.includes(state);
}

// ---------------------------------------------------------------------------
// The registry descriptor (DL-32: the SIBLING envelope consumed read-only)
// ---------------------------------------------------------------------------

export const ENVIRONMENT_KINDS = ['ssh-local', 'container', 'cloud-sandbox', 'workspace-remote'] as const;
export type EnvironmentKind = (typeof ENVIRONMENT_KINDS)[number];

export interface EnvironmentTrust {
        readonly posture: TrustPosture;
        readonly inheritsWorkspaceTrust: boolean;
}

export interface EnvironmentCapabilities {
        readonly browser: boolean;
        readonly exec: boolean;
        readonly agentHost: boolean;
        readonly terminal: boolean;
}

export interface EnvironmentDescriptor {
        readonly id: string;
        readonly kind: EnvironmentKind;
        readonly label: string;
        readonly trust: EnvironmentTrust;
        readonly capabilities: EnvironmentCapabilities;
        readonly enabled: boolean;
        readonly timing: { readonly created: number; readonly updatedAt: number };
        // connection shape omitted (we never read it here -- the lease carries
        // only the LOGICAL id + the surface; the orchestrator dispatches the
        // connection plan via the op port)
}

export interface EnvironmentsEnvelope {
        readonly $schema: string;
        readonly activeId: string | null;
        readonly environments: readonly EnvironmentDescriptor[];
}

// ---------------------------------------------------------------------------
// The PIN-2 record shapes (persisted exactly; canonical JSON on the wire)
// ---------------------------------------------------------------------------

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
        readonly error?: { readonly code: string; readonly message: string };
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
// Strict parsers (fail-closed: STORE_CORRUPT-class typed TaskResourceError)
// ---------------------------------------------------------------------------

function parseError(message: string): TaskResourceError {
        return new TaskResourceError('OP_INVALID', `environments-lifecycle parse: ${message}`);
}

export function parseLifecycleEntry(value: unknown, envId: string): LifecycleEntry {
        if (!isPlainObject(value) || !hasExactKeys(value, ['state', 'updatedAt', 'executorKind', 'lastOpRef'])) {
                throw parseError(`entries['${envId}'] must have exactly the keys [executorKind, lastOpRef, state, updatedAt] (the PIN-2 contract)`);
        }
        if (!isLifecycleState(value.state)) {
                throw parseError(`entries['${envId}'].state '${JSON.stringify(value.state)}' is not a lifecycle state`);
        }
        if (!isPositiveEpochMs(value.updatedAt)) {
                throw parseError(`entries['${envId}'].updatedAt must be a positive epoch-ms integer (got ${JSON.stringify(value.updatedAt)})`);
        }
        if (!isBoundedString(value.executorKind, 64)) {
                throw parseError(`entries['${envId}'].executorKind must be a non-empty string (<= 64 chars)`);
        }
        if (typeof value.lastOpRef !== 'number' || !Number.isSafeInteger(value.lastOpRef) || value.lastOpRef < 1) {
                throw parseError(`entries['${envId}'].lastOpRef must be a positive integer (1-based ops-ledger line number; got ${JSON.stringify(value.lastOpRef)})`);
        }
        return { state: value.state, updatedAt: value.updatedAt, executorKind: value.executorKind, lastOpRef: value.lastOpRef };
}

export function parseLifecycleEnvelope(raw: string): LifecycleEnvelope {
        let value: unknown;
        try {
                value = JSON.parse(raw);
        } catch (err) {
                throw parseError(`lifecycle file is not valid JSON -- ${err instanceof Error ? err.message : String(err)}`);
        }
        if (!isPlainObject(value) || !hasExactKeys(value, ['schemaVersion', 'schema', 'updatedAt', 'entries'])) {
                throw parseError('lifecycle envelope must be an object with exactly the keys [entries, schema, schemaVersion, updatedAt] (the PIN-2 contract)');
        }
        if (value.schemaVersion !== LIFECYCLE_SCHEMA_VERSION) {
                throw parseError(`lifecycle envelope schemaVersion must be exactly ${LIFECYCLE_SCHEMA_VERSION} (got ${JSON.stringify(value.schemaVersion)})`);
        }
        if (value.schema !== LIFECYCLE_SCHEMA_ID) {
                throw parseError(`lifecycle envelope schema must be exactly '${LIFECYCLE_SCHEMA_ID}' (got ${JSON.stringify(value.schema)})`);
        }
        if (!isPositiveEpochMs(value.updatedAt)) {
                throw parseError(`lifecycle envelope updatedAt must be a positive epoch-ms integer (got ${JSON.stringify(value.updatedAt)})`);
        }
        if (!isPlainObject(value.entries)) {
                throw parseError('lifecycle envelope entries must be an object keyed by environment id');
        }
        const entries: Record<string, LifecycleEntry> = {};
        for (const [envId, entry] of Object.entries(value.entries)) {
                if (!isEnvironmentId(envId)) {
                        throw parseError(`lifecycle envelope entry key '${envId}' is not a valid environment id`);
                }
                entries[envId] = parseLifecycleEntry(entry, envId);
        }
        return { schemaVersion: LIFECYCLE_SCHEMA_VERSION, schema: LIFECYCLE_SCHEMA_ID, updatedAt: value.updatedAt, entries };
}

export function parseOpRecord(value: unknown, lineNo: number): EnvironmentOpRecord {
        const where = `ops ledger line ${lineNo}`;
        if (!isPlainObject(value) || !hasOnlyKeys(value, ['schemaVersion', 'schema', 'ts', 'actor', 'op', 'environmentId', 'result', 'fromState', 'toState'], ['error'])) {
                throw parseError(`${where} must have the keys [actor, environmentId, fromState, op, result, schema, schemaVersion, toState, ts] plus at most [error] (the PIN-2 contract)`);
        }
        if (value.schemaVersion !== LIFECYCLE_SCHEMA_VERSION) {
                throw parseError(`${where} schemaVersion must be exactly ${LIFECYCLE_SCHEMA_VERSION}`);
        }
        if (value.schema !== OPS_SCHEMA_ID) {
                throw parseError(`${where} schema must be exactly '${OPS_SCHEMA_ID}'`);
        }
        if (!isPositiveEpochMs(value.ts)) {
                throw parseError(`${where} ts must be a positive epoch-ms integer`);
        }
        if (typeof value.actor !== 'string' || !(PROVENANCE_ACTORS as readonly string[]).includes(value.actor)) {
                throw parseError(`${where} actor must be one of agent|human|tool (got ${JSON.stringify(value.actor)}) -- provenance is mandatory`);
        }
        if (typeof value.op !== 'string' || !(ENVIRONMENT_OPS as readonly string[]).includes(value.op)) {
                throw parseError(`${where} op must be one of ${ENVIRONMENT_OPS.join('|')} (got ${JSON.stringify(value.op)})`);
        }
        if (typeof value.environmentId !== 'string' || !isEnvironmentId(value.environmentId)) {
                throw parseError(`${where} environmentId must be a valid environment id (got ${JSON.stringify(value.environmentId)})`);
        }
        if (value.result !== 'ok' && value.result !== 'error') {
                throw parseError(`${where} result must be 'ok' or 'error' (got ${JSON.stringify(value.result)})`);
        }
        for (const key of ['fromState', 'toState'] as const) {
                if (typeof value[key] !== 'string' || !isLifecycleState(value[key])) {
                        throw parseError(`${where} ${key} '${JSON.stringify(value[key])}' is not a lifecycle state`);
                }
        }
        if (value.result === 'error') {
                if (!hasKey(value, 'error')) {
                        throw parseError(`${where} result 'error' requires the error payload {code, message}`);
                }
                if (!isPlainObject(value.error) || !hasExactKeys(value.error, ['code', 'message'])) {
                        throw parseError(`${where} error must have exactly the keys [code, message]`);
                }
                if (!isBoundedString(value.error.code, 64)) {
                        throw parseError(`${where} error.code must be a non-empty string (<= 64 chars)`);
                }
                if (!isBoundedString(value.error.message, 300)) {
                        throw parseError(`${where} error.message must be a non-empty string (<= 300 chars)`);
                }
        } else if (hasKey(value, 'error')) {
                throw parseError(`${where} result 'ok' must not carry an error payload`);
        }
        return {
                schemaVersion: LIFECYCLE_SCHEMA_VERSION,
                schema: OPS_SCHEMA_ID,
                ts: value.ts,
                actor: value.actor as ProvenanceActor,
                op: value.op as EnvironmentOpName,
                environmentId: value.environmentId,
                result: value.result,
                fromState: value.fromState as string,
                toState: value.toState as string,
                ...(value.result === 'error'
                        ? { error: { code: (value.error as Record<string, string>).code, message: (value.error as Record<string, string>).message } }
                        : {}),
        };
}

export function parseOpLine(line: string, lineNo: number): EnvironmentOpRecord {
        let value: unknown;
        try {
                value = JSON.parse(line);
        } catch (err) {
                throw parseError(`ops ledger line ${lineNo} is not valid JSON -- ${err instanceof Error ? err.message : String(err)}`);
        }
        return parseOpRecord(value, lineNo);
}

/** Parses a full ops ledger (strict; one record per line; one trailing newline). */
export function parseOpsLedger(raw: string): EnvironmentOpRecord[] {
        const lines = raw.split('\n');
        if (lines[lines.length - 1] !== '') {
                throw parseError('ops ledger must end with a newline');
        }
        const records: EnvironmentOpRecord[] = [];
        for (let i = 0; i < lines.length - 1; i++) {
                const line = lines[i]!;
                if (line.trim().length === 0) {
                        throw parseError(`ops ledger line ${i + 1} is empty (one JSON object per line; no blank lines)`);
                }
                records.push(parseOpLine(line, i + 1));
        }
        return records;
}

// ---------------------------------------------------------------------------
// The registry parser (sibling envelope, read-only consumption)
// ---------------------------------------------------------------------------

export function parseEnvironmentsEnvelope(raw: string): EnvironmentsEnvelope {
        let value: unknown;
        try {
                value = JSON.parse(raw);
        } catch (err) {
                throw parseError(`environments registry is not valid JSON -- ${err instanceof Error ? err.message : String(err)}`);
        }
        if (!isPlainObject(value) || !hasOnlyKeys(value, ['$schema', 'activeId', 'environments'], [])) {
                throw parseError('environments envelope must have exactly the keys [$schema, activeId, environments]');
        }
        if (typeof value.$schema !== 'string' || value.$schema !== ENVIRONMENTS_REGISTRY_SCHEMA_ID) {
                throw parseError(`environments envelope $schema must be '${ENVIRONMENTS_REGISTRY_SCHEMA_ID}' (got ${JSON.stringify(value.$schema)})`);
        }
        if (value.activeId !== null && (typeof value.activeId !== 'string' || !isEnvironmentId(value.activeId))) {
                throw parseError('environments envelope activeId must be null or a valid environment id');
        }
        if (!Array.isArray(value.environments)) {
                throw parseError('environments envelope environments must be an array');
        }
        const environments: EnvironmentDescriptor[] = [];
        for (const [index, entry] of value.environments.entries()) {
                if (!isPlainObject(entry)) {
                        throw parseError(`environments[${index}] must be an object`);
                }
                environments.push(parseEnvironmentDescriptor(entry, `environments[${index}]`));
        }
        return { $schema: value.$schema, activeId: value.activeId, environments };
}

function parseEnvironmentDescriptor(value: Record<string, unknown>, where: string): EnvironmentDescriptor {
        if (!hasOnlyKeys(value, ['id', 'kind', 'label', 'trust', 'capabilities', 'enabled', 'timing'], [])) {
                throw parseError(`${where} must have exactly the keys [id, kind, label, trust, capabilities, enabled, timing]`);
        }
        if (!isEnvironmentId(value.id)) {
                throw parseError(`${where}.id must be a valid environment id`);
        }
        if (typeof value.kind !== 'string' || !(ENVIRONMENT_KINDS as readonly string[]).includes(value.kind)) {
                throw parseError(`${where}.kind must be one of ${ENVIRONMENT_KINDS.join('|')}`);
        }
        if (typeof value.label !== 'string' || value.label.length === 0) {
                throw parseError(`${where}.label must be a non-empty string`);
        }
        if (!isPlainObject(value.trust) || !hasExactKeys(value.trust, ['posture', 'inheritsWorkspaceTrust'])) {
                throw parseError(`${where}.trust must have exactly the keys [posture, inheritsWorkspaceTrust]`);
        }
        if (typeof value.trust.posture !== 'string' || !(TRUST_POSTURES as readonly string[]).includes(value.trust.posture)) {
                throw parseError(`${where}.trust.posture must be one of ${TRUST_POSTURES.join('|')}`);
        }
        if (typeof value.trust.inheritsWorkspaceTrust !== 'boolean') {
                throw parseError(`${where}.trust.inheritsWorkspaceTrust must be a boolean`);
        }
        if (!isPlainObject(value.capabilities) || !hasExactKeys(value.capabilities, ['browser', 'exec', 'agentHost', 'terminal'])) {
                throw parseError(`${where}.capabilities must have exactly the keys [browser, exec, agentHost, terminal]`);
        }
        for (const cap of ['browser', 'exec', 'agentHost', 'terminal'] as const) {
                const flag: unknown = (value.capabilities as Record<string, unknown>)[cap];
                if (typeof flag !== 'boolean') {
                        throw parseError(`${where}.capabilities.${cap} must be a boolean`);
                }
        }
        const caps: EnvironmentCapabilities = {
                browser: (value.capabilities as Record<string, unknown>).browser as boolean,
                exec: (value.capabilities as Record<string, unknown>).exec as boolean,
                agentHost: (value.capabilities as Record<string, unknown>).agentHost as boolean,
                terminal: (value.capabilities as Record<string, unknown>).terminal as boolean,
        };
        if (typeof value.enabled !== 'boolean') {
                throw parseError(`${where}.enabled must be a boolean`);
        }
        if (!isPlainObject(value.timing) || !hasExactKeys(value.timing, ['created', 'updatedAt'])) {
                throw parseError(`${where}.timing must have exactly the keys [created, updatedAt]`);
        }
        if (!isPositiveEpochMs(value.timing.created) || !isPositiveEpochMs(value.timing.updatedAt)) {
                throw parseError(`${where}.timing must have positive epoch-ms created + updatedAt`);
        }
        return {
                id: value.id,
                kind: value.kind as EnvironmentKind,
                label: value.label,
                trust: { posture: value.trust.posture as TrustPosture, inheritsWorkspaceTrust: value.trust.inheritsWorkspaceTrust },
                capabilities: caps,
                enabled: value.enabled,
                timing: { created: value.timing.created, updatedAt: value.timing.updatedAt },
        };
}

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

export interface EnvironmentAdapterOptions {
        readonly workspaceRoot: string;
        readonly fs: FileSystemPort;
        readonly clock?: Clock;
}

/** The acquisition result (typed; never a raw throw). */
export type EnvironmentAcquireResult =
        | {
                readonly ok: true;
                readonly entry: LifecycleEntry;
                readonly descriptor: EnvironmentDescriptor;
                readonly snapshot: TaskResourceSurfaceSnapshot;
                readonly opPort: TaskResourceOpPort;
        }
        | { readonly ok: false; readonly error: TaskResourceFailure };

/** The release result (typed; idempotent; the op-port reference for the orchestrator). */
export type EnvironmentReleaseResult =
        | { readonly ok: true; readonly opPort: TaskResourceOpPort; readonly idempotent: boolean }
        | { readonly ok: false; readonly error: TaskResourceFailure };

/**
 * The PIN-2 read-only adapter. Owns:
 *   - lifecycle envelope loading + strict parsing;
 *   - registry (sibling envelope) loading + strict parsing;
 *   - acquire (existence + usable state + trust gate);
 *   - release (typed op-port reference -- `flauz.env.detach` when attached,
 *     `flauz.env.stop` otherwise).
 *
 * NEVER starts / stops / attaches / detaches; NEVER writes to PIN-2 files;
 * NEVER weakens the trust gate.
 */
export class EnvironmentAdapter {
        private readonly workspaceRoot: string;
        private readonly fs: FileSystemPort;
        private readonly clock: Clock;

        constructor(options: EnvironmentAdapterOptions) {
                this.workspaceRoot = options.workspaceRoot;
                this.fs = options.fs;
                this.clock = options.clock ?? (() => Date.now());
        }

        get lifecyclePath(): string {
                return joinPath(this.workspaceRoot, LIFECYCLE_PATH);
        }

        get opsLedgerPath(): string {
                return joinPath(this.workspaceRoot, ENVIRONMENTS_OPS_PATH);
        }

        get registryPath(): string {
                return joinPath(this.workspaceRoot, ENVIRONMENTS_REGISTRY_PATH);
        }

        /** Loads + validates the lifecycle envelope; missing file => empty envelope. */
        async loadLifecycle(): Promise<LifecycleEnvelope> {
                const raw = await this.fs.readFileUtf8(this.lifecyclePath);
                if (raw === undefined || raw.trim().length === 0) {
                        return { schemaVersion: LIFECYCLE_SCHEMA_VERSION, schema: LIFECYCLE_SCHEMA_ID, updatedAt: this.clock(), entries: {} };
                }
                return parseLifecycleEnvelope(raw);
        }

        /** Loads + validates the registry; missing file => undefined. */
        async loadRegistry(): Promise<EnvironmentsEnvelope | undefined> {
                const raw = await this.fs.readFileUtf8(this.registryPath);
                if (raw === undefined || raw.trim().length === 0) {
                        return undefined;
                }
                return parseEnvironmentsEnvelope(raw);
        }

        /** Loads + validates the ops ledger; missing file => empty array. */
        async loadOps(): Promise<EnvironmentOpRecord[]> {
                const raw = await this.fs.readFileUtf8(this.opsLedgerPath);
                if (raw === undefined || raw.trim().length === 0) {
                        return [];
                }
                return parseOpsLedger(raw);
        }

        /** The latest entry for `environmentId`, or `undefined` if absent. */
        async entryFor(environmentId: string): Promise<LifecycleEntry | undefined> {
                const envelope = await this.loadLifecycle();
                return envelope.entries[environmentId];
        }

        /** The registry descriptor for `environmentId`, or `undefined` if absent. */
        async descriptorFor(environmentId: string): Promise<EnvironmentDescriptor | undefined> {
                const registry = await this.loadRegistry();
                if (registry === undefined) {
                        return undefined;
                }
                return registry.environments.find(env => env.id === environmentId);
        }

        /**
         * Acquire: the environment MUST exist with a usable lifecycle state,
         * and the trust posture MUST permit use. The fail-closed gate belongs
         * to the TL3 manager; the adapter enforces the SAME verdict READ-ONLY
         * and never weakens it.
         */
        async acquire(environmentId: string, actor: TaskResourceActor): Promise<EnvironmentAcquireResult> {
                if (!isEnvironmentId(environmentId)) {
                        return { ok: false, error: failure('RESOURCE_ABSENT', `environmentId must be a valid env-<slug> id (got ${JSON.stringify(environmentId)})`) };
                }
                if (actor !== 'agent' && actor !== 'human' && actor !== 'tool') {
                        throw new TaskResourceError('PROVENANCE_INVALID', `acquire: actor must be one of agent|human|tool (got ${JSON.stringify(actor)})`);
                }
                const entry = await this.entryFor(environmentId);
                if (entry === undefined) {
                        return { ok: false, error: failure('RESOURCE_ABSENT', `environment ${environmentId} not found in the lifecycle envelope (no canonical lifecycle state)`) };
                }
                if (!isRunningState(entry.state) && !isAttachedState(entry.state)) {
                        // a stopped/destroyed/failed environment is RESOURCE_ABSENT from
                        // the lease's perspective: the canonical truth says it cannot
                        // be operated. The orchestrator may start it first (via
                        // `flauz.env.start`) -- but the lease itself cannot bind to it
                        // until the lifecycle state permits use.
                        return { ok: false, error: failure('RESOURCE_ABSENT', `environment ${environmentId} is in lifecycle state '${entry.state}' (must be running or running/attached to be operable; the orchestrator may start it first)`) };
                }
                const descriptor = await this.descriptorFor(environmentId);
                if (descriptor === undefined) {
                        // the lifecycle envelope exists but the registry doesn't: the
                        // trust posture cannot be verified -> fail-closed (the TL3
                        // manager's gate; the adapter enforces the same verdict)
                        return { ok: false, error: failure('TRUST_REFUSED', `environment ${environmentId} has no registry descriptor (trust posture cannot be verified -- fail-closed; the TL3 manager's gate, enforced read-only)`) };
                }
                if (!descriptor.enabled) {
                        return { ok: false, error: failure('TRUST_REFUSED', `environment ${environmentId} is disabled in the registry (the registry's enabled flag is the authoritative posture)`) };
                }
                if (descriptor.trust.posture === 'untrusted') {
                        return {
                                ok: false,
                                error: failure(
                                        'TRUST_REFUSED',
                                        `environment ${environmentId} has trust posture 'untrusted' -- the fail-closed gate belongs to the TL3 manager; the adapter enforces the SAME verdict read-only and never weakens it`,
                                        { posture: descriptor.trust.posture },
                                ),
                        };
                }
                if (descriptor.trust.posture === 'unknown') {
                        // 'unknown' is also fail-closed: the manager refuses to start/
                        // attach until the posture is set to 'trusted' (the typed
                        // TRUST_POSTURE_REJECTED gate, applied here at the task boundary)
                        return {
                                ok: false,
                                error: failure(
                                        'TRUST_REFUSED',
                                        `environment ${environmentId} has trust posture 'unknown' -- the manager refuses start/attach until the posture is set to 'trusted' (fail-closed; the adapter enforces the SAME verdict)`,
                                        { posture: descriptor.trust.posture },
                                ),
                        };
                }
                // 'trusted' -- the gate permits use
                const snapshot: TaskResourceSurfaceSnapshot = {
                        kind: 'environment',
                        descriptorId: descriptor.id,
                        providerKind: descriptor.kind,
                        ...(isAttachedState(entry.state) ? { attachTarget: descriptor.id } : {}),
                };
                const opPort: TaskResourceOpPort = isAttachedState(entry.state) ? 'flauz.env.detach' : 'flauz.env.stop';
                return { ok: true, entry, descriptor, snapshot, opPort };
        }

        /**
         * Release: typed op-port reference for the orchestrator. Idempotent:
         * an environment already in a terminal state (stopped/destroyed/failed)
         * releases CLEANLY (the obligation is discharged; the canonical truth
         * says nothing to tear down -- the record states exactly that).
         */
        async release(environmentId: string): Promise<EnvironmentReleaseResult> {
                if (!isEnvironmentId(environmentId)) {
                        return { ok: false, error: failure('RESOURCE_ABSENT', `environmentId must be a valid env-<slug> id (got ${JSON.stringify(environmentId)})`) };
                }
                const entry = await this.entryFor(environmentId);
                if (entry === undefined) {
                        return { ok: true, opPort: 'flauz.env.stop', idempotent: true };
                }
                const idempotent = entry.state === 'stopped' || entry.state === 'destroyed' || entry.state === 'failed';
                const opPort: TaskResourceOpPort = isAttachedState(entry.state) ? 'flauz.env.detach' : 'flauz.env.stop';
                return { ok: true, opPort, idempotent };
        }
}

// ---------------------------------------------------------------------------
// Re-exports (the orchestrator + tests need them)
// ---------------------------------------------------------------------------

export { canonicalJson, isPlainObject, isPositiveEpochMs, isBoundedString, hasKey, hasOnlyKeys, hasExactKeys, ENVIRONMENT_ID_PATTERN };
