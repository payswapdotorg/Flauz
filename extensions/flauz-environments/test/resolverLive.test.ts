/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL3-H1 rung 2 — LIVE resolver drills (REAL binaries, REAL effects), each
 * SKIP-GATED on a documented env opt-in PLUS the binary/daemon presence:
 *
 *   - FLAUZ_RESOLVER_LIVE_SSH=1    the ssh resolution drill (needs the ssh
 *                                   binary AND a reachable sshd on localhost
 *                                   with working non-interactive auth — the
 *                                   liveRemote.test.ts gates)
 *   - FLAUZ_RESOLVER_LIVE_DOCKER=1 the docker resolution drill (needs the
 *                                   docker binary AND a running daemon)
 *
 * Neither drill ever fabricates a pass: without the opt-in (or without the
 * binary/daemon) the test prints an explicit SKIP line and skips — the unit
 * suites (resolver.test.ts) carry the scripted coverage; these drills are
 * the LIVE evidence that the rung-2 resolution path works over real
 * binaries. The ssh drill resolves a REAL transport endpoint; the docker
 * drill verifies a REAL running container backing (the container transport
 * itself is the live server-spawn rung — the honest v0 scope).
 */
import { test, type TestContext } from 'node:test';
import { ok, strictEqual } from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { EnvironmentRegistry } from '../src/registry.ts';
import { DockerCliExecutor, EnvironmentLifecycleManager, NodeCliPort, SshCliExecutor, nodeHttpPort, type LocalEnvFsPort } from '../src/lifecycle/index.ts';
import { FlauzEnvResolver, formatFlauzEnvAuthority } from '../src/resolver/index.ts';
import { containerRegistrationInput, sshRegistrationInput } from './helpers.ts';

const HARNESS_PATH = path.resolve(import.meta.dirname, '..', 'fixtures', 'env-agent.ts');
const cli = new NodeCliPort();

function skip(t: { skip(message?: string): void }, reason: string): void {
	console.log(`SKIP: ${reason}`);
	t.skip(reason);
}

/** The env-based secret port (the production env:<NAME> path). */
const envSecrets = {
	resolve: async (ref: string): Promise<string | undefined> => {
		if (!ref.startsWith('env:')) {
			return undefined;
		}
		const value = process.env[ref.slice('env:'.length)];
		return value !== undefined && value.length > 0 ? value : undefined;
	},
};

function realLocalFs(): LocalEnvFsPort {
	return {
		readFileUtf8: async target => {
			try {
				return await fs.readFile(target, { encoding: 'utf-8' });
			} catch (err) {
				if ((err as { code?: string }).code === 'ENOENT') {
					return undefined;
				}
				throw err;
			}
		},
		writeFile: (target, contents) => fs.writeFile(target, contents, { encoding: 'utf-8' }),
		rename: (from, to) => fs.rename(from, to),
		mkdir: target => fs.mkdir(target, { recursive: true }),
		readdir: async target => (await fs.readdir(target)).sort(),
		rm: target => fs.rm(target, { recursive: true, force: true }),
	};
}

const hashPort = { sha256Hex: (contents: string): string => createHash('sha256').update(contents, 'utf-8').digest('hex') };

async function tempRoot(): Promise<{ root: string; cleanup(): Promise<void> }> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flauz-resolver-live-'));
	return { root, cleanup: async () => fs.rm(root, { recursive: true, force: true }) };
}

async function sshBinaryPresent(): Promise<boolean> {
	const probe = await cli.spawnCli(['ssh', '-V'], { timeoutMs: 5_000 });
	return probe.spawnError === undefined;
}

async function sshdReachable(): Promise<boolean> {
	const probe = await cli.spawnCli(
		['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=2', '-o', 'StrictHostKeyChecking=yes', '--', 'localhost', 'true'],
		{ timeoutMs: 10_000 },
	);
	return probe.exitCode === 0;
}

async function dockerUsable(): Promise<boolean> {
	const probe = await cli.spawnCli(['docker', 'info'], { timeoutMs: 15_000 });
	return probe.spawnError === undefined && probe.exitCode === 0;
}

