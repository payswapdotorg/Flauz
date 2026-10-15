/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * DH-011 activation contract family: the typed end-to-end journey
 * vocabulary for the onboarding-and-activation instrument - the
 * eleventh item of the Domain Harness OS workstream (WORK-REGISTRY.md
 * § TL-B). A journey walks the COMPLETE user chain
 *   industry selection -> company/work type -> roles/workloads ->
 *   proposed harness -> validation -> user inspection and approval ->
 *   activation -> usable harness
 * THROUGH THE REAL LANDED KITS (DH-01 contract, DH-02 onboarding,
 * DH-03 roles, DH-04 ontology, DH-05 templates, DH-06 bodies,
 * DH-07 packs, DH-08 profiles, DH-09 benchmarks) - never
 * re-implementing any of them.
 *
 * THE EVIDENCE-NOT-AUTHORITY LAW (this family's first law): the
 * journey record is EVIDENCE of the run, never a second lifecycle
 * authority. The REAL DH-01 harness record (its ledger, its envelope,
 * its lifecycle machine) remains the ONLY lifecycle authority; the
 * journey record records what the journey did and what the real kit
 * answered. A post-journey lifecycle move (a retirement, say) happens
 * in the real kit and NEVER re-brokers the journey evidence.
 *
 * THE FAIL-CLOSED LAW (the registry row's core law): an incomplete or
 * unsafe proposal NEVER activates - every unsafe condition is a typed
 * refusal that leaves the REAL harness record at its pre-refusal
 * state (the record-unchanged law, pinned in the battery); there is
 * NO code path from an unsafe proposal to an active harness.
 *
 * THE MULTI-ROLE LAW: one user, multiple roles/specializations - the
 * journey composes the roles through the REAL DH-03 role-composition
 * family (its floors, its MAX_ROLES (32) bound, its frozen shapes),
 * never a parallel role vocabulary of its own.
 *
 * THE APPROVAL-BEFORE-ACTIVATION LAW: no approval, no activation -
 * the activation boundary requires the approval leg to have walked
 * AND the REAL harness record to sit at 'approved' (the fail-closed
 * double-check against the authority's own state).
 *
 * THE VERBATIM-CARRY LAW: every leg's typed refusal names the leg AND
 * carries the underlying real kit's refusal verbatim - the journey
 * never paraphrases an authority's refusal.
 *
 * THE IMPORT LAW: every vocabulary that exists upstream is imported
 * by reference (the nine family versions, the harness/industry
 * vocabularies and id alphabets, the family record shapes and their
 * validators) - never re-declared. THE CONTENT LAW: no per-industry
 * journey content is shipped - the caller supplies the selections and
 * the domain content; this family is the instrument, not the content
 * (the evidence level is fixture: the battery drives the real kits
 * with fixture inputs - claim exactly that).
 *
 * LAWS (the family pattern, inherited from the landed DH-01..DH-09):
 * - THE SINGLE-VERSION LAW: ACTIVATION_CONTRACTS_VERSION is declared
 *   ONCE here, re-carried by the kit (the re-export); the battery
 *   pins all TEN family versions equal.
 * - THE FORWARD-ONLY LAW: the journey stages (selection -> composed
 *   -> proposed -> approved -> active) never walk back; 'active' is
 *   TERMINAL for the journey record (the post-activation lifecycle
 *   belongs to the REAL DH-01 kit alone - THE
 *   EVIDENCE-NOT-AUTHORITY LAW).
 * - THE FROZEN-VOCABULARY LAW: the nine journey legs, the nine op
 *   names, the staged vocabulary and the rejection vocabulary are
 *   closed frozen lists; widening or reordering any of them is a
 *   versioned contract decision.
 * - THE STRICT-SCHEMA LAW: every payload (the record-content, the
 *   journey record, the history notes) carries a frozen closed key
 *   schema; an unknown key is the typed unknown-key rejection, a
 *   missing key the typed missing-key rejection, a wrong carrier the
 *   typed malformed-record rejection (never a silent partial
 *   verdict).
 * - THE FAIL-CLOSED PARSE: canonical fixed-key-order serialization +
 *   the typed parse walk (malformed-json / torn-envelope /
 *   unknown-contract-version / unknown-key / invalid-record),
 *   first-failure-is-the-verdict, in the frozen order.
 * - THE DETERMINISM LAW: no Math.random, no Date.now, no new Date(...)
 *   and no process.env in this module (law comments excepted) - the
 *   clock, the rng, the catalog and the fsPort are INJECTED seams the
 *   kit module forwards to the real kits it drives.
 */

import {
        DOMAIN_HARNESS_CONTRACTS_VERSION,
        isHarnessId,
        isHarnessIndustry,
        isHarnessValidationOutcome,
} from '../../contract/common/domainHarnessContract.js';
import type { HarnessIndustry, HarnessValidationOutcome, HarnessWorkType } from '../../contract/common/domainHarnessContract.js';
import {
        isOnboardingSessionId,
        ONBOARDING_CONTRACTS_VERSION,
        validateOnboardingCompanyProfile,
        validateOnboardingIndustryPayload,
        validateOnboardingReviewComposition,
        validateOnboardingWorkTypes,
} from '../../onboarding/common/onboardingContract.js';
import type { OnboardingCompanyProfile, OnboardingRefusal, OnboardingReviewComposition } from '../../onboarding/common/onboardingContract.js';
import {
        isRoleCompositionSessionId,
        MAX_ROLES,
        ROLES_CONTRACTS_VERSION,
        validateRoleCompositionSession,
        validateRoleEntry,
} from '../../roles/common/rolesContract.js';
import type { RoleCompositionRejection, RoleCompositionSession } from '../../roles/common/rolesContract.js';
import { isOntologyId, ONTOLOGY_CONTRACTS_VERSION, validateTermEntry } from '../../ontology/common/ontologyContract.js';
import type { OntologyRejection, OntologyTerm } from '../../ontology/common/ontologyContract.js';
import { isTemplateId, TEMPLATES_CONTRACTS_VERSION, validateTaskEntry } from '../../templates/common/templatesContract.js';
import type { TaskTemplateEntry, TemplatesRejection } from '../../templates/common/templatesContract.js';
import { isBodyId, BODIES_CONTRACTS_VERSION, validateBodyEntry } from '../../bodies/common/bodiesContract.js';
import type { BodiesRejection, BodyDefaultsEntry } from '../../bodies/common/bodiesContract.js';
import { isPackId, PACKS_CONTRACTS_VERSION, validatePackEntry } from '../../packs/common/packsContract.js';
import type { PackEntry, PacksRejection } from '../../packs/common/packsContract.js';
import { isProfilesId, PROFILES_CONTRACTS_VERSION, validateProfileEntry } from '../../profiles/common/profilesContract.js';
import type { ProfileEntry, ProfilesRejection } from '../../profiles/common/profilesContract.js';
import { isBenchmarkId, BENCHMARKS_CONTRACTS_VERSION, validateBenchmarkEntry } from '../../benchmarks/common/benchmarksContract.js';
import type { BenchmarkEntry, BenchmarksRejection } from '../../benchmarks/common/benchmarksContract.js';

/**
 * THE IMPORT LAW's re-export block: the NINE landed family versions,
 * the real id alphabets (the harness, onboarding-session,
 * role-composition, ontology, template, body, pack, profiles and
 * benchmark id forms) and the real record validators - imported by
 * reference, re-exported by reference, never re-declared (the
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
        MAX_ROLES,
        isHarnessId,
        isHarnessIndustry,
        isOnboardingSessionId,
        isRoleCompositionSessionId,
        isOntologyId,
        isTemplateId,
        isBodyId,
        isPackId,
        isProfilesId,
        isBenchmarkId,
        validateOnboardingCompanyProfile,
        validateOnboardingIndustryPayload,
        validateOnboardingReviewComposition,
        validateOnboardingWorkTypes,
        validateRoleCompositionSession,
        validateRoleEntry,
        validateTermEntry,
        validateTaskEntry,
        validateBodyEntry,
        validatePackEntry,
        validateProfileEntry,
        validateBenchmarkEntry,
};

/** THE SINGLE-VERSION LAW: declared ONCE here, re-carried by the kit. */
export const ACTIVATION_CONTRACTS_VERSION = '1.0.0';

/** The journey id prefix (this family's namespace). */
export const JOURNEY_ID_PREFIX = 'flauz:jrn:';

/**
 * The closed frozen journey-stage vocabulary: the five journey stages
 * in the exact walk order. The stages MIRROR the real DH-01 lifecycle
 * at the journey level (selection ~ the onboarding walk composing;
 * composed ~ the composed roles and staged records; proposed ~ the
 * DH-01 'proposed'; approved ~ the DH-01 'approved'; active ~ the
 * DH-01 'active' - the usable harness). 'active' is TERMINAL for the
 * journey record (THE EVIDENCE-NOT-AUTHORITY LAW: the post-activation
 * lifecycle - retirement included - belongs to the REAL DH-01 kit
 * alone).
 */
export const ACTIVATION_STAGES = [
        'selection',
        'composed',
        'proposed',
        'approved',
        'active',
] as const;
export type ActivationJourneyStage = (typeof ACTIVATION_STAGES)[number];

/** Pure predicate over the closed stage list. */
export function isActivationJourneyStage(value: unknown): value is ActivationJourneyStage {
        return (ACTIVATION_STAGES as readonly string[]).includes(value as string);
}

/** One whitelisted forward stage transition row (THE FORWARD-ONLY LAW's whitelist). */
export interface ActivationStageTransition {
        readonly from: ActivationJourneyStage;
        readonly to: ActivationJourneyStage;
}

/**
 * The frozen forward-only whitelist: the ONLY legal journey-stage
 * transitions are selection->composed, composed->proposed,
 * proposed->approved, approved->active. 'active' is TERMINAL - no
 * reopen; a changed journey is a NEW journey id (the journey lineage
 * law). Widening the map is a versioned contract decision.
 */
export const ACTIVATION_FORWARD_TRANSITIONS = [
        { from: 'selection', to: 'composed' },
        { from: 'composed', to: 'proposed' },
        { from: 'proposed', to: 'approved' },
        { from: 'approved', to: 'active' },
] as const;

/**
 * The typed stage verdict: ok carries the granting whitelist row
 * (1-based); refusal is the typed ILLEGAL_TRANSITION rejection naming
 * the violated whitelist row, the whitelisted successor and the
 * deterministic detail sentence. Forward-only; 'active' is TERMINAL.
 */
export type ActivationStageVerdict =
        | { readonly ok: true; readonly from: ActivationJourneyStage; readonly to: ActivationJourneyStage; readonly row: number }
        | {
                        readonly ok: false;
                        readonly reason: 'ILLEGAL_TRANSITION';
                        readonly from: unknown;
                        readonly to: unknown;
                        readonly whitelistRow: number | null;
                        readonly expectedTo: ActivationJourneyStage | null;
                        readonly detail: string;
                };

/**
 * THE FORWARD-ONLY LAW's verdict machine (pure): the exact whitelist
 * membership check. The only legal transitions are the four forward
 * rows; every other edge (skips, backwards moves, self-loops,
 * active->anything, unknown stages, non-strings) is the typed
 * ILLEGAL_TRANSITION rejection naming the violated whitelist row.
 */
export function canTransitionActivationStage(from: unknown, to: unknown): ActivationStageVerdict {
        const transitions = ACTIVATION_FORWARD_TRANSITIONS as readonly ActivationStageTransition[];
        let rowNumber = 0;
        for (let i = 0; i < transitions.length; i += 1) {
                if (transitions[i].from === from) {
                        rowNumber = i + 1;
                        break;
                }
        }
        if (!isActivationJourneyStage(from) || !isActivationJourneyStage(to)) {
                return {
                        ok: false,
                        reason: 'ILLEGAL_TRANSITION',
                        from,
                        to,
                        whitelistRow: rowNumber > 0 ? rowNumber : null,
                        expectedTo: rowNumber > 0 ? transitions[rowNumber - 1].to : null,
                        detail: `canTransitionActivationStage: '${showValue(from)}' -> '${showValue(to)}' is refused - both stages must be members of the frozen ACTIVATION_STAGES list (THE FORWARD-ONLY LAW - the journey-stage vocabulary is frozen)`,
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
                        detail: `canTransitionActivationStage: '${from}' -> '${to}' is refused - 'active' is TERMINAL for the journey record (no reopen; a changed journey is a NEW journey id; the post-activation lifecycle belongs to the REAL DH-01 kit - THE EVIDENCE-NOT-AUTHORITY LAW) (THE FORWARD-ONLY LAW)`,
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
                        detail: `canTransitionActivationStage: '${from}' -> '${to}'' is refused - the only whitelisted forward transition from '${from}' is row ${rowNumber} ('${from}' -> '${expectedTo}') (THE FORWARD-ONLY LAW - forward-only; active is terminal)`,
                };
        }
        return { ok: true, from, to, row: rowNumber };
}

/**
 * The closed frozen journey-leg vocabulary: the NINE legs of the
 * complete user journey, in the exact journey order (the registry
 * row's chain). The proposal boundary spans the proposal leg (the
 * draft mint through the REAL onboarding kit) and the validation leg
 * (the full validateDomainHarnessDescriptor boundary at the real
 * draft->proposed advance); the validation leg's evidence - the real
 * validation outcome - is carried by the journey record.
 */
export const JOURNEY_LEGS = [
        'industry-selection',
        'company-composition',
        'work-type-selection',
        'role-composition',
        'record-composition',
        'proposal',
        'validation',
        'approval',
        'activation',
] as const;
export type JourneyLeg = (typeof JOURNEY_LEGS)[number];

/** Pure predicate over the closed leg list. */
export function isJourneyLeg(value: unknown): value is JourneyLeg {
        return (JOURNEY_LEGS as readonly string[]).includes(value as string);
}

/** The frozen leg index (the walk order; -1 for a non-member). */
export function journeyLegIndex(leg: unknown): number {
        return (JOURNEY_LEGS as readonly string[]).indexOf(leg as string);
}

/**
 * The frozen op-name vocabulary (the ledger line ops): the nine kit
 * operations. The propose-harness op walks BOTH the proposal and the
 * validation legs (the two-phase boundary); its ledger line lands on
 * the validation leg (the net stage edge composed->proposed) and
 * carries the full review composition - the proposal leg's evidence -
 * in its payload.
 */
export const ACTIVATION_OP_NAMES = [
        'begin-journey',
        'select-industry',
        'compose-company',
        'select-work-types',
        'compose-roles',
        'compose-records',
        'propose-harness',
        'approve-harness',
        'activate-harness',
] as const;
export type ActivationOpName = (typeof ACTIVATION_OP_NAMES)[number];

/** Pure predicate over the closed op-name list. */
export function isActivationOpName(value: unknown): value is ActivationOpName {
        return (ACTIVATION_OP_NAMES as readonly string[]).includes(value as string);
}

/**
 * The frozen op->legs table: the legs each op WALKS. begin-journey
 * walks no leg (the entry into 'selection'); propose-harness walks
 * the proposal leg then the validation leg.
 */
export const JOURNEY_OP_LEGS: Readonly<Record<ActivationOpName, readonly JourneyLeg[]>> = {
        'begin-journey': [],
        'select-industry': ['industry-selection'],
        'compose-company': ['company-composition'],
        'select-work-types': ['work-type-selection'],
        'compose-roles': ['role-composition'],
        'compose-records': ['record-composition'],
        'propose-harness': ['proposal', 'validation'],
        'approve-harness': ['approval'],
        'activate-harness': ['activation'],
};

/**
 * The frozen op->required-legs table: the legs that must ALREADY be
 * walked before the op runs (THE FORWARD-ONLY LAW's op-level
 * whitelist; the last required leg is the op's walk FRONTIER - the
 * kit's stage guard reads it; the proposal boundary's completeness is
 * THE INCOMPLETE-COMPOSITION LAW's own station in the kit; the
 * approval leg is THE APPROVAL-BEFORE-ACTIVATION LAW's precondition
 * at the activation boundary).
 */
export const JOURNEY_OP_REQUIRED_LEGS: Readonly<Record<ActivationOpName, readonly JourneyLeg[]>> = {
        'begin-journey': [],
        'select-industry': [],
        'compose-company': ['industry-selection'],
        'select-work-types': ['company-composition'],
        'compose-roles': ['work-type-selection'],
        'compose-records': ['role-composition'],
        'propose-harness': ['record-composition'],
        'approve-harness': ['validation'],
        'activate-harness': ['approval'],
};

/**
 * The frozen leg->stage table: the journey stage AFTER each leg
 * lands. The three selection legs are 'selection' self-edges; the
 * role-composition leg enters 'composed'; the record-composition and
 * proposal legs are 'composed' self-edges (the draft composes
 * gradually); the validation leg enters 'proposed'; the approval leg
 * enters 'approved'; the activation leg enters 'active'.
 */
export const JOURNEY_LEG_STAGES: Readonly<Record<JourneyLeg, ActivationJourneyStage>> = {
        'industry-selection': 'selection',
        'company-composition': 'selection',
        'work-type-selection': 'selection',
        'role-composition': 'composed',
        'record-composition': 'composed',
        proposal: 'composed',
        validation: 'proposed',
        approval: 'approved',
        activation: 'active',
};

/** Pure predicate: a well-formed journey id (flauz:jrn:<16-hex>). */
export function isJourneyId(value: unknown): value is string {
        if (typeof value !== 'string') {
                return false;
        }
        if (!value.startsWith(JOURNEY_ID_PREFIX)) {
                return false;
        }
        const hex = value.slice(JOURNEY_ID_PREFIX.length);
        return /^[0-9a-f]{16}$/.test(hex);
}

// --- the record-composition content (the caller-supplied domain content) ---

/**
 * The frozen record-content schema keys, in the canonical
 * fixed-key-order (the serialization order AND the composition order
 * - the six real families in their frozen wave order: ontology terms,
 * template tasks, organization bodies, capability packs, model policy
 * profiles, domain benchmarks).
 */
export const JOURNEY_RECORD_CONTENT_SCHEMA_KEYS = [
        'terms',
        'tasks',
        'bodies',
        'packs',
        'profiles',
        'benchmarks',
] as const;

/**
 * THE CONTENT LAW's payload: the caller-supplied domain content for
 * the record-composition leg. Every entry shape is the OWNING real
 * family's own interface, imported by reference (the journey routes
 * the content through the real kits; it never invents entries and
 * never re-declares their shapes).
 */
export interface JourneyRecordContent {
        readonly terms: readonly OntologyTerm[];
        readonly tasks: readonly TaskTemplateEntry[];
        readonly bodies: readonly BodyDefaultsEntry[];
        readonly packs: readonly PackEntry[];
        readonly profiles: readonly ProfileEntry[];
        readonly benchmarks: readonly BenchmarkEntry[];
}

/** The union of the six record families' own typed rejections (THE VERBATIM-CARRY LAW's contract-level carrier). */
export type RecordFamilyRejection =
        | OntologyRejection
        | TemplatesRejection
        | BodiesRejection
        | PacksRejection
        | ProfilesRejection
        | BenchmarksRejection;

/**
 * THE VERBATIM-CARRY LAW's contract-level union: any owning real
 * family's typed rejection the journey-record walk surfaces - the
 * DH-02 payload refusal (the message-shaped OnboardingRefusal), the
 * DH-03 rejection-table member, and the six record families' typed
 * rejection-table members - carried complete, never paraphrased.
 */
export type VerbatimRejection = OnboardingRefusal | RoleCompositionRejection | RecordFamilyRejection;

/**
 * Closed frozen list of journey rejection reasons, in the exact walk
 * order (the kit's station order; every fail-closed condition typed
 * and named after the REAL law it enforces):
 *   disposed                 - THE DISPOSE LAW: the journey kit was
 *                              disposed; every operation after dispose
 *                              rejects;
 *   unknown-journey          - THE FAIL-CLOSED LAW: no journey with
 *                              the given id (a malformed id fails
 *                              closed as unknown - the DH-01
 *                              NOT_FOUND discipline, this family's
 *                              reason);
 *   malformed-record         - the journey record or a caller payload
 *                              carries the wrong structural type (a
 *                              non-array roles carrier, a non-object
 *                              content, an internally inconsistent
 *                              record);
 *   malformed-catalog        - THE FAIL-CLOSED LAW at the authority
 *                              seam: the injected catalog snapshot no
 *                              longer satisfies the REAL
 *                              isHarnessCatalogSnapshot predicate (a
 *                              malformed authority resolves nothing);
 *   premature-leg            - THE FORWARD-ONLY LAW: the op's leg
 *                              precedes its walked prerequisites
 *                              within the frozen leg order;
 *   stale-leg                - THE FORWARD-ONLY LAW: the op's leg is
 *                              behind the walk (already walked; the
 *                              journey record never walks back;
 *                              'active' is terminal);
 *   incomplete-composition   - THE INCOMPLETE-COMPOSITION LAW (the
 *                              row's core): the proposal boundary
 *                              requires EVERY composition leg walked
 *                              (the roles, the six record families,
 *                              the binding draft) - an incomplete
 *                              composition never proposes, never
 *                              activates;
 *   unsafe-proposal          - THE FAIL-CLOSED LAW (the row's core):
 *                              the activation boundary refused - the
 *                              REAL harness record does not sit at
 *                              'approved' (the fail-closed
 *                              double-check against the authority's
 *                              own state; there is NO code path from
 *                              an unsafe proposal to an active
 *                              harness);
 *   approval-missing         - THE APPROVAL-BEFORE-ACTIVATION LAW:
 *                              activation attempted without the
 *                              approval leg walked (no approval
 *                              input, no activation);
 *   dangling-ref-at-proposal - THE TWO-PHASE LAW / THE
 *                              NO-DANGLING-REF LAW: the REAL DH-01
 *                              draft->proposed boundary refused the
 *                              full validation (a ref does not
 *                              resolve in the catalog snapshot) -
 *                              the real refusal is carried verbatim;
 *   catalog-binding-refused  - THE CATALOG-BINDING LAW: the REAL
 *                              approve boundary refused - a
 *                              capabilityRef is ABSENT from the
 *                              catalog snapshot (fail-closed
 *                              escalation; the real refusal carried
 *                              verbatim);
 *   unapproved-capability    - THE CATALOG-BINDING LAW: the REAL
 *                              approve boundary refused - a
 *                              capabilityRef sits below
 *                              approved/enabled/available in the
 *                              catalog snapshot (a harness is NEVER
 *                              approved over an unapproved
 *                              capability; the real refusal carried
 *                              verbatim);
 *   malformed-decision       - THE FAIL-CLOSED LAW: the REAL DH-01
 *                              kit refused the caller-supplied
 *                              approval/activation decision (the
 *                              frozen per-transition shape) - the
 *                              real refusal carried verbatim;
 *   onboarding-refused       - THE VERBATIM-CARRY LAW: the REAL
 *                              DH-02 onboarding kit refused a leg
 *                              (selection, draft mint, propose
 *                              advance or its reopen) - carried
 *                              complete, never paraphrased;
 *   roles-refused            - THE VERBATIM-CARRY LAW: the REAL
 *                              DH-03 roles kit refused the role
 *                              composition (the floors, MAX_ROLES,
 *                              the entry walk) - carried verbatim;
 *   record-refused           - THE VERBATIM-CARRY LAW: one of the
 *                              REAL record kits (DH-04..DH-09)
 *                              refused the record composition or its
 *                              reopen - carried verbatim;
 *   harness-refused          - THE VERBATIM-CARRY LAW: the REAL
 *                              DH-01 kit refused a lifecycle leg
 *                              (reopen, inspect or advance) -
 *                              carried verbatim;
 *   version-mismatch         - THE SINGLE-VERSION LAW: a journey
 *                              record (or a version-bearing surface)
 *                              carries another contract version.
 * Widening or reordering the list is a versioned contract decision.
 */
export const ACTIVATION_JOURNEY_REJECTION_REASONS = [
        'disposed',
        'unknown-journey',
        'malformed-record',
        'malformed-catalog',
        'premature-leg',
        'stale-leg',
        'incomplete-composition',
        'unsafe-proposal',
        'approval-missing',
        'dangling-ref-at-proposal',
        'catalog-binding-refused',
        'unapproved-capability',
        'malformed-decision',
        'onboarding-refused',
        'roles-refused',
        'record-refused',
        'harness-refused',
        'version-mismatch',
] as const;
export type ActivationJourneyRejectionReason = (typeof ACTIVATION_JOURNEY_REJECTION_REASONS)[number];

/** Pure predicate over the closed rejection list. */
export function isActivationJourneyRejectionReason(value: unknown): value is ActivationJourneyRejectionReason {
        return (ACTIVATION_JOURNEY_REJECTION_REASONS as readonly string[]).includes(value as string);
}

/**
 * The typed journey rejection: the frozen reason, the violated law's
 * name, the deterministic message, the optional offending items and -
 * THE VERBATIM-CARRY LAW - the owning real family's own typed
 * rejection table, carried complete, never paraphrased.
 */
export interface JourneyContentRejection {
        readonly reason: ActivationJourneyRejectionReason;
        readonly law: string;
        readonly message: string;
        readonly items?: readonly string[];
        /** THE VERBATIM-CARRY LAW: the owning real family's COMPLETE typed rejection table (never first-only). */
        readonly familyRejections?: readonly VerbatimRejection[];
}

/** The typed content-validation outcome: ok carries the canonical content; refusal carries the typed rejection. */
export type JourneyContentOutcome =
        | { readonly ok: true; readonly value: JourneyRecordContent }
        | { readonly ok: false; readonly rejection: JourneyContentRejection };

/**
 * The typed journey-record validation outcome: ok carries the canonical
 * fixed-key-order record; refusal carries the typed rejection (the same
 * frozen rejection table - the record walk's own outcome shape, distinct
 * from the content walk's).
 */
export type JourneyRecordOutcome =
        | { readonly ok: true; readonly record: ActivationJourneyRecord }
        | { readonly ok: false; readonly rejection: JourneyContentRejection };

/**
 * The record-content walk (pure): the strict-schema stations
 * (malformed-record, unknown-key, missing-key) then the entry
 * stations - each family's entries walked by the OWNING family's REAL
 * validator, imported by reference (THE IMPORT LAW; the first failing
 * entry surfaces the family's COMPLETE typed rejection table
 * verbatim). Ok carries the canonical fixed-key-order copy.
 * First-failure-is-the-verdict in the frozen family order (terms,
 * tasks, bodies, packs, profiles, benchmarks).
 */
export function validateJourneyRecordContent(content: unknown): JourneyContentOutcome {
        if (!isRecord(content)) {
                return rejectedContent('malformed-record', 'THE FAIL-CLOSED LAW', 'validateJourneyRecordContent: the record content must be a plain object (never a silent partial verdict)', ['content']);
        }
        const record = content as Record<string, unknown>;
        const unknownKeys = Object.keys(record).filter((key) => !(JOURNEY_RECORD_CONTENT_SCHEMA_KEYS as readonly string[]).includes(key));
        if (unknownKeys.length > 0) {
                return rejectedContent('malformed-record', 'THE STRICT-SCHEMA LAW', `validateJourneyRecordContent: the record-content schema is closed - the unknown key(s) ${showList(unknownKeys)} are rejected (the content alphabet is the six owning families' entries, never more)`, unknownKeys);
        }
        const missingKeys = (JOURNEY_RECORD_CONTENT_SCHEMA_KEYS as readonly string[]).filter((key) => !hasOwn(record, key));
        if (missingKeys.length > 0) {
                return rejectedContent('malformed-record', 'THE FAIL-CLOSED LAW', `validateJourneyRecordContent: the record-content schema requires every family key - the key(s) ${showList(missingKeys)} are missing (a family with no content is an EMPTY array, never an absent key)`, missingKeys);
        }
        const carrierViolations: string[] = [];
        for (const key of JOURNEY_RECORD_CONTENT_SCHEMA_KEYS) {
                if (!Array.isArray(record[key])) {
                        carrierViolations.push(key);
                }
        }
        if (carrierViolations.length > 0) {
                return rejectedContent('malformed-record', 'THE FAIL-CLOSED LAW', `validateJourneyRecordContent: a content family carries the wrong structural type - the carrier(s) ${showList(carrierViolations)} must be arrays (never a silent partial verdict)`, carrierViolations);
        }
        // The entry stations: the OWNING family's REAL validator, imported by
        // reference (THE IMPORT LAW - this walk never re-implements an entry
        // law; it surfaces the family's COMPLETE typed rejection table
        // verbatim).
        const termOutcome = walkEntries(record.terms as unknown[], 'terms', validateTermEntry);
        if (termOutcome !== null) {
                return termOutcome;
        }
        const taskOutcome = walkEntries(record.tasks as unknown[], 'tasks', validateTaskEntry);
        if (taskOutcome !== null) {
                return taskOutcome;
        }
        const bodyOutcome = walkEntries(record.bodies as unknown[], 'bodies', validateBodyEntry);
        if (bodyOutcome !== null) {
                return bodyOutcome;
        }
        const packOutcome = walkEntries(record.packs as unknown[], 'packs', validatePackEntry);
        if (packOutcome !== null) {
                return packOutcome;
        }
        const profileOutcome = walkEntries(record.profiles as unknown[], 'profiles', validateProfileEntry);
        if (profileOutcome !== null) {
                return profileOutcome;
        }
        const benchmarkOutcome = walkEntries(record.benchmarks as unknown[], 'benchmarks', validateBenchmarkEntry);
        if (benchmarkOutcome !== null) {
                return benchmarkOutcome;
        }
        return {
                ok: true,
                value: {
                        terms: [...(record.terms as OntologyTerm[])],
                        tasks: [...(record.tasks as TaskTemplateEntry[])],
                        bodies: [...(record.bodies as BodyDefaultsEntry[])],
                        packs: [...(record.packs as PackEntry[])],
                        profiles: [...(record.profiles as ProfileEntry[])],
                        benchmarks: [...(record.benchmarks as BenchmarkEntry[])],
                },
        };
}

/** The per-family entry walk (the imported validator; the first failure surfaces the family's COMPLETE table verbatim). */
function walkEntries<E>(
        entries: readonly unknown[],
        family: string,
        validator: (entry: unknown) => { readonly ok: boolean; readonly value?: E; readonly rejections?: readonly RecordFamilyRejection[] },
): JourneyContentOutcome | null {
        for (let i = 0; i < entries.length; i += 1) {
                const verdict = validator(entries[i]);
                if (!verdict.ok) {
                        return rejectedContent(
                                'record-refused',
                                `THE VERBATIM-CARRY LAW (${family}[${i}])`,
                                `validateJourneyRecordContent: the ${family} entry ${i} fails the OWNING family's REAL validator - the family's COMPLETE typed rejection table is carried verbatim (this walk never re-implements an entry law)`,
                                [`${family}[${i}]`],
                                verdict.rejections,
                        );
                }
        }
        return null;
}

function rejectedContent(reason: ActivationJourneyRejectionReason, law: string, message: string, items?: readonly string[], familyRejections?: readonly VerbatimRejection[]): { readonly ok: false; readonly rejection: JourneyContentRejection } {
        return { ok: false, rejection: { reason, law, message, ...(items === undefined ? {} : { items }), ...(familyRejections === undefined ? {} : { familyRejections }) } };
}

// --- the journey record (the EVIDENCE of the run) ---

/**
 * The composed record links (the record-composition leg's evidence):
 * the six real families' composed record ids, in the frozen family
 * order. Each id is the OWNING family's own id form, guarded by its
 * REAL predicate (imported by reference); the emitted review refs
 * ARE these ids (the workflowRef is the template id, the
 * capabilityRef the pack id, the policyRef the profiles id, the
 * evidenceRefs the profiles and benchmark ids - the owning families'
 * emit surfaces return exactly these).
 */
export interface ComposedRecordLinks {
        readonly ontologyId: string;
        readonly templateId: string;
        readonly bodyId: string;
        readonly packsId: string;
        readonly profilesId: string;
        readonly benchmarksId: string;
}

/** The frozen composed-links schema keys, in the canonical fixed-key-order. */
export const COMPOSED_RECORD_LINKS_SCHEMA_KEYS = [
        'ontologyId',
        'templateId',
        'bodyId',
        'packsId',
        'profilesId',
        'benchmarksId',
] as const;

/**
 * One provenance note in the journey history: which clock reading the
 * op landed at, which LEG it walked (null ONLY on the begin note -
 * the entry into 'selection'), the stage edge, the op, the granting
 * law and the deterministic detail sentence.
 */
export interface ActivationJourneyNote {
        readonly at: string;
        readonly leg: JourneyLeg | null;
        readonly fromStage: ActivationJourneyStage | null;
        readonly toStage: ActivationJourneyStage;
        readonly op: ActivationOpName;
        readonly law: string;
        readonly detail: string;
}

/** The frozen history-note schema keys, in the canonical fixed-key-order. */
export const ACTIVATION_NOTE_SCHEMA_KEYS = [
        'at',
        'leg',
        'fromStage',
        'toStage',
        'op',
        'law',
        'detail',
] as const;

/**
 * The persisted per-journey record (THE EVIDENCE of the run - THE
 * EVIDENCE-NOT-AUTHORITY LAW): the journey id, the re-carried
 * contract version, the journey stage, the selection payloads
 * (industry / companyProfile / workTypes - the REAL DH-02 shapes,
 * set as the walk advances), the composed roles session (the REAL
 * DH-03 session record - THE MULTI-ROLE LAW's evidence), the
 * composed record links + the binding harness draft id (the
 * record-composition leg's lineage root - each re-composition mints a
 * NEW harness id, THE REGISTRY LINEAGE LAW), the CURRENT harness
 * link (the proposed/approved/active harness), the REAL validation
 * outcome the proposal boundary answered (the full green walk), the
 * RECORDED approval decision and activation decision (evidence only
 * - never brokered; the real kit's own decision records are the
 * authority), the REAL DH-02 onboarding session link, the creation
 * timestamp, the revision count (the begin is revision 1; every
 * applied op appends one) and the full leg history with provenance.
 * The journey record records what the journey did and what the real
 * kits answered - it is NEVER a second lifecycle authority.
 */
export interface ActivationJourneyRecord {
        readonly journeyId: string;
        readonly contractVersion: string;
        readonly stage: ActivationJourneyStage;
        readonly industry: HarnessIndustry | null;
        readonly companyProfile: OnboardingCompanyProfile | null;
        readonly workTypes: readonly HarnessWorkType[] | null;
        readonly rolesSession: RoleCompositionSession | null;
        readonly recordLinks: ComposedRecordLinks | null;
        readonly bindingHarnessId: string | null;
        readonly harnessId: string | null;
        readonly validation: HarnessValidationOutcome | null;
        readonly approval: Readonly<Record<string, string>> | null;
        readonly activation: Readonly<Record<string, string>> | null;
        readonly onboardingSessionId: string | null;
        readonly createdAtIso: string;
        readonly revision: number;
        readonly history: readonly ActivationJourneyNote[];
}

/** The frozen journey-record schema keys, in the canonical fixed-key-order (the serialization order). */
export const ACTIVATION_JOURNEY_RECORD_SCHEMA_KEYS = [
        'journeyId',
        'contractVersion',
        'stage',
        'industry',
        'companyProfile',
        'workTypes',
        'rolesSession',
        'recordLinks',
        'bindingHarnessId',
        'harnessId',
        'validation',
        'approval',
        'activation',
        'onboardingSessionId',
        'createdAtIso',
        'revision',
        'history',
] as const;

/**
 * The deep journey-record walk (pure): the full station tour over the
 * honest evidence record - malformed-record (the record and its
 * carriers / stage / ids / revision / history notes), version-
 * mismatch (THE SINGLE-VERSION LAW), unknown-journey (the id form),
 * then the selection payloads (the REAL DH-02 validators, surfaced
 * verbatim), the roles session (the REAL DH-03 session walk), the
 * composed links (the REAL family id predicates), the harness links
 * (the REAL DH-01 id alphabet), the validation evidence (the REAL
 * outcome predicate + the full-green mode law), the decision mirrors
 * (the frozen per-shape key sets - the EVIDENCE mirror of the real
 * kit's own decision records, never the authority) and the history
 * walk (the leg order, the op<->leg consistency, the stage chain).
 * Ok carries the canonical fixed-key-order copy.
 * First-failure-is-the-verdict in the frozen walk order. Stage-vs-
 * evidence consistency is the ledger replay's cross-check, never this
 * shape's (the DH-01 guard discipline).
 */
export function validateActivationJourneyRecord(record: unknown): JourneyRecordOutcome {
        if (!isRecord(record)) {
                return rejectedContent('malformed-record', 'THE FAIL-CLOSED LAW', 'validateActivationJourneyRecord: the journey record must be a plain object (never a silent partial verdict)', ['journey-record']);
        }
        const candidate = record as Record<string, unknown>;
        const structural: string[] = [];
        if (hasOwn(candidate, 'stage') && !isActivationJourneyStage(candidate.stage)) {
                structural.push('stage');
        }
        if (hasOwn(candidate, 'revision') && (typeof candidate.revision !== 'number' || !Number.isInteger(candidate.revision) || candidate.revision < 1)) {
                structural.push('revision');
        }
        if (hasOwn(candidate, 'createdAtIso') && (typeof candidate.createdAtIso !== 'string' || candidate.createdAtIso.length === 0)) {
                structural.push('createdAtIso');
        }
        if (hasOwn(candidate, 'onboardingSessionId') && candidate.onboardingSessionId !== null && !isOnboardingSessionId(candidate.onboardingSessionId)) {
                structural.push('onboardingSessionId');
        }
        if (hasOwn(candidate, 'workTypes') && candidate.workTypes !== null && !Array.isArray(candidate.workTypes)) {
                structural.push('workTypes');
        }
        if (hasOwn(candidate, 'rolesSession') && candidate.rolesSession !== null && !isRecord(candidate.rolesSession)) {
                structural.push('rolesSession');
        }
        if (hasOwn(candidate, 'recordLinks') && candidate.recordLinks !== null && !isRecord(candidate.recordLinks)) {
                structural.push('recordLinks');
        }
        if (hasOwn(candidate, 'companyProfile') && candidate.companyProfile !== null && !isRecord(candidate.companyProfile)) {
                structural.push('companyProfile');
        }
        if (hasOwn(candidate, 'history') && !Array.isArray(candidate.history)) {
                structural.push('history');
        }
        if (structural.length > 0) {
                return rejectedContent('malformed-record', 'THE FAIL-CLOSED LAW', `validateActivationJourneyRecord: a record field carries the wrong structural type - the field(s) ${showList(structural)} are malformed (never a silent partial verdict)`, structural);
        }
        const keys = Object.keys(candidate);
        const unknownKeys = keys.filter((key) => !(ACTIVATION_JOURNEY_RECORD_SCHEMA_KEYS as readonly string[]).includes(key));
        if (unknownKeys.length > 0) {
                return rejectedContent('malformed-record', 'THE STRICT-SCHEMA LAW', `validateActivationJourneyRecord: the journey-record schema is closed - the unknown key(s) ${showList(unknownKeys)} are rejected (the evidence alphabet is frozen)`, unknownKeys);
        }
        const missingKeys = (ACTIVATION_JOURNEY_RECORD_SCHEMA_KEYS as readonly string[]).filter((key) => !hasOwn(candidate, key));
        if (missingKeys.length > 0) {
                return rejectedContent('malformed-record', 'THE FAIL-CLOSED LAW', `validateActivationJourneyRecord: the journey-record schema requires every key - the key(s) ${showList(missingKeys)} are missing`, missingKeys);
        }
        if (!isJourneyId(candidate.journeyId)) {
                return rejectedContent('unknown-journey', 'THE FAIL-CLOSED LAW', 'validateActivationJourneyRecord: the journey id must satisfy the frozen flauz:jrn:<16-hex> form (a fabricated id form fails closed as unknown-journey)', [showValue(candidate.journeyId)]);
        }
        if (candidate.contractVersion !== ACTIVATION_CONTRACTS_VERSION) {
                return rejectedContent('version-mismatch', 'THE SINGLE-VERSION LAW', `validateActivationJourneyRecord: the journey record carries contract version '${showValue(candidate.contractVersion)}' - only '${ACTIVATION_CONTRACTS_VERSION}' is known`, [showValue(candidate.contractVersion)]);
        }
        if (candidate.industry !== null && !isHarnessIndustry(candidate.industry)) {
                return rejectedContent('malformed-record', 'THE FROZEN-VOCABULARY LAW', 'validateActivationJourneyRecord: the industry must be a member of the frozen HARNESS_INDUSTRIES list, imported by reference from the DH-01 contract', [showValue(candidate.industry)]);
        }
        if (candidate.companyProfile !== null) {
                const profileVerdict = validateOnboardingCompanyProfile(candidate.companyProfile);
                if (!profileVerdict.ok) {
                        return rejectedContent('malformed-record', 'THE IMPORT LAW', 'validateActivationJourneyRecord: the company profile fails the REAL DH-02 validateOnboardingCompanyProfile walk (surfaced verbatim)', ['companyProfile'], [profileVerdict.refusal]);
                }
        }
        if (candidate.workTypes !== null) {
                const workTypesVerdict = validateOnboardingWorkTypes(candidate.workTypes);
                if (!workTypesVerdict.ok) {
                        return rejectedContent('malformed-record', 'THE IMPORT LAW', 'validateActivationJourneyRecord: the work-type selection fails the REAL DH-02 validateOnboardingWorkTypes walk (surfaced verbatim)', ['workTypes'], [workTypesVerdict.refusal]);
                }
        }
        if (candidate.rolesSession !== null) {
                const sessionVerdict = validateRoleCompositionSession(candidate.rolesSession);
                if (!sessionVerdict.ok) {
                        return rejectedContent('malformed-record', 'THE IMPORT LAW', 'validateActivationJourneyRecord: the roles session fails the REAL DH-03 validateRoleCompositionSession walk (the COMPLETE typed rejection table is surfaced verbatim)', ['rolesSession'], [...sessionVerdict.rejections]);
                }
                const session = sessionVerdict.value;
                if (session.stage !== 'composed') {
                        return rejectedContent('malformed-record', 'THE FAIL-CLOSED LAW', `validateActivationJourneyRecord: the roles session is at the '${session.stage}' stage - the journey records ONLY composed role sessions (THE MULTI-ROLE LAW's evidence)`, [session.stage]);
                }
                if (session.roles.length === 0) {
                        return rejectedContent('malformed-record', 'THE MULTI-ROLE LAW', 'validateActivationJourneyRecord: the composed roles session carries at least one role (the REAL DH-03 floor - one user may hold MULTIPLE roles, never zero)', ['roles']);
                }
                if (session.roles.length > MAX_ROLES) {
                        return rejectedContent('malformed-record', 'THE MULTI-ROLE LAW', `validateActivationJourneyRecord: the composed roles session carries at most MAX_ROLES (${MAX_ROLES}) roles (the REAL DH-03 composition bound, imported by reference)`, [String(session.roles.length)]);
                }
                if (candidate.industry !== null && session.industry !== candidate.industry) {
                        return rejectedContent('malformed-record', 'THE FAIL-CLOSED LAW', `validateActivationJourneyRecord: the roles session's industry '${session.industry}' disagrees with the journey's industry '${candidate.industry}' (the agreement law)`, [session.industry]);
                }
        }
        if (candidate.recordLinks !== null) {
                const links = candidate.recordLinks as Record<string, unknown>;
                const linkKeys = Object.keys(links);
                const unknownLinkKeys = linkKeys.filter((key) => !(COMPOSED_RECORD_LINKS_SCHEMA_KEYS as readonly string[]).includes(key));
                const missingLinkKeys = (COMPOSED_RECORD_LINKS_SCHEMA_KEYS as readonly string[]).filter((key) => !hasOwn(links, key));
                if (unknownLinkKeys.length > 0 || missingLinkKeys.length > 0) {
                        return rejectedContent('malformed-record', 'THE STRICT-SCHEMA LAW', `validateActivationJourneyRecord: the composed-links schema is closed - the six family keys are required, in the frozen family order (the offenders: ${showList([...unknownLinkKeys, ...missingLinkKeys.map((key) => `missing:${key}`)])})`, [...unknownLinkKeys, ...missingLinkKeys]);
                }
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
                                return rejectedContent('malformed-record', 'THE IMPORT LAW', `validateActivationJourneyRecord: the composed link '${key}' must satisfy the OWNING family's REAL id predicate, imported by reference (${showValue(links[key])})`, [key]);
                        }
                }
        }
        if (candidate.bindingHarnessId !== null && !isHarnessId(candidate.bindingHarnessId)) {
                return rejectedContent('malformed-record', 'THE IMPORT LAW', 'validateActivationJourneyRecord: the binding harness id must satisfy the REAL DH-01 id alphabet (flauz:hrn:<16-hex>, imported by reference)', [showValue(candidate.bindingHarnessId)]);
        }
        if (candidate.harnessId !== null && !isHarnessId(candidate.harnessId)) {
                return rejectedContent('malformed-record', 'THE IMPORT LAW', 'validateActivationJourneyRecord: the harness link must satisfy the REAL DH-01 id alphabet (flauz:hrn:<16-hex>, imported by reference)', [showValue(candidate.harnessId)]);
        }
        if (candidate.validation !== null) {
                if (!isHarnessValidationOutcome(candidate.validation)) {
                        return rejectedContent('malformed-record', 'THE IMPORT LAW', 'validateActivationJourneyRecord: the validation evidence must satisfy the REAL DH-01 isHarnessValidationOutcome predicate, imported by reference', ['validation']);
                }
                const validation = candidate.validation as HarnessValidationOutcome;
                if (!validation.ok || validation.mode !== 'full') {
                        return rejectedContent('malformed-record', 'THE TWO-PHASE LAW', 'validateActivationJourneyRecord: the journey records ONLY the proposal boundary\'s green FULL validation outcome (the real kit\'s answer at the draft->proposed advance)', ['validation']);
                }
        }
        if (candidate.approval !== null) {
                const approvalWalked = walkDecisionMirror(candidate.approval, 'approved');
                if (typeof approvalWalked === 'string') {
                        return rejectedContent('malformed-record', 'THE FAIL-CLOSED LAW', `validateActivationJourneyRecord: the approval evidence ${approvalWalked} (the EVIDENCE mirror of the real kit's own { approvedBy, note? } decision record - never the authority)`, ['approval']);
                }
        }
        if (candidate.activation !== null) {
                const activationWalked = walkDecisionMirror(candidate.activation, 'active');
                if (typeof activationWalked === 'string') {
                        return rejectedContent('malformed-record', 'THE FAIL-CLOSED LAW', `validateActivationJourneyRecord: the activation evidence ${activationWalked} (the EVIDENCE mirror of the real kit's own { activatedBy } decision record - never the authority)`, ['activation']);
                }
        }
        const historyWalked = walkHistory(candidate.history as unknown[]);
        if (typeof historyWalked === 'string') {
                return rejectedContent('malformed-record', 'THE FORWARD-ONLY LAW', `validateActivationJourneyRecord: ${historyWalked}`, ['history']);
        }
        return {
                ok: true,
                record: canonicalJourneyRecord(candidate as unknown as ActivationJourneyRecord),
        };
}

/**
 * The decision-mirror walk (the EVIDENCE shape - the real kit's own
 * walkDecision is the authority; this is the record's structural
 * mirror only): the approved shape carries only { approvedBy, note? },
 * the active shape only { activatedBy }, every value a non-empty
 * string.
 */
function walkDecisionMirror(decision: unknown, target: 'approved' | 'active'): Readonly<Record<string, string>> | string {
        if (!isRecord(decision)) {
                return `must be a plain object (the ${target} decision mirror)`;
        }
        const record = decision as Record<string, unknown>;
        const allowed = target === 'approved' ? ['approvedBy', 'note'] : ['activatedBy'];
        const keys = Object.keys(record);
        const unknownKeys = keys.filter((key) => !allowed.includes(key));
        if (unknownKeys.length > 0) {
                return `carries the unknown key '${unknownKeys[0]}' (the ${target} mirror is ${target === 'approved' ? '{ approvedBy, note? }' : '{ activatedBy }'})`;
        }
        const requiredKey = target === 'approved' ? 'approvedBy' : 'activatedBy';
        if (!hasOwn(record, requiredKey)) {
                return `requires the '${requiredKey}' key`;
        }
        for (const key of keys) {
                if (typeof record[key] !== 'string' || (record[key] as string).length === 0) {
                        return `carries a non-string or empty '${key}' value`;
                }
        }
        const canonical: Record<string, string> = {};
        for (const key of allowed) {
                if (hasOwn(record, key)) {
                        canonical[key] = record[key] as string;
                }
        }
        return canonical;
}

/**
 * The exported decision-mirror walk (the kit's replay payload station):
 * ok carries the canonical fixed-key-order decision mirror ({ approvedBy,
 * note? } for the approved target, { activatedBy } for the active
 * target); refusal carries the deterministic drift sentence. THE
 * EVIDENCE-NOT-AUTHORITY LAW: the mirror is the EVIDENCE record of the
 * real kit's own decision (never brokered, never the authority).
 */
export function validateJourneyDecisionMirror(decision: unknown, target: 'approved' | 'active'): { readonly ok: true; readonly value: Readonly<Record<string, string>> } | { readonly ok: false; readonly message: string } {
        const walked = walkDecisionMirror(decision, target);
        if (typeof walked === 'string') {
                return { ok: false, message: walked };
        }
        return { ok: true, value: walked };
}

/**
 * The history walk: every note is the frozen seven-key shape; the
 * note legs follow the frozen leg order (strictly increasing; the
 * begin note carries leg null and enters 'selection'); each note's
 * leg is one of its op's own legs; each note's toStage is the leg's
 * stage-table stage; the stage chain never breaks (fromStage = the
 * previous note's toStage).
 */
function walkHistory(history: readonly unknown[]): string | null {
        if (history.length === 0) {
                return 'the history must carry the begin note (the journey entered the walk at selection)';
        }
        let previousStage: ActivationJourneyStage | null = null;
        let previousLegIndex = -1;
        for (let i = 0; i < history.length; i += 1) {
                const note = history[i];
                if (!isRecord(note)) {
                        return `note ${i + 1} is not a plain object`;
                }
                const noteRecord = note as Record<string, unknown>;
                const keys = Object.keys(noteRecord);
                const expected = [...ACTIVATION_NOTE_SCHEMA_KEYS];
                if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
                        return `note ${i + 1} does not carry the frozen seven-key note schema in the canonical fixed-key order`;
                }
                if (typeof noteRecord.at !== 'string' || noteRecord.at.length === 0) {
                        return `note ${i + 1} carries no timestamp`;
                }
                if (!isActivationOpName(noteRecord.op)) {
                        return `note ${i + 1} carries an unknown op ${showValue(noteRecord.op)}`;
                }
                if (typeof noteRecord.law !== 'string' || noteRecord.law.length === 0) {
                        return `note ${i + 1} carries no law name (the provenance law)`;
                }
                if (typeof noteRecord.detail !== 'string' || noteRecord.detail.length === 0) {
                        return `note ${i + 1} carries no provenance detail`;
                }
                if (i === 0) {
                        if (noteRecord.op !== 'begin-journey' || noteRecord.leg !== null || noteRecord.fromStage !== null || noteRecord.toStage !== 'selection') {
                                return 'the first note must be the begin note (op begin-journey, leg null, fromStage null, toStage selection)';
                        }
                        previousStage = 'selection';
                        previousLegIndex = -1;
                        continue;
                }
                if (!isJourneyLeg(noteRecord.leg)) {
                        return `note ${i + 1} carries an unknown leg ${showValue(noteRecord.leg)} (null is legal ONLY on the begin note)`;
                }
                const leg = noteRecord.leg as JourneyLeg;
                const op = noteRecord.op as ActivationOpName;
                if (!(JOURNEY_OP_LEGS[op] as readonly string[]).includes(leg)) {
                        return `note ${i + 1} walks leg '${leg}' under op '${op}' - the leg is not one of the op's own legs (the frozen op<->leg table)`;
                }
                const legIndex = journeyLegIndex(leg);
                if (legIndex <= previousLegIndex) {
                        return `note ${i + 1} walks leg '${leg}' out of the frozen leg order (the journey legs never walk back; the proposal boundary spans the proposal and validation legs in that order)`;
                }
                previousLegIndex = legIndex;
                if (!isActivationJourneyStage(noteRecord.fromStage) || !isActivationJourneyStage(noteRecord.toStage)) {
                        return `note ${i + 1} carries an unknown stage`;
                }
                if (noteRecord.fromStage !== previousStage) {
                        return `note ${i + 1} breaks the stage chain (fromStage '${showValue(noteRecord.fromStage)}' != the walk's current stage '${previousStage}')`;
                }
                const expectedToStage = JOURNEY_LEG_STAGES[leg];
                if (noteRecord.toStage !== expectedToStage) {
                        return `note ${i + 1} walks leg '${leg}' to stage '${showValue(noteRecord.toStage)}' - the frozen leg<->stage table lands '${expectedToStage}'`;
                }
                previousStage = expectedToStage;
        }
        return null;
}

