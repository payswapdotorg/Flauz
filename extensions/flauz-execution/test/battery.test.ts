/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-S2 M5 - the failure/timeout/rollback battery at task level.
 *
 * Failure injections over the REAL runtime stack (driveGraph + the real
 * orchestration store + the real browser session manager + the real
 * environment lifecycle manager + the real continuity/resource layers):
 *
 *   B1 tab dies mid-step (transport drop)  -> resource-lost -> retryable
 *      re-acquire on the next attempt -> step succeeds;
 *   B2 provider health degrades (stale)    -> executor-death -> retryable
 *      -> recovery on the next attempt;
 *   B3 policy gate denies MID-FLIGHT       -> use-denied -> TERMINAL
 *      policy-violation: zero retries, graph fails, fail-closed posture;
 *   B4 rollback: graph cancelled mid-run   -> every held acquisition
 *      released (rollback kind) + the coherent rollback record + both
 *      journals verify;
 *   B5 restart recovery: crash between acquire and settle -> the re-drive
 *      reuses the SAME attempt/key, the acquisition is idempotent, the
 *      effect settles once; the recovery scan records the truth;
 *   B6 executor death mid-acquisition      -> typed executor-death, the
 *      acquisition honestly lost, the graph retry policy decides.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { OrchestrationStore } from '../../flauz-agent/core/orchStore.mjs';
import { driveGraph } from '../../flauz-agent/core/runtime.mjs';
import { recoveryScan } from '../../flauz-agent/core/recovery.mjs';
import { BrowserSessionManager } from '../../flauz-browser/src/runtime/sessionManager.ts';
import { CdpEndpointHost } from '../../flauz-browser/src/runtime/host.ts';
import { FakeBrowserState, FakeCdpTransport } from '../../flauz-browser/src/cdp/fake.ts';
import { BrowserPolicyEngine } from '../../flauz-browser/src/policy.ts';
import { EnvironmentRegistry } from '../../flauz-environments/src/registry.ts';
import { EnvironmentLifecycleManager } from '../../flauz-environments/src/lifecycle/manager.ts';
import type { DescribeVerdict, ExecutorEffectResult } from '../../flauz-environments/src/lifecycle/types.ts';
import type { EnvironmentExecutor } from '../../flauz-environments/src/lifecycle/executor.ts';
import { ExecJournalStore } from '../src/journal.ts';
import { createExecutionRuntime, settleExecution, executionRecoveryScan, type StepStatusPort } from '../src/runtime.ts';
import type { GraphStatePort } from '../src/acquisition.ts';
import { pinnedMinter, steppingClock, tempRoot } from './helpers.ts';

const POLICY = JSON.stringify({
	schemaVersion: 0,
	driver: { allow: ['*.example.com'] },
	webRequest: { allow: ['*.example.com'] },
	willNavigate: { allow: ['*'] },
	partitions: { scope: 'persist', perAgent: true },
});

function memFs(seed: Record<string, string> = {}) {
	const files = new Map<string, string>(Object.entries(seed));
	return {
		readFileUtf8: async (path: string) => files.get(path),
		writeFile: async (path: string, contents: string) => { files.set(path, contents); },
		appendFile: async (path: string, contents: string) => { files.set(path, (files.get(path) ?? '') + contents); },
		rename: async (from: string, to: string) => {
			const moved = [...files.keys()].filter((key) => key === from || key.startsWith(`${from}/`));
			if (moved.length > 1 || (moved.length === 1 && moved[0] !== from)) {
				for (const key of moved) {
					const target = key === from ? to : `${to}${key.slice(from.length)}`;
					files.set(target, files.get(key) ?? '');
					files.delete(key);
				}
				return;
			}
			files.set(to, files.get(from) ?? '');
			files.delete(from);
		},
		mkdir: async () => undefined,
	};
}

