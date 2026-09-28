/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// ---------------------------------------------------------------------------------------------
// Flauz - TL1 (substrate lane) - Worker B, task TL1-005.
//
// packaging-parity.mjs - web/desktop packaging parity gate.
//
// Mission: machine-check the parity posture of every Flauz surface so the
// web/desktop shell story cannot drift silently. The registry
// (build/flauz/packaging-parity.json) classifies every flauz-* extension
// capability as desktop-full / web-degraded / web-blocked / web-full, each
// row pinned to evidence (a manifest key, a node: import, or a node-free
// subtree). This gate re-derives every citation against the live tree:
//
// Rules:
//   PP1 registry present  : a tree with flauz-* manifests MUST carry a
//                           parseable, shape-valid parity registry - an
//                           unclassified surface is a violation, not a
//                           blank slate.
//   PP2 coverage          : every live extensions/flauz-* directory has at
//                           least one registry row; a row citing a flauz-*
//                           surface that no longer exists is DRIFT.
//   PP3 evidence          : every citation re-derives - manifest-key (file
//                           parses, key path resolves, value deep-equals,
//                           or is absent when absent:true), node-import
//                           (file imports node:<module>), node-free (no
//                           source file under path imports any node:
//                           module). A citation that no longer holds is
//                           DRIFT: the tree moved without a registry
//                           update.
//   PP4 class consistency : the recorded class must be consistent with the
//                           constraint - node-import evidence forces
//                           desktop-full|web-blocked; node-free evidence
//                           forces web-full|web-degraded; the per-extension
//                           "extension packaging posture" row is re-derived
//                           from the live manifest (main-only -> web-blocked,
//                           browser entry -> web-full|web-degraded).
//   PP5 posture summary   : per-extension packaging posture + capability
//                           classes summarized so the web build story is
//                           readable at a glance.
//
// Registry: build/flauz/packaging-parity.json (schema documented in the
// registry itself; report: docs/FLAUZ-PROGRAM/PACKAGING-PARITY.md).
//
// Usage:
//   node packaging-parity.mjs [--root <repo>] [--registry <file>]
//                             [--json] [--no-fail] [--require] [--help]
//
// Exit codes:
//   0  clean (all citations hold) or documented SKIP (zero flauz manifests
//      found and no --require)
//   1  drift (evidence moved without a registry update) or violation
//      (shape/coverage/class inconsistency) - or SKIP under --require
//   2  usage error
//
// A gate that cannot fail is not a gate: every FAIL rule has a fixture under
// test/fixtures/packaging-parity/ that makes it fail, wired into
// build/flauz/scripts/verify-fixtures.sh.
//
// Zero dependencies: node >= 20 stdlib only.
// ---------------------------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const EXIT_OK = 0, EXIT_FAIL = 1, EXIT_USAGE = 2;

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..'); // .../build/flauz/scripts -> repo root

const DEFAULT_REGISTRY_REL = 'build/flauz/packaging-parity.json';
const EXTENSIONS_DIR_REL = 'extensions';
const MANIFEST_REL_RE = /^extensions\/(flauz-[^/]+)\/package\.json$/;

// The capability string that marks a row as the per-extension packaging
// posture row (PP4 posture derivation applies to exactly these).
const POSTURE_CAPABILITY = 'extension packaging posture';

// The four parity classes (the registry must declare exactly these).
const PARITY_CLASSES = ['desktop-full', 'web-degraded', 'web-blocked', 'web-full'];

// The class-implication law (PP4). The GATE owns this table; the registry
// must declare it verbatim - a registry that edits its own implications is
// a violation, not a customization.
const CLASS_IMPLICATIONS = {
	'node-import': ['desktop-full', 'web-blocked'],
	'node-free': ['web-full', 'web-degraded'],
};

// Source extensions counted by node-free walks (node-import matches any
// node: import regardless of extension).
const SOURCE_EXTENSIONS = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs']);
const WALK_SKIP = new Set(['node_modules', '.git', 'out', 'out-build', 'dist']);

const rows = [];
let exitCode = EXIT_OK;
let jsonMode = false;
let noFailMode = false;

function fail(message) {
	rows.push(`FAIL  ${message}`);
	exitCode = EXIT_FAIL;
}

function drift(message) {
	rows.push(`DRIFT ${message}`);
	exitCode = EXIT_FAIL;
}

function pass(message) {
	rows.push(`PASS  ${message}`);
}

function warn(message) {
	rows.push(`WARN  ${message}`);
}

