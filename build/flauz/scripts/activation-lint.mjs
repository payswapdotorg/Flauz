#!/usr/bin/env node
// ---------------------------------------------------------------------------------------------
// Flauz Wave 3 — Lane H (perf harness + CI + budget enforcement)
//
// activation-lint.mjs — activation discipline for extensions/flauz-* built-ins
// (PERFORMANCE-PLAN §2.1 rules + §2.2 activation budget table; MIGRATION-PLAN
// §2 layout). Runs in CI (flauz-hygiene.yml job 1) and locally (zero-dep).
//
// Rules:
//   R1 star           : `*` in activationEvents is FORBIDDEN (§2.2 row 1 — eager
//                       activation blocks onStartupFinished for everyone,
//                       extHostExtensionService.ts:671-687).
//   R2 whitelist      : every activation event must match the §2.2 whitelist:
//                         onStartupFinished
//                         onCommand:flauz.*
//                         onView:flauz.*
//                         onTaskType:flauz.*
//                         onLanguageModelChatProvider:<vendor>
//                       (vendor = [A-Za-z0-9._-]+; model resolution activates
//                       providers via this event — languageModels.ts:1223-1244.)
//                       Extra events can be allow-listed per-repo with
//                       --allow-event <regex> (repeatable) — each use must cite
//                       a PERF-plan amendment in the PR description (review gate).
//   R3 startup cap    : at most --max-startup (default 2) flauz-* extensions may
//                       declare onStartupFinished, and only ids on
//                       --startup-allowed (default: flauz-agent = the Agent
//                       Bridge, flauz-workspace — §2.2 row 2: "bridge + workspace
//                       extensions only; <=2 flauz extensions on it").
//   R4 affinity keys  : contributes.configurationDefaults["extensions.experimental.affinity"]
//                       keys must be extension ids of the flauz publisher:
//                       /^flauz\.[a-z0-9-]+$/ (DL-5/§2.1 rule 2 pins
//                       "flauz.agent-bridge"-style ids).
//   R5 affinity value : affinity values must be integers >= 1
//                       (each distinct positive int allocates an ext-host slot —
//                       extensionRunningLocationTracker.ts:167-204).
//   R6 single slot    : ALL flauz affinity values must be exactly 1 across the
//                       whole set — one pinned host total (§3.2 Agent Bridge row;
//                       cost model: exactly one additional ext-host process).
//                       Override with --max-affinity-slots N only with a
//                       DECISION-LOG entry (DL-5).
//   R7 bridge pinned  : WARN when a flauz.agent-bridge id exists in the set but
//                       no manifest pins it via affinity (R1 risk in PERF §7 —
//                       pinning is config, owned by flauz-defaults).
//   R8 proposal shape : enabledApiProposals entries must be non-empty strings
//                       (existence/renames are proposed-api-rota.mjs's job — DL-4).
//
// Manifest discovery (never hardcodes a file list — parallel lanes land at
// different times):
//   --root <dir>            repository root; manifests globbed at
//                           extensions/flauz-*/package.json
//   --manifests-glob <g>    override the glob (fixture sets use e.g. "*.package.json")
//
// If NO flauz-* manifests are found the linter exits 0 with a documented SKIP
// notice (lanes in flight). --require-manifests flips that to a failure (used
// by the fixture verification to prove the rules actually fire).
//
// Exit codes: 0 = clean (or documented SKIP) · 1 = rule violation (or parse
// error in a manifest) · 2 = usage error.
//
// Zero dependencies: node >= 20 stdlib only.
// ---------------------------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const EXIT_OK = 0, EXIT_FAIL = 1, EXIT_USAGE = 2;

const DEFAULT_GLOB = 'extensions/flauz-*/package.json';
const ALLOWED_EVENT_PATTERNS = [
        /^onStartupFinished$/,
        /^onCommand:flauz\.[A-Za-z0-9._-]*\*?$/,
        /^onView:flauz\.[A-Za-z0-9._-]*\*?$/,
        /^onTaskType:flauz\.[A-Za-z0-9._-]*\*?$/,
        /^onLanguageModelChatProvider:[A-Za-z0-9._-]+$/,
];
const DEFAULT_STARTUP_ALLOWED = ['flauz.agent-bridge', 'flauz.workspace'];
const DEFAULT_MAX_STARTUP = 2;
const AFFINITY_SETTING = 'extensions.experimental.affinity';
const AFFINITY_KEY_RE = /^flauz\.[a-z0-9-]+$/;

