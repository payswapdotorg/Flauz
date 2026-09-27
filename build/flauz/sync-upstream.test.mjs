#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Tests for build/flauz/scripts/sync-upstream.mjs (TL1-001 — the deterministic
// upstream-sync lane).
//
// Run with:
//   node --test build/flauz/sync-upstream.test.mjs
//
// Every case constructs a TINY fixture git repository in a temp dir at setup
// (nothing under test/fixtures/, never a committed .git directory) and drives
// the real CLI: exit codes + stdout content are asserted. Case families per
// the work order: clean additive delta → 0 + report rows; shared-file
// modification → 1 + named paths (+ --no-fail → 0); ahead/behind counting;
// --plan with a constructed conflict; usage errors → 2. Plus the edge cases
// that keep the gate honest: the src/vs pristine assertion, allowlist
// suppression, added-outside-namespace, and the empty-census SKIP.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '..', '..'); // build/flauz -> repo root
const SCRIPT = path.join(REPO_ROOT, 'build', 'flauz', 'scripts', 'sync-upstream.mjs');

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'flauz-sync-test-'));
test.after(() => { fs.rmSync(TMP_ROOT, { recursive: true, force: true }); });

// ---------------------------------------------------------------------------------------------
// fixture-harness helpers
// ---------------------------------------------------------------------------------------------

function git(dir, args) {
        const r = spawnSync('git', ['-C', dir, '-c', 'core.quotePath=false', ...args], { encoding: 'utf8' });
        assert.equal(r.status, 0, `git ${args.join(' ')} in ${dir} failed:\n${r.stderr}`);
        return r.stdout;
}

// A tiny repo: branch 'main' checked out, with a local branch 'upstream/main'
// parked at the shared base commit (the tool resolves --base upstream/main
// locally before its origin/<ref> fallback).
function makeFixture(name) {
        const dir = path.join(TMP_ROOT, name);
        fs.mkdirSync(dir, { recursive: true });
        git(dir, ['init', '-q', '-b', 'main']);
        git(dir, ['config', 'user.email', 'fixture@example.invalid']);
        git(dir, ['config', 'user.name', 'Flauz Fixture']);
        const api = {
                dir,
                write(rel, content) {
                        const p = path.join(dir, rel);
                        fs.mkdirSync(path.dirname(p), { recursive: true });
                        fs.writeFileSync(p, content);
                },
                commit(msg) { git(dir, ['add', '-A']); git(dir, ['commit', '-qm', msg]); },
        };
        // the shared base: upstream-owned files the product line must not fork casually
        api.write('README.md', 'upstream readme\n');
        api.write('shared.txt', 'base content\n');
        api.write('src/vs/base/common/core.txt', 'upstream core\n');
        api.write('extensions/git/package.json', '{ "name": "git" }\n');
        api.commit('base: shared upstream files');
        git(dir, ['branch', 'upstream/main']); // the preserved reference line
        return api;
}

function runTool(args, opts = {}) {
        const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
        return { status: r.status, out: r.stdout || '', err: r.stderr || '' };
}

// ---------------------------------------------------------------------------------------------
// case family 1: clean additive delta → 0 + report rows
// ---------------------------------------------------------------------------------------------

test('clean additive delta: flauz-owned additions only → exit 0, rows listed, CLEAN verdict', () => {
        const f = makeFixture('clean-additive');
        f.write('build/flauz/gate.mjs', '// flauz gate\n');
        f.write('extensions/flauz-agent/package.json', '{ "name": "flauz-agent" }\n');
        f.write('test/fixtures/case.json', '{}\n');
        f.write('.github/workflows/flauz-ci.yml', 'name: flauz-ci\n');
        f.commit('flauz: additive product work');

        const r = runTool(['--report', '--repo', f.dir, '--base', 'upstream/main']);
        assert.equal(r.status, 0, `exit ${r.status}\n${r.out}\n${r.err}`);
        assert.match(r.out, /PRISTINE  src\/vs divergence outside contrib\/flauz: NONE/);
        assert.match(r.out, / A  build\/flauz\/gate\.mjs/);
        assert.match(r.out, / A  extensions\/flauz-agent\/package\.json/);
        assert.match(r.out, / A  test\/fixtures\/case\.json/);
        assert.match(r.out, / A  \.github\/workflows\/flauz-ci\.yml/);
        assert.match(r.out, /UPSTREAM-DELTA: CLEAN/);

        const j = runTool(['--report', '--json', '--repo', f.dir, '--base', 'upstream/main']);
        assert.equal(j.status, 0);
        const report = JSON.parse(j.out);
        assert.equal(report.verdict, 'CLEAN');
        assert.equal(report.counts.addedFlauzOwned, 4);
        assert.equal(report.counts.sharedDivergent, 0);
        assert.equal(report.counts.addedOutsideNamespace, 0);
        assert.equal(report.pristine.pristine, true);
});

// ---------------------------------------------------------------------------------------------
// case family 2: shared-file modification → 1 + named paths; --no-fail → 0
// ---------------------------------------------------------------------------------------------

