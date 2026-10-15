/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * DH-012 optimization contract family: the typed Lab-driven harness
 * optimization loop vocabulary - the twelfth item of the Domain Harness
 * OS workstream (WORK-REGISTRY.md § TL-B). A loop walks the registry
 * row's eight-stage chain
 *   observe workload -> simulate candidate configurations ->
 *   compare outcomes -> recommend improvement -> obtain required
 *   approval -> execute through existing Flauz authorities -> measure
 *   result -> calibrate
 * THROUGH THE REAL LAB MODULES (workloadLearning, orgSearch,
 * runEngine over the deterministic task worlds, calibration) and
 * executes ONLY through the existing Flauz authorities (the DH-011
 * activation journey instrument and the real kits beneath it).
 *
 * THE NO-SECOND-ENGINE LAW (this family's first law, ARCHITECTURE-LOCK
 * §10.7 + §12.6): the loop RECOMMENDS and RECORDS - it never
 * schedules, never executes work, never writes a second journal
 * (beyond its own evidence mirror), never becomes a model router, a
 * capability authority or a persistence authority. Every execution
 * routes through the EXISTING Flauz authorities: the execute leg
 * drives the REAL DH-011 journey instrument (which itself drives the
 * REAL DH-02/DH-03/DH-04..DH-09 kits and the REAL DH-01 authority
 * through its own surfaces); the measure leg reads through the REAL
 * DH-09 evaluation surface; the calibrate leg folds through the REAL
 * calibration module. A Lab recommendation becomes a real change only
 * through those normal authorities (§10.7); the Lab never directly
 * performs an ungoverned side effect.
 *
 * THE APPROVAL LAW: no recommendation reaches the execute stage
 * without the recorded caller approval decision - an unapproved
 * execute attempt is the typed approval-missing refusal leaving the
 * loop record byte-identical (the record-unchanged law).
 *
 * THE AUDIT LAW: the HarnessOptimizationRecommendation carries its
 * FULL evidence trail - every leg's real outputs VERBATIM (the REAL
 * WorkloadLearningResult, OrgSearchResult and LadderRunResult shapes,
 * imported by reference, never re-declared) plus the REAL
 * LabRecommendation minted for the calibration linkage.
 *
 * THE UNCERTAINTY LAW: the recommendation's typed uncertainty
 * disclosure names its evidence level (a REAL LabEvidenceLevel
 * member; THE EVIDENCE-CEILING LAW: the loop's ceiling is
 * 'simulated' - a higher rung is the typed evidence-ceiling refusal,
 * never a promotion), its observation counts and its calibration
 * state (the REAL MIN_FACTORS_OBSERVATIONS honesty: below the
 * minimum the uncertainty field SAYS SO - never a fabricated
 * confidence).
 *
 * THE MISSING-CAPABILITY LAW: the recommendation carries an explicit
 * typed ledger of every required capability the recommended
 * organization does NOT cover (the REAL capabilityCoverage rows); a
 * zero-entry ledger is the green path - a gap is reported, never
 * silently dropped.
 *
 * THE REVERSIBILITY LAW: reversible deltas carry their typed rollback
 * path (which family records to remove/restore - a rollback that
 * itself routes through the authorities, never a direct mutation);
 * an irreversible delta is REFUSED at the recommend boundary unless
 * the caller explicitly acknowledges irreversibility (the
 * reversible-first law; the typed irreversible-refused refusal).
 *
 * THE MEASURE-CALIBRATE LAWS: the measure leg carries the
 * caller-supplied real measures (the honest-measure law - the loop
 * never invents scores; the measures route through the REAL DH-09
 * evaluation surface) and the caller-supplied REAL TaskOutcome; the
 * calibrate leg routes through the REAL observeBridgeOutcome /
 * buildCalibrationModel / correctScores surfaces and records what
 * they answered.
 *
 * THE PRIVACY LAW (LAB-002 governance): raw activity records NEVER
 * persist - the observe leg's ledger line carries only the derived
 * WorkloadLearningResult (the profile, the task types and the
 * counts); the opt-in gate refuses the observe leg without explicit
 * consent (the typed learning-opt-out refusal).
 *
 * THE IMPORT LAW: every vocabulary that exists upstream is imported
 * by reference - the TWELVE prior family versions (DH-01..DH-11) and
 * the REAL LAB_CONTRACTS_VERSION, the evidence ladder and the eval
 * vocabulary, the workload/org/ladder/calibration shapes, the six
 * record families' entry validators and id alphabets, the journey
 * record links - never re-declared. The loop-stage vocabulary, the
 * delta vocabulary and the ledger line schema are THIS family's own.
 * THE CONTENT LAW: no per-industry loop content is shipped - the
 * caller supplies the activity records, the delta's domain content
 * and the measures; this family is the instrument, not the content
 * (the evidence level is fixture: the battery drives the real
 * modules with fixture inputs - claim exactly that).
 *
 * LAWS (the family pattern, inherited from the landed DH-01..DH-11):
 * - THE SINGLE-VERSION LAW: OPTIMIZATION_CONTRACTS_VERSION is
 *   declared ONCE here, re-carried by the kit; the battery pins the
 *   TWELVE family versions equal.
 * - THE FORWARD-ONLY LAW: the loop stages (observe -> simulate ->
 *   compare -> recommend -> approve -> execute -> measure ->
 *   calibrate) never walk back; 'calibrate' is TERMINAL (a closed
 *   loop; a new optimization is a NEW loop id - the append-only
 *   lineage law).
 * - THE FROZEN-VOCABULARY LAW: the eight loop stages, the nine op
 *   names, the staged vocabulary and the rejection vocabulary are
 *   closed frozen lists; widening or reordering any of them is a
 *   versioned contract decision.
 * - THE STRICT-SCHEMA LAW: every payload (the delta, the
 *   recommendation, the loop record, the history notes) carries a
 *   frozen closed key schema; an unknown key is the typed
 *   malformed-record rejection, a missing key the typed
 *   malformed-record rejection, a wrong carrier the typed
 *   malformed-record rejection (never a silent partial verdict).
 * - THE FAIL-CLOSED PARSE: canonical fixed-key-order serialization +
 *   the typed parse walk (malformed-json / torn-envelope /
 *   unknown-contract-version / unknown-key / invalid-record),
 *   first-failure-is-the-verdict, in the frozen order.
 * - THE DETERMINISM LAW: no Math.random, no Date.now, no new Date(...)
 *   and no process.env in this module (law comments excepted) - the
 *   clock, the rng, the catalog and the fsPort are INJECTED seams the
 *   kit module forwards to the real modules it drives.
 */

import {
        DOMAIN_HARNESS_CONTRACTS_VERSION,
        isHarnessId,
        isHarnessIndustry,
} from '../../contract/common/domainHarnessContract.js';
import type { HarnessIndustry, HarnessWorkType } from '../../contract/common/domainHarnessContract.js';
import {
        ONBOARDING_CONTRACTS_VERSION,
        validateOnboardingCompanyProfile,
        validateOnboardingIndustryPayload,
        validateOnboardingWorkTypes,
} from '../../onboarding/common/onboardingContract.js';
import type { OnboardingCompanyProfile, OnboardingRefusal } from '../../onboarding/common/onboardingContract.js';
import {
        MAX_ROLES,
        ROLES_CONTRACTS_VERSION,
        validateRoleEntry,
} from '../../roles/common/rolesContract.js';
import type { HarnessRole, RoleCompositionRejection } from '../../roles/common/rolesContract.js';
import { ONTOLOGY_CONTRACTS_VERSION, validateTermEntry } from '../../ontology/common/ontologyContract.js';
import type { OntologyRejection, OntologyTerm } from '../../ontology/common/ontologyContract.js';
import { TEMPLATES_CONTRACTS_VERSION, validateTaskEntry } from '../../templates/common/templatesContract.js';
import type { TaskTemplateEntry, TemplatesRejection } from '../../templates/common/templatesContract.js';
import { BODIES_CONTRACTS_VERSION, validateBodyEntry } from '../../bodies/common/bodiesContract.js';
import type { BodyDefaultsEntry, BodiesRejection } from '../../bodies/common/bodiesContract.js';
import { PACKS_CONTRACTS_VERSION, validatePackEntry } from '../../packs/common/packsContract.js';
import type { PackEntry, PacksRejection } from '../../packs/common/packsContract.js';
import { PROFILES_CONTRACTS_VERSION, validateProfileEntry } from '../../profiles/common/profilesContract.js';
import type { ProfileEntry, ProfilesRejection } from '../../profiles/common/profilesContract.js';
import { BENCHMARKS_CONTRACTS_VERSION, validateBenchmarkEntry } from '../../benchmarks/common/benchmarksContract.js';
import type { BenchmarkEntry, BenchmarksRejection } from '../../benchmarks/common/benchmarksContract.js';
import { PROJECTIONS_CONTRACTS_VERSION } from '../../projections/common/projectionsContract.js';
import {
        ACTIVATION_CONTRACTS_VERSION,
        isJourneyId,
} from '../../activation/common/activationContract.js';
import type { ComposedRecordLinks, VerbatimRejection } from '../../activation/common/activationContract.js';
import {
        LAB_CONTRACTS_VERSION,
        type BaselineComparison,
        type CalibrationRecord,
        type EvalScore,
        type LabEvidenceLevel,
        type LabRecommendation,
        type LabScope,
        type TaskOutcome,
} from '../../../lab/common/labContracts.js';
import type { WorkloadLearningResult } from '../../../lab/common/workloadLearning.js';
import type { OrgSearchResult } from '../../../lab/common/orgSearch.js';
import type { LadderRunResult } from '../../../lab/common/runEngine.js';
import { MIN_FACTORS_OBSERVATIONS, type CalibrationModelResult } from '../../../lab/common/calibration.js';

/**
 * THE IMPORT LAW's re-export block: the TWELVE landed family versions
 * (DH-01..DH-11), the REAL lab contracts version, the real id
 * alphabets (the harness and journey forms), the real record
 * validators and the real calibration floor - imported by reference,
 * re-exported by reference, never re-declared (the
 * no-fork-of-the-core discipline).
 */
export {
        DOMAIN_HARNESS_CONTRACTS_VERSION,
        ONBOARDING_CONTRACTS_VERSION,
        ROLES_CONTRACTS_VERSION,
        ONTOLOGY_CONTRACTS_VERSION,
        TEMPLATES_CONTRACTS_VERSION,
        BODIES_CONTRACTS_VERSION,
        PACKS_CONTRACTS_VERSION,
        PROFILES_CONTRACTS_VERSION,
        BENCHMARKS_CONTRACTS_VERSION,
        PROJECTIONS_CONTRACTS_VERSION,
        ACTIVATION_CONTRACTS_VERSION,
        LAB_CONTRACTS_VERSION,
        MIN_FACTORS_OBSERVATIONS,
        MAX_ROLES,
        isHarnessId,
        isHarnessIndustry,
        isJourneyId,
        validateOnboardingCompanyProfile,
        validateOnboardingIndustryPayload,
        validateOnboardingWorkTypes,
        validateRoleEntry,
        validateTermEntry,
        validateTaskEntry,
        validateBodyEntry,
        validatePackEntry,
        validateProfileEntry,
        validateBenchmarkEntry,
};
export type { ComposedRecordLinks, VerbatimRejection } from '../../activation/common/activationContract.js';

/** THE SINGLE-VERSION LAW: declared ONCE here, re-carried by the kit (the re-export). */
export const OPTIMIZATION_CONTRACTS_VERSION = '1.0.0';

/** The loop id prefix (this family's namespace; the kit mints <prefix><16 lowercase hex> from the injected rng). */
export const LOOP_ID_PREFIX = 'flauz:opt:';

// --- the loop-stage machine (THE FORWARD-ONLY LAW) ---------------------------------------------

/**
 * The closed frozen loop-stage vocabulary: the registry row's eight
 * stages in the exact loop order. beginLoop enters 'observe' (the
 * loop awaits its first observation); every subsequent stage is
 * landed by its own stage op; 'calibrate' is TERMINAL (a closed loop;
 * a new optimization is a NEW loop id - the append-only lineage law).
 */
export const LOOP_STAGES = [
        'observe',
        'simulate',
        'compare',
        'recommend',
        'approve',
        'execute',
        'measure',
        'calibrate',
] as const;
export type LoopStage = (typeof LOOP_STAGES)[number];

/** Pure predicate over the closed stage list. */
export function isLoopStage(value: unknown): value is LoopStage {
        return (LOOP_STAGES as readonly string[]).includes(value as string);
}

/** One whitelisted forward stage transition row (THE FORWARD-ONLY LAW's whitelist). */
export interface LoopStageTransition {
        readonly from: LoopStage;
        readonly to: LoopStage;
}

/**
 * The frozen forward-only whitelist: the ONLY legal loop-stage
 * transitions are the seven forward rows. 'calibrate' is TERMINAL -
 * no reopen. Widening the map is a versioned contract decision.
 */
export const LOOP_FORWARD_TRANSITIONS = [
        { from: 'observe', to: 'simulate' },
        { from: 'simulate', to: 'compare' },
        { from: 'compare', to: 'recommend' },
        { from: 'recommend', to: 'approve' },
        { from: 'approve', to: 'execute' },
        { from: 'execute', to: 'measure' },
        { from: 'measure', to: 'calibrate' },
] as const;

/**
 * The typed stage verdict: ok carries the granting whitelist row
 * (1-based); refusal is the typed ILLEGAL_TRANSITION rejection naming
 * the violated whitelist row, the whitelisted successor and the
 * deterministic detail sentence. The observe leg's own 'observe' ->
 * 'observe' self-edge is legal by the gradual-evidence law (the loop
 * records its observation while sitting in 'observe'); every other
 * edge must be a forward row.
 */
export type LoopStageVerdict =
        | { readonly ok: true; readonly from: LoopStage; readonly to: LoopStage; readonly row: number }
        | {
                        readonly ok: false;
                        readonly reason: 'ILLEGAL_TRANSITION';
                        readonly from: unknown;
                        readonly to: unknown;
                        readonly whitelistRow: number | null;
                        readonly expectedTo: LoopStage | null;
                        readonly detail: string;
                };

/**
 * THE FORWARD-ONLY LAW's verdict machine (pure): the exact whitelist
 * membership check. The only legal transitions are the seven forward
 * rows (plus the documented observe self-edge, which callers check
 * separately before consulting this machine); every other edge
 * (skips, backwards moves, self-loops past observe, calibrate ->
 * anything, unknown stages, non-strings) is the typed
 * ILLEGAL_TRANSITION rejection naming the violated whitelist row.
 */
export function canTransitionLoopStage(from: unknown, to: unknown): LoopStageVerdict {
        const transitions = LOOP_FORWARD_TRANSITIONS as readonly LoopStageTransition[];
        let rowNumber = 0;
        for (let i = 0; i < transitions.length; i += 1) {
                if (transitions[i].from === from) {
                        rowNumber = i + 1;
                        break;
                }
        }
        if (!isLoopStage(from) || !isLoopStage(to)) {
                return {
                        ok: false,
                        reason: 'ILLEGAL_TRANSITION',
                        from,
                        to,
                        whitelistRow: rowNumber > 0 ? rowNumber : null,
                        expectedTo: rowNumber > 0 ? transitions[rowNumber - 1].to : null,
                        detail: `canTransitionLoopStage: '${showValue(from)}' -> '${showValue(to)}' is refused - both stages must be members of the frozen LOOP_STAGES list (THE FORWARD-ONLY LAW - the loop-stage vocabulary is frozen)`,
                };
        }
        if (rowNumber === 0) {
                return {
                        ok: false,
                        reason: 'ILLEGAL_TRANSITION',
                        from,
                        to,
                        whitelistRow: null,
                        expectedTo: null,
                        detail: `canTransitionLoopStage: '${from}' -> '${to}' is refused - 'calibrate' is TERMINAL for the loop record (no reopen; a new optimization is a NEW loop id; the loop closed at the calibrate leg) (THE FORWARD-ONLY LAW)`,
                };
        }
        const expectedTo = transitions[rowNumber - 1].to;
        if (expectedTo !== to) {
                return {
                        ok: false,
                        reason: 'ILLEGAL_TRANSITION',
                        from,
                        to,
                        whitelistRow: rowNumber,
                        expectedTo,
                        detail: `canTransitionLoopStage: '${from}' -> '${to}' is refused - the only whitelisted forward transition from '${from}' is row ${rowNumber} ('${from}' -> '${expectedTo}') (THE FORWARD-ONLY LAW - forward-only; calibrate is terminal)`,
                };
        }
        return { ok: true, from, to, row: rowNumber };
}

