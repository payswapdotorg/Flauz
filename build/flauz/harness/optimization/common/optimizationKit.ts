/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * DH-012 optimization kit family: the deterministic loop kit - the
 * twelfth item of the Domain Harness OS workstream (WORK-REGISTRY.md
 * § TL-B). The kit drives the registry row's eight-stage chain
 *   observe workload -> simulate candidate configurations ->
 *   compare outcomes -> recommend improvement -> obtain required
 *   approval -> execute through existing Flauz authorities ->
 *   measure result -> calibrate
 * THROUGH THE REAL LAB MODULES and executes ONLY through the EXISTING
 * Flauz authorities.
 *
 * THE NO-SECOND-ENGINE LAW (ARCHITECTURE-LOCK §10.7 + §12.6, the row's
 * core law): the kit RECOMMENDS and RECORDS - it never schedules,
 * never executes work, never writes a second journal (beyond its own
 * evidence mirror), never becomes a model router, a capability
 * authority or a persistence authority. Every real surface is a REAL
 * landed module, imported by reference and DRIVEN, never
 * re-implemented:
 *   - observeWorkload  -> the REAL LAB-002 learnWorkloadProfile over
 *                        the caller-supplied activity records (THE
 *                        PRIVACY LAW: the raw records are a TRANSIENT
 *                        input - only the derived
 *                        WorkloadLearningResult ever persists);
 *   - simulateCandidates -> the REAL LAB-005 searchOrganizations over
 *                        the observed profile (the request derived
 *                        deterministically from the profile: the
 *                        coupled scenario, the dominant task type, the
 *                        budget/SLA-derived utility weights);
 *   - compareOutcomes  -> the REAL LAB-006 runLadder over the ranked
 *                        candidates and the REAL deterministic task
 *                        worlds (THE REPRODUCIBILITY LAW: the seeds
 *                        are caller-pinned, the worlds are imported);
 *   - recommendImprovement -> composes the typed
 *                        HarnessOptimizationRecommendation through
 *                        the contract's own deep walk (THE AUDIT /
 *                        UNCERTAINTY / MISSING-CAPABILITY /
 *                        REVERSIBILITY LAWS enforced at this
 *                        boundary), minting the REAL LabRecommendation
 *                        shape the REAL calibration linkage consumes;
 *   - obtainApproval   -> records the caller's approval decision (THE
 *                        APPROVAL LAW - the EVIDENCE mirror, never
 *                        brokered);
 *   - executeThroughAuthorities -> routes the approved delta through
 *                        the REAL DH-011 activation journey instrument
 *                        (reopened over the SAME seams through the
 *                        REAL loadActivationKit; the delta's context
 *                        selections and six-family record composition
 *                        walk the REAL journey legs - beginJourney,
 *                        selectIndustry, composeCompany,
 *                        selectWorkTypes, composeRoles, composeRecords -
 *                        every real refusal carried verbatim). The
 *                        journey lands at 'composed' and STOPS THERE:
 *                        the proposal, the approval and the activation
 *                        of the composed configuration remain the
 *                        USER's journey through the REAL DH-01
 *                        authority (THE EVIDENCE-NOT-AUTHORITY LAW of
 *                        the DH-011 row, re-proven here: this surface
 *                        routes, never executes, never brokers);
 *   - measureResult   -> the caller-supplied measures through the
 *                        REAL DH-09 evaluation surface (the REAL
 *                        loadBenchmarksKit + evaluateBenchmark - the
 *                        honest-measure law: the kit NEVER invents
 *                        scores; the caller-supplied REAL TaskOutcome
 *                        rides verbatim);
 *   - calibrate       -> the REAL LAB-008 observeBridgeOutcome /
 *                        buildCalibrationModel / correctScores over
 *                        the measured records (the linkage laws of
 *                        the real module hold: the recommendation,
 *                        the winning evaluation, the observed outcome
 *                        and the journey link all agree).
 *
 * THE APPROVAL LAW: no recommendation reaches the execute stage
 * without the recorded caller approval decision - an unapproved
 * execute attempt is the typed approval-missing refusal leaving the
 * loop record byte-identical (THE RECORD-UNCHANGED LAW).
 *
 * THE PERSISTENCE MIRROR (PIN-2): `<root>/.flauz/harness/
 * optimization-ops.jsonl` (the append-only ops ledger - the authority)
 * + `<root>/.flauz/harness/optimization-loops.json` (the envelope -
 * the mirror). The ledger replay re-proves the loop laws FROM THE
 * LEDGER ALONE: the frozen line schema, the op<->leg table, the stage
 * chain through the contract's own machine, the payload walks through
 * the REAL validators (the workload / search / ladder structural
 * walks, the recommendation's own deep walk, the decision mirror, the
 * execution / measure / calibration evidence walks), THE
 * FORWARD-ONLY LAW's frontier discipline, THE APPROVAL-BEFORE-EXECUTE
 * LAW and the full record walk after every applied line. E_LEDGER_TORN
 * / E_ENVELOPE_MISMATCH fail closed; restart-deterministic.
 *
 * THE DETERMINISM LAW: no Math.random, no Date.now, no new Date(...)
 * and no process.env in this module (law comments excepted) - the
 * clock, the rng, the catalog and the fsPort are INJECTED seams the
 * kit forwards VERBATIM to every real module it drives (the REAL
 * journey instrument and the REAL benchmarks kit are constructed with
 * the SAME seams and the SAME root, so their own ledgers land beside
 * this family's mirror - one authority per surface, no second engine).
 */

import {
        LAB_CONTRACTS_VERSION,
        type LabScope,
        type TaskScenario,
        type WorkloadProfile,
} from '../../../lab/common/labContracts.js';
import { learnWorkloadProfile } from '../../../lab/common/workloadLearning.js';
import type { LabActivityRecord, WorkloadLearningControls, WorkloadLearningResult } from '../../../lab/common/workloadLearning.js';
import { FIXTURE_REQUIRED_CAPABILITIES, searchOrganizations } from '../../../lab/common/orgSearch.js';
import type { OrgSearchResult } from '../../../lab/common/orgSearch.js';
import { runLadder } from '../../../lab/common/runEngine.js';
import type { CandidateScorer, LadderRunResult } from '../../../lab/common/runEngine.js';
import { MIN_FACTORS_OBSERVATIONS, buildCalibrationModel, correctScores, observeBridgeOutcome } from '../../../lab/common/calibration.js';
import { TASK_WORLDS } from '../../../lab/common/taskWorlds.js';
import { capabilityCoverage } from '../../../lab/common/agentBodies.js';
import { loadActivationKit } from '../../activation/common/activationKit.js';
import type { ActivationKit, ActivationKitRefusal, JourneyOutcome as ActivationJourneyOutcome } from '../../activation/common/activationKit.js';
import type { ActivationJourneyRecord } from '../../activation/common/activationContract.js';
import { loadBenchmarksKit } from '../../benchmarks/common/benchmarksKit.js';
import type { BenchmarksKitRefusal } from '../../benchmarks/common/benchmarksKit.js';
import { isHarnessCatalogSnapshot } from '../../contract/common/domainHarnessContract.js';
import type { HarnessCatalogSnapshot } from '../../contract/common/domainHarnessContract.js';
import type { HarnessFsPort } from '../../contract/common/domainHarnessKit.js';
import {
        LOOP_ID_PREFIX,
        LOOP_LEG_STAGES,
        LOOP_OP_LEGS,
        LOOP_OP_REQUIRED_LEGS,
        LOOP_STAGES,
        OPTIMIZATION_CONTRACTS_VERSION,
        OPTIMIZATION_LOOP_REJECTION_REASONS,
        canTransitionLoopStage,
        isLabScope,
        isLoopEvidenceLevel,
        isLoopId,
        isLoopOpName,
        isLoopStage,
        loopEvidenceLevelRank,
        loopLegIndex,
        serializeOptimizationLoop,
        validateHarnessDelta,
        validateHarnessOptimizationRecommendation,
        validateLadderEvidence,
        validateLoopApprovalMirror,
        validateLoopCalibrationEvidence,
        validateLoopExecutionEvidence,
        validateLoopMeasureEvidence,
        validateOptimizationLoopRecord,
        validateSearchEvidence,
        validateTaskOutcome,
        validateWorkloadEvidence,
} from './optimizationContract.js';
import type {
        HarnessOptimizationRecommendation,
        LoopCalibrationEvidence,
        LoopContentRejection,
        LoopExecutionEvidence,
        LoopLeg,
        LoopMeasureEvidence,
        LoopOpName,
        LoopStage,
        OptimizationLoopRecord,
} from './optimizationContract.js';

/** THE SINGLE-VERSION LAW: re-carried by reference (declared ONCE in the contract module). */
export { OPTIMIZATION_CONTRACTS_VERSION } from './optimizationContract.js';

// --- the frozen loop constants (this family's own, disclosed) --------------------------------------

/**
 * The frozen organization-search bound (the loop's documented
 * constant): the REAL search enumerates the fixture catalog at
 * organization sizes 1..LOOP_SEARCH_MAX_AGENTS. A wider bound is a
 * versioned contract decision (the payload cost of THE AUDIT LAW's
 * verbatim carry grows with the enumeration).
 */
export const LOOP_SEARCH_MAX_AGENTS = 2;

/** The envelope path (relative to the injected root; the same .flauz/harness subtree as DH-01, distinct file). */
export const OPTIMIZATION_ENVELOPE_RELATIVE_PATH = '.flauz/harness/optimization-loops.json';

/** The append-only ops ledger path (relative to the injected root; the same .flauz/harness subtree as DH-01, distinct file). */
export const OPTIMIZATION_LEDGER_RELATIVE_PATH = '.flauz/harness/optimization-ops.jsonl';

/**
 * The frozen ledger-line schema keys, in the canonical fixed-key-order
 * (the serialization order). The payload column carries the op's OWN
 * evidence (the REAL module output, carried verbatim): the observe
 * line carries ONLY the derived WorkloadLearningResult (THE PRIVACY
 * LAW - the raw activity records are a transient input and never
 * persist); the simulate / compare lines carry the REAL search and
 * ladder results; the recommend line carries the typed
 * recommendation; the approve line the decision mirror; the execute /
 * measure / calibrate lines the typed evidence records.
 */
export const OPTIMIZATION_LEDGER_LINE_SCHEMA_KEYS = [
        'seq',
        'at',
        'contractVersion',
        'op',
        'loopId',
        'leg',
        'fromStage',
        'toStage',
        'law',
        'payload',
        'detail',
] as const;

/** The frozen envelope schema keys, in the canonical fixed-key-order. */
export const OPTIMIZATION_ENVELOPE_SCHEMA_KEYS = ['contractVersion', 'seq', 'loops'] as const;

/**
 * One append-only optimization ops ledger line (the canonical
 * persisted op): the seq (equal to the line number), the clock
 * reading, the contract version, the op name, the loop id, the walked
 * leg (null ONLY on the begin line), the net stage edge, the granting
 * law, the canonical op payload (the op's own evidence, carried
 * verbatim) and the deterministic detail sentence.
 */
export interface OptimizationOpsLedgerLine {
        readonly seq: number;
        readonly at: string;
        readonly contractVersion: string;
        readonly op: LoopOpName;
        readonly loopId: string;
        readonly leg: LoopLeg | null;
        readonly fromStage: LoopStage | null;
        readonly toStage: LoopStage;
        readonly law: string;
        readonly payload:
                | null
                | WorkloadLearningResult
                | OrgSearchResult
                | LadderRunResult
                | HarnessOptimizationRecommendation
                | Readonly<Record<string, string>>
                | LoopExecutionEvidence
                | LoopMeasureEvidence
                | LoopCalibrationEvidence;
        readonly detail: string;
}

// --- the kit-layer refusal vocabulary ----------------------------------------------------------------

/**
 * The kit-layer refusal extras (the frozen list beyond the contract's
 * OPTIMIZATION_LOOP_REJECTION_REASONS):
 *   E_LEDGER_TORN        - THE APPEND-ONLY LEDGER LAW: a torn or
 *                          missing optimization ledger line, a
 *                          structurally invalid or out-of-order line,
 *                          an unknown op or contract version, an
 *                          illegal stage edge or a fail-closed law
 *                          violation inside the ledger (an execute
 *                          line without the approval line), or a
 *                          fresh kit attempting to append over an
 *                          existing non-empty optimization ledger
 *                          (reopen with loadOptimizationKit);
 *   E_ENVELOPE_MISMATCH  - THE APPEND-ONLY LEDGER LAW: the loop
 *                          envelope diverges from the ledger replay
 *                          (or is missing / malformed while the
 *                          ledger carries lines) - never silently
 *                          rebuilt;
 *   OPTIMIZATION_IO      - THE FAIL-CLOSED LAW: the injected fs port
 *                          refused a read / append / write / mkdir on
 *                          the optimization family's own files;
 *   CORRUPT_SEAM         - THE DETERMINISM LAW: the injected clock or
 *                          rng returned a malformed value mid-op (an
 *                          empty clock reading, a non-16-hex rng
 *                          output, a duplicate minted id);
 *   UNKNOWN_FILTER       - THE FAIL-CLOSED LAW: listLoops received an
 *                          unknown filter field or a non-member
 *                          filter value.
 */
export const OPTIMIZATION_KIT_EXTRA_REFUSAL_REASONS = [
        'E_LEDGER_TORN',
        'E_ENVELOPE_MISMATCH',
        'OPTIMIZATION_IO',
        'CORRUPT_SEAM',
        'UNKNOWN_FILTER',
] as const;

/** The frozen kit refusal vocabulary: the contract's 19 domain reasons (imported by reference) plus the kit-layer extras. */
export const OPTIMIZATION_KIT_REFUSAL_REASONS = [
        ...OPTIMIZATION_LOOP_REJECTION_REASONS,
        ...OPTIMIZATION_KIT_EXTRA_REFUSAL_REASONS,
] as const;
export type OptimizationKitRefusalReason = (typeof OPTIMIZATION_KIT_REFUSAL_REASONS)[number];

/** Pure predicate over the closed kit-refusal list. */
export function isOptimizationKitRefusalReason(value: unknown): value is OptimizationKitRefusalReason {
        return (OPTIMIZATION_KIT_REFUSAL_REASONS as readonly string[]).includes(value as string);
}

/**
 * The typed kit refusal: the frozen reason, the LEG the refusal names
 * (THE VERBATIM-CARRY LAW - null on the begin / load surfaces), the
 * violated law's name, the deterministic message, the optional
 * offending items, and - THE VERBATIM-CARRY LAW - the owning real
 * surface's own typed refusal, carried complete, never paraphrased:
 * contentRejection for the contract-level walks (itself carrying the
 * owning family's complete typed rejection table); journeyRefusal for
 * the REAL DH-011 journey instrument; benchmarksRefusal for the REAL
 * DH-09 evaluation surface.
 */
export interface OptimizationKitRefusal {
        readonly reason: OptimizationKitRefusalReason;
        readonly leg: LoopLeg | null;
        readonly law: string;
        readonly message: string;
        readonly items?: readonly string[];
        /** THE VERBATIM-CARRY LAW (contract level): the record walk's typed rejection (the owning family's complete table). */
        readonly contentRejection?: LoopContentRejection;
        /** THE VERBATIM-CARRY LAW: the REAL DH-011 journey instrument's own typed refusal. */
        readonly journeyRefusal?: ActivationKitRefusal;
        /** THE VERBATIM-CARRY LAW: the REAL DH-09 evaluation surface's own typed refusal. */
        readonly benchmarksRefusal?: BenchmarksKitRefusal;
}

// --- the kit construction options + the op input shapes ----------------------------------------------

/**
 * The kit construction options (all injected, never env-read; THE
 * PERSISTENCE-FIRST LAW - the fsPort/root pair is REQUIRED: the loop
 * evidence mirror AND the execute / measure legs' reopening of the
 * real DH-11 / DH-09 kits are persistence surfaces; a non-persistent
 * loop would be a second in-memory authority, exactly what
 * THE NO-SECOND-ENGINE LAW forbids). The clock / rng / fsPort / root
 * are THE FAMILY'S FOUR SEAMS, passed THROUGH verbatim to every real
 * kit the loop constructs; the catalog is the REAL DH-11 journey
 * instrument's own required READ-ONLY resolution surface (the journey
 * cannot be constructed without it - the kit forwards it verbatim to
 * the journey, never reads it, never becomes a capability authority
 * through it; the honest fifth seam, disclosed in the README).
 */
export interface OptimizationKitOptions {
        /** The injected clock (returns the ISO string; forwarded to every real kit verbatim). */
        readonly clock: () => string;
        /** The id-minting seam (returns 16 lowercase hex chars; NEVER the random global; forwarded to every real kit verbatim). */
        readonly rng: () => string;
        /** The injected READ-ONLY catalog snapshot (the REAL DH-11 journey kit's own required seam; forwarded verbatim, never read here). */
        readonly catalog: HarnessCatalogSnapshot;
        /** The filesystem seam (the ONLY filesystem seam; shared with every real kit the loop constructs). */
        readonly fsPort: HarnessFsPort;
        /** The persistence root (the .flauz/harness subtree lands under it - this family's mirror AND the real kits' own ledgers). */
        readonly root: string;
}

/**
 * The observe-leg input (THE CONTENT LAW + THE PRIVACY LAW): the
 * caller-supplied lab scope, the raw activity records (a TRANSIENT
 * input - only the derived profile ever persists), the explicit
 * learning controls (the REAL LAB-002 governance gate: optIn false
 * refuses the leg) and the workload profile id (the caller-supplied
 * profile label the REAL learner stamps on its output).
 */
export interface ObserveWorkloadInput {
        readonly scope: LabScope;
        readonly records: readonly LabActivityRecord[];
        readonly controls: WorkloadLearningControls;
        readonly profileId: string;
}

/** The frozen observe-input schema keys, in the canonical fixed-key-order. */
export const OBSERVE_INPUT_SCHEMA_KEYS = ['scope', 'records', 'controls', 'profileId'] as const;

/** The frozen activity-record schema keys (the REAL LabActivityRecord shape's own fields, in the interface's order). */
export const ACTIVITY_RECORD_SCHEMA_KEYS = [
        'scope',
        'taskFamily',
        'toolKinds',
        'usedBrowser',
        'usedEnvironment',
        'durationMinutes',
        'complexityHint',
        'parallelThreads',
        'humanInterventions',
        'requiredReview',
        'qualitySensitivity',
        'costSensitivity',
        'latencySensitivity',
        'occurredAt',
] as const;

/** The frozen learning-controls schema keys (the REAL WorkloadLearningControls shape's own fields). */
export const WORKLOAD_CONTROLS_SCHEMA_KEYS = ['optIn', 'retentionDays', 'exportable', 'deleteAllBefore'] as const;

/**
 * The compare-leg input (THE REPRODUCIBILITY LAW): the caller-pinned
 * ladder seeds (a non-empty list of finite numbers; TWO OR MORE seeds
 * run the REAL multi-seed robustness rung (L2), a single seed runs
 * the instance-simulation rung (L1) - the level derives
 * deterministically from the pinned seed list), the instances per
 * seed and the OPTIONAL REAL response-model seam (a caller-supplied
 * CandidateScorer replaces the shipped fixture model; its honest
 * evidence label rides verbatim into the evaluation reports and THE
 * EVIDENCE-CEILING LAW refuses any label above the loop's frozen
 * 'simulated' ceiling at the recommend boundary).
 */
export interface CompareOutcomesInput {
        readonly seeds: readonly number[];
        readonly instanceCount: number;
        readonly scorer?: CandidateScorer;
}

/** The frozen compare-input schema keys, in the canonical fixed-key-order. */
export const COMPARE_INPUT_SCHEMA_KEYS = ['seeds', 'instanceCount', 'scorer'] as const;

/**
 * The recommend-leg input (THE CONTENT LAW): the caller-supplied
 * recommended change (the typed HarnessDelta - additive-only, every
 * entry walked by the OWNING family's REAL validator) and the
 * reversibility classification (THE REVERSIBILITY LAW: a reversible
 * delta carries its rollback path; an irreversible delta carries the
 * explicit acknowledgement or is refused).
 */
export interface RecommendImprovementInput {
        readonly delta: unknown;
        readonly reversibility: unknown;
}

/** The frozen recommend-input schema keys, in the canonical fixed-key-order. */
export const RECOMMEND_INPUT_SCHEMA_KEYS = ['delta', 'reversibility'] as const;

/**
 * The measure-leg input (THE HONEST-MEASURE LAW): the caller-supplied
 * measures (EvalScore-shaped rows - the kit NEVER invents scores; the
 * REAL DH-09 surface validates them against the benchmark's declared
 * KPI dimensions), the benchmark key to evaluate and the observed
 * outcome of the executed change (the REAL TaskOutcome shape - the
 * calibrate leg's input).
 */
export interface MeasureResultInput {
        readonly benchmarkKey: string;
        readonly measures: readonly unknown[];
        readonly outcome: unknown;
}

/** The frozen measure-input schema keys, in the canonical fixed-key-order. */
export const MEASURE_INPUT_SCHEMA_KEYS = ['benchmarkKey', 'measures', 'outcome'] as const;

// --- the kit surface ----------------------------------------------------------------------------------

/** The loop op outcome: ok carries the honest loop record; failure carries the typed refusal. */
export type LoopOutcome =
        | { readonly ok: true; readonly loop: OptimizationLoopRecord }
        | { readonly ok: false; readonly refusal: OptimizationKitRefusal };

/** The list outcome: ok carries the loopId-ordered honest records; failure carries the typed refusal. */
export type LoopListOutcome =
        | { readonly ok: true; readonly loops: readonly OptimizationLoopRecord[] }
        | { readonly ok: false; readonly refusal: OptimizationKitRefusal };

/** The load outcome: ok carries the reopened kit; failure carries the typed refusal. */
export type OptimizationLoadOutcome =
        | { readonly ok: true; readonly kit: OptimizationKit }
        | { readonly ok: false; readonly refusal: OptimizationKitRefusal };

/**
 * The deterministic Lab-driven optimization loop kit: every operation
 * is async with a typed outcome ({ ok: true, ... } | { ok: false,
 * refusal }); every leg routes THROUGH the real modules (THE
 * NO-SECOND-ENGINE LAW); a refused op leaves the loop record AND the
 * real records unchanged (THE RECORD-UNCHANGED LAW).
 */
export interface OptimizationKit {
        beginLoop(): Promise<LoopOutcome>;
        observeWorkload(loopId: unknown, input: unknown): Promise<LoopOutcome>;
        simulateCandidates(loopId: unknown): Promise<LoopOutcome>;
        compareOutcomes(loopId: unknown, input: unknown): Promise<LoopOutcome>;
        recommendImprovement(loopId: unknown, input: unknown): Promise<LoopOutcome>;
        obtainApproval(loopId: unknown, decision: unknown): Promise<LoopOutcome>;
        executeThroughAuthorities(loopId: unknown): Promise<LoopOutcome>;
        measureResult(loopId: unknown, input: unknown): Promise<LoopOutcome>;
        calibrate(loopId: unknown): Promise<LoopOutcome>;
        inspectLoop(loopId: unknown): Promise<LoopOutcome>;
        listLoops(filter?: unknown): Promise<LoopListOutcome>;
        dispose(): void;
}

/**
 * Creates an optimization loop kit (fail-closed factory). Validation
 * order is deterministic and mirrors the landed DH-01/DH-11 factory
 * walk EXACTLY (the same preconditions, the same message shapes, the
 * createOptimizationKit prefix): the options shape (clock / rng /
 * catalog / fsPort / root - the persistence pair REQUIRED), the
 * clock's first read (a non-empty ISO string), the rng's first read
 * (exactly 16 lowercase hex chars - the id-minting law), the catalog
 * snapshot guard (the REAL predicate, imported by reference), the fs
 * port's four functions and the non-empty root. The factory consumes
 * exactly ONE clock read and ONE rng read. The kit starts with ZERO
 * loops; persistence is LAZY; a fresh kit never appends over an
 * existing non-empty optimization ledger - reopen with
 * loadOptimizationKit.
 */
export function createOptimizationKit(options: OptimizationKitOptions): OptimizationKit {
        const bound = validateKitOptions(options, 'createOptimizationKit');
        return buildKit(bound, { seq: 0, loops: new Map<string, OptimizationLoopRecord>() }, false);
}

/**
 * Reopens a persisted optimization loop kit: replays the append-only
 * optimization ops ledger (the authoritative surface - each line
 * re-validated: the frozen eleven-key line schema, the op's leg and
 * net stage edge through the contract's own tables and machine, the
 * payload walks through the REAL validators (the workload / search /
 * ladder structural walks, the recommendation's own deep walk, the
 * decision mirror, the execution / measure / calibration evidence
 * walks), THE FORWARD-ONLY LAW's frontier discipline, THE
 * APPROVAL-BEFORE-EXECUTE LAW, the full record walk after every
 * applied line - the loop laws re-proven FROM THE LEDGER ALONE), and
 * cross-checks the envelope byte-for-byte against the replay-built
 * state. A torn or missing optimization ledger line is the typed
 * E_LEDGER_TORN; a divergent, missing or malformed envelope is the
 * typed E_ENVELOPE_MISMATCH (never silently rebuilt); a refused fs
 * port is the typed OPTIMIZATION_IO. A fresh root (no files) reopens
 * as an empty kit. The real DH-11 / DH-09 kits are NOT reopened here
 * - the execute and measure legs reopen them over their own ledgers
 * at every call (THE EVIDENCE-NOT-AUTHORITY LAW: no cached real-kit
 * handle, ever).
 */
export async function loadOptimizationKit(options: OptimizationKitOptions): Promise<OptimizationLoadOutcome> {
        const bound = validateKitOptions(options, 'loadOptimizationKit');
        const fsPort = bound.fsPort;
        const ledgerPath = `${bound.root}/${OPTIMIZATION_LEDGER_RELATIVE_PATH}`;
        const envelopePath = `${bound.root}/${OPTIMIZATION_ENVELOPE_RELATIVE_PATH}`;
        try {
                await fsPort.mkdir(`${bound.root}/.flauz/harness`, { recursive: true });
        } catch (error) {
                return { ok: false, refusal: refused('OPTIMIZATION_IO', null, 'THE FAIL-CLOSED LAW', `loadOptimizationKit: the fs port refused the root mkdir: ${toMessage(error)}`) };
        }
        let ledgerText: string | null;
        try {
                ledgerText = await readText(fsPort, ledgerPath);
        } catch (error) {
                return { ok: false, refusal: refused('OPTIMIZATION_IO', null, 'THE FAIL-CLOSED LAW', `loadOptimizationKit: the fs port refused the optimization ledger read: ${toMessage(error)}`) };
        }
        let envelopeText: string | null;
        try {
                envelopeText = await readText(fsPort, envelopePath);
        } catch (error) {
                return { ok: false, refusal: refused('OPTIMIZATION_IO', null, 'THE FAIL-CLOSED LAW', `loadOptimizationKit: the fs port refused the optimization envelope read: ${toMessage(error)}`) };
        }
        const replay = replayOptimizationLedger(ledgerText);
        if (typeof replay === 'string') {
                return { ok: false, refusal: refused('E_LEDGER_TORN', null, 'THE APPEND-ONLY LEDGER LAW', replay) };
        }
        const crossCheck = crossCheckEnvelope(envelopeText, replay.lines.length, replay.loops);
        if (crossCheck !== null) {
                return { ok: false, refusal: refused(crossCheck.reason, null, 'THE APPEND-ONLY LEDGER LAW', crossCheck.message) };
        }
        return {
                ok: true,
                kit: buildKit(bound, { seq: replay.lines.length, loops: replay.loops }, true),
        };
}

// --- the kit internals -----------------------------------------------------------------------------

interface BoundOptions {
        readonly clock: () => string;
        readonly rng: () => string;
        readonly catalog: HarnessCatalogSnapshot;
        readonly fsPort: HarnessFsPort;
        readonly root: string;
}

interface KitState {
        readonly seq: number;
        readonly loops: ReadonlyMap<string, OptimizationLoopRecord>;
}

/** The persist fold's result: applied means the optimization ledger line landed (the ledger is authoritative). */
type PersistResult =
        | { readonly applied: false; readonly refusal: OptimizationKitRefusal }
        | { readonly applied: true; readonly refusal: OptimizationKitRefusal | null };

/** The clock read's result: the injected seam's value or the typed corrupt-seam refusal. */
type ClockRead = { readonly at: string } | { readonly refusal: OptimizationKitRefusal };

/** The id-mint read's result: the 16-hex value or the typed corrupt-seam refusal. */
type MintRead = { readonly hex: string } | { readonly refusal: OptimizationKitRefusal };

function validateKitOptions(options: OptimizationKitOptions, factoryName: 'createOptimizationKit' | 'loadOptimizationKit'): BoundOptions {
        if (!isRecord(options)) {
                throw new TypeError(`${factoryName}: options must be an object`);
        }
        const opts = options as Record<string, unknown>;
        if (typeof opts.clock !== 'function') {
                throw new TypeError(
                        `${factoryName}: options.clock must be a function returning ISO string values (the injected-clock law - the kit never reads a clock itself)`,
                );
        }
        if (typeof opts.rng !== 'function') {
                throw new TypeError(
                        `${factoryName}: options.rng must be a function returning 16 lowercase hex chars (the id-minting seam - NEVER the random global)`,
                );
        }
        if (!isHarnessCatalogSnapshot(opts.catalog)) {
                throw new TypeError(
                        `${factoryName}: options.catalog must satisfy isHarnessCatalogSnapshot (the REAL DH-11 journey kit's own READ-ONLY resolution surface - the REAL predicate, imported by reference; forwarded verbatim, never read here)`,
                );
        }
        const clock = opts.clock as () => string;
        const firstClock = clock();
        if (typeof firstClock !== 'string' || firstClock.length === 0) {
                throw new TypeError(`${factoryName}: options.clock() must return a non-empty ISO string (the injected-clock law)`);
        }
        const rng = opts.rng as () => string;
        const firstHex = rng();
        if (!/^[0-9a-f]{16}$/.test(firstHex)) {
                throw new TypeError(
                        `${factoryName}: options.rng() must return exactly 16 lowercase hex chars (the id-minting seam - the kit mints ${LOOP_ID_PREFIX}<16-hex>)`,
                );
        }
        const port = opts.fsPort;
        if (!isRecord(port)) {
                throw new TypeError(`${factoryName}: options.fsPort must be an object (the ONLY filesystem seam - THE PERSISTENCE-FIRST LAW: the pair is required, never optional)`);
        }
        for (const name of ['readFile', 'writeFile', 'appendFile', 'mkdir'] as const) {
                if (typeof (port as Record<string, unknown>)[name] !== 'function') {
                        throw new TypeError(`${factoryName}: options.fsPort.${name} must be a function (the ONLY filesystem seam)`);
                }
        }
        if (typeof opts.root !== 'string' || opts.root.length === 0) {
                throw new TypeError(`${factoryName}: options.root must be a non-empty string (the .flauz/harness persistence subtree root)`);
        }
        return { clock, rng, catalog: opts.catalog as HarnessCatalogSnapshot, fsPort: port as unknown as HarnessFsPort, root: opts.root };
}

function buildKit(bound: BoundOptions, seed: KitState, reloaded: boolean): OptimizationKit {
        const fsPort = bound.fsPort;
        const ledgerPath = `${bound.root}/${OPTIMIZATION_LEDGER_RELATIVE_PATH}`;
        const envelopePath = `${bound.root}/${OPTIMIZATION_ENVELOPE_RELATIVE_PATH}`;
        let mutableSeq = seed.seq;
        let disposed = false;
        let dirEnsured = reloaded;
        // A kit reloaded from a persisted ledger NEVER re-fires the fresh-kit guard
        // (its ledger preexists; only a fresh createOptimizationKit guards the append).
        let ledgerGuardDone = seed.seq > 0;
        const loops = new Map<string, OptimizationLoopRecord>(seed.loops);

        function readClock(): ClockRead {
                const at = bound.clock();
                if (typeof at !== 'string' || at.length === 0) {
                        return {
                                refusal: refused(
                                        'CORRUPT_SEAM',
                                        null,
                                        'THE DETERMINISM LAW',
                                        'the injected clock returned an empty value mid-op (the timestamps are carried verbatim from the injected seam)',
                                ),
                        };
                }
                return { at };
        }

        function mintHex(leg: LoopLeg | null): MintRead {
                const hex = bound.rng();
                if (typeof hex !== 'string' || !/^[0-9a-f]{16}$/.test(hex)) {
                        return {
                                refusal: refused(
                                        'CORRUPT_SEAM',
                                        leg,
                                        'THE DETERMINISM LAW',
                                        'the injected rng returned a non-16-hex value mid-op (the id-minting seam is corrupt)',
                                ),
                        };
                }
                return { hex };
        }

        function copyLoop(record: OptimizationLoopRecord): OptimizationLoopRecord {
                return JSON.parse(serializeOptimizationLoop(record)) as OptimizationLoopRecord;
        }

        function loopOutcome(record: OptimizationLoopRecord): LoopOutcome {
                return { ok: true, loop: copyLoop(record) };
        }

        function envelopeBytes(nextSeq: number, nextLoops: ReadonlyMap<string, OptimizationLoopRecord>): string {
                const ids = [...nextLoops.keys()].sort();
                const records = ids.map((id) => nextLoops.get(id) as OptimizationLoopRecord);
                return `{"contractVersion":${JSON.stringify(OPTIMIZATION_CONTRACTS_VERSION)},"seq":${nextSeq},"loops":[${records
                        .map((record) => serializeOptimizationLoop(record))
                        .join(',')}]}`;
        }

        function ledgerLineBytes(line: OptimizationOpsLedgerLine): string {
                return JSON.stringify({
                        seq: line.seq,
                        at: line.at,
                        contractVersion: line.contractVersion,
                        op: line.op,
                        loopId: line.loopId,
                        leg: line.leg,
                        fromStage: line.fromStage,
                        toStage: line.toStage,
                        law: line.law,
                        payload: line.payload,
                        detail: line.detail,
                });
        }

        /**
         * THE APPEND-ONLY LEDGER LAW's persistence fold: the append lands
         * first (the ledger is authoritative - the seq advances with the
         * line), the envelope rewrite lands second, the in-memory loops
         * commit last (in the caller). An append refusal leaves NOTHING
         * applied; an envelope refusal leaves the op applied and the line
         * landed (the refusal discloses it; a reload fails closed with
         * E_ENVELOPE_MISMATCH until the next op rewrites the envelope).
         */
        async function persist(line: OptimizationOpsLedgerLine, nextLoops: ReadonlyMap<string, OptimizationLoopRecord>): Promise<PersistResult> {
                if (!dirEnsured) {
                        try {
                                await fsPort.mkdir(`${bound.root}/.flauz/harness`, { recursive: true });
                        } catch (error) {
                                return { applied: false, refusal: refused('OPTIMIZATION_IO', line.leg, 'THE FAIL-CLOSED LAW', `persist: the fs port refused the root mkdir: ${toMessage(error)} (nothing was applied)`) };
                        }
                        dirEnsured = true;
                }
                try {
                        await fsPort.appendFile(ledgerPath, `${ledgerLineBytes(line)}\n`);
                } catch (error) {
                        return { applied: false, refusal: refused('OPTIMIZATION_IO', line.leg, 'THE FAIL-CLOSED LAW', `persist: the fs port refused the optimization ledger append: ${toMessage(error)} (nothing was applied)`) };
                }
                mutableSeq = line.seq;
                try {
                        await fsPort.writeFile(envelopePath, envelopeBytes(line.seq, nextLoops));
                } catch (error) {
                        return {
                                applied: true,
                                refusal: refused(
                                        'OPTIMIZATION_IO',
                                        line.leg,
                                        'THE FAIL-CLOSED LAW',
                                        `persist: the ledger line landed at seq ${line.seq} but the fs port refused the envelope rewrite: ${toMessage(error)} (the op applied and the ledger is authoritative; a reload fails closed with E_ENVELOPE_MISMATCH until the envelope is rewritten)`,
                                ),
                        };
                }
                return { applied: true, refusal: null };
        }

        function commit(nextLoops: ReadonlyMap<string, OptimizationLoopRecord>): void {
                loops.clear();
                for (const [id, record] of nextLoops) {
                        loops.set(id, record);
                }
        }

        function refuseIfDisposed(op: string): OptimizationKitRefusal | null {
                if (disposed) {
                        return refused('disposed', null, 'THE DISPOSE LAW', `${op}: the optimization kit was disposed - every operation after dispose rejects`);
                }
                return null;
        }

        function lookupLoop(op: string, loopId: unknown): { loop: OptimizationLoopRecord } | { refusal: OptimizationKitRefusal } {
                if (!isLoopId(loopId)) {
                        return { refusal: refused('unknown-loop', null, 'THE FAIL-CLOSED LAW', `${op}: no loop with id '${showValue(loopId)}' (a malformed id fails closed as unknown - the DH-01 NOT_FOUND discipline)`) };
                }
                const loop = loops.get(loopId);
                if (loop === undefined) {
                        return { refusal: refused('unknown-loop', null, 'THE FAIL-CLOSED LAW', `${op}: no loop with id '${loopId}'`) };
                }
                return { loop };
        }

        /**
         * THE FORWARD-ONLY LAW's stage guard: the op's walk FRONTIER is
         * the last leg of its required-legs row (the contract's frozen
         * table, imported by reference); the loop's walked frontier is
         * the last history note's leg (null ONLY on the begin note). A
         * frontier behind the expectation is the typed premature-stage
         * refusal; a frontier past it is the typed stale-stage refusal
         * (the loop record never walks back; 'calibrate' is terminal).
         */
        function stageGuard(op: LoopOpName, loop: OptimizationLoopRecord): OptimizationKitRefusal | null {
                const required = LOOP_OP_REQUIRED_LEGS[op];
                const expectedLeg = required.length === 0 ? null : required[required.length - 1];
                const expectedIndex = expectedLeg === null ? -1 : loopLegIndex(expectedLeg);
                const frontier = loop.history.length === 0 ? null : loop.history[loop.history.length - 1].leg;
                const frontierIndex = frontier === null ? -1 : loopLegIndex(frontier);
                if (frontierIndex < expectedIndex) {
                        return refused(
                                'premature-stage',
                                expectedLeg,
                                'THE FORWARD-ONLY LAW',
                                `${op}: the op precedes its walked prerequisites within the frozen leg order - the walk frontier is '${showValue(frontier)}' but '${op}' requires the '${showValue(expectedLeg)}' leg walked first (an incomplete walk never recommends, never executes)`,
                        );
                }
                if (frontierIndex > expectedIndex) {
                        return refused(
                                'stale-stage',
                                expectedLeg,
                                'THE FORWARD-ONLY LAW',
                                `${op}: the op is behind the walk - the walk frontier is '${showValue(frontier)}' but '${op}' runs at the '${showValue(expectedLeg)}' frontier (the loop record never walks back; 'calibrate' is terminal; a changed loop is a NEW loop id)`,
                        );
                }
                return null;
        }

        /** THE FAIL-CLOSED LAW at the authority seam: the catalog re-check through the REAL predicate (imported by reference). */
        function catalogGuard(leg: LoopLeg | null): OptimizationKitRefusal | null {
                if (!isHarnessCatalogSnapshot(bound.catalog)) {
                        return refused(
                                'malformed-catalog',
                                leg,
                                'THE FAIL-CLOSED LAW',
                                'the injected catalog snapshot no longer satisfies the REAL isHarnessCatalogSnapshot predicate - a malformed authority resolves nothing (fail closed; the loop never routes a delta through a malformed authority)',
                        );
                }
                return null;
        }

        /**
         * The common op tail: the evidence patch + the note + line +
         * record + persist + commit fold. THE FAIL-CLOSED LAW: the op's
         * record must satisfy the contract's own deep walk BEFORE it ever
         * persists (no dishonest evidence gets bytes).
         */
        async function applyLeg(
                loop: OptimizationLoopRecord,
                op: LoopOpName,
                leg: LoopLeg,
                at: string,
                law: string,
                detail: string,
                patch: Partial<OptimizationLoopRecord>,
                payload: OptimizationOpsLedgerLine['payload'],
        ): Promise<LoopOutcome> {
                const fromStage = loop.stage;
                const toStage = LOOP_LEG_STAGES[leg];
                const next: OptimizationLoopRecord = {
                        ...loop,
                        ...patch,
                        stage: toStage,
                        revision: loop.revision + 1,
                        history: [...loop.history, { at, leg, fromStage, toStage, op, law, detail }],
                };
                const verdict = validateOptimizationLoopRecord(next);
                if (!verdict.ok) {
                        return {
                                ok: false,
                                refusal: refused(
                                        verdict.rejection.reason === 'version-mismatch' ? 'version-mismatch' : 'malformed-record',
                                        leg,
                                        verdict.rejection.law,
                                        `applyLeg: the op's record fails the contract walk (nothing was applied): ${verdict.rejection.message}`,
                                        verdict.rejection.items,
                                        { contentRejection: verdict.rejection },
                                ),
                        };
                }
                const line: OptimizationOpsLedgerLine = {
                        seq: mutableSeq + 1,
                        at,
                        contractVersion: OPTIMIZATION_CONTRACTS_VERSION,
                        op,
                        loopId: loop.loopId,
                        leg,
                        fromStage,
                        toStage,
                        law,
                        payload,
                        detail,
                };
                const nextLoops = new Map(loops);
                nextLoops.set(loop.loopId, next);
                const persistResult = await persist(line, nextLoops);
                if (!persistResult.applied) {
                        return { ok: false, refusal: persistResult.refusal };
                }
                commit(nextLoops);
                if (persistResult.refusal !== null) {
                        return { ok: false, refusal: persistResult.refusal };
                }
                return loopOutcome(next);
        }

        return {
                async beginLoop(): Promise<LoopOutcome> {
                        const disposedRefusal = refuseIfDisposed('beginLoop');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        // THE APPEND-ONLY LEDGER LAW's fresh-kit guard: a fresh kit never
                        // appends over an existing non-empty optimization ledger - reopen
                        // with loadOptimizationKit. The guard fires HERE (the first
                        // persisted op of any loop).
                        if (!ledgerGuardDone) {
                                let existing: string | null;
                                try {
                                        existing = await readText(fsPort, ledgerPath);
                                } catch (error) {
                                        return { ok: false, refusal: refused('OPTIMIZATION_IO', null, 'THE FAIL-CLOSED LAW', `beginLoop: the fs port refused the optimization ledger read: ${toMessage(error)}`) };
                                }
                                if (existing !== null && existing.trim().length > 0) {
                                        return {
                                                ok: false,
                                                refusal: refused(
                                                        'E_LEDGER_TORN',
                                                        null,
                                                        'THE APPEND-ONLY LEDGER LAW',
                                                        'beginLoop: the optimization ledger already carries lines - reopen with loadOptimizationKit (a fresh kit never appends over an existing ledger)',
                                                ),
                                        };
                                }
                                ledgerGuardDone = true;
                        }
                        // The loop id mints from the injected rng (never caller-supplied).
                        const mint = mintHex(null);
                        if ('refusal' in mint) {
                                return { ok: false, refusal: mint.refusal };
                        }
                        const loopId = `${LOOP_ID_PREFIX}${mint.hex}`;
                        if (loops.has(loopId)) {
                                return { ok: false, refusal: refused('CORRUPT_SEAM', null, 'THE DETERMINISM LAW', 'beginLoop: the injected rng minted a duplicate loop id (the id-minting seam is corrupt)') };
                        }
                        const clockRead = readClock();
                        if ('refusal' in clockRead) {
                                return { ok: false, refusal: clockRead.refusal };
                        }
                        const at = clockRead.at;
                        const detail = 'began the optimization loop (the walk enters the observe stage - the loop awaits its first observation)';
                        const record: OptimizationLoopRecord = {
                                loopId,
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
                                createdAtIso: at,
                                revision: 1,
                                history: [{ at, leg: null, fromStage: null, toStage: 'observe', op: 'begin-loop', law: 'THE FORWARD-ONLY LAW', detail }],
                        };
                        const line: OptimizationOpsLedgerLine = {
                                seq: mutableSeq + 1,
                                at,
                                contractVersion: OPTIMIZATION_CONTRACTS_VERSION,
                                op: 'begin-loop',
                                loopId,
                                leg: null,
                                fromStage: null,
                                toStage: 'observe',
                                law: 'THE FORWARD-ONLY LAW',
                                payload: null,
                                detail,
                        };
                        const nextLoops = new Map(loops);
                        nextLoops.set(loopId, record);
                        const persistResult = await persist(line, nextLoops);
                        if (!persistResult.applied) {
                                return { ok: false, refusal: persistResult.refusal };
                        }
                        commit(nextLoops);
                        if (persistResult.refusal !== null) {
                                return { ok: false, refusal: persistResult.refusal };
                        }
                        return loopOutcome(record);
                },

                async observeWorkload(loopId: unknown, input: unknown): Promise<LoopOutcome> {
                        const disposedRefusal = refuseIfDisposed('observeWorkload');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        const lookup = lookupLoop('observeWorkload', loopId);
                        if ('refusal' in lookup) {
                                return { ok: false, refusal: lookup.refusal };
                        }
                        const loop = lookup.loop;
                        const stageRefusal = stageGuard('observe-workload', loop);
                        if (stageRefusal !== null) {
                                return { ok: false, refusal: stageRefusal };
                        }
                        // THE STRICT-SCHEMA LAW: the caller payload walk (the frozen
                        // four-key input schema; the REAL LabActivityRecord /
                        // WorkloadLearningControls shapes walked structurally - the
                        // field lists come from the IMPORTED interfaces, so a drift in
                        // the real shapes fails tsc in THIS module).
                        const inputRefusal = validateObserveInput(input);
                        if (inputRefusal !== null) {
                                return { ok: false, refusal: inputRefusal };
                        }
                        const observeInput = input as ObserveWorkloadInput;
                        const clockRead = readClock();
                        if ('refusal' in clockRead) {
                                return { ok: false, refusal: clockRead.refusal };
                        }
                        const nowIso = clockRead.at;
                        // THE PRIVACY LAW (LAB-002 governance) + THE REAL-KIT LAW: the REAL
                        // learner over the caller-supplied records under the explicit
                        // controls (optIn false answers null - the typed
                        // learning-opt-out refusal; no learning from activity without
                        // explicit consent, ever).
                        const learned = learnWorkloadProfile(
                                observeInput.scope,
                                [...observeInput.records],
                                { ...observeInput.controls },
                                observeInput.profileId,
                                nowIso,
                        );
                        if (learned === null) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'learning-opt-out',
                                                'observe',
                                                'THE PRIVACY LAW (LAB-002 governance)',
                                                'observeWorkload: the REAL LAB-002 learner answered null - the caller controls carry optIn false (no learning from activity without explicit consent, ever; the loop record is unchanged)',
                                        ),
                                };
                        }
                        const at = nowIso;
                        const detail = `observed the workload through the REAL LAB-002 learnWorkloadProfile (profile ${learned.profile.id}: ${learned.retainedRecordCount} retained record(s), ${learned.excludedRecordCount} excluded - only the DERIVED profile persists, never the raw activity)`;
                        return applyLeg(
                                loop,
                                'observe-workload',
                                'observe',
                                at,
                                'THE AUDIT LAW',
                                detail,
                                // The loop's observed scope lands with the workload (the
                                // record walk enforces the scope agreement - no cross-
                                // workspace or cross-tenant leakage, ever).
                                { scope: { workspaceId: learned.profile.scope.workspaceId, tenantId: learned.profile.scope.tenantId }, workload: learned },
                                // THE PRIVACY LAW: the ledger line carries ONLY the derived
                                // WorkloadLearningResult (the raw records are a transient input).
                                learned,
                        );
                },

                async simulateCandidates(loopId: unknown): Promise<LoopOutcome> {
                        const disposedRefusal = refuseIfDisposed('simulateCandidates');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        const lookup = lookupLoop('simulateCandidates', loopId);
                        if ('refusal' in lookup) {
                                return { ok: false, refusal: lookup.refusal };
                        }
                        const loop = lookup.loop;
                        const stageRefusal = stageGuard('simulate-candidates', loop);
                        if (stageRefusal !== null) {
                                return { ok: false, refusal: stageRefusal };
                        }
                        const workload = loop.workload as WorkloadLearningResult;
                        // THE COHERENCE LAW (the LAB-011 gate): the observed dominant task
                        // family couples to a deterministic task world - a closed loop
                        // never proves itself against a family the user never runs.
                        const dominant = workload.profile.taskMix.length > 0 ? workload.profile.taskMix[0].taskTypeId : null;
                        const scenario = dominant === null ? undefined : coupleScenario(workload, dominant);
                        if (dominant === null || scenario === undefined) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'scenario-unresolvable',
                                                'simulate',
                                                'THE COHERENCE LAW',
                                                `simulateCandidates: no deterministic task world couples to the observed dominant task family ('${showValue(dominant)}' - the REAL TASK_WORLDS registry, imported by reference, carries no coupling; a closed loop never proves itself against a family the user never runs)`,
                                                [showValue(dominant)],
                                        ),
                                };
                        }
                        // The request derives deterministically from the observed profile
                        // (the REAL request shape; the utility weights from the learned
                        // budget / SLA - the documented formula; the search is
                        // level-agnostic, so the ladderLevel column records the loop's
                        // floor rung and the actual rung derives at the compare leg).
                        const request = {
                                scope: loop.scope as LabScope,
                                scenarioId: scenario.id,
                                taskTypeId: dominant,
                                utilityWeights: deriveUtilityWeights(workload.profile),
                                ladderLevel: 1 as const,
                                seeds: [] as number[],
                                maxAgents: LOOP_SEARCH_MAX_AGENTS,
                        };
                        // THE SIMULATION LAW: the REAL LAB-005 search (a pure deterministic
                        // enumeration; a refusal - undefined - is the real module's own
                        // fail-closed answer, carried as the typed search-refused refusal;
                        // unreachable with the profile-derived weights, kept fail-closed).
                        const searched = searchOrganizations(request);
                        if (searched === undefined) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'search-refused',
                                                'simulate',
                                                'THE SIMULATION LAW',
                                                'simulateCandidates: the REAL LAB-005 searchOrganizations refused the request (the real module\'s own fail-closed answer - the loop record is unchanged)',
                                        ),
                                };
                        }
                        const clockRead = readClock();
                        if ('refusal' in clockRead) {
                                return { ok: false, refusal: clockRead.refusal };
                        }
                        const at = clockRead.at;
                        const detail = `simulated ${searched.candidates.length} candidate organization(s) through the REAL LAB-005 searchOrganizations over the observed profile (scenario ${scenario.id}, dominant task type ${dominant}, max ${LOOP_SEARCH_MAX_AGENTS} agent(s))`;
                        return applyLeg(
                                loop,
                                'simulate-candidates',
                                'simulate',
                                at,
                                'THE AUDIT LAW',
                                detail,
                                { simulation: searched },
                                searched,
                        );
                },

                async compareOutcomes(loopId: unknown, input: unknown): Promise<LoopOutcome> {
                        const disposedRefusal = refuseIfDisposed('compareOutcomes');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        const lookup = lookupLoop('compareOutcomes', loopId);
                        if ('refusal' in lookup) {
                                return { ok: false, refusal: lookup.refusal };
                        }
                        const loop = lookup.loop;
                        const stageRefusal = stageGuard('compare-outcomes', loop);
                        if (stageRefusal !== null) {
                                return { ok: false, refusal: stageRefusal };
                        }
                        const inputRefusal = validateCompareInput(input);
                        if (inputRefusal !== null) {
                                return { ok: false, refusal: inputRefusal };
                        }
                        const compareInput = input as CompareOutcomesInput;
                        const simulation = loop.simulation as OrgSearchResult;
                        // THE REPRODUCIBILITY LAW: the ladder level derives from the pinned
                        // seed list (two or more seeds run the REAL multi-seed robustness
                        // rung; a single seed runs the instance-simulation rung).
                        const ladderLevel = compareInput.seeds.length >= 2 ? (2 as const) : (1 as const);
                        // The run id mints from the injected rng (the REAL calibration
                        // linkage key, carried through the compare / recommend / calibrate
                        // legs).
                        const mint = mintHex('compare');
                        if ('refusal' in mint) {
                                return { ok: false, refusal: mint.refusal };
                        }
                        const runId = `flauz:opt:run:${mint.hex}`;
                        // The lab law: candidates[0] IS the baseline - the search's
                        // ALWAYS-present baseline first, then the real ranking (the
                        // deterministic composition, never a re-ranking).
                        const candidates = [simulation.baseline.candidate, ...simulation.candidates.filter((entry) => entry.candidate.id !== simulation.baseline.candidate.id).map((entry) => entry.candidate)];
                        // THE SIMULATION LAW: the REAL LAB-006 runLadder over the ranked
                        // candidates and the coupled deterministic task world (a refusal -
                        // undefined - is the real module's own fail-closed answer: an
                        // unresolvable scenario, invalid weights, an L2 without two seeds).
                        const request = {
                                scope: loop.scope as LabScope,
                                runId,
                                taskScenarioId: simulation.request.scenarioId,
                                ladderLevel,
                                seeds: [...compareInput.seeds],
                                instanceCount: compareInput.instanceCount,
                                utilityWeights: deriveUtilityWeights((loop.workload as WorkloadLearningResult).profile),
                                candidates,
                                ...(compareInput.scorer === undefined ? {} : { scorer: compareInput.scorer }),
                        };
                        const run = runLadder(request);
                        if (run === undefined) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'ladder-refused',
                                                'compare',
                                                'THE SIMULATION LAW',
                                                'compareOutcomes: the REAL LAB-006 runLadder refused the request (the real module\'s own fail-closed answer - an unresolvable scenario, invalid weights or a rung/seed mismatch; the loop record is unchanged)',
                                        ),
                                };
                        }
                        const clockRead = readClock();
                        if ('refusal' in clockRead) {
                                return { ok: false, refusal: clockRead.refusal };
                        }
                        const at = clockRead.at;
                        const seedsUsed = ladderLevel <= 1 ? 1 : compareInput.seeds.length;
                        const detail = `compared outcomes through the REAL LAB-006 runLadder (run ${runId}, level ${ladderLevel}, ${seedsUsed} seed(s), ${run.reports.length} report(s) - seeded and pinned; the baseline is candidates[0] by the lab law)`;
                        return applyLeg(
                                loop,
                                'compare-outcomes',
                                'compare',
                                at,
                                'THE REPRODUCIBILITY LAW',
                                detail,
                                { comparison: run },
                                run,
                        );
                },

                async recommendImprovement(loopId: unknown, input: unknown): Promise<LoopOutcome> {
                        const disposedRefusal = refuseIfDisposed('recommendImprovement');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        const lookup = lookupLoop('recommendImprovement', loopId);
                        if ('refusal' in lookup) {
                                return { ok: false, refusal: lookup.refusal };
                        }
                        const loop = lookup.loop;
                        const stageRefusal = stageGuard('recommend-improvement', loop);
                        if (stageRefusal !== null) {
                                return { ok: false, refusal: stageRefusal };
                        }
                        const inputRefusal = validateRecommendInput(input);
                        if (inputRefusal !== null) {
                                return { ok: false, refusal: inputRefusal };
                        }
                        const recommendInput = input as RecommendImprovementInput;
                        const workload = loop.workload as WorkloadLearningResult;
                        const simulation = loop.simulation as OrgSearchResult;
                        const comparison = loop.comparison as LadderRunResult;
                        // THE EVIDENCE-CEILING LAW: the winning report's own evidence
                        // level is the loop's honest claim - a level above the frozen
                        // 'simulated' ceiling REFUSES the recommendation (never a
                        // promotion).
                        const bestReport = comparison.bestReport;
                        if (loopEvidenceLevelRank(bestReport.evidenceLevel) > loopEvidenceLevelRank('simulated')) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'evidence-ceiling',
                                                'recommend',
                                                'THE EVIDENCE-CEILING LAW',
                                                `recommendImprovement: the compare leg's winning report carries the evidence level '${bestReport.evidenceLevel}' - ABOVE the loop's frozen ceiling 'simulated' (the recommendation refuses rather than promote; the loop NEVER claims more than the real evaluation answered)`,
                                                [bestReport.evidenceLevel],
                                        ),
                                };
                        }
                        // THE AUDIT / CONTENT / REVERSIBILITY LAWS: the contract's own delta
                        // walk (the owning families' REAL validators; the
                        // reversible-first law at the irreversible classification).
                        const deltaOutcome = validateHarnessDelta(recommendInput.delta, recommendInput.reversibility);
                        if (!deltaOutcome.ok) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                deltaOutcome.rejection.reason,
                                                'recommend',
                                                deltaOutcome.rejection.law,
                                                `recommendImprovement: ${deltaOutcome.rejection.message} (the loop record is unchanged)`,
                                                deltaOutcome.rejection.items,
                                                { contentRejection: deltaOutcome.rejection },
                                        ),
                                };
                        }
                        const delta = deltaOutcome.value.delta;
                        const reversibility = deltaOutcome.value.reversibility;
                        // THE MISSING-CAPABILITY LAW: the REAL capabilityCoverage surface
                        // over the winning organization vs the required capabilities (the
                        // REAL fixture table's own '_default' fallback discipline); an
                        // uncovered row is REPORTED, never silently dropped.
                        const dominant = workload.profile.taskMix.length > 0 ? workload.profile.taskMix[0].taskTypeId : '';
                        const required = FIXTURE_REQUIRED_CAPABILITIES[dominant] ?? FIXTURE_REQUIRED_CAPABILITIES['_default'];
                        const coverageRows = capabilityCoverage(bestReport.candidate, required);
                        const missing = coverageRows
                                .filter((row) => !row.covered)
                                .map((row) => ({ capabilityId: row.capabilityId, requiredLevel: row.requiredLevel, bestScore: row.bestScore, taskTypeId: dominant }));
                        // THE UNCERTAINTY LAW: the prior calibration's honest counts (the
                        // LATEST completed loop's calibration evidence - the corpus this
                        // recommendation's predictions sit on top of; a first loop carries
                        // model null).
                        const prior = latestPriorCalibration(loops, loop.loopId);
                        const observationCount = prior === null ? 0 : prior.model.observationCount;
                        const calibrationState = {
                                observationCount,
                                minObservations: MIN_FACTORS_OBSERVATIONS,
                                belowMinimum: observationCount < MIN_FACTORS_OBSERVATIONS,
                                model: prior === null ? null : prior.model,
                        };
                        const seedsUsed = comparison.request.ladderLevel <= 1 ? 1 : comparison.request.seeds.length;
                        // The recommendation + lab-recommendation ids mint from the rng.
                        const mintOne = mintHex('recommend');
                        if ('refusal' in mintOne) {
                                return { ok: false, refusal: mintOne.refusal };
                        }
                        const mintTwo = mintHex('recommend');
                        if ('refusal' in mintTwo) {
                                return { ok: false, refusal: mintTwo.refusal };
                        }
                        const clockRead = readClock();
                        if ('refusal' in clockRead) {
                                return { ok: false, refusal: clockRead.refusal };
                        }
                        const at = clockRead.at;
                        const uncertainty = {
                                evidenceLevel: bestReport.evidenceLevel,
                                workloadObservationCount: workload.retainedRecordCount,
                                simulationCandidateCount: simulation.candidates.length,
                                ladderSeedCount: seedsUsed,
                                calibration: calibrationState,
                                statement: uncertaintyStatement(bestReport.evidenceLevel, workload, simulation.candidates.length, comparison.request.ladderLevel, seedsUsed, calibrationState, missing.length),
                        };
                        const labRecommendation = {
                                scope: loop.scope as LabScope,
                                contractVersion: LAB_CONTRACTS_VERSION,
                                id: `flauz:opt:lab:${mintOne.hex}`,
                                runId: comparison.runId,
                                organization: bestReport.candidate,
                                rationale: `The ladder run ${comparison.runId} ranked the organization ${bestReport.candidate.id} best for the observed workload profile ${workload.profile.id} (utility ${bestReport.utility}).`,
                                expectedGains: [...bestReport.comparison],
                                confidence: recommendationConfidence(workload.retainedRecordCount, seedsUsed, calibrationState.belowMinimum),
                                caveats: recommendationCaveats(workload, calibrationState.belowMinimum, observationCount, missing.length),
                                reversible: true as const,
                                auditTrail: [
                                        `observed the workload through the REAL LAB-002 learnWorkloadProfile (profile ${workload.profile.id}: ${workload.retainedRecordCount} retained, ${workload.excludedRecordCount} excluded record(s))`,
                                        `simulated ${simulation.candidates.length} candidate organization(s) through the REAL LAB-005 searchOrganizations (scenario ${simulation.request.scenarioId})`,
                                        `compared outcomes through the REAL LAB-006 runLadder (run ${comparison.runId}: ${comparison.reports.length} report(s))`,
                                        `recommended the harness delta (${reversibility.reversible ? 'reversible' : 'irreversible, acknowledged by the caller'}) - executed only through the REAL Flauz authorities`,
                                ],
                                status: 'issued' as const,
                                createdAt: at,
                        };
                        const recommendation: HarnessOptimizationRecommendation = {
                                recommendationId: `flauz:opt:rec:${mintTwo.hex}`,
                                contractVersion: OPTIMIZATION_CONTRACTS_VERSION,
                                loopId: loop.loopId,
                                scope: loop.scope as LabScope,
                                runId: comparison.runId,
                                workload,
                                simulation,
                                comparison,
                                bestReportId: bestReport.id,
                                expectedGains: [...bestReport.comparison],
                                labRecommendation,
                                delta,
                                reversibility,
                                uncertainty,
                                missingCapabilities: missing,
                                createdAtIso: at,
                        };
                        // THE AUDIT LAW's boundary: the composed recommendation must
                        // satisfy the contract's own deep walk BEFORE it ever persists.
                        const verdict = validateHarnessOptimizationRecommendation(recommendation);
                        if (!verdict.ok) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                verdict.rejection.reason,
                                                'recommend',
                                                verdict.rejection.law,
                                                `recommendImprovement: the composed recommendation fails the contract walk (nothing was applied): ${verdict.rejection.message}`,
                                                verdict.rejection.items,
                                                { contentRejection: verdict.rejection },
                                        ),
                                };
                        }
                        const detail = `recommended the improvement (the typed HarnessOptimizationRecommendation ${recommendation.recommendationId} carrying every leg's real outputs verbatim; the missing-capability ledger carries ${missing.length} entr${missing.length === 1 ? 'y' : 'ies'})`;
                        return applyLeg(
                                loop,
                                'recommend-improvement',
                                'recommend',
                                at,
                                'THE AUDIT LAW',
                                detail,
                                { recommendation },
                                recommendation,
                        );
                },

                async obtainApproval(loopId: unknown, decision: unknown): Promise<LoopOutcome> {
                        const disposedRefusal = refuseIfDisposed('obtainApproval');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        const lookup = lookupLoop('obtainApproval', loopId);
                        if ('refusal' in lookup) {
                                return { ok: false, refusal: lookup.refusal };
                        }
                        const loop = lookup.loop;
                        const stageRefusal = stageGuard('obtain-approval', loop);
                        if (stageRefusal !== null) {
                                return { ok: false, refusal: stageRefusal };
                        }
                        // THE APPROVAL LAW: the decision mirror walk (the EVIDENCE shape
                        // { approvedBy, note? } - never brokered, never an authority).
                        const mirror = validateLoopApprovalMirror(decision);
                        if (!mirror.ok) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'malformed-record',
                                                'approve',
                                                'THE APPROVAL LAW',
                                                `obtainApproval: the approval decision mirror ${mirror.message} (the recorded decision is the EVIDENCE shape { approvedBy, note? }; the loop record is unchanged)`,
                                        ),
                                };
                        }
                        const clockRead = readClock();
                        if ('refusal' in clockRead) {
                                return { ok: false, refusal: clockRead.refusal };
                        }
                        const at = clockRead.at;
                        const approvedBy = mirror.value.approvedBy as string;
                        const detail = `recorded the caller's approval decision (approved by ${approvedBy}) - the EVIDENCE mirror, never the authority; no approval input, no execution`;
                        return applyLeg(
                                loop,
                                'obtain-approval',
                                'approve',
                                at,
                                'THE APPROVAL LAW',
                                detail,
                                { approval: mirror.value },
                                mirror.value,
                        );
                },

                async executeThroughAuthorities(loopId: unknown): Promise<LoopOutcome> {
                        const disposedRefusal = refuseIfDisposed('executeThroughAuthorities');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        const lookup = lookupLoop('executeThroughAuthorities', loopId);
                        if ('refusal' in lookup) {
                                return { ok: false, refusal: lookup.refusal };
                        }
                        const loop = lookup.loop;
                        // THE APPROVAL LAW: no recommendation reaches the execute stage
                        // without the recorded caller approval decision - the
                        // approval-evidence guard fires BEFORE the frontier check (the
                        // contract's own documented order: the structural floor names the
                        // law directly; an unapproved execute attempt at ANY stage is the
                        // typed approval-missing refusal, the record unchanged).
                        if (loop.approval === null) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'approval-missing',
                                                'execute',
                                                'THE APPROVAL LAW',
                                                'executeThroughAuthorities: an execute attempt without the recorded caller approval decision (no approval input, no execution - ever; the loop record is unchanged)',
                                        ),
                                };
                        }
                        const stageRefusal = stageGuard('execute-through-authorities', loop);
                        if (stageRefusal !== null) {
                                return { ok: false, refusal: stageRefusal };
                        }
                        // THE FAIL-CLOSED LAW at the authority seam.
                        const catalogRefusal = catalogGuard('execute');
                        if (catalogRefusal !== null) {
                                return { ok: false, refusal: { ...catalogRefusal, message: `executeThroughAuthorities: ${catalogRefusal.message}` } };
                        }
                        const recommendation = loop.recommendation as HarnessOptimizationRecommendation;
                        // THE NO-SECOND-ENGINE LAW: reopen the REAL DH-011 journey
                        // instrument over the SAME seams and the SAME root (its own
                        // ledgers land beside this family's mirror - the real authority
                        // surfaces; a refused reopen is carried verbatim).
                        const journeyLoad = await loadActivationKit({ clock: bound.clock, rng: bound.rng, catalog: bound.catalog, fsPort: bound.fsPort, root: bound.root });
                        if (!journeyLoad.ok) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'journey-refused',
                                                'execute',
                                                'THE VERBATIM-CARRY LAW',
                                                'executeThroughAuthorities: the REAL DH-011 journey instrument refused to reopen over its own persisted ledger - the refusal is carried verbatim (the loop record is unchanged)',
                                                undefined,
                                                { journeyRefusal: journeyLoad.refusal },
                                        ),
                                };
                        }
                        const walk = await walkDeltaThroughJourney(journeyLoad.kit, recommendation);
                        if (!walk.ok) {
                                return { ok: false, refusal: walk.refusal };
                        }
                        const journey = walk.journey;
                        // THE EVIDENCE-NOT-AUTHORITY LAW: the journey must sit at
                        // 'composed' (the record-composition leg is where the delta's new
                        // composition lands; the proposal / approval / activation remain
                        // the USER's journey through the REAL DH-01 authority).
                        if (journey.stage !== 'composed' || journey.recordLinks === null || journey.bindingHarnessId === null) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'unsafe-delta',
                                                'execute',
                                                'THE NO-SECOND-ENGINE LAW',
                                                `executeThroughAuthorities: the REAL journey answered green but sits at stage '${journey.stage}' without the composed links (the execute leg records ONLY the composed configuration - the proposal, approval and activation remain the USER's journey)`,
                                        ),
                                };
                        }
                        const evidence: LoopExecutionEvidence = {
                                journeyId: journey.journeyId,
                                journeyStage: 'composed',
                                recordLinks: journey.recordLinks,
                                bindingHarnessId: journey.bindingHarnessId,
                        };
                        const clockRead = readClock();
                        if ('refusal' in clockRead) {
                                return { ok: false, refusal: clockRead.refusal };
                        }
                        const at = clockRead.at;
                        const detail = `executed through the REAL DH-011 activation journey instrument (journey ${journey.journeyId} at stage 'composed', binding draft ${journey.bindingHarnessId}; the delta's new composition landed through the REAL DH-02..DH-09 kits; the proposal, approval and activation remain the USER's journey through the REAL DH-01 authority - the loop routes, never executes)`;
                        return applyLeg(
                                loop,
                                'execute-through-authorities',
                                'execute',
                                at,
                                'THE NO-SECOND-ENGINE LAW',
                                detail,
                                { execution: evidence },
                                evidence,
                        );
                },

                async measureResult(loopId: unknown, input: unknown): Promise<LoopOutcome> {
                        const disposedRefusal = refuseIfDisposed('measureResult');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        const lookup = lookupLoop('measureResult', loopId);
                        if ('refusal' in lookup) {
                                return { ok: false, refusal: lookup.refusal };
                        }
                        const loop = lookup.loop;
                        const stageRefusal = stageGuard('measure-result', loop);
                        if (stageRefusal !== null) {
                                return { ok: false, refusal: stageRefusal };
                        }
                        const inputRefusal = validateMeasureInput(input);
                        if (inputRefusal !== null) {
                                return { ok: false, refusal: inputRefusal };
                        }
                        const measureInput = input as MeasureResultInput;
                        const execution = loop.execution as LoopExecutionEvidence;
                        // THE HONEST-MEASURE LAW: the REAL DH-09 evaluation surface,
                        // reopened over its OWN persisted ledger (the composed
                        // benchmarks record the execute leg's journey minted); the
                        // caller-supplied measures route through it verbatim - the kit
                        // NEVER invents scores.
                        const benchmarksLoad = await loadBenchmarksKit({ clock: bound.clock, rng: bound.rng, fsPort: bound.fsPort, root: bound.root });
                        if (!benchmarksLoad.ok) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'measure-refused',
                                                'measure',
                                                'THE VERBATIM-CARRY LAW',
                                                'measureResult: the REAL DH-09 benchmarks kit refused to reopen over its own persisted ledger - the refusal is carried verbatim (the loop record is unchanged)',
                                                undefined,
                                                { benchmarksRefusal: benchmarksLoad.refusal },
                                        ),
                                };
                        }
                        const evaluation = await benchmarksLoad.kit.evaluateBenchmark(execution.recordLinks.benchmarksId, measureInput.benchmarkKey, measureInput.measures);
                        if (!evaluation.ok) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'measure-refused',
                                                'measure',
                                                'THE HONEST-MEASURE LAW',
                                                'measureResult: the REAL DH-09 evaluation surface refused the caller-supplied measures - the refusal is carried verbatim (the kit NEVER invents scores; the loop record is unchanged)',
                                                undefined,
                                                { benchmarksRefusal: evaluation.refusal },
                                        ),
                                };
                        }
                        const clockRead = readClock();
                        if ('refusal' in clockRead) {
                                return { ok: false, refusal: clockRead.refusal };
                        }
                        const at = clockRead.at;
                        const evidence: LoopMeasureEvidence = {
                                benchmarkKey: measureInput.benchmarkKey,
                                evaluation: evaluation.result,
                                outcome: measureInput.outcome as LoopMeasureEvidence['outcome'],
                                measuredAt: at,
                        };
                        const detail = `measured the result through the REAL DH-09 evaluateBenchmark (benchmark ${measureInput.benchmarkKey}, ${evaluation.result.scores.length} caller-supplied measure row(s) - the loop never invents scores; the observed outcome rides verbatim)`;
                        return applyLeg(
                                loop,
                                'measure-result',
                                'measure',
                                at,
                                'THE HONEST-MEASURE LAW',
                                detail,
                                { measures: evidence },
                                evidence,
                        );
                },

                async calibrate(loopId: unknown): Promise<LoopOutcome> {
                        const disposedRefusal = refuseIfDisposed('calibrate');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        const lookup = lookupLoop('calibrate', loopId);
                        if ('refusal' in lookup) {
                                return { ok: false, refusal: lookup.refusal };
                        }
                        const loop = lookup.loop;
                        const stageRefusal = stageGuard('calibrate', loop);
                        if (stageRefusal !== null) {
                                return { ok: false, refusal: stageRefusal };
                        }
                        const scope = loop.scope;
                        if (scope === null) {
                                // Unreachable through the stage machine (the observe leg set the
                                // scope); the defensive fail-closed branch.
                                return { ok: false, refusal: refused('malformed-record', 'calibrate', 'THE FAIL-CLOSED LAW', 'calibrate: the loop record is internally inconsistent (the observe leg walked but the scope is absent)') };
                        }
                        const recommendation = loop.recommendation as HarnessOptimizationRecommendation;
                        const measures = loop.measures as LoopMeasureEvidence;
                        const execution = loop.execution as LoopExecutionEvidence;
                        const winningReport = recommendation.comparison.reports.find((report) => report.id === recommendation.bestReportId);
                        if (winningReport === undefined) {
                                return { ok: false, refusal: refused('malformed-record', 'calibrate', 'THE FAIL-CLOSED LAW', 'calibrate: the recommendation carries no winning report (the record walk proved this - the defensive re-proof)') };
                        }
                        const observedAtRead = readClock();
                        if ('refusal' in observedAtRead) {
                                return { ok: false, refusal: observedAtRead.refusal };
                        }
                        // THE LINKAGE LAW: the REAL LAB-008 bridge adapter over the loop's
                        // OWN evidence - the recommendation (the REAL LabRecommendation the
                        // recommend leg minted), the winning evaluation, the observed
                        // outcome and the journey link (the bridge entry the execution
                        // flowed through). A linkage disagreement is the real module's own
                        // fail-closed answer (undefined).
                        const rows = observeBridgeOutcome({
                                recommendation: recommendation.labRecommendation,
                                evaluation: winningReport,
                                outcome: measures.outcome,
                                bridgeEntryId: execution.journeyId,
                                observedAt: observedAtRead.at,
                        });
                        if (rows === undefined) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'calibration-refused',
                                                'calibrate',
                                                'THE LINKAGE LAW',
                                                'calibrate: the REAL LAB-008 observeBridgeOutcome refused the observation (a linkage gate - the recommendation, the evaluation, the outcome and the journey link must all agree; the loop record is unchanged)',
                                        ),
                                };
                        }
                        const computedAtRead = readClock();
                        if ('refusal' in computedAtRead) {
                                return { ok: false, refusal: computedAtRead.refusal };
                        }
                        // The REAL model builder over the minted rows (the corpus honesty
                        // label: 'fixture' - the builder never upgrades it).
                        const model = buildCalibrationModel(rows, scope, computedAtRead.at, 'fixture');
                        // The REAL correctScores over the winning report's own prediction
                        // scores (the corrected predictions the next recommendation reads).
                        const corrected = correctScores(winningReport.scores, model);
                        const evidence: LoopCalibrationEvidence = {
                                records: rows,
                                model,
                                correctedScores: corrected,
                                calibratedAt: computedAtRead.at,
                        };
                        const at = computedAtRead.at;
                        const detail = `calibrated through the REAL LAB-008 surfaces (observeBridgeOutcome minted ${rows.length} row(s); buildCalibrationModel folded the model over ${model.observationCount} usable row(s); correctScores corrected ${corrected.length} prediction score(s))`;
                        return applyLeg(
                                loop,
                                'calibrate',
                                'calibrate',
                                at,
                                'THE MEASURE-CALIBRATE LAWS',
                                detail,
                                { calibration: evidence },
                                evidence,
                        );
                },

                async inspectLoop(id: unknown): Promise<LoopOutcome> {
                        const disposedRefusal = refuseIfDisposed('inspectLoop');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        const lookup = lookupLoop('inspectLoop', id);
                        if ('refusal' in lookup) {
                                return { ok: false, refusal: lookup.refusal };
                        }
                        return loopOutcome(lookup.loop);
                },

                async listLoops(filter?: unknown): Promise<LoopListOutcome> {
                        const disposedRefusal = refuseIfDisposed('listLoops');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        if (filter !== undefined) {
                                if (!isRecord(filter)) {
                                        return { ok: false, refusal: refused('UNKNOWN_FILTER', null, 'THE FAIL-CLOSED LAW', `listLoops: the filter must be undefined or a { stage } record (carried ${showValue(filter)})`) };
                                }
                                const keys = Object.keys(filter as Record<string, unknown>);
                                if (keys.length !== 1 || keys[0] !== 'stage') {
                                        return { ok: false, refusal: refused('UNKNOWN_FILTER', null, 'THE FAIL-CLOSED LAW', `listLoops: the filter carries the unknown field(s) ${showList(keys)} - only { stage } is known`) };
                                }
                                const stage = (filter as Record<string, unknown>).stage;
                                if (!isLoopStage(stage)) {
                                        return { ok: false, refusal: refused('UNKNOWN_FILTER', null, 'THE FAIL-CLOSED LAW', `listLoops: the filter's stage '${showValue(stage)}' is not a member of the frozen LOOP_STAGES list (imported by reference)`) };
                                }
                                const target = stage;
                                return {
                                        ok: true,
                                        loops: [...loops.keys()]
                                                .sort()
                                                .map((id) => loops.get(id) as OptimizationLoopRecord)
                                                .filter((record) => record.stage === target)
                                                .map((record) => copyLoop(record)),
                                };
                        }
                        return { ok: true, loops: [...loops.keys()].sort().map((id) => copyLoop(loops.get(id) as OptimizationLoopRecord)) };
                },

                dispose(): void {
                        disposed = true;
                },
        };
}