test('shared-file modification: unallowlisted → exit 1, path named in FAIL row and verdict', () => {
        const f = makeFixture('shared-mod');
        f.write('README.md', 'product-modified readme\n');
        f.commit('flauz: touch a shared upstream file');

        const r = runTool(['--report', '--repo', f.dir, '--base', 'upstream/main']);
        assert.equal(r.status, 1, `exit ${r.status}\n${r.out}\n${r.err}`);
        assert.match(r.out, / M  README\.md/);
        assert.match(r.out, /FAIL  shared-file divergence: M README\.md/);
        assert.match(r.out, /UPSTREAM-DELTA: DIVERGENT/);
});

test('shared-file modification with --no-fail: same rows, exit 0 (informational)', () => {
        const f = makeFixture('shared-mod-nofail');
        f.write('README.md', 'product-modified readme\n');
        f.commit('flauz: touch a shared upstream file');

        const r = runTool(['--report', '--repo', f.dir, '--base', 'upstream/main', '--no-fail']);
        assert.equal(r.status, 0, `exit ${r.status}\n${r.out}\n${r.err}`);
        assert.match(r.out, / M  README\.md/);
        assert.match(r.out, /UPSTREAM-DELTA: DIVERGENT/);
        assert.match(r.out, /informational run, --no-fail/);
});

test('shared-file modification covered by the allowlist: exit 0, row carries the recorded reason', () => {
        const f = makeFixture('shared-mod-allowlisted');
        f.write('README.md', 'product-modified readme\n');
        f.commit('flauz: touch a shared upstream file');
        const allowlist = path.join(f.dir, 'sync-allowlist.json');
        fs.writeFileSync(allowlist, JSON.stringify({
                entries: [{ path: 'README.md', reason: 'fixture-recorded intentional divergence', date: '2026-09-27' }],
        }, null, '\t'));

        const r = runTool(['--report', '--repo', f.dir, '--base', 'upstream/main', '--allowlist', 'sync-allowlist.json']);
        assert.equal(r.status, 0, `exit ${r.status}\n${r.out}\n${r.err}`);
        assert.match(r.out, / M  README\.md  \[allowlisted 2026-09-27: fixture-recorded intentional divergence\]/);
        assert.match(r.out, /UPSTREAM-DELTA: CLEAN/);

        const j = runTool(['--report', '--json', '--repo', f.dir, '--base', 'upstream/main', '--allowlist', 'sync-allowlist.json']);
        assert.equal(j.status, 0);
        assert.equal(JSON.parse(j.out).counts.sharedAllowlisted, 1);
});

// ---------------------------------------------------------------------------------------------
// case family 3: ahead/behind counting (head diverged from the reference line)
// ---------------------------------------------------------------------------------------------

test('ahead/behind counting: diverged lines are reported both ways (and the not-yet-absorbed upstream paths show as shared-class rows)', () => {
        const f = makeFixture('ahead-behind');
        f.write('build/flauz/new-gate.mjs', '// product work\n');
        f.commit('product commit on main');               // main is now 1 ahead...
        git(f.dir, ['checkout', '-q', 'upstream/main']);
        f.write('src/vs/base/common/new-feature.ts', '// upstream moves on\n');
        f.commit('upstream commit on the reference line'); // ...and 1 behind
        git(f.dir, ['checkout', '-q', 'main']);

        const j = runTool(['--report', '--json', '--repo', f.dir, '--base', 'upstream/main']);
        assert.equal(j.status, 1); // trees diverge beyond flauz-owned additions (README-untouched but new-feature.ts unabsorbed)
        const report = JSON.parse(j.out);
        assert.equal(report.ahead, 1);
        assert.equal(report.behind, 1);
        // the upstream-only path reads as DELETED in the direct tree census — the
        // documented cross-read: behind > 0 means "run the sync", not "flauz deleted it"
        assert.ok(report.sharedFiles.divergent.some((d) => d.path === 'src/vs/base/common/new-feature.ts' && d.status === 'D'),
                `expected new-feature.ts as a D row, got ${JSON.stringify(report.sharedFiles)}`);
});

// ---------------------------------------------------------------------------------------------
// case family 4: --plan with a constructed conflict (conflicts are DATA, exit 0)
// ---------------------------------------------------------------------------------------------

