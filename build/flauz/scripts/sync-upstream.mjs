/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// ---------------------------------------------------------------------------------------------
// Flauz TL1 (substrate / upstream compatibility / product integration) — Worker A,
// work order TL1-001: the deterministic upstream-sync lane.
//
// sync-upstream.mjs — the upstream Code OSS reference line vs the Flauz product
// line, as DATA. Two modes:
//
//   --report  the delta census of HEAD vs the preserved upstream reference
//             (default base upstream/main, resolved with the fallback chain
//             upstream/main -> origin/upstream/main; NEVER a product branch —
//             comparing product-vs-product would vacuously pass):
//               - per-file name-status (direct tree comparison of the two
//                 refs, the compat-battery semantics: a path present
//                 upstream but absent on head reads as DELETED — after
//                 absorbing upstream that is exactly the "product removed an
//                 upstream file" regression signal; while behind > 0 it also
//                 lists not-yet-absorbed upstream paths, cross-read with the
//                 behind count), classified
//                   ADDED                    — new flauz-owned paths (the
//                                             additive-placement namespace,
//                                             ARCHITECTURE-LOCK sections 4/6), or
//                   MODIFIED/DELETED/RENAMED— shared upstream files: the
//                                             FORK-CRITICAL class. Every such
//                                             row must be covered by the
//                                             intentional-divergence allowlist
//                                             (build/flauz/sync-allowlist.json,
//                                             same pattern as compat-allowlist
//                                             .json: {path, reason, date}) or
//                                             the report FAILS;
//               - per-top-level-directory rollup;
//               - ahead/behind commit counts;
//               - the src/vs pristine assertion, re-derived with git plumbing
//                 (git diff --name-only base...head -- src/vs
//                 ':(exclude)src/vs/workbench/contrib/flauz' must be EMPTY —
//                 the same three-dot + pathspec semantics fork-critical-guard
//                 .sh uses; this is the REPORT, the guard stays the GATE);
//               - the flauz/main compatibility-alias lag note;
//               - exit 1 when shared-file divergence exists unless --no-fail.
//
//   --plan    the sync plan for MERGING upstream/main INTO main (never rebase
//             product history):
//               - ahead/behind commit counts;
//               - dry-run conflict detection via `git merge-tree --write-tree`
//                 (git >= 2.38; availability probed, honest documented
//                 fallback: the both-sides-touched intersection = conflict
//                 CANDIDATES, superset, no content-level detection);
//               - the conflict path list with both-sides classification
//                 (what each side did to the path vs the merge-base);
//               - the canary trigger list (C-20/23/24/28, README job 4);
//               - the checkpoint tag name flauz/sync/<date> (README job 6);
//               - the DECISION-LOG diff reminder (README job 6).
//             Conflicts are DATA here, not failure: exit 0 whenever a plan was
//             produced. Only an internal git failure degrades the exit (1).
//
// Options:
//   --report | --plan     exactly one mode (required).
//   --base <ref>          report base (default upstream/main).
//   --head <ref>          head side (default HEAD).
//   --target <ref>        plan merge source (default upstream/main).
//   --repo <dir>          repository to operate on (default: the repo
//                         containing this script).
//   --allowlist <file>    intentional shared-file divergence allowlist
//                         (default <repo>/build/flauz/sync-allowlist.json).
//   --json                machine output (JSON) on stdout — nothing else.
//   --out <path>          additionally write the human/markdown report
//                         document (the committed build/flauz/
//                         UPSTREAM-DELTA.md is this output).
//   --no-fail             informational run: report divergence but exit 0
//                         (the CI artifact job shape).
//   --help                this text.
//
// Exit codes (house table):
//   0  clean or SKIP (empty census / --no-fail informational run / plan produced)
//   1  divergence — unallowlisted shared-file modification/deletion/rename,
//      an added path outside the flauz namespace, or a non-pristine src/vs
//      assertion (plan mode: internal git failure)
//   2  usage error / unresolvable ref / malformed allowlist
//
// Skip-vs-fail policy: an empty census (head tree identical to base tree) is
// a documented SKIP, exit 0 — the gate has nothing to check.
//
// Growing the flauz-owned additive namespace (or allowlisting a new shared
// file) is a RECORDED decision (work-registry note + rationale in the
// allowlist entry), never a silent edit to this file's tables.
//
// Zero dependencies: node >= 20 stdlib only. Never npm install to run this.
// ---------------------------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const EXIT_OK = 0, EXIT_FAIL = 1, EXIT_USAGE = 2;

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..'); // build/flauz/scripts -> repo root

const DEFAULT_BASE = 'upstream/main';
const DEFAULT_ALLOWLIST_REL = 'build/flauz/sync-allowlist.json';

