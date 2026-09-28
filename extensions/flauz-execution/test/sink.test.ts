/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-S2 M3 capstone: the execution-resource EFFECT SINK driven by the
 * REAL durable orchestration runtime - driveGraph
 * (extensions/flauz-agent/core/runtime.mjs) over the REAL OrchestrationStore,
 * with the REAL BrowserSessionManager (FakeCdpTransport + policy engine),
 * the REAL EnvironmentLifecycleManager + FakeExecutor, and the REAL
 * ResourceGraph. Everything a durable step targets flows through the
 * existing TL3 contracts end to end.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OrchestrationStore } from '../../flauz-agent/core/orchStore.mjs';
import { driveGraph } from '../../flauz-agent/core/runtime.mjs';
import { BrowserSessionManager } from '../../flauz-browser/src/runtime/sessionManager.ts';
import { CdpEndpointHost } from '../../flauz-browser/src/runtime/host.ts';
import { FakeBrowserState, FakeCdpTransport } from '../../flauz-browser/src/cdp/fake.ts';
import { BrowserPolicyEngine } from '../../flauz-browser/src/policy.ts';
import { EnvironmentRegistry } from '../../flauz-environments/src/registry.ts';
import { EnvironmentLifecycleManager } from '../../flauz-environments/src/lifecycle/manager.ts';
import type { DescribeVerdict, ExecutorEffectResult } from '../../flauz-environments/src/lifecycle/types.ts';
import type { EnvironmentExecutor } from '../../flauz-environments/src/lifecycle/executor.ts';
import { ResourceGraph } from '../../flauz-resources/src/graph.ts';
import { ExecJournalStore } from '../src/journal.ts';
import { createExecutionRuntime, settleExecution, type StepStatusPort } from '../src/runtime.ts';
import type { GraphStatePort } from '../src/acquisition.ts';
import { pinnedMinter, steppingClock, tempRoot } from './helpers.ts';

const WORKSPACE_ROOT = '/ws/acme';
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
		rename: async (from: string, to: string) => { files.set(to, files.get(from) ?? ''); files.delete(from); },
		mkdir: async () => undefined,
	};
}

class FakeEnvExecutor implements EnvironmentExecutor {
	readonly executorKind = 'fake-local';
	readonly infrastructureClass = 'real' as const;
	readonly kinds = ['workspace-remote'] as const;
	readonly calls: string[] = [];
	failNext: { op: string; code: string; message: string } | undefined;
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
		if (this.phase === 'running') { return { health: 'healthy', state: 'running', pid: 4242, message: 'ok' }; }
		if (this.phase === 'created') { return { health: 'not-running', state: 'created', pid: null, message: 'created' }; }
		return { health: 'not-created', state: 'registered', pid: null, message: 'registered' };
	}
}

interface FullRig {
	root: string;
	cleanup: () => void;
	orch: OrchestrationStore;
	journal: ExecJournalStore;
	runtime: ReturnType<typeof createExecutionRuntime>;
	transports: FakeCdpTransport[];
	envExecutor: FakeEnvExecutor;
}

async function rig(): Promise<FullRig> {
	const { root, cleanup } = tempRoot();
	const clock = steppingClock(1730000000000, 100);
	const orch = new OrchestrationStore(root, { clock });
	const graphState: GraphStatePort = {
		stepStatus(graphId, stepId) {
			try {
				const state = orch.stateOf(graphId);
				return (state.steps as Record<string, { status?: string }>)[stepId]?.status ?? 'unknown-step';
			} catch { return 'unknown-graph'; }
		},
		acquireStepLease(input) {
			const row = orch.acquireLease({ graphId: input.graphId, stepId: input.stepId, holder: input.holder, ttlMs: input.ttlMs, actor: 'agent', origin: 'exec:lease' });
			return { leaseId: (row.payload as { leaseId: string }).leaseId, expiresAt: (row.payload as { expiresAt: number }).expiresAt };
		},
	};
	const state = new FakeBrowserState();
	const transports: FakeCdpTransport[] = [];
	const host = new CdpEndpointHost('ws://127.0.0.1:9222/devtools/browser/fake', {
		transportFactory: () => { const transport = new FakeCdpTransport({ state, commandTimeoutMs: 500 }); transports.push(transport); return transport; },
	});
	const browser = new BrowserSessionManager({ engine: () => BrowserPolicyEngine.fromPolicyText(POLICY), host, workspaceRoot: WORKSPACE_ROOT, commandTimeoutMs: 150, navigationTimeoutMs: 300 });
	const envFs = memFs();
	const registry = new EnvironmentRegistry({ root: '/ws', fs: envFs, clock });
	await registry.bootstrap();
	await registry.register({ id: 'env-staging', kind: 'workspace-remote', label: 'Staging', connection: { authorityPrefix: 'flauz-local' }, trust: { posture: 'trusted', inheritsWorkspaceTrust: false }, capabilities: { agentHost: true, browser: true, exec: true, terminal: true } } as never);
	const envExecutor = new FakeEnvExecutor();
	const lifecycle = new EnvironmentLifecycleManager({ registry, root: '/ws', fs: envFs, clock, executors: [envExecutor] });
	await lifecycle.bootstrap();
	const resourceGraph = new ResourceGraph({ root, fs: memFs(), clock });
	await resourceGraph.bootstrap();
	const journal = new ExecJournalStore(root, { clock, mintAcquisitionId: pinnedMinter() });
	const runtime = createExecutionRuntime({ journal, graphState, browser, lifecycle, resourceGraph, clock });
	return { root, cleanup, orch, journal, runtime, transports, envExecutor };
}

