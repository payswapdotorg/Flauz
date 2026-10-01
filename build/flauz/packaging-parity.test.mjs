/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Tests for build/flauz/scripts/packaging-parity.mjs (TL1-005 - web/desktop
// packaging parity gate).
//
// Run with:
//   node --test build/flauz/packaging-parity.test.mjs
//
// Case families per the work order: registry-shape validation, evidence
// derivation on fixtures (committed under test/fixtures/packaging-parity/),
// drift detection (value drift, browser entry added, node: import removed,
// node-free subtree broken), class-consistency violations (node-import and
// posture implications), coverage (unregistered extension, vanished surface),
// SKIP semantics (empty tree, --require flip, stale registry), --registry
// override, usage errors, --help, --no-fail, and the real-repo pin (the
// committed registry must classify the live seven-extension tree CLEAN),
// plus the PP6 packaged-asset presence family (P2-FIX-108: declared
// flauzPackagedAssets must ship; absent or malformed -> exit 1).
//
// Exit-code contract: 0 clean/SKIP ; 1 drift/violation ; 2 usage error.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '..', '..'); // build/flauz -> repo root
const SCRIPT = path.join(REPO_ROOT, 'build', 'flauz', 'scripts', 'packaging-parity.mjs');
const FIXTURES = path.join(REPO_ROOT, 'test', 'fixtures', 'packaging-parity');

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'flauz-parity-test-'));
test.after(() => { fs.rmSync(TMP_ROOT, { recursive: true, force: true }); });

function runTool(args) {
	const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
	return { status: r.status, out: r.stdout || '', err: r.stderr || '' };
}

function fixture(name) {
	return path.join(FIXTURES, ...name.split('/'));
}

