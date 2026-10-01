/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * P2-FIX-109 (DL-81) — the executor cancellation-port suite.
 *
 * The finding: executor ops had no cancellation ports — with the D1
 * one-mutating-op-per-environment guard, a second op was rejected but the
 * in-flight op itself ALWAYS ran to completion; a "destroy aborts a slow
 * start mid-effect" semantic was impossible. DL-81 lands the cooperative
 * cancellation port + the destroy-supersede law; this suite pins it:
 *
 *   - ACCEPTANCE (both legs of §1): a destroy issued while a slow start is
 *     mid-effect lands a CANCELLED start record AND a terminal `destroyed`
 *     envelope, the ledger recording both honestly in sequence, with NO
 *     orphan child (the spawned child is defensively reaped — asserted by
 *     pid liveness on the REAL leg).
 *       * the simulated leg drives the deterministic port model (the
 *         checkpoint after the injected latency, before the sim save);
 *       * the local-real leg drives the REAL spawn path — a real node child
 *         (the fixed harness with --delay-ready-ms) whose readiness is
 *         genuinely unconfirmed when the destroy arrives.
 *   - REGRESSION GUARDS: the D1 interleaving law holds for every
 *     NON-destroy pair (typed OP_IN_FLIGHT rejections, never interleaved);
 *     a destroy never supersedes a destroy; `cancel` with nothing in flight
 *     is the typed OP_NOT_IN_FLIGHT; the provider-retry window never
 *     retries a cancelled op.
 *   - CHECKPOINT DRILLS (fixture-level, FakeCli): the docker-cli and
 *     ssh-cli pre-spawn / post-spawn-pre-confirm checkpoints + their
 *     defensive reaps (container stop+rm; remote pid kill -15), and the
 *     local-process pre-spawn checkpoint (no child spawned).
 */
import { test } from 'node:test';
import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

import { EnvironmentRegistry } from '../src/registry.ts';
import {
	DockerCliExecutor,
	EnvironmentLifecycleError,
	EnvironmentLifecycleManager,
	LocalProcessExecutor,
	SimulatedRemoteExecutor,
	SshCliExecutor,
	cancelledEffectError,
	mintCancellationPort,
	watchCancellation,
	type ChildHandle,
	type EnvironmentExecutor,
	type EnvironmentOpOutcome,
	type EnvironmentOpRecord,
	type ExecutorOpContext,
	type ExecutorEffectResult,
	type HashPort,
	type LocalEnvFsPort,
	type ProcessPort,
	type RetryWaitPort,
} from '../src/lifecycle/index.ts';
import type { EnvironmentDescriptor, EnvironmentKind, FileSystemPort } from '../src/api.ts';
import { FakeCli } from './fakeCli.ts';
import { FIXED_TS, cloudSandboxRegistrationInput, containerRegistrationInput, fixedClock, sshRegistrationInput, workspaceRemoteRegistrationInput } from './helpers.ts';

const HARNESS_PATH = path.resolve(import.meta.dirname, '..', 'fixtures', 'env-agent.ts');
const CONTAINER_ID = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';
const REMOTE_PID = 4242;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Flushes microtasks/timers until `predicate` holds (bounded — never wedges). */
async function until(predicate: () => boolean): Promise<void> {
	for (let i = 0; i < 1000 && !predicate(); i++) {
		await new Promise<void>(resolve => setTimeout(resolve, 0));
	}
	if (!predicate()) {
		throw new Error('condition not reached (bounded wait expired)');
	}
}

/** The async-predicate variant (real-fs existence checks). */
async function untilAsync(predicate: () => Promise<boolean>): Promise<void> {
	for (let i = 0; i < 1000; i++) {
		if (await predicate()) {
			return;
		}
		await new Promise<void>(resolve => setTimeout(resolve, 2));
	}
	throw new Error('condition not reached (bounded wait expired)');
}

/** Real sleep (the docker/ssh checkpoint drills need a real interleaving window). */
const realSleep: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms));

function memFs(files: Map<string, string>): FileSystemPort {
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
	};
}

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
			files.delete(`${target}.tmp`);
		},
	};
}

function hashPort(): HashPort {
	return { sha256Hex: contents => createHash('sha256').update(contents, 'utf-8').digest('hex') };
}

function opsOf(manager: EnvironmentLifecycleManager, id: string): EnvironmentOpRecord[] {
	return manager.ops().filter(record => record.environmentId === id);
}

// ---------------------------------------------------------------------------
// The compact gated executor (the deterministic port model, TL3-audit style)
// ---------------------------------------------------------------------------

type ProbeOp = 'create' | 'start' | 'stop' | 'attach' | 'detach' | 'snapshot' | 'destroy';

