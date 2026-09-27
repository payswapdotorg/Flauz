#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// ---------------------------------------------------------------------------------------------
// Flauz TL4 (product-quality lane) — Worker B, task TL4-003.
//
// compat-battery.mjs — Code OSS compatibility battery (layers 1 + 2).
//
// Mission: machine-check that Flauz only ADDS to Code OSS. The fork-critical
// guard (layer 1) proves src/vs source purity; THIS battery adds layer 2: the
// contribution-surface diff — every stock extension manifest entry, the
// product identity (product.json) and the root package.json scripts/deps
// sections are compared between the upstream Code OSS reference line and the
// Flauz product line. A Flauz change that silently deletes a stock command,
// view, menu, keybinding, configuration property, submenu, view container,
// stock extension, stock product property or stock npm script/dependency
// FAILS this gate. Spec: docs/FLAUZ-PROGRAM/TL4-COMPAT-BATTERY.md.
//
// The L2 contract (spec section 3): Flauz may ADD, must never REMOVE, RENAME
// or RETYPE stock contribution entries. "Stock" = everything at the upstream
// side; "Flauz" = the path prefixes extensions/flauz-*/, build/flauz/,
// src/vs/workbench/contrib/flauz/, product.flauz.json and docs/FLAUZ-PROGRAM/
// (spec section 3.2). Anything added outside the Flauz namespace is a
// violation of the additive-placement law (ARCHITECTURE-LOCK sections 4/6)
// and fails until allowlisted.
//
// Layer model:
//   L1 source purity        — invokes build/flauz/scripts/fork-critical-guard.sh
//                             (git mode only; tree-mode sides SKIP).
//   L2 contribution diff    — manifest-level diff of the REQUIRED family set:
//                             commands, keybindings, menus, views,
//                             viewsContainers, configuration, submenus;
//                             + product.json identity rows (identity set
//                             extracted from product.flauz.json);
//                             + root package.json scripts/dependencies/
//                             devDependencies name-presence rows;
//                             + positive control (Flauz itself must exist:
//                             product.flauz.json + the six flauz-* built-ins).
//   L3 runtime smoke        — spec-only at this commit (CI wiring skeleton in
//                             .github/workflows/flauz-compat.yml; needs a
//                             compiled build on a CI runner — spec section 2).
//
// Usage:
//   node compat-battery.mjs [--root <dir>] [--upstream <git-ref|dir>]
//                           [--product <git-ref|dir>] [--allowlist <file>]
//                           [--json] [--layer 1|2|all] [--no-fail] [--require]
//
//   --root <dir>        repository root used for git ref resolution, the
//                       guard script and the default allowlist (default: the
//                       repo containing this script).
//   --upstream <spec>   upstream Code OSS side: a git ref (default:
//                       origin/upstream/main, falling back to upstream/main —
//                       NEVER a product branch: comparing product-vs-product
//                       would vacuously pass) or a plain directory tree
//                       (fixture mode).
//   --product <spec>    product side: git ref (default: HEAD) or a plain
//                       directory tree (fixture mode).
//   --allowlist <file>  intentional-divergence allowlist (default:
//                       <root>/build/flauz/compat-allowlist.json when
//                       present; each entry {path, key, reason, date}).
//   --json              machine output: full row table + meta + counts.
//   --layer 1|2|all     which layers to run (default: all).
//   --no-fail           report-only: violations are printed but exit 0.
//   --require           flip SKIP rows to failures (proves the gate can fire;
//                       used by CI on the real repo where nothing may skip).
//
// Exit codes:
//   0  clean or SKIP-only (or any finding under --no-fail)
//   1  violation(s) — FAIL rows present, or SKIP rows present under --require
//   2  usage error / bad side spec / malformed allowlist
//
// Row shape (--json): {layer, path, key, status: PASS|FAIL|SKIP, detail}.
// A gate that cannot fail is not a gate: every FAIL rule in this battery has
// a fixture under test/fixtures/compat-battery/ that makes it fail, wired
// into build/flauz/scripts/verify-fixtures.sh (spec section 9).
//
// Zero dependencies: node >= 20 stdlib only.
// ---------------------------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const EXIT_OK = 0, EXIT_FAIL = 1, EXIT_USAGE = 2;
const VERSION = 1;

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..'); // .../build/flauz/scripts -> repo root

const GUARD_REL = 'build/flauz/scripts/fork-critical-guard.sh';
const DEFAULT_ALLOWLIST_REL = 'build/flauz/compat-allowlist.json';

