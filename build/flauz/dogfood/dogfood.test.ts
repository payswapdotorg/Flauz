/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * A-PROD-003-W1 (dogfood harness) -- the test suite (mocha tdd; the
 * isolated runner recipe is in README.md / the work order's G6 row).
 *
 * Covers exactly what the work order mandates:
 *   - the friction-log schema (flauz.dogfood-friction/v1: the kind
 *     vocabulary verbatim from the handoff capture list, the friction
 *     row shape {ts, phase, kind, detail, recovery}, the timing row
 *     shape {ts, phase, durationMs}, append-only behavior, validation);
 *   - the exercise verification logic (the explore-repo scanner +
 *     verifier over fixture trees AND a live-tree self-consistency
 *     smoke; the provider-switch plan/summary/answer-verification
 *     logic);
 *   - P2-FIX-122 (A-PROD-003-W6): the explore-repo EXCERPT mode -- the
 *     excerpt builder's determinism, the excerpt-scoped verification
 *     logic (fixture excerpts with known consumers: hallucination
 *     detection against the excerpt, the completeness bar), the
 *     question/prompt round-trip, and the exercise's excerpt-mode
 *     wiring (the ask-time builder, the banked excerpt, the receipt).
 *
 * Harness tests (build/flauz/dogfood/**): NOT gate instruments.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FRICTION_KINDS, FRICTION_SCHEMA, FrictionLog, isFrictionKind, parseFrictionLog, validateFrictionLine } from './frictionlog.mjs';
import { answerSwitchFromPrompt } from './fake-provider.mjs';
import { answerParseFailDetail, consumeAskStream, DEFAULT_LIVE_MAX_TOKENS, finishReasonDetail, isTruncatedFinish, LIVE_MAX_TOKENS_ENV, parseLiveMaxTokens, type AskStreamEvent } from './liveBudget.mjs';
import { createOpenAiCompatAdapter } from '../../../extensions/flauz-models/src/adapters/openAiCompat.ts';
import { nodeHttpPort } from '../../../extensions/flauz-models/src/contract/nodePorts.ts';
import { sha256Hex } from '../../../extensions/flauz-workspace/src/api.ts';
import { EXPLORE_ANSWER_SCHEMA, EXPLORE_EXCERPT_SCHEMA, EXPLORE_EXCERPT_VERIFICATION_SCHEMA, EXPLORE_QUESTION, EXCERPT_BLOCK_BEGIN, EXCERPT_BLOCK_END, EXCERPT_SEED, LEDGER_MODULE, parseExploreAnswer, parseImportStatement, scanLedgerConsumers, specifierResolvesTo, verifyConsumersMap, buildTreeExcerpt, buildExcerptQuestion, excerptBlock, excerptConsumersOf, verifyPromptCarriesExcerpt, verifyExcerptConsumersMap, EXPLORE_EXERCISE, type ExploreAnswer, type GroundTruthConsumer, type TreeExcerpt } from './exercises/explore-repo.task.ts';
import type { AskOutcome, AskPrompt, DogfoodHarness, ExerciseReceipt } from './harnessTypes.ts';
import { extractFirstFencedJsonBlock, fenceTolerantParseBody, stripMarkdownJsonFence } from './answerFence.ts';
import { SWITCH_ANSWER_SCHEMA, buildSwitchQuestion, healthyLaneOf, parseSwitchAnswer, plannedSwitchSequence, providerFailureDetail, readSwitchQuestionFacts, redactAskPromptForReport, recoveryAccount, summarizeSwitchRun, verifyPromptCarriesFacts, verifySwitchAnswer, type SwitchRunRecord } from './exercises/provider-switch.task.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// ---------------------------------------------------------------------------
// suite: the friction-log schema (flauz.dogfood-friction/v1)
// ---------------------------------------------------------------------------

suite('frictionlog: the flauz.dogfood-friction/v1 schema', () => {

        test('the schema id and the kind vocabulary are pinned exactly (the handoff capture list, verbatim order)', () => {
                assert.strictEqual(FRICTION_SCHEMA, 'flauz.dogfood-friction/v1');
                assert.deepStrictEqual([...FRICTION_KINDS], [
                        'failed-task',
                        'manual-intervention',
                        'confusing-ux',
                        'provider-failure',
                        'browser-env-failure',
                        'slow-path',
                        'recovery-defect',
                        'evidence-gap',
                        'upgrade-migration',
                ]);
                assert.ok(isFrictionKind('provider-failure'));
                assert.ok(!isFrictionKind('provider-outage'));
                assert.ok(!isFrictionKind(''));
        });

        test('friction() appends exactly one line carrying the mandated fields {ts, phase, kind, detail, recovery}', async () => {
                const target = path.join(os.tmpdir(), `flauz-dogfood-test-${String(Date.now())}-${String(Math.floor(Math.random() * 1e6))}`, 'friction.jsonl');
                const log = new FrictionLog({ path: target });
                const written = await log.friction({ phase: 'test:phase', kind: 'provider-failure', detail: 'the typed failure', recovery: 'the lane was switched back' });
                const text = await fs.readFile(target, { encoding: 'utf-8' });
                const lines = text.split('\n').filter(line => line.length > 0);
                assert.strictEqual(lines.length, 1);
                const parsed = JSON.parse(lines[0] ?? '') as Record<string, unknown>;
                assert.strictEqual(parsed.schema, FRICTION_SCHEMA);
                assert.strictEqual(parsed.type, 'friction');
                assert.strictEqual(typeof parsed.ts, 'number');
                assert.strictEqual(parsed.phase, 'test:phase');
                assert.strictEqual(parsed.kind, 'provider-failure');
                assert.strictEqual(parsed.detail, 'the typed failure');
                assert.strictEqual(parsed.recovery, 'the lane was switched back');
                assert.ok(validateFrictionLine(written).ok);
        });

        test('timing() appends exactly one timing row carrying {ts, phase, durationMs}', async () => {
                const target = path.join(os.tmpdir(), `flauz-dogfood-test-${String(Date.now())}-${String(Math.floor(Math.random() * 1e6))}`, 'timing.jsonl');
                const log = new FrictionLog({ path: target });
                await log.timing({ phase: 'test:slow-path', durationMs: 137 });
                const parsed = JSON.parse((await fs.readFile(target, { encoding: 'utf-8' })).split('\n')[0] ?? '') as Record<string, unknown>;
                assert.strictEqual(parsed.schema, FRICTION_SCHEMA);
                assert.strictEqual(parsed.type, 'timing');
                assert.strictEqual(typeof parsed.ts, 'number');
                assert.strictEqual(parsed.phase, 'test:slow-path');
                assert.strictEqual(parsed.durationMs, 137);
        });

        test('an invalid row is REFUSED (nothing is ever written the schema would reject)', async () => {
                const target = path.join(os.tmpdir(), `flauz-dogfood-test-${String(Date.now())}-${String(Math.floor(Math.random() * 1e6))}`, 'refused.jsonl');
                const log = new FrictionLog({ path: target });
                await assert.rejects(() => log.friction({ phase: 'test:phase', kind: 'not-a-real-kind', detail: 'x' }), /invalid friction row/);
                await assert.rejects(() => log.friction({ phase: '', kind: 'slow-path', detail: 'x' }), /invalid friction row/);
                await assert.rejects(() => log.timing({ phase: 'test:phase', durationMs: -1 }), /invalid timing row/);
                await assert.rejects(() => fs.access(target), err => (err as { code?: string }).code === 'ENOENT');
        });

        test('the log is append-only: rows accumulate and readAll round-trips', async () => {
                const target = path.join(os.tmpdir(), `flauz-dogfood-test-${String(Date.now())}-${String(Math.floor(Math.random() * 1e6))}`, 'append.jsonl');
                const log = new FrictionLog({ path: target, clock: () => 1_000 });
                await log.friction({ phase: 'p1', kind: 'failed-task', detail: 'first', recovery: '' });
                await log.timing({ phase: 'p2', durationMs: 5 });
                await log.friction({ phase: 'p3', kind: 'evidence-gap', detail: 'third', recovery: 'the gap was backfilled' });
                const rows = await log.readAll();
                assert.strictEqual(rows.length, 3);
                assert.strictEqual(log.lines, 3);
                assert.strictEqual((rows[0] as { recovery: string }).recovery, '');
                assert.strictEqual((rows[2] as { recovery: string }).recovery, 'the gap was backfilled');
                const outcome = parseFrictionLog((await fs.readFile(target, { encoding: 'utf-8' })));
                assert.ok(outcome.ok, outcome.error);
                assert.strictEqual(outcome.rows.length, 3);
        });

        test('validateFrictionLine rejects wrong schema, missing fields, bad kinds and negative durations', () => {
                assert.ok(!validateFrictionLine({ schema: 'other/v9', type: 'friction', ts: 1, phase: 'p', kind: 'slow-path', detail: 'd', recovery: '' }).ok);
                assert.ok(!validateFrictionLine({ schema: FRICTION_SCHEMA, type: 'friction', ts: 1, phase: 'p', kind: 'slow-path' }).ok);
                assert.ok(!validateFrictionLine({ schema: FRICTION_SCHEMA, type: 'friction', ts: 1, phase: '', kind: 'slow-path', detail: 'd', recovery: '' }).ok);
                assert.ok(!validateFrictionLine({ schema: FRICTION_SCHEMA, type: 'friction', ts: -3, phase: 'p', kind: 'slow-path', detail: 'd', recovery: '' }).ok);
                assert.ok(!validateFrictionLine({ schema: FRICTION_SCHEMA, type: 'friction', ts: 1, phase: 'p', kind: 'weather', detail: 'd', recovery: '' }).ok);
                assert.ok(!validateFrictionLine({ schema: FRICTION_SCHEMA, type: 'timing', ts: 1, phase: 'p', durationMs: -5 }).ok);
                assert.ok(!validateFrictionLine({ schema: FRICTION_SCHEMA, type: 'weather', ts: 1 }).ok);
                assert.ok(!validateFrictionLine('not an object').ok);
        });

        test('readAll of a not-yet-created log is empty (no fabricated rows)', async () => {
                const log = new FrictionLog({ path: path.join(os.tmpdir(), `flauz-dogfood-test-missing-${String(Date.now())}.jsonl`) });
                assert.deepStrictEqual(await log.readAll(), []);
        });
});

// ---------------------------------------------------------------------------
// suite: the explore-repo verification logic (fixture trees)
// ---------------------------------------------------------------------------

const FIXTURE_LEDGER = 'extensions/flauz-alpha/src/ledger.ts';

interface FixtureTree {
        readonly root: string;
        readonly groundTruth: readonly GroundTruthConsumer[];
}

async function buildFixtureTree(): Promise<FixtureTree> {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flauz-dogfood-fixture-'));
        const write = async (relative: string, contents: string): Promise<void> => {
                const target = path.join(root, relative);
                await fs.mkdir(path.dirname(target), { recursive: true });
                await fs.writeFile(target, `${contents}\n`, { encoding: 'utf-8' });
        };
        await write('extensions/flauz-alpha/src/ledger.ts', 'export const a = 1; export const b = 2; export interface C {} export const d = 4; export type E = {}; export const f = 6; export const i = 9;');
        await write('extensions/flauz-alpha/src/consumer.ts', `import { a } from './ledger.ts';\nexport const use = a;\n`);
        await write('extensions/flauz-alpha/src/multi.ts', `import { b, type C } from './ledger.ts';\nexport const pair = [b, null] as const;\n`);
        await write('extensions/flauz-alpha/src/extensionless.ts', `import { i } from '../src/ledger';\nexport const value = i;\n`);
        await write('extensions/flauz-beta/deep/consumer.ts', `import { d } from '../../flauz-alpha/src/ledger.ts';\nexport const deep = d;\n`);
        await write('extensions/flauz-beta/src/typeonly.ts', `import type { E } from '../../flauz-alpha/src/ledger.ts';\nexport const marker: E | null = null;\n`);
        await write('extensions/flauz-beta/src/reexport.ts', `export { f } from '../../flauz-alpha/src/ledger.ts';\n`);
        await write('extensions/flauz-beta/src/mentions.ts', `// a comment that merely mentions ledger -- NOT a consumer\nexport const none = true;\n`);
        await write('extensions/flauz-beta/src/unrelated.ts', `import { existsSync } from './not-the-ledger.ts';\nexport const x = existsSync;\n`);
        await write('extensions/stock/src/consumer.ts', `import { a } from '../../flauz-alpha/src/ledger.ts';\nexport const stock = a;\n`);
        await write('extensions/flauz-alpha/src/README.md', `import { a } from './ledger.ts';\n`);
        const groundTruth: GroundTruthConsumer[] = [
                { file: 'extensions/flauz-alpha/src/consumer.ts', line: 1, symbols: ['a'] },
                { file: 'extensions/flauz-alpha/src/extensionless.ts', line: 1, symbols: ['i'] },
                { file: 'extensions/flauz-alpha/src/multi.ts', line: 1, symbols: ['b', 'C'] },
                { file: 'extensions/flauz-beta/deep/consumer.ts', line: 1, symbols: ['d'] },
                { file: 'extensions/flauz-beta/src/reexport.ts', line: 1, symbols: ['f'] },
                { file: 'extensions/flauz-beta/src/typeonly.ts', line: 1, symbols: ['E'] },
        ];
        return { root, groundTruth };
}

function answerOf(consumers: readonly GroundTruthConsumer[]): ExploreAnswer {
        return { schema: EXPLORE_ANSWER_SCHEMA, consumers: consumers.map(consumer => ({ file: consumer.file, line: consumer.line, consumes: [...consumer.symbols] })) };
}

suite('explore-repo: the driver-side verification logic', () => {

        test('parseImportStatement handles named, type-only, namespace, default and non-import lines', () => {
                assert.deepStrictEqual(parseImportStatement(`import { a } from './ledger.ts';`), { specifier: './ledger.ts', symbols: ['a'] });
                assert.deepStrictEqual(parseImportStatement(`import { b, type C } from './ledger.ts';`), { specifier: './ledger.ts', symbols: ['b', 'C'] });
                assert.deepStrictEqual(parseImportStatement(`import type { E } from '../src/ledger.ts';`), { specifier: '../src/ledger.ts', symbols: ['E'] });
                assert.deepStrictEqual(parseImportStatement(`export { f } from '../../flauz-alpha/src/ledger.ts';`), { specifier: '../../flauz-alpha/src/ledger.ts', symbols: ['f'] });
                assert.deepStrictEqual(parseImportStatement(`import * as ns from './ledger.ts';`), { specifier: './ledger.ts', symbols: ['*'] });
                assert.deepStrictEqual(parseImportStatement(`import whatever from './ledger.ts';`), { specifier: './ledger.ts', symbols: ['default'] });
                assert.strictEqual(parseImportStatement(`export const none = true;`), null);
                assert.strictEqual(parseImportStatement(`// import { a } from './ledger.ts';`), null);
        });

        test('specifierResolvesTo accepts only relative specifiers naming the ledger module (with the extension rules)', () => {
                assert.ok(specifierResolvesTo('extensions/flauz-alpha/src/consumer.ts', './ledger.ts', FIXTURE_LEDGER));
                assert.ok(specifierResolvesTo('extensions/flauz-alpha/src/extensionless.ts', '../src/ledger', FIXTURE_LEDGER));
                assert.ok(!specifierResolvesTo('extensions/flauz-alpha/src/consumer.ts', './other.ts', FIXTURE_LEDGER));
                assert.ok(!specifierResolvesTo('extensions/flauz-alpha/src/consumer.ts', 'flauz-alpha/src/ledger.ts', FIXTURE_LEDGER));
                assert.ok(!specifierResolvesTo('extensions/flauz-alpha/src/consumer.ts', '/etc/passwd', FIXTURE_LEDGER));
        });

        test('the scanner finds exactly the real consumers (file + line + symbols), excluding comments, other modules and non-flauz extensions', async () => {
                const fixture = await buildFixtureTree();
                const scanned = await scanLedgerConsumers(fixture.root, FIXTURE_LEDGER);
                assert.deepStrictEqual(scanned, [...fixture.groundTruth]);
        });

        test('a fully-correct map verifies 100% (sound + complete)', async () => {
                const fixture = await buildFixtureTree();
                const verification = await verifyConsumersMap(answerOf(fixture.groundTruth), fixture.groundTruth, fixture.root, FIXTURE_LEDGER);
                assert.strictEqual(verification.verified, true);
                assert.strictEqual(verification.totals.claimed, 6);
                assert.strictEqual(verification.totals.missedEntries, 0);
                assert.strictEqual(verification.totals.problemEntries, 0);
        });

        test('a hallucinated entry (wrong line / phantom file) is flagged and fails verification', async () => {
                const fixture = await buildFixtureTree();
                const doctored = [
                        ...fixture.groundTruth,
                        { file: 'extensions/flauz-beta/src/mentions.ts', line: 1, symbols: ['a'] },
                        { file: 'extensions/flauz-alpha/src/consumer.ts', line: 9, symbols: ['a'] },
                ];
                const verification = await verifyConsumersMap(answerOf(doctored), fixture.groundTruth, fixture.root, FIXTURE_LEDGER);
                assert.strictEqual(verification.verified, false);
                assert.strictEqual(verification.totals.problemEntries, 2);
                assert.ok(verification.checked.some(entry => entry.file === 'extensions/flauz-beta/src/mentions.ts' && entry.problems.some(problem => problem.includes('no ledger-import statement'))));
                assert.ok(verification.checked.some(entry => entry.file === 'extensions/flauz-alpha/src/consumer.ts' && entry.problems.some(problem => problem.includes('is at line 1, not 9'))));
        });

        test('a missing consumer breaks completeness (the map is checked, not trusted)', async () => {
                const fixture = await buildFixtureTree();
                const incomplete = fixture.groundTruth.filter(consumer => consumer.file !== 'extensions/flauz-beta/src/typeonly.ts');
                const verification = await verifyConsumersMap(answerOf(incomplete), fixture.groundTruth, fixture.root, FIXTURE_LEDGER);
                assert.strictEqual(verification.verified, false);
                assert.strictEqual(verification.totals.missedEntries, 1);
                assert.strictEqual(verification.missed[0]?.file, 'extensions/flauz-beta/src/typeonly.ts');
        });

        test('a symbol mismatch is flagged (what it consumes is checked too)', async () => {
                const fixture = await buildFixtureTree();
                const doctored = fixture.groundTruth.map(consumer => consumer.file === 'extensions/flauz-alpha/src/multi.ts' ? { file: consumer.file, line: consumer.line, symbols: ['b'] } : consumer);
                const verification = await verifyConsumersMap(answerOf(doctored), fixture.groundTruth, fixture.root, FIXTURE_LEDGER);
                assert.strictEqual(verification.verified, false);
                assert.ok(verification.checked.some(entry => entry.file === 'extensions/flauz-alpha/src/multi.ts' && entry.problems.some(problem => problem.includes('consumes mismatch'))));
        });

        test('a duplicate map entry is flagged', async () => {
                const fixture = await buildFixtureTree();
                const duplicated = [...fixture.groundTruth, fixture.groundTruth[0] ?? { file: '', line: 1, symbols: [] }];
                const verification = await verifyConsumersMap(answerOf(duplicated), fixture.groundTruth, fixture.root, FIXTURE_LEDGER);
                assert.strictEqual(verification.verified, false);
                assert.ok(verification.checked.some(entry => entry.problems.some(problem => problem.includes('duplicate map entry'))));
        });

        test('parseExploreAnswer accepts a valid answer document and rejects malformed ones', () => {
                const valid = parseExploreAnswer(JSON.stringify({ schema: EXPLORE_ANSWER_SCHEMA, consumers: [{ file: 'a.ts', line: 1, consumes: ['x'] }] }));
                assert.ok(valid.ok);
                assert.strictEqual(valid.ok && valid.answer.consumers.length, 1);
                const wrongSchema = parseExploreAnswer(JSON.stringify({ schema: 'other/v1', consumers: [] }));
                assert.ok(!wrongSchema.ok);
                const notJson = parseExploreAnswer('this is not json');
                assert.ok(!notJson.ok);
                const badLine = parseExploreAnswer(JSON.stringify({ schema: EXPLORE_ANSWER_SCHEMA, consumers: [{ file: 'a.ts', line: 0, consumes: [] }] }));
                assert.ok(!badLine.ok);
        });

        test('live-tree smoke: the scanner and the verifier agree on the real repo (self-consistency over the actual clone)', async () => {
                const groundTruth = await scanLedgerConsumers(REPO_ROOT);
                assert.ok(groundTruth.length >= 10, `expected the real tree to carry a meaningful consumer set (got ${String(groundTruth.length)})`);
                assert.ok(groundTruth.every(consumer => consumer.file.startsWith('extensions/flauz-')));
                const verification = await verifyConsumersMap(answerOf(groundTruth), groundTruth, REPO_ROOT, LEDGER_MODULE);
                assert.strictEqual(verification.verified, true, `self-consistency failed: ${JSON.stringify(verification.totals)}`);
        });
});

// ---------------------------------------------------------------------------
// suite: the provider-switch exercise logic
// ---------------------------------------------------------------------------

function fakeReceipt(switchNo: number, lane: SwitchRunRecord['receipt']['lane']): SwitchRunRecord['receipt'] {
        return { switchNo, lane, providerId: `flauz-dogfood-${lane}`, enabledLanes: [lane], providersFileSha256: 'a'.repeat(64), evidenceId: `E-${String(switchNo).padStart(6, '0')}`, seq: switchNo, at: switchNo * 1000 };
}

function okAsk(switchNo: number): SwitchRunRecord['ask'] {
        return { kind: 'ok', text: '{}', decisionId: `rd-${String(switchNo).padStart(6, '0')}`, providerId: 'flauz-dogfood-fake', modelId: 'dogfood-1', durationMs: 5, attempts: 1, wallClockBudgetMs: 15_000, finishReason: 'stop' };
}

function failedAsk(switchNo: number): SwitchRunRecord['ask'] {
        return { kind: 'provider-failure', code: 'PROVIDER_OVERLOADED', retryable: true, retryClass: 'short-backoff', status: 500, retryAfterMs: undefined, message: 'armed to fail', decisionId: `rd-${String(switchNo).padStart(6, '0')}`, providerId: 'flauz-dogfood-failing', modelId: 'dogfood-1', durationMs: 20, attempts: 3, wallClockBudgetMs: 15_000 };
}

const PROMPT_FACTS_OK = { ok: true, problems: [] } as const;

function recordOf(switchNo: number, lane: SwitchRunRecord['lane'], ask: SwitchRunRecord['ask'], atMs: number, durationMs: number): SwitchRunRecord {
        return { switchNo, lane, receipt: fakeReceipt(switchNo, lane === 'healthy' ? 'fake' : 'scripted-failing'), ask, askPrompt: 'ask prompt (fixture)', promptFacts: PROMPT_FACTS_OK, answerProblems: [], atMs, durationMs };
}

suite('provider-switch: the exercise logic', () => {

        test('the planned sequence is healthy -> scripted-failing -> healthy, in both modes', () => {
                for (const mode of ['fake-lane', 'live-provider'] as const) {
                        const plan = plannedSwitchSequence(mode);
                        assert.deepStrictEqual(plan.map(step => [step.switchNo, step.lane, step.expect]), [
                                [1, 'healthy', 'ok'],
                                [2, 'scripted-failing', 'typed-provider-failure'],
                                [3, 'healthy', 'ok'],
                        ]);
                        assert.strictEqual(plan[0]?.concreteLane, healthyLaneOf(mode));
                        assert.strictEqual(healthyLaneOf(mode), mode === 'live-provider' ? 'live' : 'fake');
                }
        });

        test('a complete run (typed failure + recovery + evidence per switch) summarizes ok', () => {
                const plan = plannedSwitchSequence('fake-lane');
                const records: SwitchRunRecord[] = [
                        recordOf(1, 'healthy', okAsk(1), 1_000, 10),
                        recordOf(2, 'scripted-failing', failedAsk(2), 2_000, 25),
                        recordOf(3, 'healthy', okAsk(3), 2_050, 10),
                ];
                const summary = summarizeSwitchRun(plan, records);
                assert.ok(summary.ok, summary.problems.join('; '));
                assert.strictEqual(summary.typedFailure?.ask.kind, 'provider-failure');
                assert.strictEqual(summary.recovery?.switchNo, 3);
                assert.strictEqual(summary.recoveryMs, 50);
        });

        test('a run without the typed failure is flagged (the failing window must actually fail)', () => {
                const plan = plannedSwitchSequence('fake-lane');
                const records: SwitchRunRecord[] = [
                        recordOf(1, 'healthy', okAsk(1), 1_000, 10),
                        recordOf(2, 'scripted-failing', okAsk(2), 2_000, 10),
                        recordOf(3, 'healthy', okAsk(3), 3_000, 10),
                ];
                const summary = summarizeSwitchRun(plan, records);
                assert.ok(!summary.ok);
                assert.ok(summary.problems.some(problem => problem.includes('produced no typed provider failure')));
        });

        test('a run without recovery is flagged, and a failure without a bounded-retry window is flagged', () => {
                const plan = plannedSwitchSequence('fake-lane');
                const noRecovery: SwitchRunRecord[] = [
                        recordOf(1, 'healthy', okAsk(1), 1_000, 10),
                        recordOf(2, 'scripted-failing', failedAsk(2), 2_000, 20),
                ];
                const noRecoverySummary = summarizeSwitchRun(plan, noRecovery);
                assert.ok(!noRecoverySummary.ok);
                assert.ok(noRecoverySummary.problems.some(problem => problem.includes('never recovered')));
                assert.ok(noRecoverySummary.problems.some(problem => problem.includes('were planned')));
                const singleAttempt: SwitchRunRecord[] = [
                        recordOf(1, 'healthy', okAsk(1), 1_000, 10),
                        recordOf(2, 'scripted-failing', { ...failedAsk(2), attempts: 1 }, 2_000, 5),
                        recordOf(3, 'healthy', okAsk(3), 2_050, 10),
                ];
                const singleAttemptSummary = summarizeSwitchRun(plan, singleAttempt);
                assert.ok(!singleAttemptSummary.ok);
                assert.ok(singleAttemptSummary.problems.some(problem => problem.includes('bounded-retry window')));
        });

        test('a switch without an evidence row is flagged', () => {
                const plan = plannedSwitchSequence('fake-lane');
                const records: SwitchRunRecord[] = [
                        { ...recordOf(1, 'healthy', okAsk(1), 1_000, 10), receipt: { ...fakeReceipt(1, 'fake'), evidenceId: '' } },
                        recordOf(2, 'scripted-failing', failedAsk(2), 2_000, 20),
                        recordOf(3, 'healthy', okAsk(3), 2_050, 10),
                ];
                const summary = summarizeSwitchRun(plan, records);
                assert.ok(!summary.ok);
                assert.ok(summary.problems.some(problem => problem.includes('minted no evidence row')));
        });

        test('the switch answer is verified against the workspace model state (checked, not trusted)', async () => {
                const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'flauz-dogfood-ws-'));
                await fs.mkdir(path.join(workspace, '.flauz', 'models'), { recursive: true });
                await fs.writeFile(path.join(workspace, '.flauz', 'models', 'providers.json'), JSON.stringify({ schema: 'flauz.model-providers/v0', providers: [
                        { providerId: 'flauz-dogfood-fake', enabled: true },
                        { providerId: 'flauz-dogfood-failing', enabled: false },
                ] }), { encoding: 'utf-8' });
                await fs.writeFile(path.join(workspace, '.flauz', 'models', 'routing-decisions.jsonl'), [
                        JSON.stringify({ decisionId: 'rd-000001' }),
                        JSON.stringify({ decisionId: 'rd-000002' }),
                        '',
                ].join('\n'), { encoding: 'utf-8' });

                const correct = parseSwitchAnswer(JSON.stringify({ schema: SWITCH_ANSWER_SCHEMA, enabledDogfoodProviders: ['flauz-dogfood-fake'], routingDecisionCount: 2, lastDecisionId: 'rd-000002' }));
                assert.ok(correct.ok);
                const good = await verifySwitchAnswer(correct.ok ? correct.answer : { schema: '', enabledDogfoodProviders: [], routingDecisionCount: 0, lastDecisionId: '' }, workspace);
                assert.ok(good.ok, good.problems.join('; '));

                const wrong = await verifySwitchAnswer({ schema: SWITCH_ANSWER_SCHEMA, enabledDogfoodProviders: ['flauz-dogfood-failing'], routingDecisionCount: 9, lastDecisionId: 'rd-000009' }, workspace);
                assert.ok(!wrong.ok);
                assert.strictEqual(wrong.problems.length, 3);
        });

        test('parseSwitchAnswer validates the schema and the field shapes', () => {
                const okOutcome = parseSwitchAnswer(JSON.stringify({ schema: SWITCH_ANSWER_SCHEMA, enabledDogfoodProviders: ['x'], routingDecisionCount: 0, lastDecisionId: '' }));
                assert.ok(okOutcome.ok);
                assert.ok(!parseSwitchAnswer('nope').ok);
                assert.ok(!parseSwitchAnswer(JSON.stringify({ schema: 'other', enabledDogfoodProviders: [], routingDecisionCount: 0, lastDecisionId: '' })).ok);
                assert.ok(!parseSwitchAnswer(JSON.stringify({ schema: SWITCH_ANSWER_SCHEMA, enabledDogfoodProviders: 'no-array', routingDecisionCount: 0, lastDecisionId: '' })).ok);
                assert.ok(!parseSwitchAnswer(JSON.stringify({ schema: SWITCH_ANSWER_SCHEMA, enabledDogfoodProviders: [], routingDecisionCount: -1, lastDecisionId: '' })).ok);
        });

        test('providerFailureDetail carries the typed code + retry class; recoveryAccount names the recovered lane', () => {
                const detail = providerFailureDetail({ code: 'PROVIDER_OVERLOADED', retryClass: 'short-backoff', retryable: true, status: 500, attempts: 3, message: 'armed to fail' });
                assert.ok(detail.includes('PROVIDER_OVERLOADED'));
                assert.ok(detail.includes('short-backoff'));
                assert.ok(detail.includes('3 bounded-retry attempt(s)'));
                const account = recoveryAccount(3, 'fake', 9);
                assert.ok(account.includes('switch 3'));
                assert.ok(account.includes('9 ms'));
        });
});

// ---------------------------------------------------------------------------
// suite: P2-FIX-118 — the fence-tolerant answer parsing (the live lanes)
// ---------------------------------------------------------------------------

const SWITCH_ANSWER_DOCUMENT = JSON.stringify({ schema: SWITCH_ANSWER_SCHEMA, enabledDogfoodProviders: ['flauz-dogfood-fake'], routingDecisionCount: 2, lastDecisionId: 'rd-000002' });
const EXPLORE_ANSWER_DOCUMENT = JSON.stringify({ schema: EXPLORE_ANSWER_SCHEMA, consumers: [{ file: 'extensions/flauz-alpha/src/consumer.ts', line: 1, consumes: ['a'] }] });

suite('P2-FIX-118: fence-tolerant answer parsing (live lanes; strip-fence-then-parse)', () => {

        test('fenced OK: a ```json-fenced switch answer parses in tolerant mode (fenceStripped true)', () => {
                const fenced = '```json\n' + SWITCH_ANSWER_DOCUMENT + '\n```';
                const parsed = parseSwitchAnswer(fenced, { fenceTolerant: true });
                assert.ok(parsed.ok, parsed.ok ? '' : parsed.error);
                assert.strictEqual(parsed.ok && parsed.fenceStripped, true);
                assert.deepStrictEqual(parsed.ok && parsed.answer.enabledDogfoodProviders, ['flauz-dogfood-fake']);
        });

        test('fenced OK: a plain-fenced (no info string) switch answer parses in tolerant mode', () => {
                const fenced = '```\n' + SWITCH_ANSWER_DOCUMENT + '\n```';
                assert.ok(parseSwitchAnswer(fenced, { fenceTolerant: true }).ok);
        });

        test('fenced OK: an explore answer wrapped in a ```json fence parses in tolerant mode', () => {
                const fenced = '```json\n' + EXPLORE_ANSWER_DOCUMENT + '\n```';
                const parsed = parseExploreAnswer(fenced, { fenceTolerant: true });
                assert.ok(parsed.ok, parsed.ok ? '' : parsed.error);
                assert.strictEqual(parsed.ok && parsed.fenceStripped, true);
        });

        test('malformed-fenced FAIL: broken JSON inside a fence is never silently accepted (switch + explore)', () => {
                const malformedSwitch = '```json\n{"schema": "flauz.dogfood-switch-answer/v1", not json at all\n```';
                const switchOutcome = parseSwitchAnswer(malformedSwitch, { fenceTolerant: true });
                assert.ok(!switchOutcome.ok);
                assert.ok(switchOutcome.error.includes('is not valid JSON inside the stripped markdown fence'));
                const malformedExplore = '```json\n{"schema": "flauz.dogfood-explore-answer/v1", consumers: nope\n```';
                const exploreOutcome = parseExploreAnswer(malformedExplore, { fenceTolerant: true });
                assert.ok(!exploreOutcome.ok);
                assert.ok(exploreOutcome.error.includes('is not valid JSON inside the stripped markdown fence'));
        });

        test('raw OK: a raw-JSON switch answer parses in tolerant mode with fenceStripped false', () => {
                const parsed = parseSwitchAnswer(SWITCH_ANSWER_DOCUMENT, { fenceTolerant: true });
                assert.ok(parsed.ok, parsed.ok ? '' : parsed.error);
                assert.strictEqual(parsed.ok && parsed.fenceStripped, false);
                assert.ok(parseExploreAnswer(EXPLORE_ANSWER_DOCUMENT, { fenceTolerant: true }).ok);
        });

        test('raw path stays the machine-lane DEFAULT: the W2 fenced answer still fails without fenceTolerant', () => {
                // the verbatim W2 shape: a correct payload wrapped in ```json (the banked evidence)
                const fenced = '```json\n' + SWITCH_ANSWER_DOCUMENT + '\n```';
                const outcome = parseSwitchAnswer(fenced);
                assert.ok(!outcome.ok);
                assert.ok(outcome.error.includes('the completion is not valid JSON'));
        });

        test('a partial fence is NOT stripped: an unterminated fence fails honestly in tolerant mode', () => {
                const unterminated = '```json\n' + SWITCH_ANSWER_DOCUMENT;
                assert.ok(!parseSwitchAnswer(unterminated, { fenceTolerant: true }).ok);
        });

        test('prose after the closing fence: the W2.1 clean-pair seam still refuses it; the P2-FIX-120 composed path now parses it (the extraction fallback)', () => {
                const withProse = '```json\n' + SWITCH_ANSWER_DOCUMENT + '\n```\nHope this helps!';
                // the W2.1 clean-pair FUNCTION keeps its narrow semantics (back-compat, UNCHANGED)
                assert.strictEqual(stripMarkdownJsonFence(withProse).fenced, false);
                // but the composed fence-tolerant parse extracts the first COMPLETE fenced block (P2-FIX-120)
                const parsed = parseSwitchAnswer(withProse, { fenceTolerant: true });
                assert.ok(parsed.ok, parsed.ok ? '' : parsed.error);
                assert.strictEqual(parsed.ok && parsed.fenceStripped, true);
        });

        test('stripMarkdownJsonFence: fence pair stripped, body exact, non-fenced text unchanged', () => {
                const stripped = stripMarkdownJsonFence('```json\n{"a":1}\n```');
                assert.strictEqual(stripped.fenced, true);
                assert.strictEqual(stripped.body, '{"a":1}');
                const untouched = stripMarkdownJsonFence('{"a":1}');
                assert.strictEqual(untouched.fenced, false);
                assert.strictEqual(untouched.body, '{"a":1}');
                const leadingNewlines = stripMarkdownJsonFence('\n\n```json\n{"a":1}\n```\n');
                assert.strictEqual(leadingNewlines.fenced, true);
                assert.strictEqual(leadingNewlines.body, '{"a":1}');
        });
});

// ---------------------------------------------------------------------------
// suite: P2-FIX-120 — prose-adjacent fenced answers (the extraction fallback)
// ---------------------------------------------------------------------------
// The W3 live re-run (records banked at records/aprod003-w3-live-2026-10-01/)
// surfaced the verbatim shape: the live model emits the fenced JSON followed
// by prose ("```json {...} ``` Success!") and the W2.1 stripper only strips a
// fence pair that ENDS the text. The fence-tolerant path now extracts the
// FIRST COMPLETE fenced block from anywhere in the text (clean-pair strip
// first, back-compat; then the extraction fallback; prose before/after
// allowed; malformed JSON inside still FAILS; no complete fence -> the honest
// raw failure; the raw-JSON machine-lane default unchanged).
// ---------------------------------------------------------------------------

suite('P2-FIX-120: prose-adjacent fenced answers (live lanes; the first complete fenced block)', () => {

        test('fenced-with-trailing-prose OK: the verbatim W3 live shape (```json {...} ``` Success!) parses, fenceStripped true', () => {
                const withTrailingProse = '```json\n' + SWITCH_ANSWER_DOCUMENT + '\n```\nSuccess! Here is the provider map you asked for.';
                const parsed = parseSwitchAnswer(withTrailingProse, { fenceTolerant: true });
                assert.ok(parsed.ok, parsed.ok ? '' : parsed.error);
                assert.strictEqual(parsed.ok && parsed.fenceStripped, true);
                assert.deepStrictEqual(parsed.ok && parsed.answer.enabledDogfoodProviders, ['flauz-dogfood-fake']);
                assert.strictEqual(parsed.ok && parsed.answer.routingDecisionCount, 2);
        });

        test('fenced-with-leading-prose OK: prose before the fence parses via the extraction fallback (BOTH exercises)', () => {
                const withLeadingProse = 'Sure! I scanned the workspace providers file and the routing ledger. Here is the answer document:\n```json\n' + SWITCH_ANSWER_DOCUMENT + '\n```';
                const parsed = parseSwitchAnswer(withLeadingProse, { fenceTolerant: true });
                assert.ok(parsed.ok, parsed.ok ? '' : parsed.error);
                assert.strictEqual(parsed.ok && parsed.fenceStripped, true);
                const explore = parseExploreAnswer('Here you go, the consumer map:\n```json\n' + EXPLORE_ANSWER_DOCUMENT + '\n```\nHappy mapping!', { fenceTolerant: true });
                assert.ok(explore.ok, explore.ok ? '' : explore.error);
                assert.strictEqual(explore.ok && explore.fenceStripped, true);
                assert.deepStrictEqual(explore.ok && explore.answer.consumers.length, 1);
        });

        test('clean-fence (the W2.1 shape) still goes through the clean-pair path FIRST (back-compat)', () => {
                const clean = '```json\n' + SWITCH_ANSWER_DOCUMENT + '\n```';
                const outcome = fenceTolerantParseBody(clean, { fenceTolerant: true });
                assert.strictEqual(outcome.fenced, true);
                assert.strictEqual(outcome.via, 'clean-pair');
                assert.strictEqual(outcome.body, SWITCH_ANSWER_DOCUMENT);
                const parsed = parseSwitchAnswer(clean, { fenceTolerant: true });
                assert.ok(parsed.ok, parsed.ok ? '' : parsed.error);
                assert.strictEqual(parsed.ok && parsed.fenceStripped, true);
        });

        test('multiple-fences: the FIRST complete fenced block wins', () => {
                const secondDocument = JSON.stringify({ schema: SWITCH_ANSWER_SCHEMA, enabledDogfoodProviders: ['flauz-dogfood-other'], routingDecisionCount: 7, lastDecisionId: 'rd-000007' });
                const twoFences = 'Here is the first answer:\n```json\n' + SWITCH_ANSWER_DOCUMENT + '\n```\nAnd a second one for good measure:\n```json\n' + secondDocument + '\n```\nDone!';
                const parsed = parseSwitchAnswer(twoFences, { fenceTolerant: true });
                assert.ok(parsed.ok, parsed.ok ? '' : parsed.error);
                assert.deepStrictEqual(parsed.ok && parsed.answer.enabledDogfoodProviders, ['flauz-dogfood-fake']);
                assert.strictEqual(parsed.ok && parsed.answer.routingDecisionCount, 2);
                assert.strictEqual(parsed.ok && parsed.answer.lastDecisionId, 'rd-000002');
        });

        test('no-fence: a prose-only completion falls to the raw parse and fails honestly (tolerant mode changes nothing)', () => {
                const proseOnly = 'I am very sorry, but I could not produce the JSON answer document you asked for.';
                const outcome = parseSwitchAnswer(proseOnly, { fenceTolerant: true });
                assert.ok(!outcome.ok);
                assert.ok(outcome.error.includes('the completion is not valid JSON'));
                assert.ok(!outcome.error.includes('fence'));
                const exploreOutcome = parseExploreAnswer('no json here at all, just words', { fenceTolerant: true });
                assert.ok(!exploreOutcome.ok);
                assert.ok(!exploreOutcome.error.includes('fence'));
        });

        test('malformed-inside-fence FAIL: broken JSON inside an extracted block is never silently accepted (BOTH exercises)', () => {
                const malformedSwitch = 'Absolutely! Here it is:\n```json\n{"schema": "flauz.dogfood-switch-answer/v1", not json at all\n```\nSuccess!';
                const switchOutcome = parseSwitchAnswer(malformedSwitch, { fenceTolerant: true });
                assert.ok(!switchOutcome.ok);
                assert.ok(switchOutcome.error.includes('is not valid JSON inside the stripped markdown fence'));
                const malformedExplore = '```json\n{"schema": "flauz.dogfood-explore-answer/v1", consumers: nope\n```\nHope this helps!';
                const exploreOutcome = parseExploreAnswer(malformedExplore, { fenceTolerant: true });
                assert.ok(!exploreOutcome.ok);
                assert.ok(exploreOutcome.error.includes('is not valid JSON inside the stripped markdown fence'));
        });

        test('an unterminated fence still fails honestly in tolerant mode (no COMPLETE pair anywhere -> the raw parse)', () => {
                const unterminatedWithProse = 'Sure! Here you go:\n```json\n' + SWITCH_ANSWER_DOCUMENT + '\nand I never closed the fence, sorry';
                const outcome = parseSwitchAnswer(unterminatedWithProse, { fenceTolerant: true });
                assert.ok(!outcome.ok);
                assert.ok(!outcome.error.includes('fence'));
        });

        test('extractFirstFencedJsonBlock: body exact (the clean-pair body semantics), first block wins, prose-only/unterminated not found', () => {
                // the clean shape: the extracted body equals the clean-pair body byte-for-byte
                const cleanText = '```json\n{"a":1}\n```';
                const extracted = extractFirstFencedJsonBlock(cleanText);
                assert.strictEqual(extracted.found, true);
                assert.strictEqual(extracted.body, '{"a":1}');
                assert.strictEqual(stripMarkdownJsonFence(cleanText).body, extracted.body);
                // prose-adjacent: leading + trailing prose, body still exact
                const fromProse = extractFirstFencedJsonBlock('Sure!\n```json\n{"a":1}\n```\nSuccess!');
                assert.strictEqual(fromProse.found, true);
                assert.strictEqual(fromProse.body, '{"a":1}');
                // the FIRST of two complete blocks wins (a bare fence before a ```json fence)
                const twoBlocks = 'x\n```\n{"first":1}\n```\ny\n```json\n{"second":2}\n```\nz';
                const firstBlock = extractFirstFencedJsonBlock(twoBlocks);
                assert.strictEqual(firstBlock.found, true);
                assert.strictEqual(firstBlock.body, '{"first":1}');
                // a fence line with an info string never CLOSES a block (interior content)
                const infoStringInterior = '```\n{"a":1}\n```json\n{"b":2}\n```';
                const outerBlock = extractFirstFencedJsonBlock(infoStringInterior);
                assert.strictEqual(outerBlock.found, true);
                assert.strictEqual(outerBlock.body, '{"a":1}\n```json\n{"b":2}');
                // no fence at all: not found, text unchanged
                const noFence = extractFirstFencedJsonBlock('just prose, no fence at all');
                assert.strictEqual(noFence.found, false);
                assert.strictEqual(noFence.body, 'just prose, no fence at all');
                // an unterminated opening: not found (no COMPLETE pair)
                const unterminated = extractFirstFencedJsonBlock('```json\n{"a":1}');
                assert.strictEqual(unterminated.found, false);
                assert.strictEqual(unterminated.body, '```json\n{"a":1}');
                // an inline backtick mention mid-line is NOT a fence line
                const inlineTick = extractFirstFencedJsonBlock('the ``` inline tick is not a fence');
                assert.strictEqual(inlineTick.found, false);
        });

        test('fenceTolerantParseBody: clean-pair preferred, extraction only as the fallback, raw default without the option', () => {
                // clean-pair first (back-compat for the W2.1 shapes)
                const clean = fenceTolerantParseBody('```json\n{"a":1}\n```', { fenceTolerant: true });
                assert.strictEqual(clean.fenced, true);
                assert.strictEqual(clean.via, 'clean-pair');
                assert.strictEqual(clean.body, '{"a":1}');
                // the extraction fallback for prose-adjacent text
                const extracted = fenceTolerantParseBody('Sure!\n```json\n{"a":1}\n```\nSuccess!', { fenceTolerant: true });
                assert.strictEqual(extracted.fenced, true);
                assert.strictEqual(extracted.via, 'extracted');
                assert.strictEqual(extracted.body, '{"a":1}');
                // no complete fence: the raw body, fenced false, no via
                const raw = fenceTolerantParseBody('{"a":1}', { fenceTolerant: true });
                assert.strictEqual(raw.fenced, false);
                assert.strictEqual(raw.body, '{"a":1}');
                assert.strictEqual(raw.via, undefined);
                // the machine-lane default: NO tolerance without the option (even a clean fence)
                const machineLane = fenceTolerantParseBody('```json\n{"a":1}\n```');
                assert.strictEqual(machineLane.fenced, false);
                assert.strictEqual(machineLane.body, '```json\n{"a":1}\n```');
        });
});

// ---------------------------------------------------------------------------
// suite: P2-FIX-117 — the wall-clock budget on timing rows
// ---------------------------------------------------------------------------

suite('P2-FIX-117: the wall-clock budget recorded on ask-measuring timing rows', () => {

        test('timing() with wallClockBudgetMs appends the field and the row validates', async () => {
                const target = path.join(os.tmpdir(), `flauz-dogfood-test-${String(Date.now())}-${String(Math.floor(Math.random() * 1e6))}`, 'budget.jsonl');
                const log = new FrictionLog({ path: target });
                const written = await log.timing({ phase: 'test:model-call', durationMs: 45_030, wallClockBudgetMs: 240_000 });
                const parsed = JSON.parse((await fs.readFile(target, { encoding: 'utf-8' })).split('\n')[0] ?? '') as Record<string, unknown>;
                assert.strictEqual(parsed.wallClockBudgetMs, 240_000);
                assert.strictEqual(written.wallClockBudgetMs, 240_000);
                assert.ok(validateFrictionLine(written).ok);
        });

        test('timing() without wallClockBudgetMs writes the pre-W2.1 shape (the field stays optional)', async () => {
                const target = path.join(os.tmpdir(), `flauz-dogfood-test-${String(Date.now())}-${String(Math.floor(Math.random() * 1e6))}`, 'nobudget.jsonl');
                const log = new FrictionLog({ path: target });
                const written = await log.timing({ phase: 'test:driver-verification', durationMs: 12 });
                const parsed = JSON.parse((await fs.readFile(target, { encoding: 'utf-8' })).split('\n')[0] ?? '') as Record<string, unknown>;
                assert.ok(!('wallClockBudgetMs' in parsed));
                assert.ok(validateFrictionLine(written).ok);
        });

        test('validateFrictionLine rejects non-positive and non-finite budgets, and still accepts the banked W2 row shape', () => {
                assert.ok(!validateFrictionLine({ schema: FRICTION_SCHEMA, type: 'timing', ts: 1, phase: 'p', durationMs: 1, wallClockBudgetMs: 0 }).ok);
                assert.ok(!validateFrictionLine({ schema: FRICTION_SCHEMA, type: 'timing', ts: 1, phase: 'p', durationMs: 1, wallClockBudgetMs: -5 }).ok);
                assert.ok(!validateFrictionLine({ schema: FRICTION_SCHEMA, type: 'timing', ts: 1, phase: 'p', durationMs: 1, wallClockBudgetMs: Number.NaN }).ok);
                assert.ok(!validateFrictionLine({ schema: FRICTION_SCHEMA, type: 'timing', ts: 1, phase: 'p', durationMs: 1, wallClockBudgetMs: '60000' }).ok);
                // the banked W2 record (no budget field) still validates -- additive, backward compatible
                assert.ok(validateFrictionLine({ schema: FRICTION_SCHEMA, type: 'timing', ts: 1790859013967, phase: 'explore-repo:model-call', durationMs: 45030 }).ok);
        });
});

// ---------------------------------------------------------------------------
// suite: P2-FIX-119 — the prompt-carried workspace facts
// ---------------------------------------------------------------------------

async function buildFactsWorkspace(): Promise<string> {
        const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'flauz-dogfood-facts-'));
        await fs.mkdir(path.join(workspace, '.flauz', 'models'), { recursive: true });
        await fs.writeFile(path.join(workspace, '.flauz', 'models', 'providers.json'), JSON.stringify({ schema: 'flauz.model-providers/v0', providers: [
                { providerId: 'flauz-dogfood-fake', enabled: true, credentialRef: 'env:FLAUZ_DOGFOOD_FAKE_KEY', baseUrl: 'http://127.0.0.1:9/v1' },
                { providerId: 'flauz-dogfood-failing', enabled: false, credentialRef: 'env:FLAUZ_DOGFOOD_FAILING_KEY', baseUrl: 'http://127.0.0.1:9/fail' },
                { providerId: 'stock-provider', enabled: true },
        ] }, null, '\t'), { encoding: 'utf-8' });
        await fs.writeFile(path.join(workspace, '.flauz', 'models', 'routing-decisions.jsonl'), [
                JSON.stringify({ decisionId: 'rd-000001', purpose: 'dogfood-lane-selection' }),
                JSON.stringify({ decisionId: 'rd-000002', purpose: 'chat-turn' }),
                JSON.stringify({ decisionId: 'rd-000003', purpose: 'dogfood-lane-selection' }),
                JSON.stringify({ decisionId: 'rd-000004', purpose: 'chat-turn' }),
                JSON.stringify({ decisionId: 'rd-000005', purpose: 'chat-turn' }),
                '',
        ].join('\n'), { encoding: 'utf-8' });
        return workspace;
}

suite('P2-FIX-119: the provider-switch question carries the workspace facts in the prompt', () => {

        test('buildSwitchQuestion embeds the providers file verbatim + the decision count + the tail (last 3 rows)', async () => {
                const workspace = await buildFactsWorkspace();
                const facts = await readSwitchQuestionFacts(workspace);
                const question = await buildSwitchQuestion(workspace);
                const providersFile = await fs.readFile(path.join(workspace, '.flauz', 'models', 'providers.json'), { encoding: 'utf-8' });
                assert.ok(question.includes(providersFile), 'the providers file content rides the prompt verbatim');
                assert.ok(question.includes('total routing decisions recorded: 5'));
                assert.ok(question.includes(JSON.stringify({ decisionId: 'rd-000003', purpose: 'dogfood-lane-selection' })));
                assert.ok(question.includes(JSON.stringify({ decisionId: 'rd-000004', purpose: 'chat-turn' })));
                assert.ok(question.includes(JSON.stringify({ decisionId: 'rd-000005', purpose: 'chat-turn' })));
                assert.ok(!question.includes('rd-000001'), 'the tail window is capped at the last 3 rows');
                assert.strictEqual(facts.routingDecisionCount, 5);
                assert.strictEqual(facts.lastDecisionId, 'rd-000005');
        });

        test('verifyPromptCarriesFacts accepts the built question and flags a gutted one', async () => {
                const workspace = await buildFactsWorkspace();
                const question = await buildSwitchQuestion(workspace);
                const good = await verifyPromptCarriesFacts(question, workspace);
                assert.ok(good.ok, good.problems.join('; '));
                const gutted = question.replace('total routing decisions recorded: 5', 'total routing decisions recorded: 2');
                const bad = await verifyPromptCarriesFacts(gutted, workspace);
                assert.ok(!bad.ok);
                assert.ok(bad.problems.some(problem => problem.includes('stale routing-decision count')));
        });

        test('ROUND-TRIP: the fake lane (answerSwitchFromPrompt) reports the prompt facts, and the strict verification accepts them', async () => {
                const workspace = await buildFactsWorkspace();
                const question = await buildSwitchQuestion(workspace);
                const outcome = answerSwitchFromPrompt(question);
                assert.ok(outcome.ok, outcome.ok ? '' : outcome.error);
                const parsed = parseSwitchAnswer(JSON.stringify({ schema: SWITCH_ANSWER_SCHEMA, ...outcome.answer }));
                assert.ok(parsed.ok, parsed.ok ? '' : parsed.error);
                const verification = await verifySwitchAnswer(parsed.answer, workspace);
                assert.ok(verification.ok, verification.problems.join('; '));
        });

        test('the retired god-view: answerSwitchFromPrompt reads the PROMPT, never the workspace (a facts-stale prompt reports stale facts)', async () => {
                const workspace = await buildFactsWorkspace();
                const question = await buildSwitchQuestion(workspace);
                // the workspace drifts AFTER the question was built: the prompt-carried answer
                // must NOT track the new state (the server-side computation path is retired)
                await fs.writeFile(path.join(workspace, '.flauz', 'models', 'providers.json'), JSON.stringify({ schema: 'flauz.model-providers/v0', providers: [{ providerId: 'flauz-dogfood-live', enabled: true }] }), { encoding: 'utf-8' });
                const outcome = answerSwitchFromPrompt(question);
                assert.ok(outcome.ok, outcome.ok ? '' : outcome.error);
                assert.deepStrictEqual(outcome.answer.enabledDogfoodProviders, ['flauz-dogfood-fake']);
                const parsed = parseSwitchAnswer(JSON.stringify({ schema: SWITCH_ANSWER_SCHEMA, ...outcome.answer }));
                assert.ok(parsed.ok);
                const verification = await verifySwitchAnswer(parsed.answer, workspace);
                assert.ok(!verification.ok, 'the strict verification catches the drift (checked, not trusted)');
        });

        test('answerSwitchFromPrompt fails closed on a prompt without the facts sections', () => {
                const outcome = answerSwitchFromPrompt('Report the provider-lane configuration of this Flauz workspace. (no facts embedded)');
                assert.ok(!outcome.ok);
                assert.ok(outcome.error.includes('no providers-file facts section'));
        });

        test('the honest empty workspace: absent files embed empty facts and the round-trip still verifies', async () => {
                const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'flauz-dogfood-empty-'));
                const question = await buildSwitchQuestion(workspace);
                assert.ok(question.includes('(the providers file is absent'));
                assert.ok(question.includes('(the routing-decision ledger is empty'));
                const outcome = answerSwitchFromPrompt(question);
                assert.ok(outcome.ok, outcome.ok ? '' : outcome.error);
                assert.deepStrictEqual(outcome.answer.enabledDogfoodProviders, []);
                assert.strictEqual(outcome.answer.routingDecisionCount, 0);
                assert.strictEqual(outcome.answer.lastDecisionId, '');
                const parsed = parseSwitchAnswer(JSON.stringify({ schema: SWITCH_ANSWER_SCHEMA, ...outcome.answer }));
                assert.ok(parsed.ok);
                const verification = await verifySwitchAnswer(parsed.answer, workspace);
                assert.ok(verification.ok, verification.problems.join('; '));
        });

        test('redactAskPromptForReport redacts credentialRef and baseUrl values (the G6 receipt posture)', async () => {
                const workspace = await buildFactsWorkspace();
                const question = await buildSwitchQuestion(workspace);
                const redacted = redactAskPromptForReport(question);
                assert.ok(redacted.includes('"credentialRef": "<redacted>"'));
                assert.ok(redacted.includes('"baseUrl": "<redacted>"'));
                assert.ok(!redacted.includes('FLAUZ_DOGFOOD_FAKE_KEY'));
                assert.ok(!redacted.includes('127.0.0.1:9'));
                assert.ok(redacted.includes('total routing decisions recorded: 5'), 'the facts stay quotable after redaction');
        });
});

// ---------------------------------------------------------------------------
// suite: P2-FIX-121 — the live completion-budget knob (FLAUZ_DOGFOOD_LIVE_MAX_TOKENS)
// ---------------------------------------------------------------------------

suite('P2-FIX-121: the live completion-budget knob (FLAUZ_DOGFOOD_LIVE_MAX_TOKENS)', () => {

        test('the knob name and the generous default are pinned exactly', () => {
                assert.strictEqual(LIVE_MAX_TOKENS_ENV, 'FLAUZ_DOGFOOD_LIVE_MAX_TOKENS');
                assert.strictEqual(DEFAULT_LIVE_MAX_TOKENS, 32_768);
        });

        test('absent (the empty raw value) resolves the generous default', () => {
                const outcome = parseLiveMaxTokens('');
                assert.ok(outcome.ok);
                assert.strictEqual(outcome.source, 'default');
                assert.strictEqual(outcome.tokens, 32_768);
        });

        test('a well-formed env value resolves it (positive safe integer, source env)', () => {
                for (const raw of ['1', '4096', '20000', '32768', '9007199254740991']) {
                        const outcome = parseLiveMaxTokens(raw);
                        assert.ok(outcome.ok, raw);
                        assert.strictEqual(outcome.source, 'env', raw);
                        assert.strictEqual(outcome.tokens, Number(raw), raw);
                }
        });

        test('malformed values FAIL CLOSED (never a silent default, never a coerced value)', () => {
                for (const raw of ['0', '-1', '3.5', 'abc', '1e5', ' 4096', '4096 ', '0x10', ' ', '99999999999999999999', 'NaN', 'null', 'undefined']) {
                        const outcome = parseLiveMaxTokens(raw);
                        assert.ok(!outcome.ok, `expected fail-closed for ${JSON.stringify(raw)}`);
                        assert.ok(outcome.error.includes('FLAUZ_DOGFOOD_LIVE_MAX_TOKENS'), `the error names the knob for ${JSON.stringify(raw)}`);
                }
        });
});

// ---------------------------------------------------------------------------
// suite: P2-FIX-121 — the finish-reason surfacing (a length finish is a VISIBLE truncation)
// ---------------------------------------------------------------------------

/** A minimal TEST-side scripted completion lane (NOT the fake lane, whose shape is frozen): one OpenAI-shaped SSE completion whose final frame carries finish_reason 'length' over a long fenced JSON cut mid-structure (the W4 live probe class: the opening fence without the closing). Captures each request's max_tokens so the tests pin the ChatRequest.maxOutputTokens -> wire max_tokens mapping end to end. */
async function startScriptedLengthLane(): Promise<{ readonly port: number; readonly calls: number; readonly lastMaxTokens: number | undefined; close(): void }> {
        const truncatedBody = '```json\n{"schema":"flauz.dogfood-explore-answer/v1","question":"map every consumer of the evidence ledger","method":"deterministic full scan","consumers":[{"file":"extensions/flauz';
        let calls = 0;
        let lastMaxTokens: number | undefined;
        const server = http.createServer((request, response) => {
                let body = '';
                request.on('data', (chunk: Buffer) => {
                        body += chunk.toString();
                });
                request.on('end', () => {
                        calls += 1;
                        lastMaxTokens = undefined;
                        try {
                                const parsed = JSON.parse(body) as { max_tokens?: number };
                                lastMaxTokens = parsed.max_tokens;
                        } catch {
                                // an unparsable body leaves the capture undefined
                        }
                        const id = 'chatcmpl-scripted-length';
                        const created = 1_760_000_000;
                        const model = 'dogfood-1';
                        const frames = [
                                `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] })}`,
                                `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { content: truncatedBody.slice(0, 40) }, finish_reason: null }] })}`,
                                `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { content: truncatedBody.slice(40) }, finish_reason: null }] })}`,
                                `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: {}, finish_reason: 'length' }] })}`,
                                `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [], usage: { prompt_tokens: 231, completion_tokens: 4095 } })}`,
                                'data: [DONE]',
                        ];
                        response.writeHead(200, { 'content-type': 'text/event-stream' });
                        response.end(`${frames.join('\n\n')}\n\n`);
                });
        });
        return await new Promise(resolve => {
                server.listen(0, '127.0.0.1', () => {
                        const address = server.address();
                        const port = address === null ? 0 : (address as { readonly port: number }).port;
                        resolve({
                                port,
                                get calls() {
                                        return calls;
                                },
                                get lastMaxTokens() {
                                        return lastMaxTokens;
                                },
                                close: () => server.close(),
                        });
                });
        });
}

suite('P2-FIX-121: the finish-reason surfacing (a length finish is a VISIBLE truncation, never a silent ok)', () => {

        test('finishReasonDetail: the length finish renders the TRUNCATED marker; every other reason renders plainly', () => {
                assert.ok(finishReasonDetail('length').includes('TRUNCATED'));
                assert.ok(finishReasonDetail('length').includes('finish_reason: length'));
                assert.strictEqual(finishReasonDetail('stop'), 'finish_reason: stop');
                assert.strictEqual(finishReasonDetail('tool-calls'), 'finish_reason: tool-calls');
                assert.strictEqual(finishReasonDetail('content-filter'), 'finish_reason: content-filter');
                assert.strictEqual(finishReasonDetail('other'), 'finish_reason: other');
                assert.ok(!finishReasonDetail('stop').includes('TRUNCATED'));
                assert.ok(isTruncatedFinish('length'));
                assert.ok(!isTruncatedFinish('stop'));
                assert.ok(!isTruncatedFinish('other'));
        });

        test('answerParseFailDetail: the truncated parse failure carries the VISIBLE marker + the knob; the stop-finish parse failure carries the plain reason', () => {
                const truncated = answerParseFailDetail('the completion is not valid JSON: Unexpected end of JSON input', 'length');
                assert.ok(truncated.includes('TRUNCATED'), truncated);
                assert.ok(truncated.includes('finish_reason: length'), truncated);
                assert.ok(truncated.includes('FLAUZ_DOGFOOD_LIVE_MAX_TOKENS'), truncated);
                const plain = answerParseFailDetail('the answer schema is "other/v1" but "flauz.dogfood-explore-answer/v1" was expected', 'stop');
                assert.ok(!plain.includes('TRUNCATED'), plain);
                assert.ok(plain.includes('finish_reason: stop'), plain);
        });

        test('consumeAskStream joins the text deltas and captures the terminal finish reason (defensive other when none arrives)', async () => {
                async function* events(): AsyncGenerator<AskStreamEvent> {
                        yield { type: 'text-delta', text: 'part-1 ' };
                        yield { type: 'usage', usage: { estimatedInputTokens: 1, estimatedOutputTokens: 1 } };
                        yield { type: 'text-delta', text: 'part-2' };
                        yield { type: 'finish', finishReason: 'length', usage: { estimatedInputTokens: 1, estimatedOutputTokens: 2 }, provenance: { providerId: 'p', modelId: 'm' } };
                }
                const outcome = await consumeAskStream(events());
                assert.strictEqual(outcome.text, 'part-1 part-2');
                assert.strictEqual(outcome.finishReason, 'length');
                async function* noFinish(): AsyncGenerator<AskStreamEvent> {
                        yield { type: 'text-delta', text: 'x' };
                }
                const bare = await consumeAskStream(noFinish());
                assert.strictEqual(bare.text, 'x');
                assert.strictEqual(bare.finishReason, 'other');
        });

        test('FIXTURE-LEVEL: a scripted stream carrying finish_reason length produces the VISIBLE TRUNCATED marker in the receipt detail (the REAL adapter over a REAL local socket)', async () => {
                const lane = await startScriptedLengthLane();
                const adapter = createOpenAiCompatAdapter({
                        config: {
                                providerId: 'flauz-dogfood-scripted-length',
                                vendor: 'flauz-dogfood',
                                displayName: 'Flauz Dogfood (scripted length)',
                                baseUrl: `http://127.0.0.1:${String(lane.port)}/v1`,
                                credentialRef: 'env:FLAUZ_DOGFOOD_SCRIPTED_LENGTH_KEY',
                                models: [{ modelId: 'dogfood-1', modelName: 'Scripted Length Model', family: 'dogfood', version: '1', contextWindowTokens: 32_000, maxOutputTokens: 4_096, inputModalities: ['text'], toolCalling: false }],
                        },
                        http: nodeHttpPort,
                        secrets: { resolve: async () => 'scripted-local-wire-marker' },
                        hash: { sha256Hex: contents => sha256Hex(contents) },
                        clock: () => Date.now(),
                });
                try {
                        // (1) the budgeted ask: the request carries maxOutputTokens and the wire
                        //     body receives it as max_tokens (the seam P2-FIX-121 wires through)
                        const budgeted = await consumeAskStream(adapter.stream({ modelId: 'dogfood-1', messages: [{ role: 'user', content: [{ kind: 'text', value: EXPLORE_QUESTION }] }], maxOutputTokens: 20_000 }));
                        assert.strictEqual(lane.calls, 1);
                        assert.strictEqual(lane.lastMaxTokens, 20_000);
                        // (2) the scripted length finish surfaces through the REAL adapter's stream
                        assert.strictEqual(budgeted.finishReason, 'length');
                        // (3) the truncated text does not parse (the opening fence without the
                        //     closing), and the receipt detail marks it TRUNCATED -- never a
                        //     bare raw-parse error again
                        const parsed = parseExploreAnswer(budgeted.text, { fenceTolerant: true });
                        assert.ok(!parsed.ok);
                        const detail = answerParseFailDetail(parsed.error, budgeted.finishReason);
                        assert.ok(detail.includes('TRUNCATED'), detail);
                        assert.ok(detail.includes('finish_reason: length'), detail);
                        assert.ok(detail.includes('FLAUZ_DOGFOOD_LIVE_MAX_TOKENS'), detail);
                        // (4) the un-budgeted request (the fake lanes' request shape): NO
                        //     max_tokens on the wire -- unchanged by P2-FIX-121
                        const unbudgeted = await consumeAskStream(adapter.stream({ modelId: 'dogfood-1', messages: [{ role: 'user', content: [{ kind: 'text', value: EXPLORE_QUESTION }] }] }));
                        assert.strictEqual(lane.calls, 2);
                        assert.strictEqual(lane.lastMaxTokens, undefined);
                        assert.strictEqual(unbudgeted.finishReason, 'length');
                } finally {
                        lane.close();
                }
        });
});

// ---------------------------------------------------------------------------
// suite: P2-FIX-122 -- the explore-repo EXCERPT mode (the bare-model lane)
// ---------------------------------------------------------------------------

/**
 * The excerpt fixture tree: the ledger at the CANONICAL module path (so
 * the builder's default ledgerModule finds it), consumers exercising the
 * shared resolution rules (extensionless + .js-twin), a distractor
 * import, and filler files so the seeded selection is meaningful.
 */
async function buildExcerptFixtureTree(): Promise<string> {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flauz-dogfood-excerpt-'));
        const write = async (relative: string, contents: string): Promise<void> => {
                const target = path.join(root, relative);
                await fs.mkdir(path.dirname(target), { recursive: true });
                await fs.writeFile(target, contents, { encoding: 'utf-8' });
        };
        await write('extensions/flauz-workspace/src/ledger.ts', 'export const alpha = 1;\nexport const beta = 2;\nexport type Gamma = {};\nexport const delta = 4;\n');
        await write('extensions/flauz-workspace/src/consumerA.ts', `// a header comment (the import is on line 2)\nimport { alpha } from './ledger';\nexport const use = alpha;\n`);
        await write('extensions/flauz-workspace/src/consumerB.ts', `import { beta, type Gamma } from './ledger.js';\nexport const pair = [beta, null] as const;\n`);
        await write('extensions/flauz-beta/src/farConsumer.ts', `import { delta } from '../../flauz-workspace/src/ledger.ts';\nexport const deep = delta;\n`);
        await write('extensions/flauz-workspace/src/distractor.ts', `import { existsSync } from './other.ts';\nexport const x = existsSync;\n`);
        for (let index = 0; index < 14; index += 1) {
                await write(`extensions/flauz-gamma/src/filler${String(index).padStart(2, '0')}.ts`, `import { value } from './constants';\nexport const local = value + ${String(index)};\n`);
        }
        return root;
}

/** A hand-built excerpt with KNOWN consumers (the verifier tests judge exactly this). */
function handBuiltExcerpt(): TreeExcerpt {
        return {
                schema: EXPLORE_EXCERPT_SCHEMA,
                ledgerModule: LEDGER_MODULE,
                seed: 7,
                fileCount: 4,
                files: [
                        {
                                file: 'extensions/flauz-workspace/src/a.ts',
                                lines: [
                                        { line: 3, text: `import { one, two } from './ledger';` },
                                        { line: 9, text: `import { other } from './unrelated';` },
                                ],
                        },
                        {
                                file: 'extensions/flauz-workspace/src/b.ts',
                                lines: [
                                        { line: 1, text: `import { three } from '../src/ledger.js';` },
                                ],
                        },
                        {
                                file: 'extensions/flauz-workspace/src/c.ts',
                                lines: [
                                        { line: 5, text: `import * as ns from './ledger.ts';` },
                                ],
                        },
                        {
                                file: 'extensions/flauz-beta/src/d.ts',
                                lines: [
                                        { line: 2, text: `import { existsSync } from './x.ts';` },
                                ],
                        },
                ],
        };
}

/** The known consumers of the hand-built excerpt (the excerpt-mode ground truth). */
const HAND_BUILT_CONSUMERS: GroundTruthConsumer[] = [
        { file: 'extensions/flauz-workspace/src/a.ts', line: 3, symbols: ['one', 'two'] },
        { file: 'extensions/flauz-workspace/src/b.ts', line: 1, symbols: ['three'] },
        { file: 'extensions/flauz-workspace/src/c.ts', line: 5, symbols: ['*'] },
];

function excerptAnswerOf(consumers: readonly GroundTruthConsumer[]): ExploreAnswer {
        return { schema: EXPLORE_ANSWER_SCHEMA, consumers: consumers.map(consumer => ({ file: consumer.file, line: consumer.line, consumes: [...consumer.symbols] })) };
}

suite('P2-FIX-122: the excerpt builder (deterministic, seeded)', () => {

        test('the defaults are pinned: the seed and the file count the exercise uses', () => {
                assert.strictEqual(EXCERPT_SEED, 1220);
                assert.strictEqual(typeof buildTreeExcerpt, 'function');
        });

        test('DETERMINISM: the same root + seed + fileCount yield the byte-identical excerpt (two builds deep-equal)', async () => {
                const root = await buildExcerptFixtureTree();
                const first = await buildTreeExcerpt(root, { fileCount: 5, seed: 4242 });
                const second = await buildTreeExcerpt(root, { fileCount: 5, seed: 4242 });
                assert.deepStrictEqual(second, first);
                assert.strictEqual(first.schema, EXPLORE_EXCERPT_SCHEMA);
                assert.strictEqual(first.ledgerModule, LEDGER_MODULE);
                assert.strictEqual(first.seed, 4242);
                assert.strictEqual(first.fileCount, 5);
        });

        test('the seed drives the selection: two seeds pick different file sets over the same tree', async () => {
                const root = await buildExcerptFixtureTree();
                const left = await buildTreeExcerpt(root, { fileCount: 3, seed: 1 });
                const right = await buildTreeExcerpt(root, { fileCount: 3, seed: 2 });
                const filesOf = (excerpt: TreeExcerpt): string[] => excerpt.files.map(file => file.file);
                assert.notDeepStrictEqual(filesOf(right), filesOf(left));
        });

        test('the excerpt carries import lines only, with the real 1-based line numbers and verbatim text, all under extensions/flauz-*', async () => {
                const root = await buildExcerptFixtureTree();
                const excerpt = await buildTreeExcerpt(root, { fileCount: 4, seed: 99 });
                assert.ok(excerpt.fileCount > 0);
                for (const file of excerpt.files) {
                        assert.ok(file.file.startsWith('extensions/flauz-'), file.file);
                        const text = await fs.readFile(path.join(root, file.file), { encoding: 'utf-8' });
                        const rawLines = text.split('\n');
                        for (const line of file.lines) {
                                assert.strictEqual(line.text, rawLines[line.line - 1]);
                                assert.notStrictEqual(parseImportStatement(line.text), null);
                        }
                }
        });

        test('the consumer guarantee: a selection that would miss every consumer is augmented with the first consumer file (the excerpt lane is never vacuous)', async () => {
                const root = await buildExcerptFixtureTree();
                // fileCount 0 -> an empty seeded selection; the guarantee must land the
                // alphabetically-first consumer file so the excerpt carries a consumer
                const excerpt = await buildTreeExcerpt(root, { fileCount: 0, seed: 5 });
                assert.deepStrictEqual(excerpt.files.map(file => file.file), ['extensions/flauz-beta/src/farConsumer.ts']);
                assert.ok(excerptConsumersOf(excerpt).length >= 1);
        });

        test('the default build over the fixture tree: all files selected, the excerpt consumers equal the tree ground truth', async () => {
                const root = await buildExcerptFixtureTree();
                const excerpt = await buildTreeExcerpt(root);
                const truth = await scanLedgerConsumers(root);
                assert.ok(excerpt.fileCount >= 18);
                assert.deepStrictEqual(excerptConsumersOf(excerpt), [...truth]);
        });
});

suite('P2-FIX-122: the excerpt consumers + the question round-trip', () => {

        test('excerptConsumersOf re-derives exactly the known consumers (the shared resolution rules hold within the excerpt; distractor rows are not consumers)', () => {
                const excerpt = handBuiltExcerpt();
                assert.deepStrictEqual(excerptConsumersOf(excerpt), [...HAND_BUILT_CONSUMERS]);
        });

        test('buildExcerptQuestion embeds the markers + the verbatim block + the ledger module + the answer schema, and does NOT carry the fake lane full-scan trigger phrase', () => {
                const excerpt = handBuiltExcerpt();
                const question = buildExcerptQuestion(excerpt);
                assert.ok(question.includes(EXCERPT_BLOCK_BEGIN));
                assert.ok(question.includes(EXCERPT_BLOCK_END));
                assert.ok(question.includes(excerptBlock(excerpt)));
                assert.ok(question.includes(LEDGER_MODULE));
                assert.ok(question.includes(EXPLORE_ANSWER_SCHEMA));
                assert.ok(question.includes(`import { one, two } from './ledger';`));
                // the fake lane's exploration trigger (fake-provider.mjs keys on this
                // phrase) -- the excerpt question must never trigger the server-side
                // full scan: the excerpt lane is a DIFFERENT question
                assert.ok(!question.toLowerCase().includes('every consumer of the evidence ledger'));
                // the full-tree question (the fake lane's, UNCHANGED) still carries it
                assert.ok(EXPLORE_QUESTION.includes('every consumer of the evidence ledger'));
                assert.ok(EXPLORE_QUESTION.includes('across extensions/flauz-*'));
        });

        test('verifyPromptCarriesExcerpt accepts the built question and flags a gutted prompt (block or markers removed)', () => {
                const excerpt = handBuiltExcerpt();
                const question = buildExcerptQuestion(excerpt);
                assert.deepStrictEqual(verifyPromptCarriesExcerpt(question, excerpt), { ok: true, problems: [] });
                const guttedBlock = question.replace(excerptBlock(excerpt), 'the excerpt went missing');
                assert.ok(!verifyPromptCarriesExcerpt(guttedBlock, excerpt).ok);
                const noMarkers = excerptBlock(excerpt);
                const flagged = verifyPromptCarriesExcerpt(noMarkers, excerpt);
                assert.ok(!flagged.ok);
                assert.ok(flagged.problems.some(problem => problem.includes('no tree-excerpt section')));
                const emptyExcerpt: TreeExcerpt = { ...excerpt, files: [{ file: 'extensions/flauz-workspace/src/empty.ts', lines: [] }] };
                const vacuous = verifyPromptCarriesExcerpt(question, emptyExcerpt);
                assert.ok(!vacuous.ok);
                assert.ok(vacuous.problems.some(problem => problem.includes('vacuous excerpt')));
        });
});

suite('P2-FIX-122: the excerpt-mode verification logic (the same 100% bar, scoped to the excerpt)', () => {

        test('a fully-correct map verifies 100% (sound + complete against the excerpt), and the receipt embeds the excerpt + the pinned schema', () => {
                const excerpt = handBuiltExcerpt();
                const verification = verifyExcerptConsumersMap(excerptAnswerOf(HAND_BUILT_CONSUMERS), excerpt);
                assert.strictEqual(verification.schema, EXPLORE_EXCERPT_VERIFICATION_SCHEMA);
                assert.strictEqual(verification.mode, 'excerpt');
                assert.strictEqual(verification.ledgerModule, LEDGER_MODULE);
                assert.deepStrictEqual(verification.excerpt, excerpt);
                assert.strictEqual(verification.verified, true);
                assert.deepStrictEqual(verification.totals, { claimed: 3, real: 3, verifiedEntries: 3, problemEntries: 0, missedEntries: 0 });
        });

        test('HALLUCINATION DETECTION (the W5 class): a plausible real-tree entry claimed OUTSIDE the excerpt fails soundness (not an excerpt row)', () => {
                const excerpt = handBuiltExcerpt();
                const hallucinated = [
                        ...HAND_BUILT_CONSUMERS,
                        { file: 'extensions/flauz-workspace/src/real-but-not-in-excerpt.ts', line: 7, symbols: ['EvidenceLedger'] },
                ];
                const verification = verifyExcerptConsumersMap(excerptAnswerOf(hallucinated), excerpt);
                assert.strictEqual(verification.verified, false);
                assert.strictEqual(verification.totals.problemEntries, 1);
                const problem = verification.checked.find(entry => !entry.ok)?.problems.join('; ');
                assert.ok(problem?.includes('is not an excerpt row'), problem ?? '');
                assert.ok(problem?.includes('outside the excerpt'), problem ?? '');
        });

        test('a non-ledger excerpt row claimed as a consumer fails (the row is real but imports a different module -- hallucinated consumer)', () => {
                const excerpt = handBuiltExcerpt();
                const doctored = [
                        ...HAND_BUILT_CONSUMERS,
                        { file: 'extensions/flauz-beta/src/d.ts', line: 2, symbols: ['existsSync'] },
                ];
                const verification = verifyExcerptConsumersMap(excerptAnswerOf(doctored), excerpt);
                assert.strictEqual(verification.verified, false);
                const problem = verification.checked.find(entry => !entry.ok)?.problems.join('; ');
                assert.ok(problem?.includes('does not import'), problem ?? '');
                assert.ok(problem?.includes('hallucinated consumer'), problem ?? '');
        });

        test('a wrong line number inside an excerpt file is flagged with the file\'s real excerpt lines', () => {
                const excerpt = handBuiltExcerpt();
                const doctored = HAND_BUILT_CONSUMERS.map(consumer => consumer.file.endsWith('b.ts')
                        ? { file: consumer.file, line: 4, symbols: [...consumer.symbols] }
                        : { file: consumer.file, line: consumer.line, symbols: [...consumer.symbols] });
                const verification = verifyExcerptConsumersMap(excerptAnswerOf(doctored), excerpt);
                assert.strictEqual(verification.verified, false);
                const problem = verification.checked.find(entry => !entry.ok)?.problems.join('; ');
                assert.ok(problem?.includes('the excerpt carries no import line at'), problem ?? '');
                assert.ok(problem?.includes('its import lines: 1'), problem ?? '');
        });

        test('the completeness bar: a missing excerpt consumer fails (missed exactly the dropped one)', () => {
                const excerpt = handBuiltExcerpt();
                const incomplete = HAND_BUILT_CONSUMERS.filter(consumer => !consumer.file.endsWith('c.ts'));
                const verification = verifyExcerptConsumersMap(excerptAnswerOf(incomplete), excerpt);
                assert.strictEqual(verification.verified, false);
                assert.strictEqual(verification.totals.missedEntries, 1);
                assert.strictEqual(verification.missed[0]?.file, 'extensions/flauz-workspace/src/c.ts');
        });

        test('a symbol mismatch is flagged (what it consumes is checked against the excerpt row\'s bindings)', () => {
                const excerpt = handBuiltExcerpt();
                const doctored = HAND_BUILT_CONSUMERS.map(consumer => consumer.file.endsWith('a.ts')
                        ? { file: consumer.file, line: consumer.line, symbols: ['one'] }
                        : { file: consumer.file, line: consumer.line, symbols: [...consumer.symbols] });
                const verification = verifyExcerptConsumersMap(excerptAnswerOf(doctored), excerpt);
                assert.strictEqual(verification.verified, false);
                const problem = verification.checked.find(entry => !entry.ok)?.problems.join('; ');
                assert.ok(problem?.includes('consumes mismatch'), problem ?? '');
        });

        test('a duplicate map entry is flagged', () => {
                const excerpt = handBuiltExcerpt();
                const duplicated = [...HAND_BUILT_CONSUMERS, HAND_BUILT_CONSUMERS[0] ?? { file: '', line: 1, symbols: [] }];
                const verification = verifyExcerptConsumersMap(excerptAnswerOf(duplicated), excerpt);
                assert.strictEqual(verification.verified, false);
                assert.ok(verification.checked.some(entry => entry.problems.some(problem => problem.includes('duplicate map entry'))));
        });

        test('a non-clean path (absolute / dot-dot) is flagged before the row lookup', () => {
                const excerpt = handBuiltExcerpt();
                const dirty = [
                        ...HAND_BUILT_CONSUMERS,
                        { file: '../outside/escape.ts', line: 1, symbols: ['x'] },
                ];
                const verification = verifyExcerptConsumersMap(excerptAnswerOf(dirty), excerpt);
                assert.strictEqual(verification.verified, false);
                assert.ok(verification.checked.some(entry => entry.problems.some(problem => problem.includes('not a clean repo-relative posix path'))));
        });
});

suite('P2-FIX-122: the exercise\'s excerpt-mode wiring (live-provider lane, stubbed seams)', () => {

        /**
         * A minimal harness for the exercise-level wiring test: the SEAMS are
         * stubs (the driver\'s receipts claim the seam levels, not unit tests),
         * the exercise logic + the excerpt machinery + the FrictionLog are the
         * REAL modules. The ask stub mimics the provider facade: the prompt
         * builder runs INSIDE the ask window (after the stand-in routing
         * decision), exactly like makeProviderFacade.ask does.
         */
        async function runExerciseInMode(mode: 'fake-lane' | 'live-provider'): Promise<{ receipt: ExerciseReceipt; root: string; recordsDir: string; askedPrompts: string[] }> {
                const treeRoot = await buildExcerptFixtureTree();
                const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flauz-dogfood-exercise-'));
                const recordsDir = path.join(root, 'records');
                await fs.mkdir(recordsDir, { recursive: true });
                const askedPrompts: string[] = [];
                const friction = new FrictionLog({ path: path.join(recordsDir, 'explore-repo.friction.jsonl'), clock: () => 1_000 });
                let seq = 0;
                const ask = async (input: AskPrompt): Promise<AskOutcome> => {
                        // the ask window: the builder runs AFTER the (stand-in) routing
                        // decision, right before the request ships -- the P2-FIX-119
                        // discipline the real facade pins
                        const prompt = typeof input === 'function' ? await input({ decisionId: 'rd-000001' }) : input;
                        askedPrompts.push(prompt);
                        if (mode === 'fake-lane') {
                                return { kind: 'ok', text: 'n/a', decisionId: 'rd-000001', providerId: 'flauz-dogfood-fake', modelId: 'dogfood-1', durationMs: 5, attempts: 1, wallClockBudgetMs: 15_000, finishReason: 'stop' };
                        }
                        // the "model": answers perfectly FROM THE PROMPT -- the answer is
                        // derived from a FRESH excerpt build (determinism: it must equal the
                        // excerpt the exercise itself embedded), fenced like a live model
                        const excerpt = await buildTreeExcerpt(treeRoot);
                        const consumers = excerptConsumersOf(excerpt);
                        const text = `\`\`\`json\n${JSON.stringify({ schema: EXPLORE_ANSWER_SCHEMA, consumers: consumers.map(consumer => ({ file: consumer.file, line: consumer.line, consumes: [...consumer.symbols] })) })}\n\`\`\``;
                        return { kind: 'ok', text, decisionId: 'rd-000001', providerId: 'flauz-dogfood-live', modelId: 'live-model', durationMs: 12, attempts: 1, wallClockBudgetMs: 15_000, finishReason: 'stop' };
                };
                const harness = {
                        runId: 'test-run',
                        mode,
                        root,
                        repoRoot: treeRoot,
                        recordsDir,
                        clock: () => 1_000,
                        friction,
                        tasks: { recordEvidence: async () => { seq += 1; return { evidenceId: `E-${String(seq).padStart(6, '0')}` }; } },
                        ledger: { append: async () => { seq += 1; return { evidenceId: `E-${String(seq).padStart(6, '0')}`, seq }; } },
                        memory: {},
                        store: {},
                        provider: { ask },
                        exerciseId: 'explore-repo',
                        taskId: 'T-001',
                        graphId: 'G-001',
                        stepId: 'S-01',
                        log: () => undefined,
                } as unknown as DogfoodHarness;
                const receipt = await EXPLORE_EXERCISE.run(harness);
                return { receipt, root, recordsDir, askedPrompts };
        }

        test('live-provider mode: the ask-time builder embeds the excerpt, the perfect answer verifies 100%, the excerpt is banked, the receipt is excerpt-scoped', async () => {
                const { receipt, root, recordsDir, askedPrompts } = await runExerciseInMode('live-provider');
                assert.strictEqual(receipt.verdict, 'PASS');
                // the ask used the EXCERPT question (built inside the ask window)
                assert.strictEqual(askedPrompts.length, 1);
                assert.ok(askedPrompts[0]?.includes(EXCERPT_BLOCK_BEGIN), 'the ask prompt embeds the excerpt markers');
                assert.ok(!askedPrompts[0]?.toLowerCase().includes('every consumer of the evidence ledger'));
                // the checks: the excerpt-embedded check + the SAME three map checks (scoped) + evidence
                const ids = receipt.checks.map(check => check.id);
                assert.deepStrictEqual(ids, ['explore.model-call-ok', 'explore.answer-parses', 'explore.excerpt-embedded', 'explore.map-sound', 'explore.map-complete', 'explore.map-100-percent', 'explore.evidence-minted']);
                assert.ok(receipt.checks.every(check => check.ok), receipt.checks.filter(check => !check.ok).map(check => check.detail).join(' | '));
                assert.ok(receipt.checks.find(check => check.id === 'explore.map-complete')?.detail.includes('excerpt consumers'));
                // the excerpt lane banked THREE artifacts: the answer + the excerpt + the verification
                assert.strictEqual(receipt.evidenceItems.length, 3);
                const excerptArtifact = receipt.evidenceItems.find(item => item.uri.endsWith('explore-excerpt.json'));
                assert.ok(excerptArtifact, 'the excerpt artifact is minted');
                // the excerpt artifact on disk == the deterministic excerpt (a reviewer can check the answer against it by hand)
                const bankedExcerpt = JSON.parse(await fs.readFile(path.join(root, excerptArtifact?.uri ?? ''), { encoding: 'utf-8' })) as TreeExcerpt;
                const expected = await buildTreeExcerpt((await buildExcerptFixtureTree()));
                assert.deepStrictEqual(bankedExcerpt.schema, EXPLORE_EXCERPT_SCHEMA);
                assert.deepStrictEqual(bankedExcerpt, expected);
                // the records receipt: the excerpt-mode schema, embedding the excerpt, all entries ok
                const verification = JSON.parse(await fs.readFile(path.join(recordsDir, 'explore-repo.verification.json'), { encoding: 'utf-8' })) as { schema: string; mode: string; excerpt: TreeExcerpt; verified: boolean; totals: { claimed: number; real: number } };
                assert.strictEqual(verification.schema, EXPLORE_EXCERPT_VERIFICATION_SCHEMA);
                assert.strictEqual(verification.mode, 'excerpt');
                assert.deepStrictEqual(verification.excerpt, expected);
                assert.strictEqual(verification.verified, true);
                assert.strictEqual(verification.totals.claimed, verification.totals.real);
                // the notes describe the excerpt lane (P2-FIX-122), never the fake lane
                assert.ok(receipt.notes.some(note => note.includes('P2-FIX-122')));
                assert.ok(receipt.notes.every(note => !note.includes('the fake lane computed its map live from the tree')));
        });

        test('live-provider mode: a HALLUCINATED answer (the W5 shape: plausible entries outside the excerpt) FAILs the receipt and banks the excerpt anyway', async () => {
                const treeRoot = await buildExcerptFixtureTree();
                const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flauz-dogfood-exercise-'));
                const recordsDir = path.join(root, 'records');
                await fs.mkdir(recordsDir, { recursive: true });
                const friction = new FrictionLog({ path: path.join(recordsDir, 'explore-repo.friction.jsonl'), clock: () => 1_000 });
                let seq = 0;
                const hallucinatedText = JSON.stringify({
                        schema: EXPLORE_ANSWER_SCHEMA,
                        consumers: [
                                { file: 'extensions/flauz-workspace/src/invented.ts', line: 12, consumes: ['EvidenceLedger'] },
                                { file: 'extensions/flauz-agent/src/also-invented.ts', line: 4, consumes: ['ledgerAppend'] },
                        ],
                });
                const ask = async (input: AskPrompt): Promise<AskOutcome> => {
                        const prompt = typeof input === 'function' ? await input({ decisionId: 'rd-000001' }) : input;
                        assert.ok(prompt.includes(EXCERPT_BLOCK_BEGIN));
                        return { kind: 'ok', text: hallucinatedText, decisionId: 'rd-000001', providerId: 'flauz-dogfood-live', modelId: 'live-model', durationMs: 12, attempts: 1, wallClockBudgetMs: 15_000, finishReason: 'stop' };
                };
                const harness = {
                        runId: 'test-run', mode: 'live-provider', root, repoRoot: treeRoot, recordsDir, clock: () => 1_000, friction,
                        tasks: { recordEvidence: async () => { seq += 1; return { evidenceId: `E-${String(seq).padStart(6, '0')}` }; } },
                        ledger: { append: async () => { seq += 1; return { evidenceId: `E-${String(seq).padStart(6, '0')}`, seq }; } },
                        memory: {}, store: {}, provider: { ask },
                        exerciseId: 'explore-repo', taskId: 'T-001', graphId: 'G-001', stepId: 'S-01', log: () => undefined,
                } as unknown as DogfoodHarness;
                const receipt = await EXPLORE_EXERCISE.run(harness);
                assert.strictEqual(receipt.verdict, 'FAIL');
                assert.ok(!receipt.checks.find(check => check.id === 'explore.map-sound')?.ok);
                assert.ok(receipt.checks.find(check => check.id === 'explore.map-100-percent')?.detail.includes('excerpt'));
                // the excerpt is STILL banked (the reviewer checks the failed answer against it)
                assert.strictEqual(receipt.evidenceItems.length, 3);
                const verification = JSON.parse(await fs.readFile(path.join(recordsDir, 'explore-repo.verification.json'), { encoding: 'utf-8' })) as { verified: boolean; totals: { problemEntries: number; missedEntries: number; claimed: number } };
                assert.strictEqual(verification.verified, false);
                assert.strictEqual(verification.totals.problemEntries, 2);
                // honest friction: the miss is logged with the excerpt scope
                const rows = await friction.readAll();
                assert.ok(rows.some(row => row.type === 'friction' && (row as { detail: string }).detail.includes('judged against the excerpt')));
        });

        test('fake-lane mode: the exercise still asks the full-tree question verbatim (the machinery ground truth, UNCHANGED by P2-FIX-122)', async () => {
                const { receipt, askedPrompts } = await runExerciseInMode('fake-lane');
                // the stubbed fake-lane ask returns a non-answer; the machinery paths this
                // pins are the QUESTION and the VERIFICATION LANE: the ask prompt is the
                // full-tree EXPLORE_QUESTION (byte-for-byte), never an excerpt question
                assert.deepStrictEqual(askedPrompts, [EXPLORE_QUESTION]);
                // and the receipt carries no excerpt check (the fake lane is unchanged)
                assert.ok(!receipt.checks.some(check => check.id === 'explore.excerpt-embedded'));
                assert.ok(!receipt.evidenceItems.some(item => item.uri.endsWith('explore-excerpt.json')));
        });
});

// ---------------------------------------------------------------------------
// A-PROD-003-W7: the agent-with-tools dogfood lane (the new suites)
// ---------------------------------------------------------------------------

import { createAgentToolSurface, mintToolReceipt, TOOL_RECEIPT_SCHEMA, type AgentToolSurface, type ToolReceipt } from './agentTools.ts';
import { AGENT_DELEGATION_EXERCISE, bootAgentSession, paddedEvidenceId, PRIMARY_AGENT, WORKER_AGENT, type SessionFacts } from './exercises/agent-delegation.task.ts';
import { TOOLS_EXPLORATION_EXERCISE, TOOLS_LANE_MARKER, TOOL_RESULTS_BEGIN, TOOL_RESULTS_END, TOOLS_DIRECTIVE_SCHEMA, TOOLS_ANSWER_SCHEMA, TOOLS_VERIFICATION_SCHEMA, MAX_TOOL_TURNS, buildToolsAskPrompt, renderToolReceiptBlock, parseToolsDirective, parseToolsAnswer, verifyToolsReceipts, readCommandFile, isReadReceipt, readOnlyCommandsConfirmationPolicy, type ToolsExplorationAnswer } from './exercises/tools-exploration.task.ts';
import { toolsAgentTurn, TOOLS_LANE_SEARCH_COMMAND } from './fake-provider.mjs';
import { SeamClient } from '../../../extensions/flauz-agent/src/seamClient.ts';
import { GOLDEN_COMMAND } from '../../../extensions/flauz-agent/src/orchestrator.ts';
import { seamTaskPort, createOrchTakeoverPort } from '../../../extensions/flauz-agent/src/takeover.ts';
import { OrchestrationStore } from '../../../extensions/flauz-agent/core/orchStore.mjs';
import { delegateStep, ingestResultReport } from '../../../extensions/flauz-agent/core/routing.mjs';
import { TERMINAL_TOOL_ID } from '../../../extensions/flauz-agent/src/tools/terminalTool.ts';

/** The canary shapes the G8 privacy pin scans for (never to appear in any receipt/friction row). */
const CANARY_SHAPES = /ghp_[A-Za-z0-9]{16,}|sk-[A-Za-z0-9]{16,}/;

/**
 * The G8 canary VALUES, assembled at RUNTIME (joined pieces) so no committed
 * source line ever carries a secret-shaped literal -- the repo's own
 * security-gate law (a planted canary must live in fixtures at run time,
 * never in the repository bytes).
 */
const GHP_TOOLS_CANARY = ['ghp', `w7toolscanary${'A'.repeat(24)}`].join('_');
const SK_TOOLS_CANARY = ['sk', `w7toolscanary${'B'.repeat(24)}`].join('-');
const GHP_DELEGATION_CANARY = ['ghp', `w7delegationcanary${'C'.repeat(24)}`].join('_');
const SK_DELEGATION_CANARY = ['sk', `w7delegationcanary${'D'.repeat(24)}`].join('-');
const GHP_DELEGATION_CANARY_2 = ['ghp', `w7delegationcanary${'E'.repeat(24)}`].join('_');

/** Builds the W7 tools fixture tree: the CANONICAL ledger module + known consumers + distractors (+ planted canaries). */
async function buildToolsFixtureTree(options?: { readonly canaries?: boolean }): Promise<{ readonly root: string; readonly groundTruth: readonly GroundTruthConsumer[] }> {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flauz-dogfood-w7tools-'));
        const write = async (relative: string, contents: string): Promise<void> => {
                const target = path.join(root, relative);
                await fs.mkdir(path.dirname(target), { recursive: true });
                await fs.writeFile(target, `${contents}\n`, { encoding: 'utf-8' });
        };
        const canaries = options?.canaries === true;
        await write('extensions/flauz-workspace/src/ledger.ts', 'export interface LedgerRow { seq: number; sha256: string; }\nexport class EvidenceLedger { append() { return null; } }\nexport function ledgerAppend() { return null; }\nexport function verifyLedger() { return true; }\n');
        await write('extensions/flauz-alpha/src/consumer.ts', [
                canaries ? `// a fixture canary comment never to be read or receipted: ${GHP_TOOLS_CANARY}` : '// the W7 tools fixture consumer',
                `import { EvidenceLedger } from '../../flauz-workspace/src/ledger';`,
                'export const use = EvidenceLedger;',
        ].join('\n'));
        await write('extensions/flauz-beta/deep/consumer.ts', [
                `import { ledgerAppend, type LedgerRow } from '../../flauz-workspace/src/ledger.js';`,
                'export const rows: LedgerRow[] = [];',
        ].join('\n'));
        await write('extensions/flauz-gamma/src/reexport.ts', [
                `export { verifyLedger } from '../../flauz-workspace/src/ledger';`,
        ].join('\n'));
        await write('extensions/flauz-delta/src/mentions.ts', '// a comment that merely mentions the ledger -- NOT a consumer\nexport const none = true;\n');
        await write('extensions/flauz-delta/src/other.ts', `import { existsSync } from './other-module';\nexport const x = existsSync;\n`);
        if (canaries) {
                await write('extensions/flauz-epsilon/src/canary-notes.ts', `// fixture-planted canaries: ${SK_TOOLS_CANARY} -- never to reach a receipt
`);
        }
        const groundTruth: GroundTruthConsumer[] = [
                { file: 'extensions/flauz-alpha/src/consumer.ts', line: 2, symbols: ['EvidenceLedger'] },
                { file: 'extensions/flauz-beta/deep/consumer.ts', line: 1, symbols: ['ledgerAppend', 'LedgerRow'] },
                { file: 'extensions/flauz-gamma/src/reexport.ts', line: 1, symbols: ['verifyLedger'] },
        ];
        return { root, groundTruth };
}

/** A fixture receipt over given output (the pure builder, hashed by the real sha256Hex). */
function fixtureReceipt(receiptId: string, command: string, stdout: string, options?: { readonly granted?: boolean; readonly exitCode?: number }): ToolReceipt {
        return mintToolReceipt({
                receiptId,
                command,
                decision: { tool: TERMINAL_TOOL_ID, title: 'Flauz terminal command', message: `Allow Flauz Agent to run \`${command}\` in the integrated terminal?`, command, granted: options?.granted ?? true, at: 1_000 },
                execution: options?.granted === false ? undefined : { command, stdout, stderr: '', exitCode: options?.exitCode ?? 0, durationMs: 5, at: 1_000 },
                refusal: options?.granted === false ? 'the human DENIED the confirmation at the tool approval gate' : null,
                ts: 1_000,
        });
}

suite('W7 agentTools: the real tool surface + the tool-receipt contract', () => {

        test('createAgentToolSurface registers the REAL flauz_terminal tool and REALLY executes through /bin/sh on the cwd', async () => {
                const root = await fs.mkdtemp(path.join(os.tmpdir(), 'w7-surface-'));
                const surface = createAgentToolSurface({ cwd: root });
                try {
                        assert.strictEqual(surface.state.tools.length, 1, 'exactly one tool registered');
                        assert.strictEqual(surface.state.tools[0]?.name, TERMINAL_TOOL_ID, 'the registered tool is flauz_terminal (the product\'s own tool)');
                        const outcome = await surface.invokeTerminal('echo hello-w7-real-execution');
                        assert.strictEqual(outcome.ok, true);
                        assert.strictEqual(outcome.kind, 'executed');
                        assert.strictEqual(outcome.output, 'hello-w7-real-execution');
                        assert.strictEqual(outcome.execution?.exitCode, 0, 'the real child exited 0');
                        assert.strictEqual(outcome.execution?.stdout.trim(), 'hello-w7-real-execution');
                        assert.strictEqual(surface.state.invocations.length, 1, 'the invocation was recorded through the platform gate');
                        assert.strictEqual(surface.state.invocations[0]?.name, TERMINAL_TOOL_ID);
                        assert.strictEqual(surface.state.invocations[0]?.confirmationAsked, true, 'the HumanApproval confirmation was asked (prepareInvocation -> confirmationMessages)');
                } finally {
                        surface.dispose();
                }
        });

        test('the confirmation gate: a DENYING policy refuses the invocation BEFORE execution (the product\'s own refusal semantics)', async () => {
                const root = await fs.mkdtemp(path.join(os.tmpdir(), 'w7-surface-deny-'));
                const surface = createAgentToolSurface({ cwd: root, confirmationPolicy: () => false });
                try {
                        const outcome = await surface.invokeTerminal('echo never-runs');
                        assert.strictEqual(outcome.ok, false);
                        assert.strictEqual(outcome.kind, 'denied');
                        assert.match(outcome.refusal ?? '', /rejected by user/);
                        assert.strictEqual(outcome.execution, undefined, 'nothing executed (the gate refused first)');
                        assert.strictEqual(surface.executions.length, 0, 'no real execution happened');
                        assert.strictEqual(surface.decisions[0]?.granted, false, 'the denial decision is captured');
                        assert.strictEqual(surface.state.invocations.length, 1, 'the refused invocation is still recorded (asked + denied)');
                } finally {
                        surface.dispose();
                }
        });

        test('the approval detail is captured verbatim from the tool\'s REAL prepareInvocation (title + message)', async () => {
                const root = await fs.mkdtemp(path.join(os.tmpdir(), 'w7-surface-approval-'));
                const surface = createAgentToolSurface({ cwd: root });
                try {
                        await surface.invokeTerminal('echo approval-detail');
                        const decision = surface.decisions[0];
                        assert.ok(decision !== undefined);
                        assert.strictEqual(decision.tool, TERMINAL_TOOL_ID);
                        assert.strictEqual(decision.title, 'Flauz terminal command');
                        assert.match(decision.message, /Allow Flauz Agent to run `echo approval-detail`/);
                        assert.strictEqual(decision.granted, true);
                } finally {
                        surface.dispose();
                }
        });

        test('mintToolReceipt: the EXECUTED shape (schema + approval + the hashed/sized stdout + local-real evidence level)', () => {
                const receipt = fixtureReceipt('R-1', "grep -nE -- 'import|export' extensions/flauz-a/src/a.ts", '1:import { x } from \'./ledger\';\n2:export const y = x;');
                assert.strictEqual(receipt.schema, TOOL_RECEIPT_SCHEMA);
                assert.strictEqual(receipt.receiptId, 'R-1');
                assert.strictEqual(receipt.tool, TERMINAL_TOOL_ID);
                assert.deepStrictEqual(receipt.input, { command: "grep -nE -- 'import|export' extensions/flauz-a/src/a.ts" });
                assert.deepStrictEqual(receipt.approval, { asked: true, granted: true, title: 'Flauz terminal command', message: 'Allow Flauz Agent to run `grep -nE -- \'import|export\' extensions/flauz-a/src/a.ts` in the integrated terminal?' });
                assert.strictEqual(receipt.execution?.exitCode, 0);
                assert.strictEqual(receipt.execution?.stdoutBytes, 53);
                assert.strictEqual(receipt.execution?.stdoutSha256, sha256Hex('1:import { x } from \'./ledger\';\n2:export const y = x;'));
                assert.strictEqual(receipt.refusal, null);
                assert.strictEqual(receipt.evidenceLevel, 'local-real');
        });

        test('mintToolReceipt: the DENIED shape (no execution, the refusal account, approval asked but not granted)', () => {
                const receipt = fixtureReceipt('R-2', 'rm -rf /', '', { granted: false });
                assert.strictEqual(receipt.schema, TOOL_RECEIPT_SCHEMA);
                assert.deepStrictEqual(receipt.approval, { asked: true, granted: false, title: 'Flauz terminal command', message: 'Allow Flauz Agent to run `rm -rf /` in the integrated terminal?' });
                assert.strictEqual(receipt.execution, null);
                assert.match(receipt.refusal ?? '', /DENIED/);
                assert.strictEqual(receipt.evidenceLevel, 'local-real');
        });
});

suite('W7 agent-delegation: the golden path + the approval-gate refusal (the REAL session machinery)', () => {

        test('a DENIED tool confirmation fails the task fail-closed: no evidence rows, the fail event carries "rejected by user"', async () => {
                const sessionRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'w7-golden-deny-'));
                const session: SessionFacts = await bootAgentSession(sessionRoot, () => undefined);
                try {
                        session.surface.setConfirmationPolicy(() => false);
                        await session.handler({ prompt: 'golden path with a denied confirmation' });
                        const refused = await session.handler({ command: 'approve', prompt: '' });
                        const task = (await session.seam.listTasks()).tasks[0];
                        assert.strictEqual(task?.status, 'failed');
                        const failEvent = task?.events.find((event: { type: string }) => event.type === 'fail');
                        assert.ok(failEvent !== undefined, 'the fail event landed');
                        assert.match(String((failEvent as { payload?: { error?: unknown } }).payload?.error ?? ''), /rejected by user/);
                        assert.match(refused.markdown.join('\n'), /failed/);
                        const ledgerLines = (await fs.readFile(path.join(sessionRoot, '.flauz', 'evidence', 'ledger.jsonl'), { encoding: 'utf-8' }).catch(() => '')).split('\n').filter(line => line.length > 0);
                        assert.strictEqual(ledgerLines.length, 0, 'NO evidence rows for the refused execution (fail-closed)');
                        assert.strictEqual(session.surface.executions.length, 0, 'nothing really executed');
                } finally {
                        await session.dispose();
                }
        });

        test('a GRANTED confirmation completes the golden path: the trail, the two hash-chained evidence rows, verify-pass, sign-off -> done', async () => {
                const sessionRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'w7-golden-grant-'));
                const session: SessionFacts = await bootAgentSession(sessionRoot, () => undefined);
                try {
                        session.surface.setConfirmationPolicy(() => true);
                        await session.handler({ prompt: 'golden path with the confirmation granted' });
                        await session.handler({ command: 'approve', prompt: '' });
                        await session.handler({ command: 'sign-off', prompt: '' });
                        const task = (await session.seam.listTasks()).tasks[0];
                        assert.strictEqual(task?.status, 'done');
                        const trail = (task?.events ?? []).map((event: { actor: string; type: string }) => `${event.actor}/${event.type}`);
                        assert.strictEqual(trail.join(' | '), 'agent/created | agent/submit-plan | human/approve | agent/report | tool/verify-pass | human/sign-off');
                        const lines = (await fs.readFile(path.join(sessionRoot, '.flauz', 'evidence', 'ledger.jsonl'), { encoding: 'utf-8' })).split('\n').filter(line => line.length > 0);
                        assert.strictEqual(lines.length, 2, 'command-output + changeset');
                        const row1 = JSON.parse(lines[0] ?? '') as { kind: string; taskId: string; prev: unknown };
                        const row2 = JSON.parse(lines[1] ?? '') as { kind: string; prev: unknown };
                        assert.strictEqual(row1.kind, 'command-output');
                        assert.strictEqual(row1.taskId, 'T-001');
                        assert.strictEqual(row1.prev, null);
                        assert.strictEqual(row2.kind, 'changeset');
                        assert.ok(typeof row2.prev === 'string' && row2.prev.length > 0, 'row 2 chains to row 1');
                        // the REAL execution: the golden command really ran in /bin/sh
                        const execution = session.surface.executions.find(entry => entry.command === GOLDEN_COMMAND);
                        assert.ok(execution !== undefined, 'the golden command really executed');
                        assert.strictEqual(execution.exitCode, 0);
                        assert.strictEqual(execution.stdout.trim(), 'flauz-golden-path-ok');
                        const verdict = await session.seam.verifyLedger();
                        assert.strictEqual(verdict.ok, true, 'the ledger verifies through the real seam');
                } finally {
                        await session.dispose();
                }
        });

        test('the policy choreography swaps mid-session: deny the first invocation, grant the second (the refusal then the re-run)', async () => {
                const sessionRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'w7-golden-swap-'));
                const session: SessionFacts = await bootAgentSession(sessionRoot, () => undefined);
                try {
                        session.surface.setConfirmationPolicy(() => false);
                        await session.handler({ prompt: 'first attempt will be denied' });
                        await session.handler({ command: 'approve', prompt: '' });
                        session.surface.setConfirmationPolicy(() => true);
                        await session.handler({ prompt: 'second attempt will be granted' });
                        await session.handler({ command: 'approve', prompt: '' });
                        const tasks = (await session.seam.listTasks()).tasks;
                        assert.strictEqual(tasks[0]?.status, 'failed', 'the denied task failed');
                        assert.strictEqual(tasks[1]?.status, 'awaiting-signoff', 'the granted task verified and awaits sign-off');
                        assert.strictEqual(session.surface.decisions.map(decision => decision.granted).join(','), 'false,true', 'the two gate decisions in order');
                        assert.strictEqual(session.surface.executions.length, 1, 'only the granted invocation executed');
                } finally {
                        await session.dispose();
                }
        });
});

