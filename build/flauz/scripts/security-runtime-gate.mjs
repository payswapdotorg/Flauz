/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// ---------------------------------------------------------------------------------------------
// Flauz TL4 (product-quality lane) -- task TL4-009.
//
// security-runtime-gate.mjs -- the RUNTIME rung of the Flauz security gate.
//
// Mission: the TL4-006 gate (security-gate.mjs -- FROZEN, never rewritten)
// owns the fixture/static rung. This sibling gate owns the documented runtime
// rung (spec: docs/FLAUZ-PROGRAM/TL4-SECURITY-GATE.md section 7): post-install
// supply-chain audit, SBOM emission, and bundle-signature verification
// against PINNED manifests. Rows are ADDITIVE -- the frozen gate keeps its
// own row catalogue untouched.
//
// Rows:
//
//   1. audit-delta      -- post-install supply-chain audit: npm audit --json
//                          over the installed root tree, filtered to the
//                          FLAUZ-ADDED dependency delta (deps/devDeps present
//                          in the product root package.json but absent in
//                          upstream/main's -- computed via git plumbing, the
//                          sync-upstream.mjs ref chain upstream/main ->
//                          origin/upstream/main). Exit 1 on any HIGH/CRITICAL
//                          advisory inside the delta; advisories outside the
//                          delta are reported, never verdicts. SKIPs when no
//                          installed tree exists (worker sandbox / pre-install
//                          lane); --require promotes SKIP to FAIL. Adjudicated
//                          exceptions live in build/flauz/security/
//                          audit-allowlist.json (born EMPTY; unused-entry
//                          hygiene mirrors the secrets-allowlist precedent).
//   2. sbom             -- CycloneDX 1.5 JSON SBOM for the Flauz artifact set
//                          (every extensions/flauz-* package.json manifest +
//                          the flauz-added root dependency delta, versions
//                          resolved from the committed package-lock.json
//                          where readable, zero-dep). Hand-rolled emission
//                          (no cyclonedx npm package -- worker sandboxes
//                          never install); deterministic by construction
//                          (content-derived serial number, no wall-clock
//                          fields) so the emitted document is byte-stable
//                          across machines. Self-check: parse-back + required
//                          fields + extension coverage. Default posture
//                          VERIFIES the committed build/flauz/security/
//                          flauz-sbom.json (ANY drift = FAIL, the pinning
//                          law); --sbom-out <path> switches to emit posture
//                          (regeneration is PR-reviewed diff-by-diff).
//   3. bundle-manifest  -- pinned sha256 manifest of the reproducible flauz
//                          extension bundles (build/flauz/security/
//                          bundle-manifest.json). Default VERIFY mode:
//                          re-bundle now (the repo's own bundler + esbuild --
//                          the EXACT mechanism of the frozen gate's packaging
//                          row), hash every dist artifact, compare against
//                          the pinned manifest; ANY drift = exit 1
//                          (supply-chain tamper signal). --generate writes
//                          the manifest from a fresh double-bundle run (the
//                          station action; the diff is reviewed
//                          extension-by-extension in the PR). SKIPs when
//                          esbuild is unresolvable (packaging-row SKIP
//                          semantics); --require promotes.
//
// Usage:
//   node security-runtime-gate.mjs [--root <repo>] [--row <audit|sbom|manifest>]
//                                  [--generate] [--sbom-out <path>] [--manifest <file>]
//                                  [--audit-json <file>] [--audit-allowlist <file>]
//                                  [--package-json <file>] [--upstream-package-json <file>]
//                                  [--extensions-root <dir>] [--verify-sbom <file>]
//                                  [--json] [--out <path>] [--require] [--no-fail] [--list]
//
//   --root <dir>        repository root (default: the repo containing this
//                       script).
//   --row <id>          run ONE row (audit | sbom | manifest); the other rows
//                       SKIP with a row-filter reason. REQUIRED by the
//                       fixture-override flags below (they point rows at
//                       synthetic inputs; mixing them into a full repo run is
//                       never intended).
//   --generate          [manifest row] write the pinned manifest from a fresh
//                       double-bundle run (station action). With
//                       --extensions-root: fixture generation (hash the given
//                       synthetic tree as-is, no bundling; requires an
//                       explicit --manifest).
//   --sbom-out <path>   [sbom row] emit posture: write the SBOM document
//                       (default posture verifies the committed artifact).
//   --manifest <file>   bundle-manifest path override (with --row manifest or
//                       --generate only; fixture verification/generation
//                       always passes an explicit path).
//   --audit-json <file> [audit row] a captured npm audit --json document
//                       (fixture mode: no npm spawn, no network).
//   --audit-allowlist <file>  audit allowlist override (default
//                       build/flauz/security/audit-allowlist.json).
//   --package-json <file>     product root package.json override (fixture;
//                       must pair with --upstream-package-json).
//   --upstream-package-json <file>  upstream package.json override (default:
//                       git show <ref>:package.json over the ref chain
//                       upstream/main -> origin/upstream/main).
//   --extensions-root <dir>   extensions tree override (fixture; default
//                       <root>/extensions).
//   --verify-sbom <file>      [sbom row] verify THIS SBOM document (structure
//                       + extension coverage + drift vs the fresh emission).
//   --json              machine-readable verdict document (stdout).
//   --out <path>        write the verdict document to <path>.
//   --require           evidence mode: SKIP rows FAIL the gate.
//   --no-fail           report only.
//   --list              print the row catalogue + policies.
//
// Audit scope decision (documented): npm audit --json over the FULL tree
// (production + dev) -- flauz-added devDependencies are product supply chain
// too (they execute in CI) -- with verdicts scoped to the flauz-added delta.
// The delta is name-level: a dep present in the product root package.json
// but absent in upstream/main's; version-range changes of upstream-shared
// deps stay upstream's posture, not flauz-added surface.
//
// Exit codes: 0 = all rows green (or SKIP without --require) * 1 = FAIL *
// 2 = usage error.
// ---------------------------------------------------------------------------------------------

'use strict';

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import process from 'node:process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..');

/** The preserved Code OSS reference line (same chain as sync-upstream.mjs). */
const UPSTREAM_REF_CHAIN = ['upstream/main', 'origin/upstream/main'];

/** The dependency sections that define the flauz-added delta (documented scope). */
const DEPENDENCY_SECTIONS = ['dependencies', 'devDependencies'];

const SEVERITY_RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };

const COMMITTED_SBOM_REL = path.join('build', 'flauz', 'security', 'flauz-sbom.json');
const COMMITTED_MANIFEST_REL = path.join('build', 'flauz', 'security', 'bundle-manifest.json');
const DEFAULT_AUDIT_ALLOWLIST_REL = path.join('build', 'flauz', 'security', 'audit-allowlist.json');

const GATE_ID = 'security-runtime-gate';
const GATE_VERSION = '1.0.0';
const GENERATION_COMMAND = 'node build/flauz/scripts/security-runtime-gate.mjs --root . --generate';

