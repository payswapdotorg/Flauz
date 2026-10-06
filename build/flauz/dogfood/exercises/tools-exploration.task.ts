/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * A-PROD-003-W7 (the agent-with-tools dogfood lane) -- EXERCISE 4:
 * tools-exploration (the deferred P2-FIX-122 full-tree question).
 *
 * THE QUESTION the W5 live run proved a bare model cannot answer ("map
 * every consumer of the evidence ledger across extensions/flauz-*" --
 * 0/7 sound, every real consumer missed), asked THROUGH THE
 * TOOL-CARRYING LANE: the ask carries the real tool surface (the
 * flauz_terminal tool: file read/search as commands, every invocation
 * through the approved invocation path -- prepareInvocation ->
 * confirmationMessages -> the HumanApproval gate -> invoke), the agent
 * answers by DIRECTING tool calls (a bounded turn loop), and its answer
 * must cite what it ACTUALLY read: the dogfood tool receipts (schema
 * `flauz.dogfood-tool-receipt/v1`) minted per approved invocation.
 *
 * THE VERIFICATION stays the driver's independent ground-truth scan --
 * scanLedgerConsumers + verifyConsumersMap, the SAME sound+complete 100%
 * bar as the fake lane's full-tree check (the map CHECKED, never
 * trusted) -- PLUS the tool-receipt contract check: every claimed
 * consumer must be covered by a read receipt whose real execution
 * actually streamed that file:line, and every cited receipt must have
 * passed the approval gate with exit 0. A hallucinated consumer fails
 * exactly as W5 proved it must.
 *
 * The lanes: the FAKE lane's agent brain lives in fake-provider.mjs
 * (`toolsAgentTurn` -- the scripted search-then-read-then-answer policy
 * that computes its answer FROM THE TOOL RESULTS carried in the
 * conversation, never a server-side scan, never canned); the LIVE lane
 * (station-side) speaks the same text protocol against a real vendor --
 * the model gets the tools and must genuinely use them.
 *
 * Harness module (build/flauz/dogfood/**): NOT a gate instrument.
 */

import * as nodeFs from 'node:fs/promises';
import * as nodePath from 'node:path';
import { sha256Hex } from '../../../../extensions/flauz-workspace/src/api.ts';
import { TERMINAL_TOOL_ID } from '../../../../extensions/flauz-agent/src/tools/terminalTool.ts';
import { fenceTolerantParseBody, type AnswerParseOptions } from '../answerFence.ts';
import { answerParseFailDetail, finishReasonDetail } from '../liveBudget.mjs';
import { scanLedgerConsumers, verifyConsumersMap, LEDGER_MODULE, type ConsumerEntry, type MapVerification } from './explore-repo.task.ts';
import { createAgentToolSurface, mintToolReceipt, type AgentToolSurface, type ToolReceipt } from '../agentTools.ts';
import type { DogfoodExercise, DogfoodHarness, ExerciseCheck, ExerciseReceipt, EvidenceItem } from '../harnessTypes.ts';

/** The pinned schema id of the agent's tool-call directive. */
export const TOOLS_DIRECTIVE_SCHEMA = 'flauz.dogfood-tool-directive/v1';

/** The pinned schema id of the tools-lane exploration answer. */
export const TOOLS_ANSWER_SCHEMA = 'flauz.dogfood-explore-tools-answer/v1';

/** The pinned schema id of the tools-lane verification receipt. */
export const TOOLS_VERIFICATION_SCHEMA = 'flauz.dogfood-explore-tools-verification/v1';

/** The marker that selects the tool-carrying lane's provider branch (checked BEFORE the legacy exploration phrase). */
export const TOOLS_LANE_MARKER = '=== TOOL-CARRYING LANE: you have real tool access through the approved invocation path ===';

/** The tool-results block markers (the conversation state embedded in every ask). */
export const TOOL_RESULTS_BEGIN = '=== TOOL RESULTS: the approved tool invocations so far (each block: the receipt, the command, the exit code, the output) ===';
export const TOOL_RESULTS_END = '=== END TOOL RESULTS ===';

/** The turn bound of the tool loop (fail-closed: an agent that never answers FAILs). */
export const MAX_TOOL_TURNS = 8;

/**
 * THE QUESTION (the deferred P2-FIX-122 full-tree ask; the operational
 * definition is the fake lane's verbatim rule -- the same question, now
 * answerable because the agent can actually read the tree through its
 * tools).
 */
export const TOOLS_EXPLORATION_QUESTION = [
        'Map every consumer of the evidence ledger across extensions/flauz-*: file + line + what it consumes.',
        `Operational definition (the verifier enforces exactly this): a consumer is a file under extensions/flauz-*/ (any depth) carrying an import or export-from statement on a single line whose relative module specifier (./ or ../, resolved with extensionless->.ts and .js/.mjs/.cjs->.ts twinning) names ${LEDGER_MODULE}.`,
        'Report each consumer as { "file": repo-relative posix path, "line": the 1-based import line, "consumes": the imported named bindings (drop "type" markers) }.',
].join(' ');

/** One tool-call the agent directs (the directive's call row). */
export interface ToolCallDirective {
        readonly tool: string;
        readonly input: { readonly command: string };
}

export type ParseDirectiveOutcome = { readonly ok: true; readonly directive: { readonly calls: readonly ToolCallDirective[] } } | { readonly ok: false; readonly error: string };

/**
 * Parses a completion as a tool-call directive (the agent asking for
 * tools this turn). Raw JSON is the machine-lane default; live lanes
 * parse through the fence-tolerant path (P2-FIX-118/120).
 */
export function parseToolsDirective(text: string, options?: AnswerParseOptions): ParseDirectiveOutcome {
        const strip = fenceTolerantParseBody(text, options);
        let parsed: unknown;
        try {
                parsed = JSON.parse(strip.body);
        } catch (err) {
                return { ok: false, error: `not a directive: the completion is not valid JSON (${err instanceof Error ? err.message : String(err)})` };
        }
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
                return { ok: false, error: 'not a directive: the completion is not a JSON object' };
        }
        const record = parsed as Record<string, unknown>;
        if (record.schema !== TOOLS_DIRECTIVE_SCHEMA) {
                return { ok: false, error: `not a directive: the schema is ${JSON.stringify(record.schema)}` };
        }
        if (!Array.isArray(record.calls) || record.calls.length === 0) {
                return { ok: false, error: 'not a directive: "calls" must be a non-empty array' };
        }
        const calls: ToolCallDirective[] = [];
        for (const [index, entry] of record.calls.entries()) {
                if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
                        return { ok: false, error: `calls[${String(index)}] is not an object` };
                }
                const row = entry as Record<string, unknown>;
                if (typeof row.tool !== 'string' || row.tool.length === 0) {
                        return { ok: false, error: `calls[${String(index)}].tool must be a non-empty string` };
                }
                const input = row.input;
                if (input === null || typeof input !== 'object' || Array.isArray(input) || typeof (input as Record<string, unknown>).command !== 'string' || (input as Record<string, unknown>).command === '') {
                        return { ok: false, error: `calls[${String(index)}].input.command must be a non-empty string` };
                }
                calls.push({ tool: row.tool, input: { command: (input as Record<string, unknown>).command as string } });
        }
        return { ok: true, directive: { calls } };
}

