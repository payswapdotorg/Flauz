/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * A-PROD-003-W1 (dogfood harness) -- EXERCISE 2: provider switching +
 * failure/recovery.
 *
 * The driver switches the session's provider lane
 *
 *     healthy -> scripted-failing -> healthy
 *
 * (the healthy lane is the fake lane in the W1 sandbox; the live lane
 * at the station in W2 -- same code path, the ENV contract selects it).
 * Every switch is the REAL enablement act: the workspace providers
 * file + the routing policy rewrite, a fresh capability-registry load
 * and a durable ModelRouter decision. The scripted-failing lane answers
 * every completion with HTTP 500, which the REAL adapter maps onto the
 * TYPED provider failure PROVIDER_OVERLOADED (retryable, short-backoff)
 * feeding the product's own bounded-retry bound. The recovery switch
 * returns to the healthy lane and the same call type succeeds.
 *
 * Receipts (the G5 contract): >= 1 typed provider-failure friction row
 * + >= 1 recovery row (a friction row whose `recovery` account is
 * populated) + one evidence row minted per switch.
 *
 * Dogfood dimensions exercised: provider switching, failure/recovery,
 * artifacts/evidence, slow-path timing rows.
 */

import * as nodeFs from 'node:fs/promises';
import * as nodePath from 'node:path';
import { sha256Hex } from '../../../../extensions/flauz-workspace/src/api.ts';
import { fenceTolerantParseBody, type AnswerParseOptions } from '../answerFence.ts';
import type { AskOutcome, AskProviderFailure, DogfoodExercise, DogfoodHarness, DogfoodMode, ExerciseCheck, ExerciseReceipt, EvidenceItem, LaneSwitchReceipt } from '../harnessTypes.ts';

/** The answer document's pinned schema id. */
export const SWITCH_ANSWER_SCHEMA = 'flauz.dogfood-switch-answer/v1';

/** THE QUESTION (marker-pinned so the fake lane recognizes it and answers from the real workspace state). */
export const SWITCH_QUESTION = [
        'Report the provider-lane configuration of this Flauz workspace as it stands right now: which dogfood provider lanes are enabled in the workspace providers file, and how many routing decisions the durable routing-decision ledger carries.',
        `Answer with exactly one JSON document of shape { "schema": "${SWITCH_ANSWER_SCHEMA}", "enabledDogfoodProviders": [...], "routingDecisionCount": N, "lastDecisionId": "rd-NNNNNN" } and nothing else.`,
].join(' ');

/** One planned lane switch (the order's fixed sequence). */
export interface SwitchStepPlan {
        readonly switchNo: number;
        readonly lane: 'healthy' | 'scripted-failing';
        readonly concreteLane: 'fake' | 'live' | 'scripted-failing';
        readonly expect: 'ok' | 'typed-provider-failure';
}

/** The healthy lane of a mode (the W1 sandbox runs the fake lane; the station's W2 run goes live). */
export function healthyLaneOf(mode: DogfoodMode): 'fake' | 'live' {
        return mode === 'live-provider' ? 'live' : 'fake';
}

/** The planned switch sequence: healthy -> scripted-failing -> healthy. */
export function plannedSwitchSequence(mode: DogfoodMode): readonly SwitchStepPlan[] {
        const healthy = healthyLaneOf(mode);
        return [
                { switchNo: 1, lane: 'healthy', concreteLane: healthy, expect: 'ok' },
                { switchNo: 2, lane: 'scripted-failing', concreteLane: 'scripted-failing', expect: 'typed-provider-failure' },
                { switchNo: 3, lane: 'healthy', concreteLane: healthy, expect: 'ok' },
        ];
}

/** The typed provider-failure detail line (the friction row's `detail`). */
export function providerFailureDetail(failure: { code: string; retryClass: string; retryable: boolean; status?: number; attempts: number; message: string }): string {
        return `the scripted-failing lane surfaced the TYPED provider failure ${failure.code} (retryable=${String(failure.retryable)}, retryClass=${failure.retryClass}, httpStatus=${String(failure.status ?? 'n/a')}) after ${String(failure.attempts)} bounded-retry attempt(s): ${failure.message}`;
}

