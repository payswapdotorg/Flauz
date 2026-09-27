/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// ---------------------------------------------------------------------------------------------
// Flauz TL4 — Worker C (TL4-005: performance & resource budgets).
//
// budget-gate.mjs — the UNIFIED budget gate: compares a machine-checkable budget
// registry (build/flauz/budgets/flauz-budgets.json) against a set of measurements
// and produces one verdict. This is the single place where "is Flauz inside its
// performance/resource budgets?" is answered across ALL metric groups (startup,
// activation, memory, CPU, browser launch, model switching, multi-agent workload).
//
// The existing single-domain gates stay authoritative for their depth semantics:
//   startup-pair.mjs   (PERF section 1.3 pair diff + R6 mark integrity + phase gate)
//   memory-snapshot.mjs(PERF section 3.2 process-tree assertions, all capture paths)
//   activation-lint.mjs(PERF section 2.1/2.2 manifest discipline)
// budget-gate.mjs UNIFIES their budget rows into one registry, adds the TL4-005
// product metrics that had NO budgets at all (browser launch, model switching,
// multi-agent workload), and enforces the skip-vs-fail policy (build/flauz/README
// section "Skip-vs-fail policy"): absent measurement => documented SKIP, never a
// silent pass; --require flips skips to failures to prove the plumbing.
//
// MEASUREMENT INPUT (--measurements <file-or-dir>), accepted shapes:
//
//   1. Measurement records — the native shape. JSON array, {"measurements":[...]}
//      envelope, single JSON object, or JSONL (one record per line):
//          {"id": "<measurement-id>", "value": <number>, "unit": "ms",
//           "measuredAt": "2026-09-27T00:00:00Z", "baseline": <number>, "source": "..."}
//      "baseline" is REQUIRED input data for delta comparisons (budget row with
//      comparison "delta<="): delta = value - baseline. "unit"/"measuredAt"/
//      "source" are echoed; a unit mismatch vs the budget row skips the row (WARN).
//
//   2. The exact JSON shapes emitted by perf-log-parse.mjs (single source of truth
//      for perf-log parsing) — mapping documented here, per shape:
//
//      --parse-timers emit  {"runs":[{"ellapsed":836,"standardStart":true,...}],"errors":[]}
//          => nearest-rank p50/p95 of `ellapsed` over standard_start runs (perf-log-parse
//             stats), POOLED per side across files:
//             startup.tsv.ellapsed.p50   {value: flauz p50, baseline: upstream p50}
//             startup.tsv.ellapsed.p95   {value: flauz p95, baseline: upstream p95}
//             startup.tsv.standard-runs  {value: min(n_flauz, n_upstream), unit: count}
//          SIDE DETECTION is by file name: a file whose base name contains
//          "upstream" feeds the baseline side; every other timers file feeds the
//          flauz side. Delta records are emitted only when both sides have data.
//
//      --parse-markers emit {"runs":[{"pairs":{"<pair-name>":178,...}}],"errors":[]}
//          => nearest-rank p95 per duration-marker pair name, pooled per side
//             (same "upstream" file-name rule):
//             startup.marker.<pair-name>.p95  {value: flauz p95, baseline: upstream p95}
//
//      --parse-process-json emit {"rows":[{"name":"flauz-core","mem":128,...}],"errors":[]}
//          => memory-snapshot-style classification (name/cmd regex classes, the same
//             DEFAULT_PATTERNS as memory-snapshot.mjs — duplicated here because that
//             script is a CLI, not an importable module; drift trip-wire = fixture
//             matrix in verify-fixtures.sh). SCENARIO detection is by file name:
//          base name contains "after-session" => scenario "after-session",
//          contains "eventually" (or neither) => "eventually" (memory-snapshot default).
//          `mem` is MB per the capture contract (build/flauz/README section 6).
//          Emitted per scenario (counts always; RSS rows only when the class exists):
//             memory.<sc>.rss.flauz-core            (MB, first flauz-core row)
//             memory.<sc>.rss.ext-host-pinned       (MB, LAST ext-host row when >= 2 hosts)
//             memory.<sc>.count.extra-ext-hosts     (extHosts - 1 stock host)
//             memory.<sc>.count.agent-sessions      (class member count)
//             memory.<sc>.count.browser-panes       (class member count)
//             memory.<sc>.rss.flauz-added-total     (core + panes + sessions + extra hosts, MB)
//             memory.<sc>.stock.shared-process|.pty-host|.watcher|.agent-host (member count)
//
//      --parse-status emit is deliberately NOT accepted (rows carry memMB, not the
//      capture-contract mem): the status/ps TEXT capture paths stay owned by
//      memory-snapshot.mjs; convert to the process-json shape for this gate.
//
//   3. RAW TSV forms of (2) — content-sniffed, parsed with perf-log-parse.mjs:
//      a --prof-append-timers TSV (first field numeric) or a --prof-duration-markers
//      TSV (name/value tab pairs). Same side/scenario file-name rules as above.
//
//   DIRECTORY MODE consumes EVERY file in the directory (non-recursive, sorted):
//   point it at a CURATED inputs dir (the CI recipe maps exactly the artifacts it
//   wants — see .github/workflows/flauz-budgets.yml), never at a mixed fixture
//   dir: regression fixtures left in the dir WILL be consumed and WILL fail the
//   gate (that is the gate working, not a bug). An unrecognized file is a usage
//   error (exit 2) naming the file.
//
// FLAGS:
//   --help                    this text
//   --budgets <file>          budget registry (default: <root>/build/flauz/budgets/flauz-budgets.json)
//   --measurements <path>     measurement file or curated dir (omit for a registry
//                             self-check: every row SKIPs, exit 0)
//   --require [scope]         SKIP -> FAIL for rows in scope. Scopes: all (default
//                             when the flag is bare), enforced (enforced-ci OR
//                             enforced-in-repo), enforced-ci, enforced-in-repo.
//                             Rows with budget null (catalogue-only) are exempt.
//   --json                    additionally emit a machine-readable verdict block
//   --root <dir>              base for resolving relative paths + the default
//                             budgets path (default: cwd)
//
// BUDGET ROW (flauz-budgets.json; schema: flauz-budgets.schema.json):
//   {"id","metric","budget","unit","comparison","severity","status","source","notes"}
//   - "metric" names the measurement id the row compares (defaults to "id";
//     multiple rows may share one metric — e.g. the PERF section 1.3 rows 1+2
//     re-gate the same p95 at different tightness).
//   - "comparison": "<=" | ">=" | "delta<=". ">=" is a TL4-005 extension over the
//     minimal "<= | delta<=" pair, needed for floor rows (R1 ext-host RSS floor,
//     stock-process presence, minimum sample counts).
//   - "budget": number | null | string form ">=100"/"<=250"/"<5"/">1" (string form
//     overrides the comparison for absolute rows; delta rows need a number).
//     null = catalogue-only row (defined, not gated: reported INFO, never fails,
//     exempt from --require).
//   - "severity": "fail" (over budget => exit 1) | "warn" (over budget => WARN row,
//     exit unchanged — the memory-snapshot [E]/R6 posture).
//   - "status": "enforced-ci" | "enforced-in-repo" | "fixture" | "pending-runtime"
//     (the promotion ladder, docs/FLAUZ-PROGRAM/TL4-PERF-BUDGETS.md section 4).
//
// Exit codes:
//   0 = all rows pass/SKIP (warns allowed — a warn row is never an exit failure)
//   1 = violation: any fail-severity row over budget, or a SKIP flipped by --require
//   2 = usage error, malformed/unreadable budget registry, unrecognized input file
//
// Zero dependencies: node >= 20 stdlib only (+ the shared perf-log-parse.mjs).
// ---------------------------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
        parseAppendTimersTsv, parseDurationMarkersTsv, parseResolveProcessesJson, stats, readTextFile,
} from './perf-log-parse.mjs';