function usage() {
	process.stdout.write(`packaging-parity.mjs - web/desktop packaging parity gate (TL1-005)

Usage:
	node packaging-parity.mjs [--root <repo>] [--registry <file>]
	node packaging-parity.mjs --root test/fixtures/packaging-parity/clean --require

Options:
	--root <dir>       root dir of the tree to classify (default: the repo containing this script)
	--registry <file>  parity registry path (default: <root>/build/flauz/packaging-parity.json)
	--json             machine-readable report on stdout
	--no-fail          report-only: drift/violations are printed but exit 0
	--require          fail when zero flauz manifests are found (default: SKIP notice, exit 0)
	-h, --help         show this help

Rules: PP1 registry present + shape-valid ; PP2 per-extension coverage ;
PP3 evidence re-derivation (manifest-key / node-import / node-free) ;
PP4 class consistent with the constraint ; PP5 per-extension posture
summary. Registry: build/flauz/packaging-parity.json; report:
docs/FLAUZ-PROGRAM/PACKAGING-PARITY.md.

Exit codes: 0 clean/SKIP ; 1 drift/violation ; 2 usage error.
`);
}

// ---------------------------------------------------------------------------------------------
// tree + JSON helpers
// ---------------------------------------------------------------------------------------------

function listFlauzManifests(rootDir) {
	const extensionsDir = path.join(rootDir, EXTENSIONS_DIR_REL);
	let entries;
	try {
		entries = fs.readdirSync(extensionsDir, { withFileTypes: true });
	} catch {
		return [];
	}
	const out = [];
	for (const entry of entries) {
		if (!entry.isDirectory() || !entry.name.startsWith('flauz-')) { continue; }
		const manifestPath = path.join(extensionsDir, entry.name, 'package.json');
		if (fs.existsSync(manifestPath)) {
			out.push({ name: entry.name, abs: manifestPath, rel: `extensions/${entry.name}/package.json` });
		}
	}
	return out;
}

function readJsonFile(absPath) {
	let text;
	try {
		text = fs.readFileSync(absPath, 'utf8');
	} catch (e) {
		return { problem: `cannot read ${absPath} - ${e.message}` };
	}
	try {
		return { value: JSON.parse(text) };
	} catch (e) {
		return { problem: `not valid JSON - ${e.message}` };
	}
}

/** Resolves a key path (array of literal segments) inside a parsed JSON value. */
function getKeyPath(value, segments) {
	let current = value;
	for (const segment of segments) {
		if (current === null || typeof current !== 'object' || !(segment in current)) {
			return undefined;
		}
		current = current[segment];
	}
	return current;
}

function deepEqual(a, b) {
	if (a === b) { return true; }
	if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') { return false; }
	if (Array.isArray(a) !== Array.isArray(b)) { return false; }
	const keysA = Object.keys(a).sort();
	const keysB = Object.keys(b).sort();
	if (keysA.length !== keysB.length || keysA.some((k, i) => k !== keysB[i])) { return false; }
	return keysA.every(k => deepEqual(a[k], b[k]));
}

function walkFiles(dir) {
	const out = [];
	let entries;
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const entry of entries) {
		const p = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (!WALK_SKIP.has(entry.name)) { out.push(...walkFiles(p)); }
		} else if (entry.isFile()) {
			out.push(p);
		}
	}
	return out;
}

// ---------------------------------------------------------------------------------------------
// evidence checkers (PP3) - each returns an array of problem strings
// ---------------------------------------------------------------------------------------------

function nodeImportRe(moduleName) {
	const escaped = moduleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp(`(?:\\bfrom\\s+|\\bimport\\(\\s*|\\bimport\\s+)['"]node:${escaped}['"]`);
}

