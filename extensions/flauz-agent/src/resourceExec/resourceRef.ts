/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-S2 -- the flauz-resources graph read-only lease adapter.
 *
 * Over `.flauz/resources.json` (envelope `flauz.resources/v0`, the logical
 * resource graph) plus `.flauz/resources-ops.jsonl` (the provenance ops
 * ledger, consumed as ADVISORY audit context with per-line typed skips --
 * fail-closed per line, never a crash; the journalBridge read discipline).
 * The graph envelope is the durable truth for ref existence and surface
 * versions; both files are consumed READ-ONLY, never modified. The graph
 * WRITE stays with flauz-resources at runtime: this adapter mints edge
 * RECORDS via a pure function, it never calls graph.addEdge.
 *
 * THE NO-FLATTENING LAW (ARCHITECTURE-LOCK Pillar 3: identity is not
 * access): a resource-ref lease carries the ref's LOGICAL id plus the
 * CURRENT SURFACE VERSION -- never any secret payload. The resources graph
 * itself is secret-free by schema (vault-only policy surfaces); as
 * defense-in-depth every lease built here is deep-scanned for secret-shaped
 * literals before it can be committed to the ledger (contracts.ts
 * acquireLease -> SECRET_IN_LEASE, fail-closed). SECRET-KIND refs are
 * VAULT-ONLY: a lease never dereferences a vault reference and never
 * carries the referenced material.
 *
 * Surface identity vs versioning: a graph surface version ADVANCING (same
 * family, new version) is a legal access-surface change -- identity
 * survives (the SurfaceRecord retains prior versions). A SURFACE_MISMATCH
 * is only the identity change: the ref's family SET changing since
 * acquisition.
 */
import {
	canonicalJson,
	hasKey,
	hasOnlyKeys,
	isPlainObject,
	isPositiveEpochMs,
	isSurfaceFamily,
	joinPath,
	parseResourceUrn,
	type Clock,
	type FileSystemPort,
	type LeaseProvenance,
	type LeaseSurfaceSnapshot,
	type SurfaceFamily,
} from './types.ts';
import type { AcquisitionVerdict, ReleaseVerdict, ResourceLeaseAdapter, SurfaceCheckVerdict } from './contracts.ts';

/** Graph envelope path, relative to the workspace root. */
export const GRAPH_PATH = '.flauz/resources.json';

/** Ops ledger path, relative to the workspace root (advisory consumption). */
export const OPS_PATH = '.flauz/resources-ops.jsonl';

/** Graph envelope schema id. */
export const RESOURCES_SCHEMA_ID = 'flauz.resources/v0';

/** Ops ledger line schema id. */
export const RESOURCES_OPS_SCHEMA_ID = 'flauz.resources-ops/v0';

/** The contract-duplicated surface families + ref kinds (DL-32). */
export const RESOURCE_KINDS = [
	'file', 'directory', 'task', 'agent-session', 'browser-session', 'environment',
	'artifact', 'evidence', 'model', 'provider', 'workflow', 'workspace',
] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

