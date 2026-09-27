/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL3-004 rung 1 — the cloud-http adapter drilled against a LOCAL mock server
 * (node:http on 127.0.0.1:0 — no external network): the full happy path, every
 * failure class (401 / 404 / 5xx / unreachable / timeout / VAULT_REF_UNRESOLVED /
 * literal keys), reconciliation semantics, and the no-key-in-artifacts
 * assertion (the resolved key exists ONLY inside the Authorization header —
 * never in any persisted artifact or ledger record).
 */
import { test } from 'node:test';
import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import * as http from 'node:http';
import { createHash } from 'node:crypto';
import { EnvironmentRegistry } from '../src/registry.ts';
import { CloudHttpExecutor, nodeHttpPort } from '../src/lifecycle/index.ts';
import type { LocalEnvFsPort } from '../src/lifecycle/index.ts';
import { cloudSandboxRegistrationInput, fixedClock } from './helpers.ts';

const ROOT = '/ws';

/** The mock key — assembled at RUNTIME from fragments so no secret-shaped literal lands in source. */
function mockApiKey(): string {
	return ['flauz', 'mock', 'vault', 'key'].join('-');
}

interface CapturedRequest {
	readonly method: string;
	readonly path: string;
	readonly headers: Record<string, string | string[] | undefined>;
	readonly body: string;
}

interface MockCloud {
	readonly port: number;
	readonly requests: CapturedRequest[];
	/** Test-configurable sandbox status per id (default absent = 404). */
	readonly sandboxes: Map<string, string>;
	/** Optional failure injection: (req) => {status, body, delayMs?}. */
	override?: (request: CapturedRequest) => { status: number; body?: string; delayMs?: number } | undefined;
	close(): Promise<void>;
}

/** A local node:http mock of the Flauz cloud-sandbox wire contract v0. */
async function startMockCloud(): Promise<MockCloud> {
	const requests: CapturedRequest[] = [];
	const sandboxes = new Map<string, string>();
	let snapshotCounter = 0;
	const server = http.createServer((req, res) => {
		const chunks: Array<{ toString(encoding?: string): string }> = [];
		req.on('data', (chunk: { toString(encoding?: string): string }) => chunks.push(chunk));
		req.on('end', () => {
			const body = chunks.map(chunk => chunk.toString('utf-8')).join('');
			const captured: CapturedRequest = { method: req.method ?? '', path: req.url ?? '', headers: { ...req.headers }, body };
			requests.push(captured);
			// every response closes its socket (the test tears the server down promptly)
			const respond = (status: number, payload?: string): void => {
				res.writeHead(status, { 'Content-Type': 'application/json', 'Connection': 'close' });
				res.end(payload ?? '');
			};
			if (overrideHolder.value !== undefined) {
				const injected = overrideHolder.value(captured);
				if (injected !== undefined) {
					if (injected.delayMs !== undefined) {
						setTimeout(() => respond(injected.status, injected.body), injected.delayMs);
						return;
					}
					respond(injected.status, injected.body);
					return;
				}
			}
			const segments = captured.path.split('/').filter(segment => segment.length > 0); // v0/sandboxes/<id>[/<op>]
			if (segments[0] !== 'v0' || segments[1] !== 'sandboxes') {
				respond(404, JSON.stringify({ error: 'unknown route' }));
				return;
			}
			const sandboxId = segments[2];
			if (sandboxId === undefined) {
				if (captured.method === 'POST') {
					const id = `sbx-${requests.length}`;
					sandboxes.set(id, 'created');
					respond(200, JSON.stringify({ sandboxId: id, status: 'created' }));
					return;
				}
				respond(405, JSON.stringify({ error: 'method not allowed' }));
				return;
			}
			const op = segments[3];
			if (op === undefined) {
				if (captured.method === 'GET') {
					const status = sandboxes.get(sandboxId);
					if (status === undefined) {
						respond(404, JSON.stringify({ error: 'no such sandbox' }));
						return;
					}
					respond(200, JSON.stringify({ sandboxId, status }));
					return;
				}
				if (captured.method === 'DELETE') {
					sandboxes.delete(sandboxId);
					respond(204);
					return;
				}
				respond(405, JSON.stringify({ error: 'method not allowed' }));
				return;
			}
			if (captured.method !== 'POST') {
				respond(405, JSON.stringify({ error: 'method not allowed' }));
				return;
			}
			if (!sandboxes.has(sandboxId)) {
				respond(404, JSON.stringify({ error: 'no such sandbox' }));
				return;
			}
			if (op === 'start') {
				sandboxes.set(sandboxId, 'running');
				respond(200, JSON.stringify({ sandboxId, status: 'running', startedAt: 1730000000000 }));
				return;
			}
			if (op === 'stop') {
				sandboxes.set(sandboxId, 'stopped');
				respond(200, JSON.stringify({ sandboxId, status: 'stopped', stoppedAt: 1730000009999 }));
				return;
			}
			if (op === 'snapshots') {
				snapshotCounter += 1;
				respond(200, JSON.stringify({ snapshotId: `snap-${snapshotCounter}`, createdAt: 1730000010000 }));
				return;
			}
			respond(404, JSON.stringify({ error: 'no such sandbox op' }));
		});
	});
	const overrideHolder: { value?: (request: CapturedRequest) => { status: number; body?: string; delayMs?: number } | undefined } = {};
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
	const port = server.address().port;
	return {
		port,
		requests,
		sandboxes,
		get override() {
			return overrideHolder.value;
		},
		set override(value) {
			overrideHolder.value = value;
		},
		close: () => new Promise<void>(resolve => server.close(() => resolve())),
	};
}

