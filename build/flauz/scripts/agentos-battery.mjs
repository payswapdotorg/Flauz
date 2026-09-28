/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// ---------------------------------------------------------------------------------------------
// Flauz TL2 (Agent OS surge) -- task TL2-S3 (TL4 runtime-verification
// secondment).
//
// agentos-battery.mjs -- the Agent OS runtime verification gate.
//
// Mission: "a green unit-test suite is not a durable Agent OS." This gate
// runs the eight-invariant Agent OS durability battery (INV-1..INV-8, spec
// docs/FLAUZ-PROGRAM/TL2-AGENTOS-BATTERY.md) and interprets its
// DETERMINISTIC machine-checkable verdict document
// (schema flauz.agentos-battery/v1) against the gate modes:
//
//   default            run the FIXTURE rung (the suite
//                      extensions/flauz-workflow/test/agentos-battery.test.ts
//                      under node --test + type stripping) and validate the
//                      emitted verdict: coverage law, row shapes, summary
//                      consistency, and INSTRUMENT BLINDNESS (the committed
//                      doctored controls MUST fire). Current-tree findings
//                      (FAIL rows) are honest DATA -- they block TL2's
//                      completion claims (see --surge-rung), never the
//                      instrument's landing.
//   --require          evidence mode: SKIP rows FAIL -- EXCEPT the
//                      named-missing-contract distance rows (reason ends
//                      "; TL2-0NN pending", e.g. the INV-5 lease row pending
//                      TL2-004): those are DISTANCE, not missing evidence
//                      (the rung ran; the product contract is absent), and
//                      are promoted only by --surge-rung. This keeps the CI
//                      evidence lanes green while the lease contract is
//                      pending, without ever weakening the completion claim.
//   --surge-rung       completion-claim evidence mode: EVERY catalogue row
//                      must be PASS (FAIL or SKIP fails). This is the mode
//                      the TL2 surge completion claim runs at.
//   --runtime          run the RUNTIME rung instead (the drill
//                      extensions/flauz-workflow/test/canaries/
//                      agentos-runtime.drill.ts over REAL ports: real child
//                      processes for the restart/cancellation/concurrency
//                      legs, a real CDP endpoint via FLAUZ_CDP_ENDPOINT, a
//                      stub provider server over a real socket). Without
//                      FLAUZ_CDP_ENDPOINT the gate reports SKIP (exit 0),
//                      FAIL under --require. The drill's verbatim GREEN
//                      evidence lines are relayed to stdout (CI asserts on
//                      the relayed lines).
//   --verdict <file>   validate a STANDALONE verdict document against the
//                      same rules + mode semantics (the CI doctored-control
//                      steps and the verify-fixtures matrix drive this).
//
// The one-contract-two-rungs law: both rungs emit the SAME verdict schema
// and the SAME invariant ids; only the port layer differs.
//
// Usage:
//   node agentos-battery.mjs [--root <dir>] [--fixtures <dir>] [--json]
//                            [--list] [--require] [--surge-rung] [--no-fail]
//                            [--runtime] [--verdict <file>]
//
//   --root <dir>      repository root (default: the repo containing this
//                     script). The suite lives at
//                     <root>/extensions/flauz-workflow/test/agentos-battery.test.ts
//                     and the drill at
//                     <root>/extensions/flauz-workflow/test/canaries/agentos-runtime.drill.ts.
//   --fixtures <dir>  control-fixture directory (default:
//                     <root>/test/fixtures/agentos-battery). Must contain
//                     golden-verdict.json, doctored-verdict-missing-row.json,
//                     doctored-verdict-blind-fail.json and doctored-ledger/.
//   --json            machine-readable verdict document on stdout.
//   --list            print the invariant catalogue and exit 0.
//   --require         evidence mode (see above).
//   --surge-rung      completion-claim evidence mode (see above).
//   --no-fail         always exit 0 (reporting only).
//   --runtime         the runtime rung (see above).
//   --verdict <file>  standalone verdict-document validation mode.
//
// Exit codes: 0 = green or SKIP-without-require (either rung) *
// 1 = FAIL/SKIP promoted by the active mode, harness error (journey crash,
// unreadable/malformed verdict document), COVERAGE-LAW violation, or
// INSTRUMENT BLINDNESS (a doctored control passing) * 2 = usage error.
// ---------------------------------------------------------------------------------------------

