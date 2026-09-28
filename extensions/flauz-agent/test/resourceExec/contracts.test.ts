/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Unit tests for the acquisition/release/rollback state machine
 * (src/resourceExec/contracts.ts): the six legal transitions, the typed
 * illegal-transition errors, EVERY mission failure class (PROVENANCE_INVALID,
 * LEASE_CONFLICT, TIMEOUT, SURFACE_MISMATCH, SECRET_IN_LEASE,
 * LEDGER_WRITE_FAILED), rollback completeness, idempotent release, expiry
 * via an injected fake clock, and crash recovery from the ledger.
 */
import { test } from 'node:test';
import { deepStrictEqual, match, notStrictEqual, ok, strictEqual } from 'node:assert';
import {
	LEASE_STATES,
	TASK_RESOURCES_PATH,
	canonicalJson,
} from '../../src/resourceExec/types.ts';
import {
	LEASE_TRANSITIONS,
	TaskLeaseBook,
	acquireLease,
	allowedSourceStates,
	applyLeaseTransition,
	expireDueLeases,
	failLease,
	releaseLease,
	rollbackTask,
	verifyLeaseSurface,
	type AcquisitionVerdict,
	type BookLeaseView,
	type ResourceLeaseAdapter,
	type SurfaceCheckVerdict,
} from '../../src/resourceExec/contracts.ts';
import { TaskResourceLedger } from '../../src/resourceExec/store.ts';
import { AGENT, HUMAN, TOOL, bootLeaseEnv, counterMintIds, failingWriteOnce, fixedClock, memoryFs, runtimeSecretFixture, steppingClock } from './helpers.ts';

const FIXED_TS_NOW = 1730001000000;

// ---------------------------------------------------------------------------
// A controllable fake adapter (TEST INFRASTRUCTURE -- never runtime code)
// ---------------------------------------------------------------------------

interface FakeAdapterOptions {
	readonly kind?: 'browser-session' | 'environment' | 'resource-ref';
	readonly surface?: Record<string, unknown>;
	readonly refuseCode?: 'RESOURCE_ABSENT' | 'TRUST_REFUSED' | 'SURFACE_MISMATCH' | 'STATE_UNREADABLE';
	readonly slowBy?: (clock: () => number) => void;
}

/** TEST INFRASTRUCTURE: a deterministic in-memory ResourceLeaseAdapter. */
function fakeAdapter(options: FakeAdapterOptions = {}): ResourceLeaseAdapter & { surfaceNow: Record<string, unknown> } {
	const surface = options.surface ?? { kind: 'browser', partition: 'persist:fixture' };
	const state = { surface };
	return {
		kind: options.kind ?? 'browser-session',
		surfaceNow: surface,
		async acquire(taskId, resourceId): Promise<AcquisitionVerdict> {
			if (options.slowBy !== undefined) {
				options.slowBy(clockRef!);
			}
			if (options.refuseCode !== undefined) {
				return { ok: false, code: options.refuseCode, message: `fixture refusal ${options.refuseCode}` };
			}
			return { ok: true, surfaceSnapshot: { surfaces: [{ family: 'browser', version: 1730000100000, surface: JSON.parse(JSON.stringify(state.surface)) as Record<string, unknown> }] }, opPort: 'flauz.browser.navigate' };
		},
		async release() {
			return { ok: true, outcome: 'clean', observed: 'fixture adapter: session active; teardown is the TL3 manager\'s call', opPort: 'flauz.browser.close' };
		},
		async verifySurface(_taskId, _resourceId, snapshot): Promise<SurfaceCheckVerdict> {
			const pinned = snapshot.surfaces[0]!.surface;
			if (canonicalJson(pinned) !== canonicalJson(state.surface)) {
				return { ok: false, code: 'SURFACE_MISMATCH', message: 'fixture adapter: the surface changed identity since acquisition' };
			}
			return { ok: true, current: { surfaces: [{ family: 'browser', version: 1730000200000, surface: state.surface }] } };
		},
	};
}

let clockRef: (() => number) | undefined;