/** In-memory LocalEnvFsPort. */
function memLocalFs(files: Map<string, string>): LocalEnvFsPort {
	return {
		readFileUtf8: async target => files.get(target),
		writeFile: async (target, contents) => {
			files.set(target, contents);
		},
		rename: async (from, to) => {
			files.set(to, files.get(from)!);
			files.delete(from);
		},
		mkdir: async () => undefined,
		readdir: async () => [],
		rm: async target => {
			files.delete(target);
		},
	};
}

interface CloudRig {
	mock: MockCloud;
	files: Map<string, string>;
	manager: CloudRigManager;
	executor: CloudHttpExecutor;
	apiKey: string;
}

type CloudRigManager = import('../src/lifecycle/index.ts').EnvironmentLifecycleManager;

async function bootCloud(options: { baseUrl?: string; resolver?: () => Promise<string | undefined>; registration?: Record<string, unknown>; requestTimeoutMs?: number } = {}): Promise<CloudRig> {
	const mock = await startMockCloud();
	const files = new Map<string, string>();
	const localFs = memLocalFs(files);
	const clock = fixedClock();
	const apiKey = mockApiKey();
	const registration = options.registration ?? cloudSandboxRegistrationInput({ trust: { posture: 'trusted', inheritsWorkspaceTrust: false } });
	const registry = new EnvironmentRegistry({ root: ROOT, fs: localFs, clock });
	await registry.bootstrap();
	await registry.register(registration as never);
	const executor = new CloudHttpExecutor({
		root: ROOT,
		http: nodeHttpPort,
		secrets: { resolve: options.resolver ?? (async () => apiKey) },
		baseUrl: options.baseUrl ?? `http://127.0.0.1:${mock.port}`,
		fs: localFs,
		hash: { sha256Hex: contents => createHash('sha256').update(contents, 'utf-8').digest('hex') },
		clock,
		requestTimeoutMs: options.requestTimeoutMs ?? 2_000,
	});
	const manager = new (await import('../src/lifecycle/index.ts')).EnvironmentLifecycleManager({ registry, root: ROOT, fs: localFs, clock, executors: [executor] });
	await manager.bootstrap();
	return { mock, files, manager, executor, apiKey };
}

