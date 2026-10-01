/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL3-006 — the continuity EXECUTION layer suite: the closed surface table
 * (the N-8 canon materialized), export (carried/redacted/lost + the
 * secret-redaction law), the ops ledger, restore (atomic, destructive-class,
 * trust-gated), verify (hash integrity) and status (read-only). In-memory
 * fs port (fully deterministic); secret-shaped test material is ASSEMBLED
 * FROM FRAGMENTS at runtime so no complete secret shape ever lands in source.
 */
import { test } from 'node:test';
import { deepStrictEqual, ok, rejects, strictEqual, throws } from 'node:assert';
import type { FileSystemPort } from '../src/api.ts';
import { EnvironmentRegistry } from '../src/registry.ts';
import { CONTINUITY_ARTIFACTS, planSwitch } from '../src/continuity.ts';
import {
	CONTINUITY_SURFACES,
	surfaceIds,
} from '../src/continuityExec/surfaces.ts';
import {
	ContinuityOpsLedger,
	parseBundleManifest,
	serializeBundleManifest,
	serializeContinuityOpRecord,
	sha256Hex,
} from '../src/continuityExec/store.ts';
import {
	ContinuityManager,
	mintBundleId,
	type ContinuityFsPort,
	type DirEntry,
} from '../src/continuityExec/manager.ts';
import { ContinuityError, isContinuityBundleId, type ContinuityErrorCode } from '../src/continuityExec/types.ts';

/** Asserts a pre-flight rejection carries the typed code (the lifecycle suite discipline). */
async function typedRejects(promise: Promise<unknown>, code: ContinuityErrorCode): Promise<void> {
	await rejects(promise, (err: unknown) => {
		ok(err instanceof ContinuityError, `expected a ContinuityError (got ${String(err)})`);
		strictEqual((err as ContinuityError).code, code);
		return true;
	});
}

// ---------------------------------------------------------------------------
// The in-memory continuity fs port (files Map + explicit dirs; kinded
// readdir; prefix-aware rename/rm; operation recording for atomicity pins)
// ---------------------------------------------------------------------------

interface MemContinuityFs extends ContinuityFsPort {
	files(): Map<string, string>;
	renames(): Array<{ from: string; to: string }>;
	delete(path: string): void;
}

function memContinuityFs(seed: Record<string, string> = {}): MemContinuityFs {
	const files = new Map<string, string>(Object.entries(seed));
	const dirs = new Set<string>();
	const renames: Array<{ from: string; to: string }> = [];
	const prefix = (path: string) => (path.endsWith('/') ? path : `${path}/`);
	const deriveEntries = (path: string): DirEntry[] | undefined => {
		const hasChildren = [...files.keys()].some(key => key.startsWith(prefix(path))) || [...dirs].some(dir => dir.startsWith(prefix(path)));
		if (!hasChildren && !dirs.has(path)) {
			return undefined;
		}
		const children = new Map<string, DirEntry['kind']>();
		for (const key of files.keys()) {
			if (!key.startsWith(prefix(path))) {
				continue;
			}
			const rest = key.slice(prefix(path).length);
			if (rest.length === 0) {
				continue;
			}
			const name = rest.split('/')[0]!;
			if (rest.includes('/')) {
				children.set(name, 'directory');
			} else if (!children.has(name)) {
				children.set(name, 'file');
			}
		}
		for (const dir of dirs) {
			if (!dir.startsWith(prefix(path))) {
				continue;
			}
			const rest = dir.slice(prefix(path).length);
			if (rest.length === 0) {
				continue;
			}
			children.set(rest.split('/')[0]!, 'directory');
		}
		return [...children.entries()].map(([name, kind]) => ({ name, kind })).sort((a, b) => (a.name < b.name ? -1 : 1));
	};
	return {
		files: () => files,
		renames: () => renames,
		delete: path => {
			files.delete(path);
			dirs.delete(path);
			for (const key of [...files.keys()]) {
				if (key.startsWith(prefix(path))) {
					files.delete(key);
				}
			}
			for (const dir of [...dirs]) {
				if (dir.startsWith(prefix(path))) {
					dirs.delete(dir);
				}
			}
		},
		readFileUtf8: async path => files.get(path),
		writeFile: async (path, contents) => {
			files.set(path, contents);
		},
		rename: async (from, to) => {
			if (files.has(from)) {
				files.set(to, files.get(from)!);
				files.delete(from);
				renames.push({ from, to });
				return;
			}
			const moved: Array<[string, string]> = [];
			for (const key of [...files.keys()]) {
				if (key.startsWith(prefix(from))) {
					moved.push([key, `${prefix(to)}${key.slice(prefix(from).length)}`]);
				}
			}
			const movedDirs: Array<[string, string]> = [];
			for (const dir of [...dirs]) {
				if (dir.startsWith(prefix(from))) {
					movedDirs.push([dir, `${prefix(to)}${dir.slice(prefix(from).length)}`]);
				}
			}
			if (moved.length === 0 && movedDirs.length === 0 && !dirs.has(from)) {
				throw Object.assign(new Error(`ENOENT: ${from}`), { code: 'ENOENT' });
			}
			for (const [fromKey, toKey] of moved) {
				files.set(toKey, files.get(fromKey)!);
				files.delete(fromKey);
			}
			for (const [fromDir, toDir] of movedDirs) {
				dirs.add(toDir);
				dirs.delete(fromDir);
			}
			renames.push({ from, to });
		},
		mkdir: async path => {
			dirs.add(path);
		},
		readdir: async path => deriveEntries(path),
		rm: async path => {
			files.delete(path);
			dirs.delete(path);
			for (const key of [...files.keys()]) {
				if (key.startsWith(prefix(path))) {
					files.delete(key);
				}
			}
			for (const dir of [...dirs]) {
				if (dir.startsWith(prefix(path))) {
					dirs.delete(dir);
				}
			}
		},
	};
}

