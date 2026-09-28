/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL3-H1 rung 2 — the resolver core drills (node --test, zero deps).
 *
 * Coverage matrix (the work order's pinned set):
 *   - the trust gate BOTH DIRECTIONS: a trusted+running environment resolves;
 *     an untrusted one NEVER does (even with a perfect probe script); an
 *     environment absent from the PIN-2 state is TRUST_REFUSED alike.
 *   - the policy gate: disabled / non-running states => POSTURE_REFUSED.
 *   - re-resolution re-checks the CURRENT state: a trust/state flip between
 *     resolves flips the verdict (nothing is cached).
 *   - the authority -> environment -> plan lookup paths (ENVIRONMENT_ABSENT /
 *     PLAN_ABSENT — the latter is a defense-in-depth drill over a duck-typed
 *     registry, labeled TEST INFRASTRUCTURE).
 *   - per-kind endpoint drills over FakeCli / the HttpPort stub / the
 *     SecretResolverPort stub (NO real binaries — the liveRemote suite owns
 *     those): ssh probe + bridge handshake (token via the port ONLY, the
 *     --agent-host-port mutual exclusion), docker inspect (deterministic
 *     flauz-<envId> name), the cloud wire probe (bearer from the port,
 *     track-record gated), the workspace-remote lifecycle-state posture.
 *   - the DL-31 schema law: literal keys (bridge tokens, cloud apiKeyRef)
 *     are rejected at the registry level — the resolver never sees them.
 */
import { test } from 'node:test';
import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { EnvironmentRegistry } from '../src/registry.ts';
import { EnvironmentLifecycleManager, SimulatedRemoteExecutor, type SimFsPort } from '../src/lifecycle/index.ts';
import type { EnvironmentDescriptor, EnvironmentKind } from '../src/api.ts';
import type { ConnectionPlan } from '../src/providers/types.ts';
import type { EnvironmentRegistry as RegistryPort } from '../src/registry.ts';
import { AGENT_HOST_BRIDGE_TOKEN_ENV_VAR, FLAUZ_ENV_AUTHORITY_PREFIX, FlauzEnvResolver, RESOLVER_ERROR_CODES, formatFlauzEnvAuthority, type FlauzEnvResolverOptions, type ResolverOutcome } from '../src/resolver/index.ts';
import type { HttpPort, SecretResolverPort } from '../src/lifecycle/cloudHttp.ts';
import { FakeCli } from './fakeCli.ts';
import { cloudSandboxRegistrationInput, containerRegistrationInput, fixedClock, sshRegistrationInput, workspaceRemoteRegistrationInput } from './helpers.ts';

const ROOT = '/ws';

// ---------------------------------------------------------------------------
// The rig (mem fs + FakeCli + stub http/secrets — zero real effects)
// ---------------------------------------------------------------------------

interface StubHttp extends HttpPort {
	readonly requests: { method: string; url: string; headers?: Record<string, string> }[];
}

function stubHttp(handler: (request: { method: string; url: string; headers?: Record<string, string> }) => { status: number; bodyText: string }): StubHttp {
	const requests: { method: string; url: string; headers?: Record<string, string> }[] = [];
	return {
		requests,
		fetch: async request => {
			requests.push({ method: request.method, url: request.url, ...(request.headers === undefined ? {} : { headers: request.headers }) });
			return handler(request);
		},
	};
}

interface StubSecrets extends SecretResolverPort {
	readonly calls: string[];
}

function stubSecrets(values: Record<string, string> = {}): StubSecrets {
	const calls: string[] = [];
	return {
		calls,
		resolve: async ref => {
			calls.push(ref);
			const value = values[ref];
			return value !== undefined && value.length > 0 ? value : undefined;
		},
	};
}

function rigFs(files: Map<string, string> = new Map()): SimFsPort {
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
		rm: async target => {
			files.delete(target);
		},
	};
}

interface Rig {
	registry: EnvironmentRegistry;
	manager: EnvironmentLifecycleManager;
	resolver: FlauzEnvResolver;
	cli: FakeCli;
	http: StubHttp;
	secrets: StubSecrets;
	files: Map<string, string>;
}

async function bootRig(options: { httpHandler?: StubHttp extends HttpPort ? never : undefined } | Record<string, never> = {}): Promise<Rig> {
	const files = new Map<string, string>();
	const fsPort = rigFs(files);
	const clock = fixedClock();
	const cli = new FakeCli();
	const http = stubHttp(() => ({ status: 200, bodyText: '{"sandboxId":"sbx-test","status":"running"}' }));
	const secrets = stubSecrets({ 'vault:bridge-token': 'bridge-token-value', 'vault:cloud-e2b-key': 'cloud-key-value', 'env:bridge-token-env': 'env-token-value' });
	const registry = new EnvironmentRegistry({ root: ROOT, fs: fsPort, clock });
	await registry.bootstrap();
	const manager = new EnvironmentLifecycleManager({
		registry,
		root: ROOT,
		fs: fsPort,
		clock,
		executors: (['ssh-local', 'container', 'cloud-sandbox', 'workspace-remote'] as const).map(kind => new SimulatedRemoteExecutor({ kind, root: ROOT, fs: fsPort, clock })),
	});
	await manager.bootstrap();
	const resolverOptions: FlauzEnvResolverOptions = {
		registry,
		lifecycle: manager,
		cli,
		http,
		secrets,
		root: ROOT,
		fs: fsPort,
		cloudBaseUrl: 'https://cloud.example.test',
	};
	void options;
	return { registry, manager, resolver: new FlauzEnvResolver(resolverOptions), cli, http, secrets, files };
}

