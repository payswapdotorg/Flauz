/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-S2 M4 suite: the continuity integration points against the REAL
 * TL3-006 capability (flauz-environments src/continuityExec:
 * ContinuityManager over flauz.continuity-bundle/v0 +
 * flauz.continuity-ops/v0) + the REAL lifecycle manager + the REAL browser
 * session manager.
 *
 * The cross-environment restoration drill: a durable step acquires an
 * environment; the environment is destroyed (churn); continuity is
 * exported + restored; the acquisition rebinds with task state,
 * authorization state and provenance SURVIVING - no fabricated rows, no
 * lost hand-off metadata. The browser drill: session loss + reattach.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { OrchestrationStore } from '../../flauz-agent/core/orchStore.mjs';
import { driveGraph } from '../../flauz-agent/core/runtime.mjs';
import { ContinuityManager } from '../../flauz-environments/src/continuityExec/manager.ts';
import { EnvironmentRegistry } from '../../flauz-environments/src/registry.ts';
import { EnvironmentLifecycleManager } from '../../flauz-environments/src/lifecycle/manager.ts';
import type { DescribeVerdict, ExecutorEffectResult } from '../../flauz-environments/src/lifecycle/types.ts';
import type { EnvironmentExecutor } from '../../flauz-environments/src/lifecycle/executor.ts';
import { BrowserSessionManager } from '../../flauz-browser/src/runtime/sessionManager.ts';
import { CdpEndpointHost } from '../../flauz-browser/src/runtime/host.ts';
import { FakeBrowserState, FakeCdpTransport } from '../../flauz-browser/src/cdp/fake.ts';
import { BrowserPolicyEngine } from '../../flauz-browser/src/policy.ts';
import { ExecJournalStore } from '../src/journal.ts';
import { createExecutionRuntime } from '../src/runtime.ts';
import {
	bindContinuityExport,
	reattachBrowserSession,
	restoreEnvironmentContinuity,
	type ContinuityPort,
} from '../src/continuity.ts';
import type { GraphStatePort } from '../src/acquisition.ts';
import { pinnedMinter, steppingClock, tempRoot } from './helpers.ts';

const POLICY = JSON.stringify({
	schemaVersion: 0,
	driver: { allow: ['*.example.com'] },
	webRequest: { allow: ['*.example.com'] },
	willNavigate: { allow: ['*'] },
	partitions: { scope: 'persist', perAgent: true },
});

