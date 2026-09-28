/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-S2 -- the PIN-2 read-only environment lease adapter.
 *
 * Reads the canonical flauz-environments state READ-ONLY and enforces the
 * SAME verdicts the TL3 lifecycle manager enforces, without ever weakening
 * them:
 *   - `.flauz/environments.json` (envelope `flauz.environments/v0`) -- the
 *     descriptor registry. DUPLICATED HERE (DL-32) as the minimal strict
 *     shape this adapter consumes: id, kind, trust posture, enabled. The
 *     full connection-shape validation belongs to the flauz-environments
 *     registry; this adapter never re-implements it.
 *   - `.flauz/environments-lifecycle.json` (envelope
 *     `flauz.environments-lifecycle/v0`, PIN-2) -- the typed lifecycle
 *     state machine. DUPLICATED HERE as the exact strict envelope parse.
 *   - `.flauz/environments-ops.jsonl` (envelope
 *     `flauz.environments-ops/v0`) -- the append-only ops ledger, consumed
 *     as ADVISORY audit context with per-line typed skips (fail-closed per
 *     line, never a crash -- the journalBridge read discipline for
 *     read-only reconciliation of append-only ledgers).
 *
 * THE TRUST GATE (TL3-003): start/attach on an `untrusted` environment is
 * rejected fail-closed by the manager; the adapter enforces the SAME
 * verdict read-only -- an untrusted environment cannot be leased
 * (TRUST_REFUSED, the message names the posture). A disabled environment
 * cannot be leased either (the manager's ENVIRONMENT_DISABLED gate,
 * enforced read-only). A destroyed environment is a terminal tombstone --
 * RESOURCE_ABSENT. The adapter NEVER performs lifecycle ops: the op ports
 * it references (`flauz.env.create` / `flauz.env.start` / `flauz.env.attach`
 * / `flauz.env.detach` / `flauz.env.stop`) are the TL3 manager's calls at
 * runtime.
 *
 * The opPort mapping (the port owning the primary runtime effect for the
 * CURRENT lifecycle state):
 *   registered -> flauz.env.create; created | failed -> flauz.env.start;
 *   stopped -> flauz.env.start; stopped/attached -> flauz.env.detach;
 *   starting | running -> flauz.env.attach; running/attached ->
 *   flauz.env.detach. Release always references flauz.env.detach for
 *   attached states and flauz.env.stop otherwise.
 */
import {
	canonicalJson,
	hasOnlyKeys,
	isEnvironmentId,
	isPlainObject,
	isPositiveEpochMs,
	joinPath,
	type Clock,
	type FileSystemPort,
	type LeaseProvenance,
	type LeaseSurfaceSnapshot,
} from './types.ts';
import type { AcquisitionVerdict, ReleaseVerdict, ResourceLeaseAdapter, SurfaceCheckVerdict } from './contracts.ts';

/** Registry path, relative to the workspace root (flauz-environments contract). */
export const ENVIRONMENTS_REGISTRY_PATH = '.flauz/environments.json';

/** Lifecycle envelope path (PIN-2). */
export const LIFECYCLE_PATH = '.flauz/environments-lifecycle.json';

/** Ops ledger path (PIN-2). */
export const OPS_PATH = '.flauz/environments-ops.jsonl';

/** Registry envelope schema id. */
export const ENVIRONMENTS_SCHEMA_ID = 'flauz.environments/v0';

/** Lifecycle envelope schema id (PIN-2). */
export const LIFECYCLE_SCHEMA_ID = 'flauz.environments-lifecycle/v0';

/** Ops ledger line schema id (PIN-2). */
export const OPS_SCHEMA_ID = 'flauz.environments-ops/v0';

/** The contract-duplicated vocabularies (DL-32). */
export const ENVIRONMENT_KINDS = ['ssh-local', 'container', 'cloud-sandbox', 'workspace-remote'] as const;
export type EnvironmentKind = (typeof ENVIRONMENT_KINDS)[number];

