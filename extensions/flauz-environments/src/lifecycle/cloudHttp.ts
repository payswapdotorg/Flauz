/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL3-004 rung 1 — the cloud-sandbox HTTP adapter (executorKind `cloud-http`,
 * kind `cloud-sandbox`): REAL client code, honest remote posture.
 *
 * A REAL REST client for an E2B-style sandbox API over the injectable
 * `HttpPort` (production impl = the Node stdlib global `fetch`; tests drill
 * against a LOCAL node:http mock server — no external network). The
 * `apiKeyRef` descriptor field is a VAULT REFERENCE resolved through the
 * injectable `SecretResolverPort` — the executor NEVER holds key material:
 * the key is resolved per request, sent ONLY as the `Authorization: Bearer`
 * header, never persisted, never logged (pinned by the no-key-in-artifacts
 * test). Literal keys are rejected at the schema level (the registry's
 * connection validation — same law as the connection-plan providers) and
 * re-checked here (defense in depth).
 *
 * ---------------------------------------------------------------------------
 * The Flauz cloud-sandbox wire contract, v0 (the sketch this client speaks;
 * clearly labeled as FLAUZ's contract — a vendor-side implementation matches
 * these routes, E2B itself is not wired in this rung):
 *
 *   POST   {base}/v0/sandboxes
 *          body  { "template": <sandboxTemplate>, "metadata": { "environmentId": <id>, "region"?: <region> } }
 *          resp  200/201 { "sandboxId": <string>, "status": "created" }
 *   POST   {base}/v0/sandboxes/{sandboxId}/start
 *          body  {}
 *          resp  200 { "sandboxId": <string>, "status": "running", "startedAt": <epochMs> }
 *   POST   {base}/v0/sandboxes/{sandboxId}/stop
 *          body  {}
 *          resp  200 { "sandboxId": <string>, "status": "stopped", "stoppedAt": <epochMs> }
 *   POST   {base}/v0/sandboxes/{sandboxId}/snapshots
 *          body  {}
 *          resp  200 { "snapshotId": <string>, "createdAt": <epochMs> }
 *   DELETE {base}/v0/sandboxes/{sandboxId}
 *          resp  200/204 (empty body allowed)
 *   GET    {base}/v0/sandboxes/{sandboxId}
 *          resp  200 { "sandboxId": <string>, "status": "created"|"running"|"stopped" }
 *
 *   Auth: `Authorization: Bearer <key resolved from apiKeyRef>` +
 *         `Content-Type: application/json` on every request.
 *   Failure classes (typed, never raw throws):
 *     - resolver returns nothing ........ VAULT_REF_UNRESOLVED (the cloud
 *                                        capability probe — keys absent fails closed)
 *     - 401/403 ........................ CLOUD_AUTH_FAILED
 *     - 404 ............................ CLOUD_SANDBOX_UNKNOWN
 *     - other non-2xx .................. CLOUD_PROVIDER_ERROR (status carried)
 *     - fetch rejects (conn refused ...) CLOUD_UNREACHABLE
 *     - wall-clock expiry .............. CLOUD_TIMEOUT
 *     - malformed response ............. CLOUD_PROTOCOL_ERROR
 * ---------------------------------------------------------------------------
 *
 * Reconciliation semantics: the sandbox id + status are persisted in a LOCAL
 * tracking record `.flauz/env-cloud/<envId>.json` (`flauz.env-cloud/v0`, the
 * same executor-local truth-file class as the simulated executor's
 * `.flauz/env-sim/` — NOT a PIN-2 sibling; those two envelopes stay exactly
 * as pinned). `probe` is provider-authoritative: a tracked sandbox the
 * provider reports `running` is `healthy` even across executor restarts
 * (sandbox ids are provider-scoped — the pid-reuse hazard that makes an
 * alive-but-foreign LOCAL pid an `orphan` has no analog here); a sandbox the
 * provider no longer knows (404) or that can no longer be verified (auth,
 * network) is `stale` — fail-closed, never silently healthy. Snapshots land
 * in `.flauz/env-snapshots/<envId>/<epochMs>/` with the SAME canonical
 * `manifest.json` (sha256 per file, `flauz.env-snapshot-manifest/v0`) as the
 * local executor. `start` reports pid 0 — a cloud sandbox has no local
 * process id (documented; the sandbox id is the identity).
 */
