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
 *                        - anything else gets a deterministic echo.
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

/** The repo-relative module the exploration question is about (the canonical evidence ledger). */
export const CANONICAL_LEDGER_MODULE = 'extensions/flauz-workspace/src/ledger.ts';

/** Source extensions the scanners consider (both implementations share this contract rule). */
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']);

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
 * @returns {Promise<{ port: number, chatCalls: number, failCalls: number, exploreComputations: number, configPromptReads: number, close: () => void }>}
 */
export function startFakeProvider(options) {
        const repoRoot = options.repoRoot;
        let chatCalls = 0;
        let failCalls = 0;
        let exploreComputations = 0;
        let configPromptReads = 0;
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
                                close: () => server.close(),
                        });
                });
        });
}