// --- the frozen leg / op tables -------------------------------------------------------------------

/**
 * The closed frozen loop-leg vocabulary: the eight walked legs, one
 * per stage, in the exact loop order. The leg vocabulary IS the stage
 * vocabulary (this family's own - the loop's stages are its legs).
 */
export const LOOP_LEGS = [
        'observe',
        'simulate',
        'compare',
        'recommend',
        'approve',
        'execute',
        'measure',
        'calibrate',
] as const;
export type LoopLeg = (typeof LOOP_LEGS)[number];

/** Pure predicate over the closed leg list. */
export function isLoopLeg(value: unknown): value is LoopLeg {
        return (LOOP_LEGS as readonly string[]).includes(value as string);
}

/** The frozen leg index (the walk order; -1 for a non-member). */
export function loopLegIndex(leg: unknown): number {
        return (LOOP_LEGS as readonly string[]).indexOf(leg as string);
}

/**
 * The frozen op-name vocabulary (the ledger line ops): the nine kit
 * operations. begin-loop walks no leg (the entry into 'observe');
 * every stage op walks exactly its own stage's leg.
 */
export const LOOP_OP_NAMES = [
        'begin-loop',
        'observe-workload',
        'simulate-candidates',
        'compare-outcomes',
        'recommend-improvement',
        'obtain-approval',
        'execute-through-authorities',
        'measure-result',
        'calibrate',
] as const;
export type LoopOpName = (typeof LOOP_OP_NAMES)[number];

/** Pure predicate over the closed op-name list. */
export function isLoopOpName(value: unknown): value is LoopOpName {
        return (LOOP_OP_NAMES as readonly string[]).includes(value as string);
}

/** The frozen op->legs table: the legs each op WALKS (begin-loop walks none). */
export const LOOP_OP_LEGS: Readonly<Record<LoopOpName, readonly LoopLeg[]>> = {
        'begin-loop': [],
        'observe-workload': ['observe'],
        'simulate-candidates': ['simulate'],
        'compare-outcomes': ['compare'],
        'recommend-improvement': ['recommend'],
        'obtain-approval': ['approve'],
        'execute-through-authorities': ['execute'],
        'measure-result': ['measure'],
        calibrate: ['calibrate'],
};

/**
 * The frozen op->required-legs table: the legs that must ALREADY be
 * walked before the op runs (THE FORWARD-ONLY LAW's op-level
 * whitelist; the last required leg is the op's walk FRONTIER - the
 * kit's stage guard reads it). The execute op's required leg is the
 * approve leg - THE APPROVAL LAW's structural floor (the kit's own
 * approval-evidence guard fires the typed approval-missing refusal
 * BEFORE this frontier check, naming the law directly).
 */
export const LOOP_OP_REQUIRED_LEGS: Readonly<Record<LoopOpName, readonly LoopLeg[]>> = {
        'begin-loop': [],
        'observe-workload': [],
        'simulate-candidates': ['observe'],
        'compare-outcomes': ['simulate'],
        'recommend-improvement': ['compare'],
        'obtain-approval': ['recommend'],
        'execute-through-authorities': ['approve'],
        'measure-result': ['execute'],
        calibrate: ['measure'],
};

/**
 * The frozen leg->stage table: the loop stage AFTER each leg lands.
 * The observe leg is the 'observe' self-edge (the loop sits in
 * 'observe' while it records its observation); every subsequent leg
 * enters its own stage.
 */
export const LOOP_LEG_STAGES: Readonly<Record<LoopLeg, LoopStage>> = {
        observe: 'observe',
        simulate: 'simulate',
        compare: 'compare',
        recommend: 'recommend',
        approve: 'approve',
        execute: 'execute',
        measure: 'measure',
        calibrate: 'calibrate',
};

/** Pure predicate: a well-formed loop id (flauz:opt:<16-hex>). */
export function isLoopId(value: unknown): value is string {
        if (typeof value !== 'string') {
                return false;
        }
        if (!value.startsWith(LOOP_ID_PREFIX)) {
                return false;
        }
        const hex = value.slice(LOOP_ID_PREFIX.length);
        return /^[0-9a-f]{16}$/.test(hex);
}

// --- THE EVIDENCE-CEILING LAW (the REAL ladder, imported by census) -------------------------------

/**
 * THE IMPORT LAW's compile-time census for the REAL evidence ladder:
 * LabEvidenceLevel is a TYPE-ONLY export of the real lab contracts
 * module, so its runtime list is DERIVED from a Record keyed by the
 * REAL imported type - the compiler forces every rung to appear
 * exactly once, in the frozen ladder order (a drift in the real union
 * fails tsc in THIS module; the battery pins the derived ladder).
 */
const LOOP_EVIDENCE_LEVEL_CENSUS: Record<LabEvidenceLevel, true> = {
        fixture: true,
        simulated: true,
        'local-real': true,
        'runtime-real': true,
        'live-provider': true,
        'production-real': true,
};

/** The REAL six-rung evidence ladder, derived from the imported type (never transcribed). */
export const LOOP_EVIDENCE_LEVELS: readonly LabEvidenceLevel[] = Object.keys(
        LOOP_EVIDENCE_LEVEL_CENSUS,
) as readonly LabEvidenceLevel[];

/** Pure predicate over the REAL six-rung evidence ladder (the derived import census). */
export function isLoopEvidenceLevel(value: unknown): value is LabEvidenceLevel {
        return (LOOP_EVIDENCE_LEVELS as readonly string[]).includes(value as string);
}

/**
 * THE EVIDENCE-CEILING LAW's allowed subset: the loop's frozen ceiling
 * for a recommendation's evidence level - 'fixture' or 'simulated'
 * ONLY. The four higher rungs are the typed evidence-ceiling refusal
 * (the loop NEVER promotes its evidence; the ceiling claim is the
 * README's CONTENT LAW disclosure).
 */
export const OPTIMIZATION_EVIDENCE_LEVEL_CEILING: readonly LabEvidenceLevel[] = ['fixture', 'simulated'];

/** The loop's evidence-level type: the ceiling subset, TYPED against the REAL imported ladder union. */
export type OptimizationEvidenceLevel = Extract<LabEvidenceLevel, 'fixture' | 'simulated'>;

/** Pure predicate over the loop's evidence ceiling (the allowed subset of the REAL ladder). */
export function isOptimizationEvidenceLevel(value: unknown): value is OptimizationEvidenceLevel {
        return (OPTIMIZATION_EVIDENCE_LEVEL_CEILING as readonly string[]).includes(value as string);
}

/**
 * The ladder rank of a REAL evidence level (its index in the frozen
 * REAL ladder order; -1 when the value is not a real rung). The
 * recommendation walk compares ranks against the loop's ceiling.
 */
export function loopEvidenceLevelRank(value: unknown): number {
        if (typeof value !== 'string') {
                return -1;
        }
        return (LOOP_EVIDENCE_LEVELS as readonly string[]).indexOf(value);
}

// --- THE TYPED HARNESS DELTA (the recommended change) ---------------------------------------------

/** The frozen delta-record family vocabulary: the six composed record families, in the frozen wave order. */
export const DELTA_RECORD_FAMILIES = ['ontology', 'templates', 'bodies', 'packs', 'profiles', 'benchmarks'] as const;
export type DeltaRecordFamily = (typeof DELTA_RECORD_FAMILIES)[number];

/** Pure predicate over the closed family list. */
export function isDeltaRecordFamily(value: unknown): value is DeltaRecordFamily {
        return (DELTA_RECORD_FAMILIES as readonly string[]).includes(value as string);
}

/**
 * One disclosed family-record reference: the family whose record is
 * named plus the record id in the OWNING family's REAL id alphabet
 * (validated by the REAL id predicate, imported by reference - the
 * FORM law; the EXISTENCE binding is the caller's wiring, the same
 * discipline as the composed families' harness bindings).
 */
export interface DeltaRecordRef {
        readonly family: DeltaRecordFamily;
        readonly recordId: string;
}

/** The frozen delta-record-ref schema keys, in the canonical fixed-key-order. */
export const DELTA_RECORD_REF_SCHEMA_KEYS = ['family', 'recordId'] as const;

/**
 * THE REVERSIBILITY LAW's typed rollback path: which family records a
 * rollback REMOVES from the composition and which it RESTORES (the
 * replaced originals) - and the frozen ROUTE: the rollback itself is
 * a RECOMPOSITION through the REAL DH-011 activation journey
 * instrument (never a direct mutation, never a second authority - a
 * record is immutable once composed; the rollback composes a new
 * record around the change).
 */
export interface HarnessRollbackPath {
        readonly route: 'dh011-activation-journey';
        readonly removeRecords: readonly DeltaRecordRef[];
        readonly restoreRecords: readonly DeltaRecordRef[];
}

/** The frozen rollback-path schema keys, in the canonical fixed-key-order. */
export const ROLLBACK_PATH_SCHEMA_KEYS = ['route', 'removeRecords', 'restoreRecords'] as const;

/**
 * THE REVERSIBILITY LAW's typed classification: a reversible delta
 * carries its rollback path; an irreversible delta carries the
 * caller's explicit acknowledgement (without it the recommend
 * boundary refuses - the reversible-first law, the typed
 * irreversible-refused refusal).
 */
export type HarnessReversibility =
        | { readonly reversible: true; readonly rollback: HarnessRollbackPath }
        | { readonly reversible: false; readonly acknowledgedBy: string };

/**
 * THE CONTENT LAW's delta context: the composition frame the execute
 * leg drives the REAL DH-011 journey through - the industry, the
 * company profile and the work types (the REAL DH-02 shapes) and the
 * named roles (the REAL DH-03 shape). Every shape is validated by its
 * OWNING family's REAL validator, imported by reference.
 */
export interface HarnessDeltaContext {
        readonly industry: HarnessIndustry;
        readonly companyProfile: OnboardingCompanyProfile;
        readonly workTypes: readonly HarnessWorkType[];
        readonly roles: readonly HarnessRole[];
}

/** The frozen delta-context schema keys, in the canonical fixed-key-order. */
export const DELTA_CONTEXT_SCHEMA_KEYS = ['industry', 'companyProfile', 'workTypes', 'roles'] as const;

/**
 * THE AUDIT LAW's typed recommended change: what to ADD to which
 * harness family records (the six families' entries, each the OWNING
 * family's REAL interface, imported by reference), what the additions
 * REPLACE (the disclosed superseded records - additive-with-
 * replacement; a replaced record is never mutated, never removed from
 * its own ledger - the append-only lineage law of the composed
 * families), and the deterministic rationale. The delta is
 * ADDITIVE-ONLY by vocabulary: there is no mutation field, and the
 * closed schema refuses any attempt to add one.
 */
export interface HarnessDelta {
        readonly context: HarnessDeltaContext;
        readonly additions: {
                readonly terms: readonly OntologyTerm[];
                readonly tasks: readonly TaskTemplateEntry[];
                readonly bodies: readonly BodyDefaultsEntry[];
                readonly packs: readonly PackEntry[];
                readonly profiles: readonly ProfileEntry[];
                readonly benchmarks: readonly BenchmarkEntry[];
        };
        readonly replaces: readonly DeltaRecordRef[];
        readonly rationale: string;
}

/** The frozen delta schema keys, in the canonical fixed-key-order. */
export const DELTA_SCHEMA_KEYS = ['context', 'additions', 'replaces', 'rationale'] as const;

/** The frozen delta-additions schema keys, in the canonical fixed-key-order (the six families in wave order). */
export const DELTA_ADDITIONS_SCHEMA_KEYS = ['terms', 'tasks', 'bodies', 'packs', 'profiles', 'benchmarks'] as const;

// --- the frozen loop-rejection vocabulary ----------------------------------------------------------

/**
 * Closed frozen list of loop rejection reasons, in the exact walk
 * order (the kit's station order; every fail-closed condition typed
 * and named after the REAL law it enforces):
 *   disposed              - THE DISPOSE LAW: the loop kit was
 *                           disposed; every operation after dispose
 *                           rejects;
 *   unknown-loop          - THE FAIL-CLOSED LAW: no loop with the
 *                           given id (a malformed id fails closed as
 *                           unknown - the DH-01 NOT_FOUND
 *                           discipline);
 *   malformed-record      - THE STRICT-SCHEMA LAW / THE FAIL-CLOSED
 *                           LAW: a caller payload or record field
 *                           carries the wrong structural type, an
 *                           unknown key or a missing key (never a
 *                           silent partial verdict);
 *   version-mismatch      - THE SINGLE-VERSION LAW: a version-bearing
 *                           surface carries another contract version;
 *   premature-stage       - THE FORWARD-ONLY LAW: the op's leg
 *                           precedes its walked prerequisites within
 *                           the frozen leg order;
 *   stale-stage           - THE FORWARD-ONLY LAW: the op's leg is
 *                           behind the walk (already walked; the loop
 *                           record never walks back; 'calibrate' is
 *                           terminal);
 *   learning-opt-out      - THE PRIVACY LAW (LAB-002 governance): the
 *                           caller's controls carry optIn false - the
 *                           REAL learnWorkloadProfile answered null;
 *                           no learning from activity without
 *                           explicit consent, ever;
 *   scenario-unresolvable - THE COHERENCE LAW: no deterministic task
 *                           world couples to the observed dominant
 *                           task family (a closed loop never proves
 *                           itself against a family the user never
 *                           runs - the LAB-011 gate);
 *   search-refused        - THE SIMULATION LAW: the REAL
 *                           searchOrganizations refused the request
 *                           (returned undefined - the real module's
 *                           own fail-closed answer);
 *   ladder-refused        - THE SIMULATION LAW: the REAL runLadder
 *                           refused the request (returned undefined -
 *                           the real module's own fail-closed answer);
 *   record-refused        - THE VERBATIM-CARRY LAW: a delta entry
 *                           fails the OWNING family's REAL validator
 *                           (the family's COMPLETE typed rejection
 *                           table carried verbatim);
 *   evidence-ceiling      - THE EVIDENCE-CEILING LAW: the compare leg's
 *                           best report carries an evidence level
 *                           above the loop's frozen ceiling - the
 *                           recommendation refuses rather than
 *                           promote (never 'local-real' or higher);
 *   irreversible-refused  - THE REVERSIBLE-FIRST LAW: an irreversible
 *                           delta without the caller's explicit
 *                           acknowledgement is refused at the
 *                           recommend boundary;
 *   approval-missing      - THE APPROVAL LAW: an execute attempt
 *                           without the recorded caller approval
 *                           decision (no approval input, no
 *                           execution - ever);
 *   malformed-catalog     - THE FAIL-CLOSED LAW at the authority
 *                           seam: the injected catalog snapshot no
 *                           longer satisfies the REAL
 *                           isHarnessCatalogSnapshot predicate (a
 *                           malformed authority resolves nothing);
 *   unsafe-delta          - THE FAIL-CLOSED LAW at the execute
 *                           boundary: the REAL DH-011 journey refused
 *                           a leg of the delta's walk (a non-composed
 *                           record the delta names, a dangling ref, a
 *                           refused context selection) - the journey's
 *                           real refusal carried verbatim;
 *   journey-refused       - THE VERBATIM-CARRY LAW: the REAL DH-011
 *                           journey instrument refused to construct
 *                           or reopen over its own persisted ledger
 *                           (the real refusal carried verbatim);
 *   measure-refused       - THE HONEST-MEASURE LAW: the REAL DH-09
 *                           evaluation surface refused the
 *                           caller-supplied measures (the real
 *                           refusal carried verbatim);
 *   calibration-refused   - THE LINKAGE LAW: the REAL
 *                           observeBridgeOutcome refused the
 *                           observation (a linkage gate - the real
 *                           module's own fail-closed answer).
 * Widening or reordering the list is a versioned contract decision.
 */
export const OPTIMIZATION_LOOP_REJECTION_REASONS = [
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
] as const;
export type OptimizationLoopRejectionReason = (typeof OPTIMIZATION_LOOP_REJECTION_REASONS)[number];

/** Pure predicate over the closed rejection list. */
export function isOptimizationLoopRejectionReason(value: unknown): value is OptimizationLoopRejectionReason {
        return (OPTIMIZATION_LOOP_REJECTION_REASONS as readonly string[]).includes(value as string);
}

/**
 * The typed loop rejection: the frozen reason, the violated law's
 * name, the deterministic message, the optional offending items and -
 * THE VERBATIM-CARRY LAW - the owning real family's own typed
 * rejection table, carried complete, never paraphrased.
 */
