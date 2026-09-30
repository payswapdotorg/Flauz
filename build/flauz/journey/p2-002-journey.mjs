/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// ---------------------------------------------------------------------------------------------
// Flauz TL4 (product-acceptance lane) -- P2-002 Worker A.
//
// p2-002-journey.mjs -- the full product acceptance journey gate.
//
// Mission: a green component suite is not a green product. This gate runs
// the 14-leg canonical acceptance journey (docs/FLAUZ-PROGRAM/
// PRODUCT-PHASE.md "Acceptance journey") against the REAL product runtime:
//
//   node build/flauz/journey/p2-002-journey.mjs [--root <dir>]
//        [--records <dir>] [--verify <dir>] [--json] [--list]
//        [--require] [--no-fail]
//
//   --root <dir>     repository root (default: the repo containing this
//                    script). The drill lives at
//                    <root>/build/flauz/journey/journey.drill.ts.
//   --records <dir>  where the per-leg receipts land (default:
//                    <root>/build/flauz/journey/records). Created if
//                    missing. The format is documented in the records/README.
//   --verify <dir>   verify an EXISTING records dir only (no drill run) --
//                    the station's re-verification entry point.
//   --json           machine-readable verdict document on stdout.
//   --list           print the journey catalogue and exit 0.
//   --require        evidence mode: a SKIP verdict, a lower-than-expected
//                    evidence level, a missing receipt or a FAIL all fail
//                    the gate (CI evidence mode; the budget-gate/compat-
//                    battery CLI precedent). Without --require a SKIP exit
//                    is 0 (the repo drill law: never fail a gate merely for
//                    lacking a browser) -- the verdict line still says SKIP.
//   --no-fail        always exit 0 (reporting only).
//
// Enforcement model (fail-closed, the session-battery/agentos-battery law):
//   1. the drill's EXIT CODE is enforced;
//   2. the drill's GREEN line is enforced on success (a drill that exits 0
//      without asserting green is not evidence);
//   3. every leg's receipt file must exist and carry the receipt schema;
//   4. every leg verdict must be PASS (FAIL = gate FAIL always; SKIP =
//      gate FAIL only under --require);
//   5. under --require every leg's evidence level must be at least the
//      expected level for that leg (runtime-real; live-provider is accepted
//      wherever runtime-real is expected, never the reverse).
//
// Exit codes: 0 = green (or SKIP without --require) * 1 = FAIL/SKIP-with-
// require * 2 = usage/environment error.
// ---------------------------------------------------------------------------------------------

'use strict';

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import process from 'node:process';

const SCRIPT_DIR = path.dirname(fileURLToPathSafe());
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..');
const DRILL_REL = path.join('build', 'flauz', 'journey', 'journey.drill.ts');
const DEFAULT_RECORDS_REL = path.join('build', 'flauz', 'journey', 'records');
const RECEIPT_SCHEMA = 'flauz.p2-002-journey-receipt/v1';
const SUMMARY_SCHEMA = 'flauz.p2-002-journey/v1';
const RUNTIME_GREEN_PREFIX = 'p2-002 journey drill: GREEN';
const RUNTIME_CENSUS_LINE = /^p2-002 journey drill: (\d+) assertions, (\d+) failures$/;

/** The canonical journey catalogue (mirrors the drill's LEGS; the gate is the enforcement copy). */
const JOURNEY_LEGS = [
	{ leg: 1, slug: 'workspace-open', name: 'create/open workspace', minLevel: 'runtime-real' },
	{ leg: 2, slug: 'mission-task', name: 'create mission/task', minLevel: 'runtime-real' },
	{ leg: 3, slug: 'agent-session', name: 'start agent session', minLevel: 'runtime-real' },
	{ leg: 4, slug: 'provider-model', name: 'choose a live provider/model', minLevel: 'runtime-real' },
	{ leg: 5, slug: 'workspace-resources', name: 'edit/read workspace resources', minLevel: 'runtime-real' },
	{ leg: 6, slug: 'browser-use', name: 'use browser', minLevel: 'runtime-real' },
	{ leg: 7, slug: 'environment-use', name: 'create/use environment', minLevel: 'runtime-real' },
	{ leg: 8, slug: 'a2a-delegation', name: 'delegate to another agent (A2A)', minLevel: 'runtime-real' },
	{ leg: 9, slug: 'approval-takeover', name: 'require/handle approval or takeover', minLevel: 'runtime-real' },
	{ leg: 10, slug: 'artifact-evidence', name: 'produce artifact/evidence', minLevel: 'runtime-real' },
	{ leg: 11, slug: 'provider-env-failure', name: 'exercise provider/environment failure', minLevel: 'runtime-real' },
	{ leg: 12, slug: 'retry-cancel-recover', name: 'retry/cancel/recover', minLevel: 'runtime-real' },
	{ leg: 13, slug: 'restart', name: 'restart', minLevel: 'runtime-real' },
	{ leg: 14, slug: 'resume-continuity', name: 'resume task and inspect continuity/provenance', minLevel: 'runtime-real' },
];

