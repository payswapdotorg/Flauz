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
 *     logic).
 *
 * Harness tests (build/flauz/dogfood/**): NOT gate instruments.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FRICTION_KINDS, FRICTION_SCHEMA, FrictionLog, isFrictionKind, parseFrictionLog, validateFrictionLine } from './frictionlog.mjs';
import { answerSwitchFromPrompt } from './fake-provider.mjs';
import { EXPLORE_ANSWER_SCHEMA, LEDGER_MODULE, parseExploreAnswer, parseImportStatement, scanLedgerConsumers, specifierResolvesTo, verifyConsumersMap, type ExploreAnswer, type GroundTruthConsumer } from './exercises/explore-repo.task.ts';
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
        return { kind: 'ok', text: '{}', decisionId: `rd-${String(switchNo).padStart(6, '0')}`, providerId: 'flauz-dogfood-fake', modelId: 'dogfood-1', durationMs: 5, attempts: 1, wallClockBudgetMs: 15_000 };
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
