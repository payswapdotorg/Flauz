/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// ---------------------------------------------------------------------------------------------
// Flauz TL3-H2 - B-POLICY workbench boot drill evaluator (zero-dep).
//
// Closes the B-POLICY canary's "stays boot-level" residuals (A4/A6/A10
// notes; spec: build/flauz/canaries/B-POLICY.md "Workbench boot drill")
// as far as the architecture allows: a booted workbench, the lazy
// onCommand activation of flauz.flauz-browser through the REAL command
// machinery, the live `browser` proposal grant, a session opened through
// the REAL proposed-API surface (window.openBrowserTab +
// BrowserTab.startCDPSession + the TL3-002 hardening commands over the
// real session), a policy-DENIED navigation's typed denial + evidence
// row, and the runtime log lines in the workbench log corpus (the
// log-backed output channel).
//
// The DRIVER side is the test-driver extension fixture
// (test/fixtures/browser-policy-driver) installed into the canary
// profile's --extensions-dir; it invokes the flauz.browser.* command
// surface and writes <workspace>/.flauz/boot-drill/driver-report.json.
// This evaluator takes the launch coordinates: the report path (polled
// until the driver writes it), the boot log capture(s), the
// user-data-dir logs tree, and the fixture workspace root (the journal
// row).
//
// Honesty law (the compat-l3-smoke discipline): a row the evaluator
// CANNOT observe is reported as SKIP with the exact reason - NEVER a
// fake pass. The one such row today is the Electron webRequest
// ERR_BLOCKED_BY_CLIENT log line (A6): the runtime's policy deny sends
// ZERO CDP commands, so no request exists for the in-tree L2 filter to
// cancel; the line is asserted only when it actually appears in the
// corpus.
//
// Usage:
//   node b-policy-boot-drill.mjs --report <file> [--report-timeout <ms>]
//        [--log <file>]... [--log-dir <dir>]...
//        [--cdp-port <n>] [--cdp-host <h>] [--boot-timeout <ms>]
//        [--workspace <dir>]
//        [--fatal-regex <re>]... [--json] [--out <path>] [--no-fail]
//
//   --report <file>          the driver report path (polled until present
//                            + parseable; REQUIRED - the drill refuses to
//                            run without the driver channel).
//   --report-timeout <ms>    report poll budget (default 120000).
//   --log <file>             (repeatable) captured log file to scan (the
//                            boot stdout/stderr capture).
//   --log-dir <dir>          (repeatable) directory tree scanned for *.log
//                            (recursive) - the --user-data-dir/logs tree,
//                            where the log-backed flauz-browser channel
//                            file lives (<logs>/<ext-id>/<name>.log).
//   --cdp-port <n>           optional CDP port (boot readiness: /json/version
//                            polled until 2xx). SKIP row when absent.
//   --cdp-host <h>           CDP host (default 127.0.0.1).
//   --boot-timeout <ms>      CDP readiness poll budget (default 120000).
//   --workspace <dir>        the fixture workspace root (the journal row:
//                            .flauz/browser-sessions.jsonl). SKIP when
//                            absent.
//   --fatal-regex <re>       (repeatable) ADDS a fatal pattern for
//                            boot.log-clean on top of the defaults.
//   --json                   machine output (the compat-battery meta shape).
//   --out <path>             write the JSON report to a file as well.
//   --no-fail                report-only: FAIL rows printed but exit 0.
//
// Exit codes: 0 pass / SKIP-only; 1 FAIL row(s) present; 2 usage error.
//
// Zero dependencies: node >= 20 stdlib only (global fetch).
// ---------------------------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const EXIT_OK = 0, EXIT_FAIL = 1, EXIT_USAGE = 2;
const VERSION = 1;

const REPORT_SCHEMA = 'flauz.bpolicy-boot-driver/v0';

// Conservative fatal patterns (the b-policy-canary 'Unresponsive|Fatal error'
// pair + the compat-l3 defaults). --fatal-regex ADDS to this set.
const DEFAULT_FATAL_PATTERNS = ['Unresponsive', 'Fatal error', 'terminated unexpectedly', 'uncaught exception'];

// The proposal trip-wires (extensionsProposedApi.ts:48,73 and extensions.ts:332,
// extensionsProposedApi.ts:112): a dead/renamed proposal or a stripped product
// grant logs exactly these. The positive fact (the grant is live and usable) is
// proven by the driver's session-open row - the API call itself runs
// checkProposedApiEnabled under the grant.
const PROPOSAL_DEAD_PATTERNS = [
	/wants API proposal '[^']*' but that proposal DOES NOT EXIST/,
	/CANNOT use API proposal: browser/,
	/CANNOT USE these API proposals/,
];

