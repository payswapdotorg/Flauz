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
//                            [--runtime]
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
//   --runtime         run the RUNTIME rung instead of the fixture rung
//                     (TL4-007): the same J1-J4 journeys over the REAL
//                     ports -- the real CdpEndpointHost +
//                     BrowserSessionManager against a real headless
//                     Chromium over a real CDP WebSocket, and the real
//                     LocalProcessExecutor for the environment leg -- via
//                     the drill
//                     extensions/flauz-workflow/test/canaries/session-battery-runtime.drill.ts.
//                     The endpoint comes from the caller's environment
//                     (FLAUZ_CDP_ENDPOINT); without it the gate reports
//                     SKIP (exit 0), or FAIL under --require (CI evidence
//                     mode). Without --runtime the gate's behavior is
//                     byte-compatible with the fixture rung.
//
// Exit codes: 0 = green or SKIP-without-require (either rung) *
// 1 = FAIL/SKIP-with-require (either rung) * 2 = usage/environment error.
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
const RUNTIME_DRILL_REL = path.join('extensions', 'flauz-workflow', 'test', 'canaries', 'session-battery-runtime.drill.ts');
const RUNTIME_GREEN_LINE = 'session-battery runtime drill: GREEN (J1-J4 over real CDP + LocalProcessExecutor)';
const RUNTIME_SKIP_PREFIX = 'session-battery runtime drill: SKIP';

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
        const options = { root: DEFAULT_ROOT, fixtures: undefined, json: false, list: false, require: false, noFail: false, runtime: false };
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
        console.log('usage: node session-battery.mjs [--root <dir>] [--fixtures <dir>] [--json] [--list] [--require] [--no-fail] [--runtime]');
        console.log('  --runtime  run the RUNTIME rung instead of the fixture rung: the same J1-J4 journeys over real CDP (a real headless Chromium via FLAUZ_CDP_ENDPOINT) + the real LocalProcessExecutor, via the session-battery-runtime drill; SKIP without the endpoint (FAIL under --require)');
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

// TL4-007 -- the RUNTIME rung: locate the drill, spawn it under
// --experimental-strip-types with the caller-provided FLAUZ_CDP_ENDPOINT,
// and enforce BOTH its exit code and its GREEN line (a drill that exits 0
// without asserting green is not evidence).
function runRuntimeDrill(root) {
        const drillPath = path.join(root, RUNTIME_DRILL_REL);
        if (!fs.existsSync(drillPath)) {
                return { verdict: 'SKIP', reason: `runtime drill not found at ${path.relative(root, drillPath)}`, pass: -1, fail: -1, output: '' };
        }
        if (!nodeSupportsStripTypes(process.versions.node)) {
                return { verdict: 'SKIP', reason: `node ${process.versions.node} lacks --experimental-strip-types (need >= 22.6)`, pass: -1, fail: -1, output: '' };
        }
        const endpoint = process.env.FLAUZ_CDP_ENDPOINT ?? '';
        if (endpoint === '') {
                return { verdict: 'SKIP', reason: 'no FLAUZ_CDP_ENDPOINT (the runtime rung needs a real headless Chromium CDP WebSocket endpoint; see the drill header for the launch pattern)', pass: -1, fail: -1, output: '' };
        }
        const run = spawnSync(process.execPath, ['--experimental-strip-types', drillPath], {
                cwd: root,
                env: { ...process.env, FLAUZ_CDP_ENDPOINT: endpoint },
                encoding: 'utf-8',
                maxBuffer: 32 * 1024 * 1024,
        });
        if (run.error !== undefined) {
                return { verdict: 'ERROR', reason: `failed to launch the runtime drill: ${run.error.message}`, pass: -1, fail: -1, output: '' };
        }
        const output = `${run.stdout ?? ''}\n${run.stderr ?? ''}`;
        if (run.status === 0) {
                if (output.includes(RUNTIME_GREEN_LINE)) {
                        const countMatch = output.match(/session-battery runtime drill: (\d+) assertions, (\d+) failures/);
                        const assertionCount = countMatch !== null ? Number.parseInt(countMatch[1], 10) : -1;
                        return { verdict: 'PASS', reason: `runtime drill green (${assertionCount >= 0 ? assertionCount : '?'} assertions, real CDP + LocalProcessExecutor)`, pass: assertionCount, fail: 0, output };
                }
                if (output.includes(RUNTIME_SKIP_PREFIX)) {
                        const skipLine = output.split('\n').find(line => line.startsWith(RUNTIME_SKIP_PREFIX)) ?? RUNTIME_SKIP_PREFIX;
                        return { verdict: 'SKIP', reason: skipLine, pass: -1, fail: -1, output };
                }
                return { verdict: 'FAIL', reason: 'runtime drill exited 0 without the GREEN line (malformed evidence)', pass: -1, fail: -1, output };
        }
        return { verdict: 'FAIL', reason: `runtime drill failed (exit ${run.status})`, pass: -1, fail: -1, output };
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

        // ---- the RUNTIME rung lane (TL4-007): real CDP + LocalProcessExecutor ----
        if (options.runtime) {
                const result = runRuntimeDrill(options.root);
                const rows = JOURNEYS.map(journey => {
                        if (result.verdict === 'PASS') {
                                return `PASS  ${journey.id} ${journey.name}`;
                        }
                        if (result.verdict === 'SKIP' || result.verdict === 'ERROR') {
                                return `${result.verdict}  ${journey.id} ${journey.name} -- ${result.reason}`;
                        }
                        return `FAIL  ${journey.id} ${journey.name} -- runtime drill failed`;
                });
                const fixtureRow = result.verdict === 'PASS'
                        ? 'PASS  fixture  normalized runtime transcript matched (0 deviations)'
                        : `${result.verdict}  fixture  ${result.reason}`;

                if (options.json) {
                        console.log(JSON.stringify({ gate: 'session-battery', rung: 'runtime', verdict: result.verdict, pass: result.pass, fail: result.fail, reason: result.reason, journeys: JOURNEYS }, null, '\t'));
                } else {
                        console.log(`session-battery: runtime drill ${RUNTIME_DRILL_REL.split(path.sep).join('/')}`);
                        console.log(`session-battery: endpoint ${process.env.FLAUZ_CDP_ENDPOINT ?? '(none)'}`);
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