test('cloud-http: the full happy path against the local mock (create/start/attach/snapshot/detach/stop/destroy)', async () => {
	const rig = await bootCloud();
	try {
		const id = 'env-test-cloud';
		const opts = { id, actor: 'human' as const };
		const created = await rig.manager.perform('create', opts);
		ok(created.ok, JSON.stringify(created.ok ? '' : created.error));
		strictEqual(rig.manager.entryOf(id)!.executorKind, 'cloud-http');
		const createRequest = rig.mock.requests[0]!;
		strictEqual(createRequest.method, 'POST');
		strictEqual(createRequest.path, '/v0/sandboxes');
		deepStrictEqual(JSON.parse(createRequest.body), { template: 'base', metadata: { environmentId: id } });
		strictEqual(createRequest.headers['authorization'], `Bearer ${rig.apiKey}`);
		const track = JSON.parse(rig.files.get(`/ws/.flauz/env-cloud/${id}.json`)!);
		strictEqual(track.schema, 'flauz.env-cloud/v0');
		strictEqual(track.status, 'created');

		// probe between create and start: provider-authoritative not-running
		const createdReport = await rig.manager.describe({ id });
		strictEqual(createdReport.verdict.health, 'not-running');

		const started = await rig.manager.perform('start', opts);
		ok(started.ok, JSON.stringify(started.ok ? '' : started.error));
		strictEqual(started.detail?.type === 'start' ? started.detail.pid : -1, 0, 'a cloud sandbox has no local process id (documented marker 0)');
		strictEqual(rig.manager.stateOf(id), 'running');
		const report = await rig.manager.describe({ id });
		strictEqual(report.verdict.health, 'healthy');
		strictEqual(report.verdict.pid, null);
		strictEqual(rig.mock.requests.find(request => request.path.endsWith('/start'))?.method, 'POST');

		const attached = await rig.manager.perform('attach', opts);
		ok(attached.ok);
		strictEqual(rig.manager.stateOf(id), 'running/attached');
		const attachedReport = await rig.manager.describe({ id });
		ok(attachedReport.verdict.lease !== undefined);
		ok(attachedReport.verdict.lease!.leaseId.startsWith('cloud-lease-'));

		const snapshotted = await rig.manager.perform('snapshot', { id, actor: 'tool' });
		ok(snapshotted.ok, JSON.stringify(snapshotted.ok ? '' : snapshotted.error));
		const detail = snapshotted.detail?.type === 'snapshot' ? snapshotted.detail : undefined;
		ok(detail !== undefined);
		const snapshotDoc = JSON.parse(rig.files.get(`${detail.snapshotDir}/cloud-snapshot.json`)!);
		strictEqual(snapshotDoc.schema, 'flauz.cloud-snapshot/v0');
		strictEqual(typeof snapshotDoc.snapshotId, 'string');
		const manifest = JSON.parse(rig.files.get(detail.manifestPath)!) as {
			schema: string; files: Array<{ bytes: number; path: string; sha256: string }>;
		};
		strictEqual(manifest.schema, 'flauz.env-snapshot-manifest/v0');
		strictEqual(manifest.files[0]!.path, 'cloud-snapshot.json');
		strictEqual(manifest.files[0]!.sha256, createHash('sha256').update(rig.files.get(`${detail.snapshotDir}/cloud-snapshot.json`)!, 'utf-8').digest('hex'));

		const detached = await rig.manager.perform('detach', opts);
		ok(detached.ok);
		strictEqual(rig.manager.stateOf(id), 'running');

		const stopped = await rig.manager.perform('stop', opts);
		ok(stopped.ok, JSON.stringify(stopped.ok ? '' : stopped.error));
		const stopDetail = stopped.detail?.type === 'stop' ? stopped.detail : undefined;
		strictEqual(stopDetail?.pid, 0);
		strictEqual(stopDetail?.forcedSignal, null);
		strictEqual(rig.manager.stateOf(id), 'stopped');
		strictEqual((await rig.manager.describe({ id })).verdict.health, 'not-running');

		const destroyed = await rig.manager.perform('destroy', opts);
		ok(destroyed.ok, JSON.stringify(destroyed.ok ? '' : destroyed.error));
		strictEqual(rig.files.has(`/ws/.flauz/env-cloud/${id}.json`), false, 'the tracking record was removed');
		strictEqual(rig.mock.requests.some(request => request.method === 'DELETE' && request.path.startsWith('/v0/sandboxes/sbx-')), true);
		strictEqual(rig.manager.stateOf(id), 'destroyed');

		// the ledger recorded every op with provenance
		deepStrictEqual(rig.manager.ops().map(record => record.op), ['create', 'start', 'attach', 'snapshot', 'detach', 'stop', 'destroy']);

		// THE NO-KEY ASSERTION: the resolved key appears ONLY as the Authorization
		// header value — never in any persisted artifact or ledger record.
		for (const [path, contents] of rig.files) {
			ok(!contents.includes(rig.apiKey), `no persisted artifact leaks the key (${path})`);
		}
		for (const record of rig.manager.ops()) {
			const serialized = JSON.stringify(record);
			ok(!serialized.includes(rig.apiKey), 'no ledger record leaks the key');
			if (record.error !== undefined) {
				ok(!record.error.message.includes(rig.apiKey), 'no error message leaks the key');
			}
		}
		for (const request of rig.mock.requests) {
			for (const [header, value] of Object.entries(request.headers)) {
				if (header === 'authorization') {
					strictEqual(value, `Bearer ${rig.apiKey}`);
					continue;
				}
				ok(!String(value).includes(rig.apiKey), `no other header leaks the key (${header})`);
			}
			ok(!request.body.includes(rig.apiKey), 'no request body leaks the key');
		}
	} finally {
		await rig.mock.close();
	}
});