const LEVEL_RANK = { fixture: 0, simulated: 1, 'local-real': 2, 'runtime-real': 3, 'live-provider': 4, unavailable: -1 };

/** fileURLToPath without depending on node:url (zero-dep spirit; stdlib fine either way). */
function fileURLToPathSafe() {
	const url = import.meta.url;
	const prefix = 'file://';
	if (!url.startsWith(prefix)) {
		throw new Error(`p2-002 journey: unsupported module url ${url}`);
	}
	let target = url.slice(prefix.length);
	if (process.platform === 'win32') {
		target = target.replace(/^\/([A-Za-z]:)/, '$1');
	}
	return decodeURIComponent(target);
}

function parseArgs(argv) {
	const options = { root: DEFAULT_ROOT, records: undefined, verify: undefined, json: false, list: false, require: false, noFail: false };
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		switch (arg) {
			case '--root':
				options.root = requireValue(argv, ++i, arg);
				break;
			case '--records':
				options.records = requireValue(argv, ++i, arg);
				break;
			case '--verify':
				options.verify = requireValue(argv, ++i, arg);
				break;
			case '--json':
				options.json = true;
				break;
			case '--list':
				options.list = true;
				break;
			case '--require':
				options.require = true;
				break;
			case '--no-fail':
				options.noFail = true;
				break;
			case '--help':
			case '-h':
				printUsage();
				process.exit(0);
				break;
			default:
				usageError(`unknown argument '${arg}'`);
		}
	}
	if (options.verify !== undefined && options.records !== undefined) {
		usageError('--verify and --records are mutually exclusive');
	}
	return options;
}

function requireValue(argv, index, flag) {
	const value = argv[index];
	if (value === undefined || value.startsWith('--')) {
		usageError(`${flag} requires a value`);
	}
	return value;
}

function printUsage() {
	console.log('usage: node p2-002-journey.mjs [--root <dir>] [--records <dir>] [--verify <dir>] [--json] [--list] [--require] [--no-fail]');
	console.log('  the 14-leg canonical acceptance journey over the real product runtime (P2-002, Worker A)');
	console.log('  --records <dir>  where the per-leg receipts land (default: build/flauz/journey/records)');
	console.log('  --verify <dir>   verify an existing records dir only (no drill run)');
	console.log('  --require        evidence mode: SKIP / lower evidence level / missing receipt / FAIL all fail the gate');
}

function usageError(message) {
	printUsage();
	console.error(`p2-002 journey: usage error: ${message}`);
	process.exit(2);
}

/** node >= 22.6 carries --experimental-strip-types (type stripping). */
function nodeSupportsStripTypes(nodeVersion) {
	const parts = nodeVersion.split('.').map(part => Number.parseInt(part, 10));
	if (parts.length < 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) {
		return false;
	}
	return parts[0] > 22 || (parts[0] === 22 && parts[1] >= 6);
}

/** Spawns the drill (the session-battery runtime pattern: exit code AND green line). */
function runDrill(root, recordsDir) {
	const drillPath = path.join(root, DRILL_REL);
	if (!fs.existsSync(drillPath)) {
		return { verdict: 'ERROR', reason: `drill not found at ${path.relative(root, drillPath)}`, output: '' };
	}
	if (!nodeSupportsStripTypes(process.versions.node)) {
		return { verdict: 'SKIP', reason: `node ${process.versions.node} lacks --experimental-strip-types (need >= 22.6)`, output: '' };
	}
	fs.mkdirSync(recordsDir, { recursive: true });
	const run = spawnSync(process.execPath, ['--experimental-strip-types', drillPath], {
		cwd: root,
		env: { ...process.env, FLAUZ_JOURNEY_RECORDS: recordsDir },
		encoding: 'utf-8',
		maxBuffer: 64 * 1024 * 1024,
	});
	if (run.error !== undefined) {
		return { verdict: 'ERROR', reason: `failed to launch the drill: ${run.error.message}`, output: '' };
	}
	const output = `${run.stdout ?? ''}\n${run.stderr ?? ''}`;
	if (run.status !== 0) {
		const census = output.match(RUNTIME_CENSUS_LINE);
		return { verdict: 'FAIL', reason: `drill failed (exit ${run.status}${census !== null ? `, ${census[2]} failing assertions` : ''})`, output };
	}
	if (!output.includes(RUNTIME_GREEN_PREFIX)) {
		return { verdict: 'FAIL', reason: 'drill exited 0 without the GREEN line (malformed evidence)', output };
	}
	return { verdict: 'PASS', reason: 'drill green (14 legs, GREEN line verified)', output };
}