export interface LoopContentRejection {
        readonly reason: OptimizationLoopRejectionReason;
        readonly law: string;
        readonly message: string;
        readonly items?: readonly string[];
        /** THE VERBATIM-CARRY LAW: the owning real family's COMPLETE typed rejection table (never first-only). */
        readonly familyRejections?: readonly VerbatimRejection[];
}

/** The typed content-validation outcome: ok carries the canonical content; refusal carries the typed rejection. */
export type LoopContentOutcome<T> =
        | { readonly ok: true; readonly value: T }
        | { readonly ok: false; readonly rejection: LoopContentRejection };

// --- the delta walk (THE AUDIT / CONTENT / REVERSIBILITY laws at the contract level) ---------------

/**
 * The delta walk (pure): the context stations (each REAL DH-02/DH-03
 * validator, imported by reference - the refusals surface verbatim),
 * the additions stations (each family's entries walked by the OWNING
 * family's REAL validator - the first failing entry surfaces the
 * family's COMPLETE typed rejection table), the replaces and
 * rollback stations (the OWNING family's REAL id predicates - the
 * FORM law) and the rationale station. THE REVERSIBILITY LAW: a
 * reversible classification REQUIRES the rollback path; an
 * irreversible classification REQUIRES the explicit acknowledgement
 * (the reversible-first law). Ok carries the canonical fixed-key-order
 * copy. First-failure-is-the-verdict in the frozen station order.
 */
export function validateHarnessDelta(delta: unknown, reversibility: unknown): LoopContentOutcome<{ readonly delta: HarnessDelta; readonly reversibility: HarnessReversibility }> {
        if (!isRecord(delta)) {
                return rejected('malformed-record', 'THE FAIL-CLOSED LAW', 'validateHarnessDelta: the delta must be a plain object (never a silent partial verdict)', ['delta']);
        }
        const candidate = delta as Record<string, unknown>;
        const unknownKeys = Object.keys(candidate).filter((key) => !(DELTA_SCHEMA_KEYS as readonly string[]).includes(key));
        if (unknownKeys.length > 0) {
                return rejected('malformed-record', 'THE STRICT-SCHEMA LAW', `validateHarnessDelta: the delta schema is closed - the unknown key(s) ${showList(unknownKeys)} are rejected (a delta is additive-only; there is no mutation field and no replacement beyond the disclosed replaces list)`, unknownKeys);
        }
        const missingKeys = (DELTA_SCHEMA_KEYS as readonly string[]).filter((key) => !hasOwn(candidate, key));
        if (missingKeys.length > 0) {
                return rejected('malformed-record', 'THE FAIL-CLOSED LAW', `validateHarnessDelta: the delta schema requires every key - the key(s) ${showList(missingKeys)} are missing`, missingKeys);
        }
        if (typeof candidate.rationale !== 'string' || candidate.rationale.length === 0) {
                return rejected('malformed-record', 'THE AUDIT LAW', 'validateHarnessDelta: the delta rationale must be a non-empty string (the auditable why of the recommended change)', ['rationale']);
        }
        // The context stations: the REAL DH-02/DH-03 validators, imported by reference.
        if (!isRecord(candidate.context)) {
                return rejected('malformed-record', 'THE FAIL-CLOSED LAW', 'validateHarnessDelta: the delta context must be a plain object (the composition frame the execute leg drives the REAL DH-011 journey through)', ['context']);
        }
        const context = candidate.context as Record<string, unknown>;
        const unknownContextKeys = Object.keys(context).filter((key) => !(DELTA_CONTEXT_SCHEMA_KEYS as readonly string[]).includes(key));
        if (unknownContextKeys.length > 0) {
                return rejected('malformed-record', 'THE STRICT-SCHEMA LAW', `validateHarnessDelta: the delta-context schema is closed - the unknown key(s) ${showList(unknownContextKeys)} are rejected`, unknownContextKeys);
        }
        const missingContextKeys = (DELTA_CONTEXT_SCHEMA_KEYS as readonly string[]).filter((key) => !hasOwn(context, key));
        if (missingContextKeys.length > 0) {
                return rejected('malformed-record', 'THE FAIL-CLOSED LAW', `validateHarnessDelta: the delta-context schema requires every key - the key(s) ${showList(missingContextKeys)} are missing`, missingContextKeys);
        }
        const industryVerdict = validateOnboardingIndustryPayload({ industry: context.industry });
        if (!industryVerdict.ok) {
                return rejected('malformed-record', 'THE IMPORT LAW', 'validateHarnessDelta: the delta-context industry fails the REAL DH-02 walk (surfaced verbatim)', ['context.industry'], [industryVerdict.refusal as unknown as VerbatimRejection]);
        }
        const companyVerdict = validateOnboardingCompanyProfile(context.companyProfile);
        if (!companyVerdict.ok) {
                return rejected('malformed-record', 'THE IMPORT LAW', 'validateHarnessDelta: the delta-context company profile fails the REAL DH-02 walk (surfaced verbatim)', ['context.companyProfile'], [companyVerdict.refusal as unknown as VerbatimRejection]);
        }
        const workTypesVerdict = validateOnboardingWorkTypes(context.workTypes);
        if (!workTypesVerdict.ok) {
                return rejected('malformed-record', 'THE IMPORT LAW', 'validateHarnessDelta: the delta-context work-type selection fails the REAL DH-02 walk (surfaced verbatim)', ['context.workTypes'], [workTypesVerdict.refusal as unknown as VerbatimRejection]);
        }
        if (!Array.isArray(context.roles)) {
                return rejected('malformed-record', 'THE FAIL-CLOSED LAW', 'validateHarnessDelta: the delta-context roles must be an array (the REAL DH-03 named roles)', ['context.roles']);
        }
        if (context.roles.length === 0) {
                return rejected('malformed-record', 'THE MULTI-ROLE LAW', 'validateHarnessDelta: the delta context carries at least one named role (the REAL DH-03 floor)', ['context.roles']);
        }
        if (context.roles.length > MAX_ROLES) {
                return rejected('malformed-record', 'THE MULTI-ROLE LAW', `validateHarnessDelta: the delta context carries at most MAX_ROLES (${MAX_ROLES}) roles (the REAL DH-03 composition bound, imported by reference)`, [String(context.roles.length)]);
        }
        for (let i = 0; i < context.roles.length; i += 1) {
                const roleVerdict = validateRoleEntry(context.roles[i]);
                if (!roleVerdict.ok) {
                        return rejected('record-refused', `THE VERBATIM-CARRY LAW (context.roles[${i}])`, `validateHarnessDelta: the role entry ${i} fails the OWNING family's REAL validator - the family's COMPLETE typed rejection table is carried verbatim (this walk never re-implements an entry law)`, [`context.roles[${i}]`], [...roleVerdict.rejections]);
                }
        }
        // The additions stations: the OWNING family's REAL validator, imported by reference.
        if (!isRecord(candidate.additions)) {
                return rejected('malformed-record', 'THE FAIL-CLOSED LAW', 'validateHarnessDelta: the delta additions must be a plain object (the six family entries)', ['additions']);
        }
        const additions = candidate.additions as Record<string, unknown>;
        const unknownAdditionKeys = Object.keys(additions).filter((key) => !(DELTA_ADDITIONS_SCHEMA_KEYS as readonly string[]).includes(key));
        if (unknownAdditionKeys.length > 0) {
                return rejected('malformed-record', 'THE STRICT-SCHEMA LAW', `validateHarnessDelta: the delta-additions schema is closed - the unknown key(s) ${showList(unknownAdditionKeys)} are rejected (the additions alphabet is the six owning families' entries, never more)`, unknownAdditionKeys);
        }
        const missingAdditionKeys = (DELTA_ADDITIONS_SCHEMA_KEYS as readonly string[]).filter((key) => !hasOwn(additions, key));
        if (missingAdditionKeys.length > 0) {
                return rejected('malformed-record', 'THE FAIL-CLOSED LAW', `validateHarnessDelta: the delta-additions schema requires every family key - the key(s) ${showList(missingAdditionKeys)} are missing (a family with no addition is an EMPTY array, never an absent key)`, missingAdditionKeys);
        }
        for (const key of DELTA_ADDITIONS_SCHEMA_KEYS) {
                if (!Array.isArray(additions[key])) {
                        return rejected('malformed-record', 'THE FAIL-CLOSED LAW', `validateHarnessDelta: a delta-additions family carries the wrong structural type - the carrier '${key}' must be an array (never a silent partial verdict)`, [key]);
                }
        }
        const termOutcome = walkDeltaEntries(additions.terms as unknown[], 'terms', validateTermEntry);
        if (termOutcome !== null) {
                return termOutcome;
        }
        const taskOutcome = walkDeltaEntries(additions.tasks as unknown[], 'tasks', validateTaskEntry);
        if (taskOutcome !== null) {
                return taskOutcome;
        }
        const bodyOutcome = walkDeltaEntries(additions.bodies as unknown[], 'bodies', validateBodyEntry);
        if (bodyOutcome !== null) {
                return bodyOutcome;
        }
        const packOutcome = walkDeltaEntries(additions.packs as unknown[], 'packs', validatePackEntry);
        if (packOutcome !== null) {
                return packOutcome;
        }
        const profileOutcome = walkDeltaEntries(additions.profiles as unknown[], 'profiles', validateProfileEntry);
        if (profileOutcome !== null) {
                return profileOutcome;
        }
        const benchmarkOutcome = walkDeltaEntries(additions.benchmarks as unknown[], 'benchmarks', validateBenchmarkEntry);
        if (benchmarkOutcome !== null) {
                return benchmarkOutcome;
        }
        // The replaces station: the disclosed superseded records (the FORM law).
        if (!Array.isArray(candidate.replaces)) {
                return rejected('malformed-record', 'THE FAIL-CLOSED LAW', 'validateHarnessDelta: the delta replaces must be an array (the disclosed superseded records - additive-with-replacement, never a mutation)', ['replaces']);
        }
        const replacesWalked = walkDeltaRecordRefs(candidate.replaces, 'replaces');
        if (replacesWalked.rejection !== null) {
                return { ok: false, rejection: replacesWalked.rejection };
        }
        // THE REVERSIBILITY LAW stations: the typed classification.
        if (!isRecord(reversibility)) {
                return rejected('malformed-record', 'THE REVERSIBILITY LAW', 'validateHarnessDelta: the reversibility classification must be a plain object ({ reversible: true, rollback } | { reversible: false, acknowledgedBy })', ['reversibility']);
        }
        const reversibilityRecord = reversibility as Record<string, unknown>;
        if (typeof reversibilityRecord.reversible !== 'boolean') {
                return rejected('malformed-record', 'THE REVERSIBILITY LAW', 'validateHarnessDelta: the reversibility classification requires the boolean reversible field', ['reversible']);
        }
        if (reversibilityRecord.reversible) {
                const unknownKeysReversibility = Object.keys(reversibilityRecord).filter((key) => key !== 'reversible' && key !== 'rollback');
                if (unknownKeysReversibility.length > 0) {
                        return rejected('malformed-record', 'THE STRICT-SCHEMA LAW', `validateHarnessDelta: the reversible classification schema is closed - the unknown key(s) ${showList(unknownKeysReversibility)} are rejected (the shape is { reversible: true, rollback })`, unknownKeysReversibility);
                }
                if (!isRecord(reversibilityRecord.rollback)) {
                        return rejected('malformed-record', 'THE REVERSIBILITY LAW', 'validateHarnessDelta: a reversible delta REQUIRES its typed rollback path (which family records to remove/restore - a rollback that itself routes through the authorities)', ['rollback']);
                }
                const rollback = reversibilityRecord.rollback as Record<string, unknown>;
                const unknownRollbackKeys = Object.keys(rollback).filter((key) => !(ROLLBACK_PATH_SCHEMA_KEYS as readonly string[]).includes(key));
                if (unknownRollbackKeys.length > 0) {
                        return rejected('malformed-record', 'THE STRICT-SCHEMA LAW', `validateHarnessDelta: the rollback-path schema is closed - the unknown key(s) ${showList(unknownRollbackKeys)} are rejected`, unknownRollbackKeys);
                }
                const missingRollbackKeys = (ROLLBACK_PATH_SCHEMA_KEYS as readonly string[]).filter((key) => !hasOwn(rollback, key));
                if (missingRollbackKeys.length > 0) {
                        return rejected('malformed-record', 'THE REVERSIBILITY LAW', `validateHarnessDelta: the rollback path requires every key - the key(s) ${showList(missingRollbackKeys)} are missing`, missingRollbackKeys);
                }
                if (rollback.route !== 'dh011-activation-journey') {
                        return rejected('malformed-record', 'THE REVERSIBILITY LAW', `validateHarnessDelta: the rollback route is frozen - '${showValue(rollback.route)}' is refused (the only route is 'dh011-activation-journey': the rollback itself is a recomposition through the REAL DH-011 journey instrument, never a direct mutation)`, ['rollback.route']);
                }
                if (!Array.isArray(rollback.removeRecords) || !Array.isArray(rollback.restoreRecords)) {
                        return rejected('malformed-record', 'THE REVERSIBILITY LAW', 'validateHarnessDelta: the rollback path removeRecords and restoreRecords must be arrays of family-record refs', ['rollback.removeRecords', 'rollback.restoreRecords']);
                }
                const removeWalked = walkDeltaRecordRefs(rollback.removeRecords, 'rollback.removeRecords');
                if (removeWalked.rejection !== null) {
                        return { ok: false, rejection: removeWalked.rejection };
                }
                const restoreWalked = walkDeltaRecordRefs(rollback.restoreRecords, 'rollback.restoreRecords');
                if (restoreWalked.rejection !== null) {
                        return { ok: false, rejection: restoreWalked.rejection };
                }
        } else {
                const unknownKeysReversibility = Object.keys(reversibilityRecord).filter((key) => key !== 'reversible' && key !== 'acknowledgedBy');
                if (unknownKeysReversibility.length > 0) {
                        return rejected('malformed-record', 'THE STRICT-SCHEMA LAW', `validateHarnessDelta: the irreversible classification schema is closed - the unknown key(s) ${showList(unknownKeysReversibility)} are rejected (the shape is { reversible: false, acknowledgedBy })`, unknownKeysReversibility);
                }
                if (typeof reversibilityRecord.acknowledgedBy !== 'string' || reversibilityRecord.acknowledgedBy.length === 0) {
                        return rejected('irreversible-refused', 'THE REVERSIBLE-FIRST LAW', 'validateHarnessDelta: an IRREVERSIBLE delta is refused at the recommend boundary unless the caller explicitly acknowledges irreversibility - the acknowledgedBy field must be the non-empty acknowledgement (a reversible delta with its rollback path is the default path)');
                }
        }
        return {
                ok: true,
                value: {
                        delta: {
                                context: {
                                        industry: (context.industry as HarnessIndustry),
                                        companyProfile: companyVerdict.value,
                                        workTypes: [...workTypesVerdict.value],
                                        roles: [...(context.roles as HarnessRole[])],
                                },
                                additions: {
                                        terms: [...(additions.terms as OntologyTerm[])],
                                        tasks: [...(additions.tasks as TaskTemplateEntry[])],
                                        bodies: [...(additions.bodies as BodyDefaultsEntry[])],
                                        packs: [...(additions.packs as PackEntry[])],
                                        profiles: [...(additions.profiles as ProfileEntry[])],
                                        benchmarks: [...(additions.benchmarks as BenchmarkEntry[])],
                                },
                                replaces: replacesWalked.refs,
                                rationale: candidate.rationale,
                        },
                        reversibility: reversibilityRecord.reversible
                                ? { reversible: true, rollback: { route: 'dh011-activation-journey', removeRecords: removeRefsOf(reversibilityRecord.rollback as Record<string, unknown>), restoreRecords: restoreRefsOf(reversibilityRecord.rollback as Record<string, unknown>) } }
                                : { reversible: false, acknowledgedBy: reversibilityRecord.acknowledgedBy as string },
                },
        };
}

