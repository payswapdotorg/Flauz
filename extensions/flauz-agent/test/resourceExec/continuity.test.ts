/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Unit tests for the continuity hand-off adapter + the hand-off operations
 * (src/resourceExec/continuity.ts): bundle validation (grammar / existence /
 * completeness / failed-verify consult), the full integrity verification
 * (carried artifact hashes incl. directory tree manifests, redacted
 * path-hashes), the export -> restore round-trip with the bundle id
 * surviving, the typed refusals (CONTINUITY_INVALID / TRUST_REFUSED /
 * RESOURCE_ABSENT) and the secret-redaction law on the hand-off records.
 */
import { test } from 'node:test';
import { deepStrictEqual, match, ok, strictEqual, throws } from 'node:assert';
import { CONTINUITY_BUNDLES_DIR, CONTINUITY_SURFACES, ContinuityHandOffAdapter, exportHandOff, parseBundleManifest, parseContinuityOpsLine, restoreHandOff } from '../../src/resourceExec/continuity.ts';
import { BrowserSessionLeaseAdapter } from '../../src/resourceExec/browserSession.ts';
import { EnvironmentLeaseAdapter } from '../../src/resourceExec/environment.ts';
import { acquireLease, releaseLease } from '../../src/resourceExec/contracts.ts';
import { sha256Hex } from '../../src/resourceExec/types.ts';
import { AGENT, BUNDLE_ID as FIXTURE_BUNDLE, TOOL, bootLeaseEnv, continuityBundle, continuityOpsFailedVerify, continuityOpsOk, environmentsRegistry, goodJournal, jsonlLine, lifecycleEnvelope, memoryFs, type MemoryFs } from './helpers.ts';

const ROOT = 'workspace';

function bundleSeed(options: Parameters<typeof continuityBundle>[0] = {}, ops = continuityOpsOk(options.bundleId ?? FIXTURE_BUNDLE)): Record<string, string> {
	const files = continuityBundle(options);
	const seed: Record<string, string> = {};
	for (const [file, contents] of Object.entries(files)) {
		seed[`workspace/${file}`] = contents;
	}
	seed['workspace/.flauz/continuity-ops.jsonl'] = ops;
	return seed;
}

function bootWorkspace(seed: Record<string, string>): { continuity: ContinuityHandOffAdapter; mem: MemoryFs } {
	const mem = memoryFs(seed);
	return { continuity: new ContinuityHandOffAdapter({ root: ROOT, fs: mem.port }), mem };
}

const FULL_SEED: Record<string, string> = {
	'workspace/.flauz/browser-sessions.jsonl': goodJournal(),
	'workspace/.flauz/environments.json': environmentsRegistry([{ id: 'env-build-agent', kind: 'ssh-local', posture: 'trusted' }, { id: 'env-quarantine', kind: 'container', posture: 'untrusted' }]),
	'workspace/.flauz/environments-lifecycle.json': lifecycleEnvelope({ 'env-build-agent': { state: 'running', updatedAt: 1730000062000 } }),
};

test('parseBundleManifest: strict over the closed 22-surface table', () => {
	const files = continuityBundle();
	const manifest = parseBundleManifest(files[`.flauz/continuity-bundles/${FIXTURE_BUNDLE}/manifest.json`]);
	strictEqual(manifest.schema, 'flauz.continuity-bundle/v0');
	strictEqual(manifest.bundleId, FIXTURE_BUNDLE);
	strictEqual(Object.keys(manifest.surfaces).length, CONTINUITY_SURFACES.length, 'every table surface is classified');
	// a manifest missing a surface is refused (closed-table completeness)
	const missing = continuityBundle({ omitSurface: 'flauz-workflow-state' });
	throws(() => parseBundleManifest(missing[`.flauz/continuity-bundles/${FIXTURE_BUNDLE}/manifest.json`]), /missing 'flauz-workflow-state'/);
	// an unknown surface is refused
	const withUnknown = continuityBundle();
	const parsed = JSON.parse(withUnknown[`.flauz/continuity-bundles/${FIXTURE_BUNDLE}/manifest.json`]);
	parsed.surfaces['flauz-unknown-surface'] = { status: 'lost', note: 'x' };
	throws(() => parseBundleManifest(JSON.stringify(parsed)), /unknown surface/);
	// a lost surface without a note is refused
	const noNote = JSON.parse(JSON.stringify(parsed));
	delete noNote.surfaces['flauz-unknown-surface'];
	delete noNote.surfaces['flauz-workflow-state'].note;
	throws(() => parseBundleManifest(JSON.stringify(noNote)), /note is REQUIRED for a lost surface/);
});