import { isSecretRef, joinPath, serializeEnvelope, type Clock, type EnvironmentDescriptor, type EnvironmentKind } from '../api.ts';
import type { ExecutorOpContext, EnvironmentExecutor } from './executor.ts';
import type { DescribeVerdict, ExecutorEffectResult } from './types.ts';
import { excerpt } from './cliPort.ts';
import type { HashPort, LocalEnvFsPort, SnapshotManifest, SnapshotManifestFile } from './localProcess.ts';

export const CLOUD_HTTP_EXECUTOR_KIND = 'cloud-http';

/** Schema id pinned into the local cloud tracking record. */
export const CLOUD_TRACK_SCHEMA_ID = 'flauz.env-cloud/v0';

/** Schema id pinned into snapshot manifests (same as the local executor). */
export const CLOUD_SNAPSHOT_MANIFEST_SCHEMA_ID = 'flauz.env-snapshot-manifest/v0';

/** Schema id pinned into the local snapshot payload document. */
export const CLOUD_SNAPSHOT_DOC_SCHEMA_ID = 'flauz.cloud-snapshot/v0';

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

/** A fetch-like HTTP port (production = the Node stdlib global fetch). */
export interface HttpPort {
	fetch(request: { readonly method: string; readonly url: string; readonly headers?: Record<string, string>; readonly body?: string; readonly timeoutMs?: number }): Promise<{ readonly status: number; readonly bodyText: string }>;
}

/**
 * Vault-reference resolver port. Production wiring resolves `env:<NAME>` from
 * the process environment and `vault:<NAME>` from the host's secret storage;
 * tests inject a stub. Returns undefined when the reference cannot be
 * resolved — the executor maps that to the typed VAULT_REF_UNRESOLVED
 * fail-closed error and NEVER sees key material it was not handed.
 */
export interface SecretResolverPort {
	resolve(ref: string): Promise<string | undefined>;
}

/**
 * The Node-stdlib implementation (global fetch + AbortSignal.timeout; zero
 * runtime dependencies). Wired by the extension host; the mock drill uses
 * the same implementation against 127.0.0.1.
 */
export const nodeHttpPort: HttpPort = {
	fetch: async request => {
		const response = await fetch(request.url, {
			method: request.method,
			headers: request.headers,
			body: request.body,
			...(request.timeoutMs === undefined ? {} : { signal: AbortSignal.timeout(request.timeoutMs) }),
		});
		return { status: response.status, bodyText: await response.text() };
	},
};

// ---------------------------------------------------------------------------
// The executor
// ---------------------------------------------------------------------------

export interface CloudHttpExecutorOptions {
	readonly root: string;
	readonly http: HttpPort;
	/** The vault-reference resolver (apiKeyRef is resolved through it). */
	readonly secrets: SecretResolverPort;
	/** Base URL of the cloud-sandbox API (v0 descriptors carry no endpoint field — pinned shape, DL-29). */
	readonly baseUrl: string;
	readonly fs: LocalEnvFsPort;
	readonly hash: HashPort;
	readonly clock?: Clock;
	/** Per-request wall-clock budget (default 15 000). */
	readonly requestTimeoutMs?: number;
	/** Kinds served (default ['cloud-sandbox']). */
	readonly kinds?: readonly EnvironmentKind[];
}

/** The local tracking record (`.flauz/env-cloud/<envId>.json`). */
export interface CloudTrackRecord {
	readonly schemaVersion: number;
	readonly schema: string;
	readonly environmentId: string;
	readonly sandboxId: string;
	readonly status: 'created' | 'running' | 'stopped';
	readonly startedAt: number | null;
	readonly lease: { readonly leaseId: string; readonly heldSince: number } | null;
	readonly snapshots: readonly string[];
}

function effectError(code: string, message: string): { ok: false; error: { code: string; message: string } } {
	return { ok: false, error: { code, message } };
}

export class CloudHttpExecutor implements EnvironmentExecutor {
	readonly executorKind = CLOUD_HTTP_EXECUTOR_KIND;
	readonly infrastructureClass = 'real' as const;
	readonly kinds: readonly EnvironmentKind[];
	private readonly root: string;
	private readonly http: HttpPort;
	private readonly secrets: SecretResolverPort;
	private readonly baseUrl: string;
	private readonly fs: LocalEnvFsPort;
	private readonly hash: HashPort;
	private readonly clock: Clock;
	private readonly requestTimeoutMs: number;
	private leaseCounter = 0;