// The Flauz built-in set (positive control — spec section 5). If Flauz grows
// a seventh built-in, extend this list (and the spec) in the same commit.
const FLAUZ_BUILTIN_EXTENSIONS = [
        'flauz-agent',
        'flauz-browser',
        'flauz-environments',
        'flauz-models',
        'flauz-workflow',
        'flauz-workspace',
];

// REQUIRED family set (spec section 3.3). Other contributes.* families are
// documented as deferred with rationale (spec section 12).
const CONTRIBUTION_FAMILIES = ['commands', 'keybindings', 'menus', 'views', 'viewsContainers', 'configuration', 'submenus'];

// Root package.json sections under identity protection (name presence only —
// version bumps ride the upstream sync; name removal is the regression signal).
const ROOT_PKG_SECTIONS = ['scripts', 'dependencies', 'devDependencies'];

// NEVER add product branches here (vacuous-pass hazard — spec section 8).
const DEFAULT_UPSTREAM_REFS = ['origin/upstream/main', 'upstream/main'];

const STOCK_MANIFEST_RE = /^extensions\/([^/]+)\/package\.json$/;

const rows = [];
let ROOT = '';
let additionsAllowed = 0;

class UsageError extends Error { }

function usage() {
        process.stdout.write(`compat-battery.mjs — Code OSS compatibility battery (TL4-003; layers 1+2)

Usage:
        node compat-battery.mjs [--root <dir>] [--upstream <git-ref|dir>] [--product <git-ref|dir>]
                                [--allowlist <file>] [--json] [--layer 1|2|all] [--no-fail] [--require]

Sides: a git ref (resolved in --root's repository) or a plain directory tree
       (fixture mode). Defaults: upstream = origin/upstream/main (then
       upstream/main), product = HEAD.

Exit codes: 0 clean/SKIP (or --no-fail) · 1 violation (or SKIP under --require) · 2 usage.
Spec: docs/FLAUZ-PROGRAM/TL4-COMPAT-BATTERY.md
`);
}

// ---------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------

function git(args) {
        const r = spawnSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
        return { ok: r.status === 0, status: r.status, out: r.stdout || '', err: r.stderr || '' };
}

function resolveSide(spec, kind) {
        // plain directory tree (fixture mode)?
        if (fs.existsSync(spec)) {
                if (fs.statSync(spec).isDirectory()) {
                        return { spec, mode: 'tree', dir: path.resolve(spec) };
                }
                throw new UsageError(`--${kind} '${spec}' exists but is not a directory`);
        }
        // git ref?
        const r = git(['rev-parse', '--verify', '--quiet', `${spec}^{commit}`]);
        if (r.ok) {
                return { spec, mode: 'git', ref: spec, sha: r.out.trim() };
        }
        throw new UsageError(`--${kind} '${spec}' is neither an existing directory nor a resolvable git ref in ${ROOT}`);
}

function sideReadFile(side, repoPath) {
        if (side.mode === 'tree') {
                try {
                        return fs.readFileSync(path.join(side.dir, repoPath), 'utf8');
                } catch {
                        return null;
                }
        }
        const r = git(['show', `${side.ref}:${repoPath}`]);
        return r.ok ? r.out : null;
}

function sideListExtensionManifests(side) {
        const out = [];
        if (side.mode === 'tree') {
                let entries = [];
                try {
                        entries = fs.readdirSync(path.join(side.dir, 'extensions'), { withFileTypes: true });
                } catch {
                        return out; // no extensions/ dir -> empty
                }
                for (const e of entries) {
                        if (!e.isDirectory()) { continue; }
                        const mf = `extensions/${e.name}/package.json`;
                        if (fs.existsSync(path.join(side.dir, mf))) { out.push(mf); }
                }
        } else {
                const r = git(['ls-tree', '-r', '--name-only', side.ref, '--', 'extensions/']);
                if (!r.ok) {
                        throw new UsageError(`git ls-tree failed for ref '${side.ref}': ${r.err.trim()}`);
                }
                for (const line of r.out.split('\n')) {
                        if (STOCK_MANIFEST_RE.test(line)) { out.push(line); }
                }
        }
        out.sort();
        return out;
}

function isFlauzManifest(repoPath) {
        const m = STOCK_MANIFEST_RE.exec(repoPath);
        return m !== null && m[1].startsWith('flauz-');
}

