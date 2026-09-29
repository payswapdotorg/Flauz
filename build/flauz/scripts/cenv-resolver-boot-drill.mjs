/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// ---------------------------------------------------------------------------------------------
// Flauz TL3-H1 - C-ENV resolver rung 2 workbench boot drill evaluator
// (zero-dep).
//
// Asserts the TL3-H1 CI job's boot-level rows: a booted workbench, the lazy
// onCommand activation of flauz.flauz-environments through the REAL command
// machinery, the live `resolvers` proposal grant (the registration surface
// row + the log-side proposal trip-wires), the typed resolution failures
// (AUTHORITY_MALFORMED / ENVIRONMENT_ABSENT), and the both-directions trust
// gate at the command level (TRUST_REFUSED for an unproven trusted entry and
// an untrusted one).
//
// The DRIVER side is the test-driver extension fixture
// (test/fixtures/resolver-driver) installed into the canary profile's
// --extensions-dir; it invokes the flauz.env.* command surface and writes
// <workspace>/.flauz/resolver-drill/driver-report.json. This evaluator takes
// the launch coordinates: the report path (polled until the driver writes
// it), the boot log capture, and the user-data-dir logs tree (the
// ExtensionService activation record).
//
// Honesty law (the b-policy-boot-drill discipline): a row the evaluator
// CANNOT observe is reported as SKIP with the exact reason - NEVER a fake
// pass.
//
// Usage:
//   node cenv-resolver-boot-drill.mjs --report <file> [--report-timeout <ms>]
//        [--log <file>]... [--log-dir <dir>]...
//        [--fatal-regex <re>]... [--json] [--out <path>] [--no-fail]
//
//   --report <file>          the driver report path (polled until present
//                            + parseable; REQUIRED - the drill refuses to
//                            run without the driver channel).
//   --report-timeout <ms>    report poll budget (default 180000).
//   --log <file>             (repeatable) captured log file to scan (the
//                            boot stdout/stderr capture).
//   --log-dir <dir>          (repeatable) directory tree scanned for *.log
//                            (recursive) - the --user-data-dir/logs tree,
//                            where the renderer log (and the
//                            ExtensionService activation record) lives.
//   --fatal-regex <re>       (repeatable) ADDS a fatal pattern for
//                            boot.log-clean on top of the defaults.
//   --json                   machine output (the compat-battery meta shape).
//   --out <path>             write the JSON report to a file as well.
//   --no-fail                report-only: FAIL rows printed but exit 0.
//
// Exit codes: 0 pass / SKIP-only; 1 FAIL row(s) present; 2 usage error.
//
// Zero dependencies: node >= 20 stdlib only.
// ---------------------------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const EXIT_OK = 0, EXIT_FAIL = 1, EXIT_USAGE = 2;
const VERSION = 1;

const REPORT_SCHEMA = 'flauz.cenv-resolver-boot-driver/v0';

// Conservative fatal patterns (the cenv-canary 'Unresponsive|Fatal error'
// pair + the compat-l3 defaults). --fatal-regex ADDS to this set.
const DEFAULT_FATAL_PATTERNS = ['Unresponsive', 'Fatal error', 'terminated unexpectedly', 'uncaught exception'];

// The proposal trip-wires (extensionsProposedApi.ts:47-50 and extensions.ts
// class): a dead/renamed proposal or a stripped product grant logs exactly
// these. The positive fact (the grant is live and usable) is proven by the
// driver's resolver-registered row - the registerRemoteAuthorityResolver
// call itself runs checkProposedApiEnabled under the grant.
const PROPOSAL_DEAD_PATTERNS = [
	/wants API proposal '[^']*' but that proposal DOES NOT EXIST/,
	/CANNOT use API proposal: resolvers/,
	/CANNOT USE these API proposals/,
];

// The compat-l3-proven activation marker: the ExtensionService record for
// the lazy onCommand activation of the flauz-environments built-in.
const FLAUZ_ACTIVATION_PATTERN = /ExtensionService#_doActivateExtension flauz\.flauz-environments/;

const rows = [];

class UsageError extends Error { }

function usage() {
	process.stdout.write(`cenv-resolver-boot-drill.mjs - C-ENV resolver rung 2 workbench boot drill evaluator (TL3-H1)

Usage:
	node cenv-resolver-boot-drill.mjs --report <file> [flags]

Flags:
	--report <file> driver report path (REQUIRED; polled until written)
	--report-timeout <ms> report poll budget (default 180000)
	--log <file> captured log file to scan (repeatable)
	--log-dir <dir> directory tree scanned for *.log (repeatable)
	--fatal-regex <re> ADDS a fatal boot-log pattern (repeatable)
	--json machine output (the compat-battery meta shape)
	--out <path> write the JSON report to a file as well
	--no-fail report-only: FAIL rows printed but exit 0
	--help this text

Exit codes: 0 pass / SKIP-only; 1 FAIL row(s); 2 usage error.
`);
}

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function pass(id, detail) {
	rows.push({ id, status: 'PASS', detail });
}

