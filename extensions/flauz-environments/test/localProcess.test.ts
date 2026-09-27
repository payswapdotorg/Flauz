/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL3-003 local-real executor tests: REAL child processes (the fixed
 * fixtures/env-agent.ts harness spawned under this node), REAL fs snapshots,
 * REAL terminate/reap choreography — including the SIGKILL escalation, crash
 * reconciliation (stale) and orphan detection (alive but not ours).
 */
import { test } from 'node:test';
import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EnvironmentRegistry } from '../src/registry.ts';
import { EnvironmentLifecycleManager, LocalProcessExecutor } from '../src/lifecycle/index.ts';
import type { ChildHandle, HashPort, LocalEnvFsPort, ProcessPort } from '../src/lifecycle/index.ts';
import type { EnvironmentDescriptor } from '../src/api.ts';
import { fixedClock, workspaceRemoteRegistrationInput } from './helpers.ts';

const HARNESS_PATH = path.resolve(import.meta.dirname, '..', 'fixtures', 'env-agent.ts');

/** The REAL node-backed ports (mirrors extension.ts wiring; vscode-free). */
function realPorts() {
	const localFs: LocalEnvFsPort = {
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
	const processPort: ProcessPort = {
		launchNodeProcess: (scriptPath, args, options) => {
			const env: Record<string, string | undefined> = { ...process.env, ...(options?.env ?? {}) };
			if (process.versions.electron !== undefined) {
				env.ELECTRON_RUN_AS_NODE = '1';
			}
			return spawn(process.execPath, [scriptPath, ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] }) as ChildHandle;
		},
		isPidAlive: pid => {
			try {
				process.kill(pid, 0);
				return true;
			} catch {
				return false;
			}
		},
	};
	const hash: HashPort = {
		sha256Hex: contents => createHash('sha256').update(contents, 'utf-8').digest('hex'),
	};
	return { localFs, processPort, hash };
}

function isPidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function tempRoot(): Promise<{ root: string; cleanup(): Promise<void> }> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flauz-env-life-'));
	return {
		root,
		cleanup: async () => {
			await fs.rm(root, { recursive: true, force: true });
		},
	};
}

interface Rig {
	root: string;
	executor: LocalProcessExecutor;
	manager: EnvironmentLifecycleManager;
	descriptor: EnvironmentDescriptor;
	cleanup(): Promise<void>;
}

async function bootRig(options: { ignoreTermination?: boolean; stopTimeoutMs?: number } = {}): Promise<Rig> {
	const { root, cleanup } = await tempRoot();
	const ports = realPorts();
	const clock = fixedClock();
	const registry = new EnvironmentRegistry({ root, fs: ports.localFs, clock });
	await registry.bootstrap();
	await registry.register(workspaceRemoteRegistrationInput() as never);
	const descriptor = registry.get('env-test-remote')!;
	const executor = new LocalProcessExecutor({
		root,
		fs: ports.localFs,
		process: ports.processPort,
		hash: ports.hash,
		clock,
		harnessPath: HARNESS_PATH,
		heartbeatMs: 100,
		...(options.ignoreTermination !== undefined ? { ignoreTermination: options.ignoreTermination } : {}),
		...(options.stopTimeoutMs !== undefined ? { stopTimeoutMs: options.stopTimeoutMs } : {}),
	});
	const manager = new EnvironmentLifecycleManager({ registry, root, fs: ports.localFs, clock, executors: [executor] });
	await manager.bootstrap();
	return { root, executor, manager, descriptor, cleanup };
}

function stateDirOf(root: string, id: string): string {
	return path.join(root, '.flauz', 'env-state', id);
}

async function readStateJson(root: string, id: string): Promise<Record<string, unknown>> {
	return JSON.parse(await fs.readFile(path.join(stateDirOf(root, id), 'state.json'), { encoding: 'utf-8' })) as Record<string, unknown>;
}

