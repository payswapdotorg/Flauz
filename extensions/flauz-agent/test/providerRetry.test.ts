/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-F2 suite: the bounded, recorded provider-retry executor (the INV-2
 * product contract) - core/providerRetry.mjs + the runtime wiring.
 *
 * The six contract facts of the packet (M3 a-f), plus the recovery window,
 * the DL-53 outcome-unknown discipline and the journal replay legality:
 *
 *   (a) retryable typed provider error -> exactly maxAttempts provider calls,
 *       per-attempt journal rows that verify in the hash chain, then the
 *       TERMINAL typed failure (retryPlanned pinned false - exhaustion is
 *       terminal, never a silent success);
 *   (b) terminal-class typed provider error -> 1 call, NO retry rows, the
 *       immediate typed failure (regression of the existing honest path);
 *   (c) retryAfterMs honored, capped at 30s, immediate when absent - proven
 *       through the INJECTED wait port (the clock/wait the harness controls);
 *   (d) absent config -> the default bound 3; a configured value respected;
 *       an invalid config throws a typed error (fail-closed, never defaulted);
 *   (e) caller-driven retries compose ABOVE the automatic loop: an explicit
 *       retryStep opens a FRESH bounded window with a FRESH idempotency key;
 *   (f) zero-network posture (DL-37): the retry loop never enables a provider.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrchestrationStore } from '../core/orchStore.mjs';
import { driveGraph } from '../core/runtime.mjs';
import { journalLine, validateJournalPayload, type JournalRow } from '../core/orchestration.mjs';
import {
	PROVIDER_RETRY_MAX_ATTEMPTS_DEFAULT,
	RETRY_AFTER_CAP_MS,
	defaultProviderRetryWait,
	isRetryableProviderError,
	providerAttemptKeyOf,
	providerRetryWaitMs,
	readProviderError,
	resolveProviderRetryBound,
	runProviderCallWithBoundedRetry,
} from '../core/providerRetry.mjs';
import { makeClock } from './harness/orchWorkspace.ts';

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

const CLOCK_BASE = 1700000000000;
const FAR_FUTURE = 1893456000000;

function makeRoot(): string {
	return mkdtempSync(join(tmpdir(), 'flauz-provider-retry-'));
}

function makeStore(root: string, clockBase = CLOCK_BASE): OrchestrationStore {
	const { clock } = makeClock(clockBase);
	return new OrchestrationStore(root, { clock });
}

/** The DL-35 code -> orchestration failure class mapping (the DL-69-style bridge). */
const CODE_TO_FAILURE_CLASS: Record<string, string> = {
	PROVIDER_OVERLOADED: 'unavailable',
	RATE_LIMITED: 'unavailable',
	NETWORK_ERROR: 'unavailable',
	TIMEOUT: 'timeout',
	AUTH_FAILED: 'permanent',
	NOT_FOUND: 'permanent',
};

/**
 * The scripted provider sink: a provider double that NEVER enables itself
 * (the zero-network posture) and surfaces TYPED DL-35 provider errors on
 * failed calls. `script` is the ordered per-provider-attempt outcomes.
 */
class ProviderScriptedSink {
	/** Zero-network posture: false until an EXPLICIT enable() - the retry loop must never flip it. */
	enabled = false;
	readonly calls: Array<{ key: string; spec: unknown }> = [];
	readonly methodCalls: string[] = [];
	private readonly script: Array<{ ok: true; value: string } | { ok: false; providerError: { code: string; retryClass: string; retryAfterMs?: number } }>;
	private scriptIndex = 0;

	constructor(script: Array<Record<string, unknown>>) {
		this.script = script.map(entry => (entry.ok === true
			? { ok: true as const, value: String(entry.value ?? 'provider-value') }
			: { ok: false as const, providerError: entry.providerError as { code: string; retryClass: string; retryAfterMs?: number } }));
	}

	run(key: string, spec: unknown): { ok: boolean; value?: string; failureClass?: string; message?: string; replayed?: boolean; providerError?: { code: string; retryClass: string; retryAfterMs?: number } } {
		this.methodCalls.push('run');
		assert.equal(this.enabled, false, 'the zero-network posture: provider calls flow through an already-wired sink - the double must never be enabled underneath the runtime');
		this.calls.push({ key, spec });
		const outcome = this.script[Math.min(this.scriptIndex, this.script.length - 1)];
		this.scriptIndex += 1;
		if (outcome.ok) {
			return { ok: true, value: outcome.value, replayed: false };
		}
		const code = outcome.providerError.code;
		return {
			ok: false,
			failureClass: CODE_TO_FAILURE_CLASS[code] ?? 'unknown-default',
			message: `provider call failed: ${code}`,
			replayed: false,
			providerError: { ...outcome.providerError },
		};
	}

	keys(): string[] {
		return this.calls.map(call => call.key);
	}
}

/** A recording wait port - the injectable clock/wait proof. */
function recordingWait(): { waits: number[]; wait(ms: number): Promise<void> } {
	const waits: number[] = [];
	return {
		waits,
		wait: async (ms: number) => {
			waits.push(ms);
		},
	};
}