'use strict';

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import process from 'node:process';

const SCRIPT_DIR = path.dirname(fileURLToPathSafe());
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..');
const SUITE_REL = path.join('extensions', 'flauz-workflow', 'test', 'agentos-battery.test.ts');
const RUNTIME_DRILL_REL = path.join('extensions', 'flauz-workflow', 'test', 'canaries', 'agentos-runtime.drill.ts');
const FIXTURES_REL = path.join('test', 'fixtures', 'agentos-battery');
const SCHEMA_ID = 'flauz.agentos-battery/v1';
const RUNTIME_GREEN_PREFIX = 'agentos runtime drill: GREEN';
const CONTRACT_SKIP_PATTERN = /;\s*TL2-\d{3}\s+pending$/;

const CATALOGUE = [
	{ id: 'INV-1', name: 'restart-recovery', claim: 'process death/restart preserves logical task state and provenance (journal, ledger, task envelopes recover; work continues; no silent state loss)' },
	{ id: 'INV-2', name: 'provider-failure-retry', claim: 'provider errors surface bounded, recorded retry behavior; no silent success; task state reflects the failure path' },
	{ id: 'INV-3', name: 'cancellation-propagation', claim: 'cancel mid-flight stops downstream work; cancellation is recorded with attribution' },
	{ id: 'INV-4', name: 'approval-interruption', claim: 'an interrupted/taken-over approval gate stays FAIL-CLOSED; takeover is recorded with attribution; no approval = no execution' },
	{ id: 'INV-5', name: 'lease-conflict', claim: 'concurrent claimants on one lease: exactly one winner; losers receive an explicit conflict error (never silent double-execution)' },
	{ id: 'INV-6', name: 'multi-agent-coordination', claim: 'concurrent agents preserve evidence and attribution (no ledger clobbering, no cross-agent evidence attribution)' },
	{ id: 'INV-7', name: 'evidence-provenance-integrity', claim: 'the ledger hash chain verifies; any tamper (doctored row, reordered chain) is DETECTED, with the first broken link named' },
	{ id: 'INV-8', name: 'partial-environment-browser-failure', claim: 'a browser/environment leg dying mid-step marks the task FAILED with evidence; never a fake success' },
];

/** fileURLToPath without depending on node:url (zero-dep spirit; stdlib fine either way). */
function fileURLToPathSafe() {
	const url = import.meta.url;
	const prefix = 'file://';
	if (!url.startsWith(prefix)) {
		throw new Error(`agentos-battery: unsupported module url ${url}`);
	}
	let target = url.slice(prefix.length);
	if (process.platform === 'win32') {
		target = target.replace(/^\/([A-Za-z]:)/, '$1');
	}
	return decodeURIComponent(target);
}