test('local-real: the full happy path with a REAL harness process (create/start/attach/snapshot/detach/stop/destroy)', async () => {
	const rig = await bootRig();
	try {
		const id = 'env-test-remote';
		// create: the per-env state dir lands
		const created = await rig.manager.perform('create', { id, actor: 'human' });
		ok(created.ok);
		strictEqual(created.detail?.type, 'create');
		ok(created.detail?.type === 'create' && created.detail.stateDir.endsWith(path.join('.flauz', 'env-state', id)));
		await fs.access(stateDirOf(rig.root, id));

		// start: a REAL child runs, writes state.json, reports ready over stdio
		const started = await rig.manager.perform('start', { id, actor: 'agent' });
		ok(started.ok, JSON.stringify(started.ok ? '' : started.error));
		strictEqual(started.detail?.type, 'start');
		const pid = started.detail?.type === 'start' ? started.detail.pid : -1;
		ok(pid > 0, `a real pid was returned (${pid})`);
		ok(isPidAlive(pid), 'the harness process is alive');
		const state = await readStateJson(rig.root, id);
		strictEqual(state.schema, 'flauz.env-state/v0');
		strictEqual(state.environmentId, id);
		strictEqual(state.pid, pid);
		strictEqual(state.status, 'running');
		strictEqual(rig.manager.stateOf(id), 'running');

		// describe: healthy, with the real pid
		const report = await rig.manager.describe({ id });
		strictEqual(report.verdict.health, 'healthy');
		strictEqual(report.verdict.pid, pid);

		// attach: a logical lease with provenance (no process effect)
		const attached = await rig.manager.perform('attach', { id, actor: 'agent' });
		ok(attached.ok);
		strictEqual(attached.detail?.type, 'attach');
		strictEqual(rig.manager.stateOf(id), 'running/attached');
		const afterAttach = await rig.manager.describe({ id });
		ok(afterAttach.verdict.lease !== undefined);
		ok(afterAttach.verdict.health === 'healthy');

		// snapshot: a REAL fs copy + sha256 manifest
		const snapshotted = await rig.manager.perform('snapshot', { id, actor: 'tool' });
		ok(snapshotted.ok, JSON.stringify(snapshotted.ok ? '' : snapshotted.error));
		strictEqual(snapshotted.detail?.type, 'snapshot');
		const detail = snapshotted.detail?.type === 'snapshot' ? snapshotted.detail : undefined;
		ok(detail !== undefined);
		strictEqual(detail.fileCount, 1);
		const manifestPath = detail.manifestPath;
		const manifest = JSON.parse(await fs.readFile(manifestPath, { encoding: 'utf-8' })) as {
			schema: string; environmentId: string; createdAt: number;
			files: Array<{ bytes: number; path: string; sha256: string }>;
		};
		strictEqual(manifest.schema, 'flauz.env-snapshot-manifest/v0');
		strictEqual(manifest.environmentId, id);
		strictEqual(manifest.files.length, 1);
		strictEqual(manifest.files[0]!.path, 'state.json');
		// the sha256 pins the copied bytes
		const copied = await fs.readFile(path.join(detail.snapshotDir, 'state.json'), { encoding: 'utf-8' });
		strictEqual(manifest.files[0]!.sha256, createHash('sha256').update(copied, 'utf-8').digest('hex'));
		strictEqual(manifest.files[0]!.bytes, copied.length);
		// the snapshot dir is epoch-named under .flauz/env-snapshots/<id>/
		ok(detail.snapshotDir.includes(path.join('.flauz', 'env-snapshots', id)));

		// detach
		const detached = await rig.manager.perform('detach', { id, actor: 'agent' });
		ok(detached.ok);
		strictEqual(rig.manager.stateOf(id), 'running');
		strictEqual((await rig.manager.describe({ id })).verdict.lease, undefined);

		// stop: graceful SIGTERM, process reaped, harness records the clean shutdown
		const stopped = await rig.manager.perform('stop', { id, actor: 'human' });
		ok(stopped.ok);
		strictEqual(stopped.detail?.type, 'stop');
		const stopDetail = stopped.detail?.type === 'stop' ? stopped.detail : undefined;
		strictEqual(stopDetail?.forcedSignal, 'SIGTERM');
		strictEqual(stopDetail?.pid, pid);
		ok(!isPidAlive(pid), 'the harness process was reaped');
		strictEqual(rig.manager.stateOf(id), 'stopped');
		const finalState = await readStateJson(rig.root, id);
		strictEqual(finalState.status, 'stopped');
		ok(finalState.stoppedAt !== undefined);
		// describe after a clean stop: not-running, NOT stale
		const stoppedReport = await rig.manager.describe({ id });
		strictEqual(stoppedReport.verdict.health, 'not-running');

		// destroy: terminal, state dir removed
		const destroyed = await rig.manager.perform('destroy', { id, actor: 'human' });
		ok(destroyed.ok);
		strictEqual(rig.manager.stateOf(id), 'destroyed');
		await fs.access(stateDirOf(rig.root, id)).then(() => { throw new Error('state dir must be gone'); }, () => undefined);
		const destroyedReport = await rig.manager.describe({ id });
		strictEqual(destroyedReport.verdict.health, 'destroyed');

		// the ledger recorded every op with provenance
		strictEqual(rig.manager.ops().length, 7);
		deepStrictEqual(rig.manager.ops().map(record => record.op), ['create', 'start', 'attach', 'snapshot', 'detach', 'stop', 'destroy']);
		deepStrictEqual(rig.manager.ops().map(record => record.actor), ['human', 'agent', 'agent', 'tool', 'agent', 'human', 'human']);
	} finally {
		await rig.cleanup();
	}
});