const EXIT_OK = 0, EXIT_FAIL = 1, EXIT_USAGE = 2;

const DEFAULT_BUDGETS_REL = 'build/flauz/budgets/flauz-budgets.json';
const COMPARISONS = new Set(['<=', '>=', 'delta<=']);
const SEVERITIES = new Set(['fail', 'warn']);
const STATUSES = new Set(['enforced-ci', 'enforced-in-repo', 'fixture', 'pending-runtime']);
const REQUIRE_SCOPES = new Set(['all', 'enforced', 'enforced-ci', 'enforced-in-repo']);
const BUDGET_STRING_FORM = /^(>=|<=|>|<)\s*(\d+(?:\.\d+)?)$/;

// Process classification — the same name/cmd regex classes as memory-snapshot.mjs
// DEFAULT_PATTERNS (duplicated deliberately: memory-snapshot.mjs is a CLI script,
// not an importable module; drift between the two is caught by the fixture matrix
// in verify-fixtures.sh which runs BOTH gates over the same process-shape data).
const PATTERNS = {
        extHost: /extension[-_ ]?host/i,
        flauzCore: /flauz[-_. ]?core/i,
        agentSession: /(agent[-_ ]?session|session[-_ ]?server|claude[-_ ]?agent|codex[-_ ]?agent|agent[-_ ]?sdk)/i,
        browserPane: /(browser[-_ ]?view|webcontentsview|browser[-_ ]?pane|browserView)/i,
        sharedProcess: /shared[-_ ]?process/i,
        ptyHost: /pty[-_ ]?host/i,
        watcher: /watcher/i,
        agentHost: /agent[-_ ]?host/i,
};

function usage() {
        process.stdout.write(`budget-gate.mjs — Flauz unified performance/resource budget gate (TL4-005)

Usage:
        node budget-gate.mjs [--budgets <file>] [--measurements <file-or-dir>]
                             [--require [all|enforced|enforced-ci|enforced-in-repo]]
                             [--json] [--root <dir>]
        node budget-gate.mjs --help

Default budgets: <root>/${DEFAULT_BUDGETS_REL} (root defaults to cwd).
Omit --measurements for a registry self-check (all rows SKIP, exit 0).

Measurement inputs (see file header for the FULL mapping):
        - measurement records: JSON array | {"measurements":[...]} | single object | JSONL
          {"id","value","unit","measuredAt","baseline","source"}  (baseline required for
          "delta<=" rows: delta = value - baseline)
        - perf-log-parse.mjs emit shapes (stdout JSON of --parse-timers / --parse-markers /
          --parse-process-json) and the RAW TSV forms of the first two:
            timers   -> startup.tsv.ellapsed.p50/.p95 (+baseline), startup.tsv.standard-runs
            markers  -> startup.marker.<pair-name>.p95 (+baseline)
            process  -> memory.<scenario>.{rss.flauz-core, rss.ext-host-pinned,
                      count.extra-ext-hosts, count.agent-sessions, count.browser-panes,
                      rss.flauz-added-total, stock.*}
          file-name conventions: "upstream" in the name = baseline side (timers/markers);
          "after-session"/"eventually" in the name = memory scenario (default eventually).
        - --parse-status output is NOT accepted (memMB shape): memory-snapshot.mjs owns
          the status/ps text paths.
        DIRECTORY MODE consumes every file — curate the dir (CI maps exactly the
        artifacts it wants); an unrecognized file is exit 2 naming the file.

Budget row: {"id","metric","budget","unit","comparison"("<="|">="|"delta<="),
"severity"("fail"|"warn"),"status"("enforced-ci"|"enforced-in-repo"|"fixture"|
"pending-runtime"),"source","notes"} — budget may be a number, null (catalogue-only,
never gated) or a string form like ">=100"/"<=250" (absolute rows only).

Exit codes: 0 pass/SKIP · 1 violation (fail row over budget, or required SKIP) ·
2 usage / malformed budgets / unrecognized input file.
`);
}

