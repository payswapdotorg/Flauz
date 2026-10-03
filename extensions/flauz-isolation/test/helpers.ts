/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Shared fixture boot for the flauz-isolation suite (A-PROD-005-W3).
 *
 * EVIDENCE LEVEL -- local-real: the fixture products are REAL trees (real
 * `extensions/<name>/package.json` manifests, a real parity registry, a
 * real SBOM body); the fixture workspaces carry REAL `.flauz/` trees
 * (records with the REAL owning schema ids -- imported from the owning
 * modules at test time, the sanctioned contract-pin pattern -- and
 * evidence-ledger rows written through THIS extension's real banking
 * writer); the planted violations are real trees walked by the real
 * boundary scan. Never claim runtime-real for multi-tenant host isolation
 * (the workspace is the isolatable unit this product owns -- the disclosed
 * boundary).
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as nodeCrypto from 'node:crypto';

import type { IsolationFsPort } from '../src/api.ts';
import { joinPath } from '../src/api.ts';
import { LAW_SURFACES } from '../src/law.ts';
import { bankLedgerRowFor } from '../src/banking.ts';

// the REAL owning schema ids the fixture bodies carry (test-time
// cross-extension imports -- the sanctioned pin pattern; src never crosses)
import { LEDGER_SCHEMA_ID as INTEGRITY_LEDGER_SCHEMA_ID, VERIFY_SCHEMA_ID as INTEGRITY_VERIFY_SCHEMA_ID, KEY_STORE_SCHEMA_ID as INTEGRITY_KEY_STORE_SCHEMA_ID } from '../../flauz-integrity/src/api.ts';
import { TELEMETRY_CONFIG_SCHEMA_ID } from '../../flauz-telemetry/src/api.ts';
import { CENSUS_RECORD_SCHEMA_ID, MATRIX_SCHEMA_ID, GATE_RECORD_SCHEMA_ID } from '../../flauz-production/src/api.ts';
import { VERIFY_RECORD_SCHEMA_ID as RELEASE_VERIFY_SCHEMA_ID, CHECKLIST_SCHEMA_ID as RELEASE_CHECKLIST_SCHEMA_ID } from '../../flauz-release/src/api.ts';
import { PLAN_SCHEMA_ID as MIGRATION_PLAN_SCHEMA_ID } from '../../flauz-migration/src/api.ts';
import { MANIFEST_SCHEMA_ID as BACKUP_MANIFEST_SCHEMA_ID } from '../../flauz-backup/src/api.ts';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');

/** The real repo root (the contract suite's local-real subject). */
export const repoRoot = REPO_ROOT;

/** Deterministic but distinguishable timestamps (advances 1000 per call). */
export function steppingClock(start = 1_740_100_000_000): () => number {
	let current = start;
	return () => {
		const value = current;
		current += 1000;
		return value;
	};
}

/** The flauz-isolation IsolationFsPort over node:fs (the extension-host wiring, mirrored in the test lane). */
export function nodeIsolationFs(): IsolationFsPort {
	return {
		readFileUtf8: async target => {
			try {
				return await fs.readFile(target, { encoding: 'utf-8' });
			} catch (err) {
				if ((err as { code?: string }).code === 'ENOENT') {
					return undefined;
				}
				throw err;
			}
		},
		readdir: async target => {
			try {
				return await fs.readdir(target);
			} catch (err) {
				const code = (err as { code?: string }).code;
				if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EACCES' || code === 'EPERM') {
					return undefined;
				}
				throw err;
			}
		},
		readlink: async target => {
			try {
				return await fs.readlink(target);
			} catch (err) {
				const code = (err as { code?: string }).code;
				if (code === 'ENOENT' || code === 'EINVAL' || code === 'EACCES' || code === 'EPERM') {
					return undefined;
				}
				throw err;
			}
		},
		mkdir: target => fs.mkdir(target, { recursive: true }),
		writeFile: (target, contents) => fs.writeFile(target, contents, { encoding: 'utf-8' }),
		appendFile: (target, contents) => fs.appendFile(target, contents, { encoding: 'utf-8' }),
	};
}

/**
 * The write-refusing fs port (the read-only law's proof vehicle): every
 * write surface throws; the read surface delegates to the real port. A
 * command that completes against this port has provably written nothing.
 */