export const TRUST_POSTURES = ['trusted', 'untrusted', 'unknown'] as const;
export type TrustPosture = (typeof TRUST_POSTURES)[number];

export const PROVENANCE_ACTORS = ['agent', 'human', 'tool'] as const;
export type ProvenanceActor = (typeof PROVENANCE_ACTORS)[number];

export const ENVIRONMENT_OPS = ['create', 'start', 'stop', 'attach', 'detach', 'snapshot', 'destroy'] as const;
export type EnvironmentOpName = (typeof ENVIRONMENT_OPS)[number];

/** Full lifecycle states: phases + the `/attached` connection substates. */
export const LIFECYCLE_STATES: readonly string[] = [
	'registered', 'created', 'starting', 'running', 'stopping', 'stopped', 'destroyed', 'failed',
	'running/attached', 'stopped/attached',
];

function isLifecycleState(value: unknown): value is string {
	return typeof value === 'string' && LIFECYCLE_STATES.includes(value);
}

// ---------------------------------------------------------------------------
// The duplicated record shapes (strict, contract-pinned)
// ---------------------------------------------------------------------------

/** The minimal strict descriptor this adapter consumes (DL-32: duplicate what you use). */
export interface EnvironmentRegistryEntry {
	readonly id: string;
	readonly kind: EnvironmentKind;
	readonly trust: { readonly posture: TrustPosture; readonly inheritsWorkspaceTrust: boolean };
	readonly enabled: boolean;
	readonly timing: { readonly created: number; readonly updatedAt: number };
}

export interface EnvironmentsRegistryEnvelope {
	readonly $schema: string;
	readonly activeId: string | null;
	readonly environments: readonly EnvironmentRegistryEntry[];
}

/** One PIN-2 lifecycle entry (the exact key set). */
export interface LifecycleEntry {
	readonly state: string;
	readonly updatedAt: number;
	readonly executorKind: string;
	readonly lastOpRef: number;
}

/** The PIN-2 lifecycle envelope (the exact key set). */
export interface LifecycleEnvelope {
	readonly schemaVersion: number;
	readonly schema: string;
	readonly updatedAt: number;
	readonly entries: Readonly<Record<string, LifecycleEntry>>;
}

/** One PIN-2 ops-ledger line (the exact key set). */
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

// ---------------------------------------------------------------------------
// Strict parsers (typed errors; the state files are canonical state -- corrupt = STATE_UNREADABLE)
// ---------------------------------------------------------------------------

function unreadable(message: string): Error {
	return new Error(message);
}

function isBoundedString(value: unknown, max: number): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= max;
}