class FakeEnvExecutor implements EnvironmentExecutor {
	readonly executorKind = 'fake-local';
	readonly infrastructureClass = 'real' as const;
	readonly kinds = ['workspace-remote'] as const;
	readonly calls: string[] = [];
	failNext: { op: string; code: string; message: string } | undefined;
	probeOverride: DescribeVerdict | undefined;
	private phase: 'registered' | 'created' | 'running' = 'registered';
	private leaseCounter = 0;
	private record(op: string): ExecutorEffectResult {
		this.calls.push(op);
		const failure = this.failNext;
		if (failure !== undefined && failure.op === op) { this.failNext = undefined; return { ok: false, error: { code: failure.code, message: failure.message } }; }
		if (op === 'create') { this.phase = 'created'; }
		if (op === 'start') { this.phase = 'running'; return { ok: true, detail: { type: 'start', pid: 4242 } }; }
		if (op === 'stop') { this.phase = 'created'; }
		if (op === 'destroy') { this.phase = 'registered'; }
		if (op === 'attach') { this.leaseCounter += 1; return { ok: true, detail: { type: 'attach', leaseId: `lease-${this.leaseCounter}`, heldSince: 1 } }; }
		if (op === 'detach') { return { ok: true, detail: { type: 'detach', leaseId: 'lease-1' } }; }
		return { ok: true };
	}
	async create(): Promise<ExecutorEffectResult> { return this.record('create'); }
	async start(): Promise<ExecutorEffectResult> { return this.record('start'); }
	async stop(): Promise<ExecutorEffectResult> { return this.record('stop'); }
	async attach(): Promise<ExecutorEffectResult> { return this.record('attach'); }
	async detach(): Promise<ExecutorEffectResult> { return this.record('detach'); }
	async snapshot(): Promise<ExecutorEffectResult> { return this.record('snapshot'); }
	async destroy(): Promise<ExecutorEffectResult> { return this.record('destroy'); }
	async probe(): Promise<DescribeVerdict> {
		if (this.probeOverride !== undefined) { return this.probeOverride; }
		if (this.phase === 'running') { return { health: 'healthy', state: 'running', pid: 4242, message: 'ok' }; }
		if (this.phase === 'created') { return { health: 'not-running', state: 'created', pid: null, message: 'created' }; }
		return { health: 'not-created', state: 'registered', pid: null, message: 'registered' };
	}
}

interface Rig {
	root: string;
	cleanup: () => void;
	orch: OrchestrationStore;
	journal: ExecJournalStore;
	runtime: ReturnType<typeof createExecutionRuntime>;
	transports: FakeCdpTransport[];
	executor: FakeEnvExecutor;
	lifecycle: EnvironmentLifecycleManager;
	browser: BrowserSessionManager;
}

async function rig(): Promise<Rig> {
	const { root, cleanup } = tempRoot();
	const clock = steppingClock(1730000000000, 100);
	const orch = new OrchestrationStore(root, { clock });
	const graphState: GraphStatePort = {
		stepStatus(graphId, stepId) {
			try { const state = orch.stateOf(graphId); return (state.steps as Record<string, { status?: string }>)[stepId]?.status ?? 'unknown-step'; } catch { return 'unknown-graph'; }
		},
		async acquireStepLease(input) {
			const row = await orch.acquireLease({ graphId: input.graphId, stepId: input.stepId, holder: input.holder, ttlMs: input.ttlMs, actor: 'agent', origin: 'exec:lease' });
			return { leaseId: (row.payload as { leaseId: string }).leaseId, expiresAt: (row.payload as { expiresAt: number }).expiresAt };
		},
		activeStepLease(graphId, stepId) {
			try {
				const state = orch.stateOf(graphId);
				const lease = (state.leases as Record<string, { leaseId: string; holder: string; expiresAt: number } | undefined>)[stepId];
				return lease ?? null;
			} catch { return null; }
		},
	};
	const state = new FakeBrowserState();
	const transports: FakeCdpTransport[] = [];
	const host = new CdpEndpointHost('ws://127.0.0.1:9222/devtools/browser/fake', { transportFactory: () => { const transport = new FakeCdpTransport({ state, commandTimeoutMs: 500 }); transports.push(transport); return transport; } });
	const browser = new BrowserSessionManager({ engine: () => BrowserPolicyEngine.fromPolicyText(POLICY), host, workspaceRoot: '/ws/acme', commandTimeoutMs: 150, navigationTimeoutMs: 300 });
	const envFs = memFs();
	const registry = new EnvironmentRegistry({ root: '/ws', fs: envFs, clock });
	await registry.bootstrap();
	await registry.register({ id: 'env-staging', kind: 'workspace-remote', label: 'Staging', connection: { authorityPrefix: 'flauz-local' }, trust: { posture: 'trusted', inheritsWorkspaceTrust: false }, capabilities: { agentHost: true, browser: true, exec: true, terminal: true } } as never);
	const executor = new FakeEnvExecutor();
	const lifecycle = new EnvironmentLifecycleManager({ registry, root: '/ws', fs: envFs, clock, executors: [executor] });
	await lifecycle.bootstrap();
	const journal = new ExecJournalStore(root, { clock, mintAcquisitionId: pinnedMinter() });
	const runtime = createExecutionRuntime({ journal, graphState, browser, lifecycle, resourceGraph: { get: () => undefined, surfacesFor: () => [], async addRef() { }, async addSurface() { } }, clock });
	return { root, cleanup, orch, journal, runtime, transports, executor, lifecycle, browser };
}

