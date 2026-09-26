/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// bundle-extensions.mjs -- build extensions/flauz-* into loadable dist/extension.js
// bundles (esbuild, the repo's own install) so real IDE boots can activate them.
//
// WHY THIS EXISTS (first-CI finding, 2026-09-26): the flauz extensions ship as
// TypeScript source with noEmit tsconfigs (typecheck-only; tests run via node
// type-stripping), so nothing ever produced the `main` targets -- real boots
// failed activation with "Cannot find module .../dist/extension.js" and the
// perf pair measured the error path (+4338ms p95 outliers) instead of Flauz.
// esbuild is the bundler the tree itself uses for bundled extensions; .ts
// specifiers (NodeNext style) are esbuild-native; ESM output preserves
// import.meta.url (flauz-agent's core/service.mjs resolution anchors at the
// extension root and resolves identically from dist/).
//
// Zero-dep at the script level: node >=20 stdlib; esbuild is resolved from the
// repo's own node_modules (present after `npm install`) -- pass --esbuild to
// override the path (sandbox testing).
//
// Usage:
//   node build/flauz/scripts/bundle-extensions.mjs [--root <repo>] [--esbuild <path>] [--verify]
//
//   --root <dir>    repository root (default: two levels up from this script)
//   --esbuild <p>   path to the esbuild bin shim (default <root>/node_modules/esbuild/bin/esbuild)
//   --verify        do not build; assert every extensions/flauz-*/package.json main
//                   exists on disk after a build (exit 1 listing misses)
//
// Exit codes: 0 ok; 1 build/verify failure; 2 usage error.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function usage(exit) {
	const text = [
		'usage: node build/flauz/scripts/bundle-extensions.mjs [options]',
		'',
		'options:',
		'\t--root <dir>    repository root (default: two levels up from this script)',
		'\t--esbuild <p>   esbuild bin shim path (default: <root>/node_modules/esbuild/bin/esbuild)',
		'\t--verify        skip building; assert every flauz extension main exists on disk',
		'\t--help          this text',
		'',
		'discovers extensions/flauz-*/src/extension.ts (glob, never hardcoded) and',
		'esbuilds each to extensions/flauz-<name>/dist/extension.js:',
		'\t--bundle --format=esm --platform=node --target=es2022 --external:vscode',
	].join('\n');
	if (exit === undefined) {
		console.log(text);
	} else {
		console.error(text);
		process.exit(exit);
	}
}

function parseArgs(argv) {
	const out = { root: path.resolve(here, '..', '..', '..'), esbuild: null, verify: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--help' || a === '-h') { usage(); process.exit(0); }
		else if (a === '--root') { out.root = path.resolve(argv[++i]); }
		else if (a === '--esbuild') { out.esbuild = path.resolve(argv[++i]); }
		else if (a === '--verify') { out.verify = true; }
		else { console.error(`unknown argument: ${a}`); usage(2); }
	}
	return out;
}

// discover extensions/flauz-*/src/extension.ts -- glob by directory scan (stdlib only)
function discover(root) {
	const extRoot = path.join(root, 'extensions');
	let names;
	try { names = fs.readdirSync(extRoot); } catch { return []; }
	return names
		.filter(n => n.startsWith('flauz-'))
		.filter(n => fs.existsSync(path.join(extRoot, n, 'src', 'extension.ts')))
		.map(n => ({ name: n, dir: path.join(extRoot, n) }));
}

function main() {
	const opts = parseArgs(process.argv.slice(2));
	const found = discover(opts.root);
	if (found.length === 0) {
		console.error('bundle-extensions: no extensions/flauz-*/src/extension.ts found under ' + opts.root);
		process.exit(1);
	}
	if (opts.verify) {
		let missing = 0;
		for (const ext of found) {
			const pkg = JSON.parse(fs.readFileSync(path.join(ext.dir, 'package.json'), 'utf8'));
			const main = pkg.main || './dist/extension.js';
			const target = path.join(ext.dir, main);
			if (!fs.existsSync(target)) {
				console.error(`MISSING  ${ext.name}: main ${main} not built (${target})`);
				missing++;
			} else {
				console.log(`ok       ${ext.name}: ${main} (${fs.statSync(target).size} bytes)`);
			}
		}
		if (missing > 0) {
			console.error(`bundle-extensions --verify: ${missing} main target(s) missing`);
			process.exit(1);
		}
		console.log(`bundle-extensions --verify: all ${found.length} main target(s) present`);
		process.exit(0);
	}
	const esbuildBin = opts.esbuild || path.join(opts.root, 'node_modules', 'esbuild', 'bin', 'esbuild');
	if (!fs.existsSync(esbuildBin)) {
		console.error(`bundle-extensions: esbuild not found at ${esbuildBin}`);
		console.error('(expected after the repo npm install; pass --esbuild <path> to override)');
		process.exit(1);
	}
	let failures = 0;
	for (const ext of found) {
		const entry = path.join(ext.dir, 'src', 'extension.ts');
		const outfile = path.join(ext.dir, 'dist', 'extension.js');
		console.log(`bundling ${ext.name}: src/extension.ts -> dist/extension.js`);
		// the esbuild bin may be a JS shim (run via node) or the native binary (run direct)
		const head = Buffer.alloc(2);
		const fd = fs.openSync(esbuildBin, 'r');
		fs.readSync(fd, head, 0, 2, 0);
		fs.closeSync(fd);
		const isScript = head.toString('latin1') === '#!';
		const argv = [esbuildBin, entry, '--bundle', '--outfile=' + outfile, '--format=esm', '--platform=node', '--target=es2022', '--external:vscode', '--log-level=warning', '--color=false'];
		const res = isScript
			? spawnSync(process.execPath, argv, { stdio: 'inherit' })
			: spawnSync(esbuildBin, argv.slice(1), { stdio: 'inherit' });

		if (res.status !== 0) {
			console.error(`bundle-extensions: FAILED ${ext.name} (esbuild exit ${res.status})`);
			failures++;
		}
	}
	if (failures > 0) {
		console.error(`bundle-extensions: ${failures} of ${found.length} bundles failed`);
		process.exit(1);
	}
	console.log(`bundle-extensions: ${found.length} bundle(s) built`);
}

main();
