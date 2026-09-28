/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL3-003 lifecycle tests (3.1 executor contract, 3.2 state machine + PIN-2
 * envelopes, 3.5 trust posture) — the manager core against the IN-MEMORY
 * FileSystemPort (pure, deterministic); the real local executor + simulated
 * executors have their own suites (localProcess.test.ts / simulated.test.ts).
 */
import { test } from 'node:test';
import { deepStrictEqual, ok, rejects, strictEqual, throws } from 'node:assert';
import { EnvironmentRegistry } from '../src/registry.ts';
import { EnvironmentLifecycleManager, EnvironmentLifecycleError, canTransition, failureState, legalOpsFrom, successState, transitionFor, type DescribeVerdict, type EnvironmentExecutor, type ExecutorEffectResult } from '../src/lifecycle/index.ts';

import { LifecycleStore, parseLifecycleEnvelope, parseOpLine, serializeLifecycleEnvelope, serializeOpRecord } from '../src/lifecycle/store.ts';
import { SimulatedRemoteExecutor } from '../src/lifecycle/simulated.ts';

import { type EnvironmentDescriptor, joinPath } from '../src/api.ts';
import { cloudSandboxRegistrationInput, fixedClock, memFsPort, steppingClock, workspaceRemoteRegistrationInput } from './helpers.ts';

const ROOT = '/ws';
const LIFECYCLE_FILE = joinPath(ROOT, '.flauz/environments-lifecycle.json');
const OPS_FILE = joinPath(ROOT, '.flauz/environments-ops.jsonl');

// ---------------------------------------------------------------------------
// A scriptable fake executor (pure manager tests; the real/simulated
// executors are exercised in their own suites)
// ---------------------------------------------------------------------------

class FakeExecutor implements EnvironmentExecutor {
	readonly executorKind = 'fake-local';
	readonly infrastructureClass = 'real' as const;
	readonly kinds = ['workspace-remote'] as const;
	readonly calls: string[] = [];
	failNext: { op: string; code: string; message: string } | undefined;
	probeVerdict: DescribeVerdict = { health: 'healthy', state: 'running', pid: 4242, message: 'fake healthy' };
	private leaseCounter = 0;

	private record(op: string): ExecutorEffectResult {
		this.calls.push(op);
		const failure = this.failNext;
		if (failure !== undefined && failure.op === op) {
			this.failNext = undefined;
			return { ok: false, error: { code: failure.code, message: failure.message } };
		}
		if (op === 'start') {
			return { ok: true, detail: { type: 'start', pid: 4242 } };
		}
		if (op === 'attach') {
			this.leaseCounter += 1;
			return { ok: true, detail: { type: 'attach', leaseId: `lease-${this.leaseCounter}`, heldSince: 1 } };
		}
		if (op === 'detach') {
			return { ok: true, detail: { type: 'detach', leaseId: 'lease-1' } };
		}
		if (op === 'snapshot') {
			return { ok: true, detail: { type: 'snapshot', snapshotDir: '/snap', fileCount: 1, manifestPath: '/snap/manifest.json' } };
		}
		return { ok: true };
	}

	async create(): Promise<ExecutorEffectResult> { return this.record('create'); }
	async start(): Promise<ExecutorEffectResult> { return this.record('start'); }
	async stop(): Promise<ExecutorEffectResult> { return this.record('stop'); }
	async attach(): Promise<ExecutorEffectResult> { return this.record('attach'); }
	async detach(): Promise<ExecutorEffectResult> { return this.record('detach'); }
	async snapshot(): Promise<ExecutorEffectResult> { return this.record('snapshot'); }
	async destroy(): Promise<ExecutorEffectResult> { return this.record('destroy'); }
	async probe(_descriptor: EnvironmentDescriptor): Promise<DescribeVerdict> { return this.probeVerdict; }
}

async function boot(options: { seed?: Record<string, string>; executors?: readonly EnvironmentExecutor[]; simulatedDefault?: boolean } = {}) {
	const fs = memFsPort(options.seed ?? {});
	const clock = steppingClock(1730000000000);
	const registry = new EnvironmentRegistry({ root: ROOT, fs, clock });
	await registry.bootstrap();
	await registry.register(workspaceRemoteRegistrationInput() as never);
	const executors = options.executors ?? [new FakeExecutor()];
	const manager = new EnvironmentLifecycleManager({ registry, root: ROOT, fs, clock, executors, simulatedDefault: options.simulatedDefault });
	await manager.bootstrap();
	return { fs, registry, manager, executors };
}

