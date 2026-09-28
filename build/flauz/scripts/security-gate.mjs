/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// ---------------------------------------------------------------------------------------------
// Flauz TL4 (product-quality lane) -- task TL4-006.
//
// security-gate.mjs -- the integrated security + release gate.
//
// Mission: one machine-checked verdict for the release-blocking security
// surface of the Flauz additive namespace. Rows (spec:
// docs/FLAUZ-PROGRAM/TL4-SECURITY-GATE.md):
//
//   1. secrets            -- credential-pattern scan over every text file in
//                           the Flauz namespace (extensions/flauz-*/{src,test,
//                           shims}, build/flauz, test/fixtures, docs/
//                           FLAUZ-PROGRAM, product.flauz.json, src/vs/
//                           workbench/contrib/flauz). Pattern battery: GitHub
//                           token family, OpenRouter, Neon, Composio, AWS
//                           AKIA, private-key blocks, JWTs, credential-carrying
//                           connection strings, generic secret assignments
//                           (with an obvious-placeholder allowlist).
//   2. dependency-purity  -- supply chain: every extensions/flauz-*/package.json
//                           declares ZERO runtime dependencies; devDependencies
//                           limited to the allowlist (typescript today).
//   3. proposed-api       -- permissions surface: composes proposed-api-rota.mjs
//                           (exit 1 = drift = FAIL here).
//   4. packaging          -- composes bundle-extensions.mjs: esbuild every
//                           flauz extension TWICE and compare content hashes
//                           (reproducible release artifacts). SKIPs when
//                           esbuild is not resolvable (pre-install lanes);
//                           --require promotes SKIP to FAIL.
//
// Delegated rows (documented, never faked): the DL-20 hardened-ledger
// integrity (tamper / wrong-key / truncated-tail) is pinned by
// extensions/flauz-workflow/test/hardening.test.ts in flauz-workflow.yml;
// browser deny-by-default + hardening is pinned by the flauz-browser.yml
// suites. This gate composes the STATIC release surface; those lanes own
// the dynamic one.
//
// Usage:
//   node security-gate.mjs [--root <repo>] [--scan-tree <dir>]
//                          [--json] [--require] [--no-fail] [--list]
//
//   --scan-tree <dir>   secrets-only mode over an arbitrary tree (fixture
//                       matrix; other rows SKIP).
//   --root <dir>        repository root (default: the repo containing this
//                       script).
//   --json              machine-readable verdict document.
//   --require           evidence mode: SKIP rows FAIL the gate.
//   --no-fail           report only.
//   --list              print the row catalogue + pattern battery.
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

const SCRIPT_DIR = path.dirname(fileURLToPathSafe());
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..');

/** The Flauz additive namespace (scan scope + the placement law's own paths). */
const FLAUZ_SCAN_GLOBS = [
	'extensions/flauz-agent',
	'extensions/flauz-browser',
	'extensions/flauz-environments',
	'extensions/flauz-models',
	'extensions/flauz-resources',
	'extensions/flauz-workflow',
	'extensions/flauz-workspace',
	'build/flauz',
	'test/fixtures',
	'docs/FLAUZ-PROGRAM',
	'src/vs/workbench/contrib/flauz',
];
const FLAUZ_SCAN_FILES = ['product.flauz.json'];
const TEXT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.jsonc', '.md', '.yml', '.yaml', '.sh', '.txt', '.tsv', '.d.ts', '.env', '.cfg', '.ini', '.toml', '.xml', '.html', '.css']);

/** devDependencies allowlist (supply chain: what the flauz lanes may use at dev time). */
const DEV_DEPENDENCY_ALLOWLIST = new Set(['typescript']);

/**
 * The credential battery. Each pattern: id, human name, regex. Fixtures
 * under test/fixtures/security-gate/ plant one match per pattern (the
 * failability proof).
 */
