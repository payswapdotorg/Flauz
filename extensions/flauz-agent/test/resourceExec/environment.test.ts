/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Unit tests for the PIN-2 read-only environment lease adapter
 * (src/resourceExec/environment.ts): the registry + lifecycle + ops reads,
 * the trust gate enforced read-only (untrusted / disabled / destroyed /
 * unknown), the op-port mapping per lifecycle state, the surface snapshot
 * and the provider-kind SURFACE_MISMATCH.
 */
import { test } from 'node:test';
import { deepStrictEqual, match, ok, strictEqual, throws } from 'node:assert';
import { EnvironmentLeaseAdapter, parseEnvironmentsRegistry, parseLifecycleEnvelope, parseOpsLine, resolveEnvironmentPosture } from '../../src/resourceExec/environment.ts';
import { AGENT, envOpsLine, environmentsRegistry, lifecycleEnvelope, memoryFs, type MemoryFs } from './helpers.ts';

const ROOT = 'workspace';
const TRUSTED_RUNNING = { 'env-build-agent': { state: 'running', updatedAt: 1730000062000 } };

function boot(options: { registry?: string; lifecycle?: string; ops?: string } = {}): { adapter: EnvironmentLeaseAdapter; mem: MemoryFs } {
	const seed: Record<string, string> = {
		'workspace/.flauz/environments.json': options.registry ?? environmentsRegistry([
			{ id: 'env-build-agent', kind: 'ssh-local', posture: 'trusted' },
			{ id: 'env-quarantine', kind: 'container', posture: 'untrusted' },
		], 'env-build-agent'),
		'workspace/.flauz/environments-lifecycle.json': options.lifecycle ?? lifecycleEnvelope(TRUSTED_RUNNING),
		...(options.ops !== undefined ? { 'workspace/.flauz/environments-ops.jsonl': options.ops } : {}),
	};
	const mem = memoryFs(seed);
	return { adapter: new EnvironmentLeaseAdapter({ root: ROOT, fs: mem.port }), mem };
}

test('parseEnvironmentsRegistry + parseLifecycleEnvelope accept the canonical shapes and refuse corruption', () => {
	const registry = parseEnvironmentsRegistry(environmentsRegistry([{ id: 'env-a', kind: 'container', posture: 'trusted' }], 'env-a'));
	strictEqual(registry.$schema, 'flauz.environments/v0');
	strictEqual(registry.environments.length, 1);
	strictEqual(registry.environments[0]!.trust.posture, 'trusted');
	throws(() => parseEnvironmentsRegistry(JSON.stringify({ $schema: 'flauz.environments/v1', activeId: null, environments: [] })), /flauz\.environments\/v0/);
	const lifecycle = parseLifecycleEnvelope(lifecycleEnvelope({ 'env-a': { state: 'running/attached', updatedAt: 1730000062000 } }));
	strictEqual(lifecycle.entries['env-a']!.state, 'running/attached');
	throws(() => parseLifecycleEnvelope(lifecycleEnvelope({ 'env-a': { state: 'exploded' as string, updatedAt: 1 } })), /not a lifecycle state/);
	throws(() => parseLifecycleEnvelope(JSON.stringify({ schemaVersion: 0, schema: 'flauz.environments-lifecycle/v1', updatedAt: 1, entries: {} })), /schema must be exactly/);
});

test('parseOpsLine validates PIN-2 lines and typed-skips bad ones (advisory consumption)', () => {
	const okLine = parseOpsLine(envOpsLine(1730000060000, 'human', 'create', 'env-a', 'registered', 'created'));
	ok(okLine.ok);
	strictEqual(okLine.ok && okLine.record.op, 'create');
	const badActor = JSON.parse(envOpsLine(1, 'human', 'create', 'env-a', 'registered', 'created'));
	badActor.actor = 'system';
	ok(!parseOpsLine(JSON.stringify(badActor)).ok);
	const badOp = JSON.parse(envOpsLine(1, 'human', 'create', 'env-a', 'registered', 'created'));
	badOp.op = 'explode';
	ok(!parseOpsLine(JSON.stringify(badOp)).ok);
	ok(!parseOpsLine('not json').ok);
});