/** The per-family entry walk (the imported validator; the first failure surfaces the family's COMPLETE table verbatim). */
function walkDeltaEntries<E>(
        entries: readonly unknown[],
        family: string,
        validator: (entry: unknown) => { readonly ok: boolean; readonly value?: E; readonly rejections?: readonly RecordFamilyRejection[] },
): LoopContentOutcome<{ readonly delta: HarnessDelta; readonly reversibility: HarnessReversibility }> | null {
        for (let i = 0; i < entries.length; i += 1) {
                const verdict = validator(entries[i]);
                if (!verdict.ok) {
                        return rejected(
                                'record-refused',
                                `THE VERBATIM-CARRY LAW (additions.${family}[${i}])`,
                                `validateHarnessDelta: the ${family} entry ${i} fails the OWNING family's REAL validator - the family's COMPLETE typed rejection table is carried verbatim (this walk never re-implements an entry law)`,
                                [`additions.${family}[${i}]`],
                                verdict.rejections,
                        );
                }
        }
        return null;
}

/** The union of the six record families' own typed rejections (THE VERBATIM-CARRY LAW's carrier). */
type RecordFamilyRejection =
        | OntologyRejection
        | TemplatesRejection
        | BodiesRejection
        | PacksRejection
        | ProfilesRejection
        | BenchmarksRejection;

/** The frozen family->REAL-id-predicate table (imported by reference - the FORM law). */
const FAMILY_ID_GUARDS: Readonly<Record<DeltaRecordFamily, (value: unknown) => boolean>> = {
        ontology: (value) => isOntologyIdRef(value),
        templates: (value) => isTemplateIdRef(value),
        bodies: (value) => isBodyIdRef(value),
        packs: (value) => isPackIdRef(value),
        profiles: (value) => isProfilesIdRef(value),
        benchmarks: (value) => isBenchmarkIdRef(value),
};

// THE IMPORT LAW's predicate block: the six owning families' REAL id
// predicates, imported by reference (the DELTA_RECORD_REF walk's guards).
import { isOntologyId } from '../../ontology/common/ontologyContract.js';
import { isTemplateId } from '../../templates/common/templatesContract.js';
import { isBodyId } from '../../bodies/common/bodiesContract.js';
import { isPackId } from '../../packs/common/packsContract.js';
import { isProfilesId } from '../../profiles/common/profilesContract.js';
import { isBenchmarkId } from '../../benchmarks/common/benchmarksContract.js';

function isOntologyIdRef(value: unknown): boolean { return isOntologyId(value); }
function isTemplateIdRef(value: unknown): boolean { return isTemplateId(value); }
function isBodyIdRef(value: unknown): boolean { return isBodyId(value); }
function isPackIdRef(value: unknown): boolean { return isPackId(value); }
function isProfilesIdRef(value: unknown): boolean { return isProfilesId(value); }
function isBenchmarkIdRef(value: unknown): boolean { return isBenchmarkId(value); }

/** The family-record-ref list walk: the FORM law through the REAL id predicates. */
function walkDeltaRecordRefs(refs: readonly unknown[], station: string): { refs: readonly DeltaRecordRef[]; rejection: LoopContentRejection | null } {
        const walked: DeltaRecordRef[] = [];
        for (let i = 0; i < refs.length; i += 1) {
                const ref = refs[i];
                if (!isRecord(ref)) {
                        return { refs: [], rejection: rejected('malformed-record', 'THE FAIL-CLOSED LAW', `validateHarnessDelta: ${station}[${i}] must be a plain object ({ family, recordId })`, [`${station}[${i}]`]).rejection };
                }
                const refRecord = ref as Record<string, unknown>;
                const unknownKeys = Object.keys(refRecord).filter((key) => !(DELTA_RECORD_REF_SCHEMA_KEYS as readonly string[]).includes(key));
                if (unknownKeys.length > 0) {
                        return { refs: [], rejection: rejected('malformed-record', 'THE STRICT-SCHEMA LAW', `validateHarnessDelta: ${station}[${i}] carries the unknown key(s) ${showList(unknownKeys)} - the ref schema is closed ({ family, recordId })`, unknownKeys).rejection };
                }
                if (!isDeltaRecordFamily(refRecord.family)) {
                        return { refs: [], rejection: rejected('malformed-record', 'THE FROZEN-VOCABULARY LAW', `validateHarnessDelta: ${station}[${i}] carries the family '${showValue(refRecord.family)}' - the delta-record family vocabulary is the six composed families (imported by reference)`, [`${station}[${i}].family`]).rejection };
                }
                const family = refRecord.family as DeltaRecordFamily;
                if (typeof refRecord.recordId !== 'string' || !FAMILY_ID_GUARDS[family](refRecord.recordId)) {
                        return { refs: [], rejection: rejected('malformed-record', 'THE IMPORT LAW', `validateHarnessDelta: ${station}[${i}].recordId must satisfy the OWNING family's REAL id predicate, imported by reference (${showValue(refRecord.recordId)})`, [`${station}[${i}].recordId`]).rejection };
                }
                walked.push({ family, recordId: refRecord.recordId });
        }
        return { refs: walked, rejection: null };
}

function removeRefsOf(rollback: Record<string, unknown>): readonly DeltaRecordRef[] {
        return (rollback.removeRecords as DeltaRecordRef[]);
}

function restoreRefsOf(rollback: Record<string, unknown>): readonly DeltaRecordRef[] {
        return (rollback.restoreRecords as DeltaRecordRef[]);
}

// --- THE UNCERTAINTY / MISSING-CAPABILITY / EXECUTION / MEASURE / CALIBRATION evidence shapes -------

/**
 * THE UNCERTAINTY LAW's calibration state: the prior calibration's
 * honest counts - the REAL MIN_FACTORS_OBSERVATIONS floor, imported
 * by reference; below the minimum the uncertainty SAYS SO (the
 * belowMinimum flag and the deterministic statement - never a
 * fabricated confidence). A first loop carries model null (no prior
 * calibration exists).
 */
export interface LoopCalibrationState {
        readonly observationCount: number;
        readonly minObservations: number;
        readonly belowMinimum: boolean;
        readonly model: CalibrationModelResult | null;
}

/** The frozen calibration-state schema keys, in the canonical fixed-key-order. */
export const CALIBRATION_STATE_SCHEMA_KEYS = ['observationCount', 'minObservations', 'belowMinimum', 'model'] as const;

/**
 * THE UNCERTAINTY LAW's typed disclosure: the evidence level (a REAL
 * LabEvidenceLevel member, within THE EVIDENCE-CEILING LAW's frozen
 * ceiling - never above 'simulated'), the observation counts (the
 * workload's retained records, the simulated candidates, the ladder
 * seeds), the calibration state and the deterministic honesty
 * statement.
 */
export interface HarnessUncertaintyDisclosure {
        readonly evidenceLevel: LabEvidenceLevel;
        readonly workloadObservationCount: number;
        readonly simulationCandidateCount: number;
        readonly ladderSeedCount: number;
        readonly calibration: LoopCalibrationState;
        readonly statement: string;
}

/** The frozen uncertainty schema keys, in the canonical fixed-key-order. */
export const UNCERTAINTY_SCHEMA_KEYS = [
        'evidenceLevel',
        'workloadObservationCount',
        'simulationCandidateCount',
        'ladderSeedCount',
        'calibration',
        'statement',
] as const;

/**
 * THE MISSING-CAPABILITY LAW's ledger entry: one required capability
 * the recommended organization does NOT cover - the REAL
 * capabilityCoverage row's honest fields (the required level, the
 * organization best score) plus the task type whose requirement is
 * uncovered. A zero-entry ledger is the green path; a gap is
 * reported, never silently dropped.
 */
export interface MissingCapabilityLedgerEntry {
        readonly capabilityId: string;
        readonly requiredLevel: number;
        readonly bestScore: number;
        readonly taskTypeId: string;
}

/** The frozen missing-capability ledger entry schema keys, in the canonical fixed-key-order. */
export const MISSING_CAPABILITY_SCHEMA_KEYS = ['capabilityId', 'requiredLevel', 'bestScore', 'taskTypeId'] as const;

/**
 * THE AUDIT LAW's execution evidence: the REAL DH-011 journey the
 * approved delta flowed through (the journey id in the REAL
 * flauz:jrn:<16-hex> alphabet), the journey's stage after the
 * execution leg ('composed' - the record-composition leg is where the
 * delta's new composition lands; the proposal, approval and
 * activation of that composition remain the USER's journey through
 * the REAL DH-01 authority - THE NO-SECOND-ENGINE LAW), the composed
 * record links (the six REAL family ids) and the binding harness
 * draft (the lineage root the journey minted through the REAL DH-02
 * composeDraft).
 */
export interface LoopExecutionEvidence {
        readonly journeyId: string;
        readonly journeyStage: 'composed';
        readonly recordLinks: ComposedRecordLinks;
        readonly bindingHarnessId: string;
}

/** The frozen execution-evidence schema keys, in the canonical fixed-key-order. */
export const EXECUTION_EVIDENCE_SCHEMA_KEYS = ['journeyId', 'journeyStage', 'recordLinks', 'bindingHarnessId'] as const;

/**
 * THE MEASURE-CALIBRATE LAWS' measure evidence: the caller-supplied
 * measures routed through the REAL DH-09 evaluation surface (the
 * REAL BenchmarkEvaluationResult shape, carried verbatim) plus the
 * caller-supplied REAL TaskOutcome (the observed outcome of the
 * executed change - the calibrate leg's input; the loop NEVER
 * invents scores).
 */
export interface LoopMeasureEvidence {
        readonly benchmarkKey: string;
        readonly evaluation: {
                readonly benchmarksId: string;
                readonly harnessId: string;
                readonly benchmarkKey: string;
                readonly scores: readonly EvalScore[];
                readonly evidenceLevel: LabEvidenceLevel;
        };
        readonly outcome: TaskOutcome;
        readonly measuredAt: string;
}

/** The frozen measure-evidence schema keys, in the canonical fixed-key-order. */
export const MEASURE_EVIDENCE_SCHEMA_KEYS = ['benchmarkKey', 'evaluation', 'outcome', 'measuredAt'] as const;

/**
 * THE MEASURE-CALIBRATE LAWS' calibration evidence: what the REAL
 * calibration surfaces answered - the minted CalibrationRecord rows
 * (verbatim), the folded CalibrationModelResult (verbatim) and the
 * corrected prediction scores (the REAL correctScores output,
 * verbatim).
 */
export interface LoopCalibrationEvidence {
        readonly records: readonly CalibrationRecord[];
        readonly model: CalibrationModelResult;
        readonly correctedScores: readonly EvalScore[];
        readonly calibratedAt: string;
}

/** The frozen calibration-evidence schema keys, in the canonical fixed-key-order. */
export const CALIBRATION_EVIDENCE_SCHEMA_KEYS = ['records', 'model', 'correctedScores', 'calibratedAt'] as const;

// --- THE TYPED RECOMMENDATION (the auditable record) ------------------------------------------------

/**
 * THE AUDIT LAW's typed recommendation: the FULL evidence trail - the
 * observed workload profile (the REAL WorkloadLearningResult carried
 * verbatim), the simulated candidates (the REAL OrgSearchResult
 * verbatim), the comparison (the REAL LadderRunResult verbatim), the
 * winning evaluation's id and expected gains (the REAL
 * BaselineComparison rows verbatim), the REAL LabRecommendation
 * minted for the calibration linkage (the real shape, LAB-008's
 * observeBridgeOutcome input), the recommended change (the typed
 * HarnessDelta), the reversibility classification (THE REVERSIBILITY
 * LAW), the uncertainty disclosure (THE UNCERTAINTY LAW) and the
 * missing-capability ledger (THE MISSING-CAPABILITY LAW).
 */
export interface HarnessOptimizationRecommendation {
        readonly recommendationId: string;
        readonly contractVersion: string;
        readonly loopId: string;
        readonly scope: LabScope;
        readonly runId: string;
        readonly workload: WorkloadLearningResult;
        readonly simulation: OrgSearchResult;
        readonly comparison: LadderRunResult;
        readonly bestReportId: string;
        readonly expectedGains: readonly BaselineComparison[];
        readonly labRecommendation: LabRecommendation;
        readonly delta: HarnessDelta;
        readonly reversibility: HarnessReversibility;
        readonly uncertainty: HarnessUncertaintyDisclosure;
        readonly missingCapabilities: readonly MissingCapabilityLedgerEntry[];
        readonly createdAtIso: string;
}

/** The frozen recommendation schema keys, in the canonical fixed-key-order (the serialization order). */
export const RECOMMENDATION_SCHEMA_KEYS = [
        'recommendationId',
        'contractVersion',
        'loopId',
        'scope',
        'runId',
        'workload',
        'simulation',
        'comparison',
        'bestReportId',
        'expectedGains',
        'labRecommendation',
        'delta',
        'reversibility',
        'uncertainty',
        'missingCapabilities',
        'createdAtIso',
] as const;

/** The typed recommendation-validation outcome: ok carries the canonical record; refusal carries the typed rejection. */
export type RecommendationOutcome =
        | { readonly ok: true; readonly recommendation: HarnessOptimizationRecommendation }
        | { readonly ok: false; readonly rejection: LoopContentRejection };

/**
 * The recommendation walk (pure): the structural stations, the
 * version pin, the id forms, the verbatim-evidence stations (the
 * workload / simulation / comparison shapes walked structurally, the
 * REAL version pins checked), the winning-report linkage (the
 * bestReportId is a report of the CARRIED comparison), the expected
 * gains (the REAL BaselineComparison rows), the REAL
 * LabRecommendation (the real shape's required fields), the delta
 * walk (the contract's own station tour), the reversibility
 * classification, THE UNCERTAINTY LAW (the evidence level within the
 * frozen ceiling - the promotion refusal; the calibration state's
 * belowMinimum honesty) and THE MISSING-CAPABILITY LAW (the ledger
 * entries' shapes; a zero-entry ledger is the green path). Ok carries
 * the canonical fixed-key-order copy. First-failure-is-the-verdict.
 */