// ---- formatting helpers -----------------------------------------------------------------------

function fmtNum(v) {
        if (typeof v !== 'number' || !Number.isFinite(v)) { return String(v); }
        return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

// ---- budget registry loading ------------------------------------------------------------------

function die(msg) {
        process.stderr.write(`budget-gate: ${msg}\n`);
        process.exit(EXIT_USAGE);
}

/**
 * Load + validate the budget registry. Any structural problem is exit 2
 * (a malformed registry must never silently pass as "no budgets").
 * @returns {{version:number, rows:Array<object>, file:string}}
 */
function loadBudgets(file) {
        let raw;
        try {
                raw = readTextFile(file);
        } catch (e) {
                die(`cannot read budget registry '${file}': ${e.message}`);
        }
        let data;
        try {
                data = JSON.parse(raw);
        } catch (e) {
                die(`malformed budget registry '${file}' (invalid JSON): ${e.message}`);
        }
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
                die(`malformed budget registry '${file}': top level must be an object`);
        }
        if (typeof data.version !== 'number' || !Number.isInteger(data.version) || data.version < 1) {
                die(`malformed budget registry '${file}': "version" must be a positive integer (got ${JSON.stringify(data.version)})`);
        }
        if (!Array.isArray(data.budgets) || data.budgets.length === 0) {
                die(`malformed budget registry '${file}': "budgets" must be a non-empty array`);
        }
        const seen = new Set();
        const rows = [];
        for (let i = 0; i < data.budgets.length; i++) {
                const r = data.budgets[i];
                const where = `${file} budgets[${i}]`;
                if (!r || typeof r !== 'object' || Array.isArray(r)) {
                        die(`malformed budget row at ${where}: not an object`);
                }
                if (typeof r.id !== 'string' || r.id.trim() === '') {
                        die(`malformed budget row at ${where}: "id" must be a non-empty string`);
                }
                if (seen.has(r.id)) {
                        die(`malformed budget registry '${file}': duplicate row id '${r.id}'`);
                }
                seen.add(r.id);
                const metric = (r.metric === undefined || r.metric === null || r.metric === '') ? r.id : r.metric;
                if (typeof metric !== 'string') {
                        die(`malformed budget row at ${where} ('${r.id}'): "metric" must be a string`);
                }
                const comparison = r.comparison === undefined || r.comparison === null ? '<=' : r.comparison;
                if (!COMPARISONS.has(comparison)) {
                        die(`malformed budget row at ${where} ('${r.id}'): "comparison" must be one of ${[...COMPARISONS].join(' | ')} (got ${JSON.stringify(r.comparison)})`);
                }
                const severity = r.severity === undefined || r.severity === null ? 'fail' : r.severity;
                if (!SEVERITIES.has(severity)) {
                        die(`malformed budget row at ${where} ('${r.id}'): "severity" must be fail | warn (got ${JSON.stringify(r.severity)})`);
                }
                if (typeof r.status !== 'string' || !STATUSES.has(r.status)) {
                        die(`malformed budget row at ${where} ('${r.id}'): "status" must be one of ${[...STATUSES].join(' | ')} (got ${JSON.stringify(r.status)})`);
                }
                // budget: number | null | "<op><number>" string form (absolute rows only)
                let budgetNum = null, budgetOp = null, budgetStr = null;
                if (r.budget === undefined || r.budget === null) {
                        budgetNum = null; // catalogue-only row (or explicit null)
                } else if (typeof r.budget === 'number') {
                        if (!Number.isFinite(r.budget)) {
                                die(`malformed budget row at ${where} ('${r.id}'): "budget" number is not finite`);
                        }
                        budgetNum = r.budget;
                } else if (typeof r.budget === 'string') {
                        const m = r.budget.match(BUDGET_STRING_FORM);
                        if (!m) {
                                die(`malformed budget row at ${where} ('${r.id}'): string "budget" must match /^(>=|<=|>|<)\\d+(\\.\\d+)?$/ (got ${JSON.stringify(r.budget)})`);
                        }
                        if (comparison === 'delta<=') {
                                die(`malformed budget row at ${where} ('${r.id}'): delta rows need a numeric "budget" (string form is absolute-only)`);
                        }
                        budgetOp = m[1];
                        budgetNum = Number(m[2]);
                        budgetStr = r.budget;
                } else {
                        die(`malformed budget row at ${where} ('${r.id}'): "budget" must be a number, null or an operator string`);
                }
                rows.push({
                        id: r.id,
                        metric,
                        budgetNum,
                        budgetOp,
                        budgetStr,
                        unit: typeof r.unit === 'string' ? r.unit : undefined,
                        comparison,
                        severity,
                        status: r.status,
                        source: typeof r.source === 'string' ? r.source : '',
                        notes: typeof r.notes === 'string' ? r.notes : '',
                });
        }
        return { version: data.version, rows, file };
}

