/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * DH-009 domain benchmark/simulation-worlds contract battery: the
 * frozen-vocab cross-pins (against the REAL landed modules - the
 * seven prior family versions plus the REAL LAB contracts version;
 * the REAL LAB-003 task-world registry census pinned BY IMPORT; the
 * REAL evaluation vocabulary and evidence ladder through the
 * compile-time census derivations), the stage machine, the
 * benchmark laws (every rejection class, the split stations, the
 * evidence-ceiling refusal for each higher rung), the deep record
 * walk with the complete-table law, the station-major frozen order,
 * the absent-key discipline, the serialization round-trip with the
 * fail-closed parse, and the in-suite determinism greps (law-comment
 * lines only).
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
        DOMAIN_HARNESS_CONTRACTS_VERSION,
        HARNESS_ID_PREFIX,
        HARNESS_INDUSTRIES,
        isHarnessId,
        isHarnessIndustry,
} from '../../../contract/common/domainHarnessContract.js';
import { ONBOARDING_CONTRACTS_VERSION } from '../../../onboarding/common/onboardingContract.js';
import { ROLES_CONTRACTS_VERSION } from '../../../roles/common/rolesContract.js';
import { ONTOLOGY_CONTRACTS_VERSION } from '../../../ontology/common/ontologyContract.js';
import { TEMPLATES_CONTRACTS_VERSION } from '../../../templates/common/templatesContract.js';
import { BODIES_CONTRACTS_VERSION } from '../../../bodies/common/bodiesContract.js';
import { PACKS_CONTRACTS_VERSION } from '../../../packs/common/packsContract.js';
import { LAB_CONTRACTS_VERSION } from '../../../../lab/common/labContracts.js';
import {
        TASK_WORLDS,
        generateInstances,
        getScenario,
        listWorlds,
        visiblePayload,
} from '../../../../lab/common/taskWorlds.js';
import * as family from '../../common/benchmarksContract.js';
import {
        BENCHMARK_ENTRY_SCHEMA_KEYS,
        BENCHMARK_FORWARD_TRANSITIONS,
        BENCHMARK_HYPOTHESIS_MAX_LENGTH,
        BENCHMARK_ID_PREFIX,
        BENCHMARK_KEY_MAX_LENGTH,
        BENCHMARK_LIMITATIONS_MAX_LENGTH,
        BENCHMARK_EXPECTED_OUTCOME_MAX_LENGTH,
        BENCHMARK_OP_NAMES,
        BENCHMARK_STAGES,
        BENCHMARK_SUMMARY_MAX_LENGTH,
        BENCHMARKS_CONTRACTS_VERSION,
        BENCHMARKS_RECORD_SCHEMA_KEYS,
        EVAL_DIMENSIONS,
        LAB_EVIDENCE_LEVELS,
        BENCHMARK_EVIDENCE_LEVEL_CEILING,
        MAX_BENCHMARKS,
        canTransitionBenchmarkStage,
        isBenchmarkOpName,
        isBenchmarkStage,
        labEvidenceLevelRank,
        parseBenchmarksRecord,
        serializeBenchmarksRecord,
        validateBenchmarkEntry,
        validateBenchmarkExpectedOutcome,
        validateBenchmarkHypothesis,
        validateBenchmarkKey,
        validateBenchmarkLimitations,
        validateBenchmarkSummary,
        validateBenchmarksRecord,
} from '../../common/benchmarksContract.js';
import type { BenchmarksValidationOutcome } from '../../common/benchmarksContract.js';

const CONTRACT_SOURCE = readFileSync(fileURLToPath(new URL('../../common/benchmarksContract.ts', import.meta.url)), 'utf8');

/**
 * THE SCENARIO-BINDING LAW's pin-by-import: the scenario ids the
 * fixtures bind to are DERIVED from the REAL imported registry
 * (never a hard-coded list that could drift).
 */
const REAL_SCENARIO_IDS: string[] = TASK_WORLDS.flatMap((world) => world.taskScenarios.map((scenario) => scenario.id));
const FABRICATED_SCENARIO_ID = 'scenario-se-fabricated-ghost';

function greenBenchmark(): Record<string, unknown> {
        return {
                benchmarkKey: 'regression-suite-health',
                summary: 'The regression suite health benchmark.',
                hypothesis: 'A composed agent organization completes the seeded regression-fix scenarios with a higher success rate than the single-agent baseline.',
                scenarioRefs: [...REAL_SCENARIO_IDS],
                kpiDimensions: ['success', 'quality'],
                expectedOutcome: 'The candidate clears every acceptance criterion on at least 6 of 8 seeded instances per scenario.',
                limitations: 'Fixture worlds over a synthetic repository; no real telemetry, no live repositories, single-seed runs only.',
                evidenceLevel: 'fixture',
        };
}

function greenRecord(): Record<string, unknown> {
        return {
                id: 'flauz:ben:0123456789abcdef',
                harnessId: 'flauz:hrn:0123456789abcdef',
                industry: 'software',
                stage: 'composing',
                benchmarks: [greenBenchmark()],
                history: [
                        { at: '2026-01-01T00:00:00.000Z', fromStage: null, toStage: 'composing', op: 'begin-benchmarks', law: 'THE FORWARD-ONLY LAW', detail: 'began the record' },
                ],
        };
}

function reasons<T>(outcome: BenchmarksValidationOutcome<T>): string[] {
        if (outcome.ok) {
                throw new Error('expected a refusal outcome');
        }
        return outcome.rejections.map((rejection) => rejection.reason);
}

function outcomeItems<T>(outcome: BenchmarksValidationOutcome<T>): readonly string[] {
        if (outcome.ok) {
                throw new Error('expected a refusal outcome');
        }
        return outcome.rejections[0].items ?? [];
}

