/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * DH-009 domain benchmark/simulation-worlds kit battery: the
 * fail-closed factories, the staged op surface (begin/add/replace/
 * remove/finalize/emit) with every refusal class and the
 * record-unchanged law, THE SCENARIO-BINDING boundary against the
 * REAL imported LAB task-world registry (the two-phase law: a
 * fabricated scenario id refuses at add, the finalize boundary and
 * the ledger replay re-prove), the deterministic evaluation surface
 * (instantiateBenchmark reproducibility over two pinned seeds,
 * evaluateBenchmark honest-measure laws and the evidence ceiling,
 * reportCapabilityGaps honesty), THE CROSS-KIT INTEGRATION PINS (the
 * wave crown: the REAL DH-01 harness kit -> this kit over the REAL
 * registry -> the REAL DH-02 review-composition validator), the
 * PIN-2 persistence family (ledger + envelope, torn line, divergent
 * envelope, restart replay, the multi-record ledger, the fresh-kit
 * guard, version drift, the tampered add payload), the
 * frozen-record determinism, the dispose law, and the in-suite
 * determinism greps.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHarnessKit } from '../../../contract/common/domainHarnessKit.js';
import { validateOnboardingReviewComposition } from '../../../onboarding/common/onboardingContract.js';
import { TASK_WORLDS, generateInstances, getScenario } from '../../../../lab/common/taskWorlds.js';
import {
        BENCHMARKS_CONTRACTS_VERSION,
        BENCHMARKS_ENVELOPE_RELATIVE_PATH,
        BENCHMARKS_KIT_REFUSAL_REASONS,
        BENCHMARKS_LEDGER_LINE_SCHEMA_KEYS,
        BENCHMARKS_LEDGER_RELATIVE_PATH,
        createBenchmarksKit,
        loadBenchmarksKit,
} from '../../common/benchmarksKit.js';
import {
        BENCHMARKS_REJECTION_REASONS,
        DOMAIN_HARNESS_CONTRACTS_VERSION,
        LAB_CONTRACTS_VERSION,
        ONBOARDING_CONTRACTS_VERSION,
        ONTOLOGY_CONTRACTS_VERSION,
        ROLES_CONTRACTS_VERSION,
        TEMPLATES_CONTRACTS_VERSION,
        BODIES_CONTRACTS_VERSION,
        PACKS_CONTRACTS_VERSION,
        serializeBenchmarksRecord,
} from '../../common/benchmarksContract.js';
import type { BenchmarksKit, BenchmarksKitRefusal, HarnessFsPort } from '../../common/benchmarksKit.js';

const KIT_SOURCE = readFileSync(fileURLToPath(new URL('../../common/benchmarksKit.ts', import.meta.url)), 'utf8');

const HARNESS_ID = 'flauz:hrn:0123456789abcdef';
const FABRICATED_SCENARIO_ID = 'scenario-se-fabricated-ghost';

/**
 * THE SCENARIO-BINDING LAW's pin-by-import: the scenario ids the
 * fixtures bind to are DERIVED from the REAL imported registry
 * (never a hard-coded list that could drift).
 */
const REAL_SCENARIO_IDS: string[] = TASK_WORLDS.flatMap((world) => world.taskScenarios.map((scenario) => scenario.id));
const REAL_TASK_TYPE_IDS: string[] = REAL_SCENARIO_IDS.map((scenarioId) => (getScenario(scenarioId) as { taskTypeId: string }).taskTypeId);

function makeSeams(): { clock: () => string; rng: () => string; clockReads: () => number; rngReads: () => number } {
        let clockCount = 0;
        let rngCount = 0;
        return {
                clock: () => {
                        clockCount += 1;
                        return `2026-01-01T00:00:${String(clockCount % 60).padStart(2, '0')}.${String(clockCount).padStart(3, '0')}Z`;
                },
                rng: () => {
                        rngCount += 1;
                        return rngCount.toString(16).padStart(16, '0');
                },
                clockReads: () => clockCount,
                rngReads: () => rngCount,
        };
}

/** The in-memory fs port (the DH-01 port shape; a missing file reads as ENOENT). */
class MemoryFsPort {
        private readonly files = new Map<string, string>();
        async readFile(path: string, _encoding: 'utf8'): Promise<string> {
                if (!this.files.has(path)) {
                        throw { code: 'ENOENT', message: `ENOENT: no such file: ${path}` };
                }
                return this.files.get(path) as string;
        }
        async writeFile(path: string, text: string): Promise<void> {
                this.files.set(path, text);
        }
        async appendFile(path: string, text: string): Promise<void> {
                this.files.set(path, (this.files.get(path) ?? '') + text);
        }
        async mkdir(_path: string, _options: { recursive: boolean }): Promise<void> {
                /* the in-memory port is flat - the mkdir is a no-op */
        }
        dump(path: string): string | undefined {
                return this.files.get(path);
        }
        overwrite(path: string, text: string): void {
                this.files.set(path, text);
        }
        remove(path: string): void {
                this.files.delete(path);
        }
}

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

async function beginGreen(kit: BenchmarksKit, harnessId: string = HARNESS_ID): Promise<string> {
        const outcome = await kit.beginBenchmarks(harnessId, 'software');
        if (!outcome.ok) {
                throw new Error(`beginBenchmarks refused: ${outcome.refusal.reason}`);
        }
        assert.equal(outcome.record.stage, 'composing');
        return outcome.record.id;
}

async function addBenchmarkGreen(kit: BenchmarksKit, benchmarksId: string, benchmark: Record<string, unknown> = greenBenchmark()): Promise<void> {
        const outcome = await kit.addBenchmark(benchmarksId, benchmark);
        if (!outcome.ok) {
                throw new Error(`addBenchmark refused: ${outcome.refusal.reason}`);
        }
}

async function finalizeGreen(kit: BenchmarksKit, benchmarksId: string): Promise<void> {
        const outcome = await kit.finalizeBenchmarks(benchmarksId);
        if (!outcome.ok) {
                throw new Error(`finalizeBenchmarks refused: ${outcome.refusal.reason}`);
        }
}

function refusalOf(outcome: { ok: boolean; refusal?: BenchmarksKitRefusal }): BenchmarksKitRefusal {
        if (outcome.ok || outcome.refusal === undefined) {
                throw new Error('expected a refusal outcome');
        }
        return outcome.refusal;
}

async function composeGreenKit(): Promise<{ kit: BenchmarksKit; benchmarksId: string }> {
        const seams = makeSeams();
        const kit = createBenchmarksKit({ clock: seams.clock, rng: seams.rng });
        const benchmarksId = await beginGreen(kit);
        await addBenchmarkGreen(kit, benchmarksId);
        await finalizeGreen(kit, benchmarksId);
        return { kit, benchmarksId };
}

suite('benchmarksKit · factories', () => {
        test('createBenchmarksKit binds the injected seams (green, no persistence)', () => {
                const seams = makeSeams();
                const kit = createBenchmarksKit({ clock: seams.clock, rng: seams.rng });
                assert.equal(typeof kit.disposeBenchmarks, 'function');
        });

        test('factory misuse throws TypeError: the options shape and the seam reads', () => {
                const seams = makeSeams();
                assert.throws(() => createBenchmarksKit(null as never), /createBenchmarksKit: options must be an object/);
                assert.throws(() => createBenchmarksKit({ rng: seams.rng } as never), /options\.clock must be a function/);
                assert.throws(() => createBenchmarksKit({ clock: seams.clock } as never), /options\.rng must be a function/);
                assert.throws(() => createBenchmarksKit({ clock: () => '', rng: seams.rng } as never), /options\.clock\(\) must return a non-empty ISO string/);
                assert.throws(() => createBenchmarksKit({ clock: seams.clock, rng: () => 'nope' } as never), /options\.rng\(\) must return exactly 16 lowercase hex chars/);
        });

        test('factory misuse throws TypeError: the fsPort / root pairing', () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                assert.throws(() => createBenchmarksKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort } as never), /come together or not at all/);
                assert.throws(() => createBenchmarksKit({ clock: seams.clock, rng: seams.rng, root: 'ws' } as never), /come together or not at all/);
                assert.throws(() => createBenchmarksKit({ clock: seams.clock, rng: seams.rng, fsPort: {} as HarnessFsPort, root: 'ws' } as never), /options\.fsPort\.readFile must be a function/);
                assert.throws(() => createBenchmarksKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: '' } as never), /options\.root must be a non-empty string/);
        });

        test('the factory consumes exactly ONE clock read and ONE rng read', () => {
                const seams = makeSeams();
                createBenchmarksKit({ clock: seams.clock, rng: seams.rng });
                assert.equal(seams.clockReads(), 1);
                assert.equal(seams.rngReads(), 1);
        });

        test('loadBenchmarksKit requires BOTH fsPort and root', async () => {
                const seams = makeSeams();
                // loadBenchmarksKit is ASYNC - its TypeError surfaces as a rejected
                // promise; assert.rejects is the correct channel (the landed precedent).
                await assert.rejects(loadBenchmarksKit({ clock: seams.clock, rng: seams.rng } as never), /loadBenchmarksKit: options\.fsPort and options\.root are both required/);
        });

        test('a fresh root (no files) reopens as an empty kit', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const outcome = await loadBenchmarksKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(outcome.ok);
                const listed = await outcome.kit.listBenchmarksSessions();
                assert.ok(listed.ok);
                assert.deepStrictEqual(listed.records, []);
        });

        test('the kit re-carries the nine version pins (this family + the seven landed families + the REAL LAB pin)', () => {
                assert.equal(BENCHMARKS_CONTRACTS_VERSION, '1.0.0');
                assert.equal(DOMAIN_HARNESS_CONTRACTS_VERSION, '1.0.0');
                assert.equal(ONBOARDING_CONTRACTS_VERSION, '1.0.0');
                assert.equal(ROLES_CONTRACTS_VERSION, '1.0.0');
                assert.equal(ONTOLOGY_CONTRACTS_VERSION, '1.0.0');
                assert.equal(TEMPLATES_CONTRACTS_VERSION, '1.0.0');
                assert.equal(BODIES_CONTRACTS_VERSION, '1.0.0');
                assert.equal(PACKS_CONTRACTS_VERSION, '1.0.0');
                assert.equal(LAB_CONTRACTS_VERSION, '1.0.0');
        });

        test('BENCHMARKS_KIT_REFUSAL_REASONS is the contract list plus the frozen extras', () => {
                const all = Array.from(BENCHMARKS_KIT_REFUSAL_REASONS);
                assert.deepStrictEqual(all.slice(0, BENCHMARKS_REJECTION_REASONS.length), Array.from(BENCHMARKS_REJECTION_REASONS));
                assert.deepStrictEqual(all.slice(BENCHMARKS_REJECTION_REASONS.length), [
                        'unknown-record',
                        'version-mismatch',
                        'empty-benchmarks',
                        'premature-op',
                        'stale-stage',
                        'unknown-benchmark',
                        'bad-instance-request',
                        'malformed-measures',
                        'unknown-dimension',
                        'undeclared-dimension',
                        'malformed-measure-value',
                        'missing-measure',
                        'duplicate-measure',
                        'malformed-inventory',
                        'DISPOSED',
                        'CORRUPT_SEAM',
                        'E_LEDGER_TORN',
                        'E_ENVELOPE_MISMATCH',
                        'BENCHMARKS_IO',
                        'UNKNOWN_FILTER',
                ]);
        });
});