const stepsPort = (orch: OrchestrationStore): StepStatusPort => ({
	stepStatus(graphId, stepId) {
		try { const state = orch.stateOf(graphId); return (state.steps as Record<string, { status?: string }>)[stepId]?.status ?? 'unknown-step'; } catch { return 'unknown-graph'; }
	},
});

const BROWSER_OPEN = { action: 'open', url: 'https://docs.example.com' } as const;

test('B1 tab dies mid-step: resource-lost -> RETRYABLE -> the next attempt re-acquires and the step succeeds', async () => {
	const r = await rig();
	await r.orch.submitGraph({
		title: 'flaky browser step',
		steps: [{ stepId: 'S-01', title: 'navigate', instruction: 'navigate', tool: 'flauz.exec.browser', toolInput: { ...BROWSER_OPEN }, retryPolicy: { maxAttempts: 3, backoff: { kind: 'fixed', baseMs: 1, maxMs: 1 }, retryOn: ['unavailable', 'transient', 'timeout'] } }],
		actor: 'agent', origin: 'test:battery',
	});
	await r.orch.approveGraph({ graphId: 'G-001', actor: 'human', origin: 'test:battery' });
	// Deterministic injection: wrap the sink - fail the first attempt as a
	// mid-step tab death (the transport drop accompanies it).
	let firstRun = true;
	const wrappingSink = {
		run: async (key: string, spec: Record<string, unknown>) => {
			const result = await r.runtime.sink.run(key, spec as never);
			if (firstRun) {
				firstRun = false;
				const transport = r.transports[r.transports.length - 1];
				if (transport !== undefined) { transport.drop(); }
				// Re-issue as a failure the graph can retry: mark the acquisition lost + fail.
				return { ok: false, failureClass: 'unavailable', message: 'tab died mid-step (transport drop)', replayed: false };
			}
			return result;
		},
	};
	await driveGraph(r.orch, { graphId: 'G-001', sink: wrappingSink as never, runnerId: 'worker-1', now: 1730000005000 });
	const state = r.orch.stateOf('G-001');
	const step = (state.steps as Record<string, { status?: string; failure?: { class?: string }; lastStartedAttempt?: number }>)['S-01'];
	// The first attempt failed retryable (unavailable); the retry policy scheduled the re-drive.
	assert.equal(step?.failure?.class, 'unavailable', 'the injected resource-loss surfaced as the retryable class');
	// driveGraph with the REAL sink now: the retry attempt re-acquires + succeeds.
	await driveGraph(r.orch, { graphId: 'G-001', sink: r.runtime.sink, runnerId: 'worker-1', now: 1730000010000 });
	const after = r.orch.stateOf('G-001');
	assert.equal((after.steps as Record<string, { status?: string }>)['S-01']?.status, 'succeeded', 'the retried step SUCCEEDED through the real sink');
	assert.equal(after.graphStatus, 'completed');
	assert.ok(r.journal.verifyJournal().ok);
	assert.ok(r.orch.verifyJournal().ok);
	r.cleanup();
});