/** A continuity-capable in-memory fs (the ContinuityFsPort shape). */
function contFs(seed: Record<string, string> = {}) {
	const files = new Map<string, string>(Object.entries(seed));
	const dirs = new Set<string>();
	return {
		readFileUtf8: async (path: string) => files.get(path),
		writeFile: async (path: string, contents: string) => { files.set(path, contents); },
		appendFile: async (path: string, contents: string) => { files.set(path, (files.get(path) ?? '') + contents); },
		rename: async (from: string, to: string) => {
			// Directory-aware rename (the bundle commit renames the staging dir).
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
		mkdir: async (path: string) => { dirs.add(path); },
		readdir: async (path: string) => {
			if (!dirs.has(path) && ![...files.keys()].some((key) => key.startsWith(`${path}/`))) {
				return undefined;
			}
			const names = new Set<string>();
			for (const key of [...files.keys()]) {
				if (key.startsWith(`${path}/`)) {
					names.add(key.slice(path.length + 1).split('/')[0] ?? '');
				}
			}
			return [...names].filter((name) => name.length > 0).sort().map((name) => ({ name, kind: 'file' as const, isFile: () => true, isDirectory: () => false }));
		},
		rm: async (path: string) => {
			files.delete(path);
			for (const key of [...files.keys()]) {
				if (key.startsWith(`${path}/`)) {
					files.delete(key);
				}
			}
		},
	};
}

class FakeEnvExecutor implements EnvironmentExecutor {
	readonly executorKind = 'fake-local';
	readonly infrastructureClass = 'real' as const;
	readonly kinds = ['workspace-remote'] as const;
	readonly calls: string[] = [];
	private phase: 'registered' | 'created' | 'running' | 'destroyed' = 'registered';
	private leaseCounter = 0;
	private record(op: string): ExecutorEffectResult {
		this.calls.push(op);
		if (op === 'create') { this.phase = 'created'; }
		if (op === 'start') { this.phase = 'running'; return { ok: true, detail: { type: 'start', pid: 4242 } }; }
		if (op === 'stop') { this.phase = 'created'; }
		if (op === 'destroy') { this.phase = 'destroyed'; return { ok: true, detail: { type: 'destroy', pid: null } }; }
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
		if (this.phase === 'destroyed') { return { health: 'destroyed', state: 'destroyed', pid: null, message: 'destroyed' }; }
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
	lifecycle: EnvironmentLifecycleManager;
	executor: FakeEnvExecutor;
	continuity: ContinuityPort;
	transports: FakeCdpTransport[];
	browser: BrowserSessionManager;
}

async function rig(options: { trust?: string } = {}): Promise<Rig> {
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
			} catch {
				return null;
			}
		},
	};
	const envFs = contFs({ [join('.flauz', 'tasks.json')]: '{"$schema":"flauz.tasks/v0","tasks":[]}' });
	const registry = new EnvironmentRegistry({ root: '/ws', fs: envFs, clock });
	await registry.bootstrap();
	await registry.register({ id: 'env-staging', kind: 'workspace-remote', label: 'Staging', connection: { authorityPrefix: 'flauz-local' }, trust: { posture: options.trust ?? 'trusted', inheritsWorkspaceTrust: false }, capabilities: { agentHost: true, browser: true, exec: true, terminal: true } } as never);
	const executor = new FakeEnvExecutor();
	const lifecycle = new EnvironmentLifecycleManager({ registry, root: '/ws', fs: envFs, clock, executors: [executor] });
	await lifecycle.bootstrap();
	const continuityManager = new ContinuityManager({ root, fs: envFs as never, clock, mintId: () => 'flauz:continuity:0123456789abcdef', registry: registry as never });
	const continuity: ContinuityPort = continuityManager as unknown as ContinuityPort;
	const state = new FakeBrowserState();
	const transports: FakeCdpTransport[] = [];
	const host = new CdpEndpointHost('ws://127.0.0.1:9222/devtools/browser/fake', { transportFactory: () => { const transport = new FakeCdpTransport({ state, commandTimeoutMs: 500 }); transports.push(transport); return transport; } });
	const browser = new BrowserSessionManager({ engine: () => BrowserPolicyEngine.fromPolicyText(POLICY), host, workspaceRoot: '/ws/acme', commandTimeoutMs: 150, navigationTimeoutMs: 300 });
	const journal = new ExecJournalStore(root, { clock, mintAcquisitionId: pinnedMinter() });
	const runtime = createExecutionRuntime({ journal, graphState, browser, lifecycle, resourceGraph: { get: () => undefined, surfacesFor: () => [], async addRef() { }, async addSurface() { } }, clock });
	return { root, cleanup, orch, journal, runtime, lifecycle, executor, continuity, transports, browser };
}

const ENV_REF = { resourceClass: 'environment', kind: 'environment', id: 'flauz:environment:env-staging' } as const;

test('continuity export: the REAL ContinuityManager export is journaled as a first-class row', async () => {
	const r = await rig();
	const outcome = await bindContinuityExport(r.journal, r.continuity, { environmentId: 'env-staging', origin: 'test:continuity', actor: 'agent' });
	assert.ok(outcome.ok, outcome.ok ? '' : JSON.stringify((outcome as { error?: unknown }).error));
	if (!outcome.ok) { return; }
	assert.equal(outcome.bundleId, 'flauz:continuity:0123456789abcdef');
	assert.ok(outcome.carried + outcome.lost + outcome.redacted > 0, 'the REAL surface canon was classified');
	const row = r.journal.rowsAll().find((row) => row.type === 'continuity-exported');
	assert.notEqual(row, undefined);
	const payload = row?.payload as Record<string, unknown>;
	assert.equal(payload.bundleId, 'flauz:continuity:0123456789abcdef');
	assert.equal(payload.environmentId, 'env-staging');
	assert.ok(r.journal.verifyJournal().ok);
	r.cleanup();
});