test('the lease state machine has exactly six legal transitions over the pinned states', () => {
	deepStrictEqual(LEASE_STATES, ['acquiring', 'active', 'released', 'expired', 'rolled-back', 'failed']);
	strictEqual(LEASE_TRANSITIONS.length, 6, 'exactly six transition rules');
	const cases: Array<['acquiring' | 'active', 'acquire-commit' | 'acquire-fail' | 'release' | 'expire' | 'rollback' | 'fail', string]> = [
		['acquiring', 'acquire-commit', 'active'],
		['acquiring', 'acquire-fail', 'failed'],
		['active', 'release', 'released'],
		['active', 'expire', 'expired'],
		['active', 'rollback', 'rolled-back'],
		['active', 'fail', 'failed'],
	];
	for (const [from, event, to] of cases) {
		const verdict = applyLeaseTransition(from, event);
		ok(verdict.ok, `${event} from ${from} must be legal`);
		strictEqual(verdict.state, to, `${event} from ${from} -> ${to}`);
	}
});

test('illegal transitions are typed LEASE_ILLEGAL_TRANSITION errors listing the allowed source states', () => {
	const verdict = applyLeaseTransition('expired', 'release');
	ok(!verdict.ok, 'release from expired must be rejected');
	strictEqual(verdict.error.code, 'LEASE_ILLEGAL_TRANSITION');
	match(verdict.error.message, /event 'release' is not allowed from lease state 'expired'/);
	match(verdict.error.message, /allowed source states: active/);
	const rollback = applyLeaseTransition('released', 'rollback');
	ok(!rollback.ok && rollback.error.code === 'LEASE_ILLEGAL_TRANSITION');
	match(rollback.error.message, /allowed source states: active/);
	const commit = applyLeaseTransition('active', 'acquire-commit');
	ok(!commit.ok && commit.error.code === 'LEASE_ILLEGAL_TRANSITION');
	match(commit.error.message, /allowed source states: acquiring/);
	// the table pattern (TL3-003): allowedSourceStates is the public listing
	deepStrictEqual(allowedSourceStates('release'), ['active']);
	deepStrictEqual(allowedSourceStates('acquire-commit'), ['acquiring']);
});

test('PROVENANCE_INVALID: a missing or unknown actor fails loudly and is never recorded', async () => {
	const { env } = await bootLeaseEnv(memoryFs().port, fixedClock());
	const missing = await acquireLease(env, { taskId: 'T-001', resourceId: 'flauz:browser:0123456789abcdef', actor: {} as never, adapter: fakeAdapter() });
	ok(!missing.ok && missing.error.code === 'PROVENANCE_INVALID', 'a provenance object without an actor is refused');
	match(missing.error.message, /actor is MISSING/);
	const unknown = await acquireLease(env, { taskId: 'T-001', resourceId: 'flauz:browser:0123456789abcdef', actor: { actor: 'system' } as never, adapter: fakeAdapter() });
	ok(!unknown.ok && unknown.error.code === 'PROVENANCE_INVALID');
	match(unknown.error.message, /must be one of agent\|human\|tool/);
	strictEqual(env.ledger.records().length, 0, 'provenance failures are unrecordable (a record itself requires a valid actor)');
});

test('acquire commits an active lease with the pinned surface snapshot and the op port; the ledger line is canonical', async () => {
	const clock = steppingClock();
	clockRef = clock;
	const mem = memoryFs();
	const { env, ledger } = await bootLeaseEnv(mem.port, clock);
	const outcome = await acquireLease(env, { taskId: 'T-001', resourceId: 'flauz:browser:0123456789abcdef', actor: AGENT, adapter: fakeAdapter() });
	ok(outcome.ok, 'acquire must succeed');
	strictEqual(outcome.lease.state, 'active');
	strictEqual(outcome.lease.opPort, 'flauz.browser.navigate');
	deepStrictEqual(outcome.lease.surfaceSnapshot!.surfaces[0]!.surface, { kind: 'browser', partition: 'persist:fixture' });
	strictEqual(outcome.lease.leaseId, 'flauz:lease:0000000000000001', 'the injected id factory mints deterministic ids');
	strictEqual(ledger.records().length, 1);
	const raw = mem.files.get(`workspace/${TASK_RESOURCES_PATH}`)!;
	const line = raw.split('\n')[0]!;
	strictEqual(line, canonicalJson(JSON.parse(line)), 'the ledger line is canonical');
	ok(raw.endsWith('\n') && !raw.endsWith('\n\n'), 'exactly one trailing newline');
});