/** The tools-lane answer document (the claimed map + the receipts it cites). */
export interface ToolsExplorationAnswer {
        readonly schema: string;
        readonly question: string;
        readonly method: string;
        readonly receipts: readonly string[];
        readonly consumers: readonly ConsumerEntry[];
}

export type ParseToolsAnswerOutcome = { readonly ok: true; readonly answer: ToolsExplorationAnswer } | { readonly ok: false; readonly error: string };

/** Parses the final answer document (raw JSON machine lanes; fence-tolerant live lanes). */
export function parseToolsAnswer(text: string, options?: AnswerParseOptions): ParseToolsAnswerOutcome {
        const strip = fenceTolerantParseBody(text, options);
        let parsed: unknown;
        try {
                parsed = JSON.parse(strip.body);
        } catch (err) {
                return { ok: false, error: `the completion is not valid JSON (${err instanceof Error ? err.message : String(err)})` };
        }
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
                return { ok: false, error: 'the answer document is not a JSON object' };
        }
        const record = parsed as Record<string, unknown>;
        if (record.schema !== TOOLS_ANSWER_SCHEMA) {
                return { ok: false, error: `the answer schema is ${JSON.stringify(record.schema)} but ${JSON.stringify(TOOLS_ANSWER_SCHEMA)} was expected` };
        }
        if (typeof record.question !== 'string' || record.question.length === 0) {
                return { ok: false, error: 'the answer field "question" must be a non-empty string' };
        }
        if (typeof record.method !== 'string' || record.method.length === 0) {
                return { ok: false, error: 'the answer field "method" must be a non-empty string' };
        }
        if (!Array.isArray(record.receipts) || record.receipts.some(id => typeof id !== 'string' || id.length === 0)) {
                return { ok: false, error: 'the answer field "receipts" must be an array of receipt id strings' };
        }
        if (!Array.isArray(record.consumers)) {
                return { ok: false, error: 'the answer field "consumers" is not an array' };
        }
        const consumers: ConsumerEntry[] = [];
        for (const [index, entry] of record.consumers.entries()) {
                if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
                        return { ok: false, error: `consumers[${String(index)}] is not an object` };
                }
                const row = entry as Record<string, unknown>;
                if (typeof row.file !== 'string' || row.file.length === 0) {
                        return { ok: false, error: `consumers[${String(index)}].file must be a non-empty string` };
                }
                if (typeof row.line !== 'number' || !Number.isInteger(row.line) || row.line < 1) {
                        return { ok: false, error: `consumers[${String(index)}].line must be a positive integer` };
                }
                if (!Array.isArray(row.consumes) || row.consumes.some(symbol => typeof symbol !== 'string')) {
                        return { ok: false, error: `consumers[${String(index)}].consumes must be an array of strings` };
                }
                consumers.push({ file: row.file, line: row.line, consumes: (row.consumes as unknown[]).map(String) });
        }
        return {
                ok: true,
                answer: {
                        schema: TOOLS_ANSWER_SCHEMA,
                        question: record.question,
                        method: record.method,
                        receipts: (record.receipts as unknown[]).map(String),
                        consumers,
                },
        };
}