/** Reads one receipt file; returns a problem row when absent/invalid (fail-closed). */
function readReceipt(recordsDir, leg) {
	const fileName = `leg-${String(leg.leg).padStart(2, '0')}-${leg.slug}.json`;
	const target = path.join(recordsDir, fileName);
	if (!fs.existsSync(target)) {
		return { ok: false, problem: `receipt missing: ${fileName}` };
	}
	let parsed;
	try {
		parsed = JSON.parse(fs.readFileSync(target, { encoding: 'utf-8' }));
	} catch (err) {
		return { ok: false, problem: `receipt not valid JSON: ${fileName} (${err.message})` };
	}
	if (parsed.schema !== RECEIPT_SCHEMA) {
		return { ok: false, problem: `receipt ${fileName} carries schema ${JSON.stringify(parsed.schema)} (expected ${RECEIPT_SCHEMA})` };
	}
	if (parsed.leg !== leg.leg || parsed.slug !== leg.slug) {
		return { ok: false, problem: `receipt ${fileName} identifies leg ${JSON.stringify(parsed.leg)}/${JSON.stringify(parsed.slug)} (expected ${leg.leg}/${leg.slug})` };
	}
	return { ok: true, receipt: parsed, fileName };
}

/**
 * Verifies the records dir: every canonical leg has a valid receipt, every
 * verdict is PASS, and every evidence level meets the expected minimum.
 * Returns per-leg rows for the verdict table.
 */
function verifyRecords(recordsDir) {
	const rows = [];
	let fail = 0;
	let skip = 0;
	let pass = 0;
	const summaryPath = path.join(recordsDir, 'journey-summary.json');
	if (fs.existsSync(summaryPath)) {
		const summary = JSON.parse(fs.readFileSync(summaryPath, { encoding: 'utf-8' }));
		if (summary.schema !== SUMMARY_SCHEMA) {
			rows.push({ leg: 0, slug: 'summary', verdict: 'FAIL', level: '-', reason: `journey-summary.json carries schema ${JSON.stringify(summary.schema)} (expected ${SUMMARY_SCHEMA})` });
			fail += 1;
		}
	}
	for (const leg of JOURNEY_LEGS) {
		const read = readReceipt(recordsDir, leg);
		if (!read.ok) {
			rows.push({ leg: leg.leg, slug: leg.slug, verdict: 'FAIL', level: '-', reason: read.problem });
			fail += 1;
			continue;
		}
		const receipt = read.receipt;
		if (receipt.verdict === 'FAIL') {
			rows.push({ leg: leg.leg, slug: leg.slug, verdict: 'FAIL', level: receipt.evidenceLevel, reason: receipt.firstFailing ?? 'leg failed' });
			fail += 1;
			continue;
		}
		if (receipt.verdict === 'SKIP') {
			const reason = receipt.skipReason ?? 'leg skipped (no reason recorded)';
			rows.push({ leg: leg.leg, slug: leg.slug, verdict: 'SKIP', level: receipt.evidenceLevel, reason });
			skip += 1;
			continue;
		}
		const levelRank = LEVEL_RANK[receipt.evidenceLevel] ?? -1;
		const minRank = LEVEL_RANK[leg.minLevel] ?? -1;
		if (levelRank < minRank) {
			rows.push({ leg: leg.leg, slug: leg.slug, verdict: 'FAIL', level: receipt.evidenceLevel, reason: `evidence level ${receipt.evidenceLevel} below the expected ${leg.minLevel} (leg ${leg.leg})` });
			fail += 1;
			continue;
		}
		rows.push({ leg: leg.leg, slug: leg.slug, verdict: 'PASS', level: receipt.evidenceLevel, reason: `${receipt.assertions.pass} assertions held` });
		pass += 1;
	}
	return { rows, summary: { pass, fail, skip } };
}