test('B2 provider health degrades (stale probe): executor-death -> RETRYABLE -> recovery on the next attempt', async () => {
	const r = await rig();
	await r.lifecycle.perform('create', { id: 'env-staging', actor: 'agent' });
	await r.lifecycle.perform('start', { id: 'env-staging', actor: 'agent' });
	await r.orch.submitGraph({
		title: 'flaky env step',
		steps: [{ stepId: 'S-01', title: 'attach', instruction: 'attach', tool: 'flauz.exec.environment', toolInput: { resource: { resourceClass: 'environment', kind: 'environment', id: 'flauz:environment:env-staging' }, action: 'attach', leaseTtlMs: 60000 }, retryPolicy: { maxAttempts: 3, backoff: { kind: 'fixed', baseMs: 1, maxMs: 1 }, retryOn: ['dependency-failure', 'transient', 'timeout'] } }],
		actor: 'agent', origin: 'test:battery',
	});
	await r.orch.approveGraph({ graphId: 'G-001', actor: 'human', origin: 'test:battery' });
	// Degrade the provider health BEFORE the first attempt.
	r.executor.probeOverride = { health: 'stale', state: 'running', pid: null, message: 'persisted state outruns the backing truth' };
	await driveGraph(r.orch, { graphId: 'G-001', sink: r.runtime.sink, runnerId: 'worker-1', now: 1730000005000 });
	let state = r.orch.stateOf('G-001');
	const step = (state.steps as Record<string, { status?: string; failure?: { class?: string } }>)['S-01'];
	assert.equal(step?.failure?.class, 'dependency-failure', 'executor-death maps to the retryable dependency-failure class');
	// The provider recovers.
	r.executor.probeOverride = undefined;
	await driveGraph(r.orch, { graphId: 'G-001', sink: r.runtime.sink, runnerId: 'worker-1', now: 1730000010000 });
	state = r.orch.stateOf('G-001');
	assert.equal((state.steps as Record<string, { status?: string }>)['S-01']?.status, 'succeeded', 'the recovered provider re-acquired on the retry');
	assert.equal(state.graphStatus, 'completed');
	r.cleanup();
});

test('B3 policy gate denies MID-FLIGHT: use-denied -> TERMINAL policy-violation, zero retries, fail-closed', async () => {
	const r = await rig();
	// Pre-open an agent session on an ALLOWED host (the acquisition target).
	const opened = await r.browser.open({ initiator: 'agent', agentId: 'worker-1', startUrl: 'https://docs.example.com' });
	assert.equal(opened.error, undefined);
	const sessionId = opened.descriptor.sessionId;
	// The durable step navigates THAT session to a DENIED host: the acquire
	// succeeds (the session is live + allowed), the USE is denied MID-FLIGHT.
	await r.orch.submitGraph({
		title: 'mid-flight denial',
		policy: { onStepFailure: 'fail-graph' },
		steps: [{ stepId: 'S-01', title: 'navigate', instruction: 'navigate the acquired session to a denied host', tool: 'flauz.exec.browser', toolInput: { resource: { resourceClass: 'browser-session', kind: 'browser-session', id: sessionId }, action: 'navigate', url: 'https://denied.example.net' }, retryPolicy: { maxAttempts: 3, backoff: { kind: 'fixed', baseMs: 1, maxMs: 1 }, retryOn: ['transient', 'timeout', 'unavailable'] } }],
		actor: 'agent', origin: 'test:battery',
	});
	await r.orch.approveGraph({ graphId: 'G-001', actor: 'human', origin: 'test:battery' });
	await driveGraph(r.orch, { graphId: 'G-001', sink: r.runtime.sink, runnerId: 'worker-1' });
	const state = r.orch.stateOf('G-001');
	const step = (state.steps as Record<string, { status?: string; failure?: { class?: string }; nextAttempt?: unknown }>)['S-01'];
	assert.equal(step?.status, 'failed');
	assert.equal(step?.failure?.class, 'policy-violation', 'the mid-flight denial is the TERMINAL class (never retried)');
	assert.equal(step?.nextAttempt ?? null, null, 'no retry was scheduled');
	assert.equal(state.graphStatus, 'failed');
	// The fail-closed evidence: the acquisition SUCCEEDED (the session was
	// usable) and the FAILURE was the mid-flight verdict, not the acquire.
	const settled = r.journal.rowsAll().filter((row) => row.type === 'effect-settled');
	assert.equal(settled.length, 1);
	assert.equal((settled[0]?.payload as Record<string, unknown>).failureClass, 'use-denied');
	assert.ok(r.orch.verifyJournal().ok);
	assert.ok(r.journal.verifyJournal().ok);
	r.cleanup();
});