function usage() {
        process.stdout.write(`activation-lint.mjs — activation discipline for extensions/flauz-* (PERF §2.1/§2.2)

Usage:
  node activation-lint.mjs [--root <repo>] [--manifests-glob <glob>]
  node activation-lint.mjs --root test/fixtures/manifests/bad --manifests-glob "*.json" --require-manifests

Options:
  --root <dir>             root dir for the manifests glob (default: cwd)
  --manifests-glob <g>     glob (default: ${DEFAULT_GLOB})
  --allow-event <regex>    extra allowed activation event (repeatable; cite a PERF amendment)
  --max-startup <n>        max flauz extensions on onStartupFinished (default ${DEFAULT_MAX_STARTUP})
  --startup-allowed <ids>  comma-separated ids allowed on onStartupFinished
                           (default ${DEFAULT_STARTUP_ALLOWED.join(',')})
  --max-affinity-slots <n> max distinct positive affinity value (default 1 — one pinned host, DL-5)
  --require-manifests      fail when zero manifests are found (default: SKIP notice, exit 0)
  --json                   emit a machine-readable verdict block

Rules: R1 no '*' · R2 event whitelist · R3 onStartupFinished cap+ids ·
R4 affinity key shape · R5 affinity value shape · R6 single pinned slot ·
R7 bridge pin present (WARN) · R8 enabledApiProposals shape.

Exit codes: 0 clean/SKIP · 1 violation or bad manifest · 2 usage error.
`);
}

