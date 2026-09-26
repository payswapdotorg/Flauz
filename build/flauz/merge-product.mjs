/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Flauz product overlay merger (Wave 3 Lane F, task W3-F-R-b).
//
// Merges the Flauz product overlay (`product.flauz.json`, repo root) onto the
// upstream Code OSS base (`product.json`) with NULL-DELETES semantics:
//
//   - overlay value === null          -> the key is DELETED from the merged result
//   - both values are plain objects   -> recursive merge
//   - anything else (arrays, scalars) -> the overlay value REPLACES the base value
//   - keys only in the overlay are added; keys only in the base are kept
//
// The merged product is serialized with TAB indentation + trailing newline to
// match the upstream product.json formatting (see build/gulpfile.vscode.ts which
// edits product.json in place with the same tab style).
//
// Zero dependencies. Node >= 18.3 (node:util parseArgs).
//
// Usage:
//   node build/flauz/merge-product.mjs [--base <path>] [--overlay <path>] [--out <path|->]
//
// Defaults: --base product.json --overlay product.flauz.json --out - (stdout)
//
// Programmatic use (see merge-product.test.mjs):
//   import { mergeProduct, serializeProduct, validateOverlay } from './merge-product.mjs';

import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The overlay keys v0 knows about (all real IProductConfiguration fields at 9bf9ae764da:
 *  src/vs/base/common/product.ts — version:100, nameShort/nameLong:105-106,
 *  extensionEnabledApiProposals:250, defaultChatAgent:276). Anything else is warned about. */
export const KNOWN_OVERLAY_KEYS = Object.freeze([
		'nameShort',
		'nameLong',
		'version',
		'extensionEnabledApiProposals',
		'defaultChatAgent',
]);

/** Pinned upstream commit the "no consumer" warning below is verified against. */
export const PINNED_BASE_COMMIT = '9bf9ae764da';

const DEFAULT_OVERLAY_NAME = 'product.flauz.json';

function isPlainObject(value) {
		return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
		return typeof value === 'string' && value.length > 0;
}

function isArrayOfStrings(value) {
		return Array.isArray(value) && value.every(item => typeof item === 'string');
}

/**
 * Light structural validation of the known overlay keys. Throws an Error with an
 * actionable message on the first violation. Unknown keys are allowed (v0 is
 * permissive) but each one is reported on stderr so it cannot be relied on silently.
 */
export function validateOverlay(overlay, options = {}) {
		if (!isPlainObject(overlay)) {
				throw new Error(`overlay must be a JSON object, got ${overlay === null ? 'null' : typeof overlay}`);
		}
		const overlayName = options.overlayName ?? DEFAULT_OVERLAY_NAME;

		for (const [key, value] of Object.entries(overlay)) {
				switch (key) {
						case 'nameShort':
						case 'nameLong':
								if (!isNonEmptyString(value)) {
										throw new Error(`overlay key "${key}" must be a non-empty string (got ${JSON.stringify(value)})`);
								}
								break;
						case 'version':
								if (typeof value !== 'string') {
										throw new Error(`overlay key "version" must be a string (got ${typeof value})`);
								}
								break;
						case 'extensionEnabledApiProposals':
								if (!isPlainObject(value)) {
										throw new Error(`overlay key "extensionEnabledApiProposals" must be an object of { "publisher.extensionId": [proposal, ...] }`);
								}
								for (const [extensionKey, proposals] of Object.entries(value)) {
										if (!isNonEmptyString(extensionKey)) {
												throw new Error(`overlay key "extensionEnabledApiProposals" has an invalid extension key: ${JSON.stringify(extensionKey)} (expected "publisher.name")`);
										}
										if (!isArrayOfStrings(proposals)) {
												throw new Error(`overlay key "extensionEnabledApiProposals"."${extensionKey}" must be an array of strings (got ${JSON.stringify(proposals)})`);
										}
								}
								break;
						case 'defaultChatAgent':
								if (value !== null && !isPlainObject(value)) {
										throw new Error(`overlay key "defaultChatAgent" must be null (null-deletes the base key) or an object (got ${typeof value})`);
								}
								break;
						default:
								// v0 is permissive: unknown keys pass through to the merge, but they are
								// flagged because the pinned tree has no consumer for them.
								console.error(`warning: ${overlayName} sets unknown key ${key} (no IProductConfiguration consumer at ${PINNED_BASE_COMMIT} — verify before relying on it)`);
								break;
				}
		}
}

