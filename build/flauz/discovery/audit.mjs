/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// ---------------------------------------------------------------------------------------------
// Flauz — TL4 (product quality). audit.mjs — the P2-003 discovery-audit
// engine for p2-003-discovery-gate.mjs.
//
// Loads the flauz-* surface (manifests + view sources + the shipped guide +
// the packaging-parity registry) and evaluates the DA01..DA23 rubric
// (rubric.mjs) as STATIC USER-FACING CONTRACTS over the real sources — the
// ia-gate/premium-ux-gate evidence class. Every check returns per-row:
//
//   { status: 'pass' | 'miss', misses: [{ subject, detail }], evidence: [] }
//
// A row whose target surface cannot even be located reports a miss on that
// surface (fail-closed — never SKIP-as-PASS). The CLI maps misses against
// the pinned KNOWN_GAPS registry to separate routed findings from
// regressions.
//
// Zero dependencies: node >= 20 stdlib only.
// ---------------------------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { EXPECTED_VIEWS, CONTAINER_ID, NO_FAILURE_MARKER, PRIMARY_ACTIONS, RUBRIC } from './rubric.mjs';

const EXIT_OK = 0, EXIT_FAIL = 1, EXIT_USAGE = 2;

/** The provider/source files the row contracts read (paths relative to the repo root). */
const WORKSPACE_VIEWS = 'extensions/flauz-workspace/src/views.ts';
const AGENT_SESSIONS_VIEW = 'extensions/flauz-agent/src/sessionsView.ts';
const ENVIRONMENTS_VIEW = 'extensions/flauz-environments/src/views.ts';
const BROWSER_VIEW = 'extensions/flauz-browser/src/views.ts';
const MODELS_VIEW = 'extensions/flauz-models/src/views.ts';
const PARTICIPANT_SRC = 'extensions/flauz-agent/src/participant.ts';
const ORCHESTRATOR_SRC = 'extensions/flauz-agent/src/orchestrator.ts';
const TERMINAL_TOOL_SRC = 'extensions/flauz-agent/src/tools/terminalTool.ts';