const MANIFEST_SCHEMA = 'flauz.bundle-manifest/v1';
const PINNED_NOTES = 'Pinned by --generate from a fresh double-bundle run (byte-identical passes). VERIFY mode re-bundles on every CI run and exits 1 on ANY drift (supply-chain tamper signal). Regeneration is PR-reviewed diff-by-diff; any PR that changes bundle bytes regenerates this manifest in the same PR.';

const ROW_AUDIT = 'audit-delta';
const ROW_SBOM = 'sbom';
const ROW_MANIFEST = 'bundle-manifest';

// ---------------------------------------------------------------------------------------------
// args / usage
// ---------------------------------------------------------------------------------------------

function printUsage() {
	console.log([
		'usage: node security-runtime-gate.mjs [--root <repo>] [--row <audit|sbom|manifest>]',
		'                                      [--generate] [--sbom-out <path>] [--manifest <file>]',
		'                                      [--audit-json <file>] [--audit-allowlist <file>]',
		'                                      [--package-json <file>] [--upstream-package-json <file>]',
		'                                      [--extensions-root <dir>] [--verify-sbom <file>]',
		'                                      [--json] [--out <path>] [--require] [--no-fail] [--list]',
		'',
		'The runtime rung of the Flauz security gate (TL4-009; the TL4-006 security-gate.mjs',
		'stays frozen). Rows: audit-delta (npm audit filtered to the flauz-added dependency',
		'delta), sbom (CycloneDX 1.5 SBOM for the flauz artifact set, pinned + drift-checked),',
		'bundle-manifest (pinned sha256 of the reproducible extension bundles).',
		'Exit codes: 0 pass/SKIP * 1 FAIL (or SKIP under --require) * 2 usage.',
	].join('\n'));
}

function usageError(message) {
	printUsage();
	console.error(`${GATE_ID}: usage error: ${message}`);
	process.exit(2);
}

function requireValue(argv, index, flag) {
	const value = argv[index];
	if (value === undefined || value.startsWith('--')) {
		usageError(`${flag} requires a value`);
	}
	return value;
}

function parseArgs(argv) {
	const options = { root: DEFAULT_ROOT, row: undefined, generate: false, sbomOut: undefined, manifest: undefined, auditJson: undefined, auditAllowlist: undefined, packageJson: undefined, upstreamPackageJson: undefined, extensionsRoot: undefined, verifySbom: undefined, json: false, out: undefined, require: false, noFail: false, list: false };
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		switch (arg) {
			case '--root': options.root = requireValue(argv, ++i, arg); break;
			case '--row': options.row = requireValue(argv, ++i, arg); break;
			case '--generate': options.generate = true; break;
			case '--sbom-out': options.sbomOut = requireValue(argv, ++i, arg); break;
			case '--manifest': options.manifest = requireValue(argv, ++i, arg); break;
			case '--audit-json': options.auditJson = requireValue(argv, ++i, arg); break;
			case '--audit-allowlist': options.auditAllowlist = requireValue(argv, ++i, arg); break;
			case '--package-json': options.packageJson = requireValue(argv, ++i, arg); break;
			case '--upstream-package-json': options.upstreamPackageJson = requireValue(argv, ++i, arg); break;
			case '--extensions-root': options.extensionsRoot = requireValue(argv, ++i, arg); break;
			case '--verify-sbom': options.verifySbom = requireValue(argv, ++i, arg); break;
			case '--json': options.json = true; break;
			case '--out': options.out = requireValue(argv, ++i, arg); break;
			case '--require': options.require = true; break;
			case '--no-fail': options.noFail = true; break;
			case '--list': options.list = true; break;
			case '--help':
			case '-h':
				printUsage();
				process.exit(0);
				break;
			default:
				usageError(`unknown argument '${arg}'`);
		}
	}
	validateOptions(options);
	return options;
}

function validateOptions(options) {
	if (options.row !== undefined && options.row !== 'audit' && options.row !== 'sbom' && options.row !== 'manifest') {
		usageError(`--row must be one of audit, sbom, manifest (got '${options.row}')`);
	}
	if (options.generate && options.row !== undefined && options.row !== 'manifest') {
		usageError('--generate targets the bundle-manifest row (use --row manifest or a full run)');
	}
	if (options.sbomOut !== undefined && options.row !== undefined && options.row !== 'sbom') {
		usageError('--sbom-out belongs to the sbom row (use --row sbom or a full run)');
	}
	if (options.sbomOut !== undefined && options.verifySbom !== undefined) {
		usageError('--sbom-out (emit posture) and --verify-sbom (verify posture) are exclusive');
	}
	if (options.verifySbom !== undefined && options.row !== 'sbom') {
		usageError('--verify-sbom requires --row sbom (it names the document to verify)');
	}
	if (options.auditJson !== undefined && options.row !== 'audit') {
		usageError('--audit-json requires --row audit (fixture override: a captured npm audit report)');
	}
	if ((options.packageJson !== undefined) !== (options.upstreamPackageJson !== undefined)) {
		usageError('--package-json and --upstream-package-json must be given together (the delta pair)');
	}
	if (options.packageJson !== undefined && options.row !== 'audit' && options.row !== 'sbom') {
		usageError('--package-json/--upstream-package-json require --row audit or --row sbom (fixture overrides)');
	}
	if (options.extensionsRoot !== undefined) {
		if (options.row !== 'sbom' && options.row !== 'manifest') {
			usageError('--extensions-root requires --row sbom or --row manifest (fixture override)');
		}
		if (options.row === 'sbom' && options.verifySbom === undefined && options.sbomOut === undefined) {
			usageError('--extensions-root (sbom fixture) needs an explicit target: --verify-sbom <file> or --sbom-out <path>');
		}
		if (options.row === 'manifest' && options.manifest === undefined) {
			usageError('--extensions-root (manifest fixture) requires --manifest <file> (verify, or generate with an explicit output path)');
		}
	}
	if (options.manifest !== undefined && options.row !== 'manifest' && !options.generate) {
		usageError('--manifest requires --row manifest or --generate (it overrides the bundle-manifest path)');
	}
}

function printRowCatalogue() {
	console.log(`${GATE_ID}: row catalogue (the runtime rung; spec docs/FLAUZ-PROGRAM/TL4-SECURITY-GATE.md section 7)`);
	console.log(`  1 ${ROW_AUDIT.padEnd(16)} npm audit (full tree) filtered to the flauz-added dependency delta; HIGH/CRITICAL in-delta = FAIL`);
	console.log(`  2 ${ROW_SBOM.padEnd(16)} CycloneDX 1.5 SBOM for the flauz artifact set; drift-checked vs the committed pin (emit: --sbom-out)`);
	console.log(`  3 ${ROW_MANIFEST.padEnd(16)} pinned sha256 of the reproducible flauz bundles; verify re-bundles + compares (pin: --generate)`);
	console.log(`${GATE_ID}: policies`);
	console.log('  audit scope       npm audit --json over the FULL tree (production + dev); verdicts only inside the delta');
	console.log(`  delta             deps/devDeps present in the product root package.json, absent in ${UPSTREAM_REF_CHAIN.join(' / ')} (git plumbing)`);
	console.log('  fail bar          HIGH/CRITICAL inside the delta; everything else is reported, never a verdict');
	console.log(`  allowlist         ${DEFAULT_AUDIT_ALLOWLIST_REL.replaceAll(path.sep, '/')} (born empty; unused entries = FAIL)`);
	console.log('  skip-vs-fail      audit SKIPs without an installed tree; manifest SKIPs without esbuild; --require promotes SKIPs');
	console.log('  pinning law       committed flauz-sbom.json + bundle-manifest.json; ANY drift = FAIL; regeneration is PR-reviewed');
}

