/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Flauz resource continuity (v0): restoration plans + the restore operation.
 *
 * A `RestorationPlan` records, per family, what is needed to bring a resource
 * BACK (re-attach / re-execute / re-download) without flattening the families:
 *   - browser-session refs: the session descriptor summary (sessionId,
 *     initiator, partition, state -- contract-aligned with Worker A's
 *     BrowserSessionDescriptor; duplicated type, pinned by
 *     test/fixtures/resources/contracts/) + a recovery hint;
 *   - environment refs: the environment id + lifecycle state summary (the
 *     flauz-environments registry descriptor id; the registry file is read
 *     read-only when present) + a plan re-execution hint;
 *   - file/directory/artifact refs: path + content hash.
 *
 * `restore(refId)` returns the plan AND records a `restored-from` edge on
 * successful restoration: the origin is the explicit `fromRefId` or, by
 * default, the newest `snapshot-of` ancestor of the ref (X snapshot-of refId).
 * v0 is fail-closed: a restoration without a discoverable origin is rejected
 * (no free-floating continuity claims).
 *
 * Continuity metadata NEVER carries credentials: the plan is deep-scanned for
 * secret-shaped values before it is returned (the vault-only policy, applied
 * to continuity -- SECURITY-MODEL 3.5 discipline).
 */
import {
	ENVIRONMENTS_REGISTRY_PATH,
	ResourceGraphError,
	assertNoSecretShapedValues,
	isEnvironmentId,
	joinPath,
	type EnvironmentProviderKind,
	type FileSystemPort,
	type GraphEdge,
	type ResourceProvenance,
	type ResourceRef,
	type Surface,
} from './api.ts';
import type { ResourceGraph } from './graph.ts';

/** Schema identifier of restoration plans. */
export const RESTORATION_PLAN_SCHEMA_ID = 'flauz.restorationPlan/v0';

/**
 * Contract-duplicated summary of Worker A's BrowserSessionDescriptor
 * (sessionId, initiator, partition, state). Duplicated as a type per the
 * DL-32 sibling convention; pinned against the literal fixture
 * test/fixtures/resources/contracts/browser-session-descriptor.json so
 * integration drift is detectable.
 */
export interface BrowserSessionSummary {
	/** The pinned session id shape: exactly `flauz:browser:<16-hex>`. */
	readonly sessionId: string;
	/** Who initiated the session (flauz-browser's NavigationInitiator vocabulary). */
	readonly initiator: 'agent-tool' | 'user';
	/** The session partition (`persist:flauz-<hash>` style); null when the surface records none. */
	readonly partition: string | null;
	/**
	 * Session lifecycle state. v0 graph-only value: 'unknown' (the live
	 * runtime states arrive with the browser runtime lane; the FIELD is part
	 * of the pinned shape, so it composes from day one).
	 */
	readonly state: string;
}

/**
 * Contract-duplicated environment lifecycle summary (the flauz-environments
 * registry descriptor id + registry state). Pinned against
 * test/fixtures/resources/contracts/environment-descriptor.json.
 */
export interface EnvironmentSummary {
	/** The registry descriptor id (`env-...`). */
	readonly environmentId: string;
	/** The registry's environment kind (contract-duplicated vocabulary). */
	readonly providerKind: EnvironmentProviderKind;
	/** Registry file state at plan time: read successfully / absent / present but unreadable. */
	readonly registryState: 'present' | 'absent' | 'unreadable';
	/** Descriptor enabled flag; null when the registry state is unknown. */
	readonly enabled: boolean | null;
	/** Whether the registry's activeId points at this environment; null when unknown. */
	readonly active: boolean | null;
}

/** Path + content hash summary for file/directory/artifact refs. */
export interface FileArtifactSummary {
	readonly path: string;
	readonly contentSha256: string | null;
}

export type RestorationPlan =
	| {
		readonly schemaVersion: 0;
		readonly refId: string;
		readonly family: 'browser-session';
		readonly displayName?: string;
		readonly summary: BrowserSessionSummary;
		readonly hint: string;
	}
	| {
		readonly schemaVersion: 0;
		readonly refId: string;
		readonly family: 'environment';
		readonly displayName?: string;
		readonly summary: EnvironmentSummary;
		readonly hint: string;
	}
	| {
		readonly schemaVersion: 0;
		readonly refId: string;
		readonly family: 'file-artifact';
		readonly displayName?: string;
		readonly summary: FileArtifactSummary;
		readonly hint: string;
	};

export type RestorationFamily = RestorationPlan['family'];

