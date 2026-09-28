/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL3-004 rung 1 — docker-cli executor drills over `FakeCli` (NO real
 * binaries): the full happy path (run -d keep-alive -> cp the fixed harness
 * from a temp file -> exec -d node -> readiness via the harness stdio
 * protocol), the capability failure classes (binary absent / daemon down),
 * start failures + readiness expiry, the stop escalation choreography,
 * crash reconciliation against docker inspect truth, the foreign-pid law,
 * the trust gate, and the manager routing (container -> docker-cli).
 */
import { test } from 'node:test';
import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { EnvironmentRegistry } from '../src/registry.ts';
import { EnvironmentLifecycleManager, DockerCliExecutor, type LocalEnvFsPort } from '../src/lifecycle/index.ts';
import type { EnvironmentDescriptor } from '../src/api.ts';
import { FakeCli } from './fakeCli.ts';
import { containerRegistrationInput, virtualTime } from './helpers.ts';

const ROOT = '/ws';
const HARNESS_PATH = path.resolve(import.meta.dirname, '..', 'fixtures', 'env-agent.ts');
const CONTAINER_ID = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';
const REMOTE_PID = 7788;

/** In-memory LocalEnvFsPort that records writes under the docker temp dir. */
function memLocalFs(files: Map<string, string>): LocalEnvFsPort & { tempWrites: string[] } {
	const tempWrites: string[] = [];
	return {
		tempWrites,
		readFileUtf8: async target => files.get(target),
		writeFile: async (target, contents) => {
			if (target.startsWith(`${ROOT}/.flauz/env-docker-tmp`)) {
				tempWrites.push(contents);
			}
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
			files.delete(`${target}.tmp`);
		},
	};
}

interface DockerRig {
	cli: FakeCli;
	files: Map<string, string>;
	localFs: ReturnType<typeof memLocalFs>;
	manager: EnvironmentLifecycleManager;
	executor: DockerCliExecutor;
	descriptor: EnvironmentDescriptor;
	model: {
		containerExists: boolean;
		containerRunning: boolean;
		containerStatus: string;
		pidAlive: boolean;
		harnessStatus: string;
	};
}

function stateJsonOf(id: string, model: DockerRig['model']): string {
	return `${JSON.stringify({
		beat: 5,
		environmentId: id,
		pid: REMOTE_PID,
		schema: 'flauz.env-state/v0',
		schemaVersion: 0,
		startedAt: 1730000000000,
		status: model.harnessStatus,
		...(model.harnessStatus === 'stopped' ? { stoppedAt: 1730000009999 } : {}),
	}, null, 2)}\n`;
}