export function writeRefusingFs(base: IsolationFsPort): IsolationFsPort {
	const refuse = async (): Promise<never> => {
		throw new Error('flauz-isolation/test: WRITE REFUSED (the read-only law: this command must not write)');
	};
	return {
		readFileUtf8: base.readFileUtf8,
		readdir: base.readdir,
		readlink: base.readlink,
		mkdir: () => refuse(),
		writeFile: () => refuse(),
		appendFile: () => refuse(),
	};
}

// ---------------------------------------------------------------------------
// The fixture registry product (real manifests + parity registry + SBOM)
// ---------------------------------------------------------------------------

/** The extension set the fixture registry carries: the real 17 + this wave's own (the branch tree's 18). */
export const FIXTURE_EXTENSION_NAMES: readonly string[] = [
	'flauz-agent',
	'flauz-backup',
	'flauz-browser',
	'flauz-diagnostics',
	'flauz-environments',
	'flauz-execution',
	'flauz-integrity',
	'flauz-isolation',
	'flauz-lab',
	'flauz-memory',
	'flauz-migration',
	'flauz-models',
	'flauz-production',
	'flauz-release',
	'flauz-resources',
	'flauz-telemetry',
	'flauz-workflow',
	'flauz-workspace',
];

/** The injectable growth of a fixture registry (the UNKNOWN-extension fixture). */
export interface FixtureProductOptions {
	/** A registry-grown extension the isolation law does not know (the UNKNOWN disclosure fixture). */
	readonly extraExtensions?: readonly string[];
	/** Omit the parity registry (the no-product-state refusal fixture). */
	readonly noParity?: boolean;
	/** Omit the SBOM (the registry summary's honest absent shape). */
	readonly noSbom?: boolean;
}

/** One real-shaped extension manifest for the fixture registry. */
function fixtureManifest(name: string): Record<string, unknown> {
	const short = name.replace(/^flauz-/, '');
	return {
		name,
		displayName: `Fixture ${name}`,
		description: `the ${name} fixture extension (isolation test lane)`,
		version: '0.1.0',
		publisher: 'flauz',
		license: 'MIT',
		type: 'module',
		engines: { vscode: '^1.140.0' },
		categories: ['Other'],
		activationEvents: [`onCommand:flauz.${short}.thing`],
		main: './dist/extension.js',
		contributes: { commands: [{ command: `flauz.${short}.thing`, title: `Fixture ${short} Thing`, category: 'Flauz' }] },
	};
}

/**
 * Boots a fixture repo-state product into `root` (real manifests + a real
 * parity registry body + a real SBOM body; the extension set is the real
 * 18-extension registry shape).
 */
export async function plantFixtureProduct(root: string, options: FixtureProductOptions = {}): Promise<void> {
	const names = [...FIXTURE_EXTENSION_NAMES, ...(options.extraExtensions ?? [])].sort();
	for (const name of names) {
		await fs.mkdir(path.join(root, 'extensions', name, 'src'), { recursive: true });
		await fs.writeFile(path.join(root, 'extensions', name, 'package.json'), `${JSON.stringify(fixtureManifest(name), null, 2)}\n`, 'utf-8');
		await fs.writeFile(path.join(root, 'extensions', name, 'src', 'api.ts'), 'export const fixture = 1;\n', 'utf-8');
	}
	if (options.noParity !== true) {
		const rows = names.map(name => ({ surface: `extensions/${name}`, capability: 'extension packaging posture', class: 'web-blocked' }));
		await fs.mkdir(path.join(root, 'build', 'flauz'), { recursive: true });
		await fs.writeFile(path.join(root, 'build', 'flauz', 'packaging-parity.json'), `${JSON.stringify({ version: 1, description: 'fixture parity registry (flauz-isolation test lane)', rows }, null, 2)}\n`, 'utf-8');
	}
	if (options.noSbom !== true) {
		const components = names.map(name => ({
			type: 'library',
			'bom-ref': `pkg:generic/flauz/${name}@0.1.0`,
			name,
			version: '0.1.0',
			purl: `pkg:generic/flauz/${name}@0.1.0`,
			properties: [
				{ name: 'flauz:component-kind', value: 'flauz-extension' },
				{ name: 'flauz:artifact', value: `extensions/${name}/dist/` },
			],
		}));
		await fs.mkdir(path.join(root, 'build', 'flauz', 'security'), { recursive: true });
		await fs.writeFile(path.join(root, 'build', 'flauz', 'security', 'flauz-sbom.json'), `${JSON.stringify({ bomFormat: 'CycloneDX', specVersion: '1.5', version: 1, components, dependencies: [] }, null, 2)}\n`, 'utf-8');
	}
}