suite('benchmarksKit · beginBenchmarks', () => {
        test('green: mints flauz:ben:<16-hex>, composing, ZERO benchmarks, the begin note', async () => {
                const seams = makeSeams();
                const kit = createBenchmarksKit({ clock: seams.clock, rng: seams.rng });
                const outcome = await kit.beginBenchmarks(HARNESS_ID, 'software');
                assert.ok(outcome.ok);
                assert.match(outcome.record.id, /^flauz:ben:[0-9a-f]{16}$/);
                assert.equal(outcome.record.harnessId, HARNESS_ID);
                assert.equal(outcome.record.industry, 'software');
                assert.equal(outcome.record.stage, 'composing');
                assert.deepStrictEqual(outcome.record.benchmarks, []);
                assert.equal(outcome.record.history.length, 1);
                assert.equal(outcome.record.history[0].fromStage, null);
                assert.equal(outcome.record.history[0].toStage, 'composing');
                assert.equal(outcome.record.history[0].op, 'begin-benchmarks');
        });

        test('bad-harness-id refuses (the REAL DH-01 alphabet)', async () => {
                const seams = makeSeams();
                const kit = createBenchmarksKit({ clock: seams.clock, rng: seams.rng });
                for (const harnessId of ['flauz:ben:0123456789abcdef', 'flauz:hrn:0123456789ABCDEF', 7]) {
                        const refusal = refusalOf(await kit.beginBenchmarks(harnessId, 'software'));
                        assert.equal(refusal.reason, 'bad-harness-id');
                }
        });

        test('bad-industry refuses', async () => {
                const seams = makeSeams();
                const kit = createBenchmarksKit({ clock: seams.clock, rng: seams.rng });
                const refusal = refusalOf(await kit.beginBenchmarks(HARNESS_ID, 'aerospace'));
                assert.equal(refusal.reason, 'bad-industry');
                assert.equal(refusal.law, 'THE FROZEN-VOCABULARY LAW');
        });

        test('CORRUPT_SEAM: a non-16-hex rng read or a duplicate minted id', async () => {
                const bad = createBenchmarksKit({ clock: () => '2026-01-01T00:00:00.000Z', rng: () => '0123456789abcdef' });
                const first = await bad.beginBenchmarks(HARNESS_ID, 'software');
                assert.ok(first.ok);
                const second = refusalOf(await bad.beginBenchmarks(HARNESS_ID, 'software'));
                assert.equal(second.reason, 'CORRUPT_SEAM');
                let call = 0;
                const flip = createBenchmarksKit({ clock: () => '2026-01-01T00:00:00.000Z', rng: () => (call++ === 0 ? '0123456789abcdef' : 'zzz') });
                const refusal = refusalOf(await flip.beginBenchmarks(HARNESS_ID, 'software'));
                assert.equal(refusal.reason, 'CORRUPT_SEAM');
        });
});

suite('benchmarksKit · addBenchmark', () => {
        test('green: the benchmark lands with the add-benchmark self-edge note', async () => {
                const seams = makeSeams();
                const kit = createBenchmarksKit({ clock: seams.clock, rng: seams.rng });
                const benchmarksId = await beginGreen(kit);
                const outcome = await kit.addBenchmark(benchmarksId, greenBenchmark());
                assert.ok(outcome.ok);
                assert.equal(outcome.record.benchmarks.length, 1);
                assert.deepStrictEqual(outcome.record.benchmarks[0].scenarioRefs, [...REAL_SCENARIO_IDS]);
                const note = outcome.record.history[outcome.record.history.length - 1];
                assert.equal(note.op, 'add-benchmark');
                assert.equal(note.fromStage, 'composing');
                assert.equal(note.toStage, 'composing');
        });

        test('THE TWO-PHASE LAW, station 1: a fabricated scenario id refuses AT ADD (the REAL registry binding)', async () => {
                const seams = makeSeams();
                const kit = createBenchmarksKit({ clock: seams.clock, rng: seams.rng });
                const benchmarksId = await beginGreen(kit);
                const before = await kit.inspectBenchmarks(benchmarksId);
                const refusal = refusalOf(await kit.addBenchmark(benchmarksId, { ...greenBenchmark(), scenarioRefs: [REAL_SCENARIO_IDS[0] as string, FABRICATED_SCENARIO_ID] }));
                assert.equal(refusal.reason, 'dangling-scenario-ref');
                assert.equal(refusal.law, 'THE SCENARIO-BINDING LAW');
                assert.deepStrictEqual(refusal.items, [FABRICATED_SCENARIO_ID]);
                assert.ok(refusal.rejections !== undefined);
                assert.ok(refusal.rejections.some((rejection) => rejection.reason === 'dangling-scenario-ref'));
                assert.deepStrictEqual(await kit.inspectBenchmarks(benchmarksId), before);
        });

        test('THE ENTRY FLOOR: empty scenarioRefs refuse at add (a benchmark with no scenario measures nothing)', async () => {
                const seams = makeSeams();
                const kit = createBenchmarksKit({ clock: seams.clock, rng: seams.rng });
                const benchmarksId = await beginGreen(kit);
                const refusal = refusalOf(await kit.addBenchmark(benchmarksId, { ...greenBenchmark(), scenarioRefs: [] }));
                assert.equal(refusal.reason, 'empty-scenario-refs');
        });

        test('a payload refusal carries the COMPLETE rejection table and leaves the record unchanged', async () => {
                const seams = makeSeams();
                const kit = createBenchmarksKit({ clock: seams.clock, rng: seams.rng });
                const benchmarksId = await beginGreen(kit);
                await addBenchmarkGreen(kit, benchmarksId, { ...greenBenchmark(), benchmarkKey: 'core' });
                const before = await kit.inspectBenchmarks(benchmarksId);
                const refusal = refusalOf(await kit.addBenchmark(benchmarksId, {
                        benchmarkKey: ' x ',
                        summary: '',
                        hypothesis: '',
                        scenarioRefs: [],
                        kpiDimensions: [],
                        expectedOutcome: '',
                        limitations: '',
                        evidenceLevel: 'fixture',
                        tools: 1,
                }));
                assert.equal(refusal.reason, 'no-fork');
                assert.ok(refusal.rejections !== undefined);
                assert.deepStrictEqual(refusal.rejections.map((rejection) => rejection.reason), [
                        'no-fork',
                        'benchmark-key-whitespace',
                        'summary-length',
                        'hypothesis-length',
                        'empty-scenario-refs',
                        'empty-kpi-dimensions',
                        'expected-outcome-length',
                        'limitations-length',
                ]);
                assert.deepStrictEqual(await kit.inspectBenchmarks(benchmarksId), before);
        });

        test('duplicate-benchmark-key refuses and leaves the record unchanged', async () => {
                const seams = makeSeams();
                const kit = createBenchmarksKit({ clock: seams.clock, rng: seams.rng });
                const benchmarksId = await beginGreen(kit);
                await addBenchmarkGreen(kit, benchmarksId);
                const before = await kit.inspectBenchmarks(benchmarksId);
                const refusal = refusalOf(await kit.addBenchmark(benchmarksId, { ...greenBenchmark(), summary: 'Again.' }));
                assert.equal(refusal.reason, 'duplicate-benchmark-key');
                assert.deepStrictEqual(refusal.items, ['regression-suite-health']);
                assert.deepStrictEqual(await kit.inspectBenchmarks(benchmarksId), before);
        });

        test('exactly 64 benchmarks compose; the 65th refuses max-benchmarks', async () => {
                const seams = makeSeams();
                const kit = createBenchmarksKit({ clock: seams.clock, rng: seams.rng });
                const benchmarksId = await beginGreen(kit);
                for (let index = 0; index < 64; index += 1) {
                        await addBenchmarkGreen(kit, benchmarksId, { ...greenBenchmark(), benchmarkKey: `b${String(index).padStart(2, '0')}` });
                }
                const refusal = refusalOf(await kit.addBenchmark(benchmarksId, { ...greenBenchmark(), benchmarkKey: 'b65' }));
                assert.equal(refusal.reason, 'max-benchmarks');
                assert.ok((refusal.items ?? [])[0]?.includes('64 benchmarks'));
        });

        test('unknown-record (malformed or unresolved id) and stale-stage refuse', async () => {
                const seams = makeSeams();
                const kit = createBenchmarksKit({ clock: seams.clock, rng: seams.rng });
                assert.equal(refusalOf(await kit.addBenchmark('nope', greenBenchmark())).reason, 'unknown-record');
                assert.equal(refusalOf(await kit.addBenchmark(7, greenBenchmark())).reason, 'unknown-record');
                const benchmarksId = await beginGreen(kit);
                await addBenchmarkGreen(kit, benchmarksId);
                await finalizeGreen(kit, benchmarksId);
                assert.equal(refusalOf(await kit.addBenchmark(benchmarksId, { ...greenBenchmark(), benchmarkKey: 'late' })).reason, 'stale-stage');
        });
});