test('LEASE_CONFLICT: a task cannot hold two active leases for the same resource id; the refusal is recorded', async () => {
	const { env, ledger } = await bootLeaseEnv(memoryFs().port, fixedClock());
	const first = await acquireLease(env, { taskId: 'T-001', resourceId: 'flauz:browser:0123456789abcdef', actor: AGENT, adapter: fakeAdapter() });
	ok(first.ok);
	const second = await acquireLease(env, { taskId: 'T-001', resourceId: 'flauz:browser:0123456789abcdef', actor: AGENT, adapter: fakeAdapter() });
	ok(!second.ok && second.error.code === 'LEASE_CONFLICT', 'the second acquire is a typed conflict');
	match(second.error.message, /already holds active lease/);
	strictEqual(second.record?.event, 'acquire-failed', 'the conflict attempt is auditable');
	strictEqual(ledger.records().length, 2, 'acquired + acquire-failed lines');
	// a DIFFERENT task may lease the same resource (task-level obligations)
	const otherTask = await acquireLease(env, { taskId: 'T-002', resourceId: 'flauz:browser:0123456789abcdef', actor: AGENT, adapter: fakeAdapter() });
	ok(otherTask.ok, 'a different task leases the same resource id');
});

test('adapter refusals are recorded as acquire-failed lines with the typed code', async () => {
	const { env, ledger } = await bootLeaseEnv(memoryFs().port, fixedClock());
	const refused = await acquireLease(env, { taskId: 'T-001', resourceId: 'flauz:browser:0123456789abcdef', actor: AGENT, adapter: fakeAdapter({ refuseCode: 'TRUST_REFUSED' }) });
	ok(!refused.ok && refused.error.code === 'TRUST_REFUSED');
	strictEqual(refused.record?.event, 'acquire-failed');
	strictEqual((refused.record as { error: { code: string } }).error.code, 'TRUST_REFUSED');
	strictEqual(ledger.records().length, 1);
	strictEqual(env.book.activeLeasesOf('T-001').length, 0, 'no lease was minted into the book');
});

test('TIMEOUT: an acquisition deadline exceeded on the injected clock is a typed, recorded failure', async () => {
	const clock = steppingClock(1730001000000);
	clockRef = clock;
	const { env, ledger } = await bootLeaseEnv(memoryFs().port, clock);
	const adapter = fakeAdapter({ slowBy: c => { c(); c(); c(); } }); // the probe advances the fake clock past the deadline
	const outcome = await acquireLease(env, { taskId: 'T-001', resourceId: 'flauz:browser:0123456789abcdef', actor: AGENT, adapter, deadlineAt: 1730001000001 });
	ok(!outcome.ok && outcome.error.code === 'TIMEOUT', 'the deadline check is typed TIMEOUT');
	match(outcome.error.message, /exceeded its deadline/);
	strictEqual(outcome.record?.event, 'acquire-failed');
	strictEqual(ledger.records().length, 1);
	// no deadline, no failure
	const fine = await acquireLease(env, { taskId: 'T-001', resourceId: 'flauz:browser:0123456789abcdef', actor: AGENT, adapter, deadlineAt: 1730009999999 });
	ok(fine.ok, 'a deadline not exceeded acquires normally');
});

test('SECRET_IN_LEASE: a lease carrying a secret-shaped payload is refused (the no-flattening law)', async () => {
	const { env, ledger } = await bootLeaseEnv(memoryFs().port, fixedClock());
	const secret = runtimeSecretFixture('github-pat');
	const outcome = await acquireLease(env, { taskId: 'T-001', resourceId: 'flauz:browser:0123456789abcdef', actor: AGENT, adapter: fakeAdapter({ surface: { kind: 'browser', partition: 'persist:fixture', note: secret } }) });
	ok(!outcome.ok && outcome.error.code === 'SECRET_IN_LEASE', 'a secret-shaped lease is refused');
	match(outcome.error.message, /no-flattening law/);
	strictEqual(outcome.record?.event, 'acquire-failed');
	strictEqual(ledger.records().length, 1);
	const raw = JSON.stringify(ledger.records());
	ok(!raw.includes(secret), 'the secret never reaches the ledger');
});