function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.list) {
		console.log('p2-002 journey: the 14-leg canonical acceptance journey (P2-002 Worker A)');
		for (const leg of JOURNEY_LEGS) {
			console.log(`  LEG ${String(leg.leg).padStart(2, '0')}  ${leg.slug.padEnd(22)} ${leg.name} (min level ${leg.minLevel})`);
		}
		return;
	}

	const recordsDir = options.records ?? options.verify ?? path.join(options.root, DEFAULT_RECORDS_REL);

	let drill = undefined;
	if (options.verify === undefined) {
		drill = runDrill(options.root, recordsDir);
	}

	let verification;
	if (drill !== undefined && (drill.verdict === 'ERROR' || drill.verdict === 'SKIP')) {
		verification = {
			rows: JOURNEY_LEGS.map(leg => ({ leg: leg.leg, slug: leg.slug, verdict: drill.verdict, level: '-', reason: drill.reason })),
			summary: { pass: 0, fail: 0, skip: JOURNEY_LEGS.length },
		};
	} else {
		verification = verifyRecords(recordsDir);
	}

	const drillFail = drill !== undefined && drill.verdict === 'FAIL';
	const anyFail = drillFail || verification.summary.fail > 0;
	const anySkip = verification.summary.skip > 0;
	let verdict = 'PASS';
	if (anyFail || (anySkip && options.require)) {
		verdict = 'FAIL';
	} else if (anySkip) {
		verdict = 'SKIP';
	}

	if (options.json) {
		console.log(JSON.stringify({
			gate: 'p2-002-journey',
			wo: 'P2-002',
			worker: 'A',
			drill: drill === undefined ? { ran: false } : { ran: true, verdict: drill.verdict, reason: drill.reason },
			records: path.relative(options.root, recordsDir) || recordsDir,
			legs: verification.rows,
			summary: verification.summary,
			requireMode: options.require,
			verdict,
		}, null, '\t'));
	} else {
		console.log(`p2-002 journey: drill ${DRILL_REL.split(path.sep).join('/')}`);
		console.log(`p2-002 journey: records ${path.relative(options.root, recordsDir) || recordsDir}`);
		if (drill !== undefined) {
			console.log(`p2-002 journey: drill verdict ${drill.verdict} -- ${drill.reason}`);
		} else {
			console.log('p2-002 journey: verifying the existing records dir only (--verify)');
		}
		for (const row of verification.rows) {
			const tag = row.leg === 0 ? 'summary' : `LEG ${String(row.leg).padStart(2, '0')}`;
			console.log(`${row.verdict}  ${tag} ${row.slug} [${row.level}] -- ${row.reason}`);
		}
		console.log('-- verdict ---------------------------------------------------------------');
		let verdictLine = `p2-002 journey: ${verdict} -- ${verification.summary.pass}/${String(JOURNEY_LEGS.length)} legs PASS`;
		if (drill !== undefined && drill.verdict === 'PASS') {
			const census = drill.output.match(RUNTIME_CENSUS_LINE);
			if (census !== null) {
				verdictLine += ` (${census[1]} drill assertions)`;
			}
		}
		if (verdict === 'FAIL' && anySkip && options.require && !anyFail) {
			verdictLine = `p2-002 journey: FAIL (SKIP promoted by --require) -- ${verification.rows.find(row => row.verdict === 'SKIP')?.reason ?? 'skipped leg'}`;
		}
		console.log(verdictLine);
		// relay the drill's own GREEN + census + leg lines so the CI log carries
		// them verbatim (the lane's assert greps the log for the GREEN line)
		if (drill !== undefined && typeof drill.output === 'string' && drill.verdict === 'PASS') {
			for (const line of drill.output.split('\n')) {
				if (line.startsWith(RUNTIME_GREEN_PREFIX) || RUNTIME_CENSUS_LINE.test(line) || /^p2-002 journey drill: LEG \d{2} /.test(line)) {
					console.log(line);
				}
			}
		}
	}

	if (options.noFail) {
		return;
	}
	if (verdict === 'PASS') {
		return;
	}
	if (verdict === 'SKIP' && !options.require) {
		return;
	}
	process.exit(1);
}

main();
