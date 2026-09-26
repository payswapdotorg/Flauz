/*---------------------------------------------------------------------------------------------
	*  Copyright (c) Microsoft Corporation. All rights reserved.
	*  Licensed under the MIT License. See License.txt in the project root for license information.
	*--------------------------------------------------------------------------------------------*/
// ---------------------------------------------------------------------------------------------
// Flauz Wave 3 — Lane H (perf harness + CI + budget enforcement)
//
// perf-log-parse.mjs — shared parsing helpers for the Flauz perf CI scripts.
// Single source of truth for every perf-log format the harness consumes:
//
//   1. `--prof-append-timers` TSV  (one line per run, 6-7 tab-separated fields)
//      Emitted by src/vs/workbench/contrib/performance/electron-browser/startupTimings.ts
//      (_appendStartupTimes, :70-101). Fields:
//          [0] ellapsed (ms, integer)          — getDuration(startMark, 'code/didStartWorkbench')
//                                               (timerService.ts:699)
//          [1] product nameShort
//          [2] commit (first 10 chars, or '0000000000')
//          [3] telemetry sessionId
//          [4] 'standard_start' | 'NO_standard_start : <reason>'
//          [5] perfBaseline, zero-padded, with 'ms' suffix (e.g. '0042ms')
//          [6] (optional) 'Heap: ...' line — only when --enable-tracing args are set
//
//   2. `--prof-duration-markers` TSV (one line per run: name\tvalue name\tvalue ...)
//      Emitted by startupTimings.ts (:104-127). Each line is a flat tab-joined
//      sequence of PAIRS: `markerName<TAB>durationMs`. Note upstream only pushes
//      a pair when duration is truthy (non-zero) — absent pairs must be treated
//      as "mark pair never closed" by callers that need strict pairing.
//
//   3. `resolveProcesses()` JSON — IResolvedProcessInformation
//      (src/vs/platform/process/electron-main/processMainService.ts:26-41):
//          { pidToNames: [pid, name][], processes: { name, rootProcess: ProcessItem|err }[] }
//      ProcessItem (src/vs/base/common/processes.ts:90-98):
//          { name, cmd, pid, ppid, load, mem, children? }
//
//   4. `--status` process-list text (fallback capture path, zero product code):
//      diagnosticsService.ts formatProcessList (:523-537): header
//      'CPU %\tMem MB\t   PID\tProcess' then one line per process:
//      `<load>\t<memMB>\t<pid>\t<name>` (name column may carry tree indentation
//      for unmapped children; utility-process names come from pidToNames and
//      appear unindented). Classification in this harness is NAME-BASED, not
//      tree-based, so both capture paths normalize to the same flat rows.
//
// Zero dependencies: node >= 20 stdlib only (node:fs, node:path, node:util).
// No imports from the vscode repo — CI runners may invoke it before npm install.
//
// Usage as a module:  import { parseAppendTimersTsv, ... } from './perf-log-parse.mjs'
// CLI self-test:      node perf-log-parse.mjs --selftest
//                     node perf-log-parse.mjs --parse-timers <file>
//                     node perf-log-parse.mjs --parse-markers <file>
//                     node perf-log-parse.mjs --parse-process-json <file>
//                     node perf-log-parse.mjs --parse-status <file>
//
// Exit codes (CLI): 0 = parsed OK (selftest passed), 1 = parse error, 2 = usage error.
// ---------------------------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

// ---------- percentile (nearest-rank) ---------------------------------------------------------
// Method note: nearest-rank percentile (sorted[ceil(p/100*n)-1]) — deterministic,
// order-statistics based, no interpolation. With N=10 CI runs: p50 = 5th sorted
// value, p95 = 10th (max). Documented here so startup-pair.mjs budgets are
// reproducible by hand from the raw TSVs.

export function percentileNearestRank(sortedValues, p) {
		if (!Array.isArray(sortedValues) || sortedValues.length === 0) {
				throw new Error('percentileNearestRank: empty input');
		}
		const n = sortedValues.length;
		if (n === 1) { return sortedValues[0]; }
		const rank = Math.ceil((p / 100) * n); // 1-based rank
		const clamped = Math.min(Math.max(rank, 1), n);
		return sortedValues[clamped - 1];
}