/** The file a read command targeted (the last whitespace token -- the command shape the protocol pins). */
export function readCommandFile(command: string): string {
        const tokens = command.trim().split(/\s+/);
        return tokens.length === 0 ? '' : tokens[tokens.length - 1] ?? '';
}

/** True when the receipt is a READ receipt (an approved, exit-0 numbered-lines grep of one file). */
export function isReadReceipt(receipt: ToolReceipt): boolean {
        return receipt.approval.granted && receipt.execution !== null && receipt.execution.exitCode === 0 && /^grep\s+-n/.test(receipt.input.command);
}

/** One coverage row of the tool-receipt verification. */
export interface ReceiptCoverageRow {
        readonly file: string;
        readonly line: number;
        readonly coveredBy: string | null;
}

/** The tool-receipt contract verification (pure over the answer + the run's receipts). */
export interface ToolsReceiptVerification {
        readonly schema: 'flauz.dogfood-explore-tools-receipt-verification/v1';
        readonly ok: boolean;
        readonly problems: readonly string[];
        readonly coverage: readonly ReceiptCoverageRow[];
        readonly totals: {
                readonly receipts: number;
                readonly approvedReceipts: number;
                readonly deniedReceipts: number;
                readonly readReceipts: number;
                readonly citedReceipts: number;
                readonly coveredEntries: number;
                readonly uncoveredEntries: number;
        };
}

/**
 * THE TOOL-RECEIPT CONTRACT CHECK: the answer cites what it ACTUALLY
 * read. Every cited receipt must exist, have passed the approval gate
 * (asked + granted) and exited 0; every claimed consumer (file:line)
 * must be covered by a READ receipt whose real execution streamed that
 * numbered line of that file. A claimed entry with no covering receipt
 * is an uncovered claim (the hallucination shape the live lane must
 * fail on, exactly as W5 proved).
 */