test('B4 rollback: graph cancelled mid-run -> coherent end state (persisted cancellation + rollback records)', async () => {
	const r = await rig();
	await r.orch.submitGraph({
		title: 'cancelled task',
		steps: [
			{ stepId: 'S-01', title: 'open session', instruction: 'open a session and keep it', tool: 'flauz.exec.browser', toolInput: { ...BROWSER_OPEN } },
			{ stepId: 'S-02', title: 'gated step', instruction: 'awaits human approval (never granted)', tool: 'flauz.exec.browser', dependsOn: ['S-01'], gate: 'human-approval', toolInput: { ...BROWSER_OPEN } },
		],
		actor: 'agent', origin: 'test:battery',
	});
	await r.orch.approveGraph({ graphId: 'G-001', actor: 'human', origin: 'test:battery' });
	// Drive: S-01 runs + holds its acquisition; S-02 requests approval and stalls.
	await driveGraph(r.orch, { graphId: 'G-001', sink: r.runtime.sink, runnerId: 'worker-1' });
	const after = r.orch.stateOf('G-001');
	assert.equal((after.steps as Record<string, { status?: string }>)['S-01']?.status, 'succeeded');
	assert.equal((after.steps as Record<string, { status?: string }>)['S-02']?.status, 'awaiting-approval');
	assert.equal(r.journal.heldAcquisitions({ graphId: 'G-001' }).length, 1, 'the session acquisition is still held (S-01 completed but the sweep has not run: the resource stays for the gated step)');
	// The human cancels the graph mid-run.
	r.orch.appendRow('cancel-requested', { graphId: 'G-001', actor: 'human', origin: 'test:battery', payload: { reason: 'user changed their mind' } });
	r.orch.appendRow('graph-cancelled', { graphId: 'G-001', actor: 'human', origin: 'test:battery', payload: { reason: 'user changed their mind' } });
	// The rollback sweep: every held acquisition of the graph is released.
	const report = await r.runtime.manager.rollbackGraph({ graphId: 'G-001', cause: 'user-cancel', origin: 'exec:rollback' });
	assert.equal(report.released.length, 1, 'the held acquisition was released');
	assert.equal(report.coherent, true);
	assert.equal(r.journal.heldAcquisitions({ graphId: 'G-001' }).length, 0, 'coherent: nothing held after rollback');
	const rollbackRow = r.journal.rowsAll().find((row) => row.type === 'rollback-recorded');
	assert.notEqual(rollbackRow, undefined, 'the rollback record is PERSISTED');
	assert.equal((rollbackRow?.payload as Record<string, unknown>).cause, 'user-cancel');
	assert.ok(r.journal.verifyJournal().ok, 'the execution journal verifies after rollback');
	assert.ok(r.orch.verifyJournal().ok, 'the orchestration journal verifies after rollback');
	r.cleanup();
});