test('LEDGER_WRITE_FAILED: a failing ledger write fails the acquire closed and leaves the book unchanged', async () => {
	const failing = failingWriteOnce(memoryFs().port);
	const ledger = new TaskResourceLedger({ root: 'workspace', fs: failing, clock: fixedClock() });
	await ledger.bootstrap();
	const book = new TaskLeaseBook();
	const env = { book, ledger, clock: fixedClock(), mintLeaseId: counterMintIds() };
	const outcome = await acquireLease(env, { taskId: 'T-001', resourceId: 'flauz:browser:0123456789abcdef', actor: AGENT, adapter: fakeAdapter() });
	ok(!outcome.ok && outcome.error.code === 'LEDGER_WRITE_FAILED', 'the write failure surfaces typed');
	strictEqual(book.activeLeasesOf('T-001').length, 0, 'the book is unchanged (durable truth first)');
});

test('release discharges an active lease; re-release is the documented idempotent no-op', async () => {
	const { env, ledger } = await bootLeaseEnv(memoryFs().port, steppingClock());
	const acquired = await acquireLease(env, { taskId: 'T-001', resourceId: 'flauz:browser:0123456789abcdef', actor: AGENT, adapter: fakeAdapter() });
	ok(acquired.ok);
	const released = await releaseLease(env, { leaseId: acquired.lease.leaseId, actor: AGENT, adapter: fakeAdapter() });
	ok(released.ok && !released.idempotent);
	strictEqual(released.state, 'released');
	strictEqual(released.outcome, 'clean');
	strictEqual(released.opPort, 'flauz.browser.close');
	const linesBefore = ledger.records().length;
	const again = await releaseLease(env, { leaseId: acquired.lease.leaseId, actor: AGENT });
	ok(again.ok && again.idempotent, 're-release is an idempotent success');
	strictEqual(ledger.records().length, linesBefore, 'no second line is minted (no fabricated teardown)');
	const view = env.book.view(acquired.lease.leaseId)!;
	strictEqual(view.state, 'released');
});

test('release from a terminal non-released state is a typed LEASE_ILLEGAL_TRANSITION', async () => {
	const { env } = await bootLeaseEnv(memoryFs().port, steppingClock());
	const acquired = await acquireLease(env, { taskId: 'T-001', resourceId: 'flauz:browser:0123456789abcdef', actor: AGENT, adapter: fakeAdapter() });
	ok(acquired.ok);
	const failed = await failLease(env, { leaseId: acquired.lease.leaseId, actor: AGENT, error: { code: 'RUNTIME_GONE', message: 'fixture runtime failure' } });
	ok(failed.ok);
	const release = await releaseLease(env, { leaseId: acquired.lease.leaseId, actor: AGENT });
	ok(!release.ok && release.error.code === 'LEASE_ILLEGAL_TRANSITION');
	match(release.error.message, /allowed source states: active/);
});

test('release of an unknown lease is RESOURCE_ABSENT', async () => {
	const { env } = await bootLeaseEnv(memoryFs().port, fixedClock());
	const outcome = await releaseLease(env, { leaseId: 'flauz:lease:ffffffffffffffff', actor: AGENT });
	ok(!outcome.ok && outcome.error.code === 'RESOURCE_ABSENT');
});

test('expiry: leases expire via the injected fake clock sweep', async () => {
	const clock = steppingClock();
	const { env, ledger } = await bootLeaseEnv(memoryFs().port, clock);
	const acquired = await acquireLease(env, { taskId: 'T-001', resourceId: 'flauz:browser:0123456789abcdef', actor: AGENT, adapter: fakeAdapter(), ttlMs: 5000 });
	ok(acquired.ok);
	strictEqual(acquired.lease.expiresAt, 1730001000000 + 5000);
	// before the deadline: the sweep expires nothing
	const early = await expireDueLeases(env, { actor: TOOL, now: 1730001004999 });
	ok(early.ok && early.records.length === 0);
	// after the deadline: exactly one expired record
	const due = await expireDueLeases(env, { actor: TOOL, now: 1730001005001 });
	ok(due.ok && due.records.length === 1, 'the sweep expires the due lease');
	strictEqual(due.records[0]!.event, 'expired');
	strictEqual(due.records[0]!.leaseId, acquired.lease.leaseId);
	strictEqual(env.book.view(acquired.lease.leaseId)!.state, 'expired');
	strictEqual(ledger.records().length, 2, 'acquired + expired');
});