test('parseContinuityOpsLine validates the ops ledger lines with typed skips', () => {
	const good = jsonlLine({ schemaVersion: 0, schema: 'flauz.continuity-ops/v0', ts: 1730000300000, actor: 'human', op: 'export', bundleId: FIXTURE_BUNDLE, result: 'ok' });
	ok(parseContinuityOpsLine(good).ok);
	const bad = JSON.parse(good);
	bad.op = 'explode';
	ok(!parseContinuityOpsLine(JSON.stringify(bad)).ok);
	ok(!parseContinuityOpsLine('not json').ok);
});

test('validateBundle: bad grammar, absent bundle, corrupt manifest and failed-verify consult are typed CONTINUITY_INVALID', async () => {
	const { continuity } = bootWorkspace(bundleSeed());
	const grammar = await continuity.validateBundle('not-a-bundle-id');
	ok(!grammar.ok && grammar.error.code === 'CONTINUITY_INVALID');
	match(grammar.error.message, /flauz:continuity:<16-hex>/);
	const absent = await continuity.validateBundle('flauz:continuity:ffffffffffffffff');
	ok(!absent.ok && absent.error.code === 'CONTINUITY_INVALID');
	match(absent.error.message, /no continuity bundle/);
	const corrupt = bootWorkspace(bundleSeed({ omitSurface: 'flauz-workflow-state' }));
	const corruptVerdict = await corrupt.continuity.validateBundle(FIXTURE_BUNDLE);
	ok(!corruptVerdict.ok && corruptVerdict.error.code === 'CONTINUITY_INVALID');
	match(corruptVerdict.error.message, /missing 'flauz-workflow-state'/);
	const failedVerify = bootWorkspace(bundleSeed(undefined, continuityOpsFailedVerify(FIXTURE_BUNDLE)));
	const failed = await failedVerify.continuity.validateBundle(FIXTURE_BUNDLE);
	ok(!failed.ok && failed.error.code === 'CONTINUITY_INVALID');
	match(failed.error.message, /FAILED verify/);
});

test('verifyBundle: the good bundle verifies (carried hashes + redacted path hashes re-derived)', async () => {
	const { continuity } = bootWorkspace(bundleSeed());
	const verdict = await continuity.verifyBundle(FIXTURE_BUNDLE);
	ok(verdict.ok, 'the good bundle verifies');
	const redacted = verdict.surfaces.filter(surface => surface.verdict === 'redacted');
	strictEqual(redacted.length, 3, 'the redaction law: presence + path hash');
	for (const surface of redacted) {
		match(surface.note, /payload was never copied/);
	}
	strictEqual(verdict.surfaces.filter(surface => surface.verdict === 'verified').length, 6);
	strictEqual(verdict.surfaces.filter(surface => surface.verdict === 'lost').length, 13);
});

test('verifyBundle: a carried hash mismatch and a bad redacted path-hash are typed CONTINUITY_INVALID', async () => {
	const tampered = bootWorkspace(bundleSeed({ tamperCarriedSha: { id: 'flauz-tasks-envelope', sha: sha256Hex('tampered') } }));
	const tamperedVerdict = await tampered.continuity.verifyBundle(FIXTURE_BUNDLE);
	ok(!tamperedVerdict.ok && tamperedVerdict.error.code === 'CONTINUITY_INVALID');
	match(tamperedVerdict.error.message, /failed integrity verification/);
	const badRedacted = bootWorkspace(bundleSeed({ extraRedacted: [] }));
	// overwrite the redacted hash with a wrong one
	const files = continuityBundle();
	const manifest = JSON.parse(files[`.flauz/continuity-bundles/${FIXTURE_BUNDLE}/manifest.json`]);
	manifest.surfaces['flauz-evidence-ledger'].sha256 = sha256Hex('not-the-path');
	const seed: Record<string, string> = { ...bundleSeed() };
	seed[`workspace/${CONTINUITY_BUNDLES_DIR}/${FIXTURE_BUNDLE}/manifest.json`] = JSON.stringify(manifest, null, '\t') + '\n';
	const bad = bootWorkspace(seed);
	const badVerdict = await bad.continuity.verifyBundle(FIXTURE_BUNDLE);
	ok(!badVerdict.ok && badVerdict.error.code === 'CONTINUITY_INVALID');
	match(badVerdict.error.message, /flauz-evidence-ledger/);
});