/** The recovery account (the friction row's `recovery`). */
export function recoveryAccount(recoveredSwitchNo: number, healthyLane: string, recoveryMs: number): string {
        return `the lane was switched back to the healthy provider (${healthyLane}, switch ${String(recoveredSwitchNo)}) and the same call type succeeded there; the failing lane stayed disabled in the workspace providers file; recovery measured ${String(recoveryMs)} ms from failure detection`;
}

// ---------------------------------------------------------------------------
// The answer contract + the workspace-state verification (checked, not trusted)
// ---------------------------------------------------------------------------

export interface SwitchAnswer {
        readonly schema: string;
        readonly enabledDogfoodProviders: readonly string[];
        readonly routingDecisionCount: number;
        readonly lastDecisionId: string;
}

export type ParseSwitchOutcome = { readonly ok: true; readonly answer: SwitchAnswer; readonly fenceStripped: boolean } | { readonly ok: false; readonly error: string };

/**
 * Parses the provider-switch answer document.
 *
 * P2-FIX-118: with `options.fenceTolerant` (the LIVE lanes) a leading/
 * trailing markdown fence pair around the JSON payload is stripped
 * before the raw parse (strip-fence-then-parse); malformed JSON inside
 * the fence still FAILS. The default (machine lanes) parses raw JSON
 * only -- unchanged, the W1/W2 evidence path.
 *
 * P2-FIX-120: the fence-tolerant path now ALSO extracts the FIRST
 * COMPLETE fenced block from anywhere in the text (prose before/after
 * allowed -- the live model's conversational wrapping); a text with no
 * complete fence still falls to the raw parse (the honest failure).
 */
export function parseSwitchAnswer(text: string, options?: AnswerParseOptions): ParseSwitchOutcome {
        const strip = fenceTolerantParseBody(text, options);
        let parsed: unknown;
        try {
                parsed = JSON.parse(strip.body);
        } catch (err) {
                const reason = err instanceof Error ? err.message : String(err);
                return { ok: false, error: strip.fenced ? `the completion is not valid JSON inside the stripped markdown fence: ${reason}` : `the completion is not valid JSON: ${reason}` };
        }
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
                return { ok: false, error: 'the answer document is not a JSON object' };
        }
        const record = parsed as Record<string, unknown>;
        if (record.schema !== SWITCH_ANSWER_SCHEMA) {
                return { ok: false, error: `the answer schema is ${JSON.stringify(record.schema)} but ${JSON.stringify(SWITCH_ANSWER_SCHEMA)} was expected` };
        }
        if (!Array.isArray(record.enabledDogfoodProviders) || record.enabledDogfoodProviders.some(entry => typeof entry !== 'string')) {
                return { ok: false, error: 'the answer field "enabledDogfoodProviders" must be an array of strings' };
        }
        if (typeof record.routingDecisionCount !== 'number' || !Number.isInteger(record.routingDecisionCount) || record.routingDecisionCount < 0) {
                return { ok: false, error: 'the answer field "routingDecisionCount" must be a non-negative integer' };
        }
        if (typeof record.lastDecisionId !== 'string') {
                return { ok: false, error: 'the answer field "lastDecisionId" must be a string' };
        }
        return {
                ok: true,
                answer: {
                        schema: SWITCH_ANSWER_SCHEMA,
                        enabledDogfoodProviders: (record.enabledDogfoodProviders as unknown[]).map(String),
                        routingDecisionCount: record.routingDecisionCount,
                        lastDecisionId: record.lastDecisionId,
                },
                fenceStripped: strip.fenced,
        };
}