test('local-real: crash reconciliation — a SIGKILLed harness surfaces stale, never healthy', async () => {
	const rig = await bootRig();
	try {
		const id = 'env-test-remote';
		await rig.manager.perform('create', { id, actor: 'human' });
		const started = await rig.manager.perform('start', { id, actor: 'human' });
		ok(started.ok);
		const pid = started.detail?.type === 'start' ? started.detail.pid : -1;
		// the process dies behind the manager's back (hard crash)
		process.kill(pid, 'SIGKILL');
		await new Promise(resolve => setTimeout(resolve, 200));
		ok(!isPidAlive(pid));
		const report = await rig.manager.describe({ id });
		strictEqual(report.state, 'running');           // persisted state
		strictEqual(report.verdict.health, 'stale');    // surfaced truth
		ok(report.verdict.message.includes('crash reconciliation'));
		// recovery is explicit: stop records the reconciliation (pid already dead)
		const stopped = await rig.manager.perform('stop', { id, actor: 'human' });
		ok(stopped.ok);
		strictEqual(rig.manager.stateOf(id), 'stopped');
	} finally {
		await rig.cleanup();
	}
});

test('local-real: orphan detection on restart — an alive pid we did not spawn is an orphan and is never signalled', async () => {
	const rig = await bootRig();
	try {
		const id = 'env-test-remote';
		await rig.manager.perform('create', { id, actor: 'human' });
		const started = await rig.manager.perform('start', { id, actor: 'human' });
		ok(started.ok);
		const pid = started.detail?.type === 'start' ? started.detail.pid : -1;
		ok(pid > 0);
		ok(isPidAlive(pid));

		// HOST RESTART: a fresh registry + executor + manager over the same
		// root — the old harness is still alive but nobody spawned it here.
		const ports = realPorts();
		const clock = fixedClock();
		const registry2 = new EnvironmentRegistry({ root: rig.root, fs: ports.localFs, clock });
		await registry2.bootstrap();
		const executor2 = new LocalProcessExecutor({
			root: rig.root,
			fs: ports.localFs,
			process: ports.processPort,
			hash: ports.hash,
			clock,
			harnessPath: HARNESS_PATH,
			heartbeatMs: 100,
		});
		const manager2 = new EnvironmentLifecycleManager({ registry: registry2, root: rig.root, fs: ports.localFs, clock, executors: [executor2] });
		await manager2.bootstrap();

		// describe surfaces the typed orphan verdict (never healthy)
		const report = await manager2.describe({ id });
		strictEqual(report.state, 'running');
		strictEqual(report.verdict.health, 'orphan');
		strictEqual(report.verdict.pid, pid);
		ok(report.verdict.message.includes('not spawned by this executor'));

		// stop REFUSES to signal a process we do not own (fail-closed)
		const stop = await manager2.perform('stop', { id, actor: 'human' });
		ok(!stop.ok);
		strictEqual(stop.error.code, 'PROCESS_NOT_OWNED');
		ok(isPidAlive(pid), 'the unowned process was left alone');

		// manual resolution (the human kills the stray), then destroy works
		process.kill(pid, 'SIGKILL');
		await new Promise(resolve => setTimeout(resolve, 150));
		ok(!isPidAlive(pid));
		const destroy = await manager2.perform('destroy', { id, actor: 'human' });
		ok(destroy.ok, JSON.stringify(destroy.ok ? '' : destroy.error));
		strictEqual(manager2.stateOf(id), 'destroyed');
	} finally {
		await rig.cleanup();
	}
});

