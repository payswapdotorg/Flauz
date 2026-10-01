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

export type ParseSwitchOutcome = { readonly ok: true; readonly answer: SwitchAnswer } | { readonly ok: false; readonly error: string };

export function parseSwitchAnswer(text: string): ParseSwitchOutcome {
        let parsed: unknown;
        try {
                parsed = JSON.parse(text);
        } catch (err) {
                return { ok: false, error: `the completion is not valid JSON: ${err instanceof Error ? err.message : String(err)}` };
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
// The run summary (pure, testable)
// ---------------------------------------------------------------------------

/** One executed switch as recorded by the exercise. */
export interface SwitchRunRecord {
        readonly switchNo: number;
        readonly lane: 'healthy' | 'scripted-failing';
        readonly receipt: LaneSwitchReceipt;
        readonly ask: AskOutcome;
        readonly answerProblems: readonly string[];
        readonly atMs: number;
        readonly durationMs: number;
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
                if (record.ask.kind === 'ok' && record.answerProblems.length > 0) {
                        problems.push(`switch ${String(record.switchNo)}'s answer did not verify: ${record.answerProblems.join('; ')}`);
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
                        const ask = await harness.provider.ask(SWITCH_QUESTION);
                        const atMs = Date.now();
                        const durationMs = atMs - switchStartedAt;
                        await harness.friction.timing({ phase: `provider-switch:switch-${String(step.switchNo)}`, durationMs });

                        const answerProblems: string[] = [];
                        if (ask.kind === 'ok') {
                                const parsed = parseSwitchAnswer(ask.text);
                                if (!parsed.ok) {
                                        answerProblems.push(parsed.error);
                                } else {
                                        const verification = await verifySwitchAnswer(parsed.answer, harness.root);
                                        answerProblems.push(...verification.problems);
                                }
                        } else if (step.expect === 'ok') {
                                answerProblems.push(`the healthy lane failed unexpectedly: ${ask.code} ${ask.message}`);
                        }
                        records.push({ switchNo: step.switchNo, lane: step.lane, receipt, ask, answerProblems, atMs, durationMs });
                        if (ask.kind === 'provider-failure') {
                                failureDetectedAtMs = atMs;
                                await harness.friction.timing({ phase: 'provider-switch:failure-window', durationMs: atMs - askStartedAt });
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
                recorder.check('switch.answers-verified', records.every(record => record.ask.kind !== 'ok' || record.answerProblems.length === 0), 'every healthy-lane answer matched the workspace providers file + the routing-decision ledger');

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
                                        ? { kind: 'ok', decisionId: record.ask.decisionId, attempts: record.ask.attempts, durationMs: record.ask.durationMs, text: record.ask.text }
                                        : { kind: 'provider-failure', decisionId: record.ask.decisionId, code: record.ask.code, retryClass: record.ask.retryClass, retryable: record.ask.retryable, status: record.ask.status, attempts: record.ask.attempts, message: record.ask.message },
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