export function validateHarnessOptimizationRecommendation(recommendation: unknown): RecommendationOutcome {
        if (!isRecord(recommendation)) {
                return rejectedRecommendation('malformed-record', 'THE FAIL-CLOSED LAW', 'validateHarnessOptimizationRecommendation: the recommendation must be a plain object (never a silent partial verdict)', ['recommendation']);
        }
        const candidate = recommendation as Record<string, unknown>;
        const unknownKeys = Object.keys(candidate).filter((key) => !(RECOMMENDATION_SCHEMA_KEYS as readonly string[]).includes(key));
        if (unknownKeys.length > 0) {
                return rejectedRecommendation('malformed-record', 'THE STRICT-SCHEMA LAW', `validateHarnessOptimizationRecommendation: the recommendation schema is closed - the unknown key(s) ${showList(unknownKeys)} are rejected`, unknownKeys);
        }
        const missingKeys = (RECOMMENDATION_SCHEMA_KEYS as readonly string[]).filter((key) => !hasOwn(candidate, key));
        if (missingKeys.length > 0) {
                return rejectedRecommendation('malformed-record', 'THE FAIL-CLOSED LAW', `validateHarnessOptimizationRecommendation: the recommendation schema requires every key - the key(s) ${showList(missingKeys)} are missing`, missingKeys);
        }
        if (typeof candidate.recommendationId !== 'string' || candidate.recommendationId.length === 0) {
                return rejectedRecommendation('malformed-record', 'THE AUDIT LAW', 'validateHarnessOptimizationRecommendation: the recommendation id must be a non-empty string (this family mint)', ['recommendationId']);
        }
        if (candidate.contractVersion !== OPTIMIZATION_CONTRACTS_VERSION) {
                return rejectedRecommendation('version-mismatch', 'THE SINGLE-VERSION LAW', `validateHarnessOptimizationRecommendation: the recommendation carries contract version '${showValue(candidate.contractVersion)}' - only '${OPTIMIZATION_CONTRACTS_VERSION}' is known`, [showValue(candidate.contractVersion)]);
        }
        if (!isLoopId(candidate.loopId)) {
                return rejectedRecommendation('malformed-record', 'THE FAIL-CLOSED LAW', 'validateHarnessOptimizationRecommendation: the loop link must satisfy the frozen flauz:opt:<16-hex> form', ['loopId']);
        }
        if (!isLabScope(candidate.scope)) {
                return rejectedRecommendation('malformed-record', 'THE FAIL-CLOSED LAW', 'validateHarnessOptimizationRecommendation: the scope must be the REAL LabScope shape { workspaceId, tenantId }', ['scope']);
        }
        if (typeof candidate.runId !== 'string' || candidate.runId.length === 0) {
                return rejectedRecommendation('malformed-record', 'THE LINKAGE LAW', 'validateHarnessOptimizationRecommendation: the run link must be a non-empty string (the compare-leg run id - the REAL calibration linkage key)', ['runId']);
        }
        const workloadError = validateWorkloadEvidence(candidate.workload, 'workload');
        if (workloadError !== null) {
                return rejectedRecommendation('malformed-record', 'THE AUDIT LAW', `validateHarnessOptimizationRecommendation: ${workloadError}`, ['workload']);
        }
        const simulationError = validateSearchEvidence(candidate.simulation, 'simulation');
        if (simulationError !== null) {
                return rejectedRecommendation('malformed-record', 'THE AUDIT LAW', `validateHarnessOptimizationRecommendation: ${simulationError}`, ['simulation']);
        }
        const comparisonError = validateLadderEvidence(candidate.comparison, 'comparison');
        if (comparisonError !== null) {
                return rejectedRecommendation('malformed-record', 'THE AUDIT LAW', `validateHarnessOptimizationRecommendation: ${comparisonError}`, ['comparison']);
        }
        const comparison = candidate.comparison as LadderRunResult;
        if (typeof candidate.bestReportId !== 'string' || !comparison.reports.some((report) => report.id === candidate.bestReportId)) {
                return rejectedRecommendation('malformed-record', 'THE LINKAGE LAW', 'validateHarnessOptimizationRecommendation: the best report id must name one of the CARRIED comparison reports (the winning evaluation)', ['bestReportId']);
        }
        const bestReport = comparison.reports.find((report) => report.id === candidate.bestReportId) as LadderRunResult['reports'][number];
        if (bestReport.runId !== candidate.runId) {
                return rejectedRecommendation('malformed-record', 'THE LINKAGE LAW', `validateHarnessOptimizationRecommendation: the winning report's run id '${bestReport.runId}' disagrees with the recommendation's run link '${candidate.runId}' (the calibration linkage law)`, ['bestReportId']);
        }
        if (!Array.isArray(candidate.expectedGains) || candidate.expectedGains.length === 0) {
                return rejectedRecommendation('malformed-record', 'THE AUDIT LAW', 'validateHarnessOptimizationRecommendation: the expected gains must be a non-empty array of the REAL BaselineComparison rows (carried verbatim from the winning report)', ['expectedGains']);
        }
        for (let i = 0; i < candidate.expectedGains.length; i += 1) {
                const row = candidate.expectedGains[i];
                if (!isRecord(row) || typeof row.dimension !== 'string' || typeof row.candidateValue !== 'number' || typeof row.baselineValue !== 'number' || typeof row.delta !== 'number') {
                        return rejectedRecommendation('malformed-record', 'THE AUDIT LAW', `validateHarnessOptimizationRecommendation: the expected-gains row ${i} must be the REAL BaselineComparison shape { dimension, candidateValue, baselineValue, delta }`, [`expectedGains[${i}]`]);
                }
        }
        const labRecommendationError = walkLabRecommendation(candidate.labRecommendation, candidate.scope, candidate.runId);
        if (labRecommendationError !== null) {
                return rejectedRecommendation('malformed-record', 'THE LINKAGE LAW', `validateHarnessOptimizationRecommendation: ${labRecommendationError}`, ['labRecommendation']);
        }
        const deltaOutcome = validateHarnessDelta(candidate.delta, candidate.reversibility);
        if (!deltaOutcome.ok) {
                return { ok: false, rejection: deltaOutcome.rejection };
        }
        // THE UNCERTAINTY LAW stations.
        if (!isRecord(candidate.uncertainty)) {
                return rejectedRecommendation('malformed-record', 'THE UNCERTAINTY LAW', 'validateHarnessOptimizationRecommendation: the uncertainty disclosure must be a plain object (the typed honesty field)', ['uncertainty']);
        }
        const uncertainty = candidate.uncertainty as Record<string, unknown>;
        const unknownUncertaintyKeys = Object.keys(uncertainty).filter((key) => !(UNCERTAINTY_SCHEMA_KEYS as readonly string[]).includes(key));
        if (unknownUncertaintyKeys.length > 0) {
                return rejectedRecommendation('malformed-record', 'THE STRICT-SCHEMA LAW', `validateHarnessOptimizationRecommendation: the uncertainty schema is closed - the unknown key(s) ${showList(unknownUncertaintyKeys)} are rejected`, unknownUncertaintyKeys);
        }
        const missingUncertaintyKeys = (UNCERTAINTY_SCHEMA_KEYS as readonly string[]).filter((key) => !hasOwn(uncertainty, key));
        if (missingUncertaintyKeys.length > 0) {
                return rejectedRecommendation('malformed-record', 'THE UNCERTAINTY LAW', `validateHarnessOptimizationRecommendation: the uncertainty schema requires every key - the key(s) ${showList(missingUncertaintyKeys)} are missing`, missingUncertaintyKeys);
        }
        if (!isLoopEvidenceLevel(uncertainty.evidenceLevel)) {
                return rejectedRecommendation('malformed-record', 'THE UNCERTAINTY LAW', 'validateHarnessOptimizationRecommendation: the uncertainty evidence level must be a REAL LabEvidenceLevel member (imported by reference)', ['uncertainty.evidenceLevel']);
        }
        if (loopEvidenceLevelRank(uncertainty.evidenceLevel) > loopEvidenceLevelRank('simulated')) {
                return rejectedRecommendation('evidence-ceiling', 'THE EVIDENCE-CEILING LAW', `validateHarnessOptimizationRecommendation: the uncertainty evidence level '${uncertainty.evidenceLevel}' is ABOVE the loop's frozen ceiling 'simulated' - the loop NEVER promotes its evidence (the honest claim is 'fixture' or 'simulated', exactly what the real modules answered)`, [uncertainty.evidenceLevel as string]);
        }
        if (bestReport.evidenceLevel !== uncertainty.evidenceLevel) {
                return rejectedRecommendation('malformed-record', 'THE UNCERTAINTY LAW', `validateHarnessOptimizationRecommendation: the uncertainty evidence level '${showValue(uncertainty.evidenceLevel)}' disagrees with the winning report's own level '${bestReport.evidenceLevel}' (the honest claim is exactly what the real evaluation answered)`, ['uncertainty.evidenceLevel']);
        }
        if (typeof uncertainty.workloadObservationCount !== 'number' || typeof uncertainty.simulationCandidateCount !== 'number' || typeof uncertainty.ladderSeedCount !== 'number') {
                return rejectedRecommendation('malformed-record', 'THE UNCERTAINTY LAW', 'validateHarnessOptimizationRecommendation: the uncertainty observation counts must be numbers (the honest evidence counts)', ['uncertainty.workloadObservationCount']);
        }
        if (typeof uncertainty.statement !== 'string' || uncertainty.statement.length === 0) {
                return rejectedRecommendation('malformed-record', 'THE UNCERTAINTY LAW', 'validateHarnessOptimizationRecommendation: the uncertainty statement must be a non-empty string (the deterministic honesty sentence)', ['uncertainty.statement']);
        }
        const calibrationStateError = walkCalibrationState(uncertainty.calibration);
        if (calibrationStateError !== null) {
                return rejectedRecommendation('malformed-record', 'THE UNCERTAINTY LAW', `validateHarnessOptimizationRecommendation: ${calibrationStateError}`, ['uncertainty.calibration']);
        }
        // THE MISSING-CAPABILITY LAW stations.
        if (!Array.isArray(candidate.missingCapabilities)) {
                return rejectedRecommendation('malformed-record', 'THE MISSING-CAPABILITY LAW', 'validateHarnessOptimizationRecommendation: the missing-capability ledger must be an array (a zero-entry ledger is the green path - the field is never absent, never silently dropped)', ['missingCapabilities']);
        }
        for (let i = 0; i < candidate.missingCapabilities.length; i += 1) {
                const entry = candidate.missingCapabilities[i];
                if (!isRecord(entry)) {
                        return rejectedRecommendation('malformed-record', 'THE MISSING-CAPABILITY LAW', `validateHarnessOptimizationRecommendation: the ledger entry ${i} must be a plain object`, [`missingCapabilities[${i}]`]);
                }
                const entryRecord = entry as Record<string, unknown>;
                const unknownEntryKeys = Object.keys(entryRecord).filter((key) => !(MISSING_CAPABILITY_SCHEMA_KEYS as readonly string[]).includes(key));
                if (unknownEntryKeys.length > 0) {
                        return rejectedRecommendation('malformed-record', 'THE STRICT-SCHEMA LAW', `validateHarnessOptimizationRecommendation: the ledger entry ${i} schema is closed - the unknown key(s) ${showList(unknownEntryKeys)} are rejected`, unknownEntryKeys);
                }
                const missingEntryKeys = (MISSING_CAPABILITY_SCHEMA_KEYS as readonly string[]).filter((key) => !hasOwn(entryRecord, key));
                if (missingEntryKeys.length > 0) {
                        return rejectedRecommendation('malformed-record', 'THE MISSING-CAPABILITY LAW', `validateHarnessOptimizationRecommendation: the ledger entry ${i} requires every key - the key(s) ${showList(missingEntryKeys)} are missing`, missingEntryKeys);
                }
                if (typeof entryRecord.capabilityId !== 'string' || entryRecord.capabilityId.length === 0 || typeof entryRecord.requiredLevel !== 'number' || typeof entryRecord.bestScore !== 'number' || typeof entryRecord.taskTypeId !== 'string' || entryRecord.taskTypeId.length === 0) {
                        return rejectedRecommendation('malformed-record', 'THE MISSING-CAPABILITY LAW', `validateHarnessOptimizationRecommendation: the ledger entry ${i} fields must be the honest REAL coverage-row shapes (capabilityId, requiredLevel, bestScore, taskTypeId)`, [`missingCapabilities[${i}]`]);
                }
        }
        if (typeof candidate.createdAtIso !== 'string' || candidate.createdAtIso.length === 0) {
                return rejectedRecommendation('malformed-record', 'THE AUDIT LAW', 'validateHarnessOptimizationRecommendation: the creation timestamp must be a non-empty string (the injected clock reading)', ['createdAtIso']);
        }
        return {
                ok: true,
                recommendation: {
                        recommendationId: candidate.recommendationId as string,
                        contractVersion: OPTIMIZATION_CONTRACTS_VERSION,
                        loopId: candidate.loopId as string,
                        scope: { workspaceId: (candidate.scope as unknown as LabScope).workspaceId, tenantId: (candidate.scope as unknown as LabScope).tenantId },
                        runId: candidate.runId as string,
                        workload: candidate.workload as WorkloadLearningResult,
                        simulation: candidate.simulation as OrgSearchResult,
                        comparison: candidate.comparison as LadderRunResult,
                        bestReportId: candidate.bestReportId as string,
                        expectedGains: [...(candidate.expectedGains as BaselineComparison[])],
                        labRecommendation: candidate.labRecommendation as LabRecommendation,
                        delta: deltaOutcome.value.delta,
                        reversibility: deltaOutcome.value.reversibility,
                        uncertainty: {
                                evidenceLevel: uncertainty.evidenceLevel as LabEvidenceLevel,
                                workloadObservationCount: uncertainty.workloadObservationCount as number,
                                simulationCandidateCount: uncertainty.simulationCandidateCount as number,
                                ladderSeedCount: uncertainty.ladderSeedCount as number,
                                calibration: uncertainty.calibration as LoopCalibrationState,
                                statement: uncertainty.statement as string,
                        },
                        missingCapabilities: [...(candidate.missingCapabilities as MissingCapabilityLedgerEntry[])],
                        createdAtIso: candidate.createdAtIso as string,
                },
        };
}

/** The structural walk of the REAL WorkloadLearningResult evidence (the verbatim-carrier station). */
export function validateWorkloadEvidence(value: unknown, station: string): string | null {
        if (!isRecord(value)) {
                return `the ${station} evidence must be the REAL WorkloadLearningResult shape (a plain object)`;
        }
        const result = value as Record<string, unknown>;
        // THE IMPORT LAW: the REAL WorkloadLearningResult carries its version pin on the
        // PROFILE (the real learner versions the profile and the task-type descriptors,
        // never the top-level result) - the walk checks the REAL shape's own pins.
        if (!isRecord(result.profile) || (result.profile as Record<string, unknown>).contractVersion !== LAB_CONTRACTS_VERSION) {
                return `the ${station} evidence's profile must be the REAL WorkloadProfile shape pinning LAB_CONTRACTS_VERSION`;
        }
        if (typeof result.retainedRecordCount !== 'number' || typeof result.excludedRecordCount !== 'number') {
                return `the ${station} evidence must carry the governance counts (retainedRecordCount / excludedRecordCount)`;
        }
        if (!Array.isArray(result.taskTypes) || !Array.isArray(result.warnings) || result.warnings.length === 0) {
                return `the ${station} evidence must carry the task-type inferences and the honest warnings (fixture-evidence is always present)`;
        }
        return null;
}

/** The structural walk of the REAL OrgSearchResult evidence (the verbatim-carrier station). */
export function validateSearchEvidence(value: unknown, station: string): string | null {
        if (!isRecord(value)) {
                return `the ${station} evidence must be the REAL OrgSearchResult shape (a plain object)`;
        }
        const result = value as Record<string, unknown>;
        if (result.contractVersion !== LAB_CONTRACTS_VERSION) {
                return `the ${station} evidence must pin the REAL LAB_CONTRACTS_VERSION '${LAB_CONTRACTS_VERSION}' (carried: '${showValue(result.contractVersion)}')`;
        }
        if (!Array.isArray(result.candidates) || result.candidates.length === 0) {
                return `the ${station} evidence must carry a non-empty ranked candidate list (the REAL search always answers the baseline)`;
        }
        if (!isRecord(result.baseline) || !isRecord(result.best) || !isRecord(result.request) || !Array.isArray(result.trace)) {
                return `the ${station} evidence must carry the baseline, the best candidate, the verbatim request echo and the search trace`;
        }
        return null;
}

/** The structural walk of the REAL LadderRunResult evidence (the verbatim-carrier station). */
export function validateLadderEvidence(value: unknown, station: string): string | null {
        if (!isRecord(value)) {
                return `the ${station} evidence must be the REAL LadderRunResult shape (a plain object)`;
        }
        const result = value as Record<string, unknown>;
        if (result.contractVersion !== LAB_CONTRACTS_VERSION) {
                return `the ${station} evidence must pin the REAL LAB_CONTRACTS_VERSION '${LAB_CONTRACTS_VERSION}' (carried: '${showValue(result.contractVersion)}')`;
        }
        if (typeof result.runId !== 'string' || result.runId.length === 0) {
                return `the ${station} evidence must carry the run id (the REAL calibration linkage key)`;
        }
        if (!Array.isArray(result.reports) || result.reports.length === 0 || !isRecord(result.baselineReport) || !isRecord(result.bestReport) || !Array.isArray(result.trace)) {
                return `the ${station} evidence must carry the per-candidate reports, the baseline report, the best report and the trace`;
        }
        for (let i = 0; i < (result.reports as unknown[]).length; i += 1) {
                const report = (result.reports as Record<string, unknown>[])[i];
                if (!isRecord(report) || report.contractVersion !== LAB_CONTRACTS_VERSION || !Array.isArray(report.scores) || report.scores.length < 4) {
                        return `the ${station} evidence's report ${i} must be the REAL EvaluationReport shape pinning LAB_CONTRACTS_VERSION with the four real evaluation dimensions`;
                }
        }
        return null;
}

/** The structural walk of the REAL LabRecommendation linkage record (the calibration input station). */
function walkLabRecommendation(value: unknown, scope: LabScope, runId: string): string | null {
        if (!isRecord(value)) {
                return 'the labRecommendation must be the REAL LabRecommendation shape (a plain object - the calibration linkage record)';
        }
        const recommendation = value as Record<string, unknown>;
        if (recommendation.contractVersion !== LAB_CONTRACTS_VERSION) {
                return `the labRecommendation must pin the REAL LAB_CONTRACTS_VERSION '${LAB_CONTRACTS_VERSION}'`;
        }
        if (typeof recommendation.id !== 'string' || recommendation.id.length === 0 || typeof recommendation.runId !== 'string' || recommendation.runId.length === 0) {
                return 'the labRecommendation must carry its id and run link';
        }
        if (recommendation.runId !== runId) {
                return `the labRecommendation's run link '${showValue(recommendation.runId)}' disagrees with the recommendation's run link '${runId}' (THE LINKAGE LAW - the REAL observeBridgeOutcome requires the agreement)`;
        }
        if (!isRecord(recommendation.scope) || (recommendation.scope as unknown as LabScope).workspaceId !== scope.workspaceId || (recommendation.scope as unknown as LabScope).tenantId !== scope.tenantId) {
                return 'the labRecommendation must carry the loop\'s scope (THE LINKAGE LAW - the REAL observeBridgeOutcome requires the agreement)';
        }
        if (!isRecord(recommendation.organization) || !Array.isArray(recommendation.expectedGains) || typeof recommendation.confidence !== 'number' || !Array.isArray(recommendation.caveats) || !Array.isArray(recommendation.auditTrail) || recommendation.reversible !== true || typeof recommendation.createdAt !== 'string') {
                return 'the labRecommendation must carry the organization, the expected gains, the confidence, the caveats, the audit trail, the reversible flag (the REAL contract admits only reversible lab-side records) and the creation timestamp';
        }
        if (recommendation.status !== 'issued' && recommendation.status !== 'applied' && recommendation.status !== 'reverted') {
                return `the labRecommendation status '${showValue(recommendation.status)}' is not a member of the REAL contract's frozen status list`;
        }
        return null;
}