suite('benchmarksKit · replaceBenchmarkSummary', () => {
        test('green: ONLY the summary changes (the other seven legs are immutable)', async () => {
                const seams = makeSeams();
                const kit = createBenchmarksKit({ clock: seams.clock, rng: seams.rng });
                const benchmarksId = await beginGreen(kit);
                await addBenchmarkGreen(kit, benchmarksId);
                const outcome = await kit.replaceBenchmarkSummary(benchmarksId, 'regression-suite-health', 'The refreshed summary.');
                assert.ok(outcome.ok);
                assert.equal(outcome.record.benchmarks[0].summary, 'The refreshed summary.');
                assert.equal(outcome.record.benchmarks[0].hypothesis, greenBenchmark().hypothesis);
                assert.deepStrictEqual(outcome.record.benchmarks[0].scenarioRefs, [...REAL_SCENARIO_IDS]);
                const note = outcome.record.history[outcome.record.history.length - 1];
                assert.equal(note.op, 'replace-benchmark-summary');
                assert.equal(note.law, 'THE REMOVE+RE-ADD LAW');
        });

        test('unknown-benchmark refuses (missing or malformed benchmarkKey)', async () => {
                const seams = makeSeams();
                const kit = createBenchmarksKit({ clock: seams.clock, rng: seams.rng });
                const benchmarksId = await beginGreen(kit);
                await addBenchmarkGreen(kit, benchmarksId);
                assert.equal(refusalOf(await kit.replaceBenchmarkSummary(benchmarksId, 'ghost', 's.')).reason, 'unknown-benchmark');
                assert.equal(refusalOf(await kit.replaceBenchmarkSummary(benchmarksId, 7, 's.')).reason, 'unknown-benchmark');
        });

        test('an invalid summary carries the COMPLETE table and leaves the record unchanged', async () => {
                const seams = makeSeams();
                const kit = createBenchmarksKit({ clock: seams.clock, rng: seams.rng });
                const benchmarksId = await beginGreen(kit);
                await addBenchmarkGreen(kit, benchmarksId);
                const before = await kit.inspectBenchmarks(benchmarksId);
                const refusal = refusalOf(await kit.replaceBenchmarkSummary(benchmarksId, 'regression-suite-health', ''));
                assert.equal(refusal.reason, 'summary-length');
                assert.deepStrictEqual(refusal.rejections?.map((rejection) => rejection.reason), ['summary-length']);
                assert.deepStrictEqual(await kit.inspectBenchmarks(benchmarksId), before);
        });

        test('stale-stage refuses on a composed record', async () => {
                const { kit, benchmarksId } = await composeGreenKit();
                assert.equal(refusalOf(await kit.replaceBenchmarkSummary(benchmarksId, 'regression-suite-health', 's.')).reason, 'stale-stage');
        });
});

suite('benchmarksKit · removeBenchmark', () => {
        test('green: the benchmark leaves with the remove note', async () => {
                const seams = makeSeams();
                const kit = createBenchmarksKit({ clock: seams.clock, rng: seams.rng });
                const benchmarksId = await beginGreen(kit);
                await addBenchmarkGreen(kit, benchmarksId);
                const outcome = await kit.removeBenchmark(benchmarksId, 'regression-suite-health');
                assert.ok(outcome.ok);
                assert.deepStrictEqual(outcome.record.benchmarks, []);
                assert.equal(outcome.record.history[outcome.record.history.length - 1].op, 'remove-benchmark');
        });

        test('removing the LAST benchmark is LEGAL while composing; the floor never dips below zero', async () => {
                const seams = makeSeams();
                const kit = createBenchmarksKit({ clock: seams.clock, rng: seams.rng });
                const benchmarksId = await beginGreen(kit);
                await addBenchmarkGreen(kit, benchmarksId);
                assert.ok((await kit.removeBenchmark(benchmarksId, 'regression-suite-health')).ok);
                assert.equal(refusalOf(await kit.removeBenchmark(benchmarksId, 'regression-suite-health')).reason, 'unknown-benchmark');
        });

        test('unknown-benchmark refuses', async () => {
                const seams = makeSeams();
                const kit = createBenchmarksKit({ clock: seams.clock, rng: seams.rng });
                const benchmarksId = await beginGreen(kit);
                assert.equal(refusalOf(await kit.removeBenchmark(benchmarksId, 'ghost')).reason, 'unknown-benchmark');
        });

        test('THE REMOVE+RE-ADD LAW: a changed benchmarkKey is a NEW benchmark (remove, then re-add)', async () => {
                const seams = makeSeams();
                const kit = createBenchmarksKit({ clock: seams.clock, rng: seams.rng });
                const benchmarksId = await beginGreen(kit);
                await addBenchmarkGreen(kit, benchmarksId);
                assert.ok((await kit.removeBenchmark(benchmarksId, 'regression-suite-health')).ok);
                assert.ok((await kit.addBenchmark(benchmarksId, { ...greenBenchmark(), benchmarkKey: 'flaky-suite-health' })).ok);
                const outcome = await kit.inspectBenchmarks(benchmarksId);
                assert.ok(outcome.ok);
                assert.equal(outcome.record.benchmarks.length, 1);
                assert.equal(outcome.record.benchmarks[0].benchmarkKey, 'flaky-suite-health');
        });
});

suite('benchmarksKit · finalizeBenchmarks', () => {
        test('the empty-benchmarks floor refuses empty-benchmarks (never the record shape)', async () => {
                const seams = makeSeams();
                const kit = createBenchmarksKit({ clock: seams.clock, rng: seams.rng });
                const benchmarksId = await beginGreen(kit);
                const before = await kit.inspectBenchmarks(benchmarksId);
                const refusal = refusalOf(await kit.finalizeBenchmarks(benchmarksId));
                assert.equal(refusal.reason, 'empty-benchmarks');
                assert.ok(refusal.detail.includes('fires HERE'));
                assert.deepStrictEqual(await kit.inspectBenchmarks(benchmarksId), before);
        });

        test('THE TWO-PHASE LAW, station 2: green finalize re-proves the scenario binding and the vocabulary legs', async () => {
                const seams = makeSeams();
                const kit = createBenchmarksKit({ clock: seams.clock, rng: seams.rng });
                const benchmarksId = await beginGreen(kit);
                await addBenchmarkGreen(kit, benchmarksId);
                const outcome = await kit.finalizeBenchmarks(benchmarksId);
                assert.ok(outcome.ok);
                assert.equal(outcome.record.stage, 'composed');
                assert.equal(outcome.record.benchmarks.length, 1);
                const note = outcome.record.history[outcome.record.history.length - 1];
                assert.equal(note.op, 'finalize-benchmarks');
                assert.equal(note.fromStage, 'composing');
                assert.equal(note.toStage, 'composed');
                assert.equal(note.law, 'THE SCENARIO-BINDING LAW');
        });

        test('after compose: every mutating op refuses stale-stage', async () => {
                const { kit, benchmarksId } = await composeGreenKit();
                assert.equal(refusalOf(await kit.addBenchmark(benchmarksId, { ...greenBenchmark(), benchmarkKey: 'late' })).reason, 'stale-stage');
                assert.equal(refusalOf(await kit.replaceBenchmarkSummary(benchmarksId, 'regression-suite-health', 's.')).reason, 'stale-stage');
                assert.equal(refusalOf(await kit.removeBenchmark(benchmarksId, 'regression-suite-health')).reason, 'stale-stage');
                assert.equal(refusalOf(await kit.finalizeBenchmarks(benchmarksId)).reason, 'stale-stage');
        });

        test('the frozen-record semantics: two finalize runs over identical seams serialize byte-equal', async () => {
                const first = await composeGreenKit();
                const second = await composeGreenKit();
                const firstRecord = await first.kit.inspectBenchmarks(first.benchmarksId);
                const secondRecord = await second.kit.inspectBenchmarks(second.benchmarksId);
                assert.ok(firstRecord.ok && secondRecord.ok);
                assert.equal(serializeBenchmarksRecord(firstRecord.record), serializeBenchmarksRecord(secondRecord.record));
        });

        test('a finalized record re-serializes byte-identically across a deep copy (the canonical bytes)', async () => {
                const { kit, benchmarksId } = await composeGreenKit();
                const outcome = await kit.inspectBenchmarks(benchmarksId);
                assert.ok(outcome.ok);
                const bytes = serializeBenchmarksRecord(outcome.record);
                assert.equal(serializeBenchmarksRecord(JSON.parse(bytes)), bytes);
        });
});

