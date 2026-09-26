/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Stage the Lane J (flauz-J-w4) delivery for transit (zero-dependency).
 *
 * Copies every file of the working-tree delta vs the flauz/main base
 * (git diff --name-only <base>..HEAD, ADDED + MODIFIED, excluding the staging
 * area and .eslint-allowed-javascript-files handling notes) into the staging
 * directory with repo-relative paths preserved, and (re)writes MANIFEST.txt
 * with one `<sha256>  <path>` line per file. REPORT.md inside the staging
 * dir is authored by hand and is never overwritten.
 *
 * Usage:
 *   node build/flauz/scripts/stage-j-environments.mjs [--out <dir>] [--base <sha>] [--help]
 *
 * Defaults: --out /home/z/my-project/flauz-delivery/j-environments (outside the
 * repo, inside the persisted volume); --base = flauz/main HEAD recorded in the
 * work order (a4c245147e8fe046c33b2987c322a070d161c9ba).
 *
 * Exit codes: 0 staged | 1 staging error | 2 usage error.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, writeFileSync, existsSync, statSync, readdirSync, rmSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const DEFAULT_BASE = 'a4c245147e8fe046c33b2987c322a070d161c9ba';
const DEFAULT_OUT = '/home/z/my-project/flauz-delivery/j-environments';

function usage() {
	process.stdout.write(`stage-j-environments.mjs -- stage the Lane J delivery for TL transit

Usage:
	node build/flauz/scripts/stage-j-environments.mjs [--out <dir>] [--base <sha>]

Options:
	--out <dir>   staging directory (default ${DEFAULT_OUT})
	--base <sha>  diff base (default flauz/main HEAD ${DEFAULT_BASE})
	--help        show this help

Behavior:
	- stages ADDED and MODIFIED files of <base>..HEAD (repo-relative paths kept)
	- prunes stale staged files that no longer belong to the delta
	- rewrites MANIFEST.txt with sha256 per staged file
	- never touches REPORT.md / MANIFEST.txt content authored by hand elsewhere
`);
}

function parseArgs(argv) {
	const options = { out: DEFAULT_OUT, base: DEFAULT_BASE };
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--out') {
			options.out = argv[i + 1];
			i += 1;
		} else if (argv[i] === '--base') {
			options.base = argv[i + 1];
			i += 1;
		} else if (argv[i] === '--help' || argv[i] === '-h') {
			options.help = true;
		} else {
			throw new Error(`unknown argument: ${argv[i]}`);
		}
	}
	return options;
}

function listFilesRecursively(dir) {
	const out = [];
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const entry of entries) {
		const p = join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...listFilesRecursively(p));
		} else if (entry.isFile()) {
			out.push(p);
		}
	}
	return out;
}

function main() {
	let options;
	try {
		options = parseArgs(process.argv.slice(2));
	} catch (err) {
		process.stderr.write(`usage error: ${err.message}\n`);
		usage();
		process.exit(2);
	}
	if (options.help) {
		usage();
		process.exit(0);
	}

	const diff = execFileSync('git', ['diff', '--name-only', `${options.base}..HEAD`], { cwd: repoRoot, encoding: 'utf-8' });
	const files = diff.split('\n').map(line => line.trim()).filter(line => line.length > 0 && !line.startsWith('flauz-delivery/'));

	// prune stale staged files first (so removed-from-delta paths disappear)
	if (existsSync(options.out)) {
		const keep = new Set(files.map(file => join(options.out, file)));
		for (const staged of listFilesRecursively(options.out)) {
			if (staged.endsWith('MANIFEST.txt') || staged.endsWith('REPORT.md')) {
				continue;
			}
			if (!keep.has(staged)) {
				rmSync(staged);
				process.stdout.write(`pruned stale staged file: ${relative(options.out, staged)}\n`);
			}
		}
	}

	let copied = 0;
	const manifest = [];
	for (const file of files) {
		const source = join(repoRoot, file);
		const target = join(options.out, file);
		if (!existsSync(source) || !statSync(source).isFile()) {
			continue;
		}
		mkdirSync(dirname(target), { recursive: true });
		copyFileSync(source, target);
		copied += 1;
		const digest = createHash('sha256').update(readFileSync(source)).digest('hex');
		manifest.push(`${digest}  ${file}`);
	}

	manifest.sort((a, b) => (a.slice(65) < b.slice(65) ? -1 : a.slice(65) > b.slice(65) ? 1 : 0));
	const manifestPath = join(options.out, 'MANIFEST.txt');
	const header = `# flauz-delivery/j-environments MANIFEST (sha256, repo-relative paths)\n# base: ${options.base}  head: ${headSha()}  staged: ${copied} file(s)\n`;
	writeFileSync(manifestPath, header + manifest.join('\n') + '\n');
	process.stdout.write(`staged ${copied} file(s) to ${options.out} (MANIFEST.txt rewritten)\n`);
}

function headSha() {
	try {
		return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoRoot, encoding: 'utf-8' }).trim();
	} catch {
		return 'unknown';
	}
}

main();