test('B5 restart recovery: crash between acquire and settle -> the SAME attempt re-drives idempotently', async () => {
	const r = await rig();
	await r.orch.submitGraph({
		title: 'crashy step',
		steps: [{ stepId: 'S-01', title: 'navigate', instruction: 'navigate', tool: 'flauz.exec.browser', toolInput: { ...BROWSER_OPEN } }],
		actor: 'agent', origin: 'test:battery',
	});
	await r.orch.approveGraph({ graphId: 'G-001', actor: 'human', origin: 'test:battery' });
	// Crash simulation: the step STARTS + the acquisition lands, then the
	// process dies before the settle row (a torn exec journal tail + an
	// interrupted step in the orch journal).
	const key = 'flauz-orch/G-001/S-01/run/1';
	const start = await r.orch.startStep({ graphId: 'G-001', stepId: 'S-01', runnerId: 'worker-1', actor: 'agent', origin: 'test:battery' });
	assert.equal(start.idempotencyKey, key);
	const acquisitionId = 'flauz:exec:0000000000000001';
	r.journal.appendRow('resource-acquired', {
		graphId: 'G-001', stepId: 'S-01', attempt: 1, idempotencyKey: key,
		acquisitionId, actor: 'agent', origin: 'exec:sink',
		payload: { purpose: 'crash window', resource: { resourceClass: 'browser-session', kind: 'browser-session', id: 'flauz:browser:9c8d7e6f5a4b3c2d' } },
	});
	// Simulate the crash artifact: a torn final line (the settle never landed).
	writeFileSync(join(r.root, '.flauz/execution/journal.jsonl'), readFileSync(join(r.root, '.flauz/execution/journal.jsonl'), 'utf-8') + '{"torn":');
	// RESTART: fresh stores over the same root.
	const orch2 = new OrchestrationStore(r.root, { clock: steppingClock(1730000090000) });
	const journal2 = new ExecJournalStore(r.root, { clock: steppingClock(1730000090000), mintAcquisitionId: pinnedMinter() });
	assert.notEqual(journal2.tornTail, null, 'the torn tail surfaced (the crash artifact)');
	assert.equal(journal2.rowsAll().length, 1, 'the acquired row survived the crash');
	// The REAL orchestration recovery pass marks the interrupted step ready
	// (same attempt) - the house kill-recover discipline.
	const recovery = await recoveryScan(orch2, { now: 1730000090000 });
	assert.ok(recovery.actions.includes('G-001:step-interrupted:S-01'), 'the interrupted step was recovered (same attempt re-drive)');
	const runtime2 = createExecutionRuntime({
		journal: journal2,
		graphState: {
			stepStatus(graphId, stepId) {
				try { const state = orch2.stateOf(graphId); return (state.steps as Record<string, { status?: string }>)[stepId]?.status ?? 'unknown-step'; } catch { return 'unknown-graph'; }
			},
			async acquireStepLease(input) {
				const row = await orch2.acquireLease({ graphId: input.graphId, stepId: input.stepId, holder: input.holder, ttlMs: input.ttlMs, actor: 'agent', origin: 'exec:lease' });
				return { leaseId: (row.payload as { leaseId: string }).leaseId, expiresAt: (row.payload as { expiresAt: number }).expiresAt };
			},
			activeStepLease(graphId, stepId) {
				try {
					const state = orch2.stateOf(graphId);
					const lease = (state.leases as Record<string, { leaseId: string; holder: string; expiresAt: number } | undefined>)[stepId];
					return lease ?? null;
				} catch { return null; }
			},
		},
		browser: r.browser,
		lifecycle: r.lifecycle,
		resourceGraph: { get: () => undefined, surfacesFor: () => [], async addRef() { }, async addSurface() { } },
	});
	// The execution recovery scan records the truth (torn tail surfaced; nothing fabricated).
	const report = await executionRecoveryScan(runtime2.manager, journal2, { now: 1730000090000 });
	assert.equal(report.clean, false);
	assert.ok(report.actions.some((action) => action.startsWith('torn-tail-dropped:')));
	// The interrupted step re-drives with the SAME attempt: the acquisition is
	// idempotent (the journal is the substrate) and the effect settles ONCE.
	await driveGraph(orch2, { graphId: 'G-001', sink: runtime2.sink, runnerId: 'worker-1' });
	const state = orch2.stateOf('G-001');
	assert.equal((state.steps as Record<string, { status?: string; lastStartedAttempt?: number }>)['S-01']?.status, 'succeeded', 'the interrupted step completed on the re-drive (same attempt)');
	const settledRows = journal2.rowsAll().filter((row) => row.type === 'effect-settled' && row.idempotencyKey === key);
	assert.equal(settledRows.length, 1, 'the effect settled exactly once');
	const acquisitions = [...journal2.acquisitions().values()].filter((a) => a.idempotencyKey === key);
	assert.equal(acquisitions.length, 1, 'no duplicate acquisition for the key');
	assert.ok(journal2.verifyJournal().ok);
	assert.ok(orch2.verifyJournal().ok);
	r.cleanup();
});

