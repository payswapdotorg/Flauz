/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The flauz-harness web (browser) entry bundle script - A-PROD-006-W9,
 * the gap-ledger row-4 closure vehicle's packaging leg.
 *
 * THE LAW (the packaging-parity registry's own recovery path, verbatim):
 * "Browser entrypoint built from the node-free core the extension
 * already has; keep desktop-only executors behind the desktop entry."
 * This script bundles ONLY the web-full console core -
 * src/extension.web.ts, which composes the pure selection-session
 * state machine, the flauz.harness tree view and the shared formatter
 * over the in-session port seam - and NEVER imports the runtime
 * binding (src/flauzHarnessPort.ts, the node:fs/node:crypto wiring -
 * web-blocked by law). The desktop entry (src/extension.ts) and the
 * node esbuild config (build/flauz/scripts/bundle-extensions.mjs,
 * dist/extension.js) are untouched.
 *
 * esbuild resolves the REAL contract constants
 * (HARNESS_INDUSTRIES / HARNESS_WORK_TYPES / COMPANY_SIZE_BANDS)
 * from build/flauz/harness/ by the same relative paths the desktop
 * bundle uses - the import-by-reference law; the values in the web
 * bundle are the SAME frozen constants, never re-declared.
 *
 * The build/family bundlers discipline (the repo's own law): a bundler
 * script may live at the extension root (the upstream
 * esbuild.browser.mts convention) while the STATION-side recipe
 * (build/flauz/scripts/bundle-extensions.mjs) owns the node dist. This
 * script is the web sibling's owner. The repo's own esbuild install
 * is used (same resolution discipline as bundle-extensions.mjs).
 *
 * Usage (from the repo root):
 *   node extensions/flauz-harness/esbuild.web.mjs
 * Exit codes: 0 ok; 1 build failure (any missing seam, any esbuild error).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

const entry = path.join(here, 'src', 'extension.web.ts');
const outfile = path.join(here, 'dist', 'web', 'extension.js');

if (!fs.existsSync(entry)) {
        console.error(`esbuild.web: the web entry is missing: ${entry}`);
        process.exit(1);
}

// The web-seam law: the runtime binding must NEVER be reachable from the web entry.
// Guard the boundary at build time - the entry's import graph is checked by esbuild's
// bundling itself (an import of flauzHarnessPort.ts would drag node:fs into the
// browser bundle and fail on --platform=browser's node: resolution).
const bindingPath = path.join(here, 'src', 'flauzHarnessPort.ts');
const entrySource = fs.readFileSync(entry, 'utf8');
// The check strips block comments first (the header DISCLOSES the law by naming the
// forbidden module - the disclosure must never trip the build-time boundary check).
const codeOnly = entrySource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
if (codeOnly.includes('flauzHarnessPort')) {
        console.error('esbuild.web: the web entry imports the runtime binding (src/flauzHarnessPort.ts) - the node binding NEVER ships web (the parity law).');
        process.exit(1);
}
void bindingPath;

// esbuild resolution: the same candidate list as bundle-extensions.mjs.
const candidates = [
        path.join(repoRoot, 'node_modules', 'esbuild', 'bin', 'esbuild'),
        path.join(repoRoot, 'build', 'node_modules', 'esbuild', 'bin', 'esbuild'),
        path.join(repoRoot, 'node_modules', '.bin', 'esbuild'),
].filter(fs.existsSync);
const esbuildBin = candidates[0];
if (esbuildBin === undefined) {
        console.error('esbuild.web: esbuild not found (expected after the repo npm install).');
        process.exit(1);
}

fs.mkdirSync(path.dirname(outfile), { recursive: true });

// The build/family bundlers recipe: a bundler script may be a JS shim (run via
// node) or the native binary (run direct) - the same probe as bundle-extensions.mjs.
const head = Buffer.alloc(2);
const fd = fs.openSync(esbuildBin, 'r');
fs.readSync(fd, head, 0, 2, 0);
fs.closeSync(fd);
const isScript = head.toString('latin1') === '#!';

const argv = [
        esbuildBin, entry,
        '--bundle',
        '--outfile=' + outfile,
        '--format=esm',
        '--platform=browser',
        '--target=es2022',
        '--external:vscode',
        '--log-level=warning',
        '--color=false',
];
const res = isScript
        ? spawnSync(process.execPath, argv, { stdio: 'inherit' })
        : spawnSync(esbuildBin, argv.slice(1), { stdio: 'inherit' });

if (res.status !== 0) {
        console.error(`esbuild.web: FAILED (esbuild exit ${res.status})`);
        process.exit(1);
}
if (!fs.existsSync(outfile)) {
        console.error('esbuild.web: FAILED (no output file)');
        process.exit(1);
}
const size = fs.statSync(outfile).size;
console.log(`esbuild.web: ok - ${path.relative(repoRoot, outfile)} (${size} bytes)`);