// ---- measurement input loading ----------------------------------------------------------------

/**
 * Validate one measurement record object.
 * @returns {{record: object|null, problem: string|null}}
 */
function checkRecord(o) {
        if (!o || typeof o !== 'object' || Array.isArray(o)) { return { record: null, problem: 'not an object' }; }
        if (typeof o.id !== 'string' || o.id.trim() === '') { return { record: null, problem: `"id" must be a non-empty string` }; }
        if (typeof o.value !== 'number' || !Number.isFinite(o.value)) { return { record: null, problem: `"value" must be a finite number` }; }
        const rec = { id: o.id, value: o.value };
        if (o.unit !== undefined && o.unit !== null) {
                if (typeof o.unit !== 'string') { return { record: null, problem: `"unit" must be a string` }; }
                rec.unit = o.unit;
        }
        if (o.measuredAt !== undefined && o.measuredAt !== null) {
                rec.measuredAt = String(o.measuredAt);
        }
        if (o.baseline !== undefined && o.baseline !== null) {
                if (typeof o.baseline !== 'number' || !Number.isFinite(o.baseline)) {
                        return { record: null, problem: `"baseline" must be a finite number when present` };
                }
                rec.baseline = o.baseline;
        }
        if (o.source !== undefined && o.source !== null) { rec.source = String(o.source); }
        return { record: rec, problem: null };
}

/**
 * Load one measurement input file, detecting its shape.
 * Appends to: records[], timersRuns{flauz,upstream}, markersRuns{flauz,upstream},
 * processRowsByScenario Map, and diagnostics[] (WARN lines).
 */