/** Boots the registry + manager + docker-cli executor with a scripted FakeCli docker daemon. */
async function bootDocker(options: { registration?: Record<string, unknown>; harnessPresent?: boolean } = {}): Promise<DockerRig> {
	const files = new Map<string, string>();
	if (options.harnessPresent !== false) {
		files.set(HARNESS_PATH, await fs.readFile(HARNESS_PATH, { encoding: 'utf-8' }));
	}
	const localFs = memLocalFs(files);
	const cli = new FakeCli();
	const time = virtualTime();
	const clock = time.clock;
	const registration = options.registration ?? containerRegistrationInput();
	const registry = new EnvironmentRegistry({ root: ROOT, fs: localFs, clock });
	await registry.bootstrap();
	await registry.register(registration as never);
	const descriptor = registry.get(registration.id as string)!;
	const id = descriptor.id;
	const model: DockerRig['model'] = { containerExists: true, containerRunning: true, containerStatus: 'running', pidAlive: true, harnessStatus: 'running' };
	cli.handler = argv => {
		const name = `flauz-${id}`;
		// docker info (capability probe)
		if (argv.includes('info')) {
			return { exitCode: 0, stdout: 'Server Version: 27.x' };
		}
		// docker inspect <name>
		if (argv.includes('inspect')) {
			if (!model.containerExists) {
				return { exitCode: 1, stderr: `Error: No such object: ${name}` };
			}
			return { exitCode: 0, stdout: JSON.stringify([{ Id: CONTAINER_ID, State: { Running: model.containerRunning, Status: model.containerStatus } }]) };
		}
		// docker run -d (the keep-alive holder)
		if (argv.includes('run')) {
			model.containerExists = true;
			model.containerRunning = true;
			model.containerStatus = 'running';
			return { exitCode: 0, stdout: `${CONTAINER_ID}\n` };
		}
		// docker exec kill (pid signals)
		if (argv.includes('kill') && argv.includes('-0')) {
			return { exitCode: model.pidAlive ? 0 : 1 };
		}
		if (argv.includes('kill') && argv.includes('-15')) {
			model.harnessStatus = 'stopped';
			model.pidAlive = false;
			return { exitCode: 0 };
		}
		if (argv.includes('kill') && argv.includes('-9')) {
			model.pidAlive = false;
			model.harnessStatus = 'stopped';
			return { exitCode: 0 };
		}
		// docker exec on a stopped container fails (the real daemon behavior)
		if (argv.includes('exec') && !model.containerRunning) {
			return { exitCode: 125, stderr: `Error response from daemon: container ${name} is not running` };
		}
		// docker exec cat <log or state>
		const catTarget = argv[argv.length - 1];
		if (catTarget === '/flauz/harness.out') {
			return { exitCode: 0, stdout: `${JSON.stringify({ type: 'ready', pid: REMOTE_PID })}\n` };
		}
		if (catTarget === '/flauz/env-state/state.json') {
			return { exitCode: 0, stdout: stateJsonOf(id, model) };
		}
		// docker cp <cid>:<src> <dst> (state out) or <tempfile> <cid>:/flauz/env-agent.ts (harness in)
		if (argv.includes('cp')) {
			const source = argv[argv.length - 2];
			if (source.startsWith(`${CONTAINER_ID}:`)) {
				files.set(`${argv[argv.length - 1]}/state.json`, stateJsonOf(id, model));
				return { exitCode: 0 };
			}
			return { exitCode: 0 };
		}
		// docker stop --time N <name>
		if (argv.includes('stop')) {
			model.containerRunning = false;
			model.containerStatus = 'exited';
			return { exitCode: 0 };
		}
		// docker rm [-f] <name>
		if (argv.includes('rm')) {
			model.containerExists = false;
			model.containerRunning = false;
			return { exitCode: 0 };
		}
		return { exitCode: 0 };
	};
	const executor = new DockerCliExecutor({
		root: ROOT,
		cli,
		fs: localFs,
		hash: { sha256Hex: contents => createHash('sha256').update(contents, 'utf-8').digest('hex') },
		clock,
		latency: time.latency,
		harnessPath: HARNESS_PATH,
		startTimeoutMs: 400,
		pollIntervalMs: 20,
		stopTimeoutMs: 200,
	});
	const manager = new EnvironmentLifecycleManager({ registry, root: ROOT, fs: localFs, clock, executors: [executor] });
	await manager.bootstrap();
	return { cli, files, localFs, manager, executor, descriptor, model };
}