test('verifyBundle: a carried DIRECTORY surface verifies per-file through its tree manifest', async () => {
	// build a bundle whose flauz-workflow-state directory surface is carried with a tree manifest
	const base = continuityBundle();
	const dirPath = `workspace/${CONTINUITY_BUNDLES_DIR}/${FIXTURE_BUNDLE}/surfaces/flauz-workflow-state`;
	const files = { 'index.json': '{"workflows":[]}', 'nested/deep.json': '{"deep":true}' };
	const tree = { schemaVersion: 0, schema: 'flauz.continuity-surface-tree/v0', files: [] as { path: string; sha256: string; bytes: number }[] };
	const seed: Record<string, string> = {};
	for (const [file, contents] of Object.entries(base)) {
		seed[`workspace/${file}`] = contents;
	}
	for (const [name, contents] of Object.entries(files)) {
		seed[`${dirPath}/${name}`] = contents;
		tree.files.push({ path: name, sha256: sha256Hex(contents), bytes: contents.length });
	}
	const totalBytes = tree.files.reduce((total, file) => total + file.bytes, 0);
	seed[`${dirPath}.manifest.json`] = JSON.stringify(tree, null, '\t') + '\n';
	const manifest = JSON.parse(seed[`workspace/${CONTINUITY_BUNDLES_DIR}/${FIXTURE_BUNDLE}/manifest.json`]);
	manifest.surfaces['flauz-workflow-state'] = { status: 'carried', artifactPath: 'surfaces/flauz-workflow-state', sha256: sha256Hex(JSON.stringify(tree)), bytes: totalBytes, note: 'carried from .flauz/workflows' };
	seed[`workspace/${CONTINUITY_BUNDLES_DIR}/${FIXTURE_BUNDLE}/manifest.json`] = JSON.stringify(manifest, null, '\t') + '\n';
	seed['workspace/.flauz/continuity-ops.jsonl'] = continuityOpsOk(FIXTURE_BUNDLE);
	const { continuity } = bootWorkspace(seed);
	const verdict = await continuity.verifyBundle(FIXTURE_BUNDLE);
	ok(verdict.ok, 'the directory surface verifies through its tree manifest');
	const workflow = verdict.surfaces.find(surface => surface.surface === 'flauz-workflow-state');
	ok(workflow !== undefined && workflow.verdict === 'verified');
	match(workflow!.note, /2 file\(s\)/);
});