function parseArgs(argv) {
	const options = { root: DEFAULT_ROOT, fixtures: undefined, json: false, list: false, require: false, surgeRung: false, noFail: false, runtime: false, verdict: undefined };
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		switch (arg) {
			case '--root':
				options.root = requireValue(argv, ++i, arg);
				break;
			case '--fixtures':
				options.fixtures = requireValue(argv, ++i, arg);
				break;
			case '--verdict':
				options.verdict = requireValue(argv, ++i, arg);
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
			case '--surge-rung':
				options.surgeRung = true;
				break;
			case '--no-fail':
				options.noFail = true;
				break;
			case '--runtime':
				options.runtime = true;
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
	console.log('usage: node agentos-battery.mjs [--root <dir>] [--fixtures <dir>] [--json] [--list] [--require] [--surge-rung] [--no-fail] [--runtime] [--verdict <file>]');
	console.log('  --require     evidence mode: SKIP rows FAIL (named-missing-contract distance rows stay SKIP until --surge-rung)');
	console.log('  --surge-rung  completion-claim evidence mode: every catalogue row must be PASS');
	console.log('  --runtime     the RUNTIME rung (real ports; SKIP without FLAUZ_CDP_ENDPOINT, FAIL under --require)');
	console.log('  --verdict     validate a standalone verdict document instead of running a rung');
}

function usageError(message) {
	printUsage();
	console.error(`agentos-battery: usage error: ${message}`);
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

// ---------------------------------------------------------------------------
// The verdict-document rules (shared by live verdicts and --verdict files)
// ---------------------------------------------------------------------------

function validateVerdictDocument(doc, label) {
	const violations = [];
	if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
		return [`${label}: the verdict document must be a JSON object`];
	}
	const record = doc;
	if (record['schema'] !== SCHEMA_ID) {
		violations.push(`${label}: schema must be '${SCHEMA_ID}' (got ${JSON.stringify(record['schema'])})`);
		return violations;
	}
	const rung = record['rung'];
	if (rung !== 'fixture' && rung !== 'runtime') {
		violations.push(`${label}: rung must be 'fixture' or 'runtime' (got ${JSON.stringify(rung)})`);
	}
	const rows = record['rows'];
	if (!Array.isArray(rows)) {
		violations.push(`${label}: rows must be an array`);
		return violations;
	}
	const seen = [];
	for (const [index, entry] of rows.entries()) {
		if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
			violations.push(`${label}: row #${index} must be an object`);
			continue;
		}
		const row = entry;
		const invariant = row['invariant'];
		if (typeof invariant !== 'string' || invariant.length === 0) {
			violations.push(`${label}: row #${index} carries no invariant id`);
			continue;
		}
		seen.push(invariant);
		const verdict = row['verdict'];
		if (verdict !== 'PASS' && verdict !== 'FAIL' && verdict !== 'SKIP') {
			violations.push(`${label}: row ${invariant} verdict must be PASS|FAIL|SKIP (got ${JSON.stringify(verdict)})`);
		}
		if (typeof row['reason'] !== 'string' || row['reason'].length === 0) {
			violations.push(`${label}: row ${invariant} carries no reason (mandatory for every verdict)`);
		}
		const assertions = row['assertions'];
		if (typeof assertions !== 'object' || assertions === null || typeof assertions['pass'] !== 'number' || typeof assertions['fail'] !== 'number' || assertions['pass'] < 0 || assertions['fail'] < 0) {
			violations.push(`${label}: row ${invariant} assertions must be {pass, fail} counts`);
		}
		if (typeof row['evidence'] !== 'string' || row['evidence'].length === 0) {
			violations.push(`${label}: row ${invariant} carries no evidence`);
		}
		if (verdict === 'FAIL') {
			const violated = row['violatedInvariant'];
			if (typeof violated !== 'string' || violated.length === 0) {
				violations.push(`${label}: the FAIL row ${invariant} reports no violatedInvariant (symptom-only failure reports violate the verdict contract)`);
			} else {
				if (!violated.startsWith(invariant)) {
					violations.push(`${label}: the FAIL row ${invariant}'s violatedInvariant does not name its own invariant (${violated.slice(0, 40)}...)`);
				}
				if (!/assertion [a-z0-9.-]+/.test(violated)) {
					violations.push(`${label}: the FAIL row ${invariant} does not name the first failing assertion id`);
				}
			}
		}
		if (verdict === 'PASS' && typeof assertions === 'object' && assertions !== null && assertions['pass'] === 0) {
			violations.push(`${label}: the PASS row ${invariant} rests on zero target assertions (a PASS with no evidence is blind)`);
		}
	}
	// the COVERAGE LAW: a catalogue invariant with no row is a broken instrument
	const expected = CATALOGUE.map(entry => entry.id);
	const missing = expected.filter(id => !seen.includes(id));
	const extra = [...new Set(seen)].filter(id => !expected.includes(id));
	const duplicates = seen.filter((id, index) => seen.indexOf(id) !== index);
	if (missing.length > 0) {
		violations.push(`${label}: COVERAGE LAW violation -- no row for catalogue invariant(s): ${missing.join(', ')}`);
	}
	if (extra.length > 0) {
		violations.push(`${label}: unknown invariant id(s) outside the catalogue: ${extra.join(', ')}`);
	}
	if (duplicates.length > 0) {
		violations.push(`${label}: duplicate row(s) for invariant(s): ${[...new Set(duplicates)].join(', ')}`);
	}
	// summary consistency
	const summary = record['summary'];
	if (typeof summary !== 'object' || summary === null) {
		violations.push(`${label}: summary must be {pass, fail, skip}`);
	} else {
		const pass = rows.filter(row => typeof row === 'object' && row !== null && row['verdict'] === 'PASS').length;
		const fail = rows.filter(row => typeof row === 'object' && row !== null && row['verdict'] === 'FAIL').length;
		const skip = rows.filter(row => typeof row === 'object' && row !== null && row['verdict'] === 'SKIP').length;
		if (summary['pass'] !== pass || summary['fail'] !== fail || summary['skip'] !== skip) {
			violations.push(`${label}: summary (${JSON.stringify(summary)}) does not match the rows (pass ${pass}, fail ${fail}, skip ${skip})`);
		}
	}
	// the INV-7 tamper-control marker (the doctored-ledger control status rides in the row evidence)
	const inv7 = rows.find(row => typeof row === 'object' && row !== null && row['invariant'] === 'INV-7');
	if (inv7 !== undefined && inv7['verdict'] === 'PASS' && !String(inv7['evidence']).includes('doctored-ledger-control: detected')) {
		violations.push(`${label}: the PASS INV-7 row carries no doctored-ledger-control: detected marker (the instrument's tamper control did not fire)`);
	}
	return violations;
}

