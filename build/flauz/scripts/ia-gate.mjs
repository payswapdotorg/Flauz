/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// ---------------------------------------------------------------------------------------------
// Flauz — TL4 (product quality). ia-gate.mjs — information-architecture gate
// for extensions/flauz-* (TL4-001; docs/FLAUZ-PROGRAM/TL4-IA-SPEC.md section 7).
//
// TL4-HANDOFF hard rule: "Do not let the command palette be the sole discovery
// path." This gate makes the shell contract machine-checkable:
//
// Rules:
//   IA1 single container : exactly ONE activitybar view container with id
//                          `flauz` across ALL flauz-* manifests, defined by
//                          exactly one extension (flauz-workspace). Any other
//                          activitybar container id in a flauz-* manifest is
//                          a violation (single-container law; the platform
//                          moves cross-extension views into the container at
//                          registration — viewsExtensionPoint.ts:378-396 —
//                          so ONE definition is both necessary and
//                          sufficient).
//   IA2 expected views   : the six TL4-001 views exist exactly once each,
//                          contributed by their owner extension into container
//                          `flauz`, each with a non-empty `name`:
//                            flauz.home, flauz.tasks            (flauz-workspace)
//                            flauz.agentSessions                (flauz-agent)
//                            flauz.environments                 (flauz-environments)
//                            flauz.browser                      (flauz-browser)
//                            flauz.models                       (flauz-models)
//                          (flauz-workflow intentionally ships no view — the
//                          envelope is file-based; TL4-IA-SPEC.md section 2.)
//                          Views contributed by flauz-* extensions into any
//                          OTHER container are violations.
//   IA3 welcome states   : every view contributed under container `flauz`
//                          (expected or later additions) has at least one
//                          viewsWelcome entry with non-empty `contents`, and
//                          no viewsWelcome entry points at a non-existent
//                          view (empty states are part of the product).
//   IA4 focus commands   : the container command `flauz.focusView` plus one
//                          `flauz.focusView.<view>` per expected view exist;
//                          every command whose id starts `flauz.focusView`
//                          has category exactly "Flauz" and a non-empty
//                          title; no duplicate command ids across the flauz-*
//                          manifests.
//   IA5 activation budget: no flauz-* extension declares onStartupFinished
//                          beyond flauz-agent + flauz-workspace (PERF section
//                          2.2 row 2 cap of 2 — views activate via onView:).
//   IA6 provider wiring  : every view id referenced by a
//                          registerTreeDataProvider(...) call in flauz-* src
//                          exists in a manifest, and every view contributed
//                          under container `flauz` has such a call (both
//                          directions). The call's first argument may be a
//                          string literal or a const resolving to a
//                          `flauz.*` string; pass-through parameters are
//                          ignored (they reference no concrete view).
//
// Manifest discovery: --root <dir> (default cwd), manifests globbed at
// extensions/flauz-*/package.json — never a hardcoded list.
//
// Skip-vs-fail policy (build/flauz/README.md section 2): if NO flauz-*
// manifests are found the gate exits 0 with a documented SKIP. --require
// flips that to a failure (used by the fixture verification to prove the
// rules actually fire).
//
// Usage:
//        node ia-gate.mjs [--root <repo>] [--require]
//        node ia-gate.mjs --root test/fixtures/ia-gate/clean --require
//
// Exit codes: 0 = clean (or documented SKIP) · 1 = IA violation (or a
// manifest that is not valid JSON) · 2 = usage error.
//
// Zero dependencies: node >= 20 stdlib only.
// ---------------------------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const EXIT_OK = 0, EXIT_FAIL = 1, EXIT_USAGE = 2;

const DEFAULT_GLOB = 'extensions/flauz-*/package.json';

/** The TL4-001 view set: view id -> owner extension folder name. */
const EXPECTED_VIEWS = new Map([
        ['flauz.home', 'flauz-workspace'],
        ['flauz.tasks', 'flauz-workspace'],
        ['flauz.agentSessions', 'flauz-agent'],
        ['flauz.environments', 'flauz-environments'],
        ['flauz.browser', 'flauz-browser'],
        ['flauz.models', 'flauz-models'],
]);