// --- THE NO-SECOND-ENGINE LAW's journey walk (the execute leg's core) --------------------------------

/** The journey-walk outcome: ok carries the composed journey record; failure carries the typed refusal (the real refusal verbatim). */
type JourneyWalkOutcome =
        | { readonly ok: true; readonly journey: ActivationJourneyRecord }
        | { readonly ok: false; readonly refusal: OptimizationKitRefusal };

/**
 * THE NO-SECOND-ENGINE LAW's journey walk: drives the approved
 * delta's context selections and six-family record composition
 * through the REAL DH-011 journey instrument's OWN leg ops
 * (beginJourney -> selectIndustry -> composeCompany ->
 * selectWorkTypes -> composeRoles -> composeRecords). Every real
 * refusal is carried verbatim under the typed unsafe-delta refusal
 * (a non-composed record the delta names, a dangling ref, a refused
 * context selection - the journey's own fail-closed laws). The walk
 * STOPS at 'composed': the proposal, approval and activation of the
 * composed configuration remain the USER's journey (the loop routes,
 * never executes - this function never calls proposeHarness,
 * approveHarness or activateHarness).
 */
async function walkDeltaThroughJourney(journeyKit: ActivationKit, recommendation: HarnessOptimizationRecommendation): Promise<JourneyWalkOutcome> {
        const begun = await journeyKit.beginJourney();
        if (!begun.ok) {
                return {
                        ok: false,
                        refusal: refused(
                                'unsafe-delta',
                                'execute',
                                'THE VERBATIM-CARRY LAW',
                                'executeThroughAuthorities: the REAL DH-011 journey instrument refused to begin the delta\'s journey - the refusal is carried verbatim (the loop record is unchanged)',
                                undefined,
                                { journeyRefusal: begun.refusal },
                        ),
                };
        }
        const journeyId = begun.journey.journeyId;
        const delta = recommendation.delta;
        const legs: ReadonlyArray<[string, () => Promise<ActivationJourneyOutcome>, string]> = [
                ['selectIndustry', () => journeyKit.selectIndustry(journeyId, delta.context.industry), 'the industry selection'],
                ['composeCompany', () => journeyKit.composeCompany(journeyId, delta.context.companyProfile), 'the company composition'],
                ['selectWorkTypes', () => journeyKit.selectWorkTypes(journeyId, delta.context.workTypes), 'the work-type selection'],
                ['composeRoles', () => journeyKit.composeRoles(journeyId, delta.context.roles), 'the role composition'],
                ['composeRecords', () => journeyKit.composeRecords(journeyId, delta.additions), 'the six-family record composition'],
        ];
        for (const [leg, run, label] of legs) {
                const outcome = await run();
                if (!outcome.ok) {
                        return {
                                ok: false,
                                refusal: refused(
                                        'unsafe-delta',
                                        'execute',
                                        'THE VERBATIM-CARRY LAW',
                                        `executeThroughAuthorities: the REAL DH-011 journey instrument refused ${label} of the delta's walk (${leg}) - the journey's real refusal is carried verbatim (a non-composed record the delta names, a dangling ref, a refused context selection; the loop record is unchanged)`,
                                        undefined,
                                        { journeyRefusal: outcome.refusal },
                                ),
                        };
                }
        }
        const composed = await journeyKit.inspectJourney(journeyId);
        if (!composed.ok) {
                return {
                        ok: false,
                        refusal: refused(
                                'unsafe-delta',
                                'execute',
                                'THE VERBATIM-CARRY LAW',
                                'executeThroughAuthorities: the REAL DH-011 journey instrument refused to re-read the composed journey - the refusal is carried verbatim (the loop record is unchanged)',
                                undefined,
                                { journeyRefusal: composed.refusal },
                        ),
                };
        }
        return { ok: true, journey: composed.journey };
}