/** Reads the workspace's real model-state files (the ground truth the answer is checked against). */
export async function readWorkspaceModelState(workspaceRoot: string): Promise<{ readonly enabledDogfoodProviders: readonly string[]; readonly decisionIds: readonly string[] }> {
        const enabled: string[] = [];
        let decisionIds: string[] = [];
        try {
                const raw = JSON.parse(await nodeFs.readFile(nodePath.join(workspaceRoot, '.flauz', 'models', 'providers.json'), { encoding: 'utf-8' })) as { providers?: Array<{ providerId?: unknown; enabled?: unknown }> };
                for (const entry of raw.providers ?? []) {
                        if (entry !== null && typeof entry === 'object' && typeof entry.providerId === 'string' && entry.providerId.startsWith('flauz-dogfood') && entry.enabled === true) {
                                enabled.push(entry.providerId);
                        }
                }
        } catch {
                // no providers file yet: the honest empty state
        }
        try {
                const text = await nodeFs.readFile(nodePath.join(workspaceRoot, '.flauz', 'models', 'routing-decisions.jsonl'), { encoding: 'utf-8' });
                decisionIds = text.split('\n').filter(line => line.length > 0).map(line => (JSON.parse(line) as { decisionId?: unknown }).decisionId).filter((id): id is string => typeof id === 'string');
        } catch {
                // no decision ledger yet
        }
        return { enabledDogfoodProviders: [...enabled].sort(), decisionIds };
}

/** Verifies the model's answer against the workspace's on-disk model state. */
export async function verifySwitchAnswer(answer: SwitchAnswer, workspaceRoot: string): Promise<{ readonly ok: boolean; readonly problems: readonly string[] }> {
        const problems: string[] = [];
        const state = await readWorkspaceModelState(workspaceRoot);
        const claimed = [...answer.enabledDogfoodProviders].sort();
        const real = [...state.enabledDogfoodProviders];
        if (claimed.join(',') !== real.join(',')) {
                problems.push(`enabledDogfoodProviders claimed [${claimed.join(', ')}] but the providers file says [${real.join(', ')}]`);
        }
        if (answer.routingDecisionCount !== state.decisionIds.length) {
                problems.push(`routingDecisionCount claimed ${String(answer.routingDecisionCount)} but the decision ledger carries ${String(state.decisionIds.length)}`);
        }
        const lastReal = state.decisionIds.length === 0 ? '' : state.decisionIds[state.decisionIds.length - 1] ?? '';
        if (answer.lastDecisionId !== lastReal) {
                problems.push(`lastDecisionId claimed ${JSON.stringify(answer.lastDecisionId)} but the ledger head is ${JSON.stringify(lastReal)}`);
        }
        return { ok: problems.length === 0, problems };
}

// ---------------------------------------------------------------------------
// P2-FIX-119: the workspace facts carried IN the prompt (embedded at ask time)
// ---------------------------------------------------------------------------

/**
 * The W2 live run proved the bare-model question unanswerable: a chat
 * completion with no tool/file access cannot see the providers file or
 * the routing-decision ledger, so the verification failed for the WRONG
 * reason (the fake lane only "knew" the configuration because it
 * computed answers server-side from the real files -- a god-view the
 * exercise design leaked).
 *
 * The fix is harness-only: the exercise carries the workspace facts IN
 * the prompt (the verbatim providers file content + the
 * routing-decision tail, embedded AT ASK TIME -- after the ask's own
 * durable routing decision, right before the request ships) and asks
 * the model to report them faithfully. BOTH lanes now answer from the
 * prompt-carried facts; the fake lane's server-side computation path
 * for this question is retired. The verification below stays strict
 * (the answer is still checked against the workspace's real state
 * files, never trusted).
 */

/** The embedded-facts section markers (the fake lane parses these -- pinned by the round-trip tests). */
export const SWITCH_FACTS_PROVIDERS_BEGIN = '=== WORKSPACE FACT: providers file (.flauz/models/providers.json), verbatim ===';
export const SWITCH_FACTS_PROVIDERS_END = '=== END providers file ===';
export const SWITCH_FACTS_DECISIONS_BEGIN = '=== WORKSPACE FACT: routing-decision ledger (.flauz/models/routing-decisions.jsonl) ===';
export const SWITCH_FACTS_DECISIONS_END = '=== END routing-decision ledger ===';

/** How many routing-decision rows the prompt tail carries (the oldest-first tail window). */
export const DECISION_TAIL_WINDOW = 3;