export function stats(values) {
		const nums = values.filter(v => typeof v === 'number' && Number.isFinite(v)).slice().sort((a, b) => a - b);
		const n = nums.length;
		if (n === 0) {
				return { n: 0, min: undefined, max: undefined, mean: undefined, p50: undefined, p95: undefined };
		}
		const mean = nums.reduce((a, b) => a + b, 0) / n;
		return {
				n,
				min: nums[0],
				max: nums[n - 1],
				mean,
				p50: percentileNearestRank(nums, 50),
				p95: percentileNearestRank(nums, 95),
		};
}

export function fmtMs(v) {
		return (typeof v === 'number' && Number.isFinite(v)) ? `${v.toFixed(1)}ms` : 'n/a';
}

// ---------- 1. --prof-append-timers TSV --------------------------------------------------------

/**
	* Parse the content of a `--prof-append-timers` TSV file.
	* @param {string} text raw file content
	* @returns {{ runs: Array<object>, errors: Array<string> }}
	*   run = { line, ellapsed, product, commit, sessionId, standardStart, standardStartError,
	*           perfBaselineMs, heap }
	*/
export function parseAppendTimersTsv(text) {
		const runs = [];
		const errors = [];
		const lines = String(text).split(/\r?\n/);
		for (let i = 0; i < lines.length; i++) {
				const raw = lines[i];
				if (raw.trim() === '') { continue; }
				const fields = raw.split('\t');
				if (fields.length < 6) {
						errors.push(`line ${i + 1}: expected >=6 tab-separated fields, got ${fields.length} — '${raw.slice(0, 80)}'`);
						continue;
				}
				const ellapsed = Number(fields[0]);
				if (!Number.isFinite(ellapsed)) {
						errors.push(`line ${i + 1}: ellapsed is not a number: '${fields[0]}'`);
						continue;
				}
				const verdict = fields[4];
				const standardStart = verdict === 'standard_start';
				const standardStartError = standardStart ? undefined : verdict;
				const baselineRaw = String(fields[5] || '').trim();
				const baselineMatch = baselineRaw.match(/^(\d+)ms$/);
				const perfBaselineMs = baselineMatch ? Number(baselineMatch[1]) : undefined;
				if (perfBaselineMs === undefined) {
						errors.push(`line ${i + 1}: perfBaseline field does not match /^(\\d+)ms$/: '${baselineRaw}'`);
						continue;
				}
				runs.push({
						line: i + 1,
						ellapsed,
						product: fields[1],
						commit: fields[2],
						sessionId: fields[3],
						standardStart,
						standardStartError,
						perfBaselineMs,
						heap: fields.length >= 7 ? fields.slice(6).join('\t') : undefined,
				});
		}
		return { runs, errors };
}

// ---------- 2. --prof-duration-markers TSV -----------------------------------------------------

/**
	* Parse the content of a `--prof-duration-markers` (or -file) TSV.
	* Each non-empty line is a flat sequence of name/value PAIRS (startupTimings.ts
	* pushes marker & duration together, then joins with '\t').
	* @param {string} text raw file content
	* @returns {{ runs: Array<{ line:number, pairs: Record<string, number> }>, errors: Array<string> }}
	*/
export function parseDurationMarkersTsv(text) {
		const runs = [];
		const errors = [];
		const lines = String(text).split(/\r?\n/);
		for (let i = 0; i < lines.length; i++) {
				const raw = lines[i];
				if (raw.trim() === '') { continue; }
				const parts = raw.split('\t');
				if (parts.length % 2 !== 0) {
						errors.push(`line ${i + 1}: odd number of tab fields (${parts.length}) — duration-marker lines are name/value pairs`);
						continue;
				}
				const pairs = {};
				let lineOk = true;
				for (let j = 0; j < parts.length; j += 2) {
						const name = parts[j];
						const value = Number(parts[j + 1]);
						if (!Number.isFinite(value)) {
								errors.push(`line ${i + 1}: non-numeric duration for marker '${name}': '${parts[j + 1]}'`);
								lineOk = false;
								break;
						}
						if (Object.prototype.hasOwnProperty.call(pairs, name)) {
								errors.push(`line ${i + 1}: duplicate marker '${name}'`);
								lineOk = false;
								break;
						}
						pairs[name] = value;
				}
				if (lineOk) { runs.push({ line: i + 1, pairs }); }
		}
		return { runs, errors };
}