// The A4-class runtime log lines (src/extension.ts logEffectivePolicy is NOT
// needed here; the RUNTIME lines are the boot residuals): host selection +
// the openSession line. These live in the log-backed channel file under the
// logs tree (src/extension.ts creates the channel with { log: true }).
const RUNTIME_HOST_LINE = /flauz\.browser: runtime host = workbench \(proposed browser API, posture P0\)/;
const OPEN_SESSION_LINE = /flauz\.browser: openSession flauz:browser:[0-9a-f]{16} initiator=agent partition=persist:flauz-[0-9a-f]{16}-boot-drill state=active/;

// The A6 log line (a real Electron webRequest cancellation): asserted only
// when observed (honest SKIP otherwise - see the header).
const ERR_BLOCKED_PATTERN = /ERR_BLOCKED_BY_CLIENT/;

// The compat-l3-proven activation marker: the ExtensionService record for
// the lazy onCommand activation of the flauz-browser built-in.
const FLAUZ_ACTIVATION_PATTERN = /ExtensionService#_doActivateExtension flauz\.flauz-browser/;

const rows = [];

class UsageError extends Error { }

function usage() {
	process.stdout.write(`b-policy-boot-drill.mjs - B-POLICY workbench boot drill evaluator (TL3-H2)

Usage:
	node b-policy-boot-drill.mjs --report <file> [flags]

	--report <file>          driver report path (polled; REQUIRED)
	--report-timeout <ms>    report poll budget (default 120000)
	--log <file>             boot log to scan (repeatable)
	--log-dir <dir>          log directory to scan, recursive *.log (repeatable)
	--cdp-port <n>           CDP port for the boot readiness row (optional)
	--cdp-host <h>           CDP host (default 127.0.0.1)
	--boot-timeout <ms>      CDP readiness poll budget (default 120000)
	--workspace <dir>        fixture workspace root (the journal row)
	--fatal-regex <re>       fatal log pattern (repeatable, ADDS to defaults)
	--json                   JSON report to stdout
	--out <path>             write JSON report to path
	--no-fail                report-only (always exit 0)

Exit codes: 0 pass/SKIP-only; 1 FAIL rows; 2 usage error.
`);
}

function rowAdd(id, status, detail) {
	rows.push({ id, status, detail: String(detail) });
	const marker = status === 'PASS' ? 'PASS ' : status === 'SKIP' ? 'SKIP ' : 'FAIL ';
	process.stdout.write(`${marker} ${id} -- ${detail}\n`);
}

const pass = (id, detail) => rowAdd(id, 'PASS', detail);
const fail = (id, detail) => rowAdd(id, 'FAIL', detail);
const skip = (id, detail) => rowAdd(id, 'SKIP', detail);

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

/** Collects the log corpus: the --log files (as text) + every *.log under the --log-dir trees. */
function collectLogCorpus(logFiles, logDirs) {
	const corpus = [];
	for (const file of logFiles) {
		try {
			corpus.push({ path: file, text: fs.readFileSync(file, 'utf8') });
		} catch {
			// A missing capture is not a drill failure by itself (the corpus may
			// live only in the logs tree); the rows below fail on empty evidence.
		}
	}
	const walk = dir => {
		let entries;
		try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
		for (const entry of entries) {
			const p = path.join(dir, entry.name);
			if (entry.isDirectory()) { walk(p); }
			else if (entry.isFile() && entry.name.endsWith('.log')) {
				try { corpus.push({ path: p, text: fs.readFileSync(p, 'utf8') }); } catch { /* unreadable: skip */ }
			}
		}
	};
	for (const dir of logDirs) { walk(dir); }
	return corpus;
}

function corpusText(corpus) {
	return corpus.map(entry => entry.text).join('\n');
}

function corpusMatches(corpus, pattern) {
	return corpus.some(entry => pattern.test(entry.text));
}

function readJsonSafe(file) {
	try {
		return JSON.parse(fs.readFileSync(file, 'utf8'));
	} catch (err) {
		return { __parseError: err instanceof Error ? err.message : String(err) };
	}
}