suite('W7 agent-delegation: the delegation edge + the takeover transition (the REAL orchestration seams)', () => {

        test('the delegation edge end to end: route-decided + the typed a2a task-delegation over the REAL service bus + the worker mailbox + the result-report ingestion + the graph completion', async () => {
                const sessionRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'w7-edge-'));
                const seam = await SeamClient.start({ workspaceRoot: sessionRoot, logger: () => undefined });
                try {
                        const store = new OrchestrationStore(sessionRoot, { taskPort: seamTaskPort(seam) });
                        const busPort = { post: async (input: { message: Record<string, unknown> }) => seam.request<{ id: string; seq: number; message: Record<string, unknown> }>('flauz.a2a.post', { message: input.message }) };
                        const submitted = await store.submitGraph({
                                title: 'the delegated step',
                                steps: [{ stepId: 'S-01', title: 'delegated work', instruction: 'do the delegated work' }],
                                actor: 'agent',
                                origin: 'test:w7-edge',
                        });
                        await store.approveGraph({ graphId: submitted.graphId, actor: 'human', origin: 'test:w7-edge' });
                        const delegation = await delegateStep(store, busPort, {
                                graphId: submitted.graphId,
                                stepId: 'S-01',
                                targetAgent: WORKER_AGENT,
                                reason: 'capability-match',
                                details: { requiredCapability: 'terminal' },
                                fromAgent: PRIMARY_AGENT,
                        });
                        const decision = store.journalRows.find(row => row.type === 'route-decided');
                        const receipt = store.journalRows.find(row => row.type === 'delegation-sent');
                        assert.strictEqual(String((receipt as { payload?: { decisionRowId?: unknown } })?.payload?.decisionRowId), String(decision?.rowId));
                        assert.strictEqual(String((receipt as { payload?: { messageId?: unknown } })?.payload?.messageId), delegation.messageId);
                        const a2aLines = (await fs.readFile(path.join(sessionRoot, '.flauz', 'a2a', 'messages.jsonl'), { encoding: 'utf-8' })).split('\n').filter(line => line.length > 0);
                        assert.strictEqual(a2aLines.length, 1);
                        const message = JSON.parse(a2aLines[0] ?? '') as { kind: string; from: string; to: string; id: string; payload: { taskId: string; taskDescription: string; prompt: string } };
                        assert.strictEqual(message.kind, 'task-delegation');
                        assert.strictEqual(message.from, PRIMARY_AGENT);
                        assert.strictEqual(message.to, WORKER_AGENT);
                        assert.strictEqual(message.id, delegation.messageId);
                        assert.strictEqual(message.payload.taskId, submitted.taskId);
                        const mail = await seam.request<{ messages: Array<Record<string, unknown>> }>('flauz.a2a.collect', { agentId: WORKER_AGENT, consume: true });
                        assert.strictEqual(mail.messages.length, 1);
                        const evidence = await seam.appendEvidence(submitted.taskId ?? '', { kind: 'note', uri: 'flauz-test://w7', sha256: sha256Hex('w7') });
                        const report = await busPort.post({
                                message: {
                                        kind: 'result-report',
                                        from: WORKER_AGENT,
                                        to: PRIMARY_AGENT,
                                        payload: { taskId: submitted.taskId, outcome: 'ok', evidenceIds: [paddedEvidenceId(evidence.seq)], summary: 'the delegated work completed' },
                                },
                        });
                        const ingestion = await ingestResultReport(store, { graphId: submitted.graphId, stepId: 'S-01', messageId: report.id, outcome: 'ok', summary: 'the delegated work completed', evidenceIds: [paddedEvidenceId(evidence.seq)], fromAgent: WORKER_AGENT });
                        assert.ok(ingestion.receiptRowId.length > 0);
                        await store.completeGraph({ graphId: submitted.graphId, actor: 'agent', origin: 'test:w7-edge' });
                        const state = store.getGraphState(submitted.graphId) as { graphStatus: string; steps: Record<string, { status: string; runnerId: string | null }> };
                        assert.strictEqual(state.graphStatus, 'completed');
                        assert.strictEqual(state.steps['S-01']?.status, 'succeeded');
                        assert.strictEqual(state.steps['S-01']?.runnerId, WORKER_AGENT);
                        const received = store.journalRows.find(row => row.type === 'result-received');
                        assert.deepStrictEqual((received as { payload?: { evidenceIds?: unknown } })?.payload?.evidenceIds, [paddedEvidenceId(evidence.seq)]);
                } finally {
                        await seam.dispose();
                }
        });

        test('the takeover probe reports the stuck gated step (the view row\'s data contract) and nothing after the takeover', async () => {
                const sessionRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'w7-probe-'));
                const seam = await SeamClient.start({ workspaceRoot: sessionRoot, logger: () => undefined });
                try {
                        const taskPort = seamTaskPort(seam);
                        const store = new OrchestrationStore(sessionRoot, { taskPort });
                        const submitted = await store.submitGraph({
                                title: 'the gated decision',
                                steps: [{ stepId: 'S-01', title: 'stuck work', instruction: 'needs the human', gate: 'human-approval' }],
                                actor: 'agent',
                                origin: 'test:w7-probe',
                        });
                        await store.approveGraph({ graphId: submitted.graphId, actor: 'human', origin: 'test:w7-probe' });
                        await store.approvalRequest({ graphId: submitted.graphId, stepId: 'S-01', reason: 'the gated decision', actor: 'agent', origin: 'test:w7-probe' });
                        const port = createOrchTakeoverPort(sessionRoot, taskPort, () => undefined);
                        const before = await port.stuckStepOf(submitted.taskId ?? '');
                        assert.ok(before !== undefined, 'the probe sees the stuck step');
                        assert.strictEqual(before.state, 'stuck');
                        assert.strictEqual(before.stepId, 'S-01');
                        const result = await port.takeOverStep(submitted.taskId ?? '', 'the human completed it personally');
                        assert.strictEqual(result.outcome, 'taken-over');
                        const after = await port.stuckStepOf(submitted.taskId ?? '');
                        assert.strictEqual(after, undefined, 'no human-held step remains after the completion');
                } finally {
                        await seam.dispose();
                }
        });

        test('the takeover transition: request -> accept -> complete, every journal row actor human, the step NEVER started, the chain verifies, the LEG 9 evidence lands', async () => {
                const sessionRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'w7-takeover-'));
                const seam = await SeamClient.start({ workspaceRoot: sessionRoot, logger: () => undefined });
                try {
                        const taskPort = seamTaskPort(seam);
                        const store = new OrchestrationStore(sessionRoot, { taskPort });
                        const submitted = await store.submitGraph({
                                title: 'the gated release decision',
                                steps: [{ stepId: 'S-01', title: 'the final decision', instruction: 'the gated decision', gate: 'human-approval' }],
                                actor: 'agent',
                                origin: 'test:w7-takeover',
                        });
                        await store.approveGraph({ graphId: submitted.graphId, actor: 'human', origin: 'test:w7-takeover' });
                        await store.approvalRequest({ graphId: submitted.graphId, stepId: 'S-01', reason: 'the gated release decision', actor: 'agent', origin: 'test:w7-takeover' });
                        const port = createOrchTakeoverPort(sessionRoot, taskPort, () => undefined);
                        const note = 'the human completed the gated release decision personally (the W7 takeover test)';
                        const result = await port.takeOverStep(submitted.taskId ?? '', note);
                        assert.strictEqual(result.outcome, 'taken-over');
                        assert.strictEqual(result.receipt.rows.map(row => row.type).join(','), 'takeover-requested,takeover-accepted,takeover-completed');
                        const fresh = new OrchestrationStore(sessionRoot);
                        const takeoverRows = fresh.journalRows.filter(row => row.type.startsWith('takeover-'));
                        assert.strictEqual(takeoverRows.map(row => row.type).join(','), 'takeover-requested,takeover-accepted,takeover-completed');
                        assert.ok(takeoverRows.every(row => row.actor === 'human'), 'every takeover row carries the human attribution');
                        assert.ok(!fresh.journalRows.some(row => row.type === 'step-started' && row.graphId === submitted.graphId), 'the gated step NEVER started (no agent execution)');
                        const state = fresh.stateOf(submitted.graphId) as unknown as { steps: Record<string, { status: string; takeover?: { state: string } }> };
                        assert.strictEqual(state.steps['S-01']?.status, 'succeeded');
                        assert.strictEqual(state.steps['S-01']?.takeover?.state, 'completed');
                        assert.strictEqual(fresh.verifyJournal().ok, true, 'the journal chain verifies');
                        const ledgerLines = (await fs.readFile(path.join(sessionRoot, '.flauz', 'evidence', 'ledger.jsonl'), { encoding: 'utf-8' })).split('\n').filter(line => line.length > 0);
                        const completion = ledgerLines.map(line => JSON.parse(line) as { uri?: string; sha256?: string }).find(row => row.uri === `flauz-orch-takeover://${submitted.graphId}/S-01`);
                        assert.ok(completion !== undefined, 'the takeover evidence row landed');
                        assert.strictEqual(completion.sha256, sha256Hex(note));
                } finally {
                        await seam.dispose();
                }
        });
});