suite('benchmarksKit · emitEvidenceRef', () => {
        test('premature-op on a composing record (the ref is emitted only from a COMPOSED record)', async () => {
                const seams = makeSeams();
                const kit = createBenchmarksKit({ clock: seams.clock, rng: seams.rng });
                const benchmarksId = await beginGreen(kit);
                const refusal = refusalOf(await kit.emitEvidenceRef(benchmarksId));
                assert.equal(refusal.reason, 'premature-op');
                assert.equal(refusal.law, 'THE FORWARD-ONLY LAW');
        });

        test('green on a composed record: the evidenceRef is the record id', async () => {
                const { kit, benchmarksId } = await composeGreenKit();
                const emitted = await kit.emitEvidenceRef(benchmarksId);
                assert.ok(emitted.ok);
                assert.equal(emitted.evidenceRef, benchmarksId);
                assert.match(emitted.evidenceRef, /^flauz:ben:[0-9a-f]{16}$/);
        });

        test('unknown-record refuses', async () => {
                const seams = makeSeams();
                const kit = createBenchmarksKit({ clock: seams.clock, rng: seams.rng });
                assert.equal(refusalOf(await kit.emitEvidenceRef('nope')).reason, 'unknown-record');
        });
});

suite('benchmarksKit · instantiateBenchmark (THE REPRODUCIBILITY LAW)', () => {
        test('premature-op on a composing record (the streams of a frozen definition only)', async () => {
                const seams = makeSeams();
                const kit = createBenchmarksKit({ clock: seams.clock, rng: seams.rng });
                const benchmarksId = await beginGreen(kit);
                await addBenchmarkGreen(kit, benchmarksId);
                assert.equal(refusalOf(await kit.instantiateBenchmark(benchmarksId, 'regression-suite-health', 7, 4)).reason, 'premature-op');
        });

        test('unknown-benchmark refuses (a malformed benchmarkKey fails closed as unknown)', async () => {
                const { kit, benchmarksId } = await composeGreenKit();
                assert.equal(refusalOf(await kit.instantiateBenchmark(benchmarksId, 'ghost', 7, 4)).reason, 'unknown-benchmark');
                assert.equal(refusalOf(await kit.instantiateBenchmark(benchmarksId, 7, 7, 4)).reason, 'unknown-benchmark');
        });

        test('bad-instance-request: a non-integer seed or a non-positive-integer count', async () => {
                const { kit, benchmarksId } = await composeGreenKit();
                const seedRefusal = refusalOf(await kit.instantiateBenchmark(benchmarksId, 'regression-suite-health', 7.5, 4));
                assert.equal(seedRefusal.reason, 'bad-instance-request');
                assert.deepStrictEqual(seedRefusal.items, ['seed']);
                for (const count of [0, -1, 2.5]) {
                        const countRefusal = refusalOf(await kit.instantiateBenchmark(benchmarksId, 'regression-suite-health', 7, count));
                        assert.equal(countRefusal.reason, 'bad-instance-request');
                        assert.deepStrictEqual(countRefusal.items, ['count']);
                }
                const bothRefusal = refusalOf(await kit.instantiateBenchmark(benchmarksId, 'regression-suite-health', 'seven', 0));
                assert.deepStrictEqual(bothRefusal.items, ['seed', 'count']);
        });

        test('green: the bundle delegates to the REAL generateInstances per scenarioRef, in entry order', async () => {
                const { kit, benchmarksId } = await composeGreenKit();
                const outcome = await kit.instantiateBenchmark(benchmarksId, 'regression-suite-health', 7, 4);
                assert.ok(outcome.ok);
                const bundle = outcome.bundle;
                assert.equal(bundle.benchmarkKey, 'regression-suite-health');
                assert.equal(bundle.seed, 7);
                assert.equal(bundle.count, 4);
                assert.equal(bundle.scenarioInstances.length, REAL_SCENARIO_IDS.length);
                for (let i = 0; i < REAL_SCENARIO_IDS.length; i += 1) {
                        const scenarioInstances = bundle.scenarioInstances[i];
                        const scenarioId = REAL_SCENARIO_IDS[i] as string;
                        assert.equal(scenarioInstances.scenarioId, scenarioId);
                        assert.deepStrictEqual(scenarioInstances.instances, generateInstances(scenarioId, 7, 4));
                }
        });

        test('THE REPRODUCIBILITY LAW: same seed -> byte-identical bundle (pinned twice)', async () => {
                const { kit, benchmarksId } = await composeGreenKit();
                const first = await kit.instantiateBenchmark(benchmarksId, 'regression-suite-health', 7, 4);
                const second = await kit.instantiateBenchmark(benchmarksId, 'regression-suite-health', 7, 4);
                assert.ok(first.ok && second.ok);
                assert.deepStrictEqual(first.bundle, second.bundle);
                assert.equal(JSON.stringify(first.bundle), JSON.stringify(second.bundle));
        });

        test('THE REPRODUCIBILITY LAW: two different seeds -> different bundles (seed 7 and seed 11 pinned)', async () => {
                const { kit, benchmarksId } = await composeGreenKit();
                const seedSeven = await kit.instantiateBenchmark(benchmarksId, 'regression-suite-health', 7, 4);
                const seedEleven = await kit.instantiateBenchmark(benchmarksId, 'regression-suite-health', 11, 4);
                assert.ok(seedSeven.ok && seedEleven.ok);
                assert.notEqual(JSON.stringify(seedSeven.bundle), JSON.stringify(seedEleven.bundle));
                assert.equal(seedSeven.bundle.seed, 7);
                assert.equal(seedEleven.bundle.seed, 11);
                for (let i = 0; i < REAL_SCENARIO_IDS.length; i += 1) {
                        const scenarioId = REAL_SCENARIO_IDS[i] as string;
                        assert.deepStrictEqual(seedSeven.bundle.scenarioInstances[i].instances, generateInstances(scenarioId, 7, 4));
                        assert.deepStrictEqual(seedEleven.bundle.scenarioInstances[i].instances, generateInstances(scenarioId, 11, 4));
                }
        });

        test('the read surface consumes NO clock read and NO rng read and lands no ledger line', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const kit = createBenchmarksKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                const benchmarksId = await beginGreen(kit);
                await addBenchmarkGreen(kit, benchmarksId);
                await finalizeGreen(kit, benchmarksId);
                const clockAfterCompose = seams.clockReads();
                const rngAfterCompose = seams.rngReads();
                const ledgerLines = (port.dump(`ws/${BENCHMARKS_LEDGER_RELATIVE_PATH}`) as string).split('\n').length - 1;
                await kit.instantiateBenchmark(benchmarksId, 'regression-suite-health', 7, 2);
                await kit.evaluateBenchmark(benchmarksId, 'regression-suite-health', [{ dimension: 'success', value: 0.5 }, { dimension: 'quality', value: 0.4 }]);
                await kit.reportCapabilityGaps(benchmarksId, []);
                await kit.emitEvidenceRef(benchmarksId);
                await kit.inspectBenchmarks(benchmarksId);
                await kit.listBenchmarksSessions();
                assert.equal(seams.clockReads(), clockAfterCompose);
                assert.equal(seams.rngReads(), rngAfterCompose);
                assert.equal((port.dump(`ws/${BENCHMARKS_LEDGER_RELATIVE_PATH}`) as string).split('\n').length - 1, ledgerLines);
        });
});

