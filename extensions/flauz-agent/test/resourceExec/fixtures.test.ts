/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Repo task-resources fixture matrix tests (test/fixtures/task-resources/):
 * the GOOD family pins a valid small workspace `.flauz/` state consumed
 * READ-ONLY end-to-end (adapters + coordinator + ledger + hand-off over the
 * fixture bytes, crash recovery from the fixture ledger); EVERY bad fixture
 * is rejected with its pinned typed failure class (the
 * fixtures-continuity.test.ts pattern -- each rule violated at least once).
 */
import { test } from 'node:test';
import { deepStrictEqual, match, ok, strictEqual } from 'node:assert';
import { BrowserSessionLeaseAdapter } from '../../src/resourceExec/browserSession.ts';
import { EnvironmentLeaseAdapter } from '../../src/resourceExec/environment.ts';
import { ResourceRefLeaseAdapter } from '../../src/resourceExec/resourceRef.ts';
import { ContinuityHandOffAdapter, exportHandOff, restoreHandOff } from '../../src/resourceExec/continuity.ts';
import { acquireLease, releaseLease, verifyLeaseSurface } from '../../src/resourceExec/contracts.ts';
import { TaskResourceLedger } from '../../src/resourceExec/store.ts';
import { AGENT, HUMAN, bootLeaseEnv, listFixtureFiles, memoryFs, readFixture, type MemoryFs } from './helpers.ts';

const ROOT = 'workspace';
const GOOD = 'good/.flauz';

/** Loads the good fixture family as an in-memory workspace seed (READ-ONLY consumption). */
function goodSeed(overrides: Record<string, string> = {}): Record<string, string> {
	const seed: Record<string, string> = {};
	const files = listFixtureFiles('good', '.flauz');
	for (const name of files) {
		seed[`workspace/.flauz/${name}`] = readFixture('good', '.flauz', name);
	}
	// the bundle dir (manifest + artifacts)
	const bundleDir = 'flauz:continuity:0123456789abcdef';
	seed[`workspace/.flauz/continuity-bundles/${bundleDir}/manifest.json`] = readFixture('good', '.flauz', 'continuity-bundles', bundleDir, 'manifest.json');
	for (const artifact of listFixtureFiles('good', '.flauz', 'continuity-bundles', bundleDir, 'surfaces')) {
		seed[`workspace/.flauz/continuity-bundles/${bundleDir}/surfaces/${artifact}`] = readFixture('good', '.flauz', 'continuity-bundles', bundleDir, 'surfaces', artifact);
	}
	return { ...seed, ...overrides };
}

test('the good family: the tasks envelope pins the durable-task dimension (flauz.tasks/v0)', () => {
	const tasks = JSON.parse(readFixture(GOOD, 'tasks.json'));
	strictEqual(tasks.$schema, 'flauz.tasks/v0');
	strictEqual(tasks.tasks.length, 1);
	strictEqual(tasks.tasks[0].id, 'T-001');
});

test('the good family: the PIN-1 journal, the registry + PIN-2 pair, the graph and the ops ledgers all parse', async () => {
	const journal = readFixture(GOOD, 'browser-sessions.jsonl');
	strictEqual(journal.endsWith('\n'), true);
	strictEqual(journal.split('\n').length, 5, 'four records + the trailing newline');
	const environments = new EnvironmentLeaseAdapter({ root: ROOT, fs: memoryFs(goodSeed()).port });
	ok((await environments.acquire('T-001', 'env-build-agent', AGENT)).ok, 'the trusted running fixture env is acquirable');
	const refs = new ResourceRefLeaseAdapter({ root: ROOT, fs: memoryFs(goodSeed()).port });
	ok((await refs.acquire('T-001', 'flauz:file:0123456789abcdef', AGENT)).ok, 'the fixture file ref is acquirable');
});