export interface RestoreOptions {
	/** Fail-closed provenance: the actor is MANDATORY on the recorded edge. */
	readonly provenance: ResourceProvenance;
	/** Explicit restoration origin; defaults to the newest snapshot-of ancestor. */
	readonly fromRefId?: string;
}

export interface RestorationOutcome {
	readonly plan: RestorationPlan;
	/** The recorded `restored-from` edge (refId -> origin). */
	readonly edge: GraphEdge;
}

/** The v0 restorable kind -> family mapping. */
const FAMILY_BY_KIND: Partial<Record<string, RestorationFamily>> = {
	'browser-session': 'browser-session',
	'environment': 'environment',
	'file': 'file-artifact',
	'directory': 'file-artifact',
	'artifact': 'file-artifact',
};

function currentSurface(graph: ResourceGraph, refId: string, family: Surface['kind']): Surface | undefined {
	const record = graph.surfaceRecord(refId, family);
	if (record === undefined) {
		return undefined;
	}
	const last = record.versions[record.versions.length - 1];
	return last === undefined ? undefined : last.surface;
}

function restoreError(message: string): ResourceGraphError {
	return new ResourceGraphError('FLAUZ_RESOURCES_RESTORE', `flauz.resources/v0: ${message}`);
}

/** Minimal registry read (contract-duplicated envelope probe; read-only, best-effort). */
interface RegistryProbe {
	readonly registryState: 'present' | 'absent' | 'unreadable';
	readonly enabled: boolean | null;
	readonly active: boolean | null;
}

async function probeRegistry(fs: FileSystemPort, root: string, environmentId: string): Promise<RegistryProbe> {
	let raw: string | undefined;
	try {
		raw = await fs.readFileUtf8(joinPath(root, ENVIRONMENTS_REGISTRY_PATH));
	} catch {
		raw = undefined;
	}
	if (raw === undefined) {
		return { registryState: 'absent', enabled: null, active: null };
	}
	try {
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
			throw new Error('not an object');
		}
		const record = parsed as Record<string, unknown>;
		const environments = Array.isArray(record['environments']) ? record['environments'] as readonly unknown[] : [];
		const descriptor = environments.find(entry => {
			if (typeof entry !== 'object' || entry === null) {
				return false;
			}
			return (entry as Record<string, unknown>)['id'] === environmentId;
		}) as Record<string, unknown> | undefined;
		if (descriptor === undefined) {
			return { registryState: 'present', enabled: null, active: null };
		}
		const activeId = typeof record['activeId'] === 'string' ? record['activeId'] : null;
		return {
			registryState: 'present',
			enabled: typeof descriptor['enabled'] === 'boolean' ? descriptor['enabled'] : null,
			active: activeId === environmentId,
		};
	} catch {
		return { registryState: 'unreadable', enabled: null, active: null };
	}
}

export interface ContinuityOptions {
	readonly graph: ResourceGraph;
}

export class ContinuityService {
	private readonly graph: ContinuityOptions['graph'];

	constructor(options: ContinuityOptions) {
		this.graph = options.graph;
	}

	/**
	 * Builds the restoration plan for a ref (no edge recorded). Throws typed
	 * errors for unknown refs, non-restorable kinds and missing family
	 * surfaces.
	 */
	async planRestoration(refId: string): Promise<RestorationPlan> {
		const ref = this.graph.get(refId);
		if (ref === undefined) {
			throw restoreError(`restoration rejected: ref '${refId}' does not exist`);
		}
		const family = FAMILY_BY_KIND[ref.kind];
		if (family === undefined) {
			throw restoreError(`restoration rejected: kind '${ref.kind}' has no v0 restoration family (restorable: file, directory, artifact, browser-session, environment)`);
		}
		const plan = await this.buildPlan(ref, family);
		assertNoSecretShapedValues(plan, `restorationPlan(${refId})`);
		return plan;
	}

	/**
	 * Restores a resource: returns the plan and records the `restored-from`
	 * edge (refId -> origin) on success. The origin is `options.fromRefId`
	 * when given, else the newest `snapshot-of` ancestor (X snapshot-of
	 * refId); a restoration with no discoverable origin is rejected
	 * (fail-closed continuity).
	 */
	async restore(refId: string, options: RestoreOptions): Promise<RestorationOutcome> {
		const plan = await this.planRestoration(refId);
		const origin = options.fromRefId ?? this.newestSnapshotAncestor(refId);
		if (origin === undefined) {
			throw restoreError(`restoration rejected: no restoration origin for '${refId}' (pass fromRefId or snapshot the resource first -- restored-from edges never dangle)`);
		}
		const originRef = this.graph.get(origin);
		if (originRef === undefined) {
			throw restoreError(`restoration rejected: origin ref '${origin}' does not exist`);
		}
		if (origin === refId) {
			throw restoreError('restoration rejected: the origin must differ from the restored ref (self-edges are illegal)');
		}
		const edge = await this.graph.restoreRef(refId, origin, options.provenance);
		return { plan, edge };
	}