/** Ad-hoc date formatting banned outside src/format.ts (premium spec section 2.4). */
const AD_HOC_DATE_RE = /\b(?:toLocaleString|toISOString|toDateString|toLocaleDateString|toLocaleTimeString)\s*\(|\bnew\s+Date\s*\(/;

// ---- shared helpers -------------------------------------------------------------------------

export function walkFiles(rootDir) {
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

/** Strips comments and ALL whitespace (PU6's normalization, reused by DA14). */
function normalizeSource(text) {
	return text
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/\/\/[^\n]*/g, '')
		.replace(/\s+/g, '');
}

/** The user-facing search corpus for capability-word rows (DA11/DA16). */
function userFacingCorpus(surface) {
	const parts = [];
	for (const w of surface.welcomes) { parts.push(w.contents); }
	for (const c of surface.commands) {
		parts.push(c.def.title ?? '');
		parts.push(typeof c.def.description === 'string' ? c.def.description : '');
	}
	for (const p of surface.participants) {
		parts.push(p.description ?? '');
		for (const sc of Array.isArray(p.commands) ? p.commands : []) {
			parts.push(sc.description ?? '');
		}
	}
	for (const t of surface.tools) {
		parts.push(t.userDescription ?? '');
	}
	if (surface.guide !== undefined) { parts.push(surface.guide.text); }
	for (const rel of [WORKSPACE_VIEWS, AGENT_SESSIONS_VIEW, ENVIRONMENTS_VIEW, BROWSER_VIEW, MODELS_VIEW]) {
		const text = surface.sources.get(rel);
		if (text !== undefined) { parts.push(text); }
	}
	return parts;
}

/** True when the file is a tree-provider source (premium-ux-gate's PU2 scope rule). */
function isProviderSource(text) {
	return /\bTreeDataProvider\s*</.test(text);
}

/** Does a viewsWelcome contents string carry a command link + guidance sentence? (PU1 logic) */
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

// ---- surface loading ------------------------------------------------------------------------

/**
 * Loads everything the rubric reads from a tree: flauz-* manifests, their
 * src .ts files, the shipped Flauz guide and (when present) the
 * packaging-parity registry.
 */
export function loadSurface(rootDir) {
	const base = path.resolve(rootDir);
	const surface = {
		root: base,
		manifests: [],        // { rel, dir, name, pkg }
		views: [],             // { manifest, extension, containerKey, id, name }
		welcomes: [],          // { manifest, view, contents }
		commands: [],          // { manifest, extension, id, def }
		participants: [],      // { manifest, ...participant }
		tools: [],             // { manifest, ...tool }
		sources: new Map(),   // rel path -> text
		guide: undefined,      // { rel, text }
		parityRows: undefined, // parsed packaging-parity rows
		extensionDirs: new Set(),
	};

	const manifestRe = globToRegExp('extensions/flauz-*/package.json');
	for (const f of walkFiles(base)) {
		const rel = path.relative(base, f).split(path.sep).join('/');
		if (manifestRe.test(rel)) {
			let pkg;
			try {
				pkg = JSON.parse(fs.readFileSync(f, 'utf8'));
			} catch {
				continue; // the gate fails rows that need this manifest's content
			}
			surface.manifests.push({ rel, dir: path.dirname(f), name: pkg.name ?? '<no-name>', pkg });
			surface.extensionDirs.add(rel.split('/')[1]);
		}
	}

	for (const m of surface.manifests) {
		const contributes = m.pkg.contributes ?? {};
		const views = contributes.views;
		if (views !== undefined && typeof views === 'object' && !Array.isArray(views)) {
			for (const [containerKey, entries] of Object.entries(views)) {
				if (!Array.isArray(entries)) { continue; }
				for (const v of entries) {
					surface.views.push({
						manifest: m.rel,
						extension: m.name,
						containerKey,
						id: typeof v?.id === 'string' ? v.id : '<invalid>',
						name: typeof v?.name === 'string' ? v.name : '',
					});
				}
			}
		}
		if (Array.isArray(contributes.viewsWelcome)) {
			for (const w of contributes.viewsWelcome) {
				surface.welcomes.push({
					manifest: m.rel,
					view: typeof w?.view === 'string' ? w.view : '<invalid>',
					contents: typeof w?.contents === 'string' ? w.contents : '',
				});
			}
		}
		if (Array.isArray(contributes.commands)) {
			for (const c of contributes.commands) {
				surface.commands.push({
					manifest: m.rel,
					extension: m.name,
					id: typeof c?.command === 'string' ? c.command : '<invalid>',
					def: c ?? {},
				});
			}
		}
		if (Array.isArray(contributes.chatParticipants)) {
			for (const p of contributes.chatParticipants) { surface.participants.push({ manifest: m.rel, ...p }); }
		}
		if (Array.isArray(contributes.languageModelTools)) {
			for (const t of contributes.languageModelTools) { surface.tools.push({ manifest: m.rel, ...t }); }
		}

		// sources: every .ts under the extension's src/ tree
		const srcDir = path.join(m.dir, 'src');
		if (fs.existsSync(srcDir)) {
			for (const f of walkFiles(srcDir)) {
				if (!f.endsWith('.ts')) { continue; }
				const rel = path.relative(base, f).split(path.sep).join('/');
				if (!surface.sources.has(rel)) {
					surface.sources.set(rel, fs.readFileSync(f, 'utf8'));
				}
			}
		}
	}

	// the shipped guide: flauz-workspace's own first, any flauz-* copy as fallback.
	const guidePrimary = 'extensions/flauz-workspace/flauz-guide.md';
	const guideAbs = path.join(base, guidePrimary);
	if (fs.existsSync(guideAbs)) {
		surface.guide = { rel: guidePrimary, text: fs.readFileSync(guideAbs, 'utf8') };
	} else {
		for (const f of walkFiles(base)) {
			const rel = path.relative(base, f).split(path.sep).join('/');
			if (/^extensions\/flauz-[^/]+\/flauz-guide\.md$/.test(rel)) {
				surface.guide = { rel, text: fs.readFileSync(f, 'utf8') };
				break;
			}
		}
	}

	const parityPath = path.join(base, 'build', 'flauz', 'packaging-parity.json');
	if (fs.existsSync(parityPath)) {
		try {
			const parsed = JSON.parse(fs.readFileSync(parityPath, 'utf8'));
			surface.parityRows = Array.isArray(parsed.rows) ? parsed.rows : [];
		} catch {
			surface.parityRows = [];
		}
	}

	return surface;
}

// ---- row checks -----------------------------------------------------------------------------

function checkRow(id, surface) {
	switch (id) {
		case 'DA01': return checkViews(surface);
		case 'DA02': return checkFocusFamily(surface);
		case 'DA03': return checkPrimaryActions(surface);
		case 'DA04': return checkGuidance(surface);
		case 'DA05': return checkHomeFolderBranch(surface);
		case 'DA06': return checkHomeRowsActionable(surface);
		case 'DA07': return checkAgentCapability(surface);
		case 'DA08': return checkBrowserCapability(surface);
		case 'DA09': return checkEnvironmentsCapability(surface);
		case 'DA10': return checkModelsHonesty(surface);
		case 'DA11': return checkWordDiscoverable(surface, /delegat|A2A|agent-to-agent/i, 'delegation/A2A');
		case 'DA12': return checkErrorGrammar(surface);
		case 'DA13': return checkRecovery(surface);
		case 'DA14': return checkTimeGrammar(surface);
		case 'DA15': return checkApprovalGates(surface);
		case 'DA16': return checkWordDiscoverable(surface, /takeover|take over/i, 'takeover');
		case 'DA17': return checkEvidenceProvenance(surface);
		case 'DA18': return checkLedgerVerifyAffordance(surface);
		case 'DA19': return checkNoDeadEnds(surface);
		case 'DA20': return checkPostActionRecovery(surface);
		case 'DA21': return checkA11yLabels(surface);
		case 'DA22': return checkKeyboardContract(surface);
		case 'DA23': return checkWebPosture(surface);
		default: return { status: 'miss', misses: [{ subject: id, detail: 'unknown rubric row' }], evidence: [] };
	}
}

/** DA01 — the seven views (TL4-001's six + flauz.lab), exactly, with their human-facing names, in one container. */
function checkViews(surface) {
	const misses = [];
	const evidence = [];
	const inContainer = surface.views.filter(v => v.containerKey === CONTAINER_ID);
	for (const [viewId, expectedName] of EXPECTED_VIEWS) {
		const matches = inContainer.filter(v => v.id === viewId);
		if (matches.length === 0) {
			misses.push({ subject: viewId, detail: `view '${viewId}' is not contributed under container '${CONTAINER_ID}'` });
			continue;
		}
		if (matches.length > 1) {
			misses.push({ subject: viewId, detail: `view '${viewId}' is contributed ${matches.length} times` });
			continue;
		}
		if (matches[0].name !== expectedName) {
			misses.push({ subject: viewId, detail: `view name is ${JSON.stringify(matches[0].name)}, expected ${JSON.stringify(expectedName)} (a raw id or a renamed surface breaks the six-view map a user learns once)` });
			continue;
		}
		evidence.push(`${matches[0].manifest}: '${viewId}' -> '${matches[0].name}'`);
	}
	for (const v of inContainer.filter(x => !EXPECTED_VIEWS.has(x.id))) {
		misses.push({ subject: v.id, detail: `unexpected view '${v.id}' in container '${CONTAINER_ID}' (beyond the audited six; extend the rubric deliberately, not silently)` });
	}
	return { status: misses.length === 0 ? 'pass' : 'miss', misses, evidence };
}

/** DA02 — container + per-view focus commands, category "Flauz", non-empty titles. */
function checkFocusFamily(surface) {
	const misses = [];
	const evidence = [];
	const byId = new Map(surface.commands.map(c => [c.id, c]));
	const expected = ['flauz.focusView', ...[...EXPECTED_VIEWS.keys()].map(id => `flauz.focusView.${id.slice('flauz.'.length)}`)];
	for (const cmd of expected) {
		const def = byId.get(cmd);
		if (def === undefined) {
			misses.push({ subject: cmd, detail: 'focus command missing — the view is not F1/palette reachable' });
			continue;
		}
		if (def.def.category !== 'Flauz' || typeof def.def.title !== 'string' || def.def.title.length === 0) {
			misses.push({ subject: cmd, detail: `needs category exactly "Flauz" and a non-empty title (got category ${JSON.stringify(def.def.category)})` });
			continue;
		}
		evidence.push(`${def.manifest}: '${cmd}' (${JSON.stringify(def.def.title)}, category Flauz)`);
	}
	return { status: misses.length === 0 ? 'pass' : 'miss', misses, evidence };
}

/** DA03 — every welcome links its surface's primary next action. */
function checkPrimaryActions(surface) {
	const misses = [];
	const evidence = [];
	for (const [viewId, primary] of PRIMARY_ACTIONS) {
		const entries = surface.welcomes.filter(w => w.view === viewId && w.contents.trim().length > 0);
		if (entries.length === 0) {
			misses.push({ subject: viewId, detail: 'no non-empty viewsWelcome entry — the empty state cannot carry any action' });
			continue;
		}
		if (primary.any.length === 0) {
			evidence.push(`${viewId}: no creation command exists in v0 (${primary.note})`);
			continue;
		}
		const linked = entries.some(w => primary.any.some(cmd => w.contents.includes(`](command:${cmd})`)));
		if (!linked) {
			misses.push({ subject: viewId, detail: `the welcome does not link the surface's primary next action (${primary.any.map(c => `\`${c}\``).join(' or ')}); ${primary.note}` });
		} else {
			evidence.push(`${viewId}: primary action linked (${primary.any.join(' or ')})`);
		}
	}
	return { status: misses.length === 0 ? 'pass' : 'miss', misses, evidence };
}

/** DA04 — every welcome carries a guidance sentence. */
function checkGuidance(surface) {
	const misses = [];
	const evidence = [];
	for (const viewId of EXPECTED_VIEWS.keys()) {
		const entries = surface.welcomes.filter(w => w.view === viewId && w.contents.trim().length > 0);
		if (entries.length === 0) {
			misses.push({ subject: viewId, detail: 'no non-empty viewsWelcome entry — the empty state explains nothing' });
			continue;
		}
		const quality = entries.map(w => welcomeQuality(w.contents));
		if (!quality.some(q => q.hasGuidance)) {
			misses.push({ subject: viewId, detail: 'welcome content has no guidance sentence (a non-link line >= 30 chars ending . ! ? or :) — the surface is unexplained to a new user' });
		} else {
			evidence.push(`${viewId}: guidance sentence present`);
		}
	}
	return { status: misses.length === 0 ? 'pass' : 'miss', misses, evidence };
}

/** DA05 — Home welcome: Open Folder link + the no-folder branch's view links. */
function checkHomeFolderBranch(surface) {
	const misses = [];
	const evidence = [];
	const entries = surface.welcomes.filter(w => w.view === 'flauz.home' && w.contents.trim().length > 0);
	if (entries.length === 0) {
		return { status: 'miss', misses: [{ subject: 'flauz.home', detail: 'no Home welcome to audit' }], evidence };
	}
	const contents = entries.map(w => w.contents).join('\n');
	if (!contents.includes('](command:workbench.action.files.openFolder)')) {
		misses.push({ subject: 'flauz.home', detail: 'the Home welcome does not link Open Folder (workbench.action.files.openFolder)' });
	} else {
		evidence.push('Open Folder link present');
	}
	if (!contents.includes('](command:flauz.focusView.tasks)') || !contents.includes('](command:flauz.focusView.environments)')) {
		misses.push({ subject: 'flauz.home', detail: 'the no-folder branch does not link View Tasks + View Environments (flauz.focusView.tasks / flauz.focusView.environments)' });
	} else {
		evidence.push('no-folder branch links Tasks + Environments');
	}
	if (!/no folder/i.test(contents)) {
		misses.push({ subject: 'flauz.home', detail: 'no "No folder" branch phrase — the first-run state is not addressed' });
	} else {
		evidence.push('"No folder" branch present');
	}
	return { status: misses.length === 0 ? 'pass' : 'miss', misses, evidence };
}

/** DA06 — every Home "not initialized" row carries an action command. */
function checkHomeRowsActionable(surface) {
	const misses = [];
	const evidence = [];
	const text = surface.sources.get(WORKSPACE_VIEWS);
	if (text === undefined) {
		return { status: 'miss', misses: [{ subject: WORKSPACE_VIEWS, detail: 'the Home provider source was not found' }], evidence };
	}
	const branchRe = /if \(!state\.present\) \{([\s\S]*?)\n\t\t\}/g;
	let branches = 0;
	for (const match of text.matchAll(branchRe)) {
		const body = match[1];
		if (!body.includes('\'not initialized\'')) { continue; }
		branches += 1;
		const idMatch = /id: '([A-Za-z-]+)'/.exec(body);
		const rowId = idMatch === null ? 'unknown' : idMatch[1];
		if (!/command:/.test(body)) {
			misses.push({
				subject: `home-${rowId}-not-initialized`,
				detail: `the Home "${rowId}: not initialized" row carries no command — the row is inert; selecting it does nothing (the tooltip explains the trigger, but there is no affordance to act)`,
			});
		} else {
			evidence.push(`home row '${rowId}' not-initialized branch carries a command`);
		}
	}
	if (branches === 0) {
		evidence.push('no "not initialized" Home rows in this tree (nothing to check)');
	}
	return { status: misses.length === 0 ? 'pass' : 'miss', misses, evidence };
}

/** DA07 — the agent capability: default participant + welcomes point to Chat. */
function checkAgentCapability(surface) {
	const misses = [];
	const evidence = [];
	const participant = surface.participants.find(p => p.id === 'flauz.agent');
	if (participant === undefined) {
		misses.push({ subject: 'flauz.agent-participant', detail: 'the flauz.agent chat participant is not contributed — the agent capability is undiscoverable' });
	} else {
		if (participant.isDefault !== true) {
			misses.push({ subject: 'flauz.agent-participant', detail: 'flauz.agent is not the default chat participant (isDefault !== true)' });
		} else {
			evidence.push('flauz.agent contributed as the DEFAULT participant');
		}
		const description = typeof participant.description === 'string' ? participant.description : '';
		if (description.length === 0 || !/approval|evidence/i.test(description)) {
			misses.push({ subject: 'flauz.agent-participant', detail: 'the participant description does not name the approval gates / evidence ledger — the capability is present but unexplained' });
		} else {
			evidence.push(`participant description: ${JSON.stringify(description)}`);
		}
	}
	const tasksWelcome = surface.welcomes.filter(w => w.view === 'flauz.tasks').map(w => w.contents).join('\n');
	if (!tasksWelcome.includes('](command:workbench.action.chat.open)')) {
		misses.push({ subject: 'flauz.tasks-welcome', detail: 'the Tasks welcome does not link Open Chat — task creation is not pointed at the agent' });
	} else {
		evidence.push('Tasks welcome links Open Chat');
	}
	const sessionsWelcome = surface.welcomes.filter(w => w.view === 'flauz.agentSessions').map(w => w.contents).join('\n');
	if (!/flauz agent/i.test(sessionsWelcome) || !sessionsWelcome.includes('](command:workbench.action.files.openFolder)')) {
		misses.push({ subject: 'flauz.agentSessions-welcome', detail: 'the Agent Sessions welcome does not name the Flauz agent or link Open Folder' });
	} else {
		evidence.push('Agent Sessions welcome names the agent + links Open Folder');
	}
	return { status: misses.length === 0 ? 'pass' : 'miss', misses, evidence };
}

/** DA08 — the browser capability: welcome links the policy action; the command family is categorized. */
function checkBrowserCapability(surface) {
	const misses = [];
	const evidence = [];
	const welcome = surface.welcomes.filter(w => w.view === 'flauz.browser').map(w => w.contents).join('\n');
	if (!welcome.includes('](command:flauz.browser.setPolicy)')) {
		misses.push({ subject: 'flauz.browser-welcome', detail: 'the Browser welcome does not link the policy-file action (flauz.browser.setPolicy)' });
	} else {
		evidence.push('Browser welcome links the policy-file action');
	}
	const setPolicy = surface.commands.find(c => c.id === 'flauz.browser.setPolicy');
	if (setPolicy === undefined || setPolicy.def.category !== 'Flauz' || typeof setPolicy.def.title !== 'string' || setPolicy.def.title.length === 0) {
		misses.push({ subject: 'flauz.browser.setPolicy', detail: 'the policy command is missing or not categorized "Flauz"' });
	} else {
		evidence.push(`flauz.browser.setPolicy (${JSON.stringify(setPolicy.def.title)}, category Flauz)`);
	}
	const family = surface.commands.filter(c => c.id.startsWith('flauz.browser.'));
	if (family.length < 5) {
		misses.push({ subject: 'flauz.browser-command-family', detail: `only ${family.length} flauz.browser.* commands — the capability surface looks truncated` });
	} else {
		evidence.push(`${family.length} flauz.browser.* commands (open/navigate/screenshot/policy/...)`);
	}
	return { status: misses.length === 0 ? 'pass' : 'miss', misses, evidence };
}

/** DA09 — the environments capability: welcome + the register command family. */
function checkEnvironmentsCapability(surface) {
	const misses = [];
	const evidence = [];
	const welcome = surface.welcomes.filter(w => w.view === 'flauz.environments').map(w => w.contents).join('\n');
	if (welcome.trim().length === 0) {
		misses.push({ subject: 'flauz.environments-welcome', detail: 'no Environments welcome content' });
	} else {
		evidence.push('Environments welcome explains the registry (.flauz/environments.json, trust/capabilities/plans)');
	}
	const register = surface.commands.find(c => c.id === 'flauz.env.register');
	if (register === undefined || register.def.category !== 'Flauz' || typeof register.def.title !== 'string' || register.def.title.length === 0) {
		misses.push({ subject: 'flauz.env.register', detail: 'the Register Environment command is missing or not categorized "Flauz"' });
	} else {
		evidence.push(`flauz.env.register (${JSON.stringify(register.def.title)}, category Flauz)`);
	}
	const family = surface.commands.filter(c => c.id.startsWith('flauz.env.'));
	if (family.length < 4) {
		misses.push({ subject: 'flauz.env-command-family', detail: `only ${family.length} flauz.env.* commands — the capability surface looks truncated` });
	} else {
		evidence.push(`${family.length} flauz.env.* commands (register/activate/lifecycle/continuity/...)`);
	}
	return { status: misses.length === 0 ? 'pass' : 'miss', misses, evidence };
}

/** DA10 — the models surface is honest (registered vs design stub, mock labeled). */
function checkModelsHonesty(surface) {
	const misses = [];
	const evidence = [];
	const welcome = surface.welcomes.filter(w => w.view === 'flauz.models').map(w => w.contents).join('\n');
	if (!welcome.includes('flauz-mock')) {
		misses.push({ subject: 'flauz.models-welcome', detail: 'the Models welcome does not name the deterministic flauz-mock provider — the default model posture is unexplained' });
	} else {
		evidence.push('Models welcome names flauz-mock (deterministic, on demand)');
	}
	const text = surface.sources.get(MODELS_VIEW);
	if (text === undefined) {
		misses.push({ subject: MODELS_VIEW, detail: 'the Models view source was not found' });
	} else {
		if (!text.includes('design stub · not registered')) {
			misses.push({ subject: 'flauz.models-view-honesty', detail: 'the view rows do not label design stubs as "design stub · not registered" — a stub could be mistaken for a registered provider' });
		} else {
			evidence.push('stub rows labeled "design stub · not registered"');
		}
		if (!text.includes('· registered ·')) {
			misses.push({ subject: 'flauz.models-view-honesty', detail: 'registered provider rows are not labeled "registered" — the honest registered/stub split is broken' });
		} else {
			evidence.push('registered rows labeled "registered"');
		}
		if (!text.includes(NO_FAILURE_MARKER)) {
			misses.push({ subject: 'flauz.models-view-honesty', detail: 'the no-failure-source marker is absent — the dormant-welcome safety-net posture (spec section 9) is unproven' });
		} else {
			evidence.push('no-failure-source marker present (static registry data; dormant welcome is the safety net)');
		}
	}
	return { status: misses.length === 0 ? 'pass' : 'miss', misses, evidence };
}

/** DA11/DA16 — is the capability word discoverable from any user-facing surface? */
function checkWordDiscoverable(surface, wordRe, label) {
	const misses = [];
	const evidence = [];
	for (const part of userFacingCorpus(surface)) {
		const match = wordRe.exec(part);
		if (match !== null) {
			const index = Math.max(0, match.index - 40);
			evidence.push(`mentioned: ...${part.slice(index, match.index + match[0].length + 40).replace(/\n/g, ' ')}...`);
			break;
		}
	}
	if (evidence.length === 0) {
		misses.push({
			subject: 'product-wide',
			detail: `no user-facing surface (viewsWelcome contents, command titles/descriptions, chat participant, tool userDescriptions, the shipped guide, the six view sources) mentions ${label} — the capability is invisible without docs`,
		});
	}
	return { status: misses.length === 0 ? 'pass' : 'miss', misses, evidence };
}

/** DA12 — the shared error grammar on every failure-capable view source. */
function checkErrorGrammar(surface) {
	const misses = [];
	const evidence = [];
	const providerFiles = [...surface.sources.entries()].filter(([, text]) => isProviderSource(text));
	if (providerFiles.length === 0) {
		return { status: 'miss', misses: [{ subject: 'extensions/flauz-*/src', detail: 'no tree-provider sources found under flauz-* src' }], evidence };
	}
	for (const [rel, text] of providerFiles) {
		if (text.includes(NO_FAILURE_MARKER)) {
			evidence.push(`${rel}: no-failure-source marker — documented exemption (premium spec section 9)`);
			continue;
		}
		const missing = [];
		if (!text.includes('flauzError')) { missing.push('the shared error context `flauzError`'); }
		if (!/title:\s*['"]Retry['"]/.test(text)) { missing.push('a Retry-titled row command (title: \'Retry\')'); }
		if (!/Select(?:ing)? this row/.test(text)) { missing.push('the retry sentence (Select/Selecting this row …)'); }
		if (!/Unable to Load/.test(text) && !/deny-all in effect/.test(text)) {
			missing.push('the error-row label grammar (Unable to Load <Surface>, or the sanctioned Browser fail-closed deny-all row)');
		}
		if (missing.length > 0) {
			misses.push({ subject: rel, detail: `state/error grammar missing — ${missing.join('; ')}` });
		} else {
			evidence.push(`${rel}: flauzError + Retry + retry sentence + label grammar present`);
		}
	}
	return { status: misses.length === 0 ? 'pass' : 'miss', misses, evidence };
}

/** DA13 — recovery keeps last-known-good; Browser fails closed; Home degrades per section. */
function checkRecovery(surface) {
	const misses = [];
	const evidence = [];
	const checks = [
		{
			subject: 'flauz.tasks-recovery', file: WORKSPACE_VIEWS,
			detail: 'the Tasks provider keeps the last-known-good rows below the error row',
			tokens: [/lastKnownGood/, /last-known-good snapshot/],
		},
		{
			subject: 'flauz.environments-recovery', file: ENVIRONMENTS_VIEW,
			detail: 'the Environments provider keeps the last-known-good rows below the error row',
			tokens: [/lastKnownGood/, /last-known-good snapshot/],
		},
		{
			subject: 'flauz.agentSessions-recovery', file: AGENT_SESSIONS_VIEW,
			detail: 'live status rows stay when the active-task probe fails (error row appended after them)',
			tokens: [/bridgeStatusRows\(status\);[\s\S]{0,600}?kind: 'error'/],
		},
		{
			subject: 'flauz.browser-fail-closed', file: BROWSER_VIEW,
			detail: 'an invalid policy file renders the fail-closed deny-all row (never a stale policy)',
			tokens: [/deny-all in effect/],
		},
		{
			subject: 'flauz.home-degraded-sections', file: WORKSPACE_VIEWS,
			detail: 'a failed Home section renders a degraded row (description "unreadable") instead of blanking the view',
			tokens: [/'unreadable'/],
		},
	];
	for (const check of checks) {
		const text = surface.sources.get(check.file);
		if (text === undefined) {
			misses.push({ subject: check.subject, detail: `${check.file} not found — ${check.detail} is unverifiable` });
			continue;
		}
		const failed = check.tokens.filter(re => !re.test(text));
		if (failed.length > 0) {
			misses.push({ subject: check.subject, detail: `${check.detail} — missing contract evidence (${failed.map(String).join(', ')})` });
		} else {
			evidence.push(`${check.subject}: ${check.detail}`);
		}
	}
	return { status: misses.length === 0 ? 'pass' : 'miss', misses, evidence };
}

/** DA14 — one time grammar: ages/stamps only through the shared format.ts. */
function checkTimeGrammar(surface) {
	const misses = [];
	const evidence = [];
	const viewFiles = [WORKSPACE_VIEWS, AGENT_SESSIONS_VIEW, ENVIRONMENTS_VIEW, BROWSER_VIEW, MODELS_VIEW];
	for (const rel of viewFiles) {
		const text = surface.sources.get(rel);
		if (text === undefined) { continue; }
		if (/formatAge\s*\(/.test(text) && !/from ['"]\.\/format(\.ts)?['"]/.test(text)) {
			misses.push({ subject: rel, detail: 'renders relative ages without importing the shared format.ts — the time grammar would drift' });
		}
	}
	const formatFiles = [...surface.sources.keys()].filter(rel => /^extensions\/flauz-[^/]+\/src\/format\.ts$/.test(rel));
	if (formatFiles.length > 0) {
		for (const rel of formatFiles) {
			const text = surface.sources.get(rel);
			if (!/(?:function|const)\s+formatTimestamp\b/.test(text) || !/(?:function|const)\s+formatAge\b/.test(text)) {
				misses.push({ subject: rel, detail: 'format.ts must define both formatTimestamp and formatAge (the shared time grammar)' });
			}
		}
		const distinct = new Set(formatFiles.map(rel => normalizeSource(surface.sources.get(rel))));
		if (distinct.size > 1) {
			misses.push({ subject: 'extensions/flauz-*/src/format.ts', detail: `${distinct.size} distinct format.ts implementations (${formatFiles.join(', ')}) — the user would see drifting time formats across views` });
		} else {
			evidence.push(`single distinct format.ts implementation (${formatFiles.length} verbatim copy/copies)`);
		}
	} else {
		misses.push({ subject: 'extensions/flauz-*/src/format.ts', detail: 'no shared format.ts found under the flauz extensions — timestamps have no single grammar' });
	}
	// ad-hoc dates: the view-source files themselves never format dates inline.
	for (const rel of viewFiles) {
		const text = surface.sources.get(rel);
		if (text !== undefined && AD_HOC_DATE_RE.test(text)) {
			misses.push({ subject: rel, detail: 'ad-hoc date formatting in a view source — ages/stamps must go through the shared module' });
		}
	}
	if (misses.length === 0) {
		evidence.push('every view that renders ages imports the shared formatter');
	}
	return { status: misses.length === 0 ? 'pass' : 'miss', misses, evidence };
}

/** DA15 — approval gates: participant command descriptions, followups, named terminal confirmation. */
function checkApprovalGates(surface) {
	const misses = [];
	const evidence = [];
	const participant = surface.participants.find(p => p.id === 'flauz.agent');
	if (participant === undefined) {
		misses.push({ subject: 'flauz.agent-participant-commands', detail: 'the flauz.agent participant is not contributed' });
	} else {
		const commands = Array.isArray(participant.commands) ? participant.commands : [];
		if (commands.length < 4) {
			misses.push({ subject: 'flauz.agent-participant-commands', detail: `only ${commands.length} participant commands — the four human gates (approve/request-changes/sign-off/cancel) are incomplete` });
		} else {
			evidence.push(`${commands.length} participant commands contributed`);
		}
		for (const sc of commands) {
			const description = typeof sc.description === 'string' ? sc.description : '';
			if (description.length === 0 || !/human gate/i.test(description)) {
				misses.push({ subject: `participant-command:${sc.name ?? '<invalid>'}`, detail: `the /${sc.name ?? '?'} description does not mark it as a human gate — the user cannot tell which turns require THEM` });
			}
		}
		if (misses.length === 0) {
			evidence.push('every participant command description names the human gate');
		}
	}
	const participantSrc = surface.sources.get(PARTICIPANT_SRC);
	if (participantSrc === undefined) {
		misses.push({ subject: PARTICIPANT_SRC, detail: 'participant source not found — the chat followup buttons are unverifiable' });
	} else {
		const labels = ['Approve plan', 'Request changes', 'Sign off', 'Cancel task'];
		const missingLabels = labels.filter(label => !participantSrc.includes(label));
		if (missingLabels.length > 0) {
			misses.push({ subject: 'flauz.agent-followups', detail: `followup buttons missing: ${missingLabels.join(', ')} — the user must type the gates from memory` });
		} else {
			evidence.push('chat followups: Approve plan / Request changes / Sign off / Cancel task');
		}
	}
	const terminalTool = surface.sources.get(TERMINAL_TOOL_SRC);
	if (terminalTool === undefined) {
		misses.push({ subject: TERMINAL_TOOL_SRC, detail: 'terminal tool source not found — the confirmation gate wording is unverifiable' });
	} else if (!/Allow Flauz Agent to run/.test(terminalTool)) {
		misses.push({ subject: 'flauz_terminal-confirmation', detail: 'the terminal confirmation does not name WHAT will run ("Allow Flauz Agent to run <command> …")' });
	} else {
		evidence.push('terminal confirmation names the exact command ("Allow Flauz Agent to run …")');
	}
	const tool = surface.tools.find(t => t.name === 'flauz_terminal');
	const userDescription = tool !== undefined && typeof tool.userDescription === 'string' ? tool.userDescription : '';
	if (!/confirmation/i.test(userDescription)) {
		misses.push({ subject: 'flauz_terminal-userDescription', detail: 'the tool userDescription does not tell the user it asks for confirmation first' });
	} else {
		evidence.push(`tool userDescription: ${JSON.stringify(userDescription)}`);
	}
	return { status: misses.length === 0 ? 'pass' : 'miss', misses, evidence };
}

/** DA17 — evidence rows carry provenance. */
function checkEvidenceProvenance(surface) {
	const misses = [];
	const evidence = [];
	const text = surface.sources.get(WORKSPACE_VIEWS);
	if (text === undefined) {
		return { status: 'miss', misses: [{ subject: WORKSPACE_VIEWS, detail: 'the Tasks/evidence provider source was not found' }], evidence };
	}
	const checks = [
		{ token: 'SHA-256', detail: 'the evidence tooltip does not carry the SHA-256 — the user cannot tie a row to its artifact content' },
		{ token: 'Recorded:', detail: 'the evidence tooltip does not carry the recorded timestamp' },
		{ token: 'flauz.workspace.openEvidence', detail: 'evidence rows do not open their artifact (flauz.workspace.openEvidence)' },
		{ token: 'formatAge(row.ts', detail: 'evidence rows do not render the record age in the row grammar' },
	];
	for (const check of checks) {
		if (!text.includes(check.token)) {
			misses.push({ subject: 'flauz.tasks-evidence-rows', detail: check.detail });
		}
	}
	if (misses.length === 0) {
		evidence.push('evidence rows: id + kind + uri + age in the description; SHA-256 + UTC timestamps in the tooltip; selecting opens the artifact');
	}
	return { status: misses.length === 0 ? 'pass' : 'miss', misses, evidence };
}

/** DA18 — the ledger verify affordance exists and is palette-categorized. */
function checkLedgerVerifyAffordance(surface) {
	const misses = [];
	const evidence = [];
	for (const id of ['flauz.verifyLedger', 'flauz.showTasks']) {
		const def = surface.commands.find(c => c.id === id);
		if (def === undefined) {
			misses.push({ subject: id, detail: 'the command is missing — the affordance does not exist' });
			continue;
		}
		if (def.def.category !== 'Flauz' || typeof def.def.title !== 'string' || def.def.title.length === 0) {
			misses.push({
				subject: id,
				detail: `needs category exactly "Flauz" and a non-empty title (got category ${JSON.stringify(def.def.category)}) — it groups outside the Flauz palette family, and its title must not collide with the view-focus commands`,
			});
		} else {
			evidence.push(`${id} (${JSON.stringify(def.def.title)}, category Flauz)`);
		}
	}
	return { status: misses.length === 0 ? 'pass' : 'miss', misses, evidence };
}

/** DA19 — no dead-end empty states: every view has a welcome with at least one action link. */
function checkNoDeadEnds(surface) {
	const misses = [];
	const evidence = [];
	for (const viewId of EXPECTED_VIEWS.keys()) {
		const entries = surface.welcomes.filter(w => w.view === viewId && w.contents.trim().length > 0);
		if (entries.length === 0) {
			misses.push({ subject: viewId, detail: 'no non-empty welcome — the empty state is a dead end (blank tree)' });
			continue;
		}
		if (!entries.some(w => welcomeQuality(w.contents).hasLink)) {
			misses.push({ subject: viewId, detail: 'the welcome carries no command link — the empty state shows text but offers no way forward' });
		} else {
			evidence.push(`${viewId}: empty state carries an action link`);
		}
	}
	return { status: misses.length === 0 ? 'pass' : 'miss', misses, evidence };
}

/** DA20 — post-action states are recoverable. */
function checkPostActionRecovery(surface) {
	const misses = [];
	const evidence = [];
	const orchestrator = surface.sources.get(ORCHESTRATOR_SRC);
	if (orchestrator === undefined) {
		misses.push({ subject: ORCHESTRATOR_SRC, detail: 'the orchestrator source was not found — the failure/verify paths are unverifiable' });
	} else {
		// The verify-fail message tells the user the task returned to an
		// approvable state and how to retry (the source escapes the
		// backticks inside the template literal — both spellings match).
		if (!/(?:\/approve\\`|\/approve`) to retry/.test(orchestrator)) {
			misses.push({ subject: 'flauz-agent-orchestrator-recovery', detail: 'a failed verification does not tell the user they can reply /approve to retry' });
		} else {
			evidence.push('verify-fail path returns the task to an approvable state with an explicit /approve retry instruction');
		}
		if (!orchestrator.includes('type: \'fail\'')) {
			misses.push({ subject: 'flauz-agent-orchestrator-recovery', detail: 'execution failures do not append a fail event — the failed state would be invisible' });
		} else {
			evidence.push('execution failure appends a fail event (task becomes failed, visible with its error)');
		}
	}
	const views = surface.sources.get(WORKSPACE_VIEWS);
	if (views === undefined) {
		misses.push({ subject: WORKSPACE_VIEWS, detail: 'the Tasks provider source was not found — the failed/cancelled row icons are unverifiable' });
	} else {
		if (!/case 'failed':\s*\n\s*return 'error'/.test(views) || !/case 'cancelled':\s*\n\s*return 'close'/.test(views)) {
			misses.push({ subject: 'flauz.tasks-post-action-icons', detail: 'failed/cancelled tasks do not render distinct terminal icons — the user cannot see a task ended badly' });
		} else {
			evidence.push('failed tasks render the error icon, cancelled tasks the close icon (terminal states legible at a glance)');
		}
	}
	return { status: misses.length === 0 ? 'pass' : 'miss', misses, evidence };
}

/** DA21 — accessibilityInformation on every provider row; error rows announce the retry. */
function checkA11yLabels(surface) {
	const misses = [];
	const evidence = [];
	const providerFiles = [...surface.sources.entries()].filter(([, text]) => isProviderSource(text));
	if (providerFiles.length === 0) {
		return { status: 'miss', misses: [{ subject: 'extensions/flauz-*/src', detail: 'no tree-provider sources found under flauz-* src' }], evidence };
	}
	for (const [rel, text] of providerFiles) {
		if (!text.includes('accessibilityInformation')) {
			misses.push({ subject: rel, detail: 'rows are rendered without accessibilityInformation — screen-reader users get no per-row labels' });
		} else {
			evidence.push(`${rel}: accessibilityInformation on rows`);
		}
	}
	// Error rows must announce the retry affordance (the three "Unable to Load" surfaces;
	// Browser's fail-closed row follows the spec's summary-row grammar instead — section 6).
	for (const rel of [WORKSPACE_VIEWS, AGENT_SESSIONS_VIEW, ENVIRONMENTS_VIEW]) {
		const text = surface.sources.get(rel);
		if (text === undefined) {
			misses.push({ subject: rel, detail: 'provider source not found — the error-row a11y label is unverifiable' });
		} else if (!text.includes('Select to retry')) {
			misses.push({ subject: rel, detail: 'the error row\'s accessibility label does not announce "Select to retry" — the recovery affordance is invisible to screen readers' });
		} else {
			evidence.push(`${rel}: error-row a11y label announces the retry affordance`);
		}
	}
	return { status: misses.length === 0 ? 'pass' : 'miss', misses, evidence };
}

/** DA22 — keyboard contract: focus + reveal navigation + the guide documents tree keys. */
function checkKeyboardContract(surface) {
	const misses = [];
	const evidence = [];
	const reveal = surface.commands.find(c => c.id === 'flauz.workspace.revealTask');
	if (reveal === undefined || reveal.def.category !== 'Flauz' || typeof reveal.def.title !== 'string' || reveal.def.title.length === 0) {
		misses.push({ subject: 'flauz.workspace.revealTask', detail: 'the reveal-navigation command is missing or not categorized "Flauz"' });
	} else {
		evidence.push(`flauz.workspace.revealTask (${JSON.stringify(reveal.def.title)}) — session-to-task reveal`);
	}
	const sessions = surface.sources.get(AGENT_SESSIONS_VIEW);
	if (sessions === undefined) {
		misses.push({ subject: AGENT_SESSIONS_VIEW, detail: 'the sessions view source was not found — the reveal wiring is unverifiable' });
	} else if (!sessions.includes('flauz.workspace.revealTask')) {
		misses.push({ subject: 'flauz.agentSessions-reveal', detail: 'the active-task row does not carry the reveal command — cross-view navigation drops to a whole-view focus hop' });
	} else {
		evidence.push('the Agent Sessions active-task row reveals the task in the Tasks view (select + focus + expand)');
	}
	if (surface.guide === undefined) {
		misses.push({ subject: 'flauz-guide', detail: 'the shipped Flauz guide was not found — the keyboard contract is undocumented in-product' });
	} else {
		const text = surface.guide.text;
		if (!text.includes('Arrows') || !text.includes('type-to-filter') || !text.includes('Enter')) {
			misses.push({ subject: 'flauz-guide-keyboard', detail: 'the guide does not document the standard tree keys (Arrows / type-to-filter / Enter)' });
		} else {
			evidence.push(`${surface.guide.rel}: documents the standard tree keys + the focus/reveal commands`);
		}
	}
	return { status: misses.length === 0 ? 'pass' : 'miss', misses, evidence };
}

/** DA23 — web-posture honesty: tree views only + parity coverage of every flauz extension. */
function checkWebPosture(surface) {
	const misses = [];
	const evidence = [];
	for (const m of surface.manifests) {
		const contributes = m.pkg.contributes ?? {};
		for (const key of ['webviews', 'customEditors', 'webviewView']) {
			if (contributes[key] !== undefined) {
				misses.push({ subject: `${m.rel}:${key}`, detail: 'a Flauz surface contributed a webview-family contribution point — the seven views are tree views (one posture across desktop/web)' });
			}
		}
	}
	if (misses.length === 0 && surface.manifests.length > 0) {
		evidence.push('no webview contributions — the seven views are stock tree views (one posture)');
	}
	if (surface.parityRows === undefined) {
		misses.push({ subject: 'packaging-parity-registry', detail: 'build/flauz/packaging-parity.json not found — the desktop/web posture of the flauz extensions is unclassified in this tree' });
	} else {
		const covered = new Set(surface.parityRows.map(row => (typeof row?.surface === 'string' ? row.surface : '')));
		for (const dir of surface.extensionDirs) {
			if (!covered.has(`extensions/${dir}`)) {
				misses.push({ subject: `extensions/${dir}`, detail: 'no packaging-parity row — the extension\'s web posture is unclassified (the user cannot be told honestly what works on web)' });
			}
		}
		if (misses.length === 0) {
			evidence.push(`parity registry classifies all ${surface.extensionDirs.size} flauz extension(s)`);
		}
	}
	return { status: misses.length === 0 ? 'pass' : 'miss', misses, evidence };
}

// ---- the audit ------------------------------------------------------------------------------

/**
 * Evaluates every rubric row against the loaded surface. Returns per-row
 * results: { id, title, area, persona, status, misses, evidence } where
 * status is 'pass' | 'miss' (the CLI applies the known-gap pinning).
 */
export function runDiscoveryAudit(surface) {
	const results = [];
	for (const row of RUBRIC) {
		const result = checkRow(row.id, surface);
		results.push({ ...row, status: result.status, misses: result.misses, evidence: result.evidence });
	}
	return results;
}

export { EXIT_OK, EXIT_FAIL, EXIT_USAGE };