// --- the caller-input walks (THE STRICT-SCHEMA LAW at the kit boundary) -------------------------------

function validateObserveInput(input: unknown): OptimizationKitRefusal | null {
        if (!isRecord(input)) {
                return refused('malformed-record', 'observe', 'THE STRICT-SCHEMA LAW', 'observeWorkload: the input must be a plain object { scope, records, controls, profileId } (never a silent partial verdict)');
        }
        const record = input as Record<string, unknown>;
        const unknownKeys = Object.keys(record).filter((key) => !(OBSERVE_INPUT_SCHEMA_KEYS as readonly string[]).includes(key));
        if (unknownKeys.length > 0) {
                return refused('malformed-record', 'observe', 'THE STRICT-SCHEMA LAW', `observeWorkload: the input schema is closed - the unknown key(s) ${showList(unknownKeys)} are rejected`, unknownKeys);
        }
        const missingKeys = (OBSERVE_INPUT_SCHEMA_KEYS as readonly string[]).filter((key) => !hasOwn(record, key));
        if (missingKeys.length > 0) {
                return refused('malformed-record', 'observe', 'THE FAIL-CLOSED LAW', `observeWorkload: the input schema requires every key - the key(s) ${showList(missingKeys)} are missing`, missingKeys);
        }
        if (!isLabScope(record.scope)) {
                return refused('malformed-record', 'observe', 'THE FAIL-CLOSED LAW', 'observeWorkload: the input scope must be the REAL LabScope shape { workspaceId, tenantId } (the workspace/tenant isolation law)');
        }
        if (typeof record.profileId !== 'string' || record.profileId.length === 0) {
                return refused('malformed-record', 'observe', 'THE CONTENT LAW', 'observeWorkload: the input profile id must be a non-empty string (the caller-supplied profile label the REAL learner stamps on its output)');
        }
        // THE PRIVACY LAW's input walk: the raw records are a TRANSIENT input - the
        // walk checks the REAL LabActivityRecord shape (the IMPORTED interface's own
        // field list and documented ranges) so a malformed corpus never reaches the
        // real learner.
        if (!Array.isArray(record.records)) {
                return refused('malformed-record', 'observe', 'THE FAIL-CLOSED LAW', 'observeWorkload: the input records must be an array of REAL LabActivityRecord-shaped rows (the transient input, never persisted)');
        }
        for (let i = 0; i < record.records.length; i += 1) {
                const rowError = activityRecordError(record.records[i], i);
                if (rowError !== null) {
                        return refused('malformed-record', 'observe', 'THE STRICT-SCHEMA LAW', `observeWorkload: ${rowError}`, [`records[${i}]`]);
                }
        }
        // The REAL WorkloadLearningControls shape (the governance gate).
        if (!isRecord(record.controls)) {
                return refused('malformed-record', 'observe', 'THE PRIVACY LAW (LAB-002 governance)', 'observeWorkload: the input controls must be a plain object { optIn, retentionDays, exportable, deleteAllBefore? } (the REAL governance gate)');
        }
        const controls = record.controls as Record<string, unknown>;
        const controlKeys = Object.keys(controls);
        const unknownControlKeys = controlKeys.filter((key) => !(WORKLOAD_CONTROLS_SCHEMA_KEYS as readonly string[]).includes(key));
        if (unknownControlKeys.length > 0) {
                return refused('malformed-record', 'observe', 'THE STRICT-SCHEMA LAW', `observeWorkload: the controls schema is closed - the unknown key(s) ${showList(unknownControlKeys)} are rejected`, unknownControlKeys);
        }
        for (const key of ['optIn', 'retentionDays', 'exportable'] as const) {
                if (!hasOwn(controls, key)) {
                        return refused('malformed-record', 'observe', 'THE PRIVACY LAW (LAB-002 governance)', `observeWorkload: the controls require the '${key}' key (the REAL governance gate)`, [key]);
                }
        }
        if (typeof controls.optIn !== 'boolean') {
                return rejectedControl('optIn', 'a boolean (the explicit opt-in gate - optIn false refuses the leg)');
        }
        if (typeof controls.retentionDays !== 'number' || !Number.isFinite(controls.retentionDays) || controls.retentionDays < 0) {
                return rejectedControl('retentionDays', 'a finite non-negative number (the retention window)');
        }
        if (typeof controls.exportable !== 'boolean') {
                return rejectedControl('exportable', 'a boolean (the export consent flag)');
        }
        if (controls.deleteAllBefore !== undefined && (typeof controls.deleteAllBefore !== 'string' || (controls.deleteAllBefore as string).length === 0)) {
                return rejectedControl('deleteAllBefore', 'an optional non-empty ISO string (the delete cutoff)');
        }
        return null;

        function rejectedControl(key: string, expected: string): OptimizationKitRefusal {
                return refused('malformed-record', 'observe', 'THE PRIVACY LAW (LAB-002 governance)', `observeWorkload: the controls' '${key}' must be ${expected}`, [`controls.${key}`]);
        }
}