/** Parses the registry envelope (strict on the consumed fields; DL-32 minimal duplication). */
export function parseEnvironmentsRegistry(raw: string): EnvironmentsRegistryEnvelope {
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch (err) {
		throw unreadable(`the environments registry is not valid JSON -- ${err instanceof Error ? err.message : String(err)}`);
	}
	if (!isPlainObject(value) || !hasOnlyKeys(value, ['$schema', 'activeId', 'environments'], [])) {
		throw unreadable('the environments registry must be an object with exactly the keys [$schema, activeId, environments] (flauz.environments/v0)');
	}
	if (value['$schema'] !== ENVIRONMENTS_SCHEMA_ID) {
		throw unreadable(`the environments registry $schema must be exactly '${ENVIRONMENTS_SCHEMA_ID}' (got ${JSON.stringify(value['$schema'])})`);
	}
	if (value['activeId'] !== null && !isEnvironmentId(value['activeId'])) {
		throw unreadable(`the environments registry activeId must be an environment id or null (got ${JSON.stringify(value['activeId'])})`);
	}
	if (!Array.isArray(value['environments'])) {
		throw unreadable('the environments registry environments must be an array of descriptors');
	}
	const environments: EnvironmentRegistryEntry[] = [];
	for (const [index, entry] of (value['environments'] as readonly unknown[]).entries()) {
		if (!isPlainObject(entry) || !hasOnlyKeys(entry, ['id', 'kind', 'label', 'connection', 'trust', 'capabilities', 'enabled', 'timing'], [])) {
			throw unreadable(`environments[${index}] must have exactly the keys [id, kind, label, connection, trust, capabilities, enabled, timing] (the flauz.environments/v0 descriptor)`);
		}
		if (!isEnvironmentId(entry['id'])) {
			throw unreadable(`environments[${index}].id must be a registry environment id 'env-<slug>' (got ${JSON.stringify(entry['id'])})`);
		}
		if (typeof entry['kind'] !== 'string' || !(ENVIRONMENT_KINDS as readonly string[]).includes(entry['kind'])) {
			throw unreadable(`environments[${index}].kind must be one of ${ENVIRONMENT_KINDS.join('|')} (got ${JSON.stringify(entry['kind'])})`);
		}
		if (!isPlainObject(entry['trust']) || !hasOnlyKeys(entry['trust'], ['posture', 'inheritsWorkspaceTrust'], []) || typeof entry['trust']['posture'] !== 'string' || !(TRUST_POSTURES as readonly string[]).includes(entry['trust']['posture']) || typeof entry['trust']['inheritsWorkspaceTrust'] !== 'boolean') {
			throw unreadable(`environments[${index}].trust must be { posture: ${TRUST_POSTURES.join('|')}, inheritsWorkspaceTrust: boolean }`);
		}
		if (typeof entry['enabled'] !== 'boolean') {
			throw unreadable(`environments[${index}].enabled must be a boolean`);
		}
		if (!isPlainObject(entry['timing']) || !hasOnlyKeys(entry['timing'], ['created', 'updatedAt'], []) || !isPositiveEpochMs(entry['timing']['created']) || !isPositiveEpochMs(entry['timing']['updatedAt'])) {
			throw unreadable(`environments[${index}].timing must be { created, updatedAt } positive epoch-ms integers`);
		}
		environments.push({
			id: entry['id'],
			kind: entry['kind'] as EnvironmentKind,
			trust: { posture: entry['trust']['posture'] as TrustPosture, inheritsWorkspaceTrust: entry['trust']['inheritsWorkspaceTrust'] },
			enabled: entry['enabled'],
			timing: { created: entry['timing']['created'], updatedAt: entry['timing']['updatedAt'] },
		});
	}
	return { $schema: ENVIRONMENTS_SCHEMA_ID, activeId: value['activeId'], environments };
}

/** Parses the PIN-2 lifecycle envelope (strict, exact key sets). */
export function parseLifecycleEnvelope(raw: string): LifecycleEnvelope {
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch (err) {
		throw unreadable(`the lifecycle file is not valid JSON -- ${err instanceof Error ? err.message : String(err)}`);
	}
	if (!isPlainObject(value) || !hasOnlyKeys(value, ['schemaVersion', 'schema', 'updatedAt', 'entries'], [])) {
		throw unreadable('lifecycle envelope must be an object with exactly the keys [entries, schema, schemaVersion, updatedAt] (the PIN-2 contract)');
	}
	if (value['schemaVersion'] !== 0) {
		throw unreadable(`lifecycle envelope schemaVersion must be exactly 0 (got ${JSON.stringify(value['schemaVersion'])})`);
	}
	if (value['schema'] !== LIFECYCLE_SCHEMA_ID) {
		throw unreadable(`lifecycle envelope schema must be exactly '${LIFECYCLE_SCHEMA_ID}' (got ${JSON.stringify(value['schema'])})`);
	}
	if (!isPositiveEpochMs(value['updatedAt'])) {
		throw unreadable('lifecycle envelope updatedAt must be a positive epoch-ms integer');
	}
	if (!isPlainObject(value['entries'])) {
		throw unreadable('lifecycle envelope entries must be an object keyed by environment id');
	}
	const entries: Record<string, LifecycleEntry> = {};
	for (const [envId, entry] of Object.entries(value['entries'])) {
		if (!isEnvironmentId(envId)) {
			throw unreadable(`lifecycle envelope entry key '${envId}' is not a valid environment id`);
		}
		if (!isPlainObject(entry) || !hasOnlyKeys(entry, ['state', 'updatedAt', 'executorKind', 'lastOpRef'], [])) {
			throw unreadable(`entries['${envId}'] must have exactly the keys [executorKind, lastOpRef, state, updatedAt] (the PIN-2 contract)`);
		}
		if (!isLifecycleState(entry['state'])) {
			throw unreadable(`entries['${envId}'].state '${JSON.stringify(entry['state'])}' is not a lifecycle state (expected one of ${LIFECYCLE_STATES.join('|')})`);
		}
		if (!isPositiveEpochMs(entry['updatedAt'])) {
			throw unreadable(`entries['${envId}'].updatedAt must be a positive epoch-ms integer`);
		}
		if (!isBoundedString(entry['executorKind'], 64)) {
			throw unreadable(`entries['${envId}'].executorKind must be a non-empty string (<= 64 chars)`);
		}
		if (typeof entry['lastOpRef'] !== 'number' || !Number.isSafeInteger(entry['lastOpRef']) || entry['lastOpRef'] < 1) {
			throw unreadable(`entries['${envId}'].lastOpRef must be a positive integer (1-based ops-ledger line number)`);
		}
		entries[envId] = { state: entry['state'], updatedAt: entry['updatedAt'], executorKind: entry['executorKind'], lastOpRef: entry['lastOpRef'] };
	}
	return { schemaVersion: 0, schema: LIFECYCLE_SCHEMA_ID, updatedAt: value['updatedAt'], entries };
}