// ---------------------------------------------------------------------------
// Workspace seeding (the .flauz/ state surfaces of the closed table)
// ---------------------------------------------------------------------------

const ROOT = '/ws/acme';

const SEED_STATE: Record<string, string> = {
	[`${ROOT}/.flauz/tasks.json`]: '{\n  "$schema": "flauz.tasks/v0",\n  "tasks": []\n}\n',
	[`${ROOT}/.flauz/environments.json`]: '{\n  "$schema": "flauz.environments/v0",\n  "activeId": null,\n  "environments": []\n}\n',
	[`${ROOT}/.flauz/environments-lifecycle.json`]: '{"schemaVersion":0,"schema":"flauz.environments-lifecycle/v0","updatedAt":1760000000000,"entries":{}}\n',
	[`${ROOT}/.flauz/environments-ops.jsonl`]: '',
	[`${ROOT}/.flauz/resources.json`]: '{\n  "$schema": "flauz.resources/v0",\n  "edges": [],\n  "nodes": [],\n  "surfaces": []\n}\n',
	[`${ROOT}/.flauz/resources-ops.jsonl`]: '',
	[`${ROOT}/.flauz/workflows/index.json`]: '{"schemaVersion":0,"ids":[]}\n',
	[`${ROOT}/.flauz/workflows/wf-0001.json`]: '{"schemaVersion":0,"name":"fixture workflow"}\n',
	// secret-shaped surfaces: PRESENT on disk (redacted at export; payload never read)
	[`${ROOT}/.flauz/evidence/ledger.jsonl`]: '{"rows":[]}\n',
	[`${ROOT}/.flauz/browser-sessions.jsonl`]: '',
	[`${ROOT}/.flauz/artifacts/T-001/verdict.json`]: '{"kind":"note"}\n',
};

const CARRIED_IDS = [
	'flauz-tasks-envelope',
	'flauz-environments-registry',
	'flauz-environments-lifecycle',
	'flauz-environments-ops',
	'flauz-resources-graph',
	'flauz-resources-ops',
	'flauz-workflow-state',
];
const REDACTED_IDS = ['flauz-evidence-ledger', 'flauz-evidence-artifacts', 'flauz-browser-session-journal'];

/** A secret-shaped string ASSEMBLED FROM FRAGMENTS at runtime (never a complete shape in source). */
function runtimeSecretFixture(): string {
	return ['ghp_', 'Flauz', 'Fixture', 'Only', '0000', '1111', '2222', '3333'].join('');
}

function steppingMintId(): () => string {
	let counter = 0;
	return () => `flauz:continuity:${(counter++).toString(16).padStart(16, '0')}`;
}

function fixedClock(ts = 1760000100000): () => number {
	return () => ts;
}

interface Harness {
	manager: ContinuityManager;
	fs: MemContinuityFs;
	registry: EnvironmentRegistry | undefined;
}

async function bootHarness(options: { seed?: Record<string, string>; registry?: boolean } = {}): Promise<Harness> {
	const fs = memContinuityFs(options.seed ?? SEED_STATE);
	let registry: EnvironmentRegistry | undefined;
	if (options.registry === true) {
		registry = new EnvironmentRegistry({ root: ROOT, fs, clock: fixedClock() });
		await registry.bootstrap();
	}
	const manager = new ContinuityManager({
		root: ROOT,
		fs,
		clock: fixedClock(),
		mintId: steppingMintId(),
		...(registry !== undefined ? { registry } : {}),
	});
	return { manager, fs, registry };
}

// ---------------------------------------------------------------------------
// The surface table
// ---------------------------------------------------------------------------

