/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-S2 M1 - the execution-resource port (contract shapes, exact-key
 * validators, the acquisition transition table and the task-level failure
 * taxonomy).
 *
 * This module is the TL2-side ADDITIVE bridge between the durable
 * orchestration runtime (extensions/flauz-agent/core/*.mjs - the
 * flauz.orch.* envelopes and the run(idempotencyKey, spec) effect-sink
 * seam) and the EXISTING TL3 contracts:
 *
 *   - flauz-browser  BrowserSessionDescriptor ('flauz.browser-session/v0'),
 *                    the session journal ('flauz.browser-session-journal/v0')
 *                    and BrowserSessionManager (open/navigate/close/...).
 *   - flauz-environments  EnvironmentDescriptor ('flauz.environments/v0'),
 *                    the PIN-2 lifecycle envelopes and the
 *                    EnvironmentExecutor/EnvironmentLifecycleManager ports.
 *   - flauz-resources  ResourceRef ('flauz.resources/v0') - logical identity
 *                    ONLY (identity is NOT access), access surfaces and the
 *                    resources-ops provenance ledger.
 *   - flauz-environments continuityExec  'flauz.continuity-bundle/v0' +
 *                    'flauz.continuity-ops/v0' (export/restore/verify).
 *
 * Per the DL-32 sibling convention the TL3 vocabularies this bridge needs
 * are CONTRACT-DUPLICATED as closed TypeScript types (never imported from
 * the TL3 extensions) and pinned against the fixtures the TL3 lanes ship
 * under test/fixtures/ (browser-session-journal, environments-lifecycle,
 * resources/contracts, continuity). The ADAPTERS (src/adapters.ts) accept
 * structurally-typed PORTS that the real TL3 managers satisfy; the tests
 * wire the REAL implementations, so any TL3 contract drift fails loudly at
 * the typecheck or at the behavior assertions - no silent reinterpretation.
 *
 * Everything here is PURE: no Node import, no vscode import. It runs
 * identically under `node --test` and inside the extension host.
 */

// ---------------------------------------------------------------------------
// Envelope ids (the additive sibling artifact - never a reinterpretation of
// a TL3 or TL2-Worker-A envelope)
// ---------------------------------------------------------------------------

/** Journal row schema id (the additive TL2-S2 sibling envelope). */
export const EXEC_JOURNAL_SCHEMA_ID = 'flauz.execution-journal/v0';

/** The only schemaVersion this module understands (fail-closed on others). */
export const EXEC_SCHEMA_VERSION = 0;

/** Directory (relative to the workspace root) holding execution state. */
export const EXEC_DIR = '.flauz/execution';

/** The append-only journal path, relative to the workspace root. */
export const EXEC_JOURNAL_PATH = '.flauz/execution/journal.jsonl';

// ---------------------------------------------------------------------------
// Resource identity law (ResourceRef: IDENTITY IS NOT ACCESS)
// ---------------------------------------------------------------------------

/** The three execution-resource classes this bridge serves (v0, closed). */
export const RESOURCE_CLASSES = ['browser-session', 'environment', 'logical-resource'] as const;
export type ExecutionResourceClass = (typeof RESOURCE_CLASSES)[number];

/**
 * The flauz-resources RESOURCE_KINDS vocabulary, CONTRACT-DUPLICATED
 * (DL-32; pinned by test/fixtures/resources/). The logical identity of a
 * resource is its URN; the access surface is resolved SEPARATELY at
 * execution time through the ResourceGraph.
 */
export const RESOURCE_KINDS = [
	'file', 'directory', 'task', 'agent-session', 'browser-session', 'environment',
	'artifact', 'evidence', 'model', 'provider', 'workflow', 'workspace',
] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

/** Canonical URN namespace per kind (contract-duplicated, flauz-resources). */
export const KIND_NAMESPACES: Readonly<Record<ResourceKind, string>> = {
	file: 'file',
	directory: 'directory',
	task: 'task',
	'agent-session': 'agent',
	'browser-session': 'browser',
	environment: 'environment',
	artifact: 'artifact',
	evidence: 'evidence',
	model: 'model',
	provider: 'provider',
	workflow: 'workflow',
	workspace: 'workspace',
};

/** The URN grammar (contract-duplicated: 16 lowercase hex or a bounded slug). */
const URN_PATTERN = /^flauz:([a-z][a-z0-9-]*):([0-9a-f]{16}|[A-Za-z0-9][A-Za-z0-9._-]{0,63})$/;

/** Browser-session id pattern (flauz-browser pin): flauz:browser:<16-hex>. */
const BROWSER_SESSION_ID_PATTERN = /^flauz:browser:[0-9a-f]{16}$/;

/** flauz-environments descriptor id pattern (contract-duplicated). */
const ENVIRONMENT_ID_PATTERN = /^env-[a-z0-9][a-z0-9-]{0,47}$/;

/** flauz-workspace task-id pattern (contract-duplicated). */
const TASK_ID_PATTERN = /^T-\d{3,}$/;

/** Acquisition id grammar: a LOGICAL id, never a path/URL/handle. */
export const ACQUISITION_ID_PATTERN = /^flauz:exec:[0-9a-f]{16}$/;

/** Durable graph id (contract-duplicated from the orchestration core). */
const GRAPH_ID_PATTERN = /^G-\d{3,}$/;

/** Durable step id (contract-duplicated from the orchestration core). */
const STEP_ID_PATTERN = /^S-\d{2,}$/;

/** Orchestration journal row id (R-NNNNNN, contract-duplicated). */
const ORCH_ROW_ID_PATTERN = /^R-\d{6,}$/;

/** Orchestration lease id (L-NNN-NN-N, contract-duplicated). */
const ORCH_LEASE_ID_PATTERN = /^L-\d{3,}-\d{2,}-\d{1,}$/;

const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * The identity of ONE execution resource targeted by a durable task step:
 * class + ResourceRef kind + URN id. NEVER a raw handle (no CDP target id,
 * no pid, no path, no endpoint) - the access surface is resolved at
 * execution time and recorded as hand-off metadata.
 */
export interface ExecutionResourceRef {
	readonly resourceClass: ExecutionResourceClass;
	readonly kind: ResourceKind;
	readonly id: string;
}

/** Class/kind legality: browser sessions and environments are distinct classes. */
export function classForKind(kind: ResourceKind): ExecutionResourceClass {
	if (kind === 'browser-session') {
		return 'browser-session';
	}
	if (kind === 'environment') {
		return 'environment';
	}
	return 'logical-resource';
}

/** Validates an ExecutionResourceRef (fail-closed; the id must be a URN in the kind namespace). */
export function validateExecutionResourceRef(value: unknown): { ok: true; ref: ExecutionResourceRef } | { ok: false; error: string } {
	if (!isPlainObject(value)) {
		return { ok: false, error: 'execution resource ref must be a JSON object {resourceClass, kind, id}' };
	}
	if (!hasExactKeys(value, ['resourceClass', 'kind', 'id'])) {
		return { ok: false, error: 'execution resource ref must have exactly the keys [id, kind, resourceClass]' };
	}
	const resourceClass = value.resourceClass as string;
	const kind = value.kind as string;
	const id = value.id as string;
	if (!RESOURCE_CLASSES.includes(resourceClass as ExecutionResourceClass)) {
		return { ok: false, error: `execution resource ref resourceClass must be one of ${RESOURCE_CLASSES.join(' | ')} (got ${JSON.stringify(resourceClass)})` };
	}
	if (!RESOURCE_KINDS.includes(kind as ResourceKind)) {
		return { ok: false, error: `execution resource ref kind must be one of the flauz-resources RESOURCE_KINDS (got ${JSON.stringify(kind)})` };
	}
	if (classForKind(kind as ResourceKind) !== resourceClass) {
		return { ok: false, error: `execution resource ref kind ${JSON.stringify(kind)} belongs to class ${JSON.stringify(classForKind(kind as ResourceKind))} (got ${JSON.stringify(resourceClass)})` };
	}
	const match = URN_PATTERN.exec(id);
	if (match === null) {
		return { ok: false, error: `execution resource ref id must be a URN flauz:<namespace>:<16-hex-or-slug> (got ${JSON.stringify(id)})` };
	}
	if (match[1] !== KIND_NAMESPACES[kind as ResourceKind]) {
		return { ok: false, error: `execution resource ref id ${JSON.stringify(id)} is not in the canonical namespace for kind '${String(kind)}' (expected flauz:${KIND_NAMESPACES[kind as ResourceKind]}:...)` };
	}
	if (resourceClass === 'browser-session' && !BROWSER_SESSION_ID_PATTERN.test(id)) {
		return { ok: false, error: `browser-session ref id must be exactly flauz:browser:<16-hex> (got ${JSON.stringify(id)})` };
	}
	if (resourceClass === 'environment' && !ENVIRONMENT_ID_PATTERN.test(id.split(':')[2] ?? '')) {
		return { ok: false, error: `environment ref local part must match env-<slug> (got ${JSON.stringify(id)})` };
	}
	return { ok: true, ref: { resourceClass: resourceClass as ExecutionResourceClass, kind: kind as ResourceKind, id } };
}

// ---------------------------------------------------------------------------
// Contract-duplicated TL3 vocabularies (closed; pinned by fixtures)
// ---------------------------------------------------------------------------

/** flauz-browser session states (BrowserSessionDescriptor.state). */
export const BROWSER_SESSION_STATES = ['opening', 'active', 'suspended', 'closed', 'failed'] as const;
export type BrowserSessionState = (typeof BROWSER_SESSION_STATES)[number];

/** flauz-environments provider kinds (ENVIRONMENT_KINDS). */
export const ENVIRONMENT_PROVIDER_KINDS = ['ssh-local', 'container', 'cloud-sandbox', 'workspace-remote'] as const;
export type EnvironmentProviderKind = (typeof ENVIRONMENT_PROVIDER_KINDS)[number];

/** flauz-environments trust postures. */
export const TRUST_POSTURES = ['trusted', 'untrusted', 'unknown'] as const;
export type TrustPosture = (typeof TRUST_POSTURES)[number];

/** flauz-environments lifecycle states (phases + the /attached substates). */
export const LIFECYCLE_STATES = [
	'registered', 'created', 'starting', 'running', 'stopping', 'stopped', 'destroyed', 'failed',
	'running/attached', 'stopped/attached',
] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

/** flauz-resources surface families (the per-family access surfaces). */
export const SURFACE_FAMILIES = ['file-system', 'browser', 'environment', 'model', 'task', 'artifact', 'workspace'] as const;
export type SurfaceFamily = (typeof SURFACE_FAMILIES)[number];

/** flauz-environments continuity bundle ids: flauz:continuity:<16-hex>. */
const CONTINUITY_BUNDLE_ID_PATTERN = /^flauz:continuity:[0-9a-f]{16}$/;

// ---------------------------------------------------------------------------
// Hand-off metadata: the access-surface snapshot recorded at execution time
// ---------------------------------------------------------------------------

/**
 * The browser access surface a step acquired, snapshotted from the REAL
 * BrowserSessionDescriptor the manager returned. The CDP target ids are
 * deliberately ABSENT (ephemeral, reconciled by the manager); the logical
 * ids + partition + policy source ref are the durable hand-off facts.
 */
export interface BrowserSurfaceSnapshot {
	readonly resourceClass: 'browser-session';
	readonly sessionId: string;
	readonly initiator: 'agent' | 'human';
	readonly partition: string;
	readonly state: BrowserSessionState;
	readonly tabIds: readonly string[];
	/** The policy audit handle the session was opened under (flauz-browser policySourceRefOf). */
	readonly policySourceRef: string;
}

/**
 * The environment access surface a step acquired: the registry descriptor
 * id, the executor that owns the backing truth, its honesty label and the
 * trust posture the acquisition was gated on.
 */
export interface EnvironmentSurfaceSnapshot {
	readonly resourceClass: 'environment';
	readonly descriptorId: string;
	readonly providerKind: EnvironmentProviderKind;
	readonly lifecycleState: LifecycleState;
	readonly executorKind: string;
	readonly infrastructureClass: 'real' | 'simulated';
	readonly trustPosture: TrustPosture;
	/** The attach lease id when the acquisition attached (executor attach detail). */
	readonly attachLeaseId?: string;
}

/**
 * The logical-resource access surface: the flauz-resources Surface VERBATIM
 * (the versioned per-family record from the ResourceGraph - the exact
 * flauz-resources key sets, contract-duplicated). Secrets never appear:
 * the ResourceGraph rejects literal secret surfaces and this journal
 * re-rejects them (defense in depth, validateLogicalSurface).
 */
export type LogicalSurface =
	| { readonly kind: 'file-system'; readonly root: string; readonly path: string; readonly contentSha256?: string }
	| { readonly kind: 'browser'; readonly cdpEndpoint?: string; readonly partition?: string; readonly tabIds?: readonly string[] }
	| { readonly kind: 'environment'; readonly descriptorId: string; readonly providerKind: EnvironmentProviderKind; readonly attachTarget?: string }
	| { readonly kind: 'model'; readonly providerId: string; readonly modelId: string }
	| { readonly kind: 'task'; readonly envelopePath: string; readonly taskId: string }
	| { readonly kind: 'artifact'; readonly uri: string; readonly sha256: string }
	| { readonly kind: 'workspace'; readonly root: string };

export interface LogicalSurfaceSnapshot {
	readonly resourceClass: 'logical-resource';
	readonly refId: string;
	readonly family: SurfaceFamily;
	readonly surface: LogicalSurface;
}

export type SurfaceSnapshot = BrowserSurfaceSnapshot | EnvironmentSurfaceSnapshot | LogicalSurfaceSnapshot;

function validateBrowserSurfaceSnapshot(value: Record<string, unknown>): string | undefined {
	if (!hasExactKeys(value, ['resourceClass', 'sessionId', 'initiator', 'partition', 'state', 'tabIds', 'policySourceRef'])) {
		return 'browser surface snapshot must have exactly the keys [initiator, partition, policySourceRef, resourceClass, sessionId, state, tabIds]';
	}
	if (value.resourceClass !== 'browser-session') {
		return `browser surface snapshot resourceClass must be 'browser-session' (got ${JSON.stringify(value.resourceClass)})`;
	}
	if (!BROWSER_SESSION_ID_PATTERN.test(String(value.sessionId))) {
		return `browser surface snapshot sessionId must be flauz:browser:<16-hex> (got ${JSON.stringify(value.sessionId)})`;
	}
	if (value.initiator !== 'agent' && value.initiator !== 'human') {
		return `browser surface snapshot initiator must be 'agent' | 'human' (got ${JSON.stringify(value.initiator)})`;
	}
	if (!isNonEmptyString(value.partition)) {
		return 'browser surface snapshot partition must be a non-empty string';
	}
	if (!BROWSER_SESSION_STATES.includes(value.state as BrowserSessionState)) {
		return `browser surface snapshot state must be one of ${BROWSER_SESSION_STATES.join(' | ')} (got ${JSON.stringify(value.state)})`;
	}
	if (!Array.isArray(value.tabIds) || !value.tabIds.every((tabId) => typeof tabId === 'string' && /^flauz:tab:[0-9a-f]{16}$/.test(tabId))) {
		return 'browser surface snapshot tabIds must be an array of flauz:tab:<16-hex> logical tab ids';
	}
	if (!isNonEmptyString(value.policySourceRef)) {
		return 'browser surface snapshot policySourceRef must be a non-empty string (the flauz-browser policy audit handle)';
	}
	return undefined;
}

function validateEnvironmentSurfaceSnapshot(value: Record<string, unknown>): string | undefined {
	if (!hasOnlyKeys(value, ['resourceClass', 'descriptorId', 'providerKind', 'lifecycleState', 'executorKind', 'infrastructureClass', 'trustPosture'], ['attachLeaseId'])) {
		return 'environment surface snapshot must have only the keys [attachLeaseId?, descriptorId, executorKind, infrastructureClass, lifecycleState, providerKind, resourceClass, trustPosture]';
	}
	if (value.resourceClass !== 'environment') {
		return `environment surface snapshot resourceClass must be 'environment' (got ${JSON.stringify(value.resourceClass)})`;
	}
	if (!ENVIRONMENT_ID_PATTERN.test(String(value.descriptorId))) {
		return `environment surface snapshot descriptorId must be an env-<slug> registry id (got ${JSON.stringify(value.descriptorId)})`;
	}
	if (!ENVIRONMENT_PROVIDER_KINDS.includes(value.providerKind as EnvironmentProviderKind)) {
		return `environment surface snapshot providerKind must be one of ${ENVIRONMENT_PROVIDER_KINDS.join(' | ')}`;
	}
	if (!LIFECYCLE_STATES.includes(value.lifecycleState as LifecycleState)) {
		return `environment surface snapshot lifecycleState must be one of ${LIFECYCLE_STATES.join(' | ')} (got ${JSON.stringify(value.lifecycleState)})`;
	}
	if (!isNonEmptyString(value.executorKind)) {
		return 'environment surface snapshot executorKind must be a non-empty string';
	}
	if (value.infrastructureClass !== 'real' && value.infrastructureClass !== 'simulated') {
		return `environment surface snapshot infrastructureClass must be 'real' | 'simulated' (got ${JSON.stringify(value.infrastructureClass)})`;
	}
	if (!TRUST_POSTURES.includes(value.trustPosture as TrustPosture)) {
		return `environment surface snapshot trustPosture must be one of ${TRUST_POSTURES.join(' | ')}`;
	}
	if (value.attachLeaseId !== undefined && !isNonEmptyString(value.attachLeaseId)) {
		return 'environment surface snapshot attachLeaseId must be a non-empty string when present';
	}
	return undefined;
}

const LOGICAL_SURFACE_KINDS = ['file-system', 'browser', 'environment', 'model', 'task', 'artifact', 'workspace'] as const;

export function validateLogicalSurface(surface: unknown): string | undefined {
	if (!isPlainObject(surface)) {
		return 'logical surface snapshot surface must be a JSON object (a flauz-resources Surface)';
	}
	const kind = surface.kind as string;
	if (!LOGICAL_SURFACE_KINDS.includes(kind as (typeof LOGICAL_SURFACE_KINDS)[number])) {
		return `logical surface kind must be one of ${LOGICAL_SURFACE_KINDS.join(' | ')} (got ${JSON.stringify(kind)})`;
	}
	switch (kind) {
		case 'file-system':
			if (!hasOnlyKeys(surface, ['kind', 'root', 'path'], ['contentSha256'])) {
				return "logical surface 'file-system' must have only the keys [contentSha256?, kind, path, root]";
			}
			if (!isNonEmptyString(surface.root) || !isNonEmptyString(surface.path)) {
				return "logical surface 'file-system' root/path must be non-empty strings";
			}
			if (surface.contentSha256 !== undefined && !SHA256_HEX.test(String(surface.contentSha256))) {
				return "logical surface 'file-system' contentSha256 must be 64 lowercase hex chars";
			}
			return undefined;
		case 'browser':
			if (!hasOnlyKeys(surface, ['kind'], ['cdpEndpoint', 'partition', 'tabIds'])) {
				return "logical surface 'browser' must have only the keys [cdpEndpoint?, kind, partition?, tabIds?]";
			}
			if (surface.cdpEndpoint !== undefined && !isNonEmptyString(surface.cdpEndpoint)) {
				return "logical surface 'browser' cdpEndpoint must be a non-empty string when present";
			}
			if (surface.partition !== undefined && !isNonEmptyString(surface.partition)) {
				return "logical surface 'browser' partition must be a non-empty string when present";
			}
			if (surface.tabIds !== undefined && (!Array.isArray(surface.tabIds) || !surface.tabIds.every((tabId) => isNonEmptyString(tabId)))) {
				return "logical surface 'browser' tabIds must be an array of strings when present";
			}
			return undefined;
		case 'environment':
			if (!hasOnlyKeys(surface, ['kind', 'descriptorId', 'providerKind'], ['attachTarget'])) {
				return "logical surface 'environment' must have only the keys [attachTarget?, descriptorId, kind, providerKind]";
			}
			if (!ENVIRONMENT_ID_PATTERN.test(String(surface.descriptorId))) {
				return "logical surface 'environment' descriptorId must be an env-<slug> registry id";
			}
			if (!ENVIRONMENT_PROVIDER_KINDS.includes(surface.providerKind as EnvironmentProviderKind)) {
				return "logical surface 'environment' providerKind must be a flauz-environments kind";
			}
			if (surface.attachTarget !== undefined && !isNonEmptyString(surface.attachTarget)) {
				return "logical surface 'environment' attachTarget must be a non-empty string when present";
			}
			return undefined;
		case 'model':
			if (!hasExactKeys(surface, ['kind', 'providerId', 'modelId'])) {
				return "logical surface 'model' must have exactly the keys [kind, modelId, providerId]";
			}
			if (!isNonEmptyString(surface.providerId) || !isNonEmptyString(surface.modelId)) {
				return "logical surface 'model' providerId/modelId must be non-empty strings";
			}
			return undefined;
		case 'task':
			if (!hasExactKeys(surface, ['kind', 'envelopePath', 'taskId'])) {
				return "logical surface 'task' must have exactly the keys [envelopePath, kind, taskId]";
			}
			if (!isNonEmptyString(surface.envelopePath)) {
				return "logical surface 'task' envelopePath must be a non-empty string";
			}
			if (!TASK_ID_PATTERN.test(String(surface.taskId))) {
				return "logical surface 'task' taskId must match /^T-\\d{3,}$/";
			}
			return undefined;
		case 'artifact':
			if (!hasExactKeys(surface, ['kind', 'uri', 'sha256'])) {
				return "logical surface 'artifact' must have exactly the keys [kind, sha256, uri]";
			}
			if (!isNonEmptyString(surface.uri) || !SHA256_HEX.test(String(surface.sha256))) {
				return "logical surface 'artifact' uri must be non-empty and sha256 64 lowercase hex chars";
			}
			return undefined;
		case 'workspace':
			if (!hasExactKeys(surface, ['kind', 'root'])) {
				return "logical surface 'workspace' must have exactly the keys [kind, root]";
			}
			if (!isNonEmptyString(surface.root)) {
				return "logical surface 'workspace' root must be a non-empty string";
			}
			return undefined;
	}
	return `logical surface kind ${JSON.stringify(kind)} has no validator (impossible)`;
}

/** The surface families a LOGICAL-resource ref may resolve (browser/environment families belong to their own classes). */
export const LOGICAL_SURFACE_FAMILIES = ['file-system', 'task', 'model', 'artifact', 'workspace'] as const;
export type LogicalSurfaceFamily = (typeof LOGICAL_SURFACE_FAMILIES)[number];

/** Family -> the ResourceKind namespaces whose refs may carry it (v0 closed matrix). */
const FAMILY_KINDS: Readonly<Record<LogicalSurfaceFamily, readonly ResourceKind[]>> = {
	'file-system': ['file', 'directory'],
	task: ['task'],
	model: ['model', 'provider'],
	artifact: ['artifact', 'evidence'],
	workspace: ['workspace'],
};

function validateLogicalSurfaceSnapshot(value: Record<string, unknown>): string | undefined {
	if (!hasExactKeys(value, ['resourceClass', 'refId', 'family', 'surface'])) {
		return 'logical surface snapshot must have exactly the keys [family, refId, resourceClass, surface]';
	}
	if (value.resourceClass !== 'logical-resource') {
		return `logical surface snapshot resourceClass must be 'logical-resource' (got ${JSON.stringify(value.resourceClass)})`;
	}
	if (typeof value.refId !== 'string' || !URN_PATTERN.test(value.refId)) {
		return `logical surface snapshot refId must be a URN (got ${JSON.stringify(value.refId)})`;
	}
	if (!LOGICAL_SURFACE_FAMILIES.includes(value.family as LogicalSurfaceFamily)) {
		return `logical surface snapshot family must be one of ${LOGICAL_SURFACE_FAMILIES.join(' | ')} (browser/environment families belong to their own resource classes) (got ${JSON.stringify(value.family)})`;
	}
	const namespace = value.refId.split(':')[1];
	const allowedKinds = FAMILY_KINDS[value.family as LogicalSurfaceFamily];
	const kindOfNamespace = Object.entries(KIND_NAMESPACES).filter(([, ns]) => ns === namespace).map(([kind]) => kind as ResourceKind);
	if (!kindOfNamespace.some((kind) => allowedKinds.includes(kind))) {
		return `logical surface snapshot refId ${JSON.stringify(value.refId)} (namespace '${String(namespace)}') is not a legal kind for family '${String(value.family)}' (allowed kinds: ${allowedKinds.join(' | ')})`;
	}
	return validateLogicalSurface(value.surface);
}

/** Validates a SurfaceSnapshot (per class). */
export function validateSurfaceSnapshot(value: unknown): { ok: true; snapshot: SurfaceSnapshot } | { ok: false; error: string } {
	if (!isPlainObject(value)) {
		return { ok: false, error: 'surface snapshot must be a JSON object' };
	}
	const resourceClass = value.resourceClass;
	if (resourceClass === 'browser-session') {
		const error = validateBrowserSurfaceSnapshot(value);
		return error === undefined ? { ok: true, snapshot: value as unknown as BrowserSurfaceSnapshot } : { ok: false, error };
	}
	if (resourceClass === 'environment') {
		const error = validateEnvironmentSurfaceSnapshot(value);
		return error === undefined ? { ok: true, snapshot: value as unknown as EnvironmentSurfaceSnapshot } : { ok: false, error };
	}
	if (resourceClass === 'logical-resource') {
		const error = validateLogicalSurfaceSnapshot(value);
		return error === undefined ? { ok: true, snapshot: value as unknown as LogicalSurfaceSnapshot } : { ok: false, error };
	}
	return { ok: false, error: `surface snapshot resourceClass must be one of ${RESOURCE_CLASSES.join(' | ')} (got ${JSON.stringify(resourceClass)})` };
}

// ---------------------------------------------------------------------------
// The journal row contract (flauz.execution-journal/v0)
// ---------------------------------------------------------------------------

/** Journal row actors (the orchestration vocabulary incl. 'service'). */
export const EXEC_ACTORS = ['human', 'agent', 'tool', 'service'] as const;
export type ExecActor = (typeof EXEC_ACTORS)[number];

/**
 * Every event type this journal records (v0, CLOSED list). Transition verbs
 * drive the acquisition state machine; every other row class is an
 * observational/coordination record that changes no acquisition state.
 */
export const EXEC_EVENT_TYPES = [
	'resource-acquired',
	'resource-released',
	'resource-lost',
	'resource-expired',
	'handoff-recorded',
	'acquire-denied',
	'session-reattached',
	'continuity-exported',
	'continuity-restored',
	'rollback-recorded',
	'recovery-scan',
	'effect-settled',
] as const;
export type ExecEventType = (typeof EXEC_EVENT_TYPES)[number];

/** The acquisition lifecycle states (replay projection, never persisted). */
export const ACQUISITION_STATES = ['acquired', 'lost', 'released', 'expired'] as const;
export type AcquisitionState = (typeof ACQUISITION_STATES)[number];

export const TERMINAL_ACQUISITION_STATES = ['released', 'expired'] as const;

/**
 * The acquisition transition table (the 9-transition-seam discipline):
 * legal source state FIRST, actor gate second. 'lost' is RECOVERABLE
 * (reattach/restore); 'released' and 'expired' are terminal. Release
 * accepts every actor: completion/rollback/expiry come from the executors
 * and sweeps, revocation is a human act.
 */
export const ACQUISITION_TRANSITIONS = [
	{ type: 'resource-acquired', from: [] as AcquisitionState[], actors: ['agent', 'tool', 'service'], to: 'acquired' as AcquisitionState },
	{ type: 'resource-released', from: ['acquired', 'lost'] as AcquisitionState[], actors: ['human', 'agent', 'tool', 'service'], to: 'released' as AcquisitionState },
	{ type: 'resource-lost', from: ['acquired'] as AcquisitionState[], actors: ['agent', 'tool', 'service'], to: 'lost' as AcquisitionState },
	{ type: 'resource-expired', from: ['acquired'] as AcquisitionState[], actors: ['service'], to: 'expired' as AcquisitionState },
	{ type: 'session-reattached', from: ['lost'] as AcquisitionState[], actors: ['agent', 'tool', 'service'], to: 'acquired' as AcquisitionState },
	{ type: 'continuity-restored', from: ['lost'] as AcquisitionState[], actors: ['agent', 'tool', 'service'], to: 'acquired' as AcquisitionState },
] as const;

export const ACQUISITION_TRANSITION_TYPES = ACQUISITION_TRANSITIONS.map((rule) => rule.type);

/** acquisitionId nullability per event type: acquisition-level (set) or aggregate (null). */
const EVENT_LEVELS: Readonly<Record<ExecEventType, 'acquisition' | 'aggregate'>> = {
	'resource-acquired': 'acquisition',
	'resource-released': 'acquisition',
	'resource-lost': 'acquisition',
	'resource-expired': 'acquisition',
	'handoff-recorded': 'acquisition',
	'acquire-denied': 'acquisition',
	'session-reattached': 'acquisition',
	'continuity-exported': 'aggregate',
	'continuity-restored': 'acquisition',
	'rollback-recorded': 'aggregate',
	'recovery-scan': 'aggregate',
	'effect-settled': 'acquisition',
};

/** The level of an event type (acquisition rows carry the acquisitionId). */
export function eventLevelOf(type: ExecEventType): 'acquisition' | 'aggregate' {
	return EVENT_LEVELS[type];
}

/** Exactly 15 fields per row (the orchestration 14-field discipline + acquisitionId). */
export const EXEC_JOURNAL_ROW_FIELDS = [
	'$schema', 'seq', 'ts', 'rowId', 'graphId', 'stepId', 'attempt', 'idempotencyKey',
	'acquisitionId', 'type', 'actor', 'origin', 'payload', 'contentHash', 'prev',
] as const;

/** Journal row ids follow the R-NNNNNN discipline with an X prefix (distinct namespace from the orchestration journal). */
export function execRowIdOf(seq: number): string {
	return `X-${String(seq).padStart(6, '0')}`;
}

// ---------------------------------------------------------------------------
// The task-level failure taxonomy (M2): typed execution failures and their
// MAPPING into the orchestration policy failure classes (policy.mjs) so the
// durable graph's retry policy consumes them without re-interpretation.
// ---------------------------------------------------------------------------

/** Typed execution-resource failure classes (task-level, closed v0 list). */
export const EXEC_FAILURE_CLASSES = [
	'acquire-denied',
	'use-denied',
	'resource-lost',
	'executor-death',
	'acquire-timeout',
	'surface-unresolved',
	'invalid-request',
] as const;
export type ExecFailureClass = (typeof EXEC_FAILURE_CLASSES)[number];

/** The orchestration failure-class vocabulary (contract-duplicated from core/policy.mjs). */
export const ORCH_FAILURE_CLASSES = [
	'invalid-input', 'approval-denied', 'policy-violation', 'not-implemented', 'permanent',
	'transient', 'timeout', 'unavailable', 'dependency-failure', 'unknown-default',
] as const;
export type OrchFailureClass = (typeof ORCH_FAILURE_CLASSES)[number];

export const ORCH_TERMINAL_FAILURE_CLASSES = ['invalid-input', 'approval-denied', 'policy-violation', 'not-implemented', 'permanent'] as const;

/**
 * The mapping law: acquire-denied maps to the TERMINAL 'policy-violation'
 * class - fail-closed gates stay authoritative and are NEVER retried;
 * resource/executor failures map to retryable classes so the graph's retry
 * policy re-acquires on the next attempt.
 */
export const EXEC_TO_ORCH_FAILURE_CLASS: Readonly<Record<ExecFailureClass, OrchFailureClass>> = {
	'acquire-denied': 'policy-violation',
	'use-denied': 'policy-violation',
	'resource-lost': 'unavailable',
	'executor-death': 'dependency-failure',
	'acquire-timeout': 'timeout',
	'surface-unresolved': 'invalid-input',
	'invalid-request': 'invalid-input',
};

/** Maps an execution failure class onto the orchestration retry vocabulary. */
export function toOrchFailureClass(execClass: ExecFailureClass): OrchFailureClass {
	return EXEC_TO_ORCH_FAILURE_CLASS[execClass];
}

/** Typed execution failure (the journal + adapter result arm). */
export interface ExecFailure {
	readonly failureClass: ExecFailureClass;
	readonly message: string;
	/** The gate that denied (acquire-denied only): browser-policy | environment-trust | graph-state | resource-graph | invalid-request. */
	readonly gate?: ExecDenialGate;
	/** Digest of the authoritative verdict (policy verdict / trust posture), when the gate produced one. */
	readonly verdictDigest?: string;
}

/** The deny gates (fail-closed authorities that can reject an acquisition). */
export const EXEC_DENIAL_GATES = ['browser-policy', 'environment-trust', 'graph-state', 'resource-graph', 'invalid-request'] as const;
export type ExecDenialGate = (typeof EXEC_DENIAL_GATES)[number];

// ---------------------------------------------------------------------------
// Canonical JSON (the DL-9 discipline - local pure copy, same bytes as the
// sibling extensions) + hashing helpers
// ---------------------------------------------------------------------------

/** Canonical JSON: keys sorted recursively, no insignificant whitespace, undefined dropped. */
export function canonicalJson(value: unknown): string {
	if (value === null || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return '[' + value.map(canonicalJson).join(',') + ']';
	}
	if (typeof value === 'object') {
		const record = value as Record<string, unknown>;
		const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort();
		return '{' + keys.map((key) => JSON.stringify(key) + ':' + canonicalJson(record[key])).join(',') + '}';
	}
	throw new Error(`${EXEC_JOURNAL_SCHEMA_ID}: cannot canonicalize value of type ${typeof value} (payloads must be JSON-safe)`);
}

// ---------------------------------------------------------------------------
// Payload validation per event type (exact key sets; unknown keys rejected)
// ---------------------------------------------------------------------------

const RELEASE_KINDS = ['completion', 'rollback', 'expiry', 'revocation'] as const;
const LOSS_DETECTORS = ['manager-report', 'probe', 'effect-failure'] as const;
const POLICY_RECHECKS = ['pass', 'fail', 'not-applicable'] as const;

/**
 * Validates the payload of one journal row by event type. Every rule here
 * is violated by at least one bad fixture (test/fixtures/execution/bad).
 */
export function validateExecPayload(type: ExecEventType, payload: unknown): string | undefined {
	if (!isPlainObject(payload)) {
		return `journal ${type} payload must be a JSON object`;
	}
	const label = `journal ${type}`;
	switch (type) {
		case 'resource-acquired': {
			if (!hasOnlyKeys(payload, ['purpose', 'resource'], ['lease', 'note'])) {
				return `${label} payload must have only the keys [lease?, note?, purpose, resource]`;
			}
			if (!isNonEmptyString(payload.purpose)) {
				return `${label} payload purpose must be a non-empty string (why the step needs the resource)`;
			}
			const refVerdict = validateExecutionResourceRef(payload.resource);
			if (!refVerdict.ok) {
				return `${label} payload resource: ${refVerdict.error}`;
			}
			if (payload.lease !== undefined) {
				if (!isPlainObject(payload.lease) || !hasExactKeys(payload.lease, ['expiresAt', 'leaseId', 'holder'])) {
					return `${label} payload lease must have exactly the keys [expiresAt, holder, leaseId]`;
				}
				if (!ORCH_LEASE_ID_PATTERN.test(String(payload.lease.leaseId))) {
					return `${label} payload lease.leaseId must match /^L-\\d{3,}-\\d{2,}-\\d{1,}$/ (the orchestration journal lease reference)`;
				}
				if (!isNonEmptyString(payload.lease.holder)) {
					return `${label} payload lease.holder must be a non-empty agent id`;
				}
				if (!isPositiveInteger(payload.lease.expiresAt)) {
					return `${label} payload lease.expiresAt must be a positive epoch-ms integer`;
				}
			}
			if (payload.note !== undefined && !isNonEmptyString(payload.note)) {
				return `${label} payload note must be a non-empty string when present`;
			}
			return undefined;
		}
		case 'resource-released': {
			if (!hasOnlyKeys(payload, ['releaseKind'], ['note'])) {
				return `${label} payload must have only the keys [note?, releaseKind]`;
			}
			if (!RELEASE_KINDS.includes(payload.releaseKind as (typeof RELEASE_KINDS)[number])) {
				return `${label} payload releaseKind must be one of ${RELEASE_KINDS.join(' | ')} (got ${JSON.stringify(payload.releaseKind)})`;
			}
			if (payload.note !== undefined && !isNonEmptyString(payload.note)) {
				return `${label} payload note must be a non-empty string when present`;
			}
			return undefined;
		}
		case 'resource-lost': {
			if (!hasOnlyKeys(payload, ['detectedBy', 'failureClass', 'message'], [])) {
				return `${label} payload must have only the keys [detectedBy, failureClass, message]`;
			}
			if (!LOSS_DETECTORS.includes(payload.detectedBy as (typeof LOSS_DETECTORS)[number])) {
				return `${label} payload detectedBy must be one of ${LOSS_DETECTORS.join(' | ')}`;
			}
			if (!EXEC_FAILURE_CLASSES.includes(payload.failureClass as ExecFailureClass)) {
				return `${label} payload failureClass must be one of ${EXEC_FAILURE_CLASSES.join(' | ')} (got ${JSON.stringify(payload.failureClass)})`;
			}
			if (typeof payload.message !== 'string') {
				return `${label} payload message must be a string`;
			}
			return undefined;
		}
		case 'resource-expired': {
			if (!hasExactKeys(payload, ['expiresAt', 'expiredAt'])) {
				return `${label} payload must have exactly the keys [expiredAt, expiresAt]`;
			}
			if (!isPositiveInteger(payload.expiresAt) || !isPositiveInteger(payload.expiredAt)) {
				return `${label} payload expiresAt/expiredAt must be positive epoch-ms integers`;
			}
			return undefined;
		}
		case 'handoff-recorded': {
			if (!hasExactKeys(payload, ['surface', 'surfaceDigest'])) {
				return `${label} payload must have exactly the keys [surface, surfaceDigest]`;
			}
			const surfaceVerdict = validateSurfaceSnapshot(payload.surface);
			if (!surfaceVerdict.ok) {
				return `${label} payload surface: ${surfaceVerdict.error}`;
			}
			if (!SHA256_HEX.test(String(payload.surfaceDigest))) {
				return `${label} payload surfaceDigest must be 64 lowercase hex chars (sha256 of the canonical surface)`;
			}
			if (payload.surfaceDigest !== execSha256Hex(canonicalJson(payload.surface))) {
				return `${label} payload surfaceDigest does not match the canonical surface (content-hash linkage broken)`;
			}
			return undefined;
		}
		case 'acquire-denied': {
			if (!hasOnlyKeys(payload, ['gate', 'failureClass', 'message'], ['resource', 'verdictDigest'])) {
				return `${label} payload must have only the keys [failureClass, gate, message, resource, verdictDigest?]`;
			}
			if (payload.resource !== undefined) {
				const denialRefVerdict = validateExecutionResourceRef(payload.resource);
				if (!denialRefVerdict.ok) {
					return `${label} payload resource: ${denialRefVerdict.error}`;
				}
			}
			if (payload.failureClass !== 'acquire-denied') {
				return `${label} payload failureClass must be 'acquire-denied' (the denial row is the typed fail-closed record)`;
			}
			if (!EXEC_DENIAL_GATES.includes(payload.gate as ExecDenialGate)) {
				return `${label} payload gate must be one of ${EXEC_DENIAL_GATES.join(' | ')} (got ${JSON.stringify(payload.gate)})`;
			}
			if (typeof payload.message !== 'string') {
				return `${label} payload message must be a string`;
			}
			if (payload.verdictDigest !== undefined && !SHA256_HEX.test(String(payload.verdictDigest))) {
				return `${label} payload verdictDigest must be 64 lowercase hex chars when present`;
			}
			return undefined;
		}
		case 'session-reattached': {
			if (!hasOnlyKeys(payload, ['policyRecheck', 'surface', 'surfaceDigest'], ['note'])) {
				return `${label} payload must have only the keys [note?, policyRecheck, surface, surfaceDigest]`;
			}
			if (!POLICY_RECHECKS.includes(payload.policyRecheck as (typeof POLICY_RECHECKS)[number])) {
				return `${label} payload policyRecheck must be one of ${POLICY_RECHECKS.join(' | ')}`;
			}
			const surfaceVerdict = validateSurfaceSnapshot(payload.surface);
			if (!surfaceVerdict.ok) {
				return `${label} payload surface: ${surfaceVerdict.error}`;
			}
			if (!SHA256_HEX.test(String(payload.surfaceDigest)) || payload.surfaceDigest !== execSha256Hex(canonicalJson(payload.surface))) {
				return `${label} payload surfaceDigest must be the sha256 of the canonical surface`;
			}
			if (payload.note !== undefined && !isNonEmptyString(payload.note)) {
				return `${label} payload note must be a non-empty string when present`;
			}
			return undefined;
		}
		case 'continuity-exported': {
			if (!hasOnlyKeys(payload, ['bundleId', 'surfacesCarried', 'surfacesLost', 'surfacesRedacted'], ['environmentId', 'switchPlanRef'])) {
				return `${label} payload must have only the keys [bundleId, environmentId?, surfacesCarried, surfacesLost, surfacesRedacted, switchPlanRef?]`;
			}
			if (!CONTINUITY_BUNDLE_ID_PATTERN.test(String(payload.bundleId))) {
				return `${label} payload bundleId must be flauz:continuity:<16-hex> (got ${JSON.stringify(payload.bundleId)})`;
			}
			if (payload.environmentId !== undefined && !ENVIRONMENT_ID_PATTERN.test(String(payload.environmentId))) {
				return `${label} payload environmentId must be an env-<slug> id when present`;
			}
			if (!isNonNegativeInteger(payload.surfacesCarried) || !isNonNegativeInteger(payload.surfacesLost) || !isNonNegativeInteger(payload.surfacesRedacted)) {
				return `${label} payload surfaces* counts must be non-negative integers`;
			}
			if (payload.switchPlanRef !== undefined && !isNonEmptyString(payload.switchPlanRef)) {
				return `${label} payload switchPlanRef must be a non-empty string when present`;
			}
			return undefined;
		}
		case 'continuity-restored': {
			if (!hasOnlyKeys(payload, ['bundleId', 'authorizationRegated'], ['targetEnvironmentId', 'note'])) {
				return `${label} payload must have only the keys [authorizationRegated, bundleId, note?, targetEnvironmentId?]`;
			}
			if (!CONTINUITY_BUNDLE_ID_PATTERN.test(String(payload.bundleId))) {
				return `${label} payload bundleId must be flauz:continuity:<16-hex>`;
			}
			if (payload.targetEnvironmentId !== undefined && !ENVIRONMENT_ID_PATTERN.test(String(payload.targetEnvironmentId))) {
				return `${label} payload targetEnvironmentId must be an env-<slug> id when present`;
			}
			if (typeof payload.authorizationRegated !== 'boolean') {
				return `${label} payload authorizationRegated must be a boolean (the trust/policy re-gate evidence)`;
			}
			if (payload.note !== undefined && !isNonEmptyString(payload.note)) {
				return `${label} payload note must be a non-empty string when present`;
			}
			return undefined;
		}
		case 'rollback-recorded': {
			if (!hasExactKeys(payload, ['cause', 'releasedAcquisitionIds', 'coherent'])) {
				return `${label} payload must have exactly the keys [cause, coherent, releasedAcquisitionIds]`;
			}
			if (!isNonEmptyString(payload.cause)) {
				return `${label} payload cause must be a non-empty string`;
			}
			if (!Array.isArray(payload.releasedAcquisitionIds) || !payload.releasedAcquisitionIds.every((id) => ACQUISITION_ID_PATTERN.test(String(id)))) {
				return `${label} payload releasedAcquisitionIds must be an array of flauz:exec:<16-hex> ids`;
			}
			if (typeof payload.coherent !== 'boolean') {
				return `${label} payload coherent must be a boolean`;
			}
			return undefined;
		}
		case 'recovery-scan': {
			if (!hasExactKeys(payload, ['actions', 'clean'])) {
				return `${label} payload must have exactly the keys [actions, clean]`;
			}
			if (!Array.isArray(payload.actions) || !payload.actions.every((action) => typeof action === 'string' && action.length > 0)) {
				return `${label} payload actions must be an array of non-empty action strings`;
			}
			if (typeof payload.clean !== 'boolean') {
				return `${label} payload clean must be a boolean`;
			}
			return undefined;
		}
		case 'effect-settled': {
			if (!hasOnlyKeys(payload, ['outcome'], ['failureClass', 'message', 'note', 'valueDigest'])) {
				return `${label} payload must have only the keys [failureClass?, message?, note?, outcome, valueDigest?]`;
			}
			if (payload.outcome !== 'ok' && payload.outcome !== 'failed') {
				return `${label} payload outcome must be 'ok' | 'failed' (the idempotency-settled effect record)`;
			}
			if (payload.outcome === 'ok' && !SHA256_HEX.test(String(payload.valueDigest))) {
				return `${label} payload valueDigest must be 64 lowercase hex chars when outcome is 'ok'`;
			}
			if (payload.outcome === 'failed') {
				if (!EXEC_FAILURE_CLASSES.includes(payload.failureClass as ExecFailureClass)) {
					return `${label} payload failureClass must be one of ${EXEC_FAILURE_CLASSES.join(' | ')} when outcome is 'failed'`;
				}
				if (typeof payload.message !== 'string') {
					return `${label} payload message must be a string when outcome is 'failed'`;
				}
			}
			if (payload.valueDigest !== undefined && !SHA256_HEX.test(String(payload.valueDigest))) {
				return `${label} payload valueDigest must be 64 lowercase hex chars when present`;
			}
			if (payload.note !== undefined && !isNonEmptyString(payload.note)) {
				return `${label} payload note must be a non-empty string when present`;
			}
			return undefined;
		}
	}
	return `unknown journal event type '${String(type)}'`;
}

// ---------------------------------------------------------------------------
// The full row validation (the strict-load + append path share it)
// ---------------------------------------------------------------------------

/** One journal row (the exact 15-field shape). */
export interface ExecJournalRow {
	readonly $schema: typeof EXEC_JOURNAL_SCHEMA_ID;
	readonly seq: number;
	readonly ts: number;
	readonly rowId: string;
	/** The durable graph this row serves (null: standalone/aggregate rows). */
	readonly graphId: string | null;
	/** The step within the graph (null: aggregate rows). */
	readonly stepId: string | null;
	/** The step attempt (the re-drive ordinal). */
	readonly attempt: number | null;
	/** The orchestration idempotency key (flauz-orch/<G>/<S>/run/<attempt>). */
	readonly idempotencyKey: string | null;
	/** The acquisition this row belongs to (null: aggregate rows). */
	readonly acquisitionId: string | null;
	readonly type: ExecEventType;
	readonly actor: ExecActor;
	readonly origin: string;
	readonly payload: Record<string, unknown>;
	/** sha256 of the canonical payload (the content-hash linkage). */
	readonly contentHash: string;
	/** The previous row's full hash (seq 1 has null). */
	readonly prev: string | null;
}

/**
 * Full structural validation of one journal row: exactly 15 fields, id/seq
 * consistency, actor/origin shapes, event level vs acquisitionId, per-type
 * payload shape, contentHash correctness. Chain linkage (prev) and byte
 * canonicity are checked by the store (the caller with the whole journal).
 */
export function validateExecJournalRow(row: unknown): { ok: true; row: ExecJournalRow } | { ok: false; error: string } {
	if (!isPlainObject(row)) {
		return { ok: false, error: 'journal row must be a JSON object' };
	}
	if (!hasExactKeys(row, EXEC_JOURNAL_ROW_FIELDS)) {
		return { ok: false, error: `journal row must have exactly the ${String(EXEC_JOURNAL_ROW_FIELDS.length)} keys [${EXEC_JOURNAL_ROW_FIELDS.slice().sort().join(', ')}]` };
	}
	if (row.$schema !== EXEC_JOURNAL_SCHEMA_ID) {
		return { ok: false, error: `journal row $schema must be '${EXEC_JOURNAL_SCHEMA_ID}' (got ${JSON.stringify(row.$schema)})` };
	}
	if (!isPositiveInteger(row.seq) || !isPositiveInteger(row.ts)) {
		return { ok: false, error: `journal row ${String(row.rowId)}: seq/ts must be positive integers` };
	}
	if (row.rowId !== execRowIdOf(row.seq)) {
		return { ok: false, error: `journal row id must be '${execRowIdOf(row.seq)}' (derived from seq; got ${JSON.stringify(row.rowId)})` };
	}
	if (row.graphId !== null && !GRAPH_ID_PATTERN.test(String(row.graphId))) {
		return { ok: false, error: `journal row ${String(row.rowId)}: graphId must match /^G-\\d{3,}$/ or be null` };
	}
	if (row.stepId !== null && !STEP_ID_PATTERN.test(String(row.stepId))) {
		return { ok: false, error: `journal row ${String(row.rowId)}: stepId must match /^S-\\d{2,}$/ or be null` };
	}
	if (row.attempt !== null && !isPositiveInteger(row.attempt)) {
		return { ok: false, error: `journal row ${String(row.rowId)}: attempt must be a positive integer or null` };
	}
	if (row.idempotencyKey !== null && typeof row.idempotencyKey !== 'string') {
		return { ok: false, error: `journal row ${String(row.rowId)}: idempotencyKey must be a string or null` };
	}
	if (row.idempotencyKey !== null && !/^flauz-orch\/G-\d{3,}\/S-\d{2,}\/run\/\d{1,}$/.test(row.idempotencyKey)) {
		return { ok: false, error: `journal row ${String(row.rowId)}: idempotencyKey must follow the flauz-orch/<graphId>/<stepId>/run/<attempt> house pattern (got ${JSON.stringify(row.idempotencyKey)})` };
	}
	if (!EXEC_EVENT_TYPES.includes(row.type as ExecEventType)) {
		return { ok: false, error: `journal row ${String(row.rowId)}: unknown event type '${String(row.type)}'` };
	}
	if (!EXEC_ACTORS.includes(row.actor as ExecActor)) {
		return { ok: false, error: `journal row ${String(row.rowId)}: actor must be one of ${EXEC_ACTORS.join(' | ')} (got '${String(row.actor)}')` };
	}
	if (!isNonEmptyString(row.origin)) {
		return { ok: false, error: `journal row ${String(row.rowId)}: origin must be a non-empty provenance string` };
	}
	const level = eventLevelOf(row.type as ExecEventType);
	if (level === 'acquisition' && !ACQUISITION_ID_PATTERN.test(String(row.acquisitionId))) {
		return { ok: false, error: `journal row ${String(row.rowId)}: ${String(row.type)} is acquisition-level (acquisitionId must be flauz:exec:<16-hex>)` };
	}
	if (level === 'aggregate' && row.acquisitionId !== null) {
		return { ok: false, error: `journal row ${String(row.rowId)}: ${String(row.type)} is aggregate (acquisitionId must be null)` };
	}
	const payloadError = validateExecPayload(row.type as ExecEventType, row.payload);
	if (payloadError !== undefined) {
		return { ok: false, error: `journal row ${String(row.rowId)}: ${payloadError}` };
	}
	if (row.contentHash !== execSha256Hex(canonicalJson(row.payload))) {
		return { ok: false, error: `journal row ${String(row.rowId)}: contentHash does not match the canonical payload (content-hash linkage broken)` };
	}
	if (row.prev !== null && !SHA256_HEX.test(String(row.prev))) {
		return { ok: false, error: `journal row ${String(row.rowId)}: prev must be 64 lowercase hex chars or null` };
	}
	return { ok: true, row: row as unknown as ExecJournalRow };
}

/** Row hash: sha256 over the canonical row fields EXCEPT prev (the orch rowHashOf discipline). */
export function execRowHashOf(row: ExecJournalRow): string {
	const projected: Record<string, unknown> = {};
	for (const field of EXEC_JOURNAL_ROW_FIELDS) {
		if (field !== 'prev') {
			projected[field] = (row as unknown as Record<string, unknown>)[field];
		}
	}
	return execSha256Hex(canonicalJson(projected));
}

/** The canonical stored line (no trailing newline). */
export function execJournalLine(row: ExecJournalRow): string {
	return canonicalJson(row);
}

// ---------------------------------------------------------------------------
// The execution request (what a durable step's toolInput carries to target
// an execution resource - the M1 "what a step must record" answer)
// ---------------------------------------------------------------------------

/** Browser actions a step may drive through a BrowserSession. */
export const BROWSER_ACTIONS = ['open', 'navigate', 'close'] as const;
export type BrowserAction = (typeof BROWSER_ACTIONS)[number];

/** Environment ops a step may drive through the lifecycle manager. */
export const ENVIRONMENT_OPS = ['create', 'start', 'stop', 'attach', 'detach', 'snapshot', 'destroy'] as const;
export type EnvironmentOp = (typeof ENVIRONMENT_OPS)[number];

/** Logical-resource ops (read resolves the surface; mutate records provenance). */
export const LOGICAL_ACTIONS = ['resolve', 'mutate'] as const;
export type LogicalAction = (typeof LOGICAL_ACTIONS)[number];

/**
 * The execution request carried in a step's toolInput. The resource is
 * ALWAYS referenced by ResourceRef identity; the action names the intent;
 * class-specific fields ride alongside. NO raw handles, NO credentials
 * (secret values are rejected; vault refs pass through the resource graph).
 */
export interface ExecutionRequest {
	/**
	 * The targeted ResourceRef. REQUIRED for every action except the
	 * browser 'open' action, which may mint a FRESH session (the adapter
	 * registers the minted ref in the resource graph and the acquisition
	 * row records it). IDENTITY IS NOT ACCESS: the surface is resolved at
	 * execution time.
	 */
	readonly resource?: ExecutionResourceRef;
	readonly action: string;
	readonly url?: string;
	readonly tabId?: string;
	readonly environmentOp?: EnvironmentOp;
	readonly mutation?: Record<string, unknown>;
	readonly leaseTtlMs?: number;
	readonly purpose?: string;
}

/** Validates an execution request (the toolInput parse, fail-closed). */
export function validateExecutionRequest(value: unknown): { ok: true; request: ExecutionRequest } | { ok: false; error: string } {
	if (!isPlainObject(value)) {
		return { ok: false, error: 'execution request must be a JSON object (the step toolInput)' };
	}
	if (!hasOnlyKeys(value, ['action'], ['resource', 'url', 'tabId', 'environmentOp', 'mutation', 'leaseTtlMs', 'purpose'])) {
		return { ok: false, error: 'execution request must have only the keys [action, environmentOp?, leaseTtlMs?, mutation?, purpose?, resource?, tabId?, url?]' };
	}
	if (!isNonEmptyString(value.action)) {
		return { ok: false, error: 'execution request action must be a non-empty string' };
	}
	const hasResource = value.resource !== undefined;
	let resourceClass: ExecutionResourceClass;
	if (hasResource) {
		const refVerdict = validateExecutionResourceRef(value.resource);
		if (!refVerdict.ok) {
			return { ok: false, error: `execution request resource: ${refVerdict.error}` };
		}
		resourceClass = refVerdict.ref.resourceClass;
	} else {
		// A resource-less request is ONLY the browser 'open' action (a fresh session mint).
		if (value.action !== 'open') {
			return { ok: false, error: 'execution request resource is required unless the action is the browser open (fresh session mint)' };
		}
		resourceClass = 'browser-session';
	}
	if (resourceClass === 'browser-session') {
		if (!BROWSER_ACTIONS.includes(value.action as BrowserAction)) {
			return { ok: false, error: `browser-session action must be one of ${BROWSER_ACTIONS.join(' | ')} (got ${JSON.stringify(value.action)})` };
		}
		if (value.environmentOp !== undefined || value.mutation !== undefined) {
			return { ok: false, error: 'browser-session request must not carry environmentOp/mutation' };
		}
		if (value.url !== undefined && !isNonEmptyString(value.url)) {
			return { ok: false, error: 'browser-session request url must be a non-empty string when present' };
		}
		if (value.tabId !== undefined && !/^flauz:tab:[0-9a-f]{16}$/.test(String(value.tabId))) {
			return { ok: false, error: 'browser-session request tabId must be flauz:tab:<16-hex> when present' };
		}
	} else if (resourceClass === 'environment') {
		if (!ENVIRONMENT_OPS.includes(value.action as EnvironmentOp)) {
			return { ok: false, error: `environment action must be one of ${ENVIRONMENT_OPS.join(' | ')} (got ${JSON.stringify(value.action)})` };
		}
		if (value.url !== undefined || value.tabId !== undefined || value.mutation !== undefined) {
			return { ok: false, error: 'environment request must not carry url/tabId/mutation' };
		}
	} else {
		if (!LOGICAL_ACTIONS.includes(value.action as LogicalAction)) {
			return { ok: false, error: `logical-resource action must be one of ${LOGICAL_ACTIONS.join(' | ')} (got ${JSON.stringify(value.action)})` };
		}
		if (value.url !== undefined || value.tabId !== undefined || value.environmentOp !== undefined) {
			return { ok: false, error: 'logical-resource request must not carry url/tabId/environmentOp' };
		}
		if (value.mutation !== undefined && !isPlainObject(value.mutation)) {
			return { ok: false, error: 'logical-resource request mutation must be a JSON object when present' };
		}
	}
	if (value.leaseTtlMs !== undefined && (!isPositiveInteger(value.leaseTtlMs))) {
		return { ok: false, error: 'execution request leaseTtlMs must be a positive integer (epoch ms) when present' };
	}
	if (value.purpose !== undefined && !isNonEmptyString(value.purpose)) {
		return { ok: false, error: 'execution request purpose must be a non-empty string when present' };
	}
	return { ok: true, request: value as unknown as ExecutionRequest };
}

// ---------------------------------------------------------------------------
// Shared helpers (the sibling-extension idiom, kept local and pure)
// ---------------------------------------------------------------------------

const SHA256_K = new Uint32Array([
	0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
	0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
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
 * Pure-TypeScript sha256 over the UTF-8 bytes of `input`, hex-encoded (the
 * flauz-browser/flauz-workspace pattern - zero runtime deps, identical
 * behavior under node --test and the extension host; cross-checked against
 * node:crypto in test/journal.test.ts).
 */
export function execSha256Hex(input: string): string {
	const bytes = new TextEncoder().encode(input);
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
			const s0 = rotr(w[i - 15] ?? 0, 7) ^ rotr(w[i - 15] ?? 0, 18) ^ ((w[i - 15] ?? 0) >>> 3);
			const s1 = rotr(w[i - 2] ?? 0, 17) ^ rotr(w[i - 2] ?? 0, 19) ^ ((w[i - 2] ?? 0) >>> 10);
			w[i] = ((w[i - 16] ?? 0) + s0 + (w[i - 7] ?? 0) + s1) >>> 0;
		}
		let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
		for (let i = 0; i < 64; i++) {
			const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
			const ch = (e & f) ^ (~e & g);
			const t1 = (h + S1 + ch + (SHA256_K[i] ?? 0) + (w[i] ?? 0)) >>> 0;
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
		.map((word) => word.toString(16).padStart(8, '0'))
		.join('');
}

/** Typed execution-journal error (fail-closed; stable code for logs/audit). */
export type ExecErrorCode =
	| 'EXEC_JOURNAL_CORRUPT'
	| 'EXEC_JOURNAL_INVALID_ROW'
	| 'EXEC_TRANSITION_ILLEGAL'
	| 'EXEC_ACQUISITION_UNKNOWN'
	| 'EXEC_ACQUISITION_STATE'
	| 'EXEC_EFFECT_REPLAY'
	| 'EXEC_INVALID_PARAMS';

export class ExecError extends Error {
	readonly code: ExecErrorCode;
	constructor(code: ExecErrorCode, message: string) {
		super(`${EXEC_JOURNAL_SCHEMA_ID}: ${message}`);
		this.name = 'ExecError';
		this.code = code;
	}
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasKey(value: Record<string, unknown>, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(value, key);
}

/** Keys must be exactly `expected` (no more, no less). */
function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
	const actual = Object.keys(value);
	if (actual.length !== expected.length) {
		return false;
	}
	return expected.every((key) => hasKey(value, key));
}

/** Every key must be known (required present, optional allowed, unknown rejected). */
function hasOnlyKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
	const allowed = new Set([...required, ...optional]);
	for (const key of Object.keys(value)) {
		if (!allowed.has(key)) {
			return false;
		}
	}
	return required.every((key) => hasKey(value, key));
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}

function isPositiveInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
