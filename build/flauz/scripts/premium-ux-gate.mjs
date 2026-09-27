/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// ---------------------------------------------------------------------------------------------
// Flauz — TL4 (product quality). premium-ux-gate.mjs — premium UX discipline
// gate for extensions/flauz-* (TL4-002; docs/FLAUZ-PROGRAM/TL4-PREMIUM-UX.md
// section 10 — the spec defines the exact tokens this gate checks).
//
// TL4-HANDOFF: "Treat premium as measured interaction, visual and recovery
// quality." This gate machine-checks the coherence layer so the six surfaces
// cannot drift apart again:
//
// Rules:
//   PU1 welcome quality : every view contributed under container `flauz` has a
//                         viewsWelcome entry with >= 1 command link
//                         (`](command:…)`) AND >= 1 guidance sentence (a
//                         non-link line >= 30 chars ending . ! ? or :) —
//                         empty states carry the primary next action plus an
//                         explanation (premium spec section 3).
//   PU2 state tokens    : every tree-provider source file (flauz-* src
//                         implementing the TreeDataProvider type) references
//                         the state-template token contract: the shared error
//                         context `flauzError`, a Retry-titled row command
//                         (title: 'Retry'), a flauz.*refresh* retry command id,
//                         `tooltip` and `accessibilityInformation` — OR carries
//                         the marker comment
//                         `premium-ux-gate: no-failure-source` (documented
//                         exemption for providers whose data source cannot
//                         fail; premium spec sections 4/6/9).
//   PU3 focus family    : every view contributed under container `flauz` has
//                         the matching `flauz.focusView.<view>` command with
//                         category exactly "Flauz" and a non-empty title (F1
//                         discoverability; premium spec section 5).
//   PU4 title case      : every flauz-* `contributes.commands[].title` is
//                         title-cased (each word's first alpha char uppercase,
//                         allowlist of small words: a an and as at but by for
//                         from in nor of on or per the to up via vs); every
//                         contributed user-facing description string
//                         (commands[].description, chatParticipants[].description,
//                         chatParticipants[].commands[].description,
//                         languageModelTools[].userDescription/modelDescription)
//                         starts sentence-case.
//   PU5 stock visuals   : no flauz-* manifest contributes webviews /
//                         customEditors / webviewView; no flauz-* source calls
//                         createWebviewPanel / createWebviewView; no .css /
//                         .ttf / .otf / .woff / .woff2 file exists under
//                         extensions/flauz-*/ (no custom CSS, no icon fonts —
//                         premium spec sections 2.3/6).
//   PU6 one date impl   : every extensions/flauz-*/src/format.ts defines
//                         formatTimestamp; all copies normalize identically
//                         (<= 1 distinct implementation, 0 files valid — the
//                         verbatim-duplication decision, premium spec section
//                         2.4); no flauz-* source outside format.ts performs
//                         ad-hoc date formatting (toLocaleString / toISOString
//                         / toDateString / toLocaleDateString /
//                         toLocaleTimeString / new Date().
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
//        node premium-ux-gate.mjs [--root <repo>] [--require]
//        node premium-ux-gate.mjs --root test/fixtures/premium-ux-gate/clean --require
//
// Exit codes: 0 = clean (or documented SKIP) · 1 = premium-UX violation (or a
// manifest that is not valid JSON) · 2 = usage error.
//
// Zero dependencies: node >= 20 stdlib only.
// ---------------------------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const EXIT_OK = 0, EXIT_FAIL = 1, EXIT_USAGE = 2;

const DEFAULT_GLOB = 'extensions/flauz-*/package.json';
const CONTAINER_ID = 'flauz';
const FOCUS_PREFIX = 'flauz.focusView';

/** Small words allowed lowercase inside title-cased command titles. */
const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'nor', 'of', 'on', 'or', 'per', 'the', 'to', 'up', 'via', 'vs']);

/** PU2 marker comment for providers whose data source cannot fail (spec section 9). */
const NO_FAILURE_MARKER = 'premium-ux-gate: no-failure-source';