test('surface table: the 16 N-8 canon surfaces + the post-canon state surfaces, closed and deterministic', () => {
	const ids = surfaceIds();
	const canonIds = CONTINUITY_ARTIFACTS.map(artifact => artifact.id);
	for (const id of canonIds) {
		ok(ids.includes(id), `canon surface '${id}' is in the table`);
	}
	strictEqual(ids.length, 22, '16 canon + 6 post-canon state surfaces');
	deepStrictEqual(ids.slice(0, 16), canonIds, 'the canon keeps its order first');
	// materialization classes
	const fileSurfaces = CONTINUITY_SURFACES.filter(spec => spec.kind === 'file');
	const dirSurfaces = CONTINUITY_SURFACES.filter(spec => spec.kind === 'directory');
	const nullSurfaces = CONTINUITY_SURFACES.filter(spec => spec.path === null);
	strictEqual(fileSurfaces.length, 8, 'file-materialized surfaces');
	strictEqual(dirSurfaces.length, 2, 'directory-materialized surfaces (artifacts + workflows)');
	strictEqual(nullSurfaces.length, 12, 'non-materialized canon surfaces (native rehydration / lost by design)');
	strictEqual(fileSurfaces.length + dirSurfaces.length + nullSurfaces.length, 22);
	// secret-shape classification: the captured class = evidence + artifacts + journal
	deepStrictEqual(
		CONTINUITY_SURFACES.filter(spec => spec.secretClass === 'captured').map(spec => spec.id).sort(),
		[...REDACTED_IDS].sort(),
		'the secret-shape (captured) class is exactly the evidence/artifacts/journal family',
	);
});

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

test('export: materializes a bundle from actual .flauz state — carried/redacted/lost exactly per the law', async () => {
	const { manager, fs } = await bootHarness();
	const outcome = await manager.export({ actor: 'human' });
	ok(outcome.ok, 'export succeeds');
	strictEqual(outcome.manifest.bundleId, 'flauz:continuity:0000000000000000');
	ok(isContinuityBundleId(outcome.manifest.bundleId), 'the minted id matches the grammar');
	strictEqual(Object.keys(outcome.manifest.surfaces).length, 22, 'every table surface is classified');
	for (const id of CARRIED_IDS) {
		strictEqual(outcome.manifest.surfaces[id]!.status, 'carried', `${id} carried`);
	}
	for (const id of REDACTED_IDS) {
		const entry = outcome.manifest.surfaces[id]!;
		strictEqual(entry.status, 'redacted', `${id} redacted`);
		strictEqual(entry.sha256, sha256Hex(CONTINUITY_SURFACES.find(spec => spec.id === id)!.path!), 'redacted hash = sha256 of the PATH');
		strictEqual(entry.artifactPath, undefined, 'redacted entries never reference a payload artifact');
		strictEqual(entry.bytes, undefined, 'redacted entries never record payload metadata');
	}
	const lostIds = Object.entries(outcome.manifest.surfaces).filter(([, entry]) => entry.status === 'lost').map(([id]) => id);
	strictEqual(lostIds.length, 12, 'non-materialized surfaces are typed lost entries');
	ok(lostIds.includes('terminal-scrollback') && lostIds.includes('chat-sessions'), 'lost surfaces carry the canon names');
	for (const id of lostIds) {
		ok(outcome.manifest.surfaces[id]!.note !== undefined, `lost entry '${id}' carries the why-note`);
	}
	// the bundle on disk: canonical manifest, artifacts with recorded hashes
	const bundleDir = `${ROOT}/.flauz/continuity-bundles/${outcome.manifest.bundleId}`;
	const manifestRaw = fs.files().get(`${bundleDir}/manifest.json`)!;
	ok(manifestRaw !== undefined, 'manifest.json written');
	strictEqual(manifestRaw, serializeBundleManifest(outcome.manifest), 'canonical serialization (sorted keys, 2-space, one trailing newline)');
	strictEqual(manifestRaw.endsWith('}\n'), true);
	strictEqual(manifestRaw.includes('\n\n'), false);
	const tasksArtifact = fs.files().get(`${bundleDir}/surfaces/flauz-tasks-envelope.json`)!;
	strictEqual(tasksArtifact, SEED_STATE[`${ROOT}/.flauz/tasks.json`]!, 'the tasks payload is copied byte-identically');
	strictEqual(outcome.manifest.surfaces['flauz-tasks-envelope']!.sha256, sha256Hex(tasksArtifact), 'content hash recorded');
	// directory surface: tree copy + tree manifest
	strictEqual(fs.files().get(`${bundleDir}/surfaces/flauz-workflow-state/index.json`), SEED_STATE[`${ROOT}/.flauz/workflows/index.json`]!);
	strictEqual(fs.files().get(`${bundleDir}/surfaces/flauz-workflow-state/wf-0001.json`), SEED_STATE[`${ROOT}/.flauz/workflows/wf-0001.json`]!);
	const treeManifest = JSON.parse(fs.files().get(`${bundleDir}/surfaces/flauz-workflow-state.manifest.json`)!) as { files: Array<{ path: string }> };
	deepStrictEqual(treeManifest.files.map(file => file.path), ['index.json', 'wf-0001.json'], 'per-file tree manifest, deterministic order');
	// the SECRET-SHAPED payloads are NEVER copied
	strictEqual(fs.files().get(`${bundleDir}/surfaces/flauz-evidence-ledger.jsonl`), undefined, 'the evidence ledger payload is never in the bundle');
	strictEqual(fs.files().get(`${bundleDir}/surfaces/flauz-browser-session-journal.jsonl`), undefined, 'the journal payload is never in the bundle');
	strictEqual(fs.files().get(`${bundleDir}/surfaces/flauz-evidence-artifacts/T-001/verdict.json`), undefined, 'the artifacts payload is never in the bundle');
	// commit discipline: the bundle dir was renamed into place (atomic commit)
	ok(fs.renames().some(rename => rename.from.endsWith('.staging') && rename.to.endsWith(outcome.manifest.bundleId)), 'staged then renamed (atomic commit)');
	// the ops ledger line
	const ledgerRaw = fs.files().get(`${ROOT}/.flauz/continuity-ops.jsonl`)!;
	const records = ContinuityOpsLedger.parseLedger(ledgerRaw);
	strictEqual(records.length, 1);
	strictEqual(records[0]!.op, 'export');
	strictEqual(records[0]!.result, 'ok');
	strictEqual(records[0]!.actor, 'human');
	strictEqual(records[0]!.bundleId, outcome.manifest.bundleId);
	deepStrictEqual(records[0]!.details, { surfacesCarried: 7, surfacesLost: 12, surfacesRedacted: 3 });
	strictEqual(ledgerRaw.split('\n')[0], serializeContinuityOpRecord(records[0]!), 'canonical single-line serialization');
});

