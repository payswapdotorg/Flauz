/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The Flauz resource graph (v0): nodes (refs) + edges + (versioned, per-family)
 * surface records, persisted at `.flauz/resources.json` with the DL-9/DL-32
 * sibling-envelope discipline (canonical serialization, atomic tmp+rename
 * writes, stable-sorted output).
 *
 * Mutation protocol (every mutation, no exceptions):
 *   1. validate the input (schema + secret-shape scan + fail-closed provenance);
 *   2. apply to the in-memory envelope;
 *   3. persist the envelope atomically (tmp + rename);
 *   4. append a record to the provenance ops ledger (`.flauz/resources-ops.jsonl`)
 *      carrying the before/after state digests.
 *
 * Identity-vs-access law, enforced here: `addSurface` on an existing
 * (refId, family) appends a NEW VERSION (the prior surface is retained) -- the
 * ref id never changes when an access surface moves (path move, endpoint
 * swap). `removeRef` refuses while edges or surfaces reference the node, with
 * a typed error listing them.
 */
import {
	FLAUZ_DIR,
	GRAPH_PATH,
	SCHEMA_ID,
	ResourceGraphError,
	canonicalJson,
	clone,
	edgeClosesCycle,
	findEdgeCycle,
	isEdgeKind,
	isPlainObject,
	hasKey,
	joinPath,
	serializeEnvelope,
	validateEdge,
	validateProvenance,
	validateResourceRef,
	validateSurface,
	validateSurfaceRecord,
	edgeLegalityError,
	isEdgeLegalForKinds,
	isResourceUrnForKind,
	type Clock,
	type EdgeInput,
	type EdgeKind,
	type FileSystemPort,
	type GraphEdge,
	type ResourceKind,
	type ResourceProvenance,
	type RefInput,
	type ResourceRef,
	type ResourcesEnvelope,
	type Surface,
	type SurfaceFamily,
	type SurfaceRecord,
	type SurfaceVersion,
} from './api.ts';
import { ProvenanceLedger, envelopeDigest, type ResourceOp, type ResourceOpRecord } from './provenance.ts';

export interface ResourceGraphOptions {
	readonly root: string;
	readonly fs: FileSystemPort;
	readonly clock?: Clock;
}

/** A neighbor link returned by `neighbors()`. */
export interface NeighborLink {
	readonly ref: ResourceRef;
	readonly edgeKind: EdgeKind;
	readonly direction: 'out' | 'in';
}

/** One integrity problem found by `verifyEnvelope` / `verifyWorkspace`. */
export interface VerifyProblem {
	readonly code: string;
	readonly path: string;
	readonly message: string;
}

export interface VerifyReport {
	readonly ok: boolean;
	readonly nodes: number;
	readonly edges: number;
	readonly surfaces: number;
	readonly problems: readonly VerifyProblem[];
}

export interface WorkspaceVerifyReport {
	readonly envelope: VerifyReport;
	/** Present when the ops ledger exists; absent (with a note) on seeded/fixture workspaces. */
	readonly ops: { ok: boolean; records: number; problems: readonly { line: number; message: string }[] } | undefined;
	readonly opsNote?: string;
}

const EMPTY_ENVELOPE: ResourcesEnvelope = { $schema: SCHEMA_ID, nodes: [], edges: [], surfaces: [] };

function problem(code: string, path: string, message: string): VerifyProblem {
	return { code, path, message };
}

export class ResourceGraph {
	private readonly root: string;
	private readonly fs: FileSystemPort;
	private readonly clock: Clock;
	private readonly ledger: ProvenanceLedger;
	private state: ResourcesEnvelope | undefined;
	/**
	 * The DL-77 serialized-mutation discipline (the transition lock): graph
	 * mutations are STRICTLY serial. Concurrent callers queue here -- two
	 * interleaved commits would race on the shared `.tmp` path, lose the
	 * earlier mutation's envelope write and fork the ops digest chain.
	 */
	private transitionLock: Promise<unknown> = Promise.resolve();

	constructor(options: ResourceGraphOptions) {
		this.root = options.root;
		this.fs = options.fs;
		this.clock = options.clock ?? (() => Date.now());
		this.ledger = new ProvenanceLedger({ root: options.root, fs: options.fs, clock: this.clock });
	}

	/** Runs `operation` strictly serially against every other mutation (DL-77). */
	private runSerial<T>(operation: () => Promise<T>): Promise<T> {
		const prior = this.transitionLock;
		let release: () => void = () => undefined;
		this.transitionLock = new Promise<void>(resolve => {
			release = resolve;
		});
		return prior.then(async () => {
			try {
				return await operation();
			} finally {
				release();
			}
		});
	}

	/** The workspace root this graph is bound to. */
	get workspaceRoot(): string {
		return this.root;
	}