// ---------- 3. resolveProcesses() JSON ---------------------------------------------------------

/**
	* Normalize a `resolveProcesses()` JSON payload into flat process rows.
	* Only the "Local" process tree (and any remote trees) are walked; utility
	* process names are enriched from pidToNames where available.
	* @param {string|object} json text or already-parsed object
	* @returns {{ rows: Array<{ name, pid, ppid, load, memMB, cmd }>, errors: Array<string> }}
	*/
export function parseResolveProcessesJson(json) {
		const errors = [];
		let data = json;
		if (typeof json === 'string') {
				try {
						data = JSON.parse(json);
				} catch (e) {
						return { rows: [], errors: [`invalid JSON: ${e.message}`] };
				}
		}
		if (!data || typeof data !== 'object' || !Array.isArray(data.processes)) {
				return { rows: [], errors: ['payload does not look like IResolvedProcessInformation (missing processes[])'] };
		}
		const pidToNames = new Map();
		for (const entry of Array.isArray(data.pidToNames) ? data.pidToNames : []) {
				if (Array.isArray(entry) && entry.length >= 2) {
						pidToNames.set(Number(entry[0]), String(entry[1]));
				}
		}
		const rows = [];
		const walk = (item, treeName) => {
				if (!item || typeof item !== 'object') { return; }
				const pid = Number(item.pid) || 0;
				const mappedName = pidToNames.get(pid);
				rows.push({
						name: mappedName || String(item.name || ''),
						pid,
						ppid: Number(item.ppid) || 0,
						load: Number(item.load) || 0,
						// ProcessItem.mem is platform-dependent (Linux: percent of total RAM).
						// Callers that need MB from a JSON tree must pass totalMemMB.
						mem: Number(item.mem) || 0,
						cmd: String(item.cmd || ''),
						tree: treeName,
						_memIsPercent: !mappedName, // rows sourced from pidToNames keep the mapped name; mem semantics handled by caller
				});
				if (Array.isArray(item.children)) {
						for (const child of item.children) { walk(child, treeName); }
				}
		};
		for (const proc of data.processes) {
				if (proc && proc.rootProcess && typeof proc.rootProcess === 'object' && !proc.rootProcess.errorMessage) {
						walk(proc.rootProcess, String(proc.name || 'unknown'));
				} else if (proc && proc.rootProcess && typeof proc.rootProcess === 'object') {
						// IRemoteDiagnosticError shape
						errors.push(`remote tree '${proc.name}': ${proc.rootProcess.errorMessage || 'error payload'}`);
				}
		}
		return { rows, errors };
}

// ---------- 4. --status process-list text ------------------------------------------------------

const STATUS_HEADER = /^CPU %\tMem MB\t\s*PID\tProcess$/;

/**
	* Parse the 'Process List' section of `--status` output into flat rows.
	* Format (diagnosticsService.ts:530): `CPU %\tMem MB\t   PID\tProcess`
	* followed by `<load>\t<memMB>\t<pid>\t<name>` lines. Section ends at the
	* first blank line after rows ('Workspace Stats:' or EOF).
	* @param {string} text raw --status output
	* @returns {{ rows: Array<{ name, pid, load, memMB }>, errors: Array<string> }}
	*/