/** The structural walk of the uncertainty disclosure's calibration state (THE UNCERTAINTY LAW's honesty station). */
function walkCalibrationState(value: unknown): string | null {
        if (!isRecord(value)) {
                return 'the calibration state must be a plain object (the typed honesty field)';
        }
        const state = value as Record<string, unknown>;
        const unknownKeys = Object.keys(state).filter((key) => !(CALIBRATION_STATE_SCHEMA_KEYS as readonly string[]).includes(key));
        if (unknownKeys.length > 0) {
                return `the calibration state schema is closed - the unknown key(s) ${showList(unknownKeys)} are rejected`;
        }
        const missingKeys = (CALIBRATION_STATE_SCHEMA_KEYS as readonly string[]).filter((key) => !hasOwn(state, key));
        if (missingKeys.length > 0) {
                return `the calibration state requires every key - the key(s) ${showList(missingKeys)} are missing`;
        }
        if (state.minObservations !== MIN_FACTORS_OBSERVATIONS) {
                return `the calibration state's floor must be the REAL MIN_FACTORS_OBSERVATIONS (${MIN_FACTORS_OBSERVATIONS}), imported by reference (carried: ${showValue(state.minObservations)})`;
        }
        if (typeof state.observationCount !== 'number' || typeof state.belowMinimum !== 'boolean') {
                return 'the calibration state must carry the observation count (a number) and the belowMinimum flag (a boolean)';
        }
        if (state.belowMinimum !== (state.observationCount as number) < MIN_FACTORS_OBSERVATIONS) {
                return `the calibration state's belowMinimum flag must SAY the honest truth (observationCount ${showValue(state.observationCount)} vs the REAL floor ${MIN_FACTORS_OBSERVATIONS} - never a fabricated confidence)`;
        }
        if (state.model !== null && !isRecord(state.model)) {
                return 'the calibration state\'s prior model must be the REAL CalibrationModelResult shape or null (a first loop carries no prior calibration)';
        }
        if (state.model !== null) {
                const model = state.model as Record<string, unknown>;
                if (model.contractVersion !== LAB_CONTRACTS_VERSION || typeof model.observationCount !== 'number') {
                        return 'the calibration state\'s prior model must pin LAB_CONTRACTS_VERSION and carry the observation count (the REAL CalibrationModelResult shape)';
                }
                if ((model.observationCount as number) !== (state.observationCount as number)) {
                        return 'the calibration state\'s observation count must agree with the prior model\'s own count (the honest counts)';
                }
        }
        return null;
}

// --- THE LOOP RECORD (the staged evidence record) ---------------------------------------------------

/**
 * One provenance note in the loop history: which clock reading the
 * op landed at, which LEG it walked (null ONLY on the begin note -
 * the entry into 'observe'), the stage edge, the op, the granting law
 * and the deterministic detail sentence.
 */
export interface OptimizationLoopNote {
        readonly at: string;
        readonly leg: LoopLeg | null;
        readonly fromStage: LoopStage | null;
        readonly toStage: LoopStage;
        readonly op: LoopOpName;
        readonly law: string;
        readonly detail: string;
}

/** The frozen history-note schema keys, in the canonical fixed-key-order. */
export const LOOP_NOTE_SCHEMA_KEYS = ['at', 'leg', 'fromStage', 'toStage', 'op', 'law', 'detail'] as const;

/**
 * THE APPROVAL LAW's decision mirror: the recorded caller approval
 * decision - the EVIDENCE mirror of the caller's own decision ({ approvedBy, note? }),
 * never a brokered authority (the same discipline as the DH-11
 * journey's approval mirror).
 */
export interface LoopApprovalDecision {
        readonly approvedBy: string;
        readonly note?: string;
}

/**
 * The persisted per-loop record (THE EVIDENCE of the run - THE
 * NO-SECOND-ENGINE LAW): the loop id, the re-carried contract
 * version, the loop stage, the observed lab scope, each stage's
 * evidence as the walk advances (the REAL shapes carried verbatim:
 * the workload learning result, the organization search result, the
 * ladder run result, then this family's typed recommendation, the
 * recorded approval decision, the execution evidence, the measure
 * evidence and the calibration evidence), the creation timestamp,
 * the revision count (the begin is revision 1; every applied op
 * appends one) and the full leg history with provenance. The loop
 * record records what the loop did and what the real modules
 * answered - it is NEVER a second scheduler, executor, journal or
 * authority.
 */
export interface OptimizationLoopRecord {
        readonly loopId: string;
        readonly contractVersion: string;
        readonly stage: LoopStage;
        readonly scope: LabScope | null;
        readonly workload: WorkloadLearningResult | null;
        readonly simulation: OrgSearchResult | null;
        readonly comparison: LadderRunResult | null;
        readonly recommendation: HarnessOptimizationRecommendation | null;
        readonly approval: Readonly<Record<string, string>> | null;
        readonly execution: LoopExecutionEvidence | null;
        readonly measures: LoopMeasureEvidence | null;
        readonly calibration: LoopCalibrationEvidence | null;
        readonly createdAtIso: string;
        readonly revision: number;
        readonly history: readonly OptimizationLoopNote[];
}

/** The frozen loop-record schema keys, in the canonical fixed-key-order (the serialization order). */
export const OPTIMIZATION_LOOP_RECORD_SCHEMA_KEYS = [
        'loopId',
        'contractVersion',
        'stage',
        'scope',
        'workload',
        'simulation',
        'comparison',
        'recommendation',
        'approval',
        'execution',
        'measures',
        'calibration',
        'createdAtIso',
        'revision',
        'history',
] as const;

/** The typed loop-record validation outcome: ok carries the canonical record; refusal carries the typed rejection. */
export type LoopRecordOutcome =
        | { readonly ok: true; readonly record: OptimizationLoopRecord }
        | { readonly ok: false; readonly rejection: LoopContentRejection };

/**
 * The deep loop-record walk (pure): the structural stations, the
 * version pin, the id form, the stage membership, then the
 * stage-vs-evidence consistency law (each stage's evidence is
 * present iff its leg walked - the history is the truth), the
 * per-stage evidence walks (the REAL shapes' structural walks; the
 * recommendation through the contract's own deep walk; the approval
 * through the decision-mirror walk; the execution through the REAL
 * journey-id and family-id predicates; the measures and calibration
 * through the real vocabulary walks) and the history walk (the leg
 * order, the op<->leg consistency, the stage chain).
 * First-failure-is-the-verdict in the frozen walk order.
 */
export function validateOptimizationLoopRecord(record: unknown): LoopRecordOutcome {
        if (!isRecord(record)) {
                return rejectedRecord('malformed-record', 'THE FAIL-CLOSED LAW', 'validateOptimizationLoopRecord: the loop record must be a plain object (never a silent partial verdict)', ['loop-record']);
        }
        const candidate = record as Record<string, unknown>;
        const unknownKeys = Object.keys(candidate).filter((key) => !(OPTIMIZATION_LOOP_RECORD_SCHEMA_KEYS as readonly string[]).includes(key));
        if (unknownKeys.length > 0) {
                return rejectedRecord('malformed-record', 'THE STRICT-SCHEMA LAW', `validateOptimizationLoopRecord: the loop-record schema is closed - the unknown key(s) ${showList(unknownKeys)} are rejected (the evidence alphabet is frozen)`, unknownKeys);
        }
        const missingKeys = (OPTIMIZATION_LOOP_RECORD_SCHEMA_KEYS as readonly string[]).filter((key) => !hasOwn(candidate, key));
        if (missingKeys.length > 0) {
                return rejectedRecord('malformed-record', 'THE FAIL-CLOSED LAW', `validateOptimizationLoopRecord: the loop-record schema requires every key - the key(s) ${showList(missingKeys)} are missing`, missingKeys);
        }
        if (!isLoopId(candidate.loopId)) {
                return rejectedRecord('unknown-loop', 'THE FAIL-CLOSED LAW', 'validateOptimizationLoopRecord: the loop id must satisfy the frozen flauz:opt:<16-hex> form (a fabricated id form fails closed as unknown-loop)', [showValue(candidate.loopId)]);
        }
        if (candidate.contractVersion !== OPTIMIZATION_CONTRACTS_VERSION) {
                return rejectedRecord('version-mismatch', 'THE SINGLE-VERSION LAW', `validateOptimizationLoopRecord: the loop record carries contract version '${showValue(candidate.contractVersion)}' - only '${OPTIMIZATION_CONTRACTS_VERSION}' is known`, [showValue(candidate.contractVersion)]);
        }
        if (!isLoopStage(candidate.stage)) {
                return rejectedRecord('malformed-record', 'THE FROZEN-VOCABULARY LAW', 'validateOptimizationLoopRecord: the stage must be a member of the frozen LOOP_STAGES list', ['stage']);
        }
        if (typeof candidate.createdAtIso !== 'string' || candidate.createdAtIso.length === 0) {
                return rejectedRecord('malformed-record', 'THE FAIL-CLOSED LAW', 'validateOptimizationLoopRecord: the creation timestamp must be a non-empty string', ['createdAtIso']);
        }
        if (typeof candidate.revision !== 'number' || !Number.isInteger(candidate.revision) || candidate.revision < 1) {
                return rejectedRecord('malformed-record', 'THE FAIL-CLOSED LAW', 'validateOptimizationLoopRecord: the revision must be a positive integer (the begin is revision 1; every applied op appends one)', ['revision']);
        }
        if (candidate.scope !== null && !isLabScope(candidate.scope)) {
                return rejectedRecord('malformed-record', 'THE FAIL-CLOSED LAW', 'validateOptimizationLoopRecord: the scope must be the REAL LabScope shape { workspaceId, tenantId } (set by the observe leg)', ['scope']);
        }
        if (!Array.isArray(candidate.history)) {
                return rejectedRecord('malformed-record', 'THE FAIL-CLOSED LAW', 'validateOptimizationLoopRecord: the history must be an array of provenance notes', ['history']);
        }
        // The history walk first (the walked legs are the evidence truth).
        const walked = walkHistory(candidate.history as unknown[]);
        if (typeof walked === 'string') {
                return rejectedRecord('malformed-record', 'THE FORWARD-ONLY LAW', `validateOptimizationLoopRecord: ${walked}`, ['history']);
        }
        const walkedLegs = walked.legs;
        // THE FORWARD-ONLY LAW's stage consistency: the record's stage is the last walked leg's stage (the begin's 'observe' before any leg).
        const expectedStage = walkedLegs.length === 0 ? 'observe' : LOOP_LEG_STAGES[walkedLegs[walkedLegs.length - 1]];
        if (candidate.stage !== expectedStage) {
                return rejectedRecord('malformed-record', 'THE FORWARD-ONLY LAW', `validateOptimizationLoopRecord: the record's stage '${showValue(candidate.stage)}' disagrees with the walked history (the walk's current stage is '${expectedStage}')`, ['stage']);
        }
        // The stage-vs-evidence consistency law: each stage's evidence is present iff its leg walked.
        const evidenceStations: ReadonlyArray<[LoopLeg, string, unknown]> = [
                ['observe', 'workload', candidate.workload],
                ['simulate', 'simulation', candidate.simulation],
                ['compare', 'comparison', candidate.comparison],
                ['recommend', 'recommendation', candidate.recommendation],
                ['approve', 'approval', candidate.approval],
                ['execute', 'execution', candidate.execution],
                ['measure', 'measures', candidate.measures],
                ['calibrate', 'calibration', candidate.calibration],
        ];
        for (const [leg, field, value] of evidenceStations) {
                const legWalked = (walkedLegs as readonly string[]).includes(leg);
                if (legWalked && value === null) {
                        return rejectedRecord('malformed-record', 'THE AUDIT LAW', `validateOptimizationLoopRecord: the ${leg} leg walked but the '${field}' evidence is null (the evidence trail is mandatory - never a silent gap)`, [field]);
                }
                if (!legWalked && value !== null) {
                        return rejectedRecord('malformed-record', 'THE FORWARD-ONLY LAW', `validateOptimizationLoopRecord: the '${field}' evidence is present but the ${leg} leg never walked (the evidence trail never runs ahead of the walk)`, [field]);
                }
        }
        // The per-stage evidence walks.
        if (candidate.workload !== null) {
                const workloadError = validateWorkloadEvidence(candidate.workload, 'workload');
                if (workloadError !== null) {
                        return rejectedRecord('malformed-record', 'THE AUDIT LAW', `validateOptimizationLoopRecord: ${workloadError}`, ['workload']);
                }
                const workload = candidate.workload as WorkloadLearningResult;
                if (candidate.scope === null || workload.profile.scope.workspaceId !== candidate.scope.workspaceId || workload.profile.scope.tenantId !== candidate.scope.tenantId) {
                        return rejectedRecord('malformed-record', 'THE LINKAGE LAW', 'validateOptimizationLoopRecord: the workload-evidence scope must agree with the recorded loop scope (no cross-workspace or cross-tenant leakage)', ['scope']);
                }
        }
        if (candidate.simulation !== null) {
                const simulationError = validateSearchEvidence(candidate.simulation, 'simulation');
                if (simulationError !== null) {
                        return rejectedRecord('malformed-record', 'THE AUDIT LAW', `validateOptimizationLoopRecord: ${simulationError}`, ['simulation']);
                }
        }
        if (candidate.comparison !== null) {
                const comparisonError = validateLadderEvidence(candidate.comparison, 'comparison');
                if (comparisonError !== null) {
                        return rejectedRecord('malformed-record', 'THE AUDIT LAW', `validateOptimizationLoopRecord: ${comparisonError}`, ['comparison']);
                }
        }
        if (candidate.recommendation !== null) {
                const recommendationOutcome = validateHarnessOptimizationRecommendation(candidate.recommendation);
                if (!recommendationOutcome.ok) {
                        return rejectedRecord(recommendationOutcome.rejection.reason === 'version-mismatch' ? 'version-mismatch' : 'malformed-record', recommendationOutcome.rejection.law, `validateOptimizationLoopRecord: the recommendation fails its own deep walk: ${recommendationOutcome.rejection.message}`, recommendationOutcome.rejection.items, recommendationOutcome.rejection.familyRejections);
                }
                const recommendation = recommendationOutcome.recommendation;
                if (recommendation.loopId !== candidate.loopId) {
                        return rejectedRecord('malformed-record', 'THE LINKAGE LAW', `validateOptimizationLoopRecord: the recommendation's loop link '${recommendation.loopId}' disagrees with the record's loop id '${candidate.loopId}'`, ['recommendation']);
                }
                if (candidate.comparison !== null && recommendation.comparison.runId !== (candidate.comparison as LadderRunResult).runId) {
                        return rejectedRecord('malformed-record', 'THE LINKAGE LAW', `validateOptimizationLoopRecord: the recommendation's carried comparison (run '${recommendation.comparison.runId}') disagrees with the record's comparison (run '${(candidate.comparison as LadderRunResult).runId}') - the audit trail carries the loop's OWN evidence verbatim`, ['recommendation.comparison']);
                }
                if (candidate.workload !== null && recommendation.workload.profile.id !== (candidate.workload as WorkloadLearningResult).profile.id) {
                        return rejectedRecord('malformed-record', 'THE LINKAGE LAW', `validateOptimizationLoopRecord: the recommendation's carried workload (profile '${recommendation.workload.profile.id}') disagrees with the record's workload (profile '${(candidate.workload as WorkloadLearningResult).profile.id}') - the audit trail carries the loop's OWN evidence verbatim`, ['recommendation.workload']);
                }
        }
        if (candidate.approval !== null) {
                const approvalWalked = walkApprovalMirror(candidate.approval);
                if (typeof approvalWalked === 'string') {
                        return rejectedRecord('malformed-record', 'THE FAIL-CLOSED LAW', `validateOptimizationLoopRecord: the approval evidence ${approvalWalked} (THE APPROVAL LAW's recorded decision mirror - never the authority)`, ['approval']);
                }
        }
        if (candidate.execution !== null) {
                const executionError = validateLoopExecutionEvidence(candidate.execution);
                if (executionError !== null) {
                        return rejectedRecord('malformed-record', 'THE AUDIT LAW', `validateOptimizationLoopRecord: ${executionError}`, ['execution']);
                }
        }
        if (candidate.measures !== null) {
                const measureError = validateLoopMeasureEvidence(candidate.measures);
                if (measureError !== null) {
                        return rejectedRecord('malformed-record', 'THE HONEST-MEASURE LAW', `validateOptimizationLoopRecord: ${measureError}`, ['measures']);
                }
        }
        if (candidate.calibration !== null) {
                const calibrationError = validateLoopCalibrationEvidence(candidate.calibration);
                if (calibrationError !== null) {
                        return rejectedRecord('malformed-record', 'THE MEASURE-CALIBRATE LAWS', `validateOptimizationLoopRecord: ${calibrationError}`, ['calibration']);
                }
        }
        return {
                ok: true,
                record: canonicalLoopRecord(candidate as unknown as OptimizationLoopRecord),
        };
}