/**
 * Recursive merge with NULL-DELETES semantics. Never mutates `base` or `overlay`.
 * See the header comment for the exact rules.
 */
export function mergeProduct(base, overlay, options = {}) {
		validateOverlay(overlay, options);
		return mergeNodes(base, overlay);
}

function mergeNodes(base, overlay) {
		if (!isPlainObject(overlay)) {
				return overlay; // arrays and scalars replace the base value wholesale
		}
		const target = isPlainObject(base) ? { ...base } : {};
		for (const [key, value] of Object.entries(overlay)) {
				if (value === null) {
						delete target[key]; // NULL-DELETES: drop the key from the merged result
						continue;
				}
				target[key] = mergeNodes(target[key], value);
		}
		return target;
}

/** Serialize the merged product exactly like the upstream product.json: TAB indent + trailing newline. */
export function serializeProduct(merged) {
		return `${JSON.stringify(merged, null, '\t')}\n`;
}

/**
 * Strict JSON parse (JSON.parse rejects BOM-adjacent garbage, comments, and trailing
 * commas) with a clear error message naming the file.
 */
function parseJsonFile(filePath) {
		let raw;
		try {
				raw = readFileSync(filePath, 'utf8');
		} catch (err) {
				throw new Error(`cannot read ${filePath}: ${err.message}`);
		}
		if (raw.charCodeAt(0) === 0xFEFF) {
				throw new Error(`${filePath} must not start with a UTF-8 BOM (strict JSON)`);
		}
		try {
				return JSON.parse(raw);
		} catch (err) {
				throw new Error(`${filePath} is not strict JSON (comments, trailing commas, and BOMs are rejected): ${err.message}`);
		}
}

function usage() {
		return [
				'Usage: node build/flauz/merge-product.mjs [--base <path>] [--overlay <path>] [--out <path|->]',
				'',
				'  --base     path to the upstream product.json           (default: product.json)',
				'  --overlay  path to the Flauz overlay product.flauz.json (default: product.flauz.json)',
				'  --out      output path, or "-" for stdout               (default: -)',
				'',
				'Merge semantics (null-deletes): overlay null deletes a key; plain objects merge',
				'recursively; arrays and scalars replace wholesale. Output uses TAB indentation.',
		].join('\n');
}

function main(argv) {
		const { values } = parseArgs({
				args: argv,
				options: {
						base: { type: 'string' },
						overlay: { type: 'string' },
						out: { type: 'string' },
						help: { type: 'boolean', short: 'h' },
				},
		});
		if (values.help) {
				process.stdout.write(`${usage()}\n`);
				return;
		}

		const basePath = values.base ?? 'product.json';
		const overlayPath = values.overlay ?? DEFAULT_OVERLAY_NAME;
		const outPath = values.out ?? '-';

		const base = parseJsonFile(basePath);
		if (!isPlainObject(base)) {
				throw new Error(`${basePath} must contain a JSON object at the top level`);
		}
		const overlay = parseJsonFile(overlayPath);

		const merged = mergeProduct(base, overlay, { overlayName: basename(overlayPath) });
		const serialized = serializeProduct(merged);

		if (outPath === '-') {
				process.stdout.write(serialized);
		} else {
				const absolute = resolve(outPath);
				const parent = dirname(absolute);
				if (parent) {
						mkdirSync(parent, { recursive: true });
				}
				writeFileSync(absolute, serialized);
		}
}

// `... | head -n` style consumers close the pipe early; treat that as success.
process.stdout.on('error', err => {
		if (err.code === 'EPIPE') {
				process.exit(0);
		}
		throw err;
});

// Only act as a CLI when executed directly (`node …/merge-product.mjs …`).
// Under `node --test merge-product.test.mjs` argv[1] is the TEST file, so the
// import in the test suite does not trigger the CLI path.
const invokedAsCli = process.argv[1]
		&& (import.meta.url === pathToFileURL(process.argv[1]).href
				|| process.argv[1].endsWith('merge-product.mjs'));

if (invokedAsCli) {
		try {
				main(process.argv.slice(2));
				// Exit naturally (exit code 0) so pending stdout writes to pipes drain.
		} catch (err) {
				console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
				process.exitCode = 1;
		}
}
