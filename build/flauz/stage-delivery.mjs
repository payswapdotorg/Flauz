/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Stage the Lane F delivery for transit (zero-dependency).
 *
 * Copies every NEW path of the working tree delta vs the upstream baseline
 * (git diff --name-only --diff-filter=A <base>..HEAD, excluding the staging
 * area itself) into the staging directory with repo-relative paths preserved,
 * and (re)writes MANIFEST.txt with one `<sha256>  <path>` line per file.
 * REPORT.md / README.md inside the staging dir are authored by hand and are
 * never overwritten.
 *
 * Usage: node build/flauz/stage-delivery.mjs [--out flauz-delivery/f-agent-bridge] [--base 9bf9ae764da...]
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, copyFileSync, writeFileSync, existsSync, statSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

function parseArgs(argv) {
		const options = { out: join(repoRoot, 'flauz-delivery', 'f-agent-bridge'), base: '9bf9ae764da438b1234a8243dc9e47173ef58ee7' };
		for (let i = 0; i < argv.length; i += 2) {
				if (argv[i] === '--out') {
						options.out = argv[i + 1];
				} else if (argv[i] === '--base') {
						options.base = argv[i + 1];
				} else {
						throw new Error(`unknown argument: ${argv[i]}`);
				}
		}
		return options;
}

const { out, base } = parseArgs(process.argv.slice(2));

const diff = execFileSync('git', ['diff', '--name-only', '--diff-filter=A', `${base}..HEAD`], { cwd: repoRoot, encoding: 'utf-8' });
const files = diff.split('\n').map((line) => line.trim()).filter((line) => line.length > 0 && !line.startsWith('flauz-delivery/'));

let copied = 0;
for (const file of files) {
		const source = join(repoRoot, file);
		const target = join(out, file);
		if (!existsSync(source) || !statSync(source).isFile()) {
				continue;
		}
		mkdirSync(dirname(target), { recursive: true });
		copyFileSync(source, target);
		copied += 1;
}

const manifestLines = [];
for (const file of files) {
		const source = join(repoRoot, file);
		if (!existsSync(source) || !statSync(source).isFile()) {
				continue;
		}
		const sha256 = hashFile(source);
		manifestLines.push(`${sha256}  ${file}`);
}
manifestLines.sort((a, b) => (a.slice(66) < b.slice(66) ? -1 : a.slice(66) > b.slice(66) ? 1 : 0));
writeFileSync(join(out, 'MANIFEST.txt'), `${manifestLines.join('\n')}\n`);

console.log(`staged ${copied} delta files into ${relative(repoRoot, out)} (baseline ${base.slice(0, 12)})`);

function hashFile(path) {
		return createHash('sha256').update(readFileSync(path)).digest('hex');
}