const KIND_NAMESPACES: Readonly<Record<ResourceKind, string>> = {
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

const RESOURCE_OPS = ['add-ref', 'update-ref', 'remove-ref', 'add-surface', 'add-edge', 'remove-edge', 'restore'] as const;

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

// ---------------------------------------------------------------------------
// The duplicated record shapes (strict, contract-pinned)
// ---------------------------------------------------------------------------

/** The contract-duplicated ResourceRef (logical identity ONLY). */
export interface ResourceRefNode {
	readonly schemaVersion: 0;
	readonly kind: ResourceKind;
	readonly id: string;
	readonly createdAt: number;
}

/** One version of a ref's access surface (the prior surface is retained). */
export interface SurfaceVersionNode {
	readonly surface: Readonly<Record<string, unknown>>;
	readonly updatedAt: number;
}

/** A ref's versioned surface record for ONE family (versions[last] is current). */
export interface SurfaceRecordNode {
	readonly refId: string;
	readonly family: string;
	readonly versions: readonly SurfaceVersionNode[];
}

/** The `.flauz/resources.json` envelope (the consumed projection). */
export interface ResourcesGraphEnvelope {
	readonly $schema: string;
	readonly nodes: readonly ResourceRefNode[];
	readonly edges: readonly { readonly kind: string; readonly from: string; readonly to: string; readonly createdAt: number }[];
	readonly surfaces: readonly SurfaceRecordNode[];
}

/** One advisory ops-ledger line result (typed skips). */
export type ResourceOpsLineResult = { readonly ok: true; readonly record: { readonly op: string; readonly refId: string; readonly ts: number; readonly actor: string } } | { readonly ok: false; readonly reason: string };

function isResourceUrnForKind(value: unknown, kind: ResourceKind): value is string {
	if (typeof value !== 'string') {
		return false;
	}
	const parsed = parseResourceUrn(value);
	return parsed !== undefined && parsed.namespace === KIND_NAMESPACES[kind];
}

/** Parses the graph envelope (strict on the consumed projection; DL-32). */
export function parseResourcesGraph(raw: string): ResourcesGraphEnvelope {
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch (err) {
		throw new Error(`the resources graph is not valid JSON -- ${err instanceof Error ? err.message : String(err)}`);
	}
	if (!isPlainObject(value) || !hasOnlyKeys(value, ['$schema', 'nodes', 'edges', 'surfaces'], [])) {
		throw new Error('the resources graph must be an object with exactly the keys [$schema, nodes, edges, surfaces] (flauz.resources/v0)');
	}
	if (value['$schema'] !== RESOURCES_SCHEMA_ID) {
		throw new Error(`the resources graph $schema must be exactly '${RESOURCES_SCHEMA_ID}' (got ${JSON.stringify(value['$schema'])})`);
	}
	if (!Array.isArray(value['nodes'])) {
		throw new Error('the resources graph nodes must be an array of ResourceRefs');
	}
	const nodes: ResourceRefNode[] = [];
	for (const [index, node] of (value['nodes'] as readonly unknown[]).entries()) {
		if (!isPlainObject(node) || !hasOnlyKeys(node, ['schemaVersion', 'kind', 'id', 'provenance', 'createdAt'], ['displayName'])) {
			throw new Error(`nodes[${index}] must have the keys [schemaVersion, kind, id, provenance, createdAt] + optional [displayName]`);
		}
		if (node['schemaVersion'] !== 0) {
			throw new Error(`nodes[${index}].schemaVersion must be exactly 0`);
		}
		if (typeof node['kind'] !== 'string' || !(RESOURCE_KINDS as readonly string[]).includes(node['kind'])) {
			throw new Error(`nodes[${index}].kind must be one of ${RESOURCE_KINDS.join('|')} (got ${JSON.stringify(node['kind'])})`);
		}
		const kind = node['kind'] as ResourceKind;
		if (typeof node['id'] !== 'string' || !isResourceUrnForKind(node['id'], kind)) {
			throw new Error(`nodes[${index}].id must be a URN 'flauz:${KIND_NAMESPACES[kind]}:<16-hex-or-slug>' whose namespace matches the ref kind '${kind}' (got ${JSON.stringify(node['id'])}) -- a ResourceRef NEVER carries a filesystem path, URL or endpoint`);
		}
		if (!isPositiveEpochMs(node['createdAt'])) {
			throw new Error(`nodes[${index}].createdAt must be a positive epoch-ms integer`);
		}
		if (!isPlainObject(node['provenance']) || typeof node['provenance']['actor'] !== 'string' || !['agent', 'human', 'tool'].includes(node['provenance']['actor'])) {
			throw new Error(`nodes[${index}].provenance must carry a mandatory actor (agent|human|tool)`);
		}
		nodes.push({ schemaVersion: 0, kind, id: node['id'], createdAt: node['createdAt'] });
	}
	if (!Array.isArray(value['edges'])) {
		throw new Error('the resources graph edges must be an array');
	}
	const edges: { kind: string; from: string; to: string; createdAt: number }[] = [];
	for (const [index, edge] of (value['edges'] as readonly unknown[]).entries()) {
		if (!isPlainObject(edge) || !hasOnlyKeys(edge, ['kind', 'from', 'to', 'provenance', 'createdAt'], [])) {
			throw new Error(`edges[${index}] must have the keys [kind, from, to, provenance, createdAt]`);
		}
		if (typeof edge['kind'] !== 'string' || !['depends-on', 'produced', 'bound-to', 'restored-from', 'snapshot-of', 'derived-from'].includes(edge['kind'])) {
			throw new Error(`edges[${index}].kind must be a flauz.resources/v0 edge kind`);
		}
		if (typeof edge['from'] !== 'string' || typeof edge['to'] !== 'string' || edge['from'].length === 0 || edge['to'].length === 0) {
			throw new Error(`edges[${index}].from/to must be non-empty ref ids`);
		}
		if (!isPositiveEpochMs(edge['createdAt'])) {
			throw new Error(`edges[${index}].createdAt must be a positive epoch-ms integer`);
		}
		edges.push({ kind: edge['kind'], from: edge['from'], to: edge['to'], createdAt: edge['createdAt'] });
	}
	if (!Array.isArray(value['surfaces'])) {
		throw new Error('the resources graph surfaces must be an array of surface records');
	}
	const surfaces: SurfaceRecordNode[] = [];
	for (const [index, record] of (value['surfaces'] as readonly unknown[]).entries()) {
		if (!isPlainObject(record) || !hasOnlyKeys(record, ['refId', 'family', 'versions'], [])) {
			throw new Error(`surfaces[${index}] must have the keys [refId, family, versions]`);
		}
		if (typeof record['refId'] !== 'string' || record['refId'].length === 0) {
			throw new Error(`surfaces[${index}].refId must be a non-empty ref id`);
		}
		if (!isSurfaceFamily(record['family'])) {
			throw new Error(`surfaces[${index}].family must be one of the flauz.resources/v0 surface families (got ${JSON.stringify(record['family'])})`);
		}
		if (!Array.isArray(record['versions']) || record['versions'].length === 0) {
			throw new Error(`surfaces[${index}].versions must be a non-empty array (the prior surface is retained on change -- identity survives access-surface change)`);
		}
		const versions: SurfaceVersionNode[] = [];
		for (const [vIndex, version] of (record['versions'] as readonly unknown[]).entries()) {
			if (!isPlainObject(version) || !hasOnlyKeys(version, ['surface', 'provenance', 'updatedAt'], [])) {
				throw new Error(`surfaces[${index}].versions[${vIndex}] must have the keys [surface, provenance, updatedAt]`);
			}
			if (!isPlainObject(version['surface']) || version['surface']['kind'] !== record['family']) {
				throw new Error(`surfaces[${index}].versions[${vIndex}].surface.kind must equal the record family '${record['family']}'`);
			}
			if (!isPositiveEpochMs(version['updatedAt'])) {
				throw new Error(`surfaces[${index}].versions[${vIndex}].updatedAt must be a positive epoch-ms integer`);
			}
			if (!isPlainObject(version['provenance']) || typeof version['provenance']['actor'] !== 'string' || !['agent', 'human', 'tool'].includes(version['provenance']['actor'])) {
				throw new Error(`surfaces[${index}].versions[${vIndex}].provenance must carry a mandatory actor (agent|human|tool)`);
			}
			versions.push({ surface: version['surface'] as Readonly<Record<string, unknown>>, updatedAt: version['updatedAt'] });
		}
		surfaces.push({ refId: record['refId'], family: record['family'], versions });
	}
	return { $schema: RESOURCES_SCHEMA_ID, nodes, edges, surfaces };
}

/** Validates ONE advisory ops line (per-line typed skips). */
export function parseResourceOpsLine(line: string): ResourceOpsLineResult {
	let value: unknown;
	try {
		value = JSON.parse(line);
	} catch (err) {
		return { ok: false, reason: `not valid JSON -- ${err instanceof Error ? err.message : String(err)}` };
	}
	if (!isPlainObject(value)) {
		return { ok: false, reason: 'record must be a JSON object (flauz.resources-ops/v0)' };
	}
	if (value['schema'] !== RESOURCES_OPS_SCHEMA_ID && value['schemaVersion'] !== 0) {
		return { ok: false, reason: `record must carry schema 'flauz.resources-ops/v0'` };
	}
	if (!hasKey(value, 'actor') || typeof value['actor'] !== 'string' || !['agent', 'human', 'tool'].includes(value['actor'])) {
		return { ok: false, reason: 'actor is MISSING or unknown -- the actor (agent|human|tool) is MANDATORY on every recorded mutation' };
	}
	if (typeof value['op'] !== 'string' || !(RESOURCE_OPS as readonly string[]).includes(value['op'])) {
		return { ok: false, reason: `op must be one of ${RESOURCE_OPS.join('|')}` };
	}
	if (typeof value['refId'] !== 'string' || value['refId'].length === 0) {
		return { ok: false, reason: 'refId must be a non-empty ref id' };
	}
	if (!isPositiveEpochMs(value['ts'])) {
		return { ok: false, reason: 'ts must be a positive epoch-ms integer' };
	}
	return { ok: true, record: { op: value['op'], refId: value['refId'], ts: value['ts'], actor: value['actor'] } };
}

// ---------------------------------------------------------------------------
// Edge minting (PURE; the graph WRITE stays with flauz-resources at runtime)
// ---------------------------------------------------------------------------

/** The attribution-carrying task->resource edge record (GraphEdge minus createdAt -- the graph mints it). */
export interface TaskResourceEdgeRecord {
	readonly kind: 'depends-on';
	readonly from: string;
	readonly to: string;
	readonly provenance: LeaseProvenance;
}

/**
 * Mints the attribution-carrying task->resource edge record: a `depends-on`
 * edge from the task's graph ref (`flauz:task:<taskId>`) to the resource ref.
 * PURE function -- it performs no graph mutation; writing the edge (with
 * endpoint-existence + legality + provenance validation and the ops-ledger
 * record) stays with flauz-resources at runtime (graph.addEdge).
 */
export function taskResourceEdge(input: { readonly taskId: string; readonly refId: string; readonly provenance: LeaseProvenance }): TaskResourceEdgeRecord | { readonly error: string } {
	if (!/^T-\d{3,}$/.test(input.taskId)) {
		return { error: `taskId must match the flauz-workspace task-id pattern 'T-<3+ digits>' (got ${JSON.stringify(input.taskId)})` };
	}
	const parsed = parseResourceUrn(input.refId);
	if (parsed === undefined) {
		return { error: `refId must be a ResourceRef URN 'flauz:<namespace>:<16-hex-or-slug>' (got ${JSON.stringify(input.refId)}) -- never a path, never a URL` };
	}
	return { kind: 'depends-on', from: `flauz:task:${input.taskId}`, to: input.refId, provenance: input.provenance };
}

// ---------------------------------------------------------------------------
// The adapter (read-only over the canonical graph)
// ---------------------------------------------------------------------------

export interface ResourceRefLeaseAdapterOptions {
	readonly root: string;
	readonly fs: FileSystemPort;
	readonly clock?: Clock;
}

/** The resource-ref lease adapter (identity + surface version, never payloads). */
export class ResourceRefLeaseAdapter implements ResourceLeaseAdapter {
	readonly kind = 'resource-ref' as const;

	private readonly root: string;
	private readonly fs: FileSystemPort;

	constructor(options: ResourceRefLeaseAdapterOptions) {
		this.root = options.root;
		this.fs = options.fs;
	}

	private async readGraph(): Promise<ResourcesGraphEnvelope | undefined> {
		const raw = await this.fs.readFileUtf8(joinPath(this.root, GRAPH_PATH));
		if (raw === undefined || raw.trim().length === 0) {
			return undefined; // a missing graph loads as empty (every ref is absent)
		}
		return parseResourcesGraph(raw);
	}

	private async readOps(): Promise<{ records: readonly { op: string; refId: string; ts: number; actor: string }[]; skipped: number }> {
		const raw = await this.fs.readFileUtf8(joinPath(this.root, OPS_PATH));
		if (raw === undefined || raw.trim().length === 0) {
			return { records: [], skipped: 0 };
		}
		const lines = raw.split('\n');
		const body = lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines;
		const records: { op: string; refId: string; ts: number; actor: string }[] = [];
		let skipped = 0;
		for (const line of body) {
			if (line.trim().length === 0) {
				skipped++;
				continue;
			}
			const parsed = parseResourceOpsLine(line);
			if (parsed.ok) {
				records.push(parsed.record);
			} else {
				skipped++;
			}
		}
		return { records, skipped };
	}

	private snapshotOf(graph: ResourcesGraphEnvelope, refId: string): LeaseSurfaceSnapshot {
		const surfaces = graph.surfaces
			.filter(record => record.refId === refId)
			.map(record => ({ family: record.family as SurfaceFamily, version: record.versions.length, surface: record.versions[record.versions.length - 1]!.surface }));
		return { surfaces };
	}

	async acquire(taskId: string, refId: string, actor: LeaseProvenance): Promise<AcquisitionVerdict> {
		let graph: ResourcesGraphEnvelope | undefined;
		try {
			graph = await this.readGraph();
		} catch (err) {
			return { ok: false, code: 'STATE_UNREADABLE', message: err instanceof Error ? err.message : String(err) };
		}
		if (graph === undefined) {
			return { ok: false, code: 'RESOURCE_ABSENT', message: `no resource graph exists (.flauz/resources.json is absent or empty) -- ref '${refId}' cannot be leased` };
		}
		const node = graph.nodes.find(candidate => candidate.id === refId);
		if (node === undefined) {
			return { ok: false, code: 'RESOURCE_ABSENT', message: `no ResourceRef '${refId}' exists in the graph (the graph holds ${graph.nodes.length} ref(s)) -- the lease binds a registered logical id` };
		}
		const ops = await this.readOps();
		const lastOp = ops.records.filter(record => record.refId === refId).slice(-1)[0];
		return {
			ok: true,
			surfaceSnapshot: this.snapshotOf(graph, refId),
			...(lastOp !== undefined ? { notes: [`ref kind '${node.kind}'; surface version(s) pinned; last recorded op '${lastOp.op}' by ${lastOp.actor}${ops.skipped > 0 ? `; ${ops.skipped} ops line(s) skipped as invalid (typed skips)` : ''}`] } : { notes: [`ref kind '${node.kind}'; surface version(s) pinned`] }),
		};
	}

	async release(taskId: string, refId: string, actor: LeaseProvenance): Promise<ReleaseVerdict> {
		let graph: ResourcesGraphEnvelope | undefined;
		try {
			graph = await this.readGraph();
		} catch (err) {
			return { ok: false, code: 'STATE_UNREADABLE', message: err instanceof Error ? err.message : String(err) };
		}
		if (graph === undefined) {
			return { ok: true, outcome: 'closed-elsewhere', observed: 'no resource graph exists anymore -- the obligation is discharged; no graph mutation is claimed' };
		}
		const node = graph.nodes.find(candidate => candidate.id === refId);
		if (node === undefined) {
			return { ok: true, outcome: 'closed-elsewhere', observed: `ref '${refId}' no longer exists in the graph (removed since acquisition) -- the obligation is discharged; no graph mutation is claimed` };
		}
		return { ok: true, outcome: 'clean', observed: `ref '${refId}' present (kind '${node.kind}'); graph mutations (edge writes, surface versions) belong to flauz-resources at runtime -- this adapter claims none (resource access has no single command port in v0; the surface record is the access truth)` };
	}

	async verifySurface(taskId: string, refId: string, snapshot: LeaseSurfaceSnapshot): Promise<SurfaceCheckVerdict> {
		let graph: ResourcesGraphEnvelope | undefined;
		try {
			graph = await this.readGraph();
		} catch (err) {
			return { ok: false, code: 'STATE_UNREADABLE', message: err instanceof Error ? err.message : String(err) };
		}
		if (graph === undefined) {
			return { ok: false, code: 'RESOURCE_ABSENT', message: `no resource graph exists -- ref '${refId}' cannot be verified` };
		}
		const node = graph.nodes.find(candidate => candidate.id === refId);
		if (node === undefined) {
			return { ok: false, code: 'RESOURCE_ABSENT', message: `no ResourceRef '${refId}' exists in the graph (removed since acquisition)` };
		}
		const current = this.snapshotOf(graph, refId);
		const pinnedFamilies = snapshot.surfaces.map(entry => entry.family).sort();
		const currentFamilies = current.surfaces.map(entry => entry.family).sort();
		if (canonicalJson(pinnedFamilies) !== canonicalJson(currentFamilies)) {
			return { ok: false, code: 'SURFACE_MISMATCH', message: `ref '${refId}' changed surface identity since acquisition (pinned families [${pinnedFamilies.join(', ')}], current families [${currentFamilies.join(', ')}]) -- the family set of the leased ref changed (a same-family version advance is legal: identity survives access-surface change)` };
		}
		return { ok: true, current };
	}
}