/**
 * A gateable executor: an armed gate blocks the op MID-EFFECT while the
 * cooperative cancellation port is observed (DL-81's deterministic port
 * model) — a minted cancel returns the typed OP_CANCELLED effect instead of
 * completing; a released gate completes honestly.
 */
function gatedExecutor(kinds: readonly EnvironmentKind[]): { executor: EnvironmentExecutor; controls: { gate(op: ProbeOp): void; release(op: ProbeOp): void; readonly calls: readonly string[] } } {
	const calls: string[] = [];
	const gates = new Map<ProbeOp, { promise: Promise<void>; resolve(): void }>();
	const controls = {
		gate: (op: ProbeOp) => {
			let resolve!: () => void;
			const promise = new Promise<void>(resolveImpl => {
				resolve = resolveImpl;
			});
			gates.set(op, { promise, resolve });
		},
		release: (op: ProbeOp) => {
			gates.get(op)?.resolve();
			gates.delete(op);
		},
		calls,
	};
	async function run(op: ProbeOp, ctx: ExecutorOpContext, detail: () => Record<string, unknown>): Promise<ExecutorEffectResult> {
		calls.push(op);
		const gate = gates.get(op);
		if (gate !== undefined) {
			const watch = watchCancellation(ctx.cancellation);
			const winner = await Promise.race([
				gate.promise.then(() => ({ kind: 'gate' as const })),
				watch.promise.then(() => ({ kind: 'cancelled' as const })),
			]);
			watch.dispose();
			if (winner.kind === 'cancelled') {
				return { ok: false, error: cancelledEffectError(ctx.cancellation, 'pre-spawn', 'the gated effect never ran (observed the cooperative cancellation mid-effect)') };
			}
		}
		return { ok: true, detail: detail() as never };
	}
	const executor: EnvironmentExecutor = {
		executorKind: 'p2fix109-gated',
		infrastructureClass: 'real',
		kinds,
		create: (descriptor, ctx) => run('create', ctx, () => ({ type: 'create', stateDir: '/gated' })),
		start: (descriptor, ctx) => run('start', ctx, () => ({ type: 'start', pid: REMOTE_PID })),
		stop: (descriptor, ctx) => run('stop', ctx, () => ({ type: 'stop', pid: REMOTE_PID, forcedSignal: 'SIGTERM' })),
		attach: (descriptor, ctx) => run('attach', ctx, () => ({ type: 'attach', leaseId: `lease-${descriptor.id}-1`, heldSince: ctx.now })),
		detach: (descriptor, ctx) => run('detach', ctx, () => ({ type: 'detach', leaseId: `lease-${descriptor.id}-1` })),
		snapshot: (descriptor, ctx) => run('snapshot', ctx, () => ({ type: 'snapshot', snapshotDir: '/gated/snap', fileCount: 1, manifestPath: '/gated/snap/manifest.json' })),
		destroy: (descriptor, ctx) => run('destroy', ctx, () => ({ type: 'destroy', pid: null })),
		probe: async () => ({ health: 'healthy', state: 'running', pid: REMOTE_PID, message: 'gated executor probe' }),
	};
	return { executor, controls };
}

/** Boots a registry + manager over the mem fs with the given executor + registration. */
async function bootRig(options: { executor: EnvironmentExecutor; registration: Record<string, unknown> }): Promise<{ manager: EnvironmentLifecycleManager; files: Map<string, string> }> {
	const files = new Map<string, string>();
	const fsPort = memFs(files);
	const clock = fixedClock();
	const registry = new EnvironmentRegistry({ root: '/ws-p2fix109', fs: fsPort, clock });
	await registry.bootstrap();
	await registry.register(options.registration as never);
	const manager = new EnvironmentLifecycleManager({ registry, root: '/ws-p2fix109', fs: fsPort, clock, executors: [options.executor] });
	await manager.bootstrap();
	return { manager, files };
}

// ---------------------------------------------------------------------------
// ACCEPTANCE — §1: a destroy issued while a slow start is mid-effect
// ---------------------------------------------------------------------------