/** One activity record's structural walk (the REAL LabActivityRecord interface's own fields, in its order). */
function activityRecordError(row: unknown, index: number): string | null {
        if (!isRecord(row)) {
                return `the activity record ${index} must be a plain object (the REAL LabActivityRecord shape)`;
        }
        const record = row as Record<string, unknown>;
        const keys = Object.keys(record);
        const expected = [...ACTIVITY_RECORD_SCHEMA_KEYS];
        if (keys.length !== expected.length || keys.some((key, i) => key !== expected[i])) {
                return `the activity record ${index} does not carry the REAL LabActivityRecord field list in the interface's order (a drift is a malformed corpus - never a silent partial learn)`;
        }
        if (!isLabScope(record.scope)) {
                return `the activity record ${index} carries a malformed scope (the REAL LabScope shape - the workspace/tenant isolation law)`;
        }
        if (typeof record.taskFamily !== 'string' || (record.taskFamily as string).length === 0) {
                return `the activity record ${index} carries a malformed taskFamily (a non-empty string)`;
        }
        if (!Array.isArray(record.toolKinds) || (record.toolKinds as unknown[]).some((kind) => typeof kind !== 'string' || (kind as string).length === 0)) {
                return `the activity record ${index} carries malformed toolKinds (an array of non-empty strings)`;
        }
        for (const key of ['usedBrowser', 'usedEnvironment', 'requiredReview'] as const) {
                if (typeof record[key] !== 'boolean') {
                        return `the activity record ${index} carries a non-boolean '${key}'`;
                }
        }
        if (typeof record.durationMinutes !== 'number' || !Number.isFinite(record.durationMinutes) || record.durationMinutes <= 0) {
                return `the activity record ${index} carries a malformed durationMinutes (a finite number > 0)`;
        }
        for (const key of ['complexityHint', 'qualitySensitivity', 'costSensitivity', 'latencySensitivity'] as const) {
                const value = record[key];
                if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
                        return `the activity record ${index} carries a malformed '${key}' (a finite number in [0, 1] - the REAL interface's documented range)`;
                }
        }
        if (typeof record.parallelThreads !== 'number' || !Number.isFinite(record.parallelThreads) || record.parallelThreads < 1) {
                return `the activity record ${index} carries a malformed parallelThreads (a finite number >= 1)`;
        }
        if (typeof record.humanInterventions !== 'number' || !Number.isFinite(record.humanInterventions) || record.humanInterventions < 0) {
                return `the activity record ${index} carries a malformed humanInterventions (a finite number >= 0)`;
        }
        if (typeof record.occurredAt !== 'string' || (record.occurredAt as string).length === 0) {
                return `the activity record ${index} carries a malformed occurredAt (a non-empty ISO string - the determinism law: caller-supplied timestamps only)`;
        }
        return null;
}