test('cross-environment restoration: destroy + restore rebinds the LOST acquisition (task state, authorization, provenance survive)', async () => {
	const r = await rig();
	// 1. A durable step acquires the environment (create -> start -> attach).
	await r.orch.submitGraph({
		title: 'env task',
		steps: [
			{ stepId: 'S-01', title: 'create', instruction: 'create', tool: 'flauz.exec.environment', toolInput: { resource: { ...ENV_REF }, action: 'create' } },
			{ stepId: 'S-02', title: 'start', instruction: 'start', tool: 'flauz.exec.environment', dependsOn: ['S-01'], toolInput: { resource: { ...ENV_REF }, action: 'start' } },
			{ stepId: 'S-03', title: 'attach', instruction: 'attach', tool: 'flauz.exec.environment', dependsOn: ['S-02'], toolInput: { resource: { ...ENV_REF }, action: 'attach', leaseTtlMs: 600000, purpose: 'long check' } },
		],
		actor: 'agent', origin: 'test:continuity',
	});
	await r.orch.approveGraph({ graphId: 'G-001', actor: 'human', origin: 'test:continuity' });
	await driveGraph(r.orch, { graphId: 'G-001', sink: r.runtime.sink, runnerId: 'worker-1' });
	const attached = [...r.journal.acquisitions().values()].find((a) => a.lease !== null);
	assert.notEqual(attached, undefined, 'the attach acquisition exists');
	if (attached === undefined) { return; }
	const digestCountBefore = attached.surfaceDigests.length;

	// 2. Churn: the environment is destroyed -> the acquisition is marked lost.
	await r.lifecycle.perform('stop', { id: 'env-staging', actor: 'tool' });
	await r.lifecycle.perform('destroy', { id: 'env-staging', actor: 'tool' });
	r.journal.appendRow('resource-lost', {
		graphId: attached.graphId, stepId: attached.stepId, attempt: attached.attempt, idempotencyKey: null,
		acquisitionId: attached.acquisitionId, actor: 'service', origin: 'exec:probe',
		payload: { detectedBy: 'probe', failureClass: 'executor-death', message: 'environment destroyed (churn)' },
	});
	assert.equal(r.journal.acquisitionOf(attached.acquisitionId).state, 'lost');

	// 3. Continuity export + restore (the REAL capability).
	const exported = await bindContinuityExport(r.journal, r.continuity, { environmentId: 'env-staging', origin: 'test:continuity', actor: 'agent' });
	if (!exported.ok) { console.error((exported as { error?: unknown }).error); }
	assert.ok(exported.ok, JSON.stringify((exported as { error?: unknown }).error));
	// The environment is re-created + re-started after restore (the lifecycle ops).
	await r.lifecycle.perform('create', { id: 'env-staging', actor: 'tool' });
	await r.lifecycle.perform('start', { id: 'env-staging', actor: 'tool' });
	const restored = await restoreEnvironmentContinuity(r.journal, r.continuity, r.lifecycle, { bundleId: 'flauz:continuity:0123456789abcdef', targetEnvironmentId: 'env-staging', origin: 'exec:continuity', actor: 'service' });
	assert.ok(restored.ok, restored.ok ? '' : JSON.stringify((restored as { error?: unknown }).error));
	if (!restored.ok) { return; }
	assert.equal(restored.rebinds.length, 1);
	assert.equal(restored.rebinds[0]?.rebound, true, restored.rebinds[0]?.reason);

	// 4. The assertions: state, authorization, provenance.
	const after = r.journal.acquisitionOf(attached.acquisitionId);
	assert.equal(after.state, 'acquired', 'the acquisition REBOUND (lost -> acquired)');
	assert.ok(after.surfaceDigests.length > digestCountBefore, 'the new surface hand-off is recorded');
	const restoredRows = r.journal.rowsAll().filter((row) => row.type === 'continuity-restored');
	assert.equal(restoredRows.length, 1);
	const payload = restoredRows[0]?.payload as Record<string, unknown>;
	assert.equal(payload.bundleId, 'flauz:continuity:0123456789abcdef');
	assert.equal(payload.authorizationRegated, true);
	// Task state survived: the orchestration journal is intact + completed.
	assert.ok(r.orch.verifyJournal().ok);
	const state = r.orch.stateOf('G-001');
	assert.equal(state.graphStatus, 'completed');
	// Provenance survived: the journal verifies (hash chain + content links).
	assert.ok(r.journal.verifyJournal().ok);
	r.cleanup();
});