test('acquire happy path: trusted running environment -> surface snapshot + attach op port + ops audit note', async () => {
	const { adapter } = boot({ ops: [envOpsLine(1730000060000, 'human', 'create', 'env-build-agent', 'registered', 'created'), envOpsLine(1730000062000, 'agent', 'start', 'env-build-agent', 'created', 'running')].join('\n') + '\n' });
	const verdict = await adapter.acquire('T-001', 'env-build-agent', AGENT);
	ok(verdict.ok, 'the trusted running environment is acquirable');
	deepStrictEqual(verdict.ok && verdict.surfaceSnapshot.surfaces[0]!.surface, { kind: 'environment', descriptorId: 'env-build-agent', providerKind: 'ssh-local' });
	strictEqual(verdict.ok && verdict.opPort, 'flauz.env.attach');
	strictEqual(verdict.ok && verdict.surfaceSnapshot.surfaces[0]!.version, 1730000062000, 'the version marker is the lifecycle entry updatedAt');
	match(verdict.ok && (verdict.notes?.[0] ?? ''), /last recorded op 'start' \(ok\) by agent/);
});

test('the op port follows the lifecycle state (create/start/attach/detach)', async () => {
	const cases: Array<[string, string, string]> = [
		['created', 'flauz.env.start', 'created'],
		['failed', 'flauz.env.start', 'failed'],
		['stopped', 'flauz.env.start', 'stopped'],
		['stopped/attached', 'flauz.env.detach', 'stopped/attached'],
		['running', 'flauz.env.attach', 'running'],
		['running/attached', 'flauz.env.detach', 'running/attached'],
	];
	for (const [state, expectedOpPort, _] of cases) {
		const { adapter } = boot({ lifecycle: lifecycleEnvelope({ 'env-build-agent': { state, updatedAt: 1730000062000 } }) });
		const verdict = await adapter.acquire('T-001', 'env-build-agent', AGENT);
		ok(verdict.ok, `${state} is acquirable`);
		strictEqual(verdict.ok && verdict.opPort, expectedOpPort, `${state} -> ${expectedOpPort}`);
	}
	// no lifecycle entry = registered -> create
	const { adapter } = boot({ lifecycle: lifecycleEnvelope({ 'env-quarantine': { state: 'created', updatedAt: 1730000063000 } }) });
	const registered = await adapter.acquire('T-001', 'env-build-agent', AGENT);
	ok(registered.ok && registered.opPort === 'flauz.env.create', 'registered (no entry) -> flauz.env.create');
});

test('TRUST_REFUSED: an untrusted posture is rejected fail-closed with the posture named', async () => {
	const { adapter } = boot();
	const verdict = await adapter.acquire('T-001', 'env-quarantine', AGENT);
	ok(!verdict.ok && verdict.code === 'TRUST_REFUSED');
	match(verdict.message, /trust posture 'untrusted'/);
	match(verdict.message, /SECURITY-MODEL 3.4/);
	match(verdict.message, /enforced read-only here/, 'the gate belongs to the TL3 manager');
});

test('TRUST_REFUSED: a disabled environment is rejected (the manager ENVIRONMENT_DISABLED gate, read-only)', async () => {
	const { adapter } = boot({ registry: environmentsRegistry([{ id: 'env-build-agent', kind: 'ssh-local', posture: 'trusted', enabled: false }]) });
	const verdict = await adapter.acquire('T-001', 'env-build-agent', AGENT);
	ok(!verdict.ok && verdict.code === 'TRUST_REFUSED');
	match(verdict.message, /disabled/);
});

test('RESOURCE_ABSENT: unknown registry id and destroyed lifecycle state', async () => {
	const { adapter } = boot();
	const unknown = await adapter.acquire('T-001', 'env-ghost', AGENT);
	ok(!unknown.ok && unknown.code === 'RESOURCE_ABSENT');
	match(unknown.message, /not registered/);
	const { adapter: destroyedAdapter } = boot({ lifecycle: lifecycleEnvelope({ 'env-build-agent': { state: 'destroyed', updatedAt: 1730000070000 } }) });
	const destroyed = await destroyedAdapter.acquire('T-001', 'env-build-agent', AGENT);
	ok(!destroyed.ok && destroyed.code === 'RESOURCE_ABSENT');
	match(destroyed.message, /destroyed/);
});

