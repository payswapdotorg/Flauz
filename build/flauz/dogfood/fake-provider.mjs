/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * A-PROD-003-W1 (dogfood harness) -- the fake/scripted provider lanes.
 *
 * The MODEL INTELLIGENCE stand-in for the credential-free sandbox (the
 * honest-evidence law: claimed at fixture level, never wording-promoted).
 * The lanes are the journey drill's sanctioned stub-provider-server
 * shape (the INV-2 pattern): the SERVER-SIDE scripting is a control
 * seam, while the wire, the routing and the consumers are the REAL
 * product code paths.
 *
 *   fake lane          POST /v1/chat/completions   -- answers are
 *                      COMPUTED AT REQUEST TIME from the real tree:
 *                        - the exploration question triggers a live
 *                          full scan of extensions/flauz-* (its own
 *                          independent scanner implementation; the
 *                          driver verifies the answer, never trusts
 *                          it);
 *                        - the provider-configuration question reads
 *                          the workspace facts FROM THE PROMPT
 *                          (P2-FIX-119: the exercise carries the
 *                          facts in the prompt, both lanes answer
 *                          from them -- the retired server-side
 *                          workspace read was the god-view the W2
 *                          run exposed); the fake lane extracts them
 *                          with its own independent parser (pinned by
 *                          the round-trip tests);
 *                        - anything else gets a deterministic echo;
 *   tools lane         the A-PROD-003-W7 tool-carrying exploration
 *                      question (the TOOLS_LANE_MARKER protocol): the
 *                      scripted agent directs real tool calls (search,
 *                      reads) and computes its answer from the tool
 *                      results embedded in the conversation -- the
 *                      receipts the harness minted for the approved
 *                      invocations; never canned, never a scan.
 *   environments-      the A-PROD-003-W8 environments-lifecycle
 *   lifecycle lane     question (the ENVIRONMENT-LIFECYCLE FACTS
 *                      markers): the scripted lane reads the op-
 *                      sequence facts FROM THE PROMPT and computes the
 *                      final-state map + the ops census + the failure-
 *                      leg verdicts from them (never canned).
 *   workspace-         the A-PROD-003-W8 workspace-continuity question
 *   continuity lane    (the CONTINUITY FACTS markers): the scripted
 *                      lane reads the exported surface map + the
 *                      restore outcomes + the failure legs FROM THE
 *                      PROMPT and computes the per-surface outcome
 *                      report + the redacted set with the law's
 *                      pinned wording (never canned).
 *   scripted-failing   POST /fail/chat/completions  -- ALWAYS HTTP 500
 *   lane              with an OpenAI-shaped error body: the REAL
 *                      adapter maps it onto the TYPED provider
 *                      failure PROVIDER_OVERLOADED (retryable,
 *                      short-backoff) -- the product's own error
 *                      taxonomy, no harness-side classification.
 *
 * The live lane is NOT here: W2 (the station) points the harness at a
 * real vendor through the ENV-ONLY contract (see README.md) -- the
 * driver builds that lane from FLAUZ_LIVE_PROVIDER_BASE_URL /
 * _API_KEY / _MODEL and this server is not involved.
 *
 * Harness module (build/flauz/dogfood/**): NOT a gate instrument.
 */

import * as http from 'node:http';
import * as nodeFs from 'node:fs/promises';
import * as nodePath from 'node:path';
import { TOOLS_LANE_MARKER, TOOL_RESULTS_BEGIN, TOOL_RESULTS_END, TOOLS_DIRECTIVE_SCHEMA, TOOLS_ANSWER_SCHEMA, TOOLS_EXPLORATION_QUESTION, readCommandFile } from './exercises/tools-exploration.task.ts';
import { ENVIRONMENTS_LIFECYCLE_FACTS_BEGIN, ENVIRONMENTS_LIFECYCLE_FACTS_END, ENVIRONMENTS_LIFECYCLE_ANSWER_SCHEMA } from './exercises/environments-lifecycle.task.ts';
import { WORKSPACE_CONTINUITY_FACTS_BEGIN, WORKSPACE_CONTINUITY_FACTS_END, WORKSPACE_CONTINUITY_ANSWER_SCHEMA } from './exercises/workspace-continuity.task.ts';

/** The repo-relative module the exploration question is about (the canonical evidence ledger). */
export const CANONICAL_LEDGER_MODULE = 'extensions/flauz-workspace/src/ledger.ts';

/** Source extensions the scanners consider (both implementations share this contract rule). */
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']);

/**
 * A-PROD-003-W7 -- the TOOL-CARRYING lane's scripted agent policy (the
 * fake lane's brain). The fake agent sees ONLY the conversation (exactly
 * like a real model): the question + the protocol + the TOOL RESULTS the
 * harness embedded after executing the agent's directed calls through the
 * approved invocation path. Its policy is a sound search-then-read-then-
 * answer strategy; its answer is computed FROM THE READ RECEIPTS'
 * streamed lines (never a server-side scan -- the W2 god-view stays
 * retired; never canned -- nothing is pre-baked, the map is derived at
 * request time from the tool outputs this conversation carries).
 *
 * The search command is a SOUND superset search: every ledger consumer's
 * import line carries a relative `from '...ledger'` specifier, so the
 * pattern matches every consumer file (plus false positives the reads
 * filter precisely).
 */
export const TOOLS_LANE_SEARCH_COMMAND = 'grep -rlE -- "(import|export)[^;]*from [\'\\"][^\'\\"]*ledger" extensions/flauz-*';

/** Builds one candidate-file read command (numbered import/export lines). */
function toolsLaneReadCommand(file) {
        return `grep -nE -- 'import|export' ${file}`;
}

/** Parses the receipts embedded in the conversation's tool-results block (the protocol the exercise renders). */
function parseConversationReceipts(prompt) {
        const beginIdx = prompt.indexOf(TOOL_RESULTS_BEGIN);
        if (beginIdx < 0) {
                return [];
        }
        const start = prompt.indexOf('\n', beginIdx) + 1;
        const endIdx = prompt.indexOf(TOOL_RESULTS_END, start);
        const block = endIdx < 0 ? prompt.slice(start) : prompt.slice(start, endIdx);
        const receipts = [];
        let current = null;
        for (const line of block.split('\n')) {
                const header = /^\[receipt (R-\d+) \| tool (\S+) \| (approved|denied) \| command: (.*) \| (?:exit (-?\d+)|refused before execution)\]$/.exec(line);
                if (header !== null) {
                        current = { id: header[1], tool: header[2], granted: header[3] === 'approved', command: header[4], exit: header[5] !== undefined ? Number(header[5]) : null, output: [] };
                        receipts.push(current);
                        continue;
                }
                if (current !== null && line.length > 0 && !line.startsWith('(')) {
                        current.output.push(line);
                }
        }
        return receipts;
}

/**
 * The scripted agent turn: given the conversation state (the prompt with
 * the embedded tool results), answers with EXACTLY ONE JSON document --
 * the search directive (no results yet), the read directives (the search
 * landed, candidates remain unread), or the final answer (every candidate
 * read: the consumer map computed from the streamed read lines).
 *
 * @param {string} prompt the ask prompt (the question + the protocol + the tool results so far)
 * @returns {string} the completion text (the directive or the answer document, raw JSON -- the machine-lane wire shape)
 */
export function toolsAgentTurn(prompt) {
        const receipts = parseConversationReceipts(prompt);
        const approved = receipts.filter(receipt => receipt.granted === true && receipt.exit === 0);
        const searchReceipts = approved.filter(receipt => /^grep\s+-rl/.test(receipt.command));
        const readReceipts = approved.filter(receipt => /^grep\s+-n/.test(receipt.command));
        if (searchReceipts.length === 0) {
                return JSON.stringify({ schema: TOOLS_DIRECTIVE_SCHEMA, calls: [{ tool: 'flauz_terminal', input: { command: TOOLS_LANE_SEARCH_COMMAND } }] });
        }
        const search = searchReceipts[0];
        const candidates = search.output.map(line => line.trim()).filter(line => line.startsWith('extensions/flauz-') && [...SOURCE_EXTENSIONS].some(ext => line.endsWith(ext)));
        const readFiles = readReceipts.map(receipt => readCommandFile(receipt.command));
        const unread = candidates.filter(file => !readFiles.includes(file));
        if (unread.length > 0) {
                return JSON.stringify({ schema: TOOLS_DIRECTIVE_SCHEMA, calls: unread.map(file => ({ tool: 'flauz_terminal', input: { command: toolsLaneReadCommand(file) } })) });
        }
        // every candidate read: the answer computed FROM THE READ RECEIPTS' streamed lines
        const consumers = [];
        for (const receipt of readReceipts) {
                const file = readCommandFile(receipt.command);
                for (const row of receipt.output) {
                        const match = /^(\d+):(.*)$/.exec(row);
                        if (match === null) {
                                continue;
                        }
                        const parsed = parseImportLine(match[2]);
                        if (parsed === null) {
                                continue;
                        }
                        if (specifierNamesLedger(file, parsed.specifier, CANONICAL_LEDGER_MODULE)) {
                                consumers.push({ file, line: Number(match[1]), consumes: parsed.symbols });
                        }
                }
        }
        consumers.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
        return JSON.stringify({
                schema: TOOLS_ANSWER_SCHEMA,
                question: TOOLS_EXPLORATION_QUESTION,
                method: `agent-with-tools: the approved search command ${TOOLS_LANE_SEARCH_COMMAND} over extensions/flauz-* (a sound superset search), then numbered-line reads (grep -nE 'import|export') of every candidate file; the consumer map is computed from the read receipts' streamed lines only -- the tool outputs this conversation carried (never a server-side scan, never canned)`,
                receipts: receipts.map(receipt => receipt.id),
                consumers,
        });
}
/** One consumer entry of the map (the answer's shape -- the driver verifies it independently). */
function toPosix(target) {
        return target.split(nodePath.sep).join('/');
}

/**
 * Resolves a relative import specifier against the importing file's
 * directory and reports whether it names the ledger module. Contract
 * rules (shared with the driver-side scanner, independently coded):
 * only ./ ../ specifiers; extensionless specifiers resolve with .ts;
 * .js/.mjs/.cjs specifiers resolve onto the .ts twin.
 */
function specifierNamesLedger(filePosix, specifier, ledgerPosix) {
        if (typeof specifier !== 'string' || (!specifier.startsWith('./') && !specifier.startsWith('../'))) {
                return false;
        }
        const dir = filePosix.includes('/') ? filePosix.slice(0, filePosix.lastIndexOf('/')) : '';
        const joined = `${dir === '' ? '' : `${dir}/`}${specifier}`;
        const normalized = joined.split('/').reduce((parts, segment) => {
                if (segment === '' || segment === '.') {
                        return parts;
                }
                if (segment === '..') {
                        parts.pop();
                        return parts;
                }
                parts.push(segment);
                return parts;
        }, []).join('/');
        const candidates = [
                normalized,
                `${normalized}.ts`,
                `${normalized}.js`,
                normalized.replace(/\.js$/, '.ts'),
                normalized.replace(/\.mjs$/, '.ts'),
                normalized.replace(/\.cjs$/, '.ts'),
        ];
        return candidates.includes(ledgerPosix);
}

/**
 * Parses ONE line as an import/export-from statement (string-ops
 * implementation -- deliberately NOT the driver's regex approach).
 * Returns { symbols, specifier } or null.
 */
function parseImportLine(line) {
        const fromIdx = line.indexOf(' from ');
        if (fromIdx < 0) {
                return null;
        }
        const head = line.slice(0, fromIdx).trim();
        if (!head.startsWith('import') && !head.startsWith('export')) {
                return null;
        }
        const rest = line.slice(fromIdx + ' from '.length).trim();
        const quote = rest.charAt(0);
        if (quote !== '\'' && quote !== '"') {
                return null;
        }
        const endQuote = rest.indexOf(quote, 1);
        if (endQuote < 0) {
                return null;
        }
        const specifier = rest.slice(1, endQuote);
        const open = head.indexOf('{');
        const close = head.lastIndexOf('}');
        if (open >= 0 && close > open) {
                const symbols = head.slice(open + 1, close)
                        .split(',')
                        .map(part => part.trim().replace(/^type\s+/, '').trim())
                        .filter(part => part.length > 0);
                return { symbols, specifier };
        }
        // default / namespace / bare imports of the ledger module (defensive rule)
        if (head.startsWith('import * as')) {
                return { symbols: ['*'], specifier };
        }
        if (head.startsWith('import type')) {
                return { symbols: ['default'], specifier };
        }
        if (head.startsWith('import')) {
                return { symbols: ['default'], specifier };
        }
        return null;
}

/** Recursively collects source files under <root>/extensions/ (flauz-* dirs only, sorted for determinism). */
async function collectFlauzSourceFiles(repoRoot) {
        const extensionsDir = nodePath.join(repoRoot, 'extensions');
        let entries;
        try {
                entries = await nodeFs.readdir(extensionsDir, { withFileTypes: true });
        } catch (err) {
                if (err !== null && typeof err === 'object' && err.code === 'ENOENT') {
                        return [];
                }
                throw err;
        }
        const files = [];
        for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
                if (!entry.isDirectory() || !entry.name.startsWith('flauz-')) {
                        continue;
                }
                await walk(nodePath.join(extensionsDir, entry.name));
        }
        return files.sort();

        async function walk(dir) {
                const children = await nodeFs.readdir(dir, { withFileTypes: true });
                for (const child of children.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
                        const full = nodePath.join(dir, child.name);
                        if (child.isDirectory()) {
                                await walk(full);
                                continue;
                        }
                        if (SOURCE_EXTENSIONS.has(nodePath.extname(child.name))) {
                                files.push(full);
                        }
                }
        }
}

