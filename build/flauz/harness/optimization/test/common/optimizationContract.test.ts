/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * DH-012 optimization contract battery: THE SINGLE-VERSION LAW's
 * cross-pins (OPTIMIZATION_CONTRACTS_VERSION + the ELEVEN prior family
 * versions DH-01..DH-11, all imported by reference and pinned equal +
 * the REAL LAB_CONTRACTS_VERSION and the REAL
 * MIN_FACTORS_OBSERVATIONS floor), THE NO-SECOND-ENGINE LAW's header
 * disclosure, THE FORWARD-ONLY LAW's loop-stage machine (the seven
 * whitelisted rows, every illegal edge typed, 'calibrate' TERMINAL),
 * the frozen loop-leg / op-name / op-leg / required-leg / leg-stage
 * tables, the loop id alphabet, THE EVIDENCE-CEILING LAW's derived
 * REAL ladder census, THE TYPED HARNESS DELTA walk (the strict-schema
 * stations + THE REVERSIBILITY LAW's typed classification + the
 * OWNING families' REAL validators with their complete typed rejection
 * tables surfaced verbatim), THE TYPED RECOMMENDATION walk (the audit
 * / linkage / uncertainty / missing-capability laws at the recommend
 * boundary), the deep loop-record walk (the stage-vs-evidence
 * consistency law, the history walk, the decision mirror, the
 * execution / measure / calibration evidence walks), the canonical
 * fixed-key-order serialization and THE FAIL-CLOSED PARSE
 * (malformed-json / torn-envelope / unknown-contract-version /
 * unknown-key / invalid-record, first-failure-is-the-verdict), and the
 * in-suite determinism greps over the shipped contract module.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { DOMAIN_HARNESS_CONTRACTS_VERSION as REAL_DOMAIN_HARNESS_CONTRACTS_VERSION } from '../../../contract/common/domainHarnessContract.js';
import { ONBOARDING_CONTRACTS_VERSION as REAL_ONBOARDING_CONTRACTS_VERSION } from '../../../onboarding/common/onboardingContract.js';
import { ROLES_CONTRACTS_VERSION as REAL_ROLES_CONTRACTS_VERSION, MAX_ROLES as REAL_MAX_ROLES } from '../../../roles/common/rolesContract.js';
import { ONTOLOGY_CONTRACTS_VERSION as REAL_ONTOLOGY_CONTRACTS_VERSION } from '../../../ontology/common/ontologyContract.js';
import { TEMPLATES_CONTRACTS_VERSION as REAL_TEMPLATES_CONTRACTS_VERSION } from '../../../templates/common/templatesContract.js';
import { BODIES_CONTRACTS_VERSION as REAL_BODIES_CONTRACTS_VERSION } from '../../../bodies/common/bodiesContract.js';
import { PACKS_CONTRACTS_VERSION as REAL_PACKS_CONTRACTS_VERSION } from '../../../packs/common/packsContract.js';
import { PROFILES_CONTRACTS_VERSION as REAL_PROFILES_CONTRACTS_VERSION } from '../../../profiles/common/profilesContract.js';
import { BENCHMARKS_CONTRACTS_VERSION as REAL_BENCHMARKS_CONTRACTS_VERSION } from '../../../benchmarks/common/benchmarksContract.js';
import { PROJECTIONS_CONTRACTS_VERSION as REAL_PROJECTIONS_CONTRACTS_VERSION } from '../../../projections/common/projectionsContract.js';
import { ACTIVATION_CONTRACTS_VERSION as REAL_ACTIVATION_CONTRACTS_VERSION } from '../../../activation/common/activationContract.js';
import { LAB_CONTRACTS_VERSION as REAL_LAB_CONTRACTS_VERSION, type LabScope } from '../../../../lab/common/labContracts.js';
import { learnWorkloadProfile, type LabActivityRecord } from '../../../../lab/common/workloadLearning.js';
import { searchOrganizations } from '../../../../lab/common/orgSearch.js';
import { runLadder, type CandidateScorer } from '../../../../lab/common/runEngine.js';
import { MIN_FACTORS_OBSERVATIONS as REAL_MIN_FACTORS_OBSERVATIONS, observeBridgeOutcome, buildCalibrationModel, correctScores } from '../../../../lab/common/calibration.js';
import { TASK_WORLDS } from '../../../../lab/common/taskWorlds.js';

import {
        ACTIVATION_CONTRACTS_VERSION,
        BENCHMARKS_CONTRACTS_VERSION,
        BODIES_CONTRACTS_VERSION,
        CALIBRATION_EVIDENCE_SCHEMA_KEYS,
        CALIBRATION_STATE_SCHEMA_KEYS,
        canTransitionLoopStage,
        DELTA_ADDITIONS_SCHEMA_KEYS,
        DELTA_CONTEXT_SCHEMA_KEYS,
        DELTA_RECORD_FAMILIES,
        DELTA_RECORD_REF_SCHEMA_KEYS,
        DELTA_SCHEMA_KEYS,
        DOMAIN_HARNESS_CONTRACTS_VERSION,
        EXECUTION_EVIDENCE_SCHEMA_KEYS,
        isDeltaRecordFamily,
        isLabScope,
        isLoopEvidenceLevel,
        isLoopId,
        isLoopLeg,
        isLoopOpName,
        isLoopStage,
        isOptimizationEvidenceLevel,
        isOptimizationLoopRejectionReason,
        isOptimizationParseRejectionReason,
        LAB_CONTRACTS_VERSION,
        loopEvidenceLevelRank,
        LOOP_EVIDENCE_LEVELS,
        LOOP_FORWARD_TRANSITIONS,
        LOOP_ID_PREFIX,
        LOOP_LEG_STAGES,
        LOOP_LEGS,
        LOOP_OP_LEGS,
        LOOP_OP_NAMES,
        LOOP_OP_REQUIRED_LEGS,
        LOOP_STAGES,
        MAX_ROLES,
        MEASURE_EVIDENCE_SCHEMA_KEYS,
        MIN_FACTORS_OBSERVATIONS,
        MISSING_CAPABILITY_SCHEMA_KEYS,
        ONBOARDING_CONTRACTS_VERSION,
        ONTOLOGY_CONTRACTS_VERSION,
        OPTIMIZATION_CONTRACTS_VERSION,
        OPTIMIZATION_EVIDENCE_LEVEL_CEILING,
        OPTIMIZATION_LOOP_RECORD_SCHEMA_KEYS,
        OPTIMIZATION_LOOP_REJECTION_REASONS,
        OPTIMIZATION_PARSE_REJECTION_REASONS,
        PACKS_CONTRACTS_VERSION,
        parseOptimizationLoop,
        PROFILES_CONTRACTS_VERSION,
        PROJECTIONS_CONTRACTS_VERSION,
        RECOMMENDATION_SCHEMA_KEYS,
        ROLLBACK_PATH_SCHEMA_KEYS,
        ROLES_CONTRACTS_VERSION,
        serializeOptimizationLoop,
        TEMPLATES_CONTRACTS_VERSION,
        UNCERTAINTY_SCHEMA_KEYS,
        validateHarnessDelta,
        validateHarnessOptimizationRecommendation,
        validateLoopApprovalMirror,
        validateOptimizationLoopRecord,
        validateTaskOutcome,
} from '../../common/optimizationContract.js';

const CONTRACT_SOURCE = readFileSync(fileURLToPath(new URL('../../common/optimizationContract.ts', import.meta.url)), 'utf8');

/** THE SCENARIO-BINDING LAW's pin-by-import: the fixture binds the REAL registry ids (never a fabricated list). */
const REAL_SCENARIO_IDS: string[] = TASK_WORLDS.flatMap((world) => world.taskScenarios.map((scenario) => scenario.id));

// --- the shared fixtures (THE CONTENT LAW: the caller supplies the domain content; fixture level) ---

const SCOPE: LabScope = { workspaceId: 'ws-fixture', tenantId: 'tenant-fixture' };
const NOW_ISO = '2026-03-01T00:00:00.000Z';

function makeActivityRecords(): LabActivityRecord[] {
        const rows: LabActivityRecord[] = [];
        const families = ['bugfix', 'bugfix', 'bugfix', 'bugfix', 'feature', 'feature'];
        for (let i = 0; i < families.length; i += 1) {
                rows.push({
                        scope: SCOPE,
                        taskFamily: families[i],
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
                });
        }
        return rows;
}

/** The REAL LAB-002 evidence (the battery drives the real module with fixture inputs - claim exactly that). */
const WORKLOAD = learnWorkloadProfile(
        SCOPE,
        makeActivityRecords(),
        { optIn: true, retentionDays: 30, exportable: true },
        'wp-fixture-1',
        NOW_ISO,
) as NonNullable<ReturnType<typeof learnWorkloadProfile>>;

const UTILITY_WEIGHTS = { success: 0.3, quality: 0.4, latency: 0.15, cost: 0.15 };

/** The REAL LAB-005 evidence (the deterministic fixture search; maxAgents 1 keeps the contract battery's payload small). */
const SIMULATION = searchOrganizations({
        scope: SCOPE,
        scenarioId: 'scenario-se-bugfix-regression',
        taskTypeId: 'tt-bugfix-tests',
        utilityWeights: UTILITY_WEIGHTS,
        ladderLevel: 1,
        seeds: [],
        maxAgents: 1,
}) as NonNullable<ReturnType<typeof searchOrganizations>>;

const LADDER_CANDIDATES = [
        SIMULATION.baseline.candidate,
        ...SIMULATION.candidates.filter((entry) => entry.candidate.id !== SIMULATION.baseline.candidate.id).map((entry) => entry.candidate),
];

/** The REAL LAB-006 evidence (the seeded, pinned ladder run). */
const COMPARISON = runLadder({
        scope: SCOPE,
        runId: 'flauz:opt:run:0123456789abcdef',
        taskScenarioId: 'scenario-se-bugfix-regression',
        ladderLevel: 1,
        seeds: [11],
        instanceCount: 4,
        utilityWeights: UTILITY_WEIGHTS,
        candidates: LADDER_CANDIDATES,
}) as NonNullable<ReturnType<typeof runLadder>>;

const BEST_REPORT = COMPARISON.bestReport;

const LOOP_ID = 'flauz:opt:0123456789abcdef';
const RECOMMENDATION_ID = 'flauz:opt:rec:0123456789abcdef';
const LAB_RECOMMENDATION_ID = 'flauz:opt:lab:0123456789abcdef';
const RUN_ID = COMPARISON.runId;