const stepsPortOf = (orch: OrchestrationStore): StepStatusPort => ({
	stepStatus(graphId, stepId) {
		try {
			const state = orch.stateOf(graphId);
			return (state.steps as Record<string, { status?: string }>)[stepId]?.status ?? 'unknown-step';
		} catch { return 'unknown-graph'; }
	},
});

test('end to end: a durable step targets a browser session through the REAL TL3 contracts', async () => {
	const r = await rig();
	await r.orch.submitGraph({
		title: 'docs verification',
		steps: [{ stepId: 'S-01', title: 'navigate', instruction: 'open a session and navigate to the docs', tool: 'flauz.exec.browser', toolInput: { action: 'open', url: 'https://docs.example.com', purpose: 'verify the docs page' } }],
		actor: 'agent', origin: 'test:sink',
	});
	r.orch.approveGraph({ graphId: 'G-001', actor: 'human', origin: 'test:sink' });
	await driveGraph(r.orch, { graphId: 'G-001', sink: r.runtime.sink, runnerId: 'worker-1' });
	const state = r.orch.stateOf('G-001');
	assert.equal((state.steps as Record<string, { status?: string }>)['S-01']?.status, 'succeeded', 'the step SUCCEEDED through the real runtime');
	assert.equal(state.graphStatus, 'completed');
	// the exec journal carries the full lifecycle
	const acquisitions = [...r.journal.acquisitions().values()];
	assert.equal(acquisitions.length, 1);
	assert.equal(acquisitions[0]?.state, 'acquired');
	assert.equal(acquisitions[0]?.surfaceDigests.length, 1, 'the open hand-off (the startUrl navigation runs inside the real manager.open)');
	assert.notEqual(r.journal.settledRowFor('flauz-orch/G-001/S-01/run/1'), undefined);
	// the completion sweep releases (the step reached a terminal status)
	const sweep = await settleExecution(r.runtime.manager, r.journal, stepsPortOf(r.orch));
	assert.deepEqual(sweep.completedReleases, [acquisitions[0]?.acquisitionId]);
	assert.equal(r.journal.acquisitionOf(acquisitions[0]?.acquisitionId ?? '').state, 'released');
	assert.ok(r.journal.verifyJournal().ok);
	assert.ok(r.orch.verifyJournal().ok);
	r.cleanup();
});

test('replay: re-driving the SAME step replays the settled effect (no duplicate side effects, no duplicate rows)', async () => {
	const r = await rig();
	await r.orch.submitGraph({
		title: 'replay check',
		steps: [{ stepId: 'S-01', title: 'navigate', instruction: 'open + navigate', tool: 'flauz.exec.browser', toolInput: { action: 'open', url: 'https://docs.example.com' } }],
		actor: 'agent', origin: 'test:sink',
	});
	r.orch.approveGraph({ graphId: 'G-001', actor: 'human', origin: 'test:sink' });
	await driveGraph(r.orch, { graphId: 'G-001', sink: r.runtime.sink, runnerId: 'worker-1' });
	const rowsAfterFirst = r.journal.rowsAll().length;
	const browserSessionsAfterFirst = r.journal.acquisitions().size;
	// crash-free re-drive: the graph is completed; a second drive is a no-op at the graph level
	await driveGraph(r.orch, { graphId: 'G-001', sink: r.runtime.sink, runnerId: 'worker-1' });
	assert.equal(r.journal.rowsAll().length, rowsAfterFirst, 'no new exec rows');
	assert.equal(r.journal.acquisitions().size, browserSessionsAfterFirst);
	// the sink replays the settled effect for the same key directly
	const replayed = await r.runtime.sink.run('flauz-orch/G-001/S-01/run/1', { graphId: 'G-001', stepId: 'S-01', attempt: 1, tool: 'flauz.exec.browser', toolInput: { action: 'open', url: 'https://docs.example.com' }, instruction: 'x' });
	assert.equal(replayed.replayed, true);
	r.cleanup();
});

