/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// ---------------------------------------------------------------------------------------------
// Flauz — TL4 (product quality). p2-003-discovery-gate.mjs — the user
// discovery audit gate (P2-003; docs/FLAUZ-PROGRAM/TL4-PRODUCT-HANDOFF.md;
// audit record docs/FLAUZ-PROGRAM/acceptance/p2-003-discovery-audit.md).
//
// TL4-PRODUCT-HANDOFF: "Use the same product as a new and returning human."
// This gate makes the DISCOVERY side of that contract machine-checkable at
// the static-contract evidence level (the ia-gate/premium-ux-gate pattern):
// the 23-row rubric (rubric.mjs — DA01..DA23, the 9 checklist areas × the
// persona split) is asserted against the flauz-* manifests, the six view
// sources, the shipped Flauz guide and the packaging-parity registry.
//
// Verdict law (fail-closed):
//   - a row whose target surface cannot be located = MISS with the exact
//     miss — never SKIP-as-PASS;
//   - a MISS that is pinned in the KNOWN_GAPS registry = KNOWN-GAP (a
//     routed P2-FIX finding, reported loudly, not silent) — exit 0;
//   - a MISS that is NOT pinned = a discovery regression — exit 1;
//   - --strict flips the pinned KNOWN-GAP misses to failures (post-fix
//     enforcement for the TL4 station re-verification);
//   - a pinned gap whose row now PASSES is reported RESOLVED (the pin can
//     be retired).
//
// Manifest discovery: --root <dir> (default cwd), manifests globbed at
// extensions/flauz-*/package.json — never a hardcoded list.
//
// Skip-vs-fail policy (build/flauz/README.md section 2): if NO flauz-*
// manifests are found the gate exits 0 with a documented SKIP. --require
// flips that to a failure (used by CI and the fixture verification to
// prove the rules actually fire).
//
// Usage:
//        node p2-003-discovery-gate.mjs [--root <repo>] [--require] [--strict]
//        node p2-003-discovery-gate.mjs --root test/fixtures/discovery-gate/clean --require
//
// Exit codes: 0 = clean (or documented SKIP; known gaps allowed unless
// --strict) · 1 = discovery regression (or a pinned gap under --strict) ·
// 2 = usage error.
//
// Zero dependencies: node >= 20 stdlib only.
// ---------------------------------------------------------------------------------------------

import { parseArgs } from 'node:util';
import { RUBRIC, KNOWN_GAPS } from './rubric.mjs';
import { loadSurface, runDiscoveryAudit, walkFiles } from './audit.mjs';

const EXIT_OK = 0, EXIT_FAIL = 1, EXIT_USAGE = 2;

function usage() {
	process.stdout.write(`p2-003-discovery-gate.mjs — user discovery audit gate for extensions/flauz-* (TL4 / P2-003)

Usage:
	node p2-003-discovery-gate.mjs [--root <repo>] [--require] [--strict]
	node p2-003-discovery-gate.mjs --root test/fixtures/discovery-gate/clean --require

Options:
	--root <dir>    root dir for the manifests glob (default: cwd)
	--require       fail when zero flauz-* manifests are found (default: SKIP notice, exit 0)
	--strict        pinned known gaps (routed P2-FIX findings) also fail — post-fix enforcement
	-h, --help      show this help

Rubric: DA01..DA23 — the TL4-PRODUCT-HANDOFF P2-003 checklist (9 areas × the
persona split). Rows: view discoverability, next steps, capability
discoverability, error/recovery grammar, approval/takeover comprehension,
evidence/provenance comprehension, no dead ends, accessibility labels,
web-posture honesty. Misses pinned in the KNOWN_GAPS registry are routed
findings (P2-FIX-2xx), not regressions; unpinned misses fail.

Exit codes: 0 clean/SKIP (known gaps allowed unless --strict) · 1 regression
(or a known gap under --strict) · 2 usage error.
`);
}