/** Pure predicate: a well-formed journey record (the deep walk's ok verdict). */
export function isActivationJourneyRecord(value: unknown): value is ActivationJourneyRecord {
        return validateActivationJourneyRecord(value).ok;
}

// --- the canonical serialization + the fail-closed parse ---

/** Builds the canonical fixed-key-order object of a composed-links record. */
function canonicalLinksObject(links: ComposedRecordLinks): Record<string, string> {
        return {
                ontologyId: links.ontologyId,
                templateId: links.templateId,
                bodyId: links.bodyId,
                packsId: links.packsId,
                profilesId: links.profilesId,
                benchmarksId: links.benchmarksId,
        };
}

/** Builds the canonical fixed-key-order object of a DH-03 roles session (the owning family's own frozen key order). */
function canonicalRolesSessionObject(session: RoleCompositionSession): Record<string, unknown> {
        return {
                sessionId: session.sessionId,
                industry: session.industry,
                stage: session.stage,
                roles: session.roles.map((role) => ({ roleKey: role.roleKey, summary: role.summary })),
                history: session.history.map((note) => ({
                        at: note.at,
                        fromStage: note.fromStage,
                        toStage: note.toStage,
                        op: note.op,
                        law: note.law,
                        detail: note.detail,
                })),
        };
}