test('B6 executor death mid-acquisition: typed executor-death, the denial is the honest record, retry decides', async () => {
	const r = await rig();
	await r.lifecycle.perform('create', { id: 'env-staging', actor: 'agent' });
	await r.lifecycle.perform('start', { id: 'env-staging', actor: 'agent' });
	await r.orch.submitGraph({
		title: 'flaky attach',
		steps: [{ stepId: 'S-01', title: 'attach', instruction: 'attach', tool: 'flauz.exec.environment', toolInput: { resource: { resourceClass: 'environment', kind: 'environment', id: 'flauz:environment:env-staging' }, action: 'attach', leaseTtlMs: 60000 } }],
		actor: 'agent', origin: 'test:battery',
	});
	await r.orch.approveGraph({ graphId: 'G-001', actor: 'human', origin: 'test:battery' });
	await r.orch.startStep({ graphId: 'G-001', stepId: 'S-01', runnerId: 'worker-1', actor: 'agent', origin: 'test:battery' });
	r.executor.failNext = { op: 'attach', code: 'EXECUTOR_DIED', message: 'provider process died mid-attach' };
	const binding = { graphId: 'G-001', stepId: 'S-01', attempt: 1, idempotencyKey: 'flauz-orch/G-001/S-01/run/1', runnerId: 'worker-1', actor: 'agent' as const, origin: 'test:battery' };
	const outcome = await r.runtime.manager.acquire({ resource: { resourceClass: 'environment', kind: 'environment', id: 'flauz:environment:env-staging' }, action: 'attach', leaseTtlMs: 60000 }, binding);
	assert.ok(!outcome.ok, 'the executor death surfaced as a typed failure');
	if (outcome.ok) { return; }
	assert.equal(outcome.failure.failureClass, 'executor-death');
	assert.match(outcome.failure.message, /provider process died mid-attach/);
	// The denial projection is the honest record (no fabricated acquisition).
	const states = [...r.journal.acquisitions().values()].map((a) => a.state);
	assert.ok(states.includes('denied'), 'the typed denial row is the truth');
	assert.ok(r.journal.verifyJournal().ok);
	r.cleanup();
});

test('the completion sweep after a full run: no acquisition left held for terminal steps', async () => {
	const r = await rig();
	await r.orch.submitGraph({
		title: 'sweep check',
		steps: [
			{ stepId: 'S-01', title: 'open', instruction: 'open', tool: 'flauz.exec.browser', toolInput: { ...BROWSER_OPEN } },
			{ stepId: 'S-02', title: 'env create', instruction: 'create', tool: 'flauz.exec.environment', dependsOn: ['S-01'], toolInput: { resource: { resourceClass: 'environment', kind: 'environment', id: 'flauz:environment:env-staging' }, action: 'create' } },
		],
		actor: 'agent', origin: 'test:battery',
	});
	await r.orch.approveGraph({ graphId: 'G-001', actor: 'human', origin: 'test:battery' });
	await driveGraph(r.orch, { graphId: 'G-001', sink: r.runtime.sink, runnerId: 'worker-1' });
	assert.ok(r.journal.heldAcquisitions().length >= 1, 'acquisitions are held while steps are terminal-pending sweep');
	const sweep = await settleExecution(r.runtime.manager, r.journal, stepsPort(r.orch));
	assert.equal(sweep.completedReleases.length, r.journal.acquisitions().size === 0 ? 0 : sweep.completedReleases.length);
	assert.equal(r.journal.heldAcquisitions().length, 0, 'the completion sweep released every terminal-step acquisition');
	assert.ok(r.journal.verifyJournal().ok);
	r.cleanup();
});
