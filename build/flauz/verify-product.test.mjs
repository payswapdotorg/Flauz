/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Tests for build/flauz/scripts/verify-product.mjs (TL1-002 — the merged
// product posture gate).
//
// Run with:
//   node --test build/flauz/verify-product.test.mjs
//
// Case families per the work order (every rule has a case that makes it FAIL —
// a gate that cannot fail is not a gate): clean pass; branding violation
// (nameShort "Visual Studio Code"); Copilot defaultChatAgent surviving
// (null-delete lost); a flauz extension's proposal missing; inclusion-posture
// violations (the REAL mechanisms: builtInExtensions listing, excludedExtensions
// list, missing src/extension.ts, missing package.json, main convention);
// unknown-key warning posture; plus the honest extras the audit surfaced
// (registry drift, invented grant, stale grant, proposal drift, copilot residue,
// invalid overlay, --json shape, SKIP/--require flip, --no-fail, usage errors).
//
// The fixtures are the committed trees under test/fixtures/product-shell/; the
// suite drives the real CLI (exit codes + stdout content) like
// sync-upstream.test.mjs, and additionally asserts content-level results via
// the exported analyzeProductShell() on the REAL tree.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { analyzeProductShell, BRANDING_EXEMPTIONS, DOCUMENTED_EMPTY_MANIFEST_GRANTS } from './scripts/verify-product.mjs';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '..', '..'); // build/flauz -> repo root
const SCRIPT = path.join(REPO_ROOT, 'build', 'flauz', 'scripts', 'verify-product.mjs');
const FIXTURES = path.join(REPO_ROOT, 'test', 'fixtures', 'product-shell');

function runGate(args) {
		const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
		return { status: r.status, out: r.stdout || '', err: r.stderr || '' };
}

// ---------------------------------------------------------------------------------------------
// case family 1: clean pass (fixture + the real tree)
// ---------------------------------------------------------------------------------------------

test('clean fixture: exit 0, CLEAN verdict, zero FAIL rows', () => {
		const r = runGate(['--root', path.join(FIXTURES, 'clean'), '--require']);
		assert.equal(r.status, 0, `expected exit 0, got ${r.status}\nstdout:\n${r.out}\nstderr:\n${r.err}`);
		assert.match(r.out, /verify-product: CLEAN \(\d+ pass, 0 warn, 0 skip\)/);
		assert.doesNotMatch(r.out, /^FAIL/m);
		assert.match(r.out, /PS2  identity: merged nameShort\/nameLong are "Flauz"/);
		assert.match(r.out, /PS3  defaultChatAgent is ABSENT/);
});

test('real tree: exit 0 under --require (the CI shape)', () => {
		const r = runGate(['--root', REPO_ROOT, '--require']);
		assert.equal(r.status, 0, `expected exit 0, got ${r.status}\nstdout:\n${r.out}\nstderr:\n${r.err}`);
		assert.match(r.out, /verify-product: CLEAN/);
		assert.match(r.out, /PS4  all granted proposals exist in the registry/);
});

test('real tree content-level: analyzeProductShell reports the audited posture', () => {
		const result = analyzeProductShell(REPO_ROOT);
		assert.equal(result.verdict, 'CLEAN');
		assert.equal(result.violations, 0);
		assert.equal(result.merged.nameShort, 'Flauz');
		assert.equal(result.merged.nameLong, 'Flauz');
		assert.equal(result.merged.applicationName, 'flauz');
		assert.equal(result.merged.hasDefaultChatAgent, false);
		assert.deepEqual(
				[...result.merged.proposalEntries].sort(),
				['flauz.flauz-agent', 'flauz.flauz-browser', 'flauz.flauz-workspace']
		);
		// the documented DL-4 grant table pins the flauz-agent default-participant pattern
		assert.deepEqual([...DOCUMENTED_EMPTY_MANIFEST_GRANTS.keys()], ['flauz.flauz-agent']);
		// the branding exemptions are exactly the four documented keys
		assert.deepEqual([...BRANDING_EXEMPTIONS.keys()].sort(), ['licenseUrl', 'serverLicenseUrl', 'voiceWsUrl', 'webviewContentExternalBaseUrlTemplate'].sort());
});

// ---------------------------------------------------------------------------------------------
// case family 2: branding violations (PS2)
// ---------------------------------------------------------------------------------------------

test('branding violation (nameShort "Visual Studio Code"): exit 1, identity + sweep fire', () => {
		const r = runGate(['--root', path.join(FIXTURES, 'fail-branding'), '--require']);
		assert.equal(r.status, 1);
		assert.match(r.out, /PS2  identity: merged nameShort="Visual Studio Code"/);
		assert.match(r.out, /PS2  branding sweep: merged "nameShort" = "Visual Studio Code" names a Microsoft\/VS Code product/);
});

test('branding violation (url left at the Microsoft repo): the sweep fires independently of identity equality', () => {
		const r = runGate(['--root', path.join(FIXTURES, 'fail-branding-url'), '--require']);
		assert.equal(r.status, 1);
		assert.match(r.out, /PS2  branding sweep: merged "reportIssueUrl" = "https:\/\/github.com\/microsoft\/vscode\/issues\/new" names a Microsoft\/VS Code product/);
		assert.doesNotMatch(r.out, /PS2  identity: merged nameShort="Visual Studio Code"/);
});

// ---------------------------------------------------------------------------------------------
// case family 3: Copilot wiring violations (PS3)
// ---------------------------------------------------------------------------------------------

test('copilot defaultChatAgent surviving (null-delete lost): exit 1, PS3 fires', () => {
		const r = runGate(['--root', path.join(FIXTURES, 'fail-copilot-agent'), '--require']);
		assert.equal(r.status, 1);
		assert.match(r.out, /PS3  merged product still carries defaultChatAgent — the overlay null-delete \(DL-16\) was lost/);
});

test('copilot residue (auto-update list keeps GitHub.copilot-chat): exit 1, PS3 fires', () => {
		const r = runGate(['--root', path.join(FIXTURES, 'fail-copilot-residue'), '--require']);
		assert.equal(r.status, 1);
		assert.match(r.out, /PS3  builtInExtensionsEnabledWithAutoUpdates still names Copilot extension\(s\): GitHub\.copilot-chat/);
});

// ---------------------------------------------------------------------------------------------
// case family 4: proposal violations (PS4)
// ---------------------------------------------------------------------------------------------

test('flauz extension proposal missing: exit 1, PS4 names the WILL-BE-BROKEN hazard', () => {
		const r = runGate(['--root', path.join(FIXTURES, 'fail-proposal-missing'), '--require']);
		assert.equal(r.status, 1);
		assert.match(r.out, /PS4  extensions\/flauz-browser declares enabledApiProposals \[browser\] but the merged product has no "flauz\.flauz-browser" entry/);
		assert.match(r.out, /WILL BE BROKEN/);
});

test('proposal drift (product grants more than the manifest declares): exit 1', () => {
		const r = runGate(['--root', path.join(FIXTURES, 'fail-proposal-drift'), '--require']);
		assert.equal(r.status, 1);
		assert.match(r.out, /PS4  "flauz\.flauz-browser" must force-enable exactly the manifest set \[browser\] — merged grants \[browser, chatParticipantAdditions\]/);
});

test('unknown proposal (registry drift): exit 1 — a dropped proposal is not force-enabled', () => {
		const r = runGate(['--root', path.join(FIXTURES, 'fail-unknown-proposal'), '--require']);
		assert.equal(r.status, 1);
		assert.match(r.out, /PS4  unknown proposal name\(s\) granted: flauz\.flauz-workspace: scmArtifactProvider/);
		assert.match(r.out, /extensionsProposedApi\.ts:46-52 DROPS them/);
});

test('invented grant (empty-manifest extension gets proposals): exit 1', () => {
		const r = runGate(['--root', path.join(FIXTURES, 'fail-invented-grant'), '--require']);
		assert.equal(r.status, 1);
		assert.match(r.out, /PS4  "flauz\.flauz-models" declares NO proposals but the merged product grants \[aiTextSearchProvider\]/);
});

test('stale grant (no such extension in the tree): exit 1', () => {
		const r = runGate(['--root', path.join(FIXTURES, 'fail-stale-grant'), '--require']);
		assert.equal(r.status, 1);
		assert.match(r.out, /PS4  "flauz\.flauz-nope" grants proposals but no extensions\/flauz-\* manifest in this tree declares that identity/);
});

// ---------------------------------------------------------------------------------------------
// case family 5: inclusion-posture violations (PS5 — the REAL mechanisms)
// ---------------------------------------------------------------------------------------------

test('inclusion violation (builtInExtensions lists a flauz name): exit 1, PS5 cites extensions.ts:425', () => {
		const r = runGate(['--root', path.join(FIXTURES, 'fail-inclusion-builtin'), '--require']);
		assert.equal(r.status, 1);
		assert.match(r.out, /PS5  merged builtInExtensions lists flauz extension name\(s\) flauz-agent/);
		assert.match(r.out, /build\/lib\/extensions\.ts:425 EXCLUDES/);
});

test('inclusion violation (excludedExtensions lists a flauz name): exit 1', () => {
		const r = runGate(['--root', path.join(FIXTURES, 'fail-excluded-list'), '--require']);
		assert.equal(r.status, 1);
		assert.match(r.out, /PS5  build\/lib\/extensions\.ts excludedExtensions lists flauz-agent/);
});

test('inclusion violation (no src/extension.ts — invisible to bundle-extensions): exit 1', () => {
		const r = runGate(['--root', path.join(FIXTURES, 'fail-missing-src'), '--require']);
		assert.equal(r.status, 1);
		assert.match(r.out, /PS5  extensions\/flauz-models has no src\/extension\.ts — invisible to bundle-extensions\.mjs discovery/);
});

test('inclusion violation (no package.json — invisible to the packaging glob): exit 1', () => {
		const r = runGate(['--root', path.join(FIXTURES, 'fail-missing-manifest'), '--require']);
		assert.equal(r.status, 1);
		assert.match(r.out, /PS5  extensions\/flauz-models has no package\.json — invisible to the packaging glob/);
});

test('inclusion violation (main outside the bundle outfile convention): exit 1', () => {
		const r = runGate(['--root', path.join(FIXTURES, 'fail-main-convention'), '--require']);
		assert.equal(r.status, 1);
		assert.match(r.out, /PS5  extensions\/flauz-models: main "\.\/out\/extension\.js".*bundle-extensions\.mjs hardcodes the outfile/);
});

// ---------------------------------------------------------------------------------------------
// case family 6: overlay validation + unknown-key warning posture (PS1)
// ---------------------------------------------------------------------------------------------

test('invalid overlay (nameShort not a string): exit 1, PS1 reports the validateOverlay rejection', () => {
		const r = runGate(['--root', path.join(FIXTURES, 'fail-invalid-overlay'), '--require']);
		assert.equal(r.status, 1);
		assert.match(r.out, /PS1  validateOverlay rejected the committed overlay: overlay key "nameShort" must be a non-empty string \(got 42\)/);
});

test('unknown-key warning posture: exit 0 with a WARN row (DL-17 — warn, do not fail)', () => {
		const r = runGate(['--root', path.join(FIXTURES, 'warn-unknown-key'), '--require']);
		assert.equal(r.status, 0, `expected exit 0, got ${r.status}\nstdout:\n${r.out}\nstderr:\n${r.err}`);
		assert.match(r.out, /WARN  PS1  overlay sets unknown key "identifier"/);
		assert.match(r.out, /DL-17: unknown keys are omitted, not guessed/);
});

// ---------------------------------------------------------------------------------------------
// case family 7: SKIP / --require / --no-fail / --json / usage
// ---------------------------------------------------------------------------------------------

test('tree without the product shell: documented SKIP (exit 0); --require flips it (exit 1)', () => {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flauz-vp-empty-'));
		try {
				const skip = runGate(['--root', tmp]);
				assert.equal(skip.status, 0);
				assert.match(skip.out, /SKIP  product shell not present/);

				const required = runGate(['--root', tmp, '--require']);
				assert.equal(required.status, 1);
				assert.match(required.out, /FAIL  GATE  --require: product shell not present/);
		} finally {
				fs.rmSync(tmp, { recursive: true, force: true });
		}
});

test('single-file absence (product.json without the overlay): same SKIP/--require contract', () => {
		const r = runGate(['--root', path.join(FIXTURES, 'fail-no-overlay')]);
		assert.equal(r.status, 0);
		assert.match(r.out, /SKIP  product shell not present/);
		const required = runGate(['--root', path.join(FIXTURES, 'fail-no-overlay'), '--require']);
		assert.equal(required.status, 1);
});

test('--no-fail: violations listed but exit 0 (report-only)', () => {
		const r = runGate(['--root', path.join(FIXTURES, 'fail-copilot-agent'), '--no-fail']);
		assert.equal(r.status, 0);
		assert.match(r.out, /PS3  merged product still carries defaultChatAgent/);
});

test('--json: single parseable object with verdict/counts/rows/merged', () => {
		const r = runGate(['--root', path.join(FIXTURES, 'clean'), '--json']);
		assert.equal(r.status, 0);
		const report = JSON.parse(r.out);
		assert.equal(report.gate, 'verify-product');
		assert.equal(report.verdict, 'CLEAN');
		assert.equal(report.counts.fail, 0);
		assert.ok(Array.isArray(report.rows) && report.rows.length > 0);
		assert.equal(report.merged.nameShort, 'Flauz');
		assert.equal(report.merged.hasDefaultChatAgent, false);

		const bad = runGate(['--root', path.join(FIXTURES, 'fail-branding'), '--json']);
		assert.equal(bad.status, 1);
		const badReport = JSON.parse(bad.out);
		assert.equal(badReport.verdict, 'VIOLATIONS');
		assert.ok(badReport.counts.fail >= 1);
		assert.ok(badReport.rows.some(row => row.status === 'FAIL' && row.rule === 'PS2'));
});

test('usage errors: unknown flag and --require+--no-fail exit 2; --help exits 0', () => {
		assert.equal(runGate(['--bogus']).status, 2);
		assert.equal(runGate(['--require', '--no-fail']).status, 2);
		const help = runGate(['--help']);
		assert.equal(help.status, 0);
		assert.match(help.out, /verify-product\.mjs — merged product posture gate \(TL1-002\)/);
		assert.match(help.out, /Exit codes: 0 clean\/SKIP · 1 violation · 2 usage error/);
});