	/** The filesystem port (shared with continuity for sibling-state reads). */
	get port(): FileSystemPort {
		return this.fs;
	}

	/** Absolute path of the graph envelope file. */
	get filePath(): string {
		return joinPath(this.root, GRAPH_PATH);
	}

	/** Loads + validates the envelope, or creates the empty one. Idempotent. */
	async bootstrap(): Promise<ResourcesEnvelope> {
		if (this.state !== undefined) {
			return this.state;
		}
		return await this.runSerial(async () => {
			if (this.state !== undefined) {
				return this.state;
			}
			await this.fs.mkdir(joinPath(this.root, FLAUZ_DIR));
			const raw = await this.fs.readFileUtf8(this.filePath);
			if (raw === undefined) {
				this.state = clone(EMPTY_ENVELOPE);
				await this.persist();
				await this.ledger.ensure();
				return this.state;
			}
			this.state = ResourceGraph.parseEnvelope(raw);
			return this.state;
		});
	}

	/** Validates + parses a graph document (used by bootstrap, tests + the canary). */
	static parseEnvelope(raw: string): ResourcesEnvelope {
		let value: unknown;
		try {
			value = JSON.parse(raw);
		} catch (err) {
			throw new ResourceGraphError('FLAUZ_RESOURCES_PERSIST', `flauz.resources/v0: graph is not valid JSON -- ${(err as Error).message}`);
		}
		if (!isPlainObject(value)) {
			throw new ResourceGraphError('FLAUZ_RESOURCES_PERSIST', 'flauz.resources/v0: graph must be a JSON object');
		}
		const keys = Object.keys(value);
		if (!keys.every(key => ['$schema', 'nodes', 'edges', 'surfaces'].includes(key)) || keys.length !== 4) {
			throw new ResourceGraphError('FLAUZ_RESOURCES_PERSIST', `flauz.resources/v0: graph must have exactly the keys [$schema, nodes, edges, surfaces] (got [${keys.sort().join(', ')}])`);
		}
		if (value.$schema !== SCHEMA_ID) {
			throw new ResourceGraphError('FLAUZ_RESOURCES_PERSIST', `flauz.resources/v0: graph must carry $schema exactly '${SCHEMA_ID}' (got ${JSON.stringify(value.$schema)})`);
		}
		if (!Array.isArray(value.nodes)) {
			throw new ResourceGraphError('FLAUZ_RESOURCES_PERSIST', 'flauz.resources/v0: graph must carry a nodes array');
		}
		if (!Array.isArray(value.edges)) {
			throw new ResourceGraphError('FLAUZ_RESOURCES_PERSIST', 'flauz.resources/v0: graph must carry an edges array');
		}
		if (!Array.isArray(value.surfaces)) {
			throw new ResourceGraphError('FLAUZ_RESOURCES_PERSIST', 'flauz.resources/v0: graph must carry a surfaces array');
		}
		const seen = new Set<string>();
		const nodes = (value.nodes as readonly unknown[]).map((entry, index) => {
			const ref = validateResourceRef(entry, `nodes[${index}]`);
			if (seen.has(ref.id)) {
				throw new ResourceGraphError('FLAUZ_RESOURCES_DUPLICATE', `flauz.resources/v0: nodes[${index}]: duplicate ref id '${ref.id}'`);
			}
			seen.add(ref.id);
			return ref;
		});
		const edgeSeen = new Set<string>();
		const edges = (value.edges as readonly unknown[]).map((entry, index) => {
			const edge = validateEdge(entry, `edges[${index}]`);
			const triple = `${edge.kind}|${edge.from}|${edge.to}`;
			if (edgeSeen.has(triple)) {
				throw new ResourceGraphError('FLAUZ_RESOURCES_DUPLICATE', `flauz.resources/v0: edges[${index}]: duplicate edge ${triple}`);
			}
			edgeSeen.add(triple);
			return edge;
		});
		const surfaceSeen = new Set<string>();
		const surfaces = (value.surfaces as readonly unknown[]).map((entry, index) => {
			const record = validateSurfaceRecord(entry, `surfaces[${index}]`);
			const pair = `${record.refId}|${record.family}`;
			if (surfaceSeen.has(pair)) {
				throw new ResourceGraphError('FLAUZ_RESOURCES_DUPLICATE', `flauz.resources/v0: surfaces[${index}]: duplicate surface record for ${pair}`);
			}
			surfaceSeen.add(pair);
			return record;
		});
		// load-time integrity (fail-closed): a graph file with dangling edges,
		// self-edges, illegal endpoint kinds or orphan surfaces is REJECTED --
		// the same typed rules addEdge/addSurface enforce on mutation.
		const kindById = new Map(nodes.map(ref => [ref.id, ref.kind]));
		for (const [index, edge] of edges.entries()) {
			const fromKind = kindById.get(edge.from);
			const toKind = kindById.get(edge.to);
			if (fromKind === undefined) {
				throw new ResourceGraphError('FLAUZ_RESOURCES_EDGE_ILLEGAL', `flauz.resources/v0: edges[${index}]: endpoint '${edge.from}' is not a graph node`);
			}
			if (toKind === undefined) {
				throw new ResourceGraphError('FLAUZ_RESOURCES_EDGE_ILLEGAL', `flauz.resources/v0: edges[${index}]: endpoint '${edge.to}' is not a graph node`);
			}
			if (edge.from === edge.to) {
				throw new ResourceGraphError('FLAUZ_RESOURCES_EDGE_ILLEGAL', `flauz.resources/v0: edges[${index}]: self-edge '${edge.from}'`);
			}
			if (!isEdgeLegalForKinds(edge.kind, fromKind, toKind)) {
				throw new ResourceGraphError('FLAUZ_RESOURCES_EDGE_ILLEGAL', edgeLegalityError(edge.kind, fromKind, toKind));
			}
		}
		// load-time integrity (fail-closed): a graph file with dangling edges,
		// self-edges, illegal endpoint kinds, orphan surfaces or ancestry
		// cycles is REJECTED -- the same typed rules addEdge/addSurface
		// enforce on mutation.
		const cycle = findEdgeCycle(edges);
		if (cycle !== undefined) {
			throw new ResourceGraphError('FLAUZ_RESOURCES_EDGE_ILLEGAL', `flauz.resources/v0: edges carry a '${cycle.kind}' cycle: ${cycle.path.join(' -> ')} (ancestry edge kinds must stay acyclic per kind)`);
		}
		for (const [index, record] of surfaces.entries()) {
			if (!kindById.has(record.refId)) {
				throw new ResourceGraphError('FLAUZ_RESOURCES_SCHEMA', `flauz.resources/v0: surfaces[${index}]: surface bound to unknown ref '${record.refId}' (no orphan surfaces)`);
			}
		}
		return stableSortEnvelope({ $schema: SCHEMA_ID, nodes, edges, surfaces });
	}

