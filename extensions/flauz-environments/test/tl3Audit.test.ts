/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL3-PB product-readiness audit probes (Worker B — environments lane).
 *
 * Journey-shaped probes for the P2-002/P2-003 acceptance phase, one group per
 * audit checklist item. The suites that already pin a surface (lifecycle /
 * localProcess / sshCli / dockerCli / cloudHttp / simulated / resolver /
 * resolverAuthority / fixtures-*) are cited in the findings table; the probes
 * here either drive the JOURNEY shape (the full lifecycle through the manager
 * with REAL processes), pin fail-closed behavior the acceptance phase would
 * hit, or serve as regression tests for defects confirmed during the audit:
 *
 *   - destroy/op interleavings on one environment (fail-closed, no
 *     resurrection of a destroyed envelope, no impossible ledger sequence);
 *   - torn-write recovery (a ledger line beyond an entry's lastOpRef —
 *     the crash window inside commit() — reconciles to the ledger's truth);
 *   - teardown honesty (a vanished binary mid-destroy never fabricates
 *     success — typed CLI_NOT_AVAILABLE instead);
 *   - the resolver core's typed boundary (an unreadable registry/PIN-2
 *     source maps to typed failures — never a raw throw).
 *
 * Zero real binaries: FakeCli/mem-fs/ports everywhere except the two REAL
 * process drills (items 1 + 8), which spawn the fixed fixtures/env-agent.ts
 * harness under this node and reap it in-finally.
 */
import { test } from 'node:test';
import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

import { canonicalJson, type EnvironmentDescriptor, type EnvironmentKind } from '../src/api.ts';
import { EnvironmentRegistry } from '../src/registry.ts';
import {
        CloudHttpExecutor,
        DockerCliExecutor,
        EnvironmentLifecycleError,
        EnvironmentLifecycleManager,
        LocalProcessExecutor,
        SshCliExecutor,
        type ChildHandle,
        type EnvironmentExecutor,
        type EnvironmentOpOutcome,
        type EnvironmentOpRecord,
        type ExecutorOpContext,
        type HashPort,
        type LocalEnvFsPort,
        cancelledEffectError,
        mintCancellationPort,
        type ProcessPort,
        watchCancellation,
        LIFECYCLE_PATH,
        OPS_PATH,
} from '../src/lifecycle/index.ts';
import { serializeOpRecord } from '../src/lifecycle/store.ts';
import type { HttpPort, SecretResolverPort } from '../src/lifecycle/cloudHttp.ts';
import { FlauzEnvResolver, formatFlauzEnvAuthority, type FlauzEnvResolverOptions } from '../src/resolver/index.ts';
import { FakeCli } from './fakeCli.ts';
import {
        FIXED_TS,
        cloudSandboxRegistrationInput,
        containerRegistrationInput,
        fixedClock,
        sshRegistrationInput,
        virtualTime,
        workspaceRemoteRegistrationInput,
} from './helpers.ts';

const ROOT = '/flauz-tl3-audit-root';
const HARNESS_PATH = path.resolve(import.meta.dirname, '..', 'fixtures', 'env-agent.ts');
const REMOTE_PID = 424242;

// ---------------------------------------------------------------------------
// Shared probe infrastructure
// ---------------------------------------------------------------------------

function deferred(): { promise: Promise<void>; resolve(): void } {
        let resolve!: () => void;
        const promise = new Promise<void>(resolveImpl => {
                resolve = resolveImpl;
        });
        return { promise, resolve };
}

/** Flushes microtasks/timers until `predicate` holds (bounded — never wedges). */
async function until(predicate: () => boolean): Promise<void> {
        for (let i = 0; i < 500 && !predicate(); i++) {
                await new Promise<void>(resolve => setTimeout(resolve, 0));
        }
        if (!predicate()) {
                throw new Error('probe condition not reached (bounded wait expired)');
        }
}