/** One advisory ops-ledger line result: the record, or the typed skip reason. */
export type OpsLineResult = { readonly ok: true; readonly record: EnvironmentOpRecord } | { readonly ok: false; readonly reason: string };

/** Validates ONE ops-ledger line (per-line typed skips; advisory consumption). */
export function parseOpsLine(line: string): OpsLineResult {
	let value: unknown;
	try {
		value = JSON.parse(line);
	} catch (err) {
		return { ok: false, reason: `not valid JSON -- ${err instanceof Error ? err.message : String(err)}` };
	}
	if (!isPlainObject(value) || !hasOnlyKeys(value, ['schemaVersion', 'schema', 'ts', 'actor', 'op', 'environmentId', 'result', 'fromState', 'toState'], ['error'])) {
		return { ok: false, reason: 'record must have the keys [actor, environmentId, fromState, op, result, schema, schemaVersion, toState, ts] plus at most [error] (the PIN-2 contract)' };
	}
	if (value['schemaVersion'] !== 0 || value['schema'] !== OPS_SCHEMA_ID) {
		return { ok: false, reason: `record must carry schema 'flauz.environments-ops/v0' version 0` };
	}
	if (!isPositiveEpochMs(value['ts'])) {
		return { ok: false, reason: 'ts must be a positive epoch-ms integer' };
	}
	if (typeof value['actor'] !== 'string' || !(PROVENANCE_ACTORS as readonly string[]).includes(value['actor'])) {
		return { ok: false, reason: `actor must be one of ${PROVENANCE_ACTORS.join('|')} (got ${JSON.stringify(value['actor'])}) -- provenance is mandatory` };
	}
	if (typeof value['op'] !== 'string' || !(ENVIRONMENT_OPS as readonly string[]).includes(value['op'])) {
		return { ok: false, reason: `op must be one of ${ENVIRONMENT_OPS.join('|')} (got ${JSON.stringify(value['op'])})` };
	}
	if (!isEnvironmentId(value['environmentId'])) {
		return { ok: false, reason: `environmentId must be a valid environment id (got ${JSON.stringify(value['environmentId'])})` };
	}
	if (value['result'] !== 'ok' && value['result'] !== 'error') {
		return { ok: false, reason: `result must be 'ok' or 'error' (got ${JSON.stringify(value['result'])})` };
	}
	if (!isLifecycleState(value['fromState']) || !isLifecycleState(value['toState'])) {
		return { ok: false, reason: 'fromState/toState must be lifecycle states' };
	}
	if (value['result'] === 'error' && (!isPlainObject(value['error']) || !hasOnlyKeys(value['error'], ['code', 'message'], []) || !isBoundedString(value['error']['code'], 64) || !isBoundedString(value['error']['message'], 300))) {
		return { ok: false, reason: "result 'error' requires the error payload {code, message}" };
	}
	return {
		ok: true,
		record: {
			schemaVersion: 0, schema: OPS_SCHEMA_ID, ts: value['ts'], actor: value['actor'] as ProvenanceActor, op: value['op'] as EnvironmentOpName, environmentId: value['environmentId'], result: value['result'], fromState: value['fromState'], toState: value['toState'],
			...(value['result'] === 'error' ? { error: { code: (value['error'] as Record<string, string>)['code'], message: (value['error'] as Record<string, string>)['message'] } } : {}),
		},
	};
}