test('P2-FIX-109 acceptance (simulated, deterministic): destroy issued while a slow start is mid-effect lands a cancelled start record + a terminal destroyed envelope — the ledger records both honestly, the sim truth is never fabricated running', async () => {
	const files = new Map<string, string>();
	const fsPort = memFs(files);
	const clock = fixedClock();
	const registration = sshRegistrationInput({ id: 'env-p2fix109-sim', trust: { posture: 'trusted', inheritsWorkspaceTrust: true } });
	const registry = new EnvironmentRegistry({ root: '/ws-p2fix109-sim', fs: fsPort, clock });
	await registry.bootstrap();
	await registry.register(registration as never);
	// the deterministic port model: the pre-spawn checkpoint sits AFTER the
	// injected latency and BEFORE the sim save — a 150 ms slow start
	const executor = new SimulatedRemoteExecutor({ kind: 'ssh-local', root: '/ws-p2fix109-sim', fs: { ...fsPort, rm: async target => { files.delete(target); } }, clock, latencyMs: 150 });
	const manager = new EnvironmentLifecycleManager({ registry, root: '/ws-p2fix109-sim', fs: fsPort, clock, executors: [executor] });
	await manager.bootstrap();
	const id = 'env-p2fix109-sim';
	const opts = { id, actor: 'human' as const, simulated: true };
	ok((await manager.perform('create', opts)).ok);
	// the slow start goes in flight (mid-latency, pre-save)
	const startP: Promise<EnvironmentOpOutcome> = manager.perform('start', opts);
	await new Promise<void>(resolve => setTimeout(resolve, 40)); // inside the 150 ms effect window
	// the destroy arrives MID-EFFECT: DL-81 destroy-supersede
	const destroyP = manager.perform('destroy', { id, actor: 'agent', simulated: true });
	const startOutcome = await startP;
	ok(!startOutcome.ok, 'the cancelled start resolves through the error arm (the two-armed envelope is unchanged)');
	strictEqual(startOutcome.error.code, 'OP_CANCELLED', 'the typed OP_CANCELLED error');
	strictEqual(startOutcome.record.result, 'cancelled', 'the ledger records the attempt as cancelled (distinct from error)');
	strictEqual(startOutcome.record.op, 'start');
	strictEqual(startOutcome.record.actor, 'human', 'the attempt row keeps its issuing provenance');
	strictEqual(startOutcome.record.toState, 'failed', 'the cancelled start settles through the EXISTING failure-state law (never fabricated completion, never a silent healthy state)');
	ok(startOutcome.record.error?.message.includes("cancelled at checkpoint 'pre-spawn'"), 'the checkpoint is named');
	ok(startOutcome.record.error?.message.includes("by actor 'agent' (destroy-supersede)"), 'the cancelling actor provenance + the destroy-supersede reason ride the typed error');
	const destroyOutcome = await destroyP;
	ok(destroyOutcome.ok, 'the destroy proceeds as the terminal op');
	strictEqual(destroyOutcome.record.fromState, 'failed');
	strictEqual(destroyOutcome.record.toState, 'destroyed');
	strictEqual(manager.stateOf(id), 'destroyed', 'the terminal destroyed envelope');
	// the ledger records BOTH attempts honestly in sequence
	deepStrictEqual(opsOf(manager, id).map(record => [record.op, record.result, record.toState]), [
		['create', 'ok', 'created'],
		['start', 'cancelled', 'failed'],
		['destroy', 'ok', 'destroyed'],
	]);
	// the sim truth was never mutated to running (no fabricated running state)
	const simState = JSON.parse(files.get(`/ws-p2fix109-sim/.flauz/env-sim/${id}.json`) ?? 'null') as { running?: boolean } | null;
	ok(simState === null || simState.running === false, 'the cancelled start never saved a running sim truth');
});