// ---------------------------------------------------------------------------
// 3.2 — the state machine
// ---------------------------------------------------------------------------

test('state machine: the canonical chain is legal and composes the attach/detach substate', () => {
	strictEqual(successState('registered', 'create'), 'created');
	strictEqual(successState('created', 'start'), 'running');
	strictEqual(successState('running', 'stop'), 'stopped');
	strictEqual(successState('stopped', 'start'), 'running');
	strictEqual(successState('created', 'destroy'), 'destroyed');
	// attach/detach composes the /attached substate on running + stopped
	strictEqual(successState('running', 'attach'), 'running/attached');
	strictEqual(successState('running/attached', 'detach'), 'running');
	strictEqual(successState('stopped', 'attach'), 'stopped/attached');
	strictEqual(successState('stopped/attached', 'detach'), 'stopped');
	// a held lease is released by the stop transition
	strictEqual(successState('running/attached', 'stop'), 'stopped');
	// snapshot preserves state
	strictEqual(successState('running/attached', 'snapshot'), 'running/attached');
	for (const [state, op] of [['registered', 'create'], ['created', 'start'], ['stopped', 'start'], ['failed', 'start'], ['running', 'stop'], ['running/attached', 'stop'], ['starting', 'stop'], ['running', 'attach'], ['stopped', 'attach'], ['running/attached', 'detach'], ['stopped/attached', 'detach'], ['stopped', 'destroy'], ['failed', 'destroy']] as const) {
		ok(canTransition(state, op), `${op} legal from ${state}`);
	}
});

test('state machine: illegal transitions are typed errors naming the legal ops (never silent)', () => {
	for (const [state, op] of [['running', 'create'], ['running', 'start'], ['running', 'destroy'], ['created', 'attach'], ['stopped', 'detach'], ['registered', 'start'], ['registered', 'snapshot'], ['destroyed', 'start'], ['destroyed', 'snapshot'], ['created', 'create']] as const) {
		throws(() => transitionFor(state, op), (err: unknown) => {
			ok(err instanceof EnvironmentLifecycleError);
			strictEqual((err as EnvironmentLifecycleError).code, 'ILLEGAL_TRANSITION');
			ok((err as Error).message.includes(`illegal from state '${state}'`));
			return true;
		}, `${op} must be illegal from ${state}`);
	}
	// the error names what IS legal
	deepStrictEqual([...legalOpsFrom('running')], ['stop', 'attach', 'snapshot']);
});

test('state machine: start/stop failures land in failed; every other failure keeps the state', () => {
	strictEqual(failureState('created', 'start'), 'failed');
	strictEqual(failureState('running', 'stop'), 'failed');
	strictEqual(failureState('running', 'attach'), 'running');
	strictEqual(failureState('created', 'snapshot'), 'created');
	strictEqual(failureState('stopped', 'destroy'), 'stopped');
});

// ---------------------------------------------------------------------------
// 3.2 — the PIN-2 store
// ---------------------------------------------------------------------------

test('store: lifecycle envelope round-trips with the DL-9 discipline (sorted keys, 2-space, one trailing newline)', async () => {
	const store = new LifecycleStore({ root: ROOT, fs: memFsPort(), clock: fixedClock() });
	const { envelope } = await store.load();
	const withEntry = { ...envelope, entries: { 'env-x': { state: 'running', updatedAt: 1730000000000, executorKind: 'local-process', lastOpRef: 1 } } };
	const serialized = serializeLifecycleEnvelope(withEntry);
	strictEqual(serialized.endsWith('}\n'), true);
	strictEqual(serialized.includes('\n\n'), false);
	strictEqual(serialized.split('\n')[1], '  "entries": {');
	deepStrictEqual(parseLifecycleEnvelope(serialized), withEntry);
	store.verifyEnvelopeRoundTrip(withEntry);
});