/** Copies a fixture tree into a temp dir (for mutation cases). */
function copyFixture(name) {
	const dest = path.join(TMP_ROOT, name.replace(/\//g, '__'));
	fs.cpSync(fixture(name), dest, { recursive: true });
	return dest;
}

// ---------------------------------------------------------------------------------------------
// case family 1: clean fixture - exit 0, CLEAN verdict, per-extension summary
// ---------------------------------------------------------------------------------------------

test('clean fixture: all citations hold -> exit 0, CLEAN verdict, posture summary', () => {
	const r = runTool(['--root', fixture('clean'), '--require']);
	assert.equal(r.status, 0, `exit ${r.status}\n${r.out}\n${r.err}`);
	assert.match(r.out, /PASS  extensions\/flauz-demo :: extension packaging posture \[web-blocked\]/);
	assert.match(r.out, /PASS  extensions\/flauz-demo :: demo bridge \(stdio spawn\) \[desktop-full\]/);
	assert.match(r.out, /PASS  extensions\/flauz-demo :: pure core module \[web-full\]/);
	assert.match(r.out, /per-extension posture summary:/);
	assert.match(r.out, /extensions\/flauz-demo\s+packaging=web-blocked \| capabilities: desktop-full \(demo bridge/);
	assert.match(r.out, /packaging-parity: CLEAN \(1 extension\(s\) covered, 5 rows, 0 drift, 0 violations\)/);
});

test('clean fixture --json: verdict CLEAN, counts, perExtension shape', () => {
	const r = runTool(['--root', fixture('clean'), '--json']);
	assert.equal(r.status, 0, `exit ${r.status}\n${r.out}\n${r.err}`);
	const report = JSON.parse(r.out);
	assert.equal(report.tool, 'packaging-parity');
	assert.equal(report.verdict, 'CLEAN');
	assert.equal(report.counts.rows, 5);
	// P2-FIX-108: the PP6 PASS row (flauz-demo's declared fixtures/ ships)
	// is a pass line in the message stream too, on top of the 5 registry rows.
	assert.equal(report.counts.pass, 6);
	assert.equal(report.counts.drift, 0);
	assert.equal(report.counts.fail, 0);
	assert.equal(report.manifests, 1);
	assert.equal(report.perExtension['flauz-demo'].posture, 'web-blocked');
	assert.equal(report.perExtension['flauz-demo'].capabilities['pure core module'], 'web-full');
	assert.equal(report.rows.filter(row => row.status === 'PASS').length, 5);
});

// ---------------------------------------------------------------------------------------------
// case family 2: drift detection (PP3) - the tree moved without a registry update
// ---------------------------------------------------------------------------------------------

test('value drift: registry pins a stale main value -> exit 1, DRIFT names both values', () => {
	const r = runTool(['--root', fixture('drifted/key-value')]);
	assert.equal(r.status, 1, `exit ${r.status}\n${r.out}\n${r.err}`);
	assert.match(r.out, /DRIFT extensions\/flauz-demo :: extension packaging posture \[web-blocked\] - PP3 citation: extensions\/flauz-demo\/package\.json: key 'main' value drifted - registry pins "\.\/dist\/OLD\.js", live is "\.\/dist\/extension\.js"/);
	assert.match(r.out, /packaging-parity: drift\/violations found/);
});

test('browser entry added: absence citation + posture derivation both drift -> exit 1', () => {
	const r = runTool(['--root', fixture('drifted/browser-added')]);
	assert.equal(r.status, 1, `exit ${r.status}\n${r.out}\n${r.err}`);
	assert.match(r.out, /PP3 citation: extensions\/flauz-demo\/package\.json: key 'browser' is now PRESENT/);
	assert.match(r.out, /PP4 posture: live manifest has a browser entrypoint \(\.\/dist\/web\/extension\.js\) but the row says 'web-blocked'/);
});

test('node: import removed: citation fails -> exit 1, DRIFT says the dependency is gone', () => {
	const r = runTool(['--root', fixture('drifted/import-removed')]);
	assert.equal(r.status, 1, `exit ${r.status}\n${r.out}\n${r.err}`);
	assert.match(r.out, /PP3 citation: extensions\/flauz-demo\/src\/bridge\.ts: no longer imports node:child_process/);
});

test('node-free subtree broken: a node: import appears -> exit 1, DRIFT names the file', () => {
	const r = runTool(['--root', fixture('drifted/node-free-broken')]);
	assert.equal(r.status, 1, `exit ${r.status}\n${r.out}\n${r.err}`);
	assert.match(r.out, /PP3 citation: extensions\/flauz-demo\/src\/pure\.ts: extensions\/flauz-demo\/src\/pure\.ts now imports a node: module/);
});

// ---------------------------------------------------------------------------------------------
// case family 3: class-consistency violations (PP4) - the gate owns the law
// ---------------------------------------------------------------------------------------------

test('class mismatch: node-import evidence with class web-full -> exit 1, FAIL states the implication', () => {
	const r = runTool(['--root', fixture('drifted/class-mismatch')]);
	assert.equal(r.status, 1, `exit ${r.status}\n${r.out}\n${r.err}`);
	assert.match(r.out, /FAIL  extensions\/flauz-demo :: demo bridge \(stdio spawn\) \[web-full\] - PP4 class 'web-full' is inconsistent with node-import evidence \(a node: import forces desktop-full \| web-blocked\)/);
});

test('posture mismatch: main-only manifest with posture web-degraded -> exit 1, FAIL cites isWebExtension()', () => {
	const r = runTool(['--root', fixture('drifted/posture-mismatch')]);
	assert.equal(r.status, 1, `exit ${r.status}\n${r.out}\n${r.err}`);
	assert.match(r.out, /PP4 posture: live manifest is main-only \(\.\/dist\/extension\.js, no browser sibling\) but the row says 'web-degraded'/);
});

// ---------------------------------------------------------------------------------------------
// case family 4: coverage (PP2) - unclassified surfaces and vanished surfaces
// ---------------------------------------------------------------------------------------------

test('coverage gap: live extension without registry rows -> exit 1, FAIL names the extension', () => {
	const r = runTool(['--root', fixture('drifted/coverage-gap')]);
	assert.equal(r.status, 1, `exit ${r.status}\n${r.out}\n${r.err}`);
	assert.match(r.out, /FAIL  PP2 coverage: extension flauz-other \(extensions\/flauz-other\/package\.json\) has no parity rows - an unclassified surface is a violation/);
});

test('vanished surface: registry cites an extension absent from the tree -> exit 1, DRIFT', () => {
	const r = runTool(['--root', fixture('drifted/surface-vanished')]);
	assert.equal(r.status, 1, `exit ${r.status}\n${r.out}\n${r.err}`);
	assert.match(r.out, /DRIFT PP2 extensions\/flauz-gone: registry cites this surface but it does not exist in the live tree/);
});

// ---------------------------------------------------------------------------------------------
// case family 5: registry shape validation (PP1)
// ---------------------------------------------------------------------------------------------

test('malformed rows: missing fields, bad class, empty evidence -> exit 1, one FAIL per problem', () => {
	const r = runTool(['--root', fixture('drifted/malformed-row')]);
	assert.equal(r.status, 1, `exit ${r.status}\n${r.out}\n${r.err}`);
	assert.match(r.out, /FAIL  registry :: row 1: field 'recoveryPath' must be a non-empty string/);
	assert.match(r.out, /FAIL  registry :: row 1: class 'webish' is not one of desktop-full \| web-degraded \| web-blocked \| web-full/);
	assert.match(r.out, /FAIL  registry :: row 3: evidence must be a non-empty array \(every row cites a file \+ key - never a guess\)/);
});

test('weakened implications: registry editing its own classImplications -> exit 1', () => {
	const dir = copyFixture('clean');
	const registryPath = path.join(dir, 'build', 'flauz', 'packaging-parity.json');
	const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
	registry.classImplications['node-import'] = ['desktop-full', 'web-blocked', 'web-full']; // the weakening
	fs.writeFileSync(registryPath, JSON.stringify(registry, null, '\t') + '\n');
	const r = runTool(['--root', dir]);
	assert.equal(r.status, 1, `exit ${r.status}\n${r.out}\n${r.err}`);
	assert.match(r.out, /FAIL  registry :: registry\.classImplications must match the gate law verbatim/);
});

// ---------------------------------------------------------------------------------------------
// case family 6: SKIP semantics + missing registry
// ---------------------------------------------------------------------------------------------

test('empty tree: documented SKIP -> exit 0; --require flips it -> exit 1', () => {
	const skip = runTool(['--root', fixture('empty')]);
	assert.equal(skip.status, 0, `exit ${skip.status}\n${skip.out}\n${skip.err}`);
	assert.match(skip.out, /SKIP  no extensions\/flauz-\*\/package\.json found under .+ - no Flauz surfaces in this tree/);
	assert.match(skip.out, /packaging-parity: SKIP/);
	const required = runTool(['--root', fixture('empty'), '--require']);
	assert.equal(required.status, 1, `exit ${required.status}\n${required.out}\n${required.err}`);
});

test('stale registry + empty tree: SKIP stands, WARN reports the stale rows', () => {
	const dir = copyFixture('clean');
	fs.rmSync(path.join(dir, 'extensions'), { recursive: true, force: true });
	const r = runTool(['--root', dir]);
	assert.equal(r.status, 0, `exit ${r.status}\n${r.out}\n${r.err}`);
	assert.match(r.out, /WARN  registry .+ cites 4 extension-surface row\(s\) but this tree has no flauz-\* extensions/);
	assert.match(r.out, /packaging-parity: SKIP/);
});

test('manifests present + registry missing: exit 1, FAIL demands classification', () => {
	const dir = copyFixture('clean');
	fs.rmSync(path.join(dir, 'build'), { recursive: true, force: true });
	const r = runTool(['--root', dir]);
	assert.equal(r.status, 1, `exit ${r.status}\n${r.out}\n${r.err}`);
	assert.match(r.out, /FAIL  no parity registry at .+ - a tree with 1 flauz-\* manifest\(s\) must carry one/);
});

test('unparseable registry: exit 1, FAIL names the parse problem', () => {
	const dir = copyFixture('clean');
	const registryPath = path.join(dir, 'build', 'flauz', 'packaging-parity.json');
	fs.writeFileSync(registryPath, '{ not json');
	const r = runTool(['--root', dir]);
	assert.equal(r.status, 1, `exit ${r.status}\n${r.out}\n${r.err}`);
	assert.match(r.out, /FAIL  registry .+: not valid JSON/);
});

// ---------------------------------------------------------------------------------------------
// case family 7: --registry override, --no-fail, usage, --help
// ---------------------------------------------------------------------------------------------

test('--registry override: routing the clean registry at the clean tree passes, at a missing path fails', () => {
	const ok = runTool(['--root', fixture('clean'), '--registry', fixture('clean/build/flauz/packaging-parity.json')]);
	assert.equal(ok.status, 0, `exit ${ok.status}\n${ok.out}\n${ok.err}`);
	const missing = runTool(['--root', fixture('clean'), '--registry', path.join(TMP_ROOT, 'no-such-registry.json')]);
	assert.equal(missing.status, 1, `exit ${missing.status}\n${missing.out}\n${missing.err}`);
	assert.match(missing.out, /FAIL  no parity registry at/);
});

test('--no-fail: drift reported but exit 0', () => {
	const r = runTool(['--root', fixture('drifted/key-value'), '--no-fail']);
	assert.equal(r.status, 0, `exit ${r.status}\n${r.out}\n${r.err}`);
	assert.match(r.out, /DRIFT extensions\/flauz-demo :: extension packaging posture/);
});

test('usage error: unknown flag -> exit 2, error line on stderr, usage on stdout', () => {
	const r = runTool(['--definitely-not-a-flag']);
	assert.equal(r.status, 2, `exit ${r.status}\n${r.out}\n${r.err}`);
	assert.match(r.err, /usage error: Unknown option '--definitely-not-a-flag'/);
	assert.match(r.out, /packaging-parity\.mjs - web\/desktop packaging parity gate/);
	assert.match(r.out, /Exit codes: 0 clean\/SKIP ; 1 drift\/violation ; 2 usage error\./);
});

test('--help: exit 0, single-line options, exit-code contract documented', () => {
	const r = runTool(['--help']);
	assert.equal(r.status, 0, `exit ${r.status}\n${r.out}\n${r.err}`);
	assert.match(r.out, /--root <dir>       root dir of the tree to classify/);
	assert.match(r.out, /--registry <file>  parity registry path/);
	assert.match(r.out, /Exit codes: 0 clean\/SKIP ; 1 drift\/violation ; 2 usage error\./);
	// STYLE LAW: usage/option entries are single lines.
	for (const line of r.out.split('\n')) {
		if (/^\s+--/.test(line)) {
			assert.equal(line.trim().split(/\s{2,}/).length <= 2 ? 0 : 1, 0, `usage option line is not single-entry: ${line}`);
		}
	}
});

// ---------------------------------------------------------------------------------------------
// case family 8: the real-repo pin - the committed registry classifies the live tree
// ---------------------------------------------------------------------------------------------

test('real repo: committed registry vs live tree -> exit 0 CLEAN with the nine extensions covered', () => {
	const r = runTool(['--root', REPO_ROOT, '--require']);
	assert.equal(r.status, 0, `exit ${r.status}\n${r.out}\n${r.err}`);
	// PLATFORM-H1 (2026-09-28): flauz-execution + flauz-memory gained their first
	// rows (3 each) and flauz-models gained the two node-bound TL2-002 rows
	// (adapter wire plumbing + fabric wiring) after its seam citation was
	// narrowed - 28 -> 36 rows, 7 -> 9 extensions.
	assert.match(r.out, /packaging-parity: CLEAN \(9 extension\(s\) covered, 36 rows, 0 drift, 0 violations\)/);
	for (const name of ['flauz-agent', 'flauz-browser', 'flauz-environments', 'flauz-execution', 'flauz-memory', 'flauz-models', 'flauz-resources', 'flauz-workflow', 'flauz-workspace']) {
		assert.match(r.out, new RegExp(`extensions/${name}\\s+packaging=web-blocked`));
	}
});

// ---------------------------------------------------------------------------------------------
// case family 9: PP6 packaged-asset presence (P2-FIX-108) - manifest-declared
// ---------------------------------------------------------------------------------------------

test('PP6 clean: flauz-demo ships its declared fixtures/ -> exit 0 with a PP6 PASS row', () => {
	const r = runTool(['--root', fixture('clean'), '--require']);
	assert.equal(r.status, 0, `exit ${r.status}\n${r.out}\n${r.err}`);
	assert.match(r.out, /PASS  PP6 flauz-demo: packaged assets present \(1 declared\)/);
});

test('PP6 absent asset: the declared fixtures/ removed from the tree -> exit 1, FAIL names it', () => {
	const dir = copyFixture('clean');
	fs.rmSync(path.join(dir, 'extensions', 'flauz-demo', 'fixtures'), { recursive: true, force: true });
	const r = runTool(['--root', dir]);
	assert.equal(r.status, 1, `exit ${r.status}\n${r.out}\n${r.err}`);
	assert.match(r.out, /FAIL  PP6 flauz-demo: packaged asset 'fixtures' declared but absent from the packaged tree/);
});

test('PP6 malformed declaration: flauzPackagedAssets escaping the extension root -> exit 1', () => {
	const dir = copyFixture('clean');
	const manifestPath = path.join(dir, 'extensions', 'flauz-demo', 'package.json');
	const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
	manifest.flauzPackagedAssets = ['../escape'];
	fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, '\t') + '\n');
	const r = runTool(['--root', dir]);
	assert.equal(r.status, 1, `exit ${r.status}\n${r.out}\n${r.err}`);
	assert.match(r.out, /FAIL  PP6 flauz-demo: malformed flauzPackagedAssets/);
});