const PROVIDER_FAILURES: Array<Record<string, unknown>> = [
	{ ok: false, providerError: { code: 'PROVIDER_OVERLOADED', retryClass: 'short-backoff' } },
	{ ok: false, providerError: { code: 'PROVIDER_OVERLOADED', retryClass: 'short-backoff' } },
	{ ok: false, providerError: { code: 'PROVIDER_OVERLOADED', retryClass: 'short-backoff' } },
	{ ok: false, providerError: { code: 'PROVIDER_OVERLOADED', retryClass: 'short-backoff' } },
	{ ok: false, providerError: { code: 'PROVIDER_OVERLOADED', retryClass: 'short-backoff' } },
];

async function submittedGraph(store: OrchestrationStore, policy: Record<string, unknown> = {}): Promise<string> {
	const submitted = await store.submitGraph({
		title: 'provider-retry graph',
		steps: [{ stepId: 'S-01', title: 'call the provider', instruction: 'run the provider-backed step' }],
		policy,
		actor: 'agent',
		origin: 'test:provider-retry',
	});
	await store.approveGraph({ graphId: submitted.graphId, actor: 'human', origin: 'test:provider-retry' });
	return submitted.graphId;
}

async function drive(store: OrchestrationStore, graphId: string, sink: ProviderScriptedSink, options: { now?: number; providerRetry?: Record<string, unknown> } = {}): Promise<Awaited<ReturnType<typeof driveGraph>>> {
	return await driveGraph(store, {
		graphId,
		sink: sink as never,
		now: options.now ?? CLOCK_BASE,
		runnerId: 'runtime-test',
		origin: 'test:provider-retry',
		...(options.providerRetry === undefined ? {} : { providerRetry: options.providerRetry as never }),
		wait: async () => {
			/* the harness-controlled wait: no real sleeps in tests */
		},
	});
}

function providerRetryRows(store: OrchestrationStore): JournalRow[] {
	return store.journalRows.filter(row => row.type === 'provider-retry');
}

// ---------------------------------------------------------------------------
// the pure helpers
// ---------------------------------------------------------------------------

test('provider retry: resolveProviderRetryBound - the DL-36 additive field matrix', () => {
	assert.equal(resolveProviderRetryBound(undefined), PROVIDER_RETRY_MAX_ATTEMPTS_DEFAULT);
	assert.equal(resolveProviderRetryBound(null), PROVIDER_RETRY_MAX_ATTEMPTS_DEFAULT);
	assert.equal(resolveProviderRetryBound({}), PROVIDER_RETRY_MAX_ATTEMPTS_DEFAULT);
	assert.equal(resolveProviderRetryBound({ maxAttempts: 2 }), 2);
	assert.equal(resolveProviderRetryBound({ maxAttempts: 5 }), 5);
	assert.equal(PROVIDER_RETRY_MAX_ATTEMPTS_DEFAULT, 3);
	for (const bad of [0, -1, 1.5, '3', true, [], [3]]) {
		assert.throws(() => resolveProviderRetryBound({ maxAttempts: bad as never }), /providerRetry\.maxAttempts must be a positive integer/);
	}
	assert.throws(() => resolveProviderRetryBound('nope' as never), /providerRetry config must be a JSON object/);
	assert.throws(() => resolveProviderRetryBound({ maxAttempts: 3, extra: 1 } as never), /at most the key \[maxAttempts\]/);
});

test('provider retry: readProviderError - the structural DL-35 read + the fail-closed garbage rule', () => {
	assert.equal(readProviderError({ ok: true, value: 'x' }), null);
	assert.equal(readProviderError({ ok: false, failureClass: 'unavailable' }), null);
	assert.equal(readProviderError({ ok: false, providerError: 'PROVIDER_OVERLOADED' }), null);
	assert.equal(readProviderError({ ok: false, providerError: { code: '', retryClass: 'short-backoff' } }), null);
	assert.equal(readProviderError({ ok: false, providerError: { code: 'X', retryClass: 'nope' } }), null);
	assert.equal(readProviderError({ ok: false, providerError: { code: 'X', retryClass: 'short-backoff', retryAfterMs: -5 } }), null);
	const read = readProviderError({ ok: false, providerError: { code: 'RATE_LIMITED', retryClass: 'long-backoff', retryAfterMs: 4000 } });
	assert.deepEqual(read, { code: 'RATE_LIMITED', retryClass: 'long-backoff', retryAfterMs: 4000 });
	// the retryable/terminal split per the DL-35 fixed table
	assert.equal(isRetryableProviderError(read), true);
	assert.equal(isRetryableProviderError(readProviderError({ ok: false, providerError: { code: 'AUTH_FAILED', retryClass: 'none' } })), false);
	assert.equal(isRetryableProviderError(null), false);
});