test('--plan with a constructed conflict: exit 0, conflicted path listed with both-sides classification', () => {
        const f = makeFixture('plan-conflict');
        f.write('shared.txt', 'flauz side\n');
        f.write('build/flauz/keep.md', 'flauz-owned additive\n');
        f.commit('product work on main');
        git(f.dir, ['checkout', '-q', 'upstream/main']);
        f.write('shared.txt', 'upstream side\n');
        f.commit('upstream work on the reference line');
        git(f.dir, ['checkout', '-q', 'main']);

        const r = runTool(['--plan', '--repo', f.dir, '--target', 'upstream/main']);
        assert.equal(r.status, 0, `exit ${r.status}\n${r.out}\n${r.err}`);
        assert.match(r.out, /CONFLICT  shared\.txt — flauz: MODIFIED · upstream: MODIFIED/);
        assert.match(r.out, /SYNC PLAN: PLAN PRODUCED — 1 conflict path\(s\)/);
        assert.match(r.out, /checkpoint tag: flauz\/sync\/\d{4}-\d{2}-\d{2}/);
        assert.match(r.out, /REMINDER  flauz-owned additive paths auto-resolve/);

        const j = runTool(['--plan', '--json', '--repo', f.dir, '--target', 'upstream/main']);
        assert.equal(j.status, 0);
        const plan = JSON.parse(j.out);
        assert.equal(plan.mergeDryRun.clean, false);
        assert.equal(plan.mergeDryRun.conflictCount, 1);
        assert.deepEqual(plan.mergeDryRun.conflicts[0], { path: 'shared.txt', flauz: 'MODIFIED', upstream: 'MODIFIED' });
        assert.equal(plan.ahead, 1);
        assert.equal(plan.behind, 1);
});

test('--plan on a clean merge: exit 0, CLEAN dry-run line', () => {
        const f = makeFixture('plan-clean');
        f.write('build/flauz/keep.md', 'flauz-owned additive\n');
        f.commit('product work on main, no shared-file overlap');

        const r = runTool(['--plan', '--repo', f.dir, '--target', 'upstream/main']);
        assert.equal(r.status, 0, `exit ${r.status}\n${r.out}\n${r.err}`);
        assert.match(r.out, /CLEAN  dry-run merge of upstream\/main into HEAD: no conflicts/);
});

// ---------------------------------------------------------------------------------------------
// case family 5: usage errors → 2
// ---------------------------------------------------------------------------------------------

test('usage errors: unknown flag → 2; missing mode → 2; unresolvable base ref → 2', () => {
        const f = makeFixture('usage');

        assert.equal(runTool(['--definitely-not-a-flag']).status, 2);
        assert.equal(runTool([]).status, 2); // exactly one of --report/--plan required
        assert.equal(runTool(['--report', '--plan']).status, 2);
        const badBase = runTool(['--report', '--repo', f.dir, '--base', 'no-such-ref-anywhere']);
        assert.equal(badBase.status, 2);
        assert.match(badBase.err, /base ref 'no-such-ref-anywhere' does not resolve/);
});

// ---------------------------------------------------------------------------------------------
// edge cases that keep the gate honest
// ---------------------------------------------------------------------------------------------

test('src/vs modification: pristine assertion FAILs and the path is named (FORK-CRITICAL class)', () => {
        const f = makeFixture('pristine-fail');
        f.write('src/vs/base/common/core.txt', 'forked core\n');
        f.commit('flauz: forbidden src/vs change');

        const r = runTool(['--report', '--repo', f.dir, '--base', 'upstream/main']);
        assert.equal(r.status, 1, `exit ${r.status}\n${r.out}\n${r.err}`);
        assert.match(r.out, /FAIL  src\/vs NOT pristine outside contrib\/flauz \(1 path\(s\)\):/);
        assert.match(r.out, /FORK-CRITICAL  src\/vs\/base\/common\/core\.txt/);
});

test('added path outside the flauz namespace: exit 1, placement-law FAIL row', () => {
        const f = makeFixture('outside-namespace');
        f.write('random-upstream-file.js', '// not a flauz-owned path\n');
        f.commit('flauz: addition outside the additive namespace');

        const r = runTool(['--report', '--repo', f.dir, '--base', 'upstream/main']);
        assert.equal(r.status, 1, `exit ${r.status}\n${r.out}\n${r.err}`);
        assert.match(r.out, /FAIL  added outside the flauz namespace: random-upstream-file\.js/);
});

test('empty census (head == base): documented SKIP, exit 0', () => {
        const f = makeFixture('empty-delta'); // no commits after parking upstream/main

        const r = runTool(['--report', '--repo', f.dir, '--base', 'upstream/main']);
        assert.equal(r.status, 0, `exit ${r.status}\n${r.out}\n${r.err}`);
        assert.match(r.out, /SKIP  empty census/);
        assert.match(r.out, /UPSTREAM-DELTA: SKIP/);
});

test('--report --out writes the markdown delta document (regeneration shape of build/flauz/UPSTREAM-DELTA.md)', () => {
        const f = makeFixture('out-doc');
        f.write('build/flauz/keep.md', 'flauz-owned additive\n');
        f.commit('product work');

        const out = path.join(f.dir, 'UPSTREAM-DELTA.md');
        const r = runTool(['--report', '--repo', f.dir, '--base', 'upstream/main', '--out', out]);
        assert.equal(r.status, 0, `exit ${r.status}\n${r.out}\n${r.err}`);
        const doc = fs.readFileSync(out, 'utf8');
        assert.match(doc, /# Flauz upstream delta report/);
        assert.match(doc, /## src\/vs pristine assertion/);
        assert.match(doc, /\*\*PASS\*\*/);
        assert.match(doc, /## Census — added paths \(1 flauz-owned\)/);
        assert.match(doc, /## Regeneration/);
});