/** Pure predicate: a well-formed loop record (the deep walk's ok verdict). */
export function isOptimizationLoopRecord(value: unknown): value is OptimizationLoopRecord {
        return validateOptimizationLoopRecord(value).ok;
}

/**
 * The approval decision-mirror walk (the EVIDENCE shape - the caller's
 * own decision): the shape carries only { approvedBy, note? }, every
 * value a non-empty string.
 */
function walkApprovalMirror(decision: unknown): Readonly<Record<string, string>> | string {
        if (!isRecord(decision)) {
                return 'must be a plain object (the approval decision mirror)';
        }
        const record = decision as Record<string, unknown>;
        const keys = Object.keys(record);
        const unknownKeys = keys.filter((key) => key !== 'approvedBy' && key !== 'note');
        if (unknownKeys.length > 0) {
                return `carries the unknown key '${unknownKeys[0]}' (the approval mirror is { approvedBy, note? })`;
        }
        if (!hasOwn(record, 'approvedBy')) {
                return "requires the 'approvedBy' key";
        }
        for (const key of keys) {
                if (typeof record[key] !== 'string' || (record[key] as string).length === 0) {
                        return `carries a non-string or empty '${key}' value`;
                }
        }
        const canonical: Record<string, string> = {};
        for (const key of ['approvedBy', 'note']) {
                if (hasOwn(record, key)) {
                        canonical[key] = record[key] as string;
                }
        }
        return canonical;
}

/**
 * The exported decision-mirror walk (the kit's replay payload station):
 * ok carries the canonical fixed-key-order decision mirror; refusal
 * carries the deterministic drift sentence.
 */
export function validateLoopApprovalMirror(decision: unknown): { readonly ok: true; readonly value: Readonly<Record<string, string>> } | { readonly ok: false; readonly message: string } {
        const walked = walkApprovalMirror(decision);
        if (typeof walked === 'string') {
                return { ok: false, message: walked };
        }
        return { ok: true, value: walked };
}

/** The execution-evidence walk: the REAL journey-id and family-id predicates, imported by reference. */
export function validateLoopExecutionEvidence(value: unknown): string | null {
        if (!isRecord(value)) {
                return 'the execution evidence must be a plain object';
        }
        const evidence = value as Record<string, unknown>;
        const unknownKeys = Object.keys(evidence).filter((key) => !(EXECUTION_EVIDENCE_SCHEMA_KEYS as readonly string[]).includes(key));
        if (unknownKeys.length > 0) {
                return `the execution-evidence schema is closed - the unknown key(s) ${showList(unknownKeys)} are rejected`;
        }
        const missingKeys = (EXECUTION_EVIDENCE_SCHEMA_KEYS as readonly string[]).filter((key) => !hasOwn(evidence, key));
        if (missingKeys.length > 0) {
                return `the execution evidence requires every key - the key(s) ${showList(missingKeys)} are missing`;
        }
        if (!isJourneyId(evidence.journeyId)) {
                return `the execution evidence's journey link must satisfy the REAL DH-011 isJourneyId predicate (flauz:jrn:<16-hex>, imported by reference) - carried ${showValue(evidence.journeyId)}`;
        }
        if (evidence.journeyStage !== 'composed') {
                return `the execution evidence's journey stage must be 'composed' (the record-composition leg is where the delta lands; the proposal/approval/activation remain the USER's journey through the REAL DH-01 authority - THE NO-SECOND-ENGINE LAW) - carried ${showValue(evidence.journeyStage)}`;
        }
        if (!isRecord(evidence.recordLinks)) {
                return 'the execution evidence must carry the composed record links (the six REAL family ids)';
        }
        const links = evidence.recordLinks as Record<string, unknown>;
        const linkGuards: ReadonlyArray<[string, (value: unknown) => boolean]> = [
                ['ontologyId', isOntologyId],
                ['templateId', isTemplateId],
                ['bodyId', isBodyId],
                ['packsId', isPackId],
                ['profilesId', isProfilesId],
                ['benchmarksId', isBenchmarkId],
        ];
        for (const [key, guard] of linkGuards) {
                if (!guard(links[key])) {
                        return `the composed link '${key}' must satisfy the OWNING family's REAL id predicate, imported by reference (${showValue(links[key])})`;
                }
        }
        if (!isHarnessId(evidence.bindingHarnessId)) {
                return `the binding harness link must satisfy the REAL DH-01 isHarnessId predicate (flauz:hrn:<16-hex>, imported by reference) - carried ${showValue(evidence.bindingHarnessId)}`;
        }
        return null;
}

/** The measure-evidence walk: the REAL evaluation vocabulary (the DH-09 result + the REAL TaskOutcome). */
export function validateLoopMeasureEvidence(value: unknown): string | null {
        if (!isRecord(value)) {
                return 'the measure evidence must be a plain object';
        }
        const evidence = value as Record<string, unknown>;
        const unknownKeys = Object.keys(evidence).filter((key) => !(MEASURE_EVIDENCE_SCHEMA_KEYS as readonly string[]).includes(key));
        if (unknownKeys.length > 0) {
                return `the measure-evidence schema is closed - the unknown key(s) ${showList(unknownKeys)} are rejected`;
        }
        const missingKeys = (MEASURE_EVIDENCE_SCHEMA_KEYS as readonly string[]).filter((key) => !hasOwn(evidence, key));
        if (missingKeys.length > 0) {
                return `the measure evidence requires every key - the key(s) ${showList(missingKeys)} are missing`;
        }
        if (typeof evidence.benchmarkKey !== 'string' || evidence.benchmarkKey.length === 0) {
                return 'the measure evidence must carry the evaluated benchmark key (the DH-09 evaluation surface)';
        }
        if (typeof evidence.measuredAt !== 'string' || evidence.measuredAt.length === 0) {
                return 'the measure evidence must carry the measured-at timestamp';
        }
        if (!isRecord(evidence.evaluation)) {
                return 'the measure evidence must carry the REAL BenchmarkEvaluationResult shape (the DH-09 honest-measure answer)';
        }
        const evaluation = evidence.evaluation as Record<string, unknown>;
        if (typeof evaluation.benchmarksId !== 'string' || typeof evaluation.harnessId !== 'string' || typeof evaluation.benchmarkKey !== 'string' || !Array.isArray(evaluation.scores)) {
                return 'the evaluation evidence must carry the REAL BenchmarkEvaluationResult fields (benchmarksId / harnessId / benchmarkKey / scores)';
        }
        if (evaluation.benchmarkKey !== evidence.benchmarkKey) {
                return `the evaluation evidence's benchmark key '${showValue(evaluation.benchmarkKey)}' disagrees with the measure evidence's key '${evidence.benchmarkKey}'`;
        }
        if (!isLoopEvidenceLevel(evaluation.evidenceLevel)) {
                return `the evaluation evidence's level '${showValue(evaluation.evidenceLevel)}' is not a REAL LabEvidenceLevel member`;
        }
        if (loopEvidenceLevelRank(evaluation.evidenceLevel) > loopEvidenceLevelRank('simulated')) {
                return `the evaluation evidence's level '${evaluation.evidenceLevel}' is ABOVE the loop's frozen ceiling 'simulated' (THE EVIDENCE-CEILING LAW - the loop never promotes its measures)`;
        }
        const outcomeError = validateTaskOutcome(evidence.outcome);
        if (outcomeError !== null) {
                return outcomeError;
        }
        return null;
}

/** The REAL TaskOutcome walk (the caller-supplied observed outcome - the calibrate leg's input). */
export function validateTaskOutcome(value: unknown): string | null {
        if (!isRecord(value)) {
                return 'the measured outcome must be the REAL TaskOutcome shape (a plain object)';
        }
        const outcome = value as Record<string, unknown>;
        if (typeof outcome.success !== 'boolean' || typeof outcome.quality !== 'number' || !Number.isFinite(outcome.quality) || typeof outcome.latencyMs !== 'number' || !Number.isFinite(outcome.latencyMs) || typeof outcome.costUsd !== 'number' || !Number.isFinite(outcome.costUsd)) {
                return 'the measured outcome must carry the REAL TaskOutcome fields (success boolean, quality / latencyMs / costUsd numbers)';
        }
        if (!Array.isArray(outcome.verification)) {
                return 'the measured outcome must carry the verification rows (the REAL TaskOutcome shape)';
        }
        for (let i = 0; i < (outcome.verification as unknown[]).length; i += 1) {
                const row = (outcome.verification as Record<string, unknown>[])[i];
                if (!isRecord(row) || typeof row.check !== 'string' || typeof row.passed !== 'boolean') {
                        return `the measured outcome's verification row ${i} must be the REAL { check, passed } shape`;
                }
        }
        return null;
}

/** The calibration-evidence walk: the REAL calibration module's own answer shapes. */
export function validateLoopCalibrationEvidence(value: unknown): string | null {
        if (!isRecord(value)) {
                return 'the calibration evidence must be a plain object';
        }
        const evidence = value as Record<string, unknown>;
        const unknownKeys = Object.keys(evidence).filter((key) => !(CALIBRATION_EVIDENCE_SCHEMA_KEYS as readonly string[]).includes(key));
        if (unknownKeys.length > 0) {
                return `the calibration-evidence schema is closed - the unknown key(s) ${showList(unknownKeys)} are rejected`;
        }
        const missingKeys = (CALIBRATION_EVIDENCE_SCHEMA_KEYS as readonly string[]).filter((key) => !hasOwn(evidence, key));
        if (missingKeys.length > 0) {
                return `the calibration evidence requires every key - the key(s) ${showList(missingKeys)} are missing`;
        }
        if (typeof evidence.calibratedAt !== 'string' || evidence.calibratedAt.length === 0) {
                return 'the calibration evidence must carry the calibrated-at timestamp';
        }
        if (!Array.isArray(evidence.records) || evidence.records.length === 0) {
                return 'the calibration evidence must carry a non-empty CalibrationRecord array (the REAL observeBridgeOutcome mints four rows per observation)';
        }
        for (let i = 0; i < (evidence.records as unknown[]).length; i += 1) {
                const row = (evidence.records as Record<string, unknown>[])[i];
                if (!isRecord(row) || row.contractVersion !== LAB_CONTRACTS_VERSION || typeof row.id !== 'string' || typeof row.recommendationId !== 'string' || typeof row.dimension !== 'string' || typeof row.predicted !== 'number' || typeof row.observed !== 'number' || typeof row.factor !== 'number' || typeof row.observedAt !== 'string') {
                        return `the calibration record ${i} must be the REAL CalibrationRecord shape pinning LAB_CONTRACTS_VERSION`;
                }
        }
        if (!isRecord(evidence.model)) {
                return 'the calibration evidence must carry the REAL CalibrationModelResult shape';
        }
        const model = evidence.model as Record<string, unknown>;
        if (model.contractVersion !== LAB_CONTRACTS_VERSION || !isRecord(model.factors) || typeof model.observationCount !== 'number' || !Array.isArray(model.reliabilityCurve) || typeof model.computedAt !== 'string') {
                return 'the calibration model must pin LAB_CONTRACTS_VERSION and carry the REAL CalibrationModelResult fields (factors / reliabilityCurve / observationCount / computedAt)';
        }
        if ((model.observationCount as number) !== (evidence.records as unknown[]).length) {
                return `the calibration model's observation count ${showValue(model.observationCount)} disagrees with the carried records (${(evidence.records as unknown[]).length}) - the honest counts`;
        }
        if (!Array.isArray(evidence.correctedScores) || (evidence.correctedScores as unknown[]).length === 0) {
                return 'the calibration evidence must carry the corrected prediction scores (the REAL correctScores output)';
        }
        for (let i = 0; i < (evidence.correctedScores as unknown[]).length; i += 1) {
                const score = (evidence.correctedScores as Record<string, unknown>[])[i];
                if (!isRecord(score) || typeof score.dimension !== 'string' || typeof score.value !== 'number') {
                        return `the corrected score ${i} must be the REAL EvalScore shape`;
                }
        }
        return null;
}

/**
 * The history walk: every note is the frozen seven-key shape; the
 * note legs follow the frozen leg order (strictly increasing; the
 * begin note carries leg null and enters 'observe'); each note's leg
 * is the op's own leg; each note's toStage is the leg's stage-table
 * stage; the stage chain never breaks. Returns the walked legs (the
 * evidence truth) or the drift sentence.
 */
function walkHistory(history: readonly unknown[]): { legs: readonly LoopLeg[] } | string {
        if (history.length === 0) {
                return 'the history must carry the begin note (the loop entered the walk at observe)';
        }
        const legs: LoopLeg[] = [];
        let previousStage: LoopStage | null = null;
        let previousLegIndex = -1;
        for (let i = 0; i < history.length; i += 1) {
                const note = history[i];
                if (!isRecord(note)) {
                        return `note ${i + 1} is not a plain object`;
                }
                const noteRecord = note as Record<string, unknown>;
                const keys = Object.keys(noteRecord);
                const expected = [...LOOP_NOTE_SCHEMA_KEYS];
                if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
                        return `note ${i + 1} does not carry the frozen seven-key note schema in the canonical fixed-key order`;
                }
                if (typeof noteRecord.at !== 'string' || noteRecord.at.length === 0) {
                        return `note ${i + 1} carries no timestamp`;
                }
                if (!isLoopOpName(noteRecord.op)) {
                        return `note ${i + 1} carries an unknown op ${showValue(noteRecord.op)}`;
                }
                if (typeof noteRecord.law !== 'string' || noteRecord.law.length === 0) {
                        return `note ${i + 1} carries no law name (the provenance law)`;
                }
                if (typeof noteRecord.detail !== 'string' || noteRecord.detail.length === 0) {
                        return `note ${i + 1} carries no provenance detail`;
                }
                if (i === 0) {
                        if (noteRecord.op !== 'begin-loop' || noteRecord.leg !== null || noteRecord.fromStage !== null || noteRecord.toStage !== 'observe') {
                                return 'the first note must be the begin note (op begin-loop, leg null, fromStage null, toStage observe)';
                        }
                        previousStage = 'observe';
                        previousLegIndex = -1;
                        continue;
                }
                if (!isLoopLeg(noteRecord.leg)) {
                        return `note ${i + 1} carries an unknown leg ${showValue(noteRecord.leg)} (null is legal ONLY on the begin note)`;
                }
                const leg = noteRecord.leg as LoopLeg;
                const op = noteRecord.op as LoopOpName;
                if (!(LOOP_OP_LEGS[op] as readonly string[]).includes(leg)) {
                        return `note ${i + 1} walks leg '${leg}' under op '${op}' - the leg is not one of the op's own legs (the frozen op<->leg table)`;
                }
                const legIndex = loopLegIndex(leg);
                if (legIndex <= previousLegIndex) {
                        return `note ${i + 1} walks leg '${leg}' out of the frozen leg order (the loop legs never walk back)`;
                }
                previousLegIndex = legIndex;
                if (!isLoopStage(noteRecord.fromStage) || !isLoopStage(noteRecord.toStage)) {
                        return `note ${i + 1} carries an unknown stage`;
                }
                if (noteRecord.fromStage !== previousStage) {
                        return `note ${i + 1} breaks the stage chain (fromStage '${showValue(noteRecord.fromStage)}' != the walk's current stage '${previousStage}')`;
                }
                const expectedToStage = LOOP_LEG_STAGES[leg];
                if (noteRecord.toStage !== expectedToStage) {
                        return `note ${i + 1} walks leg '${leg}' to stage '${showValue(noteRecord.toStage)}' - the frozen leg<->stage table lands '${expectedToStage}'`;
                }
                previousStage = expectedToStage;
                legs.push(leg);
        }
        return { legs };
}