export function verifyToolsReceipts(answer: ToolsExplorationAnswer, receipts: readonly ToolReceipt[]): ToolsReceiptVerification {
        const problems: string[] = [];
        const byId = new Map(receipts.map(receipt => [receipt.receiptId, receipt]));
        for (const cited of answer.receipts) {
                const receipt = byId.get(cited);
                if (receipt === undefined) {
                        problems.push(`the answer cites receipt ${cited} which this run never minted`);
                        continue;
                }
                if (!receipt.approval.asked || !receipt.approval.granted) {
                        problems.push(`the answer cites receipt ${cited} which did not pass the approval gate (asked=${String(receipt.approval.asked)}, granted=${String(receipt.approval.granted)})`);
                }
                if (receipt.execution === null || receipt.execution.exitCode !== 0) {
                        problems.push(`the answer cites receipt ${cited} whose real execution did not succeed (exit ${String(receipt.execution?.exitCode ?? 'n/a')})`);
                }
        }
        const coverage: ReceiptCoverageRow[] = [];
        for (const entry of answer.consumers) {
                let coveredBy: string | null = null;
                for (const receipt of receipts) {
                        if (!isReadReceipt(receipt)) {
                                continue;
                        }
                        if (readCommandFile(receipt.input.command) !== entry.file) {
                                continue;
                        }
                        const rowPresent = new RegExp(`^${String(entry.line)}:`, 'm').test(receipt.execution?.stdout ?? '');
                        if (rowPresent) {
                                coveredBy = receipt.receiptId;
                                break;
                        }
                }
                if (coveredBy === null) {
                        problems.push(`the claimed consumer ${entry.file}:${String(entry.line)} is not covered by any read receipt (the agent did not actually read that line through its tools)`);
                }
                coverage.push({ file: entry.file, line: entry.line, coveredBy });
        }
        const approvedReceipts = receipts.filter(receipt => receipt.approval.asked && receipt.approval.granted && receipt.execution !== null && receipt.execution.exitCode === 0).length;
        return {
                schema: 'flauz.dogfood-explore-tools-receipt-verification/v1',
                ok: problems.length === 0,
                problems,
                coverage,
                totals: {
                        receipts: receipts.length,
                        approvedReceipts,
                        deniedReceipts: receipts.length - approvedReceipts,
                        readReceipts: receipts.filter(isReadReceipt).length,
                        citedReceipts: answer.receipts.length,
                        coveredEntries: coverage.filter(row => row.coveredBy !== null).length,
                        uncoveredEntries: coverage.filter(row => row.coveredBy === null).length,
                },
        };
}

/** Renders one receipt's conversation block (the format the provider-side agent parses). */
export function renderToolReceiptBlock(receipt: ToolReceipt): string {
        const header = receipt.execution !== null
                ? `[receipt ${receipt.receiptId} | tool ${receipt.tool} | ${receipt.approval.granted ? 'approved' : 'denied'} | command: ${receipt.input.command} | exit ${String(receipt.execution.exitCode)}]`
                : `[receipt ${receipt.receiptId} | tool ${receipt.tool} | ${receipt.approval.granted ? 'approved' : 'denied'} | command: ${receipt.input.command} | refused before execution]`;
        return `${header}\n${receipt.execution !== null ? receipt.execution.stdout : '(no output: the invocation was refused at the approval gate)'}`;
}

/** Builds the ask prompt of one turn: the protocol header + the question + the full tool-results conversation state. */
export function buildToolsAskPrompt(receipts: readonly ToolReceipt[]): string {
        return [
                TOOLS_EXPLORATION_QUESTION,
                '',
                TOOLS_LANE_MARKER,
                'You are an agent WITH TOOL ACCESS: the flauz_terminal tool executes real commands in the repository root, and EVERY invocation passes the HumanApproval confirmation gate before it runs (an approved invocation is receipted below; a denied one is refused before execution). File read/search happens through this tool.',
                'TOOL PROTOCOL -- answer this turn with EXACTLY ONE JSON document, either:',
                `  a tool-call directive: { "schema": "${TOOLS_DIRECTIVE_SCHEMA}", "calls": [ { "tool": "flauz_terminal", "input": { "command": "<shell command>" } } ] }`,
                `  or the final answer: { "schema": "${TOOLS_ANSWER_SCHEMA}", "question": "<the question verbatim>", "method": "<how you found them>", "receipts": ["R-1", ...], "consumers": [ { "file": "...", "line": N, "consumes": [...] } ] }`,
                'Every consumer you report MUST be covered by a read receipt above (a numbered-lines read of that file); cite the receipt ids you actually used. A consumer you did not read through your tools is a hallucination and fails verification.',
                '',
                TOOL_RESULTS_BEGIN,
                ...(receipts.length === 0 ? ['(no tool invocations yet -- this is your first turn)'] : receipts.map(renderToolReceiptBlock)),
                TOOL_RESULTS_END,
        ].join('\n');
}

class Recorder {
        readonly checks: ExerciseCheck[] = [];

