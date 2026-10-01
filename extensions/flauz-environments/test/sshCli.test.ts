/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL3-004 rung 1 — ssh-cli executor drills over `FakeCli` (NO real binaries):
 * the full happy path, every capability/start/stop failure class, the
 * never-signal-foreign-pids law, snapshot manifest integrity, the argv
 * injection discipline, the trust gate, and the manager routing
 * (ssh-local -> ssh-cli without opt-in; simulated stays opt-in).
 */
import { test } from 'node:test';
import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { EnvironmentRegistry } from '../src/registry.ts';
import { EnvironmentLifecycleManager, SimulatedRemoteExecutor, SshCliExecutor, type LocalEnvFsPort } from '../src/lifecycle/index.ts';
import type { EnvironmentDescriptor, EnvironmentKind } from '../src/api.ts';
import { FakeCli } from './fakeCli.ts';
import { sshRegistrationInput, virtualTime } from './helpers.ts';

const ROOT = '/ws';
const HARNESS_PATH = path.resolve(import.meta.dirname, '..', 'fixtures', 'env-agent.ts');
const REMOTE_PID = 4242;

/** In-memory LocalEnvFsPort (deterministic; snapshot bytes land in the map). */
function memLocalFs(files: Map<string, string> = new Map()): LocalEnvFsPort & { dump(): Map<string, string> } {
	return {
		dump: () => files,
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
			files.delete(`${target}.tmp`);
		},
	};
}

interface SshRig {
	cli: FakeCli;
	files: Map<string, string>;
	manager: EnvironmentLifecycleManager;
	executor: SshCliExecutor;
	descriptor: EnvironmentDescriptor;
	remote: {
		alive: boolean;
		status: string;
	};
}

function stateJsonOf(id: string, remote: { alive: boolean; status: string }): string {
	return `${JSON.stringify({
		beat: 3,
		environmentId: id,
		pid: REMOTE_PID,
		schema: 'flauz.env-state/v0',
		schemaVersion: 0,
		startedAt: 1730000000000,
		status: remote.status,
		...(remote.status === 'stopped' ? { stoppedAt: 1730000009999 } : {}),
	}, null, 2)}\n`;
}

/**
 * Boots the registry + manager + ssh-cli executor over the in-memory fs with
 * a scripted FakeCli. The handler models the remote truth: the harness log,
 * the state file, and pid liveness (`kill -0`).
 */
