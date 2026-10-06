/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * A-PROD-003-W8 -- the environments-lifecycle + workspace-continuity
 * dogfood exercise tests (sibling suite to dogfood.test.ts, following
 * the browser-policy.dogfood.test.ts precedent).
 *
 * The mutation law (per the work order): a swapped verdict, a fabricated
 * fact, and a wrong schema must EACH FAIL the verification; the
 * marker-protocol failures (missing + unterminated facts section) are
 * typed errors. The state-machine legality pins run against the REAL
 * product transition table; the secret-redaction law (the payload never
 * appears in the bundle or the ledger) and the G8 canary law
 * (runtime-assembled constants, never committed literals) are pinned;
 * the force-gate + mismatch legs and the frictionlog validation are
 * pinned; the full exercise wiring runs BOTH lanes end to end.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FRICTION_SCHEMA, FrictionLog, validateFrictionLine } from './frictionlog.mjs';
import { answerEnvironmentsLifecycleFromPrompt, answerWorkspaceContinuityFromPrompt, startFakeProvider } from './fake-provider.mjs';
import type { AskOutcome, AskPrompt, DogfoodHarness } from './harnessTypes.ts';

import {
        ENVIRONMENTS_LIFECYCLE_ANSWER_SCHEMA,
        ENVIRONMENTS_LIFECYCLE_FACTS_BEGIN,
        ENVIRONMENTS_LIFECYCLE_FACTS_END,
        LIFECYCLE_MAIN_ENV_ID,
        LIFECYCLE_UNTRUSTED_ENV_ID,
        MAIN_STATE_CHAIN,
        buildEnvironmentsLifecycleQuestion,
        environmentsLifecycleFactsOf,
        deriveEnvironmentsLifecycleGroundTruth,
        parseEnvironmentsLifecycleAnswer,
        verifyEnvironmentsLifecycleAnswer,
        ENVIRONMENTS_LIFECYCLE_EXERCISE,
        type EnvironmentsLifecycleAnswer,
        type EnvironmentsLifecycleGroundTruth,
} from './exercises/environments-lifecycle.task.ts';
import {
        WORKSPACE_CONTINUITY_ANSWER_SCHEMA,
        WORKSPACE_CONTINUITY_FACTS_BEGIN,
        WORKSPACE_CONTINUITY_FACTS_END,
        CONTINUITY_SOURCE_ENV_ID,
        buildWorkspaceContinuityQuestion,
        deriveWorkspaceContinuityGroundTruth,
        parseWorkspaceContinuityAnswer,
        verifyWorkspaceContinuityAnswer,
        WORKSPACE_CONTINUITY_EXERCISE,
        runtimeContinuityCanary,
        type WorkspaceContinuityAnswer,
        type WorkspaceContinuityFacts,
} from './exercises/workspace-continuity.task.ts';
import { canTransition, failureState, successState, transitionFor } from '../../../extensions/flauz-environments/src/lifecycle/stateMachine.ts';
import { EnvironmentLifecycleError, type EnvironmentOpRecord, type LifecycleEntry } from '../../../extensions/flauz-environments/src/lifecycle/types.ts';
import { CONTINUITY_SURFACES, REDACTED_NOTE, looksSecretShaped, surfaceIds } from '../../../extensions/flauz-environments/src/continuityExec/surfaces.ts';
import type { BundleSurfaceEntry, ContinuityBundleManifest, RestoreSurfaceResult } from '../../../extensions/flauz-environments/src/continuityExec/types.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** The canary shapes the G8 privacy pin scans for (never to appear in any receipt/friction row or committed source). */
const CANARY_SHAPES = /ghp_[A-Za-z0-9]{16,}|sk-[A-Za-z0-9]{16,}/;

// ---------------------------------------------------------------------------
// The fabricated lifecycle fixture (deterministic: fixed ids + ts)
// ---------------------------------------------------------------------------

function lifecycleOpsFixture(): EnvironmentOpRecord[] {
        const base = { schemaVersion: 0, schema: 'flauz.environments-ops/v0', ts: 1_000 };
        const rows: Array<Omit<EnvironmentOpRecord, 'schemaVersion' | 'schema' | 'ts'>> = [
                { environmentId: LIFECYCLE_MAIN_ENV_ID, op: 'create', actor: 'human', result: 'ok', fromState: 'registered', toState: 'created' },
                { environmentId: LIFECYCLE_MAIN_ENV_ID, op: 'start', actor: 'agent', result: 'ok', fromState: 'created', toState: 'running' },
                { environmentId: LIFECYCLE_MAIN_ENV_ID, op: 'attach', actor: 'agent', result: 'ok', fromState: 'running', toState: 'running/attached' },
                { environmentId: LIFECYCLE_MAIN_ENV_ID, op: 'snapshot', actor: 'tool', result: 'ok', fromState: 'running/attached', toState: 'running/attached' },
                { environmentId: LIFECYCLE_MAIN_ENV_ID, op: 'stop', actor: 'human', result: 'ok', fromState: 'running/attached', toState: 'stopped' },
                { environmentId: LIFECYCLE_MAIN_ENV_ID, op: 'destroy', actor: 'human', result: 'ok', fromState: 'stopped', toState: 'destroyed' },
                { environmentId: LIFECYCLE_UNTRUSTED_ENV_ID, op: 'create', actor: 'human', result: 'ok', fromState: 'registered', toState: 'created' },
                { environmentId: LIFECYCLE_UNTRUSTED_ENV_ID, op: 'start', actor: 'agent', result: 'error', fromState: 'created', toState: 'created', error: { code: 'TRUST_POSTURE_REJECTED', message: "environment 'env-dogfood-w8-untrusted' has trust posture 'untrusted' — start is rejected fail-closed" } },
                { environmentId: LIFECYCLE_UNTRUSTED_ENV_ID, op: 'destroy', actor: 'human', result: 'ok', fromState: 'created', toState: 'destroyed' },
                { environmentId: LIFECYCLE_MAIN_ENV_ID, op: 'stop', actor: 'human', result: 'error', fromState: 'destroyed', toState: 'destroyed', error: { code: 'ILLEGAL_TRANSITION', message: "op 'stop' is illegal from state 'destroyed' (legal ops: none)" } },
        ];
        return rows.map(row => ({ ...base, ...row }));
}

function lifecycleEntriesFixture(): Record<string, LifecycleEntry> {
        return {
                [LIFECYCLE_MAIN_ENV_ID]: { state: 'destroyed', updatedAt: 1_000, executorKind: 'local-process', lastOpRef: 10 },
                [LIFECYCLE_UNTRUSTED_ENV_ID]: { state: 'destroyed', updatedAt: 1_000, executorKind: 'local-process', lastOpRef: 9 },
        };
}