function loadMeasurementFile(file, ctx) {
        const base = path.basename(file).toLowerCase();
        const isUpstream = base.includes('upstream');
        const scenario = base.includes('after-session') ? 'after-session' : 'eventually';
        let text;
        try {
                text = readTextFile(file);
        } catch (e) {
                die(`cannot read measurement input '${file}': ${e.message}`);
        }
        const trimmed = text.trim();
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
                let parsed = null;
                try {
                        parsed = JSON.parse(trimmed);
                } catch {
                        parsed = null;
                }
                if (parsed !== null) {
                        if (Array.isArray(parsed)) {
                                collectRecords(parsed, file, ctx);
                                ctx.inputs.push(`${file} (measurement records: ${parsed.length})`);
                                return;
                        }
                        if (parsed && typeof parsed === 'object') {
                                if (Array.isArray(parsed.runs)) {
                                        if (parsed.runs.length === 0) {
                                                ctx.diagnostics.push(`WARN: ${file}: runs[] is empty — no measurements extracted.`);
                                                ctx.inputs.push(`${file} (perf-log-parse emit: empty runs)`);
                                                return;
                                        }
                                        const first = parsed.runs.find(r => r && typeof r === 'object') || {};
                                        if (first && typeof first.pairs === 'object' && first.pairs !== null && !Array.isArray(first.pairs)) {
                                                const side = isUpstream ? 'upstream' : 'flauz';
                                                for (const run of parsed.runs) {
                                                        if (run && typeof run === 'object' && run.pairs && typeof run.pairs === 'object') { ctx.markersRuns[side].push(run); }
                                                        else { ctx.diagnostics.push(`WARN: ${file}: malformed markers run entry skipped.`); }
                                                }
                                                if (Array.isArray(parsed.errors)) {
                                                        for (const e of parsed.errors) { ctx.diagnostics.push(`WARN: ${file} (markers): ${e}`); }
                                                }
                                                ctx.inputs.push(`${file} (perf-log-parse --parse-markers emit, side=${side}, runs=${ctx.markersRuns[side].length})`);
                                                return;
                                        }
                                        if (typeof first.ellapsed === 'number') {
                                                const side = isUpstream ? 'upstream' : 'flauz';
                                                for (const run of parsed.runs) {
                                                        if (run && typeof run === 'object' && typeof run.ellapsed === 'number') { ctx.timersRuns[side].push(run); }
                                                        else { ctx.diagnostics.push(`WARN: ${file}: malformed timers run entry skipped.`); }
                                                }
                                                if (Array.isArray(parsed.errors)) {
                                                        for (const e of parsed.errors) { ctx.diagnostics.push(`WARN: ${file} (timers): ${e}`); }
                                                }
                                                ctx.inputs.push(`${file} (perf-log-parse --parse-timers emit, side=${side}, runs=${ctx.timersRuns[side].length})`);
                                                return;
                                        }
                                        die(`unrecognized measurement input '${file}': runs[] entries have neither \`pairs\` nor \`ellapsed\` (accepted: perf-log-parse --parse-timers/--parse-markers emit shapes, measurement records).`);
                                }
                                if (Array.isArray(parsed.rows)) {
                                        if (parsed.rows.length > 0 && parsed.rows[0] && typeof parsed.rows[0] === 'object' && ('memMB' in parsed.rows[0]) && !('mem' in parsed.rows[0])) {
                                                die(`unrecognized measurement input '${file}': this looks like a --parse-status emit (rows carry \`memMB\`). The status/ps text capture paths are owned by memory-snapshot.mjs; convert to the process-json shape (mem in MB, capture contract build/flauz/README section 6) for this gate.`);
                                        }
                                        if (parsed.rows.length > 0 && parsed.rows[0] && typeof parsed.rows[0] === 'object' && !('name' in parsed.rows[0])) {
                                                die(`unrecognized measurement input '${file}': rows[] entries have no \`name\` (accepted process shape: perf-log-parse --parse-process-json emit).`);
                                        }
                                        const bucket = ctx.processRowsByScenario.get(scenario) ?? [];
                                        for (const row of parsed.rows) {
                                                if (row && typeof row === 'object' && typeof row.name === 'string') { bucket.push(row); }
                                                else { ctx.diagnostics.push(`WARN: ${file}: malformed process row skipped.`); }
                                        }
                                        ctx.processRowsByScenario.set(scenario, bucket);
                                        if (Array.isArray(parsed.errors)) {
                                                for (const e of parsed.errors) { ctx.diagnostics.push(`WARN: ${file} (process-json): ${e}`); }
                                        }
                                        ctx.inputs.push(`${file} (perf-log-parse --parse-process-json emit, scenario=${scenario}, rows=${bucket.length})`);
                                        return;
                                }
                                if (Array.isArray(parsed.measurements)) {
                                        collectRecords(parsed.measurements, file, ctx);
                                        ctx.inputs.push(`${file} (measurement envelope: ${parsed.measurements.length})`);
                                        return;
                                }
                                if (typeof parsed.id === 'string' && typeof parsed.value === 'number') {
                                        collectRecords([parsed], file, ctx);
                                        ctx.inputs.push(`${file} (single measurement record)`);
                                        return;
                                }
                                die(`unrecognized measurement input '${file}': JSON object matches no accepted shape (see --help for the mapping).`);
                        }
                        die(`unrecognized measurement input '${file}' (see --help for the mapping).`);
                }
                // JSON.parse failed on a {/[ file: JSONL of measurement records
                const lines = trimmed.split(/\r?\n/);
                let count = 0;
                for (let i = 0; i < lines.length; i++) {
                        const line = lines[i].trim();
                        if (line === '') { continue; }
                        let o = null;
                        try { o = JSON.parse(line); } catch { o = null; }
                        if (o === null) {
                                ctx.diagnostics.push(`WARN: ${file} line ${i + 1}: not valid JSON — record dropped (never fatal).`);
                                continue;
                        }
                        const { record, problem } = checkRecord(o);
                        if (!record) {
                                ctx.diagnostics.push(`WARN: ${file} line ${i + 1}: bad measurement record (${problem}) — dropped.`);
                                continue;
                        }
                        ctx.records.push(record);
                        count++;
                }
                if (count === 0) {
                        die(`unrecognized measurement input '${file}': no valid JSONL measurement records (see --help for the mapping).`);
                }
                ctx.inputs.push(`${file} (JSONL measurement records: ${count})`);
                return;
        }
        // ---- raw TSV sniffing (parsed with the shared perf-log-parse module) ----
        const firstLine = trimmed.split(/\r?\n/).find(l => l.trim() !== '') ?? '';
        const fields = firstLine.split('\t');
        if (/^-?\d+(\.\d+)?$/.test(fields[0].trim()) && fields.length >= 6) {
                const side = isUpstream ? 'upstream' : 'flauz';
                const { runs, errors } = parseAppendTimersTsv(text);
                for (const e of errors) { ctx.diagnostics.push(`WARN: ${file} (timers TSV): ${e}`); }
                ctx.timersRuns[side].push(...runs);
                ctx.inputs.push(`${file} (raw --prof-append-timers TSV, side=${side}, runs=${runs.length})`);
                return;
        }
        if (fields.length >= 2 && fields.length % 2 === 0) {
                const side = isUpstream ? 'upstream' : 'flauz';
                const { runs, errors } = parseDurationMarkersTsv(text);
                for (const e of errors) { ctx.diagnostics.push(`WARN: ${file} (markers TSV): ${e}`); }
                ctx.markersRuns[side].push(...runs);
                ctx.inputs.push(`${file} (raw --prof-duration-markers TSV, side=${side}, runs=${runs.length})`);
                return;
        }
        die(`unrecognized measurement input '${file}': not JSON/JSONL, not an append-timers TSV (numeric first field, >=6 tab fields), not a duration-markers TSV (even tab field count). Curate the inputs dir (see --help).`);
}

function collectRecords(arr, file, ctx) {
        for (let i = 0; i < arr.length; i++) {
                const { record, problem } = checkRecord(arr[i]);
                if (!record) {
                        ctx.diagnostics.push(`WARN: ${file} record #${i + 1}: bad measurement record (${problem}) — dropped.`);
                        continue;
                }
                ctx.records.push(record);
        }
}

// ---- synthesis: perf-log-parse shapes -> measurement records ----------------------------------