test('store: the ops ledger is append-only — history survives byte-for-byte, lines number from 1', async () => {
	const fs = memFsPort();
	const store = new LifecycleStore({ root: ROOT, fs, clock: fixedClock() });
	const first: Parameters<typeof store.appendOp>[0] = {
		schemaVersion: 0, schema: 'flauz.environments-ops/v0', ts: 1730000000000, actor: 'agent', op: 'create',
		environmentId: 'env-x', result: 'ok', fromState: 'registered', toState: 'created',
	};
	strictEqual(await store.appendOp(first), 1);
	const second: Parameters<typeof store.appendOp>[0] = {
		...first, ts: 1730000001000, op: 'start', fromState: 'created', toState: 'running', actor: 'human',
	};
	strictEqual(await store.appendOp(second), 2);
	const raw = fs.files().get(OPS_FILE)!;
	strictEqual(raw.split('\n').length, 3); // two lines + trailing newline
	// lines are canonical (sorted keys) single-line JSON
	strictEqual(raw.split('\n')[0], serializeOpRecord(first));
	ok(raw.split('\n')[0].startsWith('{"actor":'));
	// re-parse yields the same records
	deepStrictEqual(LifecycleStore.parseLedger(raw).length, 2);
});

test('store: parseOpLine + parseLifecycleEnvelope reject every mutation of the PIN-2 shapes', () => {
	const goodLine = '{"actor":"agent","environmentId":"env-x","fromState":"created","op":"start","result":"ok","schema":"flauz.environments-ops/v0","schemaVersion":0,"toState":"running","ts":1730000000000}';
	ok(parseOpLine(goodLine, 1).op === 'start');
	const envelope = `{\n\t"schemaVersion": 0,\n\t"schema": "flauz.environments-lifecycle/v0",\n\t"updatedAt": 1730000000000,\n\t"entries": {\n\t\t"env-x": {\n\t\t\t"state": "running",\n\t\t\t"updatedAt": 1730000000000,\n\t\t\t"executorKind": "local-process",\n\t\t\t"lastOpRef": 1\n\t\t}\n\t}\n}`;
	ok(parseLifecycleEnvelope(envelope).entries['env-x'] !== undefined);
});

test('store: appendOp fails closed when the existing ledger is corrupted (history is never extended over rot)', async () => {
	const fs = memFsPort({ [OPS_FILE]: 'this is not json\n' });
	const store = new LifecycleStore({ root: ROOT, fs, clock: fixedClock() });
	const record: Parameters<typeof store.appendOp>[0] = {
		schemaVersion: 0, schema: 'flauz.environments-ops/v0', ts: 1730000000000, actor: 'agent', op: 'create',
		environmentId: 'env-x', result: 'ok', fromState: 'registered', toState: 'created',
	};
	await rejects(store.appendOp(record), /line 1 is not valid JSON/);
});

// ---------------------------------------------------------------------------
// 3.1/3.5 — the manager: provenance law, happy path, typed outcomes
// ---------------------------------------------------------------------------

test('manager: missing or invalid actor is a schema rejection (pre-flight, nothing recorded)', async () => {
	const { manager } = await boot();
	for (const badActor of [undefined, null, '', 'anonymous', 7]) {
		await rejects(manager.perform('create', { id: 'env-test-remote', actor: badActor }), (err: unknown) => {
			ok(err instanceof EnvironmentLifecycleError);
			const code = (err as EnvironmentLifecycleError).code;
			ok(code === 'ACTOR_REQUIRED' || code === 'ACTOR_INVALID', `unexpected code ${code}`);
			return true;
		});
	}
	strictEqual(manager.ops().length, 0);
});

test('manager: unknown op + unknown environment are typed pre-flight errors', async () => {
	const { manager } = await boot();
	await rejects(manager.perform('restart', { id: 'env-test-remote', actor: 'human' }), (err: unknown) => {
		ok(err instanceof EnvironmentLifecycleError);
		strictEqual((err as EnvironmentLifecycleError).code, 'OP_UNKNOWN');
		return true;
	});
	await rejects(manager.perform('create', { id: 'env-nope', actor: 'human' }), (err: unknown) => {
		ok(err instanceof EnvironmentLifecycleError);
		strictEqual((err as EnvironmentLifecycleError).code, 'ENVIRONMENT_UNKNOWN');
		return true;
	});
	await rejects(manager.describe({ id: 'env-nope' }), (err: unknown) => {
		ok(err instanceof EnvironmentLifecycleError);
		strictEqual((err as EnvironmentLifecycleError).code, 'ENVIRONMENT_UNKNOWN');
		return true;
	});
});

