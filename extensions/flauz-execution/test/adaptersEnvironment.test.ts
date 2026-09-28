/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-S2 M3 suite (environments): the EnvironmentExecutionAdapter against
 * the REAL flauz-environments runtime - EnvironmentRegistry +
 * EnvironmentLifecycleManager + a scriptable FakeExecutor (the lifecycle
 * test rig pattern). The structural port is satisfied by the real manager.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EnvironmentRegistry } from '../../flauz-environments/src/registry.ts';
import { EnvironmentLifecycleManager } from '../../flauz-environments/src/lifecycle/manager.ts';
import type { DescribeVerdict, ExecutorEffectResult } from '../../flauz-environments/src/lifecycle/types.ts';
import type { EnvironmentExecutor } from '../../flauz-environments/src/lifecycle/executor.ts';
import type { EnvironmentDescriptor } from '../../flauz-environments/src/api.ts';
import { EnvironmentExecutionAdapter } from '../src/adapters.ts';
import { ExecJournalStore } from '../src/journal.ts';
import type { StepBinding } from '../src/acquisition.ts';
import { ENVIRONMENT_REF, pinnedMinter, steppingClock, tempRoot } from './helpers.ts';

const ROOT = '/ws';

/** In-memory FileSystemPort (the environments test discipline). */
function memFs(seed: Record<string, string> = {}) {
	const files = new Map<string, string>(Object.entries(seed));
	return {
		readFileUtf8: async (path: string) => files.get(path),
		writeFile: async (path: string, contents: string) => { files.set(path, contents); },
		rename: async (from: string, to: string) => { files.set(to, files.get(from) ?? ''); files.delete(from); },
		mkdir: async () => undefined,
	};
}

/** The scriptable fake executor (the flauz-environments lifecycle rig pattern). */
class FakeExecutor implements EnvironmentExecutor {
	readonly executorKind = 'fake-local';
	readonly infrastructureClass = 'real' as const;
	readonly kinds = ['workspace-remote'] as const;
	readonly calls: string[] = [];
	failNext: { op: string; code: string; message: string } | undefined;
	/** Optional stale/orphan override (the health-degradation injection). */
	probeOverride: DescribeVerdict | undefined;
	private phase: 'registered' | 'created' | 'running' = 'registered';
	private leaseCounter = 0;