test('cloud-http: 401 is the typed CLOUD_AUTH_FAILED failure class', async () => {
	const rig = await bootCloud();
	try {
		rig.mock.override = () => ({ status: 401, body: JSON.stringify({ error: 'unauthorized' }) });
		const created = await rig.manager.perform('create', { id: 'env-test-cloud', actor: 'human' });
		ok(!created.ok);
		strictEqual(created.error.code, 'CLOUD_AUTH_FAILED');
		ok(!created.error.message.includes(rig.apiKey), 'the auth failure never echoes the key');
	} finally {
		await rig.mock.close();
	}
});

test('cloud-http: 404 is the typed CLOUD_SANDBOX_UNKNOWN failure class (and a stale verdict at probe)', async () => {
	const rig = await bootCloud();
	try {
		await rig.manager.perform('create', { id: 'env-test-cloud', actor: 'human' });
		rig.mock.sandboxes.clear(); // the provider forgets the sandbox
		const started = await rig.manager.perform('start', { id: 'env-test-cloud', actor: 'human' });
		ok(!started.ok);
		strictEqual(started.error.code, 'CLOUD_SANDBOX_UNKNOWN');
		strictEqual(rig.manager.stateOf('env-test-cloud'), 'failed'); // a failed start lands in failed
		const report = await rig.manager.describe({ id: 'env-test-cloud' });
		strictEqual(report.state, 'failed');
		strictEqual(report.verdict.health, 'stale');
		ok(report.verdict.message.includes('gone at the provider'));
	} finally {
		await rig.mock.close();
	}
});

test('cloud-http: a 5xx is the typed CLOUD_PROVIDER_ERROR failure class (status carried)', async () => {
	const rig = await bootCloud();
	try {
		rig.mock.override = () => ({ status: 503, body: JSON.stringify({ error: 'overloaded' }) });
		const created = await rig.manager.perform('create', { id: 'env-test-cloud', actor: 'human' });
		ok(!created.ok);
		strictEqual(created.error.code, 'CLOUD_PROVIDER_ERROR');
		ok(created.error.message.includes('503'));
	} finally {
		await rig.mock.close();
	}
});

test('cloud-http: an unreachable API is the typed CLOUD_UNREACHABLE failure class', async () => {
	// port 1 on loopback: nothing listens — connection refused, no external network
	const rig = await bootCloud({ baseUrl: 'http://127.0.0.1:1' });
	try {
		const created = await rig.manager.perform('create', { id: 'env-test-cloud', actor: 'human' });
		ok(!created.ok);
		strictEqual(created.error.code, 'CLOUD_UNREACHABLE');
	} finally {
		await rig.mock.close();
	}
});

test('cloud-http: a wall-clock expiry is the typed CLOUD_TIMEOUT failure class', async () => {
	const rig = await bootCloud({ requestTimeoutMs: 80 });
	try {
		rig.mock.override = () => ({ status: 200, body: JSON.stringify({ sandboxId: 'sbx-late', status: 'created' }), delayMs: 400 });
		const created = await rig.manager.perform('create', { id: 'env-test-cloud', actor: 'human' });
		ok(!created.ok);
		strictEqual(created.error.code, 'CLOUD_TIMEOUT');
	} finally {
		await rig.mock.close();
	}
});