test('STATE_UNREADABLE: a corrupt registry or lifecycle envelope refuses the acquire', async () => {
	const { adapter: badRegistry } = boot({ registry: JSON.stringify({ $schema: 'flauz.environments/v9' }) });
	const registryVerdict = await badRegistry.acquire('T-001', 'env-build-agent', AGENT);
	ok(!registryVerdict.ok && registryVerdict.code === 'STATE_UNREADABLE');
	const { adapter: badLifecycle } = boot({ lifecycle: JSON.stringify({ schemaVersion: 0, schema: 'flauz.environments-lifecycle/v9', updatedAt: 1, entries: {} }) });
	const lifecycleVerdict = await badLifecycle.acquire('T-001', 'env-build-agent', AGENT);
	ok(!lifecycleVerdict.ok && lifecycleVerdict.code === 'STATE_UNREADABLE');
});

test('release: attached -> detach port; running -> stop port; destroyed-since -> closed-elsewhere', async () => {
	const attached = boot({ lifecycle: lifecycleEnvelope({ 'env-build-agent': { state: 'running/attached', updatedAt: 1730000062000 } }) });
	const attachedVerdict = await attached.adapter.release('T-001', 'env-build-agent', AGENT);
	ok(attachedVerdict.ok && attachedVerdict.opPort === 'flauz.env.detach');
	match(attachedVerdict.observed, /detaching via flauz\.env\.detach is the TL3 manager's call/);
	const running = boot();
	const runningVerdict = await running.adapter.release('T-001', 'env-build-agent', AGENT);
	ok(runningVerdict.ok && runningVerdict.opPort === 'flauz.env.stop');
	match(runningVerdict.observed, /claims no teardown/);
	const destroyed = boot({ lifecycle: lifecycleEnvelope({ 'env-build-agent': { state: 'destroyed', updatedAt: 1730000070000 } }) });
	const destroyedVerdict = await destroyed.adapter.release('T-001', 'env-build-agent', AGENT);
	ok(destroyedVerdict.ok && destroyedVerdict.outcome === 'closed-elsewhere');
	match(destroyedVerdict.observed, /destroyed/);
});

test('SURFACE_MISMATCH: a provider-kind change under the same environment id is an identity change', async () => {
	const { adapter } = boot({ registry: environmentsRegistry([{ id: 'env-build-agent', kind: 'container', posture: 'trusted' }]) });
	const pinned = { surfaces: [{ family: 'environment' as const, version: 1730000062000, surface: { kind: 'environment', descriptorId: 'env-build-agent', providerKind: 'ssh-local' } }] };
	const verdict = await adapter.verifySurface('T-001', 'env-build-agent', pinned);
	ok(!verdict.ok && verdict.code === 'SURFACE_MISMATCH');
	match(verdict.message, /provider kind of the leased environment changed/);
});

test('resolveEnvironmentPosture: the shared resolver (used by the continuity restore-point)', async () => {
	const mem = memoryFs({ 'workspace/.flauz/environments.json': environmentsRegistry([{ id: 'env-a', kind: 'container', posture: 'trusted' }, { id: 'env-b', kind: 'container', posture: 'untrusted' }]) });
	ok((await resolveEnvironmentPosture(ROOT, mem.port, 'env-a')).ok);
	const untrusted = await resolveEnvironmentPosture(ROOT, mem.port, 'env-b');
	ok(untrusted.ok && untrusted.posture === 'untrusted');
	const unknown = await resolveEnvironmentPosture(ROOT, mem.port, 'env-ghost');
	ok(!unknown.ok && unknown.code === 'RESOURCE_ABSENT');
	const noRegistry = memoryFs();
	const absent = await resolveEnvironmentPosture(ROOT, noRegistry.port, 'env-a');
	ok(!absent.ok && absent.code === 'RESOURCE_ABSENT');
});