suite('W7 agent-delegation: the exercise wiring (the full lane, stubbed driver seams)', () => {

        /** The stubbed driver-level harness (the W6 wiring-test pattern: the SEAMS are stubs, the session machinery is REAL). */
        async function stubHarness(recordsDir: string): Promise<DogfoodHarness> {
                const root = await fs.mkdtemp(path.join(os.tmpdir(), 'w7-delegation-exercise-'));
                await fs.mkdir(recordsDir, { recursive: true });
                const friction = new FrictionLog({ path: path.join(recordsDir, 'agent-delegation.friction.jsonl'), clock: () => 1_000 });
                let seq = 0;
                return {
                        runId: 'test-run', mode: 'fake-lane', root, repoRoot: REPO_ROOT, recordsDir, clock: () => 1_000, friction,
                        tasks: { recordEvidence: async () => { seq += 1; return { evidenceId: `E-${String(seq).padStart(6, '0')}` }; } },
                        ledger: { append: async () => { seq += 1; return { evidenceId: `E-${String(seq).padStart(6, '0')}`, seq }; } },
                        memory: {}, store: {}, provider: { ask: async () => { throw new Error('the delegation exercise asks no provider turn'); } },
                        exerciseId: 'agent-delegation', taskId: 'T-001', graphId: 'G-001', stepId: 'S-01', log: () => undefined,
                } as unknown as DogfoodHarness;
        }

        test('the full agent-delegation run PASSes with the pinned checks + the 10 human-gate friction rows (2 with recovery accounts)', async () => {
                const recordsDir = path.join(os.tmpdir(), `w7-delegation-records-${String(Date.now())}`);
                const harness = await stubHarness(recordsDir);
                const receipt = await AGENT_DELEGATION_EXERCISE.run(harness);
                assert.strictEqual(receipt.verdict, 'PASS', receipt.checks.filter(check => !check.ok).map(check => `${check.id}: ${check.detail}`).join(' | '));
                assert.deepStrictEqual(receipt.checks.map(check => check.id), [
                        'delegation.session-booted',
                        'delegation.golden-refusal-fail-closed',
                        'delegation.golden-path-completed',
                        'delegation.golden-tool-real',
                        'delegation.edge-routed',
                        'delegation.delegated-work-real',
                        'delegation.result-ingested',
                        'delegation.takeover-transition',
                        'delegation.shared-state-consistent',
                        'delegation.evidence-minted',
                        'delegation.human-gates-logged',
                ]);
                const rows = await (harness.friction as FrictionLog).readAll();
                const interventions = rows.filter(row => row.type === 'friction');
                assert.strictEqual(interventions.length, 10, 'the 10 human interventions (2 plan approvals, the denial, the grant, the sign-off, 2 graph approvals, the step approval, the worker confirmation, the takeover)');
                assert.ok(interventions.every(row => row.kind === 'manual-intervention'));
                assert.strictEqual(interventions.filter(row => (row as { recovery: string }).recovery.length > 0).length, 2, 'the denial\'s re-run + the takeover\'s completion carry recovery accounts');
                assert.strictEqual(receipt.frictionRows.friction, 10);
                assert.strictEqual(receipt.frictionRows.recovery, 2);
                const report = JSON.parse(await fs.readFile(path.join(recordsDir, 'agent-delegation.report.json'), { encoding: 'utf-8' })) as {
                        schema: string;
                        toolReceipts: Array<{ receiptId: string; approval: { granted: boolean }; execution: unknown }>;
                        delegatedWork?: { output?: string; exitCode?: number };
                };
                assert.strictEqual(report.schema, 'flauz.dogfood-delegation-report/v1');
                assert.deepStrictEqual(report.toolReceipts.map(entry => entry.receiptId), ['R-1', 'R-2', 'R-3']);
                assert.strictEqual(report.toolReceipts[0]?.approval.granted, false, 'R-1 is the DENIED gate');
                assert.strictEqual(report.toolReceipts[0]?.execution, null);
                assert.ok(report.toolReceipts[1]?.execution !== null && report.toolReceipts[2]?.execution !== null, 'R-2 + R-3 really executed');
                assert.ok(String(report.delegatedWork?.output ?? '').includes('w7 delegated module test: PASS'));
                assert.strictEqual(report.delegatedWork?.exitCode, 0);
        });

        test('G8 privacy canary: fixture-planted ghp_/sk_-shaped canaries NEVER appear in any receipt or friction row of the delegation lane', async () => {
                const recordsDir = path.join(os.tmpdir(), `w7-delegation-canary-${String(Date.now())}`);
                const harness = await stubHarness(recordsDir);
                await fs.mkdir(path.join(harness.root, 'w7-agent-delegation-session'), { recursive: true });
                await fs.writeFile(path.join(harness.root, 'secrets-canary.txt'), `${GHP_DELEGATION_CANARY}
${SK_DELEGATION_CANARY}
`, { encoding: 'utf-8' });
                await fs.writeFile(path.join(harness.root, 'w7-agent-delegation-session', 'secrets-canary.txt'), `${GHP_DELEGATION_CANARY_2}
`, { encoding: 'utf-8' });
                const receipt = await AGENT_DELEGATION_EXERCISE.run(harness);
                assert.strictEqual(receipt.verdict, 'PASS', 'the canary planting changed nothing');
                assert.doesNotMatch(JSON.stringify(receipt), CANARY_SHAPES, 'the exercise receipt carries no canary');
                const frictionText = await fs.readFile(path.join(recordsDir, 'agent-delegation.friction.jsonl'), { encoding: 'utf-8' });
                assert.doesNotMatch(frictionText, CANARY_SHAPES, 'no friction row carries a canary');
                const reportText = await fs.readFile(path.join(recordsDir, 'agent-delegation.report.json'), { encoding: 'utf-8' });
                assert.doesNotMatch(reportText, CANARY_SHAPES, 'the session report carries no canary');
        });
});

