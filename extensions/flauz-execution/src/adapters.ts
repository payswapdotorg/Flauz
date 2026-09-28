/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-S2 M3 - the BrowserSession / EnvironmentExecutor / logical-resource
 * adapters: the TL2-side bridge that lets a durable task step TARGET a
 * browser session, an environment or a logical resource THROUGH the
 * existing TL3 contracts (no redesign).
 *
 * The adapters operate on STRUCTURAL PORTS (below) that the REAL TL3
 * managers satisfy; the test suites wire the real implementations
 * (BrowserSessionManager over FakeCdpTransport + the real policy engine,
 * EnvironmentLifecycleManager over the FakeExecutor + registry,
 * ResourceGraph) so any TL3 contract drift fails loudly.
 *
 * The identity law: a step references ResourceRef IDENTITY (URN ids);
 * the adapter resolves the ACCESS SURFACE at execution time through the
 * resource graph and records the hand-off metadata. A fresh browser
 * session is minted through the REAL session manager (the descriptor's
 * logical id becomes the ResourceRef, registered in the graph with task
 * provenance - the same posture as the resources journal).
 *
 * Fail-closed posture: the browser policy verdict (deny => zero CDP
 * commands) and the environment trust gate (TRUST_POSTURE_REJECTED on
 * start/attach for untrusted) are AUTHORITATIVE; denials map to the
 * TERMINAL taxonomy classes (acquire-denied / use-denied -> policy-
 * violation) and are never retried by this bridge.
 */

import {
	type ExecFailure,
	type ExecutionRequest,
	type ExecutionResourceRef,
	type SurfaceSnapshot,
	type BrowserSurfaceSnapshot,
	type EnvironmentSurfaceSnapshot,
	type LogicalSurfaceSnapshot,
	classForKind,
	type ResourceKind,
	execSha256Hex,
	validateLogicalSurface,
} from './contracts.ts';
import { ExecJournalStore } from './journal.ts';
import type { StepBinding } from './acquisition.ts';

// ---------------------------------------------------------------------------
// The structural TL3 ports (the real managers satisfy these; mock drivers
// in the M2 suite, the REAL implementations in the M3 suites)
// ---------------------------------------------------------------------------

/** The BrowserSessionDescriptor subset this bridge records (contract-duplicated shape). */
export interface BrowserSessionDescriptorLike {
	readonly sessionId: string;
	readonly initiator: 'agent' | 'human';
	readonly agentId?: string;
	readonly partition: string;
	readonly state: 'opening' | 'active' | 'suspended' | 'closed' | 'failed';
	readonly tabs: ReadonlyArray<{ readonly tabId: string; readonly state: string; readonly url: string }>;
	readonly policySourceRef?: string;
	readonly error?: { readonly code: string; readonly message: string };
}

/** One navigation result arm (the tabs.ts NavigationOutcome subset). */
export interface NavigationOutcomeLike {
	readonly sent: boolean;
	readonly verdict?: { readonly decision: string; readonly layer: string; readonly reason: string; readonly url: string };
	readonly committedUrl?: string;
	readonly error?: { readonly code: string; readonly message: string };
}

/** The BrowserSessionManager port (open/navigate/close/getSession). */
export interface BrowserSessionManagerPort {
	open(input: { initiator: 'agent' | 'human'; agentId?: string; startUrl?: string }): Promise<{ descriptor: BrowserSessionDescriptorLike; error?: { code: string; message: string } }>;
	navigate(sessionId: string, url: string, options?: { tabId?: string }): Promise<NavigationOutcomeLike | { error: { code: string; message: string } }>;
	close(sessionId: string): Promise<BrowserSessionDescriptorLike | { error: { code: string; message: string } }>;
	getSession(sessionId: string): BrowserSessionDescriptorLike | undefined;
}

/** The lifecycle manager port (perform/describe). */
export interface EnvironmentLifecyclePort {
	perform(op: string, request: { id: string; actor?: unknown; simulated?: boolean }): Promise<{ ok: true; record: { toState: string }; detail?: unknown } | { ok: false; record: unknown; error: { code: string; message: string } }>;
	describe(request: { id: string }): Promise<{
		environmentId: string;
		kind: string;
		trust: string;
		state: string;
		executorKind: string;
		verdict: { health: string; state: string; pid: number | null; message: string; lease?: { leaseId: string; heldSince: number } };
	}>;
}