function synthesize(ctx) {
        // timers pair (side pools of parsed runs; stats over standard_start runs only)
        const fa = ctx.timersRuns.flauz.filter(r => r.standardStart === true);
        const ua = ctx.timersRuns.upstream.filter(r => r.standardStart === true);
        const dropped = (ctx.timersRuns.flauz.length - fa.length) + (ctx.timersRuns.upstream.length - ua.length);
        if (dropped > 0) {
                ctx.diagnostics.push(`WARN: ${dropped} non-standard-start timer run(s) excluded from startup stats (startup-pair semantics).`);
        }
        if (fa.length > 0) {
                const sf = stats(fa.map(r => r.ellapsed));
                const su = ua.length > 0 ? stats(ua.map(r => r.ellapsed)) : null;
                const src = `synthesized: append-timers pair (flauz n=${sf.n}${su ? `, upstream n=${su.n}` : ''})`;
                const emit = (id, value, baseline, unit) => addSynthesized(ctx, { id, value, baseline, unit, source: src });
                emit('startup.tsv.ellapsed.p50', sf.p50, su ? su.p50 : undefined, 'ms');
                emit('startup.tsv.ellapsed.p95', sf.p95, su ? su.p95 : undefined, 'ms');
                emit('startup.tsv.standard-runs', su ? Math.min(sf.n, su.n) : sf.n, undefined, 'count');
        }
        // duration-marker pairs (p95 per pair name, per side)
        const flauzPairs = new Map();
        for (const run of ctx.markersRuns.flauz) {
                for (const [name, v] of Object.entries(run.pairs)) {
                        if (typeof v === 'number' && Number.isFinite(v)) {
                                if (!flauzPairs.has(name)) { flauzPairs.set(name, []); }
                                flauzPairs.get(name).push(v);
                        }
                }
        }
        const upPairs = new Map();
        for (const run of ctx.markersRuns.upstream) {
                for (const [name, v] of Object.entries(run.pairs)) {
                        if (typeof v === 'number' && Number.isFinite(v)) {
                                if (!upPairs.has(name)) { upPairs.set(name, []); }
                                upPairs.get(name).push(v);
                        }
                }
        }
        for (const [name, vals] of flauzPairs) {
                const s = stats(vals);
                const uVals = upPairs.get(name);
                const us = uVals ? stats(uVals) : null;
                addSynthesized(ctx, {
                        id: `startup.marker.${name}.p95`,
                        value: s.p95,
                        baseline: us ? us.p95 : undefined,
                        unit: 'ms',
                        source: `synthesized: duration-marker pair (flauz n=${s.n}${us ? `, upstream n=${us.n}` : ''})`,
                });
        }
        // process snapshots -> memory rows (per scenario; mem is MB per capture contract)
        for (const [sc, rows] of ctx.processRowsByScenario) {
                const cls = (key) => rows.filter(r => PATTERNS[key].test(r.name || '') || PATTERNS[key].test(r.cmd || ''));
                const extHosts = cls('extHost');
                const flauzCore = cls('flauzCore');
                const sessions = cls('agentSession');
                const panes = cls('browserPane');
                const sumMB = (list) => Math.round(list.reduce((a, r) => a + (Number(r.mem) || 0), 0));
                const emit = (id, value, unit) => addSynthesized(ctx, { id, value, unit, source: `synthesized: process snapshot (scenario ${sc}, ${rows.length} rows)` });
                if (flauzCore.length > 1) {
                        ctx.diagnostics.push(`WARN: memory.${sc}: ${flauzCore.length} flauz-core processes in the pooled snapshot (memory-snapshot R2 expects <= 1) — first row used for RSS.`);
                }
                if (flauzCore.length >= 1) { emit(`memory.${sc}.rss.flauz-core`, Number(flauzCore[0].mem) || 0, 'MB'); }
                const extra = Math.max(0, extHosts.length - 1);
                emit(`memory.${sc}.count.extra-ext-hosts`, extra, 'count');
                if (extHosts.length >= 2) {
                        emit(`memory.${sc}.rss.ext-host-pinned`, Number(extHosts[extHosts.length - 1].mem) || 0, 'MB');
                }
                emit(`memory.${sc}.count.agent-sessions`, sessions.length, 'count');
                emit(`memory.${sc}.count.browser-panes`, panes.length, 'count');
                const flauzAdded = [...flauzCore, ...panes, ...sessions, ...(extra > 0 ? extHosts.slice(1) : [])];
                emit(`memory.${sc}.rss.flauz-added-total`, sumMB(flauzAdded), 'MB');
                for (const [key, label] of [['sharedProcess', 'shared-process'], ['ptyHost', 'pty-host'], ['watcher', 'watcher'], ['agentHost', 'agent-host']]) {
                        emit(`memory.${sc}.stock.${label}`, cls(key).length, 'count');
                }
        }
}

function addSynthesized(ctx, rec) {
        if (ctx.records.some(r => r.id === rec.id)) {
                ctx.diagnostics.push(`WARN: synthesized measurement '${rec.id}' dropped — an explicit record with that id already exists (explicit input wins).`);
                return;
        }
        ctx.records.push(rec);
}

// ---- comparison engine ------------------------------------------------------------------------

function skipReason(row) {
        switch (row.status) {
                case 'enforced-ci': return 'measurement absent (status enforced-ci): this input did not carry the metric — check the CI input mapping (flauz-budgets.yml) before treating the gate as green';
                case 'enforced-in-repo': return `no measurement in this input — enforced in-repo by ${row.source || 'activation-lint.mjs'} (see docs/FLAUZ-PROGRAM/TL4-PERF-BUDGETS.md section 5)`;
                case 'fixture': return 'fixture-status row: no measurement provided (sampling driver pending — see doctrine section 4, promotion ladder)';
                case 'pending-runtime': return 'pending-runtime: the measuring runtime does not exist yet (contract defined, not measured — see doctrine section 6)';
                default: return 'measurement absent';
        }
}