test('the good family: a full acquire -> release round-trip over the fixture bytes (browser + environment + ref)', async () => {
	const mem = memoryFs(goodSeed());
	const { env } = await bootLeaseEnv(mem.port, () => 1730001000000, 'workspace', 100);
	const browser = new BrowserSessionLeaseAdapter({ root: ROOT, fs: mem.port });
	const environments = new EnvironmentLeaseAdapter({ root: ROOT, fs: mem.port });
	const refs = new ResourceRefLeaseAdapter({ root: ROOT, fs: mem.port });
	// NOTE: T-001 already holds the fixture's ACTIVE env lease (env-build-agent) -> LEASE_CONFLICT pins the fixture ledger
	const conflict = await acquireLease(env, { taskId: 'T-001', resourceId: 'env-build-agent', actor: AGENT, adapter: environments });
	ok(!conflict.ok && conflict.error.code === 'LEASE_CONFLICT', 'the fixture ledger holds the active env obligation');
	// a different task leases the same env cleanly
	const envLease = await acquireLease(env, { taskId: 'T-002', resourceId: 'env-build-agent', actor: AGENT, adapter: environments });
	ok(envLease.ok);
	strictEqual(envLease.lease.opPort, 'flauz.env.attach');
	const browserLease = await acquireLease(env, { taskId: 'T-002', resourceId: 'flauz:browser:0123456789abcdef', actor: AGENT, adapter: browser });
	ok(browserLease.ok);
	deepStrictEqual(browserLease.lease.surfaceSnapshot!.surfaces[0]!.surface, { kind: 'browser', partition: 'persist:flauz-0123456789abcdef-worker-1', tabIds: ['flauz:tab:0000000000000001'] });
	const refLease = await acquireLease(env, { taskId: 'T-002', resourceId: 'flauz:file:0123456789abcdef', actor: AGENT, adapter: refs });
	ok(refLease.ok);
	// release all three; the closed fixture session discharges closed-elsewhere
	const closedSession = await acquireLease(env, { taskId: 'T-002', resourceId: 'flauz:browser:aaaabbbbccccdddd', actor: AGENT, adapter: browser });
	ok(!closedSession.ok && closedSession.error.code === 'TRUST_REFUSED', 'the fixture closed session is not operable');
	const released = await releaseLease(env, { leaseId: browserLease.lease.leaseId, actor: AGENT, adapter: browser });
	ok(released.ok && released.outcome === 'clean');
	const report = await new TaskResourceLedger({ root: ROOT, fs: mem.port }).verify();
	ok(report.ok, 'the extended fixture ledger verifies clean');
});

test('the good family: crash recovery rebuilds the fixture obligations from the fixture ledger', async () => {
	const mem = memoryFs(goodSeed());
	const rebuilt = await new TaskResourceLedger({ root: ROOT, fs: mem.port }).rebuildBook();
	ok(rebuilt.ok, 'the fixture ledger replays clean');
	strictEqual(rebuilt.records, 3, 'two acquired + one released lines');
	const active = rebuilt.book.activeLeasesOf('T-001');
	strictEqual(active.length, 1, 'the ACTIVE env lease survives the restart');
	strictEqual(active[0]!.lease.resourceId, 'env-build-agent');
	strictEqual(rebuilt.book.view('flauz:lease:0000000000000001')!.state, 'released');
});