/** The workspace facts the prompt carries (captured at ask time). */
export interface SwitchQuestionFacts {
        readonly providersFileContent: string;
        readonly routingDecisionCount: number;
        readonly lastDecisionId: string;
        readonly decisionTail: readonly string[];
}

/** Reads the workspace facts the question embeds (the same files the verification reads). */
export async function readSwitchQuestionFacts(workspaceRoot: string): Promise<SwitchQuestionFacts> {
        let providersFileContent = '';
        try {
                providersFileContent = await nodeFs.readFile(nodePath.join(workspaceRoot, '.flauz', 'models', 'providers.json'), { encoding: 'utf-8' });
        } catch {
                // absent file: the honest empty state (embedded as such)
        }
        let decisionLines: string[] = [];
        try {
                const text = await nodeFs.readFile(nodePath.join(workspaceRoot, '.flauz', 'models', 'routing-decisions.jsonl'), { encoding: 'utf-8' });
                decisionLines = text.split('\n').filter(line => line.length > 0);
        } catch {
                // absent ledger: zero decisions so far
        }
        const tail = decisionLines.slice(-DECISION_TAIL_WINDOW);
        let lastDecisionId = '';
        for (const line of [...tail].reverse()) {
                try {
                        const row = JSON.parse(line) as { decisionId?: unknown };
                        if (typeof row.decisionId === 'string') {
                                lastDecisionId = row.decisionId;
                                break;
                        }
                } catch {
                        // not a JSON row: keep walking the tail backwards
                }
        }
        return { providersFileContent, routingDecisionCount: decisionLines.length, lastDecisionId, decisionTail: tail };
}

/** The honest placeholder when the providers file is absent (the empty state is a fact too). */
const PROVIDERS_ABSENT_NOTE = '(the providers file is absent -- the honest empty state: no dogfood provider lane is enabled)';

/** The honest placeholder when the routing-decision ledger is empty. */
const DECISIONS_EMPTY_NOTE = '(the routing-decision ledger is empty -- no routing decisions recorded)';

/**
 * Builds the full provider-switch question with the workspace facts
 * embedded (called AT ASK TIME so the facts include the ask's own
 * routing decision -- the verification then reads exactly the same
 * state, and a faithful report verifies).
 */
export async function buildSwitchQuestion(workspaceRoot: string): Promise<string> {
        const facts = await readSwitchQuestionFacts(workspaceRoot);
        return [
                SWITCH_QUESTION,
                '',
                'You are a bare chat completion with NO tool or file access, so the workspace facts you must report are embedded below, captured at ask time (P2-FIX-119: the exercise carries the facts in the prompt; both lanes answer from the prompt-carried facts).',
                '',
                SWITCH_FACTS_PROVIDERS_BEGIN,
                facts.providersFileContent.length > 0 ? facts.providersFileContent : PROVIDERS_ABSENT_NOTE,
                SWITCH_FACTS_PROVIDERS_END,
                '',
                SWITCH_FACTS_DECISIONS_BEGIN,
                `total routing decisions recorded: ${String(facts.routingDecisionCount)}`,
                `routing-decision tail (the last up to ${String(DECISION_TAIL_WINDOW)} rows, verbatim, oldest first):`,
                ...(facts.decisionTail.length > 0 ? [...facts.decisionTail] : [DECISIONS_EMPTY_NOTE]),
                SWITCH_FACTS_DECISIONS_END,
                '',
                'Report the facts above faithfully: enabledDogfoodProviders = every provider entry whose providerId starts with "flauz-dogfood" and whose "enabled" is true in the providers file above; routingDecisionCount = the total routing decisions recorded; lastDecisionId = the decisionId of the LAST tail row ("" when the ledger is empty).',
                `Answer with exactly one JSON document of shape { "schema": "${SWITCH_ANSWER_SCHEMA}", "enabledDogfoodProviders": [...], "routingDecisionCount": N, "lastDecisionId": "rd-NNNNNN" } and nothing else.`,
        ].join('\n');
}