	/** The newest ref X with edge `X snapshot-of refId` (by edge createdAt, tie-break by X id). */
	private newestSnapshotAncestor(refId: string): string | undefined {
		const candidates = this.graph.envelope().edges
			.filter(edge => edge.kind === 'snapshot-of' && edge.to === refId && edge.from !== refId)
			.sort((a, b) => (b.createdAt - a.createdAt) || (a.from < b.from ? -1 : 1));
		const first = candidates[0];
		return first === undefined ? undefined : first.from;
	}

	private async buildPlan(ref: ResourceRef, family: RestorationFamily): Promise<RestorationPlan> {
		const base = {
			schemaVersion: 0 as const,
			refId: ref.id,
			family,
			...(ref.displayName !== undefined ? { displayName: ref.displayName } : {}),
		};
		if (family === 'browser-session') {
			const surface = currentSurface(this.graph, ref.id, 'browser');
			if (surface === undefined || surface.kind !== 'browser') {
				throw restoreError(`restoration rejected: browser-session ref '${ref.id}' has no current browser surface (bind one with addSurface first)`);
			}
			const summary: BrowserSessionSummary = {
				sessionId: ref.id,
				initiator: ref.provenance.actor === 'human' ? 'user' : 'agent-tool',
				partition: surface.partition ?? null,
				state: 'unknown',
			};
			return {
				...base,
				family: 'browser-session',
				summary,
				hint: `re-attach the session through the browser runtime (partition ${summary.partition ?? 'n/a'}${surface.cdpEndpoint !== undefined ? `, last endpoint ${surface.cdpEndpoint}` : ''}); screenshots/network evidence persist only as artifact refs`,
			};
		}
		if (family === 'environment') {
			const surface = currentSurface(this.graph, ref.id, 'environment');
			if (surface === undefined || surface.kind !== 'environment') {
				throw restoreError(`restoration rejected: environment ref '${ref.id}' has no current environment surface (bind one with addSurface first)`);
			}
			if (!isEnvironmentId(surface.descriptorId)) {
				throw restoreError(`restoration rejected: environment surface of '${ref.id}' carries a malformed descriptor id (${JSON.stringify(surface.descriptorId)})`);
			}
			const probe = await probeRegistry(this.graph.port, this.graph.workspaceRoot, surface.descriptorId);
			const summary: EnvironmentSummary = {
				environmentId: surface.descriptorId,
				providerKind: surface.providerKind,
				registryState: probe.registryState,
				enabled: probe.enabled,
				active: probe.active,
			};
			return {
				...base,
				family: 'environment',
				summary,
				hint: `re-execute the connection plan: flauz.env.activate ${summary.environmentId} then flauz.env.switch (flauz.connectionPlan/v0 re-run; attach target ${surface.attachTarget ?? 'n/a'})`,
			};
		}
		// file-artifact family: artifact surface preferred, file-system surface fallback
		const artifact = currentSurface(this.graph, ref.id, 'artifact');
		if (artifact !== undefined && artifact.kind === 'artifact') {
			const summary: FileArtifactSummary = { path: artifact.uri, contentSha256: artifact.sha256 };
			return {
				...base,
				family: 'file-artifact',
				summary,
				hint: `re-acquire the artifact at ${summary.path} and verify sha256 ${summary.contentSha256}`,
			};
		}
		const fs = currentSurface(this.graph, ref.id, 'file-system');
		if (fs !== undefined && fs.kind === 'file-system') {
			const summary: FileArtifactSummary = {
				path: joinPath(fs.root, fs.path),
				contentSha256: fs.contentSha256 ?? null,
			};
			return {
				...base,
				family: 'file-artifact',
				summary,
				hint: `re-acquire ${summary.path}${summary.contentSha256 !== null ? ` and verify sha256 ${summary.contentSha256}` : ' (no content hash recorded)'}`,
			};
		}
		throw restoreError(`restoration rejected: ${ref.kind} ref '${ref.id}' has no artifact or file-system surface (bind one with addSurface first)`);
	}
}

/** Convenience: validates that a plan carries no credentials (exported for tests/canaries). */
export function planCarriesNoCredentials(plan: RestorationPlan): boolean {
	try {
		assertNoSecretShapedValues(plan, 'plan');
		return true;
	} catch {
		return false;
	}
}