function isContractSkip(reason) {
	return typeof reason === 'string' && CONTRACT_SKIP_PATTERN.test(reason);
}

// ---------------------------------------------------------------------------
// The runner + verdict plumbing
// ---------------------------------------------------------------------------

function readVerdictFile(file, label) {
	let raw;
	try {
		raw = fs.readFileSync(file, 'utf-8');
	} catch (err) {
		return { ok: false, violations: [`${label}: verdict document unreadable at ${file} (${err.message})`], doc: undefined };
	}
	let doc;
	try {
		doc = JSON.parse(raw);
	} catch (err) {
		return { ok: false, violations: [`${label}: verdict document at ${file} is not valid JSON (${err.message})`], doc: undefined };
	}
	const violations = validateVerdictDocument(doc, label);
	return { ok: violations.length === 0, violations, doc };
}

/** Applies the mode semantics to a validated verdict; returns the failure list. */
function modeFailures(doc, options) {
	const failures = [];
	for (const row of doc.rows) {
		if (options.surgeRung && row.verdict !== 'PASS') {
			failures.push(`--surge-rung: every catalogue row must be PASS (row ${row.invariant} is ${row.verdict})`);
		} else if (options.require && row.verdict === 'SKIP' && !isContractSkip(row.reason)) {
			failures.push(`--require: SKIP row ${row.invariant} promoted to FAIL (${row.reason})`);
		}
	}
	return [...new Set(failures)];
}

function printVerdict(doc, options, rungLabel) {
	if (options.json) {
		console.log(JSON.stringify(doc, null, '\t'));
		return;
	}
	for (const row of doc.rows) {
		const suffix = row.verdict === 'FAIL' ? ` -- ${row.violatedInvariant ?? row.reason}` : row.verdict === 'SKIP' ? ` -- ${row.reason}` : '';
		console.log(`${row.verdict}  ${row.invariant}${suffix}`);
	}
	const summary = doc.summary;
	console.log('-- verdict ---------------------------------------------------------------');
	let verdict = 'PASS';
	let reason = `instrument green (${String(summary.pass)} PASS, ${String(summary.fail)} FAIL findings, ${String(summary.skip)} SKIP distance)`;
	for (const failure of modeFailures(doc, options)) {
		verdict = 'FAIL';
		reason = failure;
	}
	console.log(`agentos-battery: ${verdict} -- ${reason} [${rungLabel}]`);
}

