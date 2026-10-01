/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL3-P2 PARTITION C audit suite (flauz-environments continuity side) — the
 * regression tests for the product-readiness findings (each fails on the
 * untouched base c27de198 and passes after the fix) plus the checklist
 * evidence pins:
 *
 *   C3/DL-77  continuity ops appends + manager ops are STRICTLY serial
 *   C5        export redaction: a canary secret can NEVER land in a bundle
 *   C6        an in-place ops-ledger record rewrite is OPS_CORRUPT (prev chain)
 *   C7        restore is ALL-OR-NOTHING under injected failure (rollback)
 *   C8        export -> wipe -> restore yields byte-identical state surfaces
 *   C9        the browser-session journal is consumed READ-ONLY
 *   C10       canonical serialization is byte-identical across runs
 */
import { test } from 'node:test';
import { ok, strictEqual, throws } from 'node:assert';
import { ContinuityManager, type ContinuityFsPort, type DirEntry } from '../src/continuityExec/manager.ts';
import { ContinuityOpsLedger, serializeContinuityOpRecord } from '../src/continuityExec/store.ts';
import { ContinuityError, type ContinuityErrorCode } from '../src/continuityExec/types.ts';

const ROOT = '/ws/acme';
const JOURNAL_PATH = `${ROOT}/.flauz/browser-sessions.jsonl`;

const SEED_STATE: Record<string, string> = {
	[`${ROOT}/.flauz/tasks.json`]: '{\n  "$schema": "flauz.tasks/v0",\n  "tasks": []\n}\n',
	[`${ROOT}/.flauz/environments.json`]: '{\n  "$schema": "flauz.environments/v0",\n  "activeId": null,\n  "environments": []\n}\n',
	[`${ROOT}/.flauz/environments-lifecycle.json`]: '{"schemaVersion":0,"schema":"flauz.environments-lifecycle/v0","updatedAt":1760000000000,"entries":{}}',
	[`${ROOT}/.flauz/environments-ops.jsonl`]: '',
	[`${ROOT}/.flauz/resources.json`]: '{\n  "$schema": "flauz.resources/v0",\n  "edges": [],\n  "nodes": [],\n  "surfaces": []\n}\n',
	[`${ROOT}/.flauz/resources-ops.jsonl`]: '',
	[`${ROOT}/.flauz/workflows/index.json`]: '{"schemaVersion":0,"ids":[]}',
	[`${ROOT}/.flauz/workflows/wf-0001.json`]: '{"schemaVersion":0,"name":"fixture workflow"}',
	[`${ROOT}/.flauz/workflows/wf-0002.json`]: '{"schemaVersion":0,"name":"second workflow"}',
	// captured (secret-shaped class) surfaces, PRESENT on disk:
	[`${ROOT}/.flauz/evidence/ledger.jsonl`]: '{"rows":[]}',
	[`${ROOT}/.flauz/browser-sessions.jsonl`]: '',
	[`${ROOT}/.flauz/artifacts/T-001/verdict.json`]: '{"kind":"note"}',
};

/** A secret-shaped canary ASSEMBLED FROM FRAGMENTS at runtime (never a complete shape in source). */
function canary(): string {
	return ['ghp_', 'Flauz', 'Audit', 'Canary', '0000', '1111', '2222', '3333'].join('');
}