test('local-real: a harness that refuses graceful termination is SIGKILL-escalated and reaped', async () => {
	const rig = await bootRig({ ignoreTermination: true, stopTimeoutMs: 250 });
	try {
		const id = 'env-test-remote';
		await rig.manager.perform('create', { id, actor: 'human' });
		const started = await rig.manager.perform('start', { id, actor: 'human' });
		ok(started.ok);
		const pid = started.detail?.type === 'start' ? started.detail.pid : -1;
		ok(isPidAlive(pid));
		const stopped = await rig.manager.perform('stop', { id, actor: 'human' });
		ok(stopped.ok);
		const stopDetail = stopped.detail?.type === 'stop' ? stopped.detail : undefined;
		strictEqual(stopDetail?.forcedSignal, 'SIGKILL');
		ok(!isPidAlive(pid), 'the refusing harness was killed and reaped');
		strictEqual(rig.manager.stateOf(id), 'stopped');
	} finally {
		await rig.cleanup();
	}
});

test('local-real: double start at the executor level is a typed ALREADY_RUNNING error (the manager-level guard is the state machine)', async () => {
	const rig = await bootRig();
	try {
		const ctx = { actor: 'human' as const, now: Date.now() };
		await rig.executor.create(rig.descriptor, ctx);
		const first = await rig.executor.start(rig.descriptor, ctx);
		ok(first.ok);
		const second = await rig.executor.start(rig.descriptor, ctx);
		ok(!second.ok);
		strictEqual(second.error.code, 'ALREADY_RUNNING');
		const stop = await rig.executor.stop(rig.descriptor, ctx);
		ok(stop.ok);
		// manager-level: start on running is an ILLEGAL_TRANSITION record (never reaches the executor)
		const viaManager = await rig.manager.perform('start', { id: 'env-test-remote', actor: 'human' });
		ok(!viaManager.ok);
		strictEqual(viaManager.error.code, 'ILLEGAL_TRANSITION');
	} finally {
		await rig.cleanup();
	}
});

test('local-real: snapshot on a never-started (created) environment is a typed NO_STATE_DIR error', async () => {
	const rig = await bootRig();
	try {
		const id = 'env-test-remote';
		await rig.manager.perform('create', { id, actor: 'human' });
		const snap = await rig.manager.perform('snapshot', { id, actor: 'human' });
		ok(!snap.ok);
		strictEqual(snap.error.code, 'NO_STATE_DIR');
		strictEqual(rig.manager.stateOf(id), 'created'); // state preserved
	} finally {
		await rig.cleanup();
	}
});

test('local-real: the injection law — the executor only ever spawns the fixed harness shipped in this extension', async () => {
	const rig = await bootRig();
	try {
		strictEqual(rig.executor.executorKind, 'local-process');
		strictEqual(rig.executor.infrastructureClass, 'real');
		deepStrictEqual([...rig.executor.kinds], ['workspace-remote']);
		// the harness file exists inside the extension and carries the protocol doc
		const source = await fs.readFile(HARNESS_PATH, { encoding: 'utf-8' });
		ok(source.includes('FIXED harness'));
		ok(source.includes('Descriptor-supplied execution is\n * FORBIDDEN') || source.includes('FORBIDDEN'));
		ok(source.includes('flauz.env-state/v0'));
	} finally {
		await rig.cleanup();
	}
});