// ---------------------------------------------------------------------------
// The posture resolver (shared with continuity.ts -- same-module consumption)
// ---------------------------------------------------------------------------

export type PostureVerdict =
	| { readonly ok: true; readonly posture: TrustPosture; readonly enabled: boolean; readonly kind: EnvironmentKind }
	| { readonly ok: false; readonly code: 'RESOURCE_ABSENT' | 'STATE_UNREADABLE'; readonly message: string };

/** Resolves an environment's posture/enabled/kind from the registry (read-only). */
export async function resolveEnvironmentPosture(root: string, fs: FileSystemPort, environmentId: string): Promise<PostureVerdict> {
	if (!isEnvironmentId(environmentId)) {
		return { ok: false, code: 'RESOURCE_ABSENT', message: `environmentId must be a registry id 'env-<slug>' (got ${JSON.stringify(environmentId)}) -- never a path, never a URL` };
	}
	const raw = await fs.readFileUtf8(joinPath(root, ENVIRONMENTS_REGISTRY_PATH));
	if (raw === undefined || raw.trim().length === 0) {
		return { ok: false, code: 'RESOURCE_ABSENT', message: `environment '${environmentId}' is not registered (no environments registry exists)` };
	}
	let registry: EnvironmentsRegistryEnvelope;
	try {
		registry = parseEnvironmentsRegistry(raw);
	} catch (err) {
		return { ok: false, code: 'STATE_UNREADABLE', message: err instanceof Error ? err.message : String(err) };
	}
	const entry = registry.environments.find(candidate => candidate.id === environmentId);
	if (entry === undefined) {
		return { ok: false, code: 'RESOURCE_ABSENT', message: `environment '${environmentId}' is not registered (the registry holds ${registry.environments.length} environment(s))` };
	}
	return { ok: true, posture: entry.trust.posture, enabled: entry.enabled, kind: entry.kind };
}

// ---------------------------------------------------------------------------
// The adapter (read-only over the canonical PIN-2 pair + the registry)
// ---------------------------------------------------------------------------

export interface EnvironmentLeaseAdapterOptions {
	readonly root: string;
	readonly fs: FileSystemPort;
	readonly clock?: Clock;
}

/** The environment lease adapter (read-only; the trust gate is never weakened). */
export class EnvironmentLeaseAdapter implements ResourceLeaseAdapter {
	readonly kind = 'environment' as const;

	private readonly root: string;
	private readonly fs: FileSystemPort;

	constructor(options: EnvironmentLeaseAdapterOptions) {
		this.root = options.root;
		this.fs = options.fs;
	}

