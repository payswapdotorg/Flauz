/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// ---------------------------------------------------------------------------------------------
// Flauz TL4 (product-quality lane) -- task TL4-004.
//
// session-battery.mjs -- the whole-session acceptance gate (fixture rung).
//
// Mission: a green unit-test suite is not a green product. This gate runs
// the whole-session battery -- four scripted user journeys that drive the
// REAL Flauz surfaces end to end (flauz.tasks/v0 state machine, evidence
// ledger, workflow envelope save + re-run, browser session manager over a
// FakeCdpTransport with the policy engine + on-disk journal, environment
// lifecycle behind the simulated remote executor) and compare the
// distilled observable transcript against the pinned fixture
// test/fixtures/session-battery/golden-transcript.json.
//
// The journeys (spec: docs/FLAUZ-PROGRAM/TL4-SESSION-BATTERY.md):
//   J1 golden      -- create task -> plan -> approve -> tool -> browser leg
//                    (allowed navigation) -> environment leg (lifecycle) ->
//                    verify -> sign-off -> save fragment.
//   J2 recovery    -- re-run the saved fragment (replay approvals): new
//                    task, derived evidence (derivedFrom), history row.
//   J3 fail-closed -- denied navigation sends ZERO drive commands; the
//                    provenance law rejects actor-less lifecycle ops.
//   J4 continuity  -- full restart on the same root: tasks, workflows,
//                    lifecycle state, browser journal all recover; work
//                    continues.
//
// Runner model: the battery suite is a node:test file importing the real
// extension sources (.ts) -- it needs node >= 22.6 (--experimental-strip-types).
// On older nodes the gate reports SKIP rows (the battery itself is still
// exercised in CI's compiled unit-test subset, where the suite runs as
// compiled .js). With --require a SKIP is a FAIL (CI evidence mode).
//
// Usage:
//   node session-battery.mjs [--root <dir>] [--fixtures <dir>]
//                            [--json] [--list] [--require] [--no-fail]
//
//   --root <dir>      repository root (default: the repo containing this
//                     script). The suite lives at
//                     <root>/extensions/flauz-workflow/test/session-battery.test.ts.
//   --fixtures <dir>  pinned-transcript directory (default:
//                     <root>/test/fixtures/session-battery). Must contain
//                     golden-transcript.json.
//   --json            machine-readable verdict document on stdout.
//   --list            print the journey catalogue and exit 0.
//   --require         evidence mode: SKIP verdicts FAIL the gate.
//   --no-fail         always exit 0 (reporting only).
//
// Exit codes: 0 = battery green * 1 = battery FAIL/SKIP-with-require *
// 2 = usage/environment error.
// ---------------------------------------------------------------------------------------------

'use strict';

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import process from 'node:process';

const SCRIPT_DIR = path.dirname(fileURLToPathSafe());
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..');
const SUITE_REL = path.join('extensions', 'flauz-workflow', 'test', 'session-battery.test.ts');
const FIXTURES_REL = path.join('test', 'fixtures', 'session-battery');

/** fileURLToPath without depending on node:url (zero-dep spirit; stdlib fine either way). */
function fileURLToPathSafe() {
	const url = import.meta.url;
	const prefix = 'file://';
	if (!url.startsWith(prefix)) {
		throw new Error(`session-battery: unsupported module url ${url}`);
	}
	let target = url.slice(prefix.length);
	if (process.platform === 'win32') {
		target = target.replace(/^\/([A-Za-z]:)/, '$1');
	}
	return decodeURIComponent(target);
}