function globToRegExp(pattern) {
        let re = '';
        for (let i = 0; i < pattern.length; i++) {
                const c = pattern[i];
                if (c === '*') {
                        if (pattern[i + 1] === '*') {
                                if (pattern[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i += 1; }
                        } else { re += '[^/]*'; }
                } else if (c === '?') { re += '[^/]'; }
                else { re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&'); }
        }
        return new RegExp(`^${re}$`);
}

function walkFiles(rootDir) {
        const out = [];
        const skip = new Set(['node_modules', '.git', 'out', 'out-build', 'dist']);
        const rec = (dir) => {
                let entries;
                try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
                for (const e of entries) {
                        const p = path.join(dir, e.name);
                        if (e.isDirectory()) { if (!skip.has(e.name)) { rec(p); } }
                        else if (e.isFile()) { out.push(p); }
                }
        };
        rec(rootDir);
        return out;
}

function main() {
        let parsed;
        try {
                parsed = parseArgs({
                        allowPositionals: false,
                        options: {
                                root: { type: 'string', default: process.cwd() },
                                'manifests-glob': { type: 'string', default: DEFAULT_GLOB },
                                'allow-event': { type: 'string', multiple: true },
                                'max-startup': { type: 'string' },
                                'startup-allowed': { type: 'string', default: DEFAULT_STARTUP_ALLOWED.join(',') },
                                'max-affinity-slots': { type: 'string' },
                                'require-manifests': { type: 'boolean', default: false },
                                json: { type: 'boolean', default: false },
                                help: { type: 'boolean', default: false },
                        },
                });
        } catch (e) {
                process.stderr.write(`usage error: ${e.message}\n\n`); usage(); process.exit(EXIT_USAGE);
        }
        const args = parsed.values;
        if (args.help) { usage(); process.exit(EXIT_OK); }

        const allowedExtra = [];
        for (const spec of (args['allow-event'] ?? [])) {
                try { allowedExtra.push(new RegExp(spec)); } catch (e) {
                        process.stderr.write(`usage error: --allow-event '${spec}': ${e.message}\n`);
                        process.exit(EXIT_USAGE);
                }
        }
        const startupAllowed = args['startup-allowed'].split(',').map(s => s.trim()).filter(Boolean);
        const parsePositiveInt = (value, label, fallback) => {
                if (value === undefined || value === '') { return fallback; }
                const n = Number(value);
                if (!Number.isInteger(n) || n < 1) {
                        process.stderr.write(`usage error: --${label} must be a positive integer (got '${value}')\n`);
                        process.exit(EXIT_USAGE);
                }
                return n;
        };
        const maxStartup = parsePositiveInt(args['max-startup'], 'max-startup', DEFAULT_MAX_STARTUP);
        const maxAffinitySlots = parsePositiveInt(args['max-affinity-slots'], 'max-affinity-slots', 1);

        const base = path.resolve(args.root);
        const re = globToRegExp(args['manifests-glob']);
        const manifests = [];
        for (const f of walkFiles(base)) {
                const rel = path.relative(base, f).split(path.sep).join('/');
                if (re.test(rel)) { manifests.push({ abs: f, rel }); }
        }

        const report = [];
        let exit = EXIT_OK;
        const fail = (m) => { report.push(`FAIL  ${m}`); exit = EXIT_FAIL; };
        const warn = (m) => report.push(`WARN  ${m}`);
        const pass = (m) => report.push(`PASS  ${m}`);

        if (manifests.length === 0) {
                const msg = `no manifests matched '${args['manifests-glob']}' under ${base} — flauz-* lanes not merged yet (documented SKIP; activation lint deferred).`;
                if (args['require-manifests']) { fail(msg); }
                else { report.push(`SKIP  ${msg}`); }
                process.stdout.write(report.join('\n') + '\n');
                process.exit(exit);
        }
        report.push(`linting ${manifests.length} manifest(s): ${manifests.map(m => m.rel).join(', ')}`);

        const startupUsers = [];
        const affinityEntries = []; // { file, key, value }
        const bridgeIdsPresent = new Set();

        for (const m of manifests) {
                let pkg;
                try {
                        pkg = JSON.parse(fs.readFileSync(m.abs, 'utf8'));
                } catch (e) {
                        fail(`${m.rel}: not valid JSON — ${e.message}`);
                        continue;
                }
                const id = `${pkg.publisher || '<no-publisher>'}.${pkg.name || '<no-name>'}`;
                if (/^flauz\./.test(id) || pkg.publisher === 'flauz') { bridgeIdsPresent.add(id); }

                // R1 + R2
                const events = Array.isArray(pkg.activationEvents) ? pkg.activationEvents : [];
                for (const ev of events) {
                        if (ev === '*') { fail(`R1 ${m.rel} (${id}): activationEvents contains '*' — eager activation is forbidden (PERF §2.2 row 1).`); continue; }
                        const okBuiltIn = ALLOWED_EVENT_PATTERNS.some(p => p.test(ev));
                        const okExtra = allowedExtra.some(p => p.test(ev));
                        if (!okBuiltIn && !okExtra) {
                                fail(`R2 ${m.rel} (${id}): activation event '${ev}' is not on the §2.2 whitelist (${ALLOWED_EVENT_PATTERNS.map(p => p.source).join(' | ')})${allowedExtra.length ? ` nor on the --allow-event list` : ''}.`);
                        }
                        if (ev === 'onStartupFinished') { startupUsers.push({ rel: m.rel, id }); }
                }

                // R3 id check per-declarer
                for (const u of startupUsers.filter(u => u.rel === m.rel)) {
                        if (!startupAllowed.includes(id)) {
                                fail(`R3 ${m.rel} (${id}): declares onStartupFinished but is not on the allowed list (${startupAllowed.join(', ')}) — §2.2 row 2: "bridge + workspace extensions only".`);
                        }
                }

                // R4-R6 affinity (contributes.configurationDefaults["extensions.experimental.affinity"])
                const confDefaults = pkg?.contributes?.configurationDefaults;
                if (confDefaults && typeof confDefaults === 'object' && Object.prototype.hasOwnProperty.call(confDefaults, AFFINITY_SETTING)) {
                        const aff = confDefaults[AFFINITY_SETTING];
                        if (!aff || typeof aff !== 'object' || Array.isArray(aff)) {
                                fail(`R4 ${m.rel}: ${AFFINITY_SETTING} must be an object of { "<extension-id>": <slot> }.`);
                        } else {
                                for (const [key, value] of Object.entries(aff)) {
                                        if (!AFFINITY_KEY_RE.test(key)) {
                                                fail(`R4 ${m.rel}: affinity key '${key}' does not match ${AFFINITY_KEY_RE} (DL-5 pins flauz-publisher ids).`);
                                        }
                                        if (!Number.isInteger(value) || value < 1) {
                                                fail(`R5 ${m.rel}: affinity value for '${key}' must be an integer >= 1 (got ${JSON.stringify(value)}).`);
                                        }
                                        affinityEntries.push({ file: m.rel, key, value });
                                }
                        }
                }

                // R8 proposals shape
                if (pkg.enabledApiProposals !== undefined) {
                        if (!Array.isArray(pkg.enabledApiProposals) || pkg.enabledApiProposals.some(p => typeof p !== 'string' || p.trim() === '')) {
                                fail(`R8 ${m.rel}: enabledApiProposals must be an array of non-empty strings (existence tracking: proposed-api-rota.mjs).`);
                        }
                }
        }

        // R3 cap
        if (startupUsers.length > maxStartup) {
                fail(`R3 ${startupUsers.length} flauz extensions declare onStartupFinished > cap ${maxStartup} — ${startupUsers.map(u => u.id).join(', ')} (PERF §2.2 row 2).`);
        } else if (startupUsers.length > 0) {
                pass(`R3 onStartupFinished declarers: ${startupUsers.length} <= ${maxStartup} (${startupUsers.map(u => u.id).join(', ') || 'none'})`);
        } else {
                pass('R3 no flauz extension activates on onStartupFinished (nothing eager)');
        }

        // R6 single pinned slot
        const distinctSlots = new Set(affinityEntries.map(a => a.value).filter(v => Number.isInteger(v) && v >= 1));
        if (distinctSlots.size > maxAffinitySlots) {
                fail(`R6 affinity pins ${distinctSlots.size} distinct slot(s) {${[...distinctSlots].join(',')}} > ${maxAffinitySlots} — each distinct positive integer allocates a NEW extension-host process (§2.1 rule 2; one pinned host total, §3.2). Entries: ${affinityEntries.map(a => `${a.key}=${a.value} (${a.file})`).join('; ')}`);
        } else if (affinityEntries.length > 0) {
                pass(`R6 affinity entries ${affinityEntries.length}, distinct slots {${[...distinctSlots].join(',')}} <= ${maxAffinitySlots} — ${affinityEntries.map(a => `${a.key}=${a.value}`).join(', ')}`);
        }

        // R7 bridge pinned
        const pinnedIds = new Set(affinityEntries.map(a => a.key));
        for (const id of bridgeIdsPresent) {
                if (/agent-bridge/.test(id) && !pinnedIds.has(id)) {
                        warn(`R7 bridge id '${id}' present but not pinned via ${AFFINITY_SETTING} — pinning is flauz-defaults config (PERF §7 R1); CI canary asserts the 'Placing extension(s) … on a separate extension host.' log line.`);
                }
        }
        if (pinnedIds.size > 0) {
                const unpinned = [...bridgeIdsPresent].filter(id => !pinnedIds.has(id) && !/agent-bridge/.test(id));
                if (unpinned.length) { report.push(`INFO  flauz ids not affinity-pinned (by design?): ${unpinned.join(', ')}`); }
        }

        report.push('── verdict ' + '─'.repeat(51));
        report.push(exit === EXIT_OK ? 'ACTIVATION LINT GREEN' : 'ACTIVATION LINT VIOLATIONS PRESENT');
        process.stdout.write(report.join('\n') + '\n');
        if (args.json) {
                process.stdout.write('\n<flauz-activation-lint-json>\n' + JSON.stringify({ exit, manifests: manifests.length }) + '\n</flauz-activation-lint-json>\n');
        }
        process.exit(exit);
}

main();
