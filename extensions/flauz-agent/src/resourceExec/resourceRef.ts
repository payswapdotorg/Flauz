/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-S2 -- the ResourceRef graph read-only adapter (the task-boundary layer
 * over flauz-resources' `.flauz/resources.json` + `.flauz/resources-ops.jsonl`).
 *
 * Design law (DL-32, verbatim from `journalBridge.ts`): the ResourceRef shape,
 * the kind/edge/surface vocabularies and the id grammars are DUPLICATED HERE
 * AS TYPES and pinned by the EXISTING repo-root fixtures at
 * `test/fixtures/resources/` (valid + bad -- consumed READ-ONLY, never
 * modified). This module NEVER imports from `extensions/flauz-resources/*` --
 * the contract is duplicated.
 *
 * Acquisition semantics (the no-flattening law):
 *   - the ResourceRef MUST exist in the graph (by URN);
 *   - SECRET-KIND refs are VAULT-ONLY -- the lease carries the ref id +
 *     surface version, NEVER any secret payload (the no-flattening law);
 *   - secret-shape detection runs defense-in-depth on every parsed ref
 *     (a vault-only policy surface silently containing a secret is a
 *     contract violation, never a carryable state).
 *
 * Edge minting: `edgeFor(taskId, refId)` is a PURE function returning the
 * attribution-carrying task->resource edge record (`depends-on` -- a legal
 * endpoint combination under the resources/v0 matrix); the graph WRITE
 * stays with flauz-resources at runtime (the orchestrator dispatches the
 * edge through the graph mutation port; the adapter only computes the
 * typed record).
 */
import {
        TaskResourceError,
        canonicalJson,
        hasExactKeys,
        hasKey,
        hasOnlyKeys,
        isBoundedString,
        isPlainObject,
        isPositiveEpochMs,
        isResourceRefId,
        joinPath,
        type Clock,
        type FileSystemPort,
        type TaskResourceActor,
        type TaskResourceFailure,
        type TaskResourceSurfaceSnapshot,
} from './types.ts';
import { failure, looksSecretShaped } from './contracts.ts';

// ---------------------------------------------------------------------------
// The resources/v0 contracts, duplicated as types (DL-32)
// ---------------------------------------------------------------------------

/** Schema id pinned into `.flauz/resources.json`. */
export const RESOURCES_SCHEMA_ID = 'flauz.resources/v0';

/** Schema id of the mutation log `.flauz/resources-ops.jsonl` records. */
export const RESOURCES_OPS_SCHEMA_ID = 'flauz.resources-ops/v0';

/** Resource-graph envelope path, relative to the workspace root. */
export const GRAPH_PATH = '.flauz/resources.json';

/** Provenance ops log path, relative to the workspace root (append-only JSONL). */
export const RESOURCES_OPS_PATH = '.flauz/resources-ops.jsonl';

export const RESOURCE_KINDS = [
        'file', 'directory', 'task', 'agent-session', 'browser-session', 'environment',
        'artifact', 'evidence', 'model', 'provider', 'workflow', 'workspace',
] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

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

/** The kinds whose surfaces carry secret-shaped material at the schema level. */
export const SECRET_KINDS: readonly ResourceKind[] = ['evidence', 'artifact'];

/** `true` when `kind` is a known resource kind. */
export function isResourceKind(value: unknown): value is ResourceKind {
        return typeof value === 'string' && (RESOURCE_KINDS as readonly string[]).includes(value);
}

/** The URN local part: exactly 16 lowercase hex chars, or a bounded slug. */
const URN_PATTERN = /^flauz:([a-z][a-z0-9-]*):([0-9a-f]{16}|[A-Za-z0-9][A-Za-z0-9._-]{0,63})$/;

/** Parses `flauz:<namespace>:<local>`; undefined when not URN-shaped. */
export function parseResourceUrn(value: string): { namespace: string; local: string; kind: ResourceKind } | undefined {
        const match = URN_PATTERN.exec(value);
        if (match === null) {
                return undefined;
        }
        const namespace = match[1] ?? '';
        const local = match[2] ?? '';
        const kind = (Object.keys(KIND_NAMESPACES) as readonly ResourceKind[]).find(k => KIND_NAMESPACES[k] === namespace);
        if (kind === undefined) {
                return undefined;
        }
        return { namespace, local, kind };
}

export const ACTORS = ['agent', 'human', 'tool'] as const;
export type Actor = (typeof ACTORS)[number];

export interface ResourceProvenance {
        readonly actor: Actor;
        readonly actorId?: string;
        readonly sessionId?: string;
        readonly taskId?: string;
        readonly cause?: string;
}

export interface ResourceRef {
        readonly schemaVersion: 0;
        readonly kind: ResourceKind;
        readonly id: string;
        readonly displayName?: string;
        readonly provenance: ResourceProvenance;
        readonly createdAt: number;
}

// ---------------------------------------------------------------------------
// Surfaces (DL-32: the per-family shapes)
// ---------------------------------------------------------------------------

export interface BrowserSurface {
        readonly kind: 'browser';
        readonly cdpEndpoint?: string;
        readonly partition?: string;
        readonly tabIds?: readonly string[];
}

export interface EnvironmentSurface {
        readonly kind: 'environment';
        readonly descriptorId: string;
        readonly providerKind: string;
        readonly attachTarget?: string;
}

export interface FileSystemSurface {
        readonly kind: 'file-system';
        readonly root: string;
        readonly path: string;
        readonly contentSha256?: string;
}

export type Surface = BrowserSurface | EnvironmentSurface | FileSystemSurface | { readonly kind: string };

export interface SurfaceVersion {
        readonly surface: Surface;
        readonly provenance: ResourceProvenance;
        readonly updatedAt: number;
}

export interface SurfaceRecord {
        readonly refId: string;
        readonly family: string;
        readonly versions: readonly SurfaceVersion[];
}

// ---------------------------------------------------------------------------
// Edges (DL-32: the legal-kind matrix)
// ---------------------------------------------------------------------------

export const EDGE_KINDS = ['depends-on', 'produced', 'bound-to', 'restored-from', 'snapshot-of', 'derived-from'] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

export interface GraphEdge {
        readonly kind: EdgeKind;
        readonly from: string;
        readonly to: string;
        readonly provenance: ResourceProvenance;
        readonly createdAt: number;
}

export interface ResourcesEnvelope {
        readonly $schema: string;
        readonly nodes: readonly ResourceRef[];
        readonly edges: readonly GraphEdge[];
        readonly surfaces: readonly SurfaceRecord[];
}

// ---------------------------------------------------------------------------
// Strict parsers (fail-closed; typed TaskResourceError on shape violations)
// ---------------------------------------------------------------------------

function parseError(message: string): TaskResourceError {
        return new TaskResourceError('OP_INVALID', `resources graph parse: ${message}`);
}

export function parseResourceRef(value: unknown, where = 'ref'): ResourceRef {
        if (!isPlainObject(value)) {
                throw parseError(`${where} must be a plain object`);
        }
        if (!hasOnlyKeys(value, ['schemaVersion', 'kind', 'id', 'provenance', 'createdAt'], ['displayName'])) {
                throw parseError(`${where} must have exactly the keys [schemaVersion, kind, id, provenance, createdAt] + optional [displayName]`);
        }
        if (value.schemaVersion !== 0) {
                throw parseError(`${where}.schemaVersion must be exactly 0 (got ${JSON.stringify(value.schemaVersion)})`);
        }
        if (!isResourceKind(value.kind)) {
                throw parseError(`${where}.kind must be one of ${RESOURCE_KINDS.join('|')}`);
        }
        if (typeof value.id !== 'string' || !isResourceRefId(value.id)) {
                throw parseError(`${where}.id must be a URN 'flauz:<kind-namespace>:<16-hex-or-slug>' (got ${JSON.stringify(value.id)})`);
        }
        const parsed = parseResourceUrn(value.id);
        if (parsed === undefined || parsed.kind !== value.kind) {
                throw parseError(`${where}.id namespace does not match kind '${value.kind}' (got ${JSON.stringify(value.id)})`);
        }
        if (value.displayName !== undefined && !isBoundedString(value.displayName, 200)) {
                throw parseError(`${where}.displayName must be a non-empty string of at most 200 chars`);
        }
        if (!isPlainObject(value.provenance) || !hasOnlyKeys(value.provenance, ['actor'], ['actorId', 'sessionId', 'taskId', 'cause'])) {
                throw parseError(`${where}.provenance must have the keys [actor] + optional [actorId, sessionId, taskId, cause]`);
        }
        if (typeof value.provenance.actor !== 'string' || !(ACTORS as readonly string[]).includes(value.provenance.actor)) {
                throw parseError(`${where}.provenance.actor must be one of agent|human|tool`);
        }
        if (!isPositiveEpochMs(value.createdAt)) {
                throw parseError(`${where}.createdAt must be a positive epoch-ms integer`);
        }
        // defense-in-depth: a vault-only policy surface silently containing a
        // secret-shaped literal is a contract violation, never a carryable state
        if (looksSecretShaped(canonicalJson(value))) {
                throw parseError(`${where} payload contains secret-shaped text -- vault-only policy surfaces may carry only vault-style references, never literal credentials`);
        }
        return value as unknown as ResourceRef;
}

export function parseResourcesEnvelope(raw: string): ResourcesEnvelope {
        let value: unknown;
        try {
                value = JSON.parse(raw);
        } catch (err) {
                throw parseError(`resources.json is not valid JSON -- ${err instanceof Error ? err.message : String(err)}`);
        }
        if (!isPlainObject(value) || !hasOnlyKeys(value, ['$schema', 'nodes', 'edges', 'surfaces'], [])) {
                throw parseError('resources envelope must have exactly the keys [$schema, nodes, edges, surfaces]');
        }
        if (typeof value.$schema !== 'string' || value.$schema !== RESOURCES_SCHEMA_ID) {
                throw parseError(`resources envelope $schema must be '${RESOURCES_SCHEMA_ID}' (got ${JSON.stringify(value.$schema)})`);
        }
        if (!Array.isArray(value.nodes)) {
                throw parseError('resources envelope nodes must be an array');
        }
        const nodes: ResourceRef[] = [];
        for (const [index, ref] of value.nodes.entries()) {
                nodes.push(parseResourceRef(ref, `nodes[${index}]`));
        }
        return { $schema: value.$schema, nodes, edges: value.edges as readonly GraphEdge[], surfaces: value.surfaces as readonly SurfaceRecord[] };
}

// ---------------------------------------------------------------------------
// Edge minting (PURE: the graph WRITE stays with flauz-resources at runtime)
// ---------------------------------------------------------------------------

/**
 * Mints the attribution-carrying task->resource edge record for the lease.
 * PURE: returns the typed record; does NOT write to the graph. The
 * orchestrator dispatches the edge through the resources mutation port.
 *
 * Edge kind: `depends-on` -- a legal endpoint combination under the
 * resources/v0 matrix (`from: ['task', 'workflow', ...]` `to: '*'`).
 *
 * `provenance` is the lease's actor (fail-closed: MANDATORY).
 */
export function edgeFor(taskId: string, refId: string, provenance: ResourceProvenance, now: number): GraphEdge {
        if (typeof taskId !== 'string' || !/^T-\d{3,}$/.test(taskId)) {
                throw new TaskResourceError('TASK_ID_INVALID', `edgeFor: taskId must match 'T-<3+ digits>' (got ${JSON.stringify(taskId)})`);
        }
        if (typeof refId !== 'string' || !isResourceRefId(refId)) {
                throw new TaskResourceError('OP_INVALID', `edgeFor: refId must be a ResourceRef URN (got ${JSON.stringify(refId)})`);
        }
        if (!isPlainObject(provenance) || typeof provenance.actor !== 'string' || !(ACTORS as readonly string[]).includes(provenance.actor)) {
                throw new TaskResourceError('PROVENANCE_INVALID', `edgeFor: provenance.actor must be one of agent|human|tool (got ${JSON.stringify(provenance?.actor)})`);
        }
        if (!isPositiveEpochMs(now)) {
                throw new TaskResourceError('OP_INVALID', `edgeFor: now must be a positive epoch-ms integer (got ${JSON.stringify(now)})`);
        }
        return {
                kind: 'depends-on',
                from: `flauz:task:${taskId}`,
                to: refId,
                provenance,
                createdAt: now,
        };
}

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

export interface ResourceRefAdapterOptions {
        readonly workspaceRoot: string;
        readonly fs: FileSystemPort;
        readonly clock?: Clock;
}

/** The acquisition result (typed; never a raw throw). */
export type ResourceRefAcquireResult =
        | {
                readonly ok: true;
                readonly ref: ResourceRef;
                readonly snapshot: TaskResourceSurfaceSnapshot;
                readonly secretShaped: boolean;
        }
        | { readonly ok: false; readonly error: TaskResourceFailure };

/** The release result (typed; idempotent). */
export type ResourceRefReleaseResult =
        | { readonly ok: true; readonly idempotent: boolean }
        | { readonly ok: false; readonly error: TaskResourceFailure };

/**
 * The ResourceRef graph read-only adapter. Owns:
 *   - graph envelope loading + strict parsing;
 *   - acquire (existence + secret-kind vault-only posture);
 *   - release (idempotent; the obligation is at the task-graph level only).
 *
 * NEVER mutates `.flauz/resources.json` or `.flauz/resources-ops.jsonl`.
 * Edge minting is PURE -- the graph WRITE stays with flauz-resources.
 */
export class ResourceRefAdapter {
        private readonly workspaceRoot: string;
        private readonly fs: FileSystemPort;
        private readonly clock: Clock;

        constructor(options: ResourceRefAdapterOptions) {
                this.workspaceRoot = options.workspaceRoot;
                this.fs = options.fs;
                this.clock = options.clock ?? (() => Date.now());
        }

        get graphPath(): string {
                return joinPath(this.workspaceRoot, GRAPH_PATH);
        }

        get opsPath(): string {
                return joinPath(this.workspaceRoot, RESOURCES_OPS_PATH);
        }

        /** Loads + validates the graph envelope; missing file => empty graph. */
        async loadGraph(): Promise<ResourcesEnvelope> {
                const raw = await this.fs.readFileUtf8(this.graphPath);
                if (raw === undefined || raw.trim().length === 0) {
                        return { $schema: RESOURCES_SCHEMA_ID, nodes: [], edges: [], surfaces: [] };
                }
                return parseResourcesEnvelope(raw);
        }

        /** The ResourceRef for `refId`, or `undefined` if absent. */
        async refFor(refId: string): Promise<ResourceRef | undefined> {
                const graph = await this.loadGraph();
                return graph.nodes.find(node => node.id === refId);
        }

        /** The latest surface version for `refId` in `family`, or `undefined`. */
        async surfaceFor(refId: string, family: string): Promise<SurfaceVersion | undefined> {
                const graph = await this.loadGraph();
                const record = graph.surfaces.find(rec => rec.refId === refId && rec.family === family);
                if (record === undefined || record.versions.length === 0) {
                        return undefined;
                }
                return record.versions[record.versions.length - 1];
        }

        /**
         * Acquire: the ResourceRef MUST exist; SECRET-KIND refs are VAULT-ONLY --
         * the lease carries the ref id + surface version, NEVER any secret payload
         * (the no-flattening law).
         */
        async acquire(refId: string, _actor: TaskResourceActor): Promise<ResourceRefAcquireResult> {
                if (typeof refId !== 'string' || !isResourceRefId(refId)) {
                        return { ok: false, error: failure('RESOURCE_ABSENT', `refId must be a ResourceRef URN 'flauz:<kind-namespace>:<16-hex-or-slug>' (got ${JSON.stringify(refId)})`) };
                }
                const ref = await this.refFor(refId);
                if (ref === undefined) {
                        return { ok: false, error: failure('RESOURCE_ABSENT', `resource ref ${refId} not found in the graph (no canonical ResourceRef with that id)`) };
                }
                const secretShaped = SECRET_KINDS.includes(ref.kind);
                const surfaceVersion = await this.surfaceFor(refId, surfaceFamilyOfKind(ref.kind));
                const snapshot: TaskResourceSurfaceSnapshot = {
                        kind: 'resource-ref',
                        refKind: ref.kind,
                        ...(surfaceVersion !== undefined ? { surfaceVersion: surfaceVersion.updatedAt } : {}),
                        ...(secretShaped ? { secretShaped: true } : {}),
                };
                return { ok: true, ref, snapshot, secretShaped };
        }

        /** Release: idempotent (the obligation is at the task-graph level only). */
        async release(_refId: string): Promise<ResourceRefReleaseResult> {
                // the ResourceRef itself is never torn down by the lease -- the
                // lease is the task-graph obligation; the actual resource lifecycle
                // (file delete, etc.) belongs to the orchestrator through the op port
                return { ok: true, idempotent: true };
        }
}

/** Maps a ResourceKind to its surface family (DL-32: the per-kind family map). */
function surfaceFamilyOfKind(kind: ResourceKind): string {
        switch (kind) {
                case 'browser-session': return 'browser';
                case 'environment': return 'environment';
                case 'file': return 'file-system';
                case 'directory': return 'file-system';
                case 'artifact': return 'file-system';
                case 'evidence': return 'file-system';
                default: return kind;
        }
}

export { canonicalJson, isPlainObject, isPositiveEpochMs, isBoundedString, hasKey, hasOnlyKeys, hasExactKeys };