function clone(value: Record<string, unknown>): Record<string, unknown> {
        return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

suite('benchmarksContract · frozen vocabularies and cross-pins', () => {
        test('BENCHMARKS_CONTRACTS_VERSION is 1.0.0 and BENCHMARK_ID_PREFIX is flauz:ben:', () => {
                assert.equal(BENCHMARKS_CONTRACTS_VERSION, '1.0.0');
                assert.equal(BENCHMARK_ID_PREFIX, 'flauz:ben:');
        });

        test('BENCHMARK_STAGES and BENCHMARK_FORWARD_TRANSITIONS are frozen', () => {
                assert.deepStrictEqual([...BENCHMARK_STAGES], ['composing', 'composed']);
                assert.deepStrictEqual([...BENCHMARK_FORWARD_TRANSITIONS], [{ from: 'composing', to: 'composed' }]);
        });

        test('the stage and op-name predicates are closed over their frozen vocabularies', () => {
                assert.ok(isBenchmarkStage('composing'));
                assert.ok(isBenchmarkStage('composed'));
                assert.ok(!isBenchmarkStage('draft'));
                assert.ok(!isBenchmarkStage(7));
                for (const op of BENCHMARK_OP_NAMES) {
                        assert.ok(isBenchmarkOpName(op), `the op '${op}' must be a member`);
                }
                assert.ok(!isBenchmarkOpName('begin-benchmarks '));
                assert.ok(!isBenchmarkOpName(7));
        });

        test('the benchmark-law constants are frozen (64 / 200 / 300 / 300 / 300 / 64)', () => {
                assert.equal(BENCHMARK_KEY_MAX_LENGTH, 64);
                assert.equal(BENCHMARK_SUMMARY_MAX_LENGTH, 200);
                assert.equal(BENCHMARK_HYPOTHESIS_MAX_LENGTH, 300);
                assert.equal(BENCHMARK_EXPECTED_OUTCOME_MAX_LENGTH, 300);
                assert.equal(BENCHMARK_LIMITATIONS_MAX_LENGTH, 300);
                assert.equal(MAX_BENCHMARKS, 64);
        });

        test('BENCHMARK_OP_NAMES is the frozen five-op vocabulary', () => {
                assert.deepStrictEqual([...BENCHMARK_OP_NAMES], [
                        'begin-benchmarks',
                        'add-benchmark',
                        'replace-benchmark-summary',
                        'remove-benchmark',
                        'finalize-benchmarks',
                ]);
        });

        test('BENCHMARK_ENTRY_SCHEMA_KEYS is the frozen eight-key station', () => {
                assert.deepStrictEqual([...BENCHMARK_ENTRY_SCHEMA_KEYS], [
                        'benchmarkKey',
                        'summary',
                        'hypothesis',
                        'scenarioRefs',
                        'kpiDimensions',
                        'expectedOutcome',
                        'limitations',
                        'evidenceLevel',
                ]);
        });

        test('the DH-01 re-exports are referentially identical to the real module (THE IMPORT LAW)', () => {
                assert.equal(family.DOMAIN_HARNESS_CONTRACTS_VERSION, DOMAIN_HARNESS_CONTRACTS_VERSION);
                assert.equal(family.HARNESS_ID_PREFIX, HARNESS_ID_PREFIX);
                assert.equal(family.HARNESS_INDUSTRIES, HARNESS_INDUSTRIES);
                assert.equal(family.isHarnessId, isHarnessId);
                assert.equal(family.isHarnessIndustry, isHarnessIndustry);
                assert.ok(isHarnessId('flauz:hrn:0123456789abcdef'));
                assert.ok(isHarnessIndustry('software'));
        });

        test('the seven prior family versions (DH-01..DH-07) and the REAL LAB_CONTRACTS_VERSION are re-carried equal (THE SINGLE-VERSION LAW)', () => {
                assert.equal(family.DOMAIN_HARNESS_CONTRACTS_VERSION, DOMAIN_HARNESS_CONTRACTS_VERSION);
                assert.equal(family.ONBOARDING_CONTRACTS_VERSION, ONBOARDING_CONTRACTS_VERSION);
                assert.equal(family.ROLES_CONTRACTS_VERSION, ROLES_CONTRACTS_VERSION);
                assert.equal(family.ONTOLOGY_CONTRACTS_VERSION, ONTOLOGY_CONTRACTS_VERSION);
                assert.equal(family.TEMPLATES_CONTRACTS_VERSION, TEMPLATES_CONTRACTS_VERSION);
                assert.equal(family.BODIES_CONTRACTS_VERSION, BODIES_CONTRACTS_VERSION);
                assert.equal(family.PACKS_CONTRACTS_VERSION, PACKS_CONTRACTS_VERSION);
                assert.equal(family.LAB_CONTRACTS_VERSION, LAB_CONTRACTS_VERSION);
                assert.equal(LAB_CONTRACTS_VERSION, '1.0.0');
        });

        test('THE IMPORT LAW census: EVAL_DIMENSIONS is the REAL evaluation vocabulary (derived from the imported type)', () => {
                assert.deepStrictEqual([...EVAL_DIMENSIONS], ['success', 'quality', 'latency', 'cost']);
                for (const dimension of EVAL_DIMENSIONS) {
                        assert.ok(family.isEvalDimension(dimension), `the dimension '${dimension}' must be a member`);
                }
                assert.ok(!family.isEvalDimension('speed'));
                assert.ok(!family.isEvalDimension(7));
        });

        test('THE IMPORT LAW census: LAB_EVIDENCE_LEVELS is the REAL six-rung ladder in the frozen ladder order', () => {
                assert.deepStrictEqual([...LAB_EVIDENCE_LEVELS], [
                        'fixture',
                        'simulated',
                        'local-real',
                        'runtime-real',
                        'live-provider',
                        'production-real',
                ]);
                for (const level of LAB_EVIDENCE_LEVELS) {
                        assert.ok(family.isLabEvidenceLevel(level), `the rung '${level}' must be a member`);
                }
                assert.ok(!family.isLabEvidenceLevel('runtime'));
                assert.ok(!family.isLabEvidenceLevel(7));
        });

        test('THE EVIDENCE-CEILING LAW: the family ceiling is the honest subset fixture/simulated; the ladder ranks follow the frozen order', () => {
                assert.deepStrictEqual([...BENCHMARK_EVIDENCE_LEVEL_CEILING], ['fixture', 'simulated']);
                assert.ok(family.isBenchmarkEvidenceLevel('fixture'));
                assert.ok(family.isBenchmarkEvidenceLevel('simulated'));
                assert.ok(!family.isBenchmarkEvidenceLevel('local-real'));
                assert.ok(!family.isBenchmarkEvidenceLevel('production-real'));
                assert.equal(labEvidenceLevelRank('fixture'), 0);
                assert.equal(labEvidenceLevelRank('simulated'), 1);
                assert.equal(labEvidenceLevelRank('local-real'), 2);
                assert.equal(labEvidenceLevelRank('runtime-real'), 3);
                assert.equal(labEvidenceLevelRank('live-provider'), 4);
                assert.equal(labEvidenceLevelRank('production-real'), 5);
                assert.equal(labEvidenceLevelRank('runtime'), -1);
                assert.equal(labEvidenceLevelRank(7), -1);
        });
});

suite('benchmarksContract · the scenario-registry cross-pins (THE IMPORT LAW)', () => {
        test('the TASK_WORLDS registry census: the frozen registry state pinned by import', () => {
                assert.equal(TASK_WORLDS.length, 1);
                assert.equal(listWorlds().length, TASK_WORLDS.length);
                assert.equal(REAL_SCENARIO_IDS.length, 3);
                assert.deepStrictEqual(REAL_SCENARIO_IDS, [
                        'scenario-se-bugfix-regression',
                        'scenario-se-feature-addition',
                        'scenario-se-flaky-investigation',
                ]);
        });

        test('every registry scenario id resolves through the REAL getScenario (pin by import, never transcription)', () => {
                for (const scenarioId of REAL_SCENARIO_IDS) {
                        const scenario = getScenario(scenarioId);
                        assert.ok(scenario !== undefined, `the scenario '${scenarioId}' must resolve`);
                        assert.equal(scenario.id, scenarioId);
                        assert.ok(typeof scenario.taskTypeId === 'string' && scenario.taskTypeId.length > 0);
                        assert.ok(typeof scenario.worldId === 'string' && scenario.worldId.length > 0);
                }
        });

        test('a fabricated scenario id resolves to nothing (the dangling-scenario refusal basis)', () => {
                assert.equal(getScenario(FABRICATED_SCENARIO_ID), undefined);
        });

        test('generateInstances is deterministic in (scenarioId, seed, instanceIndex): same seed twice is deep-equal', () => {
                const scenarioId = REAL_SCENARIO_IDS[0] as string;
                const first = generateInstances(scenarioId, 7, 4);
                const second = generateInstances(scenarioId, 7, 4);
                assert.equal(first.length, 4);
                assert.deepStrictEqual(first, second);
                assert.equal(JSON.stringify(first), JSON.stringify(second));
                for (let i = 0; i < first.length; i += 1) {
                        assert.equal(first[i]!.scenarioId, scenarioId);
                        assert.equal(first[i]!.seed, 7);
                        assert.equal(first[i]!.instanceIndex, i);
                }
        });

        test('generateInstances: two different seeds produce different instance streams', () => {
                const scenarioId = REAL_SCENARIO_IDS[0] as string;
                const seedSeven = generateInstances(scenarioId, 7, 4);
                const seedEleven = generateInstances(scenarioId, 11, 4);
                assert.notEqual(JSON.stringify(seedSeven), JSON.stringify(seedEleven));
        });

        test('generateInstances: the stream is independent of the requested count (per-instance sub-seeds)', () => {
                const scenarioId = REAL_SCENARIO_IDS[1] as string;
                const short = generateInstances(scenarioId, 5, 2);
                const long = generateInstances(scenarioId, 5, 5);
                assert.deepStrictEqual(long.slice(0, 2), short);
        });

        test('visiblePayload withholds the ground-truth lanes (acceptance criteria and difficulty)', () => {
                const scenarioId = REAL_SCENARIO_IDS[2] as string;
                const instances = generateInstances(scenarioId, 3, 2);
                const payload = visiblePayload(instances[0]!);
                assert.equal(payload.scenarioId, scenarioId);
                assert.ok(!('acceptanceCriteria' in payload));
                assert.ok(!('difficulty' in payload));
                assert.ok(payload.contextFiles.length >= 3 && payload.contextFiles.length <= 6);
                assert.ok(payload.obstacles.length >= 1 && payload.obstacles.length <= 3);
        });
});

suite('benchmarksContract · the stage machine', () => {
        test('composing -> composed is the single whitelisted row', () => {
                const verdict = canTransitionBenchmarkStage('composing', 'composed');
                assert.ok(verdict.ok);
                assert.equal(verdict.row, 1);
                assert.equal(verdict.from, 'composing');
                assert.equal(verdict.to, 'composed');
        });

        test('composed is TERMINAL (whitelistRow null, expectedTo null)', () => {
                const verdict = canTransitionBenchmarkStage('composed', 'composing');
                assert.ok(!verdict.ok);
                assert.equal(verdict.reason, 'ILLEGAL_TRANSITION');
                assert.equal(verdict.whitelistRow, null);
                assert.equal(verdict.expectedTo, null);
                const selfLoop = canTransitionBenchmarkStage('composed', 'composed');
                assert.ok(!selfLoop.ok);
                assert.equal(selfLoop.reason, 'ILLEGAL_TRANSITION');
                assert.equal(selfLoop.whitelistRow, null);
                assert.equal(selfLoop.expectedTo, null);
        });

        test('the composing self-loop is refused with expectedTo composed', () => {
                const verdict = canTransitionBenchmarkStage('composing', 'composing');
                assert.ok(!verdict.ok);
                assert.equal(verdict.whitelistRow, 1);
                assert.equal(verdict.expectedTo, 'composed');
        });

        test('unknown or non-string stages are refused', () => {
                for (const [from, to] of [['draft', 'composed'], ['composing', 'draft'], [null, 'composed'], ['composing', 7]] as unknown[][]) {
                        const verdict = canTransitionBenchmarkStage(from, to);
                        assert.ok(!verdict.ok);
                        assert.equal(verdict.reason, 'ILLEGAL_TRANSITION');
                }
        });
});

suite('benchmarksContract · the split text stations', () => {
        test('validateBenchmarkKey: green at 1 and 64 chars', () => {
                const oneChar = validateBenchmarkKey('k');
                assert.ok(oneChar.ok);
                assert.equal(oneChar.value, 'k');
                assert.ok(validateBenchmarkKey('a'.repeat(64)).ok);
        });

        test('validateBenchmarkKey: a non-string carrier is the single-station malformed-record table', () => {
                for (const benchmarkKey of [null, 7, undefined]) {
                        const outcome = validateBenchmarkKey(benchmarkKey);
                        assert.ok(!outcome.ok);
                        assert.deepStrictEqual(reasons(outcome), ['malformed-record']);
                }
        });

        test('validateBenchmarkKey: empty and 65 chars are benchmark-key-length', () => {
                assert.deepStrictEqual(reasons(validateBenchmarkKey('')), ['benchmark-key-length']);
                assert.deepStrictEqual(outcomeItems(validateBenchmarkKey('')), ['empty']);
                assert.deepStrictEqual(reasons(validateBenchmarkKey('a'.repeat(65))), ['benchmark-key-length']);
                assert.deepStrictEqual(outcomeItems(validateBenchmarkKey('a'.repeat(65))), ['65 chars']);
        });

        test('validateBenchmarkKey: whitespace and control chars are their own split stations', () => {
                assert.deepStrictEqual(reasons(validateBenchmarkKey(' k')), ['benchmark-key-whitespace']);
                assert.deepStrictEqual(outcomeItems(validateBenchmarkKey('k ')), ['leading/trailing whitespace']);
                assert.deepStrictEqual(reasons(validateBenchmarkKey('k\u0000')), ['benchmark-key-control-chars']);
                assert.deepStrictEqual(outcomeItems(validateBenchmarkKey('k\u0000')), ['U+0000']);
                assert.deepStrictEqual(outcomeItems(validateBenchmarkKey('k\u007F')), ['U+007F']);
        });

        test('validateBenchmarkKey: one multi-offense key reports every split station in the frozen order', () => {
                const outcome = validateBenchmarkKey(' k\u0000');
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['benchmark-key-whitespace', 'benchmark-key-control-chars']);
        });

        test('validateBenchmarkSummary: green at 1 and 200 chars; a non-string carrier is malformed-record', () => {
                const oneChar = validateBenchmarkSummary('s');
                assert.ok(oneChar.ok);
                assert.equal(oneChar.value, 's');
                assert.ok(validateBenchmarkSummary('a'.repeat(200)).ok);
                assert.deepStrictEqual(reasons(validateBenchmarkSummary(7)), ['malformed-record']);
                assert.deepStrictEqual(reasons(validateBenchmarkSummary('')), ['summary-length']);
                assert.deepStrictEqual(outcomeItems(validateBenchmarkSummary('a'.repeat(201))), ['201 chars']);
                assert.deepStrictEqual(reasons(validateBenchmarkSummary('s\u009F')), ['summary-control-chars']);
                assert.deepStrictEqual(outcomeItems(validateBenchmarkSummary('s\u009F')), ['U+009F']);
        });

        test('validateBenchmarkHypothesis: the bounds and control chars refuse their own stations (THE TESTABLE-HYPOTHESIS LAW)', () => {
                assert.ok(validateBenchmarkHypothesis('h').ok);
                assert.ok(validateBenchmarkHypothesis('a'.repeat(300)).ok);
                assert.deepStrictEqual(reasons(validateBenchmarkHypothesis(7)), ['malformed-record']);
                assert.deepStrictEqual(reasons(validateBenchmarkHypothesis('')), ['hypothesis-length']);
                assert.deepStrictEqual(reasons(validateBenchmarkHypothesis('a'.repeat(301))), ['hypothesis-length']);
                assert.deepStrictEqual(outcomeItems(validateBenchmarkHypothesis('a'.repeat(301))), ['301 chars']);
                assert.deepStrictEqual(reasons(validateBenchmarkHypothesis('h\u0000')), ['hypothesis-control-chars']);
                assert.deepStrictEqual(outcomeItems(validateBenchmarkHypothesis('h\u0000')), ['U+0000']);
        });

        test('validateBenchmarkExpectedOutcome: the bounds and control chars refuse their own stations', () => {
                assert.ok(validateBenchmarkExpectedOutcome('o').ok);
                assert.ok(validateBenchmarkExpectedOutcome('a'.repeat(300)).ok);
                assert.deepStrictEqual(reasons(validateBenchmarkExpectedOutcome(null)), ['malformed-record']);
                assert.deepStrictEqual(reasons(validateBenchmarkExpectedOutcome('')), ['expected-outcome-length']);
                assert.deepStrictEqual(reasons(validateBenchmarkExpectedOutcome('a'.repeat(301))), ['expected-outcome-length']);
                assert.deepStrictEqual(reasons(validateBenchmarkExpectedOutcome('o\u0000')), ['expected-outcome-control-chars']);
        });

        test('validateBenchmarkLimitations: the bounds and control chars refuse their own stations (THE LIMITATIONS DISCLOSURE)', () => {
                assert.ok(validateBenchmarkLimitations('l').ok);
                assert.ok(validateBenchmarkLimitations('a'.repeat(300)).ok);
                assert.deepStrictEqual(reasons(validateBenchmarkLimitations(7)), ['malformed-record']);
                assert.deepStrictEqual(reasons(validateBenchmarkLimitations('')), ['limitations-length']);
                assert.deepStrictEqual(reasons(validateBenchmarkLimitations('a'.repeat(301))), ['limitations-length']);
                assert.deepStrictEqual(reasons(validateBenchmarkLimitations('l\u0000')), ['limitations-control-chars']);
        });
});