function lifecycleGroundTruthFixture(): EnvironmentsLifecycleGroundTruth {
        return deriveEnvironmentsLifecycleGroundTruth(lifecycleEntriesFixture(), lifecycleOpsFixture());
}

/** A faithful answer document over the fabricated ground truth. */
function faithfulLifecycleAnswer(gt: EnvironmentsLifecycleGroundTruth): EnvironmentsLifecycleAnswer {
        return {
                schema: ENVIRONMENTS_LIFECYCLE_ANSWER_SCHEMA,
                environments: { ...gt.environments },
                opsLedger: { rows: gt.opsRows, kinds: { ...gt.opsKinds } },
                failureLegs: gt.failureLegs.map(leg => ({ ...leg })),
        };
}

// ---------------------------------------------------------------------------
// The fabricated continuity fixture (deterministic: fixed ids + the closed table)
// ---------------------------------------------------------------------------

function continuityManifestFixture(): ContinuityBundleManifest {
        const surfaces: Record<string, BundleSurfaceEntry> = {};
        for (const spec of CONTINUITY_SURFACES) {
                if (spec.id === 'flauz-tasks-envelope' || spec.id === 'flauz-environments-registry') {
                        surfaces[spec.id] = { status: 'carried', artifactPath: spec.artifactName ?? '', sha256: 'a'.repeat(64), bytes: 10, note: `carried from ${spec.path}` };
                } else if (spec.secretClass === 'captured') {
                        surfaces[spec.id] = { status: 'redacted', sha256: 'b'.repeat(64), note: REDACTED_NOTE };
                } else {
                        surfaces[spec.id] = { status: 'lost', note: spec.lostNote };
                }
        }
        return {
                schemaVersion: 0,
                schema: 'flauz.continuity-bundle/v0',
                bundleId: 'flauz:continuity:0000000000000000',
                createdAt: 1_000,
                actor: 'human',
                sourceEnvironmentId: CONTINUITY_SOURCE_ENV_ID,
                surfaces,
        };
}

function continuityRestoreSurfacesFixture(): RestoreSurfaceResult[] {
        return CONTINUITY_SURFACES.map(spec => {
                const entry = continuityManifestFixture().surfaces[spec.id]!;
                if (entry.status === 'carried') {
                        return { surface: spec.id, outcome: 'carried' as const, note: `restored to ${spec.path}` };
                }
                if (entry.status === 'redacted') {
                        return { surface: spec.id, outcome: 'redacted' as const, note: 'the payload was never copied into the bundle (the secret-redaction law) — re-acquire via the SCM surface or the source environment' };
                }
                return { surface: spec.id, outcome: 'lost' as const, note: entry.note };
        });
}

function continuityFailureLegsFixture(): Array<{ leg: string; code: string }> {
        return [
                { leg: 'ungated-restore', code: 'RESTORE_TARGET_NOT_EMPTY' },
                { leg: 'tamper-verify', code: 'VERIFY_FAILED' },
        ];
}

function continuityGroundTruthFixture() {
        return deriveWorkspaceContinuityGroundTruth(continuityManifestFixture(), continuityRestoreSurfacesFixture(), continuityFailureLegsFixture());
}

function faithfulContinuityAnswer(gt: ReturnType<typeof continuityGroundTruthFixture>): WorkspaceContinuityAnswer {
        return {
                schema: WORKSPACE_CONTINUITY_ANSWER_SCHEMA,
                bundleId: gt.bundleId,
                restoreOutcomes: gt.restoreOutcomes.map(row => ({ ...row })),
                redactedSurfaces: gt.redactedSurfaces.map(row => ({ ...row })),
                failureLegs: gt.failureLegs.map(leg => ({ ...leg })),
        };
}

/** Joins the SSE completion text of one fake-provider ask (the W7 wire-test pattern). */
async function postFakeProviderAsk(port: number, prompt: string): Promise<string> {
        const body = JSON.stringify({ model: 'dogfood-1', messages: [{ role: 'user', content: prompt }] });
        const text = await new Promise<string>((resolve, reject) => {
                const request = http.request({ host: '127.0.0.1', port, path: '/v1/chat/completions', method: 'POST', headers: { 'content-type': 'application/json' } }, response => {
                        let raw = '';
                        response.on('data', chunk => {
                                raw += chunk.toString('utf-8');
                        });
                        response.on('end', () => resolve(raw));
                });
                request.on('error', reject);
                request.end(body);
        });
        return text.split('\n').filter(line => line.startsWith('data: ') && !line.includes('[DONE]')).map(line => JSON.parse(line.slice('data: '.length)) as { choices: Array<{ delta: { content?: string } }> }).map(event => event.choices[0]?.delta.content ?? '').join('');
}

// ---------------------------------------------------------------------------
// suite: the environments-lifecycle exercise
// ---------------------------------------------------------------------------