test('rollback completeness: a task with 3 active leases that fails produces 3 typed release records -- none silently dropped', async () => {
	const { env, ledger } = await bootLeaseEnv(memoryFs().port, steppingClock());
	const ids: string[] = [];
	for (const resourceId of ['flauz:browser:0123456789abcdef', 'flauz:browser:fedcba9876543210', 'flauz:browser:aaaabbbbccccdddd']) {
		const acquired = await acquireLease(env, { taskId: 'T-001', resourceId, actor: AGENT, adapter: fakeAdapter() });
		ok(acquired.ok);
		ids.push(acquired.lease.leaseId);
	}
	strictEqual(env.book.activeLeasesOf('T-001').length, 3);
	const rollback = await rollbackTask(env, { taskId: 'T-001', actor: AGENT, reason: 'fixture task failure' });
	ok(rollback.ok, 'the rollback completes');
	strictEqual(rollback.records.length, 3, 'three typed rolled-back records');
	strictEqual(rollback.lines.length, 3);
	deepStrictEqual(rollback.records.map(record => record.leaseId).sort(), [...ids].sort(), 'every active lease is rolled back');
	for (const record of rollback.records) {
		strictEqual(record.event, 'rolled-back');
		strictEqual(record.reason, 'fixture task failure');
		strictEqual(env.book.view(record.leaseId)!.state, 'rolled-back');
	}
	strictEqual(env.book.activeLeasesOf('T-001').length, 0, 'no lease is silently dropped');
	strictEqual(ledger.records().length, 6, '3 acquired + 3 rolled-back lines');
});

test('SURFACE_MISMATCH: a surface identity change since acquisition is typed, never a silent pass', async () => {
	const clock = steppingClock();
	clockRef = clock;
	const { env } = await bootLeaseEnv(memoryFs().port, clock);
	const adapter = fakeAdapter();
	const acquired = await acquireLease(env, { taskId: 'T-001', resourceId: 'flauz:browser:0123456789abcdef', actor: AGENT, adapter });
	ok(acquired.ok);
	adapter.surfaceNow['partition'] = 'persist:flauz-repartitioned-9999';
	const verdict = await verifyLeaseSurface(env, { leaseId: acquired.lease.leaseId, adapter });
	ok(!verdict.ok && verdict.error.code === 'SURFACE_MISMATCH');
	match(verdict.error.message, /changed identity since acquisition/);
	// a same-identity surface still passes (a version advance is legal)
	const same = await verifyLeaseSurface(env, { leaseId: acquired.lease.leaseId, adapter: fakeAdapter({ surface: { kind: 'browser', partition: 'persist:fixture' } }) });
	ok(same.ok, 'the pinned identity still verifies');
});

test('crash recovery: a restarted task graph rebuilds its lease obligations from the ledger', async () => {
	const { port } = memoryFs();
	const clock = steppingClock();
	{
		const { env } = await bootLeaseEnv(port, clock);
		const first = await acquireLease(env, { taskId: 'T-001', resourceId: 'flauz:browser:0123456789abcdef', actor: AGENT, adapter: fakeAdapter() });
		ok(first.ok);
		const second = await acquireLease(env, { taskId: 'T-001', resourceId: 'env-build-agent', actor: AGENT, adapter: fakeAdapter({ kind: 'environment', surface: { descriptorId: 'env-build-agent', kind: 'environment', providerKind: 'ssh-local' } }) });
		ok(second.ok);
		const released = await releaseLease(env, { leaseId: first.lease.leaseId, actor: AGENT });
		ok(released.ok);
	}
	// "restart": a fresh boot over the SAME durable ledger
	const restarted = await bootLeaseEnv(port, clock);
	const active = restarted.book.activeLeasesOf('T-001');
	strictEqual(active.length, 1, 'the surviving obligation is rebuilt');
	strictEqual(active[0]!.lease.resourceId, 'env-build-agent');
	strictEqual(active[0]!.state, 'active');
	const discharged = restarted.book.view('flauz:lease:0000000000000001')!;
	strictEqual(discharged.state, 'released', 'the discharged lease rebuilds as released');
	const report = await restarted.ledger.verify();
	ok(report.ok, 'the recovered ledger verifies clean');
	strictEqual(report.records, 3);
});