// The flauz-owned additive-placement namespace (ARCHITECTURE-LOCK sections 4/6). The
// product line may ADD under these path prefixes without failing the report.
// Anything added OUTSIDE them is flagged (exit 1) until the placement decision
// is recorded. Prefix set derived from the actual product tree at the TL4
// wave-1 merge point — extend only with a recorded decision.
const FLAUZ_ADDITIVE_PATH_RES = [
	/^extensions\/flauz-[^/]+\//,          // the six Flauz built-in extensions
	/^build\/flauz\//,                     // product packaging, gates, canaries, budgets (this tool's home)
	/^test\/fixtures\//,                   // contract and conformance fixtures
	/^docs\/FLAUZ-PROGRAM\//,              // the authoritative program control plane
	/^docs\/FLAUZ-[^/]+\.md$/,             // top-level Flauz handoff documents
	/^\.github\/workflows\/flauz-/,        // the flauz-* CI jobs
	/^product\.flauz\.json$/,              // the product overlay (repo root)
	/^FLAUZ-START-HERE\.md$/,              // the start-here doc (repo root)
	/^flauz-delivery\//,                   // lane transit-staging reports
	/^src\/vs\/workbench\/contrib\/flauz\//, // F-01 escape hatch: the ONE additive src/vs dir (currently unused; guard excludes exactly this)
];

// Canary triggers at EVERY upstream sync (build/flauz/README.md job 4; DL-11).
const SYNC_CANARIES = [
	{ id: 'C-20', job: 'c20-default-agent', spec: 'build/flauz/canaries/C-20.md' },
	{ id: 'C-23', job: 'c23-parallel-sessions', spec: 'build/flauz/canaries/C-23.md' },
	{ id: 'C-24', job: 'c24-subagents-steering', spec: 'build/flauz/canaries/C-24.md' },
	{ id: 'C-28', job: 'c28-browser-tools', spec: 'build/flauz/canaries/C-28.md' },
];
const CANARIES_WORKFLOW = '.github/workflows/flauz-canaries.yml';

class UsageError extends Error { }

function usage() {
	process.stdout.write(`sync-upstream.mjs — deterministic upstream-sync lane (TL1-001)

Usage:
	node sync-upstream.mjs --report [--base <ref=upstream/main>] [--head <ref=HEAD>] [--json] [--out <path>] [--no-fail]
	node sync-upstream.mjs --plan   [--target <ref=upstream/main>] [--head <ref=HEAD>] [--json] [--out <path>]
	node sync-upstream.mjs --help

Common options:
	--repo <dir>        repository to operate on (default: the repo containing this script)
	--allowlist <file>  intentional shared-file divergence allowlist (default <repo>/build/flauz/sync-allowlist.json)

Base/target refs resolve with the fallback chain upstream/main ->
origin/upstream/main (the preserved Code OSS reference line — never a product
branch). --report: exit 0 clean/SKIP, 1 shared-file divergence (unless
--no-fail), 2 usage. --plan: exit 0 whenever a plan was produced (conflicts
are DATA), 1 internal git failure, 2 usage.

Documented procedure: build/flauz/SYNC-RUNBOOK.md. Committed census:
build/flauz/UPSTREAM-DELTA.md (regenerate with --report --out).
`);
}

// ---------------------------------------------------------------------------------------------
// git plumbing helpers
// ---------------------------------------------------------------------------------------------

let REPO = '';

function git(args, opts = {}) {
	const r = spawnSync('git', ['-C', REPO, '-c', 'core.quotePath=false', ...args], {
		encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts,
	});
	return { ok: r.status === 0, status: r.status, out: (r.stdout || ''), err: (r.stderr || '') };
}