	private async readState(): Promise<{ registry: EnvironmentsRegistryEnvelope; lifecycle: LifecycleEnvelope; ops: readonly EnvironmentOpRecord[]; opsSkipped: number } | { error: string }> {
		const registryRaw = await this.fs.readFileUtf8(joinPath(this.root, ENVIRONMENTS_REGISTRY_PATH));
		if (registryRaw === undefined || registryRaw.trim().length === 0) {
			return { error: 'no environments registry exists (.flauz/environments.json is absent or empty) -- the canonical TL3 state cannot be read' };
		}
		let registry: EnvironmentsRegistryEnvelope;
		try {
			registry = parseEnvironmentsRegistry(registryRaw);
		} catch (err) {
			return { error: err instanceof Error ? err.message : String(err) };
		}
		const lifecycleRaw = await this.fs.readFileUtf8(joinPath(this.root, LIFECYCLE_PATH));
		let lifecycle: LifecycleEnvelope;
		if (lifecycleRaw === undefined || lifecycleRaw.trim().length === 0) {
			// a missing lifecycle file loads as the empty envelope (the manager's own posture)
			lifecycle = { schemaVersion: 0, schema: LIFECYCLE_SCHEMA_ID, updatedAt: 0, entries: {} };
		} else {
			try {
				lifecycle = parseLifecycleEnvelope(lifecycleRaw);
			} catch (err) {
				return { error: err instanceof Error ? err.message : String(err) };
			}
		}
		const opsRaw = await this.fs.readFileUtf8(joinPath(this.root, OPS_PATH));
		const ops: EnvironmentOpRecord[] = [];
		let opsSkipped = 0;
		if (opsRaw !== undefined && opsRaw.trim().length > 0) {
			const lines = opsRaw.split('\n');
			const body = lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines;
			for (const line of body) {
				if (line.trim().length === 0) {
					opsSkipped++;
					continue;
				}
				const parsed = parseOpsLine(line);
				if (parsed.ok) {
					ops.push(parsed.record);
				} else {
					opsSkipped++;
				}
			}
		}
		return { registry, lifecycle, ops, opsSkipped };
	}

	private opPortForState(state: string): string {
		if (state === 'registered') {
			return 'flauz.env.create';
		}
		if (state === 'created' || state === 'failed' || state === 'stopped') {
			return 'flauz.env.start';
		}
		if (state === 'stopped/attached') {
			return 'flauz.env.detach';
		}
		if (state === 'starting' || state === 'running') {
			return 'flauz.env.attach';
		}
		return 'flauz.env.detach'; // running/attached
	}

	async acquire(taskId: string, environmentId: string, actor: LeaseProvenance): Promise<AcquisitionVerdict> {
		const state = await this.readState();
		if ('error' in state) {
			return { ok: false, code: 'STATE_UNREADABLE', message: state.error };
		}
		const entry = state.registry.environments.find(candidate => candidate.id === environmentId);
		if (entry === undefined) {
			return { ok: false, code: 'RESOURCE_ABSENT', message: `environment '${environmentId}' is not registered (the registry holds ${state.registry.environments.length} environment(s)) -- the lease binds a registered logical id` };
		}
		if (entry.trust.posture === 'untrusted') {
			return { ok: false, code: 'TRUST_REFUSED', message: `environment '${environmentId}' has trust posture 'untrusted' -- acquire is rejected fail-closed (re-register with a trusted posture or review the descriptor; SECURITY-MODEL 3.4; the gate belongs to the TL3 manager, enforced read-only here)` };
		}
		if (!entry.enabled) {
			return { ok: false, code: 'TRUST_REFUSED', message: `environment '${environmentId}' is disabled -- acquire is rejected (the TL3 manager's ENVIRONMENT_DISABLED gate, enforced read-only here; enable the descriptor first)` };
		}
		const lifecycleEntry = state.lifecycle.entries[environmentId];
		const lifecycleState = lifecycleEntry?.state ?? 'registered';
		if (lifecycleState === 'destroyed') {
			return { ok: false, code: 'RESOURCE_ABSENT', message: `environment '${environmentId}' is in lifecycle state 'destroyed' (terminal tombstone; the backing truth is gone) -- it cannot be leased` };
		}
		const version = lifecycleEntry?.updatedAt ?? entry.timing.updatedAt;
		const lastOp = lifecycleEntry === undefined ? undefined : state.ops.filter(op => op.environmentId === environmentId).slice(-1)[0];
		return {
			ok: true,
			surfaceSnapshot: { surfaces: [{ family: 'environment', version, surface: { kind: 'environment', descriptorId: entry.id, providerKind: entry.kind } }] },
			opPort: this.opPortForState(lifecycleState),
			...(lastOp !== undefined ? { notes: [`lifecycle state '${lifecycleState}'; last recorded op '${lastOp.op}' (${lastOp.result}) by ${lastOp.actor}${state.opsSkipped > 0 ? `; ${state.opsSkipped} ops line(s) skipped as invalid (typed skips)` : ''}`] } : {}),
		};
	}