	constructor(options: CloudHttpExecutorOptions) {
		this.root = options.root;
		this.http = options.http;
		this.secrets = options.secrets;
		this.baseUrl = options.baseUrl.replace(/\/+$/, '');
		this.fs = options.fs;
		this.hash = options.hash;
		this.clock = options.clock ?? (() => Date.now());
		this.requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
		this.kinds = options.kinds ?? ['cloud-sandbox'];
	}

	// -- helpers -------------------------------------------------------------------

	private trackPathOf(envId: string): string {
		return joinPath(this.root, '.flauz', 'env-cloud', `${envId}.json`);
	}

	private snapshotRootOf(envId: string): string {
		return joinPath(this.root, '.flauz', 'env-snapshots', envId);
	}

	private async readTrack(envId: string): Promise<CloudTrackRecord | undefined> {
		const raw = await this.fs.readFileUtf8(this.trackPathOf(envId));
		if (raw === undefined) {
			return undefined;
		}
		try {
			const value = JSON.parse(raw) as Partial<CloudTrackRecord>;
			if (value.schema !== CLOUD_TRACK_SCHEMA_ID || typeof value.sandboxId !== 'string' || typeof value.status !== 'string') {
				return undefined;
			}
			return value as CloudTrackRecord;
		} catch {
			return undefined; // unreadable truth reads as gone (stale), never healthy
		}
	}

	private async writeTrack(record: CloudTrackRecord): Promise<void> {
		await this.fs.mkdir(joinPath(this.root, '.flauz', 'env-cloud'));
		await this.fs.writeFile(this.trackPathOf(record.environmentId), serializeEnvelope(record));
	}

	/** The validated descriptor connection (typed rejection on shape drift / literal keys). */
	private connectionOf(descriptor: EnvironmentDescriptor): { ok: true; connection: { readonly provider: string; readonly apiKeyRef: string; readonly sandboxTemplate: string; readonly region?: string } } | { ok: false; error: { code: string; message: string } } {
		const connection = descriptor.connection as { provider?: unknown; apiKeyRef?: unknown; sandboxTemplate?: unknown; region?: unknown };
		if (typeof connection?.apiKeyRef !== 'string' || !isSecretRef(connection.apiKeyRef)) {
			return { ok: false, error: { code: 'CONNECTION_INVALID', message: `cloud-sandbox descriptor '${descriptor.id}' must carry a vault-style apiKeyRef (vault:<name> or env:<name>) — literal keys are rejected (SECURITY-MODEL 3.5)` } };
		}
		if (typeof connection.sandboxTemplate !== 'string' || connection.sandboxTemplate.length === 0) {
			return { ok: false, error: { code: 'CONNECTION_INVALID', message: `cloud-sandbox descriptor '${descriptor.id}' must carry a sandboxTemplate (data field)` } };
		}
		return {
			ok: true,
			connection: {
				provider: typeof connection.provider === 'string' ? connection.provider : 'custom',
				apiKeyRef: connection.apiKeyRef,
				sandboxTemplate: connection.sandboxTemplate,
				...(typeof connection.region === 'string' && connection.region.length > 0 ? { region: connection.region } : {}),
			},
		};
	}

