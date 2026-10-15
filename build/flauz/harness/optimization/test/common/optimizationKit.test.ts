/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * DH-012 optimization kit battery: THE FAIL-CLOSED FACTORY (every
 * option station, the one-clock/one-rng read law), THE COMPLETE LOOP
 * HAPPY PATH (the crown: observe -> simulate -> compare -> recommend ->
 * approve -> execute -> measure -> calibrate - every leg THROUGH the
 * REAL LAB modules and the REAL DH-011 journey instrument, with the
 * REAL harness authority re-read at 'draft' - THE NO-SECOND-ENGINE
 * LAW), THE FORWARD-ONLY LAW's stage guard (every premature / stale
 * refusal), THE APPROVAL LAW (the unapproved execute refusal firing
 * before the frontier check), THE FAIL-CLOSED BRANCHES (the
 * learning-opt-out privacy gate, the scenario coherence gate, the
 * evidence-ceiling promotion refusal, the irreversible-refused law,
 * the unsafe-delta refusals routed through the REAL journey's own
 * fail-closed laws with the real refusals carried verbatim, the
 * malformed-catalog seam, the journey reopen refusal, the honest-
 * measure refusals through the REAL DH-09 surface, the corrupt-seam
 * law), THE RECORD-UNCHANGED LAW (byte-identical after every
 * refusal), THE UNCERTAINTY LAW across loops (the first loop's
 * below-minimum honesty, the second loop's carried prior calibration,
 * the zero-gap green path), THE PRIVACY LAW (the raw activity never
 * persists), the PIN-2 persistence mirror (lazy landing, restart
 * determinism, the ledger replay re-proving the loop laws from the
 * ledger alone - torn / tampered / drifted-seq / unknown-op / foreign
 * version lines, THE APPROVAL-BEFORE-EXECUTE LAW, the frontier
 * discipline, the payload walks, the envelope cross-checks, the
 * fresh-kit guard, the envelope-rewrite disclosure, the IO refusals),
 * the listing filters, THE DISPOSE LAW, THE IMPORT LAW's source pins
 * (the real modules imported by reference; the execute leg never
 * calls proposeHarness / approveHarness / activateHarness) and the
 * in-suite determinism greps.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { learnWorkloadProfile } from '../../../../lab/common/workloadLearning.js';
import { searchOrganizations } from '../../../../lab/common/orgSearch.js';
import { runLadder, type CandidateScorer } from '../../../../lab/common/runEngine.js';
import { buildCalibrationModel, correctScores, observeBridgeOutcome } from '../../../../lab/common/calibration.js';
import { TASK_WORLDS } from '../../../../lab/common/taskWorlds.js';
import { loadHarnessKit } from '../../../contract/common/domainHarnessKit.js';
import { loadActivationKit } from '../../../activation/common/activationKit.js';
import type { HarnessFsPort } from '../../../contract/common/domainHarnessKit.js';
import type { EvalScore } from '../../../../lab/common/labContracts.js';
import type { OrganizationCandidate } from '../../../../lab/common/labContracts.js';

import {
        LOOP_SEARCH_MAX_AGENTS,
        OPTIMIZATION_ENVELOPE_RELATIVE_PATH,
        OPTIMIZATION_KIT_REFUSAL_REASONS,
        OPTIMIZATION_LEDGER_LINE_SCHEMA_KEYS,
        OPTIMIZATION_LEDGER_RELATIVE_PATH,
        createOptimizationKit,
        loadOptimizationKit,
} from '../../common/optimizationKit.js';
import type { LoopOutcome, OptimizationKit, OptimizationKitRefusal } from '../../common/optimizationKit.js';
import { OPTIMIZATION_CONTRACTS_VERSION, serializeOptimizationLoop } from '../../common/optimizationContract.js';

const KIT_SOURCE = readFileSync(fileURLToPath(new URL('../../common/optimizationKit.ts', import.meta.url)), 'utf8');

/** THE SCENARIO-BINDING LAW's pin-by-import: the fixture binds the REAL registry ids (never a fabricated list). */
const REAL_SCENARIO_IDS: string[] = TASK_WORLDS.flatMap((world) => world.taskScenarios.map((scenario) => scenario.id));

const SCOPE = { workspaceId: 'ws-fixture', tenantId: 'tenant-fixture' };

// --- the seams (the family's four injected seams, with the corrupt-seam controls) ----------------------

interface Seams {
        readonly clock: () => string;
        readonly rng: () => string;
        readonly clockReads: () => number;
        readonly rngReads: () => number;
        /** THE CORRUPT-SEAM LAW's controls: from the given 1-based read the seam answers the malformed value once. */
        readonly failClockAt: (read: number) => void;
        readonly failRngAt: (read: number) => void;
}

function makeSeams(): Seams {
        let clockCount = 0;
        let rngCount = 0;
        let failClock = 0;
        let failRng = 0;
        return {
                clock: () => {
                        clockCount += 1;
                        if (failClock === clockCount) {
                                return '';
                        }
                        return `2026-03-01T03:00:${String(clockCount % 60).padStart(2, '0')}.${String(clockCount).padStart(3, '0')}Z`;
                },
                rng: () => {
                        rngCount += 1;
                        if (failRng === rngCount) {
                                return 'not-hex';
                        }
                        return rngCount.toString(16).padStart(16, '0');
                },
                clockReads: () => clockCount,
                rngReads: () => rngCount,
                failClockAt: (read: number) => {
                        failClock = read;
                },
                failRngAt: (read: number) => {
                        failRng = read;
                },
        };
}