	/** Current envelope (bootstrapped). */
	envelope(): ResourcesEnvelope {
		this.assertBootstrapped();
		return clone(this.state!);
	}

	// -------------------------------------------------------------------------
	// Mutations
	// -------------------------------------------------------------------------

	/** Adds a ref (createdAt minted from the graph clock). Rejects duplicate ids. */
	async addRef(input: RefInput): Promise<ResourceRef> {
		return await this.runSerial(() => this.addRefSerial(input));
	}

	private async addRefSerial(input: RefInput): Promise<ResourceRef> {
		this.assertBootstrapped();
		const candidate = {
			schemaVersion: 0,
			kind: input.kind,
			id: input.id,
			...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
			provenance: input.provenance,
			createdAt: this.clock(),
		};
		const ref = validateResourceRef(candidate, 'addRef');
		if (this.get(ref.id) !== undefined) {
			throw new ResourceGraphError('FLAUZ_RESOURCES_DUPLICATE', `flauz.resources/v0: addRef rejected: ref '${ref.id}' already exists`);
		}
		await this.commit('add-ref', ref.id, ref.provenance, envelope => {
			return { ...envelope, nodes: [...envelope.nodes, ref] };
		}, `added ${ref.kind} ref`);
		return clone(ref);
	}

	/** Patches a ref's displayName (the only mutable field in v0; identity is immutable). */
	async updateRef(id: string, patch: { displayName: string }, provenance: ResourceProvenance): Promise<ResourceRef> {
		return await this.runSerial(() => this.updateRefSerial(id, patch, provenance));
	}

	private async updateRefSerial(id: string, patch: { displayName: string }, provenance: ResourceProvenance): Promise<ResourceRef> {
		this.assertBootstrapped();
		const validated = validateProvenance(provenance, 'updateRef.provenance');
		if (!isPlainObject(patch) || !hasOnlyPatchKeys(patch)) {
			throw new ResourceGraphError('FLAUZ_RESOURCES_SCHEMA', 'flauz.resources/v0: updateRef patch must be exactly { displayName }');
		}
		if (typeof patch.displayName !== 'string' || patch.displayName.length === 0 || patch.displayName.length > 200) {
			throw new ResourceGraphError('FLAUZ_RESOURCES_SCHEMA', 'flauz.resources/v0: updateRef patch.displayName must be a non-empty string of at most 200 chars');
		}
		const current = this.get(id);
		if (current === undefined) {
			throw new ResourceGraphError('FLAUZ_RESOURCES_NOT_FOUND', `flauz.resources/v0: updateRef rejected: ref '${id}' does not exist`);
		}
		const updated: ResourceRef = { ...current, displayName: patch.displayName };
		await this.commit('update-ref', id, validated, envelope => {
			return { ...envelope, nodes: envelope.nodes.map(node => node.id === id ? updated : node) };
		}, `displayName -> '${patch.displayName}'`);
		return clone(updated);
	}