suite('A-PROD-003-W8 environments-lifecycle dogfood exercise', () => {

        suite('the independent verifier', () => {

                test('PASSES a faithful answer at 100%', () => {
                        const gt = lifecycleGroundTruthFixture();
                        const verification = verifyEnvironmentsLifecycleAnswer(faithfulLifecycleAnswer(gt), gt);
                        assert.equal(verification.ok, true, verification.problems.join('; '));
                        assert.equal(verification.soundnessViolations, 0);
                        assert.equal(verification.completenessViolations, 0);
                });

                test('FAILS a swapped final state (mutation: main destroyed -> running)', () => {
                        const gt = lifecycleGroundTruthFixture();
                        const answer = faithfulLifecycleAnswer(gt);
                        const mutated: EnvironmentsLifecycleAnswer = { ...answer, environments: { ...answer.environments, [LIFECYCLE_MAIN_ENV_ID]: 'running' } };
                        const verification = verifyEnvironmentsLifecycleAnswer(mutated, gt);
                        assert.equal(verification.ok, false);
                        assert.ok(verification.soundnessViolations >= 1);
                        assert.ok(verification.problems.some(problem => problem.includes(LIFECYCLE_MAIN_ENV_ID) && problem.includes('final state')));
                });

                test('FAILS a fabricated environment entry', () => {
                        const gt = lifecycleGroundTruthFixture();
                        const answer = faithfulLifecycleAnswer(gt);
                        const mutated: EnvironmentsLifecycleAnswer = { ...answer, environments: { ...answer.environments, 'env-fabricated-w8': 'destroyed' } };
                        const verification = verifyEnvironmentsLifecycleAnswer(mutated, gt);
                        assert.equal(verification.ok, false);
                        assert.ok(verification.problems.some(problem => problem.includes('FABRICATED')));
                });

                test('FAILS a missing environment entry (completeness)', () => {
                        const gt = lifecycleGroundTruthFixture();
                        const answer = faithfulLifecycleAnswer(gt);
                        const { [LIFECYCLE_UNTRUSTED_ENV_ID]: _dropped, ...rest } = answer.environments;
                        const mutated: EnvironmentsLifecycleAnswer = { ...answer, environments: rest };
                        const verification = verifyEnvironmentsLifecycleAnswer(mutated, gt);
                        assert.equal(verification.ok, false);
                        assert.ok(verification.completenessViolations >= 1);
                        assert.ok(verification.problems.some(problem => problem.includes(LIFECYCLE_UNTRUSTED_ENV_ID) && problem.includes('MISSING')));
                });

                test('FAILS a wrong ops-row count (fabricated fact)', () => {
                        const gt = lifecycleGroundTruthFixture();
                        const answer = faithfulLifecycleAnswer(gt);
                        const mutated: EnvironmentsLifecycleAnswer = { ...answer, opsLedger: { ...answer.opsLedger, rows: 11 } };
                        const verification = verifyEnvironmentsLifecycleAnswer(mutated, gt);
                        assert.equal(verification.ok, false);
                        assert.ok(verification.problems.some(problem => problem.includes('opsLedger.rows')));
                });

                test('FAILS a fabricated kinds census entry', () => {
                        const gt = lifecycleGroundTruthFixture();
                        const answer = faithfulLifecycleAnswer(gt);
                        const mutated: EnvironmentsLifecycleAnswer = { ...answer, opsLedger: { rows: gt.opsRows, kinds: { ...answer.opsLedger.kinds, cancel: 1 } } };
                        const verification = verifyEnvironmentsLifecycleAnswer(mutated, gt);
                        assert.equal(verification.ok, false);
                        assert.ok(verification.problems.some(problem => problem.includes('cancel') && problem.includes('FABRICATED')));
                });

                test('FAILS a swapped failure-leg verdict (mutation: untrusted-start rejected -> illegal)', () => {
                        const gt = lifecycleGroundTruthFixture();
                        const answer = faithfulLifecycleAnswer(gt);
                        assert.notEqual(answer.failureLegs.find(entry => entry.leg === 'untrusted-start'), undefined);
                        const mutated: EnvironmentsLifecycleAnswer = { ...answer, failureLegs: answer.failureLegs.map(leg => (leg.leg === 'untrusted-start' ? { ...leg, verdict: 'illegal' as const } : { ...leg })) };
                        const verification = verifyEnvironmentsLifecycleAnswer(mutated, gt);
                        assert.equal(verification.ok, false);
                        assert.ok(verification.soundnessViolations >= 1);
                        assert.ok(verification.problems.some(problem => problem.includes('untrusted-start')));
                });

                test('FAILS a fabricated failure leg', () => {
                        const gt = lifecycleGroundTruthFixture();
                        const answer = faithfulLifecycleAnswer(gt);
                        const mutated: EnvironmentsLifecycleAnswer = { ...answer, failureLegs: [...answer.failureLegs.map(leg => ({ ...leg })), { leg: 'illegal-destroy', verdict: 'illegal', code: 'ILLEGAL_TRANSITION' }] };
                        const verification = verifyEnvironmentsLifecycleAnswer(mutated, gt);
                        assert.equal(verification.ok, false);
                        assert.ok(verification.problems.some(problem => problem.includes('illegal-destroy') && problem.includes('FABRICATED')));
                });
        });

        suite('the answer parse + the prompt', () => {

                test('parses a faithful document and rejects a wrong schema + non-JSON', () => {
                        const gt = lifecycleGroundTruthFixture();
                        const parsed = parseEnvironmentsLifecycleAnswer(JSON.stringify(faithfulLifecycleAnswer(gt)));
                        assert.equal(parsed.ok, true);
                        if (parsed.ok) {
                                assert.equal(parsed.answer.environments[LIFECYCLE_MAIN_ENV_ID], 'destroyed');
                                assert.equal(parsed.answer.opsLedger.rows, 10);
                        }
                        assert.equal(parseEnvironmentsLifecycleAnswer('{"schema":"wrong/v1"}').ok, false);
                        assert.equal(parseEnvironmentsLifecycleAnswer('not json').ok, false);
                });

                test('rejects a bad verdict enum, a bad census count, and a non-string state', () => {
                        const gt = lifecycleGroundTruthFixture();
                        const answer = faithfulLifecycleAnswer(gt);
                        assert.equal(parseEnvironmentsLifecycleAnswer(JSON.stringify({ ...answer, failureLegs: [{ leg: 'x', verdict: 'unexpected', code: 'Y' }] })).ok, false);
                        assert.equal(parseEnvironmentsLifecycleAnswer(JSON.stringify({ ...answer, opsLedger: { rows: 10, kinds: { create: 0 } } })).ok, false);
                        assert.equal(parseEnvironmentsLifecycleAnswer(JSON.stringify({ ...answer, environments: { 'env-x': '' } })).ok, false);
                });

                test('builds the question with the facts embedded and the sha pinned', () => {
                        const facts = environmentsLifecycleFactsOf('local-process', lifecycleOpsFixture());
                        const built = buildEnvironmentsLifecycleQuestion(facts);
                        assert.ok(built.prompt.includes(ENVIRONMENTS_LIFECYCLE_FACTS_BEGIN));
                        assert.ok(built.prompt.includes(ENVIRONMENTS_LIFECYCLE_FACTS_END));
                        assert.ok(built.prompt.includes('"executorKind": "local-process"'));
                        assert.match(built.factsSha256, /^[0-9a-f]{64}$/);
                });

                test('a FENCED answer parses in the tolerant (live) mode and fails in the raw default', () => {
                        const gt = lifecycleGroundTruthFixture();
                        const fenced = `\`\`\`json\n${JSON.stringify(faithfulLifecycleAnswer(gt))}\n\`\`\``;
                        assert.ok(parseEnvironmentsLifecycleAnswer(fenced, { fenceTolerant: true }).ok);
                        assert.ok(!parseEnvironmentsLifecycleAnswer(fenced).ok, 'the raw machine-lane default stays strict');
                });
        });

        suite('the state-machine legality pins (the REAL product machine)', () => {

                test('the pinned scenario chain is legal through the REAL transition table (incl. the /attached substate + state-preserving snapshot)', () => {
                        const chain = [...MAIN_STATE_CHAIN];
                        let state = chain[0]!;
                        const ops: Array<'create' | 'start' | 'attach' | 'snapshot' | 'stop' | 'destroy'> = ['create', 'start', 'attach', 'snapshot', 'stop', 'destroy'];
                        for (const op of ops) {
                                assert.ok(canTransition(state, op), `${op} must be legal from ${state}`);
                                state = successState(state, op);
                        }
                        assert.equal(state, 'destroyed');
                        assert.equal(chain[3], 'running/attached', 'the attach lands the composite substate');
                        assert.equal(successState('running/attached', 'snapshot'), 'running/attached', 'snapshot is state-preserving');
                        assert.equal(chain.length, 7);
                });

                test('stop on a destroyed id is the typed ILLEGAL_TRANSITION (the machine never resurrects a tombstone)', () => {
                        assert.throws(() => transitionFor('destroyed', 'stop'), (err: unknown) => {
                                assert.ok(err instanceof EnvironmentLifecycleError);
                                assert.equal((err as EnvironmentLifecycleError).code, 'ILLEGAL_TRANSITION');
                                assert.ok((err as Error).message.includes("illegal from state 'destroyed'"));
                                return true;
                        });
                        // the pure failure-state resolver is itself fail-closed on an illegal op
                        // (the manager records the typed rejection with the state untouched)
                        assert.throws(() => failureState('destroyed', 'stop'), (err: unknown) => err instanceof EnvironmentLifecycleError);
                });

                test('the ground-truth derivation: final states + the census + the failure legs from the real row shapes', () => {
                        const gt = lifecycleGroundTruthFixture();
                        assert.deepEqual({ ...gt.environments }, { [LIFECYCLE_MAIN_ENV_ID]: 'destroyed', [LIFECYCLE_UNTRUSTED_ENV_ID]: 'destroyed' });
                        assert.equal(gt.opsRows, 10);
                        assert.deepEqual({ ...gt.opsKinds }, { create: 2, start: 2, attach: 1, snapshot: 1, stop: 2, destroy: 2 });
                        assert.deepEqual(gt.failureLegs.map(leg => ({ leg: leg.leg, verdict: leg.verdict, code: leg.code })), [
                                { leg: 'illegal-stop', verdict: 'illegal', code: 'ILLEGAL_TRANSITION' },
                                { leg: 'untrusted-start', verdict: 'rejected', code: 'TRUST_POSTURE_REJECTED' },
                        ]);
                });
        });

        suite('the fake lane (the scripted answer computed from the prompt-carried facts)', () => {

                test('computes the full answer FROM the facts (final states, census, legs) -- never canned', () => {
                        const facts = environmentsLifecycleFactsOf('local-process', lifecycleOpsFixture());
                        const built = buildEnvironmentsLifecycleQuestion(facts);
                        const outcome = answerEnvironmentsLifecycleFromPrompt(built.prompt);
                        assert.equal(outcome.ok, true, outcome.ok ? '' : outcome.error);
                        if (!outcome.ok) {
                                return;
                        }
                        assert.equal(outcome.answer.schema, ENVIRONMENTS_LIFECYCLE_ANSWER_SCHEMA);
                        assert.deepEqual({ ...outcome.answer.environments }, { [LIFECYCLE_MAIN_ENV_ID]: 'destroyed', [LIFECYCLE_UNTRUSTED_ENV_ID]: 'destroyed' });
                        assert.equal(outcome.answer.opsLedger.rows, 10);
                        assert.deepEqual({ ...outcome.answer.opsLedger.kinds }, { create: 2, start: 2, attach: 1, snapshot: 1, stop: 2, destroy: 2 });
                        assert.deepEqual(outcome.answer.failureLegs.map(leg => ({ leg: leg.leg, verdict: leg.verdict, code: leg.code })), [
                                { leg: 'illegal-stop', verdict: 'illegal', code: 'ILLEGAL_TRANSITION' },
                                { leg: 'untrusted-start', verdict: 'rejected', code: 'TRUST_POSTURE_REJECTED' },
                        ]);
                });

                test('a MISSING facts section is the typed error', () => {
                        const outcome = answerEnvironmentsLifecycleFromPrompt('a prompt with no facts at all');
                        assert.equal(outcome.ok, false);
                        if (!outcome.ok) {
                                assert.ok(outcome.error.includes('no environment-lifecycle facts section'));
                        }
                });

                test('an UNTERMINATED facts section is the typed error', () => {
                        const facts = environmentsLifecycleFactsOf('local-process', lifecycleOpsFixture());
                        const built = buildEnvironmentsLifecycleQuestion(facts);
                        const truncated = built.prompt.slice(0, built.prompt.indexOf(ENVIRONMENTS_LIFECYCLE_FACTS_END));
                        const outcome = answerEnvironmentsLifecycleFromPrompt(truncated);
                        assert.equal(outcome.ok, false);
                        if (!outcome.ok) {
                                assert.ok(outcome.error.includes('unterminated'));
                        }
                });

                test('malformed facts JSON is the typed error', () => {
                        const prompt = `${ENVIRONMENTS_LIFECYCLE_FACTS_BEGIN}\n{not json\n${ENVIRONMENTS_LIFECYCLE_FACTS_END}`;
                        const outcome = answerEnvironmentsLifecycleFromPrompt(prompt);
                        assert.equal(outcome.ok, false);
                        if (!outcome.ok) {
                                assert.ok(outcome.error.includes('not valid JSON'));
                        }
                });

                test('the provider branch answers the lane over the REAL SSE wire and the census counts it', async () => {
                        const provider = await startFakeProvider({ repoRoot: REPO_ROOT, workspaceRoot: REPO_ROOT });
                        try {
                                const facts = environmentsLifecycleFactsOf('local-process', lifecycleOpsFixture());
                                const built = buildEnvironmentsLifecycleQuestion(facts);
                                const completion = await postFakeProviderAsk(provider.port, built.prompt);
                                const answer = JSON.parse(completion) as { schema: string; environments: Record<string, string>; opsLedger: { rows: number } };
                                assert.equal(answer.schema, ENVIRONMENTS_LIFECYCLE_ANSWER_SCHEMA);
                                assert.equal(answer.environments[LIFECYCLE_MAIN_ENV_ID], 'destroyed');
                                assert.equal(answer.opsLedger.rows, 10);
                                assert.equal(provider.environmentsComputations, 1, 'the census counted the environments-lane turn');
                        } finally {
                                provider.close();
                        }
                });
        });
});