/**
 * THE FAKE LANE'S LIVE COMPUTATION: maps every consumer of the
 * evidence ledger across extensions/flauz-* by scanning the REAL tree
 * at request time (file + line + what it consumes). This is a
 * retrieval script standing in for a model -- fixture-level
 * intelligence, real data.
 */
export async function computeLedgerConsumerMap(repoRoot, ledgerModule = CANONICAL_LEDGER_MODULE) {
        const files = await collectFlauzSourceFiles(repoRoot);
        const consumers = [];
        for (const absolute of files) {
                const repoRelative = toPosix(nodePath.relative(repoRoot, absolute));
                let text;
                try {
                        text = await nodeFs.readFile(absolute, { encoding: 'utf-8' });
                } catch {
                        continue;
                }
                const lines = text.split('\n');
                for (let index = 0; index < lines.length; index += 1) {
                        const parsed = parseImportLine(lines[index]);
                        if (parsed === null) {
                                continue;
                        }
                        if (specifierNamesLedger(repoRelative, parsed.specifier, ledgerModule)) {
                                consumers.push({ file: repoRelative, line: index + 1, consumes: parsed.symbols });
                        }
                }
        }
        return consumers;
}

/**
 * P2-FIX-119: THE FAKE LANE'S PROMPT-FACTS READ for the
 * provider-configuration question. The exercise embeds the workspace
 * facts in the prompt at ask time; this is the bare-model simulation:
 * read + faithfully report what the prompt carries -- NEVER a fresh
 * read of the workspace state (the server-side computation path is
 * retired; the god-view is gone). String-ops implementation,
 * independent of the exercise's builder; the round-trip tests pin the
 * two sides together.
 *
 * @param {string} prompt the ask prompt (the question with the embedded facts)
 * @returns {{ ok: true, answer: { enabledDogfoodProviders: string[], routingDecisionCount: number, lastDecisionId: string } } | { ok: false, error: string }}
 */