	/**
	 * Removes a ref. REFUSES while edges reference the node or surfaces are
	 * bound to it (a typed error lists the offending edges + surface families).
	 */
	async removeRef(id: string, provenance: ResourceProvenance): Promise<void> {
		return await this.runSerial(() => this.removeRefSerial(id, provenance));
	}

	private async removeRefSerial(id: string, provenance: ResourceProvenance): Promise<void> {
		this.assertBootstrapped();
		const validated = validateProvenance(provenance, 'removeRef.provenance');
		if (this.get(id) === undefined) {
			throw new ResourceGraphError('FLAUZ_RESOURCES_NOT_FOUND', `flauz.resources/v0: removeRef rejected: ref '${id}' does not exist`);
		}
		const boundEdges = this.state!.edges.filter(edge => edge.from === id || edge.to === id)
			.map(edge => ({ kind: edge.kind, from: edge.from, to: edge.to }));
		const boundSurfaces = this.state!.surfaces.filter(record => record.refId === id)
			.map(record => record.family);
		if (boundEdges.length > 0 || boundSurfaces.length > 0) {
			throw new ResourceGraphError(
				'FLAUZ_RESOURCES_REF_IN_USE',
				`flauz.resources/v0: removeRef rejected: ref '${id}' is still referenced (remove the edges/surfaces first)`,
				{ edges: boundEdges, surfaces: boundSurfaces },
			);
		}
		await this.commit('remove-ref', id, validated, envelope => {
			return { ...envelope, nodes: envelope.nodes.filter(node => node.id !== id) };
		}, 'removed ref');
	}

	/**
	 * Adds (or versions) an access surface for a ref. When a record for the
	 * (refId, family) pair already exists, the PRIOR surface is retained and a
	 * new version appended -- the ref identity survives the access-surface
	 * change. An identical-to-current surface is rejected as a no-op.
	 */
	async addSurface(refId: string, surface: Surface, provenance: ResourceProvenance): Promise<SurfaceRecord> {
		return await this.runSerial(() => this.addSurfaceSerial(refId, surface, provenance));
	}

	private async addSurfaceSerial(refId: string, surface: Surface, provenance: ResourceProvenance): Promise<SurfaceRecord> {
		this.assertBootstrapped();
		const validated = validateProvenance(provenance, 'addSurface.provenance');
		const validatedSurface = validateSurface(surface, 'addSurface.surface');
		if (this.get(refId) === undefined) {
			throw new ResourceGraphError('FLAUZ_RESOURCES_NOT_FOUND', `flauz.resources/v0: addSurface rejected: ref '${refId}' does not exist`);
		}
		const existing = this.surfaceRecord(refId, validatedSurface.kind);
		let record: SurfaceRecord;
		if (existing === undefined) {
			record = {
				refId,
				family: validatedSurface.kind,
				versions: [{ surface: validatedSurface, provenance: validated, updatedAt: this.clock() }],
			};
			await this.commit('add-surface', refId, validated, envelope => {
				return { ...envelope, surfaces: [...envelope.surfaces, record] };
			}, `surface ${validatedSurface.kind} bound`);
		} else {
			const current = existing.versions[existing.versions.length - 1] as SurfaceVersion;
			if (canonicalJson(current.surface) === canonicalJson(validatedSurface)) {
				throw new ResourceGraphError('FLAUZ_RESOURCES_DUPLICATE', `flauz.resources/v0: addSurface rejected: the ${validatedSurface.kind} surface is identical to the current version (no-op version)`);
			}
			const version: SurfaceVersion = { surface: validatedSurface, provenance: validated, updatedAt: this.clock() };
			const updated: SurfaceRecord = { ...existing, versions: [...existing.versions, version] };
			await this.commit('add-surface', refId, validated, envelope => {
				return { ...envelope, surfaces: envelope.surfaces.map(r => r.refId === refId && r.family === updated.family ? updated : r) };
			}, `surface ${validatedSurface.kind} re-versioned (prior retained)`);
			record = updated;
		}
		return clone(record);
	}

	/** Adds an edge (typed endpoint + legality validation; createdAt from the clock). */
	async addEdge(input: EdgeInput, provenance: ResourceProvenance): Promise<GraphEdge> {
		return await this.runSerial(() => this.addEdgeSerial(input, provenance));
	}

	private async addEdgeSerial(input: EdgeInput, provenance: ResourceProvenance): Promise<GraphEdge> {
		this.assertBootstrapped();
		const validated = validateProvenance(provenance, 'addEdge.provenance');
		const edge = this.validateNewEdge(input, validated);
		await this.commit('add-edge', edge.from, validated, envelope => {
			return { ...envelope, edges: [...envelope.edges, edge] };
		}, `${edge.kind} ${edge.from} -> ${edge.to}`);
		return clone(edge);
	}