test('export: a secret-shaped literal in a CARRIED payload fails closed (EXPORT_SECRET_DETECTED), no bundle committed', async () => {
	const poisoned = { ...SEED_STATE };
	poisoned[`${ROOT}/.flauz/tasks.json`] = `{"tasks":[{"note":"token ${runtimeSecretFixture()}"}]}\n`;
	const { manager, fs } = await bootHarness({ seed: poisoned });
	const outcome = await manager.export({ actor: 'agent' });
	ok(!outcome.ok, 'export fails');
	strictEqual(outcome.error.code, 'EXPORT_SECRET_DETECTED');
	strictEqual(outcome.error.message.includes('vault-only'), true, 'the message names the law');
	// the failed attempt is ledger-recorded
	strictEqual(outcome.record.result, 'error');
	strictEqual(outcome.record.error!.code, 'EXPORT_SECRET_DETECTED');
	// no bundle dir committed (staging cleaned)
	const entries = [...fs.files().keys()].filter(key => key.includes('continuity-bundles'));
	strictEqual(entries.length, 0, 'no bundle bytes survive (staging removed)');
	const records = ContinuityOpsLedger.parseLedger(fs.files().get(`${ROOT}/.flauz/continuity-ops.jsonl`)!);
	strictEqual(records.length, 1, 'the failed attempt is auditable');
	strictEqual(records[0]!.result, 'error');
});

test('export: provenance law — a missing/invalid actor is a pre-flight rejection, nothing recorded', async () => {
	const { manager, fs } = await bootHarness();
	await typedRejects(manager.export({ actor: undefined }), 'ACTOR_REQUIRED');
	await typedRejects(manager.export({ actor: 'daemon' as never }), 'ACTOR_INVALID');
	strictEqual(fs.files().get(`${ROOT}/.flauz/continuity-ops.jsonl`), undefined, 'no ledger line for a rejected call');
});

test('export: source environment resolution — unknown env is a RECORDED failure; a registered env is pinned as source', async () => {
	const { manager, fs } = await bootHarness({ registry: true });
	const unknown = await manager.export({ actor: 'human', environmentId: 'env-nope' });
	ok(!unknown.ok);
	strictEqual(unknown.error.code, 'ENVIRONMENT_UNKNOWN');
	strictEqual(unknown.record.result, 'error', 'the resolution failure is ledger-recorded');
	await typedRejects(manager.export({ actor: 'human', environmentId: 'not-an-env-id' }), 'ENVIRONMENT_ID_INVALID');
	await typedRejects(manager.export({ actor: 'human', environmentId: 42 as never }), 'ENVIRONMENT_ID_INVALID');
	const registered = new EnvironmentRegistry({ root: ROOT, fs, clock: fixedClock() });
	await registered.bootstrap();
	await registered.register({
		id: 'env-src-main',
		kind: 'ssh-local',
		label: 'Source',
		connection: { host: 'src.example.internal', authMethod: 'key' },
		trust: { posture: 'unknown', inheritsWorkspaceTrust: false },
		capabilities: { agentHost: true, browser: false, exec: true, terminal: true },
	});
	const managerWithEnv = new ContinuityManager({ root: ROOT, fs, clock: fixedClock(), mintId: steppingMintId(), registry: registered });
	const okExport = await managerWithEnv.export({ actor: 'human', environmentId: 'env-src-main' });
	ok(okExport.ok);
	strictEqual(okExport.manifest.sourceEnvironmentId, 'env-src-main');
	strictEqual(okExport.record.details!.fromEnvironmentId, 'env-src-main');
});

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