export function answerSwitchFromPrompt(prompt) {
        const section = (beginMarker, endMarker) => {
                const beginIdx = prompt.indexOf(beginMarker);
                if (beginIdx < 0) {
                        return null;
                }
                const contentStart = prompt.indexOf('\n', beginIdx) + 1;
                const endIdx = prompt.indexOf(endMarker, contentStart);
                if (endIdx < 0) {
                        return null;
                }
                return prompt.slice(contentStart, endIdx);
        };
        const providersSection = section('=== WORKSPACE FACT: providers file', '=== END providers file ===');
        if (providersSection === null) {
                return { ok: false, error: 'the prompt carries no providers-file facts section (P2-FIX-119: the question must embed the workspace facts)' };
        }
        const enabled = [];
        if (!providersSection.trim().startsWith('(the providers file is absent')) {
                let parsed;
                try {
                        parsed = JSON.parse(providersSection);
                } catch (err) {
                        return { ok: false, error: `the prompt-embedded providers file does not parse: ${err instanceof Error ? err.message : String(err)}` };
                }
                if (Array.isArray(parsed.providers)) {
                        for (const entry of parsed.providers) {
                                if (entry !== null && typeof entry === 'object' && entry.providerId !== undefined
                                        && String(entry.providerId).startsWith('flauz-dogfood') && entry.enabled === true) {
                                        enabled.push(String(entry.providerId));
                                }
                        }
                }
        }
        enabled.sort();
        const decisionsSection = section('=== WORKSPACE FACT: routing-decision ledger', '=== END routing-decision ledger ===');
        if (decisionsSection === null) {
                return { ok: false, error: 'the prompt carries no routing-decision facts section (P2-FIX-119: the question must embed the workspace facts)' };
        }
        const countMatch = /total routing decisions recorded:\s*(\d+)/.exec(decisionsSection);
        if (countMatch === null) {
                return { ok: false, error: 'the prompt-embedded routing-decision facts carry no total count' };
        }
        const routingDecisionCount = Number(countMatch[1]);
        let lastDecisionId = '';
        for (const line of decisionsSection.split('\n')) {
                const trimmed = line.trim();
                if (trimmed.length === 0 || trimmed.startsWith('(')) {
                        continue;
                }
                try {
                        const row = JSON.parse(trimmed);
                        if (row !== null && typeof row === 'object' && typeof row.decisionId === 'string') {
                                lastDecisionId = row.decisionId;
                        }
                } catch {
                        // not a JSON row (e.g. the section header lines) -- keep walking
                }
        }
        return { ok: true, answer: { enabledDogfoodProviders: enabled, routingDecisionCount, lastDecisionId } };
}