/** Checks that an ask prompt actually carries the workspace facts (checked, not trusted; the G6 receipt). */
export async function verifyPromptCarriesFacts(prompt: string, workspaceRoot: string): Promise<{ readonly ok: boolean; readonly problems: readonly string[] }> {
        const problems: string[] = [];
        const facts = await readSwitchQuestionFacts(workspaceRoot);
        if (!prompt.includes(SWITCH_FACTS_PROVIDERS_BEGIN) || !prompt.includes(SWITCH_FACTS_PROVIDERS_END)) {
                problems.push('the ask prompt carries no providers-file facts section');
        } else if (facts.providersFileContent.length > 0 && !prompt.includes(facts.providersFileContent)) {
                problems.push('the ask prompt does not embed the workspace providers file verbatim');
        }
        if (!prompt.includes(SWITCH_FACTS_DECISIONS_BEGIN) || !prompt.includes(SWITCH_FACTS_DECISIONS_END)) {
                problems.push('the ask prompt carries no routing-decision facts section');
        } else {
                if (!prompt.includes(`total routing decisions recorded: ${String(facts.routingDecisionCount)}`)) {
                        problems.push(`the ask prompt states a stale routing-decision count (the ledger carries ${String(facts.routingDecisionCount)})`);
                }
                if (facts.lastDecisionId.length > 0 && !prompt.includes(facts.lastDecisionId)) {
                        problems.push(`the ask prompt tail does not carry the current routing-decision head ${facts.lastDecisionId}`);
                }
        }
        return { ok: problems.length === 0, problems };
}

/** Redacts report-copy secrets posture: credentialRef and baseUrl VALUES never ride a receipt (the G6 receipt quotes the redacted ask). */
export function redactAskPromptForReport(prompt: string): string {
        return prompt
                .replace(/("credentialRef"\s*:\s*)"[^"\n]*"/g, '$1"<redacted>"')
                .replace(/("baseUrl"\s*:\s*)"[^"\n]*"/g, '$1"<redacted>"');
}

// ---------------------------------------------------------------------------
// The run summary (pure, testable)
// ---------------------------------------------------------------------------

/** One executed switch as recorded by the exercise. */
export interface SwitchRunRecord {
        readonly switchNo: number;
        readonly lane: 'healthy' | 'scripted-failing';
        readonly receipt: LaneSwitchReceipt;
        readonly ask: AskOutcome;
        readonly askPrompt: string;
        readonly promptFacts: PromptFactsCheck;
        readonly answerProblems: readonly string[];
        readonly atMs: number;
        readonly durationMs: number;
}

/** The ask-time prompt-facts check (P2-FIX-119: the facts are checked, not trusted). */
export interface PromptFactsCheck {
        readonly ok: boolean;
        readonly problems: readonly string[];
}

export interface SwitchRunSummary {
        readonly ok: boolean;
        readonly problems: readonly string[];
        readonly typedFailure: SwitchRunRecord | undefined;
        readonly recovery: SwitchRunRecord | undefined;
        readonly recoveryMs: number;
}

/** Type guard: the record's ask surfaced the typed provider failure. */
function hasTypedFailure(record: SwitchRunRecord): record is SwitchRunRecord & { readonly ask: AskProviderFailure } {
        return record.ask.kind === 'provider-failure';
}