async function bootSsh(options: { registration?: Record<string, unknown>; harnessPresent?: boolean } = {}): Promise<SshRig> {
	const files = new Map<string, string>();
	if (options.harnessPresent !== false) {
		files.set(HARNESS_PATH, await fs.readFile(HARNESS_PATH, { encoding: 'utf-8' }));
	}
	const localFs = memLocalFs(files);
	const cli = new FakeCli();
	const time = virtualTime();
	const clock = time.clock;
	const registration = options.registration ?? sshRegistrationInput();
	const registry = new EnvironmentRegistry({ root: ROOT, fs: localFs, clock });
	await registry.bootstrap();
	await registry.register(registration as never);
	const descriptor = registry.get(registration.id as string)!;
	const id = descriptor.id;
	const remote = { alive: true, status: 'running' };
	cli.handler = argv => {
		const last = argv[argv.length - 1];
		if (argv.includes('kill') && argv.includes('-0')) {
			return { exitCode: remote.alive ? 0 : 1 };
		}
		if (argv.includes('kill') && argv.includes('-15')) {
			remote.status = 'stopped';
			remote.alive = false; // the graceful protocol worked (harness exits cleanly on SIGTERM)
			return { exitCode: 0 };
		}
		if (argv.includes('kill') && argv.includes('-9')) {
			remote.alive = false;
			remote.status = 'stopped';
			return { exitCode: 0 };
		}
		if (argv.includes('true')) {
			return { exitCode: 0 };
		}
		if (last === `~/.flauz/env-state/${id}/harness.out`) {
			return { stdout: `${JSON.stringify({ type: 'ready', pid: REMOTE_PID })}\n` };
		}
		if (last === `~/.flauz/env-state/${id}/state.json`) {
			return { stdout: stateJsonOf(id, remote) };
		}
		return { exitCode: 0 };
	};
	const executor = new SshCliExecutor({
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
	return { cli, files, manager, executor, descriptor, remote };
}

test('ssh-cli: the full happy path over FakeCli (create/start/attach/snapshot/detach/stop/destroy)', async () => {
	const rig = await bootSsh();
	const id = rig.descriptor.id;
	try {
		// create: capability probe (ssh -V) + connectivity/auth probe (ssh <target> true)
		const created = await rig.manager.perform('create', { id, actor: 'human' });
		ok(created.ok, JSON.stringify(created.ok ? '' : created.error));
		strictEqual(rig.manager.entryOf(id)!.executorKind, 'ssh-cli');
		const versionCall = rig.cli.calls[0]!;
		deepStrictEqual(versionCall.argv, ['ssh', '-V']);
		const probeCall = rig.cli.calls[1]!;
		ok(probeCall.argv.includes('true'));
		deepStrictEqual(probeCall.argv.slice(0, 8), ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=yes', '--']);

		// start: ONE command-free pipe — the FIXED harness ships over stdin to `node -`
		const started = await rig.manager.perform('start', { id, actor: 'agent' });
		ok(started.ok, JSON.stringify(started.ok ? '' : started.error));
		strictEqual(started.detail?.type, 'start');
		strictEqual(started.detail?.type === 'start' ? started.detail.pid : 0, REMOTE_PID);
		const launchCall = rig.cli.calls.find(call => call.argv.includes('nohup'))!;
		ok(launchCall !== undefined, 'the launch call was recorded');
		deepStrictEqual(launchCall.argv.slice(-17), ['mkdir', '-p', `~/.flauz/env-state/${id}`, '&&', 'nohup', 'node', '-', '--state-dir', `~/.flauz/env-state/${id}`, '--id', id, '--heartbeat-ms', '500', '>', `~/.flauz/env-state/${id}/harness.out`, '2>&1', '&']);
		ok(launchCall.stdin !== undefined && launchCall.stdin.includes('flauz.env-state/v0'), 'the harness content rode stdin');
		strictEqual(launchCall.stdin, await fs.readFile(HARNESS_PATH, { encoding: 'utf-8' }), 'the shipped bytes ARE the fixed harness, byte-for-byte');
		// the ready line (the harness's OWN stdio protocol) provided the pid
		strictEqual(rig.manager.stateOf(id), 'running');
		const report = await rig.manager.describe({ id });
		strictEqual(report.verdict.health, 'healthy');
		strictEqual(report.verdict.pid, REMOTE_PID);

		// attach: logical lease with provenance
		const attached = await rig.manager.perform('attach', { id, actor: 'agent' });
		ok(attached.ok);
		strictEqual(rig.manager.stateOf(id), 'running/attached');
		ok((await rig.manager.describe({ id })).verdict.lease !== undefined);

		// snapshot: remote state pulled over the connection -> canonical manifest
		const snapshotted = await rig.manager.perform('snapshot', { id, actor: 'tool' });
		ok(snapshotted.ok, JSON.stringify(snapshotted.ok ? '' : snapshotted.error));
		const detail = snapshotted.detail?.type === 'snapshot' ? snapshotted.detail : undefined;
		ok(detail !== undefined);
		strictEqual(detail.fileCount, 1);
		const snapshotState = rig.files.get(`${detail.snapshotDir}/state.json`)!;
		strictEqual(snapshotState, stateJsonOf(id, rig.remote));
		const manifest = JSON.parse(rig.files.get(`${detail.manifestPath}`)!) as {
			schema: string; environmentId: string; createdAt: number;
			files: Array<{ bytes: number; path: string; sha256: string }>;
		};
		strictEqual(manifest.schema, 'flauz.env-snapshot-manifest/v0');
		strictEqual(manifest.environmentId, id);
		strictEqual(manifest.files.length, 1);
		strictEqual(manifest.files[0]!.path, 'state.json');
		strictEqual(manifest.files[0]!.sha256, createHash('sha256').update(snapshotState, 'utf-8').digest('hex'));
		strictEqual(manifest.files[0]!.bytes, snapshotState.length);

		// detach
		const detached = await rig.manager.perform('detach', { id, actor: 'agent' });
		ok(detached.ok);
		strictEqual(rig.manager.stateOf(id), 'running');

		// stop: graceful kill -15 on the harness-reported pid, reaped
		const stopped = await rig.manager.perform('stop', { id, actor: 'human' });
		ok(stopped.ok, JSON.stringify(stopped.ok ? '' : stopped.error));
		const stopDetail = stopped.detail?.type === 'stop' ? stopped.detail : undefined;
		strictEqual(stopDetail?.forcedSignal, 'SIGTERM');
		strictEqual(stopDetail?.pid, REMOTE_PID);
		strictEqual(rig.cli.everCalledWith('-15'), true);
		strictEqual(rig.cli.everCalledWith('-9'), false);
		strictEqual(rig.manager.stateOf(id), 'stopped');

		// destroy: terminal teardown removes the remote state dir
		const destroyed = await rig.manager.perform('destroy', { id, actor: 'human' });
		ok(destroyed.ok, JSON.stringify(destroyed.ok ? '' : destroyed.error));
		const rmCall = rig.cli.calls.find(call => call.argv.includes('rm'))!;
		deepStrictEqual(rmCall.argv.slice(-3), ['rm', '-rf', `~/.flauz/env-state/${id}`]);
		strictEqual(rig.manager.stateOf(id), 'destroyed');

		// the ledger recorded every op with provenance
		deepStrictEqual(rig.manager.ops().map(record => record.op), ['create', 'start', 'attach', 'snapshot', 'detach', 'stop', 'destroy']);
		deepStrictEqual(new Set(rig.manager.ops().map(record => record.actor)), new Set(['human', 'agent', 'tool']));
	} finally {
		// nothing real to clean (FakeCli + mem fs)
	}
});

test('ssh-cli: binary absent is the typed CLI_NOT_AVAILABLE fail-closed error (the dev-box case)', async () => {
	const rig = await bootSsh();
	const id = rig.descriptor.id;
	rig.cli.queueResult({ spawnError: 'spawn ssh ENOENT' });
	const created = await rig.manager.perform('create', { id, actor: 'human' });
	ok(!created.ok);
	strictEqual(created.error.code, 'CLI_NOT_AVAILABLE');
	ok(created.error.message.includes('fails closed'));
	strictEqual(rig.manager.stateOf(id), 'registered'); // failed create mints no entry
	strictEqual(rig.manager.entryOf(id), undefined);
});

test('ssh-cli: probe failure classes — SSH_AUTH_FAILED (permission denied) vs SSH_UNREACHABLE', async () => {
	const rig = await bootSsh();
	const id = rig.descriptor.id;
	rig.cli.queueResult({ exitCode: 0 }); // ssh -V
	rig.cli.queueResult({ exitCode: 255, stderr: 'test.example.internal: Permission denied (publickey,password).' });
	const auth = await rig.manager.perform('create', { id, actor: 'human' });
	ok(!auth.ok);
	strictEqual(auth.error.code, 'SSH_AUTH_FAILED');

	const rig2 = await bootSsh({ registration: sshRegistrationInput({ id: 'env-test-ssh-b' }) });
	rig2.cli.queueResult({ exitCode: 0 });
	rig2.cli.queueResult({ exitCode: 255, stderr: 'ssh: connect to host test.example.internal port 22: Connection refused' });
	const unreachable = await rig2.manager.perform('create', { id: 'env-test-ssh-b', actor: 'human' });
	ok(!unreachable.ok);
	strictEqual(unreachable.error.code, 'SSH_UNREACHABLE');
});

test('ssh-cli: a harness protocol error line surfaces as typed START_FAILED and lands the env in failed', async () => {
	const rig = await bootSsh();
	const id = rig.descriptor.id;
	rig.cli.queueResult({ exitCode: 0 }); // ssh -V
	rig.cli.queueResult({ exitCode: 0 }); // ssh <target> true
	rig.cli.queueResult({ exitCode: 0 }); // launch
	rig.cli.handler = () => ({ stdout: `${JSON.stringify({ type: 'error', message: '--state-dir must be absolute' })}\n` });
	const created = await rig.manager.perform('create', { id, actor: 'human' });
	ok(created.ok);
	const started = await rig.manager.perform('start', { id, actor: 'agent' });
	ok(!started.ok);
	strictEqual(started.error.code, 'START_FAILED');
	ok(started.error.message.includes('--state-dir must be absolute'));
	strictEqual(rig.manager.stateOf(id), 'failed');
	// recovery: start is legal from failed
	rig.cli.handler = argv => {
		const last = argv[argv.length - 1];
		if (last === `~/.flauz/env-state/${id}/harness.out`) {
			return { stdout: `${JSON.stringify({ type: 'ready', pid: 9911 })}\n` };
		}
		return { exitCode: 0 };
	};
	const retry = await rig.manager.perform('start', { id, actor: 'agent' });
	ok(retry.ok, JSON.stringify(retry.ok ? '' : retry.error));
	strictEqual(retry.record.fromState, 'failed');
});

test('ssh-cli: the readiness window expiry is a typed START_FAILED (never a hang)', async () => {
	const rig = await bootSsh();
	const id = rig.descriptor.id;
	rig.cli.queueResult({ exitCode: 0 }); // ssh -V
	rig.cli.queueResult({ exitCode: 0 }); // connectivity
	rig.cli.queueResult({ exitCode: 0 }); // launch
	rig.cli.handler = () => ({ stdout: '' }); // the log never carries a ready line
	await rig.manager.perform('create', { id, actor: 'human' });
	const started = await rig.manager.perform('start', { id, actor: 'agent' });
	ok(!started.ok);
	strictEqual(started.error.code, 'START_FAILED');
	ok(started.error.message.includes('did not report ready'));
	strictEqual(rig.manager.stateOf(id), 'failed');
});

test('ssh-cli: a pid that refuses graceful death is SIGKILL-escalated (timeout + kill escalation)', async () => {
	const rig = await bootSsh();
	const id = rig.descriptor.id;
	await rig.manager.perform('create', { id, actor: 'human' });
	await rig.manager.perform('start', { id, actor: 'human' });
	// kill -15 lands but the pid stays alive past the grace window -> kill -9
	rig.cli.handler = argv => {
		if (argv.includes('kill') && argv.includes('-0')) {
			return { exitCode: 0 }; // still alive
		}
		if (argv.includes('kill') && argv.includes('-15')) {
			return { exitCode: 0 };
		}
		if (argv.includes('kill') && argv.includes('-9')) {
			rig.remote.alive = false;
			rig.remote.status = 'stopped';
			return { exitCode: 0 };
		}
		return { exitCode: 0 };
	};
	const stopped = await rig.manager.perform('stop', { id, actor: 'human' });
	ok(stopped.ok);
	const stopDetail = stopped.detail?.type === 'stop' ? stopped.detail : undefined;
	strictEqual(stopDetail?.forcedSignal, 'SIGKILL');
	strictEqual(rig.cli.everCalledWith('-9'), true);
	strictEqual(rig.manager.stateOf(id), 'stopped');
});

test('ssh-cli: never-signal-foreign-pids — a fresh executor sees an orphan, refuses stop, resolves after the human acts', async () => {
	const rig = await bootSsh();
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
	const remote2 = { alive: true, status: 'running' };
	cli2.handler = argv => {
		const last = argv[argv.length - 1];
		if (argv.includes('kill') && argv.includes('-0')) {
			return { exitCode: remote2.alive ? 0 : 1 };
		}
		if (argv.includes('kill') && argv.includes('-15') || argv.includes('kill') && argv.includes('-9')) {
			remote2.alive = false;
			remote2.status = 'stopped';
			return { exitCode: 0 };
		}
		if (last === `~/.flauz/env-state/${id}/state.json`) {
			return { stdout: stateJsonOf(id, remote2) };
		}
		return { exitCode: 0 };
	};
	const executor2 = new SshCliExecutor({
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

	// stop REFUSES to signal a pid this instance did not start (fail-closed)
	const stop = await manager2.perform('stop', { id, actor: 'human' });
	ok(!stop.ok);
	strictEqual(stop.error.code, 'PROCESS_NOT_OWNED');
	strictEqual(cli2.everCalledWith('-15'), false);
	strictEqual(cli2.everCalledWith('-9'), false);
	strictEqual(remote2.alive, true, 'the unowned remote process was left alone');

	// manual resolution: the human kills the stray remotely; then destroy proceeds
	remote2.alive = false;
	remote2.status = 'stopped';
	const destroy = await manager2.perform('destroy', { id, actor: 'human' });
	ok(destroy.ok, JSON.stringify(destroy.ok ? '' : destroy.error));
	strictEqual(manager2.stateOf(id), 'destroyed');
});

test('ssh-cli: crash reconciliation — a dead remote pid with running state surfaces stale, never healthy', async () => {
	const rig = await bootSsh();
	const id = rig.descriptor.id;
	await rig.manager.perform('create', { id, actor: 'human' });
	await rig.manager.perform('start', { id, actor: 'human' });
	// the remote process dies behind the manager's back (hard crash)
	rig.remote.alive = false;
	const report = await rig.manager.describe({ id });
	strictEqual(report.state, 'running');
	strictEqual(report.verdict.health, 'stale');
	ok(report.verdict.message.includes('crash reconciliation'));
	// recovery is explicit: stop records the reconciliation (pid already dead)
	const stopped = await rig.manager.perform('stop', { id, actor: 'human' });
	ok(stopped.ok, JSON.stringify(stopped.ok ? '' : stopped.error));
	strictEqual(rig.manager.stateOf(id), 'stopped');
});

test('ssh-cli: the injection law — descriptor connection data never reaches argv as commands; the destination carries host/port/user', async () => {
	const rig = await bootSsh({
		registration: sshRegistrationInput({
			id: 'env-test-ssh-inj',
			connection: { host: 'test.example.internal', port: 2222, user: 'deploy', authMethod: 'key', remotePath: '/home/deploy/x; rm -rf /' },
		}),
	});
	const id = rig.descriptor.id;
	await rig.manager.perform('create', { id, actor: 'human' });
	await rig.manager.perform('start', { id, actor: 'human' });
	await rig.manager.perform('stop', { id, actor: 'human' });
	await rig.manager.perform('destroy', { id, actor: 'human' });
	// the descriptor's remotePath NEVER appears in any argv token
	for (const call of rig.cli.calls) {
		for (const token of call.argv) {
			ok(!token.includes(';'), `no shell metachar token reached argv: ${JSON.stringify(token)}`);
			ok(!token.includes('/home/deploy'), `the descriptor remotePath never reaches argv: ${JSON.stringify(token)}`);
		}
	}
	// host/port/user ride the ssh DESTINATION only (client-parsed, never shelled)
	const withTarget = rig.cli.calls.filter(call => call.argv.includes('--'));
	ok(withTarget.length > 0);
	for (const call of withTarget) {
		const target = call.argv[call.argv.indexOf('--') + 1]!;
		strictEqual(target, 'deploy@test.example.internal');
		ok(call.argv.includes('-p'));
		strictEqual(call.argv[call.argv.indexOf('-p') + 1], '2222');
	}
	// every ssh invocation is non-interactive + fail-closed on unknown host keys
	for (const call of rig.cli.calls) {
		strictEqual(call.argv[0], 'ssh');
		if (call.argv.includes('--')) {
			ok(call.argv.includes('BatchMode=yes'));
			ok(call.argv.includes('StrictHostKeyChecking=yes'));
		}
	}
});

test('ssh-cli: the trust gate holds through the real executor — untrusted rejects BEFORE any ssh call; unknown proceeds (DL-30)', async () => {
	const rig = await bootSsh({ registration: sshRegistrationInput({ id: 'env-test-ssh-untrusted', trust: { posture: 'untrusted', inheritsWorkspaceTrust: false } }) });
	const id = 'env-test-ssh-untrusted';
	await rig.manager.perform('create', { id, actor: 'human' });
	const callsBefore = rig.cli.calls.length;
	const started = await rig.manager.perform('start', { id, actor: 'agent' });
	ok(!started.ok);
	strictEqual(started.error.code, 'TRUST_POSTURE_REJECTED');
	ok(started.error.message.includes('untrusted'));
	strictEqual(rig.cli.calls.length, callsBefore, 'the gate rejected before reaching the executor');
	strictEqual(rig.manager.stateOf(id), 'created');
});

test('ssh-cli: routing — ssh-local resolves the REAL executor without any opt-in; the simulated drill stays behind the opt-in', async () => {
	const files = new Map<string, string>([[HARNESS_PATH, await fs.readFile(HARNESS_PATH, { encoding: 'utf-8' })]]);
	const localFs = memLocalFs(files);
	const cli = new FakeCli();
	const time = virtualTime();
	const clock = time.clock;
	const registry = new EnvironmentRegistry({ root: ROOT, fs: localFs, clock });
	await registry.bootstrap();
	await registry.register(sshRegistrationInput() as never);
	await registry.register(sshRegistrationInput({ id: 'env-test-ssh-b' }) as never);
	const sshExecutor = new SshCliExecutor({
		root: ROOT, cli, fs: localFs,
		hash: { sha256Hex: contents => createHash('sha256').update(contents, 'utf-8').digest('hex') },
		clock, latency: time.latency, harnessPath: HARNESS_PATH,
	});
	const simExecutor = new SimulatedRemoteExecutor({ kind: 'ssh-local' as EnvironmentKind, root: ROOT, fs: { ...localFs, rm: async target => localFs.rm(target) }, clock });
	const manager = new EnvironmentLifecycleManager({ registry, root: ROOT, fs: localFs, clock, executors: [sshExecutor, simExecutor] });
	await manager.bootstrap();
	// real without opt-in (FakeCli scripts the probe + connectivity)
	const created = await manager.perform('create', { id: 'env-test-ssh', actor: 'human' });
	ok(created.ok, JSON.stringify(created.ok ? '' : created.error));
	strictEqual(manager.entryOf('env-test-ssh')!.executorKind, 'ssh-cli');
	// simulated with the opt-in (drives the drill executor instead)
	const simCreated = await manager.perform('create', { id: 'env-test-ssh-b', actor: 'human', simulated: true });
	ok(simCreated.ok, JSON.stringify(simCreated.ok ? '' : simCreated.error));
	strictEqual(manager.entryOf('env-test-ssh-b')!.executorKind, 'simulated-ssh-local');
	// and the first entry stays ssh-cli (routing is per-request, not global)
	strictEqual(manager.entryOf('env-test-ssh')!.executorKind, 'ssh-cli');
});

test('ssh-cli: executor-level double start is a typed ALREADY_RUNNING while the pid lives', async () => {
	const rig = await bootSsh();
	const ctx = { actor: 'human' as const, now: Date.now() };
	await rig.executor.create(rig.descriptor, ctx);
	const first = await rig.executor.start(rig.descriptor, ctx);
	ok(first.ok);
	const second = await rig.executor.start(rig.descriptor, ctx);
	ok(!second.ok);
	strictEqual(second.error.code, 'ALREADY_RUNNING');
	const stop = await rig.executor.stop(rig.descriptor, ctx);
	ok(stop.ok);
});

test('ssh-cli: snapshot without a remote state file is the typed NO_STATE_DIR error (state preserved)', async () => {
	const rig = await bootSsh();
	const id = rig.descriptor.id;
	await rig.manager.perform('create', { id, actor: 'human' });
	rig.cli.handler = argv => {
		const last = argv[argv.length - 1];
		if (last === `~/.flauz/env-state/${id}/state.json`) {
			return { exitCode: 1, stderr: `cat: ${last}: No such file or directory` };
		}
		return { exitCode: 0 };
	};
	const snap = await rig.manager.perform('snapshot', { id, actor: 'human' });
	ok(!snap.ok);
	strictEqual(snap.error.code, 'NO_STATE_DIR');
	strictEqual(rig.manager.stateOf(id), 'created');
});

test('ssh-cli: the fixed harness missing from disk is a typed HARNESS_MISSING (injection law — nothing else is ever run)', async () => {
	const rig = await bootSsh({ harnessPresent: false });
	const id = rig.descriptor.id;
	await rig.manager.perform('create', { id, actor: 'human' });
	const started = await rig.manager.perform('start', { id, actor: 'human' });
	ok(!started.ok);
	strictEqual(started.error.code, 'HARNESS_MISSING');
	strictEqual(rig.cli.calls.some(call => call.argv.includes('nohup')), false, 'no launch happened without the fixed harness');
});
// ---------------------------------------------------------------------------
// P2-FIX-110 — the `remotePidAlive` single-invocation unverifiable window
// (a `kill -0` that spawn-fails while the op's other invocations worked is
// UNVERIFIABLE, never "not alive"; the consuming op verdicts fail closed)
// ---------------------------------------------------------------------------

/**
 * P2-FIX-110 rig: a FRESH executor + manager over the same persisted truth
 * (the host-restart shape — nothing in `owned`, so stop/destroy/probe take
 * the reconcile-against-remote-truth path), with a single-invocation vanish
 * window: while `window.open` is true ONLY the `kill -0` liveness probe
 * spawn-fails (state reads, signal kills and `rm` all still work).
 */
async function bootSshHostRestart(rig: SshRig) {
	const id = rig.descriptor.id;
	const cli = new FakeCli();
	const files = new Map(rig.files);
	const localFs = memLocalFs(files);
	const time = virtualTime();
	const clock = time.clock;
	const registry = new EnvironmentRegistry({ root: ROOT, fs: localFs, clock });
	await registry.bootstrap();
	const remote = { alive: true, status: 'running' };
	const window = { open: false };
	cli.handler = argv => {
		const last = argv[argv.length - 1];
		if (window.open && argv.includes('kill') && argv.includes('-0')) {
			// the binary vanished for the liveness probe ONLY. exitCode is PINNED to
			// null because that is exactly what the real NodeCliPort reports for the
			// ENOENT class (FakeCli's default-fill would otherwise fake exit 0 — a
			// spawn error with exit status 0 cannot happen on the real seam)
			return { exitCode: null, spawnError: 'spawn ssh ENOENT' };
		}
		if (argv.includes('kill') && argv.includes('-0')) {
			return { exitCode: remote.alive ? 0 : 1 };
		}
		if (argv.includes('kill') && argv.includes('-15') || argv.includes('kill') && argv.includes('-9')) {
			remote.alive = false;
			remote.status = 'stopped';
			return { exitCode: 0 };
		}
		if (last === `~/.flauz/env-state/${id}/state.json`) {
			return { stdout: stateJsonOf(id, remote) };
		}
		return { exitCode: 0 };
	};
	const executor = new SshCliExecutor({
		root: ROOT, cli, fs: localFs,
		hash: { sha256Hex: contents => createHash('sha256').update(contents, 'utf-8').digest('hex') },
		clock, latency: time.latency, harnessPath: HARNESS_PATH,
		startTimeoutMs: 400, pollIntervalMs: 20, stopTimeoutMs: 200,
	});
	const manager = new EnvironmentLifecycleManager({ registry, root: ROOT, fs: localFs, clock, executors: [executor] });
	await manager.bootstrap();
	return { cli, manager, remote, window, id };
}

test('ssh-cli P2-FIX-110: a kill -0 that spawn-fails while the state read worked is UNVERIFIABLE — the stop op fails closed instead of claiming the unowned pid stopped', async () => {
	const rig = await bootSsh();
	const id = rig.descriptor.id;
	await rig.manager.perform('create', { id, actor: 'human' });
	await rig.manager.perform('start', { id, actor: 'human' });
	// HOST RESTART: a fresh executor over the same truth (the not-owned path)
	const fresh = await bootSshHostRestart(rig);
	fresh.window.open = true; // the binary vanishes for the kill -0 ONLY
	const stop = await fresh.manager.perform('stop', { id, actor: 'human' });
	ok(!stop.ok, 'an unverifiable liveness probe must not claim the pid stopped');
	strictEqual(stop.error.code, 'CLI_NOT_AVAILABLE');
	ok(stop.error.message.includes('unverifiable'), `the verdict names the evidence: ${stop.error.message}`);
	// fail-closed direction: no signal was sent, the unowned process was left alone
	strictEqual(fresh.cli.everCalledWith('-15'), false);
	strictEqual(fresh.cli.everCalledWith('-9'), false);
	strictEqual(fresh.remote.alive, true, 'the possibly-live backing pid was never signaled');
});

test('ssh-cli P2-FIX-110: the describe probe fails closed as stale WITHOUT the fabricated "gone" claim when the kill -0 spawn-fails mid-probe (a clean exit status still reads not-alive)', async () => {
	const rig = await bootSsh();
	const id = rig.descriptor.id;
	await rig.manager.perform('create', { id, actor: 'human' });
	await rig.manager.perform('start', { id, actor: 'human' });
	const fresh = await bootSshHostRestart(rig);
	fresh.window.open = true;
	const unverifiable = await fresh.manager.describe({ id });
	strictEqual(unverifiable.verdict.health, 'stale', 'fail closed — never healthy');
	strictEqual(unverifiable.verdict.state, 'stopped');
	strictEqual(unverifiable.verdict.pid, REMOTE_PID);
	ok(unverifiable.verdict.message.includes('unverifiable'), `the message names the evidence: ${unverifiable.verdict.message}`);
	ok(!unverifiable.verdict.message.includes('crash reconciliation'), 'an unverifiable pid is not a confirmed crash');
	// the clean exit-status control: binary back, pid actually dead -> the exact pre-existing stale verdict
	fresh.window.open = false;
	fresh.remote.alive = false;
	const dead = await fresh.manager.describe({ id });
	strictEqual(dead.verdict.health, 'stale');
	ok(dead.verdict.message.includes('crash reconciliation'), `the clean exit-status probe still reads not-alive: ${dead.verdict.message}`);
});

test('ssh-cli P2-FIX-110: destroy over an unverifiable liveness probe refuses the teardown (no rm -rf, no fabricated destroyed) — the retry after repair completes it honestly', async () => {
	const rig = await bootSsh();
	const id = rig.descriptor.id;
	await rig.manager.perform('create', { id, actor: 'human' });
	await rig.manager.perform('start', { id, actor: 'human' });
	await rig.manager.perform('stop', { id, actor: 'human' }); // owned graceful stop; lifecycle = stopped
	// HOST RESTART over the same truth — but the remote pid is STILL LIVE
	// (pid reuse / the graceful stop never landed): the not-owned path
	const fresh = await bootSshHostRestart(rig);
	fresh.window.open = true; // the binary vanishes for the kill -0 only; rm still works
	const destroy = await fresh.manager.perform('destroy', { id, actor: 'human' });
	ok(!destroy.ok, 'an unverifiable liveness probe must not fabricate destroy success');
	strictEqual(destroy.error.code, 'CLI_NOT_AVAILABLE');
	ok(destroy.error.message.includes('unverifiable'), `the verdict names the evidence: ${destroy.error.message}`);
	strictEqual(fresh.cli.everCalledWith('rm'), false, 'no rm -rf was issued over unverifiable liveness');
	strictEqual(fresh.remote.alive, true, 'the possibly-live backing pid was never signaled');
	strictEqual(fresh.manager.stateOf(id), 'stopped', 'the failed destroy preserved the state (no partial teardown)');
	// the binary returns: the retry completes the teardown honestly
	fresh.window.open = false;
	fresh.remote.alive = false; // the human resolved the stray remotely
	const retried = await fresh.manager.perform('destroy', { id, actor: 'human' });
	ok(retried.ok, JSON.stringify(retried.ok ? '' : retried.error));
	strictEqual(fresh.manager.stateOf(id), 'destroyed');
	ok(fresh.cli.everCalledWith('rm'), 'the retry actually issued the rm -rf');
});

test('ssh-cli P2-FIX-110: start never launches a second harness over an unverifiable previous one (fail-closed refusal, no double launch)', async () => {
	const rig = await bootSsh();
	const id = rig.descriptor.id;
	const ctx = { actor: 'human' as const, now: Date.now() };
	await rig.executor.create(rig.descriptor, ctx);
	const first = await rig.executor.start(rig.descriptor, ctx);
	ok(first.ok);
	// the single-invocation window: ONLY the kill -0 liveness probe fails
	// (exitCode null models the real port's ENOENT result exactly)
	rig.cli.handler = argv => {
		if (argv.includes('kill') && argv.includes('-0')) {
			return { exitCode: null, spawnError: 'spawn ssh ENOENT' };
		}
		const last = argv[argv.length - 1];
		if (last === `~/.flauz/env-state/${id}/harness.out`) {
			return { stdout: `${JSON.stringify({ type: 'ready', pid: 9911 })}\n` };
		}
		return { exitCode: 0 };
	};
	const second = await rig.executor.start(rig.descriptor, ctx);
	ok(!second.ok, 'an unverifiable previous harness must not be double-started');
	strictEqual(second.error.code, 'CLI_NOT_AVAILABLE');
	ok(second.error.message.includes('unverifiable'), `the verdict names the evidence: ${second.error.message}`);
	strictEqual(rig.cli.calls.filter(call => call.argv.includes('nohup')).length, 1, 'exactly one harness launch happened');
});

test('ssh-cli P2-FIX-110: a spawn-failing kill -0 during the stop grace window never confirms gone — the escalation runs honestly (no fabricated graceful reap)', async () => {
	const rig = await bootSsh();
	const id = rig.descriptor.id;
	await rig.manager.perform('create', { id, actor: 'human' });
	await rig.manager.perform('start', { id, actor: 'human' });
	const window = { open: true }; // the binary is ALREADY gone for kill -0 when the stop begins
	rig.cli.handler = argv => {
		if (argv.includes('kill') && argv.includes('-0')) {
			// exitCode null = the real port's ENOENT shape (never the default-fill 0)
			return window.open ? { exitCode: null, spawnError: 'spawn ssh ENOENT' } : { exitCode: rig.remote.alive ? 0 : 1 };
		}
		if (argv.includes('kill') && argv.includes('-15')) {
			return { exitCode: 0 }; // delivered, but this pid refuses graceful death
		}
		if (argv.includes('kill') && argv.includes('-9')) {
			window.open = false; // the binary returns alongside the escalation
			rig.remote.alive = false;
			rig.remote.status = 'stopped';
			return { exitCode: 0 };
		}
		return { exitCode: 0 };
	};
	const stopped = await rig.manager.perform('stop', { id, actor: 'human' });
	ok(stopped.ok, JSON.stringify(stopped.ok ? '' : stopped.error));
	const stopDetail = stopped.detail?.type === 'stop' ? stopped.detail : undefined;
	strictEqual(stopDetail?.forcedSignal, 'SIGKILL', 'the unconfirmed reap escalates instead of fabricating a SIGTERM confirmation');
	strictEqual(rig.cli.everCalledWith('-9'), true, 'the escalation actually ran');
	strictEqual(rig.manager.stateOf(id), 'stopped');
});