// ---------------------------------------------------------------------------
// The fixture workspace (a real .flauz/ tree at the law table's own paths)
// ---------------------------------------------------------------------------

/** The injectable durable state of a fixture workspace. */
export interface FixtureWorkspaceOptions {
	/** Plant a well-formed evidence ledger + watermark (rows through the REAL banking writer). */
	readonly withEvidence?: boolean;
	readonly withTelemetry?: boolean;
	readonly withMemory?: boolean;
	readonly withMigration?: boolean;
	readonly withIntegrity?: boolean;
	readonly withProduction?: boolean;
	readonly withRelease?: boolean;
	/** Plant a real export shape: `.flauz-exports/export-<stamp>/state/` + the manifest. */
	readonly withExport?: boolean;
	/** Plant a real support-bundle shape: `.flauz/support-bundle-<stamp>/`. */
	readonly withBundle?: boolean;
}

/** The law table's paths for one surface id (the fixture plants at the LAW's own paths). */
export function lawPathsOf(surfaceId: string): readonly string[] {
	const surface = LAW_SURFACES.find(candidate => candidate.id === surfaceId);
	if (surface === undefined) {
		throw new Error(`flauz-isolation/test: no law surface '${surfaceId}'`);
	}
	return [...surface.files, ...surface.dirs];
}

/** The filename stamp of the export-stamp convention (the real owning shape). */
export function fixtureStamp(epochMs: number): string {
	return new Date(epochMs).toISOString().replaceAll(':', '');
}

/** Writes a minimal real-shaped record body carrying the owning $schema id. */
async function plantRecord(root: string, rel: string, schemaId: string, extra: Record<string, unknown> = {}): Promise<void> {
	await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
	await fs.writeFile(path.join(root, rel), `${JSON.stringify({ $schema: schemaId, schemaVersion: 0, createdAt: 1_740_000_000_000, ...extra }, null, 2)}\n`, 'utf-8');
}

/**
 * Plants the evidence surface the local-real way: ONE hand-written seed row
 * in the owning shape (taskId 'flauz-workspace', the owning writer's own
 * provenance) + the remaining rows through THIS extension's REAL banking
 * writer + a well-formed watermark in the owning shape (so the banking
 * writer's resync path is genuinely exercised over the fixture tree).
 */
export async function plantEvidenceRows(root: string, count: number, clock: () => number): Promise<void> {
	if (count < 1) {
		return;
	}
	const seed = { seq: 1, ts: 1_740_000_000_000, taskId: 'flauz-workspace', kind: 'note', uri: '.flauz/tasks.json', sha256: 'a'.repeat(64), prev: null };
	await fs.mkdir(path.join(root, '.flauz', 'evidence'), { recursive: true });
	await fs.writeFile(path.join(root, '.flauz', 'evidence', 'ledger.jsonl'), `${JSON.stringify(seed)}
`, 'utf-8');
	await fs.writeFile(path.join(root, '.flauz', 'evidence', 'size.json'), `${JSON.stringify({ $schema: 'flauz.evidence.size/v1', rowCount: 1, bytes: Buffer.byteLength(`${JSON.stringify(seed)}
`), headSha256: 'b'.repeat(64), lastCheckpointSeq: null, updatedAt: 1_740_000_000_000 }, null, 2)}
`, 'utf-8');
	const port = nodeIsolationFs();
	for (let index = 1; index < count; index += 1) {
		await bankLedgerRowFor({ root, fs: port, clock }, `{"fixture":"${String(index)}"}`, `.flauz/fixtures/row-${String(index)}.json`);
	}
}

/**
 * Boots a minimal-but-real fixture workspace: durable-state surfaces at the
 * LAW TABLE's own paths, records carrying the REAL owning schema ids,
 * evidence rows through the REAL banking writer.
 */