/** W7 (A-PROD-003-W7): the browser-policy outcome-map answer, COMPUTED from
 *  the prompt-carried facts (the P2-FIX-119 doctrine: both lanes answer from
 *  the prompt; the server-side computation path is retired). The exercise
 *  embeds the scripted outcome map + the drop/recovery facts at ask time. */
export function answerBrowserPolicyFromPrompt(prompt) {
        const beginMarker = '=== BROWSER-SESSION FACT: the scripted outcome map';
        const beginIdx = prompt.indexOf(beginMarker);
        if (beginIdx < 0) {
                return { ok: false, error: 'the prompt carries no browser-session facts section (the question must embed the outcome map)' };
        }
        const contentStart = prompt.indexOf('\n', beginIdx) + 1;
        const endIdx = prompt.indexOf('=== END browser-session facts ===', contentStart);
        if (endIdx < 0) {
                return { ok: false, error: 'the browser-session facts section is unterminated' };
        }
        const body = prompt.slice(contentStart, endIdx).trim();
        let facts;
        try {
                facts = JSON.parse(body);
        } catch (err) {
                return { ok: false, error: `the embedded outcome map is not valid JSON: ${err instanceof Error ? err.message : String(err)}` };
        }
        return {
                ok: true,
                answer: {
                        schema: 'flauz.dogfood-browser-policy-answer/v1',
                        question: 'report the browser session outcome map from the prompt-carried facts',
                        method: 'read of the prompt-carried browser-session facts (the fake lane answers from the prompt; simulated evidence, never promoted)',
                        navigations: facts.navigations,
                        dropRecovery: facts.dropRecovery,
                },
        };
}