suite('benchmarksKit · evaluateBenchmark (THE HONEST-MEASURE LAW)', () => {
        test('premature-op on a composing record and unknown-benchmark refuse', async () => {
                const seams = makeSeams();
                const kit = createBenchmarksKit({ clock: seams.clock, rng: seams.rng });
                const benchmarksId = await beginGreen(kit);
                await addBenchmarkGreen(kit, benchmarksId);
                assert.equal(refusalOf(await kit.evaluateBenchmark(benchmarksId, 'regression-suite-health', [])).reason, 'premature-op');
                const { kit: composedKit, benchmarksId: composedId } = await composeGreenKit();
                assert.equal(refusalOf(await composedKit.evaluateBenchmark(composedId, 'ghost', [])).reason, 'unknown-benchmark');
        });

        test('malformed-measures: a non-array carrier, a non-object row, an extra key, a bad unit', async () => {
                const { kit, benchmarksId } = await composeGreenKit();
                const carrier = refusalOf(await kit.evaluateBenchmark(benchmarksId, 'regression-suite-health', 'nope'));
                assert.equal(carrier.reason, 'malformed-measures');
                assert.deepStrictEqual(carrier.items, ['measures']);
                const nonObject = refusalOf(await kit.evaluateBenchmark(benchmarksId, 'regression-suite-health', [7]));
                assert.equal(nonObject.reason, 'malformed-measures');
                assert.deepStrictEqual(nonObject.items, ['measures[0]']);
                const extraKey = refusalOf(await kit.evaluateBenchmark(benchmarksId, 'regression-suite-health', [{ dimension: 'success', value: 1, invented: true }]));
                assert.equal(extraKey.reason, 'malformed-measures');
                assert.deepStrictEqual(extraKey.items, ['measures[0]:invented']);
                const badUnit = refusalOf(await kit.evaluateBenchmark(benchmarksId, 'regression-suite-health', [{ dimension: 'success', value: 1, unit: '' }]));
                assert.equal(badUnit.reason, 'malformed-measures');
                assert.deepStrictEqual(badUnit.items, ['measures[0]:unit']);
        });

        test('unknown-dimension: a non-REAL dimension refuses (the imported vocabulary)', async () => {
                const { kit, benchmarksId } = await composeGreenKit();
                const refusal = refusalOf(await kit.evaluateBenchmark(benchmarksId, 'regression-suite-health', [
                        { dimension: 'success', value: 1 },
                        { dimension: 'speed', value: 1 },
                ]));
                assert.equal(refusal.reason, 'unknown-dimension');
                assert.equal(refusal.law, 'THE HONEST-MEASURE LAW');
                assert.deepStrictEqual(refusal.items, ['speed']);
        });

        test('undeclared-dimension: a REAL dimension outside the declared kpiDimensions refuses', async () => {
                const { kit, benchmarksId } = await composeGreenKit();
                const refusal = refusalOf(await kit.evaluateBenchmark(benchmarksId, 'regression-suite-health', [
                        { dimension: 'success', value: 1 },
                        { dimension: 'latency', value: 100 },
                ]));
                assert.equal(refusal.reason, 'undeclared-dimension');
                assert.deepStrictEqual(refusal.items, ['latency']);
        });

        test('malformed-measure-value: NaN and Infinity refuse (never a laundered corrupt measure)', async () => {
                const { kit, benchmarksId } = await composeGreenKit();
                const nanRefusal = refusalOf(await kit.evaluateBenchmark(benchmarksId, 'regression-suite-health', [
                        { dimension: 'success', value: Number.NaN },
                        { dimension: 'quality', value: 1 },
                ]));
                assert.equal(nanRefusal.reason, 'malformed-measure-value');
                assert.deepStrictEqual(nanRefusal.items, ['success']);
                const infinityRefusal = refusalOf(await kit.evaluateBenchmark(benchmarksId, 'regression-suite-health', [
                        { dimension: 'success', value: 1 },
                        { dimension: 'quality', value: Number.POSITIVE_INFINITY },
                ]));
                assert.equal(infinityRefusal.reason, 'malformed-measure-value');
                assert.deepStrictEqual(infinityRefusal.items, ['quality']);
        });

        test('duplicate-measure: two rows claiming one dimension refuse', async () => {
                const { kit, benchmarksId } = await composeGreenKit();
                const refusal = refusalOf(await kit.evaluateBenchmark(benchmarksId, 'regression-suite-health', [
                        { dimension: 'success', value: 0.9 },
                        { dimension: 'success', value: 0.5 },
                        { dimension: 'quality', value: 0.5 },
                ]));
                assert.equal(refusal.reason, 'duplicate-measure');
                assert.deepStrictEqual(refusal.items, ['success']);
        });

        test('missing-measure: a declared KPI dimension without a caller row refuses (the kit NEVER invents the score)', async () => {
                const { kit, benchmarksId } = await composeGreenKit();
                const refusal = refusalOf(await kit.evaluateBenchmark(benchmarksId, 'regression-suite-health', [
                        { dimension: 'success', value: 0.9 },
                ]));
                assert.equal(refusal.reason, 'missing-measure');
                assert.equal(refusal.law, 'THE HONEST-MEASURE LAW');
                assert.deepStrictEqual(refusal.items, ['quality']);
        });

        test('green: the scores compose in the benchmark\'s canonical kpiDimensions order with the caller values and units', async () => {
                const { kit, benchmarksId } = await composeGreenKit();
                const outcome = await kit.evaluateBenchmark(benchmarksId, 'regression-suite-health', [
                        { dimension: 'quality', value: 0.62, unit: 'ratio' },
                        { dimension: 'success', value: 0.75 },
                ]);
                assert.ok(outcome.ok);
                assert.equal(outcome.result.benchmarksId, benchmarksId);
                assert.equal(outcome.result.harnessId, HARNESS_ID);
                assert.equal(outcome.result.benchmarkKey, 'regression-suite-health');
                assert.deepStrictEqual(outcome.result.scores, [
                        { dimension: 'success', value: 0.75 },
                        { dimension: 'quality', value: 0.62, unit: 'ratio' },
                ]);
                assert.equal(outcome.result.evidenceLevel, 'fixture');
        });

        test('the evidence walk: an absent claim inherits the benchmark\'s own rung; an equal claim is carried verbatim', async () => {
                const seams = makeSeams();
                const kit = createBenchmarksKit({ clock: seams.clock, rng: seams.rng });
                const benchmarksId = await beginGreen(kit);
                await addBenchmarkGreen(kit, benchmarksId, { ...greenBenchmark(), evidenceLevel: 'simulated' });
                await finalizeGreen(kit, benchmarksId);
                const measures = [{ dimension: 'success', value: 1 }, { dimension: 'quality', value: 1 }];
                const absent = await kit.evaluateBenchmark(benchmarksId, 'regression-suite-health', measures);
                assert.ok(absent.ok);
                assert.equal(absent.result.evidenceLevel, 'simulated');
                const equal = await kit.evaluateBenchmark(benchmarksId, 'regression-suite-health', measures, 'simulated');
                assert.ok(equal.ok);
                assert.equal(equal.result.evidenceLevel, 'simulated');
        });

        test('the evidence walk: a claim BELOW the benchmark\'s rung is the honest floor (carried verbatim, never promoted)', async () => {
                const seams = makeSeams();
                const kit = createBenchmarksKit({ clock: seams.clock, rng: seams.rng });
                const benchmarksId = await beginGreen(kit);
                await addBenchmarkGreen(kit, benchmarksId, { ...greenBenchmark(), evidenceLevel: 'simulated' });
                await finalizeGreen(kit, benchmarksId);
                const outcome = await kit.evaluateBenchmark(benchmarksId, 'regression-suite-health', [
                        { dimension: 'success', value: 1 },
                        { dimension: 'quality', value: 1 },
                ], 'fixture');
                assert.ok(outcome.ok);
                assert.equal(outcome.result.evidenceLevel, 'fixture');
        });

        test('THE EVIDENCE-CEILING LAW: each of the four higher rungs is the typed evidence-promotion refusal (pinned one by one)', async () => {
                const { kit, benchmarksId } = await composeGreenKit();
                for (const rung of ['local-real', 'runtime-real', 'live-provider', 'production-real'] as const) {
                        const refusal = refusalOf(await kit.evaluateBenchmark(benchmarksId, 'regression-suite-health', [
                                { dimension: 'success', value: 1 },
                                { dimension: 'quality', value: 1 },
                        ], rung));
                        assert.equal(refusal.reason, 'evidence-promotion', `the rung '${rung}' must refuse`);
                        assert.equal(refusal.law, 'THE EVIDENCE-CEILING LAW');
                        assert.deepStrictEqual(refusal.items, [rung]);
                }
        });

        test('THE EVIDENCE-CEILING LAW: a claim above the benchmark\'s own rung (simulated over fixture) is evidence-promotion; a non-rung claim is bad-evidence-level', async () => {
                const { kit, benchmarksId } = await composeGreenKit();
                const measures = [{ dimension: 'success', value: 1 }, { dimension: 'quality', value: 1 }];
                const promotion = refusalOf(await kit.evaluateBenchmark(benchmarksId, 'regression-suite-health', measures, 'simulated'));
                assert.equal(promotion.reason, 'evidence-promotion');
                assert.deepStrictEqual(promotion.items, ['simulated']);
                const nonRung = refusalOf(await kit.evaluateBenchmark(benchmarksId, 'regression-suite-health', measures, 'runtime'));
                assert.equal(nonRung.reason, 'bad-evidence-level');
        });
});