export async function plantFixtureWorkspace(root: string, options: FixtureWorkspaceOptions = {}, clock: () => number = steppingClock()): Promise<void> {
	if (options.withEvidence === true) {
		await plantEvidenceRows(root, 2, clock);
	}
	if (options.withTelemetry === true) {
		await plantRecord(root, '.flauz/telemetry/config.json', TELEMETRY_CONFIG_SCHEMA_ID);
		await fs.mkdir(path.join(root, '.flauz', 'telemetry'), { recursive: true });
		await fs.writeFile(path.join(root, '.flauz', 'telemetry', 'ledger.jsonl'), `${JSON.stringify({ schemaVersion: 1, eventId: 'fixture.event', ts: 1_740_000_000_000 })}\n`, 'utf-8');
	}
	if (options.withMemory === true) {
		await fs.mkdir(path.join(root, '.flauz', 'memory', 'tasks'), { recursive: true });
		await fs.writeFile(path.join(root, '.flauz', 'memory', 'index.json'), `${JSON.stringify({ schemaVersion: 0, tiers: [] }, null, 2)}\n`, 'utf-8');
		await fs.writeFile(path.join(root, '.flauz', 'watermarks.json'), `${JSON.stringify({ schemaVersion: 0, envelopes: [] }, null, 2)}\n`, 'utf-8');
	}
	if (options.withMigration === true) {
		await plantRecord(root, '.flauz/migration/plan.json', MIGRATION_PLAN_SCHEMA_ID);
	}
	if (options.withIntegrity === true) {
		const stamp = fixtureStamp(1_740_000_000_000);
		await plantRecord(root, `.flauz/integrity/ledger-${stamp}.json`, INTEGRITY_LEDGER_SCHEMA_ID);
		await plantRecord(root, `.flauz/integrity/verify-${stamp}.json`, INTEGRITY_VERIFY_SCHEMA_ID);
		// the port-owned key store: the REAL owning shape (public + private hex + fingerprint)
		const { publicKey, privateKey } = nodeCrypto.generateKeyPairSync('ed25519');
		const spki = publicKey.export({ type: 'spki', format: 'der' });
		const pkcs8 = privateKey.export({ type: 'pkcs8', format: 'der' });
		const publicKeyHex = Buffer.from(spki.subarray(spki.length - 32)).toString('hex');
		const privateKeyHex = Buffer.from(pkcs8.subarray(pkcs8.length - 32)).toString('hex');
		const fingerprint = nodeCrypto.createHash('sha256').update(Buffer.from(publicKeyHex, 'hex')).digest('hex');
		await plantRecord(root, '.flauz/integrity/keys/ed25519-local-dev.json', INTEGRITY_KEY_STORE_SCHEMA_ID, { algorithm: 'ed25519', keyPosture: 'local-dev', publicKeyHex, privateKeyHex, fingerprint, createdAt: 1_740_000_000_000 });
	}
	if (options.withProduction === true) {
		const stamp = fixtureStamp(1_740_000_000_000);
		await plantRecord(root, `.flauz/production/census-${stamp}.json`, CENSUS_RECORD_SCHEMA_ID);
		await plantRecord(root, `.flauz/production/matrix-${stamp}.json`, MATRIX_SCHEMA_ID);
		await plantRecord(root, `.flauz/production/gate-${stamp}.json`, GATE_RECORD_SCHEMA_ID);
	}
	if (options.withRelease === true) {
		const stamp = fixtureStamp(1_740_000_000_000);
		await plantRecord(root, `.flauz/release/verify-${stamp}.json`, RELEASE_VERIFY_SCHEMA_ID);
		await plantRecord(root, `.flauz/release/checklist-${stamp}.json`, RELEASE_CHECKLIST_SCHEMA_ID);
	}
	if (options.withExport === true) {
		const stamp = fixtureStamp(1_740_000_000_000);
		const exportDir = path.join(root, '.flauz-exports', `export-${stamp}`);
		await fs.mkdir(path.join(exportDir, 'state', 'evidence'), { recursive: true });
		await fs.writeFile(path.join(exportDir, 'state', 'evidence', 'ledger.jsonl'), `${JSON.stringify({ seq: 1, ts: 1_740_000_000_000, taskId: 'flauz-workspace', kind: 'note', uri: '.flauz/tasks.json', sha256: 'a'.repeat(64), prev: null })}\n`, 'utf-8');
		await fs.writeFile(path.join(exportDir, 'manifest.json'), `${JSON.stringify({ $schema: BACKUP_MANIFEST_SCHEMA_ID, createdAt: 1_740_000_000_000 }, null, 2)}\n`, 'utf-8');
	}
	if (options.withBundle === true) {
		const stamp = fixtureStamp(1_740_000_000_000);
		await fs.mkdir(path.join(root, '.flauz', `support-bundle-${stamp}`), { recursive: true });
		await fs.writeFile(path.join(root, '.flauz', `support-bundle-${stamp}`, 'diagnostics.json'), `${JSON.stringify({ $schema: 'flauz.diagnostics/v0', schemaVersion: 0 }, null, 2)}\n`, 'utf-8');
	}
}

// ---------------------------------------------------------------------------
// The planted violations (real trees the boundary scan walks)
// ---------------------------------------------------------------------------