	/** Removes an edge (kind, from, to). */
	async removeEdge(kind: EdgeKind, from: string, to: string, provenance: ResourceProvenance): Promise<void> {
		return await this.runSerial(() => this.removeEdgeSerial(kind, from, to, provenance));
	}

	private async removeEdgeSerial(kind: EdgeKind, from: string, to: string, provenance: ResourceProvenance): Promise<void> {
		this.assertBootstrapped();
		const validated = validateProvenance(provenance, 'removeEdge.provenance');
		if (!isEdgeKind(kind)) {
			throw new ResourceGraphError('FLAUZ_RESOURCES_SCHEMA', `flauz.resources/v0: removeEdge rejected: unknown edge kind ${JSON.stringify(kind)}`);
		}
		const existing = this.state!.edges.find(edge => edge.kind === kind && edge.from === from && edge.to === to);
		if (existing === undefined) {
			throw new ResourceGraphError('FLAUZ_RESOURCES_NOT_FOUND', `flauz.resources/v0: removeEdge rejected: edge '${kind}' ${from} -> ${to} does not exist`);
		}
		await this.commit('remove-edge', from, validated, envelope => {
			return { ...envelope, edges: envelope.edges.filter(edge => !(edge.kind === kind && edge.from === from && edge.to === to)) };
		}, `${kind} ${from} -> ${to} removed`);
	}

	/**
	 * Records a restoration: the `restored-from` edge (from refId to
	 * originRefId) plus a dedicated `restore` op for continuity audits. Used
	 * by the continuity service; validated like any other edge.
	 */
	async restoreRef(refId: string, originRefId: string, provenance: ResourceProvenance): Promise<GraphEdge> {
		return await this.runSerial(async () => {
			this.assertBootstrapped();
			const edge = await this.addEdgeSerial({ kind: 'restored-from', from: refId, to: originRefId }, provenance);
			await this.commitOpOnly('restore', refId, provenance, `restored from ${originRefId}`);
			return edge;
		});
	}

	// -------------------------------------------------------------------------
	// Queries
	// -------------------------------------------------------------------------

	/** All refs of a kind, sorted by id. */
	byKind(kind: ResourceKind): readonly ResourceRef[] {
		this.assertBootstrapped();
		return this.state!.nodes.filter(ref => ref.kind === kind);
	}

	get(id: string): ResourceRef | undefined {
		this.assertBootstrapped();
		const found = this.state!.nodes.find(ref => ref.id === id);
		return found === undefined ? undefined : clone(found);
	}

	/** All refs connected to `id` by any edge (optionally one edge kind). */
	neighbors(id: string, edgeKind?: EdgeKind): readonly NeighborLink[] {
		this.assertBootstrapped();
		const byId = new Map(this.state!.nodes.map(ref => [ref.id, ref]));
		const links: NeighborLink[] = [];
		for (const edge of this.state!.edges) {
			if (edgeKind !== undefined && edge.kind !== edgeKind) {
				continue;
			}
			if (edge.from === id) {
				const ref = byId.get(edge.to);
				if (ref !== undefined) {
					links.push({ ref, edgeKind: edge.kind, direction: 'out' });
				}
			}
			if (edge.to === id) {
				const ref = byId.get(edge.from);
				if (ref !== undefined) {
					links.push({ ref, edgeKind: edge.kind, direction: 'in' });
				}
			}
		}
		return links;
	}

	/**
	 * The lineage chain of `id`: the ref itself first, then the ancestry
	 * closure over `produced` (incoming -- who produced me), `restored-from`
	 * (outgoing -- what I was restored from) and `snapshot-of` (outgoing --
	 * what I snapshot). Deterministic breadth-first order over the stored
	 * (stable-sorted) edge list; cycle-safe.
	 */
	lineage(id: string): readonly ResourceRef[] {
		this.assertBootstrapped();
		const byId = new Map(this.state!.nodes.map(ref => [ref.id, ref]));
		if (!byId.has(id)) {
			throw new ResourceGraphError('FLAUZ_RESOURCES_NOT_FOUND', `flauz.resources/v0: lineage rejected: ref '${id}' does not exist`);
		}
		const result: ResourceRef[] = [byId.get(id)!];
		const visited = new Set<string>([id]);
		const queue: string[] = [id];
		while (queue.length > 0) {
			const current = queue.shift()!;
			const next: string[] = [];
			for (const edge of this.state!.edges) {
				if (edge.kind === 'produced' && edge.to === current && edge.from !== current) {
					next.push(edge.from);
				}
				if ((edge.kind === 'restored-from' || edge.kind === 'snapshot-of') && edge.from === current && edge.to !== current) {
					next.push(edge.to);
				}
			}
			for (const candidate of next) {
				if (!visited.has(candidate)) {
					visited.add(candidate);
					const ref = byId.get(candidate);
					if (ref !== undefined) {
						result.push(ref);
						queue.push(candidate);
					}
				}
			}
		}
		return result;
	}