function main() {
	let parsed;
	try {
		parsed = parseArgs({
			allowPositionals: false,
			options: {
				root: { type: 'string', default: process.cwd() },
				require: { type: 'boolean', default: false },
				strict: { type: 'boolean', default: false },
				help: { type: 'boolean', default: false },
			},
		});
	} catch (e) {
		process.stderr.write(`usage error: ${e.message}\n\n`);
		usage();
		process.exit(EXIT_USAGE);
	}
	const args = parsed.values;
	if (args.help) {
		usage();
		process.exit(EXIT_OK);
	}

	const report = [];
	let exit = EXIT_OK;
	const fail = (m) => { report.push(`FAIL  ${m}`); exit = EXIT_FAIL; };

	// ---- the skip-vs-fail gate on manifest presence --------------------------------
	const surface = loadSurface(args.root);
	if (surface.manifests.length === 0) {
		const msg = `no manifests matched 'extensions/flauz-*/package.json' under ${surface.root} — flauz-* surfaces not present in this tree (documented SKIP; discovery gate deferred).`;
		if (args.require) { fail(msg); } else { report.push(`SKIP  ${msg}`); }
		process.stdout.write(report.join('\n') + '\n');
		process.exit(exit);
	}
	report.push(`discovery-gate: auditing ${surface.manifests.length} flauz manifest(s) under ${surface.root}`);

	// ---- run the rubric ---------------------------------------------------------------
	const results = runDiscoveryAudit(surface);
	let passCount = 0;
	let gapCount = 0;
	let missCount = 0;
	const findingsRouted = new Set();
	for (const row of results) {
		if (row.status === 'pass') {
			// Any pinned gap on a passing row is RESOLVED (informational).
			for (const key of KNOWN_GAPS.keys()) {
				if (key.startsWith(`${row.id}:`)) {
					report.push(`RESOLVED ${row.id} — pinned known gap now passes (retire the pin: ${key})`);
				}
			}
			passCount += 1;
			report.push(`PASS  ${row.id} ${row.title}`);
			for (const line of row.evidence.slice(0, 6)) {
				report.push(`        · ${line}`);
			}
			continue;
		}
		// status === 'miss': pinned known gap or regression?
		const pinned = [];
		const unknown = [];
		for (const miss of row.misses) {
			const pin = KNOWN_GAPS.get(`${row.id}:${miss.subject}`);
			if (pin !== undefined) {
				pinned.push({ miss, pin });
			} else {
				unknown.push(miss);
			}
		}
		for (const { miss, pin } of pinned) {
			gapCount += 1;
			findingsRouted.add(pin.finding);
			report.push(`KNOWN-GAP ${row.id} — ${miss.subject}: ${miss.detail}`);
			report.push(`        routed as ${pin.finding} (${pin.note})`);
		}
		if (unknown.length > 0) {
			missCount += 1;
			for (const miss of unknown) {
				fail(`${row.id} ${miss.subject}: ${miss.detail}`);
			}
		}
		if (pinned.length > 0 && unknown.length === 0) {
			for (const line of row.evidence.slice(0, 4)) {
				report.push(`        · ${line}`);
			}
		}
	}

	// ---- verdict -----------------------------------------------------------------------
	const strictFail = args.strict && gapCount > 0;
	if (strictFail) { exit = EXIT_FAIL; }
	process.stdout.write(report.join('\n') + '\n');
	const summary = `discovery-gate: ${passCount} PASS · ${gapCount} KNOWN-GAP (routed: ${[...findingsRouted].sort().join(', ') || 'none'}) · ${missCount} row(s) with unknown miss(es) — ${results.length} rubric rows`;
	if (exit === EXIT_FAIL && missCount > 0) {
		process.stdout.write(`${summary}\n`);
		process.stdout.write('discovery-gate: DISCOVERY REGRESSIONS found (see FAIL lines above)\n');
	} else if (strictFail) {
		process.stdout.write(`${summary}\n`);
		process.stdout.write('discovery-gate: KNOWN GAPS enforced as failures (--strict) — see KNOWN-GAP lines above\n');
	} else {
		process.stdout.write(`${summary}\n`);
		process.stdout.write(gapCount > 0
			? 'discovery-gate: CLEAN of regressions; known gaps stay routed (enforce with --strict after the fixes land)\n'
			: 'discovery-gate: CLEAN\n');
	}
	process.exit(exit);
}

main();