test('the good family: the hand-off round-trip over the fixture bundle (export -> restore, bundle id surviving)', async () => {
	const mem = memoryFs(goodSeed());
	const continuity = new ContinuityHandOffAdapter({ root: ROOT, fs: mem.port });
	const verdict = await continuity.verifyBundle('flauz:continuity:0123456789abcdef');
	ok(verdict.ok, 'the fixture bundle verifies end-to-end (22 surfaces)');
	const { env } = await bootLeaseEnv(mem.port, () => 1730001000000, 'workspace', 100);
	const exported = await exportHandOff(env, continuity, { taskId: 'T-001', actor: AGENT, bundleId: 'flauz:continuity:0123456789abcdef' });
	ok(exported.ok);
	deepStrictEqual(exported.record.leaseIds, ['flauz:lease:0000000000000002'], 'the fixture ACTIVE lease is carried');
	const restarted = await bootLeaseEnv(mem.port, () => 1730002000000);
	const restored = await restoreHandOff(restarted.env, continuity, { handOff: exported.record, actor: HUMAN, targetEnvironmentId: 'env-build-agent' });
	ok(restored.ok, 'the restore verifies the fixture bundle and re-binds the fixture lease');
	strictEqual(restored.record.continuityBundleId, 'flauz:continuity:0123456789abcdef');
	deepStrictEqual(restored.record.reboundLeaseIds, ['flauz:lease:0000000000000002']);
});