const ANY_NODE_IMPORT_RE = /(?:\bfrom\s+|\bimport\(\s*|\bimport\s+)['"]node:/;

function checkManifestKey(rootDir, item) {
	const problems = [];
	const abs = path.resolve(rootDir, item.file);
	const parsed = readJsonFile(abs);
	if (parsed.problem !== undefined) {
		problems.push(`${item.file}: ${parsed.problem}`);
		return problems;
	}
	const live = getKeyPath(parsed.value, item.key);
	const keyPathText = item.key.join('/');
	if (item.absent === true) {
		if (live !== undefined) {
			problems.push(`${item.file}: key '${keyPathText}' is now PRESENT (value ${JSON.stringify(live).slice(0, 60)}) - the row classified its absence`);
		}
		return problems;
	}
	if (live === undefined) {
		problems.push(`${item.file}: key path '${keyPathText}' not found`);
		return problems;
	}
	if (Object.prototype.hasOwnProperty.call(item, 'value') && !deepEqual(live, item.value)) {
		problems.push(`${item.file}: key '${keyPathText}' value drifted - registry pins ${JSON.stringify(item.value).slice(0, 60)}, live is ${JSON.stringify(live).slice(0, 60)}`);
	}
	return problems;
}

function checkNodeImport(rootDir, item) {
	const problems = [];
	const abs = path.resolve(rootDir, item.file);
	let text;
	try {
		text = fs.readFileSync(abs, 'utf8');
	} catch (e) {
		problems.push(`${item.file}: cannot read - ${e.message}`);
		return problems;
	}
	if (!nodeImportRe(item.module).test(text)) {
		problems.push(`${item.file}: no longer imports node:${item.module} - the node dependency this row classified is gone`);
	}
	return problems;
}

function checkNodeFree(rootDir, item) {
	const problems = [];
	const abs = path.resolve(rootDir, item.path);
	let stat;
	try {
		stat = fs.statSync(abs);
	} catch (e) {
		problems.push(`${item.path}: cannot stat - ${e.message}`);
		return problems;
	}
	const targets = stat.isDirectory() ? walkFiles(abs) : [abs];
	const sourceTargets = targets.filter(f => SOURCE_EXTENSIONS.has(path.extname(f)));
	if (sourceTargets.length === 0) {
		problems.push(`${item.path}: no source files found under the cited path`);
		return problems;
	}
	for (const f of sourceTargets) {
		let text;
		try {
			text = fs.readFileSync(f, 'utf8');
		} catch (e) {
			problems.push(`${item.path}: cannot read ${f} - ${e.message}`);
			continue;
		}
		if (ANY_NODE_IMPORT_RE.test(text)) {
			const rel = path.relative(rootDir, f).split(path.sep).join('/');
			problems.push(`${item.path}: ${rel} now imports a node: module - the node-free subtree this row classified is broken`);
		}
	}
	return problems;
}

function checkEvidenceItem(rootDir, item) {
	if (item.kind === 'manifest-key') { return checkManifestKey(rootDir, item); }
	if (item.kind === 'node-import') { return checkNodeImport(rootDir, item); }
	if (item.kind === 'node-free') { return checkNodeFree(rootDir, item); }
	return [`unknown evidence kind '${item.kind}'`];
}

// ---------------------------------------------------------------------------------------------
// registry shape validation (PP1)
// ---------------------------------------------------------------------------------------------

function validateRegistryShape(registry) {
	const problems = [];
	if (typeof registry !== 'object' || registry === null || Array.isArray(registry)) {
		return ['registry root is not a JSON object'];
	}
	if (registry.version !== 1) {
		problems.push(`registry version must be 1 (found ${JSON.stringify(registry.version)})`);
	}
	if (typeof registry.classes !== 'object' || registry.classes === null) {
		problems.push('registry.classes missing - the four class definitions must be documented');
	} else {
		const declared = Object.keys(registry.classes).sort();
		const expected = [...PARITY_CLASSES].sort();
		if (declared.length !== expected.length || declared.some((k, i) => k !== expected[i])) {
			problems.push(`registry.classes must declare exactly ${expected.join(', ')} (found ${declared.join(', ') || '<none>'})`);
		}
	}
	if (!deepEqual(registry.classImplications ?? {}, CLASS_IMPLICATIONS)) {
		problems.push(`registry.classImplications must match the gate law verbatim (${JSON.stringify(CLASS_IMPLICATIONS)}) - the gate owns the implication table; a registry cannot weaken its own contract`);
	}
	if (!Array.isArray(registry.rows) || registry.rows.length === 0) {
		problems.push('registry.rows must be a non-empty array');
		return problems;
	}
	registry.rows.forEach((row, index) => {
		const label = `row ${index + 1}`;
		if (typeof row !== 'object' || row === null) {
			problems.push(`${label}: not an object`);
			return;
		}
		for (const field of ['surface', 'capability', 'class', 'reason', 'recoveryPath']) {
			if (typeof row[field] !== 'string' || row[field].length === 0) {
				problems.push(`${label}: field '${field}' must be a non-empty string`);
			}
		}
		if (typeof row.class === 'string' && !PARITY_CLASSES.includes(row.class)) {
			problems.push(`${label}: class '${row.class}' is not one of ${PARITY_CLASSES.join(' | ')}`);
		}
		if (!Array.isArray(row.evidence) || row.evidence.length === 0) {
			problems.push(`${label}: evidence must be a non-empty array (every row cites a file + key - never a guess)`);
			return;
		}
		row.evidence.forEach((item, evidenceIndex) => {
			const where = `${label} evidence ${evidenceIndex + 1}`;
			if (typeof item !== 'object' || item === null) {
				problems.push(`${where}: not an object`);
				return;
			}
			if (item.kind === 'manifest-key') {
				if (typeof item.file !== 'string' || item.file.length === 0) { problems.push(`${where}: manifest-key needs a non-empty 'file'`); }
				if (!Array.isArray(item.key) || item.key.length === 0 || item.key.some(s => typeof s !== 'string' || s.length === 0)) {
					problems.push(`${where}: manifest-key 'key' must be a non-empty array of string segments`);
				}
				if (item.absent !== undefined && item.absent !== true) { problems.push(`${where}: 'absent' may only be the literal true`); }
				if (item.absent === true && Object.prototype.hasOwnProperty.call(item, 'value')) { problems.push(`${where}: 'absent' and 'value' are mutually exclusive`); }
			} else if (item.kind === 'node-import') {
				if (typeof item.file !== 'string' || item.file.length === 0) { problems.push(`${where}: node-import needs a non-empty 'file'`); }
				if (typeof item.module !== 'string' || item.module.length === 0) { problems.push(`${where}: node-import needs a non-empty 'module'`); }
			} else if (item.kind === 'node-free') {
				if (typeof item.path !== 'string' || item.path.length === 0) { problems.push(`${where}: node-free needs a non-empty 'path'`); }
			} else {
				problems.push(`${where}: unknown evidence kind '${item.kind}' (expected manifest-key | node-import | node-free)`);
			}
		});
	});
	return problems;
}

// ---------------------------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------------------------

function main() {
	let parsed;
	try {
		parsed = parseArgs({
			allowPositionals: false,
			options: {
				root: { type: 'string' },
				registry: { type: 'string' },
				json: { type: 'boolean', default: false },
				'no-fail': { type: 'boolean', default: false },
				require: { type: 'boolean', default: false },
				help: { type: 'boolean', default: false },
			},
		});
	} catch (e) {
		process.stderr.write(`usage error: ${e.message}\n\n`);
		usage();
		process.exit(EXIT_USAGE);
	}
	const args = parsed.values;
	if (args.help) {
		usage();
		process.exit(EXIT_OK);
	}
	jsonMode = args.json;
	noFailMode = args['no-fail'];
	const rootDir = path.resolve(args.root ?? SCRIPT_REPO_ROOT);
	const registryPath = args.registry !== undefined ? path.resolve(args.registry) : path.join(rootDir, DEFAULT_REGISTRY_REL);

	const manifests = listFlauzManifests(rootDir);
	const manifestByExtension = new Map(manifests.map(m => [m.name, m]));
	const registryExists = fs.existsSync(registryPath);

	// ---- SKIP family (build/flauz/README.md section 2 skip-vs-fail policy) -------------------
	if (manifests.length === 0) {
		const message = `no extensions/flauz-*/package.json found under ${rootDir} - no Flauz surfaces in this tree (documented SKIP; packaging-parity deferred).`;
		if (registryExists) {
			const parsedRegistry = readJsonFile(registryPath);
			if (parsedRegistry.value !== undefined && Array.isArray(parsedRegistry.value.rows)) {
				const citing = parsedRegistry.value.rows.filter(r => typeof r?.surface === 'string' && r.surface.startsWith('extensions/')).length;
				if (citing > 0) {
					warn(`registry ${path.relative(rootDir, registryPath) || registryPath} cites ${citing} extension-surface row(s) but this tree has no flauz-* extensions - stale registry or wrong --root?`);
				}
			}
		}
		if (args.require) {
			fail(message);
		} else {
			rows.push(`SKIP  ${message}`);
		}
		emit(rootDir, registryPath, manifests, null);
		return;
	}

	// ---- PP1: registry present + parseable ---------------------------------------------------
	if (!registryExists) {
		fail(`no parity registry at ${registryPath} - a tree with ${manifests.length} flauz-* manifest(s) must carry one (TL1-005: every surface classified, machine-checked, documented).`);
		emit(rootDir, registryPath, manifests, null);
		return;
	}
	const parsedRegistry = readJsonFile(registryPath);
	if (parsedRegistry.problem !== undefined) {
		fail(`registry ${registryPath}: ${parsedRegistry.problem}`);
		emit(rootDir, registryPath, manifests, null);
		return;
	}
	const registry = parsedRegistry.value;

	const shapeProblems = validateRegistryShape(registry);
	for (const problem of shapeProblems) {
		fail(`registry :: ${problem}`);
	}
	if (shapeProblems.length > 0) {
		emit(rootDir, registryPath, manifests, registry);
		return;
	}

	const registryRows = registry.rows;

	// ---- PP2: coverage (live extensions need rows; rows citing dead surfaces drift) ----------
	const surfacesInRegistry = new Set(registryRows.map(r => r.surface));
	for (const m of manifests) {
		const surface = `extensions/${m.name}`;
		if (!surfacesInRegistry.has(surface)) {
			fail(`PP2 coverage: extension ${m.name} (${m.rel}) has no parity rows - an unclassified surface is a violation`);
		}
	}
	for (const surface of surfacesInRegistry) {
		const match = /^extensions\/(flauz-[^/]+)$/.exec(surface);
		if (match === null) { continue; }
		if (!manifestByExtension.has(match[1])) {
			drift(`PP2 ${surface}: registry cites this surface but it does not exist in the live tree - the registry moved without the tree (or the extension was deleted without a registry update)`);
		}
	}

	// ---- PP3 + PP4: per-row evidence re-derivation and class consistency ---------------------
	const rowResults = [];
	for (const row of registryRows) {
		const problems = [];
		let hasNodeImport = false;
		let hasNodeFree = false;
		for (const item of row.evidence) {
			if (item.kind === 'node-import') { hasNodeImport = true; }
			if (item.kind === 'node-free') { hasNodeFree = true; }
			for (const problem of checkEvidenceItem(rootDir, item)) {
				problems.push(`PP3 citation: ${problem}`);
			}
		}
		// PP4 class-vs-evidence implications (the gate owns the law).
		if (hasNodeImport && !CLASS_IMPLICATIONS['node-import'].includes(row.class)) {
			problems.push(`PP4 class '${row.class}' is inconsistent with node-import evidence (a node: import forces ${CLASS_IMPLICATIONS['node-import'].join(' | ')})`);
		}
		if (hasNodeFree && !CLASS_IMPLICATIONS['node-free'].includes(row.class)) {
			problems.push(`PP4 class '${row.class}' is inconsistent with node-free evidence (a node-free subtree forces ${CLASS_IMPLICATIONS['node-free'].join(' | ')})`);
		}
		// PP4 posture derivation: the per-extension packaging posture row is re-derived
		// from the live manifest, never trusted from the registry.
		if (row.capability === POSTURE_CAPABILITY) {
			const match = /^extensions\/(flauz-[^/]+)$/.exec(row.surface);
			if (match !== null) {
				const manifest = manifestByExtension.get(match[1]);
				if (manifest === undefined) {
					problems.push('PP4 posture: surface does not exist in the live tree (see the coverage row above)');
				} else {
					const pkg = readJsonFile(manifest.abs).value ?? {};
					const hasBrowser = typeof pkg.browser === 'string' && pkg.browser.length > 0;
					const hasMain = typeof pkg.main === 'string' && pkg.main.length > 0;
					if (hasBrowser) {
						if (!['web-full', 'web-degraded'].includes(row.class)) {
							problems.push(`PP4 posture: live manifest has a browser entrypoint (${pkg.browser}) but the row says '${row.class}' - a browser entry makes the extension web-shapeable (web-full | web-degraded); update the registry consciously`);
						}
					} else if (hasMain) {
						if (row.class !== 'web-blocked') {
							problems.push(`PP4 posture: live manifest is main-only (${pkg.main}, no browser sibling) but the row says '${row.class}' - a main-only manifest is excluded from every web build (upstream isWebExtension()); the posture must be web-blocked until a browser entry exists`);
						}
					} else {
						warn(`PP4 posture ${row.surface}: manifest has neither main nor browser - declarative-only manifest, no posture implication`);
					}
				}
			}
		}
		rowResults.push({ row, problems });
		if (problems.length === 0) {
			pass(`${row.surface} :: ${row.capability} [${row.class}] - ${row.evidence.length} citation(s) hold`);
		} else {
			// PP3 citation failures are DRIFT (the tree moved); PP4 class
			// inconsistencies are violations (FAIL) - tag each line by its kind.
			for (const problem of problems) {
				if (problem.startsWith('PP3 citation:')) {
					drift(`${row.surface} :: ${row.capability} [${row.class}] - ${problem}`);
				} else {
					fail(`${row.surface} :: ${row.capability} [${row.class}] - ${problem}`);
				}
			}
		}
	}

	emit(rootDir, registryPath, manifests, registry, rowResults);
}

/** Prints the report (or JSON), applies --no-fail, exits. */
function emit(rootDir, registryPath, manifests, registry, rowResults = []) {
	const counts = { rows: rowResults.length, pass: 0, drift: 0, fail: 0, warn: 0 };
	for (const line of rows) {
		if (line.startsWith('PASS')) { counts.pass++; }
		else if (line.startsWith('DRIFT')) { counts.drift++; }
		else if (line.startsWith('FAIL')) { counts.fail++; }
		else if (line.startsWith('WARN')) { counts.warn++; }
	}
	const clean = exitCode === EXIT_OK;

	if (jsonMode) {
		const perExtension = {};
		for (const m of manifests) {
			const surface = `extensions/${m.name}`;
			const own = rowResults.filter(r => r.row.surface === surface);
			perExtension[m.name] = {
				posture: own.find(r => r.row.capability === POSTURE_CAPABILITY)?.row.class ?? null,
				capabilities: Object.fromEntries(own.filter(r => r.row.capability !== POSTURE_CAPABILITY).map(r => [r.row.capability, r.row.class])),
			};
		}
		const output = {
			tool: 'packaging-parity',
			version: 1,
			root: rootDir,
			registry: registryPath,
			manifests: manifests.length,
			verdict: counts.drift + counts.fail === 0 ? (manifests.length === 0 ? 'SKIP' : 'CLEAN') : 'DRIFT',
			counts,
			perExtension,
			rows: rowResults.map(r => ({
				surface: r.row.surface,
				capability: r.row.capability,
				class: r.row.class,
				status: r.problems.length === 0 ? 'PASS' : 'PROBLEM',
				problems: r.problems,
			})),
			messages: rows,
		};
		process.stdout.write(JSON.stringify(output, null, '\t') + '\n');
	} else {
		if (rows.length > 0) {
			process.stdout.write(rows.join('\n') + '\n');
		}
		// ---- PP5: per-extension posture summary ------------------------------------------------
		if (manifests.length > 0 && registry !== null) {
			process.stdout.write('  per-extension posture summary:\n');
			for (const m of manifests) {
				const surface = `extensions/${m.name}`;
				const own = rowResults.filter(r => r.row.surface === surface);
				const posture = own.find(r => r.row.capability === POSTURE_CAPABILITY);
				const capabilities = own.filter(r => r.row.capability !== POSTURE_CAPABILITY);
				const postureText = posture === undefined ? 'UNCLASSIFIED' : `${posture.row.class}${posture.problems.length > 0 ? '*' : ''}`;
				const capabilityText = capabilities.length === 0 ? 'none' : capabilities.map(r => `${r.row.class} (${r.row.capability})`).join(', ');
				process.stdout.write(`    ${surface.padEnd(34)} packaging=${postureText} | capabilities: ${capabilityText}\n`);
			}
			const productRows = rowResults.filter(r => !r.row.surface.startsWith('extensions/'));
			if (productRows.length > 0) {
				process.stdout.write('  product surfaces:\n');
				for (const r of productRows) {
					process.stdout.write(`    ${r.row.surface.padEnd(34)} ${r.row.class} (${r.row.capability})${r.problems.length > 0 ? '*' : ''}\n`);
				}
			}
			process.stdout.write('  (* = row has problems; classes: desktop-full | web-degraded | web-blocked | web-full)\n');
		}
		if (manifests.length === 0) {
			process.stdout.write(`packaging-parity: SKIP (no flauz manifests under ${rootDir})\n`);
		} else if (clean) {
			process.stdout.write(`packaging-parity: CLEAN (${manifests.length} extension(s) covered, ${rowResults.length} rows, 0 drift, 0 violations)\n`);
		} else {
			process.stdout.write('packaging-parity: drift/violations found (see FAIL/DRIFT lines above)\n');
		}
	}

	if (noFailMode) {
		// --no-fail: report-only - drift and violations are data for the Lead
		// (the CI report stream); the exit code stays 0.
		process.exit(EXIT_OK);
	}
	process.exit(exitCode);
}

main();