// ---------------------------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------------------------

function git(rootDir, args) {
	const run = spawnSync('git', ['-C', rootDir, ...args], { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
	return { ok: run.status === 0, out: run.stdout || '', err: run.stderr || '' };
}

function resolveUpstreamRef(rootDir) {
	for (const candidate of UPSTREAM_REF_CHAIN) {
		const r = git(rootDir, ['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`]);
		if (r.ok && r.out.trim()) {
			return { ref: candidate, sha: r.out.trim() };
		}
	}
	return null;
}

function gitShowFile(rootDir, ref, relPath) {
	const r = git(rootDir, ['show', `${ref}:${relPath}`]);
	return r.ok ? r.out : null;
}

function readJsonFile(filePath) {
	return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function writeFileEnsuringDir(filePath, contents) {
	fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
	fs.writeFileSync(filePath, contents);
}

function canonicalJson(value) {
	return JSON.stringify(value, null, '\t') + '\n';
}

function skipRow(id, reason) {
	return { id, verdict: 'SKIP', detail: reason };
}

function failRow(id, detail, payload) {
	return { id, verdict: 'FAIL', detail, ...(payload ?? {}) };
}

function passRow(id, detail, payload) {
	return { id, verdict: 'PASS', detail, ...(payload ?? {}) };
}

function tailOf(text, lines, maxChars) {
	return text.trim().split('\n').slice(-lines).join(' | ').slice(0, maxChars);
}

/** esbuild resolution -- the EXACT candidate list of the frozen gate's packaging row. */
function resolveEsbuild(rootDir) {
	const candidates = [
		path.join(rootDir, 'node_modules', 'esbuild', 'bin', 'esbuild'),
		path.join(rootDir, 'node_modules', '.bin', 'esbuild'),
		path.join(rootDir, 'build', 'node_modules', 'esbuild', 'bin', 'esbuild'),
	];
	for (const candidate of candidates) {
		if (fs.existsSync(candidate)) {
			return candidate;
		}
	}
	return undefined;
}

/** The repo's own bundler -- the EXACT invocation of the frozen gate's packaging row. */
function runBundlerOnce(rootDir, esbuild) {
	const bundler = path.join(rootDir, 'build', 'flauz', 'scripts', 'bundle-extensions.mjs');
	if (!fs.existsSync(bundler)) {
		return { ok: false, detail: 'bundle-extensions.mjs not found' };
	}
	const run = spawnSync(process.execPath, [bundler, '--root', rootDir, '--esbuild', esbuild], { encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024, timeout: 300_000 });
	if (run.error !== undefined) {
		return { ok: false, detail: run.error.message };
	}
	if (run.status !== 0) {
		return { ok: false, detail: `bundler exit ${run.status}: ${tailOf(`${run.stderr ?? ''}\n${run.stdout ?? ''}`, 3, 300)}` };
	}
	return { ok: true };
}

function collectFilesUnder(dir, baseRel, out) {
	let entries;
	try {
		entries = fs.readdirSync(path.join(dir, baseRel), { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		const rel = baseRel === '' ? entry.name : `${baseRel}/${entry.name}`;
		if (entry.isDirectory()) {
			collectFilesUnder(dir, rel, out);
		} else if (entry.isFile()) {
			out.push(rel);
		}
	}
}

/** Discover the flauz extension manifests under the extensions root (glob by directory scan, never hardcoded). */
function discoverFlauzExtensions(extensionsRoot) {
	const found = [];
	let entries = [];
	try {
		entries = fs.readdirSync(extensionsRoot, { withFileTypes: true });
	} catch {
		return found;
	}
	for (const entry of entries) {
		if (!entry.isDirectory() || !entry.name.startsWith('flauz-')) {
			continue;
		}
		const manifestPath = path.join(extensionsRoot, entry.name, 'package.json');
		if (!fs.existsSync(manifestPath)) {
			continue;
		}
		let parsed;
		try {
			parsed = readJsonFile(manifestPath);
		} catch {
			continue;
		}
		const name = typeof parsed.name === 'string' && parsed.name.length > 0 ? parsed.name : entry.name;
		found.push({ dir: entry.name, name, version: typeof parsed.version === 'string' ? parsed.version : undefined });
	}
	found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
	return found;
}

/** deps/devDeps of a root package.json, merged name -> {range, section} (dependencies wins). */
function mergedDependencySections(pkg) {
	const merged = new Map();
	for (const section of DEPENDENCY_SECTIONS) {
		const block = pkg?.[section];
		if (typeof block !== 'object' || block === null) {
			continue;
		}
		for (const [name, range] of Object.entries(block)) {
			if (!merged.has(name)) {
				merged.set(name, { range: String(range), section });
			}
		}
	}
	return merged;
}

/** The flauz-added dependency delta: product names absent upstream (name-level, documented). */
function computeDependencyDelta(productPkg, upstreamPkg) {
	const product = mergedDependencySections(productPkg);
	const upstream = mergedDependencySections(upstreamPkg);
	const added = [];
	const removed = [];
	const unchanged = [];
	for (const name of Array.from(product.keys()).sort()) {
		if (upstream.has(name)) {
			unchanged.push(name);
		} else {
			const dep = product.get(name);
			added.push({ name, range: dep.range, section: dep.section });
		}
	}
	for (const name of Array.from(upstream.keys()).sort()) {
		if (!product.has(name)) {
			removed.push(name);
		}
	}
	return { added, removed, unchanged };
}

/** Exact version from the committed lockfile (deterministic: the lockfile is committed). */
function resolveLockfileVersion(lockfilePath, name) {
	if (!fs.existsSync(lockfilePath)) {
		return null;
	}
	try {
		const lock = readJsonFile(lockfilePath);
		const hit = lock?.packages?.[`node_modules/${name}`]?.version;
		if (typeof hit === 'string') {
			return hit;
		}
		const legacy = lock?.dependencies?.[name]?.version;
		if (typeof legacy === 'string') {
			return legacy;
		}
	} catch {
		return null;
	}
	return null;
}

/** Load the product + upstream package.json pair (fixture files, or git plumbing). */
function loadDeltaInputs(ctx) {
	let productPkg;
	try {
		productPkg = readJsonFile(ctx.productPkgPath);
	} catch (err) {
		return { error: `product package.json unreadable (${ctx.productPkgPath}): ${err instanceof Error ? err.message : String(err)}` };
	}
	if (ctx.upstreamPkgPath !== undefined) {
		let upstreamPkg;
		try {
			upstreamPkg = readJsonFile(ctx.upstreamPkgPath);
		} catch (err) {
			return { error: `upstream package.json unreadable (${ctx.upstreamPkgPath}): ${err instanceof Error ? err.message : String(err)}` };
		}
		return { productPkg, upstreamPkg, source: `delta pair (files)` };
	}
	const ref = resolveUpstreamRef(ctx.rootDir);
	if (ref === null) {
		return { skip: `upstream reference line unavailable (tried ${UPSTREAM_REF_CHAIN.join(', ')}) -- cannot compute the flauz dependency delta` };
	}
	const raw = gitShowFile(ctx.rootDir, ref.ref, 'package.json');
	if (raw === null) {
		return { skip: `package.json not readable at ${ref.ref} (${ref.sha.slice(0, 12)}) -- cannot compute the flauz dependency delta` };
	}
	try {
		return { productPkg, upstreamPkg: JSON.parse(raw), source: `delta vs ${ref.ref} @ ${ref.sha.slice(0, 12)} (git plumbing)` };
	} catch (err) {
		return { error: `upstream package.json at ${ref.ref} is not valid JSON: ${err instanceof Error ? err.message : String(err)}` };
	}
}

// ---------------------------------------------------------------------------------------------
// row 1: audit-delta
// ---------------------------------------------------------------------------------------------

function loadAuditAllowlist(allowlistPath) {
	let raw;
	try {
		raw = readJsonFile(allowlistPath);
	} catch (err) {
		throw new Error(`audit allowlist ${allowlistPath} unreadable: ${err instanceof Error ? err.message : String(err)}`);
	}
	if (typeof raw !== 'object' || raw === null || !Array.isArray(raw.allow)) {
		throw new Error(`audit allowlist ${allowlistPath} must be an object with an 'allow' array (schema flauz.audit-allowlist/v0)`);
	}
	for (const entry of raw.allow) {
		if (typeof entry?.advisory !== 'string' || typeof entry?.package !== 'string' || typeof entry?.reason !== 'string') {
			throw new Error(`audit allowlist ${allowlistPath}: every entry needs string fields {advisory, package, reason}`);
		}
	}
	return { entries: raw.allow, path: allowlistPath, consumed: new Set() };
}

/** Advisory identities from an npm audit vuln's via[] (objects carry the advisory; strings are dependency chains). */
function advisoryIdentities(via) {
	const identities = [];
	for (const v of via) {
		if (typeof v === 'string') {
			identities.push({ id: `transitive:${v}`, title: `introduced via ${v}`, url: '' });
		} else if (v !== null && typeof v === 'object') {
			const match = /GHSA-[A-Za-z0-9-]+$/.exec(String(v.url ?? ''));
			identities.push({ id: match !== null ? match[0] : String(v.title ?? 'unnamed advisory'), title: String(v.title ?? ''), url: String(v.url ?? '') });
		}
	}
	return identities;
}

function runAuditRow(ctx) {
	const inputs = loadDeltaInputs(ctx);
	if (inputs.error !== undefined) {
		return failRow(ROW_AUDIT, inputs.error);
	}
	if (inputs.skip !== undefined) {
		return skipRow(ROW_AUDIT, inputs.skip);
	}
	const delta = computeDependencyDelta(inputs.productPkg, inputs.upstreamPkg);

	let report;
	let reportSource;
	if (ctx.auditReportPath !== undefined) {
		try {
			report = readJsonFile(ctx.auditReportPath);
		} catch (err) {
			return failRow(ROW_AUDIT, `audit report unreadable (${ctx.auditReportPath}): ${err instanceof Error ? err.message : String(err)}`);
		}
		reportSource = ctx.auditReportPath;
	} else {
		if (!fs.existsSync(path.join(ctx.rootDir, 'node_modules'))) {
			return skipRow(ROW_AUDIT, `no installed tree (${path.join(ctx.rootDir, 'node_modules')} absent) -- worker sandbox / pre-install lane; the flauz-security CI job 2 runs this row post-install`);
		}
		const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
		const run = spawnSync(npmCmd, ['audit', '--json'], { cwd: ctx.rootDir, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024, timeout: 240_000, shell: process.platform === 'win32' });
		let parsed;
		try {
			parsed = JSON.parse(run.stdout ?? '');
		} catch {
			parsed = undefined;
		}
		if (parsed === undefined || typeof parsed !== 'object' || parsed === null || typeof parsed.vulnerabilities !== 'object' || parsed.vulnerabilities === null) {
			const why = run.error !== undefined ? ` (${run.error.message})` : '';
			return failRow(ROW_AUDIT, `npm audit did not produce a readable report${why}: ${tailOf(`${run.stderr ?? ''}\n${run.stdout ?? ''}`, 3, 300)}`);
		}
		report = parsed;
		reportSource = `npm audit --json (spawned in ${ctx.rootDir})`;
	}

	let allowlist = { entries: [], path: undefined, consumed: new Set() };
	if (ctx.auditAllowlistPath !== undefined && fs.existsSync(ctx.auditAllowlistPath)) {
		try {
			allowlist = loadAuditAllowlist(ctx.auditAllowlistPath);
		} catch (err) {
			return failRow(ROW_AUDIT, err instanceof Error ? err.message : String(err));
		}
	}

	const deltaNames = new Set(delta.added.map(dep => dep.name));
	const vulnerabilities = report.vulnerabilities ?? {};
	const inDelta = [];
	const outsideBySeverity = {};
	let outsideTotal = 0;
	for (const [name, vuln] of Object.entries(vulnerabilities)) {
		const severity = typeof vuln?.severity === 'string' ? vuln.severity : 'unknown';
		if (!deltaNames.has(name)) {
			outsideTotal += 1;
			outsideBySeverity[severity] = (outsideBySeverity[severity] ?? 0) + 1;
			continue;
		}
		const identities = advisoryIdentities(Array.isArray(vuln?.via) ? vuln.via : []);
		const live = [];
		let suppressedCount = 0;
		for (const identity of identities) {
			const entryIndex = allowlist.entries.findIndex(entry => entry.advisory === identity.id && entry.package === name);
			if (entryIndex >= 0) {
				allowlist.consumed.add(entryIndex);
				suppressedCount += 1;
			} else {
				live.push(identity);
			}
		}
		const allowlisted = identities.length > 0 && live.length === 0;
		inDelta.push({
			package: name,
			severity,
			isDirect: vuln?.isDirect === true,
			range: typeof vuln?.range === 'string' ? vuln.range : '',
			identities,
			suppressedAdvisories: suppressedCount,
			allowlisted,
			fixAvailable: vuln?.fixAvailable ?? null,
		});
	}

	const failing = inDelta.filter(vuln => !vuln.allowlisted && (SEVERITY_RANK[vuln.severity] ?? -1) >= SEVERITY_RANK.high);
	const unusedEntries = allowlist.entries
		.map((entry, index) => ({ entry, index }))
		.filter(pair => !allowlist.consumed.has(pair.index))
		.map(pair => `${pair.entry.advisory} @ ${pair.entry.package}`);

	const allowlistPayload = {
		path: allowlist.path,
		entries: allowlist.entries.length,
		consumed: Array.from(allowlist.consumed),
		unused: unusedEntries,
	};
	const payload = {
		audit: {
			reportSource,
			deltaSource: inputs.source,
			delta,
			inDelta,
			outsideDelta: { total: outsideTotal, bySeverity: outsideBySeverity },
			allowlist: allowlistPayload,
		},
	};

	if (failing.length > 0) {
		const detail = `${failing.length} HIGH/CRITICAL advisory(ies) INSIDE the flauz dependency delta (added deps: ${delta.added.map(dep => `${dep.name}@${dep.range}`).join(', ') || 'none'})`;
		return failRow(ROW_AUDIT, detail, payload);
	}
	if (unusedEntries.length > 0) {
		return failRow(ROW_AUDIT, `unused audit-allowlist entries (fixture drift -- remove them when the advisory is fixed): ${unusedEntries.join(', ')}`, payload);
	}
	const allowlistedNote = inDelta.filter(v => v.allowlisted).length;
	const detail = `delta ${delta.added.length} added/${delta.removed.length} removed/${delta.unchanged.length} unchanged; advisories: ${inDelta.length} in-delta (${allowlistedNote} allowlisted), ${outsideTotal} outside-delta (informational); allowlist ${allowlist.consumed.size}/${allowlist.entries.length} consumed`;
	return passRow(ROW_AUDIT, detail, payload);
}

// ---------------------------------------------------------------------------------------------
// row 2: sbom (CycloneDX 1.5, zero-dep emission, deterministic)
// ---------------------------------------------------------------------------------------------

/** Deterministic RFC-4122-shaped UUID (version 5, variant 10xx) from the canonical content. */
function deterministicSerialNumber(canonical) {
	const digest = createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
	const hex = digest.slice(0, 32).split('');
	hex[12] = '5';
	hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
	const s = hex.join('');
	return `urn:uuid:${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

function buildSbomDocument(extensions, deltaDeps, rootDir) {
	const components = [];
	const dependsOn = [];
	for (const ext of extensions) {
		const hasVersion = typeof ext.version === 'string' && ext.version.length > 0;
		const ref = hasVersion ? `pkg:generic/flauz/${ext.name}@${ext.version}` : `pkg:generic/flauz/${ext.name}`;
		const component = { type: 'library', 'bom-ref': ref, name: ext.name };
		if (hasVersion) {
			component.version = ext.version;
			component.purl = ref;
		}
		component.properties = [
			{ name: 'flauz:component-kind', value: 'flauz-extension' },
			{ name: 'flauz:artifact', value: `extensions/${ext.dir}/dist/` },
		];
		components.push(component);
		dependsOn.push(ref);
	}
	for (const dep of deltaDeps) {
		const exact = dep.resolved !== null && dep.resolved !== undefined ? dep.resolved : null;
		const purlSafe = exact !== null && !dep.name.includes('/');
		const ref = purlSafe ? `pkg:npm/${dep.name}@${exact}` : `dep:${dep.name}`;
		const component = { type: 'library', 'bom-ref': ref, name: dep.name, version: exact ?? dep.range };
		if (purlSafe) {
			component.purl = ref;
		}
		component.properties = [
			{ name: 'flauz:component-kind', value: 'flauz-root-dependency-delta' },
			{ name: 'flauz:dependency-section', value: dep.section },
			{ name: 'flauz:declared-range', value: dep.range },
		];
		if (exact !== null) {
			component.properties.push({ name: 'flauz:resolved-from', value: 'package-lock.json' });
		}
		components.push(component);
		dependsOn.push(ref);
	}

	// Root identity: the Flauz product overlay (deterministic -- committed file, no wall clock).
	let rootName = 'Flauz';
	let rootVersion;
	try {
		const overlay = readJsonFile(path.join(rootDir, 'product.flauz.json'));
		if (typeof overlay.nameLong === 'string' && overlay.nameLong.length > 0) {
			rootName = overlay.nameLong;
		}
		if (typeof overlay.version === 'string' && overlay.version.length > 0) {
			rootVersion = overlay.version;
		}
	} catch {
		// no overlay: the defaults stand
	}
	const rootRef = rootVersion !== undefined ? `pkg:generic/flauz@${rootVersion}` : 'pkg:generic/flauz';
	const root = { type: 'application', 'bom-ref': rootRef, name: rootName };
	if (rootVersion !== undefined) {
		root.version = rootVersion;
		root.purl = rootRef;
	}
	root.properties = [
		{ name: 'flauz:component-kind', value: 'flauz-product-overlay' },
		{ name: 'flauz:base-product', value: 'Code OSS (additive product line)' },
	];

	const serial = deterministicSerialNumber({ components, dependsOn });
	return {
		$schema: 'http://cyclonedx.org/schema/bom-1.5.schema.json',
		bomFormat: 'CycloneDX',
		specVersion: '1.5',
		serialNumber: serial,
		version: 1,
		metadata: {
			tools: { components: [{ type: 'application', name: GATE_ID, version: GATE_VERSION }] },
			component: root,
		},
		components,
		dependencies: [{ ref: rootRef, dependsOn }],
	};
}

/** Structural validation of a CycloneDX 1.5 JSON document (the self-check + verify-target check). */
function validateSbomDocument(doc, expectedExtensionNames) {
	const problems = [];
	if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
		return ['not a JSON object'];
	}
	if (doc.bomFormat !== 'CycloneDX') {
		problems.push('bomFormat must be the string \'CycloneDX\'');
	}
	if (doc.specVersion !== '1.5') {
		problems.push('specVersion must be the string \'1.5\'');
	}
	if (!Number.isInteger(doc.version) || doc.version < 1) {
		problems.push('version must be an integer >= 1');
	}
	if (doc.serialNumber !== undefined && !/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(doc.serialNumber)) {
		problems.push('serialNumber must be a lowercase urn:uuid:<uuid>');
	}
	if (doc.metadata !== undefined && (typeof doc.metadata !== 'object' || doc.metadata === null || Array.isArray(doc.metadata))) {
		problems.push('metadata must be an object');
	}
	const names = new Set();
	const refs = new Set();
	if (!Array.isArray(doc.components)) {
		problems.push('components must be an array');
	} else {
		for (const component of doc.components) {
			if (typeof component !== 'object' || component === null || Array.isArray(component)) {
				problems.push('component entry is not an object');
				continue;
			}
			if (typeof component.type !== 'string' || component.type.length === 0) {
				problems.push(`component '${String(component.name ?? '?')}': type must be a non-empty string`);
			}
			if (typeof component.name !== 'string' || component.name.length === 0) {
				problems.push('component with empty/missing name');
				continue;
			}
			names.add(component.name);
			if (component['bom-ref'] !== undefined) {
				const ref = component['bom-ref'];
				if (typeof ref !== 'string' || ref.length === 0) {
					problems.push(`component '${component.name}': bom-ref must be a non-empty string`);
				} else if (refs.has(ref)) {
					problems.push(`duplicate bom-ref '${ref}'`);
				} else {
					refs.add(ref);
				}
			}
		}
		for (const extName of expectedExtensionNames) {
			if (!names.has(extName)) {
				problems.push(`flauz extension '${extName}' missing from components`);
			}
		}
	}
	const rootRef = doc.metadata?.component?.['bom-ref'];
	if (rootRef !== undefined) {
		refs.add(rootRef);
	}
	if (doc.dependencies !== undefined) {
		if (!Array.isArray(doc.dependencies)) {
			problems.push('dependencies must be an array');
		} else {
			for (const dep of doc.dependencies) {
				if (typeof dep?.ref !== 'string' || dep.ref.length === 0) {
					problems.push('dependencies entry missing a non-empty ref');
					continue;
				}
				if (!refs.has(dep.ref)) {
					problems.push(`dependencies ref '${dep.ref}' has no matching component`);
				}
				for (const target of Array.isArray(dep.dependsOn) ? dep.dependsOn : []) {
					if (!refs.has(target)) {
						problems.push(`dependsOn ref '${target}' has no matching component`);
					}
				}
			}
		}
	}
	return problems;
}

function runSbomRow(ctx) {
	const extensions = discoverFlauzExtensions(ctx.extensionsRoot);
	if (extensions.length === 0) {
		return skipRow(ROW_SBOM, `no flauz-* extension manifests found under ${ctx.extensionsRoot}`);
	}
	const inputs = loadDeltaInputs(ctx);
	if (inputs.error !== undefined) {
		return failRow(ROW_SBOM, inputs.error);
	}
	if (inputs.skip !== undefined) {
		return skipRow(ROW_SBOM, inputs.skip);
	}
	const delta = computeDependencyDelta(inputs.productPkg, inputs.upstreamPkg);
	const deltaDeps = delta.added.map(dep => ({ ...dep, resolved: resolveLockfileVersion(ctx.lockfilePath, dep.name) }));

	const doc = buildSbomDocument(extensions, deltaDeps, ctx.rootDir);
	const serialized = canonicalJson(doc);
	let parseBack;
	try {
		parseBack = JSON.parse(serialized); // the parse-back proof: what is written/compared is what parses
	} catch (err) {
		return failRow(ROW_SBOM, `emitted document does not parse back: ${err instanceof Error ? err.message : String(err)}`);
	}
	const selfProblems = validateSbomDocument(parseBack, extensions.map(ext => ext.name));
	if (selfProblems.length > 0) {
		return failRow(ROW_SBOM, `self-check failed on the emitted document: ${selfProblems.join('; ')}`);
	}
	const summary = {
		sbom: {
			extensions: extensions.length,
			deltaDependencies: deltaDeps.length,
			components: doc.components.length,
			serialNumber: doc.serialNumber,
			deltaSource: inputs.source,
		},
	};

	if (ctx.sbomOutPath !== undefined) {
		writeFileEnsuringDir(ctx.sbomOutPath, serialized);
		return passRow(ROW_SBOM, `emitted ${doc.components.length} components (${extensions.length} extensions + ${deltaDeps.length} delta deps) -> ${ctx.sbomOutPath} (self-check ok)`, summary);
	}

	const targetPath = ctx.verifySbomPath ?? ctx.committedSbomPath;
	if (!fs.existsSync(targetPath)) {
		return skipRow(ROW_SBOM, `no SBOM document to verify at ${targetPath} (regenerate: --sbom-out ${targetPath}; regeneration is PR-reviewed)`);
	}
	let targetRaw;
	try {
		targetRaw = fs.readFileSync(targetPath, 'utf-8');
	} catch (err) {
		return failRow(ROW_SBOM, `target SBOM unreadable (${targetPath}): ${err instanceof Error ? err.message : String(err)}`);
	}
	let targetDoc;
	try {
		targetDoc = JSON.parse(targetRaw);
	} catch (err) {
		return failRow(ROW_SBOM, `target SBOM ${targetPath} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
	}
	const targetProblems = validateSbomDocument(targetDoc, extensions.map(ext => ext.name));
	if (targetProblems.length > 0) {
		return failRow(ROW_SBOM, `${targetPath} fails validation: ${targetProblems.join('; ')}`, summary);
	}
	if (targetRaw !== serialized) {
		return failRow(ROW_SBOM, `DRIFT vs ${targetPath} -- the pinned SBOM must be regenerated in the PR that changed the artifact set (regenerate: --sbom-out ${targetPath}; the diff is PR-reviewed)`, summary);
	}
	return passRow(ROW_SBOM, `${doc.components.length} components (${extensions.length} extensions + ${deltaDeps.length} delta deps) match the pinned ${targetPath} (self-check + coverage ok)`, summary);
}

// ---------------------------------------------------------------------------------------------
// row 3: bundle-manifest (pinned sha256 of the reproducible bundles)
// ---------------------------------------------------------------------------------------------

/** sha256 of every flauz extension dist artifact (extensions root, per extension, sorted, deterministic). */
function hashDistTree(extensionsRoot) {
	const bundles = {};
	let extensionCount = 0;
	let artifactCount = 0;
	let entries = [];
	try {
		entries = fs.readdirSync(extensionsRoot, { withFileTypes: true });
	} catch {
		return { bundles, extensionCount: 0, artifactCount: 0 };
	}
	for (const entry of entries.map(e => e.name).sort()) {
		const extDir = path.join(extensionsRoot, entry);
		if (!entry.startsWith('flauz-') || !fs.existsSync(path.join(extDir, 'dist'))) {
			continue;
		}
		const distDir = path.join(extDir, 'dist');
		const files = [];
		collectFilesUnder(distDir, '', files);
		if (files.length === 0) {
			continue;
		}
		const artifacts = {};
		for (const rel of files.sort()) {
			artifacts[`dist/${rel}`] = createHash('sha256').update(fs.readFileSync(path.join(distDir, rel))).digest('hex');
			artifactCount += 1;
		}
		let version = null;
		const manifestPath = path.join(extDir, 'package.json');
		if (fs.existsSync(manifestPath)) {
			try {
				const parsed = readJsonFile(manifestPath);
				if (typeof parsed.version === 'string') {
					version = parsed.version;
				}
			} catch {
				version = null;
			}
		}
		bundles[entry] = { version, artifacts };
		extensionCount += 1;
	}
	return { bundles, extensionCount, artifactCount };
}

function loadBundleManifest(manifestPath) {
	let raw;
	try {
		raw = readJsonFile(manifestPath);
	} catch (err) {
		throw new Error(`bundle manifest ${manifestPath} unreadable: ${err instanceof Error ? err.message : String(err)}`);
	}
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
		throw new Error(`bundle manifest ${manifestPath} must be a JSON object`);
	}
	if (raw.$schema !== MANIFEST_SCHEMA) {
		throw new Error(`bundle manifest ${manifestPath}: $schema must be '${MANIFEST_SCHEMA}' (got ${JSON.stringify(raw.$schema)})`);
	}
	if (raw.manifestVersion !== 1) {
		throw new Error(`bundle manifest ${manifestPath}: manifestVersion must be 1`);
	}
	if (raw.status !== 'PINNED' && raw.status !== 'STATION-PENDING') {
		throw new Error(`bundle manifest ${manifestPath}: status must be 'PINNED' or 'STATION-PENDING' (got ${JSON.stringify(raw.status)})`);
	}
	if (typeof raw.generationCommand !== 'string' || raw.generationCommand.length === 0) {
		throw new Error(`bundle manifest ${manifestPath}: generationCommand must be a non-empty string`);
	}
	if (raw.status === 'PINNED' && (typeof raw.bundles !== 'object' || raw.bundles === null || Array.isArray(raw.bundles))) {
		throw new Error(`bundle manifest ${manifestPath}: a PINNED manifest must carry a 'bundles' object`);
	}
	return raw;
}

function writeBundleManifest(manifestPath, tree, extra) {
	const bundles = {};
	for (const name of Object.keys(tree.bundles).sort()) {
		bundles[name] = tree.bundles[name];
	}
	const doc = {
		$schema: MANIFEST_SCHEMA,
		manifestVersion: 1,
		status: extra.status,
		baseCommit: extra.baseCommit,
		generatedAt: extra.generatedAt,
		generationCommand: GENERATION_COMMAND,
		notes: extra.note ?? PINNED_NOTES,
		bundles,
	};
	writeFileEnsuringDir(manifestPath, canonicalJson(doc));
}

function compareTreeAgainstManifest(manifest, tree) {
	const problems = [];
	const pinned = manifest.bundles ?? {};
	for (const [extName, entry] of Object.entries(pinned)) {
		const treeEntry = tree.bundles[extName];
		if (treeEntry === undefined) {
			problems.push(`'${extName}' is pinned but has no dist artifacts under the extensions root`);
			continue;
		}
		if (typeof entry?.version === 'string' && typeof treeEntry.version === 'string' && entry.version !== treeEntry.version) {
			problems.push(`'${extName}' version drift (pinned ${entry.version}, tree ${treeEntry.version}) -- regenerate the manifest`);
		}
		const pinnedKeys = Object.keys(entry?.artifacts ?? {}).sort();
		const treeKeys = Object.keys(treeEntry.artifacts).sort();
		if (pinnedKeys.join(',') !== treeKeys.join(',')) {
			problems.push(`'${extName}' artifact-set drift (pinned [${pinnedKeys.join(', ')}], tree [${treeKeys.join(', ')}])`);
			continue;
		}
		for (const key of pinnedKeys) {
			if (entry.artifacts[key] !== treeEntry.artifacts[key]) {
				problems.push(`'${extName}' ${key} sha256 drift (pinned ${entry.artifacts[key].slice(0, 12)}.., tree ${treeEntry.artifacts[key].slice(0, 12)}..) -- supply-chain tamper signal or unreviewed source change`);
			}
		}
	}
	for (const extName of Object.keys(tree.bundles)) {
		if (pinned[extName] === undefined) {
			problems.push(`'${extName}' has dist artifacts but is NOT pinned (unpinned extension -- regenerate the manifest)`);
		}
	}
	return problems;
}

function runManifestRow(ctx) {
	const fixtureTree = ctx.extensionsRootOverridden;

	if (ctx.generate) {
		if (fixtureTree) {
			const tree = hashDistTree(ctx.extensionsRoot);
			if (tree.extensionCount === 0) {
				return failRow(ROW_MANIFEST, `fixture generation: no flauz-*/dist artifacts under ${ctx.extensionsRoot}`);
			}
			writeBundleManifest(ctx.manifestPath, tree, { status: 'PINNED', baseCommit: null, generatedAt: new Date().toISOString(), note: 'fixture tree (synthetic dists, no bundling): hash-pinning test data for the drift-compare core; the repo-mode row re-bundles via the repo own esbuild (packaging-row mechanism)' });
			return passRow(ROW_MANIFEST, `fixture manifest generated (${tree.extensionCount} extensions, ${tree.artifactCount} artifacts) -> ${ctx.manifestPath}`);
		}
		const esbuild = resolveEsbuild(ctx.rootDir);
		if (esbuild === undefined) {
			return failRow(ROW_MANIFEST, `cannot generate: esbuild unresolvable (needs the repo npm install) -- run at the integration station: ${GENERATION_COMMAND}`);
		}
		const first = runBundlerOnce(ctx.rootDir, esbuild);
		if (!first.ok) {
			return failRow(ROW_MANIFEST, `first bundle pass failed: ${first.detail}`);
		}
		const hashesFirst = hashDistTree(path.join(ctx.rootDir, 'extensions'));
		const second = runBundlerOnce(ctx.rootDir, esbuild);
		if (!second.ok) {
			return failRow(ROW_MANIFEST, `second bundle pass failed: ${second.detail}`);
		}
		const hashesSecond = hashDistTree(path.join(ctx.rootDir, 'extensions'));
		if (hashesFirst.artifactCount === 0) {
			return failRow(ROW_MANIFEST, 'no dist artifacts produced by the bundler');
		}
		if (canonicalJson(hashesFirst.bundles) !== canonicalJson(hashesSecond.bundles)) {
			return failRow(ROW_MANIFEST, 'cannot pin a non-reproducible bundle: the two bundle passes hashed differently');
		}
		const head = git(ctx.rootDir, ['rev-parse', 'HEAD']);
		writeBundleManifest(ctx.manifestPath, hashesFirst, { status: 'PINNED', baseCommit: head.ok ? head.out.trim() : null, generatedAt: new Date().toISOString() });
		return passRow(ROW_MANIFEST, `manifest generated from a fresh double-bundle run (${hashesFirst.extensionCount} extensions, ${hashesFirst.artifactCount} artifacts, byte-identical passes) -> ${ctx.manifestPath}`);
	}

	// verify posture
	if (!fixtureTree) {
		const esbuild = resolveEsbuild(ctx.rootDir);
		if (esbuild === undefined) {
			return skipRow(ROW_MANIFEST, 'esbuild not resolvable (needs the repo npm install) -- packaging-row SKIP semantics; the flauz-security CI job 2 enforces this row post-install');
		}
	}
	if (!fs.existsSync(ctx.manifestPath)) {
		if (fixtureTree) {
			return failRow(ROW_MANIFEST, `manifest not found: ${ctx.manifestPath}`);
		}
		return skipRow(ROW_MANIFEST, `no committed bundle manifest at ${ctx.manifestPath} (station action: ${GENERATION_COMMAND} after the repo install)`);
	}
	let manifest;
	try {
		manifest = loadBundleManifest(ctx.manifestPath);
	} catch (err) {
		return failRow(ROW_MANIFEST, err instanceof Error ? err.message : String(err));
	}
	if (manifest.status === 'STATION-PENDING') {
		return failRow(ROW_MANIFEST, `manifest STATION-PENDING -- generate at the integration station: ${manifest.generationCommand} (procedure in the manifest notes; the diff is PR-reviewed extension-by-extension)`);
	}
	if (!fixtureTree) {
		const esbuild = resolveEsbuild(ctx.rootDir);
		const bundle = runBundlerOnce(ctx.rootDir, esbuild === undefined ? '' : esbuild);
		if (!bundle.ok) {
			return failRow(ROW_MANIFEST, `re-bundle failed: ${bundle.detail}`);
		}
	}
	const tree = hashDistTree(ctx.extensionsRoot);
	const problems = compareTreeAgainstManifest(manifest, tree);
	const payload = { manifest: { path: ctx.manifestPath, status: manifest.status, extensions: tree.extensionCount, artifacts: tree.artifactCount, action: 'verify' } };
	if (problems.length > 0) {
		return failRow(ROW_MANIFEST, `PIN DRIFT: ${problems.length} problem(s) vs ${ctx.manifestPath} (regenerate: ${GENERATION_COMMAND}; the diff is PR-reviewed)`, { ...payload, manifest: { ...payload.manifest, problems } });
	}
	return passRow(ROW_MANIFEST, `${tree.extensionCount} extensions / ${tree.artifactCount} artifacts match the pinned manifest (${ctx.manifestPath})`, payload);
}

// ---------------------------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------------------------

function buildContext(options) {
	const rootDir = path.resolve(options.root);
	return {
		rootDir,
		extensionsRoot: options.extensionsRoot !== undefined ? path.resolve(options.extensionsRoot) : path.join(rootDir, 'extensions'),
		extensionsRootOverridden: options.extensionsRoot !== undefined,
		productPkgPath: options.packageJson !== undefined ? path.resolve(options.packageJson) : path.join(rootDir, 'package.json'),
		upstreamPkgPath: options.upstreamPackageJson !== undefined ? path.resolve(options.upstreamPackageJson) : undefined,
		auditReportPath: options.auditJson !== undefined ? path.resolve(options.auditJson) : undefined,
		auditAllowlistPath: options.auditAllowlist !== undefined ? path.resolve(options.auditAllowlist) : path.join(rootDir, DEFAULT_AUDIT_ALLOWLIST_REL),
		sbomOutPath: options.sbomOut !== undefined ? path.resolve(options.sbomOut) : undefined,
		verifySbomPath: options.verifySbom !== undefined ? path.resolve(options.verifySbom) : undefined,
		manifestPath: options.manifest !== undefined ? path.resolve(options.manifest) : path.join(rootDir, COMMITTED_MANIFEST_REL),
		committedSbomPath: path.join(rootDir, COMMITTED_SBOM_REL),
		lockfilePath: path.join(rootDir, 'package-lock.json'),
		generate: options.generate,
	};
}

function rowPrintLines(row) {
	const lines = [];
	if (row.id === ROW_AUDIT && row.audit !== undefined) {
		for (const vuln of row.audit.inDelta) {
			if (row.verdict === 'FAIL' && !vuln.allowlisted && (SEVERITY_RANK[vuln.severity] ?? -1) >= SEVERITY_RANK.high) {
				const ids = vuln.identities.map(identity => identity.id).join(', ');
				const fix = vuln.fixAvailable !== null && typeof vuln.fixAvailable === 'object' ? `, fix ${vuln.fixAvailable.name}@${vuln.fixAvailable.version ?? '?'}` : '';
				lines.push(`${vuln.package} (${vuln.severity}${vuln.isDirect ? ', direct' : ''}) ${ids} range ${vuln.range}${fix}`);
			}
			if (vuln.allowlisted) {
				lines.push(`${vuln.package} (${vuln.severity}) allowlisted: ${vuln.identities.map(identity => identity.id).join(', ')} (reported, suppressed from the verdict)`);
			}
		}
		for (const unused of row.audit.allowlist.unused) {
			lines.push(`unused allowlist entry: ${unused}`);
		}
	}
	if (row.id === ROW_MANIFEST && row.manifest?.problems !== undefined) {
		for (const problem of row.manifest.problems) {
			lines.push(problem);
		}
	}
	return lines;
}

function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.list) {
		printRowCatalogue();
		return;
	}
	const ctx = buildContext(options);
	const rows = [];
	if (options.row !== undefined && options.row !== 'audit') {
		rows.push(skipRow(ROW_AUDIT, `row filter: only '${options.row}' runs (--row)`));
	} else {
		rows.push(runAuditRow(ctx));
	}
	if (options.row !== undefined && options.row !== 'sbom') {
		rows.push(skipRow(ROW_SBOM, `row filter: only '${options.row}' runs (--row)`));
	} else {
		rows.push(runSbomRow(ctx));
	}
	if (options.row !== undefined && options.row !== 'manifest') {
		rows.push(skipRow(ROW_MANIFEST, `row filter: only '${options.row}' runs (--row)`));
	} else {
		rows.push(runManifestRow(ctx));
	}

	let failed = false;
	for (const row of rows) {
		if (row.verdict === 'FAIL') {
			failed = true;
		}
		if (row.verdict === 'SKIP' && options.require) {
			failed = true;
		}
	}

	const mode = options.row !== undefined ? `row:${options.row}` : 'repo';
	const doc = { gate: GATE_ID, mode, root: ctx.rootDir, rows };
	if (options.out !== undefined) {
		writeFileEnsuringDir(options.out, canonicalJson(doc));
	}
	if (options.json) {
		console.log(JSON.stringify(doc, null, '\t'));
	} else {
		console.log(`security-runtime-gate: ${mode === 'repo' ? `root ${path.basename(ctx.rootDir)}` : mode}`);
		for (const row of rows) {
			console.log(`${row.verdict.padEnd(6)} ${row.id.padEnd(16)} ${row.detail}`);
			for (const line of rowPrintLines(row)) {
				console.log(`       ${line}`);
			}
		}
		console.log('-- verdict ---------------------------------------------------------------');
		let verdictLine = `security-runtime-gate: ${failed ? 'FAIL' : 'GREEN'}`;
		if (failed && options.require) {
			verdictLine += ' (evidence mode: SKIP rows promoted)';
		}
		console.log(verdictLine);
	}

	if (options.noFail) {
		return;
	}
	if (failed) {
		process.exit(1);
	}
}

main();