test('provider retry: providerRetryWaitMs - retryAfterMs honored, capped, immediate when absent', () => {
	assert.equal(providerRetryWaitMs({ code: 'X', retryClass: 'immediate' }), 0);
	assert.equal(providerRetryWaitMs({ code: 'X', retryClass: 'short-backoff', retryAfterMs: 5000 }), 5000);
	assert.equal(providerRetryWaitMs({ code: 'X', retryClass: 'long-backoff', retryAfterMs: 60000 }), RETRY_AFTER_CAP_MS);
	assert.equal(RETRY_AFTER_CAP_MS, 30000);
});

test('provider retry: providerAttemptKeyOf - attempt 1 keeps the canonical key, later attempts are keyed per ordinal', () => {
	assert.equal(providerAttemptKeyOf('flauz-orch/G-001/S-01/run/1', 1), 'flauz-orch/G-001/S-01/run/1');
	assert.equal(providerAttemptKeyOf('flauz-orch/G-001/S-01/run/1', 2), 'flauz-orch/G-001/S-01/run/1#p2');
	assert.equal(providerAttemptKeyOf('flauz-orch/G-001/S-01/run/1', 3), 'flauz-orch/G-001/S-01/run/1#p3');
});

test('provider retry: defaultProviderRetryWait - 0ms resolves immediately, a positive wait resolves', async () => {
	await defaultProviderRetryWait(0);
	await defaultProviderRetryWait(-1);
	const start = Date.now();
	await defaultProviderRetryWait(20);
	assert.ok(Date.now() - start < 5000, 'the default wait port resolves (never hangs)');
});

// ---------------------------------------------------------------------------
// (a) the retryable window: bound, recording, terminal exhaustion
// ---------------------------------------------------------------------------