/** A Map-backed LocalEnvFsPort (mem-fs; paths are opaque keys). */
function memLocalFs(files: Map<string, string>): LocalEnvFsPort {
        return {
                readFileUtf8: async target => files.get(target),
                writeFile: async (target, contents) => {
                        files.set(target, contents);
                },
                rename: async (from, to) => {
                        if (!files.has(from)) {
                                throw Object.assign(new Error(`ENOENT: ${from}`), { code: 'ENOENT' });
                        }
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

type ProbeOp = 'create' | 'start' | 'stop' | 'attach' | 'detach' | 'snapshot' | 'destroy';

interface GatedControls {
        /** Arms a gate: the NEXT invocation of `op` blocks inside the executor until released. */
        gate(op: ProbeOp): void;
        /** Releases an armed gate (no-op when not armed). */
        release(op: ProbeOp): void;
        /** Queues a typed effect-failure cue consumed by the next `op` call. */
        failWith(op: ProbeOp, code: string, message: string): void;
        /** Queues a raw-throw cue consumed by the next `op` call (the EXECUTOR_THREW drill). */
        throwOn(op: ProbeOp, message: string): void;
        /** Every executor call in order (the audit surface). */
        readonly calls: readonly string[];
}

/**
 * A scriptable, gateable executor: ops can be BLOCKED mid-effect (interleaving
 * drills), fail with a typed cue, or throw raw — while every invocation is
 * recorded on `calls` so probes can prove gates fire BEFORE any effect.
 */
function gatedExecutor(kinds: readonly EnvironmentKind[]): { executor: EnvironmentExecutor; controls: GatedControls } {
        const calls: string[] = [];
        const gates = new Map<ProbeOp, { promise: Promise<void>; resolve(): void }>();
        const failCues = new Map<ProbeOp, { code: string; message: string }>();
        const throwCues = new Map<ProbeOp, string>();
        const controls: GatedControls = {
                gate: op => gates.set(op, deferred()),
                release: op => {
                        gates.get(op)?.resolve();
                        gates.delete(op);
                },
                failWith: (op, code, message) => failCues.set(op, { code, message }),
                throwOn: (op, message) => throwCues.set(op, message),
                calls,
        };
        async function run(op: ProbeOp, descriptor: EnvironmentDescriptor, ctx: ExecutorOpContext, detail: () => Record<string, unknown>): Promise<{ ok: true; detail?: never } | { ok: false; error: { code: string; message: string } }> {
                calls.push(op);
                const cue = failCues.get(op);
                if (cue !== undefined) {
                        failCues.delete(op);
                        return { ok: false, error: cue };
                }
                const throwCue = throwCues.get(op);
                if (throwCue !== undefined) {
                        throwCues.delete(op);
                        throw new Error(throwCue);
                }
                const gate = gates.get(op);
                if (gate !== undefined) {
                        // the gate STAYS armed in the map so controls.release() can find
                        // and resolve it while this op is suspended on it.
                        // DL-81 / P2-FIX-109: the cooperative cancellation port is
                        // observed WHILE the effect is gated (mid-effect) — a minted
                        // cancel returns the typed OP_CANCELLED effect instead of
                        // completing (the deterministic port model; the real executors
                        // observe at their pre-spawn / pre-confirm checkpoints).
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
                executorKind: 'gated-local',
                infrastructureClass: 'real',
                kinds,
                create: (descriptor, ctx) => run('create', descriptor, ctx, () => ({ type: 'create', stateDir: '/gated/env-state' })),
                start: (descriptor, ctx) => run('start', descriptor, ctx, () => ({ type: 'start', pid: REMOTE_PID })),
                stop: (descriptor, ctx) => run('stop', descriptor, ctx, () => ({ type: 'stop', pid: REMOTE_PID, forcedSignal: 'SIGTERM' })),
                attach: (descriptor, ctx) => run('attach', descriptor, ctx, () => ({ type: 'attach', leaseId: `lease-${descriptor.id}-1`, heldSince: ctx.now })),
                detach: (descriptor, ctx) => run('detach', descriptor, ctx, () => ({ type: 'detach', leaseId: `lease-${descriptor.id}-1` })),
                snapshot: (descriptor, ctx) => run('snapshot', descriptor, ctx, () => ({ type: 'snapshot', snapshotDir: '/gated/snap', fileCount: 1, manifestPath: '/gated/snap/manifest.json' })),
                destroy: (descriptor, ctx) => run('destroy', descriptor, ctx, () => ({ type: 'destroy', pid: null })),
                probe: async () => ({ health: 'healthy', state: 'running', pid: REMOTE_PID, message: 'gated executor probe' }),
        };
        return { executor, controls };
}

/** Boots registry + manager over the mem fs with the given executor + registration. */
async function bootMemRig(options: { executor: EnvironmentExecutor; registration: Record<string, unknown>; extraRegistration?: Record<string, unknown> }): Promise<{ registry: EnvironmentRegistry; manager: EnvironmentLifecycleManager; files: Map<string, string> }> {
        const files = new Map<string, string>();
        const fsPort = memLocalFs(files);
        const clock = fixedClock();
        const registry = new EnvironmentRegistry({ root: ROOT, fs: fsPort, clock });
        await registry.bootstrap();
        await registry.register(options.registration as never);
        if (options.extraRegistration !== undefined) {
                await registry.register(options.extraRegistration as never);
        }
        const manager = new EnvironmentLifecycleManager({ registry, root: ROOT, fs: fsPort, clock, executors: [options.executor] });
        await manager.bootstrap();
        return { registry, manager, files };
}

/** A FRESH registry + manager over the same mem files (the restart drill). */
async function bootManagerOver(files: Map<string, string>, executors: readonly EnvironmentExecutor[]): Promise<EnvironmentLifecycleManager> {
        const fsPort = memLocalFs(files);
        const clock = fixedClock();
        const registry = new EnvironmentRegistry({ root: ROOT, fs: fsPort, clock });
        await registry.bootstrap();
        const manager = new EnvironmentLifecycleManager({ registry, root: ROOT, fs: fsPort, clock, executors });
        await manager.bootstrap();
        return manager;
}

function opsOf(manager: EnvironmentLifecycleManager, id: string): EnvironmentOpRecord[] {
        return manager.ops().filter(record => record.environmentId === id);
}

function ledgerPathOf(): string {
        return `${ROOT}/${OPS_PATH}`;
}

function envelopePathOf(): string {
        return `${ROOT}/${LIFECYCLE_PATH}`;
}

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
                isPidAlive: pid => isPidAlive(pid),
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

interface RealRig {
        root: string;
        executor: LocalProcessExecutor;
        manager: EnvironmentLifecycleManager;
        cleanup(): Promise<void>;
}

async function realRig(options: { ignoreTermination?: boolean; stopTimeoutMs?: number } = {}): Promise<RealRig> {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flauz-tl3-audit-'));
        const ports = realPorts();
        const clock = fixedClock();
        const registry = new EnvironmentRegistry({ root, fs: ports.localFs, clock });
        await registry.bootstrap();
        await registry.register(workspaceRemoteRegistrationInput() as never);
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
        return {
                root,
                executor,
                manager,
                cleanup: async () => {
                        await executor.destroy((await registry.get('env-test-remote'))!, { actor: 'tool', now: Date.now(), cancellation: mintCancellationPort().port }).catch(() => undefined);
                        await fs.rm(root, { recursive: true, force: true });
                },
        };
}

/** The ssh FakeCli rig: models the remote truth (log, state file, pid liveness). */
async function bootSshRig(options: { registration?: Record<string, unknown> } = {}) {
        const files = new Map<string, string>();
        files.set(HARNESS_PATH, await fs.readFile(HARNESS_PATH, { encoding: 'utf-8' }));
        const fsPort = memLocalFs(files);
        const cli = new FakeCli();
        const time = virtualTime();
        const clock = time.clock;
        const registration = options.registration ?? sshRegistrationInput({ id: 'env-audit-ssh' });
        const registry = new EnvironmentRegistry({ root: ROOT, fs: fsPort, clock });
        await registry.bootstrap();
        await registry.register(registration as never);
        const id = registration.id as string;
        const remote = { alive: true, status: 'running' };
        let broken = false;
        cli.handler = argv => {
                if (broken) {
                        return { spawnError: 'spawn ssh ENOENT' };
                }
                const last = argv[argv.length - 1];
                if (argv.includes('kill') && argv.includes('-0')) {
                        return { exitCode: remote.alive ? 0 : 1 };
                }
                if (argv.includes('kill') && argv.includes('-15')) {
                        remote.status = 'stopped';
                        remote.alive = false;
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
                        return {
                                stdout: `${JSON.stringify({
                                        beat: 3,
                                        environmentId: id,
                                        pid: REMOTE_PID,
                                        schema: 'flauz.env-state/v0',
                                        schemaVersion: 0,
                                        startedAt: FIXED_TS,
                                        status: remote.status,
                                        ...(remote.status === 'stopped' ? { stoppedAt: FIXED_TS + 999 } : {}),
                                }, null, 2)}\n`,
                        };
                }
                return { exitCode: 0 };
        };
        const executor = new SshCliExecutor({
                root: ROOT,
                cli,
                fs: fsPort,
                hash: { sha256Hex: contents => createHash('sha256').update(contents, 'utf-8').digest('hex') },
                clock,
                latency: time.latency,
                harnessPath: HARNESS_PATH,
                startTimeoutMs: 400,
                pollIntervalMs: 20,
                stopTimeoutMs: 200,
        });
        const manager = new EnvironmentLifecycleManager({ registry, root: ROOT, fs: fsPort, clock, executors: [executor] });
        await manager.bootstrap();
        return { cli, files, manager, executor, id, breakBinary: () => (broken = true), repairBinary: () => (broken = false) };
}

// ---------------------------------------------------------------------------
// Item 1 — LIFECYCLE REAL RUN (real processes, real fs, the full journey)
// ---------------------------------------------------------------------------

test('tl3-audit item 1: the REAL local journey create->start->attach->detach->stop->snapshot->destroy records exactly the state machine\'s transitions and leaves no live pid', async () => {
        const rig = await realRig();
        const id = 'env-test-remote';
        try {
                const create = await rig.manager.perform('create', { id, actor: 'human' });
                ok(create.ok, JSON.stringify(create.ok ? '' : create.error));
                const start = await rig.manager.perform('start', { id, actor: 'human' });
                ok(start.ok, JSON.stringify(start.ok ? '' : start.error));
                const pid = start.detail?.type === 'start' ? start.detail.pid : undefined;
                strictEqual(typeof pid, 'number');
                ok(isPidAlive(pid!), 'the harness process is live after start');
                const attach = await rig.manager.perform('attach', { id, actor: 'human' });
                ok(attach.ok);
                strictEqual(rig.manager.stateOf(id), 'running/attached');
                const detach = await rig.manager.perform('detach', { id, actor: 'human' });
                ok(detach.ok);
                strictEqual(rig.manager.stateOf(id), 'running');
                const stop = await rig.manager.perform('stop', { id, actor: 'human' });
                ok(stop.ok, JSON.stringify(stop.ok ? '' : stop.error));
                ok(!isPidAlive(pid!), 'the harness process is reaped after stop (graceful SIGTERM path)');
                const snapshot = await rig.manager.perform('snapshot', { id, actor: 'human' });
                ok(snapshot.ok, JSON.stringify(snapshot.ok ? '' : snapshot.error));
                strictEqual(snapshot.detail?.type, 'snapshot');
                const destroy = await rig.manager.perform('destroy', { id, actor: 'human' });
                ok(destroy.ok, JSON.stringify(destroy.ok ? '' : destroy.error));
                // the ledger chain is EXACTLY the machine's — no improvised states
                deepStrictEqual(opsOf(rig.manager, id).map(record => [record.op, record.fromState, record.toState, record.result]), [
                        ['create', 'registered', 'created', 'ok'],
                        ['start', 'created', 'running', 'ok'],
                        ['attach', 'running', 'running/attached', 'ok'],
                        ['detach', 'running/attached', 'running', 'ok'],
                        ['stop', 'running', 'stopped', 'ok'],
                        ['snapshot', 'stopped', 'stopped', 'ok'],
                        ['destroy', 'stopped', 'destroyed', 'ok'],
                ]);
                // terminal: no orphaned process, no surviving state dir
                ok(!isPidAlive(pid!), 'no orphaned harness process after destroy');
                await rejects(fs.access(path.join(rig.root, '.flauz', 'env-state', id)));
                strictEqual(rig.manager.stateOf(id), 'destroyed');
                // and every later op on the terminal state is the ledger-recorded rejection
                const restart = await rig.manager.perform('start', { id, actor: 'human' });
                ok(!restart.ok);
                strictEqual(restart.error.code, 'ILLEGAL_TRANSITION');
        } finally {
                await rig.cleanup();
        }
});

test('tl3-audit item 1: a stubborn child that ignores SIGTERM is SIGKILL-escalated and fully reaped (the escalation actually fires)', async () => {
        const rig = await realRig({ ignoreTermination: true, stopTimeoutMs: 250 });
        const id = 'env-test-remote';
        try {
                await rig.manager.perform('create', { id, actor: 'human' });
                const start = await rig.manager.perform('start', { id, actor: 'human' });
                ok(start.ok);
                const pid = start.detail?.type === 'start' ? start.detail.pid : undefined;
                strictEqual(typeof pid, 'number');
                const stop = await rig.manager.perform('stop', { id, actor: 'human' });
                ok(stop.ok, JSON.stringify(stop.ok ? '' : stop.error));
                const stopDetail = stop.detail;
                ok(stopDetail !== undefined && stopDetail.type === 'stop');
                strictEqual(stopDetail.forcedSignal, 'SIGKILL', 'the pid-tracked SIGKILL escalation fired under a SIGTERM-immune child');
                ok(!isPidAlive(pid!), 'the stubborn child is dead after the escalation (no orphan)');
                const destroy = await rig.manager.perform('destroy', { id, actor: 'human' });
                ok(destroy.ok);
                strictEqual(rig.manager.stateOf(id), 'destroyed');
        } finally {
                await rig.cleanup();
        }
});

// ---------------------------------------------------------------------------
// Item 2 — FAILURE CLASSES (typed taxonomy at the manager boundary)
// ---------------------------------------------------------------------------

test('tl3-audit item 2: effect failures + a raw executor throw surface TYPED codes and land the machine\'s failure states (no raw leak)', async () => {
        const { executor, controls } = gatedExecutor(['workspace-remote']);
        const rig = await bootMemRig({ executor, registration: workspaceRemoteRegistrationInput({ id: 'env-audit-fail' }) });
        const id = 'env-audit-fail';
        await rig.manager.perform('create', { id, actor: 'human' });
        // a failed start effect: the typed error, landing `failed` per the machine
        controls.failWith('start', 'EFFECT_START_FAILED', 'the provider refused the start');
        const startFailed = await rig.manager.perform('start', { id, actor: 'human' });
        ok(!startFailed.ok);
        strictEqual(startFailed.error.code, 'EFFECT_START_FAILED');
        strictEqual(startFailed.record.result, 'error');
        strictEqual(rig.manager.stateOf(id), 'failed');
        // a raw executor throw NEVER leaks: the manager wraps it as EXECUTOR_THREW
        controls.throwOn('start', 'provider connection lost mid-flight');
        const threw = await rig.manager.perform('start', { id, actor: 'human' });
        ok(!threw.ok);
        strictEqual(threw.error.code, 'EXECUTOR_THREW');
        strictEqual(threw.error.message.includes('provider connection lost mid-flight'), true);
        strictEqual(rig.manager.stateOf(id), 'failed');
        // recovery: start is legal from failed and succeeds now
        const recovered = await rig.manager.perform('start', { id, actor: 'human' });
        ok(recovered.ok);
        strictEqual(rig.manager.stateOf(id), 'running');
});

test('tl3-audit item 2: attach to a non-running environment and snapshot of a destroyed one are ledger-recorded ILLEGAL_TRANSITION (typed, state untouched)', async () => {
        const { executor } = gatedExecutor(['workspace-remote']);
        const rig = await bootMemRig({ executor, registration: workspaceRemoteRegistrationInput({ id: 'env-audit-illegal' }) });
        const id = 'env-audit-illegal';
        // attach on a registered-but-never-created environment: typed rejection
        const attach = await rig.manager.perform('attach', { id, actor: 'human' });
        ok(!attach.ok);
        strictEqual(attach.error.code, 'ILLEGAL_TRANSITION');
        strictEqual(attach.record.op, 'attach');
        strictEqual(attach.record.result, 'error');
        strictEqual(rig.manager.stateOf(id), 'registered');
        // journey to destroyed, then snapshot: typed rejection, terminal state holds
        await rig.manager.perform('create', { id, actor: 'human' });
        await rig.manager.perform('start', { id, actor: 'human' });
        await rig.manager.perform('stop', { id, actor: 'human' });
        await rig.manager.perform('destroy', { id, actor: 'human' });
        const snapshot = await rig.manager.perform('snapshot', { id, actor: 'human' });
        ok(!snapshot.ok);
        strictEqual(snapshot.error.code, 'ILLEGAL_TRANSITION');
        strictEqual(rig.manager.stateOf(id), 'destroyed');
});

// ---------------------------------------------------------------------------
// Item 3 — DESTROY-DURING-OP (fail-closed interleavings on one environment)
// ---------------------------------------------------------------------------

test('tl3-audit item 3 (DL-81 / P2-FIX-109): destroy issued while a stop is in flight SUPERSEDES it — the stop lands cancelled, the destroy lands the terminal destroyed envelope, the ledger records both honestly in sequence', async () => {
        const { executor, controls } = gatedExecutor(['workspace-remote']);
        const rig = await bootMemRig({ executor, registration: workspaceRemoteRegistrationInput({ id: 'env-audit-race' }) });
        const id = 'env-audit-race';
        await rig.manager.perform('create', { id, actor: 'human' });
        await rig.manager.perform('start', { id, actor: 'human' });
        // stop in flight (blocked inside the executor effect)
        controls.gate('stop');
        const stopP: Promise<EnvironmentOpOutcome> = rig.manager.perform('stop', { id, actor: 'human' });
        await until(() => controls.calls.includes('stop'));
        // destroy arrives while the stop is in flight: the DL-81 destroy-supersede
        // (terminal decisiveness) — NOT the pre-DL-81 OP_IN_FLIGHT rejection. The
        // in-flight stop is cooperatively cancelled at its gated checkpoint and the
        // destroy proceeds as the terminal op over the settled envelope.
        const destroyP = rig.manager.perform('destroy', { id, actor: 'agent' });
        const stopOutcome = await stopP;
        ok(!stopOutcome.ok, 'the cancelled stop resolves through the error arm (the two-armed outcome envelope is unchanged)');
        strictEqual(stopOutcome.error.code, 'OP_CANCELLED', 'the typed cancellation error');
        strictEqual(stopOutcome.record.result, 'cancelled', 'the ledger records the attempt as cancelled (distinct from error)');
        strictEqual(stopOutcome.record.op, 'stop');
        strictEqual(stopOutcome.record.actor, 'human', 'the attempt row keeps its issuing provenance');
        strictEqual(stopOutcome.record.error?.message.includes("by actor 'agent' (destroy-supersede)"), true, 'the cancelling actor provenance + reason ride the typed error payload');
        const destroyOutcome = await destroyP;
        ok(destroyOutcome.ok, 'the destroy proceeds as the terminal op');
        strictEqual(destroyOutcome.record.toState, 'destroyed');
        strictEqual(rig.manager.stateOf(id), 'destroyed', 'the terminal destroyed envelope');
        // the ledger sequence is exactly the machine-legal pair, recorded honestly
        deepStrictEqual(opsOf(rig.manager, id).map(record => [record.op, record.result, record.toState]), [
                ['create', 'ok', 'created'],
                ['start', 'ok', 'running'],
                ['stop', 'cancelled', 'failed'],
                ['destroy', 'ok', 'destroyed'],
        ]);
});

test('tl3-audit item 3: a start issued while a destroy is in flight is rejected typed; the envelope reaches the terminal destroyed state and holds it', async () => {
        const { executor, controls } = gatedExecutor(['workspace-remote']);
        const rig = await bootMemRig({ executor, registration: workspaceRemoteRegistrationInput({ id: 'env-audit-race2' }) });
        const id = 'env-audit-race2';
        await rig.manager.perform('create', { id, actor: 'human' });
        // destroy in flight (blocked inside the executor effect)
        controls.gate('destroy');
        const destroyP = rig.manager.perform('destroy', { id, actor: 'human' });
        await until(() => controls.calls.includes('destroy'));
        // start arrives while the destroy is in flight: fail-closed typed rejection
        const startP = rig.manager.perform('start', { id, actor: 'human' });
        await rejects(() => startP, (err: unknown) => {
                ok(err instanceof EnvironmentLifecycleError);
                strictEqual((err as EnvironmentLifecycleError).code, 'OP_IN_FLIGHT');
                return true;
        });
        strictEqual(controls.calls.includes('start'), false, 'the rejected start never reached the executor');
        controls.release('destroy');
        const destroyOutcome = await destroyP;
        ok(destroyOutcome.ok);
        strictEqual(rig.manager.stateOf(id), 'destroyed', 'the envelope reaches the terminal state');
        // the terminal state holds: a later start is the ledger-recorded rejection
        const restart = await rig.manager.perform('start', { id, actor: 'human' });
        ok(!restart.ok);
        strictEqual(restart.error.code, 'ILLEGAL_TRANSITION');
        deepStrictEqual(opsOf(rig.manager, id).map(record => [record.op, record.toState]), [
                ['create', 'created'],
                ['destroy', 'destroyed'],
                ['start', 'destroyed'],
        ], 'the ledger holds exactly the machine-legal sequence (the failed start row preserves the state)');
});

test('tl3-audit item 3: a snapshot issued while a destroy is in flight is rejected typed (no partial snapshot state over a terminal envelope)', async () => {
        const { executor, controls } = gatedExecutor(['workspace-remote']);
        const rig = await bootMemRig({ executor, registration: workspaceRemoteRegistrationInput({ id: 'env-audit-race3' }) });
        const id = 'env-audit-race3';
        await rig.manager.perform('create', { id, actor: 'human' });
        controls.gate('destroy');
        const destroyP = rig.manager.perform('destroy', { id, actor: 'human' });
        await until(() => controls.calls.includes('destroy'));
        const snapshotP = rig.manager.perform('snapshot', { id, actor: 'human' });
        await rejects(() => snapshotP, (err: unknown) => (err instanceof EnvironmentLifecycleError) && (err as EnvironmentLifecycleError).code === 'OP_IN_FLIGHT');
        strictEqual(controls.calls.includes('snapshot'), false);
        controls.release('destroy');
        ok((await destroyP).ok);
        strictEqual(rig.manager.stateOf(id), 'destroyed');
});

test('tl3-audit item 3 (DL-81 / P2-FIX-109): destroy issued while a start is in flight supersedes it — the cancelled start + the terminal destroyed envelope, no interleaved rows', async () => {
        const { executor, controls } = gatedExecutor(['workspace-remote']);
        const rig = await bootMemRig({ executor, registration: workspaceRemoteRegistrationInput({ id: 'env-audit-race4' }) });
        const id = 'env-audit-race4';
        await rig.manager.perform('create', { id, actor: 'human' });
        controls.gate('start');
        const startP: Promise<EnvironmentOpOutcome> = rig.manager.perform('start', { id, actor: 'human' });
        await until(() => controls.calls.includes('start'));
        const destroyP = rig.manager.perform('destroy', { id, actor: 'agent' });
        const startOutcome = await startP;
        ok(!startOutcome.ok, 'the cancelled start resolves through the error arm');
        strictEqual(startOutcome.error.code, 'OP_CANCELLED', 'the typed cancellation error');
        strictEqual(startOutcome.record.result, 'cancelled', 'cancellation never fabricates completion — a cancelled start records cancelled, not started');
        strictEqual(startOutcome.record.toState, 'failed', 'the cancelled start settles through the EXISTING failure-state law (never a silent healthy state)');
        const destroyOutcome = await destroyP;
        ok(destroyOutcome.ok, 'the destroy proceeds as the terminal op');
        strictEqual(destroyOutcome.record.fromState, 'failed', 'the destroy proceeds from the state the cancelled attempt settled into');
        strictEqual(destroyOutcome.record.toState, 'destroyed');
        strictEqual(rig.manager.stateOf(id), 'destroyed', 'the terminal destroyed envelope holds');
        deepStrictEqual(opsOf(rig.manager, id).map(record => [record.op, record.result, record.toState]), [
                ['create', 'ok', 'created'],
                ['start', 'cancelled', 'failed'],
                ['destroy', 'ok', 'destroyed'],
        ]);
});

// ---------------------------------------------------------------------------
// Item 4 — TRUST GATE (registry + PIN-2 checks before ANY effect)
// ---------------------------------------------------------------------------

test('tl3-audit item 4: untrusted + disabled gates fire BEFORE any executor effect (start/attach never reach the executor)', async () => {
        const { executor, controls } = gatedExecutor(['workspace-remote']);
        const rig = await bootMemRig({
                executor,
                registration: workspaceRemoteRegistrationInput({ id: 'env-audit-untrusted', trust: { posture: 'untrusted', inheritsWorkspaceTrust: false } }),
                extraRegistration: workspaceRemoteRegistrationInput({ id: 'env-audit-disabled', enabled: false }),
        });
        // create is legal for both (create provisions, it does not connect)
        ok((await rig.manager.perform('create', { id: 'env-audit-untrusted', actor: 'human' })).ok);
        ok((await rig.manager.perform('create', { id: 'env-audit-disabled', actor: 'human' })).ok);
        // untrusted start: ledger-recorded typed rejection naming the posture
        const untrustedStart = await rig.manager.perform('start', { id: 'env-audit-untrusted', actor: 'human' });
        ok(!untrustedStart.ok);
        strictEqual(untrustedStart.error.code, 'TRUST_POSTURE_REJECTED');
        strictEqual(untrustedStart.error.message.includes('untrusted'), true);
        strictEqual(rig.manager.stateOf('env-audit-untrusted'), 'created', 'the rejection left the state untouched');
        // disabled start: ledger-recorded typed rejection
        const disabledStart = await rig.manager.perform('start', { id: 'env-audit-disabled', actor: 'human' });
        ok(!disabledStart.ok);
        strictEqual(disabledStart.error.code, 'ENVIRONMENT_DISABLED');
        // the attach legs need a running state: seed the PIN-2 envelope (a posture/
        // enabled flip AFTER the environment was started), then attach on a fresh manager
        for (const seededId of ['env-audit-untrusted', 'env-audit-disabled']) {
                const envelope = JSON.parse(rig.files.get(envelopePathOf())!) as { entries: Record<string, { state: string }> };
                envelope.entries[seededId].state = 'running';
                rig.files.set(envelopePathOf(), JSON.stringify(envelope));
        }
        const { executor: freshExecutor, controls: freshControls } = gatedExecutor(['workspace-remote']);
        const fresh = await bootManagerOver(rig.files, [freshExecutor]);
        const untrustedAttach = await fresh.perform('attach', { id: 'env-audit-untrusted', actor: 'human' });
        ok(!untrustedAttach.ok);
        strictEqual(untrustedAttach.error.code, 'TRUST_POSTURE_REJECTED');
        const disabledAttach = await fresh.perform('attach', { id: 'env-audit-disabled', actor: 'human' });
        ok(!disabledAttach.ok);
        strictEqual(disabledAttach.error.code, 'ENVIRONMENT_DISABLED');
        deepStrictEqual([...controls.calls], ['create', 'create'], 'only the legal creates reached the executor — no rejected start ever did');
        strictEqual(freshControls.calls.length, 0, 'no rejected attach ever reached the executor effect');
});

test('tl3-audit item 4: EVERY op on an absent registry entry is the typed pre-flight ENVIRONMENT_UNKNOWN (no op path skips the registry)', async () => {
        const { executor, controls } = gatedExecutor(['workspace-remote']);
        const rig = await bootMemRig({ executor, registration: workspaceRemoteRegistrationInput({ id: 'env-audit-present' }) });
        for (const op of ['create', 'start', 'stop', 'attach', 'detach', 'snapshot', 'destroy'] as const) {
                await rejects(() => rig.manager.perform(op, { id: 'env-audit-not-registered', actor: 'human' }), (err: unknown) => {
                        ok(err instanceof EnvironmentLifecycleError, op);
                        strictEqual((err as EnvironmentLifecycleError).code, 'ENVIRONMENT_UNKNOWN', op);
                        return true;
                });
        }
        strictEqual(controls.calls.length, 0);
        const rawLedger = rig.files.get(ledgerPathOf()) ?? '';
        strictEqual(rawLedger.split('\n').filter(line => line.length > 0).length, 0, 'nothing was recorded for pre-flight rejections');
});

test('tl3-audit item 4: destroyed is terminal at the PIN-2 layer — every op on a destroyed environment is the ledger-recorded ILLEGAL_TRANSITION', async () => {
        const { executor, controls } = gatedExecutor(['workspace-remote']);
        const rig = await bootMemRig({ executor, registration: workspaceRemoteRegistrationInput({ id: 'env-audit-terminal' }) });
        const id = 'env-audit-terminal';
        await rig.manager.perform('create', { id, actor: 'human' });
        await rig.manager.perform('start', { id, actor: 'human' });
        await rig.manager.perform('stop', { id, actor: 'human' });
        await rig.manager.perform('destroy', { id, actor: 'human' });
        const callsAfterDestroy = controls.calls.length;
        for (const op of ['create', 'start', 'stop', 'attach', 'detach', 'snapshot', 'destroy'] as const) {
                const outcome = await rig.manager.perform(op, { id, actor: 'human' });
                ok(!outcome.ok, op);
                strictEqual(outcome.error.code, 'ILLEGAL_TRANSITION', op);
                strictEqual(rig.manager.stateOf(id), 'destroyed', op);
        }
        strictEqual(controls.calls.length, callsAfterDestroy, 'the PIN-2 state check rejected every op before any effect');
});

test('tl3-audit item 4: descriptors never carry credentials — literal keys, literal bridge tokens and unknown credential fields are schema-rejected at registration', async () => {
        const { executor } = gatedExecutor(['workspace-remote']);
        const rig = await bootMemRig({ executor, registration: workspaceRemoteRegistrationInput({ id: 'env-audit-schema' }) });
        await rejects(() => rig.registry.register(cloudSandboxRegistrationInput({ id: 'env-audit-literal-key', connection: { provider: 'e2b', apiKeyRef: 'sk-live-literal-key-material', sandboxTemplate: 'base' } }) as never), /vault-style/);
        await rejects(() => rig.registry.register(sshRegistrationInput({
                id: 'env-audit-literal-token',
                connection: { host: 'audit.example.test', authMethod: 'key', agentHostBridge: { bridgePort: 9777, tokenRef: 'literal-token-material' } },
        }) as never), /vault-style/);
        await rejects(() => rig.registry.register(sshRegistrationInput({
                id: 'env-audit-password-field',
                connection: { host: 'audit.example.test', authMethod: 'password', password: 'hunter2' },
        }) as never), /unknown keys/);
});

// ---------------------------------------------------------------------------
// Item 5 — PROVIDER SEAMS (FakeCli drills: capability, honesty, injection, secrets)
// ---------------------------------------------------------------------------

test('tl3-audit item 5: capability probes are typed at the manager boundary — absent ssh binary CLI_NOT_AVAILABLE, probe timeout SSH_PROBE_TIMEOUT, docker daemon down DAEMON_UNREACHABLE', async () => {
        // ssh binary absent: the ssh -V capability probe surfaces the typed class
        {
                const rig = await bootSshRig();
                rig.cli.queueResult({ spawnError: 'spawn ssh ENOENT' });
                const create = await rig.manager.perform('create', { id: rig.id, actor: 'human' });
                ok(!create.ok);
                strictEqual(create.error.code, 'CLI_NOT_AVAILABLE');
        }
        // ssh probe timeout: the bounded invocation was SIGKILLed — typed, never a hang
        {
                const rig = await bootSshRig();
                rig.cli.queueResults([{ exitCode: 0 }, { timedOut: true }]);
                const create = await rig.manager.perform('create', { id: rig.id, actor: 'human' });
                ok(!create.ok);
                strictEqual(create.error.code, 'SSH_PROBE_TIMEOUT');
        }
        // docker daemon down: docker info exit 1 -> typed DAEMON_UNREACHABLE
        {
                const files = new Map<string, string>();
                const fsPort = memLocalFs(files);
                const cli = new FakeCli();
                const time = virtualTime();
                const registry = new EnvironmentRegistry({ root: ROOT, fs: fsPort, clock: time.clock });
                await registry.bootstrap();
                await registry.register(containerRegistrationInput({ id: 'env-audit-docker' }) as never);
                cli.handler = () => ({ exitCode: 1, stderr: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?' });
                const executor = new DockerCliExecutor({ root: ROOT, cli, fs: fsPort, hash: { sha256Hex: contents => createHash('sha256').update(contents, 'utf-8').digest('hex') }, clock: time.clock, harnessPath: HARNESS_PATH });
                const manager = new EnvironmentLifecycleManager({ registry, root: ROOT, fs: fsPort, clock: time.clock, executors: [executor] });
                await manager.bootstrap();
                const create = await manager.perform('create', { id: 'env-audit-docker', actor: 'human' });
                ok(!create.ok);
                strictEqual(create.error.code, 'DAEMON_UNREACHABLE');
        }
});

test('tl3-audit item 5: injection law — the ssh launch argv is executor-constructed; the harness rides stdin; descriptor text beyond host/user never reaches argv', async () => {
        const rig = await bootSshRig({
                registration: sshRegistrationInput({
                        id: 'env-audit-injection',
                        label: 'Audit Label With Spaces And;Pipe',
                        connection: { host: 'audit-target.test', user: 'audituser', port: 2222, authMethod: 'key', remotePath: '/home/audit/remote; rm -rf /' },
                }),
        });
        const id = rig.id;
        ok((await rig.manager.perform('create', { id, actor: 'human' })).ok);
        ok((await rig.manager.perform('start', { id, actor: 'human' })).ok);
        const launch = rig.cli.calls.find(call => call.argv.includes('nohup'));
        ok(launch !== undefined, 'the harness launch invocation was recorded');
        // the FIXED harness ships over stdin, byte-for-byte
        strictEqual(launch.stdin, await fs.readFile(HARNESS_PATH, { encoding: 'utf-8' }));
        // the remote command words are the fixed vocabulary + registry-validated id + numbers
        deepStrictEqual(launch.argv.slice(launch.argv.indexOf('mkdir')), [
                'mkdir', '-p', `~/.flauz/env-state/${id}`, '&&', 'nohup', 'node', '-',
                '--state-dir', `~/.flauz/env-state/${id}`, '--id', id, '--heartbeat-ms', '500',
                '>', `~/.flauz/env-state/${id}/harness.out`, '2>&1', '&',
        ]);
        // no descriptor text beyond the connection host/user ever reaches any argv
        for (const call of rig.cli.calls) {
                for (const token of call.argv) {
                        strictEqual(token.includes('Audit Label'), false, `label leaked into argv: ${token}`);
                        strictEqual(token.includes('rm -rf'), false, `remotePath payload leaked into argv: ${token}`);
                        strictEqual(token.includes(';'), false, `shell metacharacter leaked into argv: ${token}`);
                }
        }
});

test('tl3-audit item 5: the cloud seam never materializes the key — the Authorization header is the ONLY carrier; every persisted byte stays key-free', async () => {
        const files = new Map<string, string>();
        const fsPort = memLocalFs(files);
        const clock = fixedClock();
        const requests: { method: string; url: string; headers?: Record<string, string> }[] = [];
        const http: HttpPort = {
                fetch: async request => {
                        requests.push({ method: request.method, url: request.url, ...(request.headers === undefined ? {} : { headers: request.headers }) });
                        if (request.method === 'POST' && request.url.endsWith('/v0/sandboxes')) {
                                return { status: 201, bodyText: '{"sandboxId":"sbx-audit-1"}' };
                        }
                        if (request.url.endsWith('/start') || request.url.endsWith('/snapshots')) {
                                return { status: 200, bodyText: request.url.endsWith('/snapshots') ? '{"snapshotId":"snap-audit-1"}' : '{}' };
                        }
                        return { status: 200, bodyText: '{"status":"running"}' };
                },
        };
        const KEY = 'cloud-key-value-audit';
        const secrets: SecretResolverPort = { resolve: async ref => (ref === 'vault:cloud-e2b-key' ? KEY : undefined) };
        const registry = new EnvironmentRegistry({ root: ROOT, fs: fsPort, clock });
        await registry.bootstrap();
        await registry.register(cloudSandboxRegistrationInput({ id: 'env-audit-cloud', trust: { posture: 'trusted', inheritsWorkspaceTrust: true } }) as never);
        const executor = new CloudHttpExecutor({ root: ROOT, http, secrets, baseUrl: 'https://cloud.example.test', fs: fsPort, hash: { sha256Hex: contents => createHash('sha256').update(contents, 'utf-8').digest('hex') }, clock });
        const manager = new EnvironmentLifecycleManager({ registry, root: ROOT, fs: fsPort, clock, executors: [executor] });
        await manager.bootstrap();
        const id = 'env-audit-cloud';
        ok((await manager.perform('create', { id, actor: 'human' })).ok);
        ok((await manager.perform('start', { id, actor: 'human' })).ok);
        ok((await manager.perform('snapshot', { id, actor: 'human' })).ok);
        // the key rode ONLY inside the Authorization header of the provider calls
        ok(requests.length >= 3);
        for (const request of requests) {
                strictEqual(request.headers?.Authorization, `Bearer ${KEY}`);
        }
        // and no persisted byte (ledger, envelope, tracking record, snapshot artifacts) carries it
        for (const [file, contents] of files) {
                strictEqual(contents.includes(KEY), false, `key material persisted at ${file}`);
        }
});

test('tl3-audit item 5: ssh destroy when the binary vanishes for the final rm is the TYPED CLI_NOT_AVAILABLE — never a fabricated success; retry after repair completes the teardown', async () => {
        const rig = await bootSshRig();
        const id = rig.id;
        await rig.manager.perform('create', { id, actor: 'human' });
        await rig.manager.perform('start', { id, actor: 'human' });
        await rig.manager.perform('stop', { id, actor: 'human' });
        strictEqual(rig.manager.stateOf(id), 'stopped');
        // the ssh binary disappears for the teardown's rm -rf
        rig.breakBinary();
        const destroy = await rig.manager.perform('destroy', { id, actor: 'human' });
        ok(!destroy.ok, 'a vanished binary must not fabricate destroy success');
        strictEqual(destroy.error.code, 'CLI_NOT_AVAILABLE');
        strictEqual(rig.manager.stateOf(id), 'stopped', 'the failed destroy preserved the state (no partial teardown)');
        // the binary returns: destroy retries honestly to the terminal state
        rig.repairBinary();
        const retried = await rig.manager.perform('destroy', { id, actor: 'human' });
        ok(retried.ok, JSON.stringify(retried.ok ? '' : retried.error));
        strictEqual(rig.manager.stateOf(id), 'destroyed');
        ok(rig.cli.everCalledWith('rm'), 'the retry actually issued the rm -rf');
});

test('tl3-audit item 5: docker teardown when the binary vanishes mid-destroy is the TYPED CLI_NOT_AVAILABLE — never a fabricated "already gone"', async () => {
        const files = new Map<string, string>();
        const fsPort = memLocalFs(files);
        const cli = new FakeCli();
        const time = virtualTime();
        let calls = 0;
        cli.handler = argv => {
                const index = calls++;
                // the binary vanishes from the `docker stop` of the teardown onward
                // (the inspect that chose the teardown path ran while it was alive)
                if (index >= 2) {
                        return { spawnError: 'spawn docker ENOENT' };
                }
                if (argv.includes('inspect')) {
                        return { exitCode: 0, stdout: JSON.stringify([{ Id: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', State: { Running: false, Status: 'exited' } }]) };
                }
                return { exitCode: 0 };
        };
        const executor = new DockerCliExecutor({ root: ROOT, cli, fs: fsPort, hash: { sha256Hex: contents => createHash('sha256').update(contents, 'utf-8').digest('hex') }, clock: time.clock, harnessPath: HARNESS_PATH });
        const registry = new EnvironmentRegistry({ root: ROOT, fs: fsPort, clock: time.clock });
        await registry.bootstrap();
        const descriptor = (await registry.register(containerRegistrationInput({ id: 'env-audit-docker2' }) as never)) as EnvironmentDescriptor;
        const destroy = await executor.destroy(descriptor, { actor: 'human', now: time.now(), cancellation: mintCancellationPort().port });
        ok(!destroy.ok, 'a vanished binary must not fabricate teardown success');
        strictEqual(destroy.error.code, 'CLI_NOT_AVAILABLE');
});

// ---------------------------------------------------------------------------
// Item 6 — RESOLVER RUNG 2 (typed boundary; gates cited from resolver suites)
// ---------------------------------------------------------------------------

test('tl3-audit item 6: the resolver core NEVER leaks a raw throw — unreadable registry/PIN-2 sources map to typed ENVIRONMENT_ABSENT / TRUST_REFUSED (fail-closed)', async () => {
        // (a) registry bootstrapped + environment registered, lifecycle manager NOT bootstrapped
        {
                const files = new Map<string, string>();
                const fsPort = memLocalFs(files);
                const clock = fixedClock();
                const registry = new EnvironmentRegistry({ root: ROOT, fs: fsPort, clock });
                await registry.bootstrap();
                await registry.register(sshRegistrationInput({ id: 'env-audit-resolve', trust: { posture: 'trusted', inheritsWorkspaceTrust: true }, connection: { host: 'resolve-target.test', authMethod: 'key' } }) as never);
                const unbootstrappedManager = new EnvironmentLifecycleManager({ registry, root: ROOT, fs: fsPort, clock, executors: [] });
                const resolver = new FlauzEnvResolver(resolverOptions(registry, unbootstrappedManager, files));
                const outcome = await resolver.resolve(formatFlauzEnvAuthority('ssh-local', 'env-audit-resolve'));
                ok(!outcome.ok);
                strictEqual(outcome.failure.code, 'TRUST_REFUSED', 'an unreadable PIN-2 source refuses at the trust gate (fail-closed)');
                strictEqual(outcome.failure.detail, 'STORE_CORRUPT');
        }
        // (b) registry NOT bootstrapped: typed ENVIRONMENT_ABSENT
        {
                const files = new Map<string, string>();
                const fsPort = memLocalFs(files);
                const clock = fixedClock();
                const registry = new EnvironmentRegistry({ root: ROOT, fs: fsPort, clock });
                const manager = new EnvironmentLifecycleManager({ registry, root: ROOT, fs: fsPort, clock, executors: [] });
                const resolver = new FlauzEnvResolver(resolverOptions(registry, manager, files));
                const outcome = await resolver.resolve(formatFlauzEnvAuthority('ssh-local', 'env-audit-resolve'));
                ok(!outcome.ok);
                strictEqual(outcome.failure.code, 'ENVIRONMENT_ABSENT', 'an unreadable registry fails closed as absent');
        }
        // (c) nested a@b transit stays the typed AUTHORITY_MALFORMED naming NESTED_TRANSIT
        {
                const files = new Map<string, string>();
                const fsPort = memLocalFs(files);
                const clock = fixedClock();
                const registry = new EnvironmentRegistry({ root: ROOT, fs: fsPort, clock });
                await registry.bootstrap();
                const manager = new EnvironmentLifecycleManager({ registry, root: ROOT, fs: fsPort, clock, executors: [] });
                await manager.bootstrap();
                const resolver = new FlauzEnvResolver(resolverOptions(registry, manager, files));
                const outcome = await resolver.resolve('flauz-env+ssh-local+env-audit-resolve@other-authority');
                ok(!outcome.ok);
                strictEqual(outcome.failure.code, 'AUTHORITY_MALFORMED');
                strictEqual(outcome.failure.message.includes('NESTED_TRANSIT'), true);
        }
});

function resolverOptions(registry: EnvironmentRegistry, manager: EnvironmentLifecycleManager, files: Map<string, string>): FlauzEnvResolverOptions {
        return {
                registry,
                lifecycle: manager,
                cli: new FakeCli(),
                http: { fetch: async () => ({ status: 200, bodyText: '{"status":"running"}' }) },
                secrets: { resolve: async () => undefined },
                root: ROOT,
                fs: memLocalFs(files),
                cloudBaseUrl: 'https://cloud.example.test',
        };
}

// ---------------------------------------------------------------------------
// Item 7 — PIN-2 ENVELOPES (canonical JSONL; malformed fails closed)
// ---------------------------------------------------------------------------

test('tl3-audit item 7: canonical JSONL discipline — compact sorted-keys lines, the DL-9 envelope, exactly one record per op', async () => {
        const { executor } = gatedExecutor(['workspace-remote']);
        const rig = await bootMemRig({ executor, registration: workspaceRemoteRegistrationInput({ id: 'env-audit-canon' }) });
        const id = 'env-audit-canon';
        for (const op of ['create', 'start', 'attach', 'detach', 'stop', 'snapshot', 'destroy'] as const) {
                const outcome = await rig.manager.perform(op, { id, actor: 'agent' });
                ok(outcome.ok, `${op}: ${JSON.stringify(outcome.ok ? '' : outcome.error)}`);
        }
        const rawLedger = rig.files.get(ledgerPathOf())!;
        strictEqual(rawLedger.endsWith('\n'), true, 'the ledger ends with exactly one trailing newline');
        strictEqual(rawLedger.includes('\n\n'), false, 'no blank lines');
        const lines = rawLedger.split('\n').slice(0, -1);
        strictEqual(lines.length, 7, 'exactly one ledger record per op');
        for (const line of lines) {
                strictEqual(line, canonicalJson(JSON.parse(line)), 'every ledger line is the compact, recursively-sorted canonical form');
        }
        const rawEnvelope = rig.files.get(envelopePathOf())!;
        const reparsed = JSON.parse(rawEnvelope) as { entries: Record<string, Record<string, unknown>> };
        strictEqual(rawEnvelope, `${JSON.stringify(reparsed, null, 2)}\n`, 'the envelope is the DL-9 form (canonical key order, 2-space indent, one trailing newline)');
        deepStrictEqual(Object.keys(reparsed.entries[id]).sort(), ['executorKind', 'lastOpRef', 'state', 'updatedAt'], 'the entry key set is exactly the PIN-2 four');
        strictEqual(reparsed.entries[id].lastOpRef, 7, 'lastOpRef points at the environment\'s most recent record');
        strictEqual(JSON.parse(lines[0]).actor, 'agent', 'provenance rides every record');
});

test('tl3-audit item 7: a malformed ledger line fails bootstrap closed (typed STORE_CORRUPT) and blocks every op', async () => {
        const { executor } = gatedExecutor(['workspace-remote']);
        const rig = await bootMemRig({ executor, registration: workspaceRemoteRegistrationInput({ id: 'env-audit-corrupt' }) });
        const id = 'env-audit-corrupt';
        await rig.manager.perform('create', { id, actor: 'human' });
        // corrupt the ledger with a non-JSON trailing line
        rig.files.set(ledgerPathOf(), `${rig.files.get(ledgerPathOf())}this-line-is-not-json\n`);
        const { executor: executor2 } = gatedExecutor(['workspace-remote']);
        await rejects(() => bootManagerOver(rig.files, [executor2]), (err: unknown) => {
                ok(err instanceof EnvironmentLifecycleError);
                strictEqual((err as EnvironmentLifecycleError).code, 'STORE_CORRUPT');
                return true;
        });
        const blocked = new EnvironmentLifecycleManager({ registry: rig.registry, root: ROOT, fs: memLocalFs(rig.files), clock: fixedClock(), executors: [executor2] });
        await rejects(() => blocked.perform('start', { id, actor: 'human' }), (err: unknown) => {
                ok(err instanceof EnvironmentLifecycleError);
                strictEqual((err as EnvironmentLifecycleError).code, 'STORE_CORRUPT');
                return true;
        });
});

// ---------------------------------------------------------------------------
// Item 8 — RESTART RECOVERY (torn writes; a real killed harness)
// ---------------------------------------------------------------------------

test('tl3-audit item 8: torn-write recovery — a destroy-ok ledger tail beyond the envelope\'s lastOpRef reconciles to the ledger\'s terminal truth at bootstrap', async () => {
        const { executor } = gatedExecutor(['workspace-remote']);
        const rig = await bootMemRig({ executor, registration: workspaceRemoteRegistrationInput({ id: 'env-audit-torn' }) });
        const id = 'env-audit-torn';
        await rig.manager.perform('create', { id, actor: 'human' });
        await rig.manager.perform('start', { id, actor: 'human' });
        await rig.manager.perform('stop', { id, actor: 'human' });
        strictEqual(rig.manager.stateOf(id), 'stopped');
        strictEqual(rig.manager.entryOf(id)!.lastOpRef, 3);
        // simulate the crash window inside commit(): appendOp landed, writeEnvelope never did
        const torn = serializeOpRecord({
                schemaVersion: 0,
                schema: 'flauz.environments-ops/v0',
                ts: FIXED_TS + 4000,
                actor: 'human',
                op: 'destroy',
                environmentId: id,
                result: 'ok',
                fromState: 'stopped',
                toState: 'destroyed',
        });
        rig.files.set(ledgerPathOf(), `${rig.files.get(ledgerPathOf())}${torn}\n`);
        // a fresh manager (process restart) recovers from the ledger's truth
        const { executor: freshExecutor } = gatedExecutor(['workspace-remote']);
        const recovered = await bootManagerOver(rig.files, [freshExecutor]);
        strictEqual(recovered.stateOf(id), 'destroyed', 'the envelope reconciled to the ledger\'s terminal truth (never stuck in a pre-op state)');
        strictEqual(recovered.entryOf(id)!.lastOpRef, 4);
        // the recovery is DURABLE: the envelope file itself was rewritten
        const rawEnvelope = JSON.parse(rig.files.get(envelopePathOf())!) as { entries: Record<string, { state: string; lastOpRef: number }> };
        strictEqual(rawEnvelope.entries[id].state, 'destroyed');
        strictEqual(rawEnvelope.entries[id].lastOpRef, 4);
        // a THIRD manager (another restart) reads the consistent pair
        const { executor: thirdExecutor } = gatedExecutor(['workspace-remote']);
        const again = await bootManagerOver(rig.files, [thirdExecutor]);
        strictEqual(again.stateOf(id), 'destroyed');
        // and the terminal state holds: every op is the ledger-recorded rejection
        const restart = await recovered.perform('start', { id, actor: 'human' });
        ok(!restart.ok);
        strictEqual(restart.error.code, 'ILLEGAL_TRANSITION');
});

test('tl3-audit item 8: REAL restart recovery — SIGKILL the harness mid-lifecycle; a fresh manager over the same root reconciles to a terminal state', async () => {
        const rig = await realRig();
        const id = 'env-test-remote';
        let pid: number | undefined;
        try {
                await rig.manager.perform('create', { id, actor: 'human' });
                const start = await rig.manager.perform('start', { id, actor: 'human' });
                ok(start.ok);
                pid = start.detail?.type === 'start' ? start.detail.pid : undefined;
                strictEqual(typeof pid, 'number');
                // the "host crash": the harness dies without telling anyone
                process.kill(pid!, 'SIGKILL');
                await until(() => !isPidAlive(pid!));
                // a fresh registry + executor + manager over the SAME root (process restart)
                const ports = realPorts();
                const clock = fixedClock();
                const registry = new EnvironmentRegistry({ root: rig.root, fs: ports.localFs, clock });
                await registry.bootstrap();
                const executor = new LocalProcessExecutor({ root: rig.root, fs: ports.localFs, process: ports.processPort, hash: ports.hash, clock, harnessPath: HARNESS_PATH, heartbeatMs: 100 });
                const manager = new EnvironmentLifecycleManager({ registry, root: rig.root, fs: ports.localFs, clock, executors: [executor] });
                await manager.bootstrap();
                strictEqual(manager.stateOf(id), 'running', 'the persisted envelope still claims liveness');
                const report = await manager.describe({ id });
                strictEqual(report.verdict.health, 'stale', 'the probe surfaces the crash reconciliation — never silently healthy');
                strictEqual(report.verdict.message.includes('crash reconciliation'), true);
                // explicit reconciliation: stop then destroy reach the terminal state
                const stop = await manager.perform('stop', { id, actor: 'human' });
                ok(stop.ok, JSON.stringify(stop.ok ? '' : stop.error));
                strictEqual(manager.stateOf(id), 'stopped');
                const destroy = await manager.perform('destroy', { id, actor: 'human' });
                ok(destroy.ok, JSON.stringify(destroy.ok ? '' : destroy.error));
                strictEqual(manager.stateOf(id), 'destroyed');
        } finally {
                if (pid !== undefined && isPidAlive(pid)) {
                        try {
                                process.kill(pid, 'SIGKILL');
                        } catch {
                                // already gone
                        }
                }
                await rig.cleanup();
        }
});

// ---------------------------------------------------------------------------
// Item 9 — COMMAND SURFACE (reads never mutate; gates precede effects)
// ---------------------------------------------------------------------------

test('tl3-audit item 9: read surfaces never mutate — list/get/planFor/serialize/describe/entries/ops leave every state file byte-identical', async () => {
        const { executor } = gatedExecutor(['workspace-remote']);
        const rig = await bootMemRig({ executor, registration: workspaceRemoteRegistrationInput({ id: 'env-audit-read' }) });
        const id = 'env-audit-read';
        await rig.manager.perform('create', { id, actor: 'human' });
        await rig.manager.perform('start', { id, actor: 'human' });
        const before = new Map(rig.files);
        // the read surface (the flauz.env.list / showPlan / status command paths)
        rig.registry.list();
        rig.registry.get(id);
        rig.registry.planFor(id);
        rig.registry.serialize();
        rig.registry.verifyRoundTrip();
        await rig.manager.describe({ id });
        rig.manager.entries();
        rig.manager.ops();
        rig.manager.opAt(1);
        for (const [file, contents] of before) {
                strictEqual(rig.files.get(file), contents, `read surface mutated ${file}`);
        }
});

test('tl3-audit item 9: gates precede effects — trust/posture/PIN-2 rejections never reach the executor (the mutating-command path)', async () => {
        const { executor, controls } = gatedExecutor(['workspace-remote']);
        const rig = await bootMemRig({
                executor,
                registration: workspaceRemoteRegistrationInput({ id: 'env-audit-gate', trust: { posture: 'untrusted', inheritsWorkspaceTrust: false } }),
                extraRegistration: workspaceRemoteRegistrationInput({ id: 'env-audit-gate-never-created' }),
        });
        // trust gate: create is legal (provisioning), start on the untrusted
        // environment is the typed rejection — zero executor calls
        ok((await rig.manager.perform('create', { id: 'env-audit-gate', actor: 'agent' })).ok);
        {
                const outcome = await rig.manager.perform('start', { id: 'env-audit-gate', actor: 'agent' });
                ok(!outcome.ok);
                strictEqual(outcome.error.code, 'TRUST_POSTURE_REJECTED');
        }
        // PIN-2 state gate: mutating ops on a registered-but-never-created environment
        for (const op of ['stop', 'detach', 'snapshot', 'destroy'] as const) {
                const outcome = await rig.manager.perform(op, { id: 'env-audit-gate-never-created', actor: 'agent' });
                ok(!outcome.ok, op);
                strictEqual(outcome.error.code, 'ILLEGAL_TRANSITION', op);
        }
        deepStrictEqual([...controls.calls], ['create'], 'only the legal create reached the executor — every rejected op fired before any effect');
});