function validateCompareInput(input: unknown): OptimizationKitRefusal | null {
        if (!isRecord(input)) {
                return refused('malformed-record', 'compare', 'THE STRICT-SCHEMA LAW', 'compareOutcomes: the input must be a plain object { seeds, instanceCount, scorer? } (never a silent partial verdict)');
        }
        const record = input as Record<string, unknown>;
        const unknownKeys = Object.keys(record).filter((key) => !(COMPARE_INPUT_SCHEMA_KEYS as readonly string[]).includes(key));
        if (unknownKeys.length > 0) {
                return refused('malformed-record', 'compare', 'THE STRICT-SCHEMA LAW', `compareOutcomes: the input schema is closed - the unknown key(s) ${showList(unknownKeys)} are rejected (the REAL EvaluationRequest fields the loop forwards; the scope / runId / candidates derive from the loop's own evidence)`, unknownKeys);
        }
        const missingKeys = (COMPARE_INPUT_SCHEMA_KEYS as readonly string[]).filter((key) => key !== 'scorer' && !hasOwn(record, key));
        if (missingKeys.length > 0) {
                return refused('malformed-record', 'compare', 'THE FAIL-CLOSED LAW', `compareOutcomes: the input schema requires the key(s) ${showList(missingKeys)} (the scorer is the optional REAL replaceable seam)`, missingKeys);
        }
        // THE REPRODUCIBILITY LAW: the seeds are caller-pinned.
        if (!Array.isArray(record.seeds) || record.seeds.length === 0) {
                return refused('malformed-record', 'compare', 'THE REPRODUCIBILITY LAW', 'compareOutcomes: the input seeds must be a non-empty array of finite numbers (the pinned seed list - two or more seeds run the REAL multi-seed robustness rung)');
        }
        for (let i = 0; i < record.seeds.length; i += 1) {
                if (typeof record.seeds[i] !== 'number' || !Number.isFinite(record.seeds[i])) {
                        return refused('malformed-record', 'compare', 'THE REPRODUCIBILITY LAW', `compareOutcomes: the seed ${i} must be a finite number (the pinned seed list)`, [`seeds[${i}]`]);
                }
        }
        if (typeof record.instanceCount !== 'number' || !Number.isInteger(record.instanceCount) || record.instanceCount < 1) {
                return refused('malformed-record', 'compare', 'THE REPRODUCIBILITY LAW', 'compareOutcomes: the input instanceCount must be an integer >= 1 (the instances per seed the REAL world generator draws)');
        }
        if (record.scorer !== undefined) {
                const scorerError = scorerErrorOf(record.scorer);
                if (scorerError !== null) {
                        return refused('malformed-record', 'compare', 'THE SIMULATION LAW', `compareOutcomes: ${scorerError}`);
                }
        }
        return null;
}