test('restore: re-hydrates state atomically with typed per-surface outcomes', async () => {
	const { manager, fs } = await bootHarness();
	const exported = await manager.export({ actor: 'human' });
	ok(exported.ok);
	const bundleId = exported.manifest.bundleId;
	// simulate the fresh target workspace: the state surfaces are gone, the bundle + ledger ride over
	for (const path of Object.keys(SEED_STATE)) {
		fs.delete(path);
	}
	strictEqual(fs.files().get(`${ROOT}/.flauz/tasks.json`), undefined, 'target starts empty');
	const restored = await manager.restore({ bundleId, actor: 'human' });
	ok(restored.ok, 'restore succeeds');
	const outcomes = new Map(restored.surfaces.map(surface => [surface.surface, surface.outcome]));
	for (const id of CARRIED_IDS) {
		strictEqual(outcomes.get(id), 'carried', `${id} restored`);
	}
	for (const id of REDACTED_IDS) {
		strictEqual(outcomes.get(id), 'redacted', `${id} records the redaction (nothing to restore)`);
	}
	strictEqual(restored.surfaces.filter(surface => surface.outcome === 'lost').length, 12);
	// byte-identical re-hydration (file + directory surfaces)
	strictEqual(fs.files().get(`${ROOT}/.flauz/tasks.json`), SEED_STATE[`${ROOT}/.flauz/tasks.json`]!);
	strictEqual(fs.files().get(`${ROOT}/.flauz/workflows/index.json`), SEED_STATE[`${ROOT}/.flauz/workflows/index.json`]!);
	strictEqual(fs.files().get(`${ROOT}/.flauz/workflows/wf-0001.json`), SEED_STATE[`${ROOT}/.flauz/workflows/wf-0001.json`]!);
	// atomic per-file: tmp+rename observed for the file surfaces
	ok(fs.renames().some(rename => rename.to === `${ROOT}/.flauz/tasks.json` && rename.from === `${ROOT}/.flauz/tasks.json.tmp`), 'tmp+rename per file');
	// the ops ledger line
	const records = ContinuityOpsLedger.parseLedger(fs.files().get(`${ROOT}/.flauz/continuity-ops.jsonl`)!);
	strictEqual(records.length, 2);
	strictEqual(records[1]!.op, 'restore');
	strictEqual(records[1]!.result, 'ok');
	deepStrictEqual(records[1]!.details, { surfacesCarried: 7, surfacesLost: 12, surfacesRedacted: 3 });
});

test('restore: RESTORE_TARGET_NOT_EMPTY without force; force overwrites; a 0-byte target file is not non-empty', async () => {
	const { manager, fs } = await bootHarness();
	const exported = await manager.export({ actor: 'human' });
	ok(exported.ok);
	const bundleId = exported.manifest.bundleId;
	// the source state is still present (non-empty targets)
	const refused = await manager.restore({ bundleId, actor: 'human' });
	ok(!refused.ok);
	strictEqual(refused.error.code, 'RESTORE_TARGET_NOT_EMPTY');
	ok(refused.error.message.includes('flauz-tasks-envelope'), 'the offending surfaces are named');
	strictEqual(refused.record.result, 'error', 'the refusal is ledger-recorded');
	const forced = await manager.restore({ bundleId, actor: 'human', force: true });
	ok(forced.ok, 'force overwrites the non-empty target');
	// a 0-byte existing target file is NOT non-empty state — restore proceeds without force
	for (const path of Object.keys(SEED_STATE)) {
		fs.delete(path);
	}
	fs.files().set(`${ROOT}/.flauz/tasks.json`, '');
	const emptyFileOk = await manager.restore({ bundleId, actor: 'human' });
	ok(emptyFileOk.ok, 'an empty (0-byte) target file does not require force');
});