suite('benchmarksContract · validateBenchmarkEntry', () => {
        test('a green benchmark entry validates and the ok copy carries the fixed eight-key order', () => {
                const outcome = validateBenchmarkEntry(greenBenchmark());
                assert.ok(outcome.ok);
                assert.equal(outcome.value.benchmarkKey, 'regression-suite-health');
                assert.deepStrictEqual(outcome.value.scenarioRefs, [...REAL_SCENARIO_IDS]);
                assert.deepStrictEqual(outcome.value.kpiDimensions, ['success', 'quality']);
                assert.deepStrictEqual(Object.keys(outcome.value), [...BENCHMARK_ENTRY_SCHEMA_KEYS]);
        });

        test('a non-object is the single-station malformed-record table', () => {
                for (const benchmark of [null, 'benchmark', 7, ['x']]) {
                        const outcome = validateBenchmarkEntry(benchmark);
                        assert.ok(!outcome.ok);
                        assert.deepStrictEqual(reasons(outcome), ['malformed-record']);
                }
        });

        test('a non-string text-leg carrier is malformed-record (the per-leg stations never cascade)', () => {
                const benchmark = greenBenchmark();
                benchmark.benchmarkKey = 7;
                const withKey = validateBenchmarkEntry(benchmark);
                assert.deepStrictEqual(reasons(withKey), ['malformed-record']);
                const withHypothesis = validateBenchmarkEntry({ ...greenBenchmark(), hypothesis: null });
                assert.ok(withHypothesis.ok === false && withHypothesis.rejections[0].reason === 'malformed-record');
                assert.ok(withHypothesis.ok === false && (withHypothesis.rejections[0].items ?? []).includes('hypothesis'));
        });

        test('an extra key is the typed no-fork rejection (a benchmark grants NOTHING and executes NOTHING by itself)', () => {
                const outcome = validateBenchmarkEntry({ ...greenBenchmark(), tools: ['shell'] });
                assert.ok(!outcome.ok);
                assert.equal(outcome.rejections[0].reason, 'no-fork');
                assert.equal(outcome.rejections[0].law, 'THE NO-FORK LAW');
                assert.deepStrictEqual(outcome.rejections[0].items, ['tools']);
        });

        test('benchmark-key boundaries: 1 and 64 chars are legal; empty and 65 refuse benchmark-key-length', () => {
                assert.ok(validateBenchmarkEntry({ ...greenBenchmark(), benchmarkKey: 'a' }).ok);
                assert.ok(validateBenchmarkEntry({ ...greenBenchmark(), benchmarkKey: 'a'.repeat(64) }).ok);
                assert.deepStrictEqual(reasons(validateBenchmarkEntry({ ...greenBenchmark(), benchmarkKey: '' })), ['benchmark-key-length']);
                assert.deepStrictEqual(reasons(validateBenchmarkEntry({ ...greenBenchmark(), benchmarkKey: 'a'.repeat(65) })), ['benchmark-key-length']);
        });

        test('benchmark-key whitespace and control chars refuse their own stations', () => {
                assert.deepStrictEqual(reasons(validateBenchmarkEntry({ ...greenBenchmark(), benchmarkKey: ' k' })), ['benchmark-key-whitespace']);
                assert.deepStrictEqual(reasons(validateBenchmarkEntry({ ...greenBenchmark(), benchmarkKey: 'k\u0000' })), ['benchmark-key-control-chars']);
        });

        test('THE ENTRY FLOOR: empty scenarioRefs refuse empty-scenario-refs (a benchmark with no scenario measures nothing)', () => {
                const outcome = validateBenchmarkEntry({ ...greenBenchmark(), scenarioRefs: [] });
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['empty-scenario-refs']);
                assert.equal(outcome.rejections[0].law, 'THE SCENARIO-BINDING LAW');
        });

        test('a non-array scenarioRefs carrier or a non-string member is bad-scenario-refs-carrier', () => {
                assert.deepStrictEqual(reasons(validateBenchmarkEntry({ ...greenBenchmark(), scenarioRefs: 'nope' })), ['bad-scenario-refs-carrier']);
                const withMember = validateBenchmarkEntry({ ...greenBenchmark(), scenarioRefs: [REAL_SCENARIO_IDS[0], 7] });
                assert.ok(!withMember.ok);
                assert.deepStrictEqual(reasons(withMember), ['bad-scenario-refs-carrier']);
                assert.deepStrictEqual((withMember.rejections[0].items ?? []), ['scenarioRefs[1]']);
        });

        test('repeated scenarioRefs are duplicate-scenario-ref', () => {
                const outcome = validateBenchmarkEntry({ ...greenBenchmark(), scenarioRefs: [REAL_SCENARIO_IDS[0], REAL_SCENARIO_IDS[0]] });
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['duplicate-scenario-ref']);
                assert.deepStrictEqual(outcome.rejections[0].items, [REAL_SCENARIO_IDS[0]]);
        });

        test('THE SCENARIO-BINDING LAW: a fabricated scenario id refuses dangling-scenario-ref at the entry walk', () => {
                const outcome = validateBenchmarkEntry({ ...greenBenchmark(), scenarioRefs: [REAL_SCENARIO_IDS[0] as string, FABRICATED_SCENARIO_ID] });
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['dangling-scenario-ref']);
                assert.equal(outcome.rejections[0].law, 'THE SCENARIO-BINDING LAW');
                assert.deepStrictEqual(outcome.rejections[0].items, [FABRICATED_SCENARIO_ID]);
        });

        test('THE KPI-VOCABULARY LAW: empty kpiDimensions refuse empty-kpi-dimensions (a benchmark measuring nothing is a typed refusal)', () => {
                const outcome = validateBenchmarkEntry({ ...greenBenchmark(), kpiDimensions: [] });
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['empty-kpi-dimensions']);
                assert.equal(outcome.rejections[0].law, 'THE KPI-VOCABULARY LAW');
        });

        test('a non-array kpiDimensions carrier or a non-string member is bad-kpi-dimensions-carrier', () => {
                assert.deepStrictEqual(reasons(validateBenchmarkEntry({ ...greenBenchmark(), kpiDimensions: 'success' })), ['bad-kpi-dimensions-carrier']);
                const withMember = validateBenchmarkEntry({ ...greenBenchmark(), kpiDimensions: ['success', 7] });
                assert.deepStrictEqual(reasons(withMember), ['bad-kpi-dimensions-carrier']);
        });

        test('a non-REAL kpi dimension refuses unknown-kpi-dimension', () => {
                const outcome = validateBenchmarkEntry({ ...greenBenchmark(), kpiDimensions: ['success', 'speed'] });
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['unknown-kpi-dimension']);
                assert.deepStrictEqual(outcome.rejections[0].items, ['speed']);
        });

        test('repeated kpiDimensions are duplicate-kpi-dimension', () => {
                const outcome = validateBenchmarkEntry({ ...greenBenchmark(), kpiDimensions: ['success', 'success'] });
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['duplicate-kpi-dimension']);
        });

        test('THE EVIDENCE-CEILING LAW: each of the four higher rungs refuses evidence-promotion (pinned one by one)', () => {
                for (const rung of ['local-real', 'runtime-real', 'live-provider', 'production-real'] as const) {
                        const outcome = validateBenchmarkEntry({ ...greenBenchmark(), evidenceLevel: rung });
                        assert.ok(!outcome.ok, `the rung '${rung}' must refuse`);
                        assert.deepStrictEqual(reasons(outcome), ['evidence-promotion'], `the rung '${rung}' is the typed evidence-promotion refusal`);
                        assert.equal(outcome.rejections[0].law, 'THE EVIDENCE-CEILING LAW');
                        assert.deepStrictEqual(outcome.rejections[0].items, [rung]);
                }
        });

        test('a value that is not a real ladder rung refuses bad-evidence-level', () => {
                const outcome = validateBenchmarkEntry({ ...greenBenchmark(), evidenceLevel: 'runtime' });
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['bad-evidence-level']);
                assert.equal(outcome.rejections[0].law, 'THE FAIL-CLOSED LAW');
        });

        test('fixture and simulated are the green evidence levels for a benchmark definition', () => {
                assert.ok(validateBenchmarkEntry({ ...greenBenchmark(), evidenceLevel: 'fixture' }).ok);
                assert.ok(validateBenchmarkEntry({ ...greenBenchmark(), evidenceLevel: 'simulated' }).ok);
        });

        test('THE COMPLETE TABLE: one multi-offense entry reports every station in the frozen order', () => {
                const outcome = validateBenchmarkEntry({
                        benchmarkKey: ' k ',
                        summary: '',
                        hypothesis: '',
                        scenarioRefs: [],
                        kpiDimensions: [],
                        expectedOutcome: '',
                        limitations: '',
                        evidenceLevel: 'production-real',
                        tools: 1,
                });
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), [
                        'no-fork',
                        'benchmark-key-whitespace',
                        'summary-length',
                        'hypothesis-length',
                        'empty-scenario-refs',
                        'empty-kpi-dimensions',
                        'expected-outcome-length',
                        'limitations-length',
                        'evidence-promotion',
                ]);
        });
});