test('P2-FIX-109 acceptance (local-real): destroy issued while a REAL slow start is mid-effect (a real node child, readiness unconfirmed) lands a cancelled start + a terminal destroyed envelope — the spawned child is defensively reaped, NO orphan child', async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flauz-p2fix109-'));
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
	let launches = 0;
	const processPort: ProcessPort = {
		launchNodeProcess: (scriptPath, args, options) => {
			launches += 1;
			const env: Record<string, string | undefined> = { ...process.env, ...(options?.env ?? {}) };
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
	const isPidAlive = (pid: number): boolean => {
		try {
			process.kill(pid, 0);
			return true;
		} catch {
			return false;
		}
	};
	try {
		const clock = fixedClock();
		const registry = new EnvironmentRegistry({ root, fs: localFs, clock });
		await registry.bootstrap();
		await registry.register(workspaceRemoteRegistrationInput({ id: 'env-p2fix109-local' }) as never);
		// the REAL slow start: the fixed harness delays its ready line 400 ms
		// (state file written + signal handlers armed, readiness pending)
		const executor = new LocalProcessExecutor({
			root,
			fs: localFs,
			process: processPort,
			hash: hashPort(),
			clock,
			harnessPath: HARNESS_PATH,
			heartbeatMs: 100,
			readyDelayMs: 400,
		});
		const manager = new EnvironmentLifecycleManager({ registry, root, fs: localFs, clock, executors: [executor] });
		await manager.bootstrap();
		const id = 'env-p2fix109-local';
		ok((await manager.perform('create', { id, actor: 'human' })).ok);
		const startP: Promise<EnvironmentOpOutcome> = manager.perform('start', { id, actor: 'human' });
		// mid-effect marker: the real child wrote its state file but has NOT
		// readied (the 400 ms delay) — genuinely mid-effect
		const stateFile = path.join(root, '.flauz', 'env-state', id, 'state.json');
		await untilAsync(async () => {
			try {
				await fs.access(stateFile);
				return true;
			} catch {
				return false;
			}
		});
		const destroyP = manager.perform('destroy', { id, actor: 'agent' });
		const startOutcome = await startP;
		ok(!startOutcome.ok, 'the cancelled start resolves through the error arm');
		strictEqual(startOutcome.error.code, 'OP_CANCELLED', 'the typed OP_CANCELLED error');
		strictEqual(startOutcome.record.result, 'cancelled', 'the ledger records the attempt as cancelled (distinct from error)');
		strictEqual(startOutcome.record.toState, 'failed', 'settled through the existing failure-state law — never a silent healthy running state');
		// the partial-effect facts NAME the real spawned child
		const pidMatch = /child pid (\d+) spawned/.exec(startOutcome.record.error?.message ?? '');
		ok(pidMatch !== null, `the partial-effect facts name the spawned child (${startOutcome.record.error?.message})`);
		const pid = pidMatch === null ? -1 : Number.parseInt(pidMatch[1]!, 10);
		strictEqual(launches, 1, 'exactly one real child was spawned');
		// THE no-orphan-child assertion: the defensive reap killed the real child
		ok(!isPidAlive(pid), `the unconfirmed child (pid ${pid}) was defensively reaped — no orphan child`);
		const destroyOutcome = await destroyP;
		ok(destroyOutcome.ok, 'the destroy proceeds as the terminal op');
		strictEqual(destroyOutcome.record.toState, 'destroyed');
		strictEqual(manager.stateOf(id), 'destroyed', 'the terminal destroyed envelope');
		deepStrictEqual(opsOf(manager, id).map(record => [record.op, record.result, record.toState]), [
			['create', 'ok', 'created'],
			['start', 'cancelled', 'failed'],
			['destroy', 'ok', 'destroyed'],
		]);
		// the destroy removed the state dir (terminal teardown)
		await rejects(() => fs.access(path.join(root, '.flauz', 'env-state', id)));
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// REGRESSION GUARDS — the D1 interleaving law holds for every non-destroy pair
// ---------------------------------------------------------------------------

test('P2-FIX-109 regression (D1 law): a START issued while a stop is in flight is still the typed OP_IN_FLIGHT rejection (non-destroy pairs never interleave)', async () => {
	const { executor, controls } = gatedExecutor(['workspace-remote']);
	const rig = await bootRig({ executor, registration: workspaceRemoteRegistrationInput({ id: 'env-p2fix109-d1a' }) });
	const id = 'env-p2fix109-d1a';
	await rig.manager.perform('create', { id, actor: 'human' });
	await rig.manager.perform('start', { id, actor: 'human' });
	controls.gate('stop');
	const stopP = rig.manager.perform('stop', { id, actor: 'human' });
	await until(() => controls.calls.includes('stop'));
	const startP = rig.manager.perform('start', { id, actor: 'human' });
	await rejects(() => startP, (err: unknown) => {
		ok(err instanceof EnvironmentLifecycleError);
		strictEqual((err as EnvironmentLifecycleError).code, 'OP_IN_FLIGHT', 'the D1 interleaving law is unchanged for non-destroy pairs');
		return true;
	});
	strictEqual(controls.calls.filter(call => call === 'start').length, 1, 'the rejected start never reached the executor (only the earlier happy-path start did)');
	controls.release('stop');
	ok((await stopP).ok, 'the in-flight stop completes honestly');
	strictEqual(rig.manager.stateOf(id), 'stopped');
});

test('P2-FIX-109 regression (D1 law): a SNAPSHOT issued while a start is in flight is still the typed OP_IN_FLIGHT rejection', async () => {
	const { executor, controls } = gatedExecutor(['workspace-remote']);
	const rig = await bootRig({ executor, registration: workspaceRemoteRegistrationInput({ id: 'env-p2fix109-d1b' }) });
	const id = 'env-p2fix109-d1b';
	await rig.manager.perform('create', { id, actor: 'human' });
	controls.gate('start');
	const startP = rig.manager.perform('start', { id, actor: 'human' });
	await until(() => controls.calls.includes('start'));
	const snapshotP = rig.manager.perform('snapshot', { id, actor: 'human' });
	await rejects(() => snapshotP, (err: unknown) => (err instanceof EnvironmentLifecycleError) && (err as EnvironmentLifecycleError).code === 'OP_IN_FLIGHT');
	strictEqual(controls.calls.includes('snapshot'), false);
	controls.release('start');
	ok((await startP).ok);
	strictEqual(rig.manager.stateOf(id), 'running');
});

test('P2-FIX-109 regression (D1 law): a DESTROY issued while a destroy is in flight is still the typed OP_IN_FLIGHT rejection (the terminal op is never superseded)', async () => {
	const { executor, controls } = gatedExecutor(['workspace-remote']);
	const rig = await bootRig({ executor, registration: workspaceRemoteRegistrationInput({ id: 'env-p2fix109-d1c' }) });
	const id = 'env-p2fix109-d1c';
	await rig.manager.perform('create', { id, actor: 'human' });
	await rig.manager.perform('start', { id, actor: 'human' });
	await rig.manager.perform('stop', { id, actor: 'human' });
	controls.gate('destroy');
	const destroyP = rig.manager.perform('destroy', { id, actor: 'human' });
	await until(() => controls.calls.includes('destroy'));
	const destroy2P = rig.manager.perform('destroy', { id, actor: 'human' });
	await rejects(() => destroy2P, (err: unknown) => (err instanceof EnvironmentLifecycleError) && (err as EnvironmentLifecycleError).code === 'OP_IN_FLIGHT');
	strictEqual(rig.manager.ops().filter(record => record.environmentId === id && record.op === 'destroy').length, 0, 'the rejected destroy recorded nothing');
	controls.release('destroy');
	ok((await destroyP).ok);
	strictEqual(rig.manager.stateOf(id), 'destroyed');
});

// ---------------------------------------------------------------------------
// The cancel(id, actor) API
// ---------------------------------------------------------------------------

test('P2-FIX-109: cancel(id, actor) with nothing in flight is the typed OP_NOT_IN_FLIGHT rejection; provenance is mandatory exactly as on accepted attempts', async () => {
	const { executor } = gatedExecutor(['workspace-remote']);
	const rig = await bootRig({ executor, registration: workspaceRemoteRegistrationInput({ id: 'env-p2fix109-api' }) });
	const id = 'env-p2fix109-api';
	await rig.manager.perform('create', { id, actor: 'human' });
	await rejects(() => rig.manager.cancel({ id, actor: 'human' }), (err: unknown) => {
		ok(err instanceof EnvironmentLifecycleError);
		strictEqual((err as EnvironmentLifecycleError).code, 'OP_NOT_IN_FLIGHT', 'typed OP_NOT_IN_FLIGHT when nothing is in flight');
		return true;
	});
	await rejects(() => rig.manager.cancel({ id }), (err: unknown) => {
		ok(err instanceof EnvironmentLifecycleError);
		strictEqual((err as EnvironmentLifecycleError).code, 'ACTOR_REQUIRED', 'provenance is mandatory on the cancel');
		return true;
	});
	await rejects(() => rig.manager.cancel({ id: 'env-not-registered', actor: 'human' }), (err: unknown) => {
		ok(err instanceof EnvironmentLifecycleError);
		strictEqual((err as EnvironmentLifecycleError).code, 'ENVIRONMENT_UNKNOWN');
		return true;
	});
});

test('P2-FIX-109: a standalone cancel of an in-flight start lands the cancelled record, settles `failed`, and recovery is a legal re-start (the existing machine law)', async () => {
	const { executor, controls } = gatedExecutor(['workspace-remote']);
	const rig = await bootRig({ executor, registration: workspaceRemoteRegistrationInput({ id: 'env-p2fix109-cancel' }) });
	const id = 'env-p2fix109-cancel';
	await rig.manager.perform('create', { id, actor: 'human' });
	controls.gate('start');
	const startP: Promise<EnvironmentOpOutcome> = rig.manager.perform('start', { id, actor: 'human' });
	await until(() => controls.calls.includes('start'));
	const cancelP: Promise<EnvironmentOpOutcome> = rig.manager.cancel({ id, actor: 'tool' });
	const startOutcome = await startP;
	ok(!startOutcome.ok);
	strictEqual(startOutcome.error.code, 'OP_CANCELLED');
	strictEqual(startOutcome.record.result, 'cancelled');
	const cancelOutcome = await cancelP;
	strictEqual(cancelOutcome.record.result, 'cancelled', 'the cancel resolves to the attempt\'s own cancelled outcome');
	ok(cancelOutcome.record.error?.message.includes("by actor 'tool' (cancel)"), 'the explicit-cancel reason is recorded');
	strictEqual(rig.manager.stateOf(id), 'failed', 'the envelope settles through the failure-state law (never silently healthy)');
	// the consumed gate is released (it stays armed in the map after the race)
	controls.release('start');
	// recovery: start is legal from failed (the existing machine law)
	const recovered = await rig.manager.perform('start', { id, actor: 'human' });
	ok(recovered.ok, 'a cancelled start recovers through the ordinary failed-state restart path');
	strictEqual(rig.manager.stateOf(id), 'running');
	await rig.manager.perform('stop', { id, actor: 'human' });
	ok((await rig.manager.perform('destroy', { id, actor: 'human' })).ok);
});

// ---------------------------------------------------------------------------
// The provider-retry window never retries a cancelled op
// ---------------------------------------------------------------------------

class ScriptedRetryExecutor implements EnvironmentExecutor {
	readonly executorKind = 'p2fix109-scripted-cloud';
	readonly infrastructureClass = 'real' as const;
	readonly kinds = ['cloud-sandbox'] as const;
	readonly calls: string[] = [];

	async create(): Promise<ExecutorEffectResult> {
		return { ok: true };
	}

	async start(): Promise<ExecutorEffectResult> {
		this.calls.push('start');
		return { ok: false, error: { code: 'CLOUD_PROVIDER_ERROR', message: 'cloud-sandbox POST /v0/sandboxes/sbx-1/start failed (HTTP 500): {"error":"provider exploded"}', providerRetryHint: { status: 500 } } };
	}

	async stop(): Promise<ExecutorEffectResult> {
		return { ok: true };
	}

	async attach(): Promise<ExecutorEffectResult> {
		return { ok: true };
	}

	async detach(): Promise<ExecutorEffectResult> {
		return { ok: true };
	}

	async snapshot(): Promise<ExecutorEffectResult> {
		return { ok: true };
	}

	async destroy(): Promise<ExecutorEffectResult> {
		return { ok: true };
	}

	async probe(): Promise<never> {
		throw new Error('not used');
	}
}

test('P2-FIX-109: the provider-retry window NEVER retries a cancelled op — a cancel minted during the inter-attempt wait is observed at the between-rounds checkpoint', async () => {
	const executor = new ScriptedRetryExecutor();
	const files = new Map<string, string>();
	const fsPort = memFs(files);
	const clock = fixedClock();
	const registration = cloudSandboxRegistrationInput({ id: 'env-p2fix109-retry', trust: { posture: 'trusted', inheritsWorkspaceTrust: true } });
	const registry = new EnvironmentRegistry({ root: '/ws-p2fix109-retry', fs: fsPort, clock });
	await registry.bootstrap();
	await registry.register(registration as never);
	const waits: number[] = [];
	const manager = new EnvironmentLifecycleManager({
		registry,
		root: '/ws-p2fix109-retry',
		fs: fsPort,
		clock,
		executors: [executor],
		providerRetry: { maxAttempts: 3 },
		// the wait port mints the cancellation DURING the inter-attempt wait
		// (the manager is mid-attempt — the port is minted and observable)
		providerRetryWait: (async ms => {
			waits.push(ms);
			manager.cancel({ id: 'env-p2fix109-retry', actor: 'human' }).catch(() => undefined);
		}) satisfies RetryWaitPort,
	});
	await manager.bootstrap();
	const id = 'env-p2fix109-retry';
	ok((await manager.perform('create', { id, actor: 'human' })).ok, 'the journey starts from created');
	const outcome = await manager.perform('start', { id, actor: 'human' });
	strictEqual(executor.calls.length, 1, 'the executor was consulted exactly ONCE — the window never re-issued the cancelled op');
	strictEqual(waits.length, 1, 'exactly one inter-attempt wait ran (the cancel was minted inside it)');
	ok(!outcome.ok, 'the cancelled start resolves through the error arm');
	strictEqual(outcome.error.code, 'OP_CANCELLED', 'the typed cancellation outcome (not the provider error, not exhaustion)');
	strictEqual(outcome.record.result, 'cancelled', 'the ledger records the attempt as cancelled');
	strictEqual(outcome.record.toState, 'failed');
	ok(outcome.record.error?.message.includes("checkpoint 'provider-retry-window'"), 'the between-rounds checkpoint is named');
	// the ledger: the create row, one engaged attempt row (the 500) + the request-level cancelled row
	const rows = opsOf(manager, id);
	deepStrictEqual(rows.map(record => [record.op, record.result]), [['create', 'ok'], ['start', 'error'], ['start', 'cancelled']]);
});

// ---------------------------------------------------------------------------
// CHECKPOINT DRILLS — docker-cli / ssh-cli / local-process (fixture level)
// ---------------------------------------------------------------------------

test('P2-FIX-109 (docker-cli drill): a pre-armed cancel returns the typed OP_CANCELLED at the PRE-SPAWN checkpoint (no container launched)', async () => {
	const files = new Map<string, string>([[HARNESS_PATH, await fs.readFile(HARNESS_PATH, { encoding: 'utf-8' })]]);
	const cli = new FakeCli();
	const executor = new DockerCliExecutor({ root: '/ws-p2fix109-docker', cli, fs: memLocalFs(files), hash: hashPort(), clock: () => Date.now(), latency: realSleep, harnessPath: HARNESS_PATH, startTimeoutMs: 2000, pollIntervalMs: 10 });
	const descriptor: EnvironmentDescriptor = {
		id: 'env-p2fix109-docker',
		kind: 'container',
		label: 'Drill',
		connection: { workspaceFolder: '/workspace', name: 'p2fix109-container' },
		trust: { posture: 'trusted', inheritsWorkspaceTrust: true },
		capabilities: { agentHost: true, browser: false, exec: true, terminal: true },
		enabled: true,
		timing: { created: FIXED_TS, updatedAt: FIXED_TS },
	};
	const mint = mintCancellationPort();
	mint.cancel('human', 'cancel');
	const result = await executor.start(descriptor, { actor: 'human', now: FIXED_TS, cancellation: mint.port });
	ok(!result.ok);
	strictEqual(result.error.code, 'OP_CANCELLED');
	ok(result.error.message.includes("checkpoint 'pre-spawn'"), 'the pre-spawn checkpoint is named');
	ok(result.error.message.includes('no container launched'), 'the partial-effect facts are honest');
	strictEqual(cli.everCalledWith('run'), false, 'no docker run was ever issued');
});

test('P2-FIX-109 (docker-cli drill): a cancel observed at the PRE-CONFIRM checkpoint defensively stops+removes the launched container BEFORE returning OP_CANCELLED (no orphan container)', async () => {
	const files = new Map<string, string>([[HARNESS_PATH, await fs.readFile(HARNESS_PATH, { encoding: 'utf-8' })]]);
	const cli = new FakeCli();
	const model = { containerExists: false, containerRunning: false };
	cli.handler = argv => {
		const name = 'flauz-env-p2fix109-docker';
		if (argv.includes('info')) {
			return { exitCode: 0, stdout: 'Server Version: 27.x' };
		}
		if (argv.includes('inspect')) {
			return model.containerExists ? { exitCode: 0, stdout: JSON.stringify([{ Id: CONTAINER_ID, State: { Running: model.containerRunning, Status: 'running' } }]) } : { exitCode: 1, stderr: 'no such object' };
		}
		if (argv.includes('run')) {
			model.containerExists = true;
			model.containerRunning = true;
			return { exitCode: 0, stdout: `${CONTAINER_ID}\n` };
		}
		if (argv.includes('stop')) {
			model.containerRunning = false;
			return { exitCode: 0 };
		}
		if (argv.includes('rm')) {
			model.containerExists = false;
			return { exitCode: 0 };
		}
		// the harness log never reports ready during the drill (the slow start)
		if (argv.includes('exec') && argv.includes('cat')) {
			return { exitCode: 0, stdout: '' };
		}
		return { exitCode: 0 };
	};
	const executor = new DockerCliExecutor({ root: '/ws-p2fix109-docker', cli, fs: memLocalFs(files), hash: hashPort(), clock: () => Date.now(), latency: realSleep, harnessPath: HARNESS_PATH, startTimeoutMs: 2000, pollIntervalMs: 10 });
	const descriptor: EnvironmentDescriptor = {
		id: 'env-p2fix109-docker',
		kind: 'container',
		label: 'Drill',
		connection: { workspaceFolder: '/workspace', name: 'p2fix109-container' },
		trust: { posture: 'trusted', inheritsWorkspaceTrust: true },
		capabilities: { agentHost: true, browser: false, exec: true, terminal: true },
		enabled: true,
		timing: { created: FIXED_TS, updatedAt: FIXED_TS },
	};
	const mint = mintCancellationPort();
	const startP = executor.start(descriptor, { actor: 'human', now: FIXED_TS, cancellation: mint.port });
	await until(() => cli.everCalledWith('run')); // the container IS launched (post-spawn)
	mint.cancel('agent', 'cancel'); // mid-readiness — the pre-confirm checkpoint
	const result = await startP;
	ok(!result.ok);
	strictEqual(result.error.code, 'OP_CANCELLED', 'the typed OP_CANCELLED effect');
	ok(result.error.message.includes("checkpoint 'pre-confirm'"), 'the post-spawn/pre-confirm checkpoint is named');
	ok(result.error.message.includes(CONTAINER_ID.slice(0, 12)), 'the partial-effect facts name the launched container');
	ok(cli.everCalledWith('stop') && cli.everCalledWith('rm'), 'the defensive reap stopped AND removed the container');
	strictEqual(model.containerExists, false, 'no orphan container remains');
});

test('P2-FIX-109 (ssh-cli drill): a cancel observed at the PRE-CONFIRM checkpoint defensively terminates the named remote harness pid BEFORE returning OP_CANCELLED (no orphan remote child)', async () => {
	const files = new Map<string, string>([[HARNESS_PATH, await fs.readFile(HARNESS_PATH, { encoding: 'utf-8' })]]);
	const cli = new FakeCli();
	const remote = { alive: true };
	const id = 'env-p2fix109-ssh';
	cli.handler = argv => {
		const last = argv[argv.length - 1];
		if (argv.includes('kill') && argv.includes('-0')) {
			return { exitCode: remote.alive ? 0 : 1 };
		}
		if (argv.includes('kill') && argv.includes('-15')) {
			remote.alive = false; // the graceful protocol worked
			return { exitCode: 0 };
		}
		if (argv.includes('kill') && argv.includes('-9')) {
			remote.alive = false;
			return { exitCode: 0 };
		}
		if (argv.includes('true')) {
			return { exitCode: 0 };
		}
		// the remote harness log never reports ready during the drill (the slow start)
		if (last === `~/.flauz/env-state/${id}/harness.out`) {
			return { exitCode: 0, stdout: '' };
		}
		// the remote state file names the pid (the harness writes it BEFORE ready)
		if (last === `~/.flauz/env-state/${id}/state.json`) {
			return { exitCode: 0, stdout: `${JSON.stringify({ beat: 0, environmentId: id, pid: REMOTE_PID, schema: 'flauz.env-state/v0', schemaVersion: 0, startedAt: FIXED_TS, status: 'running' }, null, 2)}\n` };
		}
		return { exitCode: 0 };
	};
	const executor = new SshCliExecutor({ root: '/ws-p2fix109-ssh', cli, fs: memLocalFs(files), hash: hashPort(), clock: () => Date.now(), latency: realSleep, harnessPath: HARNESS_PATH, startTimeoutMs: 2000, pollIntervalMs: 10, stopTimeoutMs: 500 });
	const descriptor: EnvironmentDescriptor = {
		id,
		kind: 'ssh-local',
		label: 'Drill',
		connection: { host: 'drill.example.internal', authMethod: 'key' },
		trust: { posture: 'trusted', inheritsWorkspaceTrust: true },
		capabilities: { agentHost: true, browser: false, exec: true, terminal: true },
		enabled: true,
		timing: { created: FIXED_TS, updatedAt: FIXED_TS },
	};
	const mint = mintCancellationPort();
	const startP = executor.start(descriptor, { actor: 'human', now: FIXED_TS, cancellation: mint.port });
	await until(() => cli.calls.some(call => call.argv.includes('nohup'))); // the remote harness IS launched (post-spawn)
	mint.cancel('agent', 'cancel'); // mid-readiness — the pre-confirm checkpoint
	const result = await startP;
	ok(!result.ok);
	strictEqual(result.error.code, 'OP_CANCELLED', 'the typed OP_CANCELLED effect');
	ok(result.error.message.includes("checkpoint 'pre-confirm'"), 'the post-spawn/pre-confirm checkpoint is named');
	ok(result.error.message.includes(`pid ${REMOTE_PID}`), 'the partial-effect facts name the remote harness pid');
	ok(cli.calls.some(call => call.argv.includes('kill') && call.argv.includes('-15')), 'the defensive reap terminated the named remote pid (graceful signal)');
	strictEqual(remote.alive, false, 'no orphan remote child remains');
});

test('P2-FIX-109 (local-process drill): a pre-armed cancel returns the typed OP_CANCELLED at the PRE-SPAWN checkpoint — no child is ever spawned', async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flauz-p2fix109-pre-'));
	const localFs: LocalEnvFsPort = {
		readFileUtf8: async () => undefined,
		writeFile: async () => undefined,
		rename: async () => undefined,
		mkdir: async () => undefined,
		readdir: async () => [],
		rm: async () => undefined,
	};
	let launches = 0;
	const processPort: ProcessPort = {
		launchNodeProcess: () => {
			launches += 1;
			throw new Error('the drill must never spawn');
		},
		isPidAlive: () => false,
	};
	try {
		const executor = new LocalProcessExecutor({ root, fs: localFs, process: processPort, hash: hashPort(), clock: fixedClock(), harnessPath: HARNESS_PATH });
		const descriptor: EnvironmentDescriptor = {
			id: 'env-p2fix109-pre',
			kind: 'workspace-remote',
			label: 'Drill',
			connection: { authorityPrefix: 'flauz-local' },
			trust: { posture: 'trusted', inheritsWorkspaceTrust: true },
			capabilities: { agentHost: true, browser: true, exec: true, terminal: true },
			enabled: true,
			timing: { created: FIXED_TS, updatedAt: FIXED_TS },
		};
		const mint = mintCancellationPort();
		mint.cancel('human', 'cancel');
		const result = await executor.start(descriptor, { actor: 'human', now: FIXED_TS, cancellation: mint.port });
		ok(!result.ok);
		strictEqual(result.error.code, 'OP_CANCELLED');
		ok(result.error.message.includes("checkpoint 'pre-spawn'"), 'the pre-spawn checkpoint is named');
		ok(result.error.message.includes('no child spawned'), 'the partial-effect facts are honest');
		strictEqual(launches, 0, 'no child was ever spawned');
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});