export function parseStatusProcessList(text) {
		const rows = [];
		const errors = [];
		const lines = String(text).split(/\r?\n/);
		let inSection = false;
		for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				if (STATUS_HEADER.test(line)) { inSection = true; continue; }
				if (!inSection) { continue; }
				if (line.trim() === '') {
						// blank line terminates the section unless more indented rows follow
						const next = lines.slice(i + 1).find(l => l.trim() !== '');
						if (!next || !/^\s*\d/.test(next)) { break; }
						continue;
				}
				const fields = line.split('\t');
				if (fields.length < 4) {
						errors.push(`line ${i + 1}: expected >=4 tab fields in process row: '${line.slice(0, 80)}'`);
						continue;
				}
				const load = Number(fields[0].trim());
				const memMB = Number(fields[1].trim());
				const pid = Number(fields[2].trim());
				const name = fields.slice(3).join('\t').trim();
				if (!Number.isFinite(load) || !Number.isFinite(memMB) || !Number.isFinite(pid)) {
						errors.push(`line ${i + 1}: non-numeric CPU/MEM/PID: '${line.slice(0, 80)}'`);
						continue;
				}
				rows.push({ name, pid, load, memMB });
		}
		return { rows, errors };
}

// ---------- shared file loading ----------------------------------------------------------------

export function readTextFile(file) {
		try {
				return fs.readFileSync(path.resolve(file), 'utf8');
		} catch (e) {
				throw new Error(`cannot read '${file}': ${e.message}`);
		}
}

export function loadJsonFile(file) {
		try {
				return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
		} catch (e) {
				throw new Error(`cannot parse JSON '${file}': ${e.message}`);
		}
}

// ---------- CLI (runs only when executed directly, never when imported) ------------------------

import { pathToFileURL } from 'node:url';

function isMainModule() {
		const argv1 = process.argv[1];
		if (!argv1) { return false; }
		try {
				return import.meta.url === pathToFileURL(path.resolve(argv1)).href;
		} catch {
				return false;
		}
}

function printUsage() {
		process.stdout.write(`perf-log-parse.mjs — shared parsing helpers for the Flauz perf harness

Usage:
	node perf-log-parse.mjs --parse-timers  <file>   parse a --prof-append-timers TSV
	node perf-log-parse.mjs --parse-markers <file>   parse a --prof-duration-markers TSV
	node perf-log-parse.mjs --parse-process-json <file>  parse a resolveProcesses() JSON
	node perf-log-parse.mjs --parse-status   <file>  parse the process list of --status output
	node perf-log-parse.mjs --selftest               run built-in unit selftest

Module exports:
	percentileNearestRank(sorted, p)  stats(values)  fmtMs(v)
	parseAppendTimersTsv(text)        parseDurationMarkersTsv(text)
	parseResolveProcessesJson(json)   parseStatusProcessList(text)
	readTextFile(file)                loadJsonFile(file)

Exit codes: 0 parsed OK / selftest passed; 1 parse error; 2 usage error.
`);
}