function parseJsonOrNull(text) {
        if (text === null) { return { value: null }; }
        try {
                return { value: JSON.parse(text) };
        } catch (e) {
                return { error: e.message };
        }
}

// stable deep-equality string (key order independent)
function stableStringify(v) {
        if (Array.isArray(v)) {
                return `[${v.map(stableStringify).join(',')}]`;
        }
        if (v !== null && typeof v === 'object') {
                const keys = Object.keys(v).sort();
                return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
        }
        return JSON.stringify(v);
}

function pushRow(layer, rowPath, key, status, detail, extra) {
        const row = { layer, path: rowPath, key, status, detail };
        if (extra) { Object.assign(row, extra); }
        rows.push(row);
        return row;
}

// ---------------------------------------------------------------------------------------------
// L2 — contribution extraction (spec section 3.3: key normalization)
// ---------------------------------------------------------------------------------------------

function extractContributionKeys(manifest) {
        const keys = {};
        for (const f of CONTRIBUTION_FAMILIES) { keys[f] = new Set(); }
        const c = manifest && typeof manifest === 'object' ? manifest.contributes : null;
        if (!c || typeof c !== 'object') { return keys; }

        // commands: contributes.commands[].command
        if (Array.isArray(c.commands)) {
                for (const e of c.commands) {
                        if (e && typeof e === 'object' && typeof e.command === 'string') {
                                keys.commands.add(`commands/${e.command}`);
                        }
                }
        }

        // keybindings: contributes.keybindings[] — full platform tuple
        // (command|key|mac|linux|win|when); absent fields normalize to ''
        if (Array.isArray(c.keybindings)) {
                for (const e of c.keybindings) {
                        if (!e || typeof e !== 'object' || typeof e.command !== 'string') { continue; }
                        const tup = [e.command, e.key ?? '', e.mac ?? '', e.linux ?? '', e.win ?? '', e.when ?? ''].join('|');
                        keys.keybindings.add(`keybindings/${tup}`);
                }
        }

        // menus: contributes.menus — the menu-location keys
        if (c.menus && typeof c.menus === 'object' && !Array.isArray(c.menus)) {
                for (const m of Object.keys(c.menus)) {
                        keys.menus.add(`menus/${m}`);
                }
        }

        // views: contributes.views — {container: [{id}, ...]} -> container/id
        if (c.views && typeof c.views === 'object' && !Array.isArray(c.views)) {
                for (const [container, views] of Object.entries(c.views)) {
                        if (!Array.isArray(views)) { continue; }
                        for (const v of views) {
                                if (v && typeof v === 'object' && typeof v.id === 'string') {
                                        keys.views.add(`views/${container}/${v.id}`);
                                }
                        }
                }
        }

        // viewsContainers: {location: [{id}, ...]} -> location/id
        if (c.viewsContainers && typeof c.viewsContainers === 'object' && !Array.isArray(c.viewsContainers)) {
                for (const [location, containers] of Object.entries(c.viewsContainers)) {
                        if (!Array.isArray(containers)) { continue; }
                        for (const v of containers) {
                                if (v && typeof v === 'object' && typeof v.id === 'string') {
                                        keys.viewsContainers.add(`viewsContainers/${location}/${v.id}`);
                                }
                        }
                }
        }

        // configuration: object form {properties} OR array form [{properties}]
        const cfgs = Array.isArray(c.configuration) ? c.configuration : (c.configuration !== undefined ? [c.configuration] : []);
        for (const cfg of cfgs) {
                if (cfg && typeof cfg === 'object' && cfg.properties && typeof cfg.properties === 'object') {
                        for (const p of Object.keys(cfg.properties)) {
                                keys.configuration.add(`configuration/${p}`);
                        }
                }
        }

        // submenus: contributes.submenus[].id
        if (Array.isArray(c.submenus)) {
                for (const e of c.submenus) {
                        if (e && typeof e === 'object' && typeof e.id === 'string') {
                                keys.submenus.add(`submenus/${e.id}`);
                        }
                }
        }

        return keys;
}

// ---------------------------------------------------------------------------------------------
// L2 — manifest diff
// ---------------------------------------------------------------------------------------------

