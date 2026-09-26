#!/usr/bin/env node

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// ---------------------------------------------------------------------------------------------
// Flauz Wave 3 — Lane H (perf harness + CI + budget enforcement)
//
// proposed-api-rota.mjs — proposed-API churn rota (DL-4 posture; PERF section 7 R5;
// MIGRATION-PLAN section 5 job 5). Runs at EVERY upstream sync (DL-11).
//
// What it does:
//   1. Builds the FLAUZ UNION of enabled proposed APIs:
//        - product.flauz.json#extensionEnabledApiProposals  (map extId -> [proposal])
//          (product config is the DL-4 mechanism — extensionsProposedApi.ts:42-114
//          reads productService.extensionEnabledApiProposals and OVERRIDES whatever
//          the extension manifest declares)
//        - every extensions/flauz-*/package.json#enabledApiProposals (array)
//      (Globbed — never a hardcoded file list; lanes land at different times.)
//   2. Builds the UPSTREAM INVENTORY at HEAD:
//        - src/vscode-dts/vscode.proposed.*.d.ts filenames (the d.ts relocation
//          that motivated this rota is a real precedent — D-3)
//        - cross-checks the generated registry
//          src/vs/platform/extensions/common/extensionsApiProposals.ts (the
//          runtime gate: proposals missing from the registry trigger the in-tree
//          "DOES NOT EXIST" warn at extensionsProposedApi.ts:47)
//   3. Reports DRIFT:
//        ABSENT   — proposal referenced by the flauz union but with no d.ts/registry
//                   entry at HEAD (renamed, removed, or finalized upstream: the
//                   extension will silently lose the API — extensionsProposedApi
//                   filters it out).
//        UNION-DELTA (with --baseline <json>) — proposals added/removed from the
//                   flauz union since the last sync (new dependencies to review).
//        INVENTORY-DELTA (with --baseline <json>) — d.ts files added/removed at
//                   HEAD since the last sync; a removed-inventory + newly-added
//                   flauz proposal with a similar name is the RENAME signature.
//        REGISTRY-MISMATCH — d.ts file exists but registry key absent (or vice
//                   versa): upstream generated-file drift, always worth reporting.
//   4. Prints a DECISION-LOG diff reminder whenever drift is present (MIGRATION
//      section 5 job 6: DECISION-LOG reviewed at every checkpoint tag).
//
// Modes:
//   rota (default)   : assert — exit 1 on any drift, 0 when clean.
//   --report <dir>   : additionally write drift-report.md + drift-report.json
//                      into <dir> (CI artifact; upload with if: always()).
//   --snapshot <file>: write the current union+inventory as a baseline JSON
//                      (checked in at build/flauz/rota-baseline.json by the TL at
//                      each sync tag; do NOT commit it from PRs).
//   --baseline <file>: diff against a previous snapshot (see INVENTORY-DELTA).
//   --no-fail        : informational run — report drift but exit 0.
//
// Zero flauz proposals anywhere (lanes not merged) -> documented SKIP, exit 0
// (CI must stay green while lanes are in flight). --require flips that to fail.
//
// Exit codes: 0 clean/SKIP · 1 drift (unless --no-fail) or bad input · 2 usage.
//
// Zero dependencies: node >= 20 stdlib only.
// ---------------------------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const EXIT_OK = 0, EXIT_FAIL = 1, EXIT_USAGE = 2;

const DTS_GLOB_DIR = 'src/vscode-dts';
const DTS_PREFIX = 'vscode.proposed.';
const DTS_SUFFIX = '.d.ts';
const REGISTRY_FILE = 'src/vs/platform/extensions/common/extensionsApiProposals.ts';
const PRODUCT_FLAUZ = 'product.flauz.json';

function usage() {
	process.stdout.write(`proposed-api-rota.mjs — proposed-API churn rota (DL-4, PERF R5, MIGRATION section 5 job 5)

Usage:
  node proposed-api-rota.mjs --repo-root <dir>                 # rota assert mode
  node proposed-api-rota.mjs --repo-root <dir> --report <dir>  # + artifacts
  node proposed-api-rota.mjs --repo-root <dir> --snapshot <file>
  node proposed-api-rota.mjs --repo-root <dir> --baseline <file>
  node proposed-api-rota.mjs --repo-root <dir> --no-fail       # informational

Exit codes: 0 clean/SKIP · 1 drift (unless --no-fail) · 2 usage error.
`);
}

function readJsonSafe(file) {
	try { return { value: JSON.parse(fs.readFileSync(file, 'utf8')) }; }
	catch (e) { return { error: e.message }; }
}