suite('W7 tools-exploration: the protocol + the receipt-contract verification (pure)', () => {

        test('parseToolsDirective: the valid raw directive parses; malformed JSON / wrong schema / empty calls / bad call shapes fail closed', () => {
                const valid = JSON.stringify({ schema: TOOLS_DIRECTIVE_SCHEMA, calls: [{ tool: 'flauz_terminal', input: { command: 'grep -n x' } }] });
                const parsed = parseToolsDirective(valid);
                assert.ok(parsed.ok);
                assert.strictEqual(parsed.directive.calls.length, 1);
                assert.strictEqual(parsed.directive.calls[0]?.tool, 'flauz_terminal');
                assert.strictEqual(parsed.directive.calls[0]?.input.command, 'grep -n x');
                assert.ok(!parseToolsDirective('not json').ok);
                assert.ok(!parseToolsDirective(JSON.stringify({ schema: 'wrong/v1', calls: [] })).ok);
                assert.ok(!parseToolsDirective(JSON.stringify({ schema: TOOLS_DIRECTIVE_SCHEMA, calls: [] })).ok);
                assert.ok(!parseToolsDirective(JSON.stringify({ schema: TOOLS_DIRECTIVE_SCHEMA, calls: [{ tool: '', input: { command: 'x' } }] })).ok);
                assert.ok(!parseToolsDirective(JSON.stringify({ schema: TOOLS_DIRECTIVE_SCHEMA, calls: [{ tool: 'flauz_terminal', input: { command: '' } }] })).ok);
                assert.ok(!parseToolsDirective(JSON.stringify({ schema: TOOLS_DIRECTIVE_SCHEMA, calls: [{ tool: 'flauz_terminal' }] })).ok);
        });

        test('parseToolsDirective: a FENCED directive parses in the tolerant (live) mode and fails in the raw default', () => {
                const fenced = `\`\`\`json\n${JSON.stringify({ schema: TOOLS_DIRECTIVE_SCHEMA, calls: [{ tool: 'flauz_terminal', input: { command: 'ls' } }] })}\n\`\`\``;
                assert.ok(parseToolsDirective(fenced, { fenceTolerant: true }).ok);
                assert.ok(!parseToolsDirective(fenced).ok, 'the raw machine-lane default stays strict');
        });

        test('parseToolsAnswer: the valid shape parses (consumers + receipts); wrong schema / missing / mistyped fields fail closed', () => {
                const valid = JSON.stringify({
                        schema: TOOLS_ANSWER_SCHEMA,
                        question: 'q',
                        method: 'm',
                        receipts: ['R-1', 'R-2'],
                        consumers: [{ file: 'extensions/flauz-a/src/a.ts', line: 3, consumes: ['x', 'y'] }],
                });
                const parsed = parseToolsAnswer(valid);
                assert.ok(parsed.ok);
                assert.deepStrictEqual(parsed.answer.receipts, ['R-1', 'R-2']);
                assert.deepStrictEqual(parsed.answer.consumers[0], { file: 'extensions/flauz-a/src/a.ts', line: 3, consumes: ['x', 'y'] });
                assert.ok(!parseToolsAnswer('nope').ok);
                assert.ok(!parseToolsAnswer(JSON.stringify({ schema: 'flauz.dogfood-explore-answer/v1', consumers: [], receipts: [], question: 'q', method: 'm' })).ok, 'the tools answer has its own schema');
                assert.ok(!parseToolsAnswer(JSON.stringify({ schema: TOOLS_ANSWER_SCHEMA, question: '', method: 'm', receipts: [], consumers: [] })).ok);
                assert.ok(!parseToolsAnswer(JSON.stringify({ schema: TOOLS_ANSWER_SCHEMA, question: 'q', method: 'm', receipts: 'R-1', consumers: [] })).ok);
                assert.ok(!parseToolsAnswer(JSON.stringify({ schema: TOOLS_ANSWER_SCHEMA, question: 'q', method: 'm', receipts: [], consumers: [{ file: 'a.ts', line: 0, consumes: [] }] })).ok);
                assert.ok(!parseToolsAnswer(JSON.stringify({ schema: TOOLS_ANSWER_SCHEMA, question: 'q', method: 'm', receipts: [], consumers: [{ file: 'a.ts', line: 1, consumes: [1] }] })).ok);
        });

        test('parseToolsAnswer: a FENCED answer parses in the tolerant (live) mode', () => {
                const fenced = `\`\`\`json\n${JSON.stringify({ schema: TOOLS_ANSWER_SCHEMA, question: 'q', method: 'm', receipts: [], consumers: [] })}\n\`\`\`\nSuccess!`;
                assert.ok(parseToolsAnswer(fenced, { fenceTolerant: true }).ok);
        });

        test('readCommandFile extracts the targeted file (the last token); isReadReceipt recognizes only approved exit-0 numbered greps', () => {
                assert.strictEqual(readCommandFile("grep -nE -- 'import|export' extensions/flauz-a/src/a.ts"), 'extensions/flauz-a/src/a.ts');
                assert.strictEqual(readCommandFile('grep -rlE -- x extensions/flauz-*'), 'extensions/flauz-*');
                const read = fixtureReceipt('R-1', "grep -nE -- 'import|export' extensions/flauz-a/src/a.ts", '1:x');
                const search = fixtureReceipt('R-2', 'grep -rlE -- x extensions/flauz-*', 'a.ts');
                const denied = fixtureReceipt('R-3', "grep -nE -- 'import|export' b.ts", '', { granted: false });
                const failed = fixtureReceipt('R-4', "grep -nE -- 'import|export' c.ts", '', { exitCode: 1 });
                assert.strictEqual(isReadReceipt(read), true);
                assert.strictEqual(isReadReceipt(search), false, 'the search receipt is not a read');
                assert.strictEqual(isReadReceipt(denied), false, 'a denied invocation is not a read');
                assert.strictEqual(isReadReceipt(failed), false, 'a non-zero exit is not a successful read');
        });

        test('verifyToolsReceipts: a covered answer verifies ok (every claimed file:line streamed by a read receipt)', () => {
                const receipts = [
                        fixtureReceipt('R-1', 'grep -rlE -- x extensions/flauz-*', 'extensions/flauz-a/src/a.ts\nextensions/flauz-a/src/b.ts'),
                        fixtureReceipt('R-2', "grep -nE -- 'import|export' extensions/flauz-a/src/a.ts", "1:import { x } from './ledger';\n5:export const y = x;"),
                        fixtureReceipt('R-3', "grep -nE -- 'import|export' extensions/flauz-a/src/b.ts", "2:import { z } from '../ledger.js';"),
                ];
                const answer: ToolsExplorationAnswer = {
                        schema: TOOLS_ANSWER_SCHEMA, question: 'q', method: 'm', receipts: ['R-1', 'R-2', 'R-3'],
                        consumers: [
                                { file: 'extensions/flauz-a/src/a.ts', line: 1, consumes: ['x'] },
                                { file: 'extensions/flauz-a/src/b.ts', line: 2, consumes: ['z'] },
                        ],
                };
                const verification = verifyToolsReceipts(answer, receipts);
                assert.strictEqual(verification.ok, true, verification.problems.join('; '));
                assert.strictEqual(verification.totals.coveredEntries, 2);
                assert.deepStrictEqual(verification.coverage.map(row => row.coveredBy), ['R-2', 'R-3']);
        });

        test('verifyToolsReceipts: an UNCOVERED claimed entry (the hallucination shape) fails with the coverage problem; line-prefix collisions do NOT count', () => {
                const receipts = [fixtureReceipt('R-1', "grep -nE -- 'import|export' extensions/flauz-a/src/a.ts", "12:import { x } from './ledger';")];
                const answer: ToolsExplorationAnswer = {
                        schema: TOOLS_ANSWER_SCHEMA, question: 'q', method: 'm', receipts: ['R-1'],
                        consumers: [
                                { file: 'extensions/flauz-a/src/a.ts', line: 12, consumes: ['x'] },
                                { file: 'extensions/flauz-a/src/a.ts', line: 1, consumes: ['x'] },
                                { file: 'extensions/flauz-a/src/invented.ts', line: 3, consumes: ['x'] },
                        ],
                };
                const verification = verifyToolsReceipts(answer, receipts);
                assert.strictEqual(verification.ok, false);
                assert.strictEqual(verification.totals.uncoveredEntries, 2);
                const problems = verification.problems.join('; ');
                assert.ok(problems.includes('not covered by any read receipt'), problems);
                assert.ok(problems.includes('extensions/flauz-a/src/a.ts:1'), 'the line 1 claim is uncovered (12: does not cover 1:)');
                assert.ok(problems.includes('extensions/flauz-a/src/invented.ts:3'), 'the invented file is uncovered');
        });

        test('verifyToolsReceipts: a cited receipt that was never minted, was denied, or failed its execution fails the contract', () => {
                const denied = fixtureReceipt('R-1', "grep -nE -- 'import|export' a.ts", '', { granted: false });
                const failed = fixtureReceipt('R-2', "grep -nE -- 'import|export' a.ts", '', { exitCode: 2 });
                const answer: ToolsExplorationAnswer = { schema: TOOLS_ANSWER_SCHEMA, question: 'q', method: 'm', receipts: ['R-1', 'R-2', 'R-9'], consumers: [] };
                const verification = verifyToolsReceipts(answer, [denied, failed]);
                assert.strictEqual(verification.ok, false);
                const problems = verification.problems.join('; ');
                assert.ok(problems.includes('R-9 which this run never minted'), problems);
                assert.ok(problems.includes('R-1 which did not pass the approval gate'), problems);
                assert.ok(problems.includes('R-2 whose real execution did not succeed'), problems);
        });

        test('buildToolsAskPrompt embeds the lane marker + the question + the protocol schemas + the receipts verbatim (and the empty first-turn state)', () => {
                const empty = buildToolsAskPrompt([]);
                assert.ok(empty.includes(TOOLS_LANE_MARKER));
                assert.ok(empty.includes(TOOL_RESULTS_BEGIN) && empty.includes(TOOL_RESULTS_END));
                assert.ok(empty.includes('(no tool invocations yet'));
                assert.ok(empty.includes(TOOLS_DIRECTIVE_SCHEMA) && empty.includes(TOOLS_ANSWER_SCHEMA));
                const receipt = fixtureReceipt('R-1', 'echo hi', 'hi');
                const prompt = buildToolsAskPrompt([receipt]);
                assert.ok(prompt.includes(renderToolReceiptBlock(receipt)), 'the receipt block rides the prompt verbatim');
                assert.ok(prompt.includes('[receipt R-1 | tool flauz_terminal | approved | command: echo hi | exit 0]'));
                assert.ok(prompt.includes('hi'));
        });
});