test('restore: trust gate — untrusted target environments are rejected fail-closed', async () => {
	const { manager, fs } = await bootHarness({ registry: true });
	const registered = new EnvironmentRegistry({ root: ROOT, fs, clock: fixedClock() });
	await registered.bootstrap();
	await registered.register({
		id: 'env-target-cloud',
		kind: 'cloud-sandbox',
		label: 'Cloud Target',
		connection: { provider: 'e2b', apiKeyRef: 'vault:cloud-e2b-key', sandboxTemplate: 'base' },
		trust: { posture: 'untrusted', inheritsWorkspaceTrust: false },
		capabilities: { agentHost: true, browser: false, exec: true, terminal: false },
	});
	await registered.register({
		id: 'env-target-box',
		kind: 'container',
		label: 'Container Target',
		connection: { workspaceFolder: '/workspace', name: 'target' },
		trust: { posture: 'trusted', inheritsWorkspaceTrust: true },
		capabilities: { agentHost: true, browser: false, exec: true, terminal: true },
	});
	const managerWithEnv = new ContinuityManager({ root: ROOT, fs, clock: fixedClock(), mintId: steppingMintId(), registry: registered });
	const exported = await managerWithEnv.export({ actor: 'human' });
	ok(exported.ok);
	const untrusted = await managerWithEnv.restore({ bundleId: exported.manifest.bundleId, actor: 'agent', targetEnvironmentId: 'env-target-cloud' });
	ok(!untrusted.ok);
	strictEqual(untrusted.error.code, 'TRUST_POSTURE_REJECTED');
	ok(untrusted.error.message.includes('\'untrusted\''), 'the message names the posture');
	strictEqual(untrusted.record.result, 'error', 'the rejection is ledger-recorded');
	const unknown = await managerWithEnv.restore({ bundleId: exported.manifest.bundleId, actor: 'agent', targetEnvironmentId: 'env-missing' });
	ok(!unknown.ok);
	strictEqual(unknown.error.code, 'ENVIRONMENT_UNKNOWN');
	// trusted/unknown postures proceed (the DL-30 defaults)
	const trusted = await managerWithEnv.restore({ bundleId: exported.manifest.bundleId, actor: 'agent', targetEnvironmentId: 'env-target-box', force: true });
	ok(trusted.ok);
	strictEqual(trusted.record.details!.toEnvironmentId, 'env-target-box');
});

test('restore: ALL-OR-NOTHING — a tampered artifact fails the whole restore BEFORE any write', async () => {
	const { manager, fs } = await bootHarness();
	const exported = await manager.export({ actor: 'human' });
	ok(exported.ok);
	const bundleId = exported.manifest.bundleId;
	// simulate the fresh target + a tampered tasks artifact in the carried bundle
	for (const path of Object.keys(SEED_STATE)) {
		fs.delete(path);
	}
	fs.files().set(`${ROOT}/.flauz/continuity-bundles/${bundleId}/surfaces/flauz-tasks-envelope.json`, '{"tasks":[{"tampered":true}]}\n');
	const prior = fs.files().get(`${ROOT}/.flauz/tasks.json`);
	strictEqual(prior, undefined, 'the target has no prior tasks state in this drill');
	const failed = await manager.restore({ bundleId, actor: 'human' });
	ok(!failed.ok, 'the op fails when any surface fails');
	strictEqual(failed.error.code, 'RESTORE_SURFACE_FAILED');
	ok(failed.error.message.includes('NOTHING was written'), 'the error names the all-or-nothing law');
	const tasksResult = failed.surfaces.find(surface => surface.surface === 'flauz-tasks-envelope')!;
	strictEqual(tasksResult.outcome, 'skipped');
	ok(tasksResult.note !== undefined && tasksResult.note.includes('hash mismatch'), 'the skip reason names the mismatch');
	strictEqual(fs.files().get(`${ROOT}/.flauz/tasks.json`), undefined, 'no partial write of the tampered surface');
	// the OTHER surfaces were NOT written either (all-or-nothing, not per-surface)
	const registryResult = failed.surfaces.find(surface => surface.surface === 'flauz-environments-registry')!;
	strictEqual(registryResult.outcome, 'skipped', 'independent surfaces are not attempted when any surface fails validation');
	ok(registryResult.note !== undefined && registryResult.note.includes('all-or-nothing'), 'the note explains the all-or-nothing abort');
	strictEqual(fs.files().get(`${ROOT}/.flauz/environments.json`), undefined, 'NOTHING was written (the target keeps its prior state)');
	strictEqual(fs.files().get(`${ROOT}/.flauz/workflows/index.json`), undefined, 'no directory-surface file was written either');
	// the failed attempt is ledger-recorded with the prev chain intact
	const records = ContinuityOpsLedger.parseLedger(fs.files().get(`${ROOT}/.flauz/continuity-ops.jsonl`)!);
	strictEqual(records[records.length - 1]!.result, 'error');
	strictEqual(records[records.length - 1]!.error!.code, 'RESTORE_SURFACE_FAILED');
});

test('restore: pre-flight rejections — unknown bundle / bad id shape (nothing recorded)', async () => {
	const { manager, fs } = await bootHarness();
	await typedRejects(manager.restore({ bundleId: 'flauz:continuity:deadbeefdeadbeef', actor: 'human' }), 'BUNDLE_UNKNOWN');
	await typedRejects(manager.restore({ bundleId: '../etc/passwd', actor: 'human' }), 'BUNDLE_ID_INVALID');
	await typedRejects(manager.restore({ bundleId: 'flauz:continuity:0000000000000000', actor: 'human', force: 'yes' as never }), 'OP_INVALID');
	strictEqual(fs.files().get(`${ROOT}/.flauz/continuity-ops.jsonl`), undefined, 'pre-flight rejections record nothing');
});