const SECRET_PATTERNS = [
	{ id: 'github-pat', name: 'GitHub personal access token', pattern: /ghp_[A-Za-z0-9]{36}/ },
	{ id: 'github-oauth', name: 'GitHub OAuth token', pattern: /gho_[A-Za-z0-9]{36}/ },
	{ id: 'github-app', name: 'GitHub app installation token', pattern: /ghs_[A-Za-z0-9]{36}/ },
	{ id: 'github-refresh', name: 'GitHub refresh token', pattern: /ghr_[A-Za-z0-9]{76}/ },
	{ id: 'openrouter', name: 'OpenRouter API key', pattern: /sk-or-v1-[A-Za-z0-9-]{40,}/ },
	{ id: 'neon', name: 'Neon API key', pattern: /napi_[A-Za-z0-9]{40,}/ },
	{ id: 'aws-access-key', name: 'AWS access key id', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
	{ id: 'private-key', name: 'private key block', pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/ },
	{ id: 'jwt', name: 'JSON Web Token', pattern: /eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/ },
	{ id: 'composio', name: 'Composio key', pattern: /\b[ca]k_[A-Za-z0-9]{24,}\b/ },
	{ id: 'connection-string', name: 'credential-carrying connection string', pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:@/]+:[^\s@/]+@[^\s]+/ },
	{ id: 'secret-assignment', name: 'secret-looking assignment', pattern: /\b(?:api[_-]?key|apikey|secret|token|password|passwd|passphrase)\b\s*[:=]\s*['"][A-Za-z0-9+/_~-]{20,}['"]/ },
];

/** Obvious placeholders never count as planted secrets. */
const PLACEHOLDER_MARKERS = ['example', 'placeholder', 'fixture', 'sample', 'dummy', 'test-value', 'xxxx', 'aaaa', 'bbbb', 'cccc', '0123456789', 'your-', 'token-here', 'not-a-real', 'xxxxx'];

const SKIP_ROWS_TEXT_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.woff', '.woff2', '.ttf', '.eot', '.zip', '.gz', '.tar', '.wasm']);

/**
 * The gate's own failability fixtures (planted synthetic credentials) are its
 * TEST DATA -- scanning them in repo mode would be self-incrimination, not
 * detection. The clean tree stays in scope (it must keep proving placeholders
 * never fire).
 */
const SELF_FIXTURE_PREFIXES = ['test/fixtures/security-gate/planted-', 'test/fixtures/security-gate/allowlist-case/'];

function fileURLToPathSafe() {
	const url = import.meta.url;
	const prefix = 'file://';
	if (!url.startsWith(prefix)) {
		throw new Error(`security-gate: unsupported module url ${url}`);
	}
	let target = url.slice(prefix.length);
	if (process.platform === 'win32') {
		target = target.replace(/^\/([A-Za-z]:)/, '$1');
	}
	return decodeURIComponent(target);
}

function parseArgs(argv) {
	const options = { root: DEFAULT_ROOT, scanTree: undefined, allowlist: undefined, json: false, require: false, noFail: false, list: false };
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		switch (arg) {
			case '--root':
				options.root = requireValue(argv, ++i, arg);
				break;
			case '--scan-tree':
				options.scanTree = requireValue(argv, ++i, arg);
				break;
			case '--allowlist':
				options.allowlist = requireValue(argv, ++i, arg);
				break;
			case '--json':
				options.json = true;
				break;
			case '--require':
				options.require = true;
				break;
			case '--no-fail':
				options.noFail = true;
				break;
			case '--list':
				options.list = true;
				break;
			case '--help':
			case '-h':
				printUsage();
				process.exit(0);
				break;
			default:
				usageError(`unknown argument '${arg}'`);
		}
	}
	return options;
}

function requireValue(argv, index, flag) {
	const value = argv[index];
	if (value === undefined || value.startsWith('--')) {
		usageError(`${flag} requires a value`);
	}
	return value;
}

function printUsage() {
	console.log('usage: node security-gate.mjs [--root <repo>] [--scan-tree <dir>] [--allowlist <file>] [--json] [--require] [--no-fail] [--list]');
}

function usageError(message) {
	printUsage();
	console.error(`security-gate: usage error: ${message}`);
	process.exit(2);
}

function isPlaceholderCandidate(matchText) {
	const lowered = matchText.toLowerCase();
	for (const marker of PLACEHOLDER_MARKERS) {
		if (lowered.includes(marker)) {
			return true;
		}
	}
	// Single-character or trivially-repeated runs are placeholders by shape.
	if (/^(.)\1+$/.test(matchText)) {
		return true;
	}
	return false;
}

/** Collect files under a directory (bounded walk). */
function collectFiles(rootDir, baseRel, out) {
	const abs = path.join(rootDir, baseRel);
	let entries;
	try {
		entries = fs.readdirSync(abs, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === 'out') {
			continue;
		}
		const rel = baseRel === '' ? entry.name : `${baseRel}/${entry.name}`;
		if (entry.isDirectory()) {
			collectFiles(rootDir, rel, out);
		} else if (entry.isFile()) {
			out.push({ abs: path.join(rootDir, rel), rel });
		}
	}
}

/** The intentional-divergence allowlist (same discipline as compat-allowlist). */
function loadAllowlist(allowlistPath) {
	const raw = JSON.parse(fs.readFileSync(allowlistPath, 'utf-8'));
	if (typeof raw !== 'object' || raw === null || !Array.isArray(raw.allow)) {
		throw new Error(`security-gate: allowlist ${allowlistPath} must be an object with an 'allow' array`);
	}
	return { entries: raw.allow, path: allowlistPath };
}

function allowlistMatches(entry, fileRel, patternId) {
	return entry.file === fileRel && (entry.pattern === undefined || entry.pattern === patternId);
}

/** Row 1: the secret scan. Returns { verdict, findings, scanned, allowlistHits }. */
function scanSecrets(rootDir, scanTreeMode, allowlist) {
	const files = [];
	if (scanTreeMode) {
		collectFiles(rootDir, '', files);
	} else {
		for (const rel of FLAUZ_SCAN_GLOBS) {
			collectFiles(rootDir, rel, files);
		}
		for (const rel of FLAUZ_SCAN_FILES) {
			const abs = path.join(rootDir, rel);
			if (fs.existsSync(abs)) {
				files.push({ abs, rel });
			}
		}
	}
	const findings = [];
	const allowlistHits = new Set();
	let scanned = 0;
	for (const file of files) {
		if (!scanTreeMode) {
			let selfFixture = false;
			for (const prefix of SELF_FIXTURE_PREFIXES) {
				if (file.rel.startsWith(prefix)) {
					selfFixture = true;
					break;
				}
			}
			if (selfFixture) {
				continue;
			}
		}
		const ext = path.extname(file.abs).toLowerCase();
		if (SKIP_ROWS_TEXT_EXTENSIONS.has(ext)) {
			continue;
		}
		let contents;
		try {
			contents = fs.readFileSync(file.abs, 'utf-8');
		} catch {
			continue;
		}
		scanned += 1;
		const lines = contents.split('\n');
		for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
			const line = lines[lineIndex];
			for (const pattern of SECRET_PATTERNS) {
				const match = pattern.pattern.exec(line);
				if (match === null) {
					continue;
				}
				if (pattern.id === 'secret-assignment' && isPlaceholderCandidate(line)) {
					continue;
				}
				const allowed = allowlist.entries.find(entry => allowlistMatches(entry, file.rel, pattern.id));
				if (allowed !== undefined) {
					allowlistHits.add(allowlist.entries.indexOf(allowed));
					continue;
				}
				findings.push({ file: file.rel, line: lineIndex + 1, pattern: pattern.id, name: pattern.name, sample: `${match[0].slice(0, 12)}...` });
			}
		}
	}
	return { verdict: findings.length === 0 ? 'PASS' : 'FAIL', findings, scanned, allowlistHits };
}

