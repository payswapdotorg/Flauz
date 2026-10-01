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
import { EXPLORE_ANSWER_SCHEMA, LEDGER_MODULE, parseExploreAnswer, parseImportStatement, scanLedgerConsumers, specifierResolvesTo, verifyConsumersMap, type ExploreAnswer, type GroundTruthConsumer } from './exercises/explore-repo.task.ts';
import { SWITCH_ANSWER_SCHEMA, healthyLaneOf, parseSwitchAnswer, plannedSwitchSequence, providerFailureDetail, recoveryAccount, summarizeSwitchRun, verifySwitchAnswer, type SwitchRunRecord } from './exercises/provider-switch.task.ts';

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
        return { kind: 'ok', text: '{}', decisionId: `rd-${String(switchNo).padStart(6, '0')}`, providerId: 'flauz-dogfood-fake', modelId: 'dogfood-1', durationMs: 5, attempts: 1 };
}

function failedAsk(switchNo: number): SwitchRunRecord['ask'] {
        return { kind: 'provider-failure', code: 'PROVIDER_OVERLOADED', retryable: true, retryClass: 'short-backoff', status: 500, retryAfterMs: undefined, message: 'armed to fail', decisionId: `rd-${String(switchNo).padStart(6, '0')}`, providerId: 'flauz-dogfood-failing', modelId: 'dogfood-1', durationMs: 20, attempts: 3 };
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
                        { switchNo: 1, lane: 'healthy', receipt: fakeReceipt(1, 'fake'), ask: okAsk(1), answerProblems: [], atMs: 1_000, durationMs: 10 },
                        { switchNo: 2, lane: 'scripted-failing', receipt: fakeReceipt(2, 'scripted-failing'), ask: failedAsk(2), answerProblems: [], atMs: 2_000, durationMs: 25 },
                        { switchNo: 3, lane: 'healthy', receipt: fakeReceipt(3, 'fake'), ask: okAsk(3), answerProblems: [], atMs: 2_050, durationMs: 10 },
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
                        { switchNo: 1, lane: 'healthy', receipt: fakeReceipt(1, 'fake'), ask: okAsk(1), answerProblems: [], atMs: 1_000, durationMs: 10 },
                        { switchNo: 2, lane: 'scripted-failing', receipt: fakeReceipt(2, 'scripted-failing'), ask: okAsk(2), answerProblems: [], atMs: 2_000, durationMs: 10 },
                        { switchNo: 3, lane: 'healthy', receipt: fakeReceipt(3, 'fake'), ask: okAsk(3), answerProblems: [], atMs: 3_000, durationMs: 10 },
                ];
                const summary = summarizeSwitchRun(plan, records);
                assert.ok(!summary.ok);
                assert.ok(summary.problems.some(problem => problem.includes('produced no typed provider failure')));
        });

        test('a run without recovery is flagged, and a failure without a bounded-retry window is flagged', () => {
                const plan = plannedSwitchSequence('fake-lane');
                const noRecovery: SwitchRunRecord[] = [
                        { switchNo: 1, lane: 'healthy', receipt: fakeReceipt(1, 'fake'), ask: okAsk(1), answerProblems: [], atMs: 1_000, durationMs: 10 },
                        { switchNo: 2, lane: 'scripted-failing', receipt: fakeReceipt(2, 'scripted-failing'), ask: failedAsk(2), answerProblems: [], atMs: 2_000, durationMs: 20 },
                ];
                const noRecoverySummary = summarizeSwitchRun(plan, noRecovery);
                assert.ok(!noRecoverySummary.ok);
                assert.ok(noRecoverySummary.problems.some(problem => problem.includes('never recovered')));
                assert.ok(noRecoverySummary.problems.some(problem => problem.includes('were planned')));
                const singleAttempt: SwitchRunRecord[] = [
                        { switchNo: 1, lane: 'healthy', receipt: fakeReceipt(1, 'fake'), ask: okAsk(1), answerProblems: [], atMs: 1_000, durationMs: 10 },
                        { switchNo: 2, lane: 'scripted-failing', receipt: fakeReceipt(2, 'scripted-failing'), ask: { ...failedAsk(2), attempts: 1 }, answerProblems: [], atMs: 2_000, durationMs: 5 },
                        { switchNo: 3, lane: 'healthy', receipt: fakeReceipt(3, 'fake'), ask: okAsk(3), answerProblems: [], atMs: 2_050, durationMs: 10 },
                ];
                const singleAttemptSummary = summarizeSwitchRun(plan, singleAttempt);
                assert.ok(!singleAttemptSummary.ok);
                assert.ok(singleAttemptSummary.problems.some(problem => problem.includes('bounded-retry window')));
        });

        test('a switch without an evidence row is flagged', () => {
                const plan = plannedSwitchSequence('fake-lane');
                const records: SwitchRunRecord[] = [
                        { switchNo: 1, lane: 'healthy', receipt: { ...fakeReceipt(1, 'fake'), evidenceId: '' }, ask: okAsk(1), answerProblems: [], atMs: 1_000, durationMs: 10 },
                        { switchNo: 2, lane: 'scripted-failing', receipt: fakeReceipt(2, 'scripted-failing'), ask: failedAsk(2), answerProblems: [], atMs: 2_000, durationMs: 20 },
                        { switchNo: 3, lane: 'healthy', receipt: fakeReceipt(3, 'fake'), ask: okAsk(3), answerProblems: [], atMs: 2_050, durationMs: 10 },
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