/** Plants a NESTED `.flauz/` tree (the cross-workspace state bleed fixture). */
export async function plantNestedFlauzTree(root: string, rel = 'vendored/other-workspace'): Promise<string> {
	const nested = path.join(root, rel, '.flauz');
	await fs.mkdir(path.join(nested, 'evidence'), { recursive: true });
	await fs.writeFile(path.join(nested, 'evidence', 'ledger.jsonl'), `${JSON.stringify({ seq: 1, ts: 1_740_000_000_000, taskId: 'flauz-workspace', kind: 'note', uri: '.flauz/tasks.json', sha256: 'a'.repeat(64), prev: null })}\n`, 'utf-8');
	return joinPath(rel, '.flauz');
}

/** Plants a stamp-shaped stray record OUTSIDE the boundary (the copied-artifact fixture). */
export async function plantStrayRecord(root: string, rel = 'docs/notes'): Promise<string> {
	const stamp = fixtureStamp(1_740_000_000_000);
	const target = path.join(root, rel, `ledger-${stamp}.json`);
	await fs.mkdir(path.dirname(target), { recursive: true });
	await fs.writeFile(target, `${JSON.stringify({ $schema: INTEGRITY_LEDGER_SCHEMA_ID, schemaVersion: 0 }, null, 2)}\n`, 'utf-8');
	return joinPath(rel, `ledger-${stamp}.json`);
}

/** Plants an export-shaped directory OUTSIDE the exports dir (the export-banked-outside fixture). */
export async function plantStrayExport(root: string, rel = 'backups'): Promise<string> {
	const stamp = fixtureStamp(1_740_000_000_000);
	const dir = path.join(root, rel, `export-${stamp}`);
	await fs.mkdir(path.join(dir, 'state'), { recursive: true });
	return joinPath(rel, `export-${stamp}`);
}

/** Plants an export-shaped directory INSIDE `.flauz/` (the anti-recursion fixture). */
export async function plantExportInsideFlauz(root: string): Promise<string> {
	const stamp = fixtureStamp(1_740_000_000_000);
	await fs.mkdir(path.join(root, '.flauz', `export-${stamp}`, 'state'), { recursive: true });
	return `.flauz/export-${stamp}`;
}

/** Plants a bundle-shaped directory OUTSIDE `.flauz/` (the bundle-outside-boundary fixture). */
export async function plantStrayBundle(root: string, rel = 'shared'): Promise<string> {
	const stamp = fixtureStamp(1_740_000_000_000);
	await fs.mkdir(path.join(root, rel, `support-bundle-${stamp}`), { recursive: true });
	return joinPath(rel, `support-bundle-${stamp}`);
}

/** Plants a symlink OUTSIDE the boundary whose target resolves INSIDE `.flauz/` (the link-leak fixture; the target is LINK-RELATIVE, as stored). */
export async function plantSymlinkIntoBoundary(root: string, linkRel = 'repo/leaked-ledger.jsonl', targetRel = '.flauz/evidence/ledger.jsonl'): Promise<string> {
	await fs.mkdir(path.dirname(path.join(root, linkRel)), { recursive: true });
	await fs.mkdir(path.dirname(path.join(root, targetRel)), { recursive: true });
	await fs.writeFile(path.join(root, targetRel), `${JSON.stringify({ seq: 1, ts: 1_740_000_000_000, taskId: 'flauz-workspace', kind: 'note', uri: '.flauz/tasks.json', sha256: 'a'.repeat(64), prev: null })}\n`, 'utf-8');
	// a RELATIVE symlink target resolves against the LINK'S directory: compute
	// the link-relative hop that resolves to <root>/<targetRel>
	const linkDir = path.dirname(path.join(root, linkRel));
	const relativeTarget = path.relative(linkDir, path.join(root, targetRel));
	await fs.symlink(relativeTarget, path.join(root, linkRel));
	return linkRel;
}

/** Plants an ABSOLUTE-target symlink into the boundary (the absolute-target leak fixture). */
export async function plantAbsoluteSymlinkIntoBoundary(root: string, linkRel = 'repo/leaked-absolute.jsonl'): Promise<string> {
	await fs.mkdir(path.dirname(path.join(root, linkRel)), { recursive: true });
	await fs.symlink(path.join(root, '.flauz', 'evidence', 'ledger.jsonl'), path.join(root, linkRel));
	return linkRel;
}