// ---------------------------------------------------------------------------
// suite: the workspace-continuity exercise
// ---------------------------------------------------------------------------

suite('A-PROD-003-W8 workspace-continuity dogfood exercise', () => {

        suite('the independent verifier', () => {

                test('PASSES a faithful answer at 100%', () => {
                        const gt = continuityGroundTruthFixture();
                        const verification = verifyWorkspaceContinuityAnswer(faithfulContinuityAnswer(gt), gt);
                        assert.equal(verification.ok, true, verification.problems.join('; '));
                        assert.equal(verification.soundnessViolations, 0);
                        assert.equal(verification.completenessViolations, 0);
                });

                test('FAILS a swapped restore outcome (mutation: the tasks envelope carried -> lost)', () => {
                        const gt = continuityGroundTruthFixture();
                        const answer = faithfulContinuityAnswer(gt);
                        const swapped = answer.restoreOutcomes.map(row => (row.surface === 'flauz-tasks-envelope' ? { ...row, outcome: 'lost' } : { ...row }));
                        const verification = verifyWorkspaceContinuityAnswer({ ...answer, restoreOutcomes: swapped }, gt);
                        assert.equal(verification.ok, false);
                        assert.ok(verification.soundnessViolations >= 1);
                        assert.ok(verification.problems.some(problem => problem.includes('flauz-tasks-envelope') && problem.includes('outcome')));
                });

                test('FAILS a fabricated surface entry', () => {
                        const gt = continuityGroundTruthFixture();
                        const answer = faithfulContinuityAnswer(gt);
                        const fabricated = [...answer.restoreOutcomes.map(row => ({ ...row })), { surface: 'flauz-fabricated-surface', outcome: 'carried' }];
                        const verification = verifyWorkspaceContinuityAnswer({ ...answer, restoreOutcomes: fabricated }, gt);
                        assert.equal(verification.ok, false);
                        assert.ok(verification.problems.some(problem => problem.includes('flauz-fabricated-surface') && problem.includes('FABRICATED')));
                });

                test('FAILS a missing surface entry (completeness)', () => {
                        const gt = continuityGroundTruthFixture();
                        const answer = faithfulContinuityAnswer(gt);
                        const dropped = answer.restoreOutcomes.filter(row => row.surface !== 'flauz-environments-registry');
                        const verification = verifyWorkspaceContinuityAnswer({ ...answer, restoreOutcomes: dropped }, gt);
                        assert.equal(verification.ok, false);
                        assert.ok(verification.completenessViolations >= 1);
                        assert.ok(verification.problems.some(problem => problem.includes('flauz-environments-registry') && problem.includes('MISSING')));
                });

                test('FAILS a non-pinned redaction why (the law\'s wording must be verbatim)', () => {
                        const gt = continuityGroundTruthFixture();
                        const answer = faithfulContinuityAnswer(gt);
                        const mutated = answer.redactedSurfaces.map(row => (row.surface === 'flauz-evidence-ledger' ? { ...row, why: 'it seemed secret-ish' } : { ...row }));
                        const verification = verifyWorkspaceContinuityAnswer({ ...answer, redactedSurfaces: mutated }, gt);
                        assert.equal(verification.ok, false);
                        assert.ok(verification.problems.some(problem => problem.includes('why') && problem.includes('pinned law wording')));
                });

                test('FAILS a fabricated redacted surface', () => {
                        const gt = continuityGroundTruthFixture();
                        const answer = faithfulContinuityAnswer(gt);
                        const mutated = [...answer.redactedSurfaces.map(row => ({ ...row })), { surface: 'flauz-tasks-envelope', why: REDACTED_NOTE }];
                        const verification = verifyWorkspaceContinuityAnswer({ ...answer, redactedSurfaces: mutated }, gt);
                        assert.equal(verification.ok, false);
                        assert.ok(verification.problems.some(problem => problem.includes('flauz-tasks-envelope') && problem.includes('does not redact')));
                });

                test('FAILS a wrong bundleId (fabricated fact)', () => {
                        const gt = continuityGroundTruthFixture();
                        const answer = faithfulContinuityAnswer(gt);
                        const verification = verifyWorkspaceContinuityAnswer({ ...answer, bundleId: 'flauz:continuity:ffffffffffffffff' }, gt);
                        assert.equal(verification.ok, false);
                        assert.ok(verification.problems.some(problem => problem.includes('bundleId')));
                });

                test('FAILS a fabricated failure leg', () => {
                        const gt = continuityGroundTruthFixture();
                        const answer = faithfulContinuityAnswer(gt);
                        const mutated = [...answer.failureLegs.map(leg => ({ ...leg })), { leg: 'trust-gate', code: 'TRUST_POSTURE_REJECTED' }];
                        const verification = verifyWorkspaceContinuityAnswer({ ...answer, failureLegs: mutated }, gt);
                        assert.equal(verification.ok, false);
                        assert.ok(verification.problems.some(problem => problem.includes('trust-gate') && problem.includes('FABRICATED')));
                });
        });

        suite('the answer parse + the prompt', () => {

                test('parses a faithful document and rejects a wrong schema + non-JSON', () => {
                        const gt = continuityGroundTruthFixture();
                        const parsed = parseWorkspaceContinuityAnswer(JSON.stringify(faithfulContinuityAnswer(gt)));
                        assert.equal(parsed.ok, true);
                        if (parsed.ok) {
                                assert.equal(parsed.answer.restoreOutcomes.length, 22);
                                assert.equal(parsed.answer.redactedSurfaces.length, 3);
                        }
                        assert.equal(parseWorkspaceContinuityAnswer('{"schema":"wrong/v1"}').ok, false);
                        assert.equal(parseWorkspaceContinuityAnswer('nope').ok, false);
                });

                test('rejects an empty why and malformed leg shapes', () => {
                        const gt = continuityGroundTruthFixture();
                        const answer = faithfulContinuityAnswer(gt);
                        assert.equal(parseWorkspaceContinuityAnswer(JSON.stringify({ ...answer, redactedSurfaces: [{ surface: 'x', why: '' }] })).ok, false);
                        assert.equal(parseWorkspaceContinuityAnswer(JSON.stringify({ ...answer, failureLegs: [{ leg: '', code: 'X' }] })).ok, false);
                        assert.equal(parseWorkspaceContinuityAnswer(JSON.stringify({ ...answer, bundleId: '' })).ok, false);
                });

                test('builds the question with the facts embedded and the sha pinned', () => {
                        const facts: WorkspaceContinuityFacts = {
                                bundleId: 'flauz:continuity:0000000000000000',
                                surfaces: surfaceIds().map(id => ({ id, status: continuityManifestFixture().surfaces[id]!.status })),
                                redactedNote: REDACTED_NOTE,
                                restoreOutcomes: continuityRestoreSurfacesFixture().map(({ surface, outcome }) => ({ surface, outcome })),
                                failureLegs: continuityFailureLegsFixture(),
                        };
                        const built = buildWorkspaceContinuityQuestion(facts);
                        assert.ok(built.prompt.includes(WORKSPACE_CONTINUITY_FACTS_BEGIN));
                        assert.ok(built.prompt.includes(WORKSPACE_CONTINUITY_FACTS_END));
                        assert.ok(built.prompt.includes('"bundleId": "flauz:continuity:0000000000000000"'));
                        assert.match(built.factsSha256, /^[0-9a-f]{64}$/);
                });

                test('a FENCED answer parses in the tolerant (live) mode and fails in the raw default', () => {
                        const gt = continuityGroundTruthFixture();
                        const fenced = `\`\`\`json\n${JSON.stringify(faithfulContinuityAnswer(gt))}\n\`\`\``;
                        assert.ok(parseWorkspaceContinuityAnswer(fenced, { fenceTolerant: true }).ok);
                        assert.ok(!parseWorkspaceContinuityAnswer(fenced).ok, 'the raw machine-lane default stays strict');
                });
        });

        suite('the SECRET-REDACTION LAW + the closed canon (the REAL product table)', () => {

                test('the closed surface canon: 22 surfaces; the captured class is exactly the evidence/artifacts/journal family', () => {
                        assert.equal(surfaceIds().length, 22);
                        const captured = CONTINUITY_SURFACES.filter(spec => spec.secretClass === 'captured').map(spec => spec.id).sort();
                        assert.deepEqual(captured, ['flauz-browser-session-journal', 'flauz-evidence-artifacts', 'flauz-evidence-ledger']);
                });

                test('REDACTED_NOTE is the pinned law wording (verbatim)', () => {
                        assert.equal(REDACTED_NOTE, 'secret-shaped surface: presence + sha256 of the path recorded; the payload is never copied into a continuity bundle (the secret-redaction law)');
                });

                test('the G8 canary: runtime-assembled, secret-shaped by the PRODUCT scanner, and NEVER a committed literal in the harness sources', async () => {
                        const canary = runtimeContinuityCanary();
                        assert.ok(looksSecretShaped(canary), 'the product\'s own secret-shape scanner detects the canary');
                        assert.match(canary, CANARY_SHAPES);
                        const sources = [
                                'exercises/workspace-continuity.task.ts',
                                'exercises/environments-lifecycle.task.ts',
                                'fake-provider.mjs',
                                'environments-continuity.dogfood.test.ts',
                        ];
                        for (const relative of sources) {
                                const text = await fs.readFile(path.join(REPO_ROOT, 'build', 'flauz', 'dogfood', relative), { encoding: 'utf-8' });
                                assert.ok(!text.includes(canary), `${relative} must never carry the assembled canary literal`);
                                assert.doesNotMatch(text, CANARY_SHAPES, `${relative} must never carry any committed canary-shaped literal`);
                        }
                });
        });

        suite('the fake lane (the scripted answer computed from the prompt-carried facts)', () => {

                test('computes the full answer FROM the facts (restore outcomes, the redacted set with the pinned why, the legs) -- never canned', () => {
                        const facts: WorkspaceContinuityFacts = {
                                bundleId: 'flauz:continuity:0000000000000000',
                                surfaces: surfaceIds().map(id => ({ id, status: continuityManifestFixture().surfaces[id]!.status })),
                                redactedNote: REDACTED_NOTE,
                                restoreOutcomes: continuityRestoreSurfacesFixture().map(({ surface, outcome }) => ({ surface, outcome })),
                                failureLegs: continuityFailureLegsFixture(),
                        };
                        const built = buildWorkspaceContinuityQuestion(facts);
                        const outcome = answerWorkspaceContinuityFromPrompt(built.prompt);
                        assert.equal(outcome.ok, true, outcome.ok ? '' : outcome.error);
                        if (!outcome.ok) {
                                return;
                        }
                        assert.equal(outcome.answer.schema, WORKSPACE_CONTINUITY_ANSWER_SCHEMA);
                        assert.equal(outcome.answer.bundleId, 'flauz:continuity:0000000000000000');
                        assert.equal(outcome.answer.restoreOutcomes.length, 22);
                        assert.equal(outcome.answer.restoreOutcomes.find(row => row.surface === 'flauz-tasks-envelope')?.outcome, 'carried');
                        assert.equal(outcome.answer.restoreOutcomes.find(row => row.surface === 'flauz-evidence-ledger')?.outcome, 'redacted');
                        assert.deepEqual(outcome.answer.redactedSurfaces.map(row => row.surface).sort(), ['flauz-browser-session-journal', 'flauz-evidence-artifacts', 'flauz-evidence-ledger']);
                        assert.ok(outcome.answer.redactedSurfaces.every(row => row.why === REDACTED_NOTE));
                        assert.deepEqual(outcome.answer.failureLegs.map(leg => ({ ...leg })), continuityFailureLegsFixture());
                });

                test('a MISSING facts section is the typed error', () => {
                        const outcome = answerWorkspaceContinuityFromPrompt('a prompt with no facts at all');
                        assert.equal(outcome.ok, false);
                        if (!outcome.ok) {
                                assert.ok(outcome.error.includes('no continuity facts section'));
                        }
                });

                test('an UNTERMINATED facts section is the typed error', () => {
                        const facts: WorkspaceContinuityFacts = {
                                bundleId: 'flauz:continuity:0000000000000000',
                                surfaces: surfaceIds().map(id => ({ id, status: 'lost' })),
                                redactedNote: REDACTED_NOTE,
                                restoreOutcomes: [],
                                failureLegs: [],
                        };
                        const built = buildWorkspaceContinuityQuestion(facts);
                        const truncated = built.prompt.slice(0, built.prompt.indexOf(WORKSPACE_CONTINUITY_FACTS_END));
                        const outcome = answerWorkspaceContinuityFromPrompt(truncated);
                        assert.equal(outcome.ok, false);
                        if (!outcome.ok) {
                                assert.ok(outcome.error.includes('unterminated'));
                        }
                });

                test('facts without the surfaces array are the typed error', () => {
                        const prompt = `${WORKSPACE_CONTINUITY_FACTS_BEGIN}\n{"bundleId": "flauz:continuity:0000000000000000"}\n${WORKSPACE_CONTINUITY_FACTS_END}`;
                        const outcome = answerWorkspaceContinuityFromPrompt(prompt);
                        assert.equal(outcome.ok, false);
                        if (!outcome.ok) {
                                assert.ok(outcome.error.includes('no { bundleId, surfaces, restoreOutcomes }'));
                        }
                });

                test('the provider branch answers the lane over the REAL SSE wire and the census counts it', async () => {
                        const provider = await startFakeProvider({ repoRoot: REPO_ROOT, workspaceRoot: REPO_ROOT });
                        try {
                                const facts: WorkspaceContinuityFacts = {
                                        bundleId: 'flauz:continuity:0000000000000000',
                                        surfaces: surfaceIds().map(id => ({ id, status: continuityManifestFixture().surfaces[id]!.status })),
                                        redactedNote: REDACTED_NOTE,
                                        restoreOutcomes: continuityRestoreSurfacesFixture().map(({ surface, outcome }) => ({ surface, outcome })),
                                        failureLegs: continuityFailureLegsFixture(),
                                };
                                const built = buildWorkspaceContinuityQuestion(facts);
                                const completion = await postFakeProviderAsk(provider.port, built.prompt);
                                const answer = JSON.parse(completion) as { schema: string; bundleId: string; redactedSurfaces: Array<{ surface: string; why: string }> };
                                assert.equal(answer.schema, WORKSPACE_CONTINUITY_ANSWER_SCHEMA);
                                assert.equal(answer.bundleId, 'flauz:continuity:0000000000000000');
                                assert.equal(answer.redactedSurfaces.length, 3);
                                assert.ok(answer.redactedSurfaces.every(row => row.why === REDACTED_NOTE));
                                assert.equal(provider.continuityComputations, 1, 'the census counted the continuity-lane turn');
                        } finally {
                                provider.close();
                        }
                });
        });
});