test('a denied step fails the graph TERMINALLY (policy-violation is not retried)', async () => {
	const r = await rig();
	await r.orch.submitGraph({
		title: 'denied navigation',
		steps: [{ stepId: 'S-01', title: 'navigate', instruction: 'navigate to a denied host', tool: 'flauz.exec.browser', toolInput: { action: 'open', url: 'https://evil.example.net' } }],
		actor: 'agent', origin: 'test:sink',
	});
	r.orch.approveGraph({ graphId: 'G-001', actor: 'human', origin: 'test:sink' });
	await driveGraph(r.orch, { graphId: 'G-001', sink: r.runtime.sink, runnerId: 'worker-1' });
	const state = r.orch.stateOf('G-001');
	const step = (state.steps as Record<string, { status?: string; failure?: { class?: string } }>)['S-01'];
	assert.equal(step?.status, 'failed');
	assert.equal(step?.failure?.class, 'policy-violation', 'fail-closed maps to the terminal orchestration class');
	// no retry was scheduled (terminal - the fail-closed posture)
	assert.equal((state.steps as Record<string, { nextAttempt?: unknown }>)['S-01']?.nextAttempt ?? null, null);
	const deniedRows = r.journal.rowsAll().filter((row) => row.type === 'acquire-denied');
	assert.equal(deniedRows.length, 1);
	assert.equal((deniedRows[0]?.payload as Record<string, unknown>)['gate'], 'browser-policy');
	r.cleanup();
});

test('an environment step: create + attach through the REAL lifecycle manager (lease-bound)', async () => {
	const r = await rig();
	await r.orch.submitGraph({
		title: 'env bring-up',
		steps: [
			{ stepId: 'S-01', title: 'create', instruction: 'create the staging environment', tool: 'flauz.exec.environment', toolInput: { resource: { resourceClass: 'environment', kind: 'environment', id: 'flauz:environment:env-staging' }, action: 'create' } },
			{ stepId: 'S-02', title: 'start', instruction: 'start the staging environment', tool: 'flauz.exec.environment', dependsOn: ['S-01'], toolInput: { resource: { resourceClass: 'environment', kind: 'environment', id: 'flauz:environment:env-staging' }, action: 'start' } },
			{ stepId: 'S-03', title: 'attach', instruction: 'attach with a task-step lease', tool: 'flauz.exec.environment', dependsOn: ['S-02'], toolInput: { resource: { resourceClass: 'environment', kind: 'environment', id: 'flauz:environment:env-staging' }, action: 'attach', leaseTtlMs: 60000, purpose: 'run checks' } },
		],
		actor: 'agent', origin: 'test:sink',
	});
	r.orch.approveGraph({ graphId: 'G-001', actor: 'human', origin: 'test:sink' });
	await driveGraph(r.orch, { graphId: 'G-001', sink: r.runtime.sink, runnerId: 'worker-1' });
	const state = r.orch.stateOf('G-001');
	const steps = state.steps as Record<string, { status?: string }>;
	assert.equal(steps['S-01']?.status, 'succeeded');
	assert.equal(steps['S-02']?.status, 'succeeded');
	assert.equal(steps['S-03']?.status, 'succeeded', 'the attach step succeeded');
	assert.equal(state.graphStatus, 'completed');
	const leased = [...r.journal.acquisitions().values()].filter((a) => a.lease !== null);
	assert.equal(leased.length, 1, 'the attach acquisition carries the task-step lease');
	assert.match(leased[0]?.lease?.leaseId ?? '', /^L-001-03-1$/);
	const orchLease = r.orch.rowsFor('G-001').find((row) => row.type === 'lease-acquired');
	assert.notEqual(orchLease, undefined, 'the REAL orchestration journal recorded the lease');
	assert.ok(r.orch.verifyJournal().ok);
	assert.ok(r.journal.verifyJournal().ok);
	r.cleanup();
});