test('cross-environment restoration on an UNTRUSTED target: NO rebind (fail-closed; the acquisition stays lost)', async () => {
	const r = await rig({ trust: 'untrusted' });
	// Seed a lost environment acquisition (the churn path).
	r.journal.appendRow('resource-acquired', {
		graphId: 'G-001', stepId: 'S-02', attempt: 1, idempotencyKey: 'flauz-orch/G-001/S-02/run/1',
		acquisitionId: 'flauz:exec:0000000000000002', actor: 'agent', origin: 'test',
		payload: { purpose: 'churn path', resource: { ...ENV_REF } },
	});
	r.journal.appendRow('resource-lost', {
		graphId: 'G-001', stepId: 'S-02', attempt: 1, idempotencyKey: null,
		acquisitionId: 'flauz:exec:0000000000000002', actor: 'service', origin: 'test',
		payload: { detectedBy: 'probe', failureClass: 'executor-death', message: 'churn' },
	});
	// An export WITHOUT the environment id (the source env is untrusted - the
	// manager fail-closes environment-scoped exports on unverified trust).
	const exported = await bindContinuityExport(r.journal, r.continuity, { origin: 'test:continuity', actor: 'agent' });
	assert.ok(exported.ok, JSON.stringify((exported as { error?: unknown }).error));
	if (!exported.ok) { return; }
	// The restore itself hits the manager's fail-closed trust gate for the
	// unregistered target, OR the rebind layer refuses: BOTH are honest - no
	// acquisition is ever rebound on an untrusted target.
	const restored = await restoreEnvironmentContinuity(r.journal, r.continuity, r.lifecycle, { bundleId: exported.bundleId, targetEnvironmentId: 'env-staging', origin: 'exec:continuity' });
	if (!restored.ok) {
		// The REAL manager denied the restore (fail-closed) - the typed error surfaces.
		assert.ok(['TRUST_POSTURE_REJECTED', 'ENVIRONMENT_UNKNOWN', 'RESTORE_TARGET_NOT_EMPTY'].includes(restored.error.code), JSON.stringify(restored.error));
		assert.equal(r.journal.acquisitionOf('flauz:exec:0000000000000002').state, 'lost');
	} else {
		assert.equal(restored.rebinds.length, 0, 'no lost environment acquisition matched a trusted rebind');
	}
	assert.equal(r.journal.acquisitionOf('flauz:exec:0000000000000002').state, 'lost', 'the acquisition honestly stays lost');
	assert.ok(r.journal.verifyJournal().ok);
	r.cleanup();
});