/** Row 2: dependency purity (supply chain). */
function checkDependencyPurity(rootDir) {
	const problems = [];
	let checked = 0;
	const extensionsDir = path.join(rootDir, 'extensions');
	let entries = [];
	try {
		entries = fs.readdirSync(extensionsDir, { withFileTypes: true });
	} catch {
		return { verdict: 'SKIP', problems, checked: 0, reason: 'extensions/ not found' };
	}
	for (const entry of entries) {
		if (!entry.isDirectory() || !entry.name.startsWith('flauz-')) {
			continue;
		}
		const manifest = path.join(extensionsDir, entry.name, 'package.json');
		if (!fs.existsSync(manifest)) {
			continue;
		}
		checked += 1;
		let parsed;
		try {
			parsed = JSON.parse(fs.readFileSync(manifest, 'utf-8'));
		} catch (err) {
			problems.push({ extension: entry.name, problem: `manifest not valid JSON: ${err instanceof Error ? err.message : String(err)}` });
			continue;
		}
		const deps = Object.keys(parsed.dependencies ?? {});
		if (deps.length > 0) {
			problems.push({ extension: entry.name, problem: `runtime dependencies declared: ${deps.join(', ')} (flauz extensions are zero-dep by discipline)` });
		}
		const devDeps = Object.keys(parsed.devDependencies ?? {});
		for (const dep of devDeps) {
			if (!DEV_DEPENDENCY_ALLOWLIST.has(dep)) {
				problems.push({ extension: entry.name, problem: `devDependency '${dep}' is outside the allowlist (${Array.from(DEV_DEPENDENCY_ALLOWLIST).join(', ')})` });
			}
		}
	}
	if (checked === 0) {
		return { verdict: 'SKIP', problems, checked, reason: 'no flauz-* extension manifests found' };
	}
	return { verdict: problems.length === 0 ? 'PASS' : 'FAIL', problems, checked };
}

