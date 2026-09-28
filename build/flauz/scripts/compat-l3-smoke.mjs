/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// ---------------------------------------------------------------------------------------------
// Flauz TL4 (product-quality lane) - Worker B, task TL4-008.
//
// compat-l3-smoke.mjs - Code OSS compatibility battery, layer 3: the runtime
// boot smoke driver (zero-dep). Spec: docs/FLAUZ-PROGRAM/TL4-COMPAT-BATTERY.md
// section 11; baseline: build/flauz/compat-l3-baseline.md.
//
// Mission: assert, at RUNTIME, what can honestly be observed about a booted
// workbench with the Flauz extensions active - "Flauz adds, never regresses
// Code OSS" proven by boot, not just by manifests (L1/L2 stay with
// compat-battery.mjs; this driver never touches them).
//
// Modes:
//   attach (CI)   the harness launched the workbench (xvfb + scripts/code.sh,
//                 the b-policy-canary pattern); the driver takes the launch
//                 coordinates: CDP port (--remote-debugging-port), captured
//                 log path(s), user-data-dir logs tree, compiled output root.
//   child         the driver launches the subject itself (--cmd/--arg/--env),
//                 owns the process group, captures stdout/stderr into the log
//                 corpus automatically and evaluates the natural exit code.
//
// Honesty law: a row the driver CANNOT observe is reported as SKIP with the
// exact reason - NEVER a fake pass. The row catalogue is ADDITIVE (baseline
// doc section 2 records the census and the distance list).
//
// Row catalogue (v1):
//   boot.cdp-reachable      CDP /json/version answered (PASS-capable)
//   boot.workbench-target   /json/list has a page target whose url matches
//                           --target-regex (PASS-capable)
//   boot.http-reachable     --http-url answered 2xx (PASS-capable)
//   boot.exit-clean         child mode only: natural exit code 0
//                           (attach mode SKIPs - the harness owns the process)
//   workbench.log-clean     no fatal pattern in the log corpus (PASS-capable)
//   ext.host-started        extension-host startup marker in the corpus
//                           (PASS-capable; source-pinned default regex)
//   ext.flauz-activated     a flauz.* built-in activation record in the corpus
//                           (PASS-capable; the L3 positive control)
//   pillar.<p>.compiled     compiled-output presence rows (x7: terminal, scm,
//                           palette, settings, notebook, debug, remote) - the
//                           B-POLICY A3 compile-grep pattern (PASS-capable)
//   pillar.<p>.functional   terminal/scm/palette/settings runtime smokes -
//                           SKIP until a UI-automation driver exists (lane F)
//
// Usage:
//   node compat-l3-smoke.mjs [--cdp-port <n>] [--cdp-host <h>] [--http-url <u>]
//                            [--log <file>]... [--log-dir <dir>]...
//                            [--compile-root <dir>] [--cmd <path> [--arg <v>]...
//                            [--cwd <dir>] [--env <K=V>]...]
//                            [--target-regex <re>] [--boot-timeout <ms>]
//                            [--settle-timeout <ms>] [--poll-interval <ms>]
//                            [--kill-timeout <ms>] [--ext-host-regex <re>]
//                            [--ext-activation-regex <re>] [--fatal-regex <re>]...
//                            [--require] [--json] [--out <path>] [--no-fail]
//
//   --cdp-port <n>          CDP HTTP endpoint port on --cdp-host (default
//                           127.0.0.1); the workbench is launched with
//                           --remote-debugging-port=<n>. Polled until ready.
//   --http-url <u>          generic readiness URL (polled until 2xx).
//   --log <file>            (repeatable) captured log file to scan (the boot
//                           stdout/stderr capture).
//   --log-dir <dir>         (repeatable) directory tree scanned for *.log
//                           (recursive) - the --user-data-dir/logs tree.
//   --compile-root <dir>    compiled output root for the pillar compiled rows
//                           (default: <repo>/out; the default SKIPs when the
//                           directory is absent - workers never build).
//   --cmd <path>            child mode: launch this subject (the driver owns
//                           the process group and kills it at the end).
//   --arg <value>           (repeatable) one argument for --cmd. NOTE: values
//                           starting with a dash need the equals form
//                           (--arg=-e) - node:util parseArgs rejects the
//                           space form as ambiguous.
//   --cwd <dir>             working directory for --cmd.
//   --env <K=V>             (repeatable) extra environment for --cmd.
//   --target-regex <re>     /json/list page-target url match (default
//                           'workbench' - matches the workbench.html target).
//   --boot-timeout <ms>     readiness poll budget (default 60000).
//   --settle-timeout <ms>   post-readiness wait for extension-activation
//                           markers in the log corpus (default 30000).
//   --poll-interval <ms>    poll interval (default 500).
//   --kill-timeout <ms>     child mode: SIGTERM to SIGKILL grace (default
//                           10000).
//   --ext-host-regex <re>   extension-host startup marker (default
//                           'ExtensionService#_doActivateExtension|Eager
//                           extensions activated' - pinned to
//                           src/vs/workbench/api/common/extHostExtensionService.ts:480,818).
//   --ext-activation-regex <re>  flauz activation marker (default
//                           'ExtensionService#_doActivateExtension flauz\.').
//   --fatal-regex <re>      (repeatable) ADDS a fatal pattern for
//                           workbench.log-clean on top of the defaults
//                           (Unresponsive, Fatal error, terminated
//                           unexpectedly, uncaught exception).
//   --require               CI contract: at least one live boot channel
//                           (--cdp-port | --http-url | --cmd) must be wired,
//                           else usage error (exit 2) - the gate refuses to
//                           SKIP-pass a run that observed no boot. Unlike
//                           compat-battery --require, SKIP rows do NOT
//                           escalate: the honest census (functional rows)
//                           is part of the report.
//   --json                  machine output (tab-indented, the
//                           compat-battery.mjs meta shape).
//   --out <path>            write the JSON report to a file as well (parent
//                           dirs created) - independent of --json.
//   --no-fail               report-only: FAIL rows are printed but exit 0
//                           (usage errors still exit 2).
//
// Environment fallbacks (the CI job wires these): FLAUZ_L3_CDP_PORT,
// FLAUZ_L3_HTTP_URL, FLAUZ_L3_LOG, FLAUZ_L3_LOG_DIR, FLAUZ_L3_COMPILE_ROOT,
// FLAUZ_L3_CMD, FLAUZ_L3_BOOT_TIMEOUT_MS, FLAUZ_L3_SETTLE_TIMEOUT_MS.
//
// Exit codes:
//   0  pass / SKIP-only (or any finding under --no-fail)
//   1  divergence - FAIL row(s) present
//   2  usage error / internal error
//
// Zero dependencies: node >= 20 stdlib only (global fetch).
// ---------------------------------------------------------------------------------------------

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const EXIT_OK = 0, EXIT_FAIL = 1, EXIT_USAGE = 2;
const VERSION = 1;

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..'); // .../build/flauz/scripts -> repo root