test('the book replay refuses a corrupted chain (fail-closed recovery)', async () => {
	const book = new TaskLeaseBook();
	const acquired = {
		schemaVersion: 0 as const, schema: 'flauz.task-resources/v0' as const, ts: 1, actor: 'agent' as const, event: 'acquired' as const, taskId: 'T-001',
		leaseId: 'flauz:lease:0000000000000001', resourceId: 'flauz:browser:0123456789abcdef', resourceKind: 'browser-session' as const,
		lease: { schemaVersion: 0 as const, leaseId: 'flauz:lease:0000000000000001', taskId: 'T-001', resourceKind: 'browser-session' as const, resourceId: 'flauz:browser:0123456789abcdef', actor: AGENT, state: 'active' as const, acquiredAt: 1 },
	};
	const okReplay = book.replay([acquired]);
	ok(okReplay.ok);
	// double-acquire of the same lease id is a typed problem
	const bad = new TaskLeaseBook();
	const verdict = bad.replay([acquired, acquired]);
	ok(!verdict.ok && verdict.problems.length === 1);
	match(verdict.problems[0]!.message, /minted more than once/);
});

test('book queries: activeLease/activeLeasesOf/expiredLeases follow acquisition order', async () => {
	const { env } = await bootLeaseEnv(memoryFs().port, steppingClock());
	const a = await acquireLease(env, { taskId: 'T-001', resourceId: 'flauz:browser:0123456789abcdef', actor: AGENT, adapter: fakeAdapter() });
	const b = await acquireLease(env, { taskId: 'T-001', resourceId: 'flauz:browser:fedcba9876543210', actor: AGENT, adapter: fakeAdapter(), ttlMs: 1000 });
	ok(a.ok && b.ok);
	const conflictView = env.book.activeLease('T-001', 'flauz:browser:0123456789abcdef');
	ok(conflictView !== undefined);
	strictEqual((conflictView as BookLeaseView).lease.leaseId, a.lease.leaseId);
	strictEqual(env.book.activeLeasesOf('T-001').length, 2);
	strictEqual(env.book.expiredLeases(FIXED_TS_NOW + 5000).length, 1, 'only the ttl lease is due');
});

test('REQUEST_INVALID: malformed task/resource ids and arguments are typed refusals', async () => {
	const { env } = await bootLeaseEnv(memoryFs().port, fixedClock());
	const badTask = await acquireLease(env, { taskId: 'task-1', resourceId: 'flauz:browser:0123456789abcdef', actor: AGENT, adapter: fakeAdapter() });
	ok(!badTask.ok && badTask.error.code === 'REQUEST_INVALID');
	const badResource = await acquireLease(env, { taskId: 'T-001', resourceId: '/etc/passwd', actor: AGENT, adapter: fakeAdapter() });
	ok(!badResource.ok && badResource.error.code === 'REQUEST_INVALID');
	match(badResource.error.message, /never a path, never a URL/);
	const badBundle = await acquireLease(env, { taskId: 'T-001', resourceId: 'flauz:browser:0123456789abcdef', actor: AGENT, adapter: fakeAdapter(), continuityBundleId: 'not-a-bundle-id' });
	ok(!badBundle.ok && badBundle.error.code === 'REQUEST_INVALID');
});

test('release without an adapter consults nothing and claims no teardown', async () => {
	const { env } = await bootLeaseEnv(memoryFs().port, steppingClock());
	const acquired = await acquireLease(env, { taskId: 'T-001', resourceId: 'flauz:browser:0123456789abcdef', actor: AGENT, adapter: fakeAdapter() });
	ok(acquired.ok);
	const released = await releaseLease(env, { leaseId: acquired.lease.leaseId, actor: HUMAN });
	ok(released.ok);
	match(released.observed!, /no runtime effect claimed/);
	notStrictEqual(released.observed, undefined);
});