test('docker-cli: the full happy path over FakeCli (create/start/attach/snapshot/detach/stop/destroy)', async () => {
	const rig = await bootDocker();
	const id = rig.descriptor.id;
	const harnessSource = await fs.readFile(HARNESS_PATH, { encoding: 'utf-8' });
	// create: the capability probe is `docker info`
	const created = await rig.manager.perform('create', { id, actor: 'human' });
	ok(created.ok, JSON.stringify(created.ok ? '' : created.error));
	strictEqual(rig.manager.entryOf(id)!.executorKind, 'docker-cli');
	deepStrictEqual(rig.cli.calls[0]!.argv, ['docker', 'info']);

	// start: run -d keep-alive -> cp from a temp file -> exec -d node -> ready line
	const started = await rig.manager.perform('start', { id, actor: 'agent' });
	ok(started.ok, JSON.stringify(started.ok ? '' : started.error));
	strictEqual(started.detail?.type === 'start' ? started.detail.pid : 0, REMOTE_PID);
	const runCall = rig.cli.calls.find(call => call.argv.includes('run'))!;
	deepStrictEqual(runCall.argv, ['docker', 'run', '-d', '--name', `flauz-${id}`, 'node:24-alpine', 'tail', '-f', '/dev/null']);
	const cpCalls = rig.cli.calls.filter(call => call.argv.includes('cp'));
	strictEqual(cpCalls.length, 1, 'the harness shipped via exactly one docker cp');
	deepStrictEqual(cpCalls[0]!.argv.slice(0, 2), ['docker', 'cp']);
	strictEqual(cpCalls[0]!.argv[2], `${ROOT}/.flauz/env-docker-tmp/${id}.ts`, 'the cp source is the workspace temp file');
	strictEqual(cpCalls[0]!.argv[3], `${CONTAINER_ID}:/flauz/env-agent.ts`);
	strictEqual(rig.files.has(`${ROOT}/.flauz/env-docker-tmp/${id}.ts`), false, 'the temp file was cleaned up');
	const execLaunch = rig.cli.calls.find(call => call.argv.includes('sh'))!;
	ok(execLaunch !== undefined);
	deepStrictEqual(execLaunch.argv.slice(0, 5), ['docker', 'exec', '-d', CONTAINER_ID, 'sh']);
	strictEqual(execLaunch.argv[5], '-c');
	strictEqual(execLaunch.argv[6], `tail -f /dev/null | node /flauz/env-agent.ts --state-dir /flauz/env-state --id ${id} --heartbeat-ms 500 > /flauz/harness.out 2>&1`);
	// the temp-file bytes (recorded at write time) were the fixed harness, byte-for-byte
	strictEqual(rig.localFs.tempWrites.length, 1);
	strictEqual(rig.localFs.tempWrites[0], harnessSource, 'the shipped bytes ARE the fixed harness');
	strictEqual(rig.manager.stateOf(id), 'running');
	const report = await rig.manager.describe({ id });
	strictEqual(report.verdict.health, 'healthy');
	strictEqual(report.verdict.pid, REMOTE_PID);

	// attach: logical lease
	const attached = await rig.manager.perform('attach', { id, actor: 'agent' });
	ok(attached.ok);
	strictEqual(rig.manager.stateOf(id), 'running/attached');

	// snapshot: docker cp out -> canonical manifest
	const snapshotted = await rig.manager.perform('snapshot', { id, actor: 'tool' });
	ok(snapshotted.ok, JSON.stringify(snapshotted.ok ? '' : snapshotted.error));
	const detail = snapshotted.detail?.type === 'snapshot' ? snapshotted.detail : undefined;
	ok(detail !== undefined);
	const snapshotState = rig.files.get(`${detail.snapshotDir}/state.json`)!;
	strictEqual(snapshotState, stateJsonOf(id, rig.model));
	const manifest = JSON.parse(rig.files.get(detail.manifestPath)!) as {
		schema: string; files: Array<{ bytes: number; path: string; sha256: string }>;
	};
	strictEqual(manifest.schema, 'flauz.env-snapshot-manifest/v0');
	strictEqual(manifest.files[0]!.path, 'state.json');
	strictEqual(manifest.files[0]!.sha256, createHash('sha256').update(snapshotState, 'utf-8').digest('hex'));

	// detach
	ok((await rig.manager.perform('detach', { id, actor: 'agent' })).ok);

	// stop: graceful kill -15 on the OWNED pid, then the blessed docker stop --time
	const stopped = await rig.manager.perform('stop', { id, actor: 'human' });
	ok(stopped.ok, JSON.stringify(stopped.ok ? '' : stopped.error));
	const stopDetail = stopped.detail?.type === 'stop' ? stopped.detail : undefined;
	strictEqual(stopDetail?.forcedSignal, 'SIGTERM');
	strictEqual(stopDetail?.pid, REMOTE_PID);
	ok(rig.cli.everCalledWith('-15'));
	strictEqual(rig.cli.everCalledWith('-9'), false);
	const dockerStop = rig.cli.calls.filter(call => call.argv.includes('stop'))[0]!;
	deepStrictEqual(dockerStop.argv, ['docker', 'stop', '--time', '10', `flauz-${id}`]);
	strictEqual(rig.manager.stateOf(id), 'stopped');

	// destroy: stop (idempotent) + rm
	const destroyed = await rig.manager.perform('destroy', { id, actor: 'human' });
	ok(destroyed.ok, JSON.stringify(destroyed.ok ? '' : destroyed.error));
	ok(rig.cli.calls.some(call => call.argv.includes('rm')));
	strictEqual(rig.manager.stateOf(id), 'destroyed');

	// the ledger recorded every op with provenance
	deepStrictEqual(rig.manager.ops().map(record => record.op), ['create', 'start', 'attach', 'snapshot', 'detach', 'stop', 'destroy']);
});