/** Summarizes + validates a switch run against its plan (the exercise's self-check). */
export function summarizeSwitchRun(plan: readonly SwitchStepPlan[], records: readonly SwitchRunRecord[]): SwitchRunSummary {
        const problems: string[] = [];
        if (records.length !== plan.length) {
                problems.push(`executed ${String(records.length)} switches but ${String(plan.length)} were planned`);
        }
        const typedFailure = records.find(hasTypedFailure);
        const recovery = records.find((record, index) => index > 0 && records[index - 1]?.ask.kind === 'provider-failure' && record.ask.kind === 'ok');
        const expectedFailure = plan.find(step => step.expect === 'typed-provider-failure');
        if (expectedFailure !== undefined && typedFailure === undefined) {
                problems.push(`the planned failing window (switch ${String(expectedFailure.switchNo)}) produced no typed provider failure`);
        }
        if (typedFailure !== undefined && typedFailure.ask.attempts < 2) {
                problems.push(`the typed failure exhausted no bounded-retry window (${String(typedFailure.ask.attempts)} attempt(s))`);
        }
        if (typedFailure !== undefined && (typedFailure.ask.retryClass.length === 0 || typedFailure.ask.code.length === 0)) {
                problems.push('the typed failure carries no code/retryClass');
        }
        if (recovery === undefined && typedFailure !== undefined) {
                problems.push('the run never recovered onto a healthy lane after the typed failure');
        }
        for (const record of records) {
                if (record.receipt.evidenceId.length === 0) {
                        problems.push(`switch ${String(record.switchNo)} minted no evidence row`);
                }
        }
        for (const record of records) {
                if (record.answerProblems.length > 0) {
                        problems.push(`switch ${String(record.switchNo)}'s answer/prompt verification reported problems: ${record.answerProblems.join('; ')}`);
                }
        }
        const recoveryMs = typedFailure !== undefined && recovery !== undefined ? Math.max(0, recovery.atMs - typedFailure.atMs) : 0;
        return { ok: problems.length === 0, problems, typedFailure, recovery, recoveryMs };
}

// ---------------------------------------------------------------------------
// The exercise
// ---------------------------------------------------------------------------

class Recorder {
        readonly checks: ExerciseCheck[] = [];

        check(id: string, ok: boolean, detail: string): boolean {
                this.checks.push({ id, ok, detail });
                return ok;
        }
}

async function mintArtifact(harness: DogfoodHarness, uri: string, contents: string, note: string): Promise<{ item: EvidenceItem; evidenceId: string }> {
        const absolute = nodePath.join(harness.root, uri);
        await nodeFs.mkdir(nodePath.dirname(absolute), { recursive: true });
        await nodeFs.writeFile(absolute, contents, { encoding: 'utf-8' });
        const sha256 = sha256Hex(contents);
        const appended = await harness.ledger.append(harness.taskId, { kind: 'note', uri, sha256, note });
        await harness.tasks.recordEvidence(harness.taskId, { evidenceId: appended.evidenceId, seq: appended.seq, kind: 'note', uri, sha256, note });
        return { item: { kind: 'note', uri, sha256 }, evidenceId: appended.evidenceId };
}