/** Registers + creates + starts an environment (a PIN-2 running entry, simulated executor). */
async function runningEnv(rig: Rig, registration: Record<string, unknown>): Promise<string> {
	await rig.registry.register(registration as never);
	const id = registration.id as string;
	const opts = { id, actor: 'human' as const, simulated: true };
	const created = await rig.manager.perform('create', opts);
	ok(created.ok, JSON.stringify(created.ok ? '' : created.error));
	const started = await rig.manager.perform('start', opts);
	ok(started.ok, JSON.stringify(started.ok ? '' : started.error));
	strictEqual(started.record.toState, 'running');
	return id;
}

function sshAuthority(id: string): string {
	return formatFlauzEnvAuthority('ssh-local', id);
}

/**
 * Seeds a RUNNING PIN-2 entry DIRECTLY (TEST INFRASTRUCTURE): used for the
 * states the manager's own fail-closed gate refuses to produce (an untrusted
 * or disabled environment never reaches 'running' through perform()) — the
 * drill proves the RESOLVER'S gate is independent of the manager's (even a
 * doctored running state never resolves an untrusted environment).
 */
async function seedRunningEntry(rig: Rig, id: string, executorKind = 'simulated-ssh-local'): Promise<void> {
	const ts = 1730000000000;
	const line = JSON.stringify({ schemaVersion: 0, schema: 'flauz.environments-ops/v0', ts, actor: 'human', op: 'start', environmentId: id, result: 'ok', fromState: 'starting', toState: 'running' });
	rig.files.set(`${ROOT}/.flauz/environments-ops.jsonl`, `${line}\n`);
	rig.files.set(`${ROOT}/.flauz/environments-lifecycle.json`, JSON.stringify({
		schemaVersion: 0,
		schema: 'flauz.environments-lifecycle/v0',
		updatedAt: ts,
		entries: { [id]: { state: 'running', updatedAt: ts, executorKind, lastOpRef: 1 } },
	}));
	// the manager caches its envelope at bootstrap — rebuild manager+resolver
	// over the seeded files (a FRESH boot reading the doctored state).
	const fsPort = rigFs(rig.files);
	const clock = fixedClock();
	const manager = new EnvironmentLifecycleManager({
		registry: rig.registry,
		root: ROOT,
		fs: fsPort,
		clock,
		executors: (['ssh-local', 'container', 'cloud-sandbox', 'workspace-remote'] as const).map(kind => new SimulatedRemoteExecutor({ kind, root: ROOT, fs: fsPort, clock })),
	});
	await manager.bootstrap();
	rig.manager = manager;
	rig.resolver = new FlauzEnvResolver({ registry: rig.registry, lifecycle: manager, cli: rig.cli, http: rig.http, secrets: rig.secrets, root: ROOT, fs: fsPort, cloudBaseUrl: 'https://cloud.example.test' });
}

// ---------------------------------------------------------------------------
// The trust gate — the acceptance's center of gravity, BOTH directions
// ---------------------------------------------------------------------------