suite('W7 tools-exploration: the fake lane\'s scripted agent (the tool-carrying brain)', () => {

        test('turn 1 (no receipts): the search directive (the exact sound-superset command, tool flauz_terminal)', () => {
                const response = JSON.parse(toolsAgentTurn(buildToolsAskPrompt([]))) as { schema: string; calls: Array<{ tool: string; input: { command: string } }> };
                assert.strictEqual(response.schema, TOOLS_DIRECTIVE_SCHEMA);
                assert.strictEqual(response.calls.length, 1);
                assert.strictEqual(response.calls[0]?.tool, TERMINAL_TOOL_ID);
                assert.strictEqual(response.calls[0]?.input.command, TOOLS_LANE_SEARCH_COMMAND);
        });

        test('with the search receipt: the READ directives for every source-extension candidate (non-source candidates skipped)', () => {
                const receipts = [
                        fixtureReceipt('R-1', TOOLS_LANE_SEARCH_COMMAND, 'extensions/flauz-alpha/src/consumer.ts\nextensions/flauz-alpha/src/README.md\nextensions/flauz-beta/deep/consumer.ts'),
                ];
                const response = JSON.parse(toolsAgentTurn(buildToolsAskPrompt(receipts))) as { schema: string; calls: Array<{ input: { command: string } }> };
                assert.strictEqual(response.schema, TOOLS_DIRECTIVE_SCHEMA);
                assert.deepStrictEqual(response.calls.map(call => call.input.command), [
                        "grep -nE -- 'import|export' extensions/flauz-alpha/src/consumer.ts",
                        "grep -nE -- 'import|export' extensions/flauz-beta/deep/consumer.ts",
                ]);
        });

        test('with search + reads: the ANSWER computed from the read lines ONLY (real consumers resolved, other-module imports excluded, receipts cited)', () => {
                const receipts = [
                        fixtureReceipt('R-1', TOOLS_LANE_SEARCH_COMMAND, 'extensions/flauz-alpha/src/consumer.ts'),
                        fixtureReceipt('R-2', "grep -nE -- 'import|export' extensions/flauz-alpha/src/consumer.ts", [
                                '1:// a comment mentioning import and ledger -- not a statement',
                                "2:import { EvidenceLedger } from '../../flauz-workspace/src/ledger';",
                                "3:import { existsSync } from 'node:fs';",
                                '4:export const use = EvidenceLedger;',
                        ].join('\n')),
                ];
                const response = JSON.parse(toolsAgentTurn(buildToolsAskPrompt(receipts))) as { schema: string; consumers: Array<{ file: string; line: number; consumes: string[] }>; receipts: string[]; question: string; method: string };
                assert.strictEqual(response.schema, TOOLS_ANSWER_SCHEMA);
                assert.deepStrictEqual(response.consumers, [{ file: 'extensions/flauz-alpha/src/consumer.ts', line: 2, consumes: ['EvidenceLedger'] }]);
                assert.deepStrictEqual(response.receipts, ['R-1', 'R-2']);
                assert.ok(response.method.includes('agent-with-tools'));
                assert.ok(response.method.includes('never a server-side scan'));
        });

        test('a DENIED search receipt re-requests the search (the fail-closed loop state -- the agent cannot proceed without its tools)', () => {
                const receipts = [fixtureReceipt('R-1', TOOLS_LANE_SEARCH_COMMAND, '', { granted: false })];
                const response = JSON.parse(toolsAgentTurn(buildToolsAskPrompt(receipts))) as { schema: string; calls: Array<{ input: { command: string } }> };
                assert.strictEqual(response.schema, TOOLS_DIRECTIVE_SCHEMA);
                assert.strictEqual(response.calls[0]?.input.command, TOOLS_LANE_SEARCH_COMMAND);
        });
});