suite('benchmarksKit · reportCapabilityGaps (THE CAPABILITY-GAP HONESTY LAW)', () => {
        test('premature-op on a composing record and unknown-record refuse', async () => {
                const seams = makeSeams();
                const kit = createBenchmarksKit({ clock: seams.clock, rng: seams.rng });
                const benchmarksId = await beginGreen(kit);
                await addBenchmarkGreen(kit, benchmarksId);
                assert.equal(refusalOf(await kit.reportCapabilityGaps(benchmarksId, [])).reason, 'premature-op');
                assert.equal(refusalOf(await kit.reportCapabilityGaps('nope', [])).reason, 'unknown-record');
        });

        test('malformed-inventory: a non-array carrier or a non-string member refuses (never a silent skip)', async () => {
                const { kit, benchmarksId } = await composeGreenKit();
                const carrier = refusalOf(await kit.reportCapabilityGaps(benchmarksId, 'nope'));
                assert.equal(carrier.reason, 'malformed-inventory');
                assert.equal(carrier.law, 'THE CAPABILITY-GAP HONESTY LAW');
                const member = refusalOf(await kit.reportCapabilityGaps(benchmarksId, [REAL_SCENARIO_IDS[0], 7]));
                assert.equal(member.reason, 'malformed-inventory');
                assert.deepStrictEqual(member.items, ['inventory[1]']);
        });

        test('THE ZERO-GAP GREEN PATH: an inventory holding every scenarioRef and every REAL taskTypeId reports the empty ledger', async () => {
                const { kit, benchmarksId } = await composeGreenKit();
                const fullInventory = [...REAL_SCENARIO_IDS, ...REAL_TASK_TYPE_IDS];
                const outcome = await kit.reportCapabilityGaps(benchmarksId, fullInventory);
                assert.ok(outcome.ok);
                assert.deepStrictEqual(outcome.gaps, []);
        });

        test('an empty inventory reports EVERY requirement honestly (scenario refs and REAL taskTypeIds, first-seen order)', async () => {
                const { kit, benchmarksId } = await composeGreenKit();
                const outcome = await kit.reportCapabilityGaps(benchmarksId, []);
                assert.ok(outcome.ok);
                assert.equal(outcome.gaps.length, 1);
                assert.equal(outcome.gaps[0].benchmarkKey, 'regression-suite-health');
                const expected: string[] = [];
                for (const scenarioId of REAL_SCENARIO_IDS) {
                        expected.push(scenarioId);
                        expected.push((getScenario(scenarioId) as { taskTypeId: string }).taskTypeId);
                }
                assert.deepStrictEqual(outcome.gaps[0].missing, expected);
        });

        test('a partial inventory names the missing requirements, never silently dropping them, never inventing any', async () => {
                const seams = makeSeams();
                const kit = createBenchmarksKit({ clock: seams.clock, rng: seams.rng });
                const benchmarksId = await beginGreen(kit);
                await addBenchmarkGreen(kit, benchmarksId, { ...greenBenchmark(), benchmarkKey: 'two-scenario-benchmark', scenarioRefs: [REAL_SCENARIO_IDS[0], REAL_SCENARIO_IDS[1]] });
                await finalizeGreen(kit, benchmarksId);
                // the inventory holds the first scenario and its task type only
                const partial = [REAL_SCENARIO_IDS[0] as string, REAL_TASK_TYPE_IDS[0] as string];
                const outcome = await kit.reportCapabilityGaps(benchmarksId, partial);
                assert.ok(outcome.ok);
                assert.equal(outcome.gaps.length, 1);
                assert.deepStrictEqual(outcome.gaps[0].missing, [REAL_SCENARIO_IDS[1], REAL_TASK_TYPE_IDS[1]]);
                // an inventory holding invented extras still reports the same honest gap
                const withNoise = await kit.reportCapabilityGaps(benchmarksId, ['invented-capability', REAL_SCENARIO_IDS[0] as string, REAL_TASK_TYPE_IDS[0] as string]);
                assert.ok(withNoise.ok);
                assert.deepStrictEqual(withNoise.gaps[0].missing, [REAL_SCENARIO_IDS[1], REAL_TASK_TYPE_IDS[1]]);
        });

        test('a benchmark with nothing missing carries no gap row; a second benchmark with gaps carries its own row', async () => {
                const seams = makeSeams();
                const kit = createBenchmarksKit({ clock: seams.clock, rng: seams.rng });
                const benchmarksId = await beginGreen(kit);
                await addBenchmarkGreen(kit, benchmarksId, { ...greenBenchmark(), scenarioRefs: [REAL_SCENARIO_IDS[0]] });
                await addBenchmarkGreen(kit, benchmarksId, { ...greenBenchmark(), benchmarkKey: 'gapped-benchmark', scenarioRefs: [REAL_SCENARIO_IDS[1]] });
                await finalizeGreen(kit, benchmarksId);
                const inventory = [REAL_SCENARIO_IDS[0] as string, REAL_TASK_TYPE_IDS[0] as string];
                const outcome = await kit.reportCapabilityGaps(benchmarksId, inventory);
                assert.ok(outcome.ok);
                assert.equal(outcome.gaps.length, 1);
                assert.equal(outcome.gaps[0].benchmarkKey, 'gapped-benchmark');
                assert.deepStrictEqual(outcome.gaps[0].missing, [REAL_SCENARIO_IDS[1], REAL_TASK_TYPE_IDS[1]]);
        });
});

suite('benchmarksKit · THE CROSS-KIT INTEGRATION PINS (the wave crown)', () => {
        test('the crown: the REAL harness kit -> this kit over the REAL registry -> instantiate (reproducible) -> evaluate -> gaps -> emit -> the REAL review-composition validator passes', async () => {
                const seams = makeSeams();
                const harnessKit = createHarnessKit({
                        clock: seams.clock,
                        rng: seams.rng,
                        catalog: { capabilities: [], workflowIds: [], policyIds: [], evidenceIds: [] },
                });
                const minted = await harnessKit.mintHarness({
                        industry: 'software',
                        workTypes: ['analysis'],
                        displayName: 'Crown Harness',
                        roles: [
                                { roleKey: 'analyst', summary: 'Runs the domain analysis.' },
                                { roleKey: 'reviewer', summary: 'Reviews the domain work.' },
                        ],
                        capabilityRefs: [],
                        workflowRefs: [],
                        policyRefs: [],
                        evidenceRefs: [],
                });
                assert.ok(minted.ok);
                const harnessId = minted.record.harnessId;
                const kit = createBenchmarksKit({ clock: seams.clock, rng: seams.rng });
                const begun = await kit.beginBenchmarks(harnessId, 'software');
                assert.ok(begun.ok);
                const benchmarksId = begun.record.id;
                assert.ok((await kit.addBenchmark(benchmarksId, greenBenchmark())).ok);
                const finalized = await kit.finalizeBenchmarks(benchmarksId);
                assert.ok(finalized.ok);
                assert.equal(finalized.record.stage, 'composed');
                // THE REPRODUCIBILITY LAW over the pinned seed 7
                const instantiated = await kit.instantiateBenchmark(benchmarksId, 'regression-suite-health', 7, 3);
                assert.ok(instantiated.ok);
                const reInstantiated = await kit.instantiateBenchmark(benchmarksId, 'regression-suite-health', 7, 3);
                assert.ok(reInstantiated.ok);
                assert.deepStrictEqual(instantiated.bundle, reInstantiated.bundle);
                // THE HONEST-MEASURE LAW over caller-supplied measures
                const evaluated = await kit.evaluateBenchmark(benchmarksId, 'regression-suite-health', [
                        { dimension: 'success', value: 0.75 },
                        { dimension: 'quality', value: 0.62, unit: 'ratio' },
                ]);
                assert.ok(evaluated.ok);
                assert.equal(evaluated.result.harnessId, harnessId);
                assert.equal(evaluated.result.evidenceLevel, 'fixture');
                // THE CAPABILITY-GAP HONESTY LAW over a caller inventory (the zero-gap green path)
                const gaps = await kit.reportCapabilityGaps(benchmarksId, [...REAL_SCENARIO_IDS, ...REAL_TASK_TYPE_IDS]);
                assert.ok(gaps.ok);
                assert.deepStrictEqual(gaps.gaps, []);
                // the emitted evidenceRef rides the REAL review composition's evidenceRefs family
                const emitted = await kit.emitEvidenceRef(benchmarksId);
                assert.ok(emitted.ok);
                assert.equal(emitted.evidenceRef, benchmarksId);
                const composition = validateOnboardingReviewComposition({
                        roles: [
                                { roleKey: 'analyst', summary: 'Runs the domain analysis.' },
                                { roleKey: 'reviewer', summary: 'Reviews the domain work.' },
                        ],
                        capabilityRefs: [],
                        workflowRefs: [],
                        policyRefs: [],
                        evidenceRefs: [emitted.evidenceRef],
                });
                assert.ok(composition.ok);
                assert.deepStrictEqual(composition.value.evidenceRefs, [emitted.evidenceRef]);
        });

        test('the crown negative: a composition MISSING the evidenceRefs slot refuses the REAL validator; a duplicated ref refuses duplicate-ref', async () => {
                const { kit, benchmarksId } = await composeGreenKit();
                const emitted = await kit.emitEvidenceRef(benchmarksId);
                assert.ok(emitted.ok);
                // a composition that misses the ref slot entirely: the REAL DH-02 walk refuses
                // the missing key (the family slot that carries the emitted ref).
                const missingSlot = validateOnboardingReviewComposition({
                        roles: [{ roleKey: 'analyst', summary: 'Runs the domain analysis.' }],
                        capabilityRefs: [],
                        workflowRefs: [],
                        policyRefs: [],
                });
                assert.ok(!missingSlot.ok);
                assert.equal(missingSlot.refusal.reason, 'missing-key');
                const duplicated = validateOnboardingReviewComposition({
                        roles: [{ roleKey: 'analyst', summary: 'Runs the domain analysis.' }],
                        capabilityRefs: [],
                        workflowRefs: [],
                        policyRefs: [],
                        evidenceRefs: [emitted.evidenceRef, emitted.evidenceRef],
                });
                assert.ok(!duplicated.ok);
                assert.equal(duplicated.refusal.reason, 'duplicate-ref');
                const malformed = validateOnboardingReviewComposition({
                        roles: [{ roleKey: 'analyst', summary: 'Runs the domain analysis.' }],
                        capabilityRefs: [],
                        workflowRefs: [],
                        policyRefs: [],
                        evidenceRefs: [emitted.evidenceRef, 7],
                });
                assert.ok(!malformed.ok);
                assert.equal(malformed.refusal.reason, 'malformed-refs');
        });

        test('the crown gap ledger: an empty caller inventory reports the REAL scenario and task-type requirements honestly', async () => {
                const { kit, benchmarksId } = await composeGreenKit();
                const gaps = await kit.reportCapabilityGaps(benchmarksId, []);
                assert.ok(gaps.ok);
                assert.equal(gaps.gaps.length, 1);
                assert.equal(gaps.gaps[0].benchmarkKey, 'regression-suite-health');
                const expected: string[] = [];
                for (const scenarioId of REAL_SCENARIO_IDS) {
                        expected.push(scenarioId);
                        expected.push((getScenario(scenarioId) as { taskTypeId: string }).taskTypeId);
                }
                assert.deepStrictEqual(gaps.gaps[0].missing, expected);
        });
});