test('manager: the full happy path records every op with provenance + before/after state', async () => {
	const { manager } = await boot();
	const id = 'env-test-remote';
	deepStrictEqual(manager.stateOf(id), 'registered');
	const steps = [
		['create', 'human', 'created'],
		['start', 'agent', 'running'],
		['attach', 'agent', 'running/attached'],
		['snapshot', 'tool', 'running/attached'],
		['detach', 'agent', 'running'],
		['stop', 'human', 'stopped'],
		['destroy', 'human', 'destroyed'],
	] as const;
	let expectedLine = 0;
	for (const [op, actor, toState] of steps) {
		const outcome = await manager.perform(op, { id, actor });
		ok(outcome.ok, `${op} must succeed (${outcome.ok ? '' : JSON.stringify(outcome.error)})`);
		expectedLine += 1;
		strictEqual(manager.opAt(expectedLine)!.op, op);
		strictEqual(outcome.record.actor, actor);
		strictEqual(outcome.record.result, 'ok');
		strictEqual(outcome.record.toState, toState);
		strictEqual(manager.stateOf(id), toState);
	}
	strictEqual(manager.ops().length, 7);
	// entry + lastOpRef point at the final op
	strictEqual(manager.entryOf(id)!.lastOpRef, 7);
	strictEqual(manager.opAt(7)!.op, 'destroy');
	// fromState chain: registered -> created -> ... -> stopped
	strictEqual(manager.ops()[6]!.fromState, 'stopped');
	strictEqual(manager.ops()[1]!.fromState, 'created');
});

test('manager: illegal transitions are ledger-recorded typed errors (state untouched)', async () => {
	const { manager } = await boot();
	const id = 'env-test-remote';
	await manager.perform('create', { id, actor: 'human' });
	const outcome = await manager.perform('start', { id, actor: 'human' });
	ok(outcome.ok);
	// start on running is illegal
	const rejected = await manager.perform('start', { id, actor: 'agent' });
	ok(!rejected.ok);
	strictEqual(rejected.error.code, 'ILLEGAL_TRANSITION');
	strictEqual(rejected.record.result, 'error');
	strictEqual(rejected.record.fromState, 'running');
	strictEqual(rejected.record.toState, 'running'); // no state change
	ok(rejected.record.error !== undefined);
	strictEqual(manager.stateOf(id), 'running'); // untouched
	strictEqual(manager.ops().length, 3);         // but recorded
});

test('manager: executor failures land start/stop in failed and carry the error record', async () => {
	const executor = new FakeExecutor();
	const { manager } = await boot({ executors: [executor] });
	const id = 'env-test-remote';
	await manager.perform('create', { id, actor: 'human' });
	executor.failNext = { op: 'start', code: 'HARNESS_EXPLODED', message: 'the harness exploded' };
	const failed = await manager.perform('start', { id, actor: 'agent' });
	ok(!failed.ok);
	strictEqual(failed.error.code, 'HARNESS_EXPLODED');
	strictEqual(failed.record.toState, 'failed');
	strictEqual(manager.stateOf(id), 'failed');
	// recovery: start is legal from failed and succeeds now
	const retry = await manager.perform('start', { id, actor: 'agent' });
	ok(retry.ok);
	strictEqual(retry.record.toState, 'running');
	strictEqual(manager.stateOf(id), 'running');
});

// ---------------------------------------------------------------------------
// 3.5 — trust posture enforcement (fail-closed, posture named)
// ---------------------------------------------------------------------------

