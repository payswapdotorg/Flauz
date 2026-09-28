/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL3-004 rung 1 — LIVE remote drills (REAL binaries, REAL effects), each
 * SKIP-GATED with an explicit SKIP line: the ssh drill needs the ssh binary
 * AND a reachable sshd (localhost) with working non-interactive auth; the
 * docker drill needs the docker binary AND a running daemon (GitHub CI
 * ubuntu runners have docker — the drill exercises there; dev boxes without
 * a daemon skip cleanly). Neither test ever fabricates a pass.
 */
import { test, type TestContext } from 'node:test';
import { ok, strictEqual } from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { EnvironmentRegistry } from '../src/registry.ts';
import { DockerCliExecutor, NodeCliPort, SshCliExecutor, type LocalEnvFsPort } from '../src/lifecycle/index.ts';
import { containerRegistrationInput, sshRegistrationInput } from './helpers.ts';

const HARNESS_PATH = path.resolve(import.meta.dirname, '..', 'fixtures', 'env-agent.ts');
const cli = new NodeCliPort();

/** Real fs ports (mirrors the extension.ts wiring; vscode-free). */
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
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flauz-env-live-'));
	return { root, cleanup: async () => fs.rm(root, { recursive: true, force: true }) };
}

function skip(t: { skip(message?: string): void }, reason: string): void {
	console.log(`SKIP: ${reason}`);
	t.skip(reason);
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

test('live ssh: the REAL full lifecycle over the system ssh binary (skips without a reachable sshd)', async (t: TestContext) => {
	if (!(await sshBinaryPresent())) {
		return skip(t, 'ssh binary absent — live ssh drill not run');
	}
	if (!(await sshdReachable())) {
		return skip(t, 'no reachable sshd on localhost (or non-interactive auth unavailable) — live ssh drill not run');
	}
	const { root, cleanup } = await tempRoot();
	const localFs = realLocalFs();
	const clock = () => Date.now();
	const registry = new EnvironmentRegistry({ root, fs: localFs, clock });
	await registry.bootstrap();
	await registry.register(sshRegistrationInput({ id: 'env-live-ssh', connection: { host: 'localhost', authMethod: 'agent' } }) as never);
	const executor = new SshCliExecutor({
		root, cli, fs: localFs, hash: hashPort, clock, harnessPath: HARNESS_PATH,
		commandTimeoutMs: 60_000, startTimeoutMs: 20_000, stopTimeoutMs: 5_000,
	});
	const { EnvironmentLifecycleManager } = await import('../src/lifecycle/index.ts');
	const manager = new EnvironmentLifecycleManager({ registry, root, fs: localFs, clock, executors: [executor] });
	await manager.bootstrap();
	try {
		const id = 'env-live-ssh';
		const created = await manager.perform('create', { id, actor: 'human' });
		ok(created.ok, JSON.stringify(created.ok ? '' : created.error));
		const started = await manager.perform('start', { id, actor: 'human' });
		ok(started.ok, JSON.stringify(started.ok ? '' : started.error));
		const pid = started.detail?.type === 'start' ? started.detail.pid : 0;
		ok(pid > 0, `a real remote pid was reported (${pid})`);
		const report = await manager.describe({ id });
		strictEqual(report.verdict.health, 'healthy');
		strictEqual(report.verdict.pid, pid);
		const snapshotted = await manager.perform('snapshot', { id, actor: 'human' });
		ok(snapshotted.ok, JSON.stringify(snapshotted.ok ? '' : snapshotted.error));
		const detail = snapshotted.detail?.type === 'snapshot' ? snapshotted.detail : undefined;
		ok(detail !== undefined);
		const manifest = JSON.parse(await fs.readFile(detail.manifestPath, { encoding: 'utf-8' })) as { schema: string; files: Array<{ sha256: string }> };
		strictEqual(manifest.schema, 'flauz.env-snapshot-manifest/v0');
		const stopped = await manager.perform('stop', { id, actor: 'human' });
		ok(stopped.ok, JSON.stringify(stopped.ok ? '' : stopped.error));
		const destroyed = await manager.perform('destroy', { id, actor: 'human' });
		ok(destroyed.ok, JSON.stringify(destroyed.ok ? '' : destroyed.error));
	} finally {
		await cleanup();
	}
});

test('live docker: the REAL full lifecycle over the system docker daemon (skips without docker)', async (t: TestContext) => {
	if (!(await dockerUsable())) {
		return skip(t, 'docker binary absent or daemon down — live docker drill not run');
	}
	const { root, cleanup } = await tempRoot();
	const localFs = realLocalFs();
	const clock = () => Date.now();
	const registry = new EnvironmentRegistry({ root, fs: localFs, clock });
	await registry.bootstrap();
	await registry.register(containerRegistrationInput({ id: 'env-live-container' }) as never);
	const executor = new DockerCliExecutor({
		root, cli, fs: localFs, hash: hashPort, clock, harnessPath: HARNESS_PATH,
		commandTimeoutMs: 180_000, startTimeoutMs: 30_000, stopTimeoutMs: 5_000,
	});
	const { EnvironmentLifecycleManager } = await import('../src/lifecycle/index.ts');
	const manager = new EnvironmentLifecycleManager({ registry, root, fs: localFs, clock, executors: [executor] });
	await manager.bootstrap();
	const id = 'env-live-container';
	try {
		const created = await manager.perform('create', { id, actor: 'human' });
		ok(created.ok, JSON.stringify(created.ok ? '' : created.error));
		const started = await manager.perform('start', { id, actor: 'human' });
		ok(started.ok, JSON.stringify(started.ok ? '' : started.error));
		const pid = started.detail?.type === 'start' ? started.detail.pid : 0;
		ok(pid > 0, `a real in-container harness pid was reported (${pid})`);
		const report = await manager.describe({ id });
		strictEqual(report.verdict.health, 'healthy');
		strictEqual(report.verdict.pid, pid);
		const snapshotted = await manager.perform('snapshot', { id, actor: 'human' });
		ok(snapshotted.ok, JSON.stringify(snapshotted.ok ? '' : snapshotted.error));
		const detail = snapshotted.detail?.type === 'snapshot' ? snapshotted.detail : undefined;
		ok(detail !== undefined);
		const manifest = JSON.parse(await fs.readFile(detail.manifestPath, { encoding: 'utf-8' })) as { schema: string; files: Array<{ sha256: string }> };
		strictEqual(manifest.schema, 'flauz.env-snapshot-manifest/v0');
		const stopped = await manager.perform('stop', { id, actor: 'human' });
		ok(stopped.ok, JSON.stringify(stopped.ok ? '' : stopped.error));
		const destroyed = await manager.perform('destroy', { id, actor: 'human' });
		ok(destroyed.ok, JSON.stringify(destroyed.ok ? '' : destroyed.error));
	} finally {
		// defensive reaping even on assertion failure
		await cli.spawnCli(['docker', 'rm', '-f', 'flauz-env-live-container'], { timeoutMs: 30_000 }).catch(() => undefined);
		await cleanup();
	}
});