	/** All surface records bound to a ref. */
	surfacesFor(id: string): readonly SurfaceRecord[] {
		this.assertBootstrapped();
		return clone(this.state!.surfaces.filter(record => record.refId === id));
	}

	/** The surface record of one family for a ref (current version = versions[last]). */
	surfaceRecord(refId: string, family: SurfaceFamily): SurfaceRecord | undefined {
		this.assertBootstrapped();
		const found = this.state!.surfaces.find(record => record.refId === refId && record.family === family);
		return found === undefined ? undefined : clone(found);
	}

	/** The ops records recorded so far (strict parse). */
	async ops(): Promise<readonly ResourceOpRecord[]> {
		this.assertBootstrapped();
		return await this.ledger.readAll();
	}

	// -------------------------------------------------------------------------
	// Internals
	// -------------------------------------------------------------------------

	private validateNewEdge(input: EdgeInput, provenance: ResourceProvenance): GraphEdge {
		if (!isPlainObject(input) || !hasKey(input, 'kind') || !hasKey(input, 'from') || !hasKey(input, 'to')) {
			throw new ResourceGraphError('FLAUZ_RESOURCES_SCHEMA', 'flauz.resources/v0: addEdge input must be { kind, from, to }');
		}
		if (!isEdgeKind(input.kind)) {
			throw new ResourceGraphError('FLAUZ_RESOURCES_SCHEMA', `flauz.resources/v0: addEdge rejected: unknown edge kind ${JSON.stringify(input.kind)} (closed v0 set: depends-on|produced|bound-to|restored-from|snapshot-of|derived-from)`);
		}
		if (typeof input.from !== 'string' || typeof input.to !== 'string' || input.from === '' || input.to === '') {
			throw new ResourceGraphError('FLAUZ_RESOURCES_SCHEMA', 'flauz.resources/v0: addEdge rejected: from/to must be non-empty ref ids');
		}
		if (input.from === input.to) {
			throw new ResourceGraphError('FLAUZ_RESOURCES_EDGE_ILLEGAL', `flauz.resources/v0: addEdge rejected: self-edge '${input.from}' -> '${input.to}' (lineage edges must connect distinct refs)`);
		}
		const fromRef = this.get(input.from);
		if (fromRef === undefined) {
			throw new ResourceGraphError('FLAUZ_RESOURCES_EDGE_ILLEGAL', `flauz.resources/v0: addEdge rejected: endpoint '${input.from}' does not exist (both endpoints must be graph nodes)`);
		}
		const toRef = this.get(input.to);
		if (toRef === undefined) {
			throw new ResourceGraphError('FLAUZ_RESOURCES_EDGE_ILLEGAL', `flauz.resources/v0: addEdge rejected: endpoint '${input.to}' does not exist (both endpoints must be graph nodes)`);
		}
		if (!isEdgeLegalForKinds(input.kind, fromRef.kind, toRef.kind)) {
			throw new ResourceGraphError('FLAUZ_RESOURCES_EDGE_ILLEGAL', edgeLegalityError(input.kind, fromRef.kind, toRef.kind));
		}
		if (edgeClosesCycle(input.kind, input.from, input.to, this.state!.edges)) {
			throw new ResourceGraphError('FLAUZ_RESOURCES_EDGE_ILLEGAL', `flauz.resources/v0: addEdge rejected: '${input.kind}' ${input.from} -> ${input.to} closes a '${input.kind}' cycle (ancestry edge kinds must stay acyclic per kind)`);
		}
		const duplicate = this.state!.edges.some(edge => edge.kind === input.kind && edge.from === input.from && edge.to === input.to);
		if (duplicate) {
			throw new ResourceGraphError('FLAUZ_RESOURCES_DUPLICATE', `flauz.resources/v0: addEdge rejected: edge '${input.kind}' ${input.from} -> ${input.to} already exists`);
		}
		return {
			kind: input.kind,
			from: input.from,
			to: input.to,
			provenance,
			createdAt: this.clock(),
		};
	}

	private async commit(
		op: ResourceOp,
		refId: string,
		provenance: ResourceProvenance,
		mutate: (envelope: ResourcesEnvelope) => ResourcesEnvelope,
		note: string,
	): Promise<void> {
		const before = this.state!;
		const beforeDigest = envelopeDigest(before);
		const after = stableSortEnvelope(mutate(before));
		// re-validate the resulting envelope through the strict parser: a
		// mutation that would corrupt the document never reaches the disk.
		const roundTrip = ResourceGraph.parseEnvelope(serializeEnvelope(after));
		await this.fs.writeFile(`${this.filePath}.tmp`, serializeEnvelope(after));
		await this.fs.rename(`${this.filePath}.tmp`, this.filePath);
		this.state = roundTrip;
		await this.ledger.append({
			op,
			refId,
			provenance,
			beforeDigest,
			afterDigest: envelopeDigest(roundTrip),
			note,
		});
	}