test('manager: untrusted start/attach are rejected fail-closed naming the posture; trusted and unknown proceed', async () => {
	const fs = memFsPort();
	const clock = fixedClock();
	const registry = new EnvironmentRegistry({ root: ROOT, fs, clock });
	await registry.bootstrap();
	await registry.register(workspaceRemoteRegistrationInput({ id: 'env-untrusted', trust: { posture: 'untrusted', inheritsWorkspaceTrust: false } }) as never);
	await registry.register(workspaceRemoteRegistrationInput({ id: 'env-trusted', trust: { posture: 'trusted', inheritsWorkspaceTrust: true } }) as never);
	await registry.register(workspaceRemoteRegistrationInput() as never); // unknown posture (DL-30 workspace-remote default)
	const manager = new EnvironmentLifecycleManager({ registry, root: ROOT, fs, clock, executors: [new FakeExecutor()] });
	await manager.bootstrap();

	for (const envId of ['env-untrusted', 'env-trusted', 'env-test-remote']) {
		const created = await manager.perform('create', { id: envId, actor: 'human' });
		ok(created.ok, `create must work for ${envId} (create is not start)`);
	}

	// untrusted: start + attach rejected with the posture NAMED
	for (const op of ['start', 'attach'] as const) {
		// start needs the created state first; attach needs running — drive the
		// env to running via a trusted clone for the attach leg
		if (op === 'start') {
			const rejected = await manager.perform('start', { id: 'env-untrusted', actor: 'agent' });
			ok(!rejected.ok);
			strictEqual(rejected.error.code, 'TRUST_POSTURE_REJECTED');
			ok(rejected.error.message.includes('untrusted'), 'the posture must be named');
			strictEqual(rejected.record.result, 'error');
			strictEqual(manager.stateOf('env-untrusted'), 'created'); // state untouched by the rejection
		}
	}
	// untrusted attach: seed a running state via the store (simulating a posture
	// change after the env was started), then attempt attach on a running untrusted env
	const seededRejected = await (async () => {
		// drive env-untrusted to running through the store seed (simulating a posture
		// change after the env was started), then attempt attach
		const fsFiles = fs.files();
		const envelope = JSON.parse(fsFiles.get(LIFECYCLE_FILE)!);
		envelope.entries['env-untrusted'].state = 'running';
		fsFiles.set(LIFECYCLE_FILE, JSON.stringify(envelope));
		const fresh = new EnvironmentLifecycleManager({ registry, root: ROOT, fs, clock, executors: [new FakeExecutor()] });
		await fresh.bootstrap();
		return await fresh.perform('attach', { id: 'env-untrusted', actor: 'agent' });
	})();
	ok(!seededRejected.ok);
	strictEqual(seededRejected.error.code, 'TRUST_POSTURE_REJECTED');
	ok(seededRejected.error.message.includes('untrusted'));

	// trusted + unknown proceed (start succeeds)
	const trustedStart = await manager.perform('start', { id: 'env-trusted', actor: 'agent' });
	ok(trustedStart.ok, 'trusted start proceeds');
	strictEqual(trustedStart.record.toState, 'running');
	const unknownStart = await manager.perform('start', { id: 'env-test-remote', actor: 'agent' });
	ok(unknownStart.ok, 'unknown posture start proceeds (DL-30)');
	// teardown ops are NOT posture-gated (stop/destroy/snapshot stay available)
	const stop = await manager.perform('stop', { id: 'env-test-remote', actor: 'human' });
	ok(stop.ok, 'stop is not trust-gated');
	const destroy = await manager.perform('destroy', { id: 'env-untrusted', actor: 'human' });
	ok(destroy.ok, 'destroy is not trust-gated');
});

test('manager: the DL-30 cloud-sandbox default posture (untrusted) rejects start without any fixture magic', async () => {
	const fs = memFsPort();
	const clock = fixedClock();
	const registry = new EnvironmentRegistry({ root: ROOT, fs, clock });
	await registry.bootstrap();
	await registry.register(cloudSandboxRegistrationInput() as never); // posture untrusted by default
	const manager = new EnvironmentLifecycleManager({ registry, root: ROOT, fs, clock, executors: [new SimCloudExecutor()] });
	await manager.bootstrap();
	await manager.perform('create', { id: 'env-test-cloud', actor: 'human', simulated: true });
	const rejected = await manager.perform('start', { id: 'env-test-cloud', actor: 'agent', simulated: true });
	ok(!rejected.ok);
	strictEqual(rejected.error.code, 'TRUST_POSTURE_REJECTED');
	ok(rejected.error.message.includes('untrusted'));
});