suite('benchmarksContract · validateBenchmarksRecord', () => {
        test('a green record validates and the ok copy is canonical', () => {
                const outcome = validateBenchmarksRecord(greenRecord());
                assert.ok(outcome.ok);
                assert.equal(outcome.value.id, 'flauz:ben:0123456789abcdef');
                assert.equal(outcome.value.benchmarks.length, 1);
                assert.deepStrictEqual(outcome.value.benchmarks[0].scenarioRefs, [...REAL_SCENARIO_IDS]);
        });

        test('the canonical serialization order is the frozen six-key record order and the frozen eight-key entry order', () => {
                const bytes = serializeBenchmarksRecord(greenRecord());
                const parsed = JSON.parse(bytes) as Record<string, unknown>;
                assert.deepStrictEqual(Object.keys(parsed), [...BENCHMARKS_RECORD_SCHEMA_KEYS]);
                const firstBenchmark = (parsed.benchmarks as Record<string, unknown>[])[0];
                assert.deepStrictEqual(Object.keys(firstBenchmark), [...BENCHMARK_ENTRY_SCHEMA_KEYS]);
        });

        test('a non-object is the single-station malformed-record table', () => {
                for (const value of [null, 'record', 7, ['x']]) {
                        const outcome = validateBenchmarksRecord(value);
                        assert.ok(!outcome.ok);
                        assert.deepStrictEqual(reasons(outcome), ['malformed-record']);
                }
        });

        test('a non-array benchmarks / history carrier is malformed-record', () => {
                const badBenchmarks = clone(greenRecord());
                badBenchmarks.benchmarks = 'nope';
                assert.deepStrictEqual(reasons(validateBenchmarksRecord(badBenchmarks)), ['malformed-record']);
                const badHistory = clone(greenRecord());
                badHistory.history = 'nope';
                assert.deepStrictEqual(reasons(validateBenchmarksRecord(badHistory)), ['malformed-record']);
        });

        test('a non-object benchmark entry or a non-string text-leg carrier is malformed-record; a non-array scenarioRefs carrier is its own station', () => {
                const badEntry = clone(greenRecord());
                badEntry.benchmarks = [7];
                const badEntryOutcome = validateBenchmarksRecord(badEntry);
                assert.deepStrictEqual(reasons(badEntryOutcome), ['malformed-record']);
                assert.deepStrictEqual(outcomeItems(badEntryOutcome), ['benchmarks[0]']);
                const badCarrier = clone(greenRecord());
                badCarrier.benchmarks = [{ ...greenBenchmark(), hypothesis: 7 }];
                const badCarrierOutcome = validateBenchmarksRecord(badCarrier);
                assert.deepStrictEqual(reasons(badCarrierOutcome), ['malformed-record']);
                assert.deepStrictEqual(outcomeItems(badCarrierOutcome), ['benchmarks[0]:hypothesis']);
                const badLegs = clone(greenRecord());
                badLegs.benchmarks = [{ ...greenBenchmark(), scenarioRefs: 'nope' }];
                assert.deepStrictEqual(reasons(validateBenchmarksRecord(badLegs)), ['bad-scenario-refs-carrier']);
        });

        test('an unknown record key is unknown-key', () => {
                const record = clone(greenRecord());
                record.nope = 1;
                const outcome = validateBenchmarksRecord(record);
                assert.ok(!outcome.ok);
                assert.equal(outcome.rejections[0].reason, 'unknown-key');
                assert.deepStrictEqual(outcome.rejections[0].items, ['nope']);
        });

        test('THE ABSENT-KEY DISCIPLINE: every absent key is missing-key, never a structural station', () => {
                for (const key of [...BENCHMARKS_RECORD_SCHEMA_KEYS]) {
                        const record = clone(greenRecord());
                        delete record[key];
                        const outcome = validateBenchmarksRecord(record);
                        assert.ok(!outcome.ok, `the absent '${key}' must refuse`);
                        assert.deepStrictEqual(reasons(outcome), ['missing-key'], `the absent '${key}' is the missing-key station only`);
                }
        });

        test('bad-harness-id classes refuse through the REAL DH-01 alphabet', () => {
                for (const harnessId of ['flauz:ben:0123456789abcdef', 'flauz:hrn:0123456789ABCDEF', 'flauz:hrn:0123456789abcde', 7]) {
                        const record = clone(greenRecord());
                        record.harnessId = harnessId;
                        assert.deepStrictEqual(reasons(validateBenchmarksRecord(record)), ['bad-harness-id']);
                }
        });

        test('a non-member industry is bad-industry', () => {
                const record = clone(greenRecord());
                record.industry = 'aerospace';
                const outcome = validateBenchmarksRecord(record);
                assert.ok(!outcome.ok);
                assert.equal(outcome.rejections[0].reason, 'bad-industry');
                assert.equal(outcome.rejections[0].law, 'THE FROZEN-VOCABULARY LAW');
        });

        test('a bad stage is bad-stage', () => {
                const record = clone(greenRecord());
                record.stage = 'draft';
                const outcome = validateBenchmarksRecord(record);
                assert.ok(!outcome.ok);
                assert.equal(outcome.rejections[0].reason, 'bad-stage');
                assert.equal(outcome.rejections[0].law, 'THE FORWARD-ONLY LAW');
        });

        test('a malformed history note is bad-history', () => {
                const record = clone(greenRecord());
                record.history = [{ at: '2026-01-01T00:00:00.000Z', fromStage: null, toStage: 'composing', op: 'nope', law: 'THE LAW', detail: 'd' }];
                assert.deepStrictEqual(reasons(validateBenchmarksRecord(record)), ['bad-history']);
        });

        test('per-entry violations surface with the benchmarks[i]: item prefixes', () => {
                const record = greenRecord();
                record.benchmarks = [{ ...greenBenchmark(), benchmarkKey: ' k' }];
                const outcome = validateBenchmarksRecord(record);
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['benchmark-key-whitespace']);
                assert.deepStrictEqual(outcome.rejections[0].items, ['benchmarks[0]:leading/trailing whitespace']);
        });

        test('THE SCENARIO-BINDING LAW in the deep walk: a fabricated scenario id refuses dangling-scenario-ref', () => {
                const record = greenRecord();
                record.benchmarks = [{ ...greenBenchmark(), scenarioRefs: [FABRICATED_SCENARIO_ID] }];
                const outcome = validateBenchmarksRecord(record);
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['dangling-scenario-ref']);
                assert.deepStrictEqual(outcome.rejections[0].items, [`benchmarks[0]:${FABRICATED_SCENARIO_ID}`]);
        });

        test('THE STATION-MAJOR ORDER: an entry no-fork precedes the record schema stations', () => {
                const record = greenRecord();
                record.benchmarks = [{ ...greenBenchmark(), tools: 1 }];
                record.nope = 1;
                const outcome = validateBenchmarksRecord(record);
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['no-fork', 'unknown-key']);
                assert.deepStrictEqual(outcome.rejections[0].items, ['benchmarks[0]:tools']);
        });

        test('THE STATION-MAJOR ORDER: bad-stage and bad-history precede the benchmark family laws', () => {
                const record = greenRecord();
                record.stage = 'draft';
                record.history = [{ at: '2026-01-01T00:00:00.000Z', fromStage: null, toStage: 'composing', op: 'nope', law: 'THE LAW', detail: 'd' }];
                record.benchmarks = [{ ...greenBenchmark(), benchmarkKey: '' }];
                const outcome = validateBenchmarksRecord(record);
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['bad-stage', 'bad-history', 'benchmark-key-length']);
        });

        test('repeated benchmarkKeys are duplicate-benchmark-key', () => {
                const record = greenRecord();
                record.benchmarks = [
                        { ...greenBenchmark(), summary: 'One.' },
                        { ...greenBenchmark(), summary: 'Two.' },
                ];
                const outcome = validateBenchmarksRecord(record);
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['duplicate-benchmark-key']);
                assert.deepStrictEqual(outcome.rejections[0].items, ['regression-suite-health']);
        });

        test('exactly 63 and 64 benchmarks validate (the composition bound)', () => {
                for (const count of [63, 64]) {
                        const record = greenRecord();
                        record.benchmarks = Array.from({ length: count }, (_unused, index) => ({ ...greenBenchmark(), benchmarkKey: `b${String(index).padStart(2, '0')}` }));
                        assert.ok(validateBenchmarksRecord(record).ok, `${count} benchmarks must validate`);
                }
        });

        test('65 benchmarks are max-benchmarks', () => {
                const record = greenRecord();
                record.benchmarks = Array.from({ length: 65 }, (_unused, index) => ({ ...greenBenchmark(), benchmarkKey: `b${String(index).padStart(2, '0')}` }));
                const outcome = validateBenchmarksRecord(record);
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['max-benchmarks']);
                assert.deepStrictEqual(outcome.rejections[0].items, ['65 benchmarks']);
        });

        test('empty benchmarks are LEGAL on the record shape (the floor fires at finalize)', () => {
                const record = greenRecord();
                record.benchmarks = [];
                assert.ok(validateBenchmarksRecord(record).ok);
        });

        test('THE COMPLETE TABLE: a multi-offense record reports every station in the frozen walk order', () => {
                const record = greenRecord();
                record.nope = 1;
                delete record.industry;
                record.harnessId = 'bad';
                record.benchmarks = [
                        { ...greenBenchmark(), summary: 'One.' },
                        { ...greenBenchmark(), summary: 'Two.', kpiDimensions: ['speed'] },
                ];
                const outcome = validateBenchmarksRecord(record);
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['unknown-key', 'missing-key', 'bad-harness-id', 'unknown-kpi-dimension', 'duplicate-benchmark-key']);
        });
});