/** The REAL CandidateScorer seam's structural walk (the replaceable response model). */
function scorerErrorOf(scorer: unknown): string | null {
        if (!isRecord(scorer)) {
                return 'the scorer must be a plain object (the REAL CandidateScorer seam - the replaceable response model)';
        }
        const record = scorer as Record<string, unknown>;
        const keys = Object.keys(record);
        if (keys.length !== 4 || keys.some((key) => !['engineId', 'engineVersion', 'evidenceLevel', 'scoreCandidate'].includes(key))) {
                return 'the scorer must carry exactly the REAL CandidateScorer fields { engineId, engineVersion, evidenceLevel, scoreCandidate }';
        }
        if (typeof record.engineId !== 'string' || (record.engineId as string).length === 0) {
                return 'the scorer\'s engineId must be a non-empty string (the stable engine identifier)';
        }
        if (typeof record.engineVersion !== 'string' || (record.engineVersion as string).length === 0) {
                return 'the scorer\'s engineVersion must be a non-empty string (the semver-style engine version)';
        }
        if (!isLoopEvidenceLevel(record.evidenceLevel)) {
                return 'the scorer\'s evidenceLevel must be a member of the REAL six-rung LabEvidenceLevel ladder (the honesty label the real engine stamps on its reports; a claim above the loop\'s ceiling refuses at the recommend boundary)';
        }
        if (typeof record.scoreCandidate !== 'function') {
                return 'the scorer\'s scoreCandidate must be a function (the REAL per-dimension scoring seam)';
        }
        return null;
}