/**
 * Provenance of a task-caused mutation, in the flauz-resources actor
 * vocabulary (agent|human|tool - the graph/lifecycle journals accept no
 * 'service' actor; a service-driven sweep attributes as 'tool').
 */
export interface MutationProvenance {
	readonly actor: 'agent' | 'human' | 'tool';
	readonly actorId?: string;
	readonly cause?: string;
}

/** The resource graph port (identity + versioned access surfaces + provenance). */
export interface ResourceGraphPort {
	get(id: string): { kind: string; id: string } | undefined;
	surfacesFor(id: string): ReadonlyArray<{ refId: string; family: string; versions: ReadonlyArray<{ surface: unknown; updatedAt: number }> }>;
	addRef(input: { kind: ResourceKind; id: string; displayName?: string; provenance: MutationProvenance }): Promise<unknown>;
	addSurface(refId: string, surface: object, provenance: MutationProvenance): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Shared adapter plumbing
// ---------------------------------------------------------------------------

/** Provenance of a task-caused mutation (the MutationProvenance law above). */
function mutationProvenance(binding: StepBinding): MutationProvenance {
	const actor = binding.actor === 'agent' ? 'agent' : 'tool';
	return { actor, actorId: binding.runnerId, cause: `${binding.origin} (${binding.idempotencyKey})` };
}

/** Digest of an authoritative gate verdict (the verdict core posture). */
function verdictDigestOf(verdict: { decision: string; layer: string; reason: string; url: string } | undefined): string | undefined {
	if (verdict === undefined) {
		return undefined;
	}
	return execSha256Hex(`${verdict.decision}/${verdict.layer}/${verdict.reason}/${verdict.url}`);
}

function denied(gate: 'browser-policy' | 'environment-trust' | 'graph-state' | 'resource-graph' | 'invalid-request', message: string, digest?: string): { ok: false; failure: ExecFailure } {
	return { ok: false, failure: { failureClass: 'acquire-denied', gate, message, ...(digest !== undefined ? { verdictDigest: digest } : {}) } };
}

// ---------------------------------------------------------------------------
// The browser adapter
// ---------------------------------------------------------------------------

export interface BrowserExecutionAdapterOptions {
	readonly browser: BrowserSessionManagerPort;
	readonly graph: ResourceGraphPort;
	readonly journal: ExecJournalStore;
}

/** Drives browser sessions through the REAL session manager + policy engine. */
export class BrowserExecutionAdapter {
	private readonly browser: BrowserSessionManagerPort;
	private readonly graph: ResourceGraphPort;
	private readonly journal: ExecJournalStore;

	constructor(options: BrowserExecutionAdapterOptions) {
		this.browser = options.browser;
		this.graph = options.graph;
		this.journal = options.journal;
	}

	/** The acquire path: an existing session ref resolves; a resource-less open mints. */
	async open(request: ExecutionRequest, binding: StepBinding): Promise<{ ok: true; resource: ExecutionResourceRef; surface: SurfaceSnapshot } | { ok: false; failure: ExecFailure }> {
		if (request.resource !== undefined) {
			return this.openExisting(request, binding);
		}
		// A FRESH session: the real manager mints the logical id (the
		// descriptor), the ref is registered in the resource graph with task
		// provenance, and the surface version records the access truth.
		const opened = await this.browser.open({ initiator: 'agent', agentId: binding.runnerId, ...(request.url !== undefined ? { startUrl: request.url } : {}) });
		if (opened.error !== undefined) {
			return denied('browser-policy', `session open failed (fail-closed): ${opened.error.message}`);
		}
		const descriptor = opened.descriptor;
		const resource: ExecutionResourceRef = { resourceClass: 'browser-session', kind: 'browser-session', id: descriptor.sessionId };
		await this.graph.addRef({ kind: 'browser-session', id: descriptor.sessionId, displayName: `agent session ${binding.runnerId}`, provenance: mutationProvenance(binding) });
		await this.graph.addSurface(descriptor.sessionId, { kind: 'browser', ...(descriptor.partition !== undefined ? { partition: descriptor.partition } : {}), tabIds: descriptor.tabs.map((tab) => tab.tabId) }, mutationProvenance(binding));
		const snapshot = this.snapshotOf(descriptor);
		return { ok: true, resource, surface: snapshot };
	}

