/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The Flauz logical resource graph -- core model (v0).
 *
 * THE LAW THIS MODULE ENCODES (ARCHITECTURE-LOCK section 3, Pillar 3 "Workspace
 * OS"; TL3-HANDOFF Worker C): IDENTITY IS NOT ACCESS.
 *   - A `ResourceRef` carries LOGICAL identity only: a URN-shaped id
 *     (`flauz:<kind>:<16-hex-or-slug>`), never a filesystem path, URL, endpoint
 *     or credential.
 *   - Access data lives in SEPARATE, per-family `Surface` records bound to the
 *     ref id (`FileSystemSurface`, `BrowserSurface`, `EnvironmentSurface`,
 *     `ModelSurface`, `TaskSurface`, `ArtifactSurface`, `WorkspaceSurface`) --
 *     unification WITHOUT flattening the divergent access surfaces.
 *   - Every ref, surface version and edge carries provenance (the agent-vs-
 *     human actor distinction is MANDATORY -- fail-closed).
 *
 * Envelope discipline (DL-9 / DL-32 sibling-envelope convention): canonical
 * JSON (recursively sorted keys, no insignificant whitespace), pretty
 * serialization with 2-space indent + exactly one trailing newline, atomic
 * tmp+rename persistence via the `FileSystemPort`, `Clock` port for
 * deterministic tests. Same discipline as flauz-workspace / flauz-environments,
 * duplicated by convention -- no cross-extension imports.
 *
 * Cross-worker contracts (TL3 orchestrator pins) are DUPLICATED HERE AS TYPES
 * and pinned by `test/contract.test.ts` + `test/fixtures/resources/contracts/`:
 *   - Worker A's BrowserSessionDescriptor session ids are exactly
 *     `flauz:browser:<16-hex>` -- browser-session refs carry THAT id.
 *   - flauz-environments keys environments by descriptor id (`env-...`) --
 *     environment refs carry THAT id as the URN local part.
 *   - flauz-workspace task ids are `T-<digits>` (TASK_ID_PATTERN below).
 */

/** Schema identifier pinned into `.flauz/resources.json`. */
export const SCHEMA_ID = 'flauz.resources/v0';

/** Schema identifier of the mutation log `.flauz/resources-ops.jsonl` records. */
export const OPS_SCHEMA_ID = 'flauz.resources-ops/v0';

/** Directory (relative to the workspace root) holding all Flauz state. */
export const FLAUZ_DIR = '.flauz';

/** Resource-graph envelope path, relative to the workspace root. */
export const GRAPH_PATH = '.flauz/resources.json';

/** Provenance ops log path, relative to the workspace root (append-only JSONL). */
export const OPS_PATH = '.flauz/resources-ops.jsonl';

/** Sibling registry path (flauz-environments contract file; read-only, optional). */
export const ENVIRONMENTS_REGISTRY_PATH = '.flauz/environments.json';

// ---------------------------------------------------------------------------
// Closed vocabularies (v0)
// ---------------------------------------------------------------------------

export const RESOURCE_KINDS = [
	'file', 'directory', 'task', 'agent-session', 'browser-session', 'environment',
	'artifact', 'evidence', 'model', 'provider', 'workflow', 'workspace',
] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export const EDGE_KINDS = ['depends-on', 'produced', 'bound-to', 'restored-from', 'snapshot-of', 'derived-from'] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

export const ACTORS = ['agent', 'human', 'tool'] as const;
export type Actor = (typeof ACTORS)[number];

export const SURFACE_FAMILIES = [
	'file-system', 'browser', 'environment', 'model', 'task', 'artifact', 'workspace',
] as const;
export type SurfaceFamily = (typeof SURFACE_FAMILIES)[number];

/**
 * Contract-duplicated environment provider kinds (flauz-environments
 * `ENVIRONMENT_KINDS`, DL-32: duplicated as types, pinned by contract
 * fixtures -- never imported).
 */
export const ENVIRONMENT_PROVIDER_KINDS = ['ssh-local', 'container', 'cloud-sandbox', 'workspace-remote'] as const;
export type EnvironmentProviderKind = (typeof ENVIRONMENT_PROVIDER_KINDS)[number];

/**
 * The canonical URN namespace per resource kind. Browser sessions use
 * `flauz:browser:<16-hex>` (Worker A's pinned BrowserSessionDescriptor id);
 * agent sessions use the symmetric `flauz:agent:` namespace; environment refs
 * carry the registry descriptor id as the local part
 * (`flauz:environment:env-staging`).
 */
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

/** The URN local part: exactly 16 lowercase hex chars, or a bounded slug. */
const URN_PATTERN = /^flauz:([a-z][a-z0-9-]*):([0-9a-f]{16}|[A-Za-z0-9][A-Za-z0-9._-]{0,63})$/;

/** flauz-workspace task-id pattern (contract-duplicated, DL-32). */
const TASK_ID_PATTERN = /^T-\d{3,}$/;

/** flauz-environments descriptor-id pattern (contract-duplicated, DL-32). */
const ENVIRONMENT_ID_PATTERN = /^env-[a-z0-9][a-z0-9-]{0,47}$/;

/** Browser-session id pattern (Worker A pin): exactly `flauz:browser:<16-hex>`. */
const BROWSER_SESSION_ID_PATTERN = /^flauz:browser:[0-9a-f]{16}$/;

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

// ---------------------------------------------------------------------------
// Provenance (fail-closed: the actor is MANDATORY on every mutation)
// ---------------------------------------------------------------------------

export interface ResourceProvenance {
	/** Who caused the mutation. Mandatory -- a missing actor is a schema rejection. */
	readonly actor: Actor;
	/** Stable id of the acting agent/human/tool (e.g. `flauz-agent`, `user-42`). */
	readonly actorId?: string;
	/** The agent session the mutation happened in, when applicable. */
	readonly sessionId?: string;
	/** The flauz task the mutation happened for, when applicable. */
	readonly taskId?: string;
	/** Free-form human-readable cause. */
	readonly cause?: string;
}

// ---------------------------------------------------------------------------
// ResourceRef -- logical identity ONLY (never a path, URL, endpoint, secret)
// ---------------------------------------------------------------------------

export interface ResourceRef {
	readonly schemaVersion: 0;
	readonly kind: ResourceKind;
	/** URN-shaped logical id: `flauz:<kind-namespace>:<16-hex-or-slug>`. */
	readonly id: string;
	readonly displayName?: string;
	readonly provenance: ResourceProvenance;
	/** Epoch ms, minted by the graph clock at creation. */
	readonly createdAt: number;
}

/** Input to `ResourceGraph.addRef` (createdAt is minted by the graph clock). */
export interface RefInput {
	readonly kind: ResourceKind;
	readonly id: string;
	readonly displayName?: string;
	readonly provenance: ResourceProvenance;
}

// ---------------------------------------------------------------------------
// Access surfaces -- separate, per-family records (the no-flattening law)
// ---------------------------------------------------------------------------

export interface FileSystemSurface {
	readonly kind: 'file-system';
	readonly root: string;
	readonly path: string;
	readonly contentSha256?: string;
}

export interface BrowserSurface {
	readonly kind: 'browser';
	readonly cdpEndpoint?: string;
	readonly partition?: string;
	readonly tabIds?: readonly string[];
}

export interface EnvironmentSurface {
	readonly kind: 'environment';
	/** The flauz-environments registry descriptor id (`env-...`). */
	readonly descriptorId: string;
	readonly providerKind: EnvironmentProviderKind;
	readonly attachTarget?: string;
}

export interface ModelSurface {
	readonly kind: 'model';
	readonly providerId: string;
	readonly modelId: string;
}

export interface TaskSurface {
	readonly kind: 'task';
	readonly envelopePath: string;
	readonly taskId: string;
}

export interface ArtifactSurface {
	readonly kind: 'artifact';
	readonly uri: string;
	readonly sha256: string;
}

export interface WorkspaceSurface {
	readonly kind: 'workspace';
	readonly root: string;
}

export type Surface =
	| FileSystemSurface
	| BrowserSurface
	| EnvironmentSurface
	| ModelSurface
	| TaskSurface
	| ArtifactSurface
	| WorkspaceSurface;

/** One version of a ref's access surface in a family (the prior surface is retained). */
export interface SurfaceVersion {
	readonly surface: Surface;
	readonly provenance: ResourceProvenance;
	readonly updatedAt: number;
}

/** A ref's versioned surface record for ONE family (versions[last] is current). */
export interface SurfaceRecord {
	readonly refId: string;
	readonly family: SurfaceFamily;
	readonly versions: readonly SurfaceVersion[];
}

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

export interface GraphEdge {
	readonly kind: EdgeKind;
	readonly from: string;
	readonly to: string;
	readonly provenance: ResourceProvenance;
	readonly createdAt: number;
}

/** Input to `ResourceGraph.addEdge` (createdAt minted by the graph clock). */
export interface EdgeInput {
	readonly kind: EdgeKind;
	readonly from: string;
	readonly to: string;
}

/**
 * Edge-kind legality per endpoint kinds (v0 closed matrix). `'*'` means any
 * kind. A typed, test-pinned restriction -- NOT a free-for-all: illegal
 * endpoint combinations are rejected at add time and flagged by verify.
 */
export interface EdgeLegality {
	readonly from: readonly ResourceKind[] | '*';
	readonly to: readonly ResourceKind[] | '*';
}

/**
 * The restorable from-kinds: EXACTLY the kinds with a v0 restoration family
 * in ContinuityService (`FAMILY_BY_KIND`) -- DL-82 (P2-FIX-111), the
 * restrict-the-matrix convergence. `task`, `agent-session` and `workflow`
 * LEAVE the restorable from-kinds until their owning lanes (flauz-workspace
 * task envelope; Agent OS agent sessions) mint their restoration families
 * (the joint DL-R2 re-admission wave: matrix + family + tests + fixtures
 * together) -- the graph grammar never admits edges the service cannot
 * execute.
 */
const RESTORABLE_KINDS: readonly ResourceKind[] = [
	'file', 'directory', 'artifact', 'evidence', 'browser-session', 'environment',
];

export const EDGE_LEGALITY: Readonly<Record<EdgeKind, EdgeLegality>> = {
	'depends-on': { from: ['task', 'workflow', 'agent-session', 'browser-session', 'environment', 'model'], to: '*' },
	'produced': { from: ['task', 'workflow', 'agent-session', 'browser-session', 'environment'], to: ['file', 'directory', 'artifact', 'evidence'] },
	'bound-to': { from: ['task', 'workflow', 'agent-session', 'browser-session', 'file', 'directory', 'artifact', 'evidence'], to: ['environment', 'workspace'] },
	'restored-from': { from: RESTORABLE_KINDS, to: '*' },
	'snapshot-of': { from: RESTORABLE_KINDS, to: RESTORABLE_KINDS },
	'derived-from': { from: '*', to: '*' },
};

/**
 * Edge kinds whose directed relation carries ANCESTRY semantics and must
 * therefore stay ACYCLIC per kind (C2): `produced` (producer precedes
 * product), `restored-from` (origin precedes the restored copy),
 * `snapshot-of` (original precedes the snapshot), `derived-from` (source
 * precedes the derivative). A cycle within ONE kind (X snapshot-of Y while
 * Y snapshot-of X) is mutual ancestry -- temporally impossible nonsense.
 * Cross-kind round trips are lawful (the designed restore flow: a snapshot
 * `snapshot-of` a session, the session later `restored-from` that snapshot),
 * so the invariant is enforced per kind, not across kinds. `depends-on` and
 * `bound-to` carry no ancestry semantics and are unrestricted in v0.
 */
export const ACYCLIC_EDGE_KINDS: readonly EdgeKind[] = ['produced', 'restored-from', 'snapshot-of', 'derived-from'];

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

export interface ResourcesEnvelope {
	readonly $schema: string;
	readonly nodes: readonly ResourceRef[];
	readonly edges: readonly GraphEdge[];
	readonly surfaces: readonly SurfaceRecord[];
}

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

export type ResourceErrorCode =
	| 'FLAUZ_RESOURCES_SCHEMA'        // structural/schema violation
	| 'FLAUZ_RESOURCES_DUPLICATE'     // duplicate ref id / edge / surface version
	| 'FLAUZ_RESOURCES_NOT_FOUND'     // unknown ref id / family
	| 'FLAUZ_RESOURCES_REF_IN_USE'    // removeRef refused (edges/surfaces bound)
	| 'FLAUZ_RESOURCES_EDGE_ILLEGAL'  // endpoints missing, self-edge or matrix violation
	| 'FLAUZ_RESOURCES_SECRET'        // secret-shaped literal rejected (vault-only policy)
	| 'FLAUZ_RESOURCES_PROVENANCE'    // missing/invalid actor (fail-closed provenance)
	| 'FLAUZ_RESOURCES_RESTORE'       // restoration failures
	| 'FLAUZ_RESOURCES_PERSIST';      // load/parse/persist failures

export class ResourceGraphError extends Error {
	readonly code: ResourceErrorCode;
	/** Structured payload (e.g. the edge/surface listing on a removeRef refusal). */
	readonly details: Record<string, unknown> | undefined;

	constructor(code: ResourceErrorCode, message: string, details?: Record<string, unknown>) {
		super(`${code}: ${message}`);
		this.name = 'ResourceGraphError';
		this.code = code;
		this.details = details;
	}
}

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

export function isResourceKind(value: unknown): value is ResourceKind {
	return typeof value === 'string' && (RESOURCE_KINDS as readonly string[]).includes(value);
}

export function isEdgeKind(value: unknown): value is EdgeKind {
	return typeof value === 'string' && (EDGE_KINDS as readonly string[]).includes(value);
}

export function isActor(value: unknown): value is Actor {
	return typeof value === 'string' && (ACTORS as readonly string[]).includes(value);
}

export function isSurfaceFamily(value: unknown): value is SurfaceFamily {
	return typeof value === 'string' && (SURFACE_FAMILIES as readonly string[]).includes(value);
}

export function isEnvironmentProviderKind(value: unknown): value is EnvironmentProviderKind {
	return typeof value === 'string' && (ENVIRONMENT_PROVIDER_KINDS as readonly string[]).includes(value);
}

export function isSha256Hex(value: unknown): value is string {
	return typeof value === 'string' && SHA256_HEX_PATTERN.test(value);
}

export function isTaskId(value: unknown): value is string {
	return typeof value === 'string' && TASK_ID_PATTERN.test(value);
}

export function isEnvironmentId(value: unknown): value is string {
	return typeof value === 'string' && ENVIRONMENT_ID_PATTERN.test(value);
}

/** Browser-session ref ids are exactly Worker A's pinned session ids. */
export function isBrowserSessionId(value: unknown): value is string {
	return typeof value === 'string' && BROWSER_SESSION_ID_PATTERN.test(value);
}

/** The URN namespace segment for a kind (e.g. `browser` for `browser-session`). */
export function resourceUrnNamespace(kind: ResourceKind): string {
	return KIND_NAMESPACES[kind];
}

/** Parses `flauz:<namespace>:<local>`; undefined when not URN-shaped. */
export function parseResourceUrn(value: string): { namespace: string; local: string } | undefined {
	const match = URN_PATTERN.exec(value);
	if (match === null) {
		return undefined;
	}
	return { namespace: match[1] ?? '', local: match[2] ?? '' };
}

/** True when `value` is a well-formed URN with the canonical namespace for `kind`. */
export function isResourceUrnForKind(value: unknown, kind: ResourceKind): value is string {
	if (typeof value !== 'string') {
		return false;
	}
	const parsed = parseResourceUrn(value);
	return parsed !== undefined && parsed.namespace === KIND_NAMESPACES[kind];
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Own-property presence check (the eslint-blessed replacement for the `in` operator). */
export function hasKey(obj: object, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(obj, key);
}

/** Every key must be known (required present, optional allowed, unknown rejected). */
function hasOnlyKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[]): boolean {
	const allowed = new Set([...required, ...optional]);
	for (const key of Object.keys(value)) {
		if (!allowed.has(key)) {
			return false;
		}
	}
	return required.every(key => hasKey(value, key));
}

export function isPositiveEpochMs(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}

function isBoundedString(value: unknown, max: number): value is string {
	return isNonEmptyString(value) && value.length <= max;
}

// ---------------------------------------------------------------------------
// Secret-shape detection (vault-only policy, SECURITY-MODEL 3.5 discipline)
// ---------------------------------------------------------------------------

/** Vault-style secret reference (`vault:...` / `env:...`) -- the ONLY legal secret carrier. */
const SECRET_REF_PATTERN = /^(vault|env):[A-Za-z0-9._/-]+$/;

export function isSecretRef(value: unknown): value is string {
	return typeof value === 'string' && SECRET_REF_PATTERN.test(value);
}

/**
 * Known credential shapes. A surface/ref/edge carrying a string that MATCHES
 * one of these is REJECTED at the schema level: surfaces may carry only
 * vault-style secret REFERENCES, never literal credentials. (Pattern text only
 * -- no complete secret shape is ever spelled out in this source file; test
 * fixtures assemble secret-shaped strings from fragments at runtime.)
 */
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

/**
 * Deep-walks a JSON value and rejects any secret-shaped string it finds
 * (fail-closed). `path` is a JSON-path-ish location for the error message.
 */
export function assertNoSecretShapedValues(value: unknown, path: string): void {
	if (typeof value === 'string') {
		if (looksSecretShaped(value)) {
			throw new ResourceGraphError(
				'FLAUZ_RESOURCES_SECRET',
				`${path}: secret-shaped literal rejected -- surfaces and continuity metadata may carry only vault-style references (vault:/env:), never literal credentials`,
			);
		}
		return;
	}
	if (Array.isArray(value)) {
		for (const [index, item] of value.entries()) {
			assertNoSecretShapedValues(item, `${path}[${index}]`);
		}
		return;
	}
	if (isPlainObject(value)) {
		for (const key of Object.keys(value)) {
			assertNoSecretShapedValues(value[key], `${path}.${key}`);
		}
	}
}

// ---------------------------------------------------------------------------
// Validators (throw ResourceGraphError with the flauz.resources/v0 prefix)
// ---------------------------------------------------------------------------

function schemaError(message: string): ResourceGraphError {
	return new ResourceGraphError('FLAUZ_RESOURCES_SCHEMA', `flauz.resources/v0: ${message}`);
}

export function validateProvenance(value: unknown, where = 'value'): ResourceProvenance {
	if (!isPlainObject(value)) {
		throw schemaError(`${where}: provenance must be an object { actor, actorId?, sessionId?, taskId?, cause? }`);
	}
	// fail-closed provenance: the actor check comes FIRST -- a missing or
	// unknown actor is never buried under a generic shape error
	if (!hasKey(value, 'actor')) {
		throw new ResourceGraphError(
			'FLAUZ_RESOURCES_PROVENANCE',
			`flauz.resources/v0: ${where}: provenance.actor is MISSING -- the actor is MANDATORY on every mutation (fail-closed provenance)`,
		);
	}
	if (!isActor(value.actor)) {
		throw new ResourceGraphError(
			'FLAUZ_RESOURCES_PROVENANCE',
			`flauz.resources/v0: ${where}: provenance.actor must be one of agent|human|tool (got ${JSON.stringify(value.actor)}) -- the actor is MANDATORY on every mutation (fail-closed provenance)`,
		);
	}
	if (!hasOnlyKeys(value, ['actor'], ['actorId', 'sessionId', 'taskId', 'cause'])) {
		throw schemaError(`${where}: provenance must have exactly the keys [actor] + optional [actorId, sessionId, taskId, cause] (got [${Object.keys(value).sort().join(', ')}])`);
	}
	const result: { actor: Actor; actorId?: string; sessionId?: string; taskId?: string; cause?: string } = { actor: value.actor };
	if (value.actorId !== undefined) {
		if (!isBoundedString(value.actorId, 200)) {
			throw schemaError(`${where}: provenance.actorId must be a non-empty string of at most 200 chars`);
		}
		result.actorId = value.actorId;
	}
	if (value.sessionId !== undefined) {
		if (!isBoundedString(value.sessionId, 200)) {
			throw schemaError(`${where}: provenance.sessionId must be a non-empty string of at most 200 chars`);
		}
		result.sessionId = value.sessionId;
	}
	if (value.taskId !== undefined) {
		if (!isBoundedString(value.taskId, 200)) {
			throw schemaError(`${where}: provenance.taskId must be a non-empty string of at most 200 chars`);
		}
		result.taskId = value.taskId;
	}
	if (value.cause !== undefined) {
		if (!isBoundedString(value.cause, 500)) {
			throw schemaError(`${where}: provenance.cause must be a non-empty string of at most 500 chars`);
		}
		result.cause = value.cause;
	}
	return result;
}

export function validateResourceRef(value: unknown, where = 'value'): ResourceRef {
	if (!isPlainObject(value)) {
		throw schemaError(`${where}: ref must be a plain object`);
	}
	if (!hasOnlyKeys(value, ['schemaVersion', 'kind', 'id', 'provenance', 'createdAt'], ['displayName'])) {
		throw schemaError(`${where}: ref must have exactly the keys [schemaVersion, kind, id, provenance, createdAt] + optional [displayName] (got [${Object.keys(value).sort().join(', ')}])`);
	}
	if (value.schemaVersion !== 0) {
		throw schemaError(`${where}: schemaVersion must be exactly 0 (got ${JSON.stringify(value.schemaVersion)})`);
	}
	if (!isResourceKind(value.kind)) {
		throw schemaError(`${where}: kind must be one of ${RESOURCE_KINDS.join('|')} (got ${JSON.stringify(value.kind)})`);
	}
	const kind: ResourceKind = value.kind;
	if (!isNonEmptyString(value.id)) {
		throw schemaError(`${where}: id must be a non-empty string`);
	}
	if (!isResourceUrnForKind(value.id, kind)) {
		const namespace = KIND_NAMESPACES[kind];
		throw schemaError(
			`${where}: id must be a URN 'flauz:${namespace}:<16-hex-or-slug>' whose namespace matches the ref kind '${kind}' (got ${JSON.stringify(value.id)}) -- a ResourceRef NEVER carries a filesystem path, URL or endpoint`,
		);
	}
	if (value.displayName !== undefined && !isBoundedString(value.displayName, 200)) {
		throw schemaError(`${where}: displayName must be a non-empty string of at most 200 chars when present`);
	}
	const provenance = validateProvenance(value.provenance, `${where}.provenance`);
	if (!isPositiveEpochMs(value.createdAt)) {
		throw schemaError(`${where}: createdAt must be a positive integer epoch-ms`);
	}
	assertNoSecretShapedValues(value, where);
	const ref: { schemaVersion: 0; kind: ResourceKind; id: string; displayName?: string; provenance: ResourceProvenance; createdAt: number } = {
		schemaVersion: 0,
		kind,
		id: value.id,
		provenance,
		createdAt: value.createdAt,
	};
	if (value.displayName !== undefined) {
		ref.displayName = value.displayName;
	}
	return ref;
}

const SURFACE_KEY_MAP: Readonly<Record<SurfaceFamily, { required: readonly string[]; optional: readonly string[] }>> = {
	'file-system': { required: ['kind', 'root', 'path'], optional: ['contentSha256'] },
	browser: { required: ['kind'], optional: ['cdpEndpoint', 'partition', 'tabIds'] },
	environment: { required: ['kind', 'descriptorId', 'providerKind'], optional: ['attachTarget'] },
	model: { required: ['kind', 'providerId', 'modelId'], optional: [] },
	task: { required: ['kind', 'envelopePath', 'taskId'], optional: [] },
	artifact: { required: ['kind', 'uri', 'sha256'], optional: [] },
	workspace: { required: ['kind', 'root'], optional: [] },
};

function validateBoundedField(value: Record<string, unknown>, key: string, where: string, max: number): string {
	const raw = value[key];
	if (!isBoundedString(raw, max)) {
		throw schemaError(`${where}.${key} must be a non-empty string of at most ${max} chars`);
	}
	return raw;
}

export function validateSurface(value: unknown, where = 'value'): Surface {
	if (!isPlainObject(value)) {
		throw schemaError(`${where}: surface must be a plain object`);
	}
	if (!isNonEmptyString(value.kind) || !isSurfaceFamily(value.kind)) {
		throw schemaError(`${where}: surface.kind must be one of ${SURFACE_FAMILIES.join('|')} (got ${JSON.stringify(value.kind)})`);
	}
	const family: SurfaceFamily = value.kind;
	const keys = SURFACE_KEY_MAP[family];
	if (!hasOnlyKeys(value, keys.required, keys.optional)) {
		throw schemaError(`${where}: ${family} surface must have exactly the keys [${keys.required.join(', ')}] + optional [${keys.optional.join(', ')}] (got [${Object.keys(value).sort().join(', ')}])`);
	}
	assertNoSecretShapedValues(value, where);
	switch (family) {
		case 'file-system': {
			const surface: { kind: 'file-system'; root: string; path: string; contentSha256?: string } = {
				kind: 'file-system',
				root: validateBoundedField(value, 'root', where, 1024),
				path: validateBoundedField(value, 'path', where, 1024),
			};
			if (value.contentSha256 !== undefined) {
				if (!isSha256Hex(value.contentSha256)) {
					throw schemaError(`${where}.contentSha256 must be 64 lowercase hex chars`);
				}
				surface.contentSha256 = value.contentSha256;
			}
			return surface;
		}
		case 'browser': {
			const surface: { kind: 'browser'; cdpEndpoint?: string; partition?: string; tabIds?: readonly string[] } = { kind: 'browser' };
			if (value.cdpEndpoint !== undefined) {
				surface.cdpEndpoint = validateBoundedField(value, 'cdpEndpoint', where, 1024);
			}
			if (value.partition !== undefined) {
				surface.partition = validateBoundedField(value, 'partition', where, 200);
			}
			if (value.tabIds !== undefined) {
				if (!Array.isArray(value.tabIds) || value.tabIds.some(tab => !isBoundedString(tab, 200)) || value.tabIds.length > 64) {
					throw schemaError(`${where}.tabIds must be an array of at most 64 non-empty strings`);
				}
				surface.tabIds = value.tabIds as readonly string[];
			}
			return surface;
		}
		case 'environment': {
			if (!isEnvironmentId(value.descriptorId)) {
				throw schemaError(`${where}.descriptorId must be a flauz-environments registry id ('env-<slug>', contract-duplicated pattern) -- got ${JSON.stringify(value.descriptorId)}`);
			}
			if (!isEnvironmentProviderKind(value.providerKind)) {
				throw schemaError(`${where}.providerKind must be one of ${ENVIRONMENT_PROVIDER_KINDS.join('|')} (contract-duplicated vocabulary; got ${JSON.stringify(value.providerKind)})`);
			}
			const surface: { kind: 'environment'; descriptorId: string; providerKind: EnvironmentProviderKind; attachTarget?: string } = {
				kind: 'environment',
				descriptorId: value.descriptorId,
				providerKind: value.providerKind,
			};
			if (value.attachTarget !== undefined) {
				surface.attachTarget = validateBoundedField(value, 'attachTarget', where, 1024);
			}
			return surface;
		}
		case 'model': {
			return {
				kind: 'model',
				providerId: validateBoundedField(value, 'providerId', where, 200),
				modelId: validateBoundedField(value, 'modelId', where, 200),
			};
		}
		case 'task': {
			if (!isTaskId(value.taskId)) {
				throw schemaError(`${where}.taskId must match the flauz-workspace task-id pattern 'T-<3+ digits>' (contract-duplicated pattern) -- got ${JSON.stringify(value.taskId)}`);
			}
			return {
				kind: 'task',
				envelopePath: validateBoundedField(value, 'envelopePath', where, 1024),
				taskId: value.taskId,
			};
		}
		case 'artifact': {
			if (!isSha256Hex(value.sha256)) {
				throw schemaError(`${where}.sha256 must be 64 lowercase hex chars`);
			}
			return {
				kind: 'artifact',
				uri: validateBoundedField(value, 'uri', where, 1024),
				sha256: value.sha256,
			};
		}
		case 'workspace': {
			return {
				kind: 'workspace',
				root: validateBoundedField(value, 'root', where, 1024),
			};
		}
	}
}

export function validateSurfaceVersion(value: unknown, where = 'value'): SurfaceVersion {
	if (!isPlainObject(value)) {
		throw schemaError(`${where}: surface version must be a plain object { surface, provenance, updatedAt }`);
	}
	if (!hasOnlyKeys(value, ['surface', 'provenance', 'updatedAt'], [])) {
		throw schemaError(`${where}: surface version must have exactly the keys [surface, provenance, updatedAt] (got [${Object.keys(value).sort().join(', ')}])`);
	}
	const surface = validateSurface(value.surface, `${where}.surface`);
	const provenance = validateProvenance(value.provenance, `${where}.provenance`);
	if (!isPositiveEpochMs(value.updatedAt)) {
		throw schemaError(`${where}.updatedAt must be a positive integer epoch-ms`);
	}
	return { surface, provenance, updatedAt: value.updatedAt };
}

export function validateSurfaceRecord(value: unknown, where = 'value'): SurfaceRecord {
	if (!isPlainObject(value)) {
		throw schemaError(`${where}: surface record must be a plain object { refId, family, versions }`);
	}
	if (!hasOnlyKeys(value, ['refId', 'family', 'versions'], [])) {
		throw schemaError(`${where}: surface record must have exactly the keys [refId, family, versions] (got [${Object.keys(value).sort().join(', ')}])`);
	}
	if (!isNonEmptyString(value.refId)) {
		throw schemaError(`${where}.refId must be a non-empty string`);
	}
	if (!isSurfaceFamily(value.family)) {
		throw schemaError(`${where}.family must be one of ${SURFACE_FAMILIES.join('|')} (got ${JSON.stringify(value.family)})`);
	}
	if (!Array.isArray(value.versions) || value.versions.length === 0) {
		throw schemaError(`${where}.versions must be a non-empty array (the prior surface is retained on change -- identity survives access-surface change)`);
	}
	const versions = value.versions.map((version, index) => validateSurfaceVersion(version, `${where}.versions[${index}]`));
	for (const [index, version] of versions.entries()) {
		if (version.surface.kind !== value.family) {
			throw schemaError(`${where}.versions[${index}].surface.kind must equal the record family '${value.family}' (got '${version.surface.kind}')`);
		}
	}
	return { refId: value.refId, family: value.family, versions };
}

export function validateEdge(value: unknown, where = 'value'): GraphEdge {
	if (!isPlainObject(value)) {
		throw schemaError(`${where}: edge must be a plain object`);
	}
	if (!hasOnlyKeys(value, ['kind', 'from', 'to', 'provenance', 'createdAt'], [])) {
		throw schemaError(`${where}: edge must have exactly the keys [kind, from, to, provenance, createdAt] (got [${Object.keys(value).sort().join(', ')}])`);
	}
	if (!isEdgeKind(value.kind)) {
		throw schemaError(`${where}: edge kind must be one of ${EDGE_KINDS.join('|')} (got ${JSON.stringify(value.kind)})`);
	}
	if (!isNonEmptyString(value.from) || !isNonEmptyString(value.to)) {
		throw schemaError(`${where}: edge from/to must be non-empty ref ids`);
	}
	const provenance = validateProvenance(value.provenance, `${where}.provenance`);
	if (!isPositiveEpochMs(value.createdAt)) {
		throw schemaError(`${where}: createdAt must be a positive integer epoch-ms`);
	}
	assertNoSecretShapedValues(value, where);
	return { kind: value.kind, from: value.from, to: value.to, provenance, createdAt: value.createdAt };
}

// ---------------------------------------------------------------------------
// Edge legality (typed endpoint-kind validation)
// ---------------------------------------------------------------------------

function kindAllowed(kind: ResourceKind, side: readonly ResourceKind[] | '*'): boolean {
	return side === '*' || side.includes(kind);
}

export function isEdgeLegalForKinds(edgeKind: EdgeKind, fromKind: ResourceKind, toKind: ResourceKind): boolean {
	const legality = EDGE_LEGALITY[edgeKind];
	return kindAllowed(fromKind, legality.from) && kindAllowed(toKind, legality.to);
}

export function edgeLegalityError(edgeKind: EdgeKind, fromKind: ResourceKind, toKind: ResourceKind): string {
	const legality = EDGE_LEGALITY[edgeKind];
	const fromList = legality.from === '*' ? 'any' : legality.from.join('|');
	const toList = legality.to === '*' ? 'any' : legality.to.join('|');
	return `flauz.resources/v0: edge '${edgeKind}' is not legal for endpoint kinds ${fromKind} -> ${toKind} (legal: from [${fromList}] to [${toList}])`;
}

// ---------------------------------------------------------------------------
// Ancestry-cycle invariants (C2: no forbidden cycles on append or at load)
// ---------------------------------------------------------------------------

/**
 * True when adding `from -> to` of an ancestry kind would close a directed
 * cycle among the EXISTING edges of the SAME kind (i.e. `from` is already
 * reachable from `to`). Self-edges report true (they are 1-cycles).
 */
export function edgeClosesCycle(kind: EdgeKind, from: string, to: string, edges: readonly { kind: EdgeKind; from: string; to: string }[]): boolean {
	if (!(ACYCLIC_EDGE_KINDS as readonly string[]).includes(kind)) {
		return false;
	}
	if (from === to) {
		return true;
	}
	const adjacency = new Map<string, string[]>();
	for (const edge of edges) {
		if (edge.kind !== kind) {
			continue;
		}
		const list = adjacency.get(edge.from) ?? [];
		list.push(edge.to);
		adjacency.set(edge.from, list);
	}
	const queue: string[] = [to];
	const seen = new Set<string>([to]);
	while (queue.length > 0) {
		const current = queue.shift()!;
		if (current === from) {
			return true;
		}
		for (const next of adjacency.get(current) ?? []) {
			if (!seen.has(next)) {
				seen.add(next);
				queue.push(next);
			}
		}
	}
	return false;
}

/**
 * Finds the first directed cycle among the ancestry-kind edges (deterministic:
 * kinds in ACYCLIC_EDGE_KINDS order, start nodes and neighbors sorted by id).
 * Returns the offending kind + the cyclic path, or undefined when acyclic.
 */
export function findEdgeCycle(edges: readonly { kind: EdgeKind; from: string; to: string }[]): { kind: EdgeKind; path: string[] } | undefined {
	for (const kind of ACYCLIC_EDGE_KINDS) {
		const adjacency = new Map<string, string[]>();
		for (const edge of edges) {
			if (edge.kind !== kind) {
				continue;
			}
			const list = adjacency.get(edge.from) ?? [];
			list.push(edge.to);
			adjacency.set(edge.from, list);
		}
		for (const list of adjacency.values()) {
			list.sort();
		}
		const WHITE = 0, GRAY = 1, BLACK = 2;
		const color = new Map<string, number>();
		const parent = new Map<string, string>();
		for (const start of [...adjacency.keys()].sort()) {
			if ((color.get(start) ?? WHITE) !== WHITE) {
				continue;
			}
			const stack: string[] = [start];
			color.set(start, GRAY);
			while (stack.length > 0) {
				const node = stack[stack.length - 1] as string;
				let advanced = false;
				for (const next of adjacency.get(node) ?? []) {
					const nextColor = color.get(next) ?? WHITE;
					if (nextColor === GRAY) {
						// back edge -> cycle: walk parents from `node` up to `next`
						const path: string[] = [next];
						let walker: string | undefined = node;
						while (walker !== undefined && walker !== next) {
							path.unshift(walker);
							walker = parent.get(walker);
						}
						path.push(next);
						return { kind, path };
					}
					if (nextColor === WHITE) {
						color.set(next, GRAY);
						parent.set(next, node);
						stack.push(next);
						advanced = true;
						break;
					}
				}
				if (!advanced) {
					color.set(node, BLACK);
					stack.pop();
				}
			}
		}
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// Canonical serialization (DL-9 discipline, verbatim from the sibling lanes)
// ---------------------------------------------------------------------------

/**
 * Canonical JSON: keys sorted recursively, no insignificant whitespace,
 * `undefined` values dropped. This is the exact byte input of the state
 * digests in the provenance ops log.
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
	throw new Error(`flauz.resources/v0: cannot canonicalize value of type ${typeof value} (payloads must be JSON-safe)`);
}

/** Deep copy with recursively sorted keys (input to the pretty serializer). */
export function deepSorted(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(deepSorted);
	}
	if (value !== null && typeof value === 'object') {
		const record = value as Record<string, unknown>;
		const result: Record<string, unknown> = {};
		for (const key of Object.keys(record).filter(k => record[k] !== undefined).sort()) {
			result[key] = deepSorted(record[key]);
		}
		return result;
	}
	return value;
}

/**
 * Envelope serialization with the git-diffability discipline (DL-9): fully
 * canonical (sorted) key order, 2-space indent, exactly one trailing newline,
 * no volatile noise. Logically identical states always serialize to identical
 * bytes.
 */
export function serializeEnvelope(envelope: unknown): string {
	return JSON.stringify(deepSorted(envelope), null, 2) + '\n';
}

/** Structured deep clone (drops `undefined`; key order canonicalized). */
export function clone<T>(value: T): T {
	return JSON.parse(canonicalJson(value)) as T;
}

/** POSIX-style join (v0 targets POSIX workspace roots; documented in README). */
export function joinPath(...parts: readonly string[]): string {
	return parts.filter(part => part.length > 0).join('/').replace(/\/{2,}/g, '/');
}

// ---------------------------------------------------------------------------
// sha256 (pure TypeScript, zero deps -- same implementation as flauz-workspace)
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
 * Pure-TypeScript sha256 over the UTF-8 bytes of `input`, hex-encoded. Kept
 * local (instead of `node:crypto`) so the core stays free of node typings and
 * runtime deps -- the extension host and the node test runner execute the
 * exact same code path. Cross-checked against `node:crypto` in
 * test/api.test.ts.
 */
export function sha256Hex(input: string): string {
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
			const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
			const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
			w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
		}
		let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
		for (let i = 0; i < 64; i++) {
			const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
			const ch = (e & f) ^ (~e & g);
			const t1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
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
// Ports
// ---------------------------------------------------------------------------

/**
 * Filesystem port consumed by the graph, the ops ledger and continuity. The
 * extension host wires a vscode.workspace.fs-backed implementation
 * (src/extension.ts); tests wire node:fs against temp dirs. Keeping this a
 * port is what lets the core typecheck without @types/node and run under
 * plain `node --test`.
 */
export interface FileSystemPort {
	readFileUtf8(path: string): Promise<string | undefined>;
	writeFile(path: string, contents: string): Promise<void>;
	appendFile(path: string, contents: string): Promise<void>;
	rename(fromPath: string, toPath: string): Promise<void>;
	mkdir(path: string): Promise<void>;
}

/** Injectable clock (deterministic fixtures in tests; Date.now in the host). */
export type Clock = () => number;