// --- the canonical serialization + the fail-closed parse -------------------------------------------

/** Builds the canonical fixed-key-order object of a loop record (the nested REAL shapes ride the real modules' own deterministic key orders). */
function canonicalLoopRecordObject(record: OptimizationLoopRecord): Record<string, unknown> {
        return {
                loopId: record.loopId,
                contractVersion: record.contractVersion,
                stage: record.stage,
                scope: record.scope === null ? null : { workspaceId: record.scope.workspaceId, tenantId: record.scope.tenantId },
                workload: record.workload === null ? null : record.workload,
                simulation: record.simulation === null ? null : record.simulation,
                comparison: record.comparison === null ? null : record.comparison,
                recommendation: record.recommendation === null ? null : recommendationObject(record.recommendation),
                approval: record.approval === null ? null : { ...record.approval },
                execution: record.execution === null ? null : {
                        journeyId: record.execution.journeyId,
                        journeyStage: record.execution.journeyStage,
                        recordLinks: linksObject(record.execution.recordLinks),
                        bindingHarnessId: record.execution.bindingHarnessId,
                },
                measures: record.measures === null ? null : measuresObject(record.measures),
                calibration: record.calibration === null ? null : calibrationObject(record.calibration),
                createdAtIso: record.createdAtIso,
                revision: record.revision,
                history: record.history.map((note) => ({
                        at: note.at,
                        leg: note.leg,
                        fromStage: note.fromStage,
                        toStage: note.toStage,
                        op: note.op,
                        law: note.law,
                        detail: note.detail,
                })),
        };
}

/** Builds the canonical fixed-key-order object of a recommendation (the nested REAL shapes ride their own deterministic key orders). */
function recommendationObject(recommendation: HarnessOptimizationRecommendation): Record<string, unknown> {
        return {
                recommendationId: recommendation.recommendationId,
                contractVersion: recommendation.contractVersion,
                loopId: recommendation.loopId,
                scope: { workspaceId: recommendation.scope.workspaceId, tenantId: recommendation.scope.tenantId },
                runId: recommendation.runId,
                workload: recommendation.workload,
                simulation: recommendation.simulation,
                comparison: recommendation.comparison,
                bestReportId: recommendation.bestReportId,
                expectedGains: recommendation.expectedGains.map((row) => ({ dimension: row.dimension, candidateValue: row.candidateValue, baselineValue: row.baselineValue, delta: row.delta })),
                labRecommendation: recommendation.labRecommendation,
                delta: deltaObject(recommendation.delta),
                reversibility: recommendation.reversibility.reversible
                        ? { reversible: true, rollback: rollbackObject(recommendation.reversibility.rollback) }
                        : { reversible: false, acknowledgedBy: recommendation.reversibility.acknowledgedBy },
                uncertainty: uncertaintyObject(recommendation.uncertainty),
                missingCapabilities: recommendation.missingCapabilities.map((entry) => ({ capabilityId: entry.capabilityId, requiredLevel: entry.requiredLevel, bestScore: entry.bestScore, taskTypeId: entry.taskTypeId })),
                createdAtIso: recommendation.createdAtIso,
        };
}

/** Builds the canonical fixed-key-order object of a delta. */
function deltaObject(delta: HarnessDelta): Record<string, unknown> {
        return {
                context: {
                        industry: delta.context.industry,
                        companyProfile: { displayName: delta.context.companyProfile.displayName, sizeBand: delta.context.companyProfile.sizeBand },
                        workTypes: [...delta.context.workTypes],
                        roles: delta.context.roles.map((role) => ({ roleKey: role.roleKey, summary: role.summary })),
                },
                additions: {
                        terms: delta.additions.terms.map((entry) => ({ ...entry })),
                        tasks: delta.additions.tasks.map((entry) => ({ ...entry })),
                        bodies: delta.additions.bodies.map((entry) => ({ ...entry })),
                        packs: delta.additions.packs.map((entry) => ({ ...entry })),
                        profiles: delta.additions.profiles.map((entry) => ({ ...entry })),
                        benchmarks: delta.additions.benchmarks.map((entry) => ({ ...entry })),
                },
                replaces: delta.replaces.map((ref) => ({ family: ref.family, recordId: ref.recordId })),
                rationale: delta.rationale,
        };
}

/** Builds the canonical fixed-key-order object of a rollback path. */
function rollbackObject(rollback: HarnessRollbackPath): Record<string, unknown> {
        return {
                route: rollback.route,
                removeRecords: rollback.removeRecords.map((ref) => ({ family: ref.family, recordId: ref.recordId })),
                restoreRecords: rollback.restoreRecords.map((ref) => ({ family: ref.family, recordId: ref.recordId })),
        };
}

/** Builds the canonical fixed-key-order object of an uncertainty disclosure. */
function uncertaintyObject(uncertainty: HarnessUncertaintyDisclosure): Record<string, unknown> {
        return {
                evidenceLevel: uncertainty.evidenceLevel,
                workloadObservationCount: uncertainty.workloadObservationCount,
                simulationCandidateCount: uncertainty.simulationCandidateCount,
                ladderSeedCount: uncertainty.ladderSeedCount,
                calibration: {
                        observationCount: uncertainty.calibration.observationCount,
                        minObservations: uncertainty.calibration.minObservations,
                        belowMinimum: uncertainty.calibration.belowMinimum,
                        model: uncertainty.calibration.model,
                },
                statement: uncertainty.statement,
        };
}

/** Builds the canonical fixed-key-order object of the composed record links (the REAL DH-11 six-key shape). */
function linksObject(links: ComposedRecordLinks): Record<string, string> {
        return {
                ontologyId: links.ontologyId,
                templateId: links.templateId,
                bodyId: links.bodyId,
                packsId: links.packsId,
                profilesId: links.profilesId,
                benchmarksId: links.benchmarksId,
        };
}

/** Builds the canonical fixed-key-order object of a measure evidence (the nested REAL shapes ride their own orders). */
function measuresObject(measures: LoopMeasureEvidence): Record<string, unknown> {
        return {
                benchmarkKey: measures.benchmarkKey,
                evaluation: measures.evaluation,
                outcome: measures.outcome,
                measuredAt: measures.measuredAt,
        };
}

/** Builds the canonical fixed-key-order object of a calibration evidence (the nested REAL shapes ride their own orders). */
function calibrationObject(calibration: LoopCalibrationEvidence): Record<string, unknown> {
        return {
                records: calibration.records,
                model: calibration.model,
                correctedScores: calibration.correctedScores.map((score) => ({ dimension: score.dimension, value: score.value, ...(score.unit === undefined ? {} : { unit: score.unit }) })),
                calibratedAt: calibration.calibratedAt,
        };
}

/** The canonical fixed-key-order copy of a validated loop record (the honest copy handed to callers). */
function canonicalLoopRecord(record: OptimizationLoopRecord): OptimizationLoopRecord {
        return JSON.parse(JSON.stringify(canonicalLoopRecordObject(record))) as OptimizationLoopRecord;
}

/**
 * THE CANONICAL SERIALIZATION: the validated loop record -> the
 * canonical fixed-key-order bytes (every THIS-family shape in its
 * frozen key order; every nested REAL shape riding the real module's
 * own deterministic key order - the real modules' byte-identical
 * law). A record that fails the deep walk never gets canonical bytes
 * (a TypeError - no dishonest evidence ever gets canonical form).
 */
export function serializeOptimizationLoop(record: unknown): string {
        if (!isOptimizationLoopRecord(record)) {
                throw new TypeError('serializeOptimizationLoop: record must satisfy isOptimizationLoopRecord - no dishonest loop evidence ever gets canonical bytes');
        }
        return JSON.stringify(canonicalLoopRecordObject(record as OptimizationLoopRecord));
}

/**
 * Closed frozen list of parse rejection reasons (the parse walk is
 * first-failure-is-the-verdict, in this exact order):
 *   malformed-json           - the bytes are not valid JSON;
 *   torn-envelope            - the bytes parse but the record envelope
 *                              is structurally incomplete or torn (a
 *                              non-object, a missing key, a value of
 *                              the wrong structural type - never a
 *                              silent partial parse);
 *   unknown-contract-version - the record carries a contract version
 *                              other than OPTIMIZATION_CONTRACTS_VERSION;
 *   unknown-key              - an extra key at the record, note or
 *                              decision level (tampered bytes);
 *   invalid-record           - the deep semantic walk refuses (the
 *                              frozen taxonomy of
 *                              validateOptimizationLoopRecord).
 */
export const OPTIMIZATION_PARSE_REJECTION_REASONS = [
        'malformed-json',
        'torn-envelope',
        'unknown-contract-version',
        'unknown-key',
        'invalid-record',
] as const;
export type OptimizationParseRejectionReason = (typeof OPTIMIZATION_PARSE_REJECTION_REASONS)[number];

/** Pure predicate over the closed parse-rejection list. */
export function isOptimizationParseRejectionReason(value: unknown): value is OptimizationParseRejectionReason {
        return (OPTIMIZATION_PARSE_REJECTION_REASONS as readonly string[]).includes(value as string);
}

/** The typed parse rejection: the frozen reason and the drift-naming message. */
export interface OptimizationParseRejection {
        readonly reason: OptimizationParseRejectionReason;
        readonly message: string;
}

/** The typed parse outcome: ok carries the validated record; failure names the drift. */
export type OptimizationParseOutcome =
        | { readonly ok: true; readonly record: OptimizationLoopRecord }
        | { readonly ok: false; readonly rejection: OptimizationParseRejection };

/**
 * THE FAIL-CLOSED PARSE: bytes -> the typed parse outcome. Malformed
 * JSON, a torn envelope, an unknown contract version, an unknown key
 * (record / note / decision level) or invalid content (the deep loop
 * walk) - each a typed rejection naming the drift; never a silent
 * partial parse. First-failure-is-the-verdict, in the frozen
 * OPTIMIZATION_PARSE_REJECTION_REASONS order.
 */
export function parseOptimizationLoop(bytes: unknown): OptimizationParseOutcome {
        if (typeof bytes !== 'string') {
                return { ok: false, rejection: { reason: 'torn-envelope', message: 'parseOptimizationLoop: bytes must be a string (the canonical fixed-key-order loop bytes)' } };
        }
        let parsed: unknown;
        try {
                parsed = JSON.parse(bytes);
        } catch (error) {
                return { ok: false, rejection: { reason: 'malformed-json', message: `parseOptimizationLoop: the bytes are not valid JSON: ${toMessage(error)}` } };
        }
        if (!isRecord(parsed)) {
                return { ok: false, rejection: { reason: 'torn-envelope', message: 'parseOptimizationLoop: the bytes must carry a JSON object (the loop-record envelope)' } };
        }
        const record = parsed as Record<string, unknown>;
        for (const key of OPTIMIZATION_LOOP_RECORD_SCHEMA_KEYS) {
                if (!hasOwn(record, key)) {
                        return { ok: false, rejection: { reason: 'torn-envelope', message: `parseOptimizationLoop: the '${key}' key is missing (a torn write - never a silent partial parse)` } };
                }
        }
        if (
                typeof record.loopId !== 'string' ||
                typeof record.contractVersion !== 'string' ||
                typeof record.stage !== 'string' ||
                typeof record.createdAtIso !== 'string' ||
                typeof record.revision !== 'number' ||
                !Array.isArray(record.history) ||
                (record.scope !== null && !isRecord(record.scope)) ||
                (record.workload !== null && !isRecord(record.workload)) ||
                (record.simulation !== null && !isRecord(record.simulation)) ||
                (record.comparison !== null && !isRecord(record.comparison)) ||
                (record.recommendation !== null && !isRecord(record.recommendation)) ||
                (record.approval !== null && !isRecord(record.approval)) ||
                (record.execution !== null && !isRecord(record.execution)) ||
                (record.measures !== null && !isRecord(record.measures)) ||
                (record.calibration !== null && !isRecord(record.calibration))
        ) {
                return { ok: false, rejection: { reason: 'torn-envelope', message: 'parseOptimizationLoop: the record envelope carries a value of the wrong structural type (a torn write - never a silent partial parse)' } };
        }
        if (record.contractVersion !== OPTIMIZATION_CONTRACTS_VERSION) {
                return { ok: false, rejection: { reason: 'unknown-contract-version', message: `parseOptimizationLoop: the record carries contract version '${record.contractVersion}' - only '${OPTIMIZATION_CONTRACTS_VERSION}' is known (the single-version law)` } };
        }
        const unknownRecordKeys = Object.keys(record).filter((key) => !(OPTIMIZATION_LOOP_RECORD_SCHEMA_KEYS as readonly string[]).includes(key));
        if (unknownRecordKeys.length > 0) {
                return { ok: false, rejection: { reason: 'unknown-key', message: `parseOptimizationLoop: the record carries the unknown key '${unknownRecordKeys[0]}' (the strict loop schema is closed)` } };
        }
        const history = record.history as unknown[];
        for (let i = 0; i < history.length; i += 1) {
                const note = history[i];
                if (!isRecord(note)) {
                        return { ok: false, rejection: { reason: 'torn-envelope', message: `parseOptimizationLoop: history note ${i + 1} is not a JSON object (a torn write)` } };
                }
                const unknownNoteKeys = Object.keys(note as Record<string, unknown>).filter((key) => !(LOOP_NOTE_SCHEMA_KEYS as readonly string[]).includes(key));
                if (unknownNoteKeys.length > 0) {
                        return { ok: false, rejection: { reason: 'unknown-key', message: `parseOptimizationLoop: history note ${i + 1} carries the unknown key '${unknownNoteKeys[0]}' (the frozen seven-key note schema)` } };
                }
        }
        const approval = record.approval as Record<string, unknown> | null;
        if (approval !== null) {
                const unknownApprovalKeys = Object.keys(approval).filter((key) => key !== 'approvedBy' && key !== 'note');
                if (unknownApprovalKeys.length > 0) {
                        return { ok: false, rejection: { reason: 'unknown-key', message: `parseOptimizationLoop: the approval mirror carries the unknown key '${unknownApprovalKeys[0]}' (the { approvedBy, note? } evidence shape)` } };
                }
        }
        const deep = validateOptimizationLoopRecord(parsed);
        if (!deep.ok) {
                return { ok: false, rejection: { reason: 'invalid-record', message: `parseOptimizationLoop: the deep loop walk refuses: ${deep.rejection.message}` } };
        }
        return { ok: true, record: deep.record };
}

// --- the shared helpers (the family pattern's private block) ---------------------------------------

function rejected(reason: OptimizationLoopRejectionReason, law: string, message: string, items?: readonly string[], familyRejections?: readonly VerbatimRejection[]): { readonly ok: false; readonly rejection: LoopContentRejection } {
        return { ok: false, rejection: { reason, law, message, ...(items === undefined ? {} : { items }), ...(familyRejections === undefined ? {} : { familyRejections }) } };
}

function rejectedRecommendation(reason: OptimizationLoopRejectionReason, law: string, message: string, items?: readonly string[], familyRejections?: readonly VerbatimRejection[]): { readonly ok: false; readonly rejection: LoopContentRejection } {
        return rejected(reason, law, message, items, familyRejections);
}

function rejectedRecord(reason: OptimizationLoopRejectionReason, law: string, message: string, items?: readonly string[], familyRejections?: readonly VerbatimRejection[]): { readonly ok: false; readonly rejection: LoopContentRejection } {
        return rejected(reason, law, message, items, familyRejections);
}

function isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isLabScope(value: unknown): value is LabScope {
        if (!isRecord(value)) {
                return false;
        }
        const scope = value as Partial<LabScope>;
        return typeof scope.workspaceId === 'string' && scope.workspaceId.length > 0 && typeof scope.tenantId === 'string' && scope.tenantId.length > 0;
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

function toMessage(error: unknown): string {
        if (error instanceof Error) {
                return error.message;
        }
        return String(error);
}
