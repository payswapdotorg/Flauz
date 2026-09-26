#!/usr/bin/env node

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// ---------------------------------------------------------------------------------------------
// Flauz Wave 3 — Lane H (perf harness + CI + budget enforcement)
//
// startup-pair.mjs — startup perf pair gate (PERFORMANCE-PLAN section 1.3) + mark-pair
// integrity check (PERF section 6.3 / risk R6).
//
// Modes (composable):
//
//  A) TSV pair diff (section 1.3 rows 1-2):
//     node startup-pair.mjs \
//       --timers-flauz   <flauz-main append-timers TSV> \
//       --timers-upstream <upstream-main append-timers TSV>
//
//     Parses both TSVs (format: perf-log-parse.mjs), keeps only standard_start
//     runs, and asserts (deltas are Flauz - Upstream, same runner, raw ms):
//       section 1.3 row 1  first-paint delta        p50 <= +75 ms   p95 <= +150 ms
//       section 1.3 row 2  didStartWorkbench delta  p95 <= +100 ms
//     NOTE on semantics: the append-timers TSV exposes exactly one timing column,
//     `ellapsed`, which the timer service defines as
//     getDuration(startMark, 'code/didStartWorkbench') (timerService.ts:699) —
//     i.e. the workbench-done duration. Row 1 gates the p50/p95 deltas of that
//     column; row 2 re-gates the same column's p95 at the tighter +100 ms. For
//     finer first-paint granularity (didStartRenderer → didStartWorkbench) use
//     mode B markers, which the same CI job also collects.
//     Non-standard runs are excluded from stats and reported; if either side has
//     fewer than --min-runs (default 5) standard runs, the gate FAILS (invalid
//     measurement).
//
//  B) Duration-marker pair budgets (section 1.3 rows 2-3, section 6.2 flauz marks):
//     node startup-pair.mjs \
//       --markers-flauz   <flauz-main duration-markers TSV> \
//       --markers-upstream <upstream-main duration-markers TSV>
//
//     Asserts, per marker pair (nearest-rank percentiles across runs):
//       - `code/didStartRenderer-code/didStartWorkbench`  p95 delta <= +100 ms  (row 2 exact)
//       - `code/flauz/willConnectCore-code/flauz/didConnectCore` absolute <= 500 ms
//         (row 3: handshake complete <= 500 ms after Eventually — measured as the
//         mark pair duration the bridge emits)
//       - every pair in --pairs-file additionally: either {absMax: ms} (absolute)
//         or {deltaMaxP95: ms} (pair diff vs upstream).
//     A budgeted pair that is ABSENT from every flauz run is a FAIL (marks never
//     closed) — protects the drift class where timerService computes timers from
//     marks nobody emits (PERF section 6.3, evidence 01 claim 4: ellapsedWindowMaximize).
//
//  C) Mark-pair integrity / source grep (R6):
//     node startup-pair.mjs --check-marks --src-root <repo-or-src-dir>
//
//     Every budgeted `code/flauz/*` mark name must be greppable as a literal in
//     at least one file under the Flauz source globs:
//       extensions/flauz-*/**/*.{ts,js,mjs}  and  src/vs/workbench/contrib/flauz/**/*
//     If no flauz source exists yet (parallel lanes not merged), the check
//     reports SKIP (exit 0) — CI must stay green while lanes are in flight
//     (work order: "glob whatever exists at CI time, never hardcode").
//     Override the globs with --flauz-glob (repeatable).
//
//  D) Contribution-phase gate (section 1.3 row 4: "Flauz work before Restored = 0"):
//     node startup-pair.mjs --phase-gate --src-root <repo-or-src-dir>
//
//     Greps flauz sources for workbench-contribution phase registrations and
//     FAILS if any registers at a phase BEFORE AfterRestored
//     (Starting|Restored|BlockRestore — contributions.ts:31-62 phase order).
//     SKIP (exit 0) when no flauz sources exist.
//
// Output: human-readable report on stdout. Exit codes:
//   0 = all assertions passed (or documented SKIP)
//   1 = budget/integrity violation or invalid measurement
//   2 = usage error / file not readable
//
// Zero dependencies: node >= 20 stdlib only.
// ---------------------------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
        parseAppendTimersTsv, parseDurationMarkersTsv, stats, fmtMs, readTextFile,
} from './perf-log-parse.mjs';