function runLayer2ManifestDiff(upstream, product) {
        const upstreamStock = sideListExtensionManifests(upstream).filter((p) => !isFlauzManifest(p));
        const productStock = sideListExtensionManifests(product).filter((p) => !isFlauzManifest(p));
        const productFlauz = sideListExtensionManifests(product).filter((p) => isFlauzManifest(p));

        if (upstreamStock.length === 0) {
                pushRow(2, 'extensions/', 'stock-set', 'SKIP',
                        'no stock (non-flauz-*) extension manifests found on the UPSTREAM side — wrong ref/tree? ' +
                        'Nothing to protect; escalates to FAIL under --require.');
        }

        const upSet = new Set(upstreamStock);
        const prodSet = new Set(productStock);

        for (const m of upstreamStock) {
                if (!prodSet.has(m)) {
                        pushRow(2, m, 'manifest', 'FAIL', 'stock extension manifest DELETED at the product side (extension removed)');
                        continue;
                }
                const upParsed = parseJsonOrNull(sideReadFile(upstream, m));
                const prodParsed = parseJsonOrNull(sideReadFile(product, m));
                if (upParsed.error || prodParsed.error) {
                        const which = [upParsed.error ? `upstream side: ${upParsed.error}` : '', prodParsed.error ? `product side: ${prodParsed.error}` : ''].filter(Boolean).join('; ');
                        pushRow(2, m, 'manifest', 'FAIL', `manifest no longer parses as JSON (${which})`);
                        continue;
                }
                pushRow(2, m, 'manifest', 'PASS', 'stock manifest present and parses on both sides');
                const upKeys = extractContributionKeys(upParsed.value);
                const prodKeys = extractContributionKeys(prodParsed.value);
                for (const fam of CONTRIBUTION_FAMILIES) {
                        for (const key of upKeys[fam]) {
                                if (prodKeys[fam].has(key)) {
                                        pushRow(2, m, key, 'PASS', `stock ${fam} entry present`);
                                } else {
                                        pushRow(2, m, key, 'FAIL',
                                                `stock contribution entry REMOVED/RENAMED/RETYPEd at the product side (family: ${fam}; ` +
                                                `L2 contract — spec section 3.1). If intentional, add a compat-allowlist.json entry.`);
                                }
                        }
                        for (const key of prodKeys[fam]) {
                                if (!upKeys[fam].has(key)) { additionsAllowed += 1; }
                        }
                }
        }

        // non-flauz-* manifest additions at the product side violate the additive
        // placement law (ARCHITECTURE-LOCK sections 4/6): Flauz additions must
        // live under extensions/flauz-*/ so upstream syncs stay conflict-free.
        for (const m of productStock) {
                if (!upSet.has(m)) {
                        pushRow(2, m, 'manifest', 'FAIL',
                                'extension manifest ADDED outside the flauz-* namespace at the product side ' +
                                '(Flauz additions must live under extensions/flauz-*/; bless an intentional stock ' +
                                'addition via compat-allowlist.json — spec section 7)');
                }
        }

        return { stockCount: upstreamStock.length, flauzCount: productFlauz.length };
}

// ---------------------------------------------------------------------------------------------
// L2 — product.json identity rows (spec section 4)
// ---------------------------------------------------------------------------------------------