function inRequireScope(scope, rowStatus) {
        if (scope === 'all') { return true; }
        if (scope === 'enforced') { return rowStatus === 'enforced-ci' || rowStatus === 'enforced-in-repo'; }
        return rowStatus === scope; // enforced-ci | enforced-in-repo
}

// ---- main --------------------------------------------------------------------------------------

function main() {
        // --require with an optional value: bare flag (or followed by another flag) -> 'all'
        const argv = process.argv.slice(2);
        for (let i = 0; i < argv.length; i++) {
                if (argv[i] === '--require' && (i + 1 >= argv.length || String(argv[i + 1]).startsWith('--'))) {
                        argv.splice(i + 1, 0, 'all');
                }
        }
        let parsed;
        try {
                parsed = parseArgs({
                        args: argv,
                        allowPositionals: false,
                        options: {
                                budgets: { type: 'string' },
                                measurements: { type: 'string' },
                                require: { type: 'string' },
                                json: { type: 'boolean', default: false },
                                root: { type: 'string' },
                                help: { type: 'boolean', default: false },
                        },
                });
        } catch (e) {
                process.stderr.write(`usage error: ${e.message}\n\n`);
                usage();
                process.exit(EXIT_USAGE);
        }
        const args = parsed.values;
        if (args.help) { usage(); process.exit(EXIT_OK); }
        const requireScope = args.require === undefined ? null : args.require;
        if (requireScope !== null && !REQUIRE_SCOPES.has(requireScope)) {
                die(`usage error: --require scope must be one of ${[...REQUIRE_SCOPES].join(' | ')} (got '${requireScope}')`);
        }
        const root = path.resolve(args.root ?? process.cwd());
        const budgetsFile = args.budgets ? path.resolve(root, args.budgets) : path.join(root, DEFAULT_BUDGETS_REL);
        const measurementsPath = args.measurements ? path.resolve(root, args.measurements) : null;

        const registry = loadBudgets(budgetsFile);

        const ctx = {
                records: [],
                timersRuns: { flauz: [], upstream: [] },
                markersRuns: { flauz: [], upstream: [] },
                processRowsByScenario: new Map(),
                inputs: [],
                diagnostics: [],
        };
        if (measurementsPath !== null) {
                let st;
                try {
                        st = fs.statSync(measurementsPath);
                } catch (e) {
                        die(`cannot stat measurement input '${args.measurements}': ${e.message}`);
                }
                if (st.isDirectory()) {
                        let entries;
                        try {
                                entries = fs.readdirSync(measurementsPath, { withFileTypes: true });
                        } catch (e) {
                                die(`cannot list measurement dir '${args.measurements}': ${e.message}`);
                        }
                        const files = entries.filter(e => e.isFile()).map(e => e.name).sort();
                        if (files.length === 0) {
                                die(`measurement dir '${args.measurements}' is empty — nothing to compare (omit --measurements for a registry self-check instead).`);
                        }
                        for (const name of files) {
                                loadMeasurementFile(path.join(measurementsPath, name), ctx);
                        }
                } else if (st.isFile()) {
                        loadMeasurementFile(measurementsPath, ctx);
                } else {
                        die(`measurement input '${args.measurements}' is neither a file nor a directory.`);
                }
        }
        synthesize(ctx);

        // measurement pool: last record per id wins (inputs are typically chronological)
        const pool = new Map();
        for (const rec of ctx.records) {
                if (pool.has(rec.id)) {
                        ctx.diagnostics.push(`WARN: duplicate measurement id '${rec.id}' — last record wins (${fmtNum(rec.value)} ${rec.unit ?? ''}).`);
                }
                pool.set(rec.id, rec);
        }

        const report = [];
        for (const d of ctx.diagnostics) { report.push(d); }
        report.push(`budget registry: ${budgetsFile} (version ${registry.version}, ${registry.rows.length} rows)`);
        if (ctx.inputs.length > 0) {
                report.push(`measurement inputs (${ctx.inputs.length}):`);
                for (const i of ctx.inputs) { report.push(`  - ${i}`); }
        } else {
                report.push('measurement inputs: none — registry self-check mode (every row SKIPs with a documented reason).');
        }
        report.push(`require scope: ${requireScope ?? '(none — skips stay skips)'}`);

        const summary = { pass: 0, fail: 0, skip: 0, warn: 0 };
        const referenced = new Set();
        const jsonRows = [];
        let exit = EXIT_OK;

        for (const row of registry.rows) {
                referenced.add(row.metric);
                const rec = pool.get(row.metric);
                const tag = `[${row.status}]`;
                const jr = { id: row.id, metric: row.metric, status: row.status, severity: row.severity };
                jsonRows.push(jr);
                if (!rec) {
                        const reason = skipReason(row);
                        jr.verdict = 'skip'; jr.reason = reason;
                        if (requireScope !== null && inRequireScope(requireScope, row.status) && row.budgetNum !== null) {
                                summary.fail++;
                                exit = EXIT_FAIL;
                                report.push(`FAIL  ${row.id}: required by --require ${requireScope} — ${reason} ${tag}`);
                                jr.verdict = 'fail-required';
                        } else {
                                summary.skip++;
                                report.push(`SKIP  ${row.id}: ${reason} ${tag}`);
                        }
                        continue;
                }
                jr.value = rec.value; jr.baseline = rec.baseline; jr.unit = rec.unit;
                if (row.budgetNum === null) {
                        // catalogue-only row: defined, not gated (never fails, exempt from --require)
                        summary.skip++;
                        report.push(`SKIP  ${row.id}: catalogue-only row (budget null) — value ${fmtNum(rec.value)} ${rec.unit ?? ''} reported, not gated ${tag}`);
                        jr.verdict = 'info';
                        continue;
                }
                if (row.unit && rec.unit && row.unit !== rec.unit) {
                        summary.skip++; summary.warn++;
                        report.push(`WARN  ${row.id}: unit mismatch (budget '${row.unit}' vs measurement '${rec.unit}') — row skipped rather than compared apples to oranges ${tag}`);
                        jr.verdict = 'skip'; jr.reason = 'unit mismatch';
                        continue;
                }
                const op = row.budgetOp ?? row.comparison;
                let deltaValue;
                if (op === 'delta<=') {
                        if (rec.baseline === undefined) {
                                summary.skip++; summary.warn++;
                                report.push(`WARN  ${row.id}: delta comparison requires a baseline in the measurement record (delta = value - baseline) — row skipped ${tag}`);
                                jr.verdict = 'skip'; jr.reason = 'missing baseline';
                                continue;
                        }
                        deltaValue = rec.value - rec.baseline;
                }
                const budgetLabel = row.budgetStr ?? `${row.budgetOp ?? row.comparison}${row.budgetNum}${row.unit ? ` ${row.unit}` : ''}`;
                const ok = op === 'delta<=' ? deltaValue <= row.budgetNum
                        : op === '<=' ? rec.value <= row.budgetNum
                        : op === '>=' ? rec.value >= row.budgetNum
                        : op === '<' ? rec.value < row.budgetNum
                        : op === '>' ? rec.value > row.budgetNum
                        : false;
                jr.ok = ok; jr.budget = row.budgetStr ?? row.budgetNum; jr.comparison = row.comparison;
                if (ok) {
                        summary.pass++;
                        const detail = op === 'delta<=' ? `delta ${deltaValue >= 0 ? '+' : ''}${fmtNum(deltaValue)}${row.unit ?? 'ms'} (${fmtNum(rec.value)} vs baseline ${fmtNum(rec.baseline)})`
                                : `${fmtNum(rec.value)} ${rec.unit ?? row.unit ?? ''}`;
                        report.push(`PASS  ${row.id}: ${detail} (budget ${budgetLabel}) ${tag}${row.notes ? ` — ${row.notes}` : ''}`);
                } else if (row.severity === 'warn') {
                        summary.warn++;
                        const detail = op === 'delta<=' ? `delta ${deltaValue >= 0 ? '+' : ''}${fmtNum(deltaValue)}${row.unit ?? 'ms'} (${fmtNum(rec.value)} vs baseline ${fmtNum(rec.baseline)})`
                                : `${fmtNum(rec.value)} ${rec.unit ?? row.unit ?? ''}`;
                        report.push(`WARN  ${row.id}: ${detail} over budget ${budgetLabel} (warn severity — exit unaffected) ${tag}${row.notes ? ` — ${row.notes}` : ''}`);
                } else {
                        summary.fail++;
                        exit = EXIT_FAIL;
                        const detail = op === 'delta<=' ? `delta ${deltaValue >= 0 ? '+' : ''}${fmtNum(deltaValue)}${row.unit ?? 'ms'} (${fmtNum(rec.value)} vs baseline ${fmtNum(rec.baseline)})`
                                : `${fmtNum(rec.value)} ${rec.unit ?? row.unit ?? ''}`;
                        report.push(`FAIL  ${row.id}: ${detail} over budget ${budgetLabel} ${tag}${row.notes ? ` — ${row.notes}` : ''}`);
                }
        }

        // unknown measurement ids: WARN row, never a crash (never affects the exit code)
        const unknown = [];
        for (const [id, rec] of pool) {
                if (!referenced.has(id)) { unknown.push({ id, rec }); }
        }
        for (const { id, rec } of unknown) {
                summary.warn++;
                report.push(`WARN  unknown measurement id '${id}' (value ${fmtNum(rec.value)} ${rec.unit ?? ''}) — no budget row references metric '${id}'; never fatal, registry gap to consider.`);
        }

        report.push('-- verdict ' + '-'.repeat(63));
        report.push(`budget-gate: ${summary.pass} pass / ${summary.fail} fail / ${summary.skip} skip / ${summary.warn} warn`);
        report.push(exit === EXIT_OK
                ? (summary.skip > 0 ? 'BUDGET GATE GREEN (documented skips present — see SKIP lines)' : 'BUDGET GATE GREEN')
                : 'BUDGET GATE VIOLATIONS PRESENT');
        process.stdout.write(report.join('\n') + '\n');
        if (args.json) {
                process.stdout.write('\n<flauz-budget-gate-json>\n' + JSON.stringify({
                        exit,
                        budgets: budgetsFile,
                        budgetsVersion: registry.version,
                        require: requireScope,
                        measurementInputs: ctx.inputs,
                        summary,
                        rows: jsonRows,
                        unknownMeasurementIds: unknown.map(u => u.id),
                }) + '\n</flauz-budget-gate-json>\n');
        }
        process.exit(exit);
}

main();