test('provider retry: (a) a retryable typed provider error is retried exactly maxAttempts times, every attempt journaled, then the TERMINAL typed failure', async () => {
	const root = makeRoot();
	try {
		const store = makeStore(root);
		const graphId = await submittedGraph(store);
		const sink = new ProviderScriptedSink(PROVIDER_FAILURES);
		const report = await drive(store, graphId, sink);

		// exactly maxAttempts (default 3) provider calls before the typed error
		assert.equal(sink.calls.length, 3, 'exactly maxAttempts (3) provider calls');
		assert.deepEqual(sink.keys(), ['flauz-orch/G-001/S-01/run/1', 'flauz-orch/G-001/S-01/run/1#p2', 'flauz-orch/G-001/S-01/run/1#p3']);
		assert.equal(report.started[0]?.providerAttempts, 3);
		assert.equal(report.started[0]?.providerExhausted, true);

		// every attempt appended an ops-ledger row (actor, ordinal, typed outcome, wait)
		const rows = providerRetryRows(store);
		assert.equal(rows.length, 3);
		const [first, second, third] = rows;
		assert.deepEqual(first?.payload, { attemptOrdinal: 1, code: 'PROVIDER_OVERLOADED', outcome: 'retryable-failed', retryClass: 'short-backoff', waitAppliedMs: 0, maxAttempts: 3, nextAttemptOrdinal: 2 });
		assert.deepEqual(second?.payload, { attemptOrdinal: 2, code: 'PROVIDER_OVERLOADED', outcome: 'retryable-failed', retryClass: 'short-backoff', waitAppliedMs: 0, maxAttempts: 3, nextAttemptOrdinal: 3 });
		assert.deepEqual(third?.payload, { attemptOrdinal: 3, code: 'PROVIDER_OVERLOADED', outcome: 'exhausted', retryClass: 'short-backoff', waitAppliedMs: 0, maxAttempts: 3 });
		for (const row of rows) {
			assert.equal(row.actor, 'agent', 'actor attribution');
			assert.equal(row.origin, 'test:provider-retry');
			assert.equal(row.stepId, 'S-01');
			assert.equal(row.attempt, 1);
			assert.equal(row.idempotencyKey, 'flauz-orch/G-001/S-01/run/1');
		}

		// the attempt rows verify in the hash chain
		assert.deepEqual(store.verifyJournal(), { ok: true, rows: store.journalRows.length });

		// the terminal typed failure through the EXISTING honest path
		const step = store.stateOf(graphId).steps['S-01'];
		assert.equal(step?.status, 'failed');
		assert.equal(step?.failure?.class, 'unavailable');
		assert.equal(step?.failure?.message, 'provider call failed: PROVIDER_OVERLOADED');
		assert.equal(step?.failure?.retryPlanned, false, 'exhaustion is TERMINAL - the automatic step-retry loop stays silent');
		const summary = report.summary as { steps: Record<string, { providerRetry: { rows: number; lastOrdinal: number; maxAttempts: number; lastOutcome: string; ended: boolean } | null }> };
		assert.deepEqual(summary.steps['S-01']?.providerRetry, { rows: 3, lastOrdinal: 3, maxAttempts: 3, lastOutcome: 'exhausted', ended: true });

		// the journal row sequence: submitted, approved, started, 3x provider-retry, failed
		assert.deepEqual(store.journalRows.map(row => row.type), [
			'graph-submitted', 'graph-approved', 'step-started', 'provider-retry', 'provider-retry', 'provider-retry', 'step-failed',
		]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// (b) terminal-class errors: the existing honest single-shot path, unchanged
// ---------------------------------------------------------------------------

test('provider retry: (b) a terminal-class typed provider error fails immediately - 1 call, no retry rows', async () => {
	const root = makeRoot();
	try {
		const store = makeStore(root);
		const graphId = await submittedGraph(store);
		const sink = new ProviderScriptedSink([{ ok: false, providerError: { code: 'AUTH_FAILED', retryClass: 'none' } }]);
		const report = await drive(store, graphId, sink);

		assert.equal(sink.calls.length, 1, 'exactly one provider call (terminal class - no window)');
		assert.equal(report.started[0]?.providerAttempts, 1);
		assert.equal(report.started[0]?.providerExhausted, false);
		assert.equal(providerRetryRows(store).length, 0, 'no provider-retry rows on the honest single-shot path');

		const step = store.stateOf(graphId).steps['S-01'];
		assert.equal(step?.status, 'failed');
		assert.equal(step?.failure?.class, 'permanent');
		assert.equal(step?.failure?.retryPlanned, false, 'a terminal failure class is never retried by any policy');
		assert.deepEqual(store.journalRows.map(row => row.type), ['graph-submitted', 'graph-approved', 'step-started', 'step-failed']);
		assert.deepEqual(store.verifyJournal(), { ok: true, rows: store.journalRows.length });
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('provider retry: an untyped failure (no providerError) keeps the existing single-shot behavior byte-identically', async () => {
	const root = makeRoot();
	try {
		const store = makeStore(root);
		const graphId = await submittedGraph(store);
		// a plain policy-retryable failure WITHOUT a typed provider error: the
		// step-level retry policy owns it exactly as before (no provider window)
		const sink = new ProviderScriptedSink([{ ok: false, providerError: { code: 'NETWORK_ERROR', retryClass: 'short-backoff' } }]);
		sink.run = ((key: string, spec: unknown) => {
			sink.calls.push({ key, spec });
			return { ok: false, failureClass: 'unavailable', message: 'plain untyped failure', replayed: false };
		}) as never;
		const report = await drive(store, graphId, sink);
		assert.equal(sink.calls.length, 1, 'no automatic retry without a typed provider error');
		assert.equal(providerRetryRows(store).length, 0);
		const step = store.stateOf(graphId).steps['S-01'];
		assert.equal(step?.failure?.retryPlanned, true, 'the step-level policy still plans its own (caller-visible) retry');
		assert.equal(report.started[0]?.providerAttempts, 1);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// (c) backoff: retryAfterMs honored + capped + the injectable wait port
// ---------------------------------------------------------------------------

test('provider retry: (c) retryAfterMs is honored through the injectable wait port, capped at the sane cap, immediate when absent', async () => {
	const root = makeRoot();
	try {
		const store = makeStore(root);
		const graphId = await submittedGraph(store);
		const sink = new ProviderScriptedSink([
			{ ok: false, providerError: { code: 'RATE_LIMITED', retryClass: 'long-backoff', retryAfterMs: 5000 } },
			{ ok: false, providerError: { code: 'RATE_LIMITED', retryClass: 'long-backoff', retryAfterMs: 90000 } },
			{ ok: false, providerError: { code: 'RATE_LIMITED', retryClass: 'long-backoff' } },
		]);
		const recorder = recordingWait();
		await driveGraph(store, { graphId, sink: sink as never, now: CLOCK_BASE, runnerId: 'runtime-test', wait: recorder.wait });

		// attempt 2 waited the honored 5000; attempt 3 waited the CAPPED 30000
		assert.deepEqual(recorder.waits, [5000, 30000]);
		const rows = providerRetryRows(store);
		assert.equal(rows.length, 3);
		assert.equal(rows[0]?.payload.waitAppliedMs, 0);
		assert.equal(rows[0]?.payload.retryAfterMs, 5000);
		assert.equal(rows[1]?.payload.waitAppliedMs, 5000, 'the wait applied before attempt 2 is recorded on its row');
		assert.equal(rows[1]?.payload.retryAfterMs, 90000);
		assert.equal(rows[2]?.payload.waitAppliedMs, 30000, 'the capped wait is recorded on the final row');
		assert.equal(rows[2]?.payload.retryAfterMs, undefined, 'the third failure carried no vendor hint');
		assert.deepEqual(store.verifyJournal(), { ok: true, rows: store.journalRows.length });
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// (d) the configurable bound (the DL-36 additive field)
// ---------------------------------------------------------------------------

test('provider retry: (d) absent config -> the default 3; a configured value respected; invalid config fails closed', async () => {
	const roots: string[] = [];
	try {
		const fresh = async (): Promise<{ store: OrchestrationStore; graphId: string }> => {
			const root = makeRoot();
			roots.push(root);
			const store = makeStore(root);
			const graphId = await submittedGraph(store);
			return { store, graphId };
		};
		// configured maxAttempts 2
		const case2 = await fresh();
		const sink2 = new ProviderScriptedSink(PROVIDER_FAILURES);
		await drive(case2.store, case2.graphId, sink2, { providerRetry: { maxAttempts: 2 } });
		assert.equal(sink2.calls.length, 2, 'a configured bound of 2 is respected');
		assert.deepEqual(providerRetryRows(case2.store).map(row => row.payload.attemptOrdinal), [1, 2]);
		assert.equal(providerRetryRows(case2.store)[1]?.payload.outcome, 'exhausted');

		// configured maxAttempts 5
		const case5 = await fresh();
		const sink5 = new ProviderScriptedSink(PROVIDER_FAILURES);
		await drive(case5.store, case5.graphId, sink5, { providerRetry: { maxAttempts: 5 } });
		assert.equal(sink5.calls.length, 5, 'a configured bound of 5 is respected');
		assert.deepEqual(providerRetryRows(case5.store).map(row => row.payload.attemptOrdinal), [1, 2, 3, 4, 5]);

		// maxAttempts 1: the window engages but has no next attempt (exhaustion at ordinal 1)
		const case1 = await fresh();
		const sink1 = new ProviderScriptedSink(PROVIDER_FAILURES);
		await drive(case1.store, case1.graphId, sink1, { providerRetry: { maxAttempts: 1 } });
		assert.equal(sink1.calls.length, 1);
		assert.deepEqual(providerRetryRows(case1.store).map(row => (row.payload as { outcome: string; attemptOrdinal: number }).outcome), ['exhausted']);
		assert.equal((providerRetryRows(case1.store)[0]?.payload as { attemptOrdinal: number }).attemptOrdinal, 1);

		// invalid config: a typed error, never silently defaulted
		const caseBad = await fresh();
		const sinkBad = new ProviderScriptedSink(PROVIDER_FAILURES);
		await assert.rejects(
			() => drive(caseBad.store, caseBad.graphId, sinkBad, { providerRetry: { maxAttempts: 0 } }),
			/providerRetry\.maxAttempts must be a positive integer/,
		);
		assert.equal(sinkBad.calls.length, 0, 'fail-closed: an invalid config rejects before any provider call');
	} finally {
		for (const root of roots) {
			rmSync(root, { recursive: true, force: true });
		}
	}
});

// ---------------------------------------------------------------------------
// (e) composability: the caller-driven retry ABOVE the automatic loop
// ---------------------------------------------------------------------------

test('provider retry: (e) an explicit caller retry opens a FRESH bounded window with a FRESH idempotency key', async () => {
	const root = makeRoot();
	try {
		const store = makeStore(root);
		const graphId = await submittedGraph(store);
		// window 1: three retryable failures -> terminal; then the provider recovers
		const sink = new ProviderScriptedSink([
			{ ok: false, providerError: { code: 'PROVIDER_OVERLOADED', retryClass: 'short-backoff' } },
			{ ok: false, providerError: { code: 'PROVIDER_OVERLOADED', retryClass: 'short-backoff' } },
			{ ok: false, providerError: { code: 'PROVIDER_OVERLOADED', retryClass: 'short-backoff' } },
			{ ok: true, value: 'provider recovered' },
		]);

		const first = await drive(store, graphId, sink);
		assert.equal(first.graphStatus, 'approved', 'the exhausted window leaves the graph in the honest non-terminal state (manual policy)');
		assert.equal(first.started[0]?.providerExhausted, true);
		assert.deepEqual(sink.keys(), ['flauz-orch/G-001/S-01/run/1', 'flauz-orch/G-001/S-01/run/1#p2', 'flauz-orch/G-001/S-01/run/1#p3']);

		// the automatic loop stays silent: no step-retry-scheduled row was minted
		assert.equal(store.journalRows.filter(row => row.type === 'step-retry-scheduled').length, 0);

		// the EXPLICIT caller retry: a fresh step attempt -> a fresh bounded window
		await store.retryStep({ graphId, stepId: 'S-01', actor: 'service', origin: 'test:caller-retry' });
		const second = await drive(store, graphId, sink, { now: FAR_FUTURE });
		assert.equal(second.completed, true, 'the caller-driven retry recovers the provider and completes the graph');
		assert.equal(second.started[0]?.attempt, 2);
		assert.equal(second.started[0]?.idempotencyKey, 'flauz-orch/G-001/S-01/run/2', 'a FRESH idempotency key for the fresh window');
		assert.equal(second.started[0]?.providerAttempts, 1, 'the fresh window is a fresh bounded budget');
		assert.equal(second.started[0]?.providerExhausted, false);
		assert.deepEqual(sink.keys(), [
			'flauz-orch/G-001/S-01/run/1', 'flauz-orch/G-001/S-01/run/1#p2', 'flauz-orch/G-001/S-01/run/1#p3',
			'flauz-orch/G-001/S-01/run/2',
		]);
		// the second window succeeded on its first attempt: no additional provider-retry rows
		assert.equal(providerRetryRows(store).length, 3);
		const step = store.stateOf(graphId).steps['S-01'];
		assert.equal(step?.status, 'succeeded');
		assert.equal(step?.providerRetry, null, 'a fresh step attempt resets the window projection');
		assert.deepEqual(store.journalRows.map(row => row.type), [
			'graph-submitted', 'graph-approved', 'step-started',
			'provider-retry', 'provider-retry', 'provider-retry', 'step-failed',
			'step-retry-scheduled', 'step-started', 'step-succeeded', 'graph-completed',
		]);
		assert.deepEqual(store.verifyJournal(), { ok: true, rows: store.journalRows.length });
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// (f) the zero-network posture (DL-37)
// ---------------------------------------------------------------------------

test('provider retry: (f) the retry loop never enables a provider (zero-network posture)', async () => {
	const root = makeRoot();
	try {
		const store = makeStore(root);
		const graphId = await submittedGraph(store);
		const sink = new ProviderScriptedSink(PROVIDER_FAILURES);
		await drive(store, graphId, sink);

		assert.equal(sink.calls.length, 3, 'the provider was called three times - through the ALREADY-wired sink');
		assert.equal(sink.enabled, false, 'the provider double is never enabled by the retry loop');
		assert.deepEqual(sink.methodCalls, ['run', 'run', 'run'], 'the runtime touches the sink through run() only - no enablement, no credentials, no routing');
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// the recovered window + the DL-53 outcome-unknown discipline
// ---------------------------------------------------------------------------

test('provider retry: a window that recovers on a later attempt records the recovery and completes the step', async () => {
	const root = makeRoot();
	try {
		const store = makeStore(root);
		const graphId = await submittedGraph(store);
		const sink = new ProviderScriptedSink([
			{ ok: false, providerError: { code: 'PROVIDER_OVERLOADED', retryClass: 'short-backoff', retryAfterMs: 250 } },
			{ ok: true, value: 'recovered value' },
		]);
		const recorder = recordingWait();
		const report = await driveGraph(store, { graphId, sink: sink as never, now: CLOCK_BASE, runnerId: 'runtime-test', wait: recorder.wait });

		assert.deepEqual(recorder.waits, [250]);
		assert.equal(sink.calls.length, 2);
		assert.equal(report.completed, true);
		assert.equal(report.started[0]?.providerAttempts, 2);
		assert.equal(report.started[0]?.providerExhausted, false);

		const rows = providerRetryRows(store);
		assert.equal(rows.length, 2);
		assert.deepEqual(rows[0]?.payload, { attemptOrdinal: 1, code: 'PROVIDER_OVERLOADED', outcome: 'retryable-failed', retryClass: 'short-backoff', retryAfterMs: 250, waitAppliedMs: 0, maxAttempts: 3, nextAttemptOrdinal: 2 });
		assert.deepEqual(rows[1]?.payload, { attemptOrdinal: 2, code: 'PROVIDER_OVERLOADED', outcome: 'recovered', retryClass: 'short-backoff', waitAppliedMs: 250, maxAttempts: 3 });
		const step = store.stateOf(graphId).steps['S-01'];
		assert.equal(step?.status, 'succeeded');
		assert.deepEqual(store.journalRows.map(row => row.type), ['graph-submitted', 'graph-approved', 'step-started', 'provider-retry', 'provider-retry', 'step-succeeded', 'graph-completed']);
		assert.deepEqual(store.verifyJournal(), { ok: true, rows: store.journalRows.length });
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('provider retry: a LOST response (the sink throwing) is never retried optimistically (DL-53)', async () => {
	const root = makeRoot();
	try {
		const store = makeStore(root);
		const graphId = await submittedGraph(store);
		let providerCalls = 0;
		const sink = {
			run: (): { ok: boolean; replayed: boolean } => {
				providerCalls += 1;
				throw new Error('connection reset mid-call (outcome unknown)');
			},
		};
		await assert.rejects(() => driveGraph(store, { graphId, sink: sink as never, now: CLOCK_BASE, runnerId: 'runtime-test' }), /connection reset mid-call/);

		assert.equal(providerCalls, 1, 'exactly one provider call - a lost response is never blindly retried');
		assert.equal(providerRetryRows(store).length, 0, 'no provider-retry rows: nothing was CONFIRMED retryable');
		const step = store.stateOf(graphId).steps['S-01'];
		assert.equal(step?.status, 'running', 'the in-flight attempt stays running - the crash/recovery pass owns the interrupted step');
		assert.deepEqual(store.journalRows.map(row => row.type), ['graph-submitted', 'graph-approved', 'step-started']);
		assert.deepEqual(store.verifyJournal(), { ok: true, rows: store.journalRows.length });
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// the journal legality: fabricated provider-retry rows are rejected
// ---------------------------------------------------------------------------

test('provider retry: the journal replay rejects fabricated provider-retry rows (window legality)', async () => {
	const root = makeRoot();
	try {
		const store = makeStore(root);
		const graphId = await submittedGraph(store);
		const sink = new ProviderScriptedSink([
			{ ok: false, providerError: { code: 'PROVIDER_OVERLOADED', retryClass: 'short-backoff' } },
			{ ok: true, value: 'ok' },
		]);
		await drive(store, graphId, sink);
		const windowKey = 'flauz-orch/G-001/S-01/run/1';

		// the window ended ('recovered') AND the step is terminal: any further
		// provider-retry row is a fabrication and the replay rejects it.
		await assert.rejects(
			() => store.recordProviderRetry({ graphId, stepId: 'S-01', attempt: 1, idempotencyKey: windowKey, attemptOrdinal: 2, outcome: 'retryable-failed', code: 'PROVIDER_OVERLOADED', retryClass: 'short-backoff', waitAppliedMs: 0, maxAttempts: 3, nextAttemptOrdinal: 3 }),
			/requires the step to be running/,
		);

		// ordinal continuity: a first row at ordinal 2 is a fabrication
		const store2 = makeStore(root);
		const graph2 = await submittedGraph(store2);
		const start = await store2.startStep({ graphId: graph2, stepId: 'S-01', runnerId: 'runtime-test', actor: 'agent', origin: 'test' });
		await assert.rejects(
			() => store2.recordProviderRetry({ graphId: graph2, stepId: 'S-01', attempt: start.attempt, idempotencyKey: start.idempotencyKey, attemptOrdinal: 2, outcome: 'retryable-failed', code: 'PROVIDER_OVERLOADED', retryClass: 'short-backoff', waitAppliedMs: 0, maxAttempts: 3, nextAttemptOrdinal: 3 }),
			/the first provider-retry row of a window must be attemptOrdinal 1/,
		);

		// a wrong window key is a fabrication
		await assert.rejects(
			() => store2.recordProviderRetry({ graphId: graph2, stepId: 'S-01', attempt: start.attempt, idempotencyKey: 'flauz-orch/G-001/S-01/run/9', attemptOrdinal: 1, outcome: 'retryable-failed', code: 'PROVIDER_OVERLOADED', retryClass: 'short-backoff', waitAppliedMs: 0, maxAttempts: 3, nextAttemptOrdinal: 2 }),
			/provider-retry idempotencyKey must be/,
		);

		// a correct first row lands and verifies
		const landed = await store2.recordProviderRetry({ graphId: graph2, stepId: 'S-01', attempt: start.attempt, idempotencyKey: start.idempotencyKey, attemptOrdinal: 1, outcome: 'retryable-failed', code: 'PROVIDER_OVERLOADED', retryClass: 'short-backoff', waitAppliedMs: 0, maxAttempts: 3, nextAttemptOrdinal: 2 });
		assert.equal(landed.type, 'provider-retry');
		assert.deepEqual(store2.verifyJournal(), { ok: true, rows: store2.journalRows.length });
		const step2 = store2.stateOf(graph2).steps['S-01'];
		assert.deepEqual(step2?.providerRetry, { rows: 1, lastOrdinal: 1, maxAttempts: 3, lastOutcome: 'retryable-failed', ended: false });

		// continuity: ordinal 3 after ordinal 1 is a fabrication (a valid rf shape, wrong sequence)
		await assert.rejects(
			() => store2.recordProviderRetry({ graphId: graph2, stepId: 'S-01', attempt: start.attempt, idempotencyKey: start.idempotencyKey, attemptOrdinal: 3, outcome: 'retryable-failed', code: 'PROVIDER_OVERLOADED', retryClass: 'short-backoff', waitAppliedMs: 0, maxAttempts: 5, nextAttemptOrdinal: 4 }),
			/provider-retry attemptOrdinal must be 2/,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('provider retry: the payload validation matrix (every rule violated by exactly one bad fixture)', () => {
	const base = { attemptOrdinal: 1, code: 'PROVIDER_OVERLOADED', maxAttempts: 3, outcome: 'retryable-failed', retryClass: 'short-backoff', waitAppliedMs: 0, nextAttemptOrdinal: 2 };
	assert.equal(validateJournalPayload('provider-retry', base), undefined);
	assert.equal(validateJournalPayload('provider-retry', { ...base, outcome: 'exhausted', nextAttemptOrdinal: undefined }), 'journal provider-retry payload outcome \'exhausted\' requires attemptOrdinal === maxAttempts (the bound was consumed)');
	const cases: Array<[string, Record<string, unknown>, RegExp]> = [
		['unknown outcome', { ...base, outcome: 'weird' }, /outcome must be one of/],
		['zero ordinal', { ...base, attemptOrdinal: 0 }, /attemptOrdinal\/maxAttempts must be positive integers/],
		['ordinal beyond bound', { ...base, attemptOrdinal: 4 }, /attemptOrdinal must be <= maxAttempts/],
		['empty code', { ...base, code: '' }, /code must be a non-empty string/],
		['terminal retryClass', { ...base, retryClass: 'none' }, /retryClass must be one of/],
		['negative wait', { ...base, waitAppliedMs: -1 }, /waitAppliedMs must be a non-negative integer/],
		['bad hint', { ...base, retryAfterMs: -3 }, /retryAfterMs must be a non-negative integer/],
		['rf without next', { ...base, nextAttemptOrdinal: undefined }, /nextAttemptOrdinal is required/],
		['rf with skipped next', { ...base, nextAttemptOrdinal: 3 }, /nextAttemptOrdinal must be attemptOrdinal \+ 1/],
		['rf at the bound', { ...base, attemptOrdinal: 3, nextAttemptOrdinal: 4 }, /requires remaining budget/],
		['exhausted with next', { ...base, attemptOrdinal: 3, outcome: 'exhausted', nextAttemptOrdinal: 4 }, /nextAttemptOrdinal is only allowed when outcome is 'retryable-failed'/],
		['recovered at ordinal 1', { ...base, outcome: 'recovered', nextAttemptOrdinal: undefined }, /'recovered' requires attemptOrdinal >= 2/],
		['extra key', { ...base, extra: 1 }, /must have exactly the keys/],
	];
	for (const [name, payload, pattern] of cases) {
		const error = validateJournalPayload('provider-retry', payload);
		assert.ok(error !== undefined && pattern.test(error), `${name}: expected a validation error, got ${JSON.stringify(error)}`);
	}
});

test('provider retry: the journal line is canonical JSON and the row rides the hash chain', async () => {
	const root = makeRoot();
	try {
		const store = makeStore(root);
		const graphId = await submittedGraph(store);
		const sink = new ProviderScriptedSink(PROVIDER_FAILURES);
		await drive(store, graphId, sink);
		for (const row of providerRetryRows(store)) {
			const line = journalLine(row);
			assert.deepEqual(JSON.parse(line), row, 'canonical JSON round-trip');
			assert.ok(!line.includes('\n'), 'one line per row');
		}
		// tamper detection: mutating a landed provider-retry payload breaks the chain
		const tampered = [...store.journalRows];
		const target = tampered.findIndex(row => row.type === 'provider-retry');
		tampered[target] = { ...tampered[target]!, payload: { ...tampered[target]!.payload, code: 'TAMPERED' } } as JournalRow;
		const verdict = await import('../core/orchestration.mjs').then(m => m.deriveGraphState(store.graphs.find(graph => graph.graphId === graphId)!, tampered.filter(row => row.graphId === graphId)));
		assert.equal(verdict.ok, false, 'a doctored provider-retry row is detected (content-hash linkage)');
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('provider retry: runProviderCallWithBoundedRetry - the standalone executor contract (fresh keys per ordinal, recovery, exhaustion)', async () => {
	const root = makeRoot();
	try {
		const store = makeStore(root);
		const graphId = await submittedGraph(store);
		const start = await store.startStep({ graphId, stepId: 'S-01', runnerId: 'runtime-test', actor: 'agent', origin: 'test' });

		// recovery after one retryable failure
		const recovering = new ProviderScriptedSink([
			{ ok: false, providerError: { code: 'TIMEOUT', retryClass: 'short-backoff', retryAfterMs: 100 } },
			{ ok: true, value: 'late success' },
		]);
		const recorder = recordingWait();
		const recovered = await runProviderCallWithBoundedRetry(store, recovering as never, {
			graphId, stepId: 'S-01', start,
			spec: { graphId, stepId: 'S-01', attempt: start.attempt, tool: null, toolInput: null, instruction: 'run' },
			wait: recorder.wait,
		});
		assert.equal(recovered.effect.ok, true);
		assert.equal(recovered.providerAttempts, 2);
		assert.equal(recovered.exhausted, false);
		assert.deepEqual(recorder.waits, [100]);
		await store.finishStep({ graphId, stepId: 'S-01', attempt: start.attempt, outcome: 'succeeded', actor: 'agent', origin: 'test', output: 'late success', evidence: [] });

		// window 2 (a second graph): exhaustion through the standalone executor
		const store2 = makeStore(root);
		const graph2 = await submittedGraph(store2);
		const start2 = await store2.startStep({ graphId: graph2, stepId: 'S-01', runnerId: 'runtime-test', actor: 'agent', origin: 'test' });
		const failing = new ProviderScriptedSink(PROVIDER_FAILURES);
		const exhausted = await runProviderCallWithBoundedRetry(store2, failing as never, {
			graphId: graph2, stepId: 'S-01', start: start2,
			spec: { graphId: graph2, stepId: 'S-01', attempt: start2.attempt, tool: null, toolInput: null, instruction: 'run' },
			wait: async () => { /* no sleeps */ },
		});
		assert.equal(exhausted.effect.ok, false);
		assert.equal((exhausted.effect as { providerError?: { code: string } }).providerError?.code, 'PROVIDER_OVERLOADED');
		assert.equal(exhausted.providerAttempts, 3);
		assert.equal(exhausted.exhausted, true);
		assert.deepEqual(failing.keys(), ['flauz-orch/G-002/S-01/run/1', 'flauz-orch/G-002/S-01/run/1#p2', 'flauz-orch/G-002/S-01/run/1#p3']);
		await store2.finishStep({ graphId: graph2, stepId: 'S-01', attempt: start2.attempt, outcome: 'failed', actor: 'agent', origin: 'test', failureClass: 'unavailable', message: 'exhausted', retryPlanned: false });
		assert.deepEqual(store.verifyJournal(), { ok: true, rows: store.journalRows.length });
		assert.deepEqual(store2.verifyJournal(), { ok: true, rows: store2.journalRows.length });
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