// ---------------------------------------------------------------------------
// The doctored controls (INSTRUMENT BLINDNESS checks -- run in the default
// fixture mode: each committed control MUST produce its expected outcome)
// ---------------------------------------------------------------------------

function checkCommittedControls(fixturesDir, options) {
	const blindness = [];
	void options;
	const golden = readVerdictFile(path.join(fixturesDir, 'golden-verdict.json'), 'control golden-verdict');
	if (golden.ok) {
		// the control must be clean under the DEFAULT semantics (instrument
		// green-ness); the active mode's promotion applies to the LIVE verdict,
		// never to the calibration control
		const promoted = modeFailures(golden.doc, {});
		if (promoted.length > 0) {
			blindness.push(`control golden-verdict: the honest all-instrument-green control must be clean under the default semantics (got: ${promoted.join('; ')})`);
		}
	} else {
		blindness.push(`control golden-verdict: the honest control must validate clean: ${golden.violations.join('; ')}`);
	}
	const missingRow = readVerdictFile(path.join(fixturesDir, 'doctored-verdict-missing-row.json'), 'control doctored-verdict-missing-row');
	if (missingRow.ok) {
		blindness.push('control doctored-verdict-missing-row: the gate ACCEPTED a verdict with a catalogue row removed (the coverage law is blind)');
	}
	const blindFail = readVerdictFile(path.join(fixturesDir, 'doctored-verdict-blind-fail.json'), 'control doctored-verdict-blind-fail');
	if (blindFail.ok) {
		blindness.push('control doctored-verdict-blind-fail: the gate ACCEPTED a symptom-only FAIL row with no violatedInvariant (the verdict contract is blind)');
	}
	return blindness;
}

// ---------------------------------------------------------------------------
// The rungs
// ---------------------------------------------------------------------------

function runFixtureRung(options) {
	const suitePath = path.join(options.root, SUITE_REL);
	if (!fs.existsSync(suitePath)) {
		return { verdict: 'SKIP', reason: `battery suite not found at ${path.relative(options.root, suitePath)}`, violations: [], modeFailures: [], doc: undefined, output: '' };
	}
	const fixturesDir = options.fixtures ?? path.join(options.root, FIXTURES_REL);
	if (!fs.existsSync(path.join(fixturesDir, 'golden-verdict.json'))) {
		return { verdict: 'ERROR', reason: `control fixtures not found at ${path.relative(options.root, fixturesDir)}${path.sep}golden-verdict.json`, violations: [], modeFailures: [], doc: undefined, output: '' };
	}
	if (!nodeSupportsStripTypes(process.versions.node)) {
		return { verdict: 'SKIP', reason: `node ${process.versions.node} lacks --experimental-strip-types (need >= 22.6); the battery runs in CI's pinned lanes instead`, violations: [], modeFailures: [], doc: undefined, output: '' };
	}
	const verdictPath = path.join(osTmpdirSafe(), `flauz-agentos-battery-verdict-${process.pid}.json`);
	const run = spawnSync(process.execPath, ['--experimental-strip-types', '--test', suitePath], {
		cwd: options.root,
		env: { ...process.env, FLAUZ_AGENTOS_BATTERY_FIXTURES: fixturesDir, FLAUZ_AGENTOS_BATTERY_VERDICT: verdictPath },
		encoding: 'utf-8',
		maxBuffer: 32 * 1024 * 1024,
	});
	if (run.error !== undefined) {
		return { verdict: 'ERROR', reason: `failed to launch the battery runner: ${run.error.message}`, violations: [], modeFailures: [], doc: undefined, output: '' };
	}
	const output = `${run.stdout ?? ''}\n${run.stderr ?? ''}`;
	if (run.status !== 0) {
		return { verdict: 'FAIL', reason: `battery suite failed (exit ${run.status}; a journey crash or an instrument-control failure is a harness error, never a finding)`, violations: [], modeFailures: [], doc: undefined, output };
	}
	const read = readVerdictFile(verdictPath, 'fixture verdict');
	if (!read.ok) {
		return { verdict: 'FAIL', reason: `malformed verdict document: ${read.violations.join('; ')}`, violations: read.violations, modeFailures: [], doc: read.doc, output };
	}
	// the committed doctored controls MUST fire (instrument blindness)
	const blindness = checkCommittedControls(fixturesDir, options);
	if (blindness.length > 0) {
		return { verdict: 'FAIL', reason: `instrument blindness: ${blindness.join('; ')}`, violations: blindness, modeFailures: [], doc: read.doc, output };
	}
	const promoted = modeFailures(read.doc, options);
	return { verdict: promoted.length === 0 ? 'PASS' : 'FAIL', reason: promoted.length === 0 ? 'instrument green' : promoted.join('; '), violations: [], modeFailures: promoted, doc: read.doc, output };
}