function runLayer2ProductIdentity(upstream, product) {
        const upText = sideReadFile(upstream, 'product.json');
        const prodText = sideReadFile(product, 'product.json');
        const overlayText = sideReadFile(product, 'product.flauz.json');

        let identitySet = [];
        let overlayParsed = null;
        if (overlayText !== null) {
                const p = parseJsonOrNull(overlayText);
                if (p.error || !p.value || typeof p.value !== 'object' || Array.isArray(p.value)) {
                        pushRow(2, 'product.flauz.json', 'manifest', 'FAIL', `product.flauz.json is present but not a valid JSON object (${p.error ?? 'not an object'})`);
                } else {
                        overlayParsed = p.value;
                        identitySet = Object.keys(p.value).sort();
                }
        }

        if (upText === null) {
                pushRow(2, 'product.json', 'identity', 'SKIP',
                        'no product.json on the UPSTREAM side — identity rows have nothing to protect; escalates under --require.');
                return identitySet;
        }
        const up = parseJsonOrNull(upText);
        if (up.error) {
                pushRow(2, 'product.json', 'manifest', 'FAIL', `upstream product.json does not parse (${up.error})`);
                return identitySet;
        }

        let prod = {};
        if (prodText === null) {
                pushRow(2, 'product.json', 'manifest', 'FAIL', 'product.json MISSING at the product side (stock product identity file deleted)');
        } else {
                const p = parseJsonOrNull(prodText);
                if (p.error) {
                        pushRow(2, 'product.json', 'manifest', 'FAIL', `product-side product.json does not parse (${p.error})`);
                } else if (p.value && typeof p.value === 'object' && !Array.isArray(p.value)) {
                        prod = p.value;
                } else {
                        pushRow(2, 'product.json', 'manifest', 'FAIL', 'product-side product.json is not a JSON object');
                }
        }

        const stock = up.value;
        for (const key of Object.keys(stock).sort()) {
                const rowKey = `identity/${key}`;
                if (!(key in prod)) {
                        if (overlayParsed !== null && overlayParsed[key] === null) {
                                pushRow(2, 'product.json', rowKey, 'PASS',
                                        `stock product property deleted at the product side BUT covered by the Flauz overlay ` +
                                        `(product.flauz.json sets it to null — merge-product.mjs null-deletes semantics)`);
                        } else {
                                pushRow(2, 'product.json', rowKey, 'FAIL',
                                        'stock product property REMOVED at the product side without an overlay delete ' +
                                        '(product.flauz.json must set it to null to bless the removal)');
                        }
                } else if (stableStringify(prod[key]) === stableStringify(stock[key])) {
                        pushRow(2, 'product.json', rowKey, 'PASS', 'identical to upstream');
                } else if (identitySet.includes(key)) {
                        pushRow(2, 'product.json', rowKey, 'PASS',
                                `changed at the product side but inside the Flauz identity set (product.flauz.json sets this key — ` +
                                `identity set: ${identitySet.join(', ')})`);
                } else {
                        pushRow(2, 'product.json', rowKey, 'FAIL',
                                'stock product property CHANGED at the product side outside the Flauz identity set extracted ' +
                                'from product.flauz.json (spec section 4)');
                }
        }
        for (const key of Object.keys(prod)) {
                if (!(key in stock)) { additionsAllowed += 1; }
        }

        return identitySet;
}

// ---------------------------------------------------------------------------------------------
// L2 — root package.json scripts/dependencies/devDependencies (spec section 4.3)
// ---------------------------------------------------------------------------------------------

function runLayer2RootPackage(upstream, product) {
        const upText = sideReadFile(upstream, 'package.json');
        if (upText === null) {
                return; // nothing stock to protect
        }
        const up = parseJsonOrNull(upText);
        if (up.error) {
                pushRow(2, 'package.json', 'manifest', 'FAIL', `upstream root package.json does not parse (${up.error})`);
                return;
        }

        let prod = null;
        const prodText = sideReadFile(product, 'package.json');
        if (prodText === null) {
                pushRow(2, 'package.json', 'manifest', 'FAIL', 'root package.json MISSING at the product side');
        } else {
                const p = parseJsonOrNull(prodText);
                if (p.error) {
                        pushRow(2, 'package.json', 'manifest', 'FAIL', `product-side root package.json does not parse (${p.error})`);
                } else {
                        prod = p.value && typeof p.value === 'object' && !Array.isArray(p.value) ? p.value : null;
                        if (prod === null) {
                                pushRow(2, 'package.json', 'manifest', 'FAIL', 'product-side root package.json is not a JSON object');
                        }
                }
        }

        for (const section of ROOT_PKG_SECTIONS) {
                const stockSection = up.value[section];
                if (!stockSection || typeof stockSection !== 'object') { continue; }
                const prodSection = prod !== null && prod[section] && typeof prod[section] === 'object' ? prod[section] : {};
                for (const name of Object.keys(stockSection).sort()) {
                        const rowKey = `package.json/${section}/${name}`;
                        if (name in prodSection) {
                                pushRow(2, 'package.json', rowKey, 'PASS', `stock ${section} entry present`);
                        } else {
                                pushRow(2, 'package.json', rowKey, 'FAIL',
                                        `stock root package.json ${section} entry REMOVED at the product side (name-presence check; ` +
                                        `version bumps are not flagged — spec section 4.3)`);
                        }
                }
                for (const name of Object.keys(prodSection)) {
                        if (!(name in stockSection)) { additionsAllowed += 1; }
                }
        }
}

// ---------------------------------------------------------------------------------------------
// L2 — positive control (spec section 5): Flauz itself must exist
// ---------------------------------------------------------------------------------------------