// Resolve a ref for the reference line: as-is, then origin/<ref>. Returns
// { ref, sha } or null (never falls back to a product branch like main).
function resolveRef(ref) {
	for (const candidate of [ref, `origin/${ref}`]) {
		const r = git(['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`]);
		if (r.ok && r.out.trim()) {
			return { ref: candidate, sha: r.out.trim() };
		}
	}
	return null;
}

// Resolve any ref (head side may legitimately be a product branch).
function resolveAnyRef(ref) {
	const r = git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
	return r.ok && r.out.trim() ? { ref, sha: r.out.trim() } : null;
}

function countCommits(from, to) {
	// commits reachable from <to> but not from <from>
	const r = git(['rev-list', '--count', `${from}..${to}`]);
	return r.ok ? Number.parseInt(r.out.trim(), 10) : null;
}

// name-status census with rename detection, restricted to an optional pathspec.
function diffNameStatus(fromRef, toRef, pathspec) {
	const args = ['diff', '--name-status', '-M', '--no-color', fromRef, toRef];
	if (pathspec && pathspec.length > 0) { args.push('--', ...pathspec); }
	const r = git(args);
	if (!r.ok) { throw new Error(`git diff --name-status ${fromRef} ${toRef} failed: ${r.err.trim()}`); }
	const rows = [];
	for (const line of r.out.split('\n')) {
		if (!line) { continue; }
		const cols = line.split('\t');
		const status = cols[0];
		if (status.startsWith('R') || status.startsWith('C')) {
			rows.push({ status: status[0], path: cols[2], oldPath: cols[1] });
		} else {
			rows.push({ status, path: cols[1] });
		}
	}
	return rows;
}

// The src/vs pristine assertion — the exact three-dot + pathspec semantics of
// fork-critical-guard.sh, re-derived here with git plumbing (this is the
// REPORT; the guard remains the GATE).
function pristineAssertion(baseRef, headRef) {
	const r = git([
		'diff', '--name-only', '--no-color', `${baseRef}...${headRef}`,
		'--', 'src/vs', ':(exclude)src/vs/workbench/contrib/flauz',
	]);
	if (!r.ok) { throw new Error(`pristine assertion diff failed: ${r.err.trim()}`); }
	const paths = r.out.split('\n').filter(Boolean);
	return { pristine: paths.length === 0, paths };
}

// Probe `git merge-tree --write-tree` availability (git >= 2.38).
function mergeTreeAvailable(headSha) {
	const r = git(['merge-tree', '--write-tree', '--name-only', headSha, headSha]);
	return r.ok;
}

// Dry-run the merge of <targetRef> INTO <headRef>. Returns
// { available, clean, tree, conflictedPaths, error }.
function mergeTreeDryRun(headRef, targetRef, headSha) {
	if (!mergeTreeAvailable(headSha)) {
		return { available: false, clean: null, tree: null, conflictedPaths: null, error: 'git merge-tree --write-tree unavailable (needs git >= 2.38)' };
	}
	const r = git(['merge-tree', '--write-tree', '--name-only', headRef, targetRef]);
	if (r.status !== 0 && r.status !== 1) {
		return { available: true, clean: null, tree: null, conflictedPaths: null, error: `git merge-tree exited ${r.status}: ${r.err.trim() || r.out.trim()}` };
	}
	// output: line 1 = result tree OID; then the conflicted path names, one
	// per line, up to the blank line that starts the informational-messages
	// section ("Auto-merging ..." / "CONFLICT ..." prose is NOT paths).
	const raw = r.out.split('\n');
	const tree = (raw[0] || '').trim() || null;
	const conflictedPaths = [];
	for (let i = 1; i < raw.length; i++) {
		const line = raw[i];
		if (line === '') { break; } // informational messages section starts here
		if (/^(Auto-merging|CONFLICT|warning:|error:|fatal:|merge:)/.test(line)) { break; } // belt and braces
		conflictedPaths.push(line);
	}
	return { available: true, clean: r.status === 0, tree, conflictedPaths, error: null };
}

// Honest fallback when merge-tree is unavailable: files changed on BOTH sides
// since the merge-base = conflict CANDIDATES (superset — no content-level
// detection, renames excluded from matching nuance).
function conflictCandidates(mergeBaseSha, headRef, targetRef) {
	const headChanged = new Set(diffNameStatus(mergeBaseSha, headRef).map((r) => r.path));
	const targetChanged = new Set(diffNameStatus(mergeBaseSha, targetRef).map((r) => r.path));
	const both = [...headChanged].filter((p) => targetChanged.has(p)).sort();
	return both;
}

// Both-sides classification of one path vs the merge-base.
function sideStatus(mergeBaseSha, sideRef, filePath) {
	const rows = diffNameStatus(mergeBaseSha, sideRef, [filePath]);
	if (rows.length === 0) { return 'UNTOUCHED'; }
	const s = rows[0].status;
	return s === 'A' ? 'ADDED' : s === 'M' ? 'MODIFIED' : s === 'D' ? 'DELETED' : s === 'R' ? 'RENAMED' : s;
}

function isFlauzOwned(p) {
	return FLAUZ_ADDITIVE_PATH_RES.some((re) => re.test(p));
}

function topDir(p) {
	const idx = p.indexOf('/');
	return idx === -1 ? '(root)' : p.slice(0, idx);
}

// ---------------------------------------------------------------------------------------------
// allowlist
// ---------------------------------------------------------------------------------------------

function loadAllowlist(file) {
	if (!fs.existsSync(file)) { return { entries: [] }; }
	let parsed;
	try {
		parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
	} catch (e) {
		throw new UsageError(`allowlist '${file}' is not valid JSON: ${e.message}`);
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray(parsed.entries)) {
		throw new UsageError(`allowlist '${file}' must be an object with an 'entries' array`);
	}
	const entries = [];
	for (const e of parsed.entries) {
		if (!e || typeof e !== 'object' || typeof e.path !== 'string' || !e.path) {
			throw new UsageError(`allowlist '${file}' has an entry without a string 'path'`);
		}
		entries.push({ path: e.path, reason: typeof e.reason === 'string' ? e.reason : '', date: typeof e.date === 'string' ? e.date : '' });
	}
	return { entries };
}

// ---------------------------------------------------------------------------------------------
// --report
// ---------------------------------------------------------------------------------------------

function runReport(args) {
	const baseRefSpec = args.base ?? DEFAULT_BASE;
	const headRefSpec = args.head ?? 'HEAD';

	const base = resolveRef(baseRefSpec);
	if (!base) {
		throw new UsageError(`base ref '${baseRefSpec}' does not resolve (tried '${baseRefSpec}', 'origin/${baseRefSpec}') — the upstream Code OSS reference line is required`);
	}
	const head = resolveAnyRef(headRefSpec);
	if (!head) {
		throw new UsageError(`head ref '${headRefSpec}' does not resolve`);
	}

	const mergeBase = git(['merge-base', base.sha, head.sha]);
	if (!mergeBase.ok) {
		throw new UsageError(`no merge-base between ${base.ref} and ${head.ref}: ${mergeBase.err.trim()}`);
	}
	const mergeBaseSha = mergeBase.out.trim();

	const ahead = countCommits(base.sha, head.sha);
	const behind = countCommits(head.sha, base.sha);

	const pristine = pristineAssertion(base.sha, head.sha);

	// census rows: DIRECT tree comparison of the two refs (two-dot `git diff
	// base head` — the compat-battery tree-diff semantics: a path present
	// upstream but absent on head reads as DELETED, which after absorbing
	// upstream is exactly the "product removed an upstream file" regression
	// signal; while behind > 0 it also lists not-yet-absorbed upstream paths —
	// cross-read with the behind count). The pristine assertion below keeps
	// the guard's THREE-dot operator (diff base...head = merge-base vs head).
	const census = diffNameStatus(base.sha, head.sha);

	const allowlistFile = args.allowlist
		? path.resolve(REPO, args.allowlist) // repo-relative (the default below is too)
		: path.join(REPO, DEFAULT_ALLOWLIST_REL);
	const allowlist = loadAllowlist(allowlistFile);
	const allowed = new Map(allowlist.entries.map((e) => [e.path, e]));

	const shared = [];      // M/D/R rows (shared upstream files)
	const addedOwned = [];  // A rows inside the flauz namespace
	const addedOutside = []; // A rows outside the namespace (placement-law violation)
	for (const row of census) {
		if (row.status === 'A') {
			if (isFlauzOwned(row.path)) { addedOwned.push(row); } else { addedOutside.push(row); }
		} else {
			shared.push(row);
		}
	}

	// allowlist matching (renames match on new OR old path — renaming a shared
	// upstream file into the flauz namespace is still a shared-file change)
	// + stale-entry detection
	const divergent = [];
	const allowlisted = [];
	for (const row of shared) {
		const entry = allowed.get(row.path) ?? (row.oldPath ? allowed.get(row.oldPath) : undefined);
		if (entry) { allowlisted.push({ ...row, reason: entry.reason, date: entry.date }); }
		else { divergent.push(row); }
	}
	const allowlistedPaths = new Set(allowlisted.map((r) => r.path));
	const staleAllowlist = allowlist.entries.filter((e) => !allowlistedPaths.has(e.path));

	// top-level rollup (current-path semantics; exotic statuses bucket under M)
	const rollup = new Map();
	for (const row of census) {
		const dir = topDir(row.path);
		if (!rollup.has(dir)) { rollup.set(dir, { dir, A: 0, M: 0, D: 0, R: 0 }); }
		const key = ['A', 'M', 'D', 'R'].includes(row.status) ? row.status : 'M';
		rollup.get(dir)[key] += 1;
	}
	const rollupRows = [...rollup.values()].sort((a, b) => a.dir.localeCompare(b.dir));

	// flauz/main compatibility-alias lag note
	const alias = (() => {
		for (const spec of ['flauz/main', 'origin/flauz/main']) {
			const r = resolveAnyRef(spec);
			if (r) {
				return {
					ref: r.ref, sha: r.sha,
					lagCommits: countCommits(r.sha, head.sha) ?? 0,
					aheadOfHead: countCommits(head.sha, r.sha) ?? 0,
				};
			}
		}
		return null;
	})();

	const emptyCensus = census.length === 0;
	const verdict = emptyCensus ? 'SKIP'
		: (divergent.length > 0 || addedOutside.length > 0 || !pristine.pristine) ? 'DIVERGENT'
			: 'CLEAN';
	let exit = verdict === 'DIVERGENT' ? EXIT_FAIL : EXIT_OK;
	if (args['no-fail']) { exit = EXIT_OK; }

	const out = {
		tool: 'sync-upstream', mode: 'report',
		generatedAt: new Date().toISOString(),
		repoRoot: REPO,
		base: { requested: baseRefSpec, resolved: base.ref, sha: base.sha },
		head: { requested: headRefSpec, resolved: head.ref, sha: head.sha },
		mergeBase: mergeBaseSha,
		ahead, behind,
		pristine,
		counts: {
			total: census.length,
			addedFlauzOwned: addedOwned.length,
			addedOutsideNamespace: addedOutside.length,
			shared: shared.length,
			sharedAllowlisted: allowlisted.length,
			sharedDivergent: divergent.length,
		},
		sharedFiles: {
			divergent: divergent.map((r) => ({ status: r.status, path: r.path })),
			allowlisted: allowlisted.map((r) => ({ status: r.status, path: r.path, reason: r.reason, date: r.date })),
		},
		addedOutsideNamespace: addedOutside.map((r) => r.path),
		addedFlauzOwned: addedOwned.map((r) => r.path),
		rollup: rollupRows,
		alias,
		staleAllowlistEntries: staleAllowlist.map((e) => e.path),
		verdict, exitCode: exit,
	};

	// ---- console output ----
	const lines = [];
	if (!args.json) {
		lines.push(`sync-upstream: REPORT — repo ${REPO}`);
		lines.push(`INFO  base: ${baseRefSpec} -> ${base.ref} @ ${base.sha}`);
		lines.push(`INFO  head: ${head.ref} @ ${head.sha} (merge-base ${mergeBaseSha})`);
		lines.push(`INFO  ahead/behind: ${ahead} ahead, ${behind} behind (commits on head not in base / in base not on head).`);
		lines.push(`INFO  allowlist: ${allowlistFile}${fs.existsSync(allowlistFile) ? '' : ' (absent — no intentional divergences recorded)'}`);
		lines.push(pristine.pristine
			? `PRISTINE  src/vs divergence outside contrib/flauz: NONE (assertion PASS — guard semantics re-derived via git plumbing)`
			: `FAIL  src/vs NOT pristine outside contrib/flauz (${pristine.paths.length} path(s)):`);
		for (const p of pristine.paths) { lines.push(`  FORK-CRITICAL  ${p}`); }
		if (emptyCensus) {
			lines.push(`SKIP  empty census — head tree is identical to base tree; nothing to report (documented SKIP, exit 0).`);
		} else {
			lines.push(`-- census: shared upstream files (FORK-CRITICAL class) ${'-'.repeat(16)}`);
			for (const row of shared) {
				const al = allowed.get(row.path) ?? (row.oldPath ? allowed.get(row.oldPath) : undefined);
				const label = row.oldPath ? `${row.status}  ${row.oldPath} -> ${row.path}` : `${row.status}  ${row.path}`;
				lines.push(al
					? ` ${label}  [allowlisted${al.date ? ` ${al.date}` : ''}: ${al.reason}]`
					: ` ${label}`);
			}
			if (shared.length === 0) { lines.push(` (none — no shared upstream file modified, deleted or renamed)`); }
			lines.push(`-- census: added flauz-owned paths ${'-'.repeat(40)}`);
			for (const row of addedOwned) { lines.push(` A  ${row.path}`); }
			if (addedOutside.length > 0) {
				lines.push(`-- census: added OUTSIDE the flauz namespace (placement law, ARCHITECTURE-LOCK sections 4/6) ----`);
				for (const row of addedOutside) { lines.push(` FAIL  A  ${row.path}`); }
			}
			lines.push(`-- top-level rollup ${'-'.repeat(48)}`);
			for (const r of rollupRows) {
				lines.push(` ${r.dir.padEnd(24)} A=${r.A} M=${r.M} D=${r.D} R=${r.R}`);
			}
		}
		if (alias) {
			lines.push(`INFO  flauz/main compatibility alias: ${alias.ref} @ ${alias.sha} — lags head by ${alias.lagCommits} commit(s)` +
				(alias.aheadOfHead > 0 ? ` (WARNING: alias is ${alias.aheadOfHead} commit(s) AHEAD of head — not fully merged into head!)` : ''));
		} else {
			lines.push(`INFO  flauz/main compatibility alias: not present (nothing to note).`);
		}
		for (const p of staleAllowlist) {
			lines.push(`INFO  stale allowlist entry '${p}' (path is not currently divergent) — prune it at the next sync.`);
		}
		if (verdict === 'DIVERGENT' && !args['no-fail']) {
			for (const row of divergent) {
				lines.push(`FAIL  shared-file divergence: ${row.status} ${row.path} — not covered by ${path.relative(REPO, allowlistFile) || allowlistFile}`);
			}
			for (const row of addedOutside) {
				lines.push(`FAIL  added outside the flauz namespace: ${row.path}`);
			}
			if (!pristine.pristine) {
				lines.push(`FAIL  src/vs is not pristine outside contrib/flauz — FORK-CRITICAL ledger entry required (fork-critical-guard.sh is the gate).`);
			}
		}
		lines.push(`-- verdict ${'-'.repeat(51)}`);
		lines.push(`UPSTREAM-DELTA: ${verdict}${verdict === 'DIVERGENT' ? ' — ' : ' — '}${addedOwned.length} flauz-owned path(s) added; ${allowlisted.length} shared-file change(s) allowlisted; ${divergent.length + addedOutside.length + (pristine.pristine ? 0 : pristine.paths.length)} unallowlisted divergence(s).`);
		if (verdict === 'DIVERGENT' && args['no-fail']) { lines.push(`(informational run, --no-fail — exit 0)`); }
		process.stdout.write(lines.join('\n') + '\n');
	} else {
		process.stdout.write(JSON.stringify(out, null, 2) + '\n');
	}

	// ---- markdown document (--out) ----
	if (args.out) {
		const doc = renderDeltaDocument(out);
		fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
		fs.writeFileSync(path.resolve(args.out), doc);
		if (!args.json) { process.stdout.write(`report document written: ${args.out}\n`); }
	}

	return exit;
}

function renderDeltaDocument(o) {
	const L = [];
	L.push(`# Flauz upstream delta report`);
	L.push(``);
	L.push(`Generated: ${o.generatedAt} by \`build/flauz/scripts/sync-upstream.mjs --report\` (TL1-001).`);
	L.push(`Sides: base \`${o.base.requested}\` -> \`${o.base.resolved}\` @ \`${o.base.sha}\`; head \`${o.head.resolved}\` @ \`${o.head.sha}\` (merge-base \`${o.mergeBase}\`).`);
	L.push(``);
	L.push(`## Ahead / behind`);
	L.push(``);
	L.push(`The product head is **${o.ahead} commit(s) ahead** and **${o.behind} commit(s) behind** the upstream Code OSS reference line. ${o.behind === 0 ? 'No upstream absorption is pending; the next sync is a no-op merge unless upstream moves.' : `Upstream has moved — run the sync procedure (build/flauz/SYNC-RUNBOOK.md).`}`);
	L.push(``);
	L.push(`## src/vs pristine assertion`);
	L.push(``);
	L.push(o.pristine.pristine
		? `**PASS** — \`git diff --name-only ${o.base.sha}...${o.head.sha} -- src/vs ':(exclude)src/vs/workbench/contrib/flauz'\` is EMPTY. The FORK-CRITICAL ledger stays empty (DL-12/DL-10); \`fork-critical-guard.sh\` remains the gate, this report re-derives the same assertion with git plumbing.`
		: `**FAIL** — forbidden src/vs divergence outside contrib/flauz:\n\n${o.pristine.paths.map((p) => `- \`${p}\``).join('\n')}`);
	L.push(``);
	L.push(`## Census — shared upstream files (FORK-CRITICAL class)`);
	L.push(``);
	if (o.sharedFiles.allowlisted.length === 0 && o.sharedFiles.divergent.length === 0) {
		L.push(`(none — no shared upstream file is modified, deleted or renamed on the product line)`);
	}
	if (o.sharedFiles.allowlisted.length > 0) {
		L.push(`Intentional divergences (allowlisted in \`build/flauz/sync-allowlist.json\`):`);
		L.push(``);
		L.push(`| status | path | reason | recorded |`);
		L.push(`|---|---|---|---|`);
		for (const r of o.sharedFiles.allowlisted) {
			L.push(`| ${r.status} | \`${r.path}\` | ${r.reason} | ${r.date} |`);
		}
		L.push(``);
	}
	if (o.sharedFiles.divergent.length > 0) {
		L.push(`**UNALLOWLISTED divergence (the report FAILs on these):**`);
		L.push(``);
		L.push(`| status | path |`);
		L.push(`|---|---|`);
		for (const r of o.sharedFiles.divergent) {
			L.push(`| ${r.status} | \`${r.path}\` |`);
		}
		L.push(``);
	}
	L.push(`## Census — added paths (${o.counts.addedFlauzOwned} flauz-owned)`);
	L.push(``);
	if (o.counts.addedOutsideNamespace > 0) {
		L.push(`**${o.counts.addedOutsideNamespace} path(s) were added OUTSIDE the flauz-owned namespace (placement law, ARCHITECTURE-LOCK sections 4/6) — the report FAILs on these:**`);
		L.push('');
		for (const p of o.addedOutsideNamespace) { L.push(`- \`${p}\``); }
		L.push('');
	}
	L.push(`| status | path |`);
	L.push(`|---|---|`);
	for (const p of o.addedFlauzOwned) {
		L.push(`| A | \`${p}\` |`);
	}
	L.push(``);
	L.push(`## Per-top-level-directory rollup`);
	L.push(``);
	L.push(`| directory | A | M | D | R |`);
	L.push(`|---|---|---|---|---|`);
	for (const r of o.rollup) {
		L.push(`| ${r.dir === '(root)' ? '(root files)' : r.dir} | ${r.A} | ${r.M} | ${r.D} | ${r.R} |`);
	}
	L.push(``);
	L.push(`## flauz/main compatibility-alias lag`);
	L.push(``);
	if (o.alias) {
		L.push(`\`${o.alias.ref}\` @ \`${o.alias.sha}\` is the compatibility alias for the former product branch (CURRENT-STATE.md). It **lags the product head by ${o.alias.lagCommits} commit(s)**${o.alias.aheadOfHead > 0 ? ` and is ${o.alias.aheadOfHead} commit(s) AHEAD of head (not fully merged!)` : ''} — it carries no product work and must never be used to infer product state (SOURCE-OF-TRUTH.md branch policy). Repoint the alias only at sync checkpoints, TL-owned.`);
	} else {
		L.push(`No \`flauz/main\` or \`origin/flauz/main\` ref is present in this clone — nothing to note.`);
	}
	L.push(``);
	L.push(`## Regeneration`);
	L.push(``);
	L.push('```sh');
	L.push(`node build/flauz/scripts/sync-upstream.mjs --report --out build/flauz/UPSTREAM-DELTA.md`);
	L.push('```');
	L.push(``);
	L.push(`Machine output: add \`--json\`. Exit codes: 0 clean/SKIP · 1 divergence (unless \`--no-fail\`) · 2 usage.`);
	L.push(``);
	return L.join('\n');
}

// ---------------------------------------------------------------------------------------------
// --plan
// ---------------------------------------------------------------------------------------------

function runPlan(args) {
	const targetRefSpec = args.target ?? DEFAULT_BASE;
	const headRefSpec = args.head ?? 'HEAD';

	const target = resolveRef(targetRefSpec);
	if (!target) {
		throw new UsageError(`target ref '${targetRefSpec}' does not resolve (tried '${targetRefSpec}', 'origin/${targetRefSpec}') — the upstream Code OSS reference line is required`);
	}
	const head = resolveAnyRef(headRefSpec);
	if (!head) {
		throw new UsageError(`head ref '${headRefSpec}' does not resolve`);
	}

	const mergeBase = git(['merge-base', target.sha, head.sha]);
	if (!mergeBase.ok) {
		throw new UsageError(`no merge-base between ${head.ref} and ${target.ref}: ${mergeBase.err.trim()}`);
	}
	const mergeBaseSha = mergeBase.out.trim();

	const ahead = countCommits(target.sha, head.sha);
	const behind = countCommits(head.sha, target.sha);

	const dryRun = mergeTreeDryRun(head.ref, target.ref, head.sha);
	let conflictedPaths;
	let method;
	if (dryRun.available && !dryRun.error) {
		conflictedPaths = dryRun.conflictedPaths ?? [];
		method = 'git merge-tree --write-tree (content-level dry run)';
	} else if (dryRun.available && dryRun.error) {
		method = `git merge-tree --write-tree FAILED: ${dryRun.error}`;
		conflictedPaths = null;
	} else {
		conflictedPaths = conflictCandidates(mergeBaseSha, head.ref, target.ref);
		method = 'FALLBACK: both-sides-touched intersection (conflict CANDIDATES, superset — git merge-tree --write-tree needs git >= 2.38)';
	}

	// both-sides classification per conflicted path
	const conflicts = (conflictedPaths ?? []).map((p) => ({
		path: p,
		flauz: sideStatus(mergeBaseSha, head.ref, p),
		upstream: sideStatus(mergeBaseSha, target.ref, p),
	}));

	const checkpointTag = `flauz/sync/${new Date().toISOString().slice(0, 10)}`;

	const decisionLogPath = path.join(REPO, 'DECISION-LOG.md');
	const decisionLogPresent = fs.existsSync(decisionLogPath);

	const canaries = SYNC_CANARIES.map((c) => ({
		...c,
		specPresent: fs.existsSync(path.join(REPO, c.spec)),
		workflowPresent: fs.existsSync(path.join(REPO, CANARIES_WORKFLOW)),
	}));

	let exit = EXIT_OK;
	if (dryRun.error) { exit = EXIT_FAIL; } // internal git failure — the plan is degraded, the TL must look

	const out = {
		tool: 'sync-upstream', mode: 'plan',
		generatedAt: new Date().toISOString(),
		repoRoot: REPO,
		head: { requested: headRefSpec, resolved: head.ref, sha: head.sha },
		target: { requested: targetRefSpec, resolved: target.ref, sha: target.sha },
		mergeBase: mergeBaseSha,
		ahead, behind,
		mergeDryRun: {
			method,
			available: dryRun.available,
			clean: dryRun.clean,
			tree: dryRun.tree,
			error: dryRun.error,
			conflictCount: conflicts.length,
			conflicts,
		},
		canaries,
		checkpointTag,
		decisionLog: {
			present: decisionLogPresent,
			reminder: 'review the DECISION-LOG diff since the previous checkpoint tag (MIGRATION-PLAN section 5 job 6)',
		},
		verdict: dryRun.error ? 'DEGRADED (git failure)' : conflicts.length === 0 ? 'PLAN PRODUCED — clean merge' : `PLAN PRODUCED — ${conflicts.length} conflict path(s)`,
		exitCode: exit,
	};

	const lines = [];
	if (!args.json) {
		lines.push(`sync-upstream: PLAN — merge ${target.ref} INTO ${head.ref} (MERGE, never rebase product history)`);
		lines.push(`INFO  head: ${head.ref} @ ${head.sha}; target: ${targetRefSpec} -> ${target.ref} @ ${target.sha} (merge-base ${mergeBaseSha})`);
		lines.push(`INFO  ahead/behind: ${ahead} ahead, ${behind} behind.`);
		lines.push(`INFO  dry-run method: ${method}`);
		if (dryRun.error) {
			lines.push(`FAIL  ${dryRun.error}`);
		} else if (out.mergeDryRun.clean) {
			lines.push(`CLEAN  dry-run merge of ${target.ref} into ${head.ref}: no conflicts (result tree ${dryRun.tree}).`);
		} else {
			lines.push(`-- conflict path list (${conflicts.length}, with both-sides classification vs merge-base) ----`);
			for (const c of conflicts) {
				lines.push(` CONFLICT  ${c.path} — flauz: ${c.flauz} · upstream: ${c.upstream}`);
			}
			lines.push(`REMINDER  flauz-owned additive paths auto-resolve; ANY shared-file conflict escalates to the TL with both sides recorded (SYNC-RUNBOOK.md conflict policy).`);
		}
		lines.push(`-- canary triggers (build/flauz/README.md job 4 — run at EVERY sync, DL-11) ----`);
		for (const c of canaries) {
			lines.push(` ${c.id}  job ${c.job} in ${CANARIES_WORKFLOW}${c.workflowPresent ? '' : ' (workflow MISSING)'} — spec ${c.spec}${c.specPresent ? '' : ' (spec MISSING)'}`);
		}
		lines.push(`-- post-sync checkpoint (build/flauz/README.md job 6) ----`);
		lines.push(` checkpoint tag: ${checkpointTag}`);
		lines.push(` DECISION-LOG: ${out.decisionLog.reminder}.${decisionLogPresent ? '' : ` NOTE: DECISION-LOG.md is not present at this head — record sync decisions in the work registry until it lands.`}`);
		lines.push(`-- verdict ${'-'.repeat(51)}`);
		lines.push(`SYNC PLAN: ${out.verdict}${dryRun.error ? '' : ' (conflicts are DATA, not failure)'}`);
		process.stdout.write(lines.join('\n') + '\n');
	} else {
		process.stdout.write(JSON.stringify(out, null, 2) + '\n');
	}

	if (args.out) {
		const doc = renderPlanDocument(out);
		fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
		fs.writeFileSync(path.resolve(args.out), doc);
		if (!args.json) { process.stdout.write(`plan document written: ${args.out}\n`); }
	}

	return exit;
}

function renderPlanDocument(o) {
	const L = [];
	L.push(`# Flauz upstream sync plan`);
	L.push(``);
	L.push(`Generated: ${o.generatedAt} by \`build/flauz/scripts/sync-upstream.mjs --plan\` (TL1-001).`);
	L.push(`Merge \`${o.target.resolved}\` @ \`${o.target.sha}\` INTO \`${o.head.resolved}\` @ \`${o.head.sha}\` (merge-base \`${o.mergeBase}\`) — MERGE, never rebase product history.`);
	L.push(``);
	L.push(`## Ahead / behind`);
	L.push(``);
	L.push(`- product head ahead of target: **${o.ahead} commit(s)**`);
	L.push(`- product head behind target: **${o.behind} commit(s)**`);
	L.push(``);
	L.push(`## Dry-run conflict detection`);
	L.push(``);
	L.push(`Method: ${o.mergeDryRun.method}`);
	if (o.mergeDryRun.error) {
		L.push(``);
		L.push(`**ERROR:** ${o.mergeDryRun.error}`);
	} else if (o.mergeDryRun.clean) {
		L.push(``);
		L.push(`**Clean merge** — no conflicts (result tree \`${o.mergeDryRun.tree}\`).`);
	} else {
		L.push(``);
		L.push(`**${o.mergeDryRun.conflictCount} conflict path(s)** (both sides classified vs the merge-base):`);
		L.push(``);
		L.push(`| path | flauz side | upstream side |`);
		L.push(`|---|---|---|`);
		for (const c of o.mergeDryRun.conflicts) {
			L.push(`| \`${c.path}\` | ${c.flauz} | ${c.upstream} |`);
		}
		L.push(``);
		L.push(`Conflict policy: flauz-owned additive paths auto-resolve; any shared-file conflict escalates to the TL with both sides recorded (build/flauz/SYNC-RUNBOOK.md).`);
	}
	L.push(``);
	L.push(`## Canary triggers (every sync — DL-11)`);
	L.push(``);
	L.push(`| canary | CI job | workflow | spec |`);
	L.push(`|---|---|---|---|`);
	for (const c of o.canaries) {
		L.push(`| ${c.id} | \`${c.job}\` | ${CANARIES_WORKFLOW}${c.workflowPresent ? '' : ' **MISSING**'} | ${c.spec}${c.specPresent ? '' : ' **MISSING**'} |`);
	}
	L.push(``);
	L.push(`## Post-sync checkpoint`);
	L.push(``);
	L.push(`- checkpoint tag: \`${o.checkpointTag}\` (build/flauz/README.md job 6)`);
	L.push(`- DECISION-LOG reminder: ${o.decisionLog.reminder}.${o.decisionLog.present ? '' : ' DECISION-LOG.md is not present at this head — record sync decisions in the work registry until it lands.'}`);
	L.push(``);
	L.push(`Verdict: **${o.verdict}**`);
	L.push(``);
	return L.join('\n');
}

// ---------------------------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------------------------

function main() {
	let parsed;
	try {
		parsed = parseArgs({
			allowPositionals: false,
			options: {
				report: { type: 'boolean', default: false },
				plan: { type: 'boolean', default: false },
				base: { type: 'string' },
				head: { type: 'string' },
				target: { type: 'string' },
				repo: { type: 'string', default: SCRIPT_REPO_ROOT },
				allowlist: { type: 'string' },
				json: { type: 'boolean', default: false },
				out: { type: 'string' },
				'no-fail': { type: 'boolean', default: false },
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
	if (args.report === args.plan) {
		process.stderr.write(`usage error: exactly one of --report or --plan is required\n\n`);
		usage();
		process.exit(EXIT_USAGE);
	}

	REPO = path.resolve(args.repo);
	if (!fs.existsSync(path.join(REPO, '.git'))) {
		process.stderr.write(`usage error: --repo '${args.repo}' is not a git repository\n`);
		process.exit(EXIT_USAGE);
	}

	// keep the | head -40 class of inspection from producing an EPIPE crash
	process.stdout.on('error', (e) => {
		if (e.code === 'EPIPE') { process.exit(args.report ? (args['no-fail'] ? EXIT_OK : EXIT_FAIL) : EXIT_OK); }
		throw e;
	});

	try {
		process.exit(args.report ? runReport(args) : runPlan(args));
	} catch (e) {
		if (e instanceof UsageError) {
			process.stderr.write(`usage error: ${e.message}\n`);
			process.exit(EXIT_USAGE);
		}
		process.stderr.write(`sync-upstream: internal error: ${e.message}\n`);
		process.exit(EXIT_FAIL);
	}
}

main();