function validateRecommendInput(input: unknown): OptimizationKitRefusal | null {
        if (!isRecord(input)) {
                return refused('malformed-record', 'recommend', 'THE STRICT-SCHEMA LAW', 'recommendImprovement: the input must be a plain object { delta, reversibility } (never a silent partial verdict)');
        }
        const record = input as Record<string, unknown>;
        const unknownKeys = Object.keys(record).filter((key) => !(RECOMMEND_INPUT_SCHEMA_KEYS as readonly string[]).includes(key));
        if (unknownKeys.length > 0) {
                return refused('malformed-record', 'recommend', 'THE STRICT-SCHEMA LAW', `recommendImprovement: the input schema is closed - the unknown key(s) ${showList(unknownKeys)} are rejected`, unknownKeys);
        }
        const missingKeys = (RECOMMEND_INPUT_SCHEMA_KEYS as readonly string[]).filter((key) => !hasOwn(record, key));
        if (missingKeys.length > 0) {
                return refused('malformed-record', 'recommend', 'THE FAIL-CLOSED LAW', `recommendImprovement: the input schema requires every key - the key(s) ${showList(missingKeys)} are missing`, missingKeys);
        }
        return null;
}

function validateMeasureInput(input: unknown): OptimizationKitRefusal | null {
        if (!isRecord(input)) {
                return refused('malformed-record', 'measure', 'THE STRICT-SCHEMA LAW', 'measureResult: the input must be a plain object { benchmarkKey, measures, outcome } (never a silent partial verdict)');
        }
        const record = input as Record<string, unknown>;
        const unknownKeys = Object.keys(record).filter((key) => !(MEASURE_INPUT_SCHEMA_KEYS as readonly string[]).includes(key));
        if (unknownKeys.length > 0) {
                return refused('malformed-record', 'measure', 'THE STRICT-SCHEMA LAW', `measureResult: the input schema is closed - the unknown key(s) ${showList(unknownKeys)} are rejected`, unknownKeys);
        }
        const missingKeys = (MEASURE_INPUT_SCHEMA_KEYS as readonly string[]).filter((key) => !hasOwn(record, key));
        if (missingKeys.length > 0) {
                return refused('malformed-record', 'measure', 'THE FAIL-CLOSED LAW', `measureResult: the input schema requires every key - the key(s) ${showList(missingKeys)} are missing`, missingKeys);
        }
        if (typeof record.benchmarkKey !== 'string' || (record.benchmarkKey as string).length === 0) {
                return refused('malformed-record', 'measure', 'THE HONEST-MEASURE LAW', 'measureResult: the input benchmark key must be a non-empty string (the executed delta\'s benchmark to evaluate)');
        }
        if (!Array.isArray(record.measures)) {
                return refused('malformed-record', 'measure', 'THE HONEST-MEASURE LAW', 'measureResult: the input measures must be an array of EvalScore-shaped rows (the REAL evaluation-score shape; the kit NEVER invents scores - the REAL DH-09 surface validates every row)');
        }
        // THE HONEST-MEASURE LAW: the observed outcome walks through the REAL
        // TaskOutcome shape (the calibrate leg's input - never invented).
        const outcomeError = validateTaskOutcome(record.outcome);
        if (outcomeError !== null) {
                return refused('malformed-record', 'measure', 'THE HONEST-MEASURE LAW', `measureResult: ${outcomeError}`);
        }
        return null;
}

// --- the deterministic derivations (the profile -> request compositions) ------------------------------

/**
 * The utility weights derived from the observed profile (the
 * documented deterministic formula): the cost weight grows with the
 * learned per-task budget (0.5..2.0 USD span -> a quarter of the
 * span), the latency weight with the learned SLA (5..60 minute span
 * -> a quarter of the span), the success weight is the fixed 0.3
 * floor and the quality weight is the remainder. Non-negative, sum
 * exactly 1 (the REAL modules' own weight law).
 */
function deriveUtilityWeights(profile: WorkloadProfile): Record<'success' | 'quality' | 'latency' | 'cost', number> {
        const budgetShare = clamp01(profile.budgetUsdPerTask / 2);
        const slaShare = clamp01(profile.latencySlaMinutes / 60);
        const latency = 0.15 + 0.15 * slaShare;
        const cost = 0.15 + 0.15 * budgetShare;
        const success = 0.3;
        const quality = 1 - success - latency - cost;
        return { success, quality, latency, cost };
}

/**
 * THE COHERENCE LAW's deterministic coupling: the observed dominant
 * task type couples to the FIRST real task world whose task-type id
 * carries the dominant task family (the family extracted from the
 * dominant id using the REAL dominant descriptor's own verification
 * style - the learner's documented `tt-<family>-<style>` mint). No
 * coupling -> the simulate leg refuses (scenario-unresolvable).
 */
function coupleScenario(workload: WorkloadLearningResult, dominantTaskTypeId: string): TaskScenario | undefined {
        const dominant = workload.taskTypes.find((taskType) => taskType.taskTypeId === dominantTaskTypeId);
        const style = dominant === undefined ? '' : dominant.descriptor.verificationStyle;
        const family =
                style.length > 0 && dominantTaskTypeId.startsWith('tt-') && dominantTaskTypeId.endsWith(`-${style}`)
                        ? dominantTaskTypeId.slice(3, dominantTaskTypeId.length - style.length - 1)
                        : dominantTaskTypeId.slice(3);
        if (family.length === 0) {
                return undefined;
        }
        for (const world of TASK_WORLDS) {
                for (const scenario of world.taskScenarios) {
                        if (scenario.taskTypeId.slice(3).includes(family)) {
                                return scenario;
                        }
                }
        }
        return undefined;
}

/**
 * The recommendation confidence (the documented deterministic
 * formula): the retained-observation count, the ladder seed count and
 * the calibration honesty all weight it - below the REAL
 * MIN_FACTORS_OBSERVATIONS floor the confidence stays materially
 * lower (an uncalibrated corpus is never laundered into confidence).
 */
function recommendationConfidence(retainedRecordCount: number, seedsUsed: number, belowMinimum: boolean): number {
        return clamp01(0.35 + 0.04 * Math.min(retainedRecordCount, 8) + 0.05 * Math.min(seedsUsed, 4) + (belowMinimum ? 0 : 0.1));
}

/** The LabRecommendation caveats (the honest caveats, carried from the real modules' own warnings). */
function recommendationCaveats(workload: WorkloadLearningResult, belowMinimum: boolean, observationCount: number, missingCount: number): string[] {
        const caveats: string[] = [];
        for (const warning of workload.warnings) {
                caveats.push(`workload learning: ${warning} (the REAL LAB-002 warning, carried verbatim)`);
        }
        if (belowMinimum) {
                caveats.push(`the prior calibration corpus carries ${observationCount} observation row(s) - BELOW the REAL MIN_FACTORS_OBSERVATIONS floor of ${MIN_FACTORS_OBSERVATIONS} (the confidence is uncalibrated, never fabricated)`);
        }
        if (missingCount > 0) {
                caveats.push(`the recommended organization does not cover ${missingCount} required capabilit${missingCount === 1 ? 'y' : 'ies'} (the missing-capability ledger - reported, never silently dropped)`);
        }
        return caveats;
}

/** THE UNCERTAINTY LAW's deterministic honesty statement. */
function uncertaintyStatement(
        evidenceLevel: string,
        workload: WorkloadLearningResult,
        candidateCount: number,
        ladderLevel: number,
        seedsUsed: number,
        calibrationState: { observationCount: number; belowMinimum: boolean },
        missingCount: number,
): string {
        const calibrationSentence = calibrationState.belowMinimum
                ? `the prior calibration corpus carries ${calibrationState.observationCount} observation row(s) - BELOW the REAL MIN_FACTORS_OBSERVATIONS floor of ${MIN_FACTORS_OBSERVATIONS} (the honest state: the confidence is uncalibrated, never fabricated)`
                : `the prior calibration corpus carries ${calibrationState.observationCount} observation row(s) (at or above the REAL MIN_FACTORS_OBSERVATIONS floor of ${MIN_FACTORS_OBSERVATIONS})`;
        return `The recommendation's evidence level is '${evidenceLevel}' (the winning evaluation's own answer; the loop's frozen ceiling is 'simulated' - never promoted). The observed workload retained ${workload.retainedRecordCount} record(s) (${workload.excludedRecordCount} excluded); the simulation ranked ${candidateCount} candidate organization(s); the ladder run evaluated at level ${ladderLevel} using ${seedsUsed} seed(s). ${calibrationSentence}. The missing-capability ledger carries ${missingCount} entr${missingCount === 1 ? 'y' : 'ies'}.`;
}

/** The LATEST prior calibration evidence (the most recently created loop that closed its calibrate leg; deterministic under replay). */
function latestPriorCalibration(loops: ReadonlyMap<string, OptimizationLoopRecord>, currentLoopId: string): LoopCalibrationEvidence | null {
        let latest: LoopCalibrationEvidence | null = null;
        for (const [id, record] of loops) {
                if (id !== currentLoopId && record.calibration !== null) {
                        latest = record.calibration;
                }
        }
        return latest;
}

// --- the ledger replay (THE APPEND-ONLY LEDGER LAW's re-proof from the ledger alone) -------------------

interface ReplayOk {
        readonly lines: readonly OptimizationOpsLedgerLine[];
        readonly loops: ReadonlyMap<string, OptimizationLoopRecord>;
}