suite('W7 tools-exploration: the provider branch over the REAL wire', () => {

        test('the fake provider answers the tools-lane ask with the directive JSON over the real SSE wire (the W1 provider-lane fidelity)', async () => {
                const { startFakeProvider } = await import('./fake-provider.mjs');
                const fixture = await buildToolsFixtureTree();
                const provider = await startFakeProvider({ repoRoot: fixture.root, workspaceRoot: fixture.root });
                try {
                        const body = JSON.stringify({ model: 'dogfood-1', messages: [{ role: 'user', content: buildToolsAskPrompt([]) }] });
                        const text = await new Promise<string>((resolve, reject) => {
                                const request = http.request({ host: '127.0.0.1', port: provider.port, path: '/v1/chat/completions', method: 'POST', headers: { 'content-type': 'application/json' } }, response => {
                                        let raw = '';
                                        response.on('data', chunk => {
                                                raw += chunk.toString('utf-8');
                                        });
                                        response.on('end', () => resolve(raw));
                                });
                                request.on('error', reject);
                                request.end(body);
                        });
                        const completion = text.split('\n').filter(line => line.startsWith('data: ') && !line.includes('[DONE]')).map(line => JSON.parse(line.slice('data: '.length)) as { choices: Array<{ delta: { content?: string } }> }).map(event => event.choices[0]?.delta.content ?? '').join('');
                        const directive = JSON.parse(completion) as { schema: string; calls: Array<{ tool: string; input: { command: string } }> };
                        assert.strictEqual(directive.schema, TOOLS_DIRECTIVE_SCHEMA);
                        assert.strictEqual(directive.calls[0]?.tool, TERMINAL_TOOL_ID);
                        assert.strictEqual(directive.calls[0]?.input.command, TOOLS_LANE_SEARCH_COMMAND);
                        assert.strictEqual(provider.toolsComputations, 1, 'the census counted the tools-lane turn');
                } finally {
                        provider.close();
                }
        });
});

