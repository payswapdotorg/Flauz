/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL3-003 remote-simulated executor drills (3.4): for EACH remote kind
 * (ssh-local / container / cloud-sandbox) — the full happy path AND the
 * failure/recovery paths, over the deterministic file-backed simulated truth
 * (shareable across executor instances for host-restart drills). NO live
 * connections: the connection PLAN stays the artifact for real providers
 * (TL3-004).
 */
import { test } from 'node:test';
import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { EnvironmentRegistry } from '../src/registry.ts';
import { EnvironmentLifecycleManager, mintCancellationPort, type SimFsPort, SimulatedRemoteExecutor } from '../src/lifecycle/index.ts';
import type { EnvironmentKind } from '../src/api.ts';
import { fixedClock, cloudSandboxRegistrationInput, containerRegistrationInput, sshRegistrationInput } from './helpers.ts';

const ROOT = '/ws';

function simMemFs(files: Map<string, string> = new Map()): SimFsPort {
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

interface SimRig {
	kind: EnvironmentKind;
	registration: Record<string, unknown>;
	manager: EnvironmentLifecycleManager;
	executor: SimulatedRemoteExecutor;
	files: Map<string, string>;
}

async function bootSim(kind: EnvironmentKind): Promise<SimRig> {
	const files = new Map<string, string>();
	const fsPort = simMemFs(files);
	const clock = fixedClock();
	const registration = kind === 'ssh-local'
		? sshRegistrationInput({ trust: { posture: 'trusted', inheritsWorkspaceTrust: true } })
		: kind === 'container'
			? containerRegistrationInput()
			: cloudSandboxRegistrationInput({ trust: { posture: 'trusted', inheritsWorkspaceTrust: true } });
	const registry = new EnvironmentRegistry({ root: ROOT, fs: fsPort, clock });
	await registry.bootstrap();
	await registry.register(registration as never);
	const executor = new SimulatedRemoteExecutor({ kind, root: ROOT, fs: fsPort, clock });
	const manager = new EnvironmentLifecycleManager({ registry, root: ROOT, fs: fsPort, clock, executors: [executor] });
	await manager.bootstrap();
	return { kind, registration, manager, executor, files };
}

const REMOTE_KINDS: readonly EnvironmentKind[] = ['ssh-local', 'container', 'cloud-sandbox'];

for (const kind of REMOTE_KINDS) {
	test(`simulated ${kind}: the full happy-path drill (create/start/attach/snapshot/detach/stop/destroy)`, async () => {
		const rig = await bootSim(kind);
		const id = rig.registration.id as string;
		// every op needs the explicit simulated opt-in (honesty law)
		const opts = { id, actor: 'agent', simulated: true };
		const created = await rig.manager.perform('create', opts);
		ok(created.ok, JSON.stringify(created.ok ? '' : created.error));
		const started = await rig.manager.perform('start', opts);
		ok(started.ok);
		strictEqual(started.record.toState, 'running');
		ok(started.detail?.type === 'start' && started.detail.pid < 0, 'simulated pids are deterministic negative markers');
		const report = await rig.manager.describe({ id });
		strictEqual(report.verdict.health, 'healthy');
		strictEqual(report.executorKind, `simulated-${kind}`);
		const attached = await rig.manager.perform('attach', opts);
		ok(attached.ok);
		strictEqual(attached.record.toState, 'running/attached');
		ok(attached.detail?.type === 'attach' && attached.detail.leaseId.startsWith('sim-lease-'));
		const attachedReport = await rig.manager.describe({ id });
		ok(attachedReport.verdict.lease !== undefined, 'the lease is part of the sim truth');
		const snapshotted = await rig.manager.perform('snapshot', opts);
		ok(snapshotted.ok);
		ok(snapshotted.detail?.type === 'snapshot');
		const detached = await rig.manager.perform('detach', opts);
		ok(detached.ok);
		strictEqual(detached.record.toState, 'running');
		const stopped = await rig.manager.perform('stop', opts);
		ok(stopped.ok);
		strictEqual(stopped.record.toState, 'stopped');
		const stoppedReport = await rig.manager.describe({ id });
		strictEqual(stoppedReport.verdict.health, 'not-running');
		const destroyed = await rig.manager.perform('destroy', opts);
		ok(destroyed.ok);
		strictEqual(destroyed.record.toState, 'destroyed');
		// the ledger carries the full drill with provenance
		deepStrictEqual(rig.manager.ops().map(record => record.op), ['create', 'start', 'attach', 'snapshot', 'detach', 'stop', 'destroy']);
		deepStrictEqual(new Set(rig.manager.ops().map(record => record.actor)), new Set(['agent']));
	});

	test(`simulated ${kind}: the failure/recovery drill (cue -> failed -> retry start -> stop -> destroy)`, async () => {
		const rig = await bootSim(kind);
		const id = rig.registration.id as string;
		const opts = { id, actor: 'agent', simulated: true };
		await rig.manager.perform('create', opts);
		// deterministic failure injection on start
		rig.executor.queueFailureCue({ op: 'start', code: 'SIM_REMOTE_UNREACHABLE', message: `simulated ${kind} control plane unreachable` });
		const failed = await rig.manager.perform('start', opts);
		ok(!failed.ok);
		strictEqual(failed.error.code, 'SIM_REMOTE_UNREACHABLE');
		strictEqual(failed.record.toState, 'failed');
		strictEqual(rig.manager.stateOf(id), 'failed');
		// describe on failed: the sim truth is provisioned + not running
		const failedReport = await rig.manager.describe({ id });
		strictEqual(failedReport.verdict.health, 'not-running');
		// recovery: start is legal from failed and the cue is consumed
		const retry = await rig.manager.perform('start', opts);
		ok(retry.ok, JSON.stringify(retry.ok ? '' : retry.error));
		strictEqual(retry.record.fromState, 'failed');
		strictEqual(retry.record.toState, 'running');
		const stop = await rig.manager.perform('stop', opts);
		ok(stop.ok);
		const destroy = await rig.manager.perform('destroy', opts);
		ok(destroy.ok);
	});

	test(`simulated ${kind}: crash reconciliation — the sim truth vanishing surfaces stale, never healthy`, async () => {
		const rig = await bootSim(kind);
		const id = rig.registration.id as string;
		const opts = { id, actor: 'agent', simulated: true };
		await rig.manager.perform('create', opts);
		await rig.manager.perform('start', opts);
		// simulate a hard crash: the backing sim state disappears while the
		// lifecycle still claims running
		await rig.executor.simulateCrash(id);
		const report = await rig.manager.describe({ id });
		strictEqual(report.state, 'running');
		strictEqual(report.verdict.health, 'stale');
		ok(report.verdict.message.includes('crash reconciliation'));
		// explicit reconciliation: stop records it (SIM_STATE_GONE would be an
		// executor error, but stop is state-legal and the sim blank re-records)
		const stopped = await rig.manager.perform('stop', opts);
		ok(stopped.ok, JSON.stringify(stopped.ok ? '' : stopped.error));
		strictEqual(rig.manager.stateOf(id), 'stopped');
	});

	test(`simulated ${kind}: file-backed truth is shareable across instances (host-restart drill)`, async () => {
		const rig = await bootSim(kind);
		const id = rig.registration.id as string;
		const opts = { id, actor: 'agent', simulated: true };
		await rig.manager.perform('create', opts);
		await rig.manager.perform('start', opts);
		// a FRESH executor + manager over the same files (host restart):
		// the second instance sees the same running truth
		const fsPort = simMemFs(rig.files);
		const clock = fixedClock();
		const registry = new EnvironmentRegistry({ root: ROOT, fs: fsPort, clock });
		await registry.bootstrap();
		const executor2 = new SimulatedRemoteExecutor({ kind: rig.kind, root: ROOT, fs: fsPort, clock });
		const manager2 = new EnvironmentLifecycleManager({ registry, root: ROOT, fs: fsPort, clock, executors: [executor2] });
		await manager2.bootstrap();
		strictEqual(manager2.stateOf(id), 'running');
		const report = await manager2.describe({ id });
		strictEqual(report.verdict.health, 'healthy');
		// and the second instance can drive the op sequence (shared truth)
		const stopped = await manager2.perform('stop', { id, actor: 'human', simulated: true });
		ok(stopped.ok);
		strictEqual(manager2.stateOf(id), 'stopped');
	});
}

test('simulated: deterministic latency injection never blocks without opt-in values (default 0)', async () => {
	const files = new Map<string, string>();
	const fsPort = simMemFs(files);
	const clock = fixedClock();
	const registry = new EnvironmentRegistry({ root: ROOT, fs: fsPort, clock });
	await registry.bootstrap();
	await registry.register(sshRegistrationInput({ id: 'env-ssh-lat', trust: { posture: 'trusted', inheritsWorkspaceTrust: true } }) as never);
	// inject real latency: every op delays 5ms; the drill still completes deterministically
	const executor = new SimulatedRemoteExecutor({ kind: 'ssh-local', root: ROOT, fs: fsPort, clock, latencyMs: 5 });
	const manager = new EnvironmentLifecycleManager({ registry, root: ROOT, fs: fsPort, clock, executors: [executor] });
	await manager.bootstrap();
	const opts = { id: 'env-ssh-lat', actor: 'tool', simulated: true };
	for (const op of ['create', 'start', 'stop', 'destroy'] as const) {
		const outcome = await manager.perform(op, opts);
		ok(outcome.ok, `${op}: ${outcome.ok ? '' : JSON.stringify(outcome.error)}`);
	}
});

test('simulated: the executor is TEST INFRASTRUCTURE class and never claims to be real', () => {
	const executor = new SimulatedRemoteExecutor({ kind: 'container', root: ROOT, fs: simMemFs() });
	strictEqual(executor.infrastructureClass, 'simulated');
	strictEqual(executor.executorKind, 'simulated-container');
	// negative pids can never be mistaken for process ids to signal
	const fake = executor.start({ id: 'env-x', kind: 'container', label: 'x', connection: { workspaceFolder: '/w', name: 'n' }, trust: { posture: 'trusted', inheritsWorkspaceTrust: true }, capabilities: { agentHost: true, browser: false, exec: true, terminal: true }, enabled: true, timing: { created: 1, updatedAt: 1 } }, { actor: 'human', now: 1730000000000, cancellation: mintCancellationPort().port });
	void fake.then(effect => {
		ok(effect.ok);
		ok(effect.detail?.type === 'start' && effect.detail.pid < 0);
	});
});