/** Builds the canonical fixed-key-order object of a green full validation outcome (the DH-01 descriptor's own frozen key order). */
function canonicalValidationObject(outcome: HarnessValidationOutcome): Record<string, unknown> {
        if (!outcome.ok) {
                // Fail closed: a refusal outcome never gets canonical journey bytes
                // (the deep walk admits ONLY the green full outcome - see the
                // validation station below).
                throw new TypeError('canonicalValidationObject: only the green full validation outcome carries canonical journey bytes');
        }
        const descriptor = outcome.descriptor;
        return {
                ok: true,
                mode: outcome.mode,
                descriptor: {
                        harnessId: descriptor.harnessId,
                        contractVersion: descriptor.contractVersion,
                        industry: descriptor.industry,
                        workTypes: [...descriptor.workTypes],
                        displayName: descriptor.displayName,
                        roles: descriptor.roles.map((role) => ({ roleKey: role.roleKey, summary: role.summary })),
                        capabilityRefs: [...descriptor.capabilityRefs],
                        workflowRefs: [...descriptor.workflowRefs],
                        policyRefs: [...descriptor.policyRefs],
                        evidenceRefs: [...descriptor.evidenceRefs],
                },
        };
}

/** Builds the canonical fixed-key-order object of a journey record. */
function canonicalJourneyRecordObject(record: ActivationJourneyRecord): Record<string, unknown> {
        return {
                journeyId: record.journeyId,
                contractVersion: record.contractVersion,
                stage: record.stage,
                industry: record.industry,
                companyProfile: record.companyProfile === null ? null : { displayName: record.companyProfile.displayName, sizeBand: record.companyProfile.sizeBand },
                workTypes: record.workTypes === null ? null : [...record.workTypes],
                rolesSession: record.rolesSession === null ? null : canonicalRolesSessionObject(record.rolesSession),
                recordLinks: record.recordLinks === null ? null : canonicalLinksObject(record.recordLinks),
                bindingHarnessId: record.bindingHarnessId,
                harnessId: record.harnessId,
                validation: record.validation === null ? null : canonicalValidationObject(record.validation),
                approval: record.approval === null ? null : { ...record.approval },
                activation: record.activation === null ? null : { ...record.activation },
                onboardingSessionId: record.onboardingSessionId,
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

/** The canonical fixed-key-order copy of a validated journey record (the honest copy handed to callers). */
function canonicalJourneyRecord(record: ActivationJourneyRecord): ActivationJourneyRecord {
        return JSON.parse(JSON.stringify(canonicalJourneyRecordObject(record))) as ActivationJourneyRecord;
}

/**
 * THE CANONICAL SERIALIZATION: the validated journey record -> the
 * canonical fixed-key-order bytes (every nested shape in its OWNING
 * family's frozen key order). A record that fails the deep walk never
 * gets canonical bytes (a TypeError - no dishonest evidence ever gets
 * canonical form).
 */
export function serializeActivationJourney(record: unknown): string {
        if (!isActivationJourneyRecord(record)) {
                throw new TypeError('serializeActivationJourney: record must satisfy isActivationJourneyRecord - no dishonest journey evidence ever gets canonical bytes');
        }
        return JSON.stringify(canonicalJourneyRecordObject(record));
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
 *                              other than ACTIVATION_CONTRACTS_VERSION;
 *   unknown-key              - an extra key at the record, links,
 *                              session, decision or note level
 *                              (tampered bytes);
 *   invalid-record           - the deep semantic walk refuses (the
 *                              frozen taxonomy of
 *                              validateActivationJourneyRecord).
 */
export const ACTIVATION_PARSE_REJECTION_REASONS = [
        'malformed-json',
        'torn-envelope',
        'unknown-contract-version',
        'unknown-key',
        'invalid-record',
] as const;
export type ActivationParseRejectionReason = (typeof ACTIVATION_PARSE_REJECTION_REASONS)[number];

/** Pure predicate over the closed parse-rejection list. */
export function isActivationParseRejectionReason(value: unknown): value is ActivationParseRejectionReason {
        return (ACTIVATION_PARSE_REJECTION_REASONS as readonly string[]).includes(value as string);
}

/** The typed parse rejection: the frozen reason and the drift-naming message. */
export interface ActivationParseRejection {
        readonly reason: ActivationParseRejectionReason;
        readonly message: string;
}

/** The typed parse outcome: ok carries the validated record; failure names the drift. */
export type ActivationParseOutcome =
        | { readonly ok: true; readonly record: ActivationJourneyRecord }
        | { readonly ok: false; readonly rejection: ActivationParseRejection };

/**
 * THE FAIL-CLOSED PARSE: bytes -> the typed parse outcome. Malformed
 * JSON, a torn envelope, an unknown contract version, an unknown key
 * (record / links / session / decision / note level) or invalid
 * content (the deep journey walk) - each a typed rejection naming the
 * drift; never a silent partial parse. First-failure-is-the-verdict,
 * in the frozen ACTIVATION_PARSE_REJECTION_REASONS order.
 */
export function parseActivationJourney(bytes: unknown): ActivationParseOutcome {
        if (typeof bytes !== 'string') {
                return { ok: false, rejection: { reason: 'torn-envelope', message: 'parseActivationJourney: bytes must be a string (the canonical fixed-key-order journey bytes)' } };
        }
        let parsed: unknown;
        try {
                parsed = JSON.parse(bytes);
        } catch (error) {
                return { ok: false, rejection: { reason: 'malformed-json', message: `parseActivationJourney: the bytes are not valid JSON: ${toMessage(error)}` } };
        }
        if (!isRecord(parsed)) {
                return { ok: false, rejection: { reason: 'torn-envelope', message: 'parseActivationJourney: the bytes must carry a JSON object (the journey-record envelope)' } };
        }
        const record = parsed as Record<string, unknown>;
        for (const key of ACTIVATION_JOURNEY_RECORD_SCHEMA_KEYS) {
                if (!hasOwn(record, key)) {
                        return { ok: false, rejection: { reason: 'torn-envelope', message: `parseActivationJourney: the '${key}' key is missing (a torn write - never a silent partial parse)` } };
                }
        }
        if (
                typeof record.journeyId !== 'string' ||
                typeof record.contractVersion !== 'string' ||
                typeof record.stage !== 'string' ||
                typeof record.createdAtIso !== 'string' ||
                typeof record.revision !== 'number' ||
                !Array.isArray(record.history) ||
                (record.industry !== null && typeof record.industry !== 'string') ||
                (record.companyProfile !== null && !isRecord(record.companyProfile)) ||
                (record.workTypes !== null && !Array.isArray(record.workTypes)) ||
                (record.rolesSession !== null && !isRecord(record.rolesSession)) ||
                (record.recordLinks !== null && !isRecord(record.recordLinks)) ||
                (record.bindingHarnessId !== null && typeof record.bindingHarnessId !== 'string') ||
                (record.harnessId !== null && typeof record.harnessId !== 'string') ||
                (record.validation !== null && !isRecord(record.validation)) ||
                (record.approval !== null && !isRecord(record.approval)) ||
                (record.activation !== null && !isRecord(record.activation)) ||
                (record.onboardingSessionId !== null && typeof record.onboardingSessionId !== 'string')
        ) {
                return { ok: false, rejection: { reason: 'torn-envelope', message: 'parseActivationJourney: the record envelope carries a value of the wrong structural type (a torn write - never a silent partial parse)' } };
        }
        if (record.contractVersion !== ACTIVATION_CONTRACTS_VERSION) {
                return { ok: false, rejection: { reason: 'unknown-contract-version', message: `parseActivationJourney: the record carries contract version '${record.contractVersion}' - only '${ACTIVATION_CONTRACTS_VERSION}' is known (the single-version law)` } };
        }
        const unknownRecordKeys = Object.keys(record).filter((key) => !(ACTIVATION_JOURNEY_RECORD_SCHEMA_KEYS as readonly string[]).includes(key));
        if (unknownRecordKeys.length > 0) {
                return { ok: false, rejection: { reason: 'unknown-key', message: `parseActivationJourney: the record carries the unknown key '${unknownRecordKeys[0]}' (the strict journey schema is closed)` } };
        }
        const links = record.recordLinks as Record<string, unknown> | null;
        if (links !== null) {
                const unknownLinkKeys = Object.keys(links).filter((key) => !(COMPOSED_RECORD_LINKS_SCHEMA_KEYS as readonly string[]).includes(key));
                if (unknownLinkKeys.length > 0) {
                        return { ok: false, rejection: { reason: 'unknown-key', message: `parseActivationJourney: the composed links carry the unknown key '${unknownLinkKeys[0]}' (the six-family link schema is closed)` } };
                }
        }
        const session = record.rolesSession as Record<string, unknown> | null;
        if (session !== null) {
                const unknownSessionKeys = Object.keys(session).filter((key) => key !== 'sessionId' && key !== 'industry' && key !== 'stage' && key !== 'roles' && key !== 'history');
                if (unknownSessionKeys.length > 0) {
                        return { ok: false, rejection: { reason: 'unknown-key', message: `parseActivationJourney: the roles session carries the unknown key '${unknownSessionKeys[0]}' (the REAL DH-03 five-key session schema, imported by reference)` } };
                }
        }
        const approval = record.approval as Record<string, unknown> | null;
        if (approval !== null) {
                const unknownApprovalKeys = Object.keys(approval).filter((key) => key !== 'approvedBy' && key !== 'note');
                if (unknownApprovalKeys.length > 0) {
                        return { ok: false, rejection: { reason: 'unknown-key', message: `parseActivationJourney: the approval mirror carries the unknown key '${unknownApprovalKeys[0]}' (the { approvedBy, note? } evidence shape)` } };
                }
        }
        const activation = record.activation as Record<string, unknown> | null;
        if (activation !== null) {
                const unknownActivationKeys = Object.keys(activation).filter((key) => key !== 'activatedBy');
                if (unknownActivationKeys.length > 0) {
                        return { ok: false, rejection: { reason: 'unknown-key', message: `parseActivationJourney: the activation mirror carries the unknown key '${unknownActivationKeys[0]}' (the { activatedBy } evidence shape)` } };
                }
        }
        const history = record.history as unknown[];
        for (let i = 0; i < history.length; i += 1) {
                const note = history[i];
                if (!isRecord(note)) {
                        return { ok: false, rejection: { reason: 'torn-envelope', message: `parseActivationJourney: history note ${i + 1} is not a JSON object (a torn write)` } };
                }
                const unknownNoteKeys = Object.keys(note as Record<string, unknown>).filter((key) => !(ACTIVATION_NOTE_SCHEMA_KEYS as readonly string[]).includes(key));
                if (unknownNoteKeys.length > 0) {
                        return { ok: false, rejection: { reason: 'unknown-key', message: `parseActivationJourney: history note ${i + 1} carries the unknown key '${unknownNoteKeys[0]}' (the frozen seven-key note schema)` } };
                }
        }
        const deep = validateActivationJourneyRecord(parsed);
        if (!deep.ok) {
                return { ok: false, rejection: { reason: 'invalid-record', message: `parseActivationJourney: the deep journey walk refuses: ${deep.rejection.message}` } };
        }
        return { ok: true, record: deep.record };
}

// --- the shared helpers (the family pattern's private block) ---

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

function toMessage(error: unknown): string {
        if (error instanceof Error) {
                return error.message;
        }
        return String(error);
}