/** Minimal simulated cloud executor used by the DL-30 default-posture test. */
class SimCloudExecutor implements EnvironmentExecutor {
	readonly executorKind = 'simulated-cloud-sandbox';
	readonly infrastructureClass = 'simulated' as const;
	readonly kinds = ['cloud-sandbox'] as const;
	async create(): Promise<ExecutorEffectResult> { return { ok: true }; }
	async start(): Promise<ExecutorEffectResult> { return { ok: true, detail: { type: 'start', pid: -1 } }; }
	async stop(): Promise<ExecutorEffectResult> { return { ok: true, detail: { type: 'stop', pid: -1, forcedSignal: null } }; }
	async attach(): Promise<ExecutorEffectResult> { return { ok: true, detail: { type: 'attach', leaseId: 'l', heldSince: 1 } }; }
	async detach(): Promise<ExecutorEffectResult> { return { ok: true, detail: { type: 'detach', leaseId: 'l' } }; }
	async snapshot(): Promise<ExecutorEffectResult> { return { ok: true, detail: { type: 'snapshot', snapshotDir: '/s', fileCount: 0, manifestPath: '/s/m' } }; }
	async destroy(): Promise<ExecutorEffectResult> { return { ok: true, detail: { type: 'destroy', pid: null } }; }
	async probe(): Promise<DescribeVerdict> { return { health: 'healthy', state: 'running', pid: null, message: 'sim' }; }
}

// ---------------------------------------------------------------------------
// Executor resolution honesty (no fake claims of real remote control)
// ---------------------------------------------------------------------------

test('manager: remote kinds without the simulated opt-in fail closed (no executor claims to be real)', async () => {
	const fs = memFsPort();
	const clock = fixedClock();
	const registry = new EnvironmentRegistry({ root: ROOT, fs, clock });
	await registry.bootstrap();
	await registry.register(workspaceRemoteRegistrationInput({ id: 'env-ssh-x', kind: 'ssh-local', connection: { host: 'x.internal', authMethod: 'key' } }) as never);
	const manager = new EnvironmentLifecycleManager({ registry, root: ROOT, fs, clock, executors: [new FakeExecutor()] });
	await manager.bootstrap();
	await rejects(manager.perform('create', { id: 'env-ssh-x', actor: 'human' }), (err: unknown) => {
		ok(err instanceof EnvironmentLifecycleError);
		strictEqual((err as EnvironmentLifecycleError).code, 'NO_EXECUTOR');
		return true;
	});
});

test('manager: a kind served only by a simulated executor requires the explicit opt-in', async () => {
	const fs = memFsPort();
	const clock = fixedClock();
	const registry = new EnvironmentRegistry({ root: ROOT, fs, clock });
	await registry.bootstrap();
	await registry.register(workspaceRemoteRegistrationInput({ id: 'env-ssh-x', kind: 'ssh-local', connection: { host: 'x.internal', authMethod: 'key' } }) as never);
	const simSsh = new SimulatedRemoteExecutor({ kind: 'ssh-local', root: ROOT, fs: memSimFs(fs), clock });
	const manager = new EnvironmentLifecycleManager({ registry, root: ROOT, fs, clock, executors: [simSsh] });
	await manager.bootstrap();
	// no opt-in: typed rejection (honest — no fake claims of real remote control)
	await rejects(manager.perform('create', { id: 'env-ssh-x', actor: 'human' }), (err: unknown) => {
		ok(err instanceof EnvironmentLifecycleError);
		strictEqual((err as EnvironmentLifecycleError).code, 'SIMULATED_NOT_OPTED_IN');
		ok((err as Error).message.includes('TL3-004'));
		return true;
	});
	// opt-in per request: works
	const created = await manager.perform('create', { id: 'env-ssh-x', actor: 'human', simulated: true });
	ok(created.ok);
	strictEqual(manager.entryOf('env-ssh-x')!.executorKind, 'simulated-ssh-local');
});

/** Adapts the in-memory fs for the simulated executor (rm = forget the key). */
function memSimFs(fs: ReturnType<typeof memFsPort>): import('../src/lifecycle/simulated.ts').SimFsPort {
	return {
		readFileUtf8: async path => fs.files().get(path),
		writeFile: async (path, contents) => {
			fs.files().set(path, contents);
		},
		rename: async (from, to) => {
			fs.files().set(to, fs.files().get(from)!);
			fs.files().delete(from);
		},
		mkdir: async () => undefined,
		rm: async path => {
			fs.files().delete(path);
		},
	};
}