function runRuntimeRung(options) {
	const drillPath = path.join(options.root, RUNTIME_DRILL_REL);
	if (!fs.existsSync(drillPath)) {
		return { verdict: 'SKIP', reason: `runtime drill not found at ${path.relative(options.root, drillPath)}`, violations: [], modeFailures: [], doc: undefined, output: '' };
	}
	if (!nodeSupportsStripTypes(process.versions.node)) {
		return { verdict: 'SKIP', reason: `node ${process.versions.node} lacks --experimental-strip-types (need >= 22.6)`, violations: [], modeFailures: [], doc: undefined, output: '' };
	}
	const endpoint = process.env.FLAUZ_CDP_ENDPOINT ?? '';
	if (endpoint === '') {
		return { verdict: 'SKIP', reason: 'no FLAUZ_CDP_ENDPOINT (the runtime rung needs a real headless Chromium CDP WebSocket endpoint; see the drill header for the launch pattern)', violations: [], modeFailures: [], doc: undefined, output: '' };
	}
	const fixturesDir = options.fixtures ?? path.join(options.root, FIXTURES_REL);
	const verdictPath = path.join(osTmpdirSafe(), `flauz-agentos-battery-runtime-verdict-${process.pid}.json`);
	const run = spawnSync(process.execPath, ['--experimental-strip-types', drillPath], {
		cwd: options.root,
		env: { ...process.env, FLAUZ_CDP_ENDPOINT: endpoint, FLAUZ_AGENTOS_BATTERY_FIXTURES: fixturesDir, FLAUZ_AGENTOS_BATTERY_VERDICT: verdictPath },
		encoding: 'utf-8',
		maxBuffer: 32 * 1024 * 1024,
	});
	if (run.error !== undefined) {
		return { verdict: 'ERROR', reason: `failed to launch the runtime drill: ${run.error.message}`, violations: [], modeFailures: [], doc: undefined, output: '' };
	}
	const output = `${run.stdout ?? ''}\n${run.stderr ?? ''}`;
	if (run.status === 0) {
		const green = output.includes(RUNTIME_GREEN_PREFIX);
		if (green) {
			const read = readVerdictFile(verdictPath, 'runtime verdict');
			if (!read.ok) {
				return { verdict: 'FAIL', reason: `malformed runtime verdict document: ${read.violations.join('; ')}`, violations: read.violations, modeFailures: [], doc: read.doc, output };
			}
			const promoted = modeFailures(read.doc, options);
			return { verdict: promoted.length === 0 ? 'PASS' : 'FAIL', reason: promoted.length === 0 ? 'runtime drill green (verdict validated)' : promoted.join('; '), violations: [], modeFailures: promoted, doc: read.doc, output };
		}
		if (output.includes('agentos runtime drill: SKIP')) {
			const skipLine = output.split('\n').find(line => line.startsWith('agentos runtime drill: SKIP')) ?? 'agentos runtime drill: SKIP';
			return { verdict: 'SKIP', reason: skipLine, violations: [], modeFailures: [], doc: undefined, output };
		}
		return { verdict: 'FAIL', reason: 'runtime drill exited 0 without the GREEN line (malformed evidence)', violations: [], modeFailures: [], doc: undefined, output };
	}
	return { verdict: 'FAIL', reason: `runtime drill failed (exit ${run.status}; an instrument failure or journey crash)`, violations: [], modeFailures: [], doc: undefined, output };
}