/** The fixture delta (THE CONTENT LAW: the caller supplies the additive change). */
function greenDelta(): Record<string, unknown> {
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

function greenReversibility(): Record<string, unknown> {
        return {
                reversible: true,
                rollback: {
                        route: 'dh011-activation-journey',
                        removeRecords: [{ family: 'benchmarks', recordId: 'flauz:ben:0123456789abcdef' }],
                        restoreRecords: [],
                },
        };
}

/** The REAL LabRecommendation shape minted for the calibration linkage (LAB-008's input). */
function greenLabRecommendation(): Record<string, unknown> {
        return {
                scope: SCOPE,
                contractVersion: LAB_CONTRACTS_VERSION,
                id: LAB_RECOMMENDATION_ID,
                runId: RUN_ID,
                organization: BEST_REPORT.candidate,
                rationale: 'The fixture lab recommendation over the seeded ladder run.',
                expectedGains: [...BEST_REPORT.comparison],
                confidence: 0.55,
                caveats: ['the fixture caveat'],
                reversible: true,
                auditTrail: ['observed the workload', 'simulated the candidates', 'compared the outcomes'],
                status: 'issued',
                createdAt: '2026-03-01T00:00:04.000Z',
        };
}

function greenUncertainty(): Record<string, unknown> {
        return {
                evidenceLevel: BEST_REPORT.evidenceLevel,
                workloadObservationCount: WORKLOAD.retainedRecordCount,
                simulationCandidateCount: SIMULATION.candidates.length,
                ladderSeedCount: 1,
                calibration: {
                        observationCount: 0,
                        minObservations: MIN_FACTORS_OBSERVATIONS,
                        belowMinimum: true,
                        model: null,
                },
                statement: 'The fixture uncertainty statement: the evidence is fixture-level, the prior calibration corpus is empty and the honest floor is disclosed.',
        };
}

function greenRecommendation(loopId: string = LOOP_ID): Record<string, unknown> {
        return {
                recommendationId: RECOMMENDATION_ID,
                contractVersion: OPTIMIZATION_CONTRACTS_VERSION,
                loopId,
                scope: SCOPE,
                runId: RUN_ID,
                workload: WORKLOAD,
                simulation: SIMULATION,
                comparison: COMPARISON,
                bestReportId: BEST_REPORT.id,
                expectedGains: [...BEST_REPORT.comparison],
                labRecommendation: greenLabRecommendation(),
                delta: greenDelta(),
                reversibility: greenReversibility(),
                uncertainty: greenUncertainty(),
                missingCapabilities: [],
                createdAtIso: '2026-03-01T00:00:04.000Z',
        };
}

const OUTCOME = { success: true, quality: 0.82, latencyMs: 120000, costUsd: 1.2, verification: [{ check: 'fixture-verification', passed: true }] };

/** The REAL LAB-008 calibration evidence (the bridge rows + the folded model + the corrected scores). */
function greenCalibrationEvidence(recommendation: Record<string, unknown>): Record<string, unknown> {
        const rows = observeBridgeOutcome({
                recommendation: recommendation.labRecommendation as Parameters<typeof observeBridgeOutcome>[0]['recommendation'],
                evaluation: BEST_REPORT,
                outcome: OUTCOME,
                bridgeEntryId: 'flauz:jrn:0123456789abcdef',
                observedAt: '2026-03-01T00:00:07.000Z',
        }) as NonNullable<ReturnType<typeof observeBridgeOutcome>>;
        const model = buildCalibrationModel(rows, SCOPE, '2026-03-01T00:00:08.000Z', 'fixture');
        return {
                records: rows,
                model,
                correctedScores: correctScores(BEST_REPORT.scores, model),
                calibratedAt: '2026-03-01T00:00:08.000Z',
        };
}

const EXECUTION_EVIDENCE = {
        journeyId: 'flauz:jrn:0123456789abcdef',
        journeyStage: 'composed',
        recordLinks: {
                ontologyId: 'flauz:ont:0123456789abcdef',
                templateId: 'flauz:tpl:0123456789abcdef',
                bodyId: 'flauz:bod:0123456789abcdef',
                packsId: 'flauz:pak:0123456789abcdef',
                profilesId: 'flauz:prf:0123456789abcdef',
                benchmarksId: 'flauz:ben:0123456789abcdef',
        },
        bindingHarnessId: 'flauz:hrn:0123456789abcdef',
};

const MEASURE_EVIDENCE = {
        benchmarkKey: 'regression-suite-health',
        evaluation: {
                benchmarksId: 'flauz:ben:0123456789abcdef',
                harnessId: 'flauz:hrn:0123456789abcdef',
                benchmarkKey: 'regression-suite-health',
                scores: [{ dimension: 'success', value: 0.75 }, { dimension: 'quality', value: 0.82 }],
                evidenceLevel: 'fixture',
        },
        outcome: OUTCOME,
        measuredAt: '2026-03-01T00:00:06.000Z',
};

/** The loop history notes (the frozen seven-key shape, in the canonical fixed-key order). */
function loopHistory(): Record<string, unknown>[] {
        return [
                { at: '2026-03-01T00:00:00.000Z', leg: null, fromStage: null, toStage: 'observe', op: 'begin-loop', law: 'THE FORWARD-ONLY LAW', detail: 'began the optimization loop' },
                { at: '2026-03-01T00:00:01.000Z', leg: 'observe', fromStage: 'observe', toStage: 'observe', op: 'observe-workload', law: 'THE AUDIT LAW', detail: 'observed the workload through the REAL LAB-002 learner' },
                { at: '2026-03-01T00:00:02.000Z', leg: 'simulate', fromStage: 'observe', toStage: 'simulate', op: 'simulate-candidates', law: 'THE AUDIT LAW', detail: 'simulated the candidate organizations through the REAL LAB-005 search' },
                { at: '2026-03-01T00:00:03.000Z', leg: 'compare', fromStage: 'simulate', toStage: 'compare', op: 'compare-outcomes', law: 'THE REPRODUCIBILITY LAW', detail: 'compared the outcomes through the REAL LAB-006 ladder' },
                { at: '2026-03-01T00:00:04.000Z', leg: 'recommend', fromStage: 'compare', toStage: 'recommend', op: 'recommend-improvement', law: 'THE AUDIT LAW', detail: 'recommended the improvement' },
                { at: '2026-03-01T00:00:05.000Z', leg: 'approve', fromStage: 'recommend', toStage: 'approve', op: 'obtain-approval', law: 'THE APPROVAL LAW', detail: 'recorded the caller approval decision' },
                { at: '2026-03-01T00:00:06.000Z', leg: 'execute', fromStage: 'approve', toStage: 'execute', op: 'execute-through-authorities', law: 'THE NO-SECOND-ENGINE LAW', detail: 'executed through the REAL DH-011 journey instrument' },
                { at: '2026-03-01T00:00:07.000Z', leg: 'measure', fromStage: 'execute', toStage: 'measure', op: 'measure-result', law: 'THE HONEST-MEASURE LAW', detail: 'measured through the REAL DH-09 evaluation surface' },
                { at: '2026-03-01T00:00:08.000Z', leg: 'calibrate', fromStage: 'measure', toStage: 'calibrate', op: 'calibrate', law: 'THE MEASURE-CALIBRATE LAWS', detail: 'calibrated through the REAL LAB-008 surfaces' },
        ];
}

/** The fully-walked green loop record (every stage's evidence present, the closed loop). */
function greenLoopRecord(): Record<string, unknown> {
        return {
                loopId: LOOP_ID,
                contractVersion: OPTIMIZATION_CONTRACTS_VERSION,
                stage: 'calibrate',
                scope: SCOPE,
                workload: WORKLOAD,
                simulation: SIMULATION,
                comparison: COMPARISON,
                recommendation: greenRecommendation(),
                approval: { approvedBy: 'fixture-approver', note: 'the fixture approval' },
                execution: EXECUTION_EVIDENCE,
                measures: MEASURE_EVIDENCE,
                calibration: greenCalibrationEvidence(greenRecommendation()),
                createdAtIso: '2026-03-01T00:00:00.000Z',
                revision: 9,
                history: loopHistory(),
        };
}

/** A record walked to the recommend stage (the audit trail's mid-walk shape). */
function recommendedLoopRecord(): Record<string, unknown> {
        return {
                loopId: LOOP_ID,
                contractVersion: OPTIMIZATION_CONTRACTS_VERSION,
                stage: 'recommend',
                scope: SCOPE,
                workload: WORKLOAD,
                simulation: SIMULATION,
                comparison: COMPARISON,
                recommendation: greenRecommendation(),
                approval: null,
                execution: null,
                measures: null,
                calibration: null,
                createdAtIso: '2026-03-01T00:00:00.000Z',
                revision: 5,
                history: loopHistory().slice(0, 5),
        };
}

/** The begin-only loop record (the walk's entry shape). */
function begunLoopRecord(): Record<string, unknown> {
        return {
                loopId: LOOP_ID,
                contractVersion: OPTIMIZATION_CONTRACTS_VERSION,
                stage: 'observe',
                scope: null,
                workload: null,
                simulation: null,
                comparison: null,
                recommendation: null,
                approval: null,
                execution: null,
                measures: null,
                calibration: null,
                createdAtIso: '2026-03-01T00:00:00.000Z',
                revision: 1,
                history: loopHistory().slice(0, 1),
        };
}

function refusalOf(outcome: { ok: boolean; rejection?: unknown }): { reason: string; law: string; message: string; items?: string[]; familyRejections?: unknown[] } {
        if (outcome.ok || outcome.rejection === undefined) {
                throw new Error('expected a refusal outcome');
        }
        return outcome.rejection as { reason: string; law: string; message: string; items?: string[]; familyRejections?: unknown[] };
}

function recordRefusalOf(outcome: { ok: boolean; rejection?: unknown }): { reason: string; law: string; message: string; items?: string[] } {
        return refusalOf(outcome);
}

function deepClone<T>(value: T): T {
        return JSON.parse(JSON.stringify(value)) as T;
}

// --- THE SINGLE-VERSION LAW's cross-pins ------------------------------------------------------------

suite('optimizationContract · version cross-pins (THE SINGLE-VERSION LAW + THE IMPORT LAW)', () => {
        test('OPTIMIZATION_CONTRACTS_VERSION is 1.0.0, declared exactly once in the contract module', () => {
                assert.strictEqual(OPTIMIZATION_CONTRACTS_VERSION, '1.0.0');
                const declarations = CONTRACT_SOURCE.match(/OPTIMIZATION_CONTRACTS_VERSION = '/g) ?? [];
                assert.strictEqual(declarations.length, 1, 'the version constant is declared exactly once');
        });

        test('the ELEVEN prior family versions are re-exported by reference and pinned equal (DH-01..DH-11)', () => {
                assert.strictEqual(DOMAIN_HARNESS_CONTRACTS_VERSION, REAL_DOMAIN_HARNESS_CONTRACTS_VERSION);
                assert.strictEqual(ONBOARDING_CONTRACTS_VERSION, REAL_ONBOARDING_CONTRACTS_VERSION);
                assert.strictEqual(ROLES_CONTRACTS_VERSION, REAL_ROLES_CONTRACTS_VERSION);
                assert.strictEqual(ONTOLOGY_CONTRACTS_VERSION, REAL_ONTOLOGY_CONTRACTS_VERSION);
                assert.strictEqual(TEMPLATES_CONTRACTS_VERSION, REAL_TEMPLATES_CONTRACTS_VERSION);
                assert.strictEqual(BODIES_CONTRACTS_VERSION, REAL_BODIES_CONTRACTS_VERSION);
                assert.strictEqual(PACKS_CONTRACTS_VERSION, REAL_PACKS_CONTRACTS_VERSION);
                assert.strictEqual(PROFILES_CONTRACTS_VERSION, REAL_PROFILES_CONTRACTS_VERSION);
                assert.strictEqual(BENCHMARKS_CONTRACTS_VERSION, REAL_BENCHMARKS_CONTRACTS_VERSION);
                assert.strictEqual(PROJECTIONS_CONTRACTS_VERSION, REAL_PROJECTIONS_CONTRACTS_VERSION);
                assert.strictEqual(ACTIVATION_CONTRACTS_VERSION, REAL_ACTIVATION_CONTRACTS_VERSION);
        });

        test('the REAL LAB_CONTRACTS_VERSION and the REAL calibration floor are pinned by reference', () => {
                assert.strictEqual(LAB_CONTRACTS_VERSION, REAL_LAB_CONTRACTS_VERSION);
                assert.strictEqual(MIN_FACTORS_OBSERVATIONS, REAL_MIN_FACTORS_OBSERVATIONS);
                assert.strictEqual(MIN_FACTORS_OBSERVATIONS, 3);
        });

        test('the REAL DH-03 MAX_ROLES bound is pinned by reference', () => {
                assert.strictEqual(MAX_ROLES, REAL_MAX_ROLES);
        });

        test('THE NO-SECOND-ENGINE LAW is disclosed in the contract header', () => {
                assert.ok(CONTRACT_SOURCE.includes('THE NO-SECOND-ENGINE LAW'), 'the header names the law');
                assert.ok(CONTRACT_SOURCE.includes('never'), 'the header states the never-schedule / never-execute discipline');
                assert.ok(CONTRACT_SOURCE.includes('DH-011 journey instrument'), 'the header names the real execution authority');
        });
});

// --- the frozen vocabularies ------------------------------------------------------------------------

suite('optimizationContract · the frozen loop vocabularies (THE FROZEN-VOCABULARY LAW)', () => {
        test('LOOP_STAGES is the registry row\'s eight stages in the exact loop order', () => {
                assert.deepStrictEqual(LOOP_STAGES, ['observe', 'simulate', 'compare', 'recommend', 'approve', 'execute', 'measure', 'calibrate']);
        });

        test('LOOP_LEGS is the same frozen vocabulary (the legs ARE the stages)', () => {
                assert.deepStrictEqual(LOOP_LEGS, LOOP_STAGES);
                assert.deepStrictEqual([...LOOP_LEGS], ['observe', 'simulate', 'compare', 'recommend', 'approve', 'execute', 'measure', 'calibrate']);
        });

        test('LOOP_OP_NAMES is the nine kit operations in the frozen order', () => {
                assert.deepStrictEqual([...LOOP_OP_NAMES], [
                        'begin-loop',
                        'observe-workload',
                        'simulate-candidates',
                        'compare-outcomes',
                        'recommend-improvement',
                        'obtain-approval',
                        'execute-through-authorities',
                        'measure-result',
                        'calibrate',
                ]);
        });

        test('LOOP_OP_LEGS: every stage op walks exactly its own stage\'s leg (begin-loop walks none)', () => {
                assert.deepStrictEqual(LOOP_OP_LEGS['begin-loop'], []);
                for (const op of LOOP_OP_NAMES) {
                        if (op === 'begin-loop') {
                                continue;
                        }
                        assert.strictEqual(LOOP_OP_LEGS[op].length, 1, `${op} walks exactly one leg`);
                }
                assert.strictEqual(LOOP_OP_LEGS['observe-workload'][0], 'observe');
                assert.strictEqual(LOOP_OP_LEGS['execute-through-authorities'][0], 'execute');
                assert.strictEqual(LOOP_OP_LEGS['calibrate'][0], 'calibrate');
        });

        test('LOOP_OP_REQUIRED_LEGS: the frontier table (the execute op requires the approve leg - THE APPROVAL LAW\'s structural floor)', () => {
                assert.deepStrictEqual(LOOP_OP_REQUIRED_LEGS['begin-loop'], []);
                assert.deepStrictEqual(LOOP_OP_REQUIRED_LEGS['observe-workload'], []);
                assert.deepStrictEqual(LOOP_OP_REQUIRED_LEGS['simulate-candidates'], ['observe']);
                assert.deepStrictEqual(LOOP_OP_REQUIRED_LEGS['compare-outcomes'], ['simulate']);
                assert.deepStrictEqual(LOOP_OP_REQUIRED_LEGS['recommend-improvement'], ['compare']);
                assert.deepStrictEqual(LOOP_OP_REQUIRED_LEGS['obtain-approval'], ['recommend']);
                assert.deepStrictEqual(LOOP_OP_REQUIRED_LEGS['execute-through-authorities'], ['approve']);
                assert.deepStrictEqual(LOOP_OP_REQUIRED_LEGS['measure-result'], ['execute']);
                assert.deepStrictEqual(LOOP_OP_REQUIRED_LEGS['calibrate'], ['measure']);
        });

        test('LOOP_LEG_STAGES: each leg lands its own stage (the observe self-edge is the gradual-evidence law)', () => {
                assert.strictEqual(LOOP_LEG_STAGES['observe'], 'observe');
                assert.strictEqual(LOOP_LEG_STAGES['simulate'], 'simulate');
                assert.strictEqual(LOOP_LEG_STAGES['recommend'], 'recommend');
                assert.strictEqual(LOOP_LEG_STAGES['execute'], 'execute');
                assert.strictEqual(LOOP_LEG_STAGES['calibrate'], 'calibrate');
        });

        test('OPTIMIZATION_LOOP_REJECTION_REASONS is the frozen 19-station walk order', () => {
                assert.deepStrictEqual([...OPTIMIZATION_LOOP_REJECTION_REASONS], [
                        'disposed',
                        'unknown-loop',
                        'malformed-record',
                        'version-mismatch',
                        'premature-stage',
                        'stale-stage',
                        'learning-opt-out',
                        'scenario-unresolvable',
                        'search-refused',
                        'ladder-refused',
                        'record-refused',
                        'evidence-ceiling',
                        'irreversible-refused',
                        'approval-missing',
                        'malformed-catalog',
                        'unsafe-delta',
                        'journey-refused',
                        'measure-refused',
                        'calibration-refused',
                ]);
        });

        test('OPTIMIZATION_PARSE_REJECTION_REASONS is the frozen five-reason parse order', () => {
                assert.deepStrictEqual([...OPTIMIZATION_PARSE_REJECTION_REASONS], ['malformed-json', 'torn-envelope', 'unknown-contract-version', 'unknown-key', 'invalid-record']);
        });

        test('the frozen schema-key tables (the canonical fixed-key orders)', () => {
                assert.deepStrictEqual([...DELTA_SCHEMA_KEYS], ['context', 'additions', 'replaces', 'rationale']);
                assert.deepStrictEqual([...DELTA_ADDITIONS_SCHEMA_KEYS], ['terms', 'tasks', 'bodies', 'packs', 'profiles', 'benchmarks']);
                assert.deepStrictEqual([...DELTA_CONTEXT_SCHEMA_KEYS], ['industry', 'companyProfile', 'workTypes', 'roles']);
                assert.deepStrictEqual([...DELTA_RECORD_REF_SCHEMA_KEYS], ['family', 'recordId']);
                assert.deepStrictEqual([...ROLLBACK_PATH_SCHEMA_KEYS], ['route', 'removeRecords', 'restoreRecords']);
                assert.deepStrictEqual([...RECOMMENDATION_SCHEMA_KEYS], [
                        'recommendationId', 'contractVersion', 'loopId', 'scope', 'runId', 'workload', 'simulation', 'comparison',
                        'bestReportId', 'expectedGains', 'labRecommendation', 'delta', 'reversibility', 'uncertainty', 'missingCapabilities', 'createdAtIso',
                ]);
                assert.deepStrictEqual([...UNCERTAINTY_SCHEMA_KEYS], ['evidenceLevel', 'workloadObservationCount', 'simulationCandidateCount', 'ladderSeedCount', 'calibration', 'statement']);
                assert.deepStrictEqual([...CALIBRATION_STATE_SCHEMA_KEYS], ['observationCount', 'minObservations', 'belowMinimum', 'model']);
                assert.deepStrictEqual([...MISSING_CAPABILITY_SCHEMA_KEYS], ['capabilityId', 'requiredLevel', 'bestScore', 'taskTypeId']);
                assert.deepStrictEqual([...EXECUTION_EVIDENCE_SCHEMA_KEYS], ['journeyId', 'journeyStage', 'recordLinks', 'bindingHarnessId']);
                assert.deepStrictEqual([...MEASURE_EVIDENCE_SCHEMA_KEYS], ['benchmarkKey', 'evaluation', 'outcome', 'measuredAt']);
                assert.deepStrictEqual([...CALIBRATION_EVIDENCE_SCHEMA_KEYS], ['records', 'model', 'correctedScores', 'calibratedAt']);
                assert.deepStrictEqual([...OPTIMIZATION_LOOP_RECORD_SCHEMA_KEYS], [
                        'loopId', 'contractVersion', 'stage', 'scope', 'workload', 'simulation', 'comparison', 'recommendation',
                        'approval', 'execution', 'measures', 'calibration', 'createdAtIso', 'revision', 'history',
                ]);
        });

        test('the delta-record family vocabulary is the six composed families (DELTA_RECORD_FAMILIES)', () => {
                assert.deepStrictEqual([...DELTA_RECORD_FAMILIES], ['ontology', 'templates', 'bodies', 'packs', 'profiles', 'benchmarks']);
                assert.ok(isDeltaRecordFamily('ontology'));
                assert.ok(!isDeltaRecordFamily('roles'));
                assert.ok(!isDeltaRecordFamily('contract'));
        });

        test('the closed predicates', () => {
                assert.ok(isLoopStage('observe'));
                assert.ok(!isLoopStage('observed'));
                assert.ok(isLoopLeg('calibrate'));
                assert.ok(!isLoopLeg(null));
                assert.ok(isLoopOpName('begin-loop'));
                assert.ok(!isLoopOpName('begin'));
                assert.ok(isOptimizationLoopRejectionReason('approval-missing'));
                assert.ok(!isOptimizationLoopRejectionReason('APPROVAL_MISSING'));
                assert.ok(isOptimizationParseRejectionReason('torn-envelope'));
                assert.ok(!isOptimizationParseRejectionReason('torn'));
        });

        test('isLoopId: the flauz:opt:<16-hex> alphabet', () => {
                assert.ok(isLoopId('flauz:opt:0123456789abcdef'));
                assert.ok(!isLoopId('flauz:opt:0123456789abcde'));
                assert.ok(!isLoopId('flauz:opt:0123456789ABCDEF'));
                assert.ok(!isLoopId('flauz:jrn:0123456789abcdef'));
                assert.ok(!isLoopId(42));
                assert.strictEqual(LOOP_ID_PREFIX, 'flauz:opt:');
        });

        test('isLabScope: the REAL LabScope shape', () => {
                assert.ok(isLabScope({ workspaceId: 'ws', tenantId: 't' }));
                assert.ok(!isLabScope({ workspaceId: '', tenantId: 't' }));
                assert.ok(!isLabScope({ workspaceId: 'ws' }));
                assert.ok(!isLabScope(null));
        });
});

// --- THE FORWARD-ONLY LAW's loop-stage machine -------------------------------------------------------

suite('optimizationContract · the loop-stage machine (THE FORWARD-ONLY LAW)', () => {
        test('LOOP_FORWARD_TRANSITIONS is exactly the seven forward rows', () => {
                assert.deepStrictEqual([...LOOP_FORWARD_TRANSITIONS], [
                        { from: 'observe', to: 'simulate' },
                        { from: 'simulate', to: 'compare' },
                        { from: 'compare', to: 'recommend' },
                        { from: 'recommend', to: 'approve' },
                        { from: 'approve', to: 'execute' },
                        { from: 'execute', to: 'measure' },
                        { from: 'measure', to: 'calibrate' },
                ]);
        });

        test('every forward row grants ok with its 1-based row number', () => {
                LOOP_FORWARD_TRANSITIONS.forEach((row, index) => {
                        const verdict = canTransitionLoopStage(row.from, row.to);
                        assert.ok(verdict.ok, `${row.from} -> ${row.to} is whitelisted`);
                        assert.strictEqual((verdict as { row: number }).row, index + 1);
                        assert.strictEqual((verdict as { from: string }).from, row.from);
                        assert.strictEqual((verdict as { to: string }).to, row.to);
                });
        });

        test('a skip is the typed ILLEGAL_TRANSITION naming the whitelisted successor (simulate -> recommend)', () => {
                const verdict = canTransitionLoopStage('simulate', 'recommend');
                assert.ok(!verdict.ok);
                assert.strictEqual(verdict.reason, 'ILLEGAL_TRANSITION');
                assert.strictEqual((verdict as { expectedTo: string | null }).expectedTo, 'compare');
                assert.strictEqual((verdict as { whitelistRow: number | null }).whitelistRow, 2);
        });

        test('a backward move is the typed ILLEGAL_TRANSITION (execute -> recommend)', () => {
                const verdict = canTransitionLoopStage('execute', 'recommend');
                assert.ok(!verdict.ok);
                assert.strictEqual(verdict.reason, 'ILLEGAL_TRANSITION');
                assert.strictEqual((verdict as { whitelistRow: number | null }).whitelistRow, 6);
                assert.strictEqual((verdict as { expectedTo: string | null }).expectedTo, 'measure');
        });

        test('a self-loop past observe is the typed ILLEGAL_TRANSITION (simulate -> simulate)', () => {
                const verdict = canTransitionLoopStage('simulate', 'simulate');
                assert.ok(!verdict.ok);
                assert.strictEqual(verdict.reason, 'ILLEGAL_TRANSITION');
        });

        test('\'calibrate\' is TERMINAL: no row leaves it, no successor exists', () => {
                const verdict = canTransitionLoopStage('calibrate', 'observe');
                assert.ok(!verdict.ok);
                assert.strictEqual((verdict as { whitelistRow: number | null }).whitelistRow, null);
                assert.strictEqual((verdict as { expectedTo: string | null }).expectedTo, null);
                assert.ok((verdict as { detail: string }).detail.includes('TERMINAL'));
        });

        test('unknown stages and non-strings are the typed ILLEGAL_TRANSITION', () => {
                const unknown = canTransitionLoopStage('frobnicate', 'simulate');
                assert.ok(!unknown.ok);
                assert.strictEqual(unknown.reason, 'ILLEGAL_TRANSITION');
                assert.strictEqual((unknown as { whitelistRow: number | null }).whitelistRow, null);
                const nonString = canTransitionLoopStage(42, 'simulate');
                assert.ok(!nonString.ok);
                assert.strictEqual(nonString.reason, 'ILLEGAL_TRANSITION');
                const unknownTo = canTransitionLoopStage('observe', 'frobnicate');
                assert.ok(!unknownTo.ok);
                assert.strictEqual(unknownTo.reason, 'ILLEGAL_TRANSITION');
                assert.strictEqual((unknownTo as { whitelistRow: number | null }).whitelistRow, 1);
        });
});

// --- THE EVIDENCE-CEILING LAW's ladder census ---------------------------------------------------------

suite('optimizationContract · the REAL evidence ladder census (THE EVIDENCE-CEILING LAW)', () => {
        test('LOOP_EVIDENCE_LEVELS is the REAL six-rung ladder in the frozen order (derived from the imported type)', () => {
                assert.deepStrictEqual([...LOOP_EVIDENCE_LEVELS], ['fixture', 'simulated', 'local-real', 'runtime-real', 'live-provider', 'production-real']);
        });

        test('OPTIMIZATION_EVIDENCE_LEVEL_CEILING is exactly the fixture/simulated subset', () => {
                assert.deepStrictEqual([...OPTIMIZATION_EVIDENCE_LEVEL_CEILING], ['fixture', 'simulated']);
                assert.ok(isOptimizationEvidenceLevel('fixture'));
                assert.ok(isOptimizationEvidenceLevel('simulated'));
                assert.ok(!isOptimizationEvidenceLevel('local-real'));
        });

        test('isLoopEvidenceLevel over the REAL ladder; the rank helper', () => {
                assert.ok(isLoopEvidenceLevel('fixture'));
                assert.ok(!isLoopEvidenceLevel('guaranteed'));
                assert.strictEqual(loopEvidenceLevelRank('fixture'), 0);
                assert.strictEqual(loopEvidenceLevelRank('simulated'), 1);
                assert.strictEqual(loopEvidenceLevelRank('production-real'), 5);
                assert.strictEqual(loopEvidenceLevelRank('nonsense'), -1);
                assert.strictEqual(loopEvidenceLevelRank(42), -1);
        });
});

// --- THE TYPED HARNESS DELTA walk ----------------------------------------------------------------------

suite('optimizationContract · the harness delta walk (THE AUDIT / CONTENT / REVERSIBILITY LAWS)', () => {
        test('the green delta validates and canonicalizes', () => {
                const outcome = validateHarnessDelta(greenDelta(), greenReversibility());
                assert.ok(outcome.ok);
                assert.strictEqual(outcome.value.delta.context.industry, 'software');
                assert.deepStrictEqual([...outcome.value.delta.context.workTypes], ['analysis', 'drafting', 'review']);
                assert.strictEqual(outcome.value.delta.additions.terms.length, 2);
                assert.strictEqual(outcome.value.delta.replaces.length, 0, 'the green delta carries no disclosed replacements; the rollback path carries its own remove row');
                assert.strictEqual(outcome.value.reversibility.reversible, true);
        });

        test('a non-object delta is the malformed-record refusal', () => {
                const outcome = validateHarnessDelta('delta', greenReversibility());
                const rejection = refusalOf(outcome);
                assert.strictEqual(rejection.reason, 'malformed-record');
                assert.strictEqual(rejection.law, 'THE FAIL-CLOSED LAW');
        });

        test('an unknown delta key is the STRICT-SCHEMA refusal (there is no mutation field)', () => {
                const delta = { ...greenDelta(), mutation: 'patch' } as Record<string, unknown>;
                const rejection = refusalOf(validateHarnessDelta(delta, greenReversibility()));
                assert.strictEqual(rejection.reason, 'malformed-record');
                assert.strictEqual(rejection.law, 'THE STRICT-SCHEMA LAW');
                assert.ok(rejection.message.includes('mutation'));
        });

        test('a missing delta key is the FAIL-CLOSED refusal', () => {
                const delta = greenDelta() as Record<string, unknown>;
                delete delta.rationale;
                const rejection = refusalOf(validateHarnessDelta(delta, greenReversibility()));
                assert.strictEqual(rejection.reason, 'malformed-record');
                assert.ok(rejection.message.includes('rationale'));
        });

        test('an empty rationale is the AUDIT-LAW refusal', () => {
                const delta = { ...greenDelta(), rationale: '' } as Record<string, unknown>;
                const rejection = refusalOf(validateHarnessDelta(delta, greenReversibility()));
                assert.strictEqual(rejection.reason, 'malformed-record');
                assert.strictEqual(rejection.law, 'THE AUDIT LAW');
        });

        test('the context stations: an unknown key and a missing key are refused', () => {
                const delta = deepClone(greenDelta());
                (delta.context as Record<string, unknown>).extra = 1;
                const rejection = refusalOf(validateHarnessDelta(delta, greenReversibility()));
                assert.strictEqual(rejection.reason, 'malformed-record');
                assert.strictEqual(rejection.law, 'THE STRICT-SCHEMA LAW');

                const delta2 = deepClone(greenDelta());
                delete (delta2.context as Record<string, unknown>).workTypes;
                const rejection2 = refusalOf(validateHarnessDelta(delta2, greenReversibility()));
                assert.strictEqual(rejection2.reason, 'malformed-record');
                assert.strictEqual(rejection2.law, 'THE FAIL-CLOSED LAW');
        });

        test('a foreign industry is refused by the REAL DH-02 walk, carried verbatim', () => {
                const delta = deepClone(greenDelta());
                (delta.context as Record<string, unknown>).industry = 'not-an-industry';
                const rejection = refusalOf(validateHarnessDelta(delta, greenReversibility()));
                assert.strictEqual(rejection.reason, 'malformed-record');
                assert.strictEqual(rejection.law, 'THE IMPORT LAW');
                assert.ok(Array.isArray(rejection.familyRejections) && rejection.familyRejections.length > 0, 'the REAL DH-02 refusal rides verbatim');
        });

        test('a malformed company profile is refused by the REAL DH-02 walk, carried verbatim', () => {
                const delta = deepClone(greenDelta());
                (delta.context as Record<string, unknown>).companyProfile = { displayName: '', sizeBand: 'small' };
                const rejection = refusalOf(validateHarnessDelta(delta, greenReversibility()));
                assert.strictEqual(rejection.reason, 'malformed-record');
                assert.ok(Array.isArray(rejection.familyRejections) && rejection.familyRejections.length > 0);
        });

        test('a foreign work type is refused by the REAL DH-02 walk, carried verbatim', () => {
                const delta = deepClone(greenDelta());
                (delta.context as Record<string, unknown>).workTypes = ['analysis', 'bogus'];
                const rejection = refusalOf(validateHarnessDelta(delta, greenReversibility()));
                assert.strictEqual(rejection.reason, 'malformed-record');
                assert.ok(Array.isArray(rejection.familyRejections) && rejection.familyRejections.length > 0);
        });

        test('the roles stations: non-array, empty (the MULTI-ROLE floor) and the MAX_ROLES bound', () => {
                const nonArray = deepClone(greenDelta());
                (nonArray.context as Record<string, unknown>).roles = 'analyst';
                assert.strictEqual(refusalOf(validateHarnessDelta(nonArray, greenReversibility())).reason, 'malformed-record');

                const empty = deepClone(greenDelta());
                (empty.context as Record<string, unknown>).roles = [];
                const emptyRejection = refusalOf(validateHarnessDelta(empty, greenReversibility()));
                assert.strictEqual(emptyRejection.reason, 'malformed-record');
                assert.strictEqual(emptyRejection.law, 'THE MULTI-ROLE LAW');

                const tooMany = deepClone(greenDelta());
                const roles = Array.from({ length: MAX_ROLES + 1 }, (_, index) => ({ roleKey: `role-${index}`, summary: 'The fixture role.' }));
                (tooMany.context as Record<string, unknown>).roles = roles;
                const boundRejection = refusalOf(validateHarnessDelta(tooMany, greenReversibility()));
                assert.strictEqual(boundRejection.reason, 'malformed-record');
                assert.strictEqual(boundRejection.law, 'THE MULTI-ROLE LAW');
                assert.ok(boundRejection.message.includes(String(MAX_ROLES)));
        });

        test('a malformed role entry surfaces the REAL DH-03 rejection table verbatim (record-refused)', () => {
                const delta = deepClone(greenDelta());
                (delta.context as Record<string, unknown>).roles = [{ roleKey: '', summary: 'The malformed role.' }];
                const rejection = refusalOf(validateHarnessDelta(delta, greenReversibility()));
                assert.strictEqual(rejection.reason, 'record-refused');
                assert.strictEqual(rejection.law, 'THE VERBATIM-CARRY LAW (context.roles[0])');
                assert.ok(Array.isArray(rejection.familyRejections) && rejection.familyRejections.length > 0, 'the COMPLETE DH-03 table is carried');
        });

        test('the additions stations: a non-object, an unknown family key and a missing family key are refused', () => {
                const nonObject = { ...greenDelta(), additions: 'nope' } as Record<string, unknown>;
                assert.strictEqual(refusalOf(validateHarnessDelta(nonObject, greenReversibility())).reason, 'malformed-record');

                const unknownFamily = deepClone(greenDelta());
                (unknownFamily.additions as Record<string, unknown>).roles = [];
                const unknownRejection = refusalOf(validateHarnessDelta(unknownFamily, greenReversibility()));
                assert.strictEqual(unknownRejection.reason, 'malformed-record');
                assert.strictEqual(unknownRejection.law, 'THE STRICT-SCHEMA LAW');

                const missingFamily = deepClone(greenDelta());
                delete (missingFamily.additions as Record<string, unknown>).packs;
                const missingRejection = refusalOf(validateHarnessDelta(missingFamily, greenReversibility()));
                assert.strictEqual(missingRejection.reason, 'malformed-record');
                assert.ok(missingRejection.message.includes('EMPTY array'));
        });

        test('a malformed term entry surfaces the REAL DH-04 rejection table verbatim (record-refused)', () => {
                const delta = deepClone(greenDelta());
                (delta.additions as Record<string, unknown>).terms = [{ term: '', definition: 'nope' }];
                const rejection = refusalOf(validateHarnessDelta(delta, greenReversibility()));
                assert.strictEqual(rejection.reason, 'record-refused');
                assert.ok(rejection.law.includes('additions.terms[0]'));
                assert.ok(Array.isArray(rejection.familyRejections) && rejection.familyRejections.length > 0);
        });

        test('a malformed task entry surfaces the REAL DH-05 rejection table verbatim', () => {
                const delta = deepClone(greenDelta());
                (delta.additions as Record<string, unknown>).tasks = [{ taskKey: 'survey', summary: 'Missing the term refs.' }];
                const rejection = refusalOf(validateHarnessDelta(delta, greenReversibility()));
                assert.strictEqual(rejection.reason, 'record-refused');
                assert.ok(rejection.law.includes('additions.tasks[0]'));
        });

        test('a malformed body entry surfaces the REAL DH-06 rejection table verbatim', () => {
                const delta = deepClone(greenDelta());
                (delta.additions as Record<string, unknown>).bodies = [{ bodyKey: 'triage', summary: 'Missing the role refs.' }];
                const rejection = refusalOf(validateHarnessDelta(delta, greenReversibility()));
                assert.strictEqual(rejection.reason, 'record-refused');
                assert.ok(rejection.law.includes('additions.bodies[0]'));
        });

        test('a malformed pack entry surfaces the REAL DH-07 rejection table verbatim', () => {
                const delta = deepClone(greenDelta());
                (delta.additions as Record<string, unknown>).packs = [{ packKey: 'core', summary: 'Missing the body refs.' }];
                const rejection = refusalOf(validateHarnessDelta(delta, greenReversibility()));
                assert.strictEqual(rejection.reason, 'record-refused');
                assert.ok(rejection.law.includes('additions.packs[0]'));
        });

        test('a malformed profile entry surfaces the REAL DH-08 rejection table verbatim', () => {
                const delta = deepClone(greenDelta());
                (delta.additions as Record<string, unknown>).profiles = [{ profileKey: 'core', summary: 'Missing every authority ref.' }];
                const rejection = refusalOf(validateHarnessDelta(delta, greenReversibility()));
                assert.strictEqual(rejection.reason, 'record-refused');
                assert.ok(rejection.law.includes('additions.profiles[0]'));
        });

        test('a malformed benchmark entry surfaces the REAL DH-09 rejection table verbatim', () => {
                const delta = deepClone(greenDelta());
                (delta.additions as Record<string, unknown>).benchmarks = [{ benchmarkKey: 'regression-suite-health', summary: 'Missing the hypothesis.' }];
                const rejection = refusalOf(validateHarnessDelta(delta, greenReversibility()));
                assert.strictEqual(rejection.reason, 'record-refused');
                assert.ok(rejection.law.includes('additions.benchmarks[0]'));
        });

        test('the replaces stations: a non-array, an unknown key, a foreign family and a foreign record id', () => {
                const nonArray = { ...greenDelta(), replaces: 'nope' } as Record<string, unknown>;
                assert.strictEqual(refusalOf(validateHarnessDelta(nonArray, greenReversibility())).reason, 'malformed-record');

                const unknownKey = deepClone(greenDelta());
                (unknownKey as Record<string, unknown>).replaces = [{ family: 'ontology', recordId: 'flauz:ont:0123456789abcdef', extra: 1 }];
                assert.strictEqual(refusalOf(validateHarnessDelta(unknownKey, greenReversibility())).law, 'THE STRICT-SCHEMA LAW');

                const foreignFamily = deepClone(greenDelta());
                (foreignFamily as Record<string, unknown>).replaces = [{ family: 'roles', recordId: 'flauz:rol:0123456789abcdef' }];
                const familyRejection = refusalOf(validateHarnessDelta(foreignFamily, greenReversibility()));
                assert.strictEqual(familyRejection.reason, 'malformed-record');
                assert.strictEqual(familyRejection.law, 'THE FROZEN-VOCABULARY LAW');

                const foreignId = deepClone(greenDelta());
                (foreignId as Record<string, unknown>).replaces = [{ family: 'ontology', recordId: 'flauz:tpl:0123456789abcdef' }];
                const idRejection = refusalOf(validateHarnessDelta(foreignId, greenReversibility()));
                assert.strictEqual(idRejection.reason, 'malformed-record');
                assert.strictEqual(idRejection.law, 'THE IMPORT LAW');
        });

        test('a replace ref carrying the OWNING family\'s REAL id form passes (the FORM law)', () => {
                const delta = deepClone(greenDelta());
                (delta as Record<string, unknown>).replaces = [
                        { family: 'ontology', recordId: 'flauz:ont:0123456789abcdef' },
                        { family: 'benchmarks', recordId: 'flauz:ben:0123456789abcdef' },
                ];
                const outcome = validateHarnessDelta(delta, greenReversibility());
                assert.ok(outcome.ok);
                assert.strictEqual(outcome.value.delta.replaces.length, 2);
        });
});

suite('optimizationContract · THE REVERSIBILITY LAW at the delta boundary', () => {
        test('a reversible delta REQUIRES its typed rollback path', () => {
                const rejection = refusalOf(validateHarnessDelta(greenDelta(), { reversible: true }));
                assert.strictEqual(rejection.reason, 'malformed-record');
                assert.strictEqual(rejection.law, 'THE REVERSIBILITY LAW');
                assert.ok((rejection.items ?? []).includes('rollback'));
        });

        test('the rollback route is frozen to the REAL DH-011 journey instrument', () => {
                const reversibility = {
                        reversible: true,
                        rollback: { route: 'direct-mutation', removeRecords: [], restoreRecords: [] },
                };
                const rejection = refusalOf(validateHarnessDelta(greenDelta(), reversibility));
                assert.strictEqual(rejection.reason, 'malformed-record');
                assert.ok(rejection.message.includes('dh011-activation-journey'));
        });

        test('the rollback-path schema is closed and complete', () => {
                const unknownKey = {
                        reversible: true,
                        rollback: { route: 'dh011-activation-journey', removeRecords: [], restoreRecords: [], extra: 1 },
                };
                assert.strictEqual(refusalOf(validateHarnessDelta(greenDelta(), unknownKey)).law, 'THE STRICT-SCHEMA LAW');

                const missingKey = {
                        reversible: true,
                        rollback: { route: 'dh011-activation-journey', removeRecords: [] },
                };
                assert.strictEqual(refusalOf(validateHarnessDelta(greenDelta(), missingKey)).law, 'THE REVERSIBILITY LAW');

                const malformedRefs = {
                        reversible: true,
                        rollback: { route: 'dh011-activation-journey', removeRecords: 'none', restoreRecords: [] },
                };
                assert.strictEqual(refusalOf(validateHarnessDelta(greenDelta(), malformedRefs)).reason, 'malformed-record');
        });

        test('an irreversible delta without the explicit acknowledgement is REFUSED (the reversible-first law, the named typed refusal)', () => {
                const rejection = refusalOf(validateHarnessDelta(greenDelta(), { reversible: false }));
                assert.strictEqual(rejection.reason, 'irreversible-refused');
                assert.strictEqual(rejection.law, 'THE REVERSIBLE-FIRST LAW');
        });

        test('an empty acknowledgement is still refused', () => {
                const rejection = refusalOf(validateHarnessDelta(greenDelta(), { reversible: false, acknowledgedBy: '' }));
                assert.strictEqual(rejection.reason, 'irreversible-refused');
        });

        test('an irreversible delta WITH the explicit acknowledgement validates (the acknowledged path)', () => {
                const outcome = validateHarnessDelta(greenDelta(), { reversible: false, acknowledgedBy: 'fixture-ops-lead' });
                assert.ok(outcome.ok);
                assert.strictEqual(outcome.value.reversibility.reversible, false);
                assert.strictEqual((outcome.value.reversibility as { acknowledgedBy: string }).acknowledgedBy, 'fixture-ops-lead');
        });

        test('a non-boolean reversible field is refused', () => {
                const rejection = refusalOf(validateHarnessDelta(greenDelta(), { reversible: 'yes' }));
                assert.strictEqual(rejection.reason, 'malformed-record');
        });
});

// --- THE TYPED RECOMMENDATION walk ----------------------------------------------------------------------

suite('optimizationContract · the typed recommendation walk (THE AUDIT / LINKAGE / UNCERTAINTY / MISSING-CAPABILITY LAWS)', () => {
        test('the green recommendation validates and canonicalizes (the zero-gap green path)', () => {
                const outcome = validateHarnessOptimizationRecommendation(greenRecommendation());
                assert.ok(outcome.ok);
                assert.strictEqual(outcome.recommendation.recommendationId, RECOMMENDATION_ID);
                assert.strictEqual(outcome.recommendation.missingCapabilities.length, 0, 'the zero-entry ledger is the green path');
                assert.strictEqual(outcome.recommendation.uncertainty.evidenceLevel, BEST_REPORT.evidenceLevel);
        });

        test('a non-object, an unknown key and a missing key are the malformed-record refusals', () => {
                assert.strictEqual(refusalOf(validateHarnessOptimizationRecommendation('nope')).reason, 'malformed-record');
                const unknownKey = { ...greenRecommendation(), promoted: true } as Record<string, unknown>;
                assert.strictEqual(refusalOf(validateHarnessOptimizationRecommendation(unknownKey)).law, 'THE STRICT-SCHEMA LAW');
                const missingKey = greenRecommendation() as Record<string, unknown>;
                delete missingKey.missingCapabilities;
                const missingRejection = refusalOf(validateHarnessOptimizationRecommendation(missingKey));
                assert.strictEqual(missingRejection.reason, 'malformed-record');
                assert.ok(missingRejection.message.includes('missingCapabilities'), 'the closed schema requires the ledger key');

                const notAnArray = { ...greenRecommendation(), missingCapabilities: null } as Record<string, unknown>;
                const arrayRejection = refusalOf(validateHarnessOptimizationRecommendation(notAnArray));
                assert.ok(arrayRejection.message.includes('never silently dropped'), 'the ledger field is never absent, never silently dropped');
        });

        test('a foreign contract version is the version-mismatch refusal', () => {
                const recommendation = { ...greenRecommendation(), contractVersion: '9.9.9' } as Record<string, unknown>;
                const rejection = refusalOf(validateHarnessOptimizationRecommendation(recommendation));
                assert.strictEqual(rejection.reason, 'version-mismatch');
                assert.strictEqual(rejection.law, 'THE SINGLE-VERSION LAW');
        });

        test('a malformed loop link and a malformed scope are refused', () => {
                const badLoop = { ...greenRecommendation(), loopId: 'flauz:opt:nope' } as Record<string, unknown>;
                assert.strictEqual(refusalOf(validateHarnessOptimizationRecommendation(badLoop)).reason, 'malformed-record');
                const badScope = { ...greenRecommendation(), scope: { workspaceId: '' } } as Record<string, unknown>;
                const scopeRejection = refusalOf(validateHarnessOptimizationRecommendation(badScope));
                assert.strictEqual(scopeRejection.reason, 'malformed-record');
                assert.ok(scopeRejection.message.includes('LabScope'));
        });

        test('the verbatim-evidence stations: a foreign workload profile version, missing counts and silent warnings are refused', () => {
                const foreignVersion = deepClone(greenRecommendation());
                (foreignVersion.workload as Record<string, unknown>).profile = { ...(WORKLOAD.profile as unknown as Record<string, unknown>), contractVersion: '9.9.9' };
                assert.ok(refusalOf(validateHarnessOptimizationRecommendation(foreignVersion)).message.includes('WorkloadProfile'));

                const missingCounts = deepClone(greenRecommendation());
                delete (missingCounts.workload as Record<string, unknown>).retainedRecordCount;
                assert.ok(refusalOf(validateHarnessOptimizationRecommendation(missingCounts)).message.includes('retainedRecordCount'));

                const silentWarnings = deepClone(greenRecommendation());
                (silentWarnings.workload as Record<string, unknown>).warnings = [];
                assert.ok(refusalOf(validateHarnessOptimizationRecommendation(silentWarnings)).message.includes('honest warnings'));
        });

        test('the verbatim-evidence stations: a foreign simulation version, an empty candidate list and a missing baseline are refused', () => {
                const foreignVersion = deepClone(greenRecommendation());
                (foreignVersion.simulation as Record<string, unknown>).contractVersion = '9.9.9';
                assert.ok(refusalOf(validateHarnessOptimizationRecommendation(foreignVersion)).message.includes('LAB_CONTRACTS_VERSION'));

                const noCandidates = deepClone(greenRecommendation());
                (noCandidates.simulation as Record<string, unknown>).candidates = [];
                assert.ok(refusalOf(validateHarnessOptimizationRecommendation(noCandidates)).message.includes('non-empty ranked candidate list'));

                const noBaseline = deepClone(greenRecommendation());
                delete (noBaseline.simulation as Record<string, unknown>).baseline;
                assert.ok(refusalOf(validateHarnessOptimizationRecommendation(noBaseline)).message.includes('baseline'));
        });

        test('the verbatim-evidence stations: a foreign comparison version and a thin report are refused', () => {
                const foreignVersion = deepClone(greenRecommendation());
                (foreignVersion.comparison as Record<string, unknown>).contractVersion = '0.0.1';
                assert.ok(refusalOf(validateHarnessOptimizationRecommendation(foreignVersion)).message.includes('LAB_CONTRACTS_VERSION'));

                const thinReport = deepClone(greenRecommendation());
                const comparison = thinReport.comparison as { reports: Record<string, unknown>[] };
                comparison.reports = comparison.reports.map((report) => ({ ...report, scores: (report.scores as unknown[]).slice(0, 2) }));
                assert.ok(refusalOf(validateHarnessOptimizationRecommendation(thinReport)).message.includes('four real evaluation dimensions'));
        });

        test('THE LINKAGE LAW: the best report id must name a carried report', () => {
                const recommendation = { ...greenRecommendation(), bestReportId: 'eval-unknown' } as Record<string, unknown>;
                const rejection = refusalOf(validateHarnessOptimizationRecommendation(recommendation));
                assert.strictEqual(rejection.reason, 'malformed-record');
                assert.strictEqual(rejection.law, 'THE LINKAGE LAW');
        });

        test('THE LINKAGE LAW: the winning report\'s run id must agree with the recommendation\'s run link', () => {
                const recommendation = { ...greenRecommendation(), runId: 'flauz:opt:run:ffffffffffffffff' } as Record<string, unknown>;
                const rejection = refusalOf(validateHarnessOptimizationRecommendation(recommendation));
                assert.strictEqual(rejection.reason, 'malformed-record');
                assert.ok(rejection.message.includes('disagrees'));
        });

        test('the expected gains: an empty array and a malformed row are refused', () => {
                const empty = deepClone(greenRecommendation());
                (empty as Record<string, unknown>).expectedGains = [];
                assert.strictEqual(refusalOf(validateHarnessOptimizationRecommendation(empty)).reason, 'malformed-record');

                const malformed = deepClone(greenRecommendation());
                (malformed as Record<string, unknown>).expectedGains = [{ dimension: 'success', candidateValue: 1, baselineValue: 0 }];
                const rowRejection = refusalOf(validateHarnessOptimizationRecommendation(malformed));
                assert.strictEqual(rowRejection.reason, 'malformed-record');
                assert.ok(rowRejection.message.includes('BaselineComparison'));
        });

        test('the REAL LabRecommendation linkage: a foreign version, a run disagreement and a scope disagreement are refused', () => {
                const foreignVersion = deepClone(greenRecommendation());
                (foreignVersion.labRecommendation as Record<string, unknown>).contractVersion = '9.9.9';
                assert.ok(refusalOf(validateHarnessOptimizationRecommendation(foreignVersion)).message.includes('labRecommendation'));

                const runDisagreement = deepClone(greenRecommendation());
                (runDisagreement.labRecommendation as Record<string, unknown>).runId = 'flauz:opt:run:ffffffffffffffff';
                const runRejection = refusalOf(validateHarnessOptimizationRecommendation(runDisagreement));
                assert.strictEqual(runRejection.law, 'THE LINKAGE LAW');
                assert.ok(runRejection.message.includes('observeBridgeOutcome'));

                const scopeDisagreement = deepClone(greenRecommendation());
                (scopeDisagreement.labRecommendation as Record<string, unknown>).scope = { workspaceId: 'ws-other', tenantId: 'tenant-other' };
                assert.ok(refusalOf(validateHarnessOptimizationRecommendation(scopeDisagreement)).message.includes('scope'));
        });

        test('the REAL LabRecommendation shape: the reversible flag and the status vocabulary are enforced', () => {
                const irreversible = deepClone(greenRecommendation());
                (irreversible.labRecommendation as Record<string, unknown>).reversible = false;
                assert.ok(refusalOf(validateHarnessOptimizationRecommendation(irreversible)).message.includes('reversible'));

                const badStatus = deepClone(greenRecommendation());
                (badStatus.labRecommendation as Record<string, unknown>).status = 'rejected';
                assert.ok(refusalOf(validateHarnessOptimizationRecommendation(badStatus)).message.includes('frozen status list'));
        });

        test('a failing delta inside the recommendation surfaces the delta walk\'s refusal verbatim', () => {
                const recommendation = deepClone(greenRecommendation());
                (recommendation as Record<string, unknown>).reversibility = { reversible: false };
                const rejection = refusalOf(validateHarnessOptimizationRecommendation(recommendation));
                assert.strictEqual(rejection.reason, 'irreversible-refused');
                assert.strictEqual(rejection.law, 'THE REVERSIBLE-FIRST LAW');
        });

        test('THE EVIDENCE-CEILING LAW: an uncertainty level above \'simulated\' is the typed promotion refusal', () => {
                const recommendation = deepClone(greenRecommendation());
                const uncertainty = recommendation.uncertainty as Record<string, unknown>;
                uncertainty.evidenceLevel = 'local-real';
                const rejection = refusalOf(validateHarnessOptimizationRecommendation(recommendation));
                assert.strictEqual(rejection.reason, 'evidence-ceiling');
                assert.strictEqual(rejection.law, 'THE EVIDENCE-CEILING LAW');
                assert.ok(rejection.message.includes('NEVER promotes'));
        });

        test('the uncertainty level must agree with the winning report\'s own level (the honest claim)', () => {
                const recommendation = deepClone(greenRecommendation());
                const uncertainty = recommendation.uncertainty as Record<string, unknown>;
                uncertainty.evidenceLevel = 'simulated';
                const rejection = refusalOf(validateHarnessOptimizationRecommendation(recommendation));
                assert.strictEqual(rejection.reason, 'malformed-record');
                assert.strictEqual(rejection.law, 'THE UNCERTAINTY LAW');
                assert.ok(rejection.message.includes('disagrees'));
        });

        test('the uncertainty schema stations: unknown key, missing key, non-number counts and an empty statement', () => {
                const unknownKey = deepClone(greenRecommendation());
                (unknownKey.uncertainty as Record<string, unknown>).confidence = 0.99;
                assert.strictEqual(refusalOf(validateHarnessOptimizationRecommendation(unknownKey)).law, 'THE STRICT-SCHEMA LAW');

                const missingKey = deepClone(greenRecommendation());
                delete (missingKey.uncertainty as Record<string, unknown>).statement;
                assert.strictEqual(refusalOf(validateHarnessOptimizationRecommendation(missingKey)).law, 'THE UNCERTAINTY LAW');

                const nonNumber = deepClone(greenRecommendation());
                (nonNumber.uncertainty as Record<string, unknown>).workloadObservationCount = 'six';
                const countRejection = refusalOf(validateHarnessOptimizationRecommendation(nonNumber));
                assert.strictEqual(countRejection.reason, 'malformed-record');
                assert.ok(countRejection.message.includes('counts'));

                const emptyStatement = deepClone(greenRecommendation());
                (emptyStatement.uncertainty as Record<string, unknown>).statement = '';
                assert.strictEqual(refusalOf(validateHarnessOptimizationRecommendation(emptyStatement)).reason, 'malformed-record');
        });

        test('THE UNCERTAINTY LAW\'s calibration honesty: the floor is the REAL MIN_FACTORS_OBSERVATIONS and belowMinimum must say the truth', () => {
                const wrongFloor = deepClone(greenRecommendation());
                const calibration = (wrongFloor.uncertainty as Record<string, unknown>).calibration as Record<string, unknown>;
                calibration.minObservations = 2;
                const floorRejection = refusalOf(validateHarnessOptimizationRecommendation(wrongFloor));
                assert.ok(floorRejection.message.includes(String(MIN_FACTORS_OBSERVATIONS)));

                const lyingFlag = deepClone(greenRecommendation());
                const lying = (lyingFlag.uncertainty as Record<string, unknown>).calibration as Record<string, unknown>;
                lying.observationCount = 2;
                lying.belowMinimum = false;
                const lyingRejection = refusalOf(validateHarnessOptimizationRecommendation(lyingFlag));
                assert.strictEqual(lyingRejection.reason, 'malformed-record');
                assert.ok(lyingRejection.message.includes('never a fabricated confidence'));

                const honest = deepClone(greenRecommendation());
                const honestCalibration = (honest.uncertainty as Record<string, unknown>).calibration as Record<string, unknown>;
                honestCalibration.observationCount = 4;
                honestCalibration.belowMinimum = false;
                honestCalibration.model = {
                        scope: SCOPE,
                        contractVersion: LAB_CONTRACTS_VERSION,
                        factors: { success: 1, quality: 1, latency: 1, cost: 1 },
                        reliabilityCurve: [],
                        observationCount: 4,
                        evidenceLevel: 'fixture',
                        computedAt: '2026-03-01T00:00:08.000Z',
                };
                assert.ok(validateHarnessOptimizationRecommendation(honest).ok, 'an honest above-floor state validates');
        });

        test('THE MISSING-CAPABILITY LAW: the ledger entries are closed, complete and honestly shaped', () => {
                const notAnArray = { ...greenRecommendation(), missingCapabilities: 'none' } as Record<string, unknown>;
                const arrayRejection = refusalOf(validateHarnessOptimizationRecommendation(notAnArray));
                assert.strictEqual(arrayRejection.law, 'THE MISSING-CAPABILITY LAW');

                const unknownKey = deepClone(greenRecommendation());
                (unknownKey as Record<string, unknown>).missingCapabilities = [{ capabilityId: 'debugging', requiredLevel: 0.4, bestScore: 0, taskTypeId: 'tt-bugfix-tests', gap: 0.4 }];
                assert.strictEqual(refusalOf(validateHarnessOptimizationRecommendation(unknownKey)).law, 'THE STRICT-SCHEMA LAW');

                const missingKey = deepClone(greenRecommendation());
                (missingKey as Record<string, unknown>).missingCapabilities = [{ capabilityId: 'debugging', requiredLevel: 0.4, bestScore: 0 }];
                assert.strictEqual(refusalOf(validateHarnessOptimizationRecommendation(missingKey)).law, 'THE MISSING-CAPABILITY LAW');

                const malformed = deepClone(greenRecommendation());
                (malformed as Record<string, unknown>).missingCapabilities = [{ capabilityId: '', requiredLevel: 0.4, bestScore: 0, taskTypeId: 'tt-bugfix-tests' }];
                assert.strictEqual(refusalOf(validateHarnessOptimizationRecommendation(malformed)).reason, 'malformed-record');

                const honestGap = deepClone(greenRecommendation());
                (honestGap as Record<string, unknown>).missingCapabilities = [{ capabilityId: 'debugging', requiredLevel: 0.4, bestScore: 0, taskTypeId: 'tt-bugfix-tests' }];
                assert.ok(validateHarnessOptimizationRecommendation(honestGap).ok, 'a reported gap validates (never silently dropped)');
        });

        test('a missing creation timestamp is refused', () => {
                const recommendation = { ...greenRecommendation(), createdAtIso: '' } as Record<string, unknown>;
                assert.strictEqual(refusalOf(validateHarnessOptimizationRecommendation(recommendation)).reason, 'malformed-record');
        });
});

// --- the decision mirror + the exported evidence walks ---------------------------------------------------

suite('optimizationContract · the decision mirror and the exported evidence walks', () => {
        test('validateLoopApprovalMirror: the { approvedBy, note? } evidence shape, canonical key order', () => {
                const outcome = validateLoopApprovalMirror({ approvedBy: 'fixture-approver', note: 'the fixture approval' });
                assert.ok(outcome.ok);
                assert.deepStrictEqual(Object.keys(outcome.value), ['approvedBy', 'note']);

                const minimal = validateLoopApprovalMirror({ approvedBy: 'fixture-approver' });
                assert.ok(minimal.ok);
                assert.deepStrictEqual(Object.keys(minimal.value), ['approvedBy']);
        });

        test('validateLoopApprovalMirror refusals: non-object, unknown key, missing approvedBy, empty values', () => {
                assert.ok(!validateLoopApprovalMirror('nope').ok);
                assert.ok(!validateLoopApprovalMirror({ approvedBy: 'a', rejected: 'b' }).ok);
                assert.ok(!validateLoopApprovalMirror({ note: 'n' }).ok);
                assert.ok(!validateLoopApprovalMirror({ approvedBy: '' }).ok);
                assert.ok(!validateLoopApprovalMirror({ approvedBy: 'a', note: 7 }).ok);
        });

        test('validateTaskOutcome: the REAL TaskOutcome walk', () => {
                assert.strictEqual(validateTaskOutcome(OUTCOME), null);
                assert.ok(validateTaskOutcome({ success: 'yes', quality: 0.5, latencyMs: 1, costUsd: 1, verification: [] }) !== null);
                assert.ok(validateTaskOutcome({ success: true, quality: Number.NaN, latencyMs: 1, costUsd: 1, verification: [] }) !== null);
                assert.ok(validateTaskOutcome({ success: true, quality: 0.5, latencyMs: 1, costUsd: 1, verification: 'none' }) !== null);
                assert.ok(validateTaskOutcome({ success: true, quality: 0.5, latencyMs: 1, costUsd: 1, verification: [{ check: 'c', passed: 'yes' }] }) !== null);
        });
});

// --- the deep loop-record walk ----------------------------------------------------------------------------

suite('optimizationContract · the deep loop-record walk (THE FORWARD-ONLY + AUDIT + LINKAGE LAWS)', () => {
        test('the fully-walked green record validates (the closed loop, every stage\'s evidence present)', () => {
                const outcome = validateOptimizationLoopRecord(greenLoopRecord());
                assert.ok(outcome.ok);
                assert.strictEqual(outcome.record.stage, 'calibrate');
                assert.strictEqual(outcome.record.revision, 9);
                assert.strictEqual(outcome.record.history.length, 9);
        });

        test('the begin-only record validates (the entry shape, every evidence null)', () => {
                const outcome = validateOptimizationLoopRecord(begunLoopRecord());
                assert.ok(outcome.ok);
                assert.strictEqual(outcome.record.stage, 'observe');
                assert.strictEqual(outcome.record.workload, null);
        });

        test('the mid-walk record validates (walked to recommend)', () => {
                const outcome = validateOptimizationLoopRecord(recommendedLoopRecord());
                assert.ok(outcome.ok);
                assert.strictEqual(outcome.record.stage, 'recommend');
                assert.strictEqual(outcome.record.approval, null);
        });

        test('a non-object, an unknown key and a missing key are refused', () => {
                assert.strictEqual(recordRefusalOf(validateOptimizationLoopRecord(42)).reason, 'malformed-record');
                const unknownKey = { ...greenLoopRecord(), promoted: true } as Record<string, unknown>;
                assert.strictEqual(recordRefusalOf(validateOptimizationLoopRecord(unknownKey)).law, 'THE STRICT-SCHEMA LAW');
                const missingKey = greenLoopRecord() as Record<string, unknown>;
                delete missingKey.calibration;
                assert.strictEqual(recordRefusalOf(validateOptimizationLoopRecord(missingKey)).reason, 'malformed-record');
        });

        test('a malformed loop id fails closed as unknown-loop (the DH-01 NOT_FOUND discipline)', () => {
                const record = { ...begunLoopRecord(), loopId: 'flauz:opt:nope' } as Record<string, unknown>;
                const rejection = recordRefusalOf(validateOptimizationLoopRecord(record));
                assert.strictEqual(rejection.reason, 'unknown-loop');
        });

        test('a foreign contract version is the version-mismatch refusal', () => {
                const record = { ...begunLoopRecord(), contractVersion: '2.0.0' } as Record<string, unknown>;
                const rejection = recordRefusalOf(validateOptimizationLoopRecord(record));
                assert.strictEqual(rejection.reason, 'version-mismatch');
        });

        test('the stage must agree with the walked history (the walk\'s current stage)', () => {
                const record = { ...begunLoopRecord(), stage: 'simulate' } as Record<string, unknown>;
                const rejection = recordRefusalOf(validateOptimizationLoopRecord(record));
                assert.strictEqual(rejection.reason, 'malformed-record');
                assert.ok(rejection.message.includes('history'));
        });

        test('evidence never runs ahead of the walk (the FORWARD-ONLY refusal)', () => {
                const record = { ...begunLoopRecord(), workload: WORKLOAD } as Record<string, unknown>;
                const rejection = recordRefusalOf(validateOptimizationLoopRecord(record));
                assert.strictEqual(rejection.reason, 'malformed-record');
                assert.ok(rejection.message.includes('never runs ahead'));
        });

        test('a walked leg never leaves its evidence null (the AUDIT refusal)', () => {
                const record = deepClone(recommendedLoopRecord());
                (record as Record<string, unknown>).comparison = null;
                const rejection = recordRefusalOf(validateOptimizationLoopRecord(record));
                assert.strictEqual(rejection.reason, 'malformed-record');
                assert.strictEqual(rejection.law, 'THE AUDIT LAW');
                assert.ok(rejection.message.includes('mandatory'));
        });

        test('the workload evidence scope must agree with the recorded loop scope (no cross-tenant leakage)', () => {
                const record = deepClone(recommendedLoopRecord());
                record.scope = { workspaceId: 'ws-other', tenantId: 'tenant-fixture' };
                const rejection = recordRefusalOf(validateOptimizationLoopRecord(record));
                assert.strictEqual(rejection.reason, 'malformed-record');
                assert.strictEqual(rejection.law, 'THE LINKAGE LAW');
        });

        test('the recommendation\'s loop link must agree with the record\'s loop id', () => {
                const record = deepClone(recommendedLoopRecord());
                (record.recommendation as Record<string, unknown>).loopId = 'flauz:opt:ffffffffffffffff';
                const rejection = recordRefusalOf(validateOptimizationLoopRecord(record));
                assert.strictEqual(rejection.law, 'THE LINKAGE LAW');
                assert.ok(rejection.message.includes('loop id'));
        });

        test('the recommendation\'s carried evidence must be the loop\'s OWN evidence (the run link and the profile link)', () => {
                const runDrift = deepClone(recommendedLoopRecord());
                (runDrift.recommendation as Record<string, unknown>).comparison = { ...COMPARISON, runId: 'flauz:opt:run:ffffffffffffffff' };
                const runRejection = recordRefusalOf(validateOptimizationLoopRecord(runDrift));
                assert.ok(runRejection.message.includes('run'));

                const profileDrift = deepClone(recommendedLoopRecord());
                (profileDrift.recommendation as Record<string, unknown>).workload = { ...WORKLOAD, profile: { ...(WORKLOAD.profile as unknown as Record<string, unknown>), id: 'wp-other' } };
                const profileRejection = recordRefusalOf(validateOptimizationLoopRecord(profileDrift));
                assert.ok(profileRejection.message.includes('profile'));
        });

        test('the history walk: an empty history, a wrong note schema and a non-begin first note are refused', () => {
                const empty = { ...begunLoopRecord(), history: [] } as Record<string, unknown>;
                assert.ok(recordRefusalOf(validateOptimizationLoopRecord(empty)).message.includes('begin note'));

                const wrongKeys = deepClone(begunLoopRecord());
                (wrongKeys.history as Record<string, unknown>[])[0] = { op: 'begin-loop', at: '2026-03-01T00:00:00.000Z', leg: null, fromStage: null, toStage: 'observe', law: 'THE FORWARD-ONLY LAW', detail: 'began' };
                assert.ok(recordRefusalOf(validateOptimizationLoopRecord(wrongKeys)).message.includes('fixed-key order'));

                const notBegin = deepClone(begunLoopRecord());
                (notBegin.history as Record<string, unknown>[])[0] = { at: '2026-03-01T00:00:00.000Z', leg: 'observe', fromStage: 'observe', toStage: 'observe', op: 'observe-workload', law: 'THE AUDIT LAW', detail: 'observed' };
                assert.ok(recordRefusalOf(validateOptimizationLoopRecord(notBegin)).message.includes('first note'));
        });

        test('the history walk: the legs never walk back and the op must walk its own leg', () => {
                const walkingBack = deepClone(recommendedLoopRecord());
                const history = walkingBack.history as Record<string, unknown>[];
                history[4] = { at: '2026-03-01T00:00:04.000Z', leg: 'observe', fromStage: 'compare', toStage: 'observe', op: 'observe-workload', law: 'THE AUDIT LAW', detail: 'observed again' };
                assert.ok(recordRefusalOf(validateOptimizationLoopRecord(walkingBack)).message.includes('never walk back'));

                const wrongLeg = deepClone(recommendedLoopRecord());
                const wrongHistory = wrongLeg.history as Record<string, unknown>[];
                wrongHistory[4] = { at: '2026-03-01T00:00:04.000Z', leg: 'simulate', fromStage: 'compare', toStage: 'simulate', op: 'recommend-improvement', law: 'THE AUDIT LAW', detail: 'recommended' };
                assert.ok(recordRefusalOf(validateOptimizationLoopRecord(wrongLeg)).message.includes('op<->leg table'));
        });

        test('the history walk: the stage chain never breaks and the leg lands its stage-table stage', () => {
                const brokenChain = deepClone(recommendedLoopRecord());
                const history = brokenChain.history as Record<string, unknown>[];
                history[4] = { at: '2026-03-01T00:00:04.000Z', leg: 'recommend', fromStage: 'simulate', toStage: 'recommend', op: 'recommend-improvement', law: 'THE AUDIT LAW', detail: 'recommended' };
                assert.ok(recordRefusalOf(validateOptimizationLoopRecord(brokenChain)).message.includes('stage chain'));

                const wrongLanding = deepClone(recommendedLoopRecord());
                const landingHistory = wrongLanding.history as Record<string, unknown>[];
                landingHistory[4] = { at: '2026-03-01T00:00:04.000Z', leg: 'recommend', fromStage: 'compare', toStage: 'approve', op: 'recommend-improvement', law: 'THE AUDIT LAW', detail: 'recommended' };
                assert.ok(recordRefusalOf(validateOptimizationLoopRecord(wrongLanding)).message.includes('leg<->stage table'));
        });

        test('the execution evidence walk: the REAL journey id, the composed stage, the six REAL family ids and the binding draft', () => {
                const foreignJourney = deepClone(greenLoopRecord());
                (foreignJourney.execution as Record<string, unknown>).journeyId = 'flauz:opt:0123456789abcdef';
                assert.ok(recordRefusalOf(validateOptimizationLoopRecord(foreignJourney)).message.includes('isJourneyId'));

                const wrongStage = deepClone(greenLoopRecord());
                (wrongStage.execution as Record<string, unknown>).journeyStage = 'active';
                const stageRejection = recordRefusalOf(validateOptimizationLoopRecord(wrongStage));
                assert.ok(stageRejection.message.includes('composed'));
                assert.ok(stageRejection.message.includes('NO-SECOND-ENGINE'));

                const foreignLink = deepClone(greenLoopRecord());
                const links = (foreignLink.execution as Record<string, unknown>).recordLinks as Record<string, unknown>;
                links.templateId = 'flauz:ont:0123456789abcdef';
                assert.ok(recordRefusalOf(validateOptimizationLoopRecord(foreignLink)).message.includes('OWNING family'));

                const foreignHarness = deepClone(greenLoopRecord());
                (foreignHarness.execution as Record<string, unknown>).bindingHarnessId = 'flauz:jrn:0123456789abcdef';
                assert.ok(recordRefusalOf(validateOptimizationLoopRecord(foreignHarness)).message.includes('isHarnessId'));
        });

        test('the measure evidence walk: the DH-09 evaluation shape, the ceiling and the REAL TaskOutcome', () => {
                const mismatchedKey = deepClone(greenLoopRecord());
                const evaluation = (mismatchedKey.measures as Record<string, unknown>).evaluation as Record<string, unknown>;
                evaluation.benchmarkKey = 'other-benchmark';
                assert.ok(recordRefusalOf(validateOptimizationLoopRecord(mismatchedKey)).message.includes('disagrees'));

                const promoted = deepClone(greenLoopRecord());
                const promotedEvaluation = (promoted.measures as Record<string, unknown>).evaluation as Record<string, unknown>;
                promotedEvaluation.evidenceLevel = 'production-real';
                const ceilingRejection = recordRefusalOf(validateOptimizationLoopRecord(promoted));
                assert.strictEqual(ceilingRejection.law, 'THE HONEST-MEASURE LAW');
                assert.ok(ceilingRejection.message.includes('EVIDENCE-CEILING'));

                const inventedOutcome = deepClone(greenLoopRecord());
                (inventedOutcome.measures as Record<string, unknown>).outcome = { success: true, quality: 0.5, latencyMs: 1, costUsd: 1 };
                const outcomeRejection = recordRefusalOf(validateOptimizationLoopRecord(inventedOutcome));
                assert.strictEqual(outcomeRejection.law, 'THE HONEST-MEASURE LAW');
                assert.ok(outcomeRejection.message.includes('TaskOutcome'));
        });

        test('the calibration evidence walk: the REAL rows, the folded model and the corrected scores', () => {
                const noRows = deepClone(greenLoopRecord());
                (noRows.calibration as Record<string, unknown>).records = [];
                assert.ok(recordRefusalOf(validateOptimizationLoopRecord(noRows)).message.includes('non-empty'));

                const foreignRowVersion = deepClone(greenLoopRecord());
                const rows = (foreignRowVersion.calibration as Record<string, unknown>).records as Record<string, unknown>[];
                rows[0] = { ...rows[0], contractVersion: '9.9.9' };
                assert.ok(recordRefusalOf(validateOptimizationLoopRecord(foreignRowVersion)).message.includes('CalibrationRecord'));

                const dishonestCount = deepClone(greenLoopRecord());
                const model = (dishonestCount.calibration as Record<string, unknown>).model as Record<string, unknown>;
                model.observationCount = 99;
                const countRejection = recordRefusalOf(validateOptimizationLoopRecord(dishonestCount));
                assert.ok(countRejection.message.includes('honest counts'));

                const noScores = deepClone(greenLoopRecord());
                (noScores.calibration as Record<string, unknown>).correctedScores = [];
                assert.ok(recordRefusalOf(validateOptimizationLoopRecord(noScores)).message.includes('corrected'));
        });
});

// --- the canonical serialization + THE FAIL-CLOSED PARSE ---------------------------------------------------

suite('optimizationContract · the canonical serialization + THE FAIL-CLOSED PARSE', () => {
        test('the full record round-trips byte-identically (canonical fixed-key order)', () => {
                const bytes = serializeOptimizationLoop(greenLoopRecord());
                const parsed = parseOptimizationLoop(bytes);
                assert.ok(parsed.ok);
                const again = serializeOptimizationLoop(parsed.record);
                assert.strictEqual(again, bytes);
        });

        test('the begin-only and mid-walk records round-trip byte-identically', () => {
                for (const record of [begunLoopRecord(), recommendedLoopRecord()]) {
                        const bytes = serializeOptimizationLoop(record);
                        const parsed = parseOptimizationLoop(bytes);
                        assert.ok(parsed.ok);
                        assert.strictEqual(serializeOptimizationLoop(parsed.record), bytes);
                }
        });

        test('serializeOptimizationLoop refuses a non-record (no dishonest evidence ever gets canonical bytes)', () => {
                assert.throws(() => serializeOptimizationLoop({ ...begunLoopRecord(), stage: 'teleport' }), TypeError);
        });

        test('parse: non-string bytes are the torn-envelope refusal', () => {
                const outcome = parseOptimizationLoop(42);
                assert.ok(!outcome.ok);
                assert.strictEqual(outcome.rejection.reason, 'torn-envelope');
        });

        test('parse: malformed JSON is the malformed-json refusal', () => {
                const outcome = parseOptimizationLoop('{');
                assert.ok(!outcome.ok);
                assert.strictEqual(outcome.rejection.reason, 'malformed-json');
        });

        test('parse: a non-object envelope is the torn-envelope refusal', () => {
                const outcome = parseOptimizationLoop('[]');
                assert.ok(!outcome.ok);
                assert.strictEqual(outcome.rejection.reason, 'torn-envelope');
        });

        test('parse: a missing record key is the torn-envelope refusal (a torn write)', () => {
                const bytes = serializeOptimizationLoop(begunLoopRecord());
                const parsed = JSON.parse(bytes) as Record<string, unknown>;
                delete parsed.revision;
                const outcome = parseOptimizationLoop(JSON.stringify(parsed));
                assert.ok(!outcome.ok);
                assert.strictEqual(outcome.rejection.reason, 'torn-envelope');
                assert.ok(outcome.rejection.message.includes('revision'));
        });

        test('parse: a wrong structural type is the torn-envelope refusal', () => {
                const bytes = serializeOptimizationLoop(begunLoopRecord());
                const parsed = JSON.parse(bytes) as Record<string, unknown>;
                parsed.history = {};
                const outcome = parseOptimizationLoop(JSON.stringify(parsed));
                assert.ok(!outcome.ok);
                assert.strictEqual(outcome.rejection.reason, 'torn-envelope');
        });

        test('parse: a foreign contract version is the unknown-contract-version refusal', () => {
                const bytes = serializeOptimizationLoop(begunLoopRecord());
                const parsed = JSON.parse(bytes) as Record<string, unknown>;
                parsed.contractVersion = '0.0.1';
                const outcome = parseOptimizationLoop(JSON.stringify(parsed));
                assert.ok(!outcome.ok);
                assert.strictEqual(outcome.rejection.reason, 'unknown-contract-version');
        });

        test('parse: an unknown record key is the unknown-key refusal', () => {
                const bytes = serializeOptimizationLoop(begunLoopRecord());
                const parsed = JSON.parse(bytes) as Record<string, unknown>;
                parsed.extra = 1;
                const outcome = parseOptimizationLoop(JSON.stringify(parsed));
                assert.ok(!outcome.ok);
                assert.strictEqual(outcome.rejection.reason, 'unknown-key');
        });

        test('parse: an unknown history-note key is the unknown-key refusal', () => {
                const bytes = serializeOptimizationLoop(begunLoopRecord());
                const parsed = JSON.parse(bytes) as { history: Record<string, unknown>[] };
                parsed.history[0].extra = 1;
                const outcome = parseOptimizationLoop(JSON.stringify(parsed));
                assert.ok(!outcome.ok);
                assert.strictEqual(outcome.rejection.reason, 'unknown-key');
                assert.ok(outcome.rejection.message.includes('note'));
        });

        test('parse: an unknown approval-mirror key is the unknown-key refusal', () => {
                const bytes = serializeOptimizationLoop(greenLoopRecord());
                const parsed = JSON.parse(bytes) as { approval: Record<string, unknown> };
                parsed.approval.rejected = 'b';
                const outcome = parseOptimizationLoop(JSON.stringify(parsed));
                assert.ok(!outcome.ok);
                assert.strictEqual(outcome.rejection.reason, 'unknown-key');
                assert.ok(outcome.rejection.message.includes('approval'));
        });

        test('parse: a deep-walk refusal is the invalid-record refusal (first-failure-is-the-verdict)', () => {
                const bytes = serializeOptimizationLoop(begunLoopRecord());
                const parsed = JSON.parse(bytes) as Record<string, unknown>;
                parsed.stage = 'simulate';
                const outcome = parseOptimizationLoop(JSON.stringify(parsed));
                assert.ok(!outcome.ok);
                assert.strictEqual(outcome.rejection.reason, 'invalid-record');
                assert.ok(outcome.rejection.message.includes('deep loop walk'));
        });
});

// --- THE DETERMINISM LAW (the in-suite greps) -----------------------------------------------------------------

suite('optimizationContract · determinism greps (THE DETERMINISM LAW)', () => {
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