export const PROVIDER_SWITCH_EXERCISE: DogfoodExercise = {
        id: 'provider-switch',
        title: 'provider switching: fake -> scripted-failing -> fake with typed failure + recovery',
        prompt: SWITCH_QUESTION,
        dimensions: ['provider switching', 'failure/recovery', 'artifacts/evidence', 'slow-path timing'],
        async run(harness: DogfoodHarness): Promise<ExerciseReceipt> {
                const recorder = new Recorder();
                const evidenceIds: string[] = [];
                const evidenceItems: EvidenceItem[] = [];
                const notes: string[] = [];
                const plan = plannedSwitchSequence(harness.mode);
                const records: SwitchRunRecord[] = [];
                let failureDetectedAtMs = 0;

                for (const step of plan) {
                        harness.log(`switch ${String(step.switchNo)}: selecting lane '${step.concreteLane}' (expect ${step.expect})`);
                        const switchStartedAt = Date.now();
                        const receipt = await harness.provider.selectLane(step.concreteLane);
                        const askStartedAt = Date.now();
                        // P2-FIX-119: the question is BUILT AT ASK TIME (inside the ask window,
                        // after the ask's own durable routing decision) so the embedded facts
                        // are exactly the state the strict verification will read.
                        let askPrompt = '';
                        const ask = await harness.provider.ask(async () => {
                                askPrompt = await buildSwitchQuestion(harness.root);
                                return askPrompt;
                        });
                        const atMs = Date.now();
                        const durationMs = atMs - switchStartedAt;
                        await harness.friction.timing({ phase: `provider-switch:switch-${String(step.switchNo)}`, durationMs, wallClockBudgetMs: ask.wallClockBudgetMs });

                        const answerProblems: string[] = [];
                        if (ask.kind === 'ok') {
                                // P2-FIX-118: the LIVE lanes get the fence-tolerant parse
                                // (strip-fence-then-parse); machine lanes keep the raw-JSON default.
                                const parsed = parseSwitchAnswer(ask.text, { fenceTolerant: harness.mode === 'live-provider' });
                                if (!parsed.ok) {
                                        answerProblems.push(parsed.error);
                                } else {
                                        const verification = await verifySwitchAnswer(parsed.answer, harness.root);
                                        answerProblems.push(...verification.problems);
                                }
                        } else if (step.expect === 'ok') {
                                answerProblems.push(`the healthy lane failed unexpectedly: ${ask.code} ${ask.message}`);
                        }
                        // P2-FIX-119 receipt: the ask prompt must actually carry the workspace facts
                        const promptFacts = await verifyPromptCarriesFacts(askPrompt, harness.root);
                        answerProblems.push(...promptFacts.problems);
                        records.push({ switchNo: step.switchNo, lane: step.lane, receipt, ask, askPrompt, promptFacts, answerProblems, atMs, durationMs });
                        if (ask.kind === 'provider-failure') {
                                failureDetectedAtMs = atMs;
                                await harness.friction.timing({ phase: 'provider-switch:failure-window', durationMs: atMs - askStartedAt, wallClockBudgetMs: ask.wallClockBudgetMs });
                        }
                }

                const summary = summarizeSwitchRun(plan, records);

                // the friction rows: the typed provider failure WITH its recovery account
                // (one append-only row, written once the recovery is known), plus a
                // recovery-defect row if the recovery itself failed to restore the call.
                if (summary.typedFailure !== undefined && summary.typedFailure.ask.kind === 'provider-failure') {
                        if (summary.recovery !== undefined) {
                                await harness.friction.friction({
                                        phase: 'provider-switch:failing-lane',
                                        kind: 'provider-failure',
                                        detail: providerFailureDetail(summary.typedFailure.ask),
                                        recovery: recoveryAccount(summary.recovery.switchNo, summary.recovery.receipt.lane, summary.recoveryMs),
                                });
                        } else {
                                await harness.friction.friction({
                                        phase: 'provider-switch:failing-lane',
                                        kind: 'provider-failure',
                                        detail: providerFailureDetail(summary.typedFailure.ask),
                                        recovery: 'the lane was NOT switched back within this exercise window',
                                });
                                await harness.friction.friction({
                                        phase: 'provider-switch:recovery',
                                        kind: 'recovery-defect',
                                        detail: 'the scripted provider failure was never recovered onto a healthy lane inside the exercise window',
                                        recovery: '',
                                });
                        }
                        await harness.friction.timing({ phase: 'provider-switch:recovery', durationMs: summary.recoveryMs });
                }

                // the checks (the G5 receipts)
                recorder.check('switch.sequence-executed', records.length === plan.length && records.every((record, index) => record.switchNo === plan[index]?.switchNo), `the planned sequence healthy->scripted-failing->healthy executed (${records.map(record => record.receipt.lane).join(' -> ')})`);
                const typedAsk = summary.typedFailure?.ask;
                const typedOk = typedAsk !== undefined && typedAsk.kind === 'provider-failure' && typedAsk.attempts >= 2;
                recorder.check('switch.failure-typed', typedOk, typedAsk !== undefined && typedAsk.kind === 'provider-failure' ? providerFailureDetail(typedAsk) : 'no typed provider failure occurred');
                recorder.check('switch.recovery-occurred', summary.recovery !== undefined && summary.recovery.ask.kind === 'ok', summary.recovery === undefined ? 'no recovery switch succeeded' : recoveryAccount(summary.recovery.switchNo, summary.recovery.receipt.lane, summary.recoveryMs));
                recorder.check('switch.evidence-per-switch', records.every(record => record.receipt.evidenceId.length > 0), `one evidence row per switch: ${records.map(record => `#${String(record.switchNo)}=${record.receipt.evidenceId}`).join(', ')}`);
                recorder.check('switch.answers-verified', records.every(record => record.answerProblems.length === 0), 'every healthy-lane answer matched the workspace providers file + the routing-decision ledger, and every ask prompt carried the workspace facts (P2-FIX-118 fence-tolerant parse on live lanes; P2-FIX-119 prompt-carried facts)');

                // the report artifact (the exercise's durable receipt)
                const reportUri = `.flauz/artifacts/${harness.taskId}/provider-switch-report.json`;
                const report = {
                        schema: 'flauz.dogfood-switch-report/v1',
                        exerciseId: 'provider-switch',
                        mode: harness.mode,
                        plan,
                        switches: records.map(record => ({
                                switchNo: record.switchNo,
                                lane: record.receipt.lane,
                                providerId: record.receipt.providerId,
                                enabledLanes: record.receipt.enabledLanes,
                                providersFileSha256: record.receipt.providersFileSha256,
                                evidenceId: record.receipt.evidenceId,
                                ask: record.ask.kind === 'ok'
                                        ? { kind: 'ok', decisionId: record.ask.decisionId, attempts: record.ask.attempts, durationMs: record.ask.durationMs, wallClockBudgetMs: record.ask.wallClockBudgetMs, fenceStripped: harness.mode === 'live-provider' && fenceTolerantParseBody(record.ask.text, { fenceTolerant: true }).fenced, text: record.ask.text }
                                        : { kind: 'provider-failure', decisionId: record.ask.decisionId, code: record.ask.code, retryClass: record.ask.retryClass, retryable: record.ask.retryable, status: record.ask.status, attempts: record.ask.attempts, wallClockBudgetMs: record.ask.wallClockBudgetMs, message: record.ask.message },
                                askPromptRedacted: redactAskPromptForReport(record.askPrompt),
                                promptFacts: record.promptFacts,
                                answerProblems: record.answerProblems,
                                atMs: record.atMs,
                                durationMs: record.durationMs,
                        })),
                        summary: { ok: summary.ok, problems: summary.problems, recoveryMs: summary.recoveryMs },
                };
                const artifact = await mintArtifact(harness, reportUri, `${JSON.stringify(report, null, '\t')}\n`, 'the provider-switch exercise report (3 lane switches, the typed failure + the recovery)');
                evidenceItems.push(artifact.item);
                evidenceIds.push(artifact.evidenceId);
                // the records-dir copy: the switch report is a run receipt (the workspace root is ephemeral)
                await nodeFs.mkdir(harness.recordsDir, { recursive: true });
                await nodeFs.writeFile(nodePath.join(harness.recordsDir, 'provider-switch.report.json'), `${JSON.stringify(report, null, '\t')}\n`, { encoding: 'utf-8' });
                recorder.check('switch.report-evidence-minted', artifact.evidenceId.length > 0, `the switch report is hash-pinned into the evidence ledger (${artifact.evidenceId})`);

                notes.push('the typed failure classes are the product\'s real code paths (the adapter\'s error taxonomy + the product\'s bounded-retry bound); the failing wire itself is the harness\'s scripted lane');
                notes.push(`model intelligence: fixture (the scripted lanes); seams: local-real (providers-file enablement, routing policy, durable decisions, adapter stream, evidence ledger)`);
                notes.push('P2-FIX-119: both lanes answer from the prompt-carried workspace facts (providers file content + routing-decision tail, embedded at ask time); the fake lane\'s server-side computation path for this question is retired; the verification stays strict (checked against the real state files)');
                notes.push('P2-FIX-118: live-lane answers parse through the fence-tolerant path (strip-fence-then-parse; malformed JSON inside a fence still fails); machine lanes keep the raw-JSON default');

                const failCount = recorder.checks.filter(check => !check.ok).length;
                const frictionRows = await harness.friction.readAll();
                return {
                        schema: 'flauz.dogfood-exercise-receipt/v1',
                        exerciseId: 'provider-switch',
                        title: 'provider switching: fake -> scripted-failing -> fake with typed failure + recovery',
                        dimensions: ['provider switching', 'failure/recovery', 'artifacts/evidence', 'slow-path timing'],
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