/** The in-memory fs port (the DH-01 port shape; a missing file reads as ENOENT; selective refusals isolate the family's own files). */
class MemoryFsPort {
        readonly files = new Map<string, string>();
        refuseAppends = false;
        refuseWrites = false;
        refuseMkdirs = false;
        refuseReads = false;
        /** The selective mode: when set, only paths containing this fragment refuse (isolates the optimization family's own files). */
        selectFragment: string | null = null;
        private refused(path: string, flag: boolean): boolean {
                if (!flag) {
                        return false;
                }
                return this.selectFragment === null || path.includes(this.selectFragment);
        }
        async readFile(path: string): Promise<string> {
                if (this.refused(path, this.refuseReads)) {
                        throw { code: 'EACCES', message: `refused: ${path}` };
                }
                if (!this.files.has(path)) {
                        throw { code: 'ENOENT', message: `ENOENT: no such file: ${path}` };
                }
                return this.files.get(path) as string;
        }
        async writeFile(path: string, text: string): Promise<void> {
                if (this.refused(path, this.refuseWrites)) {
                        throw { code: 'EACCES', message: `refused: ${path}` };
                }
                this.files.set(path, text);
        }
        async appendFile(path: string, text: string): Promise<void> {
                if (this.refused(path, this.refuseAppends)) {
                        throw { code: 'EACCES', message: `refused: ${path}` };
                }
                this.files.set(path, (this.files.get(path) ?? '') + text);
        }
        async mkdir(): Promise<void> {
                if (this.refuseMkdirs) {
                        throw { code: 'EACCES', message: 'refused mkdir' };
                }
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

/** A mutable catalog fixture (the injected READ-ONLY resolution surface; the malformed-catalog test mutates it). */
function makeCatalog(): { capabilities: { entryId: string; state: string }[]; workflowIds: string[]; policyIds: string[]; evidenceIds: string[] } {
        return { capabilities: [], workflowIds: [], policyIds: [], evidenceIds: [] };
}

// --- the caller-supplied fixtures (THE CONTENT LAW) -----------------------------------------------------

function makeRecords(taskFamilyMix: readonly string[] = ['bugfix', 'bugfix', 'bugfix', 'bugfix', 'feature', 'feature']): unknown[] {
        return taskFamilyMix.map((taskFamily) => ({
                scope: SCOPE,
                taskFamily,
                toolKinds: ['editor', 'shell', 'test-runner'],
                usedBrowser: false,
                usedEnvironment: true,
                durationMinutes: 45,
                complexityHint: 0.6,
                parallelThreads: 2,
                humanInterventions: 1,
                requiredReview: false,
                qualitySensitivity: 0.7,
                costSensitivity: 0.4,
                latencySensitivity: 0.5,
                occurredAt: '2026-02-26T10:00:00Z',
        }));
}

function observeInput(records: readonly unknown[] = makeRecords(), profileId = 'wp-fixture-1'): Record<string, unknown> {
        return { scope: SCOPE, records: [...records], controls: { optIn: true, retentionDays: 30, exportable: true }, profileId };
}

function compareInput(seeds: readonly number[] = [11], instanceCount = 4): Record<string, unknown> {
        return { seeds: [...seeds], instanceCount };
}

function deltaFixture(): Record<string, unknown> {
        return {
                context: {
                        industry: 'software',
                        companyProfile: { displayName: 'fixture optimization harness', sizeBand: 'small' },
                        workTypes: ['analysis', 'drafting', 'review'],
                        roles: [
                                { roleKey: 'analyst', summary: 'Runs the domain analysis.' },
                                { roleKey: 'reviewer', summary: 'Reviews the domain work.' },
                        ],
                },
                additions: {
                        terms: [
                                { term: 'fixture.discovery', definition: 'the fixture discovery term' },
                                { term: 'fixture.affidavit', definition: 'the fixture affidavit term' },
                        ],
                        tasks: [{ taskKey: 'survey', summary: 'Survey the incoming signal.', termRefs: ['fixture.discovery'] }],
                        bodies: [{ bodyKey: 'triage', summary: 'Triage the incoming work.', roleRefs: ['analyst', 'reviewer'] }],
                        packs: [{ packKey: 'core', summary: 'The core pack.', bodyRefs: ['triage'] }],
                        profiles: [{
                                profileKey: 'core',
                                summary: 'The core policy profile.',
                                permissionRefs: ['read-files'],
                                approvalTiers: ['high'],
                                evidenceFloor: 'local-real',
                                kpiDimensions: ['success', 'cost'],
                        }],
                        benchmarks: [{
                                benchmarkKey: 'regression-suite-health',
                                summary: 'The regression suite health benchmark.',
                                hypothesis: 'A composed agent organization completes the seeded regression-fix scenarios with a higher success rate than the single-agent baseline.',
                                scenarioRefs: [...REAL_SCENARIO_IDS],
                                kpiDimensions: ['success', 'quality'],
                                expectedOutcome: 'The candidate clears every acceptance criterion on at least 6 of 8 seeded instances per scenario.',
                                limitations: 'Fixture worlds over a synthetic repository; no real telemetry, no live repositories, single-seed runs only.',
                                evidenceLevel: 'fixture',
                        }],
                },
                replaces: [],
                rationale: 'The fixture delta: add the discovered terms and the guarded benchmark to the composed configuration.',
        };
}

function reversibilityFixture(): Record<string, unknown> {
        return {
                reversible: true,
                rollback: {
                        route: 'dh011-activation-journey',
                        removeRecords: [{ family: 'benchmarks', recordId: 'flauz:ben:0123456789abcdef' }],
                        restoreRecords: [],
                },
        };
}

function recommendInput(delta: Record<string, unknown> = deltaFixture(), reversibility: Record<string, unknown> = reversibilityFixture()): Record<string, unknown> {
        return { delta, reversibility };
}

const APPROVAL_DECISION = { approvedBy: 'fixture-approver', note: 'the fixture approval' };

const MEASURE_OUTCOME = { success: true, quality: 0.82, latencyMs: 120000, costUsd: 1.2, verification: [{ check: 'fixture-verification', passed: true }] };

function measureInput(benchmarkKey = 'regression-suite-health', measures: readonly unknown[] = [{ dimension: 'success', value: 0.75 }, { dimension: 'quality', value: 0.82 }]): Record<string, unknown> {
        return { benchmarkKey, measures: [...measures], outcome: MEASURE_OUTCOME };
}

/** The steering scorer (THE SIMULATION LAW's replaceable REAL response-model seam): rewards orgs seating the implementer body. */
const STEERING_SCORER: CandidateScorer = {
        engineId: 'fixture-steering-scorer',
        engineVersion: '1.0.0',
        evidenceLevel: 'fixture',
        scoreCandidate(candidate: OrganizationCandidate): EvalScore[] {
                const seatsImplementer = candidate.nodes.some((node) => node.bodyId === 'body-implementer');
                if (seatsImplementer) {
                        return [
                                { dimension: 'success', value: 0.9, unit: '' },
                                { dimension: 'quality', value: 0.9, unit: '' },
                                { dimension: 'latency', value: 0.1, unit: '' },
                                { dimension: 'cost', value: 0.1, unit: '' },
                        ];
                }
                return [
                        { dimension: 'success', value: 0.3, unit: '' },
                        { dimension: 'quality', value: 0.3, unit: '' },
                        { dimension: 'latency', value: 0.7, unit: '' },
                        { dimension: 'cost', value: 0.7, unit: '' },
                ];
        },
};

// --- the rig ---------------------------------------------------------------------------------------------

interface LoopRig {
        readonly kit: OptimizationKit;
        readonly port: MemoryFsPort;
        readonly catalog: ReturnType<typeof makeCatalog>;
        readonly seams: Seams;
        readonly loopId: string;
}

interface RigOptions {
        readonly root?: string;
        readonly delta?: Record<string, unknown>;
        readonly records?: readonly unknown[];
        readonly profileId?: string;
        readonly seeds?: readonly number[];
        readonly scorer?: CandidateScorer;
        readonly observeControls?: Record<string, unknown>;
        readonly approvalDecision?: Record<string, unknown>;
        readonly benchmarkKey?: string;
        readonly measures?: readonly unknown[];
}

async function beginRig(options: RigOptions = {}): Promise<LoopRig> {
        const seams = makeSeams();
        const port = new MemoryFsPort();
        const catalog = makeCatalog();
        const kit = createOptimizationKit({ clock: seams.clock, rng: seams.rng, catalog, fsPort: port as unknown as HarnessFsPort, root: options.root ?? 'ws' });
        const begun = await kit.beginLoop();
        if (!begun.ok) {
                throw new Error(`beginLoop refused: ${begun.refusal.reason}: ${begun.refusal.message}`);
        }
        return { kit, port, catalog, seams, loopId: begun.loop.loopId };
}

/** The stage-aware walk: walks ONLY the legs between the loop's current frontier and the target (composable, never double-walking). */
async function walkTo(rig: LoopRig, target: 'observe' | 'simulate' | 'compare' | 'recommend' | 'approve' | 'execute' | 'measure' | 'calibrate', options: RigOptions = {}): Promise<LoopOutcome> {
        const legOrder = ['observe', 'simulate', 'compare', 'recommend', 'approve', 'execute', 'measure', 'calibrate'] as const;
        const inspected = await rig.kit.inspectLoop(rig.loopId);
        if (!inspected.ok) {
                throw new Error(`inspectLoop refused: ${inspected.refusal.reason}`);
        }
        const frontier = inspected.loop.history[inspected.loop.history.length - 1].leg;
        const frontierIndex = frontier === null ? -1 : legOrder.indexOf(frontier);
        const targetIndex = legOrder.indexOf(target);
        let outcome: LoopOutcome = inspected;
        for (let i = frontierIndex + 1; i <= targetIndex; i += 1) {
                const leg = legOrder[i];
                if (leg === 'observe') {
                        outcome = await rig.kit.observeWorkload(rig.loopId, observeInput(options.records, options.profileId));
                } else if (leg === 'simulate') {
                        outcome = await rig.kit.simulateCandidates(rig.loopId);
                } else if (leg === 'compare') {
                        outcome = await rig.kit.compareOutcomes(rig.loopId, options.scorer === undefined ? compareInput(options.seeds) : { ...compareInput(options.seeds), scorer: options.scorer });
                } else if (leg === 'recommend') {
                        outcome = await rig.kit.recommendImprovement(rig.loopId, recommendInput(options.delta));
                } else if (leg === 'approve') {
                        outcome = await rig.kit.obtainApproval(rig.loopId, options.approvalDecision ?? APPROVAL_DECISION);
                } else if (leg === 'execute') {
                        outcome = await rig.kit.executeThroughAuthorities(rig.loopId);
                } else if (leg === 'measure') {
                        outcome = await rig.kit.measureResult(rig.loopId, measureInput(options.benchmarkKey, options.measures));
                } else {
                        outcome = await rig.kit.calibrate(rig.loopId);
                }
                if (!outcome.ok) {
                        throw new Error(`the leg '${leg}' refused: ${outcome.refusal.reason}: ${outcome.refusal.message}`);
                }
        }
        return outcome;
}

/** The opt-out observe input (THE PRIVACY LAW's gate). */
function optOutInput(): Record<string, unknown> {
        return { ...observeInput(), controls: { optIn: false, retentionDays: 30, exportable: true } };
}

function refusalOf(outcome: { ok: boolean; refusal?: OptimizationKitRefusal }): OptimizationKitRefusal {
        if (outcome.ok || outcome.refusal === undefined) {
                throw new Error('expected a refusal outcome');
        }
        return outcome.refusal;
}

function loopOf(outcome: LoopOutcome): Record<string, unknown> {
        if (!outcome.ok) {
                throw new Error(`expected an ok outcome: ${outcome.refusal.reason}: ${outcome.refusal.message}`);
        }
        return outcome.loop as unknown as Record<string, unknown>;
}

/** THE RECORD-UNCHANGED LAW's byte pin: the loop record before == after (canonical bytes). */
async function loopBytes(rig: LoopRig): Promise<string> {
        const inspected = await rig.kit.inspectLoop(rig.loopId);
        if (!inspected.ok) {
                throw new Error(`inspectLoop refused: ${inspected.refusal.reason}`);
        }
        return serializeOptimizationLoop(inspected.loop);
}

/** The ledger lines as parsed JSON objects (for the tamper rig). */
function ledgerLines(port: MemoryFsPort, root = 'ws'): Record<string, unknown>[] {
        const text = port.dump(`${root}/${OPTIMIZATION_LEDGER_RELATIVE_PATH}`) ?? '';
        return text.split('\n').filter((line) => line.trim().length > 0).map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** Writes the tampered lines back with re-sequenced line numbers (the seq must equal the line number; for dropped-line tampers). */
function writeLedgerLines(port: MemoryFsPort, lines: readonly Record<string, unknown>[], root = 'ws'): void {
        const resequenced = lines.map((line, index) => ({ ...line, seq: index + 1 }));
        port.overwrite(`${root}/${OPTIMIZATION_LEDGER_RELATIVE_PATH}`, `${resequenced.map((line) => JSON.stringify(line)).join('\n')}\n`);
}

/** Writes the tampered lines back RAW (no re-sequencing - for the drifted-seq tamper). */
function writeLedgerLinesRaw(port: MemoryFsPort, lines: readonly Record<string, unknown>[], root = 'ws'): void {
        port.overwrite(`${root}/${OPTIMIZATION_LEDGER_RELATIVE_PATH}`, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
}

// --- THE FAIL-CLOSED FACTORY -----------------------------------------------------------------------------

suite('optimizationKit · the fail-closed factory', () => {
        test('every option station refuses with the deterministic TypeError', () => {
                const port = new MemoryFsPort() as unknown as HarnessFsPort;
                const seams = makeSeams();
                assert.throws(() => createOptimizationKit(null as unknown as never), /options must be an object/);
                assert.throws(() => createOptimizationKit({ clock: 'x', rng: seams.rng, catalog: makeCatalog(), fsPort: port, root: 'ws' } as unknown as never), /options.clock must be a function/);
                assert.throws(() => createOptimizationKit({ clock: seams.clock, rng: 'x', catalog: makeCatalog(), fsPort: port, root: 'ws' } as unknown as never), /options.rng must be a function/);
                assert.throws(() => createOptimizationKit({ clock: seams.clock, rng: seams.rng, catalog: { junk: true }, fsPort: port, root: 'ws' } as unknown as never), /isHarnessCatalogSnapshot/);
                assert.throws(() => createOptimizationKit({ clock: seams.clock, rng: seams.rng, catalog: makeCatalog(), fsPort: 'x', root: 'ws' } as unknown as never), /options.fsPort must be an object/);
                assert.throws(() => createOptimizationKit({ clock: seams.clock, rng: seams.rng, catalog: makeCatalog(), fsPort: { readFile: async () => '' }, root: 'ws' } as unknown as never), /options.fsPort.writeFile must be a function/);
                assert.throws(() => createOptimizationKit({ clock: seams.clock, rng: seams.rng, catalog: makeCatalog(), fsPort: port, root: '' } as unknown as never), /options.root must be a non-empty string/);
        });

        test('the first clock read and the first rng read are validated (the seam contracts)', () => {
                const port = new MemoryFsPort() as unknown as HarnessFsPort;
                const emptyClock = { clock: () => '', rng: () => '0123456789abcdef', catalog: makeCatalog(), fsPort: port, root: 'ws' };
                assert.throws(() => createOptimizationKit(emptyClock as never), /non-empty ISO string/);
                const badHex = { clock: () => '2026-03-01T00:00:00.000Z', rng: () => 'XYZ', catalog: makeCatalog(), fsPort: port, root: 'ws' };
                assert.throws(() => createOptimizationKit(badHex as never), /16 lowercase hex/);
        });

        test('the factory consumes exactly ONE clock read and ONE rng read', async () => {
                const seams = makeSeams();
                const before = { clock: seams.clockReads(), rng: seams.rngReads() };
                const kit = createOptimizationKit({ clock: seams.clock, rng: seams.rng, catalog: makeCatalog(), fsPort: new MemoryFsPort() as unknown as HarnessFsPort, root: 'ws' });
                const after = { clock: seams.clockReads(), rng: seams.rngReads() };
                assert.strictEqual(after.clock - before.clock, 1);
                assert.strictEqual(after.rng - before.rng, 1);
                const listed = await kit.listLoops();
                assert.ok(listed.ok);
                assert.strictEqual(listed.loops.length, 0);
        });

        test('a fresh kit inspects an unknown loop (malformed ids fail closed as unknown)', async () => {
                const rig = await beginRig();
                const malformed = await rig.kit.inspectLoop('garbage');
                assert.ok(!malformed.ok);
                assert.strictEqual(refusalOf(malformed).reason, 'unknown-loop');
                const foreign = await rig.kit.inspectLoop('flauz:opt:ffffffffffffffff');
                assert.ok(!foreign.ok);
                assert.strictEqual(refusalOf(foreign).reason, 'unknown-loop');
        });

        test('OPTIMIZATION_KIT_REFUSAL_REASONS is the contract\'s 19 domain reasons plus the five kit-layer extras', () => {
                assert.strictEqual(OPTIMIZATION_KIT_REFUSAL_REASONS.length, 24);
                assert.deepStrictEqual([...OPTIMIZATION_KIT_REFUSAL_REASONS].slice(-5), ['E_LEDGER_TORN', 'E_ENVELOPE_MISMATCH', 'OPTIMIZATION_IO', 'CORRUPT_SEAM', 'UNKNOWN_FILTER']);
        });
});

// --- THE COMPLETE LOOP HAPPY PATH (the crown) ------------------------------------------------------------

suite('optimizationKit · THE COMPLETE LOOP HAPPY PATH (the crown: every leg through the REAL modules)', () => {
        test('observe: the REAL LAB-002 learner over the caller-supplied activity records', async () => {
                const rig = await beginRig();
                const outcome = await rig.kit.observeWorkload(rig.loopId, observeInput());
                const loop = loopOf(outcome);
                assert.strictEqual(loop.stage, 'observe');
                const workload = loop.workload as Record<string, unknown>;
                assert.strictEqual(workload.retainedRecordCount, 6);
                assert.strictEqual(workload.excludedRecordCount, 0);
                assert.deepStrictEqual((workload.warnings as string[]).slice(0, 1), ['fixture-evidence']);
                const profile = workload.profile as Record<string, unknown>;
                assert.strictEqual(profile.id, 'wp-fixture-1');
                assert.strictEqual((profile.taskMix as { taskTypeId: string }[])[0].taskTypeId, 'tt-bugfix-tests');
                assert.deepStrictEqual(loop.scope, SCOPE);
                // THE VERBATIM-CARRY LAW: the carried workload IS the real module's own answer (re-derived).
                const rederived = learnWorkloadProfile(SCOPE, makeRecords() as never, { optIn: true, retentionDays: 30, exportable: true }, 'wp-fixture-1', (loop.history as { at: string }[])[1].at);
                assert.deepStrictEqual(JSON.parse(JSON.stringify(workload)), JSON.parse(JSON.stringify(rederived)));
        });

        test('simulate: the REAL LAB-005 search over the observed profile (the derived request + the verbatim carry)', async () => {
                const rig = await beginRig({ seeds: [11] });
                await walkTo(rig, 'observe');
                const outcome = await rig.kit.simulateCandidates(rig.loopId);
                const loop = loopOf(outcome);
                assert.strictEqual(loop.stage, 'simulate');
                const simulation = loop.simulation as Record<string, unknown>;
                assert.strictEqual((simulation.candidates as unknown[]).length, 117, 'LOOP_SEARCH_MAX_AGENTS 2 enumerates 9 single + 108 two-agent candidates');
                const request = simulation.request as Record<string, unknown>;
                assert.strictEqual(request.scenarioId, 'scenario-se-bugfix-regression');
                assert.strictEqual(request.taskTypeId, 'tt-bugfix-tests');
                assert.strictEqual(request.maxAgents, LOOP_SEARCH_MAX_AGENTS);
                // THE VERBATIM-CARRY LAW: the carried simulation IS the real module's own answer (re-run over the echoed request).
                const rerun = searchOrganizations(request as never);
                assert.deepStrictEqual(JSON.parse(JSON.stringify(simulation)), JSON.parse(JSON.stringify(rerun)));
        });

        test('compare: the REAL LAB-006 ladder, seeded and pinned (the verbatim carry + the baseline law)', async () => {
                const rig = await beginRig();
                await walkTo(rig, 'simulate');
                const outcome = await rig.kit.compareOutcomes(rig.loopId, compareInput());
                const loop = loopOf(outcome);
                assert.strictEqual(loop.stage, 'compare');
                const comparison = loop.comparison as Record<string, unknown>;
                assert.ok(/^flauz:opt:run:[0-9a-f]{16}$/.test(comparison.runId as string), 'the run id mints from the rng seam in the loop family namespace');
                const reports = comparison.reports as Record<string, unknown>[];
                assert.strictEqual(reports.length, 117);
                assert.strictEqual((comparison.baselineReport as Record<string, unknown>).id, reports[0].id, 'the baseline is candidates[0] by the lab law');
                assert.strictEqual((comparison.request as Record<string, unknown>).ladderLevel, 1, 'a single pinned seed runs the instance-simulation rung');
                // THE VERBATIM-CARRY LAW: the carried comparison IS the real module's own answer (re-run over the echoed request).
                const rerun = runLadder(comparison.request as never);
                assert.deepStrictEqual(JSON.parse(JSON.stringify(comparison)), JSON.parse(JSON.stringify(rerun)));
        });

        test('recommend: the typed recommendation carrying every leg\'s real outputs verbatim', async () => {
                const rig = await beginRig();
                await walkTo(rig, 'compare');
                const outcome = await rig.kit.recommendImprovement(rig.loopId, recommendInput());
                const loop = loopOf(outcome);
                assert.strictEqual(loop.stage, 'recommend');
                const recommendation = loop.recommendation as Record<string, unknown>;
                assert.ok(/^flauz:opt:rec:[0-9a-f]{16}$/.test(recommendation.recommendationId as string));
                assert.strictEqual(recommendation.loopId, rig.loopId);
                assert.strictEqual(recommendation.runId, (loop.comparison as Record<string, unknown>).runId);
                assert.deepStrictEqual(JSON.parse(JSON.stringify(recommendation.workload)), JSON.parse(JSON.stringify(loop.workload)), 'the audit trail carries the loop\'s OWN workload verbatim');
                assert.deepStrictEqual(JSON.parse(JSON.stringify(recommendation.simulation)), JSON.parse(JSON.stringify(loop.simulation)), 'the audit trail carries the loop\'s OWN simulation verbatim');
                assert.deepStrictEqual(JSON.parse(JSON.stringify(recommendation.comparison)), JSON.parse(JSON.stringify(loop.comparison)), 'the audit trail carries the loop\'s OWN comparison verbatim');
                const bestReport = (loop.comparison as { bestReport: Record<string, unknown> }).bestReport;
                assert.strictEqual(recommendation.bestReportId, bestReport.id);
                assert.deepStrictEqual(recommendation.expectedGains, bestReport.comparison, 'the expected gains are the winning report\'s own REAL BaselineComparison rows');
                const uncertainty = recommendation.uncertainty as Record<string, unknown>;
                assert.strictEqual(uncertainty.evidenceLevel, bestReport.evidenceLevel, 'the honest claim is exactly what the real evaluation answered');
                assert.strictEqual(uncertainty.workloadObservationCount, 6);
                assert.strictEqual(uncertainty.simulationCandidateCount, 117);
                assert.strictEqual(uncertainty.ladderSeedCount, 1);
                const calibration = uncertainty.calibration as Record<string, unknown>;
                assert.strictEqual(calibration.observationCount, 0, 'the FIRST loop carries no prior calibration');
                assert.strictEqual(calibration.belowMinimum, true);
                assert.strictEqual(calibration.model, null);
                const labRecommendation = recommendation.labRecommendation as Record<string, unknown>;
                assert.strictEqual(labRecommendation.status, 'issued');
                assert.strictEqual(labRecommendation.reversible, true);
                assert.strictEqual(labRecommendation.runId, recommendation.runId);
                assert.deepStrictEqual(labRecommendation.scope, SCOPE);
                assert.ok((labRecommendation.caveats as string[]).some((caveat) => caveat.includes('BELOW')), 'the below-minimum caveat is carried honestly');
        });

        test('THE MISSING-CAPABILITY LAW: the honest gap is reported (never silently dropped)', async () => {
                const rig = await beginRig();
                await walkTo(rig, 'compare');
                const outcome = await rig.kit.recommendImprovement(rig.loopId, recommendInput());
                const recommendation = loopOf(outcome).recommendation as Record<string, unknown>;
                const missing = recommendation.missingCapabilities as { capabilityId: string; requiredLevel: number; bestScore: number; taskTypeId: string }[];
                assert.strictEqual(missing.length, 1, 'the fixture winner (the solo generalist) does not cover the required debugging capability');
                assert.strictEqual(missing[0].capabilityId, 'debugging');
                assert.strictEqual(missing[0].requiredLevel, 0.4);
                assert.strictEqual(missing[0].taskTypeId, 'tt-bugfix-tests');
        });

        test('approve: the recorded caller decision (THE APPROVAL LAW\'s evidence mirror)', async () => {
                const rig = await beginRig();
                await walkTo(rig, 'recommend');
                const outcome = await rig.kit.obtainApproval(rig.loopId, APPROVAL_DECISION);
                const loop = loopOf(outcome);
                assert.strictEqual(loop.stage, 'approve');
                assert.deepStrictEqual(loop.approval, APPROVAL_DECISION);
        });

        test('execute: the REAL DH-011 journey lands at \'composed\' and the REAL harness authority stays at \'draft\' (THE NO-SECOND-ENGINE LAW)', async () => {
                const rig = await beginRig();
                await walkTo(rig, 'approve');
                const outcome = await rig.kit.executeThroughAuthorities(rig.loopId);
                const loop = loopOf(outcome);
                assert.strictEqual(loop.stage, 'execute');
                const execution = loop.execution as Record<string, unknown>;
                assert.ok(/^flauz:jrn:[0-9a-f]{16}$/.test(execution.journeyId as string), 'the REAL journey id alphabet');
                assert.strictEqual(execution.journeyStage, 'composed');
                const links = execution.recordLinks as Record<string, string>;
                assert.ok(/^flauz:ont:[0-9a-f]{16}$/.test(links.ontologyId));
                assert.ok(/^flauz:tpl:[0-9a-f]{16}$/.test(links.templateId));
                assert.ok(/^flauz:bod:[0-9a-f]{16}$/.test(links.bodyId));
                assert.ok(/^flauz:pak:[0-9a-f]{16}$/.test(links.packsId));
                assert.ok(/^flauz:prf:[0-9a-f]{16}$/.test(links.profilesId));
                assert.ok(/^flauz:ben:[0-9a-f]{16}$/.test(links.benchmarksId));
                assert.ok(/^flauz:hrn:[0-9a-f]{16}$/.test(execution.bindingHarnessId as string), 'the binding draft minted through the REAL DH-02 composeDraft');
                // THE EVIDENCE-NOT-AUTHORITY LAW: the journey re-read through the REAL DH-11 load surface.
                const journeyKit = await loadActivationKit({ clock: rig.seams.clock, rng: rig.seams.rng, catalog: rig.catalog, fsPort: rig.port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(journeyKit.ok);
                const journey = await journeyKit.kit.inspectJourney(execution.journeyId as string);
                assert.ok(journey.ok);
                assert.strictEqual(journey.journey.stage, 'composed');
                // THE NO-SECOND-ENGINE LAW: the REAL DH-01 authority's own state is the truth - the loop never proposed, approved or activated.
                const harnessKit = await loadHarnessKit({ clock: rig.seams.clock, rng: rig.seams.rng, catalog: rig.catalog, fsPort: rig.port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(harnessKit.ok);
                const harness = await harnessKit.kit.inspectHarness(execution.bindingHarnessId as string);
                assert.ok(harness.ok);
                assert.strictEqual(harness.record.state, 'draft', 'the proposal, approval and activation remain the USER\'s journey through the REAL DH-01 authority');
        });

        test('measure: the caller-supplied measures through the REAL DH-09 evaluation surface (the honest-measure law)', async () => {
                const rig = await beginRig();
                await walkTo(rig, 'execute');
                const outcome = await rig.kit.measureResult(rig.loopId, measureInput());
                const loop = loopOf(outcome);
                assert.strictEqual(loop.stage, 'measure');
                const measures = loop.measures as Record<string, unknown>;
                assert.strictEqual(measures.benchmarkKey, 'regression-suite-health');
                const evaluation = measures.evaluation as Record<string, unknown>;
                assert.strictEqual(evaluation.benchmarkKey, 'regression-suite-health');
                assert.deepStrictEqual(evaluation.scores, [{ dimension: 'success', value: 0.75 }, { dimension: 'quality', value: 0.82 }], 'the caller\'s own measure rows ride verbatim - the kit NEVER invents scores');
                assert.strictEqual(evaluation.evidenceLevel, 'fixture', 'the honest evidence label');
                assert.deepStrictEqual(measures.outcome, MEASURE_OUTCOME, 'the observed outcome rides verbatim');
        });

        test('calibrate: the REAL LAB-008 surfaces (the bridge rows, the folded model, the corrected scores)', async () => {
                const rig = await beginRig();
                await walkTo(rig, 'measure');
                const outcome = await rig.kit.calibrate(rig.loopId);
                const loop = loopOf(outcome);
                assert.strictEqual(loop.stage, 'calibrate');
                const calibration = loop.calibration as Record<string, unknown>;
                const rows = calibration.records as Record<string, unknown>[];
                assert.strictEqual(rows.length, 4, 'the REAL observeBridgeOutcome mints one row per dimension');
                const model = calibration.model as Record<string, unknown>;
                assert.strictEqual(model.observationCount, 4);
                const factors = model.factors as Record<string, number>;
                for (const dimension of ['success', 'quality', 'latency', 'cost'] as const) {
                        assert.strictEqual(factors[dimension], 2, `the ${dimension} ratio clamps at the REAL FACTOR_MAX`);
                }
                assert.strictEqual(model.evidenceLevel, 'fixture', 'the builder never upgrades the corpus label');
                // THE VERBATIM-CARRY LAW: re-run the REAL surfaces over the loop's own evidence and compare.
                const recommendation = loop.recommendation as Record<string, unknown>;
                const winningReport = (recommendation.comparison as { reports: Record<string, unknown>[]; bestReportId: string }).reports
                        .find((report) => report.id === recommendation.bestReportId) as never;
                const rerunRows = observeBridgeOutcome({
                        recommendation: recommendation.labRecommendation as never,
                        evaluation: winningReport,
                        outcome: MEASURE_OUTCOME as never,
                        bridgeEntryId: (loop.execution as Record<string, unknown>).journeyId as string,
                        observedAt: rows[0].observedAt as string,
                });
                assert.deepStrictEqual(rows, rerunRows);
                const rerunModel = buildCalibrationModel(rerunRows as never, SCOPE, calibration.calibratedAt as string, 'fixture');
                assert.deepStrictEqual(JSON.parse(JSON.stringify(model)), JSON.parse(JSON.stringify(rerunModel)));
                const rerunCorrected = correctScores((winningReport as { scores: unknown[] }).scores as never, rerunModel);
                assert.deepStrictEqual(calibration.correctedScores, rerunCorrected);
        });

        test('the closed loop: the final record, the revision count and the history walk', async () => {
                const rig = await beginRig();
                const outcome = await walkTo(rig, 'calibrate');
                const loop = loopOf(outcome);
                assert.strictEqual(loop.stage, 'calibrate');
                assert.strictEqual(loop.revision, 9, 'the begin is revision 1; every applied stage op appends one');
                const history = loop.history as { op: string; law: string; leg: string | null; toStage: string }[];
                assert.strictEqual(history.length, 9);
                assert.deepStrictEqual(history.map((note) => note.op), [
                        'begin-loop', 'observe-workload', 'simulate-candidates', 'compare-outcomes', 'recommend-improvement',
                        'obtain-approval', 'execute-through-authorities', 'measure-result', 'calibrate',
                ]);
                assert.strictEqual(history[0].leg, null);
                assert.strictEqual(history[1].leg, 'observe');
                assert.strictEqual(history[8].leg, 'calibrate');
                assert.strictEqual(history[8].toStage, 'calibrate');
                assert.deepStrictEqual(history.map((note) => note.law), [
                        'THE FORWARD-ONLY LAW',
                        'THE AUDIT LAW', 'THE AUDIT LAW', 'THE REPRODUCIBILITY LAW', 'THE AUDIT LAW',
                        'THE APPROVAL LAW', 'THE NO-SECOND-ENGINE LAW', 'THE HONEST-MEASURE LAW', 'THE MEASURE-CALIBRATE LAWS',
                ]);
        });

        test('THE PRIVACY LAW: the raw activity records never persist (the ledger carries only the derived profile)', async () => {
                const rig = await beginRig();
                await walkTo(rig, 'calibrate');
                const ledger = rig.port.dump(`ws/${OPTIMIZATION_LEDGER_RELATIVE_PATH}`) as string;
                assert.ok(!ledger.includes('taskFamily'), 'no raw activity field ever lands in the ledger');
                assert.ok(!ledger.includes('occurredAt'), 'no raw timestamp field ever lands in the ledger');
                assert.ok(ledger.includes('wp-fixture-1'), 'the derived profile id does persist');
        });

        test('the two-seed rung: TWO OR MORE pinned seeds run the REAL multi-seed robustness rung (L2)', async () => {
                const rig = await beginRig({ seeds: [11, 12] });
                await walkTo(rig, 'compare', { seeds: [11, 12] });
                const inspected = await rig.kit.inspectLoop(rig.loopId);
                assert.ok(inspected.ok);
                const comparison = inspected.loop.comparison as unknown as Record<string, unknown>;
                assert.strictEqual((comparison.request as Record<string, unknown>).ladderLevel, 2);
                assert.strictEqual((comparison.bestReport as Record<string, unknown>).robustness !== undefined, true, 'the L2 report carries the robustness statistics');
        });
});

// --- the stage guard (THE FORWARD-ONLY LAW) ---------------------------------------------------------------

suite('optimizationKit · the stage guard (THE FORWARD-ONLY LAW)', () => {
        test('every premature op names its missing prerequisite leg', async () => {
                const rig = await beginRig();
                const simulate = refusalOf(await rig.kit.simulateCandidates(rig.loopId));
                assert.strictEqual(simulate.reason, 'premature-stage');
                assert.ok(simulate.message.includes("'observe'"));
                await walkTo(rig, 'observe');
                const compare = refusalOf(await rig.kit.compareOutcomes(rig.loopId, compareInput()));
                assert.strictEqual(compare.reason, 'premature-stage');
                await walkTo(rig, 'simulate');
                const recommend = refusalOf(await rig.kit.recommendImprovement(rig.loopId, recommendInput()));
                assert.strictEqual(recommend.reason, 'premature-stage');
                await walkTo(rig, 'compare');
                const approve = refusalOf(await rig.kit.obtainApproval(rig.loopId, APPROVAL_DECISION));
                assert.strictEqual(approve.reason, 'premature-stage');
                await walkTo(rig, 'recommend');
                const measure = refusalOf(await rig.kit.measureResult(rig.loopId, measureInput()));
                assert.strictEqual(measure.reason, 'premature-stage');
                await walkTo(rig, 'approve');
                const calibrate = refusalOf(await rig.kit.calibrate(rig.loopId));
                assert.strictEqual(calibrate.reason, 'premature-stage');
        });

        test('every stale op refuses (the loop record never walks back)', async () => {
                const rig = await beginRig();
                await walkTo(rig, 'observe');
                const secondObserve = refusalOf(await rig.kit.observeWorkload(rig.loopId, observeInput()));
                assert.strictEqual(secondObserve.reason, 'stale-stage');
                await walkTo(rig, 'compare');
                const staleSimulate = refusalOf(await rig.kit.simulateCandidates(rig.loopId));
                assert.strictEqual(staleSimulate.reason, 'stale-stage');
                assert.ok(staleSimulate.message.includes('never walks back'));
        });

        test('\'calibrate\' is TERMINAL: every op after the closed loop refuses stale-stage', async () => {
                const rig = await beginRig();
                await walkTo(rig, 'calibrate');
                const again = refusalOf(await rig.kit.calibrate(rig.loopId));
                assert.strictEqual(again.reason, 'stale-stage');
                const measure = refusalOf(await rig.kit.measureResult(rig.loopId, measureInput()));
                assert.strictEqual(measure.reason, 'stale-stage');
                const observe = refusalOf(await rig.kit.observeWorkload(rig.loopId, observeInput()));
                assert.strictEqual(observe.reason, 'stale-stage');
        });

        test('THE DISPOSE LAW: every operation after dispose rejects', async () => {
                const rig = await beginRig();
                rig.kit.dispose();
                for (const outcome of [
                        await rig.kit.beginLoop(),
                        await rig.kit.observeWorkload(rig.loopId, observeInput()),
                        await rig.kit.simulateCandidates(rig.loopId),
                        await rig.kit.compareOutcomes(rig.loopId, compareInput()),
                        await rig.kit.recommendImprovement(rig.loopId, recommendInput()),
                        await rig.kit.obtainApproval(rig.loopId, APPROVAL_DECISION),
                        await rig.kit.executeThroughAuthorities(rig.loopId),
                        await rig.kit.measureResult(rig.loopId, measureInput()),
                        await rig.kit.calibrate(rig.loopId),
                        await rig.kit.inspectLoop(rig.loopId),
                        await rig.kit.listLoops(),
                ]) {
                        assert.ok(!outcome.ok, 'every op refuses after dispose');
                        assert.strictEqual(refusalOf(outcome as never).reason, 'disposed');
                }
        });
});

// --- THE APPROVAL LAW ---------------------------------------------------------------------------------------

suite('optimizationKit · THE APPROVAL LAW (no approval input, no execution - ever)', () => {
        test('an execute attempt without the recorded approval decision is the typed approval-missing refusal', async () => {
                const rig = await beginRig();
                await walkTo(rig, 'recommend');
                const before = await loopBytes(rig);
                const refused = refusalOf(await rig.kit.executeThroughAuthorities(rig.loopId));
                assert.strictEqual(refused.reason, 'approval-missing');
                assert.strictEqual(refused.law, 'THE APPROVAL LAW');
                assert.ok(refused.message.includes('no approval input, no execution'));
                assert.strictEqual(await loopBytes(rig), before, 'THE RECORD-UNCHANGED LAW (byte-identical)');
        });

        test('the approval guard fires BEFORE the frontier check (an unapproved execute at ANY stage is approval-missing)', async () => {
                const rig = await beginRig();
                await walkTo(rig, 'observe');
                const refused = refusalOf(await rig.kit.executeThroughAuthorities(rig.loopId));
                assert.strictEqual(refused.reason, 'approval-missing', 'the approval law names itself first, not premature-stage');
                const begun = await beginRig({ root: 'ws-early' });
                const refusedAtBegin = refusalOf(await begun.kit.executeThroughAuthorities(begun.loopId));
                assert.strictEqual(refusedAtBegin.reason, 'approval-missing');
        });

        test('a malformed approval decision is the malformed-record refusal (the evidence mirror walk)', async () => {
                const rig = await beginRig();
                await walkTo(rig, 'recommend');
                const before = await loopBytes(rig);
                const refused = refusalOf(await rig.kit.obtainApproval(rig.loopId, { approvedBy: '' }));
                assert.strictEqual(refused.reason, 'malformed-record');
                assert.strictEqual(refused.law, 'THE APPROVAL LAW');
                const rejectedKey = refusalOf(await rig.kit.obtainApproval(rig.loopId, { approvedBy: 'a', rejected: 'b' }));
                assert.strictEqual(rejectedKey.reason, 'malformed-record');
                assert.strictEqual(await loopBytes(rig), before, 'THE RECORD-UNCHANGED LAW (byte-identical)');
        });
});

// --- the fail-closed branches ---------------------------------------------------------------------------------

suite('optimizationKit · the fail-closed branches (THE PRIVACY / COHERENCE / CEILING / REVERSIBLE-FIRST LAWS)', () => {
        test('THE PRIVACY LAW: optIn false refuses the observe leg (no learning without explicit consent)', async () => {
                const rig = await beginRig();
                const before = await loopBytes(rig);
                const refused = refusalOf(await rig.kit.observeWorkload(rig.loopId, optOutInput()));
                assert.strictEqual(refused.reason, 'learning-opt-out');
                assert.strictEqual(refused.law, 'THE PRIVACY LAW (LAB-002 governance)');
                assert.strictEqual(await loopBytes(rig), before, 'THE RECORD-UNCHANGED LAW (byte-identical)');
        });

        test('the observe input walk: non-object, unknown key, missing key, bad scope, bad records, bad controls', async () => {
                const rig = await beginRig();
                await walkTo(rig, 'observe');
                await walkTo(rig, 'simulate');
                const rig2 = await beginRig({ root: 'ws-input' });
                const nonObject = refusalOf(await rig2.kit.observeWorkload(rig2.loopId, 'nope'));
                assert.strictEqual(nonObject.reason, 'malformed-record');
                const unknownKey = refusalOf(await rig2.kit.observeWorkload(rig2.loopId, { ...observeInput(), extra: 1 }));
                assert.strictEqual(unknownKey.reason, 'malformed-record');
                const missingKey = refusalOf(await rig2.kit.observeWorkload(rig2.loopId, { records: [], controls: { optIn: true, retentionDays: 30, exportable: true }, profileId: 'wp' }));
                assert.strictEqual(missingKey.reason, 'malformed-record');
                const badScope = refusalOf(await rig2.kit.observeWorkload(rig2.loopId, { ...observeInput(), scope: { workspaceId: '' } }));
                assert.ok(badScope.message.includes('LabScope'));
                const badRecords = refusalOf(await rig2.kit.observeWorkload(rig2.loopId, observeInput([{ ...makeRecords()[0] as Record<string, unknown>, taskFamily: '' }])));
                assert.ok(badRecords.message.includes('taskFamily'));
                const badComplexity = refusalOf(await rig2.kit.observeWorkload(rig2.loopId, observeInput([{ ...makeRecords()[0] as Record<string, unknown>, complexityHint: 2 }])));
                assert.ok(badComplexity.message.includes('complexityHint'));
                const badControls = refusalOf(await rig2.kit.observeWorkload(rig2.loopId, { ...observeInput(), controls: { optIn: 'yes', retentionDays: 30, exportable: true } }));
                assert.strictEqual(badControls.law, 'THE PRIVACY LAW (LAB-002 governance)');
        });

        test('THE COHERENCE LAW: an observed family with no deterministic task-world coupling refuses the simulate leg', async () => {
                const rig = await beginRig({ records: makeRecords(['mystery-ops', 'mystery-ops', 'mystery-ops', 'mystery-ops', 'mystery-ops', 'mystery-ops']) });
                await walkTo(rig, 'observe', { records: makeRecords(['mystery-ops', 'mystery-ops', 'mystery-ops', 'mystery-ops', 'mystery-ops', 'mystery-ops']) });
                const before = await loopBytes(rig);
                const refused = refusalOf(await rig.kit.simulateCandidates(rig.loopId));
                assert.strictEqual(refused.reason, 'scenario-unresolvable');
                assert.strictEqual(refused.law, 'THE COHERENCE LAW');
                assert.ok(refused.message.includes('family the user never runs'));
                assert.strictEqual(await loopBytes(rig), before, 'THE RECORD-UNCHANGED LAW (byte-identical)');
        });

        test('the compare input walk: empty seeds, a non-finite seed, a zero instance count, an unknown key and a malformed scorer', async () => {
                const rig = await beginRig();
                await walkTo(rig, 'simulate');
                const emptySeeds = refusalOf(await rig.kit.compareOutcomes(rig.loopId, compareInput([])));
                assert.strictEqual(emptySeeds.reason, 'malformed-record');
                assert.strictEqual(emptySeeds.law, 'THE REPRODUCIBILITY LAW');
                const nonFinite = refusalOf(await rig.kit.compareOutcomes(rig.loopId, compareInput([11, Number.POSITIVE_INFINITY])));
                assert.strictEqual(nonFinite.reason, 'malformed-record');
                const zeroInstances = refusalOf(await rig.kit.compareOutcomes(rig.loopId, compareInput([11], 0)));
                assert.ok(zeroInstances.message.includes('instanceCount'));
                const unknownKey = refusalOf(await rig.kit.compareOutcomes(rig.loopId, { ...compareInput(), extra: 1 }));
                assert.strictEqual(unknownKey.law, 'THE STRICT-SCHEMA LAW');
                const malformedScorer = refusalOf(await rig.kit.compareOutcomes(rig.loopId, { ...compareInput(), scorer: { engineId: 'x' } }));
                assert.ok(malformedScorer.message.includes('CandidateScorer'));
        });

        test('THE EVIDENCE-CEILING LAW: a response model labeled above the ceiling refuses the recommendation (never a promotion)', async () => {
                const promotedScorer: CandidateScorer = { ...STEERING_SCORER, evidenceLevel: 'local-real' };
                const rig = await beginRig();
                await walkTo(rig, 'compare', { scorer: promotedScorer });
                const before = await loopBytes(rig);
                const refused = refusalOf(await rig.kit.recommendImprovement(rig.loopId, recommendInput()));
                assert.strictEqual(refused.reason, 'evidence-ceiling');
                assert.strictEqual(refused.law, 'THE EVIDENCE-CEILING LAW');
                assert.ok(refused.message.includes('rather than promote'), 'the promotion refusal names the honest ceiling');
                assert.strictEqual(await loopBytes(rig), before, 'THE RECORD-UNCHANGED LAW (byte-identical)');
        });

        test('THE REVERSIBLE-FIRST LAW: an irreversible delta without the explicit acknowledgement is refused at the recommend boundary', async () => {
                const rig = await beginRig();
                await walkTo(rig, 'compare');
                const before = await loopBytes(rig);
                const refused = refusalOf(await rig.kit.recommendImprovement(rig.loopId, recommendInput(deltaFixture(), { reversible: false })));
                assert.strictEqual(refused.reason, 'irreversible-refused');
                assert.strictEqual(refused.law, 'THE REVERSIBLE-FIRST LAW');
                assert.strictEqual(await loopBytes(rig), before, 'THE RECORD-UNCHANGED LAW (byte-identical)');
        });

        test('the recommend input walk: non-object and unknown key are refused', async () => {
                const rig = await beginRig();
                await walkTo(rig, 'compare');
                const nonObject = refusalOf(await rig.kit.recommendImprovement(rig.loopId, 'nope'));
                assert.strictEqual(nonObject.reason, 'malformed-record');
                const unknownKey = refusalOf(await rig.kit.recommendImprovement(rig.loopId, { ...recommendInput(), extra: 1 }));
                assert.strictEqual(unknownKey.reason, 'malformed-record');
        });

        test('THE CORRUPT_SEAM LAW: an empty clock reading mid-op is the typed refusal', async () => {
                const rig = await beginRig();
                // Read 1 = the factory; read 2 = beginLoop's note; read 3 = the observe leg's own read.
                rig.seams.failClockAt(3);
                const refused = refusalOf(await rig.kit.observeWorkload(rig.loopId, observeInput()));
                assert.strictEqual(refused.reason, 'CORRUPT_SEAM');
                assert.strictEqual(refused.law, 'THE DETERMINISM LAW');
        });

        test('THE CORRUPT_SEAM LAW: a non-16-hex rng value mid-op is the typed refusal (the compare leg\'s run mint)', async () => {
                const rig = await beginRig();
                await walkTo(rig, 'simulate');
                // Read 1 = the factory; read 2 = the loop id mint; read 3 = the compare leg's run id mint.
                rig.seams.failRngAt(3);
                const refused = refusalOf(await rig.kit.compareOutcomes(rig.loopId, compareInput()));
                assert.strictEqual(refused.reason, 'CORRUPT_SEAM');
                assert.strictEqual(refused.leg, 'compare');
        });
});

suite('optimizationKit · the unsafe-delta refusals (the REAL journey\'s own fail-closed laws, carried verbatim)', () => {
        test('a delta naming a non-composed record: the dangling termRef refuses through the REAL DH-05 term-resolution law', async () => {
                const delta = deltaFixture();
                ((delta.additions as Record<string, unknown>).tasks as Record<string, unknown>[])[0].termRefs = ['fixture.missing'];
                const rig = await beginRig({ delta });
                await walkTo(rig, 'approve', { delta });
                const before = await loopBytes(rig);
                const refused = refusalOf(await rig.kit.executeThroughAuthorities(rig.loopId));
                assert.strictEqual(refused.reason, 'unsafe-delta');
                assert.strictEqual(refused.leg, 'execute');
                assert.strictEqual(refused.law, 'THE VERBATIM-CARRY LAW');
                assert.ok(refused.message.includes('record composition'));
                assert.ok(refused.journeyRefusal !== undefined, 'the REAL DH-11 journey refusal rides verbatim');
                assert.strictEqual(await loopBytes(rig), before, 'THE RECORD-UNCHANGED LAW (byte-identical)');
        });

        test('a delta naming a non-composed record: the dangling roleRef refuses through the REAL DH-06 role-resolution law', async () => {
                const delta = deltaFixture();
                ((delta.additions as Record<string, unknown>).bodies as Record<string, unknown>[])[0].roleRefs = ['ghost-role'];
                const rig = await beginRig({ delta });
                await walkTo(rig, 'approve', { delta });
                const refused = refusalOf(await rig.kit.executeThroughAuthorities(rig.loopId));
                assert.strictEqual(refused.reason, 'unsafe-delta');
                assert.ok(refused.journeyRefusal !== undefined, 'the REAL DH-11 journey refusal rides verbatim');
        });

        test('a delta naming a non-composed record: the dangling bodyRef refuses through the REAL DH-07 body-resolution law', async () => {
                const delta = deltaFixture();
                ((delta.additions as Record<string, unknown>).packs as Record<string, unknown>[])[0].bodyRefs = ['ghost-body'];
                const rig = await beginRig({ delta });
                await walkTo(rig, 'approve', { delta });
                const refused = refusalOf(await rig.kit.executeThroughAuthorities(rig.loopId));
                assert.strictEqual(refused.reason, 'unsafe-delta');
                assert.ok(refused.journeyRefusal !== undefined, 'the REAL DH-11 journey refusal rides verbatim');
        });

        test('THE FAIL-CLOSED LAW at the authority seam: a mutated catalog snapshot refuses malformed-catalog', async () => {
                const rig = await beginRig();
                await walkTo(rig, 'approve');
                const before = await loopBytes(rig);
                (rig.catalog as unknown as Record<string, unknown>).capabilities = 'junk';
                const refused = refusalOf(await rig.kit.executeThroughAuthorities(rig.loopId));
                assert.strictEqual(refused.reason, 'malformed-catalog');
                assert.strictEqual(refused.leg, 'execute');
                assert.strictEqual(await loopBytes(rig), before, 'THE RECORD-UNCHANGED LAW (byte-identical)');
        });

        test('journey-refused: the REAL DH-11 instrument refusing to reopen over its own torn ledger is carried verbatim', async () => {
                const rig = await beginRig();
                await walkTo(rig, 'approve');
                const before = await loopBytes(rig);
                rig.port.overwrite('ws/.flauz/harness/activation-ops.jsonl', 'not json\n');
                const refused = refusalOf(await rig.kit.executeThroughAuthorities(rig.loopId));
                assert.strictEqual(refused.reason, 'journey-refused');
                assert.strictEqual(refused.leg, 'execute');
                assert.ok(refused.journeyRefusal !== undefined, 'the REAL DH-11 reopen refusal rides verbatim');
                assert.strictEqual(refused.journeyRefusal.reason, 'E_LEDGER_TORN');
                assert.strictEqual(await loopBytes(rig), before, 'THE RECORD-UNCHANGED LAW (byte-identical)');
        });
});

suite('optimizationKit · the honest-measure refusals (THE MEASURE-CALIBRATE LAWS)', () => {
        test('the measure input walk: non-object, unknown key, a bad benchmark key and a malformed outcome', async () => {
                const rig = await beginRig();
                await walkTo(rig, 'execute');
                const nonObject = refusalOf(await rig.kit.measureResult(rig.loopId, 'nope'));
                assert.strictEqual(nonObject.reason, 'malformed-record');
                const unknownKey = refusalOf(await rig.kit.measureResult(rig.loopId, { ...measureInput(), extra: 1 }));
                assert.strictEqual(unknownKey.reason, 'malformed-record');
                const badKey = refusalOf(await rig.kit.measureResult(rig.loopId, measureInput('')));
                assert.strictEqual(badKey.reason, 'malformed-record');
                const badOutcome = refusalOf(await rig.kit.measureResult(rig.loopId, { ...measureInput(), outcome: { success: true } }));
                assert.strictEqual(badOutcome.law, 'THE HONEST-MEASURE LAW');
        });

        test('a foreign benchmarkKey is refused by the REAL DH-09 surface, carried verbatim (measure-refused)', async () => {
                const rig = await beginRig();
                await walkTo(rig, 'execute');
                const before = await loopBytes(rig);
                const refused = refusalOf(await rig.kit.measureResult(rig.loopId, measureInput('foreign-benchmark')));
                assert.strictEqual(refused.reason, 'measure-refused');
                assert.strictEqual(refused.leg, 'measure');
                assert.ok(refused.benchmarksRefusal !== undefined, 'the REAL DH-09 refusal rides verbatim');
                assert.strictEqual(refused.benchmarksRefusal.reason, 'unknown-benchmark');
                assert.strictEqual(await loopBytes(rig), before, 'THE RECORD-UNCHANGED LAW (byte-identical)');
        });

        test('a measure row outside the benchmark\'s declared kpiDimensions is refused by the REAL DH-09 surface', async () => {
                const rig = await beginRig();
                await walkTo(rig, 'execute');
                const refused = refusalOf(await rig.kit.measureResult(rig.loopId, measureInput('regression-suite-health', [{ dimension: 'latency', value: 0.5 }])));
                assert.strictEqual(refused.reason, 'measure-refused');
                assert.ok(refused.benchmarksRefusal !== undefined);
                assert.ok(refused.benchmarksRefusal.detail.includes('kpiDimensions'));
        });
});

// --- THE UNCERTAINTY LAW across loops -----------------------------------------------------------------------

suite('optimizationKit · THE UNCERTAINTY LAW across loops (the honest calibration state)', () => {
        test('the second loop carries the first loop\'s folded calibration (observationCount 4, above the REAL floor)', async () => {
                const rig = await beginRig();
                await walkTo(rig, 'calibrate');
                const second = await rig.kit.beginLoop();
                assert.ok(second.ok);
                const secondLoopId = second.loop.loopId;
                await rig.kit.observeWorkload(secondLoopId, observeInput(makeRecords(), 'wp-fixture-2'));
                await rig.kit.simulateCandidates(secondLoopId);
                await rig.kit.compareOutcomes(secondLoopId, compareInput([12]));
                const recommended = await rig.kit.recommendImprovement(secondLoopId, recommendInput());
                assert.ok(recommended.ok);
                const secondRecommendation = recommended.loop.recommendation as unknown as Record<string, unknown>;
                const uncertainty = secondRecommendation.uncertainty as Record<string, unknown>;
                const calibration = uncertainty.calibration as Record<string, unknown>;
                assert.strictEqual(calibration.observationCount, 4, 'the prior loop\'s four folded rows');
                assert.strictEqual(calibration.belowMinimum, false);
                assert.strictEqual((calibration.model as Record<string, unknown>).observationCount, 4);
                const first = await rig.kit.inspectLoop(rig.loopId);
                assert.ok(first.ok);
                const firstRecommendation = first.loop.recommendation as unknown as Record<string, unknown>;
                const firstUncertainty = firstRecommendation.uncertainty as Record<string, unknown>;
                assert.strictEqual((firstUncertainty.calibration as Record<string, unknown>).belowMinimum, true, 'the FIRST loop honestly said below-minimum');
                const firstConfidence = (firstRecommendation.labRecommendation as Record<string, unknown>).confidence as number;
                const secondConfidence = (secondRecommendation.labRecommendation as Record<string, unknown>).confidence as number;
                assert.ok(secondConfidence > firstConfidence, 'the calibrated corpus is never laundered into a LOWER confidence');
        });

        test('the zero-gap green path: a winner covering every required capability yields the zero-entry ledger', async () => {
                const rig = await beginRig();
                await walkTo(rig, 'compare', { scorer: STEERING_SCORER });
                const recommended = await rig.kit.recommendImprovement(rig.loopId, recommendInput());
                assert.ok(recommended.ok);
                const recommendation = recommended.loop.recommendation as unknown as Record<string, unknown>;
                const missing = recommendation.missingCapabilities as unknown as unknown[];
                assert.strictEqual(missing.length, 0, 'the steering scorer seats the implementer body (code-writing 0.9, debugging 0.7) - every required capability covered');
                assert.strictEqual((recommendation.uncertainty as Record<string, unknown>).simulationCandidateCount, 117);
        });
});

// --- the PIN-2 persistence mirror -----------------------------------------------------------------------------

suite('optimizationKit · the PIN-2 persistence mirror (THE APPEND-ONLY LEDGER LAW)', () => {
        test('persistence is LAZY: no files before the first applied op; the mirror lands with the begin', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const kit = createOptimizationKit({ clock: seams.clock, rng: seams.rng, catalog: makeCatalog(), fsPort: port as unknown as HarnessFsPort, root: 'ws-lazy' });
                assert.strictEqual(port.dump('ws-lazy/.flauz/harness/optimization-ops.jsonl'), undefined);
                assert.strictEqual(port.dump(`ws-lazy/${OPTIMIZATION_ENVELOPE_RELATIVE_PATH}`), undefined);
                const begun = await kit.beginLoop();
                assert.ok(begun.ok);
                const ledger = port.dump(`ws-lazy/${OPTIMIZATION_LEDGER_RELATIVE_PATH}`) as string;
                assert.ok(ledger !== undefined);
                assert.strictEqual(ledgerLines(port, 'ws-lazy').length, 1);
                const envelope = JSON.parse(port.dump(`ws-lazy/${OPTIMIZATION_ENVELOPE_RELATIVE_PATH}`) as string) as Record<string, unknown>;
                assert.deepStrictEqual(Object.keys(envelope), ['contractVersion', 'seq', 'loops']);
                assert.strictEqual(envelope.contractVersion, OPTIMIZATION_CONTRACTS_VERSION);
                assert.strictEqual(envelope.seq, 1);
                assert.strictEqual((envelope.loops as unknown[]).length, 1);
        });

        test('the ledger line is the frozen eleven-key schema in the canonical fixed-key order', async () => {
                const rig = await beginRig();
                await walkTo(rig, 'observe');
                const [beginLine, observeLine] = ledgerLines(rig.port);
                assert.deepStrictEqual(Object.keys(beginLine), [...OPTIMIZATION_LEDGER_LINE_SCHEMA_KEYS]);
                assert.deepStrictEqual(Object.keys(observeLine), [...OPTIMIZATION_LEDGER_LINE_SCHEMA_KEYS]);
                assert.strictEqual(beginLine.op, 'begin-loop');
                assert.strictEqual(beginLine.leg, null);
                assert.strictEqual(observeLine.op, 'observe-workload');
                assert.strictEqual(observeLine.leg, 'observe');
        });

        test('restart determinism: the record is byte-identical after reloads at three walk points', async () => {
                const rig = await beginRig();
                for (const stage of ['observe', 'recommend', 'calibrate'] as const) {
                        await walkTo(rig, stage);
                        const before = await loopBytes(rig);
                        const reloaded = await loadOptimizationKit({ clock: rig.seams.clock, rng: rig.seams.rng, catalog: rig.catalog, fsPort: rig.port as unknown as HarnessFsPort, root: 'ws' });
                        assert.ok(reloaded.ok, `the reload at ${stage} must open green`);
                        const inspected = await reloaded.kit.inspectLoop(rig.loopId);
                        assert.ok(inspected.ok);
                        assert.strictEqual(serializeOptimizationLoop(inspected.loop), before, `the ${stage} record is restart-deterministic`);
                }
        });

        test('the reloaded kit continues the walk (a new loop, the same ledger)', async () => {
                const rig = await beginRig();
                await walkTo(rig, 'calibrate');
                const reloaded = await loadOptimizationKit({ clock: rig.seams.clock, rng: rig.seams.rng, catalog: rig.catalog, fsPort: rig.port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(reloaded.ok);
                const second = await reloaded.kit.beginLoop();
                assert.ok(second.ok, 'the fresh-kit guard never fires on a reloaded kit');
                const observed = await reloaded.kit.observeWorkload(second.loop.loopId, observeInput(makeRecords(), 'wp-fixture-2'));
                assert.ok(observed.ok);
                assert.strictEqual(ledgerLines(rig.port).length, 11);
        });

        test('the fresh-kit guard: a fresh createOptimizationKit never appends over an existing non-empty ledger', async () => {
                const rig = await beginRig();
                await walkTo(rig, 'observe');
                const fresh = createOptimizationKit({ clock: rig.seams.clock, rng: rig.seams.rng, catalog: rig.catalog, fsPort: rig.port as unknown as HarnessFsPort, root: 'ws' });
                const refused = refusalOf(await fresh.beginLoop());
                assert.strictEqual(refused.reason, 'E_LEDGER_TORN');
                assert.ok(refused.message.includes('reopen with loadOptimizationKit'));
        });

        test('a fresh root reopens as an empty kit', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const reloaded = await loadOptimizationKit({ clock: seams.clock, rng: seams.rng, catalog: makeCatalog(), fsPort: port as unknown as HarnessFsPort, root: 'ws-fresh' });
                assert.ok(reloaded.ok);
                const listed = await reloaded.kit.listLoops();
                assert.ok(listed.ok);
                assert.strictEqual(listed.loops.length, 0);
        });

        test('a torn ledger line is the typed E_LEDGER_TORN', async () => {
                const rig = await beginRig();
                await walkTo(rig, 'observe');
                rig.port.overwrite(`ws/${OPTIMIZATION_LEDGER_RELATIVE_PATH}`, `${rig.port.dump(`ws/${OPTIMIZATION_LEDGER_RELATIVE_PATH}`) as string}not json\n`);
                const reloaded = await loadOptimizationKit({ clock: rig.seams.clock, rng: rig.seams.rng, catalog: rig.catalog, fsPort: rig.port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(!reloaded.ok);
                assert.strictEqual(refusalOf(reloaded as never).reason, 'E_LEDGER_TORN');
        });

        test('the replay re-proves: a drifted seq, an unknown op, a foreign version and an unknown line key', async () => {
                for (const [label, mutate] of [
                        ['seq', (lines: Record<string, unknown>[]) => { lines[1].seq = 99; }],
                        ['op', (lines: Record<string, unknown>[]) => { lines[1].op = 'frobnicate'; }],
                        ['version', (lines: Record<string, unknown>[]) => { lines[1].contractVersion = '9.9.9'; }],
                        ['key', (lines: Record<string, unknown>[]) => { lines[1].extra = 1; }],
                ] as [string, (lines: Record<string, unknown>[]) => void][]) {
                        const rig = await beginRig({ root: `ws-tamper-${label}` });
                        await walkTo(rig, 'observe');
                        const lines = ledgerLines(rig.port, `ws-tamper-${label}`);
                        mutate(lines);
                        if (label === 'seq') {
                                writeLedgerLinesRaw(rig.port, lines, `ws-tamper-${label}`);
                        } else {
                                writeLedgerLines(rig.port, lines, `ws-tamper-${label}`);
                        }
                        const reloaded = await loadOptimizationKit({ clock: rig.seams.clock, rng: rig.seams.rng, catalog: rig.catalog, fsPort: rig.port as unknown as HarnessFsPort, root: `ws-tamper-${label}` });
                        assert.ok(!reloaded.ok, `the ${label} tamper must fail closed`);
                        assert.strictEqual(refusalOf(reloaded as never).reason, 'E_LEDGER_TORN');
                }
        });

        test('the replay re-proves: the line leg must be the op\'s own leg (the frozen op<->leg table)', async () => {
                const rig = await beginRig({ root: 'ws-leg' });
                await walkTo(rig, 'observe');
                const lines = ledgerLines(rig.port, 'ws-leg');
                lines[1].leg = 'simulate';
                writeLedgerLines(rig.port, lines, 'ws-leg');
                const reloaded = await loadOptimizationKit({ clock: rig.seams.clock, rng: rig.seams.rng, catalog: rig.catalog, fsPort: rig.port as unknown as HarnessFsPort, root: 'ws-leg' });
                assert.ok(!reloaded.ok);
                assert.ok(refusalOf(reloaded as never).message.includes('op<->leg table'));
        });

        test('the replay re-proves: THE APPROVAL LAW\'s structural floor (an execute line whose approve line was dropped)', async () => {
                const rig = await beginRig({ root: 'ws-approval' });
                await walkTo(rig, 'execute');
                const lines = ledgerLines(rig.port, 'ws-approval')
                        .filter((line) => line.op !== 'obtain-approval');
                writeLedgerLines(rig.port, lines, 'ws-approval');
                const reloaded = await loadOptimizationKit({ clock: rig.seams.clock, rng: rig.seams.rng, catalog: rig.catalog, fsPort: rig.port as unknown as HarnessFsPort, root: 'ws-approval' });
                assert.ok(!reloaded.ok);
                const refusal = refusalOf(reloaded as never);
                assert.strictEqual(refusal.reason, 'E_LEDGER_TORN');
                assert.ok(refusal.message.includes('precedes its walked prerequisites'), 'the execute line is refused without the approve line (THE APPROVAL LAW\'s structural floor is the frontier discipline)');
                // The direct APPROVAL-BEFORE-EXECUTE station exists in the replay (the defense-in-depth
                // layer behind the frontier discipline - a folded state at the approve frontier with a
                // null approval evidence is unreachable through line tampering, by design).
                assert.ok(KIT_SOURCE.includes('THE APPROVAL-BEFORE-EXECUTE LAW'), 'the replay carries the direct station');
        });

        test('the replay re-proves: THE FORWARD-ONLY LAW\'s frontier discipline (a dropped observe line)', async () => {
                const rig = await beginRig({ root: 'ws-frontier' });
                await walkTo(rig, 'compare');
                const lines = ledgerLines(rig.port, 'ws-frontier')
                        .filter((line) => line.op !== 'observe-workload');
                writeLedgerLines(rig.port, lines, 'ws-frontier');
                const reloaded = await loadOptimizationKit({ clock: rig.seams.clock, rng: rig.seams.rng, catalog: rig.catalog, fsPort: rig.port as unknown as HarnessFsPort, root: 'ws-frontier' });
                assert.ok(!reloaded.ok);
                assert.ok(refusalOf(reloaded as never).message.includes('FORWARD-ONLY LAW re-proven from the ledger alone'));
        });

        test('the replay re-proves: the payload walks (a tampered observe payload fails the REAL LAB-002 structural walk)', async () => {
                const rig = await beginRig({ root: 'ws-payload' });
                await walkTo(rig, 'observe');
                const lines = ledgerLines(rig.port, 'ws-payload');
                (lines[1].payload as Record<string, unknown>).warnings = [];
                writeLedgerLines(rig.port, lines, 'ws-payload');
                const reloaded = await loadOptimizationKit({ clock: rig.seams.clock, rng: rig.seams.rng, catalog: rig.catalog, fsPort: rig.port as unknown as HarnessFsPort, root: 'ws-payload' });
                assert.ok(!reloaded.ok);
                assert.ok(refusalOf(reloaded as never).message.includes('honest warnings'));
        });

        test('the replay re-proves: a second begin line for the same loop refuses (the append-only lineage law)', async () => {
                const rig = await beginRig({ root: 'ws-lineage' });
                await walkTo(rig, 'observe');
                const lines = ledgerLines(rig.port, 'ws-lineage');
                writeLedgerLines(rig.port, [lines[0], { ...lines[0] }], 'ws-lineage');
                const reloaded = await loadOptimizationKit({ clock: rig.seams.clock, rng: rig.seams.rng, catalog: rig.catalog, fsPort: rig.port as unknown as HarnessFsPort, root: 'ws-lineage' });
                assert.ok(!reloaded.ok);
                assert.ok(refusalOf(reloaded as never).message.includes('a second time'));
        });

        test('the envelope cross-check: a tampered envelope and a missing envelope fail closed (never silently rebuilt)', async () => {
                const rig = await beginRig({ root: 'ws-envelope' });
                await walkTo(rig, 'observe');
                rig.port.overwrite(`ws-envelope/${OPTIMIZATION_ENVELOPE_RELATIVE_PATH}`, '{"contractVersion":"1.0.0","seq":2,"loops":[]}');
                let reloaded = await loadOptimizationKit({ clock: rig.seams.clock, rng: rig.seams.rng, catalog: rig.catalog, fsPort: rig.port as unknown as HarnessFsPort, root: 'ws-envelope' });
                assert.ok(!reloaded.ok);
                assert.strictEqual(refusalOf(reloaded as never).reason, 'E_ENVELOPE_MISMATCH');

                rig.port.remove(`ws-envelope/${OPTIMIZATION_ENVELOPE_RELATIVE_PATH}`);
                reloaded = await loadOptimizationKit({ clock: rig.seams.clock, rng: rig.seams.rng, catalog: rig.catalog, fsPort: rig.port as unknown as HarnessFsPort, root: 'ws-envelope' });
                assert.ok(!reloaded.ok);
                assert.strictEqual(refusalOf(reloaded as never).reason, 'E_ENVELOPE_MISMATCH');
        });

        test('the envelope-rewrite disclosure: a refused envelope write applies the op, discloses the refusal, and the next op rewrites the envelope green', async () => {
                const rig = await beginRig({ root: 'ws-rewrite' });
                await walkTo(rig, 'observe');
                rig.port.refuseWrites = true;
                rig.port.selectFragment = OPTIMIZATION_ENVELOPE_RELATIVE_PATH;
                const simulated = await rig.kit.simulateCandidates(rig.loopId);
                assert.ok(!simulated.ok, 'the refused envelope write surfaces the typed refusal');
                assert.strictEqual(refusalOf(simulated).reason, 'OPTIMIZATION_IO');
                assert.ok(refusalOf(simulated).message.includes('the ledger line landed'), 'the refusal discloses that the op applied and the ledger is authoritative');
                // The stuck reload fails closed with E_ENVELOPE_MISMATCH (the envelope diverges from the ledger).
                const stuck = await loadOptimizationKit({ clock: rig.seams.clock, rng: rig.seams.rng, catalog: rig.catalog, fsPort: rig.port as unknown as HarnessFsPort, root: 'ws-rewrite' });
                assert.ok(!stuck.ok);
                assert.strictEqual(refusalOf(stuck as never).reason, 'E_ENVELOPE_MISMATCH');
                // The NEXT op rewrites the envelope; the reload opens green.
                rig.port.refuseWrites = false;
                rig.port.selectFragment = null;
                const compared = await rig.kit.compareOutcomes(rig.loopId, compareInput());
                assert.ok(compared.ok);
                const healed = await loadOptimizationKit({ clock: rig.seams.clock, rng: rig.seams.rng, catalog: rig.catalog, fsPort: rig.port as unknown as HarnessFsPort, root: 'ws-rewrite' });
                assert.ok(healed.ok, 'the envelope rewrite heals the mirror');
                const inspected = await healed.kit.inspectLoop(rig.loopId);
                assert.ok(inspected.ok);
                assert.strictEqual(inspected.loop.stage, 'compare');
        });

        test('THE FAIL-CLOSED LAW: a refused mkdir at the first persist and a refused append mid-walk apply NOTHING', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const kit = createOptimizationKit({ clock: seams.clock, rng: seams.rng, catalog: makeCatalog(), fsPort: port as unknown as HarnessFsPort, root: 'ws-io' });
                // The refused mkdir fires at the FIRST persist (the .flauz/harness subtree lands with the first applied op).
                port.refuseMkdirs = true;
                const mkdirRefused = refusalOf(await kit.beginLoop());
                assert.strictEqual(mkdirRefused.reason, 'OPTIMIZATION_IO');
                assert.ok(mkdirRefused.message.includes('nothing was applied'));
                const empty = await kit.listLoops();
                assert.ok(empty.ok);
                assert.strictEqual(empty.loops.length, 0, 'the refused mkdir applied NOTHING');
                // The refused append fires mid-walk.
                port.refuseMkdirs = false;
                const begun = await kit.beginLoop();
                assert.ok(begun.ok);
                const loopId = begun.loop.loopId;
                const observed = await kit.observeWorkload(loopId, observeInput());
                assert.ok(observed.ok);
                const before = serializeOptimizationLoop(observed.loop);
                port.refuseAppends = true;
                const appendRefused = refusalOf(await kit.simulateCandidates(loopId));
                assert.strictEqual(appendRefused.reason, 'OPTIMIZATION_IO');
                assert.ok(appendRefused.message.includes('nothing was applied'));
                const after = await kit.inspectLoop(loopId);
                assert.ok(after.ok);
                assert.strictEqual(serializeOptimizationLoop(after.loop), before, 'the refused append leaves the loop record byte-identical');
        });

        test('a refused read at load time is the typed OPTIMIZATION_IO', async () => {
                const rig = await beginRig({ root: 'ws-read' });
                await walkTo(rig, 'observe');
                rig.port.refuseReads = true;
                rig.port.selectFragment = OPTIMIZATION_LEDGER_RELATIVE_PATH;
                const reloaded = await loadOptimizationKit({ clock: rig.seams.clock, rng: rig.seams.rng, catalog: rig.catalog, fsPort: rig.port as unknown as HarnessFsPort, root: 'ws-read' });
                assert.ok(!reloaded.ok);
                assert.strictEqual(refusalOf(reloaded as never).reason, 'OPTIMIZATION_IO');
        });
});

// --- the listing filters --------------------------------------------------------------------------------------

suite('optimizationKit · the listing filters', () => {
        test('listLoops answers the loopId-ordered honest records; the { stage } filter; the UNKNOWN_FILTER branches', async () => {
                const rig = await beginRig();
                await walkTo(rig, 'calibrate');
                const second = await rig.kit.beginLoop();
                assert.ok(second.ok);
                const secondObserved = await rig.kit.observeWorkload(second.loop.loopId, observeInput(makeRecords(), 'wp-fixture-2'));
                assert.ok(secondObserved.ok);
                const listed = await rig.kit.listLoops();
                assert.ok(listed.ok);
                assert.strictEqual(listed.loops.length, 2);
                assert.deepStrictEqual(listed.loops.map((loop) => loop.loopId), [...listed.loops.map((loop) => loop.loopId)].sort());
                assert.strictEqual(listed.loops[1].stage, 'observe');
                assert.strictEqual(listed.loops[0].stage, 'calibrate');
                const closed = await rig.kit.listLoops({ stage: 'calibrate' });
                assert.ok(closed.ok);
                assert.strictEqual(closed.loops.length, 1);
                assert.strictEqual(closed.loops[0].loopId, rig.loopId);
                const observing = await rig.kit.listLoops({ stage: 'observe' });
                assert.ok(observing.ok);
                assert.strictEqual(observing.loops.length, 1);
                assert.strictEqual(observing.loops[0].loopId, second.loop.loopId);
                const nonObject = refusalOf(await rig.kit.listLoops('all'));
                assert.strictEqual(nonObject.reason, 'UNKNOWN_FILTER');
                const unknownField = refusalOf(await rig.kit.listLoops({ industry: 'software' }));
                assert.strictEqual(unknownField.reason, 'UNKNOWN_FILTER');
                const nonMember = refusalOf(await rig.kit.listLoops({ stage: 'teleported' }));
                assert.strictEqual(nonMember.reason, 'UNKNOWN_FILTER');
        });
});

// --- THE IMPORT LAW's source pins ------------------------------------------------------------------------------

suite('optimizationKit · THE IMPORT LAW and THE NO-SECOND-ENGINE LAW (the source pins)', () => {
        test('the kit imports the REAL modules by reference (never a re-implementation)', () => {
                assert.ok(KIT_SOURCE.includes(`import { learnWorkloadProfile } from '../../../lab/common/workloadLearning.js'`), 'the REAL LAB-002 learner');
                assert.ok(KIT_SOURCE.includes(`import { FIXTURE_REQUIRED_CAPABILITIES, searchOrganizations } from '../../../lab/common/orgSearch.js'`), 'the REAL LAB-005 search');
                assert.ok(KIT_SOURCE.includes(`import { runLadder } from '../../../lab/common/runEngine.js'`), 'the REAL LAB-006 ladder');
                assert.ok(KIT_SOURCE.includes(`import { MIN_FACTORS_OBSERVATIONS, buildCalibrationModel, correctScores, observeBridgeOutcome } from '../../../lab/common/calibration.js'`), 'the REAL LAB-008 calibration surfaces');
                assert.ok(KIT_SOURCE.includes(`import { TASK_WORLDS } from '../../../lab/common/taskWorlds.js'`), 'the REAL deterministic task worlds');
                assert.ok(KIT_SOURCE.includes(`import { loadActivationKit } from '../../activation/common/activationKit.js'`), 'the REAL DH-011 journey instrument');
                assert.ok(KIT_SOURCE.includes(`import { loadBenchmarksKit } from '../../benchmarks/common/benchmarksKit.js'`), 'the REAL DH-09 evaluation surface');
                assert.ok(KIT_SOURCE.includes(`import { capabilityCoverage } from '../../../lab/common/agentBodies.js'`), 'the REAL coverage surface');
        });

        test('THE NO-SECOND-ENGINE LAW: the execute leg never calls the proposal, approval or activation ops (the walk stops at \'composed\')', () => {
                assert.ok(!/\bproposeHarness\s*\(/.test(KIT_SOURCE), 'no proposal call');
                assert.ok(!/\bapproveHarness\s*\(/.test(KIT_SOURCE), 'no approval call');
                assert.ok(!/\bactivateHarness\s*\(/.test(KIT_SOURCE), 'no activation call');
                assert.ok(KIT_SOURCE.includes("never calls proposeHarness"), 'the law is disclosed at the journey-walk boundary');
        });

        test('determinism greps: Date.now / Math.random / new Date( / process.env appear only on law-comment lines', () => {
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