/** Static-asset extensions that would mean custom CSS or icon fonts (PU5). */
const FORBIDDEN_ASSET_EXTENSIONS = new Set(['.css', '.ttf', '.otf', '.woff', '.woff2']);

/** Ad-hoc date formatting calls banned outside src/format.ts (PU6). */
const AD_HOC_DATE_RE = /\b(?:toLocaleString|toISOString|toDateString|toLocaleDateString|toLocaleTimeString)\s*\(|\bnew\s+Date\s*\(/;

function usage() {
	process.stdout.write(`premium-ux-gate.mjs — premium UX discipline gate for extensions/flauz-* (TL4-002)

Usage:
	node premium-ux-gate.mjs [--root <repo>] [--require]
	node premium-ux-gate.mjs --root test/fixtures/premium-ux-gate/clean --require

Options:
	--root <dir>    root dir for the manifests glob (default: cwd)
	--require       fail when zero manifests are found (default: SKIP notice, exit 0)
	-h, --help      show this help

Rules: PU1 welcome link + guidance sentence · PU2 state-template tokens per
provider file (flauzError + Retry + flauz.*refresh* + tooltip +
accessibilityInformation, or the no-failure-source marker) · PU3 focus
command per view (category "Flauz") · PU4 title-cased command titles +
sentence-cased descriptions · PU5 no webviews / custom CSS / icon fonts ·
PU6 single formatTimestamp implementation + no ad-hoc date formatting.

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

/** Strips comments and ALL whitespace — the PU6 normalization (byte-identity modulo layout). */
function normalizeSource(text) {
	return text
		.replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
		.replace(/\/\/[^\n]*/g, '')          // line comments
		.replace(/\s+/g, '');                // all whitespace
}

/** First alpha character of a token, lowercase (null when the token has none). */
function firstAlphaLower(token) {
	const match = /[A-Za-z]/.exec(token);
	return match === null ? null : match[0].toLowerCase();
}

/** The word a title token represents (leading non-letters stripped, trailing punctuation kept off the decision). */
function tokenWord(token) {
	const stripped = token.replace(/^[^A-Za-z]+/, '');
	const word = /^[A-Za-z][A-Za-z0-9'-]*/.exec(stripped);
	return word === null ? '' : word[0];
}

/** PU4: title-case check for one command title. Returns a violation message or null. */
function titleCaseViolation(title) {
	for (const token of title.split(/\s+/)) {
		if (token.length === 0) { continue; }
		const word = tokenWord(token);
		if (word.length === 0) { continue; }            // no letters (numbers, punctuation)
		const lower = word.toLowerCase();
		const first = word[0];
		if (SMALL_WORDS.has(lower)) { continue; }        // allowlisted small word
		if (first !== first.toUpperCase()) {
			return `word '${word}' is not capitalized (small-word allowlist: ${[...SMALL_WORDS].join(' ')})`;
		}
	}
	return null;
}

/** PU4: sentence-case check for one description string. Returns a violation message or null. */
function sentenceCaseViolation(text) {
	const match = /[A-Za-z]/.exec(text);
	if (match === null) { return null; }                // no letters — nothing to check
	if (match[0] !== match[0].toUpperCase()) {
		return 'does not start sentence-case (first letter must be uppercase)';
	}
	return null;
}

/** PU1: does a viewsWelcome contents string carry a command link and a guidance sentence? */
function welcomeQuality(contents) {
	const linkRe = /\]\(command:[^)]+\)/;
	const hasLink = linkRe.test(contents);
	let hasGuidance = false;
	for (const rawLine of contents.split('\n')) {
		const line = rawLine.trim();
		if (line.length === 0 || linkRe.test(line)) { continue; }
		if (line.length >= 30 && /[.!?:]$/.test(line)) { hasGuidance = true; break; }
	}
	return { hasLink, hasGuidance };
}

/** True when the file is a tree-provider source (PU2 scope: files implementing the TreeDataProvider type — the wiring inside extension.ts passes providers as parameters and references no provider type). */
function isProviderSource(text) {
	return /\bTreeDataProvider\s*</.test(text);
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
		const msg = `no manifests matched '${DEFAULT_GLOB}' under ${base} — flauz-* premium UX not present in this tree (documented SKIP; premium-ux-gate deferred).`;
		if (args.require) { fail(msg); } else { report.push(`SKIP  ${msg}`); }
		process.stdout.write(report.join('\n') + '\n');
		process.exit(exit);
	}
	report.push(`premium-ux-gate: checking ${manifests.length} flauz manifest(s) under ${base}`);

	// ---- parse every manifest; collect the surface --------------------------------
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

	const flauzViews = [];            // { manifest, id, name }
	const welcomes = [];              // { manifest, view, contents }
	const commandDefs = [];           // { manifest, id, title, category, description? }
	const descriptionStrings = [];    // { manifest, where, text }

	for (const m of parsedManifests) {
		const contributes = m.pkg.contributes ?? {};
		const views = contributes.views;
		if (views !== undefined && typeof views === 'object' && !Array.isArray(views)) {
			for (const [containerKey, entries] of Object.entries(views)) {
				if (!Array.isArray(entries) || containerKey !== CONTAINER_ID) { continue; }
				for (const v of entries) {
					flauzViews.push({ manifest: m.rel, id: typeof v?.id === 'string' ? v.id : '<invalid>', name: typeof v?.name === 'string' ? v.name : '' });
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
				commandDefs.push({ manifest: m.rel, id, title: typeof c?.title === 'string' ? c.title : '', category: c?.category });
				if (typeof c?.description === 'string' && c.description.length > 0) {
					descriptionStrings.push({ manifest: m.rel, where: `command '${id}' description`, text: c.description });
				}
			}
		}
		const participants = contributes.chatParticipants;
		if (Array.isArray(participants)) {
			for (const p of participants) {
				if (typeof p?.description === 'string' && p.description.length > 0) {
					descriptionStrings.push({ manifest: m.rel, where: `chat participant '${p?.id ?? '<invalid>'}' description`, text: p.description });
				}
				for (const sc of Array.isArray(p?.commands) ? p.commands : []) {
					if (typeof sc?.description === 'string' && sc.description.length > 0) {
						descriptionStrings.push({ manifest: m.rel, where: `chat slash command '${sc?.name ?? '<invalid>'}' description`, text: sc.description });
					}
				}
			}
		}
		const tools = contributes.languageModelTools;
		if (Array.isArray(tools)) {
			for (const t of tools) {
				for (const key of ['userDescription', 'modelDescription']) {
					if (typeof t?.[key] === 'string' && t[key].length > 0) {
						descriptionStrings.push({ manifest: m.rel, where: `language model tool '${t?.name ?? '<invalid>'}' ${key}`, text: t[key] });
					}
				}
			}
		}

		// PU5 manifest half: no webview-family contribution points.
		for (const key of ['webviews', 'customEditors', 'webviewView']) {
			if (contributes[key] !== undefined) {
				fail(`PU5 ${m.rel}: contributes '${key}' — Flauz surfaces are tree views; webviews are out of scope (premium spec section 12).`);
			}
		}
	}

	// ---- PU1: welcome quality ------------------------------------------------------
	for (const v of flauzViews) {
		const entries = welcomes.filter(w => w.view === v.id && w.contents.trim().length > 0);
		if (entries.length === 0) {
			fail(`PU1 view '${v.id}' has no non-empty viewsWelcome entry (empty states are part of the product).`);
			continue;
		}
		const quality = entries.map(w => welcomeQuality(w.contents));
		if (!quality.some(q => q.hasLink)) {
			fail(`PU1 view '${v.id}' welcome content has no command link — an empty state must carry its primary next action (premium spec section 3).`);
		}
		if (!quality.some(q => q.hasGuidance)) {
			fail(`PU1 view '${v.id}' welcome content has no guidance sentence — an empty state must explain the surface (a non-link line >= 30 chars ending . ! ? or :).`);
		}
		if (quality.some(q => q.hasLink && q.hasGuidance)) {
			pass(`PU1 view '${v.id}' welcome content carries a command link + a guidance sentence.`);
		}
	}

	// ---- PU2: state-template tokens per provider file --------------------------------
	const providerFiles = [];
	for (const m of parsedManifests) {
		const srcDir = path.join(m.dir, 'src');
		if (!fs.existsSync(srcDir)) { continue; }
		for (const f of walkFiles(srcDir)) {
			if (!f.endsWith('.ts')) { continue; }
			const text = fs.readFileSync(f, 'utf8');
			if (isProviderSource(text)) {
				providerFiles.push({ manifest: m.rel, abs: f, text });
			}
		}
	}
	if (providerFiles.length === 0) {
		warn('PU2 no tree-provider source files found under flauz-* src — nothing to check (unexpected with views present).');
	}
	for (const pf of providerFiles) {
		const rel = path.relative(base, pf.abs).split(path.sep).join('/');
		if (pf.text.includes(NO_FAILURE_MARKER)) {
			pass(`PU2 ${rel}: no-failure-source marker — documented exemption (no loading/error path by design).`);
			continue;
		}
		const missing = [];
		if (!pf.text.includes('flauzError')) { missing.push("shared error context 'flauzError'"); }
		if (!/title:\s*['"]Retry['"]/.test(pf.text)) { missing.push("Retry-titled row command (title: 'Retry')"); }
		if (!/flauz\.[A-Za-z.]*refresh[A-Za-z]*/.test(pf.text)) { missing.push('a flauz.*refresh* retry command id'); }
		if (!pf.text.includes('tooltip')) { missing.push('row tooltips'); }
		if (!pf.text.includes('accessibilityInformation')) { missing.push('accessibilityInformation labels'); }
		if (missing.length > 0) {
			fail(`PU2 ${rel}: state-template tokens missing — ${missing.join('; ')} (premium spec sections 4/6; or declare the no-failure-source marker).`);
		} else {
			pass(`PU2 ${rel}: state-template tokens present (flauzError + Retry + retry command + tooltip + a11y).`);
		}
	}

	// ---- PU3: focus command per view --------------------------------------------------
	for (const v of flauzViews) {
		const shortName = v.id.startsWith('flauz.') ? v.id.slice('flauz.'.length) : v.id;
		const wanted = `${FOCUS_PREFIX}.${shortName}`;
		const defs = commandDefs.filter(c => c.id === wanted);
		if (defs.length === 0) {
			fail(`PU3 view '${v.id}' has no focus command '${wanted}' (category "Flauz"; premium spec section 5).`);
			continue;
		}
		const def = defs[0];
		if (def.category !== 'Flauz' || def.title.length === 0) {
			fail(`PU3 focus command '${wanted}' needs category exactly "Flauz" and a non-empty title (${def.manifest}).`);
		} else {
			pass(`PU3 view '${v.id}' focus command '${wanted}' (category "Flauz").`);
		}
	}

	// ---- PU4: title-cased command titles + sentence-cased descriptions ------------------
	let titleCaseFails = 0;
	for (const c of commandDefs) {
		if (c.title.length === 0) {
			fail(`PU4 ${c.manifest}: command '${c.id}' has an empty title.`);
			titleCaseFails++;
			continue;
		}
		const violation = titleCaseViolation(c.title);
		if (violation !== null) {
			fail(`PU4 ${c.manifest}: command '${c.id}' title '${c.title}' — ${violation}.`);
			titleCaseFails++;
		}
	}
	if (titleCaseFails === 0 && commandDefs.length > 0) {
		pass(`PU4 all ${commandDefs.length} command title(s) are title-cased.`);
	}
	let sentenceFails = 0;
	for (const d of descriptionStrings) {
		const violation = sentenceCaseViolation(d.text);
		if (violation !== null) {
			fail(`PU4 ${d.manifest}: ${d.where} — ${violation} (text: ${JSON.stringify(d.text.slice(0, 60))}).`);
			sentenceFails++;
		}
	}
	if (sentenceFails === 0 && descriptionStrings.length > 0) {
		pass(`PU4 all ${descriptionStrings.length} contributed description string(s) start sentence-case.`);
	}

	// ---- PU5: stock visuals only (source + asset halves) --------------------------------
	let webviewCalls = 0;
	for (const m of parsedManifests) {
		const srcDir = path.join(m.dir, 'src');
		if (!fs.existsSync(srcDir)) { continue; }
		for (const f of walkFiles(srcDir)) {
			if (!f.endsWith('.ts')) { continue; }
			const text = fs.readFileSync(f, 'utf8');
			if (/\bcreateWebviewPanel\s*\(|\bcreateWebviewView\s*\(/.test(text)) {
				const rel = path.relative(base, f).split(path.sep).join('/');
				fail(`PU5 ${rel}: webview creation call — Flauz surfaces are tree views (premium spec section 12).`);
				webviewCalls++;
			}
		}
	}
	let forbiddenAssets = 0;
	for (const m of parsedManifests) {
		for (const f of walkFiles(m.dir)) {
			if (FORBIDDEN_ASSET_EXTENSIONS.has(path.extname(f).toLowerCase())) {
				const rel = path.relative(base, f).split(path.sep).join('/');
				fail(`PU5 ${rel}: forbidden static asset ('${path.extname(f)}') — no custom CSS, no icon fonts under flauz-* (premium spec sections 2.3/6).`);
				forbiddenAssets++;
			}
		}
	}
	if (webviewCalls === 0 && forbiddenAssets === 0) {
		pass(`PU5 no webview contributions, no webview creation calls, no css/font assets under the ${parsedManifests.length} flauz extension(s).`);
	}

	// ---- PU6: one date implementation ----------------------------------------------------
	const formatFiles = [];
	for (const m of parsedManifests) {
		const candidate = path.join(m.dir, 'src', 'format.ts');
		if (fs.existsSync(candidate)) {
			formatFiles.push({ manifest: m.rel, abs: candidate, text: fs.readFileSync(candidate, 'utf8') });
		}
	}
	for (const ff of formatFiles) {
		if (!/(?:function|const)\s+formatTimestamp\b/.test(ff.text)) {
			fail(`PU6 ${ff.manifest}/src/format.ts: does not define formatTimestamp — the shared module contract (premium spec section 2.4).`);
		}
	}
	const distinct = new Set(formatFiles.map(ff => normalizeSource(ff.text)));
	if (distinct.size > 1) {
		fail(`PU6 ${distinct.size} distinct format.ts implementations across flauz-* (${formatFiles.map(ff => ff.manifest).join(', ')}) — the verbatim-duplication decision allows exactly ONE distinct implementation (premium spec section 2.4).`);
	} else if (formatFiles.length > 0) {
		pass(`PU6 single distinct formatTimestamp implementation (${formatFiles.length} verbatim copy/copies: ${formatFiles.map(ff => ff.manifest).join(', ')}).`);
	} else {
		pass('PU6 no format.ts present — 0 implementations (valid when no surface renders timestamps).');
	}
	let adHocDates = 0;
	for (const m of parsedManifests) {
		const srcDir = path.join(m.dir, 'src');
		if (!fs.existsSync(srcDir)) { continue; }
		for (const f of walkFiles(srcDir)) {
			if (!f.endsWith('.ts') || path.basename(f) === 'format.ts') { continue; }
			const text = fs.readFileSync(f, 'utf8');
			if (AD_HOC_DATE_RE.test(text)) {
				const rel = path.relative(base, f).split(path.sep).join('/');
				fail(`PU6 ${rel}: ad-hoc date formatting outside src/format.ts — timestamps go through the shared module (premium spec section 2.4).`);
				adHocDates++;
			}
		}
	}
	if (adHocDates === 0) {
		pass('PU6 no ad-hoc date formatting outside the shared module.');
	}

	// ---- verdict ---------------------------------------------------------------------------
	process.stdout.write(report.join('\n') + '\n');
	if (exit === EXIT_OK) {
		process.stdout.write(`premium-ux-gate: CLEAN (${flauzViews.length} view(s), ${providerFiles.length} provider file(s), ${commandDefs.length} command title(s), ${formatFiles.length} format.ts cop(ies))\n`);
	} else {
		process.stdout.write('premium-ux-gate: premium UX violations found (see FAIL lines above)\n');
	}
	process.exit(exit);
}

main();