	/** Acquire an EXISTING session ref: resolve + verify liveness. */
	private async openExisting(request: ExecutionRequest, binding: StepBinding): Promise<{ ok: true; resource: ExecutionResourceRef; surface: SurfaceSnapshot } | { ok: false; failure: ExecFailure }> {
		const resource = request.resource as ExecutionResourceRef;
		const descriptor = this.browser.getSession(resource.id);
		if (descriptor === undefined) {
			return { ok: false, failure: { failureClass: 'resource-lost', message: `browser session ${resource.id} is not live (unknown to the session manager - the session was lost or never opened)` } };
		}
		if (descriptor.state !== 'active' && descriptor.state !== 'suspended') {
			return { ok: false, failure: { failureClass: 'resource-lost', message: `browser session ${resource.id} is '${descriptor.state}' (not usable)` } };
		}
		// The ref must be KNOWN to the resource graph (identity catalog).
		if (this.graph.get(resource.id) === undefined) {
			await this.graph.addRef({ kind: 'browser-session', id: resource.id, displayName: `session ${resource.id}`, provenance: mutationProvenance(binding) });
		}
		return { ok: true, resource, surface: this.snapshotOf(descriptor) };
	}

	/** The use path: policy-gated navigation / session close. */
	async use(request: ExecutionRequest, binding: StepBinding, acquisitionId: string): Promise<{ ok: true; value: string } | { ok: false; failure: ExecFailure }> {
		const resource = request.resource;
		if (resource === undefined) {
			return { ok: false, failure: { failureClass: 'invalid-request', message: 'browser use requires the resource ref' } };
		}
		if (request.action === 'close') {
			const closed = await this.browser.close(resource.id);
			if (Object.hasOwn(closed, 'error') && closed.error !== undefined) {
				return { ok: false, failure: { failureClass: 'resource-lost', message: `close failed: ${closed.error.message}` } };
			}
			return { ok: true, value: `closed ${resource.id}` };
		}
		if (request.action !== 'navigate' || request.url === undefined) {
			return { ok: false, failure: { failureClass: 'invalid-request', message: 'browser use requires action navigate + url (or close)' } };
		}
		const outcome = await this.browser.navigate(resource.id, request.url, request.tabId !== undefined ? { tabId: request.tabId } : {});
		if (Object.hasOwn(outcome, 'error') && outcome.error !== undefined && !Object.hasOwn(outcome, 'sent')) {
			return { ok: false, failure: { failureClass: 'resource-lost', message: `navigation failed (resource lost mid-step): ${outcome.error.message}` } };
		}
		const navigation = outcome as NavigationOutcomeLike;
		if (!navigation.sent) {
			// Fail-closed: the policy denied it and ZERO CDP commands were
			// sent. Terminal - never retried by this bridge.
			return { ok: false, failure: { failureClass: 'use-denied', gate: 'browser-policy', message: `navigation to ${request.url} denied by the browser policy (${navigation.verdict?.layer ?? 'unknown'}: ${navigation.verdict?.reason ?? 'no reason'})`, ...verdictDigestExtra(verdictDigestOf(navigation.verdict)) } };
		}
		if (navigation.error !== undefined) {
			return { ok: false, failure: { failureClass: 'resource-lost', message: `navigation error (resource lost mid-step): ${navigation.error.message}` } };
		}
		// Provenance: record a new surface version when the tab set changed.
		const descriptor = this.browser.getSession(resource.id);
		if (descriptor !== undefined) {
			const tabIds = descriptor.tabs.map((tab) => tab.tabId);
			const latest = this.currentBrowserSurface(resource.id);
			if (latest === undefined || !arrayEquals((latest as { tabIds?: string[] }).tabIds ?? [], tabIds)) {
				await this.graph.addSurface(resource.id, { kind: 'browser', ...(descriptor.partition !== undefined ? { partition: descriptor.partition } : {}), tabIds }, mutationProvenance(binding));
			}
			this.recordHandoff(binding, acquisitionId, this.snapshotOf(descriptor));
		}
		return { ok: true, value: `navigated ${resource.id} -> ${navigation.committedUrl ?? request.url}` };
	}

	private snapshotOf(descriptor: BrowserSessionDescriptorLike): BrowserSurfaceSnapshot {
		return {
			resourceClass: 'browser-session',
			sessionId: descriptor.sessionId,
			initiator: descriptor.initiator,
			partition: descriptor.partition,
			state: descriptor.state,
			tabIds: descriptor.tabs.map((tab) => tab.tabId),
			policySourceRef: descriptor.policySourceRef ?? 'unknown-policy-source',
		};
	}