suite('W7 tools-exploration: the exercise wiring (the full lane)', () => {

        /** The stubbed driver-level harness with a controllable ask (the fake-policy brain or a stubbed one). */
        async function stubHarness(repoRoot: string, recordsDir: string, ask: (prompt: string) => Promise<string>): Promise<DogfoodHarness> {
                const root = await fs.mkdtemp(path.join(os.tmpdir(), 'w7-tools-exercise-'));
                await fs.mkdir(recordsDir, { recursive: true });
                const friction = new FrictionLog({ path: path.join(recordsDir, 'tools-exploration.friction.jsonl'), clock: () => 1_000 });
                let seq = 0;
                return {
                        runId: 'test-run', mode: 'fake-lane', root, repoRoot, recordsDir, clock: () => 1_000, friction,
                        tasks: { recordEvidence: async () => { seq += 1; return { evidenceId: `E-${String(seq).padStart(6, '0')}` }; } },
                        ledger: { append: async () => { seq += 1; return { evidenceId: `E-${String(seq).padStart(6, '0')}`, seq }; } },
                        memory: {}, store: {},
                        provider: { ask: async (input: AskPrompt): Promise<AskOutcome> => {
                                const prompt = typeof input === 'function' ? await input({ decisionId: 'rd-000001' }) : input;
                                const text = await ask(prompt);
                                return { kind: 'ok', text, decisionId: 'rd-000001', providerId: 'flauz-dogfood-fake', modelId: 'dogfood-1', durationMs: 5, attempts: 1, wallClockBudgetMs: 15_000, finishReason: 'stop' };
                        } },
                        exerciseId: 'tools-exploration', taskId: 'T-001', graphId: 'G-001', stepId: 'S-01', log: () => undefined,
                } as unknown as DogfoodHarness;
        }

        test('the happy path: the REAL tool surface over the fixture tree + the fake-policy brain -> PASS, receipts cited, the map 100% verified against the driver\'s own scan', async () => {
                const fixture = await buildToolsFixtureTree();
                const recordsDir = path.join(os.tmpdir(), `w7-tools-records-${String(Date.now())}`);
                const harness = await stubHarness(fixture.root, recordsDir, async prompt => toolsAgentTurn(prompt));
                const receipt = await TOOLS_EXPLORATION_EXERCISE.run(harness);
                assert.strictEqual(receipt.verdict, 'PASS', receipt.checks.filter(check => !check.ok).map(check => `${check.id}: ${check.detail}`).join(' | '));
                assert.deepStrictEqual(receipt.checks.map(check => check.id), [
                        'tools.model-calls-ok', 'tools.answer-parses', 'tools.tool-receipts-real', 'tools.answer-cites-reads',
                        'tools.map-sound', 'tools.map-complete', 'tools.map-100-percent', 'tools.evidence-minted',
                ]);
                const verification = JSON.parse(await fs.readFile(path.join(recordsDir, 'tools-exploration.verification.json'), { encoding: 'utf-8' })) as {
                        schema: string; verified: boolean;
                        turns: Array<{ kind: string }>;
                        receiptVerification: { totals: { receipts: number; readReceipts: number; coveredEntries: number; uncoveredEntries: number } };
                        mapVerification: { totals: { claimed: number; real: number; verifiedEntries: number; problemEntries: number; missedEntries: number } };
                };
                assert.strictEqual(verification.schema, TOOLS_VERIFICATION_SCHEMA);
                assert.strictEqual(verification.verified, true);
                assert.deepStrictEqual(verification.turns.map(turn => turn.kind), ['directive', 'directive', 'answer'], 'search -> reads -> answer');
                assert.strictEqual(verification.receiptVerification.totals.receipts, 4, 'the search + the 3 candidate reads');
                assert.strictEqual(verification.receiptVerification.totals.readReceipts, 3);
                assert.strictEqual(verification.receiptVerification.totals.coveredEntries, 3);
                assert.strictEqual(verification.receiptVerification.totals.uncoveredEntries, 0);
                assert.deepStrictEqual(verification.mapVerification.totals, { claimed: 3, real: 3, verifiedEntries: 3, problemEntries: 0, missedEntries: 0 }, 'the fixture ground truth verified 100%');
                assert.strictEqual(receipt.evidenceItems.length, 2 + verification.receiptVerification.totals.receipts, 'every receipt + the answer + the verification hash-pinned');
        });

        test('the hallucinating stub (answers immediately, claims it never read) FAILs: the coverage contract + the map soundness, with honest friction rows', async () => {
                const fixture = await buildToolsFixtureTree();
                const recordsDir = path.join(os.tmpdir(), `w7-tools-halluc-${String(Date.now())}`);
                const hallucinated = JSON.stringify({
                        schema: TOOLS_ANSWER_SCHEMA,
                        question: 'q',
                        method: 'guessed without reading',
                        receipts: ['R-1'],
                        consumers: [
                                { file: 'extensions/flauz-alpha/src/consumer.ts', line: 2, consumes: ['EvidenceLedger'] },
                                { file: 'extensions/flauz-invented/src/consumer.ts', line: 1, consumes: ['EvidenceLedger'] },
                        ],
                });
                const harness = await stubHarness(fixture.root, recordsDir, async () => hallucinated);
                const receipt = await TOOLS_EXPLORATION_EXERCISE.run(harness);
                assert.strictEqual(receipt.verdict, 'FAIL');
                assert.ok(!receipt.checks.find(check => check.id === 'tools.answer-cites-reads')?.ok, 'the coverage check failed');
                assert.ok(!receipt.checks.find(check => check.id === 'tools.map-sound')?.ok, 'the invented entry fails soundness');
                const rows = await (harness.friction as FrictionLog).readAll();
                assert.ok(rows.some(row => row.type === 'friction' && row.kind === 'evidence-gap' && (row as { detail: string }).detail.includes('tool-receipt contract failed')));
                assert.ok(rows.some(row => row.type === 'friction' && row.kind === 'failed-task' && (row as { detail: string }).detail.includes('not 100% verified')));
        });

        test('the refusing human: a non-read-only command is DENIED at the exercise\'s approval gate -- every denial a manual-intervention friction row, the loop fails closed at the turn bound', async () => {
                const fixture = await buildToolsFixtureTree();
                const recordsDir = path.join(os.tmpdir(), `w7-tools-refusal-${String(Date.now())}`);
                // an agent that insists on a WRITE-class command: the careful-human policy refuses every one at the gate
                const demanding = JSON.stringify({ schema: TOOLS_DIRECTIVE_SCHEMA, calls: [{ tool: 'flauz_terminal', input: { command: 'node -e "process.exit(0)"' } }] });
                const harness = await stubHarness(fixture.root, recordsDir, async () => demanding);
                const receipt = await TOOLS_EXPLORATION_EXERCISE.run(harness);
                assert.strictEqual(receipt.verdict, 'FAIL');
                assert.ok(!receipt.checks.find(check => check.id === 'tools.answer-parses')?.ok, 'the agent never answered (the loop hit the turn bound)');
                const rows = await (harness.friction as FrictionLog).readAll();
                const denials = rows.filter(row => row.type === 'friction' && row.kind === 'manual-intervention' && (row as { detail: string }).detail.includes('DENIED'));
                assert.strictEqual(denials.length, MAX_TOOL_TURNS, `every one of the ${String(MAX_TOOL_TURNS)} turns' refusals is logged as a human intervention`);
                const verification = JSON.parse(await fs.readFile(path.join(recordsDir, 'tools-exploration.verification.json'), { encoding: 'utf-8' })) as { receiptVerification: { totals: { receipts: number; deniedReceipts: number } } };
                assert.strictEqual(verification.receiptVerification.totals.receipts, MAX_TOOL_TURNS);
                assert.strictEqual(verification.receiptVerification.totals.deniedReceipts, MAX_TOOL_TURNS, 'every receipt records the denied gate');
        });

        test('an agent directing an UNKNOWN tool is refused by the lane (the surface is flauz_terminal only) and the refusal is logged', async () => {
                const fixture = await buildToolsFixtureTree();
                const recordsDir = path.join(os.tmpdir(), `w7-tools-unknown-${String(Date.now())}`);
                const rogue = JSON.stringify({ schema: TOOLS_DIRECTIVE_SCHEMA, calls: [{ tool: 'not_a_real_tool', input: { command: 'ls' } }] });
                const harness = await stubHarness(fixture.root, recordsDir, async () => rogue);
                const receipt = await TOOLS_EXPLORATION_EXERCISE.run(harness);
                assert.strictEqual(receipt.verdict, 'FAIL');
                assert.ok(!receipt.checks.find(check => check.id === 'tools.tool-surface-known')?.ok, 'the unknown tool is flagged');
                const rows = await (harness.friction as FrictionLog).readAll();
                assert.ok(rows.some(row => row.type === 'friction' && (row as { detail: string }).detail.includes('unknown tool')));
        });

        test('G8 privacy canary: fixture-planted ghp_/sk_-shaped canaries NEVER appear in any receipt or friction row of the tools lane', async () => {
                const fixture = await buildToolsFixtureTree({ canaries: true });
                const recordsDir = path.join(os.tmpdir(), `w7-tools-canary-${String(Date.now())}`);
                const harness = await stubHarness(fixture.root, recordsDir, async prompt => toolsAgentTurn(prompt));
                const receipt = await TOOLS_EXPLORATION_EXERCISE.run(harness);
                assert.strictEqual(receipt.verdict, 'PASS', 'the canary planting changed nothing (the canaries sit on lines the tools never read)');
                assert.doesNotMatch(JSON.stringify(receipt), CANARY_SHAPES, 'the exercise receipt carries no canary');
                const frictionText = await fs.readFile(path.join(recordsDir, 'tools-exploration.friction.jsonl'), { encoding: 'utf-8' });
                assert.doesNotMatch(frictionText, CANARY_SHAPES, 'no friction row carries a canary');
                const verificationText = await fs.readFile(path.join(recordsDir, 'tools-exploration.verification.json'), { encoding: 'utf-8' });
                assert.doesNotMatch(verificationText, CANARY_SHAPES, 'the verification receipt (embedding every tool receipt) carries no canary');
        });

        test('MAX_TOOL_TURNS is pinned at 8 (the fail-closed bound) and the careful-human policy grants read-only grep commands only', () => {
                assert.strictEqual(MAX_TOOL_TURNS, 8);
                assert.strictEqual(readOnlyCommandsConfirmationPolicy('flauz_terminal', { title: 't', message: 'Allow Flauz Agent to run `grep -rn ledger extensions/flauz-*` in the integrated terminal?' }), true);
                assert.strictEqual(readOnlyCommandsConfirmationPolicy('flauz_terminal', { title: 't', message: 'Allow Flauz Agent to run `rm -rf /` in the integrated terminal?' }), false);
                assert.strictEqual(readOnlyCommandsConfirmationPolicy('flauz_terminal', { title: 't', message: 'Allow Flauz Agent to run `node scratch/test.mjs` in the integrated terminal?' }), false);
        });
});