test('the hand-off round-trip: export -> restore with the bundle id surviving and the leases re-bound', async () => {
	const mem = memoryFs({ ...FULL_SEED, ...bundleSeed() });
	const browser = new BrowserSessionLeaseAdapter({ root: ROOT, fs: mem.port });
	const environments = new EnvironmentLeaseAdapter({ root: ROOT, fs: mem.port });
	const continuity = new ContinuityHandOffAdapter({ root: ROOT, fs: mem.port });
	const { env } = await bootLeaseEnv(mem.port, () => 1730001000000);
	const browserLease = await acquireLease(env, { taskId: 'T-001', resourceId: 'flauz:browser:0123456789abcdef', actor: AGENT, adapter: browser });
	const envLease = await acquireLease(env, { taskId: 'T-001', resourceId: 'env-build-agent', actor: AGENT, adapter: environments });
	ok(browserLease.ok && envLease.ok);
	// export-point
	const exportOutcome = await exportHandOff(env, continuity, { taskId: 'T-001', actor: AGENT, bundleId: FIXTURE_BUNDLE });
	ok(exportOutcome.ok, 'the export validates the bundle and records the hand-off');
	strictEqual(exportOutcome.record.continuityBundleId, FIXTURE_BUNDLE, 'the bundle id is attached');
	deepStrictEqual(exportOutcome.record.leaseIds, [browserLease.lease.leaseId, envLease.lease.leaseId], 'the active lease ids are carried');
	// "restart" (crash recovery) + restore-point on a fresh boot over the same durable ledger
	const restarted = await bootLeaseEnv(mem.port, () => 1730002000000);
	const restoreOutcome = await restoreHandOff(restarted.env, continuity, { handOff: exportOutcome.record, actor: AGENT, targetEnvironmentId: 'env-build-agent' });
	ok(restoreOutcome.ok, 'the restore verifies the bundle, trusts the target and re-binds the leases');
	strictEqual(restoreOutcome.record.continuityBundleId, FIXTURE_BUNDLE, 'the bundle id SURVIVES the hand-off');
	deepStrictEqual(restoreOutcome.record.reboundLeaseIds, [browserLease.lease.leaseId, envLease.lease.leaseId]);
	deepStrictEqual(restoreOutcome.record.skippedLeaseIds, []);
	const view = restarted.env.book.view(browserLease.lease.leaseId)!;
	strictEqual(view.state, 'active');
	strictEqual(view.reboundBundleId, FIXTURE_BUNDLE, 'the re-bound lease is annotated with the bundle id');
	strictEqual(view.carriedBundleId, FIXTURE_BUNDLE, 'the carried annotation survives the replay');
});

test('restore-point refusals: failed bundle verify, untrusted target, unknown target, discharged leases as typed skips', async () => {
	const mem = memoryFs({ ...FULL_SEED, ...bundleSeed() });
	const browser = new BrowserSessionLeaseAdapter({ root: ROOT, fs: mem.port });
	const continuity = new ContinuityHandOffAdapter({ root: ROOT, fs: mem.port });
	const { env } = await bootLeaseEnv(mem.port, () => 1730001000000);
	const lease = await acquireLease(env, { taskId: 'T-001', resourceId: 'flauz:browser:0123456789abcdef', actor: AGENT, adapter: browser });
	ok(lease.ok);
	const exportOutcome = await exportHandOff(env, continuity, { taskId: 'T-001', actor: AGENT, bundleId: FIXTURE_BUNDLE });
	ok(exportOutcome.ok);
	// a tampered bundle refuses the restore (CONTINUITY_INVALID)
	const tamperedFiles = continuityBundle({ tamperCarriedSha: { id: 'flauz-tasks-envelope', sha: sha256Hex('tampered') } });
	for (const [file, contents] of Object.entries(tamperedFiles)) {
		mem.files.set(`workspace/${file.replace(/^\.flauz\//, '.flauz/')}`, contents);
	}
	mem.files.set('workspace/.flauz/continuity-bundles/flauz:continuity:0123456789abcdef/manifest.json', tamperedFiles[`.flauz/continuity-bundles/${FIXTURE_BUNDLE}/manifest.json`]);
	const tampered = await restoreHandOff(env, continuity, { handOff: exportOutcome.record, actor: AGENT });
	ok(!tampered.ok && tampered.error.code === 'CONTINUITY_INVALID');
	// restore the good bundle bytes
	const goodFiles = continuityBundle();
	mem.files.set('workspace/.flauz/continuity-bundles/flauz:continuity:0123456789abcdef/manifest.json', goodFiles[`.flauz/continuity-bundles/${FIXTURE_BUNDLE}/manifest.json`]);
	// an untrusted target is TRUST_REFUSED (the mission class for untrusted environments)
	const untrusted = await restoreHandOff(env, continuity, { handOff: exportOutcome.record, actor: AGENT, targetEnvironmentId: 'env-quarantine' });
	ok(!untrusted.ok && untrusted.error.code === 'TRUST_REFUSED');
	match(untrusted.error.message, /trust posture 'untrusted'/);
	// an unknown target is RESOURCE_ABSENT
	const unknown = await restoreHandOff(env, continuity, { handOff: exportOutcome.record, actor: AGENT, targetEnvironmentId: 'env-ghost' });
	ok(!unknown.ok && unknown.error.code === 'RESOURCE_ABSENT');
	// a lease discharged before the switch is a typed skip, never silently dropped
	const released = await releaseLease(env, { leaseId: lease.lease.leaseId, actor: AGENT, adapter: browser });
	ok(released.ok);
	const restored = await restoreHandOff(env, continuity, { handOff: exportOutcome.record, actor: AGENT, targetEnvironmentId: 'env-build-agent' });
	ok(restored.ok);
	deepStrictEqual(restored.record.skippedLeaseIds, [lease.lease.leaseId], 'the discharged lease is skipped, typed');
	deepStrictEqual(restored.record.reboundLeaseIds, []);
	// a hand-off record naming an UNKNOWN lease refuses the whole restore (fail-closed)
	const bogus = { ...exportOutcome.record, leaseIds: ['flauz:lease:eeeeeeeeeeeeeeee'] };
	const refused = await restoreHandOff(env, continuity, { handOff: bogus, actor: AGENT });
	ok(!refused.ok && refused.error.code === 'REQUEST_INVALID');
	match(refused.error.message, /unknown to the lease book/);
});