function osTmpdirSafe() {
	// os.tmpdir without importing node:os (zero-dep spirit; stdlib fine either way)
	return process.env.TMPDIR ?? '/tmp';
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.list) {
		console.log('agentos-battery: the Agent OS durability invariant catalogue (TL2-S3)');
		for (const entry of CATALOGUE) {
			console.log(`  ${entry.id}  ${entry.name}`);
			console.log(`        ${entry.claim}`);
		}
		return;
	}

	// ---- standalone verdict-document validation mode (--verdict <file>) ----
	if (options.verdict !== undefined) {
		const read = readVerdictFile(options.verdict, 'verdict');
		for (const violation of read.violations) {
			console.error(`agentos-battery: ${violation}`);
		}
		if (read.doc !== undefined) {
			printVerdict(read.doc, options, `--verdict ${path.basename(options.verdict)}`);
		} else {
			console.log('-- verdict ---------------------------------------------------------------');
			console.log(`agentos-battery: FAIL -- verdict document unreadable/malformed [--verdict ${path.basename(options.verdict)}]`);
		}
		if (options.noFail) {
			return;
		}
		if (read.ok && modeFailures(read.doc, options).length === 0) {
			return;
		}
		process.exit(1);
	}

	// ---- the rung lanes ----
	const result = options.runtime ? runRuntimeRung(options) : runFixtureRung(options);
	if (options.json && result.doc !== undefined) {
		console.log(JSON.stringify(result.doc, null, '\t'));
	} else if (result.doc !== undefined) {
		for (const row of result.doc.rows) {
			const suffix = row.verdict === 'FAIL' ? ` -- ${row.violatedInvariant ?? row.reason}` : row.verdict === 'SKIP' ? ` -- ${row.reason}` : '';
			console.log(`${row.verdict}  ${row.invariant}${suffix}`);
		}
	}
	console.log('-- verdict ---------------------------------------------------------------');
	let verdictLine = `agentos-battery: ${result.verdict} -- ${result.reason}`;
	if (result.verdict === 'SKIP' && options.require) {
		const environmental = !result.modeFailures || result.modeFailures.length === 0;
		if (environmental) {
			verdictLine = `agentos-battery: FAIL (SKIP promoted by --require) -- ${result.reason}`;
		}
	}
	console.log(verdictLine);
	// relay the drill's verbatim evidence lines so the CI log carries the
	// GREEN line (the lane's assert greps the log for it; the gate checked it
	// internally but the raw line must also be visible)
	if (options.runtime && typeof result.output === 'string') {
		for (const line of result.output.split('\n')) {
			if (line.startsWith(RUNTIME_GREEN_PREFIX) || /^agentos runtime drill: \d+ assertions, \d+ failures$/.test(line) || line.startsWith('agentos runtime drill: ROW ')) {
				console.log(line);
			}
		}
	}

	if (options.noFail) {
		return;
	}
	if (result.verdict === 'PASS') {
		return;
	}
	if (result.verdict === 'SKIP') {
		if (options.require) {
			process.exit(1);
		}
		if (options.surgeRung) {
			process.exit(1);
		}
		return;
	}
	process.exit(1);
}

main();