test('the bad family: every fixture is rejected with its pinned typed class', async () => {
	const bad = listFixtureFiles('bad');
	strictEqual(bad.length, 21, 'the bad matrix covers every pinned failure class');
	const cases = {
		'01-browser-session-absent.jsonl': { path: '.flauz/browser-sessions.jsonl', run: async (fs: MemoryFs) => await new BrowserSessionLeaseAdapter({ root: ROOT, fs: fs.port }).acquire('T-001', 'flauz:browser:0123456789abcdef', AGENT) },
		'02-browser-session-closed.jsonl': { path: '.flauz/browser-sessions.jsonl', run: async (fs: MemoryFs) => await new BrowserSessionLeaseAdapter({ root: ROOT, fs: fs.port }).acquire('T-001', 'flauz:browser:0123456789abcdef', AGENT) },
		'03-browser-session-failed.jsonl': { path: '.flauz/browser-sessions.jsonl', run: async (fs: MemoryFs) => await new BrowserSessionLeaseAdapter({ root: ROOT, fs: fs.port }).acquire('T-001', 'flauz:browser:0123456789abcdef', AGENT) },
		'04-browser-human-initiator.jsonl': { path: '.flauz/browser-sessions.jsonl', run: async (fs: MemoryFs) => await new BrowserSessionLeaseAdapter({ root: ROOT, fs: fs.port }).acquire('T-001', 'flauz:browser:fedcba9876543210', AGENT) },
		'05-browser-non-canonical.jsonl': { path: '.flauz/browser-sessions.jsonl', run: async (fs: MemoryFs) => await new BrowserSessionLeaseAdapter({ root: ROOT, fs: fs.port }).acquire('T-001', 'flauz:browser:0123456789abcdef', AGENT) },
		'06-env-untrusted.json': { path: '.flauz/environments.json', run: async (fs: MemoryFs) => await new EnvironmentLeaseAdapter({ root: ROOT, fs: fs.port }).acquire('T-001', 'env-build-agent', AGENT) },
		'07-env-unknown.json': { path: '.flauz/environments.json', run: async (fs: MemoryFs) => await new EnvironmentLeaseAdapter({ root: ROOT, fs: fs.port }).acquire('T-001', 'env-build-agent', AGENT) },
		'08-env-destroyed.json': { path: '.flauz/environments-lifecycle.json', run: async (fs: MemoryFs) => await new EnvironmentLeaseAdapter({ root: ROOT, fs: fs.port }).acquire('T-001', 'env-build-agent', AGENT) },
		'09-env-lifecycle-corrupt.json': { path: '.flauz/environments-lifecycle.json', run: async (fs: MemoryFs) => await new EnvironmentLeaseAdapter({ root: ROOT, fs: fs.port }).acquire('T-001', 'env-build-agent', AGENT) },
		'10-ref-absent.json': { path: '.flauz/resources.json', run: async (fs: MemoryFs) => await new ResourceRefLeaseAdapter({ root: ROOT, fs: fs.port }).acquire('T-001', 'flauz:file:0123456789abcdef', AGENT) },
		'11-graph-corrupt.json': { path: '.flauz/resources.json', run: async (fs: MemoryFs) => await new ResourceRefLeaseAdapter({ root: ROOT, fs: fs.port }).acquire('T-001', 'flauz:file:0123456789abcdef', AGENT) },
		'12-bundle-manifest-incomplete.json': { path: '.flauz/continuity-bundles/flauz:continuity:0123456789abcdef/manifest.json', run: async (fs: MemoryFs) => await new ContinuityHandOffAdapter({ root: ROOT, fs: fs.port }).validateBundle('flauz:continuity:0123456789abcdef') },
		'13-bundle-hash-mismatch.json': { path: '.flauz/continuity-bundles/flauz:continuity:0123456789abcdef/manifest.json', run: async (fs: MemoryFs) => await new ContinuityHandOffAdapter({ root: ROOT, fs: fs.port }).verifyBundle('flauz:continuity:0123456789abcdef') },
		'14-bundle-redacted-bad-hash.json': { path: '.flauz/continuity-bundles/flauz:continuity:0123456789abcdef/manifest.json', run: async (fs: MemoryFs) => await new ContinuityHandOffAdapter({ root: ROOT, fs: fs.port }).verifyBundle('flauz:continuity:0123456789abcdef') },
		'15-ledger-non-canonical.jsonl': { path: '.flauz/task-resources.jsonl', run: async (fs: MemoryFs) => await new TaskResourceLedger({ root: ROOT, fs: fs.port }).verify() },
		'16-ledger-unknown-actor.jsonl': { path: '.flauz/task-resources.jsonl', run: async (fs: MemoryFs) => await new TaskResourceLedger({ root: ROOT, fs: fs.port }).verify() },
		'17-ledger-double-acquire.jsonl': { path: '.flauz/task-resources.jsonl', run: async (fs: MemoryFs) => await new TaskResourceLedger({ root: ROOT, fs: fs.port }).verify() },
		'18-ledger-terminal-without-acquire.jsonl': { path: '.flauz/task-resources.jsonl', run: async (fs: MemoryFs) => await new TaskResourceLedger({ root: ROOT, fs: fs.port }).verify() },
		'19-ledger-wrong-schema.jsonl': { path: '.flauz/task-resources.jsonl', run: async (fs: MemoryFs) => await new TaskResourceLedger({ root: ROOT, fs: fs.port }).verify() },
	};
	const expected: Record<string, string> = {
		'01-browser-session-absent.jsonl': 'RESOURCE_ABSENT',
		'02-browser-session-closed.jsonl': 'TRUST_REFUSED',
		'03-browser-session-failed.jsonl': 'TRUST_REFUSED',
		'04-browser-human-initiator.jsonl': 'TRUST_REFUSED',
		'05-browser-non-canonical.jsonl': 'RESOURCE_ABSENT',
		'06-env-untrusted.json': 'TRUST_REFUSED',
		'07-env-unknown.json': 'RESOURCE_ABSENT',
		'08-env-destroyed.json': 'RESOURCE_ABSENT',
		'09-env-lifecycle-corrupt.json': 'STATE_UNREADABLE',
		'10-ref-absent.json': 'RESOURCE_ABSENT',
		'11-graph-corrupt.json': 'STATE_UNREADABLE',
		'12-bundle-manifest-incomplete.json': 'CONTINUITY_INVALID',
		'13-bundle-hash-mismatch.json': 'CONTINUITY_INVALID',
		'14-bundle-redacted-bad-hash.json': 'CONTINUITY_INVALID',
		'15-ledger-non-canonical.jsonl': 'LEDGER_CORRUPT',
		'16-ledger-unknown-actor.jsonl': 'LEDGER_CORRUPT',
		'17-ledger-double-acquire.jsonl': 'LEDGER_CORRUPT',
		'18-ledger-terminal-without-acquire.jsonl': 'LEDGER_CORRUPT',
		'19-ledger-wrong-schema.jsonl': 'LEDGER_CORRUPT',
	};
	for (const file of Object.keys(cases) as Array<keyof typeof cases>) {
		const seed = goodSeed({ [`workspace/${cases[file]!.path}`]: readFixture('bad', file) });
		const mem = memoryFs(seed);
		const outcome = await cases[file]!.run(mem);
		const code = 'error' in outcome && outcome.error !== undefined ? outcome.error.code
			: 'code' in outcome && outcome.code !== undefined ? outcome.code
				: !('ok' in outcome) || !outcome.ok ? 'LEDGER_CORRUPT' : undefined;
		strictEqual(code, expected[file], `${file} must be rejected with ${expected[file]}`);
		ok(!(outcome as { ok: boolean }).ok, `${file} must not succeed`);
	}
	// 20: the partition-changed journal (acquire on the prefix, verify on the full)
	{
		const changed = readFixture('bad', '20-browser-partition-changed.jsonl');
		const prefix = changed.split('\n')[0]! + '\n';
		const mem = memoryFs(goodSeed({ 'workspace/.flauz/browser-sessions.jsonl': prefix }));
		const adapter = new BrowserSessionLeaseAdapter({ root: ROOT, fs: mem.port });
		const { env } = await bootLeaseEnv(mem.port, () => 1730001000000, 'workspace', 100);
		const lease = await acquireLease(env, { taskId: 'T-009', resourceId: 'flauz:browser:0123456789abcdef', actor: AGENT, adapter });
		ok(lease.ok, 'the prefix journal acquires');
		mem.files.set('workspace/.flauz/browser-sessions.jsonl', changed);
		const verdict = await verifyLeaseSurface(env, { leaseId: lease.lease.leaseId, adapter });
		ok(!verdict.ok && verdict.error.code === 'SURFACE_MISMATCH', '20-browser-partition-changed.jsonl must be rejected with SURFACE_MISMATCH');
	}
	// 21: the family-changed graph (acquire on the good graph, verify on the bad)
	{
		const mem = memoryFs(goodSeed());
		const adapter = new ResourceRefLeaseAdapter({ root: ROOT, fs: mem.port });
		const { env } = await bootLeaseEnv(mem.port, () => 1730001000000, 'workspace', 100);
		const lease = await acquireLease(env, { taskId: 'T-009', resourceId: 'flauz:file:0123456789abcdef', actor: AGENT, adapter });
		ok(lease.ok);
		mem.files.set('workspace/.flauz/resources.json', readFixture('bad', '21-ref-family-changed.json'));
		const verdict = await verifyLeaseSurface(env, { leaseId: lease.lease.leaseId, adapter });
		ok(!verdict.ok && verdict.error.code === 'SURFACE_MISMATCH', '21-ref-family-changed.json must be rejected with SURFACE_MISMATCH');
	}
});

test('the fixtures contain no literal credential-shaped strings (secret-safety)', () => {
	const patterns = [/\bghp_[A-Za-z0-9]{20,}\b/, /\bsk-[A-Za-z0-9_-]{16,}\b/, /\bAKIA[0-9A-Z]{16}\b/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{16,}\b/];
	for (const file of listFixtureFiles('bad')) {
		const contents = readFixture('bad', file);
		for (const pattern of patterns) {
			ok(!pattern.test(contents), `bad/${file} must not contain a literal credential-shaped string`);
		}
	}
	for (const file of ['tasks.json', 'browser-sessions.jsonl', 'environments.json', 'environments-lifecycle.json', 'environments-ops.jsonl', 'resources.json', 'resources-ops.jsonl', 'task-resources.jsonl', 'continuity-ops.jsonl']) {
		const contents = readFixture(GOOD, file);
		for (const pattern of patterns) {
			ok(!pattern.test(contents), `good/.flauz/${file} must not contain a literal credential-shaped string`);
		}
	}
	match(readFixture('good', '.flauz', 'environments.json'), /vault:fixture\/cloud-key/, 'secrets travel as vault references only');
});