// Pillar compiled-output rows (spec section 11.3: notebook/debug/remote start
// as compile-output greps - the B-POLICY canary A3 pattern; terminal/scm/
// palette/settings get the same honest weaker rung while the functional rows
// wait for the lane F driver). rel paths are under the compile root (out/).
// Markers are pinned to strings present in the pinned source files - if an
// upstream sync moves them, the row FAILs and the baseline gets updated in
// the same commit (sync-drift tripwire, the canary A3 semantics).
const PILLAR_COMPILE_ROWS = [
	{ row: 'pillar.terminal.compiled', rel: 'vs/workbench/contrib/terminal/browser/terminal.contribution.js', marker: 'TerminalMainContribution' },
	{ row: 'pillar.scm.compiled', rel: 'vs/workbench/contrib/scm/browser/scm.contribution.js', marker: /id:\s*['\"]scm['\"]/ },
	{ row: 'pillar.palette.compiled', rel: 'vs/workbench/contrib/quickaccess/browser/quickAccess.contribution.js', marker: 'CommandsQuickAccess' },
	{ row: 'pillar.settings.compiled', rel: 'vs/workbench/contrib/preferences/browser/preferences.contribution.js', marker: 'workbench.action.openSettings' },
	{ row: 'pillar.notebook.compiled', rel: 'vs/workbench/contrib/notebook/browser/notebook.contribution.js', marker: /id:\s*['\"]notebook['\"]/ },
	{ row: 'pillar.debug.compiled', rel: 'vs/workbench/contrib/debug/browser/debug.contribution.js', marker: /id:\s*['\"]debug['\"]/ },
	{ row: 'pillar.remote.compiled', rel: 'vs/platform/remote/common/remoteHosts.js', marker: 'parseAuthority' },
];

// Functional pillar rows the launch mechanism cannot honestly assert without
// a UI-automation driver (lane F session driver). Always SKIP in v1, with the
// exact reason - the census is part of the report, never a fake pass.
const PILLAR_FUNCTIONAL_SKIP_ROWS = [
	{ row: 'pillar.terminal.functional', reason: 'terminal panel create + shell execute needs UI automation (lane F session driver); not observable via CDP HTTP endpoints or captured logs' },
	{ row: 'pillar.scm.functional', reason: 'SCM view render + stage/commit flow needs UI automation and a git workspace; not observable via CDP HTTP endpoints or captured logs' },
	{ row: 'pillar.palette.functional', reason: 'command palette open + stock command execute needs UI automation; not observable via CDP HTTP endpoints or captured logs' },
	{ row: 'pillar.settings.functional', reason: 'settings editor open needs UI automation; not observable via CDP HTTP endpoints or captured logs' },
];

// Conservative fatal patterns for workbench.log-clean (the b-policy-canary
// 'Unresponsive|Fatal error' pair plus the source-pinned extension-host
// crash line and the node fatal class). Deliberately conservative: a smoke,
// not a log audit. --fatal-regex ADDS to this set, never replaces it.
const DEFAULT_FATAL_PATTERNS = ['Unresponsive', 'Fatal error', 'terminated unexpectedly', 'uncaught exception'];

const DEFAULT_EXT_HOST_REGEX = 'ExtensionService#_doActivateExtension|Eager extensions activated';
const DEFAULT_EXT_ACTIVATION_REGEX = 'ExtensionService#_doActivateExtension flauz\\.';
const DEFAULT_EXT_ID_REGEX = 'ExtensionService#_doActivateExtension (flauz\\.flauz-[\\w-]+)';

const rows = [];

class UsageError extends Error { }

function usage() {
	process.stdout.write(`compat-l3-smoke.mjs - Code OSS compatibility battery, layer 3 (TL4-008)

Usage:
	node compat-l3-smoke.mjs [flags]

	--cdp-port <n>        attach mode: CDP port of the booted workbench
	--http-url <u>        attach mode: workbench HTTP endpoint
	--log <file>          boot log to scan (repeatable)
	--log-dir <dir>       log directory to scan (repeatable)
	--compile-root <dir>  compiled out/ tree to verify pillar rows against
	--cmd <path>          child mode: launch the subject process group
	--arg <v>             child argv entry (repeatable, with --cmd)
	--cwd <dir>           child working directory (with --cmd)
	--env <K=V>           child environment entry (repeatable)
	--target-regex <re>   CDP target filter
	--boot-timeout <ms>   workbench boot timeout
	--settle-timeout <ms> row settle timeout
	--fatal-regex <re>    fatal log pattern (repeatable)
	--require             exit 1 on FAIL rows (default: report-only)
	--json                JSON report to stdout
	--out <path>          write JSON report to path
	--no-fail             report-only (always exit 0)

Modes: attach (CI - the harness launched the workbench, the driver takes the
coordinates) or child (--cmd - the driver launches the subject, owns the
process group and evaluates the natural exit code).

Rows: boot.cdp-reachable, boot.workbench-target, boot.http-reachable,
boot.exit-clean, workbench.log-clean, ext.host-started, ext.flauz-activated,
pillar.<terminal|scm|palette|settings|notebook|debug|remote>.compiled,
pillar.<terminal|scm|palette|settings>.functional (SKIP until the lane F
driver - an unobservable row is SKIP with its reason, never a fake pass).

Exit codes: 0 pass/SKIP-only (or --no-fail) - 1 divergence - 2 usage.
Spec: docs/FLAUZ-PROGRAM/TL4-COMPAT-BATTERY.md section 11
Baseline: build/flauz/compat-l3-baseline.md
`);
}

// ---------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------

function addRow(id, status, detail) {
	rows.push({ id, status, detail });
}

function parseMs(flagName, raw, fallback) {
	if (raw === undefined) { return fallback; }
	const n = Number(raw);
	if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
		throw new UsageError(`--${flagName} must be a non-negative integer of milliseconds (got '${raw}')`);
	}
	return n;
}

function compileRegex(flagName, raw, flags) {
	try {
		return new RegExp(raw, flags);
	} catch (e) {
		throw new UsageError(`--${flagName} is not a valid regular expression: ${e.message}`);
	}
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchJson(url, timeoutMs) {
	return fetch(url, { signal: AbortSignal.timeout(timeoutMs) }).then(async (res) => {
		if (!res.ok) {
			throw new Error(`HTTP ${res.status}`);
		}
		return { status: res.status, body: await res.json() };
	});
}

// Recursive *.log walk (no fs.readdirSync recursive: keeps node >= 20.0 usable).
function walkLogs(dir, base, out) {
	let entries;
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch (e) {
		out.push({ path: dir, error: `cannot read directory: ${e.message}` });
		return;
	}
	for (const ent of entries) {
		const p = path.join(dir, ent.name);
		if (ent.isDirectory()) { walkLogs(p, base, out); }
		else if (ent.isFile() && ent.name.endsWith('.log')) { out.push({ path: p }); }
	}
}

// Build the log corpus: explicit files + recursive *.log under --log-dir, deduped.
function readCorpus(logFiles, logDirs) {
	const seen = new Set();
	const entries = [];
	const addFile = (p) => {
		const key = path.resolve(p);
		if (seen.has(key)) { return; }
		seen.add(key);
		let text;
		try {
			text = fs.readFileSync(p, 'utf8');
		} catch (e) {
			entries.push({ path: key, error: `cannot read: ${e.message}` });
			return;
		}
		entries.push({ path: key, text, bytes: Buffer.byteLength(text) });
	};
	for (const dir of logDirs) {
		const found = [];
		walkLogs(path.resolve(dir), dir, found);
		for (const f of found) {
			if (f.error !== undefined) { entries.push({ path: f.path, error: f.error }); continue; }
			addFile(f.path);
		}
	}
	for (const file of logFiles) { addFile(file); }
	return entries;
}

function corpusStats(entries) {
	const readable = entries.filter((e) => e.text !== undefined);
	const bytes = readable.reduce((n, e) => n + (e.bytes ?? 0), 0);
	return { wired: entries.length, readable: readable.length, bytes };
}

function findMarker(entries, re) {
	for (const e of entries) {
		if (e.text === undefined) { continue; }
		const lines = e.text.split('\n');
		for (let i = 0; i < lines.length; i++) {
			if (re.test(lines[i])) { return { file: e.path, line: i + 1, text: lines[i].slice(0, 200) }; }
		}
	}
	return null;
}

function collectIds(entries, re) {
	const ids = new Set();
	for (const e of entries) {
		if (e.text === undefined) { continue; }
		for (const m of e.text.matchAll(re)) { if (m[1]) { ids.add(m[1]); } }
	}
	return [...ids].sort();
}

function scanFatal(entries, patterns) {
	const hits = [];
	for (const e of entries) {
		if (e.text === undefined) { continue; }
		const lines = e.text.split('\n');
		for (let i = 0; i < lines.length; i++) {
			for (const re of patterns) {
				if (re.test(lines[i])) { hits.push({ file: e.path, line: i + 1, pattern: re.source, text: lines[i].slice(0, 200) }); }
			}
		}
	}
	return hits;
}

// ---------------------------------------------------------------------------------------------
// child mode
// ---------------------------------------------------------------------------------------------

function waitForExit(child, ms) {
	return new Promise((resolve) => {
		const t = setTimeout(() => resolve({ timeout: true }), ms);
		child.once('exit', (code, signal) => { clearTimeout(t); resolve({ code, signal }); });
	});
}

function killGroup(pid, signal) {
	// detached spawn put the child in its own process group: -pid reaches the
	// whole tree (workbench main + renderer + extension host).
	try { process.kill(-pid, signal); return true; } catch { /* group gone */ }
	try { process.kill(pid, signal); return true; } catch { /* process gone */ }
	return false;
}

// ---------------------------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------------------------

async function run(parsed) {
	const v = parsed.values;

	// ---- resolve channels (flags first, then FLAUZ_L3_* env fallbacks) ----
	const cdpPort = v['cdp-port'] ?? process.env.FLAUZ_L3_CDP_PORT ?? null;
	const httpUrl = v['http-url'] ?? process.env.FLAUZ_L3_HTTP_URL ?? null;
	const logFiles = [...(v.log ?? [])];
	const envLog = process.env.FLAUZ_L3_LOG;
	if (envLog !== undefined && envLog !== '') { logFiles.push(envLog); }
	const logDirs = [...(v['log-dir'] ?? [])];
	const envLogDir = process.env.FLAUZ_L3_LOG_DIR;
	if (envLogDir !== undefined && envLogDir !== '') { logDirs.push(envLogDir); }

	let compileRoot = null;
	let compileRootExplicit = false;
	const compileRootSpec = v['compile-root'] ?? process.env.FLAUZ_L3_COMPILE_ROOT ?? null;
	if (compileRootSpec !== null) {
		compileRoot = path.resolve(compileRootSpec);
		compileRootExplicit = true;
	} else {
		const def = path.join(SCRIPT_REPO_ROOT, 'out');
		if (fs.existsSync(def) && fs.statSync(def).isDirectory()) { compileRoot = def; }
	}

	const childCfg = v.cmd !== undefined ? {
		cmd: v.cmd,
		args: [...(v.arg ?? [])],
		cwd: v.cwd !== undefined ? path.resolve(v.cwd) : process.cwd(),
		env: (() => {
			const env = { ...process.env };
			for (const pair of v.env ?? []) {
				const eq = pair.indexOf('=');
				if (eq <= 0) { throw new UsageError(`--env expects K=V (got '${pair}')`); }
				env[pair.slice(0, eq)] = pair.slice(eq + 1);
			}
			return env;
		})(),
	} : (process.env.FLAUZ_L3_CMD !== undefined ? { cmd: process.env.FLAUZ_L3_CMD, args: [], cwd: process.cwd(), env: { ...process.env } } : null);

	if (childCfg !== null && v.cwd !== undefined && (!fs.existsSync(childCfg.cwd) || !fs.statSync(childCfg.cwd).isDirectory())) {
		throw new UsageError(`--cwd '${childCfg.cwd}' is not a directory`);
	}

	// ---- patterns ----
	const bootTimeout = parseMs('boot-timeout', v['boot-timeout'] ?? process.env.FLAUZ_L3_BOOT_TIMEOUT_MS, 60000);
	const settleTimeout = parseMs('settle-timeout', v['settle-timeout'] ?? process.env.FLAUZ_L3_SETTLE_TIMEOUT_MS, 30000);
	const pollInterval = parseMs('poll-interval', v['poll-interval'], 500);
	const killTimeout = parseMs('kill-timeout', v['kill-timeout'], 10000);
	if (pollInterval < 50) { throw new UsageError('--poll-interval must be >= 50 ms (tight loops starve the runner)'); }

	const targetRegex = compileRegex('target-regex', v['target-regex'] ?? 'workbench', 'i');
	const extHostRegex = compileRegex('ext-host-regex', v['ext-host-regex'] ?? DEFAULT_EXT_HOST_REGEX, '');
	const extActivationRegex = compileRegex('ext-activation-regex', v['ext-activation-regex'] ?? DEFAULT_EXT_ACTIVATION_REGEX, '');
	const extIdRegex = new RegExp(DEFAULT_EXT_ID_REGEX, 'g');
	const fatalPatterns = [...DEFAULT_FATAL_PATTERNS.map((p) => new RegExp(p, 'i')), ...(v['fatal-regex'] ?? []).map((p) => compileRegex('fatal-regex', p, 'i'))];

	let cdp = null;
	if (cdpPort !== null) {
		if (!/^\d+$/.test(String(cdpPort))) { throw new UsageError(`--cdp-port must be an integer port (got '${cdpPort}')`); }
		const port = Number(cdpPort);
		if (port < 1 || port > 65535) { throw new UsageError(`--cdp-port out of range (got ${port})`); }
		cdp = { host: v['cdp-host'] ?? '127.0.0.1', port };
	}

	// ---- the --require CI contract ----
	if (v.require && cdp === null && httpUrl === null && childCfg === null) {
		throw new UsageError('--require demands a live boot channel (--cdp-port | --http-url | --cmd): refusing to SKIP-pass a gate that observed no boot (logs/compile output alone are not a boot observation)');
	}

	const mode = childCfg !== null ? 'child' : 'attach';
	const startedAt = Date.now();

	// ---- launch the subject (child mode) ----
	let child = null;
	let childExit = null;      // { code, signal } once the child is gone
	let childError = null;     // spawn failure (ENOENT etc.)
	let childCapture = null;   // { stdout, stderr } capture paths (auto-wired corpus)
	let shutdownStarted = false;
	if (childCfg !== null) {
		const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compat-l3-'));
		childCapture = { stdout: path.join(runDir, 'child-out.log'), stderr: path.join(runDir, 'child-err.log') };
		const outFd = fs.openSync(childCapture.stdout, 'a');
		const errFd = fs.openSync(childCapture.stderr, 'a');
		try {
			child = spawn(childCfg.cmd, childCfg.args, { cwd: childCfg.cwd, env: childCfg.env, detached: true, stdio: ['ignore', outFd, errFd] });
		} finally {
			fs.closeSync(outFd);
			fs.closeSync(errFd);
		}
		child.once('exit', (code, signal) => { childExit = { code, signal }; });
		child.once('error', (err) => { childError = err; });
	}

	// ---- readiness ----
	let cdpVersion = null;
	let cdpTargets = null;
	let cdpFailure = null;
	if (cdp !== null) {
		const base = `http://${cdp.host}:${cdp.port}`;
		const deadline = Date.now() + bootTimeout;
		let attempts = 0;
		while (Date.now() < deadline) {
			if (child !== null && childExit !== null) {
				cdpFailure = `subject exited (code ${childExit.code}, signal ${childExit.signal ?? 'none'}) before the endpoint answered`;
				break;
			}
			if (child !== null && childError !== null) {
				cdpFailure = `failed to spawn '${childCfg.cmd}': ${childError.message}`;
				break;
			}
			attempts += 1;
			try {
				const r = await fetchJson(`${base}/json/version`, Math.max(2000, pollInterval * 2));
				cdpVersion = r.body;
				cdpFailure = null; // a late answer wins over an earlier timeout note
				break;
			} catch (e) {
				if (Date.now() + pollInterval >= deadline) { cdpFailure = `no response from ${base}/json/version within ${bootTimeout} ms (${attempts} attempt(s): ${e.message})`; }
				else { await sleep(pollInterval); }
			}
		}
		if (Date.now() >= deadline && cdpVersion === null && cdpFailure === null) {
			cdpFailure = `no response from ${base}/json/version within ${bootTimeout} ms (${attempts} attempt(s))`;
		}
		if (cdpVersion !== null) {
			try {
				const r = await fetchJson(`${base}/json/list`, Math.max(2000, pollInterval * 2));
				cdpTargets = Array.isArray(r.body) ? r.body : [];
			} catch (e) {
				cdpTargets = { error: e.message };
			}
		}
	}

	let httpOk = null;
	if (httpUrl !== null) {
		const deadline = Date.now() + bootTimeout;
		let attempts = 0;
		let lastErr = 'no attempt';
		while (Date.now() < deadline) {
			if (child !== null && childExit !== null) {
				lastErr = `subject exited (code ${childExit.code}, signal ${childExit.signal ?? 'none'}) before the URL answered`;
				break;
			}
			attempts += 1;
			try {
				const res = await fetch(httpUrl, { signal: AbortSignal.timeout(Math.max(2000, pollInterval * 2)) });
				if (res.ok) { httpOk = { status: res.status }; break; }
				lastErr = `HTTP ${res.status}`;
			} catch (e) {
				lastErr = e.message;
			}
			if (Date.now() + pollInterval < deadline) { await sleep(pollInterval); }
		}
		if (httpOk === null) { httpOk = { failure: `${httpUrl}: ${lastErr} (${attempts} attempt(s) within ${bootTimeout} ms)` }; }
	}

	// child mode with no readiness channel: the boot phase is the natural-exit
	// wait itself (fixture stubs exit on their own; a real workbench holds until
	// boot-timeout, then the shutdown path takes over).
	if (child !== null && cdp === null && httpUrl === null) {
		const r = await waitForExit(child, bootTimeout);
		if (r.timeout !== true) { childExit = { code: r.code, signal: r.signal }; }
	}

	// ---- settle: wait for extension-activation markers in the corpus ----
	const corpusFiles = () => {
		const files = [...logFiles];
		const dirs = [...logDirs];
		if (childCapture !== null) { files.push(childCapture.stdout, childCapture.stderr); }
		return { files, dirs };
	};
	const settled = { host: false, activation: false };
	{
		const { files, dirs } = corpusFiles();
		const wired = files.length + dirs.length;
		if (wired > 0) {
			const deadline = Date.now() + settleTimeout;
			while (Date.now() < deadline) {
				const entries = readCorpus(files, dirs);
				settled.host = findMarker(entries, extHostRegex) !== null;
				settled.activation = findMarker(entries, extActivationRegex) !== null;
				if (settled.host && settled.activation) { break; }
				if (child !== null && childExit !== null) { break; } // subject gone: no point waiting
				await sleep(pollInterval);
			}
		}
	}

	// ---- shut the child down (always, even on failure) ----
	if (child !== null && childExit === null && childError === null) {
		shutdownStarted = true;
		killGroup(child.pid, 'SIGTERM');
		const r = await waitForExit(child, killTimeout);
		if (r.timeout === true) {
			killGroup(child.pid, 'SIGKILL');
			await waitForExit(child, 5000);
		}
	}

	// ---- final corpus (post-shutdown: the log is the evidence artifact) ----
	const { files: finalFiles, dirs: finalDirs } = corpusFiles();
	const corpus = readCorpus(finalFiles, finalDirs);
	const stats = corpusStats(corpus);
	const corpusWired = logFiles.length + logDirs.length + (childCapture !== null ? 2 : 0);

	// ---- rows ----
	if (cdp === null) {
		addRow('boot.cdp-reachable', 'SKIP', 'no CDP endpoint wired (attach: --cdp-port; the workbench launches with --remote-debugging-port)');
		addRow('boot.workbench-target', 'SKIP', 'no CDP endpoint wired');
	} else if (cdpFailure !== null) {
		addRow('boot.cdp-reachable', 'FAIL', cdpFailure);
		addRow('boot.workbench-target', 'FAIL', `no CDP endpoint (see boot.cdp-reachable)`);
	} else {
		addRow('boot.cdp-reachable', 'PASS', `http://${cdp.host}:${cdp.port}/json/version answered (Browser: ${cdpVersion?.Browser ?? 'unknown'})`);
		if (cdpTargets === null) {
			addRow('boot.workbench-target', 'SKIP', 'cdp reachable but /json/list not fetched (internal ordering)');
		} else if (cdpTargets.error !== undefined) {
			addRow('boot.workbench-target', 'FAIL', `/json/list request failed: ${cdpTargets.error}`);
		} else {
			const match = cdpTargets.find((t) => t && t.type === 'page' && targetRegex.test(String(t.url ?? '')));
			if (match !== undefined) {
				addRow('boot.workbench-target', 'PASS', `${cdpTargets.length} target(s); page match ${match.url}`);
			} else {
				const urls = cdpTargets.map((t) => `${t?.type ?? '?'}:${t?.url ?? ''}`).join(', ');
				addRow('boot.workbench-target', 'FAIL', `no page target matching /${targetRegex.source}/i among ${cdpTargets.length} target(s): ${urls || '(empty list)'}`);
			}
		}
	}

	if (httpUrl === null) {
		addRow('boot.http-reachable', 'SKIP', 'no --http-url wired');
	} else if (httpOk.failure !== undefined) {
		addRow('boot.http-reachable', 'FAIL', httpOk.failure);
	} else {
		addRow('boot.http-reachable', 'PASS', `${httpUrl} answered HTTP ${httpOk.status}`);
	}

	if (childCfg === null) {
		addRow('boot.exit-clean', 'SKIP', 'attach mode: the workbench process belongs to the harness (killed by the CI job for artifact capture); a natural exit code is only observable in --cmd child mode');
	} else if (childError !== null) {
		addRow('boot.exit-clean', 'FAIL', `failed to spawn '${childCfg.cmd}': ${childError.message}`);
	} else if (childExit === null) {
		addRow('boot.exit-clean', 'FAIL', `no exit recorded for the child (internal error)`);
	} else if (childExit.code === 0) {
		addRow('boot.exit-clean', 'PASS', `natural exit 0${shutdownStarted ? ' (after driver SIGTERM)' : ''}`);
	} else if (childExit.code !== null) {
		addRow('boot.exit-clean', 'FAIL', `exited ${childExit.code}${shutdownStarted ? ' (after driver SIGTERM)' : ''}`);
	} else {
		addRow('boot.exit-clean', 'FAIL', `terminated by signal ${childExit.signal ?? 'unknown'}${shutdownStarted ? ' (driver-initiated shutdown; exit-clean requires a natural exit 0 - graceful quit via CDP is on the distance list)' : ''}`);
	}

	if (corpusWired === 0) {
		addRow('workbench.log-clean', 'SKIP', 'no captured log wired (--log / --log-dir; in --cmd mode the child captures auto-wire)');
	} else {
		const errors = corpus.filter((e) => e.error !== undefined);
		if (stats.readable === 0) {
			addRow('workbench.log-clean', 'FAIL', `${corpusWired} log path(s) wired but none readable: ${errors.map((e) => `${e.path} (${e.error})`).join('; ')}`);
		} else {
			const hits = scanFatal(corpus, fatalPatterns);
			const note = errors.length > 0 ? ` [${errors.length} path(s) unreadable]` : '';
			if (hits.length > 0) {
				addRow('workbench.log-clean', 'FAIL', `${hits.length} fatal pattern hit(s)${note}: ${hits.slice(0, 5).map((h) => `${path.basename(h.file)}:${h.line} /${h.pattern}/ ${h.text}`).join(' | ')}${hits.length > 5 ? ` | ... and ${hits.length - 5} more` : ''}`);
			} else {
				addRow('workbench.log-clean', 'PASS', `${stats.readable} file(s), ${stats.bytes} byte(s) scanned, 0 fatal pattern hit(s)${note}`);
			}
		}
	}

	const extSkip = () => 'no captured log wired - extension-host markers are log observations';
	if (corpusWired === 0) {
		addRow('ext.host-started', 'SKIP', extSkip());
		addRow('ext.flauz-activated', 'SKIP', extSkip());
	} else if (stats.readable === 0) {
		addRow('ext.host-started', 'FAIL', `log corpus wired but unreadable (${stats.wired} path(s)) - cannot assert extension-host startup`);
		addRow('ext.flauz-activated', 'FAIL', `log corpus wired but unreadable (${stats.wired} path(s)) - cannot assert flauz activation`);
	} else {
		const hostHit = findMarker(corpus, extHostRegex);
		if (hostHit !== null) {
			addRow('ext.host-started', 'PASS', `${path.basename(hostHit.file)}:${hostHit.line} '${hostHit.text.trim()}'`);
		} else {
			addRow('ext.host-started', 'FAIL', `no line matching /${extHostRegex.source}/ in ${stats.readable} file(s), ${stats.bytes} byte(s) - the extension host either did not start or its log was not captured`);
		}
		const activatedIds = collectIds(corpus, extIdRegex);
		if (activatedIds.length > 0) {
			addRow('ext.flauz-activated', 'PASS', `activation record(s): ${activatedIds.join(', ')}`);
		} else {
			addRow('ext.flauz-activated', 'FAIL', `no 'ExtensionService#_doActivateExtension flauz.*' record in ${stats.readable} file(s), ${stats.bytes} byte(s) - the flauz built-ins did not activate at runtime (L3 positive control)`);
		}
	}

	if (compileRoot === null) {
		for (const p of PILLAR_COMPILE_ROWS) {
			addRow(p.row, 'SKIP', `no compiled output (default ${path.join(SCRIPT_REPO_ROOT, 'out')} absent and no --compile-root; workers never build - the CI lane compiles first)`);
		}
	} else if (!fs.existsSync(compileRoot) || !fs.statSync(compileRoot).isDirectory()) {
		for (const p of PILLAR_COMPILE_ROWS) {
			addRow(p.row, 'FAIL', `compile root '${compileRoot}' does not exist (wired ${compileRootExplicit ? 'explicitly via --compile-root' : 'as the default'})`);
		}
	} else {
		for (const p of PILLAR_COMPILE_ROWS) {
			const file = path.join(compileRoot, p.rel);
			if (!fs.existsSync(file)) {
				addRow(p.row, 'FAIL', `missing ${p.rel} under ${compileRoot} (upstream drift or incomplete compile)`);
				continue;
			}
			let text;
			try {
				text = fs.readFileSync(file, 'utf8');
			} catch (e) {
				addRow(p.row, 'FAIL', `cannot read ${p.rel}: ${e.message}`);
				continue;
			}
			const found = typeof p.marker === 'string' ? text.includes(p.marker) : p.marker.test(text);
			if (!found) {
				addRow(p.row, 'FAIL', `${p.rel} exists but marker '${p.marker}' absent (upstream drift)`);
			} else {
				addRow(p.row, 'PASS', `${p.rel} (marker '${p.marker}' present)`);
			}
		}
	}

	for (const p of PILLAR_FUNCTIONAL_SKIP_ROWS) {
		addRow(p.row, 'SKIP', p.reason);
	}

	// ---- verdict ----
	const counts = { PASS: 0, FAIL: 0, SKIP: 0 };
	for (const r of rows) { counts[r.status] += 1; }
	let exit = counts.FAIL > 0 ? EXIT_FAIL : EXIT_OK;
	if (v['no-fail']) { exit = EXIT_OK; }

	const meta = {
		tool: 'compat-l3-smoke',
		version: VERSION,
		date: new Date().toISOString(),
		mode,
		channels: {
			cdp: cdp === null ? null : `${cdp.host}:${cdp.port}`,
			http: httpUrl,
			child: childCfg === null ? null : { cmd: childCfg.cmd, args: childCfg.args, cwd: childCfg.cwd },
			logs: logFiles,
			logDirs,
			childCaptures: childCapture,
			compileRoot: compileRoot === null ? null : { dir: compileRoot, explicit: compileRootExplicit },
		},
		patterns: {
			fatal: fatalPatterns.map((re) => re.source),
			extHost: extHostRegex.source,
			extActivation: extActivationRegex.source,
			target: targetRegex.source,
		},
		timings: { bootTimeout, settleTimeout, pollInterval, killTimeout, elapsedMs: Date.now() - startedAt },
		settled,
		counts,
		verdict: counts.FAIL > 0 ? 'FAIL' : 'PASS',
		rows,
	};

	if (v.out !== undefined) {
		const outPath = path.resolve(v.out);
		fs.mkdirSync(path.dirname(outPath), { recursive: true });
		fs.writeFileSync(outPath, `${JSON.stringify(meta, null, '\t')}\n`);
	}

	if (v.json) {
		process.stdout.write(`${JSON.stringify(meta, null, '\t')}\n`);
	} else {
		const out = [];
		out.push(`compat-l3-smoke: L3 runtime boot smoke (TL4-008) - ${mode} mode`);
		out.push(`  channels: cdp=${meta.channels.cdp ?? '-'} http=${meta.channels.http ?? '-'} child=${meta.channels.child ? meta.channels.child.cmd : '-'} logs=${logFiles.length + logDirs.length} compileRoot=${meta.channels.compileRoot ? meta.channels.compileRoot.dir : '-'}`);
		for (const r of rows) {
			out.push(`  ${r.status}  ${r.id}  ${r.detail}`);
		}
		out.push(`compat-l3-smoke: verdict: ${rows.length} rows - ${counts.PASS} PASS, ${counts.FAIL} FAIL, ${counts.SKIP} SKIP - ${counts.FAIL > 0 ? 'FAIL (divergence - see rows above)' : 'PASS (boot smoke observations hold)'}` + (v['no-fail'] ? ' [--no-fail: exit suppressed]' : ''));
		process.stdout.write(`${out.join('\n')}\n`);
	}
	return exit;
}

function main() {
	let parsed;
	try {
		parsed = parseArgs({
			allowPositionals: false,
			options: {
				help: { type: 'boolean', default: false, short: 'h' },
				'cdp-port': { type: 'string' },
				'cdp-host': { type: 'string' },
				'http-url': { type: 'string' },
				log: { type: 'string', multiple: true },
				'log-dir': { type: 'string', multiple: true },
				'compile-root': { type: 'string' },
				cmd: { type: 'string' },
				arg: { type: 'string', multiple: true },
				cwd: { type: 'string' },
				env: { type: 'string', multiple: true },
				'target-regex': { type: 'string' },
				'boot-timeout': { type: 'string' },
				'settle-timeout': { type: 'string' },
				'poll-interval': { type: 'string' },
				'kill-timeout': { type: 'string' },
				'ext-host-regex': { type: 'string' },
				'ext-activation-regex': { type: 'string' },
				'fatal-regex': { type: 'string', multiple: true },
				require: { type: 'boolean', default: false },
				json: { type: 'boolean', default: false },
				out: { type: 'string' },
				'no-fail': { type: 'boolean', default: false },
			},
		});
	} catch (e) {
		process.stderr.write(`compat-l3-smoke: ${e.message}\n`);
		usage();
		process.exit(EXIT_USAGE);
	}
	if (parsed.values.help) { usage(); process.exit(EXIT_OK); }

	run(parsed).then((code) => process.exit(code), (e) => {
		if (e instanceof UsageError) {
			process.stderr.write(`compat-l3-smoke: ${e.message}\n`);
			process.exit(EXIT_USAGE);
		}
		process.stderr.write(`compat-l3-smoke: internal error: ${e && e.stack ? e.stack : e}\n`);
		process.exit(EXIT_USAGE);
	});
}

main();