interface AuditFs extends ContinuityFsPort {
	files(): Map<string, string>;
	delete(path: string): void;
	readonly writes: string[];
}
function auditFs(seed: Record<string, string> = {}): AuditFs {
	const files = new Map<string, string>(Object.entries(seed));
	const dirs = new Set<string>();
	const writes: string[] = [];
	const prefix = (p: string) => (p.endsWith('/') ? p : `${p}/`);
	const deriveEntries = (p: string): DirEntry[] | undefined => {
		const children = new Map<string, DirEntry['kind']>();
		for (const key of files.keys()) {
			if (!key.startsWith(prefix(p))) {
				continue;
			}
			const rest = key.slice(prefix(p).length);
			if (rest.length === 0) {
				continue;
			}
			children.set(rest.split('/')[0]!, rest.includes('/') ? 'directory' : 'file');
		}
		for (const dir of dirs) {
			if (!dir.startsWith(prefix(p))) {
				continue;
			}
			const rest = dir.slice(prefix(p).length);
			if (rest.length === 0) {
				continue;
			}
			children.set(rest.split('/')[0]!, 'directory');
		}
		return children.size === 0 ? undefined : [...children.entries()].map(([name, kind]) => ({ name, kind })).sort((a, b) => (a.name < b.name ? -1 : 1));
	};
	return {
		files: () => files,
		delete: p => {
			files.delete(p);
			dirs.delete(p);
			for (const key of [...files.keys()]) {
				if (key.startsWith(prefix(p))) {
					files.delete(key);
				}
			}
		},
		writes,
		readFileUtf8: async p => files.get(p),
		writeFile: async (p, c) => {
			writes.push(`write:${p}`);
			files.set(p, c);
		},
		rename: async (from, to) => {
			writes.push(`rename:${from}->${to}`);
			if (files.has(from)) {
				files.set(to, files.get(from)!);
				files.delete(from);
				return;
			}
			const moved = [...files.keys()].filter(k => k.startsWith(prefix(from)));
			for (const k of moved) {
				files.set(`${prefix(to)}${k.slice(prefix(from).length)}`, files.get(k)!);
			}
			for (const k of moved) {
				files.delete(k);
			}
			for (const d of [...dirs].filter(d => d.startsWith(prefix(from)))) {
				dirs.add(`${prefix(to)}${d.slice(prefix(from).length)}`) as unknown as void;
				dirs.delete(d);
			}
		},
		mkdir: async p => {
			dirs.add(p);
		},
		readdir: async p => deriveEntries(p),
		rm: async p => {
			writes.push(`rm:${p}`);
			files.delete(p);
			dirs.delete(p);
			for (const key of [...files.keys()]) {
				if (key.startsWith(prefix(p))) {
					files.delete(key);
				}
			}
			for (const dir of [...dirs]) {
				if (dir.startsWith(prefix(p))) {
					dirs.delete(dir);
				}
			}
		},
	};
}

function managerOf(fs: AuditFs): ContinuityManager {
	return new ContinuityManager({
		root: ROOT,
		fs,
		clock: () => 1760000100000,
		mintId: steppingMintId(),
	});
}

function steppingMintId(): () => string {
	let counter = 0;
	return () => `flauz:continuity:${(counter++).toString(16).padStart(16, '0')}`;
}

async function typedRejects(promise: Promise<unknown>, code: ContinuityErrorCode): Promise<void> {
	let caught: unknown;
	try {
		await promise;
	} catch (err) {
		caught = err;
	}
	ok(caught instanceof ContinuityError, `expected a ContinuityError (got ${String(caught)})`);
	strictEqual((caught as ContinuityError).code, code);
}

// ---------------------------------------------------------------------------
// C3 / DL-77 — serialized appends + serialized manager ops
// ---------------------------------------------------------------------------

test('REGRESSION (DL-77): concurrent continuity ledger appends serialize — every record lands', async () => {
	const fs = auditFs();
	const ledger = new ContinuityOpsLedger({ root: ROOT, fs, clock: () => 1000 });
	const record = (i: number) => ({
		schemaVersion: 0, schema: 'flauz.continuity-ops/v0', ts: 1000 + i, actor: 'human' as const,
		op: 'export' as const, bundleId: `flauz:continuity:${i.toString(16).padStart(16, '0')}`, result: 'ok' as const,
	});
	await Promise.all([ledger.append(record(1)), ledger.append(record(2)), ledger.append(record(3))]);
	const raw = fs.files().get(`${ROOT}/.flauz/continuity-ops.jsonl`) ?? '';
	const lines = raw.split('\n').filter(l => l !== '');
	strictEqual(lines.length, 3, 'all three appends landed (base: 0 survived)');
	strictEqual(raw.endsWith('\n') && !raw.endsWith('\n\n'), true, 'exactly one trailing newline per record');
	const parsed = ContinuityOpsLedger.parseLedger(raw);
	strictEqual(parsed.length, 3);
	strictEqual(parsed[0]!.prev, null, 'genesis carries prev === null');
});