function fail(id, detail) {
	rows.push({ id, status: 'FAIL', detail });
}

function skip(id, detail) {
	rows.push({ id, status: 'SKIP', detail });
}

function verdict() {
	return rows.some(row => row.status === 'FAIL') ? 'FAIL' : 'PASS';
}

function collectLogCorpus(logFiles, logDirs) {
	const corpus = [];
	for (const file of logFiles) {
		try { corpus.push({ path: file, text: fs.readFileSync(file, 'utf8') }); } catch { /* unreadable: skip */ }
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
	const reportTimeoutMs = parsePositiveInt(args['report-timeout'], 'report-timeout', 180000);
	const fatalPatterns = DEFAULT_FATAL_PATTERNS.map(source => new RegExp(source));
	for (const spec of (args['fatal-regex'] ?? [])) {
		try { fatalPatterns.push(new RegExp(spec)); } catch (err) {
			process.stderr.write(`usage error: --fatal-regex '${spec}': ${err.message}\n`);
			process.exit(EXIT_USAGE);
		}
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
		// boot.log-clean: no fatal pattern anywhere in the corpus.
		const fatalHit = fatalPatterns.find(pattern => corpusMatches(corpus, pattern));
		if (fatalHit === undefined) {
			pass('boot.log-clean', `no fatal pattern in ${corpus.length} log file(s) (${DEFAULT_FATAL_PATTERNS.join(' | ')})`);
		} else {
			fail('boot.log-clean', `fatal pattern '${fatalHit.source}' present in the boot log corpus - the boot crashed or hung`);
		}
		// boot.proposal-tripwire: the grant dead-class patterns must be absent
		// (the A3-class tripwire; complements the driver's registration row).
		const deadHit = PROPOSAL_DEAD_PATTERNS.find(pattern => corpusMatches(corpus, pattern));
		if (deadHit === undefined) {
			pass('boot.proposal-tripwire', `no DOES-NOT-EXIST / CANNOT-use proposal warning in the corpus (the resolvers grant is live and matching at this HEAD - DL-4 drift class absent)`);
		} else {
			fail('boot.proposal-tripwire', `proposal trip-wire fired: '${deadHit.source}' in the corpus - a proposed API does not exist at this HEAD (DL-4 drift class)`);
		}
		// boot.activation-record: the ExtensionService record for the lazy
		// onCommand activation.
		if (corpusMatches(corpus, FLAUZ_ACTIVATION_PATTERN)) {
			pass('boot.activation-record', 'ExtensionService#_doActivateExtension flauz.flauz-environments present in the logs tree (the real activation machinery ran)');
		} else {
			fail('boot.activation-record', 'the ExtensionService activation record for flauz.flauz-environments is absent from the log corpus (the built-in never activated)');
		}
	}

	// ---- the driver rows ----
	if (report !== undefined && report.__schemaMismatch === undefined) {
		evaluateDriverRows(report);
	}

	// ---- verdict + output ----
	const result = {
		schema: 'flauz.cenv-resolver-boot-drill/v1',
		version: VERSION,
		at: new Date().toISOString(),
		verdict: verdict(),
		rows,
	};
	const text = rows.map(row => `  ${row.status}  ${row.id.padEnd(34)} ${row.detail}`).join('\n');
	const summary = `-- verdict -----------------------------------------------------
${rows.filter(r => r.status === 'PASS').length} PASS / ${rows.filter(r => r.status === 'FAIL').length} FAIL / ${rows.filter(r => r.status === 'SKIP').length} SKIP
C-ENV resolver rung 2 boot drill: ${verdict()}`;
	if (args.json) {
		process.stdout.write(JSON.stringify(result) + '\n');
	} else {
		process.stdout.write(text + '\n' + summary + '\n');
	}
	if (args.out !== undefined && args.out !== '') {
		fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
		fs.writeFileSync(args.out, JSON.stringify(result, null, 1) + '\n');
	}
	if (verdict() === 'FAIL' && !args['no-fail']) {
		process.exit(EXIT_FAIL);
	}
	process.exit(EXIT_OK);
}

main().catch(err => {
	process.stderr.write(`internal error: ${err instanceof Error ? err.stack : String(err)}\n`);
	process.exit(EXIT_FAIL);
});