test('cloud-http: an unresolvable vault reference is the typed VAULT_REF_UNRESOLVED fail-closed (the keys-absent case)', async () => {
	const rig = await bootCloud({ resolver: async () => undefined });
	try {
		const created = await rig.manager.perform('create', { id: 'env-test-cloud', actor: 'human' });
		ok(!created.ok);
		strictEqual(created.error.code, 'VAULT_REF_UNRESOLVED');
		ok(created.error.message.includes('fails closed'));
		strictEqual(rig.manager.entryOf('env-test-cloud'), undefined);
		strictEqual(rig.mock.requests.length, 0, 'no request left the machine without a resolvable key');
	} finally {
		await rig.mock.close();
	}
});

test('cloud-http: a literal key in the descriptor is rejected (schema law, defense in depth at the executor)', async () => {
	const rig = await bootCloud();
	try {
		const descriptor = {
			id: 'env-test-cloud',
			kind: 'cloud-sandbox',
			label: 'Literal key',
			connection: { provider: 'e2b', apiKeyRef: 'e2b-key-literal-not-a-ref', sandboxTemplate: 'base' },
			trust: { posture: 'trusted', inheritsWorkspaceTrust: false },
			capabilities: { agentHost: true, browser: false, exec: true, terminal: false },
			enabled: true,
			timing: { created: 1, updatedAt: 1 },
		};
		const created = await rig.executor.create(descriptor as never, { actor: 'human', now: Date.now() });
		ok(!created.ok);
		strictEqual(created.error.code, 'CONNECTION_INVALID');
		ok(created.error.message.includes('vault'));
		strictEqual(rig.mock.requests.length, 0);
	} finally {
		await rig.mock.close();
	}
});

test('cloud-http: the trust gate holds — the cloud default posture (untrusted) rejects start before any request', async () => {
	const rig = await bootCloud({ registration: cloudSandboxRegistrationInput() });
	try {
		const id = 'env-test-cloud';
		await rig.manager.perform('create', { id, actor: 'human' });
		const requestsBefore = rig.mock.requests.length;
		const started = await rig.manager.perform('start', { id, actor: 'agent' });
		ok(!started.ok);
		strictEqual(started.error.code, 'TRUST_POSTURE_REJECTED');
		strictEqual(rig.mock.requests.length, requestsBefore);
	} finally {
		await rig.mock.close();
	}
});

test('cloud-http: reconciliation is provider-authoritative — a tracked running sandbox stays healthy across a fresh executor (host restart)', async () => {
	const rig = await bootCloud();
	try {
		const id = 'env-test-cloud';
		await rig.manager.perform('create', { id, actor: 'human' });
		await rig.manager.perform('start', { id, actor: 'human' });
		// HOST RESTART: a fresh registry + executor + manager over the same tracking file
		const files2 = new Map(rig.files);
		const localFs2 = memLocalFs(files2);
		const clock = fixedClock();
		const registry2 = new EnvironmentRegistry({ root: ROOT, fs: localFs2, clock });
		await registry2.bootstrap();
		const executor2 = new CloudHttpExecutor({
			root: ROOT,
			http: nodeHttpPort,
			secrets: { resolve: async () => rig.apiKey },
			baseUrl: `http://127.0.0.1:${rig.mock.port}`,
			fs: localFs2,
			hash: { sha256Hex: contents => createHash('sha256').update(contents, 'utf-8').digest('hex') },
			clock,
		});
		const manager2 = new (await import('../src/lifecycle/index.ts')).EnvironmentLifecycleManager({ registry: registry2, root: ROOT, fs: localFs2, clock, executors: [executor2] });
		await manager2.bootstrap();
		strictEqual(manager2.stateOf(id), 'running');
		const report = await manager2.describe({ id });
		strictEqual(report.verdict.health, 'healthy');
		strictEqual(report.executorKind, 'cloud-http');
		// and the second instance can stop it (the provider is the authority)
		const stopped = await manager2.perform('stop', { id, actor: 'human' });
		ok(stopped.ok, JSON.stringify(stopped.ok ? '' : stopped.error));
		strictEqual(manager2.stateOf(id), 'stopped');
	} finally {
		await rig.mock.close();
	}
});