	/** One REST call with the typed failure classes (never a raw throw). */
	private async call(method: string, path: string, apiKey: string, body?: Record<string, unknown>): Promise<{ ok: true; payload: Record<string, unknown> } | { ok: false; error: { code: string; message: string } }> {
		let response: { readonly status: number; readonly bodyText: string };
		try {
			response = await this.http.fetch({
				method,
				url: `${this.baseUrl}${path}`,
				headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
				timeoutMs: this.requestTimeoutMs,
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if (/abort|timeout|timed out/i.test(message)) {
				return { ok: false, error: { code: 'CLOUD_TIMEOUT', message: `cloud-sandbox ${method} ${path} timed out after ${this.requestTimeoutMs} ms` } };
			}
			return { ok: false, error: { code: 'CLOUD_UNREACHABLE', message: `cloud-sandbox ${method} ${path} could not reach ${this.baseUrl} (${excerpt(message)})` } };
		}
		if (response.status === 401 || response.status === 403) {
			return { ok: false, error: { code: 'CLOUD_AUTH_FAILED', message: `cloud-sandbox ${method} ${path} was rejected as unauthorized (HTTP ${response.status}) — check the ${'apiKeyRef'} resolution and the provider account` } };
		}
		if (response.status === 404) {
			return { ok: false, error: { code: 'CLOUD_SANDBOX_UNKNOWN', message: `cloud-sandbox ${method} ${path}: the provider no longer knows this sandbox (HTTP 404)` } };
		}
		if (response.status < 200 || response.status >= 300) {
			return { ok: false, error: { code: 'CLOUD_PROVIDER_ERROR', message: `cloud-sandbox ${method} ${path} failed (HTTP ${response.status}): ${excerpt(response.bodyText)}` } };
		}
		if (response.bodyText.trim().length === 0) {
			return { ok: true, payload: {} }; // 204-class empty body is legal
		}
		try {
			const payload = JSON.parse(response.bodyText) as Record<string, unknown>;
			if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
				return { ok: false, error: { code: 'CLOUD_PROTOCOL_ERROR', message: `cloud-sandbox ${method} ${path} returned a non-object JSON body` } };
			}
			return { ok: true, payload };
		} catch {
			return { ok: false, error: { code: 'CLOUD_PROTOCOL_ERROR', message: `cloud-sandbox ${method} ${path} returned a malformed JSON body: ${excerpt(response.bodyText)}` } };
		}
	}

	/** Resolves the API key through the vault port (never stores it). */
	private async resolveKey(descriptor: EnvironmentDescriptor, apiKeyRef: string): Promise<{ ok: true; apiKey: string } | { ok: false; error: { code: string; message: string } }> {
		const resolved = await this.secrets.resolve(apiKeyRef);
		if (resolved === undefined || resolved.length === 0) {
			return { ok: false, error: { code: 'VAULT_REF_UNRESOLVED', message: `cloud-sandbox descriptor '${descriptor.id}' references ${apiKeyRef} which cannot be resolved through the secret resolver — the cloud executor fails closed (install the key in the vault/environment or drive the simulated executor with { simulated: true })` } };
		}
		return { ok: true, apiKey: resolved };
	}

	// -- the ops -------------------------------------------------------------------

	async create(descriptor: EnvironmentDescriptor, _ctx: ExecutorOpContext): Promise<ExecutorEffectResult> {
		const shape = this.connectionOf(descriptor);
		if (!shape.ok) {
			return { ok: false, error: shape.error };
		}
		const key = await this.resolveKey(descriptor, shape.connection.apiKeyRef);
		if (!key.ok) {
			return { ok: false, error: key.error };
		}
		const response = await this.call('POST', '/v0/sandboxes', key.apiKey, {
			template: shape.connection.sandboxTemplate,
			metadata: { environmentId: descriptor.id, ...(shape.connection.region === undefined ? {} : { region: shape.connection.region }) },
		});
		if (!response.ok) {
			return { ok: false, error: response.error };
		}
		const sandboxId = response.payload.sandboxId;
		if (typeof sandboxId !== 'string' || sandboxId.length === 0) {
			return effectError('CLOUD_PROTOCOL_ERROR', `cloud-sandbox create for '${descriptor.id}' returned no sandboxId: ${JSON.stringify(response.payload)}`);
		}
		await this.writeTrack({
			schemaVersion: 0,
			schema: CLOUD_TRACK_SCHEMA_ID,
			environmentId: descriptor.id,
			sandboxId,
			status: 'created',
			startedAt: null,
			lease: null,
			snapshots: [],
		});
		return { ok: true, detail: { type: 'create', stateDir: joinPath(this.root, '.flauz', 'env-cloud') } };
	}

	async start(descriptor: EnvironmentDescriptor, ctx: ExecutorOpContext): Promise<ExecutorEffectResult> {
		const shape = this.connectionOf(descriptor);
		if (!shape.ok) {
			return { ok: false, error: shape.error };
		}
		const track = await this.readTrack(descriptor.id);
		if (track === undefined) {
			return effectError('CLOUD_SANDBOX_UNKNOWN', `environment '${descriptor.id}' has no cloud tracking record (create first)`);
		}
		const key = await this.resolveKey(descriptor, shape.connection.apiKeyRef);
		if (!key.ok) {
			return { ok: false, error: key.error };
		}
		const response = await this.call('POST', `/v0/sandboxes/${track.sandboxId}/start`, key.apiKey, {});
		if (!response.ok) {
			return { ok: false, error: response.error };
		}
		await this.writeTrack({ ...track, status: 'running', startedAt: ctx.now });
		// a cloud sandbox has no local process id — 0 is the documented no-pid marker
		return { ok: true, detail: { type: 'start', pid: 0 } };
	}

	async stop(descriptor: EnvironmentDescriptor, _ctx: ExecutorOpContext): Promise<ExecutorEffectResult> {
		const shape = this.connectionOf(descriptor);
		if (!shape.ok) {
			return { ok: false, error: shape.error };
		}
		const track = await this.readTrack(descriptor.id);
		if (track === undefined) {
			return effectError('CLOUD_SANDBOX_UNKNOWN', `environment '${descriptor.id}' has no cloud tracking record (create first)`);
		}
		const key = await this.resolveKey(descriptor, shape.connection.apiKeyRef);
		if (!key.ok) {
			return { ok: false, error: key.error };
		}
		const response = await this.call('POST', `/v0/sandboxes/${track.sandboxId}/stop`, key.apiKey, {});
		if (!response.ok) {
			return { ok: false, error: response.error };
		}
		await this.writeTrack({ ...track, status: 'stopped', lease: null });
		return { ok: true, detail: { type: 'stop', pid: 0, forcedSignal: null } };
	}

	async attach(descriptor: EnvironmentDescriptor, ctx: ExecutorOpContext): Promise<ExecutorEffectResult> {
		const track = await this.readTrack(descriptor.id);
		if (track === undefined) {
			return effectError('CLOUD_SANDBOX_UNKNOWN', `environment '${descriptor.id}' has no cloud tracking record (create first)`);
		}
		if (track.lease !== null) {
			return effectError('CLOUD_LEASE_HELD', `environment '${descriptor.id}' already holds lease '${track.lease.leaseId}'`);
		}
		this.leaseCounter += 1;
		const lease = { leaseId: `cloud-lease-${descriptor.id}-${this.leaseCounter}`, heldSince: ctx.now };
		await this.writeTrack({ ...track, lease });
		return { ok: true, detail: { type: 'attach', leaseId: lease.leaseId, heldSince: lease.heldSince } };
	}

	async detach(descriptor: EnvironmentDescriptor, _ctx: ExecutorOpContext): Promise<ExecutorEffectResult> {
		const track = await this.readTrack(descriptor.id);
		if (track === undefined || track.lease === null) {
			return effectError('NO_LEASE', `environment '${descriptor.id}' holds no connection lease`);
		}
		const leaseId = track.lease.leaseId;
		await this.writeTrack({ ...track, lease: null });
		return { ok: true, detail: { type: 'detach', leaseId } };
	}

	async snapshot(descriptor: EnvironmentDescriptor, ctx: ExecutorOpContext): Promise<ExecutorEffectResult> {
		const shape = this.connectionOf(descriptor);
		if (!shape.ok) {
			return { ok: false, error: shape.error };
		}
		const track = await this.readTrack(descriptor.id);
		if (track === undefined) {
			return effectError('CLOUD_SANDBOX_UNKNOWN', `environment '${descriptor.id}' has no cloud tracking record (create first)`);
		}
		const key = await this.resolveKey(descriptor, shape.connection.apiKeyRef);
		if (!key.ok) {
			return { ok: false, error: key.error };
		}
		const response = await this.call('POST', `/v0/sandboxes/${track.sandboxId}/snapshots`, key.apiKey, {});
		if (!response.ok) {
			return { ok: false, error: response.error };
		}
		const snapshotId = response.payload.snapshotId;
		if (typeof snapshotId !== 'string' || snapshotId.length === 0) {
			return effectError('CLOUD_PROTOCOL_ERROR', `cloud-sandbox snapshot for '${descriptor.id}' returned no snapshotId: ${JSON.stringify(response.payload)}`);
		}
		const snapshotDir = joinPath(this.snapshotRootOf(descriptor.id), String(ctx.now));
		await this.fs.mkdir(snapshotDir);
		const document = serializeEnvelope({
			schemaVersion: 0,
			schema: CLOUD_SNAPSHOT_DOC_SCHEMA_ID,
			environmentId: descriptor.id,
			sandboxId: track.sandboxId,
			snapshotId,
			createdAt: ctx.now,
		});
		await this.fs.writeFile(joinPath(snapshotDir, 'cloud-snapshot.json'), document);
		const file: SnapshotManifestFile = { bytes: document.length, path: 'cloud-snapshot.json', sha256: this.hash.sha256Hex(document) };
		const manifest: SnapshotManifest = {
			schemaVersion: 0,
			schema: CLOUD_SNAPSHOT_MANIFEST_SCHEMA_ID,
			environmentId: descriptor.id,
			createdAt: ctx.now,
			files: [file],
		};
		const manifestPath = joinPath(snapshotDir, 'manifest.json');
		await this.fs.writeFile(manifestPath, serializeEnvelope(manifest));
		await this.writeTrack({ ...track, snapshots: [...track.snapshots, snapshotDir] });
		return { ok: true, detail: { type: 'snapshot', snapshotDir, fileCount: 1, manifestPath } };
	}

	async destroy(descriptor: EnvironmentDescriptor, _ctx: ExecutorOpContext): Promise<ExecutorEffectResult> {
		const shape = this.connectionOf(descriptor);
		if (!shape.ok) {
			return { ok: false, error: shape.error };
		}
		const track = await this.readTrack(descriptor.id);
		if (track === undefined) {
			return { ok: true, detail: { type: 'destroy', pid: null } }; // already gone — idempotent
		}
		const key = await this.resolveKey(descriptor, shape.connection.apiKeyRef);
		if (!key.ok) {
			return { ok: false, error: key.error };
		}
		const response = await this.call('DELETE', `/v0/sandboxes/${track.sandboxId}`, key.apiKey);
		if (!response.ok) {
			return { ok: false, error: response.error };
		}
		await this.fs.rm(this.trackPathOf(descriptor.id)).catch(() => undefined);
		return { ok: true, detail: { type: 'destroy', pid: null } };
	}

	async probe(descriptor: EnvironmentDescriptor): Promise<DescribeVerdict> {
		const track = await this.readTrack(descriptor.id);
		if (track === undefined) {
			return {
				health: 'not-running',
				state: 'stopped',
				pid: null,
				message: `no cloud tracking record for '${descriptor.id}' (never created, or destroyed)`,
			};
		}
		if (track.lease !== null) {
			return this.provideVerdict(descriptor, track, { leaseId: track.lease.leaseId, heldSince: track.lease.heldSince });
		}
		return this.provideVerdict(descriptor, track);
	}

	/** Provider-authoritative health: the track file alone is never healthy. */
	private async provideVerdict(descriptor: EnvironmentDescriptor, track: CloudTrackRecord, lease?: { readonly leaseId: string; readonly heldSince: number }): Promise<DescribeVerdict> {
		const shape = this.connectionOf(descriptor);
		if (!shape.ok) {
			return { health: 'stale', state: 'stopped', pid: null, message: shape.error.message, ...(lease === undefined ? {} : { lease }) };
		}
		const key = await this.resolveKey(descriptor, shape.connection.apiKeyRef);
		if (!key.ok) {
			// keys absent => truth not verifiable => fail-closed, never silently healthy
			return { health: 'stale', state: 'stopped', pid: null, message: key.error.message, ...(lease === undefined ? {} : { lease }) };
		}
		const response = await this.call('GET', `/v0/sandboxes/${track.sandboxId}`, key.apiKey);
		if (!response.ok) {
			const message = response.error.code === 'CLOUD_SANDBOX_UNKNOWN'
				? `sandbox ${track.sandboxId} for '${descriptor.id}' is gone at the provider while the tracking record still exists (crash/external deletion — the lifecycle state outruns the truth)`
				: response.error.message;
			return { health: 'stale', state: 'stopped', pid: null, message, ...(lease === undefined ? {} : { lease }) };
		}
		const status = response.payload.status;
		if (status === 'running') {
			return {
				health: 'healthy',
				state: 'running',
				pid: null,
				message: `cloud sandbox ${track.sandboxId} for '${descriptor.id}' is running at the provider (provider-authoritative truth)`,
				...(lease === undefined ? {} : { lease }),
			};
		}
		return {
			health: 'not-running',
			state: 'stopped',
			pid: null,
			message: `cloud sandbox ${track.sandboxId} for '${descriptor.id}' is ${typeof status === 'string' ? status : 'in an unknown provider state'} at the provider`,
			...(lease === undefined ? {} : { lease }),
		};
	}
}