	private currentBrowserSurface(refId: string): Record<string, unknown> | undefined {
		const records = this.graph.surfacesFor(refId);
		const browserRecord = records.find((record) => record.family === 'browser');
		if (browserRecord === undefined || browserRecord.versions.length === 0) {
			return undefined;
		}
		return browserRecord.versions[browserRecord.versions.length - 1]?.surface as Record<string, unknown> | undefined;
	}

	private recordHandoff(binding: StepBinding, acquisitionId: string, surface: SurfaceSnapshot): void {
		const digest = execSha256Hex(canonical(surface));
		this.journal.appendRow('handoff-recorded', {
			graphId: binding.graphId,
			stepId: binding.stepId,
			attempt: binding.attempt,
			idempotencyKey: binding.idempotencyKey,
			acquisitionId,
			actor: 'tool',
			origin: `${binding.origin}:handoff`,
			payload: { surface, surfaceDigest: digest },
		});
	}
}

// ---------------------------------------------------------------------------
// The environment adapter
// ---------------------------------------------------------------------------

export interface EnvironmentExecutionAdapterOptions {
	readonly lifecycle: EnvironmentLifecyclePort;
	readonly graph: ResourceGraphPort;
	readonly journal: ExecJournalStore;
}

/** Drives environments through the REAL lifecycle manager + trust gate. */
export class EnvironmentExecutionAdapter {
	private readonly lifecycle: EnvironmentLifecyclePort;
	private readonly graph: ResourceGraphPort;
	private readonly journal: ExecJournalStore;

	constructor(options: EnvironmentExecutionAdapterOptions) {
		this.lifecycle = options.lifecycle;
		this.graph = options.graph;
		this.journal = options.journal;
	}

	/** The acquire path: resolve + verify (health); attach is the connection lease. */
	async open(request: ExecutionRequest, binding: StepBinding): Promise<{ ok: true; resource: ExecutionResourceRef; surface: SurfaceSnapshot } | { ok: false; failure: ExecFailure }> {
		const resource = request.resource;
		if (resource === undefined) {
			return denied('invalid-request', 'environment acquire requires the registered descriptor ref (the registry is the catalog)');
		}
		if (this.graph.get(resource.id) === undefined) {
			// The ref must exist as the environment's ResourceRef identity.
			await this.graph.addRef({ kind: 'environment', id: resource.id, displayName: `environment ${this.descriptorIdOf(resource)}`, provenance: mutationProvenance(binding) });
		}
		const report = await this.describe(resource);
		if (report === undefined) {
			return { ok: false, failure: { failureClass: 'surface-unresolved', message: `environment ${this.descriptorIdOf(resource)} is unknown to the registry (ENVIRONMENT_UNKNOWN)` } };
		}
		if (report.verdict.health === 'stale' || report.verdict.health === 'orphan') {
			return { ok: false, failure: { failureClass: 'executor-death', message: `environment ${report.environmentId} health is '${report.verdict.health}' (${report.verdict.message}) - the backing truth is gone or not ours` } };
		}
		if (request.action === 'attach') {
			// The connection lease: through the REAL manager (its trust gate is
			// authoritative - TRUST_POSTURE_REJECTED maps to the typed denial).
			const outcome = await this.lifecycle.perform('attach', { id: this.descriptorIdOf(resource), actor: envActorOf(binding) });
			if (!outcome.ok) {
				if (outcome.error.code === 'TRUST_POSTURE_REJECTED') {
					return denied('environment-trust', `attach denied (trust posture): ${outcome.error.message}`);
				}
				if (outcome.error.code === 'ILLEGAL_TRANSITION') {
					return { ok: false, failure: { failureClass: 'invalid-request', message: `attach illegal in the current state: ${outcome.error.message}` } };
				}
				return { ok: false, failure: { failureClass: 'executor-death', message: `attach failed: ${outcome.error.message}` } };
			}
			const detail = outcome.detail as { leaseId?: string } | undefined;
			const attached = await this.describe(resource);
			return { ok: true, resource, surface: this.snapshotOf(attached ?? report, detail?.leaseId) };
		}
		return { ok: true, resource, surface: this.snapshotOf(report, report.verdict.lease?.leaseId) };
	}