test('live ssh: the resolver resolves a REAL transport endpoint for a running trusted environment (skips without FLAUZ_RESOLVER_LIVE_SSH + sshd)', async (t: TestContext) => {
	if (process.env.FLAUZ_RESOLVER_LIVE_SSH !== '1') {
		return skip(t, 'FLAUZ_RESOLVER_LIVE_SSH != 1 — live ssh resolution drill not opted in');
	}
	if (!(await sshBinaryPresent())) {
		return skip(t, 'ssh binary absent — live ssh resolution drill not run');
	}
	if (!(await sshdReachable())) {
		return skip(t, 'no reachable sshd on localhost (or non-interactive auth unavailable) — live ssh resolution drill not run');
	}
	const { root, cleanup } = await tempRoot();
	const localFs = realLocalFs();
	const clock = () => Date.now();
	const registry = new EnvironmentRegistry({ root, fs: localFs, clock });
	await registry.bootstrap();
	const id = 'env-resolver-live-ssh';
	await registry.register(sshRegistrationInput({ id, trust: { posture: 'trusted', inheritsWorkspaceTrust: true }, connection: { host: 'localhost', authMethod: 'agent' } }) as never);
	const executor = new SshCliExecutor({
		root, cli, fs: localFs, hash: hashPort, clock, harnessPath: HARNESS_PATH,
		commandTimeoutMs: 60_000, startTimeoutMs: 20_000, stopTimeoutMs: 5_000,
	});
	const manager = new EnvironmentLifecycleManager({ registry, root, fs: localFs, clock, executors: [executor] });
	await manager.bootstrap();
	const resolver = new FlauzEnvResolver({ registry, lifecycle: manager, cli, http: nodeHttpPort, secrets: envSecrets, root, fs: localFs, cloudBaseUrl: '' });
	try {
		for (const op of ['create', 'start'] as const) {
			const outcome = await manager.perform(op, { id, actor: 'human' });
			ok(outcome.ok, JSON.stringify(outcome.ok ? '' : outcome.error));
		}
		const resolution = await resolver.resolve(formatFlauzEnvAuthority('ssh-local', id));
		ok(resolution.ok, resolution.ok ? '' : resolution.failure.message);
		strictEqual(resolution.result.transport.kind, 'endpoint');
		strictEqual(resolution.result.transport.kind === 'endpoint' ? resolution.result.transport.endpoint.host : '', 'localhost');
		ok(resolution.result.transport.kind === 'endpoint' && resolution.result.transport.endpoint.port > 0);
		strictEqual(resolution.result.backing.probe, 'ssh-probe');
		const stopped = await manager.perform('stop', { id, actor: 'human' });
		ok(stopped.ok, JSON.stringify(stopped.ok ? '' : stopped.error));
		const destroyed = await manager.perform('destroy', { id, actor: 'human' });
		ok(destroyed.ok, JSON.stringify(destroyed.ok ? '' : destroyed.error));
	} finally {
		await cleanup();
	}
});

test('live docker: the resolver verifies a REAL running container backing (skips without FLAUZ_RESOLVER_LIVE_DOCKER + the daemon)', async (t: TestContext) => {
	if (process.env.FLAUZ_RESOLVER_LIVE_DOCKER !== '1') {
		return skip(t, 'FLAUZ_RESOLVER_LIVE_DOCKER != 1 — live docker resolution drill not opted in');
	}
	if (!(await dockerUsable())) {
		return skip(t, 'docker binary absent or daemon down — live docker resolution drill not run');
	}
	const { root, cleanup } = await tempRoot();
	const localFs = realLocalFs();
	const clock = () => Date.now();
	const registry = new EnvironmentRegistry({ root, fs: localFs, clock });
	await registry.bootstrap();
	const id = 'env-resolver-live-docker';
	await registry.register(containerRegistrationInput({ id, trust: { posture: 'trusted', inheritsWorkspaceTrust: true } }) as never);
	const executor = new DockerCliExecutor({
		root, cli, fs: localFs, hash: hashPort, clock, harnessPath: HARNESS_PATH,
		commandTimeoutMs: 180_000, startTimeoutMs: 30_000, stopTimeoutMs: 5_000,
	});
	const manager = new EnvironmentLifecycleManager({ registry, root, fs: localFs, clock, executors: [executor] });
	await manager.bootstrap();
	const resolver = new FlauzEnvResolver({ registry, lifecycle: manager, cli, http: nodeHttpPort, secrets: envSecrets, root, fs: localFs, cloudBaseUrl: '' });
	try {
		for (const op of ['create', 'start'] as const) {
			const outcome = await manager.perform(op, { id, actor: 'human' });
			ok(outcome.ok, JSON.stringify(outcome.ok ? '' : outcome.error));
		}
		const resolution = await resolver.resolve(formatFlauzEnvAuthority('container', id));
		ok(resolution.ok, resolution.ok ? '' : resolution.failure.message);
		strictEqual(resolution.result.transport.kind, 'pending-live-rung');
		strictEqual(resolution.result.backing.probe, 'docker-inspect');
		ok(resolution.result.backing.identity.includes('flauz-env-resolver-live-docker'), resolution.result.backing.identity);
		const stopped = await manager.perform('stop', { id, actor: 'human' });
		ok(stopped.ok, JSON.stringify(stopped.ok ? '' : stopped.error));
		const destroyed = await manager.perform('destroy', { id, actor: 'human' });
		ok(destroyed.ok, JSON.stringify(destroyed.ok ? '' : destroyed.error));
	} finally {
		// defensive reaping even on assertion failure
		await cli.spawnCli(['docker', 'rm', '-f', 'flauz-env-resolver-live-docker'], { timeoutMs: 30_000 }).catch(() => undefined);
		await cleanup();
	}
});