test('the export-point without a bundle carries the lease ids only (a bundle-less hand-off is legal)', async () => {
	const mem = memoryFs(FULL_SEED);
	const browser = new BrowserSessionLeaseAdapter({ root: ROOT, fs: mem.port });
	const continuity = new ContinuityHandOffAdapter({ root: ROOT, fs: mem.port });
	const { env } = await bootLeaseEnv(mem.port, () => 1730001000000);
	const lease = await acquireLease(env, { taskId: 'T-001', resourceId: 'flauz:browser:0123456789abcdef', actor: AGENT, adapter: browser });
	ok(lease.ok);
	const exportOutcome = await exportHandOff(env, continuity, { taskId: 'T-001', actor: AGENT });
	ok(exportOutcome.ok);
	strictEqual(exportOutcome.record.continuityBundleId, undefined);
	deepStrictEqual(exportOutcome.record.leaseIds, [lease.lease.leaseId]);
	// a bad bundle grammar at the export-point is CONTINUITY_INVALID
	const bad = await exportHandOff(env, continuity, { taskId: 'T-001', actor: AGENT, bundleId: 'nope' });
	ok(!bad.ok && bad.error.code === 'CONTINUITY_INVALID');
});

test('the secret-redaction law: hand-off records carry the bundle id only -- never manifest content, never payloads', async () => {
	const mem = memoryFs({ ...FULL_SEED, ...bundleSeed() });
	const browser = new BrowserSessionLeaseAdapter({ root: ROOT, fs: mem.port });
	const continuity = new ContinuityHandOffAdapter({ root: ROOT, fs: mem.port });
	const { env, ledger } = await bootLeaseEnv(mem.port, () => 1730001000000);
	const lease = await acquireLease(env, { taskId: 'T-001', resourceId: 'flauz:browser:0123456789abcdef', actor: AGENT, adapter: browser });
	ok(lease.ok);
	const exportOutcome = await exportHandOff(env, continuity, { taskId: 'T-001', actor: AGENT, bundleId: FIXTURE_BUNDLE });
	ok(exportOutcome.ok);
	const raw = JSON.stringify(ledger.records());
	ok(!raw.includes('artifactPath'), 'no manifest artifact paths leak into the ledger');
	ok(!raw.includes('surfaces/flauz-tasks-envelope'), 'no bundle payload references leak');
	strictEqual(JSON.stringify(exportOutcome.record).includes('sha256'), false, 'no hashes/payload metadata on the hand-off record');
	// provenance is still mandatory on the hand-off ops
	const noActor = await exportHandOff(env, continuity, { taskId: 'T-001', actor: undefined as never });
	ok(!noActor.ok && noActor.error.code === 'PROVENANCE_INVALID');
});