suite('benchmarksContract · serialization and the fail-closed parse', () => {
        test('the round trip is byte-identical and double-serialize stable', () => {
                const bytes = serializeBenchmarksRecord(greenRecord());
                const parsed = parseBenchmarksRecord(bytes);
                assert.ok(parsed.ok);
                assert.equal(serializeBenchmarksRecord(parsed.record), bytes);
                assert.equal(serializeBenchmarksRecord(JSON.parse(bytes)), bytes);
        });

        test('serialize throws TypeError on a malformed record', () => {
                assert.throws(() => serializeBenchmarksRecord({ nope: 1 }), TypeError);
        });

        test('parse: malformed-json', () => {
                const outcome = parseBenchmarksRecord('{not json');
                assert.ok(!outcome.ok);
                assert.equal(outcome.rejection.reason, 'malformed-json');
        });

        test('parse: non-string bytes are torn-envelope', () => {
                const outcome = parseBenchmarksRecord(7);
                assert.ok(!outcome.ok);
                assert.equal(outcome.rejection.reason, 'torn-envelope');
        });

        test('parse: a missing key is torn-envelope', () => {
                const record = clone(greenRecord());
                delete record.stage;
                const outcome = parseBenchmarksRecord(JSON.stringify(record));
                assert.ok(!outcome.ok);
                assert.equal(outcome.rejection.reason, 'torn-envelope');
        });

        test('parse: a wrong structural type is torn-envelope', () => {
                const record = clone(greenRecord());
                record.benchmarks = 'nope';
                const outcome = parseBenchmarksRecord(JSON.stringify(record));
                assert.ok(!outcome.ok);
                assert.equal(outcome.rejection.reason, 'torn-envelope');
        });

        test('parse: unknown keys at the record / benchmark / note level are unknown-key', () => {
                const atRecord = clone(greenRecord());
                atRecord.nope = 1;
                const atRecordOutcome = parseBenchmarksRecord(JSON.stringify(atRecord));
                assert.equal(atRecordOutcome.ok === true ? 'ok' : atRecordOutcome.rejection.reason, 'unknown-key');
                const atBenchmark = clone(greenRecord());
                atBenchmark.benchmarks = [{ ...greenBenchmark(), tools: 1 }];
                const benchmarkOutcome = parseBenchmarksRecord(JSON.stringify(atBenchmark));
                assert.ok(!benchmarkOutcome.ok);
                assert.equal(benchmarkOutcome.rejection.reason, 'unknown-key');
                const atNote = clone(greenRecord());
                atNote.history = [{ at: '2026-01-01T00:00:00.000Z', fromStage: null, toStage: 'composing', op: 'begin-benchmarks', law: 'THE LAW', detail: 'd', nope: 1 }];
                const noteOutcome = parseBenchmarksRecord(JSON.stringify(atNote));
                assert.ok(!noteOutcome.ok);
                assert.equal(noteOutcome.rejection.reason, 'unknown-key');
        });

        test('parse: a semantically drifted record is invalid-record (a dangling scenario id, an over-rung evidence level)', () => {
                const dangling = clone(greenRecord());
                dangling.benchmarks = [{ ...greenBenchmark(), scenarioRefs: [FABRICATED_SCENARIO_ID] }];
                const danglingOutcome = parseBenchmarksRecord(JSON.stringify(dangling));
                assert.ok(!danglingOutcome.ok);
                assert.equal(danglingOutcome.rejection.reason, 'invalid-record');
                const promoted = clone(greenRecord());
                promoted.benchmarks = [{ ...greenBenchmark(), evidenceLevel: 'live-provider' }];
                const promotedOutcome = parseBenchmarksRecord(JSON.stringify(promoted));
                assert.ok(!promotedOutcome.ok);
                assert.equal(promotedOutcome.rejection.reason, 'invalid-record');
        });

        test('parse: the green round trip carries the canonical copy', () => {
                const outcome = parseBenchmarksRecord(serializeBenchmarksRecord(greenRecord()));
                assert.ok(outcome.ok);
                assert.equal(outcome.record.benchmarks[0].benchmarkKey, 'regression-suite-health');
                assert.deepStrictEqual(Object.keys(outcome.record), [...BENCHMARKS_RECORD_SCHEMA_KEYS]);
                assert.deepStrictEqual(Object.keys(outcome.record.benchmarks[0]), [...BENCHMARK_ENTRY_SCHEMA_KEYS]);
        });
});

suite('benchmarksContract · determinism greps', () => {
        test('Date.now / Math.random / new Date( / process.env appear only on law-comment lines', () => {
                const pattern = /Date\.now|Math\.random|new Date\(|process\.env/;
                const matches = CONTRACT_SOURCE.split('\n').filter((line) => pattern.test(line));
                assert.ok(matches.length > 0, 'the greps must actually match the law-comment lines');
                const offending = matches.filter((line) => {
                        const trimmed = line.trim();
                        return !trimmed.startsWith('*') && !trimmed.startsWith('/*') && !trimmed.startsWith('//');
                });
                assert.deepStrictEqual(offending, [], 'no executable line may carry the forbidden tokens');
        });
});