function parsePositiveInt(value, label, fallback) {
	if (value === undefined || value === '') { return fallback; }
	const n = Number(value);
	if (!Number.isInteger(n) || n < 1) {
		throw new UsageError(`--${label} must be a positive integer (got '${value}')`);
	}
	return n;
}

async function pollCdp(cdpHost, cdpPort, bootTimeoutMs) {
	const deadline = Date.now() + bootTimeoutMs;
	const url = `http://${cdpHost}:${cdpPort}/json/version`;
	for (;;) {
		try {
			const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
			if (response.ok) {
				return `CDP /json/version answered ${response.status} at ${url}`;
			}
		} catch { /* poll again */ }
		if (Date.now() >= deadline) {
			return undefined;
		}
		await sleep(500);
	}
}

async function waitForReport(reportPath, reportTimeoutMs) {
	const deadline = Date.now() + reportTimeoutMs;
	for (;;) {
		if (fs.existsSync(reportPath)) {
			const report = readJsonSafe(reportPath);
			if (report.__parseError === undefined && report.schema === REPORT_SCHEMA) {
				return report;
			}
			// Present but not final/parsable: keep polling until the budget
			// expires (the driver writes once, at the end).
			if (report.__parseError === undefined) {
				return { __schemaMismatch: report.schema };
			}
		}
		if (Date.now() >= deadline) {
			return undefined;
		}
		await sleep(500);
	}
}

function evaluateDriverRows(report) {
	if (!Array.isArray(report.rows)) {
		fail('driver.report-rows', 'the driver report carries no rows array');
		return;
	}
	for (const entry of report.rows) {
		const id = typeof entry?.id === 'string' ? entry.id : 'driver.<unnamed>';
		const ok = entry?.ok === true;
		const detail = typeof entry?.detail === 'string' ? entry.detail : JSON.stringify(entry);
		if (ok) { pass(id, detail); }
		else { fail(id, detail); }
	}
}

function evaluateJournal(workspaceRoot) {
	const journalPath = path.join(workspaceRoot, '.flauz', 'browser-sessions.jsonl');
	let text;
	try {
		text = fs.readFileSync(journalPath, 'utf8');
	} catch {
		fail('boot.journal-records', `the session journal ${journalPath} is absent - the booted runtime wrote no journal (the open path is fail-closed on journal failures: this means openSession never succeeded)`);
		return;
	}
	const lines = text.split('\n').filter(line => line.trim() !== '');
	let opened = false;
	let closed = false;
	let partitionOk = false;
	let malformed = 0;
	for (const line of lines) {
		try {
			const record = JSON.parse(line);
			if (record.schema !== 'flauz.browser-session-journal/v0') { malformed += 1; continue; }
			const partition = record.descriptor?.partition;
			if (typeof partition !== 'string') { malformed += 1; continue; }
			if (record.event === 'opened' && record.actor === 'agent' && /^persist:flauz-[0-9a-f]{16}-boot-drill$/.test(partition)) { opened = true; }
			if (record.event === 'closed') { closed = true; }
			if (/^persist:flauz-[0-9a-f]{16}-boot-drill$/.test(partition)) { partitionOk = true; }
		} catch {
			malformed += 1;
		}
	}
	if (opened && closed && partitionOk && malformed === 0) {
		pass('boot.journal-records', `${lines.length} journal record(s); the agent session's 'opened' + 'closed' records carry the persist:flauz-<16hex>-boot-drill partition (PIN-1 runtime evidence from the booted workbench)`);
	} else {
		fail('boot.journal-records', `journal content mismatch: opened=${opened} closed=${closed} partitionOk=${partitionOk} malformed=${malformed} (${lines.length} lines at ${journalPath})`);
	}
}