	/** The use path: a lifecycle op through the REAL manager (typed outcomes). */
	async use(request: ExecutionRequest, binding: StepBinding, acquisitionId: string): Promise<{ ok: true; value: string } | { ok: false; failure: ExecFailure }> {
		const resource = request.resource;
		if (resource === undefined) {
			return { ok: false, failure: { failureClass: 'invalid-request', message: 'environment use requires the resource ref' } };
		}
		const op = request.action;
		const outcome = await this.lifecycle.perform(op, { id: this.descriptorIdOf(resource), actor: envActorOf(binding) });
		if (!outcome.ok) {
			if (outcome.error.code === 'TRUST_POSTURE_REJECTED') {
				return { ok: false, failure: { failureClass: 'use-denied', gate: 'environment-trust', message: `${op} denied (trust posture): ${outcome.error.message}` } };
			}
			if (outcome.error.code === 'ENVIRONMENT_UNKNOWN') {
				return { ok: false, failure: { failureClass: 'surface-unresolved', message: outcome.error.message } };
			}
			if (outcome.error.code === 'ILLEGAL_TRANSITION') {
				return { ok: false, failure: { failureClass: 'invalid-request', message: `${op} illegal in the current state: ${outcome.error.message}` } };
			}
			return { ok: false, failure: { failureClass: 'executor-death', message: `${op} failed: ${outcome.error.message}` } };
		}
		// The post-op surface (the state the task caused - provenance posture).
		const report = await this.describe(resource);
		if (report !== undefined) {
			this.journal.appendRow('handoff-recorded', {
				graphId: binding.graphId,
				stepId: binding.stepId,
				attempt: binding.attempt,
				idempotencyKey: binding.idempotencyKey,
				acquisitionId,
				actor: 'tool',
				origin: `${binding.origin}:handoff`,
				payload: { surface: this.snapshotOf(report, report.verdict.lease?.leaseId), surfaceDigest: execSha256Hex(canonical(this.snapshotOf(report, report.verdict.lease?.leaseId))) },
			});
		}
		return { ok: true, value: `${op} ${this.descriptorIdOf(resource)} -> ${outcome.record.toState}` };
	}

	private async describe(resource: ExecutionResourceRef): Promise<Awaited<ReturnType<EnvironmentLifecyclePort['describe']>> | undefined> {
		try {
			return await this.lifecycle.describe({ id: this.descriptorIdOf(resource) });
		} catch {
			return undefined;
		}
	}

	private snapshotOf(report: Awaited<ReturnType<EnvironmentLifecyclePort['describe']>>, attachLeaseId?: string): EnvironmentSurfaceSnapshot {
		return {
			resourceClass: 'environment',
			descriptorId: report.environmentId,
			providerKind: report.kind as EnvironmentSurfaceSnapshot['providerKind'],
			lifecycleState: report.state as EnvironmentSurfaceSnapshot['lifecycleState'],
			executorKind: report.executorKind,
			infrastructureClass: report.executorKind.includes('simulated') ? 'simulated' : 'real',
			trustPosture: report.trust as EnvironmentSurfaceSnapshot['trustPosture'],
			...(attachLeaseId !== undefined ? { attachLeaseId } : {}),
		};
	}

	private descriptorIdOf(resource: ExecutionResourceRef): string {
		return resource.id.split(':')[2] ?? resource.id;
	}
}

// ---------------------------------------------------------------------------
// The logical-resource adapter
// ---------------------------------------------------------------------------

export interface LogicalResourceAdapterOptions {
	readonly graph: ResourceGraphPort;
	readonly journal: ExecJournalStore;
}

/** Resolves/mutates logical resources through the REAL resource graph. */
export class LogicalResourceAdapter {
	private readonly graph: ResourceGraphPort;
	private readonly journal: ExecJournalStore;

	constructor(options: LogicalResourceAdapterOptions) {
		this.graph = options.graph;
		this.journal = options.journal;
	}