const CONTAINER_ID = 'flauz';
const CONTAINER_OWNER = 'flauz-workspace';
const CONTAINER_FOCUS_COMMAND = 'flauz.focusView';
const STARTUP_ALLOWED = new Set(['flauz-agent', 'flauz-workspace']);

function usage() {
        process.stdout.write(`ia-gate.mjs — information-architecture gate for extensions/flauz-* (TL4-001)

Usage:
        node ia-gate.mjs [--root <repo>] [--require]
        node ia-gate.mjs --root test/fixtures/ia-gate/clean --require

Options:
        --root <dir>    root dir for the manifests glob (default: cwd)
        --require       fail when zero manifests are found (default: SKIP notice, exit 0)
        -h, --help      show this help

Rules: IA1 single \`flauz\` activity-bar container · IA2 the six expected views
(owner + container + non-empty name) · IA3 viewsWelcome for every flauz view ·
IA4 focusView command family (category "Flauz", no duplicate ids) · IA5
onStartupFinished cap (flauz-agent + flauz-workspace only) · IA6
registerTreeDataProvider wiring in both directions.

Exit codes: 0 clean/SKIP · 1 violation · 2 usage error.
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
                } else if (c === '?') {
                        re += '[^/]';
                } else {
                        re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
                }
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

/** Extracts concrete view ids referenced by registerTreeDataProvider / createTreeView calls. */
function scanProviderReferences(extensionSrcFiles) {
        // const NAME = '<flauz…>' declarations (module scope, any file) — the view
        // id constants the providers pass (HOME_VIEW_ID, SESSIONS_VIEW_ID, ...).
        const stringConsts = new Map();
        const constRe = /\bconst\s+([A-Z][A-Z0-9_]*)\s*=\s*['"](flauz\.[A-Za-z0-9.-]+)['"]/g;
        for (const file of extensionSrcFiles) {
                const text = fs.readFileSync(file, 'utf8');
                for (const match of text.matchAll(constRe)) {
                        stringConsts.set(match[1], match[2]);
                }
        }
        const referenced = new Map(); // view id -> [ "file:line", ... ]
        // TL4-002: createTreeView(<viewId>, { treeDataProvider }) counts as provider
        // wiring exactly like registerTreeDataProvider — the reveal-navigation
        // views need the TreeView handle (docs/FLAUZ-PROGRAM/TL4-PREMIUM-UX.md
        // section 5). Both call forms share the first-argument grammar.
        const callRe = /(?:registerTreeDataProvider|createTreeView)\s*\(\s*([^,)]+)/g;
        for (const file of extensionSrcFiles) {
                const text = fs.readFileSync(file, 'utf8');
                const lines = text.split('\n');
                for (let i = 0; i < lines.length; i++) {
                        for (const match of lines[i].matchAll(callRe)) {
                                const arg = match[1].trim();
                                const literal = /^['"]([^'"]+)['"]$/.exec(arg);
                                let viewId;
                                if (literal) {
                                        viewId = literal[1];
                                } else if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(arg)) {
                                        viewId = stringConsts.get(arg);
                                        if (viewId === undefined) {
                                                continue; // pass-through parameter — references no concrete view
                                        }
                                } else {
                                        continue; // dynamic expression — nothing concrete to check
                                }
                                if (!referenced.has(viewId)) { referenced.set(viewId, []); }
                                referenced.get(viewId).push(`${path.basename(file)}:${i + 1}`);
                        }
                }
        }
        return referenced;
}

function main() {
        let parsed;
        try {
                parsed = parseArgs({
                        allowPositionals: false,
                        options: {
                                root: { type: 'string', default: process.cwd() },
                                require: { type: 'boolean', default: false },
                                help: { type: 'boolean', default: false },
                        },
                });
        } catch (e) {
                process.stderr.write(`usage error: ${e.message}\n\n`);
                usage();
                process.exit(EXIT_USAGE);
        }
        const args = parsed.values;
        if (args.help) {
                usage();
                process.exit(EXIT_OK);
        }

        const base = path.resolve(args.root);
        const re = globToRegExp(DEFAULT_GLOB);
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
                const msg = `no manifests matched '${DEFAULT_GLOB}' under ${base} — flauz-* IA not present in this tree (documented SKIP; ia-gate deferred).`;
                if (args.require) { fail(msg); } else { report.push(`SKIP  ${msg}`); }
                process.stdout.write(report.join('\n') + '\n');
                process.exit(exit);
        }
        report.push(`ia-gate: checking ${manifests.length} flauz manifest(s) under ${base}`);

        // ---- parse every manifest; collect the IA surface ----------------------
        const parsedManifests = [];
        for (const m of manifests) {
                let pkg;
                try {
                        pkg = JSON.parse(fs.readFileSync(m.abs, 'utf8'));
                } catch (e) {
                        fail(`${m.rel}: not valid JSON — ${e.message}`);
                        continue;
                }
                parsedManifests.push({ rel: m.rel, dir: path.dirname(m.abs), name: pkg.name ?? '<no-name>', pkg });
        }

        const containerDefs = [];      // { manifest, id }
        const viewsByContainer = [];   // { manifest, containerKey, id, name }
        const welcomes = [];           // { manifest, view, contents }
        const commandDefs = [];        // { manifest, id, def }
        const startupUsers = [];       // extension names declaring onStartupFinished
        const seenCommandIds = new Map(); // id -> [manifest, ...]

        for (const m of parsedManifests) {
                const contributes = m.pkg.contributes ?? {};
                const containers = contributes.viewsContainers?.activitybar;
                if (Array.isArray(containers)) {
                        for (const c of containers) {
                                containerDefs.push({ manifest: m.rel, extension: m.name, id: typeof c?.id === 'string' ? c.id : '<invalid>', title: c?.title, icon: c?.icon });
                        }
                }
                const views = contributes.views;
                if (views !== undefined && typeof views === 'object' && !Array.isArray(views)) {
                        for (const [containerKey, entries] of Object.entries(views)) {
                                if (!Array.isArray(entries)) { continue; }
                                for (const v of entries) {
                                        viewsByContainer.push({ manifest: m.rel, extension: m.name, containerKey, id: typeof v?.id === 'string' ? v.id : '<invalid>', name: typeof v?.name === 'string' ? v.name : '' });
                                }
                        }
                }
                const welcomeList = contributes.viewsWelcome;
                if (Array.isArray(welcomeList)) {
                        for (const w of welcomeList) {
                                welcomes.push({ manifest: m.rel, view: typeof w?.view === 'string' ? w.view : '<invalid>', contents: typeof w?.contents === 'string' ? w.contents : '' });
                        }
                }
                const commands = contributes.commands;
                if (Array.isArray(commands)) {
                        for (const c of commands) {
                                const id = typeof c?.command === 'string' ? c.command : '<invalid>';
                                commandDefs.push({ manifest: m.rel, extension: m.name, id, def: c });
                                if (!seenCommandIds.has(id)) { seenCommandIds.set(id, []); }
                                seenCommandIds.get(id).push(m.rel);
                        }
                }
                if (Array.isArray(m.pkg.activationEvents) && m.pkg.activationEvents.includes('onStartupFinished')) {
                        startupUsers.push({ manifest: m.rel, extension: m.name });
                }
        }

        const flauzViews = viewsByContainer.filter(v => v.containerKey === CONTAINER_ID);
        const flauzViewIds = new Set(flauzViews.map(v => v.id));

        // ---- IA1: exactly one `flauz` activitybar container --------------------
        const flauzContainerDefs = containerDefs.filter(c => c.id === CONTAINER_ID);
        if (flauzContainerDefs.length === 0) {
                fail(`IA1 no activitybar container with id '${CONTAINER_ID}' is defined (flauz-workspace owns it — TL4-IA-SPEC.md section 2).`);
        } else if (flauzContainerDefs.length > 1) {
                fail(`IA1 the '${CONTAINER_ID}' activitybar container is defined ${flauzContainerDefs.length} times (${flauzContainerDefs.map(c => c.manifest).join(', ')}) — duplicate container definitions fight over 'workbench.view.extension.${CONTAINER_ID}'.`);
        } else {
                const def = flauzContainerDefs[0];
                if (def.extension !== CONTAINER_OWNER) {
                        fail(`IA1 the '${CONTAINER_ID}' container is defined by '${def.extension}' — the owner is '${CONTAINER_OWNER}' (TL4-IA-SPEC.md section 2).`);
                } else if (typeof def.title !== 'string' || def.title.length === 0 || typeof def.icon !== 'string' || def.icon.length === 0) {
                        fail(`IA1 the '${CONTAINER_ID}' container needs a non-empty title and icon (${def.manifest}).`);
                } else {
                        pass(`IA1 single '${CONTAINER_ID}' activitybar container (owner ${def.extension}, icon ${def.icon}).`);
                }
        }
        for (const other of containerDefs.filter(c => c.id !== CONTAINER_ID)) {
                fail(`IA1 ${other.manifest}: activitybar container '${other.id}' — flauz-* extensions contribute views only into the single '${CONTAINER_ID}' container (single-container law).`);
        }

        // ---- IA2: the expected view set ------------------------------------------
        for (const [viewId, owner] of EXPECTED_VIEWS) {
                const matches = viewsByContainer.filter(v => v.id === viewId);
                if (matches.length === 0) {
                        fail(`IA2 expected view '${viewId}' is missing (owner ${owner}).`);
                        continue;
                }
                if (matches.length > 1) {
                        fail(`IA2 view '${viewId}' is contributed ${matches.length} times (${matches.map(v => v.manifest).join(', ')}) — view ids must be globally unique.`);
                        continue;
                }
                const v = matches[0];
                if (v.extension !== owner) {
                        fail(`IA2 view '${viewId}' is contributed by '${v.extension}' — the owner is '${owner}'.`);
                        continue;
                }
                if (v.containerKey !== CONTAINER_ID) {
                        fail(`IA2 view '${viewId}' is contributed into container '${v.containerKey}' — flauz views live in container '${CONTAINER_ID}' (otherwise they degrade to the Explorer).`);
                        continue;
                }
                if (v.name.length === 0) {
                        fail(`IA2 view '${viewId}' (${v.manifest}) has an empty name.`);
                        continue;
                }
                pass(`IA2 view '${viewId}' — '${v.name}' (${v.extension}, container ${CONTAINER_ID}).`);
        }
        for (const v of viewsByContainer.filter(x => !EXPECTED_VIEWS.has(x.id))) {
                if (v.containerKey !== CONTAINER_ID) {
                        fail(`IA2 ${v.manifest}: view '${v.id}' is contributed into container '${v.containerKey}' — flauz views live in container '${CONTAINER_ID}'.`);
                } else {
                        warn(`IA2 ${v.manifest}: additional view '${v.id}' in container '${CONTAINER_ID}' (beyond the TL4-001 set) — welcome + provider + focus rules below still apply.`);
                }
        }

        // ---- IA3: welcome states --------------------------------------------------
        for (const v of flauzViews) {
                const entries = welcomes.filter(w => w.view === v.id);
                if (entries.length === 0) {
                        fail(`IA3 view '${v.id}' has no viewsWelcome entry — empty states are part of the product (TL4-IA-SPEC.md section 5).`);
                } else if (!entries.some(w => w.contents.trim().length > 0)) {
                        fail(`IA3 view '${v.id}' has a viewsWelcome entry with empty contents.`);
                } else {
                        pass(`IA3 view '${v.id}' has a viewsWelcome entry (${entries.length}).`);
                }
        }
        for (const w of welcomes) {
                if (!flauzViewIds.has(w.view)) {
                        fail(`IA3 ${w.manifest}: viewsWelcome entry points at '${w.view}' which is not a view contributed under container '${CONTAINER_ID}'.`);
                }
        }

        // ---- IA4: focus command family -------------------------------------------
        const focusPrefix = 'flauz.focusView';
        const expectedFocusCommands = [CONTAINER_FOCUS_COMMAND, ...[...EXPECTED_VIEWS.keys()].map(id => `${focusPrefix}.${id.slice('flauz.'.length)}`)];
        for (const cmd of expectedFocusCommands) {
                if (!seenCommandIds.has(cmd)) {
                        fail(`IA4 focus command '${cmd}' is missing (category "Flauz"; TL4-IA-SPEC.md section 4).`);
                }
        }
        for (const c of commandDefs) {
                if (!c.id.startsWith(focusPrefix)) { continue; }
                if (c.id !== CONTAINER_FOCUS_COMMAND && !c.id.startsWith(`${focusPrefix}.`)) {
                        warn(`IA4 ${c.manifest}: command '${c.id}' looks like a focus variant but does not follow 'flauz.focusView[.<view>]'.`);
                }
                if (c.def.category !== 'Flauz' || typeof c.def.title !== 'string' || c.def.title.length === 0) {
                        fail(`IA4 ${c.manifest}: focus command '${c.id}' needs category exactly "Flauz" and a non-empty title (got category ${JSON.stringify(c.def.category)}).`);
                }
        }
        const duplicates = [...seenCommandIds.entries()].filter(([, owners]) => owners.length > 1);
        for (const [id, owners] of duplicates) {
                fail(`IA4 command id '${id}' is declared ${owners.length} times (${owners.join(', ')}) — command ids must be globally unique across flauz-*.`);
        }
        if (duplicates.length === 0 && expectedFocusCommands.every(cmd => seenCommandIds.has(cmd))) {
                pass(`IA4 focus command family complete (${expectedFocusCommands.length} commands, category "Flauz", no duplicate ids).`);
        }

        // ---- IA5: activation budget -----------------------------------------------
        if (startupUsers.length > 2) {
                fail(`IA5 ${startupUsers.length} flauz-* extensions declare onStartupFinished (cap 2, PERF section 2.2 row 2): ${startupUsers.map(u => u.extension).join(', ')}.`);
        }
        for (const u of startupUsers) {
                if (!STARTUP_ALLOWED.has(u.extension)) {
                        fail(`IA5 ${u.manifest}: onStartupFinished is reserved for flauz-agent + flauz-workspace ('${u.extension}' must activate lazily — views via onView:).`);
                }
        }
        if (startupUsers.every(u => STARTUP_ALLOWED.has(u.extension)) && startupUsers.length <= 2) {
                pass(`IA5 onStartupFinished used by ${startupUsers.length} allowed extension(s)${startupUsers.length > 0 ? ` (${startupUsers.map(u => u.extension).join(', ')})` : ''}.`);
        }

        // ---- IA6: provider wiring (both directions) -------------------------------
        const srcFiles = [];
        for (const m of parsedManifests) {
                const srcDir = path.join(m.dir, 'src');
                if (fs.existsSync(srcDir)) {
                        for (const f of walkFiles(srcDir)) {
                                if (f.endsWith('.ts')) { srcFiles.push(f); }
                        }
                }
        }
        const referenced = scanProviderReferences(srcFiles);
        for (const [viewId, sites] of referenced) {
                if (!flauzViewIds.has(viewId)) {
                        fail(`IA6 registerTreeDataProvider('${viewId}') (${sites.join(', ')}) references a view id that no flauz-* manifest contributes under container '${CONTAINER_ID}'.`);
                }
        }
        for (const v of flauzViews) {
                const sites = referenced.get(v.id) ?? [];
                if (sites.length === 0) {
                        fail(`IA6 view '${v.id}' (${v.extension}) has no registerTreeDataProvider call in any flauz-* src — a tree view without a provider renders nothing.`);
                } else {
                        pass(`IA6 view '${v.id}' has a provider (${sites.join(', ')}).`);
                }
        }

        // ---- verdict ---------------------------------------------------------------
        process.stdout.write(report.join('\n') + '\n');
        if (exit === EXIT_OK) {
                process.stdout.write(`ia-gate: CLEAN (${flauzViews.length} view(s) in container '${CONTAINER_ID}', ${seenCommandIds.size} command id(s))\n`);
        } else {
                process.stdout.write('ia-gate: IA violations found (see FAIL lines above)\n');
        }
        process.exit(exit);
}

main();