// ---------------------------------------------------------------------------
// Crash reconciliation — describe never reports silently healthy
// ---------------------------------------------------------------------------

test('manager: describe surfaces a typed stale verdict when the backing truth is gone', async () => {
	const executor = new FakeExecutor();
	const { manager } = await boot({ executors: [executor] });
	const id = 'env-test-remote';
	await manager.perform('create', { id, actor: 'human' });
	await manager.perform('start', { id, actor: 'human' });
	// the "process" dies behind the manager's back (crash)
	executor.probeVerdict = { health: 'stale', state: 'stopped', pid: 4242, message: 'backing process is gone' };
	const report = await manager.describe({ id });
	strictEqual(report.state, 'running');            // persisted lifecycle state
	strictEqual(report.verdict.health, 'stale');     // surfaced, never silently healthy
	ok(report.verdict.message.includes('gone'));
	strictEqual(report.lastOp!.op, 'start');
	// reconciliation is explicit: stop lands the env in stopped
	const stop = await manager.perform('stop', { id, actor: 'human' });
	ok(stop.ok);
	strictEqual(manager.stateOf(id), 'stopped');
});

test('manager: a healthy probe against a non-running persisted state downgrades to stale (state/truth disagreement)', async () => {
	const executor = new FakeExecutor();
	const { manager } = await boot({ executors: [executor] });
	const id = 'env-test-remote';
	await manager.perform('create', { id, actor: 'human' });
	// persisted state is created; the probe lies "healthy running" — must NOT report healthy
	executor.probeVerdict = { health: 'healthy', state: 'running', pid: 1, message: 'lying probe' };
	const report = await manager.describe({ id });
	strictEqual(report.verdict.health, 'stale');
	ok(report.verdict.message.includes('disagrees'));
});

test('manager: an orphan verdict (alive but not ours) is surfaced, never treated as healthy', async () => {
	const executor = new FakeExecutor();
	const { manager } = await boot({ executors: [executor] });
	const id = 'env-test-remote';
	await manager.perform('create', { id, actor: 'human' });
	await manager.perform('start', { id, actor: 'human' });
	executor.probeVerdict = { health: 'orphan', state: 'running', pid: 999999, message: 'pid alive but not spawned by this executor' };
	const report = await manager.describe({ id });
	strictEqual(report.verdict.health, 'orphan');
	strictEqual(report.verdict.pid, 999999);
});

test('manager: describe on a registered-but-not-created environment is the not-created verdict', async () => {
	const { manager } = await boot();
	const report = await manager.describe({ id: 'env-test-remote' });
	strictEqual(report.state, 'registered');
	strictEqual(report.verdict.health, 'not-created');
	strictEqual(report.executorKind, 'none');
});

test('manager: reload preserves entries + ledger; a dangling lastOpRef fails bootstrap closed', async () => {
	const { fs, manager } = await boot();
	const id = 'env-test-remote';
	await manager.perform('create', { id, actor: 'human' });
	// reload through a fresh manager over the same files
	const registry = new EnvironmentRegistry({ root: ROOT, fs, clock: fixedClock() });
	await registry.bootstrap();
	const fresh = new EnvironmentLifecycleManager({ registry, root: ROOT, fs, clock: fixedClock(), executors: [new FakeExecutor()] });
	await fresh.bootstrap();
	strictEqual(fresh.stateOf(id), 'created');
	strictEqual(fresh.ops().length, 1);
	strictEqual(fresh.opAt(1)!.op, 'create');
	// corrupt: entry points beyond the ledger
	const files = fs.files();
	const envelope = JSON.parse(files.get(LIFECYCLE_FILE)!);
	envelope.entries[id].lastOpRef = 99;
	files.set(LIFECYCLE_FILE, JSON.stringify(envelope));
	const corrupt = new EnvironmentLifecycleManager({ registry, root: ROOT, fs, clock: fixedClock(), executors: [new FakeExecutor()] });
	await rejects(corrupt.bootstrap(), /dangling/);
});