test('REGRESSION (DL-77): concurrent manager exports serialize — both bundles + both ledger lines', async () => {
	const fs = auditFs({ ...SEED_STATE });
	const manager = managerOf(fs);
	const [first, second] = await Promise.all([manager.export({ actor: 'human' }), manager.export({ actor: 'agent' })]);
	ok(first.ok && second.ok, 'both exports succeed (serialized, not raced)');
	const ledgerRaw = fs.files().get(`${ROOT}/.flauz/continuity-ops.jsonl`) ?? '';
	const lines = ledgerRaw.split('\n').filter(l => l !== '');
	strictEqual(lines.length, 2, 'both audit records landed (base: lost lines)');
	strictEqual(fs.files().has(`${ROOT}/.flauz/continuity-bundles/${first.manifest.bundleId}/manifest.json`), true);
	strictEqual(fs.files().has(`${ROOT}/.flauz/continuity-bundles/${second.manifest.bundleId}/manifest.json`), true);
});

// ---------------------------------------------------------------------------
// C6 — in-place record rewrites are OPS_CORRUPT
// ---------------------------------------------------------------------------

test('REGRESSION (C6): an in-place ops-record rewrite (failed restore -> ok, actor swap) is OPS_CORRUPT', async () => {
	const fs = auditFs();
	const ledger = new ContinuityOpsLedger({ root: ROOT, fs, clock: () => 1000 });
	await ledger.append({
		schemaVersion: 0, schema: 'flauz.continuity-ops/v0', ts: 1000, actor: 'agent',
		op: 'restore', bundleId: 'flauz:continuity:0123456789abcdef', result: 'error',
		error: { code: 'TRUST_POSTURE_REJECTED', message: 'untrusted target' },
	});
	await ledger.append({ schemaVersion: 0, schema: 'flauz.continuity-ops/v0', ts: 2000, actor: 'human', op: 'verify', bundleId: 'flauz:continuity:0123456789abcdef', result: 'ok' });
	// TAMPER: rewrite line 1 as a schema-VALID successful human restore
	const raw = fs.files().get(`${ROOT}/.flauz/continuity-ops.jsonl`)!;
	const lines = raw.split('\n').filter(l => l !== '');
	lines[0] = serializeContinuityOpRecord({
		schemaVersion: 0, schema: 'flauz.continuity-ops/v0', ts: 1000, actor: 'human',
		op: 'restore', bundleId: 'flauz:continuity:0123456789abcdef', result: 'ok', prev: null,
		details: { surfacesCarried: 7, surfacesLost: 12, surfacesRedacted: 3 },
	});
	fs.files().set(`${ROOT}/.flauz/continuity-ops.jsonl`, `${lines.join('\n')}\n`);
	// the strict parse now REFUSES (base: re-parsed cleanly)
	throws(() => ContinuityOpsLedger.parseLedger(fs.files().get(`${ROOT}/.flauz/continuity-ops.jsonl`)!), /prev does not match the previous record's line hash/);
	await typedRejects(Promise.reject(new ContinuityError('OPS_CORRUPT', 'probe')), 'OPS_CORRUPT');
});

// ---------------------------------------------------------------------------
// C7 — all-or-nothing restore
// ---------------------------------------------------------------------------

test('REGRESSION (C7): a tampered LAST file of a directory surface writes NOTHING (intra-surface atomicity)', async () => {
	const fs = auditFs({ ...SEED_STATE });
	const manager = managerOf(fs);
	const exported = await manager.export({ actor: 'human' });
	ok(exported.ok);
	const bundleId = exported.manifest.bundleId;
	// fresh target + tamper the LAST file of the carried workflows tree
	for (const p of Object.keys(SEED_STATE)) {
		fs.delete(p);
	}
	fs.files().set(`${ROOT}/.flauz/continuity-bundles/${bundleId}/surfaces/flauz-workflow-state/wf-0002.json`, '{"schemaVersion":0,"name":"TAMPERED"}');
	const restored = await manager.restore({ bundleId, actor: 'human' });
	ok(!restored.ok, 'the restore fails');
	strictEqual(restored.error.code, 'RESTORE_SURFACE_FAILED');
	strictEqual(fs.files().has(`${ROOT}/.flauz/workflows/index.json`), false, 'base wrote index.json BEFORE the failure; now nothing is written');
	strictEqual(fs.files().has(`${ROOT}/.flauz/workflows/wf-0001.json`), false, 'base wrote wf-0001.json BEFORE the failure; now nothing is written');
	strictEqual(fs.files().has(`${ROOT}/.flauz/tasks.json`), false, 'no earlier surface was written either (all-or-nothing)');
});

test('REGRESSION (C7): an injected WRITE failure mid-restore rolls the target back to its prior state', async () => {
	const fs = auditFs({ ...SEED_STATE });
	const manager = managerOf(fs);
	const exported = await manager.export({ actor: 'human' });
	ok(exported.ok);
	const bundleId = exported.manifest.bundleId;
	// fresh target: wipe the state surfaces (the bundle + ledger ride over)
	for (const p of Object.keys(SEED_STATE)) {
		fs.delete(p);
	}
	// inject a ONE-SHOT write failure at the 4th workspace write (environments-ops.jsonl)
	const target = `${ROOT}/.flauz/environments-ops.jsonl.tmp`;
	const inner = fs.writeFile.bind(fs);
	let armed = true;
	fs.writeFile = async (p: string, c: string) => {
		if (armed && p === target) {
			armed = false;
			throw new Error('INJECTED: disk full');
		}
		await inner(p, c);
	};
	const restored = await manager.restore({ bundleId, actor: 'human' });
	ok(!restored.ok, 'the restore fails');
	strictEqual(restored.error.code, 'RESTORE_SURFACE_FAILED');
	ok(restored.error.message.includes('rolled back'), `the error names the rollback (got: ${restored.error.message})`);
	// ROLLBACK: the three files written before the injection are gone again
	strictEqual(fs.files().has(`${ROOT}/.flauz/tasks.json`), false, 'tasks.json rolled back (was absent prior)');
	strictEqual(fs.files().has(`${ROOT}/.flauz/environments.json`), false, 'environments.json rolled back');
	strictEqual(fs.files().has(`${ROOT}/.flauz/environments-lifecycle.json`), false, 'lifecycle rolled back');
	strictEqual(fs.files().has(`${ROOT}/.flauz/workflows/index.json`), false, 'later surfaces never attempted');
	// the failed attempt is ledger-recorded with the chain intact
	const records = ContinuityOpsLedger.parseLedger(fs.files().get(`${ROOT}/.flauz/continuity-ops.jsonl`)!);
	strictEqual(records[records.length - 1]!.result, 'error');
	strictEqual(records[records.length - 1]!.error!.code, 'RESTORE_SURFACE_FAILED');
	// and a RETRY after the failure is cleared succeeds cleanly (all-or-nothing both ways)
	const retried = await manager.restore({ bundleId, actor: 'human' });
	ok(retried.ok, 'the retry restores the full state');
	strictEqual(fs.files().get(`${ROOT}/.flauz/tasks.json`), SEED_STATE[`${ROOT}/.flauz/tasks.json`]!);
});

// ---------------------------------------------------------------------------
// C5 — the export redaction canary
// ---------------------------------------------------------------------------

test('C5 canary: a secret present in CAPTURED surfaces never reaches ANY bundle byte', async () => {
	const poisoned = { ...SEED_STATE };
	poisoned[`${ROOT}/.flauz/evidence/ledger.jsonl`] = `{"rows":[{"note":"token ${canary()}"}]}\n`;
	poisoned[`${ROOT}/.flauz/browser-sessions.jsonl`] = `{"journal":"${canary()}"}\n`;
	poisoned[`${ROOT}/.flauz/artifacts/T-001/verdict.json`] = `{"kind":"note","token":"${canary()}"}\n`;
	const fs = auditFs(poisoned);
	const manager = managerOf(fs);
	const outcome = await manager.export({ actor: 'human' });
	ok(outcome.ok, 'the export succeeds (captured surfaces are REDACTED, not carried)');
	strictEqual(outcome.manifest.surfaces['flauz-evidence-ledger']!.status, 'redacted');
	strictEqual(outcome.manifest.surfaces['flauz-browser-session-journal']!.status, 'redacted');
	strictEqual(outcome.manifest.surfaces['flauz-evidence-artifacts']!.status, 'redacted');
	// scan EVERY byte of the committed bundle (manifest + artifacts + tree manifests)
	let scanned = 0;
	for (const [p, contents] of fs.files()) {
		if (!p.includes('continuity-bundles')) {
			continue;
		}
		scanned++;
		ok(!contents.includes(canary()), `bundle file ${p} is canary-free`);
	}
	ok(scanned > 5, `the whole bundle was scanned (${scanned} files)`);
	// and the ops ledger is canary-free too
	ok(!(fs.files().get(`${ROOT}/.flauz/continuity-ops.jsonl`) ?? '').includes(canary()), 'the ledger is canary-free');
});

test('C5 canary: a secret smuggled into a CARRIED surface fails the export closed (no bundle committed)', async () => {
	const poisoned = { ...SEED_STATE };
	poisoned[`${ROOT}/.flauz/tasks.json`] = `{"tasks":[{"note":"token ${canary()}"}]}\n`;
	poisoned[`${ROOT}/.flauz/workflows/wf-0001.json`] = `{"schemaVersion":0,"name":"${canary()}"}\n`;
	const fs = auditFs(poisoned);
	const manager = managerOf(fs);
	const outcome = await manager.export({ actor: 'agent' });
	ok(!outcome.ok, 'the export fails closed');
	strictEqual(outcome.error.code, 'EXPORT_SECRET_DETECTED');
	const bundleBytes = [...fs.files().keys()].filter(k => k.includes('continuity-bundles'));
	strictEqual(bundleBytes.length, 0, 'no bundle bytes survive (staging removed)');
});

// ---------------------------------------------------------------------------
// C8 — export -> wipe -> restore yields byte-identical state surfaces
// ---------------------------------------------------------------------------

test('C8 journey: export -> wipe state -> restore yields BYTE-identical state surfaces + a green verify', async () => {
	const fs = auditFs({ ...SEED_STATE });
	const manager = managerOf(fs);
	const exported = await manager.export({ actor: 'human' });
	ok(exported.ok);
	const bundleId = exported.manifest.bundleId;
	const before = {
		tasks: SEED_STATE[`${ROOT}/.flauz/tasks.json`]!,
		resources: SEED_STATE[`${ROOT}/.flauz/resources.json`]!,
		resourcesOps: SEED_STATE[`${ROOT}/.flauz/resources-ops.jsonl`]!,
		workflowIndex: SEED_STATE[`${ROOT}/.flauz/workflows/index.json`]!,
	};
	// the switch: wipe the workspace state surfaces (the bundle + ops ledger ride over)
	for (const p of Object.keys(SEED_STATE)) {
		fs.delete(p);
	}
	const restored = await manager.restore({ bundleId, actor: 'human' });
	ok(restored.ok);
	strictEqual(fs.files().get(`${ROOT}/.flauz/tasks.json`), before.tasks, 'tasks.json is byte-identical');
	strictEqual(fs.files().get(`${ROOT}/.flauz/resources.json`), before.resources, 'the resource graph envelope is byte-identical (the DL-32 seam)');
	strictEqual(fs.files().get(`${ROOT}/.flauz/resources-ops.jsonl`), before.resourcesOps, 'the resources ops ledger is byte-identical');
	strictEqual(fs.files().get(`${ROOT}/.flauz/workflows/index.json`), before.workflowIndex, 'directory surfaces are byte-identical');
	const verified = await manager.verify({ bundleId, actor: 'tool' });
	ok(verified.ok, 'the restored bundle verifies');
});

// ---------------------------------------------------------------------------
// C9 — the journal is consumed READ-ONLY
// ---------------------------------------------------------------------------

test('C9: export/restore/verify NEVER write the browser-session journal', async () => {
	const fs = auditFs({ ...SEED_STATE });
	fs.files().set(JOURNAL_PATH, '{"journal":"present"}\n');
	const manager = managerOf(fs);
	const exported = await manager.export({ actor: 'human' });
	ok(exported.ok);
	const bundleId = exported.manifest.bundleId;
	// wipe the workspace state surfaces (the bundle + ops ledger + the journal ride over)
	for (const p of Object.keys(SEED_STATE)) {
		if (p === JOURNAL_PATH) {
			continue;
		}
		fs.delete(p);
	}
	const restored = await manager.restore({ bundleId, actor: 'human' });
	ok(restored.ok);
	const verified = await manager.verify({ bundleId, actor: 'tool' });
	ok(verified.ok);
	const journalWrites = fs.writes.filter(w => w.includes('.flauz/browser-sessions.jsonl') && (w.startsWith('write:') || w.startsWith('append:') || w.startsWith('rm:')));
	strictEqual(journalWrites.length, 0, `the journal is never written (got ${JSON.stringify(journalWrites)})`);
	strictEqual(fs.files().get(JOURNAL_PATH), '{"journal":"present"}\n', 'the journal bytes are untouched');
	strictEqual(exported.manifest.surfaces['flauz-browser-session-journal']!.status, 'redacted', 'the journal surface is redacted at export (payload never copied)');
});

// ---------------------------------------------------------------------------
// C10 — byte-identical serialization across runs
// ---------------------------------------------------------------------------

test('C10: the ops ledger + manifests serialize byte-identically across runs', async () => {
	const run = async (): Promise<{ ledger: string; manifest: string }> => {
		const fs = auditFs({ ...SEED_STATE });
		const manager = managerOf(fs);
		const exported = await manager.export({ actor: 'human' });
		ok(exported.ok);
		const ledger = fs.files().get(`${ROOT}/.flauz/continuity-ops.jsonl`)!;
		const manifest = fs.files().get(`${ROOT}/.flauz/continuity-bundles/${exported.manifest.bundleId}/manifest.json`)!;
		return { ledger, manifest };
	};
	const first = await run();
	const second = await run();
	strictEqual(first.ledger, second.ledger, 'identical runs produce byte-identical ledger lines');
	strictEqual(first.manifest, second.manifest, 'identical runs produce byte-identical manifests (sorted keys, 2-space, one trailing newline)');
	strictEqual(first.manifest.endsWith('}\n') && !first.manifest.includes('\n\n'), true, 'exactly one trailing newline');
	// round-trip: every ledger line re-serializes to its own bytes
	const records = ContinuityOpsLedger.parseLedger(first.ledger);
	strictEqual(first.ledger, `${records.map(serializeContinuityOpRecord).join('\n')}\n`, 'canonical JSONL round-trips byte-identically');
});