// ---- PERF section 1.3 / section 6.2 budget table ------------------------------------------------------------
// marker-pair name (exactly as passed to --prof-duration-markers) -> budget.
// `absMax`   : absolute ms budget (flauz runs only)
// `deltaMaxP95`: p95 delta budget vs the upstream pair (flauz - upstream, same runner)
export const STARTUP_BUDGETS = {
        'code/didStartRenderer-code/didStartWorkbench': { deltaMaxP95: 100, note: 'section 1.3 row 2: didStartWorkbench delta <= +100ms p95 (renderer-start segment)' },
        'code/flauz/willConnectCore-code/flauz/didConnectCore': { absMax: 500, note: 'section 1.3 row 3: core handshake <= 500ms (willConnectCore -> didConnectCore)' },
        'code/flauz/willRegisterParticipants-code/flauz/didRegisterParticipants': { absMax: 500, note: 'section 6.2 mark: participant registration window' },
        'code/flauz/willWarmModels-code/flauz/didWarmModels': { absMax: 2000, note: 'section 1.3 row 6 / section 5.1: LM vendor warm-up <= 2s, off interactive path' },
};

// section 1.3 rows 1-2, measured on the append-timers `ellapsed` column.
const FIRST_PAINT_P50_MAX = 75;    // +ms p50 delta
const FIRST_PAINT_P95_MAX = 150;   // +ms p95 delta
const DIDSTARTWORKBENCH_P95_MAX = 100; // +ms p95 delta (row 2, tighter re-gate)

// section 1.3 row 5 (Agent Bridge activation) is asserted from extensionActivationTimes
// telemetry / bridge marks; see build/flauz/README.md job map. The bridge-side
// marks live here so --check-marks covers them as soon as Worker F lands them:
export const BRIDGE_ACTIVATION_MARKS = [
        'code/flauz/willActivateBridge-code/flauz/didActivateBridge', // <= 300ms activate-resolved (section 1.3 row 5)
];

const FLAUZ_SOURCE_GLOBS_DEFAULT = [
        'extensions/flauz-*/**/*.ts',
        'extensions/flauz-*/**/*.js',
        'extensions/flauz-*/**/*.mjs',
        'src/vs/workbench/contrib/flauz/**/*',
];

// phases (src/vs/workbench/common/contributions.ts) in registration order —
// anything listed here that is NOT AfterRestored/Eventually is pre-Restored work.
const FORBIDDEN_PHASE_PATTERN = /WorkbenchPhase\s*\.\s*(BlockRestore|Starting|Restored)\b/;

const EXIT_OK = 0, EXIT_FAIL = 1, EXIT_USAGE = 2;

function usage() {
        process.stdout.write(`startup-pair.mjs — Flauz startup perf pair gate (PERF section 1.3) + mark integrity (R6)

Modes:
  --timers-flauz <tsv> --timers-upstream <tsv>
        Assert section 1.3 row 1 (<= +${FIRST_PAINT_P50_MAX}ms p50 / +${FIRST_PAINT_P95_MAX}ms p95) and row 2
        (<= +${DIDSTARTWORKBENCH_P95_MAX}ms p95) on the ellapsed column of --prof-append-timers TSVs.
  --markers-flauz <tsv> [--markers-upstream <tsv>]
        Assert duration-marker pair budgets (see table in this file / --pairs-file).
  --check-marks --src-root <dir>
        Mark-pair integrity: every budgeted code/flauz/* mark greppable in flauz sources (R6).
  --phase-gate --src-root <dir>
        section 1.3 row 4: no flauz workbench contribution before AfterRestored/Eventually.
  --pairs-file <json>
        Extra/override budgets: { "<pair-name>": { "absMax": 500 } | { "deltaMaxP95": 100 } }

Options:
  --min-runs <n>      minimum standard_start runs per side (default 5)
  --flauz-glob <g>    override source globs for --check-marks/--phase-gate (repeatable)
  --src-root <dir>    repository root (or any dir containing flauz sources)
  --json              additionally emit a machine-readable JSON verdict block

Exit codes: 0 pass/SKIP · 1 violation or invalid measurement · 2 usage error.
`);
}