// ---------------------------------------------------------------------------
// suite: the exercise wiring (the full lanes) + the driver registration
// ---------------------------------------------------------------------------

suite('A-PROD-003-W8 the exercise wiring + the driver registration', () => {

        /** The stubbed driver-level harness whose ask drives the REAL fake-lane answer lanes. */
        async function stubHarness(recordsDir: string, exerciseId: string, ask: (prompt: string) => string): Promise<DogfoodHarness> {
                const root = await fs.mkdtemp(path.join(os.tmpdir(), `w8-${exerciseId}-exercise-`));
                await fs.mkdir(recordsDir, { recursive: true });
                const friction = new FrictionLog({ path: path.join(recordsDir, `${exerciseId}.friction.jsonl`), clock: () => 1_000 });
                let seq = 0;
                return {
                        runId: 'test-run', mode: 'fake-lane', root, repoRoot: REPO_ROOT, recordsDir, clock: () => 1_000, friction,
                        tasks: { recordEvidence: async () => { seq += 1; return { evidenceId: `E-${String(seq).padStart(6, '0')}` }; } },
                        ledger: { append: async () => { seq += 1; return { evidenceId: `E-${String(seq).padStart(6, '0')}`, seq }; } },
                        memory: {}, store: {},
                        provider: { ask: async (input: AskPrompt): Promise<AskOutcome> => {
                                const prompt = typeof input === 'function' ? await input({ decisionId: 'rd-000001' }) : input;
                                return { kind: 'ok', text: ask(prompt), decisionId: 'rd-000001', providerId: 'flauz-dogfood-fake', modelId: 'dogfood-1', durationMs: 5, attempts: 1, wallClockBudgetMs: 15_000, finishReason: 'stop' };
                        } },
                        exerciseId, taskId: 'T-001', graphId: 'G-001', stepId: 'S-01', log: () => undefined,
                } as unknown as DogfoodHarness;
        }

        test('EXERCISE 5 wiring: the full environments-lifecycle run PASSes with the pinned 11 checks + the friction census + the report', async () => {
                const recordsDir = path.join(os.tmpdir(), `w8-envlife-records-${String(Date.now())}`);
                const harness = await stubHarness(recordsDir, 'environments-lifecycle', prompt => {
                        const outcome = answerEnvironmentsLifecycleFromPrompt(prompt);
                        return JSON.stringify(outcome.ok ? outcome.answer : { schema: 'flauz.dogfood-environments-lifecycle-answer-error/v1', error: outcome.error });
                });
                const receipt = await ENVIRONMENTS_LIFECYCLE_EXERCISE.run(harness);
                assert.equal(receipt.verdict, 'PASS', receipt.checks.filter(check => !check.ok).map(check => `${check.id}: ${check.detail}`).join(' | '));
                assert.deepEqual(receipt.checks.map(check => check.id), [
                        'el.state-machine-every-step',
                        'el.real-child-process',
                        'el.snapshot-manifest',
                        'el.ops-ledger-append-only',
                        'el.pin2-envelope-shape',
                        'el.illegal-transition-leg',
                        'el.trust-gate-leg',
                        'el.describe-verdicts',
                        'el.answer-verified-100',
                        'el.ask-prompt-carries-facts',
                        'el.report-evidence-minted',
                ]);
                assert.equal(receipt.frictionRows.friction, 4);
                assert.equal(receipt.frictionRows.timing, 1);
                assert.equal(receipt.frictionRows.recovery, 2);
                const rows = await (harness.friction as FrictionLog).readAll();
                const interventions = rows.filter(row => row.type === 'friction');
                assert.equal(interventions.length, 4);
                assert.ok(interventions.every(row => row.kind === 'manual-intervention'), 'every human gate is a first-class manual-intervention row');
                const report = JSON.parse(await fs.readFile(path.join(recordsDir, 'environments-lifecycle.report.json'), { encoding: 'utf-8' })) as {
                        schema: string;
                        opsLedgerRows: number;
                        groundTruth: { environments: Record<string, string>; opsRows: number };
                };
                assert.equal(report.schema, 'flauz.dogfood-environments-lifecycle-report/v1');
                assert.equal(report.opsLedgerRows, 10);
                assert.deepEqual({ ...report.groundTruth.environments }, { [LIFECYCLE_MAIN_ENV_ID]: 'destroyed', [LIFECYCLE_UNTRUSTED_ENV_ID]: 'destroyed' });
                assert.equal(report.groundTruth.opsRows, 10);
        });

        test('EXERCISE 6 wiring: the full workspace-continuity run PASSes with the pinned 15 checks + the friction census + the legs', async () => {
                const recordsDir = path.join(os.tmpdir(), `w8-continuity-records-${String(Date.now())}`);
                const harness = await stubHarness(recordsDir, 'workspace-continuity', prompt => {
                        const outcome = answerWorkspaceContinuityFromPrompt(prompt);
                        return JSON.stringify(outcome.ok ? outcome.answer : { schema: 'flauz.dogfood-workspace-continuity-answer-error/v1', error: outcome.error });
                });
                const receipt = await WORKSPACE_CONTINUITY_EXERCISE.run(harness);
                assert.equal(receipt.verdict, 'PASS', receipt.checks.filter(check => !check.ok).map(check => `${check.id}: ${check.detail}`).join(' | '));
                assert.deepEqual(receipt.checks.map(check => check.id), [
                        'wc.closed-surface-table',
                        'wc.carried-payloads-byte-real',
                        'wc.secret-redaction-law',
                        'wc.lost-surfaces-typed',
                        'wc.verify-verdicts',
                        'wc.status-report',
                        'wc.restore-fresh-root',
                        'wc.ungated-restore-leg',
                        'wc.force-restore-leg',
                        'wc.mismatch-leg',
                        'wc.export-secret-detected-leg',
                        'wc.answer-verified-100',
                        'wc.ask-prompt-carries-facts',
                        'wc.report-evidence-minted',
                        'wc.g8-canary-never-in-receipts',
                ]);
                assert.equal(receipt.frictionRows.friction, 4);
                assert.equal(receipt.frictionRows.timing, 2);
                assert.equal(receipt.frictionRows.recovery, 3);
                const report = JSON.parse(await fs.readFile(path.join(recordsDir, 'workspace-continuity.report.json'), { encoding: 'utf-8' })) as {
                        schema: string;
                        bundleId: string;
                        surfaceCensus: { carried: string[]; redacted: string[]; lostCount: number; total: number };
                        legs: { ungatedRestore: string; forceRestore: string; tamperVerify: string; secretScanExport: string };
                };
                assert.equal(report.schema, 'flauz.dogfood-workspace-continuity-report/v1');
                assert.equal(report.bundleId, 'flauz:continuity:0000000000000000');
                assert.deepEqual([...report.surfaceCensus.carried].sort(), ['flauz-environments-registry', 'flauz-tasks-envelope']);
                assert.deepEqual([...report.surfaceCensus.redacted].sort(), ['flauz-browser-session-journal', 'flauz-evidence-artifacts', 'flauz-evidence-ledger']);
                assert.equal(report.surfaceCensus.lostCount, 17);
                assert.equal(report.surfaceCensus.total, 22);
                assert.deepEqual(report.legs, {
                        ungatedRestore: 'RESTORE_TARGET_NOT_EMPTY',
                        forceRestore: 'ok',
                        tamperVerify: 'VERIFY_FAILED',
                        secretScanExport: 'EXPORT_SECRET_DETECTED',
                });
        });

        test('G8 privacy canary: the continuity lane\'s receipts, friction rows, and report NEVER carry a canary shape', async () => {
                const recordsDir = path.join(os.tmpdir(), `w8-continuity-canary-${String(Date.now())}`);
                const harness = await stubHarness(recordsDir, 'workspace-continuity', prompt => {
                        const outcome = answerWorkspaceContinuityFromPrompt(prompt);
                        return JSON.stringify(outcome.ok ? outcome.answer : { schema: 'flauz.dogfood-workspace-continuity-answer-error/v1', error: outcome.error });
                });
                // belt and braces: an EXTRA runtime-assembled canary planted in the harness root
                const extraCanary = ['ghp_', 'w8', 'Continuity', 'Canary', 'F'.repeat(24)].join('');
                await fs.writeFile(path.join(harness.root, 'secrets-canary.txt'), `${extraCanary}\n`, { encoding: 'utf-8' });
                const receipt = await WORKSPACE_CONTINUITY_EXERCISE.run(harness);
                assert.equal(receipt.verdict, 'PASS', 'the canary planting changed nothing');
                assert.doesNotMatch(JSON.stringify(receipt), CANARY_SHAPES, 'the exercise receipt carries no canary');
                const frictionText = await fs.readFile(path.join(recordsDir, 'workspace-continuity.friction.jsonl'), { encoding: 'utf-8' });
                assert.doesNotMatch(frictionText, CANARY_SHAPES, 'no friction row carries a canary');
                const reportText = await fs.readFile(path.join(recordsDir, 'workspace-continuity.report.json'), { encoding: 'utf-8' });
                assert.doesNotMatch(reportText, CANARY_SHAPES, 'the continuity report carries no canary (the drill canary + the planted one both contained)');
        });

        test('the driver registers SEVEN exercises in canonical order + the census fields (source scan)', async () => {
                const driver = await fs.readFile(path.join(REPO_ROOT, 'build', 'flauz', 'dogfood', 'dogfood-driver.mjs'), { encoding: 'utf-8' });
                const registration = /const exercises = \[([^\]]+)\];/.exec(driver);
                assert.notEqual(registration, null);
                const ids = registration![1]!.split(',').map(entry => entry.trim());
                assert.deepEqual(ids, [
                        'EXPLORE_EXERCISE',
                        'PROVIDER_SWITCH_EXERCISE',
                        'BROWSER_POLICY_EXERCISE',
                        'AGENT_DELEGATION_EXERCISE',
                        'TOOLS_EXPLORATION_EXERCISE',
                        'ENVIRONMENTS_LIFECYCLE_EXERCISE',
                        'WORKSPACE_CONTINUITY_EXERCISE',
                ]);
                assert.ok(driver.includes('environmentsComputations'));
                assert.ok(driver.includes('continuityComputations'));
        });

        test('the frictionlog validation (W8 pins): the exercise row shapes validate; invalid kinds and foreign schemas fail', () => {
                const trustGateRow = { schema: FRICTION_SCHEMA, type: 'friction', ts: 1, phase: 'environments-lifecycle:trust-gate', kind: 'manual-intervention', detail: 'the fail-closed trust gate rejected the untrusted start', recovery: 'the human destroyed the environment instead' };
                assert.deepEqual(validateFrictionLine(trustGateRow), { ok: true });
                const forceGateRow = { schema: FRICTION_SCHEMA, type: 'friction', ts: 1, phase: 'workspace-continuity:force-gate', kind: 'manual-intervention', detail: 'the un-gated restore was rejected', recovery: 'the human approved force: true' };
                assert.deepEqual(validateFrictionLine(forceGateRow), { ok: true });
                const timingRow = { schema: FRICTION_SCHEMA, type: 'timing', ts: 1, phase: 'workspace-continuity:restore', durationMs: 12 };
                assert.deepEqual(validateFrictionLine(timingRow), { ok: true });
                assert.equal(validateFrictionLine({ ...trustGateRow, kind: 'gate' }).ok, false);
                assert.equal(validateFrictionLine({ ...trustGateRow, schema: 'flauz.other/v9' }).ok, false);
                assert.equal(validateFrictionLine({ ...forceGateRow, recovery: undefined }).ok, false, 'recovery is required on every friction row');
        });
});