function main() {
	let parsed;
	try {
		parsed = parseArgs({
			allowPositionals: false,
			options: {
				'repo-root': { type: 'string', default: process.cwd() },
				report: { type: 'string' },
				snapshot: { type: 'string' },
				baseline: { type: 'string' },
				'no-fail': { type: 'boolean', default: false },
				require: { type: 'boolean', default: false },
				help: { type: 'boolean', default: false },
			},
		});
	} catch (e) {
		process.stderr.write(`usage error: ${e.message}\n\n`); usage(); process.exit(EXIT_USAGE);
	}
	const args = parsed.values;
	if (args.help) { usage(); process.exit(EXIT_OK); }

	const root = path.resolve(args['repo-root']);
	const report = [];
	const drift = { absent: [], unionAdded: [], unionRemoved: [], inventoryAdded: [], inventoryRemoved: [], registryMismatch: [] };
	let exit = EXIT_OK;
	const fail = (m) => { report.push(`FAIL  ${m}`); };
	const info = (m) => report.push(`INFO  ${m}`);

	// ---- flauz union ---------------------------------------------------------------------------
	const union = new Map(); // proposal -> Set(extId)
	const unionSources = [];

	const productFile = path.join(root, PRODUCT_FLAUZ);
	if (fs.existsSync(productFile)) {
		const { value: product, error } = readJsonSafe(productFile);
		if (error) { fail(`${PRODUCT_FLAUZ} is not valid JSON: ${error}`); exit = EXIT_FAIL; }
		else if (product && typeof product.extensionEnabledApiProposals === 'object' && product.extensionEnabledApiProposals !== null) {
			for (const [extId, proposals] of Object.entries(product.extensionEnabledApiProposals)) {
				if (!Array.isArray(proposals)) { fail(`${PRODUCT_FLAUZ}: extensionEnabledApiProposals['${extId}'] must be an array.`); exit = EXIT_FAIL; continue; }
				unionSources.push(`${PRODUCT_FLAUZ}#${extId}`);
				for (const p of proposals) {
					if (!union.has(p)) { union.set(p, new Set()); }
					union.get(p).add(extId);
				}
			}
			info(`${PRODUCT_FLAUZ}#extensionEnabledApiProposals: ${Object.keys(product.extensionEnabledApiProposals).length} extension entr(ies).`);
		} else {
			info(`${PRODUCT_FLAUZ} present but has no extensionEnabledApiProposals key (Worker F lane may not have landed it yet).`);
		}
	} else {
		info(`${PRODUCT_FLAUZ} not present at HEAD of this checkout (Worker F lane in flight — documented).`);
	}

	// extensions/flauz-*/package.json — glob, never hardcode
	const extDir = path.join(root, 'extensions');
	const flauzManifests = [];
	if (fs.existsSync(extDir)) {
		for (const entry of fs.readdirSync(extDir, { withFileTypes: true })) {
			if (entry.isDirectory() && /^flauz-/.test(entry.name)) {
				const mf = path.join(extDir, entry.name, 'package.json');
				if (fs.existsSync(mf)) { flauzManifests.push({ dir: entry.name, file: mf }); }
			}
		}
	}
	for (const m of flauzManifests) {
		const { value: pkg, error } = readJsonSafe(m.file);
		if (error) { fail(`extensions/${m.dir}/package.json: not valid JSON: ${error}`); exit = EXIT_FAIL; continue; }
		const proposals = Array.isArray(pkg.enabledApiProposals) ? pkg.enabledApiProposals : [];
		if (proposals.length > 0) { unionSources.push(`extensions/${m.dir}/package.json`); }
		for (const p of proposals) {
			if (typeof p !== 'string') { fail(`extensions/${m.dir}/package.json: enabledApiProposals must be strings.`); exit = EXIT_FAIL; continue; }
			if (!union.has(p)) { union.set(p, new Set()); }
			union.get(p).add(`extensions/${m.dir}`);
		}
	}
	info(`flauz-* manifests scanned: ${flauzManifests.length} (${flauzManifests.map(m => m.dir).join(', ') || 'none'}).`);

	// ---- upstream inventory ---------------------------------------------------------------------
	const dtsDir = path.join(root, DTS_GLOB_DIR);
	const inventory = new Set();
	if (fs.existsSync(dtsDir)) {
		for (const f of fs.readdirSync(dtsDir)) {
			if (f.startsWith(DTS_PREFIX) && f.endsWith(DTS_SUFFIX)) {
				inventory.add(f.slice(DTS_PREFIX.length, f.length - DTS_SUFFIX.length));
			}
		}
	}
	info(`upstream d.ts inventory: ${inventory.size} proposed API file(s) under ${DTS_GLOB_DIR}/.`);

	const registry = new Set();
	const registryFile = path.join(root, REGISTRY_FILE);
	if (fs.existsSync(registryFile)) {
		const text = fs.readFileSync(registryFile, 'utf8');
		const re = /^\t([A-Za-z0-9]+): \{\s*$/gm;
		let m;
		while ((m = re.exec(text)) !== null) { registry.add(m[1]); }
		info(`generated registry: ${registry.size} proposal key(s) in ${REGISTRY_FILE}.`);
	} else {
		info(`generated registry not found (${REGISTRY_FILE}) — registry cross-check skipped.`);
	}

	// ---- drift: absent -------------------------------------------------------------------------
	if (union.size === 0) {
		const skip = 'no flauz proposed-API references found (union is empty — lanes not merged yet). Rota has nothing to track; documented SKIP.';
		if (args.require) { fail(skip); exit = EXIT_FAIL; } else { info(skip); }
	}
	for (const [proposal, users] of [...union.entries()].sort()) {
		const inDts = inventory.has(proposal);
		const inRegistry = registry.size === 0 ? true : registry.has(proposal); // no registry file -> cannot check
		if (!inDts || !inRegistry) {
			drift.absent.push({ proposal, users: [...users], inDts, inRegistry });
			fail(`ABSENT: '${proposal}' (referenced by ${[...users].join(', ')}) — d.ts present: ${inDts}, registry key present: ${inRegistry}. Upstream renamed/removed/finalized this proposal; extensionsProposedApi.ts:47 will silently drop it at runtime.`);
		}
	}

	// ---- drift: registry vs d.ts (upstream generated-file consistency) --------------------------
	for (const key of registry) { if (!inventory.has(key)) { drift.registryMismatch.push({ key, side: 'registry-only' }); } }
	for (const key of inventory) { if (registry.size > 0 && !registry.has(key)) { drift.registryMismatch.push({ key, side: 'dts-only' }); } }
	for (const mm of drift.registryMismatch) {
		info(`REGISTRY-MISMATCH: '${mm.key}' is ${mm.side} — upstream generated-file drift between ${REGISTRY_FILE} and ${DTS_GLOB_DIR}/ (report upstream, do not work around).`);
	}

	// ---- drift: baseline deltas ------------------------------------------------------------------
	if (args.baseline) {
		const { value: base, error } = readJsonSafe(path.resolve(args.baseline));
		if (error || !base || typeof base !== 'object') {
			fail(`cannot read baseline '${args.baseline}': ${error || 'not a JSON object'}`);
			exit = EXIT_FAIL;
		} else {
			const baseUnion = new Set(base.union ?? []);
			const baseInventory = new Set(base.inventory ?? []);
			for (const p of union.keys()) { if (!baseUnion.has(p)) { drift.unionAdded.push(p); } }
			for (const p of baseUnion) { if (!union.has(p)) { drift.unionRemoved.push(p); } }
			for (const p of inventory) { if (!baseInventory.has(p)) { drift.inventoryAdded.push(p); } }
			for (const p of baseInventory) { if (!inventory.has(p)) { drift.inventoryRemoved.push(p); } }
			for (const p of drift.unionAdded) { report.push(`DELTA  UNION-ADDED:   '${p}' newly referenced by flauz since last sync — justify in the PR (D-3 rota review gate).`); }
			for (const p of drift.unionRemoved) { report.push(`DELTA  UNION-REMOVED: '${p}' no longer referenced by flauz since last sync.`); }
			for (const p of drift.inventoryAdded) { report.push(`DELTA  INVENTORY-ADDED:   upstream added proposal '${p}' (${DTS_GLOB_DIR}/${DTS_PREFIX}${p}${DTS_SUFFIX}).`); }
			for (const p of drift.inventoryRemoved) {
				const renamedTo = drift.inventoryAdded.find(cand => similarity(cand, p) > 0.5) ?? drift.unionAdded.find(cand => similarity(cand, p) > 0.5);
				report.push(`DELTA  INVENTORY-REMOVED: upstream removed proposal '${p}'${renamedTo ? ` — possible RENAME to '${renamedTo}' (name similarity)` : ''}. Every flauz consumer must be re-pointed this sync.`);
			}
		}
	}

	// ---- verdict ---------------------------------------------------------------------------------
	const hasDrift = drift.absent.length > 0 || drift.unionAdded.length > 0 || drift.unionRemoved.length > 0 || drift.inventoryAdded.length > 0 || drift.inventoryRemoved.length > 0;
	if (hasDrift) {
		report.push('');
		report.push('REMINDER (MIGRATION-PLAN section 5 job 6 / DL-4): the DECISION-LOG diff must be reviewed at this');
		report.push('checkpoint tag. Proposed-API drift is a DL-4 tracked change: update');
		report.push('product.flauz.json / flauz-* manifests this sync, and record the churn in the');
		report.push('sync canary report attached to the tag.');
	}
	report.push('── verdict ' + '─'.repeat(51));
	if (exit === EXIT_FAIL) {
		report.push('PROPOSED-API ROTA: INVALID INPUT (see FAIL lines)');
	} else if (hasDrift && !args['no-fail']) {
		exit = EXIT_FAIL;
		report.push('PROPOSED-API ROTA: DRIFT PRESENT — fix the union before the next sync tag');
	} else if (hasDrift) {
		report.push('PROPOSED-API ROTA: DRIFT PRESENT (informational run, --no-fail)');
	} else {
		report.push('PROPOSED-API ROTA: CLEAN');
	}
	process.stdout.write(report.join('\n') + '\n');

	// ---- snapshot / report artifacts ---------------------------------------------------------------
	if (args.snapshot) {
		const snap = {
			generatedAt: new Date().toISOString(),
			union: [...union.keys()].sort(),
			unionSources,
			inventory: [...inventory].sort(),
			registry: [...registry].sort(),
		};
		fs.mkdirSync(path.dirname(path.resolve(args.snapshot)), { recursive: true });
		fs.writeFileSync(path.resolve(args.snapshot), JSON.stringify(snap, null, 2) + '\n');
		process.stdout.write(`snapshot written: ${args.snapshot}\n`);
	}
	if (args.report) {
		const dir = path.resolve(args.report);
		fs.mkdirSync(dir, { recursive: true });
		const md = [
			'# Flauz proposed-API rota — drift report',
			'',
			`Generated: ${new Date().toISOString()}`,
			`Repo root: ${root}`,
			'',
			'## Union (flauz-referenced proposals)',
			'',
			...(union.size === 0 ? ['(empty — lanes not merged)'] : [...union.entries()].sort().map(([p, users]) => `- \`${p}\` — ${[...users].join(', ')}`)),
			'',
			'## Drift',
			'',
			drift.absent.length ? '### ABSENT (referenced, not at HEAD) — blocking' : '',
			...drift.absent.map(d => `- \`${d.proposal}\` (users: ${d.users.join(', ')}; d.ts: ${d.inDts}, registry: ${d.inRegistry})`),
			drift.inventoryRemoved.length ? '### Inventory removed since baseline (renames/removals)' : '',
			...drift.inventoryRemoved.map(d => `- \`${d}\``),
			drift.inventoryAdded.length ? '### Inventory added since baseline' : '',
			...drift.inventoryAdded.map(d => `- \`${d}\``),
			drift.unionAdded.length ? '### Union added since baseline' : '',
			...drift.unionAdded.map(d => `- \`${d}\``),
			drift.unionRemoved.length ? '### Union removed since baseline' : '',
			...drift.unionRemoved.map(d => `- \`${d}\``),
			drift.registryMismatch.length ? '### Registry/d.ts mismatch (upstream generated-file drift)' : '',
			...drift.registryMismatch.map(d => `- \`${d.key}\` (${d.side})`),
			'',
			'Reminder: DECISION-LOG diff is reviewed at every checkpoint tag (MIGRATION section 5 job 6).',
			'',
		].filter(l => l !== '').join('\n');
		fs.writeFileSync(path.join(dir, 'drift-report.md'), md);
		fs.writeFileSync(path.join(dir, 'drift-report.json'), JSON.stringify({ generatedAt: new Date().toISOString(), drift, union: [...union.keys()].sort(), inventory: [...inventory].sort() }, null, 2) + '\n');
		process.stdout.write(`artifacts written: ${path.join(dir, 'drift-report.md')}, ${path.join(dir, 'drift-report.json')}\n`);
	}

	process.exit(exit);
}

// crude trigram similarity for rename hints (0..1)
function similarity(a, b) {
	const trigrams = (s) => {
		const set = new Set();
		const t = s.toLowerCase();
		for (let i = 0; i < t.length - 2; i++) { set.add(t.slice(i, i + 3)); }
		return set;
	};
	const A = trigrams(a), B = trigrams(b);
	if (A.size === 0 || B.size === 0) { return 0; }
	let shared = 0;
	for (const g of A) { if (B.has(g)) { shared++; } }
	return shared / Math.min(A.size, B.size);
}

main();
