/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-F2B — the environments-lifecycle bounded provider-retry suite (INV-2
 * at the lifecycle seam): the manager's provider-facing op path retrying a
 * RETRYABLE typed provider error (the executor's structured providerRetryHint
 * — at this seam CLOUD_PROVIDER_ERROR from a transient HTTP class, 5xx/429),
 * bounded, recorded per attempt in the ops ledger, exhausting into the
 * EXISTING typed terminal failure; plus the real cloud executor surfacing
 * the hint end-to-end over a scripted HttpPort.
 *
 * Mirrors the landed durable-runtime precedent's suite idiom
 * (flauz-agent/test/providerRetry.test.ts — read-only precedent, PR #45):
 * engagement, the bound, per-attempt recording, exhaustion = the terminal
 * typed failure, the injectable wait (never real sleeps), non-retryable
 * classes single-shot, composability (a fresh window per explicit request),
 * and the additivity law (the off-switch is byte-identical to the
 * single-shot path).
 */
import { test } from 'node:test';
import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert';

import { EnvironmentRegistry } from '../src/registry.ts';
import {
	CloudHttpExecutor,
	EnvironmentLifecycleError,
	EnvironmentLifecycleManager,
	PROVIDER_RETRY_AFTER_CAP_MS,
	PROVIDER_RETRY_ATTEMPT_PREFIX,
	PROVIDER_RETRY_FIXED_DELAY_MS,
	PROVIDER_RETRY_MAX_ATTEMPTS_DEFAULT,
	defaultRetryWait,
	formatProviderRetryAttemptMessage,
	isRetryableProviderStatus,
	parseProviderRetryAttemptMessage,
	providerRetryWaitMs,
	readProviderRetryHint,
	resolveRetryBound,
	type EnvironmentExecutor,
	type ExecutorEffectResult,
	type ExecutorOpDetail,
	type ExecutorEffectError,
	type HttpPort,
	type ProviderRetryHint,
	type ProviderRetryOptions,
	type RetryWaitPort,
} from '../src/lifecycle/index.ts';
import { serializeOpRecord } from '../src/lifecycle/store.ts';
import { cloudSandboxRegistrationInput, memFsPort, steppingClock } from './helpers.ts';

const ROOT = '/ws';
const ENV_ID = 'env-test-cloud';

/** The deterministic no-op wait port (the test path never sleeps). */
const noWait: RetryWaitPort = async () => undefined;

/** A recording wait port — the injectable wait proof. */
function recordingWait(): { waits: number[]; wait: RetryWaitPort } {
	const waits: number[] = [];
	return { waits, wait: async ms => { waits.push(ms); } };
}

// ---------------------------------------------------------------------------
// The scripted cloud executor (hints surfaced exactly like the real one)
// ---------------------------------------------------------------------------

type ScriptEntry = { ok: true } | { ok: false; error: ExecutorEffectError } | { throw: Error };

const START_500_MESSAGE = 'cloud-sandbox POST /v0/sandboxes/sbx-1/start failed (HTTP 500): {"error":"provider exploded"}';

/** A retryable 5xx provider failure (the typed class + the structured hint). */
function provider500(message: string = START_500_MESSAGE, hint: ProviderRetryHint = { status: 500 }): ScriptEntry {
	return { ok: false, error: { code: 'CLOUD_PROVIDER_ERROR', message, providerRetryHint: hint } };
}

class ScriptedCloudExecutor implements EnvironmentExecutor {
	readonly executorKind = 'scripted-cloud';
	readonly infrastructureClass = 'real' as const;
	readonly kinds = ['cloud-sandbox'] as const;
	readonly calls: string[] = [];
	private readonly script: readonly ScriptEntry[];
	private index = 0;

	constructor(script: readonly ScriptEntry[]) {
		this.script = script;
	}

	private step(op: string): ExecutorEffectResult {
		this.calls.push(op);
		const entry = this.script[Math.min(this.index, this.script.length - 1)];
		this.index += 1;
		if ('throw' in entry) {
			throw entry.throw;
		}
		if (entry.ok) {
			return { ok: true };
		}
		return { ok: false, error: entry.error };
	}

	async create(): Promise<ExecutorEffectResult> { return this.step('create'); }
	async start(): Promise<ExecutorEffectResult> { return this.step('start'); }
	async stop(): Promise<ExecutorEffectResult> { return this.step('stop'); }
	async attach(): Promise<ExecutorEffectResult> { return this.step('attach'); }
	async detach(): Promise<ExecutorEffectResult> { return this.step('detach'); }
	async snapshot(): Promise<ExecutorEffectResult> { return this.step('snapshot'); }
	async destroy(): Promise<ExecutorEffectResult> { return this.step('destroy'); }
	async probe(): Promise<import('../src/lifecycle/index.ts').DescribeVerdict> {
		return { health: 'healthy', state: 'running', pid: 0, message: 'scripted' };
	}
}

async function bootRig(options: { script?: readonly ScriptEntry[]; providerRetry?: ProviderRetryOptions; wait?: RetryWaitPort } = {}) {
	const fs = memFsPort({});
	const clock = steppingClock(1730000000000);
	const registry = new EnvironmentRegistry({ root: ROOT, fs, clock });
	await registry.bootstrap();
	await registry.register(cloudSandboxRegistrationInput({ trust: { posture: 'trusted', inheritsWorkspaceTrust: false } }) as never);
	const executor = new ScriptedCloudExecutor(options.script ?? []);
	const manager = new EnvironmentLifecycleManager({
		registry,
		root: ROOT,
		fs,
		clock,
		executors: [executor],
		...(options.providerRetry === undefined ? {} : { providerRetry: options.providerRetry }),
		...(options.wait === undefined ? {} : { providerRetryWait: options.wait }),
	});
	await manager.bootstrap();
	return { fs, clock, registry, executor, manager };
}

/** The ops rows whose error message is an attempt row (the parseable grammar). */
function attemptRows(manager: EnvironmentLifecycleManager) {
	return manager.ops().filter(record => record.error !== undefined && record.error.message.startsWith(PROVIDER_RETRY_ATTEMPT_PREFIX));
}

// ---------------------------------------------------------------------------
// The pure policy surface
// ---------------------------------------------------------------------------

test('retry policy: resolveRetryBound — absent -> the default 3; configured respected; invalid typed-throws', () => {
	strictEqual(resolveRetryBound(undefined), PROVIDER_RETRY_MAX_ATTEMPTS_DEFAULT);
	strictEqual(resolveRetryBound(null), PROVIDER_RETRY_MAX_ATTEMPTS_DEFAULT);
	strictEqual(resolveRetryBound({}), PROVIDER_RETRY_MAX_ATTEMPTS_DEFAULT);
	strictEqual(resolveRetryBound({ maxAttempts: 5 }), 5);
	strictEqual(resolveRetryBound({ maxAttempts: 1 }), 1);
	for (const invalid of [{ maxAttempts: 0 }, { maxAttempts: -1 }, { maxAttempts: 2.5 }, { maxAttempts: '3' }, { bogus: 1 }, 3, 'x']) {
		throws(() => resolveRetryBound(invalid), (err: unknown) => {
			ok(err instanceof EnvironmentLifecycleError);
			strictEqual((err as EnvironmentLifecycleError).code, 'RETRY_CONFIG_INVALID');
			return true;
		}, `invalid config ${JSON.stringify(invalid)} must be the typed fail-closed throw`);
	}
});

test('retry policy: readProviderRetryHint — well-formed hints pass; absent/malformed never retry (fail-closed)', () => {
	strictEqual(readProviderRetryHint(undefined), null);
	strictEqual(readProviderRetryHint({ code: 'CLOUD_SANDBOX_UNKNOWN', message: 'gone' }), null);
	strictEqual(readProviderRetryHint({ code: 'CLOUD_PROVIDER_ERROR', message: 'x', providerRetryHint: { status: '500' } as unknown as ProviderRetryHint }), null);
	strictEqual(readProviderRetryHint({ code: 'CLOUD_PROVIDER_ERROR', message: 'x', providerRetryHint: { status: 200 } }), null);
	strictEqual(readProviderRetryHint({ code: 'CLOUD_PROVIDER_ERROR', message: 'x', providerRetryHint: { status: 500, retryAfterMs: -5 } }), null);
	strictEqual(readProviderRetryHint({ code: 'CLOUD_PROVIDER_ERROR', message: 'x', providerRetryHint: { status: 500, retryAfterMs: 'soon' } as unknown as ProviderRetryHint }), null);
	deepStrictEqual(readProviderRetryHint({ code: 'CLOUD_PROVIDER_ERROR', message: 'x', providerRetryHint: { status: 500 } }), { status: 500 });
	deepStrictEqual(readProviderRetryHint({ code: 'CLOUD_PROVIDER_ERROR', message: 'x', providerRetryHint: { status: 429, retryAfterMs: 120 } }), { status: 429, retryAfterMs: 120 });
});

test('retry policy: the retryable status table — 5xx and the network-ish 429 only', () => {
	for (const retryable of [500, 502, 503, 504, 550, 599, 429]) {
		ok(isRetryableProviderStatus(retryable), `HTTP ${retryable} is retryable`);
	}
	for (const terminal of [400, 401, 403, 404, 409, 422, 428, 451]) {
		ok(!isRetryableProviderStatus(terminal), `HTTP ${terminal} is NOT retryable`);
	}
});

test('retry policy: providerRetryWaitMs — the honored hint capped; the minimal fixed delay otherwise', () => {
	strictEqual(providerRetryWaitMs({ status: 503 }), PROVIDER_RETRY_FIXED_DELAY_MS);
	strictEqual(providerRetryWaitMs({ status: 503, retryAfterMs: 120 }), 120);
	strictEqual(providerRetryWaitMs({ status: 503, retryAfterMs: 60_000 }), PROVIDER_RETRY_AFTER_CAP_MS);
	strictEqual(providerRetryWaitMs({ status: 429, retryAfterMs: 999_999_999 }), PROVIDER_RETRY_AFTER_CAP_MS);
});

test('retry policy: the attempt-row grammar round-trips through format/parse (truncation-safe prefix)', () => {
	const facts = { ordinal: 2, maxAttempts: 3, op: 'start' as const, code: 'CLOUD_PROVIDER_ERROR', waitAppliedMs: 25, nextAttemptOrdinal: 3 };
	const message = formatProviderRetryAttemptMessage(facts, START_500_MESSAGE);
	deepStrictEqual(parseProviderRetryAttemptMessage(message), facts);
	const exhaustedFacts = { ordinal: 3, maxAttempts: 3, op: 'start' as const, code: 'CLOUD_PROVIDER_ERROR', waitAppliedMs: 25 };
	const exhaustedMessage = formatProviderRetryAttemptMessage(exhaustedFacts, START_500_MESSAGE);
	deepStrictEqual(parseProviderRetryAttemptMessage(exhaustedMessage), exhaustedFacts);
	// the manager caps at 300 chars with the ellipsis marker — the parseable prefix survives
	const capped = `${formatProviderRetryAttemptMessage(facts, 'x'.repeat(400)).slice(0, 299)}…`;
	deepStrictEqual(parseProviderRetryAttemptMessage(capped), facts);
	// non-attempt messages parse to undefined — never a false positive
	strictEqual(parseProviderRetryAttemptMessage(START_500_MESSAGE), undefined);
	strictEqual(parseProviderRetryAttemptMessage(undefined), undefined);
	strictEqual(parseProviderRetryAttemptMessage('provider retry attempt 2/3 on start: CODE (wait 25ms, next attempt 4) - x'), undefined);
});

test('retry policy: defaultRetryWait(0) resolves without a timer', async () => {
	await defaultRetryWait(0); // the deterministic posture — no real sleep
});

// ---------------------------------------------------------------------------
// The manager's bounded window (the scripted executor surfacing hints)
// ---------------------------------------------------------------------------

test('retry: a retryable 5xx engages the DEFAULT-bounded window — exactly 3 attempts, recorded, exhausted terminal', async () => {
	const { waits, wait } = recordingWait();
	const rig = await bootRig({ script: [{ ok: true }, provider500()], wait }); // create succeeds first; no providerRetry option: the default-on posture
	const opts = { id: ENV_ID, actor: 'human' as const };
	await rig.manager.perform('create', opts);
	const failed = await rig.manager.perform('start', opts);
	ok(!failed.ok, 'the exhausted window is the typed failure — never a silent success');
	strictEqual(failed.error.code, 'CLOUD_PROVIDER_ERROR');
	strictEqual(failed.error.message, START_500_MESSAGE, 'the terminal outcome carries the executor message byte-identically');
	strictEqual(rig.manager.stateOf(ENV_ID), 'failed');
	strictEqual(rig.executor.calls.filter(call => call === 'start').length, 3, 'exactly the default bound of provider calls');
	deepStrictEqual(waits, [PROVIDER_RETRY_FIXED_DELAY_MS, PROVIDER_RETRY_FIXED_DELAY_MS], 'the injectable wait port carried the fixed delay (never real sleeps)');
	const ops = rig.manager.ops();
	strictEqual(ops.length, 5, 'create + 3 attempt rows + the request-level failure row');
	const facts = attemptRows(rig.manager).map(record => parseProviderRetryAttemptMessage(record.error!.message));
	deepStrictEqual(facts.map(fact => fact!.ordinal), [1, 2, 3]);
	deepStrictEqual(facts.map(fact => fact!.maxAttempts), [3, 3, 3]);
	deepStrictEqual(facts.map(fact => fact!.code), ['CLOUD_PROVIDER_ERROR', 'CLOUD_PROVIDER_ERROR', 'CLOUD_PROVIDER_ERROR']);
	deepStrictEqual(facts.map(fact => fact!.waitAppliedMs), [0, 25, 25]);
	deepStrictEqual(facts.map(fact => fact!.nextAttemptOrdinal), [2, 3, undefined]);
	deepStrictEqual(facts.map(fact => fact!.op), ['start', 'start', 'start']);
	for (const row of ops.slice(1, 4)) {
		strictEqual(row.fromState, 'starting', 'the attempt rows ride the in-flight transient phase');
		strictEqual(row.toState, 'starting');
		strictEqual(row.actor, 'human', 'provenance is preserved on every attempt row');
	}
	strictEqual(ops[4]!.fromState, 'created');
	strictEqual(ops[4]!.toState, 'failed', 'the request-level failure row lands the failed transition');
});

test('retry: a configured bound is respected exactly (maxAttempts 2 -> 2 calls, 2 attempt rows)', async () => {
	const rig = await bootRig({ script: [{ ok: true }, provider500()], providerRetry: { maxAttempts: 2 }, wait: noWait });
	const opts = { id: ENV_ID, actor: 'human' as const };
	await rig.manager.perform('create', opts);
	const failed = await rig.manager.perform('start', opts);
	ok(!failed.ok);
	strictEqual(rig.executor.calls.filter(call => call === 'start').length, 2);
	strictEqual(attemptRows(rig.manager).length, 2);
	const facts = attemptRows(rig.manager).map(record => parseProviderRetryAttemptMessage(record.error!.message));
	deepStrictEqual(facts.map(fact => fact!.ordinal), [1, 2]);
	deepStrictEqual(facts.map(fact => fact!.nextAttemptOrdinal), [2, undefined]);
});

test('retry: the network-ish 429 IS retryable (the classification engages the window)', async () => {
	const rig = await bootRig({ script: [{ ok: true }, provider500('cloud-sandbox POST /v0/sandboxes/sbx-1/start failed (HTTP 429): rate limited', { status: 429, retryAfterMs: 40 })], wait: noWait });
	const opts = { id: ENV_ID, actor: 'human' as const };
	await rig.manager.perform('create', opts);
	const failed = await rig.manager.perform('start', opts);
	ok(!failed.ok);
	strictEqual(rig.executor.calls.filter(call => call === 'start').length, 3);
	strictEqual(attemptRows(rig.manager).length, 3);
});

test('retry: exhaustion is the EXISTING typed terminal failure — the request-level row is byte-identical to the single-shot path', async () => {
	const message = 'cloud-sandbox POST /v0/sandboxes/sbx-1/start failed (HTTP 503): {"error":"overloaded"}';
	const exhausted = await bootRig({ script: [{ ok: true }, { ok: false, error: { code: 'CLOUD_PROVIDER_ERROR', message, providerRetryHint: { status: 503 } } }], wait: noWait });
	const single = await bootRig({ script: [{ ok: true }, { ok: false, error: { code: 'CLOUD_PROVIDER_ERROR', message } }], wait: noWait }); // create ok, then a hint-less failure: the true pre-F2B single-shot posture
	const opts = { id: ENV_ID, actor: 'human' as const };
	await exhausted.manager.perform('create', opts);
	const failedExhausted = await exhausted.manager.perform('start', opts);
	await single.manager.perform('create', opts);
	const failedSingle = await single.manager.perform('start', opts);
	// the typed OUTCOMES are identical
	deepStrictEqual(failedExhausted.error, failedSingle.error);
	// the request-level failure rows serialize identically (byte parity)
	const rowsExhausted = exhausted.manager.ops().filter(record => record.op === 'start' && record.result === 'error' && parseProviderRetryAttemptMessage(record.error!.message) === undefined);
	const rowsSingle = single.manager.ops().filter(record => record.op === 'start');
	strictEqual(rowsExhausted.length, 1);
	strictEqual(rowsSingle.length, 1);
	strictEqual(serializeOpRecord(rowsExhausted[0]!), serializeOpRecord(rowsSingle[0]!));
	// the ledger: the single-shot file is exactly [create, start]; the exhausted file
	// adds ONLY the attempt rows between the unchanged create/start lines
	const lines = (rig: Awaited<ReturnType<typeof bootRig>>) => (rig.fs.files().get(`${ROOT}/.flauz/environments-ops.jsonl`) ?? '').split('\n').filter(line => line.length > 0);
	deepStrictEqual(lines(single).length, 2);
	deepStrictEqual(lines(exhausted).length, 5);
	strictEqual(lines(single)[0], lines(exhausted)[0]);
	strictEqual(lines(single)[1], lines(exhausted)[4]);
});

test('retry: non-retryable error classes stay single-shot byte-identically (no hint / 4xx hint / malformed hint)', async () => {
	const cases: Array<{ name: string; error: ExecutorEffectError }> = [
		{ name: 'the 404-mapped class carries no hint', error: { code: 'CLOUD_SANDBOX_UNKNOWN', message: 'cloud-sandbox POST /v0/sandboxes/sbx-1/start: the provider no longer knows this sandbox (HTTP 404)' } },
		{ name: 'a 4xx CLOUD_PROVIDER_ERROR hint is not retryable', error: { code: 'CLOUD_PROVIDER_ERROR', message: 'cloud-sandbox POST /v0/sandboxes/sbx-1/start failed (HTTP 400): bad template', providerRetryHint: { status: 400 } } },
		{ name: 'a malformed hint never retries (fail-closed)', error: { code: 'CLOUD_PROVIDER_ERROR', message: 'cloud-sandbox POST /v0/sandboxes/sbx-1/start failed (HTTP 500): boom', providerRetryHint: { status: '500' } as unknown as ProviderRetryHint } },
		{ name: 'the auth class carries no hint', error: { code: 'CLOUD_AUTH_FAILED', message: 'rejected as unauthorized (HTTP 401)' } },
	];
	for (const testCase of cases) {
		const rig = await bootRig({ script: [{ ok: true }, { ok: false, error: testCase.error }], wait: noWait });
		const opts = { id: ENV_ID, actor: 'human' as const };
		await rig.manager.perform('create', opts);
		const failed = await rig.manager.perform('start', opts);
		ok(!failed.ok, testCase.name);
		strictEqual(failed.error.code, testCase.error.code, testCase.name);
		strictEqual(rig.executor.calls.filter(call => call === 'start').length, 1, `${testCase.name}: exactly one provider call`);
		strictEqual(attemptRows(rig.manager).length, 0, `${testCase.name}: no attempt rows`);
		strictEqual(rig.manager.ops().length, 2, `${testCase.name}: the ledger is exactly [create, start-error]`);
	}
});

test('retry: a thrown executor is never retried (outcome-unknown — the EXECUTOR_THREW single-shot path)', async () => {
	const rig = await bootRig({ script: [{ ok: true }, { throw: new Error('lost response mid-flight') }], wait: noWait });
	const opts = { id: ENV_ID, actor: 'human' as const };
	await rig.manager.perform('create', opts);
	const failed = await rig.manager.perform('start', opts);
	ok(!failed.ok);
	strictEqual(failed.error.code, 'EXECUTOR_THREW');
	strictEqual(rig.executor.calls.filter(call => call === 'start').length, 1);
	strictEqual(attemptRows(rig.manager).length, 0);
});

test('retry: the additivity law — maxAttempts 1 is the off-switch (byte-identical ledger to the single-shot posture)', async () => {
	const message = START_500_MESSAGE;
	const off = await bootRig({ script: [{ ok: true }, { ok: false, error: { code: 'CLOUD_PROVIDER_ERROR', message, providerRetryHint: { status: 500 } } }], providerRetry: { maxAttempts: 1 }, wait: noWait });
	const base = await bootRig({ script: [{ ok: true }, { ok: false, error: { code: 'CLOUD_PROVIDER_ERROR', message } }], wait: noWait }); // hint-less: the pre-F2B behavior
	const opts = { id: ENV_ID, actor: 'human' as const };
	await off.manager.perform('create', opts);
	const failedOff = await off.manager.perform('start', opts);
	await base.manager.perform('create', opts);
	const failedBase = await base.manager.perform('start', opts);
	ok(!failedOff.ok && !failedBase.ok);
	strictEqual(off.executor.calls.filter(call => call === 'start').length, 1, 'the off-switch performs exactly one provider call');
	strictEqual(attemptRows(off.manager).length, 0);
	const ledgerOff = off.fs.files().get(`${ROOT}/.flauz/environments-ops.jsonl`)!;
	const ledgerBase = base.fs.files().get(`${ROOT}/.flauz/environments-ops.jsonl`)!;
	strictEqual(ledgerOff, ledgerBase, 'the ops ledger is byte-identical to the pre-F2B single-shot posture');
});

test('retry: composability — an explicit retry after exhaustion opens a FRESH window', async () => {
	const rig = await bootRig({ script: [{ ok: true }, provider500(), provider500(), provider500(), { ok: true }], wait: noWait });
	const opts = { id: ENV_ID, actor: 'human' as const };
	await rig.manager.perform('create', opts);
	const failed = await rig.manager.perform('start', opts);
	ok(!failed.ok);
	strictEqual(rig.executor.calls.filter(call => call === 'start').length, 3, 'the first window exhausts its bound');
	const recovered = await rig.manager.perform('start', opts);
	ok(recovered.ok, 'the caller-driven retry succeeds after provider recovery');
	strictEqual(rig.executor.calls.filter(call => call === 'start').length, 4, 'the fresh window starts at attempt 1 (one more call)');
	strictEqual(rig.manager.stateOf(ENV_ID), 'running');
	const ops = rig.manager.ops();
	strictEqual(ops.length, 6, 'create + 3 attempt rows + request-level failure + request-level ok');
	strictEqual(ops[5]!.result, 'ok');
	strictEqual(ops[5]!.fromState, 'failed', 'the second explicit start rides the failed -> running transition');
	strictEqual(ops[5]!.toState, 'running');
	strictEqual(attemptRows(rig.manager).length, 3, 'the fresh first-attempt-success window mints no attempt rows');
});

test('retry: within-window recovery — a later attempt succeeds and the request-level ok row closes the window', async () => {
	const { waits, wait } = recordingWait();
	const rig = await bootRig({ script: [{ ok: true }, provider500(), { ok: true }], wait });
	const opts = { id: ENV_ID, actor: 'human' as const };
	await rig.manager.perform('create', opts);
	const recovered = await rig.manager.perform('start', opts);
	ok(recovered.ok);
	strictEqual(rig.executor.calls.filter(call => call === 'start').length, 2);
	deepStrictEqual(waits, [PROVIDER_RETRY_FIXED_DELAY_MS]);
	const ops = rig.manager.ops();
	strictEqual(ops.length, 3, 'create + 1 attempt row + the request-level ok row');
	const facts = attemptRows(rig.manager).map(record => parseProviderRetryAttemptMessage(record.error!.message));
	deepStrictEqual(facts.map(fact => fact!.nextAttemptOrdinal), [2], 'the attempt row names the recovered attempt ordinal (2)');
	strictEqual(ops[2]!.result, 'ok');
	strictEqual(ops[2]!.toState, 'running');
});

test('retry: the provider-facing scope — create and stop retry on their in-flight states too', async () => {
	const createRig = await bootRig({ script: [provider500('cloud-sandbox POST /v0/sandboxes failed (HTTP 500): {"error":"overloaded"}')], wait: noWait });
	const createFailed = await createRig.manager.perform('create', { id: ENV_ID, actor: 'human' });
	ok(!createFailed.ok);
	strictEqual(createFailed.error.code, 'CLOUD_PROVIDER_ERROR');
	strictEqual(createRig.executor.calls.filter(call => call === 'create').length, 3);
	strictEqual(attemptRows(createRig.manager).length, 3);
	for (const row of attemptRows(createRig.manager)) {
		strictEqual(row.fromState, 'registered', 'a create attempt row rides the pre-entry state');
		strictEqual(row.toState, 'registered');
	}
	strictEqual(createRig.manager.entryOf(ENV_ID), undefined, 'a failed create still mints no entry');

	const stopRig = await bootRig({ script: [{ ok: true }, { ok: true }, provider500('cloud-sandbox POST /v0/sandboxes/sbx-1/stop failed (HTTP 500): {"error":"overloaded"}')], wait: noWait });
	const opts = { id: ENV_ID, actor: 'human' as const };
	await stopRig.manager.perform('create', opts);
	await stopRig.manager.perform('start', opts);
	const stopFailed = await stopRig.manager.perform('stop', opts);
	ok(!stopFailed.ok);
	strictEqual(stopRig.executor.calls.filter(call => call === 'stop').length, 3);
	strictEqual(stopRig.manager.stateOf(ENV_ID), 'failed', 'a failed stop lands in failed (the landed transition table)');
	for (const row of attemptRows(stopRig.manager)) {
		strictEqual(row.fromState, 'stopping', 'a stop attempt row rides the in-flight stopping phase');
		strictEqual(row.toState, 'stopping');
	}
});

test('retry: the engaged-window ledger round-trips — a fresh bootstrap reloads the attempt rows without STORE_CORRUPT', async () => {
	const rig = await bootRig({ script: [{ ok: true }, provider500()], wait: noWait });
	const opts = { id: ENV_ID, actor: 'human' as const };
	await rig.manager.perform('create', opts);
	await rig.manager.perform('start', opts);
	const fresh = new EnvironmentLifecycleManager({ registry: rig.registry, root: ROOT, fs: rig.fs, clock: rig.clock, executors: [new ScriptedCloudExecutor([])] });
	await fresh.bootstrap(); // any PIN-2 shape drift would throw STORE_CORRUPT here
	strictEqual(fresh.ops().length, 5);
	strictEqual(fresh.stateOf(ENV_ID), 'failed');
	strictEqual(fresh.opAt(2)!.error!.message.startsWith(PROVIDER_RETRY_ATTEMPT_PREFIX), true, 'the attempt row reloads as a first-class ledger line');
});

test('retry: an invalid providerRetry manager config is the typed fail-closed constructor throw', async () => {
	const fs = memFsPort({});
	const registry = new EnvironmentRegistry({ root: ROOT, fs, clock: steppingClock(1730000000000) });
	const base = { registry, root: ROOT, fs, executors: [new ScriptedCloudExecutor([])] as readonly EnvironmentExecutor[] };
	throws(() => new EnvironmentLifecycleManager({ ...base, providerRetry: { maxAttempts: 0 } }), (err: unknown) => {
		ok(err instanceof EnvironmentLifecycleError);
		strictEqual((err as EnvironmentLifecycleError).code, 'RETRY_CONFIG_INVALID');
		return true;
	});
	throws(() => new EnvironmentLifecycleManager({ ...base, providerRetry: { maxAttempts: '3' } as unknown as ProviderRetryOptions }));
	throws(() => new EnvironmentLifecycleManager({ ...base, providerRetry: 3 as unknown as ProviderRetryOptions }));
});

// ---------------------------------------------------------------------------
// The REAL cloud executor end-to-end (the hint surfaced over a scripted port)
// ---------------------------------------------------------------------------

interface StubResponse {
	readonly status: number;
	readonly bodyText: string;
	readonly headers?: Record<string, string>;
}

/** A scripted HttpPort double with response headers (the battery's ScriptedHttpPort pattern + the retry-after surface). */
function stubHttpPort(startResponses: readonly StubResponse[]): HttpPort & { callsOf(method: string, path: string): number } {
	const calls: Array<{ method: string; path: string }> = [];
	const startQueue = [...startResponses];
	const port: HttpPort = {
		fetch: async request => {
			const path = request.url.replace(/^https?:\/\/[^/]+/, '');
			calls.push({ method: request.method, path });
			if (request.method === 'POST' && path === '/v0/sandboxes') {
				return { status: 200, bodyText: JSON.stringify({ sandboxId: 'sbx-1', status: 'created' }) };
			}
			if (request.method === 'POST' && path === '/v0/sandboxes/sbx-1/start') {
				return startQueue.length > 0 ? startQueue.shift()! : { status: 200, bodyText: JSON.stringify({ status: 'running' }) };
			}
			return { status: 404, bodyText: JSON.stringify({ error: 'no scripted route' }) };
		},
	};
	return { ...port, callsOf: (method, path) => calls.filter(call => call.method === method && call.path === path).length };
}

async function bootCloudRig(startResponses: readonly StubResponse[], wait: RetryWaitPort) {
	const fs = memFsPort({});
	const clock = steppingClock(1730000000000);
	const registry = new EnvironmentRegistry({ root: ROOT, fs, clock });
	await registry.bootstrap();
	await registry.register(cloudSandboxRegistrationInput({ trust: { posture: 'trusted', inheritsWorkspaceTrust: false } }) as never);
	const http = stubHttpPort(startResponses);
	const cloud = new CloudHttpExecutor({
		root: ROOT,
		http,
		secrets: { resolve: async ref => ref === 'vault:cloud-e2b-key' ? 'test-key-material' : undefined },
		baseUrl: 'https://cloud.invalid',
		fs,
		hash: { sha256Hex: contents => `sha256:${contents.length}` },
		clock,
		requestTimeoutMs: 2_000,
	});
	const manager = new EnvironmentLifecycleManager({ registry, root: ROOT, fs, clock, executors: [cloud], providerRetryWait: wait });
	await manager.bootstrap();
	return { fs, registry, http, manager };
}

test('retry (real executor): a 5xx start engages the bounded window through the surfaced hint, end-to-end', async () => {
	const { waits, wait } = recordingWait();
	const rig = await bootCloudRig(Array.from({ length: 5 }, () => ({ status: 500, bodyText: JSON.stringify({ error: 'provider exploded' }) })), wait);
	const opts = { id: ENV_ID, actor: 'human' as const };
	await rig.manager.perform('create', opts);
	const failed = await rig.manager.perform('start', opts);
	ok(!failed.ok);
	strictEqual(failed.error.code, 'CLOUD_PROVIDER_ERROR');
	ok(failed.error.message.includes('500'));
	strictEqual(rig.http.callsOf('POST', '/v0/sandboxes/sbx-1/start'), 3, 'the bound stops the calls at 3 despite 5 queued failures');
	deepStrictEqual(waits, [PROVIDER_RETRY_FIXED_DELAY_MS, PROVIDER_RETRY_FIXED_DELAY_MS]);
	const facts = attemptRows(rig.manager).map(record => parseProviderRetryAttemptMessage(record.error!.message));
	deepStrictEqual(facts.map(fact => fact!.ordinal), [1, 2, 3]);
	strictEqual(rig.manager.stateOf(ENV_ID), 'failed');
});

test('retry (real executor): the honored Retry-After hint rides the response headers into the wait', async () => {
	const { waits, wait } = recordingWait();
	const rig = await bootCloudRig([
		{ status: 503, bodyText: '{}', headers: { 'retry-after': '2' } },
		{ status: 503, bodyText: '{}', headers: { 'retry-after': '2' } },
		{ status: 503, bodyText: '{}', headers: { 'retry-after': '2' } },
	], wait);
	const opts = { id: ENV_ID, actor: 'human' as const };
	await rig.manager.perform('create', opts);
	const failed = await rig.manager.perform('start', opts);
	ok(!failed.ok);
	deepStrictEqual(waits, [2_000, 2_000], 'the provider hint (2s) is honored between attempts');
	strictEqual(rig.http.callsOf('POST', '/v0/sandboxes/sbx-1/start'), 3);
});

test('retry (real executor): the 404 sandbox-vanished class stays single-shot (INV-8 depends on it)', async () => {
	const rig = await bootCloudRig([{ status: 404, bodyText: JSON.stringify({ error: 'sandbox vanished' }) }], noWait);
	const opts = { id: ENV_ID, actor: 'human' as const };
	await rig.manager.perform('create', opts);
	const failed = await rig.manager.perform('start', opts);
	ok(!failed.ok);
	strictEqual(failed.error.code, 'CLOUD_SANDBOX_UNKNOWN');
	strictEqual(rig.http.callsOf('POST', '/v0/sandboxes/sbx-1/start'), 1);
	strictEqual(attemptRows(rig.manager).length, 0);
	strictEqual(rig.manager.stateOf(ENV_ID), 'failed');
});