suite('benchmarksKit · listBenchmarksSessions', () => {
        test('green: the records list in id order, with the filter discipline', async () => {
                const seams = makeSeams();
                const kit = createBenchmarksKit({ clock: seams.clock, rng: seams.rng });
                const first = await beginGreen(kit);
                const second = await beginGreen(kit);
                const listed = await kit.listBenchmarksSessions();
                assert.ok(listed.ok);
                assert.deepStrictEqual(listed.records.map((record) => record.id), [first, second].sort());
                const composing = await kit.listBenchmarksSessions({ stage: 'composing' });
                assert.ok(composing.ok);
                assert.equal(composing.records.length, 2);
                await addBenchmarkGreen(kit, first);
                await finalizeGreen(kit, first);
                const composed = await kit.listBenchmarksSessions({ stage: 'composed' });
                assert.ok(composed.ok);
                assert.equal(composed.records.length, 1);
                assert.equal(composed.records[0].id, first);
                const byHarness = await kit.listBenchmarksSessions({ harnessId: HARNESS_ID });
                assert.ok(byHarness.ok);
                assert.equal(byHarness.records.length, 2);
        });

        test('UNKNOWN_FILTER: an unknown field or a non-member value refuses', async () => {
                const seams = makeSeams();
                const kit = createBenchmarksKit({ clock: seams.clock, rng: seams.rng });
                await beginGreen(kit);
                assert.equal(refusalOf(await kit.listBenchmarksSessions({ nope: 1 })).reason, 'UNKNOWN_FILTER');
                assert.equal(refusalOf(await kit.listBenchmarksSessions({ stage: 'draft' })).reason, 'UNKNOWN_FILTER');
                assert.equal(refusalOf(await kit.listBenchmarksSessions({ industry: 'aerospace' })).reason, 'UNKNOWN_FILTER');
                assert.equal(refusalOf(await kit.listBenchmarksSessions('nope' as never)).reason, 'UNKNOWN_FILTER');
        });
});