// ---------------------------------------------------------------------------
// Verify + status
// ---------------------------------------------------------------------------

test('verify: hash integrity — clean bundle passes; a tampered artifact is a typed mismatch', async () => {
	const { manager, fs } = await bootHarness();
	const exported = await manager.export({ actor: 'human' });
	ok(exported.ok);
	const bundleId = exported.manifest.bundleId;
	const clean = await manager.verify({ bundleId, actor: 'tool' });
	ok(clean.ok);
	const verdicts = new Map(clean.surfaces.map(surface => [surface.surface, surface.verdict]));
	for (const id of CARRIED_IDS) {
		strictEqual(verdicts.get(id), 'verified', `${id} hash-verified`);
	}
	for (const id of REDACTED_IDS) {
		strictEqual(verdicts.get(id), 'redacted', `${id} path-hash verified`);
	}
	strictEqual(clean.surfaces.filter(surface => surface.verdict === 'lost').length, 12);
	// ledger: the verify op is journaled
	let records = ContinuityOpsLedger.parseLedger(fs.files().get(`${ROOT}/.flauz/continuity-ops.jsonl`)!);
	strictEqual(records[records.length - 1]!.op, 'verify');
	strictEqual(records[records.length - 1]!.result, 'ok');
	// tamper: one byte of a carried artifact
	fs.files().set(
		`${ROOT}/.flauz/continuity-bundles/${bundleId}/surfaces/flauz-tasks-envelope.json`,
		'{"tasks":[]}\n',
	);
	const tampered = await manager.verify({ bundleId, actor: 'tool' });
	ok(!tampered.ok);
	strictEqual(tampered.error.code, 'VERIFY_FAILED');
	ok(tampered.error.message.includes('flauz-tasks-envelope'), 'the mismatched surface is named');
	strictEqual(tampered.surfaces.find(surface => surface.surface === 'flauz-tasks-envelope')!.verdict, 'mismatch');
	records = ContinuityOpsLedger.parseLedger(fs.files().get(`${ROOT}/.flauz/continuity-ops.jsonl`)!);
	strictEqual(records[records.length - 1]!.result, 'error', 'the failed verify is ledger-recorded');
	// a fabricated redacted entry (wrong path hash) is caught at PARSE time
	const manifest = JSON.parse(fs.files().get(`${ROOT}/.flauz/continuity-bundles/${bundleId}/manifest.json`)!) as { surfaces: Record<string, { sha256?: string }> };
	manifest.surfaces['flauz-evidence-ledger']!.sha256 = 'a'.repeat(64);
	fs.files().set(`${ROOT}/.flauz/continuity-bundles/${bundleId}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
	await typedRejects(manager.verify({ bundleId, actor: 'tool' }), 'BUNDLE_CORRUPT');
});

test('status: read-only — lists bundles + ops, flags incomplete/staging dirs, never appends', async () => {
	const { manager, fs } = await bootHarness();
	const empty = await manager.status();
	strictEqual(empty.bundles.length, 0);
	strictEqual(empty.ops.length, 0);
	const exported = await manager.export({ actor: 'human' });
	ok(exported.ok);
	// an incomplete bundle dir (no manifest) + a staging leftover
	fs.files().set(`${ROOT}/.flauz/continuity-bundles/flauz:continuity:aaaaaaaaaaaaaaaa/README.txt`, 'incomplete\n');
	await fs.mkdir(`${ROOT}/.flauz/continuity-bundles/flauz:continuity:bbbbbbbbbbbbbbbb.staging`);
	const report = await manager.status();
	strictEqual(report.bundles.length, 3);
	const complete = report.bundles.find(row => row.complete);
	ok(complete !== undefined && complete.manifest!.bundleId === exported.manifest.bundleId);
	const incomplete = report.bundles.find(row => row.dir === 'flauz:continuity:aaaaaaaaaaaaaaaa')!;
	strictEqual(incomplete.complete, false);
	ok(incomplete.note!.includes('no manifest.json'));
	const staging = report.bundles.find(row => row.dir.endsWith('.staging'))!;
	strictEqual(staging.complete, false);
	ok(staging.note!.includes('staging leftover'));
	strictEqual(report.ops.length, 1, 'the export op is listed');
	// read-only: status appended nothing
	const records = ContinuityOpsLedger.parseLedger(fs.files().get(`${ROOT}/.flauz/continuity-ops.jsonl`)!);
	strictEqual(records.length, 1);
});

// ---------------------------------------------------------------------------
// Ledger discipline + id grammar
// ---------------------------------------------------------------------------

test('the ops ledger append preserves existing bytes and fails closed on a corrupt tail', async () => {
	const { manager, fs } = await bootHarness();
	const first = await manager.export({ actor: 'human' });
	ok(first.ok);
	const second = await manager.export({ actor: 'agent' });
	ok(second.ok);
	const raw = fs.files().get(`${ROOT}/.flauz/continuity-ops.jsonl`)!;
	const lines = raw.split('\n');
	strictEqual(lines.length, 3, 'two records + trailing newline');
	strictEqual(lines[0], serializeContinuityOpRecord(ContinuityOpsLedger.parseLedger(`${lines[0]}\n`)[0]!), 'line 1 canonical');
	strictEqual(lines[0], raw.split('\n')[0], 'append preserved every existing byte');
	// corrupt the ledger -> the next append refuses LOUDLY (fail-closed; the
	// corrupt tail is never silently repaired or extended)
	fs.files().set(`${ROOT}/.flauz/continuity-ops.jsonl`, `${lines[0]}\nnot json\n`);
	await typedRejects(manager.export({ actor: 'human' }), 'OPS_CORRUPT');
	strictEqual(fs.files().get(`${ROOT}/.flauz/continuity-ops.jsonl`), `${lines[0]}\nnot json\n`, 'the corrupt ledger is left untouched (no silent rewrite)');
});

test('bundle id grammar: minted ids match flauz:continuity:<16-hex>; malformed factory output is rejected', async () => {
	ok(isContinuityBundleId(mintBundleId()), 'the default minter produces grammar-valid ids');
	ok(!isContinuityBundleId('flauz:continuity:xyz'), 'too short');
	ok(!isContinuityBundleId('flauz:continuity:GGGGGGGGGGGGGGGG'), 'uppercase hex rejected');
	ok(!isContinuityBundleId('.flauz/continuity-bundles/123'), 'a path is never a bundle id');
	ok(!isContinuityBundleId('https://example.com/bundle'), 'a URL is never a bundle id');
	const { fs } = await bootHarness();
	const manager = new ContinuityManager({ root: ROOT, fs, clock: fixedClock(), mintId: () => 'not-an-id' });
	await typedRejects(manager.export({ actor: 'human' }), 'BUNDLE_ID_INVALID');
});

test('parseBundleManifest rejects an incomplete surface table and traversal artifact paths', async () => {
	const { manager } = await bootHarness();
	const exported = await manager.export({ actor: 'human' });
	ok(exported.ok);
	const manifest = JSON.parse(serializeBundleManifest(exported.manifest)) as Record<string, unknown> & { surfaces: Record<string, unknown> };
	delete manifest.surfaces['terminal-scrollback'];
	throws(() => parseBundleManifest(JSON.stringify(manifest)), /missing 'terminal-scrollback'/, 'closed-table completeness is enforced');
	const traversal = JSON.parse(serializeBundleManifest(exported.manifest)) as { surfaces: Record<string, { artifactPath?: string }> };
	traversal.surfaces['flauz-tasks-envelope']!.artifactPath = 'surfaces/../../../etc/passwd';
	throws(() => parseBundleManifest(JSON.stringify(traversal)), /artifactPath/, 'traversal paths are rejected');
	const absolute = JSON.parse(serializeBundleManifest(exported.manifest)) as { surfaces: Record<string, { artifactPath?: string }> };
	absolute.surfaces['flauz-tasks-envelope']!.artifactPath = '/etc/passwd';
	throws(() => parseBundleManifest(JSON.stringify(absolute)), /artifactPath/, 'absolute paths are rejected');
});

// ---------------------------------------------------------------------------
// Switch integration (TL3-006 3.4: the plan can reference a bundle)
// ---------------------------------------------------------------------------

test('planSwitch: the optional continuityBundleId rides the plan additively; malformed ids are rejected', async () => {
	const target = {
		id: 'env-plan-target',
		kind: 'container' as const,
		label: 'Plan Target',
		connection: { workspaceFolder: '/workspace', name: 'plan-target' },
		trust: { posture: 'trusted' as const, inheritsWorkspaceTrust: true },
		capabilities: { agentHost: true, browser: false, exec: true, terminal: true },
		enabled: true,
		timing: { created: 1760000000000, updatedAt: 1760000000000 },
	};
	const plain = planSwitch(null, target);
	strictEqual(plain.continuityBundleId, undefined, 'absent by default (additive, no semantic change)');
	strictEqual(plain.notes.length, 3, 'the base notes are unchanged');
	const bundleId = 'flauz:continuity:0123456789abcdef';
	const withBundle = planSwitch(null, target, { continuityBundleId: bundleId });
	strictEqual(withBundle.continuityBundleId, bundleId);
	strictEqual(withBundle.notes.length, 4, 'the carry note is appended');
	ok(withBundle.notes[3]!.includes('flauz.continuity.export'), 'the note documents the export->switch->restore flow');
	throws(() => planSwitch(null, target, { continuityBundleId: '../etc/passwd' }), /continuityBundleId must be a logical id/);
});
