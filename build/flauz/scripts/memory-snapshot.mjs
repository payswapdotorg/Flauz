#!/usr/bin/env node
// ---------------------------------------------------------------------------------------------
// Flauz Wave 3 — Lane H (perf harness + CI + budget enforcement)
//
// memory-snapshot.mjs — memory budget gate (PERFORMANCE-PLAN §3.2) over a
// process snapshot of a Flauz session.
//
// Input formats (either):
//   --json <file>      a resolveProcesses()-shaped JSON payload
//                      ({ pidToNames: [[pid, name]...], processes: [{name, rootProcess: ProcessItem}] })
//                      — the shape PERF §6.1 names for "memory snapshots in CI".
//   --status <file>    the 'Process List' section text of `--status` output
//                      (zero-product-code capture path available TODAY; converted
//                      to the same flat rows by perf-log-parse.mjs).
//   --scenario <name>  label only: 'eventually' (snapshot at LifecyclePhase.Eventually,
//                      idle) or 'after-session' (after a scripted agent session).
//                      Affects which rows are strictly enforced (see below).
//
// §3.2 budget rows asserted (PERFORMANCE-PLAN §3.2 table):
//   R1 pinned ext host       : if affinity pinning is configured for the flauz
//                              bridge, exactly ONE extra extension-host process may
//                              exist; its RSS must be within [100, 250] MB.
//                              NOTE: the 100-250 MB range is marked [E] in the plan
//                              (estimate until the first CI baseline). Rows tagged
//                              [E] WARN by default and FAIL only with --enforce —
//                              absolute baseline (§8 question 1/3) converts them to
//                              hard gates.
//   R2 flauz core service    : if a flauz-core process is present, idle RSS <= 150 MB
//                              (hard at 'eventually'; WARN under 'after-session').
//   R3 agent sessions        : <= 2 concurrent AHP agent sessions (executing+idle).
//   R4 browser panes         : <= 2 visible browser pane renderers (WebContentsView).
//   R5 flauz-added RSS total : <= 500 MB above stock (floor case, defaults).
//   R6 stock utility shape   : shared-process, pty-host, file watcher and (when
//                              prewarm is on) agent-host utility processes are the
//                              stock baseline (evidence 06) — missing stock
//                              processes are reported INFO, never fatal.
//
// Process classification is NAME-BASED (regex on the process name/cmd columns —
// utility processes are named at spawn sites: 'shared-process'
// sharedProcess.ts:173, 'pty-host' electronPtyHostStarter.ts:61, 'agent-host'
// electronAgentHostStarter.ts:175). Flauz-specific process names (flauz core,
// bridge ext host, panes, agent sessions) are pinned by Worker F/G code as it
// lands; every pattern is overridable with --pattern name=<regex> so the CI spec
// does not hardcode another lane's internals prematurely.
//
// Exit codes: 0 = all enforced rows pass (WARNs allowed) · 1 = violation or
// invalid input · 2 = usage error.
//
// Zero dependencies: node >= 20 stdlib only.
// ---------------------------------------------------------------------------------------------

import path from 'node:path';
import { parseArgs } from 'node:util';
import {
	parseResolveProcessesJson, parseStatusProcessList, readTextFile,
} from './perf-log-parse.mjs';

const EXIT_OK = 0, EXIT_FAIL = 1, EXIT_USAGE = 2;

// default classification patterns (case-insensitive)
const DEFAULT_PATTERNS = {
	extHost: /extension[-_ ]?host/i,
	flauzCore: /flauz[-_. ]?core/i,
	agentSession: /(agent[-_ ]?session|session[-_ ]?server|claude[-_ ]?agent|codex[-_ ]?agent|agent[-_ ]?sdk)/i,
	browserPane: /(browser[-_ ]?view|webcontentsview|browser[-_ ]?pane|browserView)/i,
	sharedProcess: /shared[-_ ]?process/i,
	ptyHost: /pty[-_ ]?host/i,
	watcher: /watcher/i,
	agentHost: /agent[-_ ]?host/i,
};

// §3.2 numbers
const EXT_HOST_RSS_MIN_MB = 100;   // [E]
const EXT_HOST_RSS_MAX_MB = 250;   // [E]
const FLAUZ_CORE_MAX_IDLE_MB = 150;
const MAX_AGENT_SESSIONS = 2;
const MAX_BROWSER_PANES = 2;
const FLAUZ_TOTAL_RSS_MAX_MB = 500;

function usage() {
	process.stdout.write(`memory-snapshot.mjs — Flauz memory budget gate (PERF §3.2)

Usage:
  node memory-snapshot.mjs --json  <resolveProcesses-shaped.json> [--scenario eventually|after-session]
  node memory-snapshot.mjs --status <status-process-list.txt>     [--scenario ...]
  node memory-snapshot.mjs --json <file> --enforce        # [E] estimates become hard failures
  node memory-snapshot.mjs --json <file> --pattern extHost=/regex/i   # override a classifier

Budgets (§3.2): ext-host RSS ${EXT_HOST_RSS_MIN_MB}-${EXT_HOST_RSS_MAX_MB}MB [E] · flauz-core idle <= ${FLAUZ_CORE_MAX_IDLE_MB}MB ·
agent sessions <= ${MAX_AGENT_SESSIONS} · browser panes <= ${MAX_BROWSER_PANES} · flauz-added total <= ${FLAUZ_TOTAL_RSS_MAX_MB}MB.

Exit codes: 0 pass (WARNs allowed) · 1 violation/invalid input · 2 usage error.
`);
}