/** Row 3: the proposed-API permissions rota (composed). */
function checkProposedApi(rootDir) {
	const rota = path.join(rootDir, 'build', 'flauz', 'scripts', 'proposed-api-rota.mjs');
	if (!fs.existsSync(rota)) {
		return { verdict: 'SKIP', detail: 'proposed-api-rota.mjs not found' };
	}
	const run = spawnSync(process.execPath, [rota, '--repo-root', rootDir], { encoding: 'utf-8', maxBuffer: 16 * 1024 * 1024, timeout: 120_000 });
	if (run.error !== undefined) {
		return { verdict: 'SKIP', detail: `rota could not run: ${run.error.message}` };
	}
	if (run.status === 0) {
		return { verdict: 'PASS', detail: 'no proposed-API drift (rota assert mode)' };
	}
	const tail = `${run.stdout ?? ''}\n${run.stderr ?? ''}`.trim().split('\n').slice(-5).join(' | ');
	return { verdict: 'FAIL', detail: `rota exit ${run.status}: ${tail.slice(0, 300)}` };
}

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

function hashDirectory(dir) {
	const entries = [];
	collectArtifacts(dir, '', entries);
	const hashes = [];
	for (const rel of entries.sort()) {
		const abs = path.join(dir, rel);
		const digest = createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
		hashes.push(`${rel}:${digest}`);
	}
	return hashes;
}