test('browser session loss + reattach: the same logical session rebinds with a fresh surface + policyRecheck pass', async () => {
	const r = await rig();
	await r.orch.submitGraph({
		title: 'browser task',
		steps: [{ stepId: 'S-01', title: 'open', instruction: 'open a session', tool: 'flauz.exec.browser', toolInput: { action: 'open', url: 'https://docs.example.com' } }],
		actor: 'agent', origin: 'test:continuity',
	});
	await r.orch.approveGraph({ graphId: 'G-001', actor: 'human', origin: 'test:continuity' });
	await driveGraph(r.orch, { graphId: 'G-001', sink: r.runtime.sink, runnerId: 'worker-1' });
	const acquisition = [...r.journal.acquisitions().values()][0];
	assert.notEqual(acquisition, undefined);
	if (acquisition === undefined) { return; }
	const sessionId = acquisition.resource.id;
	const digestsBefore = acquisition.surfaceDigests.length;

	// Session loss: the transport drops; the acquisition is marked lost.
	const transport = r.transports[r.transports.length - 1];
	if (transport !== undefined) { transport.drop(); }
	r.journal.appendRow('resource-lost', {
		graphId: acquisition.graphId, stepId: acquisition.stepId, attempt: acquisition.attempt, idempotencyKey: null,
		acquisitionId: acquisition.acquisitionId, actor: 'service', origin: 'exec:drop',
		payload: { detectedBy: 'manager-report', failureClass: 'resource-lost', message: 'transport drop' },
	});
	assert.equal(r.journal.acquisitionOf(acquisition.acquisitionId).state, 'lost');

	// The manager's recovery reconciles the session (a fresh transport is
	// dialed by the factory; the same logical session id survives).
	await r.browser.awaitRecovery();
	const outcome = await reattachBrowserSession(r.journal, r.browser, { acquisitionId: acquisition.acquisitionId, origin: 'exec:reattach' });
	assert.ok(outcome.ok, outcome.ok ? '' : JSON.stringify((outcome as { error?: unknown }).error));
	if (!outcome.ok) { return; }
	const after = r.journal.acquisitionOf(acquisition.acquisitionId);
	assert.equal(after.state, 'acquired', 'the acquisition rebound (lost -> acquired via reattach)');
	assert.equal(after.resource.id, sessionId, 'the SAME logical session id (identity survives churn)');
	assert.ok(after.surfaceDigests.length > digestsBefore, 'the fresh surface hand-off is recorded');
	const reattachRow = r.journal.rowsAll().find((row) => row.type === 'session-reattached');
	assert.notEqual(reattachRow, undefined);
	assert.equal((reattachRow?.payload as Record<string, unknown>).policyRecheck, 'pass');
	assert.ok(r.journal.verifyJournal().ok);
	assert.ok(r.orch.verifyJournal().ok);
	r.cleanup();
});

test('browser reattach: a closed session is NOT rebound (typed error, honest state)', async () => {
	const r = await rig();
	await r.orch.submitGraph({
		title: 'browser task close',
		steps: [{ stepId: 'S-01', title: 'open', instruction: 'open', tool: 'flauz.exec.browser', toolInput: { action: 'open', url: 'https://docs.example.com' } }],
		actor: 'agent', origin: 'test:continuity',
	});
	await r.orch.approveGraph({ graphId: 'G-001', actor: 'human', origin: 'test:continuity' });
	await driveGraph(r.orch, { graphId: 'G-001', sink: r.runtime.sink, runnerId: 'worker-1' });
	const acquisition = [...r.journal.acquisitions().values()][0];
	if (acquisition === undefined) { return; }
	await r.browser.close(acquisition.resource.id);
	r.journal.appendRow('resource-lost', {
		graphId: acquisition.graphId, stepId: acquisition.stepId, attempt: acquisition.attempt, idempotencyKey: null,
		acquisitionId: acquisition.acquisitionId, actor: 'service', origin: 'exec:close',
		payload: { detectedBy: 'manager-report', failureClass: 'resource-lost', message: 'session closed' },
	});
	const outcome = await reattachBrowserSession(r.journal, r.browser, { acquisitionId: acquisition.acquisitionId, origin: 'exec:reattach' });
	assert.ok(!outcome.ok);
	assert.equal(r.journal.acquisitionOf(acquisition.acquisitionId).state, 'lost', 'a closed session stays lost');
	r.cleanup();
});