        check(id: string, ok: boolean, detail: string): boolean {
                this.checks.push({ id, ok, detail });
                return ok;
        }
}

/** Writes one driver-level workspace artifact + its evidence row (the journey's mint pattern). */
async function mintArtifact(harness: DogfoodHarness, uri: string, contents: string, note: string): Promise<{ item: EvidenceItem; evidenceId: string }> {
        const absolute = nodePath.join(harness.root, uri);
        await nodeFs.mkdir(nodePath.dirname(absolute), { recursive: true });
        await nodeFs.writeFile(absolute, contents, { encoding: 'utf-8' });
        const sha256 = sha256Hex(contents);
        const appended = await harness.ledger.append(harness.taskId, { kind: 'note', uri, sha256, note });
        await harness.tasks.recordEvidence(harness.taskId, { evidenceId: appended.evidenceId, seq: appended.seq, kind: 'note', uri, sha256, note });
        return { item: { kind: 'note', uri, sha256 }, evidenceId: appended.evidenceId };
}

/** The careful-human confirmation policy: read-only search commands are granted; anything else is refused at the gate. */
export function readOnlyCommandsConfirmationPolicy(toolName: string, confirmation: { title: string; message: string }): boolean {
        const match = /run `([^`]+)`/.exec(confirmation.message);
        if (match === null) {
                return false;
        }
        return /^grep\b/.test(match[1] ?? '');
}

export const TOOLS_EXPLORATION_EXERCISE: DogfoodExercise = {
        id: 'tools-exploration',
        title: 'tools exploration: the deferred full-tree ledger-consumer map through the agent-with-tools lane',
        prompt: TOOLS_EXPLORATION_QUESTION,
        dimensions: ['repository exploration', 'agent-with-tools', 'tool receipts', 'artifacts/evidence', 'slow-path timing'],
        async run(harness: DogfoodHarness): Promise<ExerciseReceipt> {
                const recorder = new Recorder();
                const evidenceIds: string[] = [];
                const evidenceItems: EvidenceItem[] = [];
                const notes: string[] = [];
                const receipts: ToolReceipt[] = [];
                const turns: Array<{ turn: number; kind: 'directive' | 'answer' | 'other'; detail: string }> = [];
                const live = harness.mode === 'live-provider';
                const surface = createAgentToolSurface({
                        cwd: harness.repoRoot,
                        confirmationPolicy: readOnlyCommandsConfirmationPolicy,
                        logger: () => undefined,
                });
                try {
                        let answer: ToolsExplorationAnswer | undefined;
                        let answerText = '';
                        let askCount = 0;

                        // (1) THE TOOL LOOP: the agent directs tool calls; the harness approves + executes + receipts
                        for (let turn = 1; turn <= MAX_TOOL_TURNS && answer === undefined; turn += 1) {
                                const prompt = buildToolsAskPrompt(receipts);
                                const askStartedAt = Date.now();
                                const outcome = await harness.provider.ask(prompt);
                                askCount += 1;
                                if (outcome.kind !== 'ok') {
                                        await harness.friction.timing({ phase: `tools-exploration:turn-${String(turn)}`, durationMs: Date.now() - askStartedAt, wallClockBudgetMs: outcome.wallClockBudgetMs });
                                        await harness.friction.friction({
                                                phase: `tools-exploration:turn-${String(turn)}`,
                                                kind: 'provider-failure',
                                                detail: `the tool-loop turn failed with the typed provider failure ${outcome.code} (${outcome.retryClass}, ${String(outcome.attempts)} attempts): ${outcome.message}`,
                                                recovery: '',
                                        });
                                        recorder.check('tools.model-calls-ok', false, `turn ${String(turn)} failed: ${outcome.message}`);
                                        break;
                                }
                                await harness.friction.timing({ phase: `tools-exploration:turn-${String(turn)}`, durationMs: Date.now() - askStartedAt, wallClockBudgetMs: outcome.wallClockBudgetMs });
                                const directive = parseToolsDirective(outcome.text, { fenceTolerant: live });
                                if (directive.ok) {
                                        turns.push({ turn, kind: 'directive', detail: `asks for ${String(directive.directive.calls.length)} tool call(s)` });
                                        for (const call of directive.directive.calls) {
                                                if (call.tool !== TERMINAL_TOOL_ID) {
                                                        await harness.friction.friction({
                                                                phase: `tools-exploration:turn-${String(turn)}`,
                                                                kind: 'failed-task',
                                                                detail: `the agent directed an unknown tool '${call.tool}' (the lane's tool surface is ${TERMINAL_TOOL_ID} only)`,
                                                                recovery: '',
                                                        });
                                                        recorder.check('tools.tool-surface-known', false, `the agent directed an unknown tool '${call.tool}'`);
                                                        continue;
                                                }
                                                const invocation = await surface.invokeTerminal(call.input.command);
                                                const receipt = mintToolReceipt({
                                                        receiptId: `R-${String(receipts.length + 1)}`,
                                                        command: call.input.command,
                                                        decision: invocation.decision,
                                                        execution: invocation.execution,
                                                        refusal: invocation.refusal,
                                                        ts: Date.now(),
                                                });
                                                receipts.push(receipt);
                                                if (invocation.kind === 'denied') {
                                                        // a human intervention at the approval gate: first-class friction, honestly logged
                                                        await harness.friction.friction({
                                                                phase: `tools-exploration:turn-${String(turn)}`,
                                                                kind: 'manual-intervention',
                                                                detail: `the human DENIED the ${TERMINAL_TOOL_ID} confirmation for '${call.input.command}' (the tool approval gate): the invocation was refused before execution`,
                                                                recovery: '',
                                                        });
                                                } else {
                                                        // the receipt's transcript is hash-pinned as the invocation's evidence row
                                                        const receiptUri = `.flauz/artifacts/${harness.taskId}/tool-receipt-${receipt.receiptId}.json`;
                                                        const artifact = await mintArtifact(harness, receiptUri, `${JSON.stringify(receipt, null, '\t')}\n`, `the tool receipt of the approved ${TERMINAL_TOOL_ID} invocation '${call.input.command}' (exit ${String(invocation.execution?.exitCode ?? -1)})`);
                                                        evidenceItems.push(artifact.item);
                                                        evidenceIds.push(artifact.evidenceId);
                                                        receipts[receipts.length - 1] = { ...receipt, evidence: { evidenceId: artifact.evidenceId, uri: receiptUri, sha256: artifact.item.sha256 } };
                                                }
                                        }
                                        continue;
                                }
                                const parsedAnswer = parseToolsAnswer(outcome.text, { fenceTolerant: live });
                                if (parsedAnswer.ok) {
                                        answer = parsedAnswer.answer;
                                        answerText = outcome.text;
                                        turns.push({ turn, kind: 'answer', detail: `the final answer carrying ${String(parsedAnswer.answer.consumers.length)} claimed consumers citing ${String(parsedAnswer.answer.receipts.length)} receipts` });
                                        break;
                                }
                                // neither a directive nor an answer: the honest parse failure
                                await harness.friction.friction({
                                        phase: `tools-exploration:turn-${String(turn)}`,
                                        kind: 'failed-task',
                                        detail: `the completion was neither a tool-call directive nor the final answer: ${directive.error}; ${parsedAnswer.error}`,
                                        recovery: '',
                                });
                                recorder.check('tools.model-calls-ok', false, answerParseFailDetail(`turn ${String(turn)}: ${directive.error}; ${parsedAnswer.error}`, outcome.finishReason));
                                break;
                        }

                        if (recorder.checks.length === 0 || recorder.checks.every(check => check.id !== 'tools.model-calls-ok')) {
                                recorder.check('tools.model-calls-ok', askCount === turns.length && turns.length > 0 && turns[turns.length - 1]?.kind === 'answer',
                                        askCount === 0
                                                ? 'no ask was made (machinery failure)'
                                                : `the tool loop ran ${String(askCount)} ask(s) over ${String(turns.length)} turn(s) (${turns.map(entry => `#${String(entry.turn)}:${entry.kind}`).join(', ')}) and produced the final answer`);
                        }
                        if (answer === undefined) {
                                if (turns.length >= MAX_TOOL_TURNS) {
                                        await harness.friction.friction({
                                                phase: 'tools-exploration:turn-bound',
                                                kind: 'failed-task',
                                                detail: `the tool loop exhausted its ${String(MAX_TOOL_TURNS)}-turn bound without a final answer (fail-closed: an agent that never answers FAILs)`,
                                                recovery: '',
                                        });
                                }
                                recorder.check('tools.answer-parses', false, 'the agent never produced the final answer document within the turn bound');
                        } else {
                                recorder.check('tools.answer-parses', true, `the final answer document carries ${String(answer.consumers.length)} claimed consumers citing ${String(answer.receipts.length)} tool receipts`);
                        }

                        // (2) THE TOOL-RECEIPT CONTRACT CHECK (checked, never trusted)
                        const receiptVerification = verifyToolsReceipts(
                                answer ?? { schema: TOOLS_ANSWER_SCHEMA, question: '', method: '', receipts: [], consumers: [] },
                                receipts,
                        );
                        const receiptsOk = receiptVerification.ok
                                && receipts.length > 0
                                && receipts.every(receipt => receipt.approval.asked)
                                && receiptVerification.totals.deniedReceipts === 0;
                        recorder.check('tools.tool-receipts-real', receiptsOk, receiptsOk
                                ? `every one of the ${String(receipts.length)} tool invocations passed the approval gate (asked + granted) and really executed (exit 0; every receipt transcript hash-pinned as an evidence row); ${String(receiptVerification.totals.readReceipts)} of them are numbered-line reads`
                                : `the tool receipts do not satisfy the contract: ${receiptVerification.problems.slice(0, 3).join('; ')} (receipts ${String(receipts.length)}, denied ${String(receiptVerification.totals.deniedReceipts)})`);
                        if (answer !== undefined) {
                                recorder.check('tools.answer-cites-reads', receiptVerification.ok && receiptVerification.totals.uncoveredEntries === 0, receiptVerification.ok
                                        ? `every claimed consumer is covered by a read receipt whose real execution streamed that file:line (${String(receiptVerification.totals.coveredEntries)}/${String(receiptVerification.totals.coveredEntries + receiptVerification.totals.uncoveredEntries)} covered; ${String(receiptVerification.totals.citedReceipts)} receipts cited)`
                                        : `the answer's citations do not hold: ${receiptVerification.problems.slice(0, 3).join('; ')}`);
                        }

                        // (3) THE DRIVER'S INDEPENDENT GROUND-TRUTH SCAN (the same sound+complete 100% bar)
                        let verification: MapVerification | undefined;
                        if (answer !== undefined) {
                                const verifyStartedAt = Date.now();
                                const groundTruth = await scanLedgerConsumers(harness.repoRoot);
                                verification = await verifyConsumersMap({ schema: answer.schema, consumers: answer.consumers }, groundTruth, harness.repoRoot);
                                await harness.friction.timing({ phase: 'tools-exploration:driver-verification', durationMs: Date.now() - verifyStartedAt });
                                recorder.check('tools.map-sound', verification.totals.problemEntries === 0, `every claimed entry re-reads as a real ledger import (${String(verification.totals.claimed - verification.totals.problemEntries)}/${String(verification.totals.claimed)} sound)`);
                                recorder.check('tools.map-complete', verification.totals.missedEntries === 0, `the map misses ${String(verification.totals.missedEntries)} of the ${String(verification.totals.real)} real consumers`);
                                recorder.check('tools.map-100-percent', verification.verified, `claimed ${String(verification.totals.claimed)} vs real ${String(verification.totals.real)}; verified=${String(verification.verified)} (the driver's independent scan: the map CHECKED, never trusted)`);
                        }

                        // (4) THE ARTIFACTS + THE EVIDENCE CHAIN
                        const answerUri = `.flauz/artifacts/${harness.taskId}/tools-exploration-answer.json`;
                        const answerArtifact = await mintArtifact(harness, answerUri, answerText !== '' ? answerText : '(no answer was produced)\n', 'the tools-exploration answer as received over the wire (the agent-with-tools lane)');
                        evidenceItems.push(answerArtifact.item);
                        evidenceIds.push(answerArtifact.evidenceId);
                        const verificationReceipt = {
                                schema: TOOLS_VERIFICATION_SCHEMA,
                                mode: harness.mode,
                                ledgerModule: LEDGER_MODULE,
                                question: TOOLS_EXPLORATION_QUESTION,
                                turns,
                                receiptVerification,
                                toolReceipts: receipts,
                                mapVerification: verification ?? null,
                                verified: (verification?.verified ?? false) && receiptVerification.ok,
                        };
                        const verificationUri = `.flauz/artifacts/${harness.taskId}/tools-exploration-verification.json`;
                        const verificationArtifact = await mintArtifact(harness, verificationUri, `${JSON.stringify(verificationReceipt, null, '\t')}\n`, 'the tools-exploration verification receipt (the driver-side ground-truth scan + the tool-receipt contract check)');
                        evidenceItems.push(verificationArtifact.item);
                        evidenceIds.push(verificationArtifact.evidenceId);
                        await nodeFs.mkdir(harness.recordsDir, { recursive: true });
                        await nodeFs.writeFile(nodePath.join(harness.recordsDir, 'tools-exploration.verification.json'), `${JSON.stringify(verificationReceipt, null, '\t')}\n`, { encoding: 'utf-8' });
                        const receiptEvidenceCount = receipts.filter(receipt => receipt.evidence !== null).length;
                        recorder.check('tools.evidence-minted', evidenceItems.length === 2 + receipts.length && receiptEvidenceCount === receipts.length, `the answer + the verification receipt + every one of the ${String(receipts.length)} approved tool receipts' transcripts are hash-pinned into the evidence ledger (${String(evidenceItems.length)} evidence rows); every receipt carries its minted evidence row`);

                        // (5) honest friction: only what actually happened
                        if (verification !== undefined && !verification.verified) {
                                const firstProblem = verification.checked.find(entry => !entry.ok)?.problems[0] ?? 'no problem detail';
                                await harness.friction.friction({
                                        phase: 'tools-exploration:verify',
                                        kind: 'failed-task',
                                        detail: `the tools-lane map is not 100% verified: ${String(verification.totals.problemEntries)} problem entries, ${String(verification.totals.missedEntries)} missed; first problem: ${firstProblem}`,
                                        recovery: '',
                                });
                        }
                        if (!receiptVerification.ok) {
                                await harness.friction.friction({
                                        phase: 'tools-exploration:receipts',
                                        kind: 'evidence-gap',
                                        detail: `the tool-receipt contract failed: ${receiptVerification.problems.slice(0, 3).join('; ')}`,
                                        recovery: '',
                                });
                        }

                        notes.push(`the deferred P2-FIX-122 full-tree question asked through the TOOL-CARRYING lane: ${String(askCount)} ask(s), ${String(receipts.length)} approved ${TERMINAL_TOOL_ID} invocation(s) (${String(receiptVerification.totals.readReceipts)} numbered-line reads), the answer citing its receipts`);
                        notes.push('the verification is the driver\'s independent ground-truth scan (scanLedgerConsumers + verifyConsumersMap -- the same sound+complete 100% bar as the fake lane\'s full-tree check) PLUS the tool-receipt contract (every claimed consumer covered by a read receipt that really streamed that file:line)');
                        notes.push(live
                                ? 'model intelligence: live-provider (the station\'s live run claims it; the model must genuinely use the tools -- hallucinated consumers fail exactly as W5 proved they must)'
                                : 'model intelligence: fixture (the fake lane\'s scripted agent policy computes its answer FROM THE TOOL RESULTS carried in the conversation -- never a server-side scan, never canned)');
                        notes.push(`seams: local-real (the real routing + adapter stream per ask, the real flauz_terminal tool over a real /bin/sh child on the repo root, the HumanApproval gate in front of every invocation)`);
                } finally {
                        surface.dispose();
                }

                const failCount = recorder.checks.filter(check => !check.ok).length;
                const frictionRows = await harness.friction.readAll();
                return {
                        schema: 'flauz.dogfood-exercise-receipt/v1',
                        exerciseId: 'tools-exploration',
                        title: 'tools exploration: the deferred full-tree ledger-consumer map through the agent-with-tools lane',
                        dimensions: ['repository exploration', 'agent-with-tools', 'tool receipts', 'artifacts/evidence', 'slow-path timing'],
                        verdict: failCount === 0 ? 'PASS' : 'FAIL',
                        checks: recorder.checks,
                        evidenceIds,
                        evidenceItems,
                        frictionLogPath: harness.friction.path,
                        frictionRows: {
                                friction: frictionRows.filter(row => row.type === 'friction').length,
                                timing: frictionRows.filter(row => row.type === 'timing').length,
                                recovery: frictionRows.filter(row => row.type === 'friction' && typeof row.recovery === 'string' && row.recovery.length > 0).length,
                        },
                        evidenceLevels: { seams: 'local-real', modelIntelligence: 'fixture' },
                        notes,
                };
        },
};