function selftest() {
		let failures = 0;
		const check = (label, cond) => {
				if (cond) { process.stdout.write(`  ok    ${label}\n`); } else { failures++; process.stderr.write(`  FAIL  ${label}\n`); }
		};

		// timers TSV
		const t1 = parseAppendTimersTsv('824\tCode\t9bf9ae764d\ts1\tstandard_start\t0042ms\n' +
				'831\tCode\t9bf9ae764d\ts2\tNO_standard_start : Expected window count : 1, Actual : 2\t0042ms\tHeap: 12MB (used)\n' +
				'garbage-line\n');
		check('timers: 2 runs parsed', t1.runs.length === 2);
		check('timers: 1 parse error reported', t1.errors.length === 1);
		check('timers: run1 standard_start', t1.runs[0].standardStart === true && t1.runs[0].ellapsed === 824 && t1.runs[0].perfBaselineMs === 42);
		check('timers: run2 non-standard + heap kept', t1.runs[1].standardStart === false && /window count/.test(t1.runs[1].standardStartError) && /Heap:/.test(t1.runs[1].heap));

		// markers TSV
		const m1 = parseDurationMarkersTsv('code/flauz/willConnectCore-code/flauz/didConnectCore\t123\tellapsed\t824\nodd\tline\n');
		check('markers: 1 run parsed', m1.runs.length === 1);
		check('markers: 1 error for odd field count', m1.errors.length === 1);
		check('markers: pair values', m1.runs[0].pairs['code/flauz/willConnectCore-code/flauz/didConnectCore'] === 123 && m1.runs[0].pairs['ellapsed'] === 824);

		// percentile / stats
		const s = stats([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
		check('stats: n=10', s.n === 10);
		check('stats: p50 = 50 (nearest-rank)', s.p50 === 50);
		check('stats: p95 = 100 (nearest-rank)', s.p95 === 100);

		// resolveProcesses JSON
		const j1 = parseResolveProcessesJson(JSON.stringify({
				pidToNames: [[200, 'pty-host'], [201, 'extensionHost--1']],
				processes: [{ name: 'Local', rootProcess: { name: 'code', cmd: 'code', pid: 100, ppid: 1, load: 0, mem: 1.2, children: [{ name: 'utility', cmd: '', pid: 200, ppid: 100, load: 0, mem: 0.4 }] } }],
		}));
		check('json: rows walked incl. children', j1.rows.length === 2);
		check('json: utility name mapped from pidToNames', j1.rows.some(r => r.name === 'pty-host' && r.pid === 200));

		// --status text
		const st1 = parseStatusProcessList('CPU %\tMem MB\t   PID\tProcess\n    0\t   100\t   100\tflauz\n    1\t    42\t   200\tpty-host\n\nWorkspace Stats: \n');
		check('status: 2 rows parsed', st1.rows.length === 2);
		check('status: row values', st1.rows[1].name === 'pty-host' && st1.rows[1].memMB === 42 && st1.rows[1].pid === 200);

		if (failures > 0) {
				process.stderr.write(`selftest: ${failures} FAILURE(S)\n`);
				return 1;
		}
		process.stdout.write('selftest: all checks passed\n');
		return 0;
}

// ---- main ----
if (!isMainModule()) {
		// imported as a library — nothing to do
} else {
let parsed;
try {
		parsed = parseArgs({
				allowPositionals: false,
				options: {
						'parse-timers': { type: 'string' },
						'parse-markers': { type: 'string' },
						'parse-process-json': { type: 'string' },
						'parse-status': { type: 'string' },
						selftest: { type: 'boolean' },
						help: { type: 'boolean', default: false },
				},
		});
} catch (e) {
		process.stderr.write(`usage error: ${e.message}\n\n`);
		printUsage();
		process.exit(2);
}
const { values: args } = parsed;
if (args.help || Object.keys(args).every(k => !args[k])) { printUsage(); process.exit(args.help ? 0 : 2); }

let exit = 0;
try {
		if (args.selftest) { exit = selftest(); }
		if (args['parse-timers']) {
				const { runs, errors } = parseAppendTimersTsv(readTextFile(args['parse-timers']));
				process.stdout.write(JSON.stringify({ runs, errors }, null, 2) + '\n');
				if (errors.length > 0) { exit = 1; }
		}
		if (args['parse-markers']) {
				const { runs, errors } = parseDurationMarkersTsv(readTextFile(args['parse-markers']));
				process.stdout.write(JSON.stringify({ runs, errors }, null, 2) + '\n');
				if (errors.length > 0) { exit = 1; }
		}
		if (args['parse-process-json']) {
				const { rows, errors } = parseResolveProcessesJson(readTextFile(args['parse-process-json']));
				process.stdout.write(JSON.stringify({ rows, errors }, null, 2) + '\n');
				if (errors.length > 0) { exit = 1; }
		}
		if (args['parse-status']) {
				const { rows, errors } = parseStatusProcessList(readTextFile(args['parse-status']));
				process.stdout.write(JSON.stringify({ rows, errors }, null, 2) + '\n');
				if (errors.length > 0) { exit = 1; }
		}
} catch (e) {
		process.stderr.write(`error: ${e.message}\n`);
		exit = 1;
}
process.exit(exit);
} // end main-module guard