function collectArtifacts(dir, baseRel, out) {
	let entries;
	try {
		entries = fs.readdirSync(path.join(dir, baseRel), { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		const rel = baseRel === '' ? entry.name : `${baseRel}/${entry.name}`;
		if (entry.isDirectory()) {
			collectArtifacts(dir, rel, out);
		} else if (entry.isFile()) {
			out.push(rel);
		}
	}
}

/** Row 4: packaging reproducibility (composed; double-bundle + hash compare). */
function checkPackaging(rootDir) {
	const bundler = path.join(rootDir, 'build', 'flauz', 'scripts', 'bundle-extensions.mjs');
	if (!fs.existsSync(bundler)) {
		return { verdict: 'SKIP', detail: 'bundle-extensions.mjs not found' };
	}
	const esbuild = resolveEsbuild(rootDir);
	if (esbuild === undefined) {
		return { verdict: 'SKIP', detail: 'esbuild not resolvable (needs the repo npm install; run the packaging CI job for the enforced row)' };
	}
	const first = spawnSync(process.execPath, [bundler, '--root', rootDir, '--esbuild', esbuild], { encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024, timeout: 300_000 });
	if (first.status !== 0) {
		return { verdict: 'FAIL', detail: `first bundle pass failed (exit ${first.status}): ${(first.stderr ?? '').slice(0, 200)}` };
	}
	const hashesFirst = hashFlauzDists(rootDir);
	const second = spawnSync(process.execPath, [bundler, '--root', rootDir, '--esbuild', esbuild], { encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024, timeout: 300_000 });
	if (second.status !== 0) {
		return { verdict: 'FAIL', detail: `second bundle pass failed (exit ${second.status}): ${(second.stderr ?? '').slice(0, 200)}` };
	}
	const hashesSecond = hashFlauzDists(rootDir);
	if (hashesFirst.length === 0) {
		return { verdict: 'FAIL', detail: 'no dist artifacts produced by the bundler' };
	}
	if (hashesFirst.join('\n') !== hashesSecond.join('\n')) {
		return { verdict: 'FAIL', detail: `reproducibility broken: ${hashesFirst.length} artifacts hashed differently across two passes` };
	}
	const verify = spawnSync(process.execPath, [bundler, '--root', rootDir, '--verify'], { encoding: 'utf-8', maxBuffer: 16 * 1024 * 1024, timeout: 120_000 });
	if (verify.status !== 0) {
		return { verdict: 'FAIL', detail: `bundle --verify failed: ${(verify.stderr ?? '').slice(0, 200)}` };
	}
	return { verdict: 'PASS', detail: `${hashesFirst.length} artifacts byte-identical across two bundle passes; all flauz mains present` };
}

function hashFlauzDists(rootDir) {
	const extensionsDir = path.join(rootDir, 'extensions');
	const hashes = [];
	let entries = [];
	try {
		entries = fs.readdirSync(extensionsDir, { withFileTypes: true });
	} catch {
		return hashes;
	}
	for (const entry of entries) {
		if (!entry.isDirectory() || !entry.name.startsWith('flauz-')) {
			continue;
		}
		const dist = path.join(extensionsDir, entry.name, 'dist');
		if (!fs.existsSync(dist)) {
			continue;
		}
		const artifacts = [];
		collectArtifacts(dist, '', artifacts);
		for (const rel of artifacts.sort()) {
			const digest = createHash('sha256').update(fs.readFileSync(path.join(dist, rel))).digest('hex');
			hashes.push(`${entry.name}/dist/${rel}:${digest}`);
		}
	}
	return hashes;
}

function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.list) {
		console.log('security-gate: row catalogue');
		console.log('  1 secrets            credential-pattern scan (Flauz namespace)');
		console.log('  2 dependency-purity  flauz extensions: zero runtime deps, allowlisted devDeps');
		console.log('  3 proposed-api       permissions drift rota (composed)');
		console.log('  4 packaging          reproducible bundles (double-build hash compare)');
		console.log('security-gate: pattern battery');
		for (const pattern of SECRET_PATTERNS) {
			console.log(`  ${pattern.id.padEnd(20)} ${pattern.name}`);
		}
		return;
	}

	const scanTreeMode = options.scanTree !== undefined;
	const rootDir = scanTreeMode ? options.scanTree : options.root;
	// scan-tree mode (fixture matrix) uses ONLY an explicit --allowlist; the
	// repo default belongs to repo mode (a fixture tree never consumes it).
	const defaultAllowlist = scanTreeMode ? undefined : path.join(options.root, 'build', 'flauz', 'security-allowlist.json');
	const allowlistPath = options.allowlist ?? defaultAllowlist;
	const allowlist = allowlistPath !== undefined && fs.existsSync(allowlistPath) ? loadAllowlist(allowlistPath) : { entries: [], path: undefined };

	const secrets = scanSecrets(rootDir, scanTreeMode, allowlist);
	const rows = [
		{ id: 'secrets', verdict: secrets.verdict, detail: `${secrets.scanned} files scanned, ${secrets.findings.length} findings` },
	];
	{
		const unusedAllowlist = allowlist.entries.filter((_entry, index) => !secrets.allowlistHits.has(index));
		if (allowlist.entries.length > 0 && unusedAllowlist.length > 0) {
			rows.push({ id: 'allowlist-hygiene', verdict: 'FAIL', detail: `unused allowlist entries (fixture drift): ${unusedAllowlist.map(entry => entry.file).join(', ')}` });
		} else if (allowlist.entries.length > 0) {
			rows.push({ id: 'allowlist-hygiene', verdict: 'PASS', detail: `${allowlist.entries.length} allowlist entries, all consumed` });
		}
	}
	if (scanTreeMode) {
		rows.push({ id: 'dependency-purity', verdict: 'SKIP', detail: 'scan-tree mode (fixture matrix): row runs in repo mode' });
		rows.push({ id: 'proposed-api', verdict: 'SKIP', detail: 'scan-tree mode (fixture matrix): row runs in repo mode' });
		rows.push({ id: 'packaging', verdict: 'SKIP', detail: 'scan-tree mode (fixture matrix): row runs in repo mode' });
	} else {
		const purity = checkDependencyPurity(rootDir);
		rows.push({ id: 'dependency-purity', verdict: purity.verdict, detail: purity.verdict === 'SKIP' ? purity.reason : `${purity.checked} manifests checked, ${purity.problems.length} problems`, problems: purity.problems });
		const rota = checkProposedApi(rootDir);
		rows.push({ id: 'proposed-api', verdict: rota.verdict, detail: rota.detail });
		const packaging = checkPackaging(rootDir);
		rows.push({ id: 'packaging', verdict: packaging.verdict, detail: packaging.detail });
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

	if (options.json) {
		console.log(JSON.stringify({ gate: 'security-gate', mode: scanTreeMode ? 'scan-tree' : 'repo', rows, findings: secrets.findings }, null, '\t'));
	} else {
		console.log(`security-gate: ${scanTreeMode ? `scan-tree ${path.basename(rootDir)}` : `root ${path.basename(rootDir)}`}`);
		for (const row of rows) {
			console.log(`${row.verdict.padEnd(6)} ${row.id.padEnd(20)} ${row.detail}`);
			for (const finding of row.id === 'secrets' ? secrets.findings : (row.problems ?? [])) {
				const label = 'file' in finding ? `${finding.file}:${finding.line} [${finding.pattern}] ${finding.name} (${finding.sample})` : `${finding.extension}: ${finding.problem}`;
				console.log(`       ${label}`);
			}
		}
		console.log('-- verdict ---------------------------------------------------------------');
		let verdictLine = `security-gate: ${failed ? 'FAIL' : 'GREEN'}`;
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