suite('benchmarksKit · persistence (the PIN-2 mirror)', () => {
        test('the ledger and the envelope land lazily at the distinct family paths', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const kit = createBenchmarksKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.equal(port.dump('ws/.flauz/harness/benchmarks-ops.jsonl'), undefined);
                const benchmarksId = await beginGreen(kit);
                const ledger = port.dump(`ws/${BENCHMARKS_LEDGER_RELATIVE_PATH}`);
                assert.ok(ledger !== undefined && ledger.endsWith('\n'));
                assert.equal(ledger.split('\n').length - 1, 1);
                // the canonical line discipline: the frozen eleven-key schema, the seq equal
                // to the line number, the contract version on every line.
                const line = JSON.parse((ledger as string).split('\n')[0]) as Record<string, unknown>;
                assert.deepStrictEqual(Object.keys(line).sort(), [...BENCHMARKS_LEDGER_LINE_SCHEMA_KEYS].sort());
                assert.equal(line.seq, 1);
                assert.equal(line.contractVersion, BENCHMARKS_CONTRACTS_VERSION);
                assert.equal(line.benchmarksId, benchmarksId);
                const envelope = port.dump(`ws/${BENCHMARKS_ENVELOPE_RELATIVE_PATH}`);
                assert.ok(envelope !== undefined);
                const parsed = JSON.parse(envelope as string) as { contractVersion: string; seq: number; records: unknown[] };
                assert.equal(parsed.contractVersion, BENCHMARKS_CONTRACTS_VERSION);
                assert.equal(parsed.seq, 1);
                assert.equal(parsed.records.length, 1);
        });

        test('restart replay is byte-identical and the seq continues', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const kit = createBenchmarksKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                const first = await beginGreen(kit);
                await addBenchmarkGreen(kit, first);
                const second = await beginGreen(kit);
                const beforeFirst = await kit.inspectBenchmarks(first);
                assert.ok(beforeFirst.ok);
                const reloaded = await loadBenchmarksKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(reloaded.ok);
                const afterFirst = await reloaded.kit.inspectBenchmarks(first);
                assert.ok(afterFirst.ok);
                assert.deepStrictEqual(afterFirst, beforeFirst);
                assert.equal(serializeBenchmarksRecord(afterFirst.record), serializeBenchmarksRecord(beforeFirst.record));
                assert.ok((await reloaded.kit.addBenchmark(second, { ...greenBenchmark(), benchmarkKey: 'extra' })).ok);
                const ledger = port.dump(`ws/${BENCHMARKS_LEDGER_RELATIVE_PATH}`) as string;
                assert.equal(ledger.split('\n').length - 1, 4);
                // the seq equals the line number on every line (the append-only ledger law).
                const ledgerLines = ledger.split('\n');
                ledgerLines.pop();
                for (let i = 0; i < ledgerLines.length; i += 1) {
                        const parsedLine = JSON.parse(ledgerLines[i]) as { seq: number };
                        assert.equal(parsedLine.seq, i + 1);
                }
                const envelope = JSON.parse(port.dump(`ws/${BENCHMARKS_ENVELOPE_RELATIVE_PATH}`) as string) as { seq: number };
                assert.equal(envelope.seq, 4);
        });

        test('a torn ledger (no trailing newline) is E_LEDGER_TORN', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const kit = createBenchmarksKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                await beginGreen(kit);
                const ledgerPath = `ws/${BENCHMARKS_LEDGER_RELATIVE_PATH}`;
                port.overwrite(ledgerPath, (port.dump(ledgerPath) as string).slice(0, -1));
                const outcome = await loadBenchmarksKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(!outcome.ok);
                assert.equal(outcome.refusal.reason, 'E_LEDGER_TORN');
        });

        test('a content-divergent envelope is E_ENVELOPE_MISMATCH (never silently rebuilt)', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const kit = createBenchmarksKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                const benchmarksId = await beginGreen(kit);
                await addBenchmarkGreen(kit, benchmarksId);
                const envelopePath = `ws/${BENCHMARKS_ENVELOPE_RELATIVE_PATH}`;
                const parsed = JSON.parse(port.dump(envelopePath) as string) as { contractVersion: string; seq: number; records: Record<string, unknown>[] };
                parsed.records[0].benchmarks = [];
                port.overwrite(envelopePath, JSON.stringify(parsed));
                const outcome = await loadBenchmarksKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(!outcome.ok);
                assert.equal(outcome.refusal.reason, 'E_ENVELOPE_MISMATCH');
        });

        test('a missing envelope while the ledger carries lines is E_ENVELOPE_MISMATCH', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const kit = createBenchmarksKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                await beginGreen(kit);
                port.remove(`ws/${BENCHMARKS_ENVELOPE_RELATIVE_PATH}`);
                const outcome = await loadBenchmarksKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(!outcome.ok);
                assert.equal(outcome.refusal.reason, 'E_ENVELOPE_MISMATCH');
        });

        test('an envelope seq ahead is E_LEDGER_TORN; behind is E_ENVELOPE_MISMATCH', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const kit = createBenchmarksKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                await beginGreen(kit);
                await beginGreen(kit);
                const envelopePath = `ws/${BENCHMARKS_ENVELOPE_RELATIVE_PATH}`;
                const ahead = JSON.parse(port.dump(envelopePath) as string) as { contractVersion: string; seq: number; records: unknown[] };
                ahead.seq = 3;
                port.overwrite(envelopePath, JSON.stringify(ahead));
                const aheadOutcome = await loadBenchmarksKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(!aheadOutcome.ok);
                assert.equal(aheadOutcome.refusal.reason, 'E_LEDGER_TORN');
                const behind = JSON.parse(port.dump(envelopePath) as string) as { contractVersion: string; seq: number; records: unknown[] };
                behind.seq = 1;
                port.overwrite(envelopePath, JSON.stringify(behind));
                const behindOutcome = await loadBenchmarksKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(!behindOutcome.ok);
                assert.equal(behindOutcome.refusal.reason, 'E_ENVELOPE_MISMATCH');
        });

        test('the multi-record ledger replays both records in id order, the composed one included', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const kit = createBenchmarksKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                const first = await beginGreen(kit);
                const second = await beginGreen(kit);
                await addBenchmarkGreen(kit, first);
                await finalizeGreen(kit, first);
                const reloaded = await loadBenchmarksKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(reloaded.ok);
                const listed = await reloaded.kit.listBenchmarksSessions();
                assert.ok(listed.ok);
                assert.equal(listed.records.length, 2);
                assert.deepStrictEqual(listed.records.map((record) => record.id), [first, second].sort());
                const composed = await reloaded.kit.inspectBenchmarks(first);
                assert.ok(composed.ok);
                assert.equal(composed.record.stage, 'composed');
                // the reloaded composed record still serves the measurement surface
                const instantiated = await reloaded.kit.instantiateBenchmark(first, 'regression-suite-health', 7, 2);
                assert.ok(instantiated.ok);
                assert.deepStrictEqual(instantiated.bundle.scenarioInstances[0].instances, generateInstances(REAL_SCENARIO_IDS[0] as string, 7, 2));
        });

        test('a fresh kit never appends over a non-empty ledger (E_LEDGER_TORN)', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const kit = createBenchmarksKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                await beginGreen(kit);
                const ledgerPath = `ws/${BENCHMARKS_LEDGER_RELATIVE_PATH}`;
                const lineCount = (port.dump(ledgerPath) as string).split('\n').length - 1;
                const fresh = createBenchmarksKit({ clock: seams.clock, rng: makeSeams().rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                const refusal = refusalOf(await fresh.beginBenchmarks(HARNESS_ID, 'software'));
                assert.equal(refusal.reason, 'E_LEDGER_TORN');
                assert.equal((port.dump(ledgerPath) as string).split('\n').length - 1, lineCount);
        });

        test('a tampered contractVersion is the typed version-mismatch', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const kit = createBenchmarksKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                await beginGreen(kit);
                const ledgerPath = `ws/${BENCHMARKS_LEDGER_RELATIVE_PATH}`;
                const lines = (port.dump(ledgerPath) as string).split('\n');
                const first = JSON.parse(lines[0]) as Record<string, unknown>;
                first.contractVersion = '9.9.9';
                lines[0] = JSON.stringify(first);
                port.overwrite(ledgerPath, `${lines.join('\n')}\n`);
                const outcome = await loadBenchmarksKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(!outcome.ok);
                assert.equal(outcome.refusal.reason, 'version-mismatch');
        });

        test('a tampered add payload (a fabricated scenario id) is E_LEDGER_TORN - THE SCENARIO-BINDING LAW re-proved from the ledger alone', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const kit = createBenchmarksKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                const benchmarksId = await beginGreen(kit);
                await addBenchmarkGreen(kit, benchmarksId);
                const ledgerPath = `ws/${BENCHMARKS_LEDGER_RELATIVE_PATH}`;
                const lines = (port.dump(ledgerPath) as string).split('\n');
                const addLine = JSON.parse(lines[1]) as { payload: { scenarioRefs: string[] } };
                addLine.payload.scenarioRefs[0] = FABRICATED_SCENARIO_ID;
                lines[1] = JSON.stringify(addLine);
                port.overwrite(ledgerPath, `${lines.join('\n')}\n`);
                const outcome = await loadBenchmarksKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(!outcome.ok);
                assert.equal(outcome.refusal.reason, 'E_LEDGER_TORN');
                assert.ok(outcome.refusal.detail.includes('SCENARIO-BINDING'));
        });

        test('the finalize line carries a NULL payload (the boundary authority is the imported registry, never a caller record)', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const kit = createBenchmarksKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                const benchmarksId = await beginGreen(kit);
                await addBenchmarkGreen(kit, benchmarksId);
                await finalizeGreen(kit, benchmarksId);
                const lines = (port.dump(`ws/${BENCHMARKS_LEDGER_RELATIVE_PATH}`) as string).split('\n');
                const last = JSON.parse(lines[lines.length - 2]) as { op: string; payload: null; benchmarksId: string };
                assert.equal(last.op, 'finalize-benchmarks');
                assert.equal(last.payload, null);
                assert.equal(last.benchmarksId, benchmarksId);
        });

        test('restart determinism: the reloaded kit instantiates and evaluates byte-identically', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const kit = createBenchmarksKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                const benchmarksId = await beginGreen(kit);
                await addBenchmarkGreen(kit, benchmarksId);
                await finalizeGreen(kit, benchmarksId);
                const before = await kit.instantiateBenchmark(benchmarksId, 'regression-suite-health', 11, 3);
                const evaluatedBefore = await kit.evaluateBenchmark(benchmarksId, 'regression-suite-health', [
                        { dimension: 'success', value: 0.8 },
                        { dimension: 'quality', value: 0.7 },
                ]);
                const reloaded = await loadBenchmarksKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(reloaded.ok);
                const after = await reloaded.kit.instantiateBenchmark(benchmarksId, 'regression-suite-health', 11, 3);
                const evaluatedAfter = await reloaded.kit.evaluateBenchmark(benchmarksId, 'regression-suite-health', [
                        { dimension: 'success', value: 0.8 },
                        { dimension: 'quality', value: 0.7 },
                ]);
                assert.ok(before.ok && after.ok);
                assert.equal(JSON.stringify(before.bundle), JSON.stringify(after.bundle));
                assert.ok(evaluatedBefore.ok && evaluatedAfter.ok);
                assert.deepStrictEqual(evaluatedBefore.result, evaluatedAfter.result);
        });
});

suite('benchmarksKit · dispose and determinism', () => {
        test('THE DISPOSE LAW: every operation after disposeBenchmarks rejects', async () => {
                const seams = makeSeams();
                const kit = createBenchmarksKit({ clock: seams.clock, rng: seams.rng });
                const benchmarksId = await beginGreen(kit);
                await addBenchmarkGreen(kit, benchmarksId);
                kit.disposeBenchmarks();
                assert.equal(refusalOf(await kit.beginBenchmarks(HARNESS_ID, 'software')).reason, 'DISPOSED');
                assert.equal(refusalOf(await kit.addBenchmark(benchmarksId, greenBenchmark())).reason, 'DISPOSED');
                assert.equal(refusalOf(await kit.replaceBenchmarkSummary(benchmarksId, 'regression-suite-health', 's.')).reason, 'DISPOSED');
                assert.equal(refusalOf(await kit.removeBenchmark(benchmarksId, 'regression-suite-health')).reason, 'DISPOSED');
                assert.equal(refusalOf(await kit.finalizeBenchmarks(benchmarksId)).reason, 'DISPOSED');
                assert.equal(refusalOf(await kit.emitEvidenceRef(benchmarksId)).reason, 'DISPOSED');
                assert.equal(refusalOf(await kit.instantiateBenchmark(benchmarksId, 'regression-suite-health', 7, 2)).reason, 'DISPOSED');
                assert.equal(refusalOf(await kit.evaluateBenchmark(benchmarksId, 'regression-suite-health', [])).reason, 'DISPOSED');
                assert.equal(refusalOf(await kit.reportCapabilityGaps(benchmarksId, [])).reason, 'DISPOSED');
                assert.equal(refusalOf(await kit.inspectBenchmarks(benchmarksId)).reason, 'DISPOSED');
                assert.equal(refusalOf(await kit.listBenchmarksSessions()).reason, 'DISPOSED');
        });

        test('determinism greps over the kit module: law-comment lines only', () => {
                const pattern = /Date\.now|Math\.random|new Date\(|process\.env/;
                const matches = KIT_SOURCE.split('\n').filter((line) => pattern.test(line));
                assert.ok(matches.length > 0, 'the greps must actually match the law-comment lines');
                const offending = matches.filter((line) => {
                        const trimmed = line.trim();
                        return !trimmed.startsWith('*') && !trimmed.startsWith('/*') && !trimmed.startsWith('//');
                });
                assert.deepStrictEqual(offending, [], 'no executable line may carry the forbidden tokens');
        });
});