/**
 * The ledger replay: each line re-validated in the canonical order -
 * the frozen eleven-key line schema, the seq (equal to the line
 * number), the contract version, the op membership, the loop id form,
 * the op's line leg (the frozen op<->leg table), the provenance
 * sentences, THE FORWARD-ONLY LAW's frontier discipline, the stage
 * chain through the contract's own machine, THE APPROVAL-BEFORE-
 * EXECUTE LAW, the payload walks through the REAL validators and the
 * FULL record walk after every applied line. Returns the replayed
 * lines + the rebuilt loops, or the deterministic drift sentence (the
 * typed E_LEDGER_TORN).
 */
function replayOptimizationLedger(ledgerText: string | null): ReplayOk | string {
        if (ledgerText === null) {
                return { lines: [], loops: new Map<string, OptimizationLoopRecord>() };
        }
        const lines = ledgerText.split('\n').filter((line) => line.trim().length > 0);
        const loops = new Map<string, OptimizationLoopRecord>();
        const replayed: OptimizationOpsLedgerLine[] = [];
        for (let i = 0; i < lines.length; i += 1) {
                let parsed: unknown;
                try {
                        parsed = JSON.parse(lines[i]);
                } catch (error) {
                        return `replayOptimizationLedger: line ${i + 1} is not valid JSON: ${toMessage(error)} (a torn write - never a silent partial replay)`;
                }
                if (!isRecord(parsed)) {
                        return `replayOptimizationLedger: line ${i + 1} is not a JSON object (a torn write)`;
                }
                const line = parsed as Record<string, unknown>;
                const keys = Object.keys(line);
                const expected = [...OPTIMIZATION_LEDGER_LINE_SCHEMA_KEYS];
                if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
                        return `replayOptimizationLedger: line ${i + 1} does not carry the frozen eleven-key ledger-line schema in the canonical fixed-key order`;
                }
                if (line.seq !== i + 1) {
                        return `replayOptimizationLedger: line ${i + 1} carries seq ${showValue(line.seq)} - the seq must equal the line number (the append-only law)`;
                }
                if (line.contractVersion !== OPTIMIZATION_CONTRACTS_VERSION) {
                        return `replayOptimizationLedger: line ${i + 1} carries contract version '${showValue(line.contractVersion)}' - only '${OPTIMIZATION_CONTRACTS_VERSION}' is known (THE SINGLE-VERSION LAW's live station)`;
                }
                if (typeof line.at !== 'string' || line.at.length === 0) {
                        return `replayOptimizationLedger: line ${i + 1} carries no clock reading`;
                }
                if (!isLoopOpName(line.op)) {
                        return `replayOptimizationLedger: line ${i + 1} carries an unknown op ${showValue(line.op)}`;
                }
                const op = line.op as LoopOpName;
                if (!isLoopId(line.loopId)) {
                        return `replayOptimizationLedger: line ${i + 1} carries a malformed loop id ${showValue(line.loopId)} (the flauz:opt:<16-hex> form)`;
                }
                const loopId = line.loopId as string;
                // The op's line leg: the LAST of the op's own legs (null only on begin).
                const opLegs = LOOP_OP_LEGS[op];
                const lineLeg = opLegs.length === 0 ? null : opLegs[opLegs.length - 1];
                if (line.leg !== lineLeg) {
                        return `replayOptimizationLedger: line ${i + 1} carries the leg '${showValue(line.leg)}' under op '${op}' - the line lands on the op's LAST leg '${showValue(lineLeg)}' (the frozen op<->leg table)`;
                }
                if (typeof line.law !== 'string' || line.law.length === 0 || typeof line.detail !== 'string' || line.detail.length === 0) {
                        return `replayOptimizationLedger: line ${i + 1} carries no provenance (the law and detail sentences are required)`;
                }
                // The loop fold's guards (the stage machine + the fail-closed laws,
                // re-proven from the ledger alone).
                const loop = loops.get(loopId);
                if (op === 'begin-loop') {
                        if (loop !== undefined) {
                                return `replayOptimizationLedger: line ${i + 1} begins the loop ${loopId} a second time (the loop lineage law - a new optimization is a NEW loop id)`;
                        }
                        if (line.payload !== null) {
                                return `replayOptimizationLedger: line ${i + 1} (begin-loop) carries a non-null payload column (the begin line mints only the loop id)`;
                        }
                        if (line.fromStage !== null || line.toStage !== 'observe') {
                                return `replayOptimizationLedger: line ${i + 1} (begin-loop) must walk the null -> observe net edge`;
                        }
                } else {
                        if (loop === undefined) {
                                return `replayOptimizationLedger: line ${i + 1} walks the loop ${loopId} before its begin line (the loop lineage law)`;
                        }
                        // THE FORWARD-ONLY LAW's frontier discipline (the contract's table).
                        const required = LOOP_OP_REQUIRED_LEGS[op];
                        const expectedLeg = required.length === 0 ? null : required[required.length - 1];
                        const expectedIndex = expectedLeg === null ? -1 : loopLegIndex(expectedLeg);
                        const frontier = loop.history.length === 0 ? null : loop.history[loop.history.length - 1].leg;
                        const frontierIndex = frontier === null ? -1 : loopLegIndex(frontier);
                        if (frontierIndex < expectedIndex) {
                                return `replayOptimizationLedger: line ${i + 1} (${op}) precedes its walked prerequisites within the frozen leg order (THE FORWARD-ONLY LAW re-proven from the ledger alone)`;
                        }
                        if (frontierIndex > expectedIndex) {
                                return `replayOptimizationLedger: line ${i + 1} (${op}) is behind the walk (the loop record never walks back; 'calibrate' is terminal; THE FORWARD-ONLY LAW re-proven from the ledger alone)`;
                        }
                        // The net stage edge: the chain + the contract's own machine.
                        if (line.fromStage !== loop.stage) {
                                return `replayOptimizationLedger: line ${i + 1} (${op}) walks from stage '${showValue(line.fromStage)}' - the loop's current stage is '${loop.stage}' (the stage chain never breaks)`;
                        }
                        const legStage = lineLeg === null ? 'observe' : LOOP_LEG_STAGES[lineLeg];
                        if (line.toStage !== legStage) {
                                return `replayOptimizationLedger: line ${i + 1} (${op}) walks to stage '${showValue(line.toStage)}' - the frozen leg<->stage table lands '${legStage}'`;
                        }
                        if (line.fromStage !== line.toStage) {
                                const verdict = canTransitionLoopStage(line.fromStage, line.toStage);
                                if (!verdict.ok) {
                                        return `replayOptimizationLedger: line ${i + 1} (${op}) walks the illegal stage edge '${showValue(line.fromStage)}' -> '${showValue(line.toStage)}' (${verdict.detail})`;
                                }
                        }
                        // THE APPROVAL-BEFORE-EXECUTE LAW: the execute line requires the
                        // approve line (the recorded approval evidence).
                        if (op === 'execute-through-authorities' && loop.approval === null) {
                                return `replayOptimizationLedger: line ${i + 1} (execute-through-authorities) arrives without the obtain-approval line (THE APPROVAL-BEFORE-EXECUTE LAW re-proven from the ledger alone - no approval input, no execution)`;
                        }
                }
                // The payload walks (the REAL validators, imported by reference).
                const payloadError = walkLinePayload(op, line.payload);
                if (payloadError !== null) {
                        return `replayOptimizationLedger: line ${i + 1} (${op}) ${payloadError}`;
                }
                // The fold: apply the line to the loop record (the begin line constructs
                // the fresh record; every other op folds over the begun one).
                const next = foldLine(loop, line, op, lineLeg);
                // THE FAIL-CLOSED PARSE: the full record walk after every applied line
                // (the loop laws re-proven from the ledger alone).
                const verdict = validateOptimizationLoopRecord(next);
                if (!verdict.ok) {
                        return `replayOptimizationLedger: line ${i + 1} (${op}) folds into a loop record that fails the deep walk: ${verdict.rejection.message} (THE FAIL-CLOSED LAW re-proven from the ledger alone)`;
                }
                loops.set(loopId, next);
                replayed.push(line as unknown as OptimizationOpsLedgerLine);
        }
        return { lines: replayed, loops };
}

/** The per-op payload walk (the REAL validators, imported by reference). */
function walkLinePayload(op: LoopOpName, payload: unknown): string | null {
        if (op === 'begin-loop') {
                return payload === null ? null : 'carries a non-null payload (the begin line mints only the loop id)';
        }
        if (op === 'observe-workload') {
                const error = validateWorkloadEvidence(payload, 'ledger');
                return error === null ? null : `carries a workload payload that fails the REAL LAB-002 structural walk (${error}) - THE PRIVACY LAW: only the DERIVED WorkloadLearningResult ever persists`;
        }
        if (op === 'simulate-candidates') {
                const error = validateSearchEvidence(payload, 'ledger');
                return error === null ? null : `carries a simulation payload that fails the REAL LAB-005 structural walk (${error})`;
        }
        if (op === 'compare-outcomes') {
                const error = validateLadderEvidence(payload, 'ledger');
                return error === null ? null : `carries a comparison payload that fails the REAL LAB-006 structural walk (${error})`;
        }
        if (op === 'recommend-improvement') {
                const walked = validateHarnessOptimizationRecommendation(payload);
                return walked.ok ? null : `carries a recommendation that fails the contract's own deep walk (${walked.rejection.reason}: ${walked.rejection.message})`;
        }
        if (op === 'obtain-approval') {
                const mirror = validateLoopApprovalMirror(payload);
                return mirror.ok ? null : `carries an approval decision mirror that fails the walk (${mirror.message})`;
        }
        if (op === 'execute-through-authorities') {
                const error = validateLoopExecutionEvidence(payload);
                return error === null ? null : `carries an execution evidence that fails the walk (${error})`;
        }
        if (op === 'measure-result') {
                const error = validateLoopMeasureEvidence(payload);
                return error === null ? null : `carries a measure evidence that fails the REAL DH-09 / TaskOutcome walks (${error})`;
        }
        const error = validateLoopCalibrationEvidence(payload);
        return error === null ? null : `carries a calibration evidence that fails the REAL LAB-008 walks (${error})`;
}

/** The fold: applies one replayed line to the loop record (the same transitions the kit applies; the begin line folds over an undefined loop). */
function foldLine(
        loop: OptimizationLoopRecord | undefined,
        line: Record<string, unknown>,
        op: LoopOpName,
        leg: LoopLeg | null,
): OptimizationLoopRecord {
        const note = {
                at: line.at as string,
                leg,
                fromStage: line.fromStage as LoopStage | null,
                toStage: line.toStage as LoopStage,
                op,
                law: line.law as string,
                detail: line.detail as string,
        };
        if (op === 'begin-loop') {
                return {
                        loopId: line.loopId as string,
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
                        createdAtIso: line.at as string,
                        revision: 1,
                        history: [note],
                };
        }
        const current = loop as OptimizationLoopRecord;
        const payload = line.payload;
        const fieldOf: Record<Exclude<LoopOpName, 'begin-loop'>, keyof OptimizationLoopRecord> = {
                'observe-workload': 'workload',
                'simulate-candidates': 'simulation',
                'compare-outcomes': 'comparison',
                'recommend-improvement': 'recommendation',
                'obtain-approval': 'approval',
                'execute-through-authorities': 'execution',
                'measure-result': 'measures',
                calibrate: 'calibration',
        };
        const field = fieldOf[op as Exclude<LoopOpName, 'begin-loop'>];
        return {
                ...current,
                ...( { [field]: payload } as Partial<OptimizationLoopRecord> ),
                ...( op === 'observe-workload' ? { scope: (payload as WorkloadLearningResult).profile.scope } : {} ),
                stage: line.toStage as LoopStage,
                revision: current.revision + 1,
                history: [...current.history, note],
        };
}

/** The envelope cross-check (the mirror vs the ledger replay; never silently rebuilt). */
function crossCheckEnvelope(envelopeText: string | null, seq: number, loops: ReadonlyMap<string, OptimizationLoopRecord>): { reason: 'E_LEDGER_TORN' | 'E_ENVELOPE_MISMATCH'; message: string } | null {
        const expected = `{"contractVersion":${JSON.stringify(OPTIMIZATION_CONTRACTS_VERSION)},"seq":${seq},"loops":[${[...loops.keys()]
                .sort()
                .map((id) => serializeOptimizationLoop(loops.get(id) as OptimizationLoopRecord))
                .join(',')}]}`;
        if (envelopeText === null) {
                if (seq === 0) {
                        return null;
                }
                return {
                        reason: 'E_ENVELOPE_MISMATCH',
                        message: 'crossCheckEnvelope: the optimization envelope is missing while the ledger carries lines (never silently rebuilt - reopen requires the honest envelope)',
                };
        }
        if (envelopeText !== expected) {
                return {
                        reason: 'E_ENVELOPE_MISMATCH',
                        message: 'crossCheckEnvelope: the optimization envelope diverges from the ledger replay (the envelope is the mirror, the ledger is the authority - never silently rebuilt)',
                };
        }
        return null;
}

// --- the shared helpers (the family pattern's private block) ---------------------------------------

function refused(
        reason: OptimizationKitRefusalReason,
        leg: LoopLeg | null,
        law: string,
        message: string,
        items?: readonly string[],
        verbatim?: { contentRejection?: LoopContentRejection; journeyRefusal?: ActivationKitRefusal; benchmarksRefusal?: BenchmarksKitRefusal },
): OptimizationKitRefusal {
        return {
                reason,
                leg,
                law,
                message,
                ...(items === undefined ? {} : { items }),
                ...(verbatim === undefined ? {} : verbatim),
        };
}

function isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
        return Object.prototype.hasOwnProperty.call(record, key);
}

function showValue(value: unknown): string {
        if (typeof value === 'string') {
                return `'${value}'`;
        }
        if (value === null) {
                return 'null';
        }
        if (value === undefined) {
                return 'undefined';
        }
        if (Array.isArray(value)) {
                return 'an array';
        }
        return typeof value;
}

function showList(items: readonly string[]): string {
        return items.map((item) => `'${item}'`).join(', ');
}

function clamp01(value: number): number {
        if (Number.isNaN(value)) {
                return 0;
        }
        return Math.min(1, Math.max(0, value));
}

function toMessage(error: unknown): string {
        if (error instanceof Error) {
                return error.message;
        }
        return String(error);
}

/** Reads a text file through the injected port (a missing file reads as null - the registry precedent's ENOENT convention). */
async function readText(fsPort: HarnessFsPort, path: string): Promise<string | null> {
        try {
                return await fsPort.readFile(path, 'utf8');
        } catch (error) {
                const code = (error as { code?: unknown }).code;
                if (code === 'ENOENT') {
                        return null;
                }
                throw error;
        }
}