/** W8 (A-PROD-003-W8): the environments-lifecycle answer, COMPUTED from
 *  the prompt-carried op-sequence facts (the P2-FIX-119 doctrine: both
 *  lanes answer from the prompt). The final state per environment is the
 *  LAST ledger row's toState per id; the census counts the rows; the
 *  failure legs derive from the error rows exactly as the driver-side
 *  verifier does (TRUST_POSTURE_REJECTED -> untrusted-<op> / rejected;
 *  everything else -> illegal-<op> / illegal). Never canned. */
export function answerEnvironmentsLifecycleFromPrompt(prompt) {
        const beginIdx = prompt.indexOf(ENVIRONMENTS_LIFECYCLE_FACTS_BEGIN);
        if (beginIdx < 0) {
                return { ok: false, error: 'the prompt carries no environment-lifecycle facts section (the question must embed the op-sequence facts)' };
        }
        const contentStart = prompt.indexOf('\n', beginIdx) + 1;
        const endIdx = prompt.indexOf(ENVIRONMENTS_LIFECYCLE_FACTS_END, contentStart);
        if (endIdx < 0) {
                return { ok: false, error: 'the environment-lifecycle facts section is unterminated' };
        }
        let facts;
        try {
                facts = JSON.parse(prompt.slice(contentStart, endIdx).trim());
        } catch (err) {
                return { ok: false, error: `the embedded environment-lifecycle facts are not valid JSON: ${err instanceof Error ? err.message : String(err)}` };
        }
        if (facts === null || typeof facts !== 'object' || !Array.isArray(facts.operations)) {
                return { ok: false, error: 'the embedded environment-lifecycle facts carry no operations array' };
        }
        const environments = {};
        const kinds = {};
        const failureLegs = [];
        for (const row of facts.operations) {
                if (row === null || typeof row !== 'object' || typeof row.envId !== 'string' || typeof row.op !== 'string') {
                        return { ok: false, error: 'an embedded operations row is malformed (envId/op must be strings)' };
                }
                environments[row.envId] = String(row.toState ?? '');
                kinds[row.op] = (kinds[row.op] ?? 0) + 1;
                if (row.result === 'error' && typeof row.error === 'string') {
                        const rejected = row.error === 'TRUST_POSTURE_REJECTED';
                        failureLegs.push({ leg: rejected ? `untrusted-${row.op}` : `illegal-${row.op}`, verdict: rejected ? 'rejected' : 'illegal', code: row.error });
                }
        }
        failureLegs.sort((a, b) => (a.leg < b.leg ? -1 : a.leg > b.leg ? 1 : 0));
        return {
                ok: true,
                answer: {
                        schema: ENVIRONMENTS_LIFECYCLE_ANSWER_SCHEMA,
                        question: 'report the final lifecycle state per environment, the ops-ledger census, and the failure-leg verdicts from the prompt-carried facts',
                        method: 'read of the prompt-carried environment-lifecycle facts (the fake lane answers from the prompt; fixture-level intelligence, never promoted)',
                        environments,
                        opsLedger: { rows: facts.operations.length, kinds },
                        failureLegs,
                },
        };
}