function toRows(input) {
	// normalize both capture paths to [{ name, pid, memMB, cmd }]
	if (input.json) {
		const { rows, errors } = parseResolveProcessesJson(readTextFile(input.json));
		if (errors.length > 0 && rows.length === 0) {
			return { rows: [], errors };
		}
		// JSON tree: ProcessItem.mem is percent-of-total on Linux — the fixture
		// pipeline (and the CI driver) is specified to emit `mem` ALREADY IN MB
		// for the flauz harness (see build/flauz/README.md "capture contract").
		return {
			rows: rows.map(r => ({ name: r.name, pid: r.pid, memMB: Number(r.mem) || 0, cmd: r.cmd || '' })),
			errors,
		};
	}
	if (input.status) {
		const { rows, errors } = parseStatusProcessList(readTextFile(input.status));
		return { rows: rows.map(r => ({ name: r.name, pid: r.pid, memMB: r.memMB, cmd: '' })), errors };
	}
	return { rows: [], errors: ['no input: pass --json or --status'] };
}

function main() {
	let parsed;
	try {
		parsed = parseArgs({
			allowPositionals: false,
			options: {
				json: { type: 'string' },
				status: { type: 'string' },
				scenario: { type: 'string', default: 'eventually' },
				enforce: { type: 'boolean', default: false },
				pattern: { type: 'string', multiple: true },
				help: { type: 'boolean', default: false },
			},
		});
	} catch (e) {
		process.stderr.write(`usage error: ${e.message}\n\n`); usage(); process.exit(EXIT_USAGE);
	}
	const args = parsed.values;
	if (args.help) { usage(); process.exit(EXIT_OK); }
	if (!args.json && !args.status) { usage(); process.exit(EXIT_USAGE); }
	if (!['eventually', 'after-session'].includes(args.scenario)) {
		process.stderr.write(`usage error: --scenario must be 'eventually' or 'after-session'\n`);
		process.exit(EXIT_USAGE);
	}

	const patterns = { ...DEFAULT_PATTERNS };
	for (const spec of (args.pattern ?? [])) {
		const m = spec.match(/^([A-Za-z]+)=(.*)$/);
		if (!m) { process.stderr.write(`usage error: --pattern must be name=<regex>\n`); process.exit(EXIT_USAGE); }
		try {
			const body = m[2].startsWith('/') ? m[2].replace(/^\/(.*)\/[a-z]*$/, '$1') : m[2];
			patterns[m[1]] = new RegExp(body, 'i');
		} catch (e) {
			process.stderr.write(`usage error: bad regex in --pattern ${spec}: ${e.message}\n`);
			process.exit(EXIT_USAGE);
		}
	}

	const { rows, errors } = toRows(args);
	if (rows.length === 0) {
		process.stderr.write(`error: no process rows parsed${errors.length ? ` — ${errors.join('; ')}` : ''}\n`);
		process.exit(EXIT_FAIL);
	}
	const report = [];
	for (const e of errors) { report.push(`WARN: ${e}`); }
	const classify = (key) => rows.filter(r => patterns[key].test(r.name) || (r.cmd && patterns[key].test(r.cmd)));
	const sumMB = (list) => list.reduce((a, r) => a + (r.memMB || 0), 0);
	const nm = (list) => list.length ? list.map(r => `${r.name}(${Math.round(r.memMB)}MB)`).join(', ') : 'none';

	report.push(`scenario: ${args.scenario} · capture: ${args.json ? 'resolveProcesses-json' : 'status-text'} · rows: ${rows.length} · enforce[E]=${args.enforce}`);

	let exit = EXIT_OK;
	const fail = (msg) => { report.push(`FAIL  ${msg}`); exit = EXIT_FAIL; };
	const warn = (msg) => report.push(`WARN  ${msg}`);
	const pass = (msg) => report.push(`PASS  ${msg}`);

	// R1 — pinned extension host
	const extHosts = classify('extHost');
	const flauzCore = classify('flauzCore');
	const sessions = classify('agentSession');
	const panes = classify('browserPane');
	// flauz-added set: flauz core + flauz ext host above stock count + panes + sessions
	const STOCK_EXT_HOSTS = 1;
	const extraExtHosts = Math.max(0, extHosts.length - STOCK_EXT_HOSTS);
	if (extraExtHosts === 0) {
		warn('R1 no affinity-pinned extra extension host detected — either pinning is off (shared host: perf-only degradation, PERF R1) or the process pattern needs a --pattern override.');
	} else if (extraExtHosts === 1) {
		const rss = Math.round(sumMB(extHosts) - (extHosts.length > 1 ? 0 : 0)); // extra host RSS = the pinned one's own RSS
		const pinned = extHosts[extHosts.length - 1];
		const pinnedRSS = Math.round(pinned.memMB || 0);
		if (pinnedRSS < EXT_HOST_RSS_MIN_MB || pinnedRSS > EXT_HOST_RSS_MAX_MB) {
			const msg = `R1 pinned ext-host RSS ${pinnedRSS}MB outside [${EXT_HOST_RSS_MIN_MB}, ${EXT_HOST_RSS_MAX_MB}]MB [E] — ${nm([pinned])}`;
			if (args.enforce) { fail(msg); } else { warn(msg); }
		} else {
			pass(`R1 pinned ext-host RSS ${pinnedRSS}MB within [${EXT_HOST_RSS_MIN_MB}, ${EXT_HOST_RSS_MAX_MB}]MB [E] — ${nm([pinned])}`);
		}
	} else {
		fail(`R1 ${extraExtHosts} extra extension-host processes — affinity pinning must allocate EXACTLY ONE additional host (§2.1 rule 2). Hosts: ${nm(extHosts)}`);
	}

	// R2 — flauz core service
	if (flauzCore.length > 1) {
		fail(`R2 ${flauzCore.length} flauz-core processes (expected <= 1): ${nm(flauzCore)}`);
	} else if (flauzCore.length === 1) {
		const rss = Math.round(flauzCore[0].memMB || 0);
		if (args.scenario === 'eventually') {
			if (rss > FLAUZ_CORE_MAX_IDLE_MB) { fail(`R2 flauz-core idle RSS ${rss}MB > ${FLAUZ_CORE_MAX_IDLE_MB}MB (§3.2) — ${nm(flauzCore)}`); }
			else { pass(`R2 flauz-core idle RSS ${rss}MB <= ${FLAUZ_CORE_MAX_IDLE_MB}MB`); }
		} else {
			// after a scripted agent session the ledger may legitimately grow; warn-only here
			if (rss > FLAUZ_TOTAL_RSS_MAX_MB) { fail(`R2 flauz-core RSS ${rss}MB > total budget ${FLAUZ_TOTAL_RSS_MAX_MB}MB even post-session — ${nm(flauzCore)}`); }
			else { warn(`R2 flauz-core RSS ${rss}MB after scripted session (idle budget ${FLAUZ_CORE_MAX_IDLE_MB}MB applies at 'eventually' only)`); }
		}
	} else {
		report.push('INFO  R2 no flauz-core process in snapshot (lane not merged / core not spawned) — row skipped.');
	}

	// R3 — agent sessions
	if (sessions.length > MAX_AGENT_SESSIONS) {
		fail(`R3 ${sessions.length} concurrent agent sessions > ${MAX_AGENT_SESSIONS} (§3.2/§4.1: 1 executing + 1 idle) — ${nm(sessions)}`);
	} else {
		pass(`R3 agent sessions ${sessions.length} <= ${MAX_AGENT_SESSIONS}${sessions.length ? ` — ${nm(sessions)}` : ''}`);
	}

	// R4 — browser panes
	if (panes.length > MAX_BROWSER_PANES) {
		fail(`R4 ${panes.length} visible browser panes > ${MAX_BROWSER_PANES} (§3.2: dispose idle pane renderers) — ${nm(panes)}`);
	} else {
		pass(`R4 browser panes ${panes.length} <= ${MAX_BROWSER_PANES}${panes.length ? ` — ${nm(panes)}` : ''}`);
	}

	// R5 — flauz-added RSS total (floor case)
	const flauzAdded = [...flauzCore, ...panes, ...sessions, ...(extraExtHosts > 0 ? extHosts.slice(STOCK_EXT_HOSTS) : [])];
	const total = Math.round(sumMB(flauzAdded));
	if (total > FLAUZ_TOTAL_RSS_MAX_MB) {
		fail(`R5 flauz-added RSS total ${total}MB > ${FLAUZ_TOTAL_RSS_MAX_MB}MB (§3.2 floor-case total) — set: ${nm(flauzAdded)}`);
	} else {
		pass(`R5 flauz-added RSS total ${total}MB <= ${FLAUZ_TOTAL_RSS_MAX_MB}MB (${flauzAdded.length} process(es))`);
	}

	// R6 — stock utility shape (informational)
	for (const [key, label] of [['sharedProcess', 'shared-process'], ['ptyHost', 'pty-host'], ['watcher', 'watcher'], ['agentHost', 'agent-host']]) {
		const found = classify(key);
		report.push(`INFO  R6 stock ${label}: ${found.length ? `present (${nm(found)})` : 'absent'}`);
	}

	report.push('── verdict ' + '─'.repeat(51));
	report.push(exit === EXIT_OK ? 'MEMORY SNAPSHOT GATES GREEN (see WARN/INFO lines for [E] rows)' : 'MEMORY SNAPSHOT VIOLATIONS PRESENT');
	process.stdout.write(report.join('\n') + '\n');
	process.exit(exit);
}

main();