function runLayer2PositiveControl(product) {
        if (sideReadFile(product, 'product.flauz.json') !== null) {
                pushRow(2, 'product.flauz.json', 'positive-control', 'PASS', 'product.flauz.json (Flauz overlay) present at the product side');
        } else {
                pushRow(2, 'product.flauz.json', 'positive-control', 'FAIL',
                        'product.flauz.json MISSING at the product side — the Flauz product overlay vanished');
        }
        for (const name of FLAUZ_BUILTIN_EXTENSIONS) {
                const mf = `extensions/${name}/package.json`;
                if (sideReadFile(product, mf) !== null) {
                        pushRow(2, mf, 'flauz-builtin', 'PASS', `Flauz built-in ${name} present`);
                } else {
                        pushRow(2, mf, 'flauz-builtin', 'FAIL', `Flauz built-in ${name} MISSING at the product side — Flauz itself vanished`);
                }
        }
}

// ---------------------------------------------------------------------------------------------
// L1 — source purity via the existing fork-critical guard
// ---------------------------------------------------------------------------------------------

function runLayer1(upstream, product) {
        if (upstream.mode !== 'git' || product.mode !== 'git') {
                pushRow(1, 'src/vs', 'source-purity', 'SKIP',
                        'L1 needs both sides as git refs (tree-mode fixture sides carry no git history). ' +
                        'L1 is enforced on the real repo and by the guard\'s own fixture cases in verify-fixtures.sh; ' +
                        'escalates to FAIL under --require.');
                return;
        }
        const guard = path.join(ROOT, GUARD_REL);
        if (!fs.existsSync(guard)) {
                throw new UsageError(`fork-critical-guard.sh not found at ${guard} (wrong --root?)`);
        }
        const r = spawnSync('sh', [guard, '--repo', ROOT, '--base', upstream.ref, '--head', product.ref], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
        if (r.status === 0) {
                pushRow(1, 'src/vs', 'source-purity', 'PASS', 'fork-critical-guard PASS — src/vs pristine outside contrib/flauz (FORK-CRITICAL ledger stays EMPTY)');
        } else if (r.status === 1) {
                const detail = `${(r.stdout || '').trim()}\n${(r.stderr || '').trim()}`.trim().split('\n').slice(0, 20).join('\n');
                pushRow(1, 'src/vs', 'source-purity', 'FAIL', `fork-critical-guard FAIL — forbidden src/vs divergence:\n${detail}`);
        } else {
                pushRow(1, 'src/vs', 'source-purity', 'FAIL', `fork-critical-guard could not run (exit ${r.status}): ${(r.stderr || r.stdout || '').trim()}`);
        }
}

// ---------------------------------------------------------------------------------------------
// allowlist (spec section 7) — L2 divergence suppression ONLY. L1 (src/vs) divergence is
// adjudicated by the fork-critical DECISION-LOG process, never by this allowlist.
// ---------------------------------------------------------------------------------------------

function loadAllowlist(explicitFile) {
        let file = explicitFile;
        let explicit = explicitFile !== undefined;
        if (!explicit) {
                const def = path.join(ROOT, DEFAULT_ALLOWLIST_REL);
                if (fs.existsSync(def)) { file = def; } else { return { file: null, entries: [], explicit: false }; }
        }
        const parsed = parseJsonOrNull(fs.readFileSync(file, 'utf8'));
        if (parsed.error || !parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
                throw new UsageError(`allowlist '${file}' is not a valid JSON object${parsed.error ? ` (${parsed.error})` : ''}`);
        }
        const entries = parsed.value.entries;
        if (!Array.isArray(entries)) {
                throw new UsageError(`allowlist '${file}' must have an "entries" array`);
        }
        for (const e of entries) {
                if (!e || typeof e !== 'object' || typeof e.path !== 'string' || typeof e.key !== 'string'
                        || typeof e.reason !== 'string' || typeof e.date !== 'string') {
                        throw new UsageError(`allowlist '${file}' has a malformed entry (need {path, key, reason, date} strings): ${JSON.stringify(e)}`);
                }
        }
        return { file, entries, explicit };
}

function applyAllowlist(allowlist) {
        const index = new Map(allowlist.entries.map((e) => [`${e.path}\u0000${e.key}`, e]));
        let used = 0;
        for (const row of rows) {
                if (row.status !== 'FAIL' || row.layer !== 2) { continue; }
                const entry = index.get(`${row.path}\u0000${row.key}`);
                if (entry) {
                        row.status = 'PASS';
                        row.allowlisted = true;
                        row.detail = `${row.detail} [ALLOWLISTED: ${entry.reason} (${entry.date})]`;
                        used += 1;
                }
        }
        return { used, unused: allowlist.entries.length - used };
}

// ---------------------------------------------------------------------------------------------
// output
// ---------------------------------------------------------------------------------------------

function countBy(status) { return rows.filter((r) => r.status === status).length; }

function layerCounts(layer) {
        const l = rows.filter((r) => r.layer === layer);
        return { rows: l.length, PASS: l.filter((r) => r.status === 'PASS').length, FAIL: l.filter((r) => r.status === 'FAIL').length, SKIP: l.filter((r) => r.status === 'SKIP').length };
}

function humanReport(meta, counts, escalatedSkips) {
        const out = [];
        out.push(`compat-battery: node ${process.versions.node}, root ${ROOT}`);
        out.push(`compat-battery: upstream ${meta.upstream.spec} (${meta.upstream.mode === 'git' ? meta.upstream.sha : 'tree'})`);
        out.push(`compat-battery: product  ${meta.product.spec} (${meta.product.mode === 'git' ? meta.product.sha : 'tree'})`);
        out.push(`compat-battery: stock manifests protected: ${meta.stockManifests}, flauz manifests at product side: ${meta.flauzManifests}`);
        out.push(`compat-battery: product identity set (from product.flauz.json): ${meta.identitySet.length ? meta.identitySet.join(', ') : '(none)'}`);
        out.push(`compat-battery: allowlist ${meta.allowlist.file ?? '(none)'} — ${meta.allowlist.entries} entries, ${meta.allowlist.used} used, ${meta.allowlist.unused} unused`);
        if (meta.layersRun.includes(1)) {
                const c = layerCounts(1);
                out.push(`layer 1 (source purity):        ${c.rows} rows — ${c.PASS} PASS · ${c.FAIL} FAIL · ${c.SKIP} SKIP`);
        }
        if (meta.layersRun.includes(2)) {
                const c = layerCounts(2);
                out.push(`layer 2 (contribution diff):    ${c.rows} rows — ${c.PASS} PASS · ${c.FAIL} FAIL · ${c.SKIP} SKIP`);
        }
        out.push(`compat-battery: additions allowed (Flauz-side adds): ${additionsAllowed}`);
        const failures = rows.filter((r) => r.status === 'FAIL');
        if (failures.length > 0) {
                out.push('compat-battery: FAIL rows:');
                const shown = failures.slice(0, 50);
                for (const f of shown) {
                        out.push(`  [L${f.layer}] ${f.path}  ${f.key}`);
                        for (const line of f.detail.split('\n')) { out.push(`          ${line}`); }
                }
                if (failures.length > shown.length) {
                        out.push(`  ... and ${failures.length - shown.length} more (use --json for the full table)`);
                }
        }
        out.push(`compat-battery: verdict: ${rows.length} rows — ${counts.PASS} PASS · ${counts.FAIL} FAIL · ${counts.SKIP} SKIP` +
                (counts.FAIL > 0 ? ' — FAIL (stock Code OSS surface regressed; see rows above)' : ' — PASS (Flauz is additive over stock)'));
        if (escalatedSkips > 0) {
                out.push(`compat-battery: ${escalatedSkips} SKIP row(s) escalated to FAIL by --require`);
        }
        return out.join('\n');
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
                                help: { type: 'boolean', default: false, short: 'h' },
                                root: { type: 'string' },
                                upstream: { type: 'string' },
                                product: { type: 'string' },
                                allowlist: { type: 'string' },
                                json: { type: 'boolean', default: false },
                                layer: { type: 'string', default: 'all' },
                                'no-fail': { type: 'boolean', default: false },
                                require: { type: 'boolean', default: false },
                        },
                });
        } catch (e) {
                process.stderr.write(`compat-battery: ${e.message}\n`);
                usage();
                process.exit(EXIT_USAGE);
        }
        if (parsed.values.help) { usage(); process.exit(EXIT_OK); }

        if (!['1', '2', 'all'].includes(parsed.values.layer)) {
                process.stderr.write(`compat-battery: --layer must be 1, 2 or all (got '${parsed.values.layer}')\n`);
                process.exit(EXIT_USAGE);
        }
        const layersRun = parsed.values.layer === 'all' ? [1, 2] : [Number(parsed.values.layer)];

        ROOT = parsed.values.root !== undefined ? path.resolve(parsed.values.root) : SCRIPT_REPO_ROOT;
        if (!fs.existsSync(ROOT) || !fs.statSync(ROOT).isDirectory()) {
                process.stderr.write(`compat-battery: --root '${ROOT}' is not a directory\n`);
                process.exit(EXIT_USAGE);
        }

        try {
                // ---- resolve sides ----
                let upstreamSpec = parsed.values.upstream;
                if (upstreamSpec === undefined) {
                        for (const candidate of DEFAULT_UPSTREAM_REFS) {
                                const r = git(['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`]);
                                if (r.ok) { upstreamSpec = candidate; break; }
                        }
                        if (upstreamSpec === undefined) {
                                throw new UsageError(
                                        `no default upstream ref found (tried ${DEFAULT_UPSTREAM_REFS.join(', ')}) — ` +
                                        `pass --upstream <git-ref|dir>. Never point the battery at a product branch: ` +
                                        `product-vs-product would vacuously pass (spec section 8).`);
                        }
                }
                const upstream = resolveSide(upstreamSpec, 'upstream');
                const productSpec = parsed.values.product ?? 'HEAD';
                const product = resolveSide(productSpec, 'product');

                if (upstream.mode === 'git' || product.mode === 'git') {
                        const inside = git(['rev-parse', '--is-inside-work-tree']);
                        if (!inside.ok || inside.out.trim() !== 'true') {
                                throw new UsageError(`--root '${ROOT}' is not a git repository (needed for git-ref sides)`);
                        }
                }

                const allowlist = loadAllowlist(parsed.values.allowlist);

                // ---- run layers ----
                let stockManifests = 0, flauzManifests = 0, identitySet = [];
                if (layersRun.includes(1)) { runLayer1(upstream, product); }
                if (layersRun.includes(2)) {
                        const manifestStats = runLayer2ManifestDiff(upstream, product);
                        stockManifests = manifestStats.stockCount;
                        flauzManifests = manifestStats.flauzCount;
                        identitySet = runLayer2ProductIdentity(upstream, product);
                        runLayer2RootPackage(upstream, product);
                        runLayer2PositiveControl(product);
                }

                // ---- allowlist suppression (after all rows exist) ----
                const allowlistUse = layersRun.includes(2) ? applyAllowlist(allowlist) : { used: 0, unused: allowlist.entries.length };

                // ---- verdict ----
                const counts = { PASS: countBy('PASS'), FAIL: countBy('FAIL'), SKIP: countBy('SKIP') };
                let escalatedSkips = 0;
                if (parsed.values.require) {
                        for (const row of rows) {
                                if (row.status === 'SKIP') { row.escalatedByRequire = true; escalatedSkips += 1; }
                        }
                }
                let exit = EXIT_OK;
                if (counts.FAIL > 0 || escalatedSkips > 0) { exit = EXIT_FAIL; }
                if (parsed.values['no-fail']) { exit = EXIT_OK; }

                const meta = {
                        tool: 'compat-battery',
                        version: VERSION,
                        date: new Date().toISOString(),
                        root: ROOT,
                        upstream: { spec: upstream.spec, mode: upstream.mode, ...(upstream.mode === 'git' ? { sha: upstream.sha } : { dir: upstream.dir }) },
                        product: { spec: product.spec, mode: product.mode, ...(product.mode === 'git' ? { sha: product.sha } : { dir: product.dir }) },
                        stockManifests,
                        flauzManifests,
                        identitySet,
                        allowlist: { file: allowlist.file, explicit: allowlist.explicit, entries: allowlist.entries.length, used: allowlistUse.used, unused: allowlistUse.unused },
                        layersRun,
                        families: CONTRIBUTION_FAMILIES,
                        flauzBuiltins: FLAUZ_BUILTIN_EXTENSIONS,
                        counts,
                        additionsAllowed,
                        verdict: counts.FAIL > 0 ? 'FAIL' : (escalatedSkips > 0 ? 'FAIL (skip escalated by --require)' : 'PASS'),
                        rows,
                };

                if (parsed.values.json) {
                        process.stdout.write(`${JSON.stringify(meta, null, '\t')}\n`);
                } else {
                        process.stdout.write(`${humanReport(meta, counts, escalatedSkips)}\n`);
                }
                process.exit(exit);
        } catch (e) {
                if (e instanceof UsageError) {
                        process.stderr.write(`compat-battery: ${e.message}\n`);
                        process.exit(EXIT_USAGE);
                }
                process.stderr.write(`compat-battery: internal error: ${e && e.stack ? e.stack : e}\n`);
                process.exit(EXIT_USAGE);
        }
}

main();