test('trust gate: a trusted + running environment RESOLVES (ssh probe scripted ok)', async () => {
	const rig = await bootRig();
	const id = await runningEnv(rig, sshRegistrationInput({ id: 'env-trusted-ssh', trust: { posture: 'trusted', inheritsWorkspaceTrust: true }, connection: { host: 'host01.example.test', authMethod: 'key' } }));
	rig.cli.queueResult({ exitCode: 0 });
	const outcome = await rig.resolver.resolve(sshAuthority(id));
	ok(outcome.ok, outcome.ok ? '' : outcome.failure.message);
	strictEqual(outcome.result.environmentId, id);
	strictEqual(outcome.result.kind, 'ssh-local');
	strictEqual(outcome.result.isTrusted, true);
	strictEqual(outcome.result.transport.kind, 'endpoint');
	strictEqual(outcome.result.transport.kind === 'endpoint' ? outcome.result.transport.endpoint.host : '', 'host01.example.test');
	strictEqual(outcome.result.transport.kind === 'endpoint' ? outcome.result.transport.endpoint.port : 0, 22);
	strictEqual(outcome.result.backing.probe, 'ssh-probe');
	// the rung-1 create-probe argv (injection law: executor-constructed only)
	deepStrictEqual(rig.cli.calls[0]?.argv, ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=yes', '--', 'host01.example.test', 'true']);
});

test('trust gate: an UNTRUSTED environment NEVER resolves — even with a perfect plan, a running PIN-2 entry and a green probe script', async () => {
	const rig = await bootRig();
	const id = 'env-untrusted-ssh';
	await rig.registry.register(sshRegistrationInput({ id, trust: { posture: 'untrusted', inheritsWorkspaceTrust: false }, connection: { host: 'host01.example.test', authMethod: 'key' } }) as never);
	// the manager's own gate would refuse start for untrusted — seed the
	// running entry directly (TEST INFRASTRUCTURE) to prove the RESOLVER'S
	// gate is independent: even a doctored running state never resolves.
	await seedRunningEntry(rig, id);
	// the probe would succeed (the "perfect plan" side of the pin)
	rig.cli.queueResult({ exitCode: 0 });
	const outcome = await rig.resolver.resolve(sshAuthority(id));
	ok(!outcome.ok);
	strictEqual(outcome.failure.code, 'TRUST_REFUSED');
	ok(outcome.failure.message.includes('untrusted'));
	// fail-closed BEFORE the probe: the CLI was never invoked
	strictEqual(rig.cli.calls.length, 0);
});

test('trust gate: the DL-30 default cloud posture (untrusted) refuses the same way (running entry seeded, provider unreachable anyway)', async () => {
	const rig = await bootRig();
	const id = 'env-cloud-default';
	await rig.registry.register(cloudSandboxRegistrationInput({ id }) as never);
	await seedRunningEntry(rig, id, 'simulated-cloud-sandbox');
	const outcome = await rig.resolver.resolve(formatFlauzEnvAuthority('cloud-sandbox', id));
	ok(!outcome.ok);
	strictEqual(outcome.failure.code, 'TRUST_REFUSED');
	strictEqual(rig.http.requests.length, 0);
});

test('trust gate: unknown posture proceeds (the DL-30 ssh-local default)', async () => {
	const rig = await bootRig();
	const id = await runningEnv(rig, sshRegistrationInput({ id: 'env-unknown-ssh', trust: { posture: 'unknown', inheritsWorkspaceTrust: false } }));
	rig.cli.queueResult({ exitCode: 0 });
	const outcome = await rig.resolver.resolve(sshAuthority(id));
	ok(outcome.ok, outcome.ok ? '' : outcome.failure.message);
});

test('trust gate: absent from the PIN-2 state (registered, never created) is TRUST_REFUSED', async () => {
	const rig = await bootRig();
	await rig.registry.register(sshRegistrationInput({ id: 'env-never-created', trust: { posture: 'trusted', inheritsWorkspaceTrust: true } }) as never);
	const outcome = await rig.resolver.resolve(sshAuthority('env-never-created'));
	ok(!outcome.ok);
	strictEqual(outcome.failure.code, 'TRUST_REFUSED');
	ok(outcome.failure.message.includes('PIN-2'));
});

// ---------------------------------------------------------------------------
// The policy gate
// ---------------------------------------------------------------------------

test('policy gate: a disabled environment is POSTURE_REFUSED (even with a running PIN-2 entry seeded)', async () => {
	const rig = await bootRig();
	const id = 'env-disabled';
	await rig.registry.register(sshRegistrationInput({ id, trust: { posture: 'trusted', inheritsWorkspaceTrust: true }, enabled: false }) as never);
	await seedRunningEntry(rig, id);
	rig.cli.queueResult({ exitCode: 0 });
	const outcome = await rig.resolver.resolve(sshAuthority(id));
	ok(!outcome.ok);
	strictEqual(outcome.failure.code, 'POSTURE_REFUSED');
	ok(outcome.failure.message.includes('disabled'));
	strictEqual(rig.cli.calls.length, 0);
});

test('policy gate: created-but-not-running is POSTURE_REFUSED (resolution is connection-scoped)', async () => {
	const rig = await bootRig();
	await rig.registry.register(sshRegistrationInput({ id: 'env-created-only', trust: { posture: 'trusted', inheritsWorkspaceTrust: true } }) as never);
	const created = await rig.manager.perform('create', { id: 'env-created-only', actor: 'human', simulated: true });
	ok(created.ok);
	const outcome = await rig.resolver.resolve(sshAuthority('env-created-only'));
	ok(!outcome.ok);
	strictEqual(outcome.failure.code, 'POSTURE_REFUSED');
	ok(outcome.failure.message.includes("'created'"));
});

test('policy gate: stopped is POSTURE_REFUSED', async () => {
	const rig = await bootRig();
	const id = await runningEnv(rig, sshRegistrationInput({ id: 'env-stopped', trust: { posture: 'trusted', inheritsWorkspaceTrust: true } }));
	const stopped = await rig.manager.perform('stop', { id, actor: 'human', simulated: true });
	ok(stopped.ok);
	const outcome = await rig.resolver.resolve(sshAuthority(id));
	ok(!outcome.ok);
	strictEqual(outcome.failure.code, 'POSTURE_REFUSED');
	ok(outcome.failure.message.includes("'stopped'"));
});

// ---------------------------------------------------------------------------
// Re-resolution re-checks the CURRENT state (nothing cached)
// ---------------------------------------------------------------------------

test('re-resolution: a trust flip between resolves flips the verdict (trusted -> untrusted -> trusted)', async () => {
	const rig = await bootRig();
	const id = await runningEnv(rig, sshRegistrationInput({ id: 'env-flip', trust: { posture: 'trusted', inheritsWorkspaceTrust: true }, connection: { host: 'host01.example.test', authMethod: 'key' } }));

	rig.cli.queueResult({ exitCode: 0 });
	const first = await rig.resolver.resolve(sshAuthority(id), { resolveAttempt: 1 });
	ok(first.ok, first.ok ? '' : first.failure.message);
	strictEqual(first.ok && first.result.resolveAttempt, 1);

	// the state flip: re-register the SAME id as untrusted (the PIN-2 entry survives)
	await rig.registry.unregister(id);
	await rig.registry.register(sshRegistrationInput({ id, trust: { posture: 'untrusted', inheritsWorkspaceTrust: false }, connection: { host: 'host01.example.test', authMethod: 'key' } }) as never);
	const second = await rig.resolver.resolve(sshAuthority(id), { resolveAttempt: 2 });
	ok(!second.ok);
	strictEqual(second.failure.code, 'TRUST_REFUSED');

	// and back: the re-resolve after a disconnection re-checks the CURRENT state
	await rig.registry.unregister(id);
	await rig.registry.register(sshRegistrationInput({ id, trust: { posture: 'trusted', inheritsWorkspaceTrust: true }, connection: { host: 'host01.example.test', authMethod: 'key' } }) as never);
	rig.cli.queueResult({ exitCode: 0 });
	const third = await rig.resolver.resolve(sshAuthority(id), { resolveAttempt: 3 });
	ok(third.ok, third.ok ? '' : third.failure.message);
	strictEqual(third.ok && third.result.resolveAttempt, 3);
});

test('re-resolution: a lifecycle stop between resolves flips the verdict to POSTURE_REFUSED', async () => {
	const rig = await bootRig();
	const id = await runningEnv(rig, sshRegistrationInput({ id: 'env-stop-flip', trust: { posture: 'trusted', inheritsWorkspaceTrust: true } }));
	rig.cli.queueResult({ exitCode: 0 });
	const first = await rig.resolver.resolve(sshAuthority(id));
	ok(first.ok);
	const stopped = await rig.manager.perform('stop', { id, actor: 'human', simulated: true });
	ok(stopped.ok);
	const second = await rig.resolver.resolve(sshAuthority(id), { resolveAttempt: 2 });
	ok(!second.ok);
	strictEqual(second.failure.code, 'POSTURE_REFUSED');
});

// ---------------------------------------------------------------------------
// Lookup paths
// ---------------------------------------------------------------------------

test('lookup: a well-formed authority for an unknown environment is ENVIRONMENT_ABSENT', async () => {
	const rig = await bootRig();
	const outcome = await rig.resolver.resolve(sshAuthority('env-never-registered'));
	ok(!outcome.ok);
	strictEqual(outcome.failure.code, 'ENVIRONMENT_ABSENT');
});

test('lookup: a malformed authority is AUTHORITY_MALFORMED before any state read', async () => {
	const rig = await bootRig();
	const outcome = await rig.resolver.resolve('ssh-remote+host01');
	ok(!outcome.ok);
	strictEqual(outcome.failure.code, 'AUTHORITY_MALFORMED');
	strictEqual(rig.cli.calls.length, 0);
	strictEqual(rig.http.requests.length, 0);
});

test('lookup: PLAN_ABSENT — the defense-in-depth drill over a duck-typed registry (TEST INFRASTRUCTURE)', async () => {
	const rig = await bootRig();
	const id = await runningEnv(rig, sshRegistrationInput({ id: 'env-plan-drift', trust: { posture: 'trusted', inheritsWorkspaceTrust: true } }));
	// a registry double whose planFor drifts (shape drift the validators would
	// normally prevent — the typed branch stays fail-closed regardless)
	const descriptor = rig.registry.get(id)!;
	const duckRegistry = {
		get: (envId: string) => (envId === id ? descriptor : undefined),
		planFor: () => {
			throw new Error('flauz.connectionPlan/v0: provider drift');
		},
	} as unknown as RegistryPort;
	const resolver = new FlauzEnvResolver({
		registry: duckRegistry,
		lifecycle: rig.manager,
		cli: rig.cli,
		http: rig.http,
		secrets: rig.secrets,
		root: ROOT,
		fs: rigFs(rig.files),
		cloudBaseUrl: 'https://cloud.example.test',
	});
	const outcome = await resolver.resolve(sshAuthority(id));
	ok(!outcome.ok);
	strictEqual(outcome.failure.code, 'PLAN_ABSENT');
	ok(outcome.failure.message.includes('provider drift'));
});

// ---------------------------------------------------------------------------
// ssh-local endpoint drills (FakeCli)
// ---------------------------------------------------------------------------

test('ssh drill: the connection port rides the endpoint; the argv carries -p', async () => {
	const rig = await bootRig();
	const id = await runningEnv(rig, sshRegistrationInput({ id: 'env-ssh-port', trust: { posture: 'trusted', inheritsWorkspaceTrust: true }, connection: { host: 'host02.example.test', port: 2222, user: 'deploy', authMethod: 'agent' } }));
	rig.cli.queueResult({ exitCode: 0 });
	const outcome = await rig.resolver.resolve(sshAuthority(id));
	ok(outcome.ok, outcome.ok ? '' : outcome.failure.message);
	strictEqual(outcome.result.transport.kind, 'endpoint');
	strictEqual(outcome.result.transport.kind === 'endpoint' ? outcome.result.transport.endpoint.port : 0, 2222);
	deepStrictEqual(rig.cli.calls[0]?.argv, ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=yes', '-p', '2222', '--', 'deploy@host02.example.test', 'true']);
	// no bridge => no handshake data, no extension host env
	ok(outcome.ok && outcome.result.agentHostBridge === undefined);
	ok(outcome.ok && outcome.result.extensionHostEnv === undefined);
});

test('ssh drill: the absent binary fails closed with ENDPOINT_UNRESOLVED [CLI_NOT_AVAILABLE]', async () => {
	const rig = await bootRig();
	const id = await runningEnv(rig, sshRegistrationInput({ id: 'env-ssh-nocli', trust: { posture: 'trusted', inheritsWorkspaceTrust: true } }));
	rig.cli.queueResult({ spawnError: 'spawn ssh ENOENT' });
	const outcome = await rig.resolver.resolve(sshAuthority(id));
	ok(!outcome.ok);
	strictEqual(outcome.failure.code, 'ENDPOINT_UNRESOLVED');
	strictEqual(outcome.failure.detail, 'CLI_NOT_AVAILABLE');
});

test('ssh drill: a failed connectivity/auth probe is ENDPOINT_UNRESOLVED with the stderr excerpt', async () => {
	const rig = await bootRig();
	const id = await runningEnv(rig, sshRegistrationInput({ id: 'env-ssh-dead', trust: { posture: 'trusted', inheritsWorkspaceTrust: true }, connection: { host: 'host03.example.test', authMethod: 'key' } }));
	rig.cli.queueResult({ exitCode: 255, stderr: 'ssh: connect to host host03.example.test port 22: Connection refused' });
	const outcome = await rig.resolver.resolve(sshAuthority(id));
	ok(!outcome.ok);
	strictEqual(outcome.failure.code, 'ENDPOINT_UNRESOLVED');
	ok(outcome.failure.message.includes('Connection refused'));
	strictEqual(outcome.failure.detail, undefined);
});

// ---------------------------------------------------------------------------
// The AHP bridge handshake (the blueprint semantics)
// ---------------------------------------------------------------------------

test('bridge: the bridged handshake rides the result — port + token env, token resolved ONLY through the port', async () => {
	const rig = await bootRig();
	const id = await runningEnv(rig, sshRegistrationInput({
		id: 'env-ssh-bridged',
		trust: { posture: 'trusted', inheritsWorkspaceTrust: true },
		connection: { host: 'host04.example.test', authMethod: 'key', agentHostBridge: { bridgePort: 9301, tokenRef: 'vault:bridge-token' } },
	}));
	rig.cli.queueResult({ exitCode: 0 });
	const outcome = await rig.resolver.resolve(sshAuthority(id));
	ok(outcome.ok, outcome.ok ? '' : outcome.failure.message);
	const result = outcome.ok ? outcome.result : undefined;
	ok(result !== undefined);
	deepStrictEqual(result.agentHostBridge, { bridgePort: 9301, tokenEnvVar: AGENT_HOST_BRIDGE_TOKEN_ENV_VAR });
	deepStrictEqual(result.extensionHostEnv, { [AGENT_HOST_BRIDGE_TOKEN_ENV_VAR]: 'bridge-token-value' });
	// the port-only law: the secrets stub was consulted with EXACTLY the vault ref
	deepStrictEqual(rig.secrets.calls, ['vault:bridge-token']);
	// the endpoint is still the SSH transport endpoint
	strictEqual(result.transport.kind, 'endpoint');
	strictEqual(result.transport.kind === 'endpoint' ? result.transport.endpoint.host : '', 'host04.example.test');
});

test('bridge: an unresolvable token reference is SECRET_UNRESOLVED [VAULT_REF_UNRESOLVED] — fail-closed', async () => {
	const rig = await bootRig();
	const id = await runningEnv(rig, sshRegistrationInput({
		id: 'env-ssh-bridge-nokey',
		trust: { posture: 'trusted', inheritsWorkspaceTrust: true },
		connection: { host: 'host05.example.test', authMethod: 'key', agentHostBridge: { bridgePort: 9301, tokenRef: 'vault:missing-token' } },
	}));
	rig.cli.queueResult({ exitCode: 0 });
	const outcome = await rig.resolver.resolve(sshAuthority(id));
	ok(!outcome.ok);
	strictEqual(outcome.failure.code, 'SECRET_UNRESOLVED');
	strictEqual(outcome.failure.detail, 'VAULT_REF_UNRESOLVED');
	ok(outcome.failure.message.includes('vault:missing-token'));
});

test('bridge: a LITERAL bridge token is rejected at the registry schema level (DL-31 / SECURITY-MODEL 3.5)', async () => {
	const rig = await bootRig();
	let rejected = false;
	try {
		await rig.registry.register(sshRegistrationInput({
			id: 'env-literal-token',
			trust: { posture: 'trusted', inheritsWorkspaceTrust: true },
			connection: { host: 'host06.example.test', authMethod: 'key', agentHostBridge: { bridgePort: 9301, tokenRef: 'literal-secret-value' } },
		}) as never);
	} catch (err) {
		rejected = true;
		ok((err as Error).message.includes('vault-style reference'));
	}
	ok(rejected, 'the registry must reject literal bridge tokens');
});

test('bridge: bridged + embedded (--agent-host-port) is BRIDGE_MISCONFIGURED — the mutual-exclusion drill (TEST INFRASTRUCTURE duck plan)', async () => {
	const rig = await bootRig();
	const id = await runningEnv(rig, sshRegistrationInput({
		id: 'env-ssh-contradiction',
		trust: { posture: 'trusted', inheritsWorkspaceTrust: true },
		connection: { host: 'host07.example.test', authMethod: 'key', agentHostBridge: { bridgePort: 9301, tokenRef: 'vault:bridge-token' } },
	}));
	const descriptor = rig.registry.get(id)!;
	// a doctored plan: embedded mode while the descriptor carries a bridge
	// (the mutual exclusion the vscode-test-resolver blueprint rejects at
	// extension.ts:169-175) — the registry derives mode from the connection,
	// so the contradiction is constructed here on purpose.
	const realPlan = rig.registry.planFor(id);
	const doctoredPlan: ConnectionPlan = { ...realPlan, agentHost: { ...realPlan.agentHost, mode: 'embedded' } };
	const duckRegistry = {
		get: (envId: string) => (envId === id ? descriptor : undefined),
		planFor: () => doctoredPlan,
	} as unknown as RegistryPort;
	const resolver = new FlauzEnvResolver({
		registry: duckRegistry,
		lifecycle: rig.manager,
		cli: rig.cli,
		http: rig.http,
		secrets: rig.secrets,
		root: ROOT,
		fs: rigFs(rig.files),
		cloudBaseUrl: 'https://cloud.example.test',
	});
	rig.cli.queueResult({ exitCode: 0 });
	const outcome = await resolver.resolve(sshAuthority(id));
	ok(!outcome.ok);
	strictEqual(outcome.failure.code, 'BRIDGE_MISCONFIGURED');
	ok(outcome.failure.message.includes('mutually exclusive'));
});

test('bridge: a bridged plan without a bridge block is BRIDGE_MISCONFIGURED (incomplete handshake)', async () => {
	const rig = await bootRig();
	const id = await runningEnv(rig, sshRegistrationInput({ id: 'env-ssh-bridgeless', trust: { posture: 'trusted', inheritsWorkspaceTrust: true } }));
	const descriptor = rig.registry.get(id)!;
	const realPlan = rig.registry.planFor(id);
	const doctoredPlan: ConnectionPlan = { ...realPlan, agentHost: { ...realPlan.agentHost, mode: 'bridged' } };
	const duckRegistry = {
		get: (envId: string) => (envId === id ? descriptor : undefined),
		planFor: () => doctoredPlan,
	} as unknown as RegistryPort;
	const resolver = new FlauzEnvResolver({ registry: duckRegistry, lifecycle: rig.manager, cli: rig.cli, http: rig.http, secrets: rig.secrets, root: ROOT, fs: rigFs(rig.files), cloudBaseUrl: 'https://cloud.example.test' });
	rig.cli.queueResult({ exitCode: 0 });
	const outcome = await resolver.resolve(sshAuthority(id));
	ok(!outcome.ok);
	strictEqual(outcome.failure.code, 'BRIDGE_MISCONFIGURED');
	ok(outcome.failure.message.includes('incomplete'));
});

// ---------------------------------------------------------------------------
// container drills (FakeCli — the deterministic flauz-<envId> name)
// ---------------------------------------------------------------------------

test('container drill: a running container resolves to the VERIFIED backing with the honest pending-live-rung transport', async () => {
	const rig = await bootRig();
	const id = await runningEnv(rig, containerRegistrationInput({ id: 'env-container-live', trust: { posture: 'trusted', inheritsWorkspaceTrust: true } }));
	rig.cli.queueResult({ exitCode: 0, stdout: JSON.stringify([{ Id: 'sha256:containerid123', State: { Running: true, Status: 'running' } }]) });
	const outcome = await rig.resolver.resolve(formatFlauzEnvAuthority('container', id));
	ok(outcome.ok, outcome.ok ? '' : outcome.failure.message);
	const result = outcome.ok ? outcome.result : undefined;
	ok(result !== undefined);
	strictEqual(result.transport.kind, 'pending-live-rung');
	ok(result.transport.kind === 'pending-live-rung' && result.transport.pendingReason.includes('live server-spawn rung'));
	strictEqual(result.backing.probe, 'docker-inspect');
	ok(result.backing.identity.includes('flauz-env-container-live'));
	ok(result.backing.identity.includes('sha256:containerid123'));
	// the rung-1 deterministic container name (dockerCli containerNameOf)
	deepStrictEqual(rig.cli.calls[0]?.argv, ['docker', 'inspect', 'flauz-env-container-live']);
});

test('container drill: the absent docker binary fails closed [CLI_NOT_AVAILABLE]', async () => {
	const rig = await bootRig();
	const id = await runningEnv(rig, containerRegistrationInput({ id: 'env-container-nocli', trust: { posture: 'trusted', inheritsWorkspaceTrust: true } }));
	rig.cli.queueResult({ spawnError: 'spawn docker ENOENT' });
	const outcome = await rig.resolver.resolve(formatFlauzEnvAuthority('container', id));
	ok(!outcome.ok);
	strictEqual(outcome.failure.code, 'ENDPOINT_UNRESOLVED');
	strictEqual(outcome.failure.detail, 'CLI_NOT_AVAILABLE');
});

test('container drill: the daemon down is ENDPOINT_UNRESOLVED [DAEMON_UNREACHABLE]', async () => {
	const rig = await bootRig();
	const id = await runningEnv(rig, containerRegistrationInput({ id: 'env-container-daemon', trust: { posture: 'trusted', inheritsWorkspaceTrust: true } }));
	rig.cli.queueResult({ exitCode: 1, stderr: 'Error response from daemon: Cannot connect to the Docker daemon at unix:///var/run/docker.sock.' });
	const outcome = await rig.resolver.resolve(formatFlauzEnvAuthority('container', id));
	ok(!outcome.ok);
	strictEqual(outcome.failure.code, 'ENDPOINT_UNRESOLVED');
	strictEqual(outcome.failure.detail, 'DAEMON_UNREACHABLE');
});

test('container drill: no such object is ENDPOINT_UNRESOLVED (no fabricated backing)', async () => {
	const rig = await bootRig();
	const id = await runningEnv(rig, containerRegistrationInput({ id: 'env-container-gone', trust: { posture: 'trusted', inheritsWorkspaceTrust: true } }));
	rig.cli.queueResult({ exitCode: 1, stderr: 'Error: No such object: flauz-env-container-gone' });
	const outcome = await rig.resolver.resolve(formatFlauzEnvAuthority('container', id));
	ok(!outcome.ok);
	strictEqual(outcome.failure.code, 'ENDPOINT_UNRESOLVED');
	strictEqual(outcome.failure.detail, undefined);
	ok(outcome.failure.message.includes('flauz-env-container-gone'));
});

test('container drill: a non-running container is ENDPOINT_UNRESOLVED (connection-scoped)', async () => {
	const rig = await bootRig();
	const id = await runningEnv(rig, containerRegistrationInput({ id: 'env-container-exited', trust: { posture: 'trusted', inheritsWorkspaceTrust: true } }));
	rig.cli.queueResult({ exitCode: 0, stdout: JSON.stringify([{ Id: 'sha256:abc', State: { Running: false, Status: 'exited (0)' } }]) });
	const outcome = await rig.resolver.resolve(formatFlauzEnvAuthority('container', id));
	ok(!outcome.ok);
	strictEqual(outcome.failure.code, 'ENDPOINT_UNRESOLVED');
	ok(outcome.failure.message.includes('exited'));
});

// ---------------------------------------------------------------------------
// cloud-sandbox drills (the HttpPort stub — the wire contract v0)
// ---------------------------------------------------------------------------

function seedCloudTrack(rig: Rig, envId: string, sandboxId: string, status: string): void {
	rig.files.set(`${ROOT}/.flauz/env-cloud/${envId}.json`, JSON.stringify({
		schemaVersion: 0,
		schema: 'flauz.env-cloud/v0',
		environmentId: envId,
		sandboxId,
		status,
		startedAt: 1730000000000,
		lease: null,
		snapshots: [],
	}));
}

test('cloud drill: a running sandbox resolves to the verified backing; the bearer key came ONLY through the port', async () => {
	const rig = await bootRig();
	const id = await runningEnv(rig, cloudSandboxRegistrationInput({ id: 'env-cloud-live', trust: { posture: 'trusted', inheritsWorkspaceTrust: true } }));
	seedCloudTrack(rig, id, 'sbx-123', 'running');
	const outcome = await rig.resolver.resolve(formatFlauzEnvAuthority('cloud-sandbox', id));
	ok(outcome.ok, outcome.ok ? '' : outcome.failure.message);
	const result = outcome.ok ? outcome.result : undefined;
	ok(result !== undefined);
	strictEqual(result.transport.kind, 'pending-live-rung');
	strictEqual(result.backing.probe, 'cloud-sandbox');
	strictEqual(result.backing.identity, 'sbx-123');
	// the wire contract v0 probe: GET {base}/v0/sandboxes/{id} + the resolved bearer
	strictEqual(rig.http.requests.length, 1);
	strictEqual(rig.http.requests[0]?.method, 'GET');
	strictEqual(rig.http.requests[0]?.url, 'https://cloud.example.test/v0/sandboxes/sbx-123');
	strictEqual(rig.http.requests[0]?.headers?.Authorization, 'Bearer cloud-key-value');
	deepStrictEqual(rig.secrets.calls, ['vault:cloud-e2b-key']);
});

test('cloud drill: no configured endpoint fails closed [CLOUD_UNREACHABLE] — never a fabricated endpoint', async () => {
	const rig = await bootRig();
	const id = await runningEnv(rig, cloudSandboxRegistrationInput({ id: 'env-cloud-nourl', trust: { posture: 'trusted', inheritsWorkspaceTrust: true } }));
	const files = new Map<string, string>();
	const resolver = new FlauzEnvResolver({ registry: rig.registry, lifecycle: rig.manager, cli: rig.cli, http: rig.http, secrets: rig.secrets, root: ROOT, fs: rigFs(files), cloudBaseUrl: '' });
	const outcome = await resolver.resolve(formatFlauzEnvAuthority('cloud-sandbox', id));
	ok(!outcome.ok);
	strictEqual(outcome.failure.code, 'ENDPOINT_UNRESOLVED');
	strictEqual(outcome.failure.detail, 'CLOUD_UNREACHABLE');
	strictEqual(rig.http.requests.length, 0);
});

test('cloud drill: no rung-1 tracking record is ENDPOINT_UNRESOLVED (not provisioned)', async () => {
	const rig = await bootRig();
	const id = await runningEnv(rig, cloudSandboxRegistrationInput({ id: 'env-cloud-notrack', trust: { posture: 'trusted', inheritsWorkspaceTrust: true } }));
	const outcome = await rig.resolver.resolve(formatFlauzEnvAuthority('cloud-sandbox', id));
	ok(!outcome.ok);
	strictEqual(outcome.failure.code, 'ENDPOINT_UNRESOLVED');
	ok(outcome.failure.message.includes('env-cloud'));
	strictEqual(rig.http.requests.length, 0);
});

test('cloud drill: an unresolvable apiKeyRef is SECRET_UNRESOLVED [VAULT_REF_UNRESOLVED]', async () => {
	const rig = await bootRig();
	const id = await runningEnv(rig, cloudSandboxRegistrationInput({ id: 'env-cloud-nokey', trust: { posture: 'trusted', inheritsWorkspaceTrust: true }, connection: { provider: 'e2b', apiKeyRef: 'vault:missing-cloud-key', sandboxTemplate: 'base' } }));
	seedCloudTrack(rig, id, 'sbx-456', 'running');
	const outcome = await rig.resolver.resolve(formatFlauzEnvAuthority('cloud-sandbox', id));
	ok(!outcome.ok);
	strictEqual(outcome.failure.code, 'SECRET_UNRESOLVED');
	strictEqual(outcome.failure.detail, 'VAULT_REF_UNRESOLVED');
	strictEqual(rig.http.requests.length, 0);
});

test('cloud drill: a 401 from the provider is ENDPOINT_UNRESOLVED [CLOUD_AUTH_FAILED]', async () => {
	const rig = await bootRig();
	const id = await runningEnv(rig, cloudSandboxRegistrationInput({ id: 'env-cloud-auth', trust: { posture: 'trusted', inheritsWorkspaceTrust: true } }));
	seedCloudTrack(rig, id, 'sbx-789', 'running');
	const http = stubHttp(() => ({ status: 401, bodyText: '{"error":"invalid key"}' }));
	const resolver = new FlauzEnvResolver({ registry: rig.registry, lifecycle: rig.manager, cli: rig.cli, http, secrets: rig.secrets, root: ROOT, fs: rigFs(rig.files), cloudBaseUrl: 'https://cloud.example.test' });
	const outcome = await resolver.resolve(formatFlauzEnvAuthority('cloud-sandbox', id));
	ok(!outcome.ok);
	strictEqual(outcome.failure.code, 'ENDPOINT_UNRESOLVED');
	strictEqual(outcome.failure.detail, 'CLOUD_AUTH_FAILED');
});

test('cloud drill: a provider-reported non-running sandbox is ENDPOINT_UNRESOLVED (connection-scoped; provider-authoritative)', async () => {
	const rig = await bootRig();
	const id = await runningEnv(rig, cloudSandboxRegistrationInput({ id: 'env-cloud-stopped', trust: { posture: 'trusted', inheritsWorkspaceTrust: true } }));
	seedCloudTrack(rig, id, 'sbx-stopped', 'running');
	// the provider (not the local track cache) is authoritative: it reports stopped
	const http = stubHttp(() => ({ status: 200, bodyText: '{"sandboxId":"sbx-stopped","status":"stopped"}' }));
	const resolver = new FlauzEnvResolver({ registry: rig.registry, lifecycle: rig.manager, cli: rig.cli, http, secrets: rig.secrets, root: ROOT, fs: rigFs(rig.files), cloudBaseUrl: 'https://cloud.example.test' });
	const outcome = await resolver.resolve(formatFlauzEnvAuthority('cloud-sandbox', id));
	ok(!outcome.ok);
	strictEqual(outcome.failure.code, 'ENDPOINT_UNRESOLVED');
	ok(outcome.failure.message.includes('stopped'));
});

test('cloud drill: a LITERAL API key is rejected at the registry schema level (DL-31)', async () => {
	const rig = await bootRig();
	let rejected = false;
	try {
		await rig.registry.register(cloudSandboxRegistrationInput({ id: 'env-literal-key', trust: { posture: 'trusted', inheritsWorkspaceTrust: true }, connection: { provider: 'e2b', apiKeyRef: 'e2b-literal-key-value', sandboxTemplate: 'base' } }) as never);
	} catch (err) {
		rejected = true;
		ok((err as Error).message.includes('vault-style reference'));
	}
	ok(rejected, 'the registry must reject literal cloud API keys');
});

// ---------------------------------------------------------------------------
// workspace-remote (the local loopback posture)
// ---------------------------------------------------------------------------

test('workspace-remote drill: the running local-loopback environment resolves with the lifecycle-state backing + the honest pending transport', async () => {
	const rig = await bootRig();
	const id = await runningEnv(rig, workspaceRemoteRegistrationInput({ id: 'env-local-loopback', trust: { posture: 'trusted', inheritsWorkspaceTrust: true } }));
	const outcome = await rig.resolver.resolve(formatFlauzEnvAuthority('workspace-remote', id));
	ok(outcome.ok, outcome.ok ? '' : outcome.failure.message);
	const result = outcome.ok ? outcome.result : undefined;
	ok(result !== undefined);
	strictEqual(result.transport.kind, 'pending-live-rung');
	strictEqual(result.backing.probe, 'lifecycle-state');
	ok(result.backing.identity.includes('running'));
	strictEqual(rig.cli.calls.length, 0, 'the loopback posture probes no binary — the PIN-2 state is the backing truth');
});

// ---------------------------------------------------------------------------
// The taxonomy + the outcome shape
// ---------------------------------------------------------------------------

test('taxonomy: the resolver failure codes are the pinned eight (mirroring the rung-1 executor taxonomy)', () => {
	deepStrictEqual(RESOLVER_ERROR_CODES, ['AUTHORITY_MALFORMED', 'ENVIRONMENT_ABSENT', 'PLAN_ABSENT', 'TRUST_REFUSED', 'POSTURE_REFUSED', 'ENDPOINT_UNRESOLVED', 'SECRET_UNRESOLVED', 'BRIDGE_MISCONFIGURED']);
});

test('outcome: the success envelope carries the authority + kind + resolveAttempt echo (the re-resolution context)', async () => {
	const rig = await bootRig();
	const id = await runningEnv(rig, sshRegistrationInput({ id: 'env-echo', trust: { posture: 'trusted', inheritsWorkspaceTrust: true }, connection: { host: 'echo.example.test', authMethod: 'key' } }));
	rig.cli.queueResult({ exitCode: 0 });
	const authority = `${FLAUZ_ENV_AUTHORITY_PREFIX}+ssh-local+${id}`;
	const outcome: ResolverOutcome = await rig.resolver.resolve(authority, { resolveAttempt: 4 });
	ok(outcome.ok);
	strictEqual(outcome.result.authority, authority);
	strictEqual(outcome.result.resolveAttempt, 4);
	strictEqual(outcome.result.kind, 'ssh-local' as EnvironmentKind);
});