test('docker-cli: binary absent and daemon down are DISTINCT typed fail-closed errors (the common dev-box cases)', async () => {
	const rig = await bootDocker();
	const id = rig.descriptor.id;
	rig.cli.queueResult({ spawnError: 'spawn docker ENOENT' });
	const noBinary = await rig.manager.perform('create', { id, actor: 'human' });
	ok(!noBinary.ok);
	strictEqual(noBinary.error.code, 'CLI_NOT_AVAILABLE');
	strictEqual(rig.manager.entryOf(id), undefined);

	const rig2 = await bootDocker({ registration: containerRegistrationInput({ id: 'env-test-container-b' }) });
	rig2.cli.queueResult({ exitCode: 1, stderr: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?' });
	const noDaemon = await rig2.manager.perform('create', { id: 'env-test-container-b', actor: 'human' });
	ok(!noDaemon.ok);
	strictEqual(noDaemon.error.code, 'DAEMON_UNREACHABLE');
	ok(noDaemon.error.message.includes('docker daemon'));
	strictEqual(rig2.manager.entryOf('env-test-container-b'), undefined);
});

test('docker-cli: a failed docker run (image pull failure) is a typed START_FAILED landing the env in failed', async () => {
	const rig = await bootDocker();
	const id = rig.descriptor.id;
	await rig.manager.perform('create', { id, actor: 'human' });
	rig.cli.queueResult({ exitCode: 1, stderr: 'Unable to find image node:24-alpine locally: pull access denied' });
	const started = await rig.manager.perform('start', { id, actor: 'agent' });
	ok(!started.ok);
	strictEqual(started.error.code, 'START_FAILED');
	ok(started.error.message.includes('pull'));
	strictEqual(rig.manager.stateOf(id), 'failed');
});

test('docker-cli: readiness expiry is a typed START_FAILED and never leaves the container behind', async () => {
	const rig = await bootDocker();
	const id = rig.descriptor.id;
	await rig.manager.perform('create', { id, actor: 'human' });
	const original = rig.cli.handler;
	rig.cli.handler = argv => {
		const catTarget = argv[argv.length - 1];
		if (catTarget === '/flauz/harness.out') {
			return { exitCode: 0, stdout: '' }; // ready never arrives
		}
		return original!(argv);
	};
	const started = await rig.manager.perform('start', { id, actor: 'agent' });
	ok(!started.ok);
	strictEqual(started.error.code, 'START_FAILED');
	ok(started.error.message.includes('did not report ready'));
	// the half-started container was defensively removed
	ok(rig.cli.calls.some(call => call.argv.includes('rm')), 'the failed start reaped the container');
	strictEqual(rig.manager.stateOf(id), 'failed');
});

test('docker-cli: a pid that refuses graceful death is SIGKILL-escalated inside the container', async () => {
	const rig = await bootDocker();
	const id = rig.descriptor.id;
	await rig.manager.perform('create', { id, actor: 'human' });
	await rig.manager.perform('start', { id, actor: 'human' });
	const original = rig.cli.handler!;
	rig.cli.handler = argv => {
		if (argv.includes('kill') && argv.includes('-0')) {
			return { exitCode: 0 }; // refuses to die
		}
		if (argv.includes('kill') && argv.includes('-15')) {
			rig.model.harnessStatus = 'stopped';
			return { exitCode: 0 };
		}
		if (argv.includes('kill') && argv.includes('-9')) {
			rig.model.pidAlive = false;
			rig.model.harnessStatus = 'stopped';
			return { exitCode: 0 };
		}
		return original(argv);
	};
	const stopped = await rig.manager.perform('stop', { id, actor: 'human' });
	ok(stopped.ok);
	const stopDetail = stopped.detail?.type === 'stop' ? stopped.detail : undefined;
	strictEqual(stopDetail?.forcedSignal, 'SIGKILL');
	ok(rig.cli.everCalledWith('-9'));
	strictEqual(rig.manager.stateOf(id), 'stopped');
});

test('docker-cli: crash reconciliation — a dead harness pid inside a RUNNING container surfaces stale, never healthy', async () => {
	const rig = await bootDocker();
	const id = rig.descriptor.id;
	await rig.manager.perform('create', { id, actor: 'human' });
	await rig.manager.perform('start', { id, actor: 'human' });
	rig.model.pidAlive = false; // the harness dies behind the manager's back
	const report = await rig.manager.describe({ id });
	strictEqual(report.state, 'running');
	strictEqual(report.verdict.health, 'stale');
	ok(report.verdict.message.includes('crash reconciliation'));
	const stopped = await rig.manager.perform('stop', { id, actor: 'human' });
	ok(stopped.ok, JSON.stringify(stopped.ok ? '' : stopped.error));
	strictEqual(rig.manager.stateOf(id), 'stopped');
});

test('docker-cli: an exited container with running-claims reconciles stale; a gone container reads not-running (manager downgrades)', async () => {
	const rig = await bootDocker();
	const id = rig.descriptor.id;
	await rig.manager.perform('create', { id, actor: 'human' });
	await rig.manager.perform('start', { id, actor: 'human' });
	// the container exits uncleanly (daemon/host restart) while the harness never wrote a stop
	rig.model.containerRunning = false;
	rig.model.containerStatus = 'exited';
	const report = await rig.manager.describe({ id });
	strictEqual(report.state, 'running');
	strictEqual(report.verdict.health, 'stale');
	// container fully gone
	rig.model.containerExists = false;
	const goneReport = await rig.manager.describe({ id });
	// the executor reads not-running; the manager's state/truth disagreement check
	// downgrades a persisted running state to stale (never silently healthy)
	strictEqual(goneReport.verdict.health, 'stale');
	strictEqual(goneReport.state, 'running');
	ok(goneReport.verdict.message.includes('disagrees') || goneReport.verdict.message.includes('no backing container'));
});

test('docker-cli: foreign-pid law — a fresh executor sees an orphan; stop never signals the foreign pid directly, docker stop is container-scoped', async () => {
	const rig = await bootDocker();
	const id = rig.descriptor.id;
	await rig.manager.perform('create', { id, actor: 'human' });
	await rig.manager.perform('start', { id, actor: 'human' });

	// HOST RESTART: a fresh registry + executor + manager over the same truth
	const cli2 = new FakeCli();
	const files2 = new Map(rig.files);
	const localFs2 = memLocalFs(files2);
	const time2 = virtualTime();
	const clock = time2.clock;
	const registry2 = new EnvironmentRegistry({ root: ROOT, fs: localFs2, clock });
	await registry2.bootstrap();
	const model2: DockerRig['model'] = { containerExists: true, containerRunning: true, containerStatus: 'running', pidAlive: true, harnessStatus: 'running' };
	cli2.handler = argv => {
		const name = `flauz-${id}`;
		if (argv.includes('info')) {
			return { exitCode: 0 };
		}
		if (argv.includes('inspect')) {
			return { exitCode: 0, stdout: JSON.stringify([{ Id: CONTAINER_ID, State: { Running: model2.containerRunning, Status: model2.containerStatus } }]) };
		}
		if (argv.includes('kill') && argv.includes('-0')) {
			return { exitCode: model2.pidAlive ? 0 : 1 };
		}
		if (argv.includes('kill') && argv.includes('-15')) {
			throw new Error('the foreign-pid law was violated: kill -15 reached a pid this instance never started');
		}
		if (argv.includes('kill') && argv.includes('-9')) {
			throw new Error('the foreign-pid law was violated: kill -9 reached a pid this instance never started');
		}
		if (argv.includes('exec') && !model2.containerRunning) {
			return { exitCode: 125 };
		}
		const catTarget = argv[argv.length - 1];
		if (catTarget === '/flauz/env-state/state.json') {
			return { exitCode: 0, stdout: stateJsonOf(id, model2) };
		}
		if (argv.includes('cp')) {
			const source = argv[argv.length - 2];
			if (source.startsWith(`${CONTAINER_ID}:`)) {
				files2.set(`${argv[argv.length - 1]}/state.json`, stateJsonOf(id, model2));
			}
			return { exitCode: 0 };
		}
		if (argv.includes('stop')) {
			model2.containerRunning = false;
			model2.containerStatus = 'exited';
			model2.pidAlive = false; // container teardown takes the namespace with it
			return { exitCode: 0 };
		}
		if (argv.includes('rm')) {
			model2.containerExists = false;
			return { exitCode: 0 };
		}
		return { exitCode: 0 };
	};
	const executor2 = new DockerCliExecutor({
		root: ROOT, cli: cli2, fs: localFs2,
		hash: { sha256Hex: contents => createHash('sha256').update(contents, 'utf-8').digest('hex') },
		clock, latency: time2.latency, harnessPath: HARNESS_PATH,
	});
	const manager2 = new EnvironmentLifecycleManager({ registry: registry2, root: ROOT, fs: localFs2, clock, executors: [executor2] });
	await manager2.bootstrap();

	// describe surfaces the typed orphan verdict (never healthy)
	const report = await manager2.describe({ id });
	strictEqual(report.state, 'running');
	strictEqual(report.verdict.health, 'orphan');
	strictEqual(report.verdict.pid, REMOTE_PID);

	// stop: NO direct pid signal — the container-scoped docker stop only
	const stopped = await manager2.perform('stop', { id, actor: 'human' });
	ok(stopped.ok, JSON.stringify(stopped.ok ? '' : stopped.error));
	const stopDetail = stopped.detail?.type === 'stop' ? stopped.detail : undefined;
	strictEqual(stopDetail?.forcedSignal, null, 'no direct signal for a foreign pid');
	// kill -0 (signal-free liveness) is the ONLY kill-shaped argv ever issued
	strictEqual(cli2.calls.some(call => call.argv.includes('-15') || call.argv.includes('-9')), false, 'no pid signal was issued for the foreign pid');
	for (const call of cli2.callsWith('kill')) {
		deepStrictEqual(call.argv.slice(-2), ['-0', String(REMOTE_PID)], 'only the signal-free kill -0 liveness probe');
	}
	const destroyed = await manager2.perform('destroy', { id, actor: 'human' });
	ok(destroyed.ok, JSON.stringify(destroyed.ok ? '' : destroyed.error));
	strictEqual(manager2.stateOf(id), 'destroyed');
});

test('docker-cli: the trust gate holds — the container default posture (trusted) starts; untrusted rejects before any docker call', async () => {
	const rig = await bootDocker({ registration: containerRegistrationInput({ id: 'env-test-container-untrusted', trust: { posture: 'untrusted', inheritsWorkspaceTrust: false } }) });
	const id = 'env-test-container-untrusted';
	await rig.manager.perform('create', { id, actor: 'human' });
	const callsBefore = rig.cli.calls.length;
	const started = await rig.manager.perform('start', { id, actor: 'agent' });
	ok(!started.ok);
	strictEqual(started.error.code, 'TRUST_POSTURE_REJECTED');
	strictEqual(rig.cli.calls.length, callsBefore);
});

test('docker-cli: snapshot without a backing container is the typed NO_STATE_DIR error (state preserved)', async () => {
	const rig = await bootDocker();
	const id = rig.descriptor.id;
	await rig.manager.perform('create', { id, actor: 'human' });
	rig.model.containerExists = false;
	const snap = await rig.manager.perform('snapshot', { id, actor: 'human' });
	ok(!snap.ok);
	strictEqual(snap.error.code, 'NO_STATE_DIR');
	strictEqual(rig.manager.stateOf(id), 'created');
});

test('docker-cli: the fixed harness missing from disk is a typed HARNESS_MISSING (injection law — nothing else is ever run)', async () => {
	const rig = await bootDocker({ harnessPresent: false });
	const id = rig.descriptor.id;
	await rig.manager.perform('create', { id, actor: 'human' });
	const started = await rig.manager.perform('start', { id, actor: 'human' });
	ok(!started.ok);
	strictEqual(started.error.code, 'HARNESS_MISSING');
	strictEqual(rig.cli.calls.some(call => call.argv.includes('run')), false, 'no container was launched without the fixed harness');
});