	/** The acquire path: the ref must exist and carry a resolvable surface version. */
	async open(request: ExecutionRequest, binding: StepBinding): Promise<{ ok: true; resource: ExecutionResourceRef; surface: SurfaceSnapshot } | { ok: false; failure: ExecFailure }> {
		const resource = request.resource;
		if (resource === undefined) {
			return denied('invalid-request', 'logical acquire requires the resource ref');
		}
		if (this.graph.get(resource.id) === undefined) {
			return { ok: false, failure: { failureClass: 'surface-unresolved', message: `resource ${resource.id} is not in the resource graph (identity unknown - no fabricated refs)` } };
		}
		const snapshot = this.resolveSnapshot(resource);
		if (snapshot === undefined) {
			return { ok: false, failure: { failureClass: 'surface-unresolved', message: `resource ${resource.id} carries no resolvable access surface (surface-unresolved)` } };
		}
		return { ok: true, resource, surface: snapshot };
	}

	/** The use path: resolve returns the surface; mutate records the new version with provenance. */
	async use(request: ExecutionRequest, binding: StepBinding, acquisitionId: string): Promise<{ ok: true; value: string } | { ok: false; failure: ExecFailure }> {
		const resource = request.resource;
		if (resource === undefined) {
			return { ok: false, failure: { failureClass: 'invalid-request', message: 'logical use requires the resource ref' } };
		}
		if (request.action === 'resolve') {
			const snapshot = this.resolveSnapshot(resource);
			if (snapshot === undefined) {
				return { ok: false, failure: { failureClass: 'surface-unresolved', message: `resource ${resource.id} carries no resolvable access surface` } };
			}
			return { ok: true, value: canonical(snapshot.surface) };
		}
		if (request.action === 'mutate') {
			const mutation = request.mutation as { surface?: Record<string, unknown> } | undefined;
			if (mutation === undefined || mutation.surface === undefined) {
				return { ok: false, failure: { failureClass: 'invalid-request', message: 'logical mutate requires mutation.surface (the new access-surface version)' } };
			}
			const error = validateLogicalSurface(mutation.surface);
			if (error !== undefined) {
				return { ok: false, failure: { failureClass: 'invalid-request', message: `logical mutate surface rejected: ${error}` } };
			}
			await this.graph.addSurface(resource.id, mutation.surface, mutationProvenance(binding));
			const snapshot = this.resolveSnapshot(resource);
			if (snapshot !== undefined) {
				this.journal.appendRow('handoff-recorded', {
					graphId: binding.graphId,
					stepId: binding.stepId,
					attempt: binding.attempt,
					idempotencyKey: binding.idempotencyKey,
					acquisitionId,
					actor: 'tool',
					origin: `${binding.origin}:handoff`,
					payload: { surface: snapshot, surfaceDigest: execSha256Hex(canonical(snapshot)) },
				});
			}
			return { ok: true, value: `mutated ${resource.id} (surface version recorded with provenance)` };
		}
		return { ok: false, failure: { failureClass: 'invalid-request', message: `logical action must be resolve|mutate (got ${JSON.stringify(request.action)})` } };
	}

	private resolveSnapshot(resource: ExecutionResourceRef): LogicalSurfaceSnapshot | undefined {
		const records = this.graph.surfacesFor(resource.id);
		const record = records.find((candidate) => classForKind(resource.kind) === 'logical-resource' && candidate.family !== 'browser' && candidate.family !== 'environment');
		if (record === undefined || record.versions.length === 0) {
			return undefined;
		}
		const surface = record.versions[record.versions.length - 1]?.surface as Record<string, unknown> | undefined;
		if (surface === undefined) {
			return undefined;
		}
		return { resourceClass: 'logical-resource', refId: resource.id, family: record.family as LogicalSurfaceSnapshot['family'], surface: surface as unknown as LogicalSurfaceSnapshot['surface'] };
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function envActorOf(binding: StepBinding): 'agent' | 'human' | 'tool' {
	// The env lifecycle provenance vocabulary is agent|human|tool; the
	// execution runtime (service) attributes as 'tool' with the origin as
	// the precise source.
	if (binding.actor === 'agent') {
		return 'agent';
	}
	return 'tool';
}

function verdictDigestExtra(digest: string | undefined): { verdictDigest?: string } {
	return digest === undefined ? {} : { verdictDigest: digest };
}

function arrayEquals(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** Local canonical JSON for adapter-side digests (identical bytes to contracts.canonicalJson). */
function canonical(value: unknown): string {
	if (value === null || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return '[' + value.map(canonical).join(',') + ']';
	}
	if (typeof value === 'object') {
		const record = value as Record<string, unknown>;
		const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort();
		return '{' + keys.map((key) => JSON.stringify(key) + ':' + canonical(record[key])).join(',') + '}';
	}
	return 'null';
}