	/** Appends an op record without changing the envelope (continuity audit annotations). */
	private async commitOpOnly(op: ResourceOp, refId: string, provenance: ResourceProvenance, note: string): Promise<void> {
		const digest = envelopeDigest(this.state!);
		await this.ledger.append({
			op,
			refId,
			provenance,
			beforeDigest: digest,
			afterDigest: digest,
			note,
		});
	}

	private async persist(): Promise<void> {
		const contents = serializeEnvelope(this.state);
		const tmp = `${this.filePath}.tmp`;
		await this.fs.writeFile(tmp, contents);
		await this.fs.rename(tmp, this.filePath);
	}

	private assertBootstrapped(): void {
		if (this.state === undefined) {
			throw new ResourceGraphError('FLAUZ_RESOURCES_PERSIST', 'flauz.resources/v0: graph not bootstrapped (call bootstrap() first)');
		}
	}
}

function hasOnlyPatchKeys(patch: object): boolean {
	const keys = Object.keys(patch);
	return keys.length === 1 && keys[0] === 'displayName';
}

/** Stable sort for git-diffable output: nodes by id; edges by (kind, from, to); surfaces by (refId, family). */
function stableSortEnvelope(envelope: ResourcesEnvelope): ResourcesEnvelope {
	const nodes = [...envelope.nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	const edges = [...envelope.edges].sort((a, b) => {
		const keyA = `${a.kind}|${a.from}|${a.to}`;
		const keyB = `${b.kind}|${b.from}|${b.to}`;
		return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
	});
	const surfaces = [...envelope.surfaces].sort((a, b) => {
		const keyA = `${a.refId}|${a.family}`;
		const keyB = `${b.refId}|${b.family}`;
		return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
	});
	return { $schema: envelope.$schema, nodes, edges, surfaces };
}

// ---------------------------------------------------------------------------
// Integrity verification (flauz.res.verify)
// ---------------------------------------------------------------------------

/**
 * Pure integrity check of an envelope: schema re-validation of every record,
 * edge endpoint existence + legality, no orphan surfaces, no duplicate
 * records, no secret-shaped values anywhere, provenance complete.
 */
export function verifyEnvelope(envelope: ResourcesEnvelope): VerifyReport {
	const problems: VerifyProblem[] = [];
	const kinds = new Map<string, ResourceKind>();
	const push = (code: string, path: string, message: string) => problems.push(problem(code, path, message));

	if (envelope.$schema !== SCHEMA_ID) {
		push('bad-schema', '$schema', `$schema must be exactly '${SCHEMA_ID}' (got ${JSON.stringify(envelope.$schema)})`);
	}
	const nodeIds = new Set<string>();
	for (const [index, node] of envelope.nodes.entries()) {
		const path = `nodes[${index}]`;
		try {
			const ref = validateResourceRef(node, path);
			if (nodeIds.has(ref.id)) {
				push('duplicate-node', path, `duplicate ref id '${ref.id}'`);
			}
			nodeIds.add(ref.id);
			kinds.set(ref.id, ref.kind);
			if (!isResourceUrnForKind(ref.id, ref.kind)) {
				push('bad-node', `${path}.id`, `id '${ref.id}' is not a URN with the canonical namespace for kind '${ref.kind}'`);
			}
		} catch (err) {
			push('bad-node', path, (err as Error).message);
		}
	}
	const edgeTriples = new Set<string>();
	for (const [index, edge] of envelope.edges.entries()) {
		const path = `edges[${index}]`;
		try {
			const parsed = validateEdge(edge, path);
			const triple = `${parsed.kind}|${parsed.from}|${parsed.to}`;
			if (edgeTriples.has(triple)) {
				push('duplicate-edge', path, `duplicate edge ${triple}`);
			}
			edgeTriples.add(triple);
			if (parsed.from === parsed.to) {
				push('edge-illegal', path, `self-edge '${parsed.from}'`);
			}
			const fromKind = kinds.get(parsed.from);
			const toKind = kinds.get(parsed.to);
			if (fromKind === undefined) {
				push('edge-endpoint-missing', path, `edge endpoint '${parsed.from}' is not a graph node`);
			}
			if (toKind === undefined) {
				push('edge-endpoint-missing', path, `edge endpoint '${parsed.to}' is not a graph node`);
			}
			if (fromKind !== undefined && toKind !== undefined && !isEdgeLegalForKinds(parsed.kind, fromKind, toKind)) {
				push('edge-illegal', path, edgeLegalityError(parsed.kind, fromKind, toKind));
			}
		} catch (err) {
			push('bad-edge', path, (err as Error).message);
		}
	}
	const cycle = findEdgeCycle(envelope.edges);
	if (cycle !== undefined) {
		push('edge-cycle', 'edges', `edges carry a '${cycle.kind}' cycle: ${cycle.path.join(' -> ')} (ancestry edge kinds must stay acyclic per kind)`);
	}
	const surfacePairs = new Set<string>();
	for (const [index, record] of envelope.surfaces.entries()) {
		const path = `surfaces[${index}]`;
		try {
			const parsed = validateSurfaceRecord(record, path);
			const pair = `${parsed.refId}|${parsed.family}`;
			if (surfacePairs.has(pair)) {
				push('duplicate-surface', path, `duplicate surface record for ${pair}`);
			}
			surfacePairs.add(pair);
			if (!nodeIds.has(parsed.refId)) {
				push('orphan-surface', path, `surface bound to unknown ref '${parsed.refId}' (no orphan surfaces)`);
			}
		} catch (err) {
			push('bad-surface', path, (err as Error).message);
		}
	}
	for (const [index, node] of envelope.nodes.entries()) {
		if (isPlainObject(node) && node.provenance === undefined) {
			push('provenance-incomplete', `nodes[${index}]`, 'ref carries no provenance');
		}
	}
	return {
		ok: problems.length === 0,
		nodes: envelope.nodes.length,
		edges: envelope.edges.length,
		surfaces: envelope.surfaces.length,
		problems,
	};
}

/**
 * Whole-workspace verification: the envelope (strict parse + integrity) plus
 * the ops-ledger chain (digest continuity against the persisted state). A
 * MISSING ops ledger is a documented note (seeded/fixture workspaces), a
 * PRESENT but inconsistent one is a failure.
 */
export async function verifyWorkspace(root: string, fs: FileSystemPort): Promise<WorkspaceVerifyReport> {
	const graphPath = joinPath(root, GRAPH_PATH);
	const raw = await fs.readFileUtf8(graphPath);
	if (raw === undefined) {
		return {
			envelope: {
				ok: false, nodes: 0, edges: 0, surfaces: 0,
				problems: [problem('bad-schema', GRAPH_PATH, `no ${GRAPH_PATH} found in the workspace (bootstrap the graph first)`)],
			},
			ops: undefined,
			opsNote: 'graph absent',
		};
	}
	let envelope: ResourcesEnvelope;
	try {
		envelope = ResourceGraph.parseEnvelope(raw);
	} catch (err) {
		return {
			envelope: { ok: false, nodes: 0, edges: 0, surfaces: 0, problems: [problem('bad-schema', GRAPH_PATH, (err as Error).message)] },
			ops: undefined,
			opsNote: 'graph unparseable',
		};
	}
	const envelopeReport = verifyEnvelope(envelope);
	const ledger = new ProvenanceLedger({ root, fs });
	if (!(await ledger.exists())) {
		return {
			envelope: envelopeReport,
			ops: undefined,
			opsNote: 'no ops ledger present (seeded or pre-provenance graph; mutations through ResourceGraph always record ops)',
		};
	}
	const opsReport = await ledger.verifyChain(envelopeDigest(envelope));
	return {
		envelope: envelopeReport,
		ops: { ok: opsReport.ok, records: opsReport.records, problems: opsReport.problems },
	};
}

// ---------------------------------------------------------------------------
// DOT export (flauz.res.graph --dot)
// ---------------------------------------------------------------------------

function dotEscape(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function refLabel(ref: ResourceRef, families: readonly string[]): string {
	const local = ref.id.split(':')[2] ?? ref.id;
	const name = ref.displayName ?? local;
	const familySuffix = families.length > 0 ? ` [${families.join(',')}]` : '';
	return `${name} (${ref.kind}${familySuffix})`;
}

/** Renders the graph in Graphviz DOT (deterministic: sorted nodes, then sorted edges). */
export function toDot(envelope: ResourcesEnvelope): string {
	const familiesByRef = new Map<string, string[]>();
	for (const record of envelope.surfaces) {
		const list = familiesByRef.get(record.refId) ?? [];
		list.push(record.family);
		familiesByRef.set(record.refId, list);
	}
	const lines: string[] = ['digraph flauz_resources {'];
	for (const node of envelope.nodes) {
		const families = (familiesByRef.get(node.id) ?? []).sort();
		lines.push(`\t"${dotEscape(node.id)}" [label="${dotEscape(refLabel(node, families))}"];`);
	}
	for (const edge of envelope.edges) {
		lines.push(`\t"${dotEscape(edge.from)}" -> "${dotEscape(edge.to)}" [label="${dotEscape(edge.kind)}"];`);
	}
	lines.push('}');
	return lines.join('\n') + '\n';
}