function parseArgs(argv) {
	const options = { root: DEFAULT_ROOT, fixtures: undefined, json: false, list: false, require: false, noFail: false };
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		switch (arg) {
			case '--root':
				options.root = requireValue(argv, ++i, arg);
				break;
			case '--fixtures':
				options.fixtures = requireValue(argv, ++i, arg);
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
	console.log('usage: node session-battery.mjs [--root <dir>] [--fixtures <dir>] [--json] [--list] [--require] [--no-fail]');
}

function usageError(message) {
	printUsage();
	console.error(`session-battery: usage error: ${message}`);
	process.exit(2);
}

const JOURNEYS = [
	{ id: 'J1', name: 'golden whole-session (task -> plan -> approve -> tool -> browser -> environment -> verify -> sign-off -> save fragment)' },
	{ id: 'J2', name: 'recovery re-run (replay approvals, derived evidence, fragment history)' },
	{ id: 'J3', name: 'fail-closed (denied navigation: zero drive commands; provenance law)' },
	{ id: 'J4', name: 'continuity (full restart on the same root: everything recovers)' },
];

/** node >= 22.6 carries --experimental-strip-types (type stripping). */
function nodeSupportsStripTypes(nodeVersion) {
	const parts = nodeVersion.split('.').map(part => Number.parseInt(part, 10));
	if (parts.length < 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) {
		return false;
	}
	return parts[0] > 22 || (parts[0] === 22 && parts[1] >= 6);
}

function runBattery(root, fixturesDir) {
	const suitePath = path.join(root, SUITE_REL);
	if (!fs.existsSync(suitePath)) {
		return { verdict: 'SKIP', reason: `battery suite not found at ${path.relative(root, suitePath)}`, pass: 0, fail: 0, output: '' };
	}
	if (!fs.existsSync(path.join(fixturesDir, 'golden-transcript.json'))) {
		return { verdict: 'ERROR', reason: `pinned fixture not found at ${path.relative(root, fixturesDir)}${path.sep}golden-transcript.json`, pass: 0, fail: 0, output: '' };
	}
	if (!nodeSupportsStripTypes(process.versions.node)) {
		return { verdict: 'SKIP', reason: `node ${process.versions.node} lacks --experimental-strip-types (need >= 22.6); the battery runs in CI's compiled unit-test subset instead`, pass: 0, fail: 0, output: '' };
	}
	const run = spawnSync(process.execPath, ['--experimental-strip-types', '--test', suitePath], {
		cwd: root,
		env: { ...process.env, FLAUZ_SESSION_BATTERY_FIXTURES: fixturesDir },
		encoding: 'utf-8',
		maxBuffer: 32 * 1024 * 1024,
	});
	if (run.error !== undefined) {
		return { verdict: 'ERROR', reason: `failed to launch the battery runner: ${run.error.message}`, pass: 0, fail: 0, output: '' };
	}
	if (run.stderr !== undefined && run.stderr.includes('bad option')) {
		return { verdict: 'SKIP', reason: 'this node rejects --experimental-strip-types (need >= 22.6)', pass: 0, fail: 0, output: run.stderr };
	}
	const output = `${run.stdout ?? ''}\n${run.stderr ?? ''}`;
	// TAP pipes emit "# pass N"; the spec reporter pipes emit "pass N" behind a
	// one-glyph status mark -- accept both without embedding non-ASCII.
	const passMatches = output.match(/^# pass (\d+)$/m) ?? output.match(/^.{0,2}pass (\d+)\s*$/m);
	const failMatches = output.match(/^# fail (\d+)$/m) ?? output.match(/^.{0,2}fail (\d+)\s*$/m);
	const pass = passMatches !== null ? Number.parseInt(passMatches[1], 10) : -1;
	const fail = failMatches !== null ? Number.parseInt(failMatches[1], 10) : -1;
	if (run.status === 0) {
		return { verdict: 'PASS', reason: `battery green (${pass >= 0 ? pass : '?'} tests)`, pass, fail, output };
	}
	return { verdict: 'FAIL', reason: `battery failed (exit ${run.status}${fail > 0 ? `, ${fail} failing tests` : ''})`, pass, fail, output };
}

function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.list) {
		console.log('session-battery: journey catalogue');
		for (const journey of JOURNEYS) {
			console.log(`  ${journey.id}  ${journey.name}`);
		}
		return;
	}
	const fixturesDir = options.fixtures ?? path.join(options.root, FIXTURES_REL);
	const result = runBattery(options.root, fixturesDir);

	const rows = JOURNEYS.map(journey => {
		if (result.verdict === 'PASS') {
			return `PASS  ${journey.id} ${journey.name}`;
		}
		if (result.verdict === 'SKIP' || result.verdict === 'ERROR') {
			return `${result.verdict}  ${journey.id} ${journey.name} -- ${result.reason}`;
		}
		return `FAIL  ${journey.id} ${journey.name} -- battery run failed`;
	});
	const fixtureRow = result.verdict === 'PASS'
		? 'PASS  fixture  golden transcript matched (0 deviations)'
		: `${result.verdict}  fixture  ${result.reason}`;

	if (options.json) {
		console.log(JSON.stringify({ gate: 'session-battery', verdict: result.verdict, pass: result.pass, fail: result.fail, reason: result.reason, journeys: JOURNEYS }, null, '\t'));
	} else {
		console.log(`session-battery: suite ${SUITE_REL.split(path.sep).join('/')}`);
		console.log(`session-battery: fixtures ${path.relative(options.root, fixturesDir)}`);
		for (const row of rows) {
			console.log(row);
		}
		console.log(fixtureRow);
		console.log('-- verdict ---------------------------------------------------------------');
		let verdictLine = `session-battery: ${result.verdict} -- ${result.reason}`;
		if (result.verdict === 'SKIP' && options.require) {
			verdictLine = `session-battery: FAIL (SKIP promoted by --require) -- ${result.reason}`;
		}
		console.log(verdictLine);
	}

	if (options.noFail) {
		return;
	}
	if (result.verdict === 'PASS') {
		return;
	}
	if (result.verdict === 'SKIP' && !options.require) {
		return;
	}
	process.exit(1);
}

main();