async function main() {
	let parsed;
	try {
		parsed = parseArgs({
			allowPositionals: false,
			options: {
				report: { type: 'string' },
				'report-timeout': { type: 'string' },
				log: { type: 'string', multiple: true },
				'log-dir': { type: 'string', multiple: true },
				'cdp-port': { type: 'string' },
				'cdp-host': { type: 'string', default: '127.0.0.1' },
				'boot-timeout': { type: 'string' },
				workspace: { type: 'string' },
				'fatal-regex': { type: 'string', multiple: true },
				json: { type: 'boolean', default: false },
				out: { type: 'string' },
				'no-fail': { type: 'boolean', default: false },
				help: { type: 'boolean', default: false },
			},
		});
	} catch (err) {
		process.stderr.write(`usage error: ${err.message}\n\n`);
		usage();
		process.exit(EXIT_USAGE);
	}
	const args = parsed.values;
	if (args.help) { usage(); process.exit(EXIT_OK); }
	if (args.report === undefined || args.report === '') {
		process.stderr.write('usage error: --report <file> is required (the driver report is the drill channel)\n\n');
		usage();
		process.exit(EXIT_USAGE);
	}
	const reportTimeoutMs = parsePositiveInt(args['report-timeout'], 'report-timeout', 120000);
	const bootTimeoutMs = parsePositiveInt(args['boot-timeout'], 'boot-timeout', 120000);
	const cdpPort = args['cdp-port'] !== undefined ? parsePositiveInt(args['cdp-port'], 'cdp-port', undefined) : undefined;
	const fatalPatterns = DEFAULT_FATAL_PATTERNS.map(source => new RegExp(source));
	for (const spec of (args['fatal-regex'] ?? [])) {
		try { fatalPatterns.push(new RegExp(spec)); } catch (err) {
			process.stderr.write(`usage error: --fatal-regex '${spec}': ${err.message}\n`);
			process.exit(EXIT_USAGE);
		}
	}

	// ---- boot readiness (optional CDP row, the compat-l3 pattern) ----
	if (cdpPort !== undefined) {
		const detail = await pollCdp(args['cdp-host'], cdpPort, bootTimeoutMs);
		if (detail === undefined) {
			fail('boot.cdp-reachable', `CDP /json/version did not answer within ${bootTimeoutMs}ms at ${args['cdp-host']}:${cdpPort} - the workbench did not finish booting`);
		} else {
			pass('boot.cdp-reachable', detail);
		}
	} else {
		skip('boot.cdp-reachable', 'no --cdp-port wired (the boot readiness row is optional; the driver report is the drill channel)');
	}

	// ---- the driver report (the drill channel) ----
	const report = await waitForReport(args.report, reportTimeoutMs);
	if (report === undefined) {
		fail('boot.driver-report', `the driver report ${args.report} did not appear within ${reportTimeoutMs}ms - the test-driver extension did not run (or crashed before writing)`);
	} else if (report.__schemaMismatch !== undefined) {
		fail('boot.driver-report', `the report at ${args.report} carries schema '${report.__schemaMismatch}' (expected '${REPORT_SCHEMA}')`);
	} else {
		pass('boot.driver-report', `the driver ran in the booted workbench and wrote ${args.report} (schema ${REPORT_SCHEMA}, vscode ${report.vscodeVersion ?? '?'}, ${Array.isArray(report.rows) ? report.rows.length : 0} rows)`);
	}

	// ---- the log corpus rows ----
	const corpus = collectLogCorpus(args.log ?? [], args['log-dir'] ?? []);
	if (corpus.length === 0) {
		fail('boot.log-corpus', 'the log corpus is EMPTY - no --log captures and no *.log under the --log-dir trees; the boot-level greps have no evidence');
	} else {
		pass('boot.log-corpus', `${corpus.length} log file(s) in the corpus (${corpus.map(e => path.basename(e.path)).slice(0, 8).join(', ')}${corpus.length > 8 ? ', ...' : ''})`);

		const text = corpusText(corpus);
		// log-clean
		const fatals = fatalPatterns.filter(pattern => pattern.test(text));
		if (fatals.length === 0) {
			pass('boot.log-clean', `no fatal pattern in the corpus (${fatalPatterns.map(p => p.source).join(' | ')})`);
		} else {
			fail('boot.log-clean', `fatal pattern(s) present: ${fatals.map(p => p.source).join(' | ')}`);
		}

		// flauz-browser activation record (the compat-l3 proven marker; the
		// record line also carries activationEvent: 'onCommand:flauz.browser.*',
		// proving the activation was command-driven, never eager)
		const activationLine = text.split('\n').find(line => FLAUZ_ACTIVATION_PATTERN.test(line));
		if (activationLine !== undefined) {
			pass('boot.flauz-activated', `activation record present: ${activationLine.trim().slice(0, 220)}`);
		} else {
			fail('boot.flauz-activated', 'no ExtensionService#_doActivateExtension flauz.flauz-browser record in the corpus - the command surface never activated (the driver report rows say the same)');
		}

		// the proposal grant trip-wires (A3-class): dead proposal / stripped grant
		const deadProposalLines = [];
		for (const pattern of PROPOSAL_DEAD_PATTERNS) {
			const patternHit = text.split('\n').filter(line => pattern.test(line)).slice(0, 2);
			deadProposalLines.push(...patternHit);
		}
		if (deadProposalLines.length === 0) {
			pass('boot.proposal-grant-live', 'no proposal trip-wire fired (no DOES-NOT-EXIST / CANNOT-use-proposal lines for the browser grant); the grant is exercised live by the driver session-open row');
		} else {
			fail('boot.proposal-grant-live', `proposal trip-wire(s) fired: ${deadProposalLines.map(l => l.trim().slice(0, 200)).join(' || ')}`);
		}

		// the A4 runtime log lines (log-backed channel -> logs tree)
		if (corpusMatches(corpus, RUNTIME_HOST_LINE)) {
			pass('boot.runtime-host-log-line', "'flauz.browser: runtime host = workbench (proposed browser API, posture P0)' present in the corpus (the A4 runtime log line, boot-verified)");
		} else {
			fail('boot.runtime-host-log-line', 'the P0 runtime-host log line is absent from the corpus - either the session never opened (see the driver rows) or the log-backed channel file is not under the --log-dir tree');
		}
		if (corpusMatches(corpus, OPEN_SESSION_LINE)) {
			pass('boot.openSession-log-line', "'flauz.browser: openSession flauz:browser:<id> initiator=agent partition=persist:flauz-<16hex>-boot-drill state=active' present in the corpus (the A4 openSession runtime log line, boot-verified)");
		} else {
			fail('boot.openSession-log-line', 'the openSession runtime log line is absent from the corpus (the driver rows carry the authoritative result; this grep proves the log-corpus surface)');
		}

		// the A6 Electron webRequest log line: PASS when observed, honest SKIP
		// otherwise (the runtime deny sends zero commands - nothing for L2 to
		// cancel; the line needs a real agent-scope content cancellation).
		if (corpusMatches(corpus, ERR_BLOCKED_PATTERN)) {
			pass('boot.err-blocked-by-client', 'ERR_BLOCKED_BY_CLIENT observed in the corpus (the A6 Electron webRequest log line, boot-verified)');
		} else {
			skip('boot.err-blocked-by-client', 'ERR_BLOCKED_BY_CLIENT not observed: the drill\'s policy-denied navigation sends ZERO CDP commands (the runtime\'s driver gate is authoritative BEFORE the wire), so no request exists for the in-tree L2 webRequest filter to cancel; observing the line would require a real agent-scope content request blocked under the canary settings - recorded as the remaining boundary, not faked');
		}
	}

	// ---- the driver rows (mirrored) ----
	if (report !== undefined && report.__schemaMismatch === undefined) {
		evaluateDriverRows(report);
	}

	// ---- the session journal (runtime file evidence from the booted workbench) ----
	if (args.workspace !== undefined) {
		evaluateJournal(args.workspace);
	} else {
		skip('boot.journal-records', 'no --workspace wired (the journal row needs the fixture workspace root)');
	}

	// ---- verdict ----
	const failCount = rows.filter(r => r.status === 'FAIL').length;
	const skipCount = rows.filter(r => r.status === 'SKIP').length;
	const passCount = rows.filter(r => r.status === 'PASS').length;
	const verdict = failCount === 0
		? `B-POLICY BOOT DRILL GREEN (${passCount} PASS, ${skipCount} SKIP-with-reason)`
		: `B-POLICY BOOT DRILL FAIL (${failCount} FAIL, ${passCount} PASS, ${skipCount} SKIP)`;
	process.stdout.write(`-- verdict ${'-'.repeat(51)}\n${verdict}\n`);

	if (args.json || args.out !== undefined) {
		const payload = { version: VERSION, verdict, counts: { pass: passCount, fail: failCount, skip: skipCount }, rows };
		const text = JSON.stringify(payload, null, 1);
		if (args.out !== undefined) {
			fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
			fs.writeFileSync(args.out, text + '\n');
		}
		if (args.json) {
			process.stdout.write('\n<flauz-bpolicy-boot-drill-json>\n' + text + '\n</flauz-bpolicy-boot-drill-json>\n');
		}
	}

	if (failCount === 0 || args['no-fail']) { process.exit(EXIT_OK); }
	process.exit(EXIT_FAIL);
}

main().catch(err => {
	process.stderr.write(`internal error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
	process.exit(EXIT_USAGE);
});