	async release(taskId: string, environmentId: string, actor: LeaseProvenance): Promise<ReleaseVerdict> {
		const state = await this.readState();
		if ('error' in state) {
			return { ok: false, code: 'STATE_UNREADABLE', message: state.error };
		}
		const entry = state.registry.environments.find(candidate => candidate.id === environmentId);
		if (entry === undefined) {
			return { ok: false, code: 'RESOURCE_ABSENT', message: `environment '${environmentId}' is not registered (the obligation cannot be discharged against an unregistered id)` };
		}
		const lifecycleEntry = state.lifecycle.entries[environmentId];
		const lifecycleState = lifecycleEntry?.state ?? 'registered';
		const attached = lifecycleState.endsWith('/attached');
		const opPort = attached ? 'flauz.env.detach' : 'flauz.env.stop';
		if (lifecycleState === 'destroyed') {
			return { ok: true, outcome: 'closed-elsewhere', observed: `lifecycle shows environment '${environmentId}' destroyed (terminal tombstone) -- the obligation is discharged; no teardown is claimed`, opPort };
		}
		const effectNote = attached
			? `detaching via flauz.env.detach is the TL3 manager's call at runtime`
			: lifecycleState === 'running' || lifecycleState === 'starting'
				? `stopping via flauz.env.stop is the TL3 manager's call at runtime`
				: `environment is in state '${lifecycleState}' -- no teardown effect is required; ${opPort} is referenced as the owning port`;
		return { ok: true, outcome: 'clean', observed: `lifecycle shows environment '${environmentId}' in state '${lifecycleState}'; ${effectNote} (this adapter claims no teardown)`, opPort };
	}

	async verifySurface(taskId: string, environmentId: string, snapshot: LeaseSurfaceSnapshot): Promise<SurfaceCheckVerdict> {
		const state = await this.readState();
		if ('error' in state) {
			return { ok: false, code: 'STATE_UNREADABLE', message: state.error };
		}
		const entry = state.registry.environments.find(candidate => candidate.id === environmentId);
		if (entry === undefined) {
			return { ok: false, code: 'RESOURCE_ABSENT', message: `environment '${environmentId}' is not registered` };
		}
		const lifecycleEntry = state.lifecycle.entries[environmentId];
		const lifecycleState = lifecycleEntry?.state ?? 'registered';
		if (lifecycleState === 'destroyed') {
			return { ok: false, code: 'SURFACE_MISMATCH', message: `environment '${environmentId}' is in lifecycle state 'destroyed' -- the leased access surface no longer exists` };
		}
		const version = lifecycleEntry?.updatedAt ?? entry.timing.updatedAt;
		const current = { surfaces: [{ family: 'environment' as const, version, surface: { kind: 'environment', descriptorId: entry.id, providerKind: entry.kind } }] };
		const pinned = snapshot.surfaces.find(candidate => candidate.family === 'environment');
		if (pinned === undefined || canonicalJson(pinned.surface) !== canonicalJson(current.surfaces[0]!.surface)) {
			return { ok: false, code: 'SURFACE_MISMATCH', message: `environment '${environmentId}' changed surface identity since acquisition (pinned ${pinned === undefined ? '(no environment surface pinned)' : canonicalJson(pinned.surface)}, current ${canonicalJson(current.surfaces[0]!.surface)}) -- the provider kind of the leased environment changed` };
		}
		return { ok: true, current };
	}
}