/** Plants a symlink whose target is OUTSIDE the workspace (never a boundary leak). */
export async function plantOutsideSymlink(root: string, linkRel = 'repo/os-link.jsonl'): Promise<string> {
	await fs.mkdir(path.dirname(path.join(root, linkRel)), { recursive: true });
	await fs.symlink('/etc/hostname', path.join(root, linkRel));
	return linkRel;
}

/** Appends an ANONYMOUS banked row (no taskId) to the evidence ledger (the taskId-law violation fixture). */
export async function plantAnonymousLedgerRow(root: string): Promise<number> {
	const ledgerPath = path.join(root, '.flauz', 'evidence', 'ledger.jsonl');
	await fs.mkdir(path.dirname(ledgerPath), { recursive: true });
	const existing = await fs.readFile(ledgerPath, 'utf-8').catch(() => '');
	const lines = existing.split('\n').filter(line => line !== '');
	lines.push(JSON.stringify({ seq: lines.length + 1, ts: 1_740_000_000_000, kind: 'note', uri: '.flauz/somewhere', sha256: 'b'.repeat(64), prev: null }));
	await fs.writeFile(ledgerPath, `${lines.join('\n')}\n`, 'utf-8');
	return lines.length;
}

/** Appends a TORN (unparseable) line to the evidence ledger (the unknown-degradation fixture). */
export async function plantTornLedgerLine(root: string): Promise<number> {
	const ledgerPath = path.join(root, '.flauz', 'evidence', 'ledger.jsonl');
	await fs.mkdir(path.dirname(ledgerPath), { recursive: true });
	const existing = await fs.readFile(ledgerPath, 'utf-8').catch(() => '');
	const lines = existing.split('\n').filter(line => line !== '');
	lines.push('{ not a ledger row at all');
	await fs.writeFile(ledgerPath, `${lines.join('\n')}\n`, 'utf-8');
	return lines.length;
}

/** Plants an unclaimed `.flauz/` top-level entry (the UNKNOWN-surface fixture). */
export async function plantUnclaimedFlauzEntry(root: string, name = 'newplane'): Promise<string> {
	await fs.mkdir(path.join(root, '.flauz', name), { recursive: true });
	await fs.writeFile(path.join(root, '.flauz', name, 'state.json'), '{}\n', 'utf-8');
	return `.flauz/${name}`;
}

/** Plants a plain FILE where the exports dir belongs (the unknown export-dir fixture). */
export async function plantExportsDirAsFile(root: string): Promise<void> {
	await fs.writeFile(path.join(root, '.flauz-exports'), 'not a directory\n', 'utf-8');
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Reads every file under a directory (recursive) as { path, text } -- the canary byte-scan vehicle. */
export async function readAllFiles(dir: string, skip?: (absPath: string) => boolean): Promise<{ path: string; text: string }[]> {
	const out: { path: string; text: string }[] = [];
	let entries;
	try {
		entries = await fs.readdir(dir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const entry of entries) {
		const target = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...await readAllFiles(target, skip));
		} else if (entry.isFile() && (skip === undefined || !skip(target))) {
			out.push({ path: target, text: await fs.readFile(target, 'utf-8') });
		}
	}
	return out;
}

/** Assembles a canary-shaped token from fragments at runtime (the no-literal law; never a complete secret in source). */
export function canaryToken(kind: 'github' | 'openai' | 'aws' | 'bearer' | 'pem'): string {
	switch (kind) {
		case 'github': return `ghp_${'Frag'.repeat(10)}Xmp1`; // 20+ chars, ghp_ prefix
		case 'openai': return `sk-ant-${'frag'.repeat(8)}Zq2`; // sk-ant- prefix, 16+ chars
		case 'aws': return `AKIA${'QWER'.repeat(4)}`; // AKIA + exactly 16 chars (the pattern's word boundary)
		case 'bearer': return `Bearer ${'tok'.repeat(10)}AbCd`; // Bearer + 16+ chars
		case 'pem': return ['-----BEGIN', 'RSA', 'PRIVATE', 'KEY-----'].join(' '); // the PEM marker shape (assembled, never literal)
	}
}

/** node:crypto sha256 hex over bytes (the independent re-derivation the assertions pin against). */
export function nodeSha256Hex(bytes: Uint8Array): string {
	return nodeCrypto.createHash('sha256').update(bytes).digest('hex');
}

/** A fresh temp root (the fixture vehicle). */
export async function tempRoot(prefix = 'flauz-iso-'): Promise<{ root: string; cleanup: () => Promise<void> }> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
	return { root, cleanup: async () => { await fs.rm(root, { recursive: true, force: true }); } };
}