// ---- tiny glob engine (no deps): supports **, *, and ? ---------------------------------------
function globToRegExp(pattern) {
        let re = '';
        for (let i = 0; i < pattern.length; i++) {
                const c = pattern[i];
                if (c === '*') {
                        if (pattern[i + 1] === '*') {
                                // '**/' or '**'
                                if (pattern[i + 2] === '/') { re += '(?:.*/)?'; i += 2; }
                                else { re += '.*'; i += 1; }
                        } else { re += '[^/]*'; }
                } else if (c === '?') { re += '[^/]'; }
                else { re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&'); }
        }
        return new RegExp(`^${re}$`);
}

function walkFiles(rootDir, { skipDirs = new Set(['node_modules', '.git', 'out', 'out-build', 'dist']) } = {}) {
        const out = [];
        const rec = (dir) => {
                let entries;
                try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
                for (const e of entries) {
                        const p = path.join(dir, e.name);
                        if (e.isDirectory()) { if (!skipDirs.has(e.name)) { rec(p); } }
                        else if (e.isFile()) { out.push(p); }
                }
        };
        rec(rootDir);
        return out;
}

function findFlauzSources(srcRoot, globs) {
        const regexes = globs.map(globToRegExp);
        const base = path.resolve(srcRoot);
        const files = walkFiles(base);
        const hits = [];
        for (const f of files) {
                const rel = path.relative(base, f).split(path.sep).join('/');
                if (regexes.some(re => re.test(rel))) { hits.push({ abs: f, rel }); }
        }
        return hits;
}

// ---- mode A: timers pair -----------------------------------------------------------------------
function runTimersPair(args, report) {
        const flauzPath = args['timers-flauz'], upstreamPath = args['timers-upstream'];
        if (!flauzPath || !upstreamPath) {
                report.push('ERROR: --timers-flauz and --timers-upstream must be given together.');
                return EXIT_USAGE;
        }
        const a = parseAppendTimersTsv(readTextFile(flauzPath));
        const b = parseAppendTimersTsv(readTextFile(upstreamPath));
        let hardErrors = 0;
        for (const e of [...a.errors, ...b.errors]) { report.push(`PARSE-ERROR: ${e}`); hardErrors++; }
        const keep = (r) => r.standardStart;
        const fa = a.runs.filter(keep), fb = b.runs.filter(keep);
        const dropped = (a.runs.length - fa.length) + (b.runs.length - fb.length);
        if (dropped > 0) {
                for (const r of a.runs.filter(r => !keep(r))) { report.push(`WARN: flauz run excluded (non-standard start): ${r.standardStartError}`); }
                for (const r of b.runs.filter(r => !keep(r))) { report.push(`WARN: upstream run excluded (non-standard start): ${r.standardStartError}`); }
        }
        let minRuns = 5;
        if (args['min-runs'] !== undefined && args['min-runs'] !== '') {
                const n = Number(args['min-runs']);
                if (!Number.isInteger(n) || n < 1) {
                        report.push(`ERROR: --min-runs must be a positive integer (got '${args['min-runs']}').`);
                        return EXIT_USAGE;
                }
                minRuns = n;
        }
        if (fa.length < minRuns || fb.length < minRuns) {
                report.push(`FAIL: invalid measurement — standard_start runs: flauz=${fa.length}, upstream=${fb.length}, need >= ${minRuns} per side.`);
                return EXIT_FAIL;
        }
        const sa = stats(fa.map(r => r.ellapsed));
        const sb = stats(fb.map(r => r.ellapsed));
        const d50 = sa.p50 - sb.p50, d95 = sa.p95 - sb.p95, dMean = sa.mean - sb.mean;
        report.push(`runs: flauz n=${sa.n}, upstream n=${sb.n} (excluded non-standard: ${dropped})`);
        report.push(`ellapsed flauz:    p50=${fmtMs(sa.p50)} p95=${fmtMs(sa.p95)} mean=${fmtMs(sa.mean)}`);
        report.push(`ellapsed upstream: p50=${fmtMs(sb.p50)} p95=${fmtMs(sb.p95)} mean=${fmtMs(sb.mean)}`);
        report.push(`perfBaseline flauz=${fmtMs(stats(fa.map(r => r.perfBaselineMs)).p50)} upstream=${fmtMs(stats(fb.map(r => r.perfBaselineMs)).p50)} (machine-speed normalizer, informational)`);
        let exit = EXIT_OK;
        const verdict = (label, value, max) => {
                const ok = value <= max;
                if (!ok) { exit = EXIT_FAIL; }
                report.push(`${ok ? 'PASS' : 'FAIL'}  section 1.3 ${label}: delta ${value >= 0 ? '+' : ''}${value.toFixed(1)}ms (budget +${max}ms)`);
        };
        verdict('row 1 first-paint p50 delta', d50, FIRST_PAINT_P50_MAX);
        verdict('row 1 first-paint p95 delta', d95, FIRST_PAINT_P95_MAX);
        verdict('row 2 didStartWorkbench p95 delta', d95, DIDSTARTWORKBENCH_P95_MAX);
        if (hardErrors > 0) { report.push(`FAIL: ${hardErrors} parse error(s) in the input TSVs.`); return EXIT_FAIL; }
        return exit;
}

// ---- mode B: duration markers ------------------------------------------------------------------
function runMarkersPair(args, budgets, report) {
        const flauzPath = args['markers-flauz'];
        if (!flauzPath) {
                report.push('ERROR: --markers-flauz is required for the markers mode.');
                return EXIT_USAGE;
        }
        const f = parseDurationMarkersTsv(readTextFile(flauzPath));
        const u = args['markers-upstream'] ? parseDurationMarkersTsv(readTextFile(args['markers-upstream'])) : { runs: [], errors: [] };
        let exit = EXIT_OK;
        if (f.errors.length > 0) { for (const e of f.errors) { report.push(`PARSE-ERROR (flauz markers): ${e}`); } exit = EXIT_FAIL; }
        if (u.errors.length > 0) { for (const e of u.errors) { report.push(`PARSE-ERROR (upstream markers): ${e}`); } exit = EXIT_FAIL; }
        if (f.runs.length === 0) { report.push('FAIL: no duration-marker runs parsed on the flauz side.'); return EXIT_FAIL; }
        report.push(`marker runs: flauz n=${f.runs.length}${u.runs.length ? `, upstream n=${u.runs.length}` : ' (no upstream side — absolute budgets only)'}`);

        for (const [pairName, budget] of Object.entries(budgets)) {
                const fVals = f.runs.map(r => r.pairs[pairName]).filter(v => typeof v === 'number');
                if (fVals.length === 0) {
                        report.push(`FAIL  ${pairName}: absent from ALL ${f.runs.length} flauz run(s) — mark pair never closed or not emitted (R6 drift class). Budget: ${budget.note}`);
                        exit = EXIT_FAIL;
                        continue;
                }
                const fs_ = stats(fVals);
                if (budget.absMax !== undefined) {
                        const ok = fs_.p95 <= budget.absMax;
                        if (!ok) { exit = EXIT_FAIL; }
                        report.push(`${ok ? 'PASS' : 'FAIL'}  ${pairName}: p95 ${fmtMs(fs_.p95)} over n=${fs_.n} (absolute budget ${budget.absMax}ms) — ${budget.note}`);
                }
                if (budget.deltaMaxP95 !== undefined) {
                        if (u.runs.length === 0) {
                                report.push(`WARN  ${pairName}: delta budget defined but no upstream markers supplied — delta not asserted (absolute side above still applies).`);
                        } else {
                                const uVals = u.runs.map(r => r.pairs[pairName]).filter(v => typeof v === 'number');
                                if (uVals.length === 0) {
                                        report.push(`WARN  ${pairName}: upstream side never emitted the pair — cannot compute delta; treating as flauz-only pair.`);
                                } else {
                                        const us = stats(uVals);
                                        const d = fs_.p95 - us.p95;
                                        const ok = d <= budget.deltaMaxP95;
                                        if (!ok) { exit = EXIT_FAIL; }
                                        report.push(`${ok ? 'PASS' : 'FAIL'}  ${pairName}: p95 delta ${d >= 0 ? '+' : ''}${d.toFixed(1)}ms (flauz ${fmtMs(fs_.p95)} vs upstream ${fmtMs(us.p95)}, budget +${budget.deltaMaxP95}ms) — ${budget.note}`);
                                }
                        }
                }
        }
        return exit;
}

// ---- mode C: mark-pair integrity (source grep) -------------------------------------------------
function runCheckMarks(args, budgets, report) {
        const srcRoot = args['src-root'];
        if (!srcRoot) { report.push('ERROR: --check-marks requires --src-root.'); return EXIT_USAGE; }
        const globs = args['flauz-glob'] ?? FLAUZ_SOURCE_GLOBS_DEFAULT;
        const sources = findFlauzSources(srcRoot, globs);
        if (sources.length === 0) {
                report.push(`SKIP: no flauz sources matched under '${srcRoot}' (${globs.join(', ')}) — lanes not merged yet; mark-pair integrity deferred (documented skip, CI stays green).`);
                return EXIT_OK;
        }
        // read all matched sources once, case-sensitive literal grep (mark strings are exact)
        const haystacks = [];
        for (const s of sources) {
                try { haystacks.push({ rel: s.rel, text: fs.readFileSync(s.abs, 'utf8') }); } catch (e) { report.push(`WARN: cannot read ${s.rel}: ${e.message}`); }
        }
        report.push(`scanned ${haystacks.length} flauz source file(s) for budgeted mark emit sites.`);
        let exit = EXIT_OK;
        // R6 scope: ONLY code/flauz/* marks require flauz-side emit sites. Upstream
        // pairs (e.g. code/didStartRenderer-code/didStartWorkbench) are emitted by
        // upstream's own src/vs code — pristine, upstream-maintained, out of scope.
        const markNames = new Set();
        for (const pair of Object.keys(budgets).concat(BRIDGE_ACTIVATION_MARKS)) {
                for (const m of pair.split('-')) {
                        if (m.startsWith('code/flauz/')) { markNames.add(m); }
                }
        }
        for (const mark of [...markNames].sort()) {
                const sites = haystacks.filter(h => h.text.includes(mark));
                if (sites.length === 0) {
                        report.push(`FAIL  mark integrity: '${mark}' has NO emit site in flauz sources (R6: timerService would compute a timer from a mark nobody emits).`);
                        exit = EXIT_FAIL;
                } else {
                        report.push(`PASS  mark integrity: '${mark}' emitted in ${sites.length} file(s): ${sites.slice(0, 3).map(s => s.rel).join(', ')}${sites.length > 3 ? ', …' : ''}`);
                }
        }
        return exit;
}

// ---- mode D: contribution-phase gate -----------------------------------------------------------
function runPhaseGate(args, report) {
        const srcRoot = args['src-root'];
        if (!srcRoot) { report.push('ERROR: --phase-gate requires --src-root.'); return EXIT_USAGE; }
        const globs = args['flauz-glob'] ?? FLAUZ_SOURCE_GLOBS_DEFAULT;
        const sources = findFlauzSources(srcRoot, globs);
        if (sources.length === 0) {
                report.push(`SKIP: no flauz sources matched under '${srcRoot}' — contribution-phase gate deferred (documented skip).`);
                return EXIT_OK;
        }
        let exit = EXIT_OK;
        let checked = 0;
        for (const s of sources) {
                let text;
                try { text = fs.readFileSync(s.abs, 'utf8'); } catch { continue; }
                checked++;
                const m = text.match(FORBIDDEN_PHASE_PATTERN);
                if (m) {
                        report.push(`FAIL  section 1.3 row 4 (no Flauz work before Restored): ${s.rel} registers a workbench contribution at WorkbenchPhase.${m[1]} — allowed phases: AfterRestored, Eventually.`);
                        exit = EXIT_FAIL;
                }
        }
        const okPhases = sources.filter(s => { try { return /WorkbenchPhase\s*\.\s*(AfterRestored|Eventually)/.test(fs.readFileSync(s.abs, 'utf8')); } catch { return false; } });
        report.push(`phase gate: ${checked} file(s) scanned; ${okPhases.length} register at AfterRestored/Eventually (allowed); pre-Restored registrations: ${exit === EXIT_OK ? 'none' : 'see FAIL lines above'}.`);
        return exit;
}

// ---- main --------------------------------------------------------------------------------------
function main() {
        let parsed;
        try {
                parsed = parseArgs({
                        allowPositionals: false,
                        options: {
                                'timers-flauz': { type: 'string' },
                                'timers-upstream': { type: 'string' },
                                'markers-flauz': { type: 'string' },
                                'markers-upstream': { type: 'string' },
                                'check-marks': { type: 'boolean' },
                                'phase-gate': { type: 'boolean' },
                                'src-root': { type: 'string' },
                                'pairs-file': { type: 'string' },
                                'min-runs': { type: 'string' },
                                'flauz-glob': { type: 'string', multiple: true },
                                json: { type: 'boolean', default: false },
                                help: { type: 'boolean', default: false },
                        },
                });
        } catch (e) {
                process.stderr.write(`usage error: ${e.message}\n\n`); usage(); process.exit(EXIT_USAGE);
        }
        const args = parsed.values;
        if (args.help) { usage(); process.exit(EXIT_OK); }

        const budgets = { ...STARTUP_BUDGETS };
        if (args['pairs-file']) {
                try {
                        const extra = JSON.parse(readTextFile(args['pairs-file']));
                        for (const [k, v] of Object.entries(extra)) { budgets[k] = v; }
                } catch (e) {
                        process.stderr.write(`error: cannot load --pairs-file: ${e.message}\n`);
                        process.exit(EXIT_USAGE);
                }
        }

        const report = [];
        let exit = EXIT_OK;
        const modes = [];
        if (args['timers-flauz'] || args['timers-upstream']) { modes.push('timers-pair'); }
        if (args['markers-flauz']) { modes.push('markers-pair'); }
        if (args['check-marks']) { modes.push('check-marks'); }
        if (args['phase-gate']) { modes.push('phase-gate'); }
        if (modes.length === 0) { usage(); process.exit(EXIT_USAGE); }

        for (const mode of modes) {
                report.push(`── ${mode} ${'─'.repeat(Math.max(0, 60 - mode.length))}`);
                let mExit;
                if (mode === 'timers-pair') { mExit = runTimersPair(args, report); }
                else if (mode === 'markers-pair') { mExit = runMarkersPair(args, budgets, report); }
                else if (mode === 'check-marks') { mExit = runCheckMarks(args, budgets, report); }
                else { mExit = runPhaseGate(args, report); }
                if (mExit === EXIT_USAGE) { process.stdout.write(report.join('\n') + '\n'); process.exit(EXIT_USAGE); }
                if (mExit !== EXIT_OK) { exit = EXIT_FAIL; }
        }

        report.push(`── verdict ${'─'.repeat(53)}`);
        report.push(exit === EXIT_OK ? 'ALL STARTUP GATES GREEN' : 'STARTUP GATE VIOLATIONS PRESENT');
        process.stdout.write(report.join('\n') + '\n');
        if (args.json) {
                process.stdout.write('\n<flauz-startup-pair-json>\n' + JSON.stringify({ exit, modes, budgets: Object.keys(budgets) }) + '\n</flauz-startup-pair-json>\n');
        }
        process.exit(exit);
}

main();