/** W8 (A-PROD-003-W8): the workspace-continuity answer, COMPUTED from
 *  the prompt-carried continuity facts (the P2-FIX-119 doctrine: both
 *  lanes answer from the prompt). The per-surface restore outcomes are
 *  the embedded restore result; the redacted set is derived from the
 *  embedded manifest surface map with the law's pinned wording (the
 *  embedded redactedNote). Never canned. */
export function answerWorkspaceContinuityFromPrompt(prompt) {
        const beginIdx = prompt.indexOf(WORKSPACE_CONTINUITY_FACTS_BEGIN);
        if (beginIdx < 0) {
                return { ok: false, error: 'the prompt carries no continuity facts section (the question must embed the exported surface map + the restore outcomes)' };
        }
        const contentStart = prompt.indexOf('\n', beginIdx) + 1;
        const endIdx = prompt.indexOf(WORKSPACE_CONTINUITY_FACTS_END, contentStart);
        if (endIdx < 0) {
                return { ok: false, error: 'the continuity facts section is unterminated' };
        }
        let facts;
        try {
                facts = JSON.parse(prompt.slice(contentStart, endIdx).trim());
        } catch (err) {
                return { ok: false, error: `the embedded continuity facts are not valid JSON: ${err instanceof Error ? err.message : String(err)}` };
        }
        if (facts === null || typeof facts !== 'object' || typeof facts.bundleId !== 'string' || !Array.isArray(facts.surfaces) || !Array.isArray(facts.restoreOutcomes)) {
                return { ok: false, error: 'the embedded continuity facts carry no { bundleId, surfaces, restoreOutcomes }' };
        }
        const redactedNote = typeof facts.redactedNote === 'string' ? facts.redactedNote : '';
        const redactedSurfaces = facts.surfaces
                .filter(row => row !== null && typeof row === 'object' && row.status === 'redacted' && typeof row.id === 'string')
                .map(row => ({ surface: String(row.id), why: redactedNote }))
                .sort((a, b) => (a.surface < b.surface ? -1 : a.surface > b.surface ? 1 : 0));
        return {
                ok: true,
                answer: {
                        schema: WORKSPACE_CONTINUITY_ANSWER_SCHEMA,
                        question: 'report the per-surface restore outcomes and the redacted surfaces (with the law\'s wording) from the prompt-carried facts',
                        method: 'read of the prompt-carried continuity facts (the fake lane answers from the prompt; fixture-level intelligence, never promoted)',
                        bundleId: facts.bundleId,
                        restoreOutcomes: facts.restoreOutcomes.map(row => (row === null || typeof row !== 'object' ? { surface: '', outcome: '' } : { surface: String(row.surface ?? ''), outcome: String(row.outcome ?? '') })),
                        redactedSurfaces,
                        failureLegs: Array.isArray(facts.failureLegs)
                                ? facts.failureLegs.map(row => (row === null || typeof row !== 'object' ? { leg: '', code: '' } : { leg: String(row.leg ?? ''), code: String(row.code ?? '') }))
                                : [],
                },
        };
}

/** One OpenAI-shaped SSE completion body (the wire shape the REAL adapter parses). */
function openAiSseBody(model, content) {
        const id = 'chatcmpl-dogfood-1';
        const created = 1_760_000_000;
        const events = [];
        events.push(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] })}`);
        const half = Math.ceil(content.length / 2);
        for (const delta of [content.slice(0, half), content.slice(half)]) {
                events.push(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { content: delta }, finish_reason: null }] })}`);
        }
        events.push(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}`);
        events.push(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [], usage: { prompt_tokens: 31, completion_tokens: 11 } })}`);
        events.push('data: [DONE]');
        return `${events.join('\n\n')}\n\n`;
}

/** Extracts the last user message text from an OpenAI-shaped chat request body. */
function lastUserPrompt(body) {
        try {
                const parsed = JSON.parse(body);
                const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
                for (let index = messages.length - 1; index >= 0; index -= 1) {
                        const message = messages[index];
                        if (message !== null && typeof message === 'object' && message.role === 'user') {
                                if (typeof message.content === 'string') {
                                        return message.content;
                                }
                                if (Array.isArray(message.content)) {
                                        const text = message.content.filter(part => part !== null && typeof part === 'object' && typeof part.text === 'string').map(part => part.text).join('');
                                        if (text.length > 0) {
                                                return text;
                                        }
                                }
                        }
                }
        } catch {
                // fall through: no parsable prompt
        }
        return '';
}