	private record(op: string): ExecutorEffectResult {
		this.calls.push(op);
		const failure = this.failNext;
		if (failure !== undefined && failure.op === op) {
			this.failNext = undefined;
			return { ok: false, error: { code: failure.code, message: failure.message } };
		}
		if (op === 'create') {
			this.phase = 'created';
		}
		if (op === 'start') {
			this.phase = 'running';
			return { ok: true, detail: { type: 'start', pid: 4242 } };
		}
		if (op === 'stop') {
			this.phase = 'created';
		}
		if (op === 'destroy') {
			this.phase = 'registered';
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
	async probe(_descriptor: EnvironmentDescriptor): Promise<DescribeVerdict> {
		if (this.probeOverride !== undefined) {
			return this.probeOverride;
		}
		if (this.phase === 'running') {
			return { health: 'healthy', state: 'running', pid: 4242, message: 'fake healthy' };
		}
		if (this.phase === 'created') {
			return { health: 'not-running', state: 'created', pid: null, message: 'created but not started' };
		}
		return { health: 'not-created', state: 'registered', pid: null, message: 'not created' };
	}
}

interface EnvRig {
	adapter: EnvironmentExecutionAdapter;
	manager: EnvironmentLifecycleManager;
	executor: FakeExecutor;
	journal: ExecJournalStore;
	cleanup: () => void;
}

async function rig(options: { trust?: string } = {}): Promise<EnvRig> {
	const { root, cleanup } = tempRoot();
	const fs = memFs();
	const clock = steppingClock(1730000000000);
	const registry = new EnvironmentRegistry({ root: ROOT, fs, clock });
	await registry.bootstrap();
	await registry.register({
		id: 'env-staging',
		kind: 'workspace-remote',
		label: 'Staging',
		connection: { authorityPrefix: 'flauz-local' },
		trust: { posture: options.trust ?? 'trusted', inheritsWorkspaceTrust: false },
		capabilities: { agentHost: true, browser: true, exec: true, terminal: true },
	} as never);
	const executor = new FakeExecutor();
	const manager = new EnvironmentLifecycleManager({ registry, root: ROOT, fs, clock, executors: [executor] });
	await manager.bootstrap();
	const journal = new ExecJournalStore(root, { clock, mintAcquisitionId: pinnedMinter() });
	const memGraph = memGraphPort();
	const adapter = new EnvironmentExecutionAdapter({ lifecycle: manager, graph: memGraph, journal });
	return { adapter, manager, executor, journal, cleanup };
}

function memGraphPort() {
	const refs = new Map<string, { kind: string; id: string }>();
	const surfaces = new Map<string, { refId: string; family: string; versions: { surface: unknown; updatedAt: number }[] }[]>();
	return {
		get: (id: string) => refs.get(id),
		surfacesFor: (id: string) => surfaces.get(id) ?? [],
		async addRef(input: { kind: string; id: string; provenance: unknown }) { refs.set(input.id, { kind: input.kind, id: input.id }); },
		async addSurface(refId: string, surface: Record<string, unknown>) {
			const family = String(surface['kind'] ?? 'unknown');
			const records = surfaces.get(refId) ?? [];
			const record = records.find((candidate) => candidate.family === family);
			if (record === undefined) { records.push({ refId, family, versions: [{ surface, updatedAt: 1 }] }); } else { record.versions.push({ surface, updatedAt: 1 }); }
			surfaces.set(refId, records);
		},
	};
}

function binding(): StepBinding {
	return { graphId: 'G-001', stepId: 'S-01', attempt: 1, idempotencyKey: 'flauz-orch/G-001/S-01/run/1', runnerId: 'worker-1', actor: 'agent', origin: 'test:environment' };
}

test('open (attach): the REAL lifecycle manager attaches; the surface snapshot carries the lease + state', async () => {
	const r = await rig();
	// registered -> created -> started first (the lifecycle law)
	await r.manager.perform('create', { id: 'env-staging', actor: 'agent' });
	await r.manager.perform('start', { id: 'env-staging', actor: 'agent' });
	const opened = await r.adapter.open({ resource: { ...ENVIRONMENT_REF }, action: 'attach', leaseTtlMs: 30000 }, binding());
	assert.ok(opened.ok, opened.ok ? '' : JSON.stringify((opened as { failure?: unknown }).failure));
	if (!opened.ok) { return; }
	assert.equal(opened.surface.resourceClass, 'environment');
	const surface = opened.surface as { lifecycleState: string; attachLeaseId?: string; trustPosture: string; executorKind: string };
	assert.equal(surface.lifecycleState, 'running/attached');
	assert.match(surface.attachLeaseId ?? '', /^lease-\d+$/);
	assert.equal(surface.trustPosture, 'trusted');
	assert.equal(surface.executorKind, 'fake-local');
	r.cleanup();
});

test('open (attach) on an UNTRUSTED environment: start is trust-gated first; the manager verdict surfaces (never bypassed)', async () => {
	const r = await rig({ trust: 'untrusted' });
	await r.manager.perform('create', { id: 'env-staging', actor: 'agent' });
	// The trust gate is authoritative at START: the typed rejection surfaces.
	const startAttempt = await r.manager.perform('start', { id: 'env-staging', actor: 'agent' });
	assert.ok(!startAttempt.ok);
	assert.equal((startAttempt as { error: { code: string } }).error.code, 'TRUST_POSTURE_REJECTED');
	// The env never reaches an attachable state (running) - so attach surfaces
	// the lifecycle law's typed verdict, NOT a bypassed gate.
	const opened = await r.adapter.open({ resource: { ...ENVIRONMENT_REF }, action: 'attach' }, binding());
	assert.ok(!opened.ok);
	if (opened.ok) { return; }
	assert.equal(opened.failure.failureClass, 'invalid-request');
	assert.match(opened.failure.message, /attach illegal in the current state/);
	assert.equal(r.executor.calls.includes('attach'), false, 'the attach op itself never ran');
	r.cleanup();
});

test('open (health): a stale probe verdict is executor-death (retryable class)', async () => {
	const r = await rig();
	await r.manager.perform('create', { id: 'env-staging', actor: 'agent' });
	await r.manager.perform('start', { id: 'env-staging', actor: 'agent' });
	r.executor.probeOverride = { health: 'stale', state: 'running', pid: null, message: 'persisted state outruns the truth' };
	const opened = await r.adapter.open({ resource: { ...ENVIRONMENT_REF }, action: 'snapshot' }, binding());
	assert.ok(!opened.ok);
	if (opened.ok) { return; }
	assert.equal(opened.failure.failureClass, 'executor-death');
	r.cleanup();
});

test('use (lifecycle op): start runs through the REAL manager; the post-op hand-off is journaled', async () => {
	const r = await rig();
	await r.manager.perform('create', { id: 'env-staging', actor: 'agent' });
	const opened = await r.adapter.open({ resource: { ...ENVIRONMENT_REF }, action: 'start' }, binding());
	assert.ok(opened.ok, opened.ok ? '' : JSON.stringify((opened as { failure?: unknown }).failure));
	if (!opened.ok) { return; }
	const acquisitionId = 'flauz:exec:0000000000000001';
	r.journal.appendRow('resource-acquired', {
		graphId: 'G-001', stepId: 'S-01', attempt: 1, idempotencyKey: 'flauz-orch/G-001/S-01/run/1',
		acquisitionId, actor: 'agent', origin: 'test:environment',
		payload: { purpose: 'test', resource: { ...ENVIRONMENT_REF } },
	});
	const used = await r.adapter.use({ resource: { ...ENVIRONMENT_REF }, action: 'start' }, binding(), acquisitionId);
	assert.ok(used.ok, used.ok ? '' : JSON.stringify((used as { failure?: unknown }).failure));
	if (!used.ok) { return; }
	assert.match(used.value, /start env-staging -> running/);
	const handoff = r.journal.rowsAll().filter((row) => row.type === 'handoff-recorded').at(-1);
	assert.notEqual(handoff, undefined);
	const surface = (handoff?.payload as { surface: { lifecycleState: string } }).surface;
	assert.equal(surface.lifecycleState, 'running');
	assert.ok(r.journal.verifyJournal().ok);
	r.cleanup();
});

test('use (op failure): a typed executor failure maps to executor-death', async () => {
	const r = await rig();
	await r.manager.perform('create', { id: 'env-staging', actor: 'agent' });
	const opened = await r.adapter.open({ resource: { ...ENVIRONMENT_REF }, action: 'start' }, binding());
	if (!opened.ok) { return; }
	const acquisitionId = 'flauz:exec:0000000000000001';
	r.journal.appendRow('resource-acquired', {
		graphId: 'G-001', stepId: 'S-01', attempt: 1, idempotencyKey: 'flauz-orch/G-001/S-01/run/1',
		acquisitionId, actor: 'agent', origin: 'test:environment',
		payload: { purpose: 'test', resource: { ...ENVIRONMENT_REF } },
	});
	r.executor.failNext = { op: 'start', code: 'EXECUTOR_FAILURE', message: 'provider degraded' };
	const used = await r.adapter.use({ resource: { ...ENVIRONMENT_REF }, action: 'start' }, binding(), acquisitionId);
	assert.ok(!used.ok);
	if (used.ok) { return; }
	assert.equal(used.failure.failureClass, 'executor-death');
	assert.match(used.failure.message, /provider degraded/);
	r.cleanup();
});

test('use (untrusted start): the trust gate denies mid-flight (use-denied, terminal)', async () => {
	const r = await rig({ trust: 'untrusted' });
	await r.manager.perform('create', { id: 'env-staging', actor: 'agent' });
	const opened = await r.adapter.open({ resource: { ...ENVIRONMENT_REF }, action: 'start' }, binding());
	// open for a non-attach action does not hit the gate; the USE does (authoritative).
	assert.ok(opened.ok);
	if (!opened.ok) { return; }
	const acquisitionId = 'flauz:exec:0000000000000001';
	r.journal.appendRow('resource-acquired', {
		graphId: 'G-001', stepId: 'S-01', attempt: 1, idempotencyKey: 'flauz-orch/G-001/S-01/run/1',
		acquisitionId, actor: 'agent', origin: 'test:environment',
		payload: { purpose: 'test', resource: { ...ENVIRONMENT_REF } },
	});
	const used = await r.adapter.use({ resource: { ...ENVIRONMENT_REF }, action: 'start' }, binding(), acquisitionId);
	assert.ok(!used.ok);
	if (used.ok) { return; }
	assert.equal(used.failure.failureClass, 'use-denied');
	assert.equal(used.failure.gate, 'environment-trust');
	r.cleanup();
});
