/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * DH-008 policy/approval/evidence/KPI profiles contract family: the
 * typed domain profile-defaults layer for the Domain Harness OS
 * direction (WORK-REGISTRY.md - registry row DH-008 "domain
 * policy/approval/evidence/KPI profiles"; ARCHITECTURE-LOCK 12.5: a
 * harness may compose "policies/approvals, evidence requirements,
 * KPIs" - a harness over the universal Flauz core, never a fork).
 * A harness is domain-specific through its industry label (DH-01),
 * its onboarding record (DH-02), its named roles (DH-03), its domain
 * terms (DH-04), its task/workflow templates (DH-05), its
 * organization's default agent bodies (DH-06) and its default
 * capability packs (DH-07) - and through its POLICY / APPROVAL /
 * EVIDENCE / KPI PROFILES: the named default profiles that scope
 * which permissions the domain's work runs under, which risk tiers
 * its approvals gate, which evidence floor its work must clear and
 * which KPI dimensions it is judged on. This family is the
 * DOMAIN-SIDE DEFAULTS layer for those profiles: a typed, staged,
 * deterministic profiles record family bound to a harness, composing
 * profile entries (configuration only), with the family's
 * validation, serialization and persistence laws.
 *
 * THE NO-NEW-AUTHORITY LAW (binding, ARCHITECTURE-LOCK 12.6 - this
 * family's charter): this contract declares DEFAULTS that REFERENCE
 * the permission/approval/evidence authorities - it grants no
 * permission, brokers no approval, leads no evidence, schedules
 * nothing, executes nothing. The permission vocabulary is the REAL
 * ZC-006 capability-pack catalog's permission table (imported by
 * reference); the approval-tier vocabulary is that same catalog's
 * REAL risk tiers (imported by reference); the evidence ladder is
 * the REAL Lab evidence ladder LabEvidenceLevel (the imported type);
 * the KPI dimensions are the REAL Lab EvalDimension vocabulary (the
 * imported type). A profile is TYPED CONFIGURATION over those real
 * vocabularies - a second permission broker, approval engine or
 * evidence ledger is forbidden here (ARCHITECTURE-LOCK 12.6).
 *
 * LAWS (the DH-008 work order; the landed family precedents,
 * inherited and binding):
 * - THE NO-FORK LAW (binding, the family charter): a profile entry
 *   is CONFIGURATION (a profileKey plus a human summary plus its
 *   permission references, its approval tiers, its evidence floor
 *   and its KPI dimensions, EXACTLY six keys); it grants NOTHING by
 *   itself. The structural engine's profile station: any additional
 *   key on a profile entry is the typed no-fork rejection.
 * - THE IMPORT LAW (binding, this wave's charter): the harness-id
 *   alphabet, the landed family versions, the REAL permission
 *   vocabulary, the REAL risk tiers, the REAL evidence ladder and
 *   the REAL eval dimensions are IMPORTED from the real modules -
 *   never re-declared, re-implemented or shadowed (the battery pins
 *   the imports). The permission ids, the risk tiers and their
 *   table are value imports from the REAL catalog module; the
 *   evidence ladder and the eval dimensions are TYPE imports from
 *   the REAL lab contracts module, whose runtime membership tables
 *   are the pinned type-exhaustive mirrors below (the catalog
 *   module's own pinned-mirror precedent: a projection of the real
 *   vocabulary, never a second authority - the module cannot compile
 *   if the real union drifts in either direction, and the battery
 *   pins the derived sets against the real vocabularies).
 * - THE AUTHORITY-BINDING LAW (binding): permissionRefs satisfy the
 *   REAL isCatalogPermissionId predicate; approvalTiers are members
 *   of the REAL CATALOG_PERMISSION_RISK_TIERS list; the
 *   evidenceFloor is a member of the REAL LabEvidenceLevel ladder;
 *   kpiDimensions are members of the REAL EvalDimension vocabulary
 *   - every one imported, never transcribed. Membership in the real
 *   vocabulary is the ONLY admissibility; this family declares no
 *   vocabulary of its own.
 * - THE CONTENT LAW (binding, this wave's honesty): NO per-industry
 *   profile content is shipped - this wave ships the LAYER, the
 *   machinery, not domain content (the registry's DH-002 precedent
 *   "industry templates are LATER waves - do not invent them"
 *   applied verbatim to policy/approval/evidence/KPI profiles; an
 *   invented legal / medical / finance policy vocabulary would be an
 *   unsourced fork of domain truth). The caller composes the
 *   profiles; this family never invents them.
 * - THE FROZEN-VOCABULARY LAW (binding): the harnessId must satisfy
 *   the REAL DH-01 harness-id alphabet (the FORM law - the
 *   EXISTENCE binding is the caller's wiring, never this layer's).
 * - THE FORWARD-ONLY LAW / THE APPEND-ONLY LINEAGE LAW (binding):
 *   composing -> composed; 'composed' is TERMINAL (a frozen record;
 *   every mutating op on a composed record refuses with the stage
 *   law); a changed profile is a NEW profile, never a mutation of a
 *   composed one.
 * - THE PROFILE LAWS (binding, frozen constants): the profileKey is
 *   non-empty, at most PROFILE_KEY_MAX_LENGTH (64) characters,
 *   carries NO leading or trailing whitespace and no control
 *   characters; the summary is non-empty, at most
 *   PROFILE_SUMMARY_MAX_LENGTH (200) characters and carries no
 *   control characters; the record holds at most MAX_PROFILES (64)
 *   profiles; profileKeys are unique within the record;
 *   permissionRefs is a duplicate-free string array whose members
 *   satisfy the REAL catalog predicate, MAY be empty (the
 *   honest-gap law: a profile MAY name zero permissions); approvalTiers
 *   is a duplicate-free array of REAL risk tiers, MAY be empty (a
 *   profile MAY gate zero tiers); the evidenceFloor is EXACTLY ONE
 *   REAL ladder member per profile (the domain's minimum evidence
 *   requirement - never overstated); kpiDimensions is a
 *   duplicate-free array of REAL eval dimensions, MAY be empty (the
 *   honest gap: a profile MAY judge zero dimensions); at least one
 *   profile at finalize (the empty-profiles floor fires THERE, never
 *   the record shape - a composing record may hold zero).
 * - THE DETERMINISM LAW (binding): no Math.random, no Date.now, no
 *   new Date(...) and no process.env in this module (law comments
 *   excepted) - the module is pure vocabulary over typed values; the
 *   clock and the rng are INJECTED at the kit boundary; the
 *   serialization is canonical fixed-key-order bytes with the
 *   entries sorted deterministically by profileKey.
 * - THE FAIL-CLOSED LAW (binding): every refusal is a typed record
 *   naming the violated law and the offending items; no silent
 *   successes, no partial effects, never a bare throw on a domain
 *   refusal; multi-offense validations report the COMPLETE rejection
 *   table in the frozen walk order.
 * - THE SINGLE-VERSION LAW (binding): PROFILES_CONTRACTS_VERSION is
 *   '1.0.0' declared ONCE here, re-carried by the kit;
 *   DOMAIN_HARNESS_CONTRACTS_VERSION, ONBOARDING_CONTRACTS_VERSION,
 *   ROLES_CONTRACTS_VERSION, ONTOLOGY_CONTRACTS_VERSION,
 *   TEMPLATES_CONTRACTS_VERSION, BODIES_CONTRACTS_VERSION and
 *   PACKS_CONTRACTS_VERSION are declared ONCE in THEIR modules and
 *   re-carried here by reference (the battery pins every copy
 *   equal).
 * - Zero external dependencies: this module is pure vocabulary over
 *   typed values; no I/O, no clock, no env read.
 */

import { isHarnessId } from '../../contract/common/domainHarnessContract.js';
import {
        CATALOG_PERMISSION_IDS,
        CATALOG_PERMISSION_RISK_TIERS,
        CATALOG_PERMISSION_TABLE,
        isCatalogPermissionId,
        isCatalogPermissionRiskTier,
} from '../../../capabilities/packs/common/catalog.js';
import type { LabEvidenceLevel, EvalDimension } from '../../../lab/common/labContracts.js';

/**
 * THE IMPORT LAW's re-export block: the REAL DH-01 harness-id
 * alphabet, the seven landed contract versions and the REAL
 * permission/approval vocabularies (the ZC-006 catalog's permission
 * ids, risk tiers and table) are re-exported BY REFERENCE (the same
 * bindings, never re-declared copies). The battery pins referential
 * identity against the real modules.
 */
export {
        DOMAIN_HARNESS_CONTRACTS_VERSION,
        HARNESS_ID_PREFIX,
        HARNESS_INDUSTRIES,
        isHarnessId,
        isHarnessIndustry,
} from '../../contract/common/domainHarnessContract.js';
export type { HarnessIndustry } from '../../contract/common/domainHarnessContract.js';
export { ONBOARDING_CONTRACTS_VERSION } from '../../onboarding/common/onboardingContract.js';
export { ROLES_CONTRACTS_VERSION } from '../../roles/common/rolesContract.js';
export { ONTOLOGY_CONTRACTS_VERSION } from '../../ontology/common/ontologyContract.js';
export { TEMPLATES_CONTRACTS_VERSION } from '../../templates/common/templatesContract.js';
export { BODIES_CONTRACTS_VERSION } from '../../bodies/common/bodiesContract.js';
export { PACKS_CONTRACTS_VERSION } from '../../packs/common/packsContract.js';
export {
        CATALOG_PERMISSION_IDS,
        CATALOG_PERMISSION_RISK_TIERS,
        CATALOG_PERMISSION_TABLE,
        isCatalogPermissionId,
        isCatalogPermissionRiskTier,
} from '../../../capabilities/packs/common/catalog.js';
export type { CatalogPermissionId, CatalogPermissionRiskTier } from '../../../capabilities/packs/common/catalog.js';
export type { LabEvidenceLevel, EvalDimension } from '../../../lab/common/labContracts.js';

/** THE SINGLE-VERSION LAW: PROFILES_CONTRACTS_VERSION is declared ONCE here, re-carried by the kit. */
export const PROFILES_CONTRACTS_VERSION = '1.0.0';

/**
 * The profiles record id prefix (this family's namespace; the same id
 * law as flauz:hrn: / flauz:onb: / flauz:rol: / flauz:ont: /
 * flauz:tpl: / flauz:bod: / flauz:pak: - the kit mints
 * <prefix><16 lowercase hex> from the injected rng).
 */
export const PROFILES_ID_PREFIX = 'flauz:prf:';

/**
 * THE AUTHORITY-BINDING LAW's pinned type-exhaustive mirror of the
 * REAL evidence ladder (the lab contracts module exports the
 * LabEvidenceLevel union type; there is no runtime list to import).
 * The Record key set is checked EXHAUSTIVELY against the imported
 * union at compile time - a rung added to or removed from the REAL
 * ladder breaks this module's compilation until the mirror is
 * reconciled (the catalog module's pinned-mirror discipline: a
 * projection, never a second authority). The derived frozen list is
 * the runtime membership table; the battery pins it against the real
 * six-rung ladder.
 */
const EVIDENCE_LADDER_MEMBERS: Readonly<Record<LabEvidenceLevel, true>> = {
        'fixture': true,
        'simulated': true,
        'local-real': true,
        'runtime-real': true,
        'live-provider': true,
        'production-real': true,
};

/**
 * The REAL evidence ladder as a runtime list (derived from the pinned
 * type-exhaustive mirror above; deterministic insertion order - the
 * ladder's own order, lowest rung first).
 */
export const PROFILES_EVIDENCE_LADDER: readonly LabEvidenceLevel[] = Object.freeze([...(Object.keys(EVIDENCE_LADDER_MEMBERS) as LabEvidenceLevel[])]);

/**
 * THE AUTHORITY-BINDING LAW's pinned type-exhaustive mirror of the
 * REAL eval-dimension vocabulary (the lab contracts module exports
 * the EvalDimension union type; there is no runtime list to import).
 * The Record key set is checked EXHAUSTIVELY against the imported
 * union at compile time - the same pinned-mirror discipline.
 */
const EVAL_DIMENSION_MEMBERS: Readonly<Record<EvalDimension, true>> = {
        'success': true,
        'quality': true,
        'latency': true,
        'cost': true,
};

/**
 * The REAL eval dimensions as a runtime list (derived from the pinned
 * type-exhaustive mirror above; deterministic insertion order).
 */
export const PROFILES_EVAL_DIMENSIONS: readonly EvalDimension[] = Object.freeze([...(Object.keys(EVAL_DIMENSION_MEMBERS) as EvalDimension[])]);

/** Pure predicate: a member of the REAL LabEvidenceLevel ladder (the imported vocabulary, by mirror). */
export function isLabEvidenceLevel(value: unknown): value is LabEvidenceLevel {
        return typeof value === 'string' && (PROFILES_EVIDENCE_LADDER as readonly string[]).includes(value);
}

/** Pure predicate: a member of the REAL EvalDimension vocabulary (the imported vocabulary, by mirror). */
export function isEvalDimension(value: unknown): value is EvalDimension {
        return typeof value === 'string' && (PROFILES_EVAL_DIMENSIONS as readonly string[]).includes(value);
}

/**
 * The closed frozen stage vocabulary: the profiles walk's two stages.
 * 'composed' is TERMINAL (a frozen record; every mutating op on a
 * composed record refuses with the stage law; THE APPEND-ONLY LINEAGE
 * LAW: a changed profile is a NEW profile, never a mutation of a
 * composed one).
 */
export const PROFILES_STAGES = [
        'composing',
        'composed',
] as const;
export type ProfilesStage = (typeof PROFILES_STAGES)[number];

/** Pure predicate over the closed stage list. */
export function isProfilesStage(value: unknown): value is ProfilesStage {
        return (PROFILES_STAGES as readonly string[]).includes(value as string);
}

/** One whitelisted forward stage transition row (THE FORWARD-ONLY LAW's whitelist). */
export interface ProfilesStageTransition {
        readonly from: ProfilesStage;
        readonly to: ProfilesStage;
}

/**
 * The frozen forward-only whitelist: the ONLY legal stage transition
 * is composing->composed. 'composed' is TERMINAL - no reopen; a
 * changed profile is a NEW profile (THE APPEND-ONLY LINEAGE LAW).
 * Widening the map is a versioned contract decision.
 */
export const PROFILES_FORWARD_TRANSITIONS = [
        { from: 'composing', to: 'composed' },
] as const;

/**
 * The typed stage verdict: ok carries the granting whitelist row
 * (1-based); refusal is the ILLEGAL_TRANSITION rejection naming the
 * violated whitelist row (the row whose from-stage matches, null when
 * none does), the whitelisted successor (expectedTo, null when the
 * from-stage is terminal or unknown), and the deterministic detail
 * sentence. Forward-only; 'composed' is TERMINAL.
 */
export type ProfilesStageVerdict =
        | { readonly ok: true; readonly from: ProfilesStage; readonly to: ProfilesStage; readonly row: number }
        | {
                        readonly ok: false;
                        readonly reason: 'ILLEGAL_TRANSITION';
                        readonly from: unknown;
                        readonly to: unknown;
                        readonly whitelistRow: number | null;
                        readonly expectedTo: ProfilesStage | null;
                        readonly detail: string;
                };

/**
 * THE FORWARD-ONLY LAW's verdict machine (pure): the exact whitelist
 * membership check (mirroring the DH-006/DH-007 semantics exactly).
 * The only legal transition is composing->composed; every other edge
 * (self-loops, composed->anything, unknown stages, non-strings) is
 * the typed ILLEGAL_TRANSITION rejection naming the violated
 * whitelist row.
 */
export function canTransitionProfilesStage(from: unknown, to: unknown): ProfilesStageVerdict {
        const transitions = PROFILES_FORWARD_TRANSITIONS as readonly ProfilesStageTransition[];
        let rowNumber = 0;
        for (let i = 0; i < transitions.length; i += 1) {
                if (transitions[i].from === from) {
                        rowNumber = i + 1;
                        break;
                }
        }
        if (!isProfilesStage(from) || !isProfilesStage(to)) {
                return {
                        ok: false,
                        reason: 'ILLEGAL_TRANSITION',
                        from,
                        to,
                        whitelistRow: rowNumber > 0 ? rowNumber : null,
                        expectedTo: rowNumber > 0 ? transitions[rowNumber - 1].to : null,
                        detail: `canTransitionProfilesStage: '${showValue(from)}' -> '${showValue(to)}' is refused - both stages must be members of the frozen PROFILES_STAGES list (THE FORWARD-ONLY LAW - the stage vocabulary is frozen)`,
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
                        detail: `canTransitionProfilesStage: '${from}' -> '${to}' is refused - 'composed' is TERMINAL (the record is FROZEN; a changed profile is a NEW profile, THE APPEND-ONLY LINEAGE LAW) (THE FORWARD-ONLY LAW)`,
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
                        detail: `canTransitionProfilesStage: '${from}' -> '${to}' is refused - the only whitelisted forward transition from '${from}' is row ${rowNumber} ('${from}' -> '${expectedTo}') (THE FORWARD-ONLY LAW - forward-only; composed is terminal)`,
                };
        }
        return { ok: true, from, to, row: rowNumber };
}

/**
 * The profile laws (all frozen constants): the profileKey is
 * non-empty, at most 64 characters, carries NO leading/trailing
 * whitespace and no control characters; the summary is non-empty, at
 * most 200 characters and carries no control characters; the record
 * holds at most MAX_PROFILES (64) profiles.
 */
export const PROFILE_KEY_MAX_LENGTH = 64;

/** The summary bound (non-empty, at most 200 characters, no control characters). */
export const PROFILE_SUMMARY_MAX_LENGTH = 200;

/** The composition bound (at most 64 profiles; the empty floor fires at finalize). */
export const MAX_PROFILES = 64;

/**
 * The frozen profiles op-name vocabulary (the ledger line ops).
 */
export const PROFILES_OP_NAMES = [
        'begin-profiles',
        'add-profile',
        'replace-profile-summary',
        'remove-profile',
        'finalize-profiles',
] as const;
export type ProfilesOpName = (typeof PROFILES_OP_NAMES)[number];

/** Pure predicate over the closed op-name list. */
export function isProfilesOpName(value: unknown): value is ProfilesOpName {
        return (PROFILES_OP_NAMES as readonly string[]).includes(value as string);
}

/**
 * One provenance note in the record history: which clock reading the
 * op landed at, the stage edge it walked (fromStage null ONLY on the
 * begin note - the entry into 'composing'; the profile ops are the
 * composing->composing self edge - the domain composes its default
 * profiles gradually), which op and which law granted it, and the
 * deterministic detail sentence.
 */
export interface ProfilesTransitionNote {
        readonly at: string;
        readonly fromStage: ProfilesStage | null;
        readonly toStage: ProfilesStage;
        readonly op: ProfilesOpName;
        readonly law: string;
        readonly detail: string;
}

/**
 * THE PROFILE LAWS' configuration entry: a profileKey plus a human
 * summary plus its permission references, its approval tiers, its
 * evidence floor and its KPI dimensions, EXACTLY six keys (THE
 * NO-FORK LAW's profile station: any additional key is the typed
 * no-fork rejection). A profile is CONFIGURATION; it grants NOTHING
 * by itself. permissionRefs is a duplicate-free string array whose
 * members satisfy the REAL catalog predicate, MAY be empty (the
 * honest-gap law); approvalTiers is a duplicate-free array of REAL
 * risk tiers, MAY be empty; the evidenceFloor is EXACTLY ONE REAL
 * ladder member; kpiDimensions is a duplicate-free array of REAL
 * eval dimensions, MAY be empty.
 */
export interface ProfileEntry {
        readonly profileKey: string;
        readonly summary: string;
        readonly permissionRefs: readonly string[];
        readonly approvalTiers: readonly string[];
        readonly evidenceFloor: string;
        readonly kpiDimensions: readonly string[];
}

/**
 * The persisted per-record honest record (THE FIVE-KEY MODEL): the
 * record id (flauz:prf:<16-hex>), the bound harness id (the REAL
 * DH-01 flauz:hrn:<16-hex> form - the FORM law here; the EXISTENCE
 * binding is the caller's wiring, pinned in the battery through the
 * real DH-01 kit), the stage, the composed profiles (MAY be empty
 * while composing - the empty floor fires at finalize, never the
 * record shape), and the full op history with provenance. The record
 * carries NO contractVersion field: THE SINGLE-VERSION LAW is
 * enforced at the kit-layer persistence surfaces (every ledger line
 * and the envelope carry PROFILES_CONTRACTS_VERSION; a drift there
 * is the typed version-mismatch). Stage-vs-payload consistency is
 * the ledger replay's cross-check, never this shape's (the DH-01
 * guard discipline).
 */
export interface ProfilesRecord {
        readonly profilesId: string;
        readonly harnessId: string;
        readonly stage: ProfilesStage;
        readonly profiles: readonly ProfileEntry[];
        readonly history: readonly ProfilesTransitionNote[];
}

/** The frozen record schema keys, in the canonical fixed-key-order (the serialization order). */
export const PROFILES_RECORD_SCHEMA_KEYS = [
        'profilesId',
        'harnessId',
        'stage',
        'profiles',
        'history',
] as const;

/** The frozen history-note schema keys, in the canonical fixed-key-order. */
export const PROFILES_NOTE_SCHEMA_KEYS = [
        'at',
        'fromStage',
        'toStage',
        'op',
        'law',
        'detail',
] as const;

/**
 * The frozen profile-entry schema keys, in the canonical
 * fixed-key-order (THE NO-FORK LAW's exact six-key alphabet: the
 * declared order profileKey, summary, permissionRefs, approvalTiers,
 * evidenceFloor, kpiDimensions).
 */
export const PROFILE_ENTRY_SCHEMA_KEYS = [
        'profileKey',
        'summary',
        'permissionRefs',
        'approvalTiers',
        'evidenceFloor',
        'kpiDimensions',
] as const;

/** Pure predicate: a well-formed profiles record id (flauz:prf:<16-hex>). */
export function isProfilesId(value: unknown): value is string {
        if (typeof value !== 'string') {
                return false;
        }
        if (!value.startsWith(PROFILES_ID_PREFIX)) {
                return false;
        }
        const hex = value.slice(PROFILES_ID_PREFIX.length);
        return /^[0-9a-f]{16}$/.test(hex);
}

/**
 * Closed frozen list of profiles rejection reasons, in the exact walk
 * order (the work order's stations are the complete closed walk - the
 * pure record vocabulary; the kit-layer stations - unknown-record,
 * version-mismatch, empty-profiles, premature-op, stale-stage,
 * unknown-profile - are declared ONCE in the kit module, this wave's
 * placement of the DH-006/DH-007 precedent's single-declaration
 * discipline one level up; the validation walks collect EVERY
 * violated law into the typed rejection table, the table's records
 * appearing in this order):
 *   malformed-record           - the candidate is not a plain object, a
 *                                carrier carries the wrong structural type
 *                                (a non-array profiles / history carrier),
 *                                or a profile entry is not a plain
 *                                object / its profileKey or summary
 *                                carrier is not a string;
 *   no-fork                    - THE NO-FORK LAW's profile station: a
 *                                profile entry carries a key beyond the
 *                                six-key profile alphabet (a profile is
 *                                CONFIGURATION - it grants NOTHING by
 *                                itself);
 *   unknown-key                - a key outside the frozen five-key record
 *                                schema;
 *   missing-key                - a required record key is absent;
 *   bad-harness-id             - the bound harnessId is not the REAL
 *                                DH-01 flauz:hrn:<16-hex> form (imported
 *                                by reference - the FORM law; the
 *                                EXISTENCE binding is the caller's
 *                                wiring, never this layer's);
 *   bad-stage                  - the stage is not a member of the frozen
 *                                PROFILES_STAGES list;
 *   bad-history                - a history note fails the frozen six-key
 *                                note shape;
 *   profile-key-length         - a profileKey is empty or longer than
 *                                PROFILE_KEY_MAX_LENGTH (64) characters;
 *   profile-key-whitespace     - a profileKey carries leading or
 *                                trailing whitespace;
 *   profile-key-control-chars  - a profileKey carries control characters
 *                                (C0/DEL/C1);
 *   summary-length             - a summary is empty or longer than
 *                                PROFILE_SUMMARY_MAX_LENGTH (200)
 *                                characters;
 *   summary-control-chars      - a summary carries control characters
 *                                (C0/DEL/C1);
 *   duplicate-profile-key      - profileKeys are not unique within the
 *                                record;
 *   max-profiles               - the record carries more than
 *                                MAX_PROFILES (64) profiles (the
 *                                composition bound);
 *   bad-permission-refs-carrier - a permissionRefs carrier is not an
 *                                array, or a member is not a string;
 *   bad-permission-ref         - THE AUTHORITY-BINDING LAW: a
 *                                permissionRef is not a member of the
 *                                REAL catalog vocabulary (the imported
 *                                isCatalogPermissionId predicate);
 *   duplicate-permission-ref   - a profile's permissionRefs carry
 *                                repeats;
 *   bad-approval-tiers-carrier - an approvalTiers carrier is not an
 *                                array, or a member is not a string;
 *   bad-approval-tier          - THE AUTHORITY-BINDING LAW: an
 *                                approvalTier is not a member of the
 *                                REAL CATALOG_PERMISSION_RISK_TIERS
 *                                list (imported by reference, never
 *                                transcribed);
 *   duplicate-approval-tier    - a profile's approvalTiers carry
 *                                repeats;
 *   bad-evidence-floor         - THE AUTHORITY-BINDING LAW: the
 *                                evidenceFloor is not a member of the
 *                                REAL LabEvidenceLevel ladder (exactly
 *                                one ladder member per profile - the
 *                                domain's minimum evidence requirement,
 *                                never overstated);
 *   bad-kpi-dimensions-carrier - a kpiDimensions carrier is not an
 *                                array, or a member is not a string;
 *   bad-kpi-dimension          - THE AUTHORITY-BINDING LAW: a
 *                                kpiDimension is not a member of the
 *                                REAL EvalDimension vocabulary;
 *   duplicate-kpi-dimension    - a profile's kpiDimensions carry
 *                                repeats.
 * Widening or reordering the list is a versioned contract decision.
 */
export const PROFILES_REJECTION_REASONS = [
        'malformed-record',
        'no-fork',
        'unknown-key',
        'missing-key',
        'bad-harness-id',
        'bad-stage',
        'bad-history',
        'profile-key-length',
        'profile-key-whitespace',
        'profile-key-control-chars',
        'summary-length',
        'summary-control-chars',
        'duplicate-profile-key',
        'max-profiles',
        'bad-permission-refs-carrier',
        'bad-permission-ref',
        'duplicate-permission-ref',
        'bad-approval-tiers-carrier',
        'bad-approval-tier',
        'duplicate-approval-tier',
        'bad-evidence-floor',
        'bad-kpi-dimensions-carrier',
        'bad-kpi-dimension',
        'duplicate-kpi-dimension',
] as const;
export type ProfilesRejectionReason = (typeof PROFILES_REJECTION_REASONS)[number];

/** Pure predicate over the closed rejection list. */
export function isProfilesRejectionReason(value: unknown): value is ProfilesRejectionReason {
        return (PROFILES_REJECTION_REASONS as readonly string[]).includes(value as string);
}

/**
 * One typed rejection from a validation walk: the frozen reason, the
 * violated law's name, the offending items, and the deterministic
 * detail sentence. NEVER a string throw, NEVER a silent skip.
 */
export interface ProfilesRejection {
        readonly reason: ProfilesRejectionReason;
        readonly law: string;
        readonly items?: readonly string[];
        readonly detail: string;
}

/**
 * The typed validation outcome (the family's outcome pattern, the
 * DH-04 OntologyValidationOutcome shape carrying the DH-01
 * complete-table law): ok carries the canonical value; refusal
 * carries the COMPLETE typed rejection table in the frozen walk order
 * - never first-only.
 */
export type ProfilesValidationOutcome<T> =
        | { readonly ok: true; readonly value: T }
        | { readonly ok: false; readonly mode: 'shape'; readonly rejections: readonly ProfilesRejection[] };

/**
 * The profileKey station walk (the split-station profile laws, the
 * family's per-key validator): malformed-record (the non-string
 * carrier) -> profile-key-length (the bound) ->
 * profile-key-whitespace (the padding) ->
 * profile-key-control-chars (the C0/DEL/C1 set), the complete table
 * over ONE key. Ok carries the profileKey string.
 */
export function validateProfileKey(profileKey: unknown): ProfilesValidationOutcome<string> {
        const rejections: ProfilesRejection[] = [];
        if (typeof profileKey !== 'string') {
                rejections.push({
                        reason: 'malformed-record',
                        law: 'THE FAIL-CLOSED LAW',
                        items: ['profileKey'],
                        detail: 'validateProfileKey: the profileKey must be a string (the profile\'s identity key)',
                });
                return { ok: false, mode: 'shape', rejections };
        }
        const lengthViolations = profileKeyLengthViolationsOf(profileKey);
        if (lengthViolations.length > 0) {
                rejections.push({
                        reason: 'profile-key-length',
                        law: 'THE FAIL-CLOSED LAW',
                        items: lengthViolations,
                        detail: `validateProfileKey: the profileKey must be a non-empty string of at most ${PROFILE_KEY_MAX_LENGTH} characters`,
                });
        }
        if (profileKey !== profileKey.trim()) {
                rejections.push({
                        reason: 'profile-key-whitespace',
                        law: 'THE FAIL-CLOSED LAW',
                        items: ['leading/trailing whitespace'],
                        detail: 'validateProfileKey: the profileKey must carry no leading or trailing whitespace',
                });
        }
        const keyControls = controlCharactersOf(profileKey);
        if (keyControls.length > 0) {
                rejections.push({
                        reason: 'profile-key-control-chars',
                        law: 'THE FAIL-CLOSED LAW',
                        items: keyControls,
                        detail: 'validateProfileKey: the profileKey must carry no control characters (C0/DEL/C1)',
                });
        }
        if (rejections.length > 0) {
                return { ok: false, mode: 'shape', rejections };
        }
        return { ok: true, value: profileKey };
}

/**
 * The summary station walk (the kit's replaceProfileSummary station):
 * malformed-record (the non-string carrier) -> summary-length (the
 * bound) -> summary-control-chars (the C0/DEL/C1 set). Ok carries the
 * summary string.
 */
export function validateProfileSummary(summary: unknown): ProfilesValidationOutcome<string> {
        const rejections: ProfilesRejection[] = [];
        if (typeof summary !== 'string') {
                rejections.push({
                        reason: 'malformed-record',
                        law: 'THE FAIL-CLOSED LAW',
                        items: ['summary'],
                        detail: 'validateProfileSummary: the summary must be a string (the profile\'s human summary)',
                });
                return { ok: false, mode: 'shape', rejections };
        }
        const lengthViolations = summaryLengthViolationsOf(summary);
        if (lengthViolations.length > 0) {
                rejections.push({
                        reason: 'summary-length',
                        law: 'THE FAIL-CLOSED LAW',
                        items: lengthViolations,
                        detail: `validateProfileSummary: the summary must be a non-empty string of at most ${PROFILE_SUMMARY_MAX_LENGTH} characters`,
                });
        }
        const summaryControls = controlCharactersOf(summary);
        if (summaryControls.length > 0) {
                rejections.push({
                        reason: 'summary-control-chars',
                        law: 'THE FAIL-CLOSED LAW',
                        items: summaryControls,
                        detail: 'validateProfileSummary: the summary must carry no control characters (C0/DEL/C1)',
                });
        }
        if (rejections.length > 0) {
                return { ok: false, mode: 'shape', rejections };
        }
        return { ok: true, value: summary };
}

/**
 * The single-profile station walk (the kit's addProfile station, the
 * family's per-payload validator architecture): malformed-record (the
 * non-object entry, the non-string profileKey / summary carriers) ->
 * no-fork -> profile-key-length -> profile-key-whitespace ->
 * profile-key-control-chars -> summary-length -> summary-control-chars
 * -> bad-permission-refs-carrier -> bad-permission-ref (the REAL
 * catalog predicate) -> duplicate-permission-ref ->
 * bad-approval-tiers-carrier -> bad-approval-tier (the REAL risk
 * tiers) -> duplicate-approval-tier -> bad-evidence-floor (the REAL
 * ladder) -> bad-kpi-dimensions-carrier -> bad-kpi-dimension (the
 * REAL eval dimensions) -> duplicate-kpi-dimension, the complete
 * table over ONE entry. Ok carries the canonical six-key copy.
 */
export function validateProfileEntry(profile: unknown): ProfilesValidationOutcome<ProfileEntry> {
        const rejections: ProfilesRejection[] = [];
        if (!isRecord(profile)) {
                rejections.push({
                        reason: 'malformed-record',
                        law: 'THE FAIL-CLOSED LAW',
                        items: ['profile'],
                        detail: 'validateProfileEntry: every profile entry must be a plain object of exactly { profileKey, summary, permissionRefs, approvalTiers, evidenceFloor, kpiDimensions } (a profile is configuration; it grants NOTHING by itself)',
                });
                return { ok: false, mode: 'shape', rejections };
        }
        const record = profile as Record<string, unknown>;
        const carrierViolations: string[] = [];
        if (typeof record.profileKey !== 'string') {
                carrierViolations.push('profileKey');
        }
        if (typeof record.summary !== 'string') {
                carrierViolations.push('summary');
        }
        if (carrierViolations.length > 0) {
                rejections.push({
                        reason: 'malformed-record',
                        law: 'THE FAIL-CLOSED LAW',
                        items: carrierViolations,
                        detail: 'validateProfileEntry: the profileKey and the summary must be strings (a profile is a key plus a human summary plus its permission refs, approval tiers, evidence floor and KPI dimensions)',
                });
        }
        const extraKeys = Object.keys(record).filter((key) => !(PROFILE_ENTRY_SCHEMA_KEYS as readonly string[]).includes(key));
        if (extraKeys.length > 0) {
                rejections.push({
                        reason: 'no-fork',
                        law: 'THE NO-FORK LAW',
                        items: extraKeys,
                        detail: `validateProfileEntry: a profile is CONFIGURATION (a profileKey plus a human summary plus its permission references, approval tiers, evidence floor and KPI dimensions) - it grants NOTHING by itself; the extra key(s) ${showList(extraKeys)} are execution material and cannot appear on a profile entry`,
                });
        }
        if (typeof record.profileKey === 'string') {
                const lengthViolations = profileKeyLengthViolationsOf(record.profileKey);
                if (lengthViolations.length > 0) {
                        rejections.push({
                                reason: 'profile-key-length',
                                law: 'THE FAIL-CLOSED LAW',
                                items: lengthViolations,
                                detail: `validateProfileEntry: the profileKey must be a non-empty string of at most ${PROFILE_KEY_MAX_LENGTH} characters`,
                        });
                }
                if (record.profileKey !== record.profileKey.trim()) {
                        rejections.push({
                                reason: 'profile-key-whitespace',
                                law: 'THE FAIL-CLOSED LAW',
                                items: ['leading/trailing whitespace'],
                                detail: 'validateProfileEntry: the profileKey must carry no leading or trailing whitespace',
                        });
                }
                const keyControls = controlCharactersOf(record.profileKey);
                if (keyControls.length > 0) {
                        rejections.push({
                                reason: 'profile-key-control-chars',
                                law: 'THE FAIL-CLOSED LAW',
                                items: keyControls,
                                detail: 'validateProfileEntry: the profileKey must carry no control characters (C0/DEL/C1)',
                        });
                }
        }
        if (typeof record.summary === 'string') {
                const lengthViolations = summaryLengthViolationsOf(record.summary);
                if (lengthViolations.length > 0) {
                        rejections.push({
                                reason: 'summary-length',
                                law: 'THE FAIL-CLOSED LAW',
                                items: lengthViolations,
                                detail: `validateProfileEntry: the summary must be a non-empty string of at most ${PROFILE_SUMMARY_MAX_LENGTH} characters`,
                        });
                }
                const summaryControls = controlCharactersOf(record.summary);
                if (summaryControls.length > 0) {
                        rejections.push({
                                reason: 'summary-control-chars',
                                law: 'THE FAIL-CLOSED LAW',
                                items: summaryControls,
                                detail: 'validateProfileEntry: the summary must carry no control characters (C0/DEL/C1)',
                        });
                }
        }
        // THE AUTHORITY-BINDING LAW's per-array walk: the carrier, the REAL
        // vocabulary membership and the per-profile uniqueness, over each of
        // the three array-valued stations in the frozen order (the
        // permissionRefs, the approvalTiers, the kpiDimensions).
        if (!Array.isArray(record.permissionRefs)) {
                rejections.push({
                        reason: 'bad-permission-refs-carrier',
                        law: 'THE FAIL-CLOSED LAW',
                        items: ['permissionRefs'],
                        detail: 'validateProfileEntry: the permissionRefs must be a string array (the profile\'s permission references; MAY be empty - the honest-gap law)',
                });
        } else {
                const permissionRefs = record.permissionRefs as unknown[];
                const nonStringMembers: string[] = [];
                for (let i = 0; i < permissionRefs.length; i += 1) {
                        if (typeof permissionRefs[i] !== 'string') {
                                nonStringMembers.push(`permissionRefs[${i}]`);
                        }
                }
                if (nonStringMembers.length > 0) {
                        rejections.push({
                                reason: 'bad-permission-refs-carrier',
                                law: 'THE FAIL-CLOSED LAW',
                                items: nonStringMembers,
                                detail: 'validateProfileEntry: every permissionRefs member must be a string (the permission-reference alphabet)',
                        });
                }
                const nonMembers = distinctFirstSeen(permissionRefs.filter((ref) => typeof ref === 'string' && !isCatalogPermissionId(ref)) as string[]);
                if (nonMembers.length > 0) {
                        rejections.push({
                                reason: 'bad-permission-ref',
                                law: 'THE AUTHORITY-BINDING LAW',
                                items: nonMembers,
                                detail: `validateProfileEntry: every permissionRef must be a member of the REAL catalog permission vocabulary (imported by reference from the ZC-006 capability-pack catalog: ${showList([...CATALOG_PERMISSION_IDS])}) - this family declares no vocabulary of its own`,
                        });
                }
                const permissionDuplicates = findDuplicates(permissionRefs.filter((ref): ref is string => typeof ref === 'string'));
                if (permissionDuplicates.length > 0) {
                        rejections.push({
                                reason: 'duplicate-permission-ref',
                                law: 'THE FAIL-CLOSED LAW',
                                items: permissionDuplicates,
                                detail: 'validateProfileEntry: the permissionRefs array must be duplicate-free (a permission reference appears once per profile)',
                        });
                }
        }
        if (!Array.isArray(record.approvalTiers)) {
                rejections.push({
                        reason: 'bad-approval-tiers-carrier',
                        law: 'THE FAIL-CLOSED LAW',
                        items: ['approvalTiers'],
                        detail: 'validateProfileEntry: the approvalTiers must be an array (the profile\'s approval risk tiers; MAY be empty - the honest-gap law)',
                });
        } else {
                const approvalTiers = record.approvalTiers as unknown[];
                const nonStringTiers: string[] = [];
                for (let i = 0; i < approvalTiers.length; i += 1) {
                        if (typeof approvalTiers[i] !== 'string') {
                                nonStringTiers.push(`approvalTiers[${i}]`);
                        }
                }
                if (nonStringTiers.length > 0) {
                        rejections.push({
                                reason: 'bad-approval-tiers-carrier',
                                law: 'THE FAIL-CLOSED LAW',
                                items: nonStringTiers,
                                detail: 'validateProfileEntry: every approvalTiers member must be a string (the approval-tier alphabet)',
                        });
                }
                const nonMemberTiers = distinctFirstSeen(approvalTiers.filter((tier) => typeof tier === 'string' && !isCatalogPermissionRiskTier(tier)) as string[]);
                if (nonMemberTiers.length > 0) {
                        rejections.push({
                                reason: 'bad-approval-tier',
                                law: 'THE AUTHORITY-BINDING LAW',
                                items: nonMemberTiers,
                                detail: `validateProfileEntry: every approvalTier must be a member of the REAL CATALOG_PERMISSION_RISK_TIERS list (imported by reference, never transcribed: ${showList([...CATALOG_PERMISSION_RISK_TIERS])}) - this family declares no vocabulary of its own`,
                        });
                }
                const tierDuplicates = findDuplicates(approvalTiers.filter((tier): tier is string => typeof tier === 'string'));
                if (tierDuplicates.length > 0) {
                        rejections.push({
                                reason: 'duplicate-approval-tier',
                                law: 'THE FAIL-CLOSED LAW',
                                items: tierDuplicates,
                                detail: 'validateProfileEntry: the approvalTiers array must be duplicate-free (an approval tier appears once per profile)',
                        });
                }
        }
        // THE AUTHORITY-BINDING LAW's evidence floor: exactly one member of
        // the REAL LabEvidenceLevel ladder per profile (the domain's minimum
        // evidence requirement - never overstated).
        if (!isLabEvidenceLevel(record.evidenceFloor)) {
                rejections.push({
                        reason: 'bad-evidence-floor',
                        law: 'THE AUTHORITY-BINDING LAW',
                        items: [showValue(record.evidenceFloor)],
                        detail: `validateProfileEntry: the evidenceFloor must be exactly one member of the REAL LabEvidenceLevel ladder (imported from the lab contracts: ${showList([...PROFILES_EVIDENCE_LADDER])}) - the domain's minimum evidence requirement, never overstated`,
                });
        }
        if (!Array.isArray(record.kpiDimensions)) {
                rejections.push({
                        reason: 'bad-kpi-dimensions-carrier',
                        law: 'THE FAIL-CLOSED LAW',
                        items: ['kpiDimensions'],
                        detail: 'validateProfileEntry: the kpiDimensions must be an array (the profile\'s KPI dimensions; MAY be empty - the honest-gap law)',
                });
        } else {
                const kpiDimensions = record.kpiDimensions as unknown[];
                const nonStringDims: string[] = [];
                for (let i = 0; i < kpiDimensions.length; i += 1) {
                        if (typeof kpiDimensions[i] !== 'string') {
                                nonStringDims.push(`kpiDimensions[${i}]`);
                        }
                }
                if (nonStringDims.length > 0) {
                        rejections.push({
                                reason: 'bad-kpi-dimensions-carrier',
                                law: 'THE FAIL-CLOSED LAW',
                                items: nonStringDims,
                                detail: 'validateProfileEntry: every kpiDimensions member must be a string (the KPI-dimension alphabet)',
                        });
                }
                const nonMemberDims = distinctFirstSeen(kpiDimensions.filter((dimension) => typeof dimension === 'string' && !isEvalDimension(dimension)) as string[]);
                if (nonMemberDims.length > 0) {
                        rejections.push({
                                reason: 'bad-kpi-dimension',
                                law: 'THE AUTHORITY-BINDING LAW',
                                items: nonMemberDims,
                                detail: `validateProfileEntry: every kpiDimension must be a member of the REAL EvalDimension vocabulary (imported from the lab contracts: ${showList([...PROFILES_EVAL_DIMENSIONS])}) - this family declares no vocabulary of its own`,
                        });
                }
                const dimDuplicates = findDuplicates(kpiDimensions.filter((dimension): dimension is string => typeof dimension === 'string'));
                if (dimDuplicates.length > 0) {
                        rejections.push({
                                reason: 'duplicate-kpi-dimension',
                                law: 'THE FAIL-CLOSED LAW',
                                items: dimDuplicates,
                                detail: 'validateProfileEntry: the kpiDimensions array must be duplicate-free (a KPI dimension appears once per profile)',
                        });
                }
        }
        if (rejections.length > 0) {
                return { ok: false, mode: 'shape', rejections };
        }
        return {
                ok: true,
                value: {
                        profileKey: record.profileKey as string,
                        summary: record.summary as string,
                        permissionRefs: [...(record.permissionRefs as string[])],
                        approvalTiers: [...(record.approvalTiers as string[])],
                        evidenceFloor: record.evidenceFloor as string,
                        kpiDimensions: [...(record.kpiDimensions as string[])],
                },
        };
}

/**
 * The deep record walk (pure): the strict twenty-four-station walk
 * over the honest record, THE STATIONS IN THE FROZEN ORDER (the
 * station-major discipline: each station is visited once, in the
 * PROFILES_REJECTION_REASONS order, and names every offense it sees)
 * - malformed-record (the record, its carriers and its profile
 * entries), no-fork (every profile entry's extra keys, before the
 * record schema stations), unknown-key, missing-key, bad-harness-id
 * (THE REAL DH-01 harness-id alphabet import - the FORM law),
 * bad-stage, bad-history, the profile family laws (profile-key-length
 * / profile-key-whitespace / profile-key-control-chars /
 * summary-length / summary-control-chars per entry,
 * duplicate-profile-key, max-profiles, then THE AUTHORITY-BINDING LAW
 * stations per entry: bad-permission-refs-carrier /
 * bad-permission-ref / duplicate-permission-ref,
 * bad-approval-tiers-carrier / bad-approval-tier /
 * duplicate-approval-tier, bad-evidence-floor,
 * bad-kpi-dimensions-carrier / bad-kpi-dimension /
 * duplicate-kpi-dimension). THE COMPLETE TABLE: every violated
 * station is reported, in the frozen walk order. Empty profiles are
 * LEGAL here (the floor fires at finalize, never the record shape);
 * stage-vs-payload consistency is the ledger replay's cross-check,
 * never this walk's. Ok carries the canonical fixed-key-order copy
 * (the profile entries sorted deterministically by profileKey).
 */
export function validateProfilesRecord(value: unknown): ProfilesValidationOutcome<ProfilesRecord> {
        const rejections: ProfilesRejection[] = [];
        if (!isRecord(value)) {
                rejections.push({
                        reason: 'malformed-record',
                        law: 'THE FAIL-CLOSED LAW',
                        items: ['record'],
                        detail: 'validateProfilesRecord: the record must be a plain object (never a silent partial verdict)',
                });
                return { ok: false, mode: 'shape', rejections };
        }
        const record = value as Record<string, unknown>;
        const keys = Object.keys(record);

        // station 1 (malformed-record): the record's own carriers and the
        // profile entries' structural shapes (a non-object entry, a
        // non-string profileKey / summary carrier - the entry-level shape
        // offenses live in this station: the work order's closed walk
        // carries no separate malformed-profile station).
        const carrierViolations: string[] = [];
        if (hasOwn(record, 'profiles') && !Array.isArray(record.profiles)) {
                carrierViolations.push('profiles');
        }
        if (hasOwn(record, 'history') && !Array.isArray(record.history)) {
                carrierViolations.push('history');
        }
        if (Array.isArray(record.profiles)) {
                const profiles = record.profiles as unknown[];
                for (let i = 0; i < profiles.length; i += 1) {
                        const profile = profiles[i];
                        if (!isRecord(profile)) {
                                carrierViolations.push(`profiles[${i}]`);
                                continue;
                        }
                        if (typeof (profile as Record<string, unknown>).profileKey !== 'string') {
                                carrierViolations.push(`profiles[${i}]:profileKey`);
                        }
                        if (typeof (profile as Record<string, unknown>).summary !== 'string') {
                                carrierViolations.push(`profiles[${i}]:summary`);
                        }
                }
        }
        if (carrierViolations.length > 0) {
                rejections.push({
                        reason: 'malformed-record',
                        law: 'THE FAIL-CLOSED LAW',
                        items: carrierViolations,
                        detail: `validateProfilesRecord: a structural shape is malformed - the offending part(s) ${showList(carrierViolations)} (the record and every profile entry must be plain objects, the profiles / history carriers must be arrays, and every profileKey / summary carrier must be a string - never a silent partial verdict)`,
                });
        }

        // station 2 (no-fork): THE NO-FORK LAW's profile station, over every
        // walkable profile entry (before the record schema stations - the
        // frozen walk order).
        if (Array.isArray(record.profiles)) {
                const noForkItems: string[] = [];
                const profiles = record.profiles as unknown[];
                for (let i = 0; i < profiles.length; i += 1) {
                        if (!isRecord(profiles[i])) {
                                continue;
                        }
                        const extraKeys = Object.keys(profiles[i] as Record<string, unknown>).filter((key) => !(PROFILE_ENTRY_SCHEMA_KEYS as readonly string[]).includes(key));
                        for (const extraKey of extraKeys) {
                                noForkItems.push(`profiles[${i}]:${extraKey}`);
                        }
                }
                if (noForkItems.length > 0) {
                        rejections.push({
                                reason: 'no-fork',
                                law: 'THE NO-FORK LAW',
                                items: noForkItems,
                                detail: `validateProfilesRecord: a profile is CONFIGURATION (a profileKey plus a human summary plus its permission references, approval tiers, evidence floor and KPI dimensions) - it grants NOTHING by itself; the extra key(s) ${showList(noForkItems)} are execution material and cannot appear on a profile entry`,
                        });
                }
        }

        // station 3 (unknown-key): the strict five-key schema is closed.
        const unknownKeys = keys.filter((key) => !(PROFILES_RECORD_SCHEMA_KEYS as readonly string[]).includes(key));
        if (unknownKeys.length > 0) {
                rejections.push({
                        reason: 'unknown-key',
                        law: 'THE FAIL-CLOSED LAW',
                        items: unknownKeys,
                        detail: `validateProfilesRecord: the record schema is closed (THE FIVE-KEY MODEL) - the unknown key(s) ${showList(unknownKeys)} are rejected`,
                });
        }

        // station 4 (missing-key): the strict schema requires every key.
        const missingKeys = (PROFILES_RECORD_SCHEMA_KEYS as readonly string[]).filter((key) => !hasOwn(record, key));
        if (missingKeys.length > 0) {
                rejections.push({
                        reason: 'missing-key',
                        law: 'THE FAIL-CLOSED LAW',
                        items: missingKeys,
                        detail: `validateProfilesRecord: the record schema requires every key - the key(s) ${showList(missingKeys)} are missing`,
                });
        }

        // station 5 (bad-harness-id): the REAL DH-01 harness-id alphabet (THE IMPORT LAW).
        // (the absent-key discipline: an absent harnessId is station 4's missing-key,
        // never a cascade here - the DH-01 law: an absent key is the missing-key
        // station, never a structural one.)
        if (hasOwn(record, 'harnessId') && !isHarnessId(record.harnessId)) {
                rejections.push({
                        reason: 'bad-harness-id',
                        law: 'THE FAIL-CLOSED LAW',
                        items: [showValue(record.harnessId)],
                        detail: 'validateProfilesRecord: the harnessId must satisfy the REAL DH-01 harness-id alphabet (flauz:hrn:<16-hex>, imported by reference - the FORM law; the EXISTENCE binding is the caller\'s wiring, never this layer\'s)',
                });
        }

        // station 6 (bad-stage).
        // (the absent-key discipline: an absent stage is station 4's missing-key,
        // never a cascade here.)
        if (hasOwn(record, 'stage') && !isProfilesStage(record.stage)) {
                rejections.push({
                        reason: 'bad-stage',
                        law: 'THE FORWARD-ONLY LAW',
                        items: [showValue(record.stage)],
                        detail: 'validateProfilesRecord: the stage must be a member of the frozen PROFILES_STAGES list (composing -> composed; composed is TERMINAL)',
                });
        }

        // station 7 (bad-history), only walkable when the carrier is an array.
        if (Array.isArray(record.history)) {
                const history = record.history as unknown[];
                const malformed: string[] = [];
                for (let i = 0; i < history.length; i += 1) {
                        if (!isWellFormedNote(history[i])) {
                                malformed.push(`history[${i}]`);
                        }
                }
                if (malformed.length > 0) {
                        rejections.push({
                                reason: 'bad-history',
                                law: 'THE FAIL-CLOSED LAW',
                                items: malformed,
                                detail: 'validateProfilesRecord: every history note must carry the frozen six-key note shape (at / fromStage / toStage / op / law / detail - the provenance record)',
                        });
                }
        }

        // stations 8-24 (the profile family laws), only walkable when the carrier
        // is an array; the per-entry stations skip the entries already refused by
        // station 1's shape walk (never a cascade over a malformed entry).
        if (Array.isArray(record.profiles)) {
                const profiles = record.profiles as unknown[];

                // station 8 (profile-key-length): the bound, per walkable entry.
                const keyLengthItems: string[] = [];
                for (let i = 0; i < profiles.length; i += 1) {
                        const profile = profiles[i];
                        if (!isRecord(profile) || typeof (profile as Record<string, unknown>).profileKey !== 'string') {
                                continue;
                        }
                        const violations = profileKeyLengthViolationsOf((profile as Record<string, unknown>).profileKey as string);
                        for (const violation of violations) {
                                keyLengthItems.push(`profiles[${i}]:${violation}`);
                        }
                }
                if (keyLengthItems.length > 0) {
                        rejections.push({
                                reason: 'profile-key-length',
                                law: 'THE FAIL-CLOSED LAW',
                                items: keyLengthItems,
                                detail: `validateProfilesRecord: every profileKey must be a non-empty string of at most ${PROFILE_KEY_MAX_LENGTH} characters`,
                        });
                }

                // station 9 (profile-key-whitespace): the padding, per walkable entry.
                const keyWhitespaceItems: string[] = [];
                for (let i = 0; i < profiles.length; i += 1) {
                        const profile = profiles[i];
                        if (!isRecord(profile) || typeof (profile as Record<string, unknown>).profileKey !== 'string') {
                                continue;
                        }
                        const profileKey = (profile as Record<string, unknown>).profileKey as string;
                        if (profileKey !== profileKey.trim()) {
                                keyWhitespaceItems.push(`profiles[${i}]:leading/trailing whitespace`);
                        }
                }
                if (keyWhitespaceItems.length > 0) {
                        rejections.push({
                                reason: 'profile-key-whitespace',
                                law: 'THE FAIL-CLOSED LAW',
                                items: keyWhitespaceItems,
                                detail: 'validateProfilesRecord: every profileKey must carry no leading or trailing whitespace',
                        });
                }

                // station 10 (profile-key-control-chars): the C0/DEL/C1 set, per walkable entry.
                const keyControlItems: string[] = [];
                for (let i = 0; i < profiles.length; i += 1) {
                        const profile = profiles[i];
                        if (!isRecord(profile) || typeof (profile as Record<string, unknown>).profileKey !== 'string') {
                                continue;
                        }
                        const controls = controlCharactersOf((profile as Record<string, unknown>).profileKey as string);
                        for (const control of controls) {
                                keyControlItems.push(`profiles[${i}]:${control}`);
                        }
                }
                if (keyControlItems.length > 0) {
                        rejections.push({
                                reason: 'profile-key-control-chars',
                                law: 'THE FAIL-CLOSED LAW',
                                items: keyControlItems,
                                detail: 'validateProfilesRecord: every profileKey must carry no control characters (C0/DEL/C1)',
                        });
                }

                // station 11 (summary-length): the bound, per walkable entry.
                const summaryLengthItems: string[] = [];
                for (let i = 0; i < profiles.length; i += 1) {
                        const profile = profiles[i];
                        if (!isRecord(profile) || typeof (profile as Record<string, unknown>).summary !== 'string') {
                                continue;
                        }
                        const violations = summaryLengthViolationsOf((profile as Record<string, unknown>).summary as string);
                        for (const violation of violations) {
                                summaryLengthItems.push(`profiles[${i}]:${violation}`);
                        }
                }
                if (summaryLengthItems.length > 0) {
                        rejections.push({
                                reason: 'summary-length',
                                law: 'THE FAIL-CLOSED LAW',
                                items: summaryLengthItems,
                                detail: `validateProfilesRecord: every summary must be a non-empty string of at most ${PROFILE_SUMMARY_MAX_LENGTH} characters`,
                        });
                }

                // station 12 (summary-control-chars): the C0/DEL/C1 set, per walkable entry.
                const summaryControlItems: string[] = [];
                for (let i = 0; i < profiles.length; i += 1) {
                        const profile = profiles[i];
                        if (!isRecord(profile) || typeof (profile as Record<string, unknown>).summary !== 'string') {
                                continue;
                        }
                        const controls = controlCharactersOf((profile as Record<string, unknown>).summary as string);
                        for (const control of controls) {
                                summaryControlItems.push(`profiles[${i}]:${control}`);
                        }
                }
                if (summaryControlItems.length > 0) {
                        rejections.push({
                                reason: 'summary-control-chars',
                                law: 'THE FAIL-CLOSED LAW',
                                items: summaryControlItems,
                                detail: 'validateProfilesRecord: every summary must carry no control characters (C0/DEL/C1)',
                        });
                }

                // station 13 (duplicate-profile-key): the record-wide uniqueness law.
                const profileKeyDuplicates = findDuplicates(
                        profiles.filter((profile) => isRecord(profile) && typeof (profile as Record<string, unknown>).profileKey === 'string').map(
                                (profile) => (profile as Record<string, unknown>).profileKey as string,
                        ),
                );
                if (profileKeyDuplicates.length > 0) {
                        rejections.push({
                                reason: 'duplicate-profile-key',
                                law: 'THE FAIL-CLOSED LAW',
                                items: profileKeyDuplicates,
                                detail: 'validateProfilesRecord: profileKeys must be unique within the record (a profile appears once)',
                        });
                }

                // station 14 (max-profiles): the composition bound.
                if (profiles.length > MAX_PROFILES) {
                        rejections.push({
                                reason: 'max-profiles',
                                law: 'THE FAIL-CLOSED LAW',
                                items: [`${profiles.length} profiles`],
                                detail: `validateProfilesRecord: the record carries at most MAX_PROFILES (${MAX_PROFILES}) profiles (the composition bound)`,
                        });
                }

                // station 15 (bad-permission-refs-carrier): the carrier and its members, per walkable entry.
                const permissionRefsCarrierItems: string[] = [];
                for (let i = 0; i < profiles.length; i += 1) {
                        const profile = profiles[i];
                        if (!isRecord(profile)) {
                                continue;
                        }
                        const permissionRefs = (profile as Record<string, unknown>).permissionRefs;
                        if (!Array.isArray(permissionRefs)) {
                                permissionRefsCarrierItems.push(`profiles[${i}]:permissionRefs`);
                                continue;
                        }
                        for (let j = 0; j < permissionRefs.length; j += 1) {
                                if (typeof permissionRefs[j] !== 'string') {
                                        permissionRefsCarrierItems.push(`profiles[${i}]:permissionRefs[${j}]`);
                                }
                        }
                }
                if (permissionRefsCarrierItems.length > 0) {
                        rejections.push({
                                reason: 'bad-permission-refs-carrier',
                                law: 'THE FAIL-CLOSED LAW',
                                items: permissionRefsCarrierItems,
                                detail: 'validateProfilesRecord: every permissionRefs must be a string array whose members are strings (the profile\'s permission references; MAY be empty - the honest-gap law)',
                        });
                }

                // station 16 (bad-permission-ref): THE AUTHORITY-BINDING LAW against the REAL catalog.
                const badPermissionRefItems: string[] = [];
                for (let i = 0; i < profiles.length; i += 1) {
                        const profile = profiles[i];
                        if (!isRecord(profile) || !Array.isArray((profile as Record<string, unknown>).permissionRefs)) {
                                continue;
                        }
                        const permissionRefs = (profile as Record<string, unknown>).permissionRefs as unknown[];
                        const nonMembers = distinctFirstSeen(permissionRefs.filter((ref) => typeof ref === 'string' && !isCatalogPermissionId(ref)) as string[]);
                        for (const ref of nonMembers) {
                                badPermissionRefItems.push(`profiles[${i}]:${ref}`);
                        }
                }
                if (badPermissionRefItems.length > 0) {
                        rejections.push({
                                reason: 'bad-permission-ref',
                                law: 'THE AUTHORITY-BINDING LAW',
                                items: badPermissionRefItems,
                                detail: `validateProfilesRecord: every permissionRef must be a member of the REAL catalog permission vocabulary (imported by reference: ${showList([...CATALOG_PERMISSION_IDS])}) - this family declares no vocabulary of its own`,
                        });
                }

                // station 17 (duplicate-permission-ref): the per-profile uniqueness law.
                const duplicatePermissionRefItems: string[] = [];
                for (let i = 0; i < profiles.length; i += 1) {
                        const profile = profiles[i];
                        if (!isRecord(profile) || !Array.isArray((profile as Record<string, unknown>).permissionRefs)) {
                                continue;
                        }
                        const permissionRefs = (profile as Record<string, unknown>).permissionRefs as unknown[];
                        const duplicates = findDuplicates(permissionRefs.filter((ref): ref is string => typeof ref === 'string'));
                        for (const duplicate of duplicates) {
                                duplicatePermissionRefItems.push(`profiles[${i}]:${duplicate}`);
                        }
                }
                if (duplicatePermissionRefItems.length > 0) {
                        rejections.push({
                                reason: 'duplicate-permission-ref',
                                law: 'THE FAIL-CLOSED LAW',
                                items: duplicatePermissionRefItems,
                                detail: 'validateProfilesRecord: every permissionRefs array must be duplicate-free (a permission reference appears once per profile)',
                        });
                }

                // station 18 (bad-approval-tiers-carrier): the carrier and its members, per walkable entry.
                const approvalTiersCarrierItems: string[] = [];
                for (let i = 0; i < profiles.length; i += 1) {
                        const profile = profiles[i];
                        if (!isRecord(profile)) {
                                continue;
                        }
                        const approvalTiers = (profile as Record<string, unknown>).approvalTiers;
                        if (!Array.isArray(approvalTiers)) {
                                approvalTiersCarrierItems.push(`profiles[${i}]:approvalTiers`);
                                continue;
                        }
                        for (let j = 0; j < approvalTiers.length; j += 1) {
                                if (typeof approvalTiers[j] !== 'string') {
                                        approvalTiersCarrierItems.push(`profiles[${i}]:approvalTiers[${j}]`);
                                }
                        }
                }
                if (approvalTiersCarrierItems.length > 0) {
                        rejections.push({
                                reason: 'bad-approval-tiers-carrier',
                                law: 'THE FAIL-CLOSED LAW',
                                items: approvalTiersCarrierItems,
                                detail: 'validateProfilesRecord: every approvalTiers must be an array whose members are strings (the profile\'s approval risk tiers; MAY be empty - the honest-gap law)',
                        });
                }

                // station 19 (bad-approval-tier): THE AUTHORITY-BINDING LAW against the REAL risk tiers.
                const badApprovalTierItems: string[] = [];
                for (let i = 0; i < profiles.length; i += 1) {
                        const profile = profiles[i];
                        if (!isRecord(profile) || !Array.isArray((profile as Record<string, unknown>).approvalTiers)) {
                                continue;
                        }
                        const approvalTiers = (profile as Record<string, unknown>).approvalTiers as unknown[];
                        const nonMemberTiers = distinctFirstSeen(approvalTiers.filter((tier) => typeof tier === 'string' && !isCatalogPermissionRiskTier(tier)) as string[]);
                        for (const tier of nonMemberTiers) {
                                badApprovalTierItems.push(`profiles[${i}]:${tier}`);
                        }
                }
                if (badApprovalTierItems.length > 0) {
                        rejections.push({
                                reason: 'bad-approval-tier',
                                law: 'THE AUTHORITY-BINDING LAW',
                                items: badApprovalTierItems,
                                detail: `validateProfilesRecord: every approvalTier must be a member of the REAL CATALOG_PERMISSION_RISK_TIERS list (imported by reference, never transcribed: ${showList([...CATALOG_PERMISSION_RISK_TIERS])})`,
                        });
                }

                // station 20 (duplicate-approval-tier): the per-profile uniqueness law.
                const duplicateApprovalTierItems: string[] = [];
                for (let i = 0; i < profiles.length; i += 1) {
                        const profile = profiles[i];
                        if (!isRecord(profile) || !Array.isArray((profile as Record<string, unknown>).approvalTiers)) {
                                continue;
                        }
                        const approvalTiers = (profile as Record<string, unknown>).approvalTiers as unknown[];
                        const duplicates = findDuplicates(approvalTiers.filter((tier): tier is string => typeof tier === 'string'));
                        for (const duplicate of duplicates) {
                                duplicateApprovalTierItems.push(`profiles[${i}]:${duplicate}`);
                        }
                }
                if (duplicateApprovalTierItems.length > 0) {
                        rejections.push({
                                reason: 'duplicate-approval-tier',
                                law: 'THE FAIL-CLOSED LAW',
                                items: duplicateApprovalTierItems,
                                detail: 'validateProfilesRecord: every approvalTiers array must be duplicate-free (an approval tier appears once per profile)',
                        });
                }

                // station 21 (bad-evidence-floor): THE AUTHORITY-BINDING LAW against the REAL ladder.
                const badEvidenceFloorItems: string[] = [];
                for (let i = 0; i < profiles.length; i += 1) {
                        const profile = profiles[i];
                        if (!isRecord(profile) || !hasOwn(profile as Record<string, unknown>, 'evidenceFloor')) {
                                continue;
                        }
                        const evidenceFloor = (profile as Record<string, unknown>).evidenceFloor;
                        if (!isLabEvidenceLevel(evidenceFloor)) {
                                badEvidenceFloorItems.push(`profiles[${i}]:${showValue(evidenceFloor)}`);
                        }
                }
                if (badEvidenceFloorItems.length > 0) {
                        rejections.push({
                                reason: 'bad-evidence-floor',
                                law: 'THE AUTHORITY-BINDING LAW',
                                items: badEvidenceFloorItems,
                                detail: `validateProfilesRecord: every evidenceFloor must be exactly one member of the REAL LabEvidenceLevel ladder (imported from the lab contracts: ${showList([...PROFILES_EVIDENCE_LADDER])}) - the domain's minimum evidence requirement, never overstated`,
                        });
                }

                // station 22 (bad-kpi-dimensions-carrier): the carrier and its members, per walkable entry.
                const kpiDimsCarrierItems: string[] = [];
                for (let i = 0; i < profiles.length; i += 1) {
                        const profile = profiles[i];
                        if (!isRecord(profile)) {
                                continue;
                        }
                        const kpiDimensions = (profile as Record<string, unknown>).kpiDimensions;
                        if (!Array.isArray(kpiDimensions)) {
                                kpiDimsCarrierItems.push(`profiles[${i}]:kpiDimensions`);
                                continue;
                        }
                        for (let j = 0; j < kpiDimensions.length; j += 1) {
                                if (typeof kpiDimensions[j] !== 'string') {
                                        kpiDimsCarrierItems.push(`profiles[${i}]:kpiDimensions[${j}]`);
                                }
                        }
                }
                if (kpiDimsCarrierItems.length > 0) {
                        rejections.push({
                                reason: 'bad-kpi-dimensions-carrier',
                                law: 'THE FAIL-CLOSED LAW',
                                items: kpiDimsCarrierItems,
                                detail: 'validateProfilesRecord: every kpiDimensions must be an array whose members are strings (the profile\'s KPI dimensions; MAY be empty - the honest-gap law)',
                        });
                }

                // station 23 (bad-kpi-dimension): THE AUTHORITY-BINDING LAW against the REAL eval dimensions.
                const badKpiDimensionItems: string[] = [];
                for (let i = 0; i < profiles.length; i += 1) {
                        const profile = profiles[i];
                        if (!isRecord(profile) || !Array.isArray((profile as Record<string, unknown>).kpiDimensions)) {
                                continue;
                        }
                        const kpiDimensions = (profile as Record<string, unknown>).kpiDimensions as unknown[];
                        const nonMemberDims = distinctFirstSeen(kpiDimensions.filter((dimension) => typeof dimension === 'string' && !isEvalDimension(dimension)) as string[]);
                        for (const dimension of nonMemberDims) {
                                badKpiDimensionItems.push(`profiles[${i}]:${dimension}`);
                        }
                }
                if (badKpiDimensionItems.length > 0) {
                        rejections.push({
                                reason: 'bad-kpi-dimension',
                                law: 'THE AUTHORITY-BINDING LAW',
                                items: badKpiDimensionItems,
                                detail: `validateProfilesRecord: every kpiDimension must be a member of the REAL EvalDimension vocabulary (imported from the lab contracts: ${showList([...PROFILES_EVAL_DIMENSIONS])})`,
                        });
                }

                // station 24 (duplicate-kpi-dimension): the per-profile uniqueness law.
                const duplicateKpiDimensionItems: string[] = [];
                for (let i = 0; i < profiles.length; i += 1) {
                        const profile = profiles[i];
                        if (!isRecord(profile) || !Array.isArray((profile as Record<string, unknown>).kpiDimensions)) {
                                continue;
                        }
                        const kpiDimensions = (profile as Record<string, unknown>).kpiDimensions as unknown[];
                        const duplicates = findDuplicates(kpiDimensions.filter((dimension): dimension is string => typeof dimension === 'string'));
                        for (const duplicate of duplicates) {
                                duplicateKpiDimensionItems.push(`profiles[${i}]:${duplicate}`);
                        }
                }
                if (duplicateKpiDimensionItems.length > 0) {
                        rejections.push({
                                reason: 'duplicate-kpi-dimension',
                                law: 'THE FAIL-CLOSED LAW',
                                items: duplicateKpiDimensionItems,
                                detail: 'validateProfilesRecord: every kpiDimensions array must be duplicate-free (a KPI dimension appears once per profile)',
                        });
                }
        }

        if (rejections.length > 0) {
                return { ok: false, mode: 'shape', rejections };
        }
        return { ok: true, value: canonicalProfilesRecord(record as unknown as ProfilesRecord) };
}

/**
 * Pure deep shape guard: a well-formed profiles record (the deep walk
 * above, green). Fails closed on every malformed path; never reads a
 * clock; never mutates its input.
 */
export function isProfilesRecord(value: unknown): value is ProfilesRecord {
        return validateProfilesRecord(value).ok;
}

/**
 * THE CANONICAL SERIALIZATION: the fixed-key-order JSON bytes of a
 * profiles record (byte-deterministic; double-serialize
 * byte-equality; the key order frozen in this module and pinned by
 * tests - the DH-01 algorithm: the frozen per-shape key orders
 * applied deeply, never an alphabetic re-sort). The record keys emit
 * in the PROFILES_RECORD_SCHEMA_KEYS order, the profile entries in
 * the PROFILE_ENTRY_SCHEMA_KEYS order (profileKey, summary,
 * permissionRefs, approvalTiers, evidenceFloor, kpiDimensions) AND
 * the entries are sorted deterministically by profileKey, the
 * history notes in the PROFILES_NOTE_SCHEMA_KEYS order. Throws
 * TypeError on a malformed record (never dishonest bytes).
 */
export function serializeProfilesRecord(record: unknown): string {
        if (!isProfilesRecord(record)) {
                throw new TypeError(
                        'serializeProfilesRecord: record must satisfy isProfilesRecord - no dishonest profiles record ever gets canonical bytes',
                );
        }
        return JSON.stringify(canonicalRecordObject(record));
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
 *   unknown-contract-version - the family-parity slot: THE FIVE-KEY
 *                              MODEL carries no contractVersion field,
 *                              so this station never fires on record
 *                              bytes (the version law fires at the
 *                              kit-layer persistence surfaces as the
 *                              typed version-mismatch); the slot is
 *                              retained for the landed family's
 *                              parse shape;
 *   unknown-key              - an extra key at the record, profile or
 *                              note level (tampered bytes);
 *   invalid-record           - the deep semantic walk refuses;
 *   non-canonical            - the bytes parse and validate but are
 *                              NOT the canonical serialization (a key
 *                              emitted out of the frozen order, the
 *                              profile entries out of the profileKey
 *                              sort, or drifting whitespace) - the
 *                              parse refuses non-canonical bytes,
 *                              never a silent normalization.
 */
export const PROFILES_PARSE_REJECTION_REASONS = [
        'malformed-json',
        'torn-envelope',
        'unknown-contract-version',
        'unknown-key',
        'invalid-record',
        'non-canonical',
] as const;
export type ProfilesParseRejectionReason = (typeof PROFILES_PARSE_REJECTION_REASONS)[number];

/** Pure predicate over the closed parse-rejection list. */
export function isProfilesParseRejectionReason(value: unknown): value is ProfilesParseRejectionReason {
        return (PROFILES_PARSE_REJECTION_REASONS as readonly string[]).includes(value as string);
}

/** The typed parse rejection: the frozen reason and the drift-naming detail. */
export interface ProfilesParseRejection {
        readonly reason: ProfilesParseRejectionReason;
        readonly detail: string;
}

/** The typed parse outcome: ok carries the validated record; failure names the drift. */
export type ProfilesParseOutcome =
        | { readonly ok: true; readonly record: ProfilesRecord }
        | { readonly ok: false; readonly rejection: ProfilesParseRejection };

/**
 * THE FAIL-CLOSED PARSE: bytes -> the typed parse outcome. Malformed
 * JSON, a torn envelope, an unknown key (record / profile / note
 * level), invalid content (the deep record walk) or non-canonical
 * bytes (the round-trip canonicality law) - each a typed rejection
 * naming the drift; never a silent partial parse, never a silent
 * normalization. First-failure-is-the-verdict, in the frozen
 * PROFILES_PARSE_REJECTION_REASONS order.
 */
export function parseProfilesRecord(bytes: unknown): ProfilesParseOutcome {
        if (typeof bytes !== 'string') {
                return {
                        ok: false,
                        rejection: {
                                reason: 'torn-envelope',
                                detail: 'parseProfilesRecord: bytes must be a string (the canonical fixed-key-order record bytes)',
                        },
                };
        }
        let parsed: unknown;
        try {
                parsed = JSON.parse(bytes);
        } catch (error) {
                return {
                        ok: false,
                        rejection: {
                                reason: 'malformed-json',
                                detail: `parseProfilesRecord: the bytes are not valid JSON: ${toMessage(error)}`,
                        },
                };
        }
        if (!isRecord(parsed)) {
                return {
                        ok: false,
                        rejection: {
                                reason: 'torn-envelope',
                                detail: 'parseProfilesRecord: the bytes must carry a JSON object (the record envelope)',
                        },
                };
        }
        const record = parsed as Record<string, unknown>;
        for (const key of PROFILES_RECORD_SCHEMA_KEYS) {
                if (!hasOwn(record, key)) {
                        return {
                                ok: false,
                                rejection: {
                                        reason: 'torn-envelope',
                                        detail: `parseProfilesRecord: the '${key}' key is missing (a torn write - never a silent partial parse)`,
                                },
                        };
                }
        }
        if (typeof record.profilesId !== 'string' || typeof record.harnessId !== 'string' || typeof record.stage !== 'string' || !Array.isArray(record.profiles) || !Array.isArray(record.history)) {
                return {
                        ok: false,
                        rejection: {
                                reason: 'torn-envelope',
                                detail: 'parseProfilesRecord: the record envelope carries a value of the wrong structural type (a torn write - never a silent partial parse)',
                        },
                };
        }
        const unknownRecordKeys = Object.keys(record).filter((key) => !(PROFILES_RECORD_SCHEMA_KEYS as readonly string[]).includes(key));
        if (unknownRecordKeys.length > 0) {
                return {
                        ok: false,
                        rejection: {
                                reason: 'unknown-key',
                                detail: `parseProfilesRecord: the record carries the unknown key '${unknownRecordKeys[0]}' (the strict five-key record schema is closed)`,
                        },
                };
        }
        const profiles = record.profiles as unknown[];
        for (let i = 0; i < profiles.length; i += 1) {
                const profile = profiles[i];
                if (isRecord(profile)) {
                        const extraProfileKeys = Object.keys(profile as Record<string, unknown>).filter((key) => !(PROFILE_ENTRY_SCHEMA_KEYS as readonly string[]).includes(key));
                        if (extraProfileKeys.length > 0) {
                                return {
                                        ok: false,
                                        rejection: {
                                                reason: 'unknown-key',
                                                detail: `parseProfilesRecord: the profile entry profiles[${i}] carries the unknown key '${extraProfileKeys[0]}' (a profile is profileKey + summary + permissionRefs + approvalTiers + evidenceFloor + kpiDimensions only)`,
                                        },
                                };
                        }
                }
        }
        const history = record.history as unknown[];
        for (let i = 0; i < history.length; i += 1) {
                const note = history[i];
                if (isRecord(note)) {
                        const extraNoteKeys = Object.keys(note as Record<string, unknown>).filter(
                                (key) => !(PROFILES_NOTE_SCHEMA_KEYS as readonly string[]).includes(key),
                        );
                        if (extraNoteKeys.length > 0) {
                                return {
                                        ok: false,
                                        rejection: {
                                                reason: 'unknown-key',
                                                detail: `parseProfilesRecord: the history note history[${i}] carries the unknown key '${extraNoteKeys[0]}' (the note schema is closed)`,
                                        },
                                };
                        }
                }
        }
        const deep = validateProfilesRecord(parsed);
        if (!deep.ok) {
                return {
                        ok: false,
                        rejection: {
                                reason: 'invalid-record',
                                detail: `parseProfilesRecord: the parsed record fails the deep record walk (${deep.rejections[0].reason} - ${deep.rejections[0].detail}; never a silent partial parse)`,
                        },
                };
        }
        // THE CANONICALITY LAW: the bytes must BE the canonical serialization
        // (the frozen key orders, the profileKey sort, the compact form) - a
        // parse that normalizes drifting bytes would be a silent rewrite.
        if (bytes !== serializeProfilesRecord(deep.value)) {
                return {
                        ok: false,
                        rejection: {
                                reason: 'non-canonical',
                                detail: 'parseProfilesRecord: the bytes are not the canonical serialization (the frozen key orders, the profile entries sorted by profileKey, the compact JSON form) - non-canonical bytes are refused, never silently normalized',
                        },
                };
        }
        return { ok: true, record: deep.value };
}

// --- internal helpers (never exported; the family's mirrored idioms) ---

/** Pure predicate: a plain object (not null, not an array). */
function isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Own-property check (never the prototype chain). */
function hasOwn(record: Record<string, unknown>, key: string): boolean {
        return Object.prototype.hasOwnProperty.call(record, key);
}

/** The distinct members of a list in first-seen order (THE FAIL-CLOSED LAW's name-each-offender-once discipline). */
function distinctFirstSeen(values: readonly string[]): string[] {
        const seen = new Set<string>();
        const distinct: string[] = [];
        for (const value of values) {
                if (!seen.has(value)) {
                        seen.add(value);
                        distinct.push(value);
                }
        }
        return distinct;
}

/** The duplicated members of a list (each duplicate reported once, in first-seen order). */
function findDuplicates(values: readonly string[]): string[] {
        const seen = new Set<string>();
        const reported = new Set<string>();
        const duplicates: string[] = [];
        for (const value of values) {
                if (seen.has(value) && !reported.has(value)) {
                        reported.add(value);
                        duplicates.push(value);
                }
                seen.add(value);
        }
        return duplicates;
}

/** The distinct control characters of a string (C0, DEL and C1), as U+XXXX codes in first-seen order. */
function controlCharactersOf(value: string): string[] {
        const seen = new Set<string>();
        const found: string[] = [];
        for (const character of value) {
                if (/[\u0000-\u001F\u007F-\u009F]/.test(character) && !seen.has(character)) {
                        seen.add(character);
                        found.push(`U+${character.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`);
                }
        }
        return found;
}

/** The profileKey bound violations (empty, over-length), as deterministic item strings. */
function profileKeyLengthViolationsOf(profileKey: string): string[] {
        const violations: string[] = [];
        if (profileKey.length === 0) {
                violations.push('empty');
        }
        if (profileKey.length > PROFILE_KEY_MAX_LENGTH) {
                violations.push(`${profileKey.length} chars`);
        }
        return violations;
}

/** The summary bound violations (empty, over-length), as deterministic item strings. */
function summaryLengthViolationsOf(summary: string): string[] {
        const violations: string[] = [];
        if (summary.length === 0) {
                violations.push('empty');
        }
        if (summary.length > PROFILE_SUMMARY_MAX_LENGTH) {
                violations.push(`${summary.length} chars`);
        }
        return violations;
}

/** Shows a value for a deterministic detail sentence (primitives only, never a full dump). */
function showValue(value: unknown): string {
        if (typeof value === 'string') {
                return value.length === 0 ? '<empty string>' : value;
        }
        if (value === null) {
                return '<null>';
        }
        if (value === undefined) {
                return '<undefined>';
        }
        if (typeof value === 'number' || typeof value === 'boolean') {
                return String(value);
        }
        if (Array.isArray(value)) {
                return '<array>';
        }
        return '<object>';
}

/** Shows a list of keys for a deterministic detail sentence. */
function showList(values: readonly string[]): string {
        return `[${values.join(', ')}]`;
}

/** Extracts an honest message from a thrown value (never re-throws). */
function toMessage(error: unknown): string {
        if (error instanceof Error) {
                return error.message;
        }
        return String(error);
}

/** Pure predicate: a well-formed history note (the exact six keys; member stages and op; non-empty strings). */
function isWellFormedNote(value: unknown): value is ProfilesTransitionNote {
        if (!isRecord(value)) {
                return false;
        }
        const record = value as Record<string, unknown>;
        const keys = Object.keys(record).sort();
        const expected = [...PROFILES_NOTE_SCHEMA_KEYS].sort();
        if (keys.length !== expected.length) {
                return false;
        }
        for (let i = 0; i < keys.length; i += 1) {
                if (keys[i] !== expected[i]) {
                        return false;
                }
        }
        if (typeof record.at !== 'string' || record.at.length === 0) {
                return false;
        }
        if (record.fromStage !== null && !isProfilesStage(record.fromStage)) {
                return false;
        }
        if (!isProfilesStage(record.toStage)) {
                return false;
        }
        if (!isProfilesOpName(record.op)) {
                return false;
        }
        if (typeof record.law !== 'string' || record.law.length === 0) {
                return false;
        }
        if (typeof record.detail !== 'string' || record.detail.length === 0) {
                return false;
        }
        return true;
}

/** Builds the canonical fixed-key-order copy of a validated record (the entries sorted by profileKey). */
function canonicalProfilesRecord(record: ProfilesRecord): ProfilesRecord {
        return canonicalRecordObject(record) as unknown as ProfilesRecord;
}

/** Builds the canonical fixed-key-order object of a validated record (the serializer's engine). */
function canonicalRecordObject(record: ProfilesRecord): Record<string, unknown> {
        return {
                profilesId: record.profilesId,
                harnessId: record.harnessId,
                stage: record.stage,
                profiles: [...record.profiles]
                        .sort((left, right) => (left.profileKey < right.profileKey ? -1 : left.profileKey > right.profileKey ? 1 : 0))
                        .map((profile) => ({
                                profileKey: profile.profileKey,
                                summary: profile.summary,
                                permissionRefs: [...profile.permissionRefs],
                                approvalTiers: [...profile.approvalTiers],
                                evidenceFloor: profile.evidenceFloor,
                                kpiDimensions: [...profile.kpiDimensions],
                        })),
                history: record.history.map((note) => ({
                        at: note.at,
                        fromStage: note.fromStage,
                        toStage: note.toStage,
                        op: note.op,
                        law: note.law,
                        detail: note.detail,
                })),
        };
}