/**
 * Boots the two local lanes on one REAL socket. The scripted-failing
 * lane's failure mode is fixed (HTTP 500 -> the adapter's typed
 * PROVIDER_OVERLOADED); the fake lane computes its exploration answer
 * live and reads its provider-configuration answer from the prompt's
 * embedded facts (P2-FIX-119). `options.workspaceRoot` is accepted for
 * contract stability (the driver always passes it) but is no longer
 * read server-side: the retired workspace read WAS the P2-FIX-119
 * god-view.
 *
 * @param {{ repoRoot: string, workspaceRoot: string, port?: number }} options
 * @returns {Promise<{ port: number, chatCalls: number, failCalls: number, exploreComputations: number, configPromptReads: number, toolsComputations: number, environmentsComputations: number, continuityComputations: number, close: () => void }>}
 */
export function startFakeProvider(options) {
        const repoRoot = options.repoRoot;
        let chatCalls = 0;
        let failCalls = 0;
        let exploreComputations = 0;
        let configPromptReads = 0;
        let toolsComputations = 0;
        let environmentsComputations = 0;
        let continuityComputations = 0;
        const server = http.createServer((request, response) => {
                const url = request.url ?? '/';
                const method = request.method ?? 'GET';
                let body = '';
                request.on('data', chunk => {
                        body += chunk.toString();
                });
                request.on('end', () => {
                        const respond = (status, payload, headers) => {
                                response.writeHead(status, { 'content-type': 'application/json', ...(headers ?? {}) });
                                response.end(payload);
                        };

                        // the scripted-failing lane: every completion fails with the typed 500
                        if (method === 'POST' && url === '/fail/chat/completions') {
                                failCalls += 1;
                                respond(500, JSON.stringify({ error: { message: 'dogfood scripted provider failure: this lane is armed to fail (the typed PROVIDER_OVERLOADED window over the real adapter wire)' } }));
                                return;
                        }
                        if (method === 'GET' && url === '/fail/models') {
                                respond(500, JSON.stringify({ error: { message: 'dogfood scripted provider failure: lane unavailable' } }));
                                return;
                        }

                        if (method === 'POST' && url === '/v1/chat/completions') {
                                chatCalls += 1;
                                let model = 'dogfood-1';
                                try {
                                        const parsed = JSON.parse(body);
                                        if (typeof parsed.model === 'string') {
                                                model = parsed.model;
                                        }
                                } catch {
                                        // keep the default model id
                                }
                                const prompt = lastUserPrompt(body);
                                const lower = prompt.toLowerCase();
                                if (prompt.includes(TOOLS_LANE_MARKER)) {
                                        // A-PROD-003-W7: the TOOL-CARRYING lane's scripted agent (fixture-level
                                        // intelligence, honestly claimed): it directs REAL tool calls -- the harness
                                        // executes them through the approved invocation path (the HumanApproval gate)
                                        // and embeds the minted receipts + their outputs back into the next ask; the
                                        // agent's answer is computed FROM THOSE TOOL RESULTS carried in the
                                        // conversation (never a server-side scan -- the W2 god-view stays retired;
                                        // never canned -- nothing is pre-baked).
                                        toolsComputations += 1;
                                        response.writeHead(200, { 'content-type': 'text/event-stream' });
                                        response.end(openAiSseBody(model, toolsAgentTurn(prompt)));
                                        return;
                                }
                                if (prompt.includes(ENVIRONMENTS_LIFECYCLE_FACTS_BEGIN)) {
                                        // A-PROD-003-W8: the environments-lifecycle lane's scripted answer FROM
                                        // THE PROMPT-CARRIED FACTS (the op-sequence facts embedded at ask time;
                                        // computed from them, never canned).
                                        environmentsComputations += 1;
                                        const outcome = answerEnvironmentsLifecycleFromPrompt(prompt);
                                        const answer = outcome.ok
                                                ? outcome.answer
                                                : { schema: 'flauz.dogfood-environments-lifecycle-answer-error/v1', error: outcome.error };
                                        response.writeHead(200, { 'content-type': 'text/event-stream' });
                                        response.end(openAiSseBody(model, JSON.stringify(answer)));
                                        return;
                                }
                                if (prompt.includes(WORKSPACE_CONTINUITY_FACTS_BEGIN)) {
                                        // A-PROD-003-W8: the workspace-continuity lane's scripted answer FROM
                                        // THE PROMPT-CARRIED FACTS (the surface map + the restore outcomes +
                                        // the failure legs embedded at ask time; computed from them, never canned).
                                        continuityComputations += 1;
                                        const outcome = answerWorkspaceContinuityFromPrompt(prompt);
                                        const answer = outcome.ok
                                                ? outcome.answer
                                                : { schema: 'flauz.dogfood-workspace-continuity-answer-error/v1', error: outcome.error };
                                        response.writeHead(200, { 'content-type': 'text/event-stream' });
                                        response.end(openAiSseBody(model, JSON.stringify(answer)));
                                        return;
                                }
                                if (lower.includes('every consumer of the evidence ledger')) {
                                        // THE REAL COMPUTATION over the REAL clone (checked by the driver, never trusted)
                                        exploreComputations += 1;
                                        computeLedgerConsumerMap(repoRoot).then(consumers => {
                                                const answer = {
                                                        schema: 'flauz.dogfood-explore-answer/v1',
                                                        question: 'map every consumer of the evidence ledger across extensions/flauz-*: file + line + what it consumes',
                                                        method: `deterministic full scan of extensions/flauz-* for import/export-from statements resolving to ${CANONICAL_LEDGER_MODULE} (computed at request time from the real tree)`,
                                                        consumers,
                                                };
                                                response.writeHead(200, { 'content-type': 'text/event-stream' });
                                                response.end(openAiSseBody(model, JSON.stringify(answer)));
                                        }, err => {
                                                respond(500, JSON.stringify({ error: { message: `dogfood fake provider scan failed: ${err instanceof Error ? err.message : String(err)}` } }));
                                        });
                                        return;
                                }
                                if (lower.includes('browser session outcome map') || prompt.includes('=== BROWSER-SESSION FACT:')) {
                                        // W7: the browser-policy exercise's fake-lane answer FROM THE
                                        // PROMPT-CARRIED FACTS (the outcome map embedded at ask time).
                                        const outcome = answerBrowserPolicyFromPrompt(prompt);
                                        const answer = outcome.ok
                                                ? outcome.answer
                                                : { schema: 'flauz.dogfood-browser-policy-answer-error/v1', error: outcome.error };
                                        response.writeHead(200, { 'content-type': 'text/event-stream' });
                                        response.end(openAiSseBody(model, JSON.stringify(answer)));
                                        return;
                                }
                                if (lower.includes('provider-lane configuration')) {
                                        // P2-FIX-119: the fake lane answers FROM THE PROMPT-CARRIED FACTS
                                        // (the exercise embeds the workspace facts at ask time; the retired
                                        // server-side workspace read was the god-view the W2 run exposed).
                                        configPromptReads += 1;
                                        const outcome = answerSwitchFromPrompt(prompt);
                                        const answer = outcome.ok
                                                ? {
                                                        schema: 'flauz.dogfood-switch-answer/v1',
                                                        question: 'report the current provider-lane configuration of this flauz workspace from the prompt-carried facts',
                                                        method: 'read of the prompt-carried workspace facts (P2-FIX-119: both lanes answer from the prompt; the server-side computation path is retired)',
                                                        ...outcome.answer,
                                                }
                                                : {
                                                        schema: 'flauz.dogfood-switch-answer-error/v1',
                                                        error: outcome.error,
                                                };
                                        response.writeHead(200, { 'content-type': 'text/event-stream' });
                                        response.end(openAiSseBody(model, JSON.stringify(answer)));
                                        return;
                                }
                                response.writeHead(200, { 'content-type': 'text/event-stream' });
                                response.end(openAiSseBody(model, `dogfood fake provider acknowledgment: ${prompt.slice(0, 120)}`));
                                return;
                        }

                        if (method === 'GET' && url === '/v1/models') {
                                respond(200, JSON.stringify({ object: 'list', data: [{ id: 'dogfood-1', object: 'model', owned_by: 'flauz-dogfood' }] }));
                                return;
                        }

                        respond(404, JSON.stringify({ error: { message: `no such dogfood provider route: ${method} ${url}` } }));
                });
        });
        return new Promise(resolve => {
                server.listen(options.port ?? 0, '127.0.0.1', () => {
                        const address = server.address();
                        resolve({
                                port: address === null ? 0 : address.port,
                                get chatCalls() {
                                        return chatCalls;
                                },
                                get failCalls() {
                                        return failCalls;
                                },
                                get exploreComputations() {
                                        return exploreComputations;
                                },
                                get configPromptReads() {
                                        return configPromptReads;
                                },
                                get toolsComputations() {
                                        return toolsComputations;
                                },
                                get environmentsComputations() {
                                        return environmentsComputations;
                                },
                                get continuityComputations() {
                                        return continuityComputations;
                                },
                                close: () => server.close(),
                        });
                });
        });
}
