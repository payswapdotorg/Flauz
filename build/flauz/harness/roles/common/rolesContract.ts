/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * DH-003 role-composition contract family: the typed multi-role user
 * composition instrument for the Domain Harness OS direction
 * (WORK-REGISTRY.md - the wave-3 role-composition family, registry
 * row DH-003 "multi-role user composition"). Where the landed DH-002
 * onboarding kit REFUSED to invent roles (its composeDraft takes a
 * caller-supplied OnboardingReviewComposition whose roles the
 * onboarding contract explicitly defers - "the caller supplies them -
 * role invention is DH-003's item"), THIS family is that instrument:
 * a typed, staged, deterministic role-composition session that
 * composes the domain roles and emits the review composition for the
 * REAL DH-02 kit. Composition over the landed families: the frozen
 * vocabularies, the HarnessRole law, the review-composition
 * validator and the ref-family list are the LANDED DH-01/DH-02
 * surfaces - imported from the real modules, never re-declared,
 * re-implemented or shadowed (THE IMPORT LAW, this family's charter).
 *
 * LAWS (the DH-003 work order; the landed DH-01/DH-02 family
 * precedents, inherited and binding):
 * - THE NO-FORK LAW (binding, the family charter): a harness is
 *   composable configuration over the universal Flauz core - the
 *   role composition COMPOSES the named roles; a named role grants
 *   NOTHING by itself (roleKey + summary, exactly two keys,
 *   configuration only). The structural engine's role station: any
 *   additional key on a role entry is the typed no-fork rejection.
 * - THE IMPORT LAW (binding, this wave's charter): the frozen
 *   vocabularies, the HarnessRole law, the review-composition
 *   validator, the ref-family list and the persistence architecture
 *   are the LANDED DH-01/DH-02 surfaces - imported from the real
 *   modules, never re-declared, re-implemented or shadowed (the
 *   battery pins the imports).
 * - THE FROZEN-VOCABULARY LAW (binding): the composition admits ONLY
 *   the landed HARNESS_INDUSTRIES members (membership is the only
 *   admissibility; the composition is industry-scoped).
 * - THE FORWARD-ONLY LAW (binding): composing -> composed; 'composed'
 *   is TERMINAL (a frozen composition; every mutating op on a
 *   composed session refuses with the stage law); a changed
 *   composition is a NEW session (the composition lineage law).
 * - THE DETERMINISM LAW (binding): no Math.random, no Date.now, no
 *   new Date(...) and no process.env in this module (law comments
 *   excepted) - the module is pure vocabulary over typed values; the
 *   clock and the rng are INJECTED at the kit boundary; the
 *   serialization is canonical fixed-key-order bytes.
 * - THE FAIL-CLOSED LAW (binding): every refusal is a typed record
 *   naming the violated law and the offending items; no silent
 *   successes, no partial effects, never a bare throw on a domain
 *   refusal; multi-offense validations report the COMPLETE rejection
 *   table in the frozen walk order.
 * - THE SINGLE-VERSION LAW (binding): ROLES_CONTRACTS_VERSION is
 *   '1.0.0' declared ONCE here, re-carried by the kit;
 *   DOMAIN_HARNESS_CONTRACTS_VERSION and ONBOARDING_CONTRACTS_VERSION
 *   are declared ONCE in THEIR modules and re-carried here by
 *   reference (the battery pins every copy equal).
 * - THE HONEST-GAP LAW (binding): the absent workflow / policy /
 *   evidence authorities are disclosed, never papered over - the
 *   emit's ref families default EMPTY (an empty family is the truth;
 *   a fabricated id would be the fork; the owning waves are DH-004 /
 *   DH-005 / DH-008).
 * - Zero external dependencies: this module is pure vocabulary over
 *   typed values; no I/O, no clock, no env read.
 */

import {
        HARNESS_REF_FAMILIES,
        isHarnessIndustry,
} from '../../contract/common/domainHarnessContract.js';
import type { HarnessIndustry, HarnessRole } from '../../contract/common/domainHarnessContract.js';
import type { OnboardingReviewComposition } from '../../onboarding/common/onboardingContract.js';

/**
 * THE IMPORT LAW's re-export block: the frozen DH-01 vocabularies and
 * both landed contract versions are re-exported BY REFERENCE (the
 * same bindings, never re-declared copies). The battery pins
 * referential identity against the real modules.
 */
export {
        DOMAIN_HARNESS_CONTRACTS_VERSION,
        HARNESS_INDUSTRIES,
        HARNESS_REF_FAMILIES,
        isHarnessIndustry,
} from '../../contract/common/domainHarnessContract.js';
export type { HarnessIndustry, HarnessRole } from '../../contract/common/domainHarnessContract.js';
export { ONBOARDING_CONTRACTS_VERSION } from '../../onboarding/common/onboardingContract.js';

/** THE SINGLE-VERSION LAW: ROLES_CONTRACTS_VERSION is declared ONCE here, re-carried by the kit. */
export const ROLES_CONTRACTS_VERSION = '1.0.0';

/**
 * The role-composition session id prefix (this family's namespace;
 * the same id law as flauz:hrn: / flauz:onb: - the kit mints
 * <prefix><16 lowercase hex> from the injected rng).
 */
export const ROLE_COMPOSITION_ID_PREFIX = 'flauz:rol:';

/**
 * The closed frozen stage vocabulary: the role-composition walk's two
 * stages. 'composed' is TERMINAL (a frozen composition; every mutáting
 * op on a composed session refuses with the stage law; a changed
 * composition is a NEW session, the composition lineage law).
 */
export const ROLE_COMPOSITION_STAGES = [
        'composing',
        'composed',
] as const;
export type RoleCompositionStage = (typeof ROLE_COMPOSITION_STAGES)[number];

/** Pure predicate over the closed stage list. */
export function isRoleCompositionStage(value: unknown): value is RoleCompositionStage {
        return (ROLE_COMPOSITION_STAGES as readonly string[]).includes(value as string);
}

/** One whitelisted forward stage transition row (THE FORWARD-ONLY LAW's whitelist). */
export interface RoleCompositionStageTransition {
        readonly from: RoleCompositionStage;
        readonly to: RoleCompositionStage;
}

/**
 * The frozen forward-only whitelist: the ONLY legal stage transition
 * is composing->composed. 'composed' is TERMINAL - no reopen; a
 * changed composition is a NEW session (the composition lineage law).
 * Widening the map is a versioned contract decision.
 */
export const ROLE_COMPOSITION_FORWARD_TRANSITIONS = [
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
export type RoleCompositionStageVerdict =
        | { readonly ok: true; readonly from: RoleCompositionStage; readonly to: RoleCompositionStage; readonly row: number }
        | {
                        readonly ok: false;
                        readonly reason: 'ILLEGAL_TRANSITION';
                        readonly from: unknown;
                        readonly to: unknown;
                        readonly whitelistRow: number | null;
                        readonly expectedTo: RoleCompositionStage | null;
                        readonly detail: string;
                };

/**
 * THE FORWARD-ONLY LAW's verdict machine (pure): the exact whitelist
 * membership check. The only legal transition is composing->composed;
 * every other edge (self-loops, composed->anything, unknown stages,
 * non-strings) is the typed ILLEGAL_TRANSITION rejection naming the
 * violated whitelist row.
 */
export function canTransitionRoleCompositionStage(from: unknown, to: unknown): RoleCompositionStageVerdict {
        const transitions = ROLE_COMPOSITION_FORWARD_TRANSITIONS as readonly RoleCompositionStageTransition[];
        let rowNumber = 0;
        for (let i = 0; i < transitions.length; i += 1) {
                if (transitions[i].from === from) {
                        rowNumber = i + 1;
                        break;
                }
        }
        if (!isRoleCompositionStage(from) || !isRoleCompositionStage(to)) {
                return {
                        ok: false,
                        reason: 'ILLEGAL_TRANSITION',
                        from,
                        to,
                        whitelistRow: rowNumber > 0 ? rowNumber : null,
                        expectedTo: rowNumber > 0 ? transitions[rowNumber - 1].to : null,
                        detail: `canTransitionRoleCompositionStage: '${showValue(from)}' -> '${showValue(to)}' is refused - both stages must be members of the frozen ROLE_COMPOSITION_STAGES list (THE FORWARD-ONLY LAW - the stage vocabulary is frozen)`,
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
                        detail: `canTransitionRoleCompositionStage: '${from}' -> '${to}' is refused - 'composed' is TERMINAL (the composition is FROZEN; a changed composition is a NEW session, the composition lineage law) (THE FORWARD-ONLY LAW)`,
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
                        detail: `canTransitionRoleCompositionStage: '${from}' -> '${to}' is refused - the only whitelisted forward transition from '${from}' is row ${rowNumber} ('${from}' -> '${expectedTo}') (THE FORWARD-ONLY LAW - forward-only; composed is terminal)`,
                };
        }
        return { ok: true, from, to, row: rowNumber };
}

/**
 * The composition-layer role laws (the DH-01 floor + the honest
 * composition bounds - all frozen constants): the roleKey is non-empty,
 * at most 64 characters, carries NO leading/trailing whitespace and no
 * control characters; the summary is non-empty, at most 200 characters
 * and carries no control characters; the composition holds at most
 * MAX_ROLES (32) roles.
 */
export const ROLE_KEY_MAX_LENGTH = 64;

/** The summary bound (non-empty, at most 200 characters, no control characters). */
export const ROLE_SUMMARY_MAX_LENGTH = 200;

/** The composition bound (at most 32 roles; the empty floor fires at finalize / emit). */
export const MAX_ROLES = 32;

/**
 * The frozen role-composition op-name vocabulary (the ledger line ops;
 * the emit is a READ op and never lands a line).
 */
export const ROLE_COMPOSITION_OP_NAMES = [
        'begin-session',
        'add-role',
        'replace-role-summary',
        'remove-role',
        'finalize-composition',
] as const;
export type RoleCompositionOpName = (typeof ROLE_COMPOSITION_OP_NAMES)[number];

/** Pure predicate over the closed op-name list. */
export function isRoleCompositionOpName(value: unknown): value is RoleCompositionOpName {
        return (ROLE_COMPOSITION_OP_NAMES as readonly string[]).includes(value as string);
}

/**
 * One provenance note in the session history: which clock reading the
 * op landed at, the stage edge it walked (fromStage null ONLY on the
 * begin note - the entry into 'composing'; the role ops are the
 * composing->composing self edge - the composition composes
 * gradually), which op and which law granted it, and the
 * deterministic detail sentence.
 */
export interface RoleCompositionTransitionNote {
        readonly at: string;
        readonly fromStage: RoleCompositionStage | null;
        readonly toStage: RoleCompositionStage;
        readonly op: RoleCompositionOpName;
        readonly law: string;
        readonly detail: string;
}

/**
 * The persisted per-session record (the honest record, THE FIVE-KEY
 * MODEL): the id, the industry that scopes the composition (one REAL
 * HARNESS_INDUSTRIES member, imported by reference), the stage, the
 * composed roles (the DH-01 HarnessRole shape, imported by reference;
 * MAY be empty while composing - the empty floor fires at finalize /
 * emit, never the session shape), and the full op history with
 * provenance. The record carries NO contractVersion field: THE
 * SINGLE-VERSION LAW is enforced at the kit-layer persistence
 * surfaces (every ledger line and the envelope carry
 * ROLES_CONTRACTS_VERSION; a drift there is the typed
 * version-mismatch). Stage-vs-payload consistency is the ledger
 * replay's cross-check, never this shape's (the DH-01 guard
 * discipline).
 */
export interface RoleCompositionSession {
        readonly sessionId: string;
        readonly industry: HarnessIndustry;
        readonly stage: RoleCompositionStage;
        readonly roles: readonly HarnessRole[];
        readonly history: readonly RoleCompositionTransitionNote[];
}

/** The frozen session-record schema keys, in the canonical fixed-key-order (the serialization order). */
export const ROLE_COMPOSITION_SESSION_SCHEMA_KEYS = [
        'sessionId',
        'industry',
        'stage',
        'roles',
        'history',
] as const;

/** The frozen history-note schema keys, in the canonical fixed-key-order. */
export const ROLE_COMPOSITION_NOTE_SCHEMA_KEYS = [
        'at',
        'fromStage',
        'toStage',
        'op',
        'law',
        'detail',
] as const;

/** Pure predicate: a well-formed role-composition session id (flauz:rol:<16-hex>). */
export function isRoleCompositionSessionId(value: unknown): value is string {
        if (typeof value !== 'string') {
                return false;
        }
        if (!value.startsWith(ROLE_COMPOSITION_ID_PREFIX)) {
                return false;
        }
        const hex = value.slice(ROLE_COMPOSITION_ID_PREFIX.length);
        return /^[0-9a-f]{16}$/.test(hex);
}

/**
 * Closed frozen list of role-composition rejection reasons, in the
 * exact walk order (the work order's fifteen stations are the EXACT
 * PREFIX; the four appended stations are this family's own design -
 * each documented below - the work order authorizes the extension
 * "where your design needs a distinct station"; the validation walks
 * collect EVERY violated law into the typed rejection table, the
 * table's records appearing in this order):
 *   malformed-record      - the candidate is not a plain object, or a
 *                           carrier carries the wrong structural type
 *                           (a non-array roles / history / ref-family
 *                           carrier, a non-record refs carrier, a
 *                           non-string ref member or summary carrier);
 *   unknown-key           - a key outside the frozen five-key session
 *                           schema (or outside the four-family refs
 *                           schema at the emit boundary);
 *   missing-key           - a required session key is absent;
 *   unknown-industry      - THE FROZEN-VOCABULARY LAW: the industry is
 *                           not a member of the DH-01 list (imported
 *                           by reference);
 *   malformed-role        - a role entry is not a plain object, or a
 *                           roleKey / summary carrier is not a string;
 *   no-fork               - THE NO-FORK LAW's role station: a role
 *                           entry carries a key beyond roleKey +
 *                           summary (a named role is CONFIGURATION -
 *                           it grants NOTHING by itself);
 *   invalid-role-key      - the roleKey is empty, longer than 64
 *                           characters, carries leading/trailing
 *                           whitespace, or carries control characters
 *                           (C0/DEL/C1);
 *   invalid-summary       - the summary is empty, longer than 200
 *                           characters, or carries control characters
 *                           (C0/DEL/C1);
 *   duplicate-role-key    - roleKeys are not unique within the
 *                           composition;
 *   max-roles-exceeded    - the composition carries more than
 *                           MAX_ROLES (32) roles (the composition
 *                           bound);
 *   empty-roles           - THE DH-01 FLOOR: the finalize / emit
 *                           boundary requires at least one composed
 *                           role (a composing session may hold zero);
 *   unknown-session       - the session id is not the
 *                           flauz:rol:<16-hex> form (and, at the kit
 *                           layer, no session resolves under the id -
 *                           a malformed id fails closed as unknown);
 *   version-mismatch      - THE SINGLE-VERSION LAW: a version-bearing
 *                           persisted surface (a kit-layer ledger line
 *                           or the envelope) carries a contract
 *                           version other than ROLES_CONTRACTS_VERSION
 *                           (the five-key session record carries no
 *                           version field - this station never fires
 *                           in the pure session walk);
 *   unknown-stage         - the stage is not a member of the frozen
 *                           ROLE_COMPOSITION_STAGES list;
 *   malformed-history     - a history note fails the frozen six-key
 *                           note shape;
 *   premature-op          - THE FORWARD-ONLY LAW (kit layer): the op
 *                           precedes its precondition within the walk
 *                           (the emit requires the composed stage);
 *   stale-stage           - THE FORWARD-ONLY LAW (kit layer): the op
 *                           is behind the walk (a mutating op on a
 *                           composed session - 'composed' is TERMINAL,
 *                           the composition is FROZEN);
 *   unknown-role          - the roleKey names no role in the
 *                           composition (at the kit layer; a malformed
 *                           key fails closed as unknown);
 *   duplicate-ref         - an emit ref family carries repeats.
 * Widening or reordering the list is a versioned contract decision.
 */
export const ROLES_REJECTION_REASONS = [
        'malformed-record',
        'unknown-key',
        'missing-key',
        'unknown-industry',
        'malformed-role',
        'no-fork',
        'invalid-role-key',
        'invalid-summary',
        'duplicate-role-key',
        'max-roles-exceeded',
        'empty-roles',
        'unknown-session',
        'version-mismatch',
        'unknown-stage',
        'malformed-history',
        'premature-op',
        'stale-stage',
        'unknown-role',
        'duplicate-ref',
] as const;
export type RoleCompositionRejectionReason = (typeof ROLES_REJECTION_REASONS)[number];

/** Pure predicate over the closed rejection list. */
export function isRoleCompositionRejectionReason(value: unknown): value is RoleCompositionRejectionReason {
        return (ROLES_REJECTION_REASONS as readonly string[]).includes(value as string);
}

/**
 * One typed rejection from a validation walk: the frozen reason, the
 * violated law's name, the offending items, and the deterministic
 * detail sentence. NEVER a string throw, NEVER a silent skip.
 */
export interface RoleCompositionRejection {
        readonly reason: RoleCompositionRejectionReason;
        readonly law: string;
        readonly items?: readonly string[];
        readonly detail: string;
}

/**
 * The typed validation outcome (the family's outcome pattern, the
 * generic shape of the DH-02 OnboardingPayloadOutcome carrying the
 * DH-01 complete-table law): ok carries the canonical value; refusal
 * carries the COMPLETE typed rejection table in the frozen walk order
 * - never first-only.
 */
export type RoleCompositionValidationOutcome<T> =
        | { readonly ok: true; readonly value: T }
        | { readonly ok: false; readonly mode: 'shape'; readonly rejections: readonly RoleCompositionRejection[] };

/**
 * The single-role station walk (the kit's addRole station, the
 * family's per-payload validator architecture): malformed-role ->
 * no-fork -> invalid-role-key -> invalid-summary, the complete table
 * over ONE entry. Ok carries the canonical { roleKey, summary } copy.
 */
export function validateRoleEntry(role: unknown): RoleCompositionValidationOutcome<HarnessRole> {
        const rejections: RoleCompositionRejection[] = [];
        if (!isRecord(role)) {
                rejections.push({
                        reason: 'malformed-role',
                        law: 'THE FAIL-CLOSED LAW',
                        items: ['role'],
                        detail: 'validateRoleEntry: every role entry must be a plain object of exactly { roleKey, summary } (a named role is configuration; it grants NOTHING by itself)',
                });
                return { ok: false, mode: 'shape', rejections };
        }
        const record = role as Record<string, unknown>;
        if (typeof record.roleKey !== 'string' || typeof record.summary !== 'string') {
                rejections.push({
                        reason: 'malformed-role',
                        law: 'THE FAIL-CLOSED LAW',
                        items: [typeof record.roleKey !== 'string' ? 'roleKey' : 'summary'],
                        detail: 'validateRoleEntry: the roleKey and the summary must be strings (a named role is a key plus a human summary)',
                });
        }
        const extraKeys = Object.keys(record).filter((key) => key !== 'roleKey' && key !== 'summary');
        if (extraKeys.length > 0) {
                rejections.push({
                        reason: 'no-fork',
                        law: 'THE NO-FORK LAW',
                        items: extraKeys,
                        detail: `validateRoleEntry: a named role is CONFIGURATION (a roleKey plus a human summary) - it grants NOTHING by itself; the extra key(s) ${showList(extraKeys)} are execution material and cannot appear on a role entry`,
                });
        }
        if (typeof record.roleKey === 'string') {
                const violations = roleKeyViolationsOf(record.roleKey);
                if (violations.length > 0) {
                        rejections.push({
                                reason: 'invalid-role-key',
                                law: 'THE FAIL-CLOSED LAW',
                                items: violations,
                                detail: `validateRoleEntry: the roleKey must be a non-empty string of at most ${ROLE_KEY_MAX_LENGTH} characters with no leading/trailing whitespace and no control characters (C0/DEL/C1)`,
                        });
                }
        }
        if (typeof record.summary === 'string') {
                const violations = summaryViolationsOf(record.summary);
                if (violations.length > 0) {
                        rejections.push({
                                reason: 'invalid-summary',
                                law: 'THE FAIL-CLOSED LAW',
                                items: violations,
                                detail: `validateRoleEntry: the summary must be a non-empty string of at most ${ROLE_SUMMARY_MAX_LENGTH} characters with no control characters (C0/DEL/C1)`,
                        });
                }
        }
        if (rejections.length > 0) {
                return { ok: false, mode: 'shape', rejections };
        }
        return { ok: true, value: { roleKey: record.roleKey as string, summary: record.summary as string } };
}

/**
 * The summary station walk (the kit's replaceRoleSummary station):
 * malformed-record (the non-string carrier) -> invalid-summary (the
 * bounds). Ok carries the summary string.
 */
export function validateRoleSummary(summary: unknown): RoleCompositionValidationOutcome<string> {
        const rejections: RoleCompositionRejection[] = [];
        if (typeof summary !== 'string') {
                rejections.push({
                        reason: 'malformed-record',
                        law: 'THE FAIL-CLOSED LAW',
                        items: ['summary'],
                        detail: 'validateRoleSummary: the summary must be a string (the named role\'s human summary)',
                });
        } else {
                const violations = summaryViolationsOf(summary);
                if (violations.length > 0) {
                        rejections.push({
                                reason: 'invalid-summary',
                                law: 'THE FAIL-CLOSED LAW',
                                items: violations,
                                detail: `validateRoleSummary: the summary must be a non-empty string of at most ${ROLE_SUMMARY_MAX_LENGTH} characters with no control characters (C0/DEL/C1)`,
                        });
                }
        }
        if (rejections.length > 0) {
                return { ok: false, mode: 'shape', rejections };
        }
        return { ok: true, value: summary as string };
}

/**
 * The deep session-record walk (pure): the strict five-key shape walk
 * over the honest record - malformed-record (the record and its
 * carriers), unknown-key, missing-key, unknown-industry (THE
 * FROZEN-VOCABULARY LAW against the REAL import), the roles family
 * laws (malformed-role / no-fork / invalid-role-key / invalid-summary
 * per entry, duplicate-role-key, max-roles-exceeded), unknown-session
 * (the id alphabet), unknown-stage, malformed-history. THE COMPLETE
 * TABLE: every violated station is reported, in the frozen walk
 * order. Empty roles are LEGAL here (the floor fires at finalize /
 * emit, never the session shape); stage-vs-payload consistency is the
 * ledger replay's cross-check, never this walk's. Ok carries the
 * canonical fixed-key-order copy.
 */
export function validateRoleCompositionSession(value: unknown): RoleCompositionValidationOutcome<RoleCompositionSession> {
        const rejections: RoleCompositionRejection[] = [];
        if (!isRecord(value)) {
                rejections.push({
                        reason: 'malformed-record',
                        law: 'THE FAIL-CLOSED LAW',
                        items: ['session'],
                        detail: 'validateRoleCompositionSession: the session record must be a plain object (never a silent partial verdict)',
                });
                return { ok: false, mode: 'shape', rejections };
        }
        const record = value as Record<string, unknown>;
        const keys = Object.keys(record);

        // station 1 (malformed-record): the carriers.
        const carrierViolations: string[] = [];
        if (hasOwn(record, 'roles') && !Array.isArray(record.roles)) {
                carrierViolations.push('roles');
        }
        if (hasOwn(record, 'history') && !Array.isArray(record.history)) {
                carrierViolations.push('history');
        }
        if (carrierViolations.length > 0) {
                rejections.push({
                        reason: 'malformed-record',
                        law: 'THE FAIL-CLOSED LAW',
                        items: carrierViolations,
                        detail: `validateRoleCompositionSession: a session field carries the wrong structural type - the carrier(s) ${showList(carrierViolations)} must be arrays (never a silent partial verdict)`,
                });
        }

        // station 2 (unknown-key): the strict five-key schema is closed.
        const unknownKeys = keys.filter((key) => !(ROLE_COMPOSITION_SESSION_SCHEMA_KEYS as readonly string[]).includes(key));
        if (unknownKeys.length > 0) {
                rejections.push({
                        reason: 'unknown-key',
                        law: 'THE FAIL-CLOSED LAW',
                        items: unknownKeys,
                        detail: `validateRoleCompositionSession: the session-record schema is closed (THE FIVE-KEY MODEL) - the unknown key(s) ${showList(unknownKeys)} are rejected`,
                });
        }

        // station 3 (missing-key): the strict schema requires every key.
        const missingKeys = (ROLE_COMPOSITION_SESSION_SCHEMA_KEYS as readonly string[]).filter((key) => !hasOwn(record, key));
        if (missingKeys.length > 0) {
                rejections.push({
                        reason: 'missing-key',
                        law: 'THE FAIL-CLOSED LAW',
                        items: missingKeys,
                        detail: `validateRoleCompositionSession: the session-record schema requires every key - the key(s) ${showList(missingKeys)} are missing`,
                });
        }

        // station 4 (unknown-industry): THE FROZEN-VOCABULARY LAW against the REAL import.
        // (the DH-01 absent-key discipline: a PRESENT-but-invalid value fires this
        // station; an absent key is station 3's missing-key, never a cascade here.)
        if (hasOwn(record, 'industry') && !isHarnessIndustry(record.industry)) {
                rejections.push({
                        reason: 'unknown-industry',
                        law: 'THE FROZEN-VOCABULARY LAW',
                        items: [showValue(record.industry)],
                        detail: 'validateRoleCompositionSession: the industry must be a member of the frozen HARNESS_INDUSTRIES list, imported by reference from the DH-01 contract (membership is the only admissibility; the composition is industry-scoped)',
                });
        }

        // stations 5-10 (the roles family laws), only walkable when the carrier is an array.
        if (Array.isArray(record.roles)) {
                const roles = record.roles as unknown[];
                for (let i = 0; i < roles.length; i += 1) {
                        const role = roles[i];
                        if (!isRecord(role)) {
                                rejections.push({
                                        reason: 'malformed-role',
                                        law: 'THE FAIL-CLOSED LAW',
                                        items: [`roles[${i}]`],
                                        detail: 'validateRoleCompositionSession: every role entry must be { roleKey, summary } with non-empty strings (a named role is configuration; it grants NOTHING by itself)',
                                });
                                continue;
                        }
                        const entry = validateRoleEntry(role);
                        if (!entry.ok) {
                                for (const rejection of entry.rejections) {
                                        rejections.push(prefixRejectionItems(rejection, `roles[${i}]`));
                                }
                        }
                }
                const roleKeyDuplicates = findDuplicates(
                        roles.filter((role) => isRecord(role) && typeof (role as Record<string, unknown>).roleKey === 'string').map(
                                (role) => (role as Record<string, unknown>).roleKey as string,
                        ),
                );
                if (roleKeyDuplicates.length > 0) {
                        rejections.push({
                                reason: 'duplicate-role-key',
                                law: 'THE FAIL-CLOSED LAW',
                                items: roleKeyDuplicates,
                                detail: 'validateRoleCompositionSession: roleKeys must be unique within the composition (a named role appears once)',
                        });
                }
                if (roles.length > MAX_ROLES) {
                        rejections.push({
                                reason: 'max-roles-exceeded',
                                law: 'THE FAIL-CLOSED LAW',
                                items: [`${roles.length} roles`],
                                detail: `validateRoleCompositionSession: the composition carries at most MAX_ROLES (${MAX_ROLES}) roles (the composition bound)`,
                        });
                }
        }

        // station 12 (unknown-session): the id alphabet.
        // (the absent-key discipline: an absent sessionId is station 3's
        // missing-key, never a cascade here.)
        if (hasOwn(record, 'sessionId') && !isRoleCompositionSessionId(record.sessionId)) {
                rejections.push({
                        reason: 'unknown-session',
                        law: 'THE FAIL-CLOSED LAW',
                        items: [showValue(record.sessionId)],
                        detail: `validateRoleCompositionSession: the sessionId must be the ${ROLE_COMPOSITION_ID_PREFIX}<16-hex> form (minted from the injected rng at the kit boundary, never caller-supplied)`,
                });
        }

        // station 13 (version-mismatch) never fires on THE FIVE-KEY MODEL: the session
        // record carries no contractVersion - THE SINGLE-VERSION LAW is enforced at the
        // kit-layer persistence surfaces (every ledger line and the envelope carry
        // ROLES_CONTRACTS_VERSION; a drift there is the typed version-mismatch).

        // station 14 (unknown-stage).
        // (the absent-key discipline: an absent stage is station 3's missing-key,
        // never a cascade here — the DH-01 law: an absent key is the missing-key
        // station, never a structural one.)
        if (hasOwn(record, 'stage') && !isRoleCompositionStage(record.stage)) {
                rejections.push({
                        reason: 'unknown-stage',
                        law: 'THE FORWARD-ONLY LAW',
                        items: [showValue(record.stage)],
                        detail: 'validateRoleCompositionSession: the stage must be a member of the frozen ROLE_COMPOSITION_STAGES list (composing -> composed; composed is TERMINAL)',
                });
        }

        // station 15 (malformed-history), only walkable when the carrier is an array.
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
                                reason: 'malformed-history',
                                law: 'THE FAIL-CLOSED LAW',
                                items: malformed,
                                detail: 'validateRoleCompositionSession: every history note must carry the frozen six-key note shape (at / fromStage / toStage / op / law / detail - the provenance record)',
                        });
                }
        }

        if (rejections.length > 0) {
                return { ok: false, mode: 'shape', rejections };
        }
        return { ok: true, value: canonicalRoleCompositionSession(record as unknown as RoleCompositionSession) };
}

/**
 * The emit-input walk (pure): the composed roles array (the full role
 * family laws incl. THE DH-01 FLOOR - the emit must name at least one
 * role) and the four ref-family carriers (HARNESS_REF_FAMILIES from
 * the REAL DH-01 contract - string arrays, duplicate-free, MAY be
 * empty; non-array carriers refuse; the ABSENT carriers default EMPTY
 * per THE HONEST-GAP LAW - the emit NEVER invents a non-empty ref).
 * THE COMPLETE TABLE in the frozen walk order. Ok carries the full
 * canonical OnboardingReviewComposition (roles + the four families).
 */
export function validateReviewCompositionEmit(roles: unknown, refs: unknown): RoleCompositionValidationOutcome<OnboardingReviewComposition> {
        const rejections: RoleCompositionRejection[] = [];

        // station 1 (malformed-record): every structural check first (the roles carrier, the refs record, the four family carriers and their members).
        const structural: string[] = [];
        if (!Array.isArray(roles)) {
                structural.push('roles');
        }
        const refsIsRecord = isRecord(refs);
        if (!refsIsRecord) {
                structural.push('refs');
        }
        const refsRecord: Record<string, unknown> = refsIsRecord ? (refs as Record<string, unknown>) : {};
        const familyCarriers: Record<string, string[]> = {};
        for (const family of HARNESS_REF_FAMILIES) {
                const carrier = refsRecord[family];
                if (carrier === undefined) {
                        // THE HONEST-GAP LAW: the absent carrier defaults EMPTY (an empty family is the truth; a fabricated id would be the fork).
                        familyCarriers[family] = [];
                        continue;
                }
                if (!Array.isArray(carrier)) {
                        structural.push(family);
                        familyCarriers[family] = [];
                        continue;
                }
                const nonStringMembers: string[] = [];
                for (let i = 0; i < carrier.length; i += 1) {
                        if (typeof carrier[i] !== 'string') {
                                nonStringMembers.push(`${family}[${i}]`);
                        }
                }
                if (nonStringMembers.length > 0) {
                        structural.push(...nonStringMembers);
                        familyCarriers[family] = [];
                        continue;
                }
                familyCarriers[family] = carrier as string[];
        }
        if (structural.length > 0) {
                rejections.push({
                        reason: 'malformed-record',
                        law: 'THE FAIL-CLOSED LAW',
                        items: structural,
                        detail: `validateReviewCompositionEmit: a field carries the wrong structural type - the offending field(s) ${showList(structural)} (the roles carrier must be an array; the refs must be a plain object whose four HARNESS_REF_FAMILIES carriers are string arrays; never a silent partial verdict)`,
                });
        }

        // station 2 (unknown-key): the refs record admits ONLY the four ref families (imported by reference).
        const unknownKeys = Object.keys(refsRecord).filter((key) => !(HARNESS_REF_FAMILIES as readonly string[]).includes(key));
        if (unknownKeys.length > 0) {
                rejections.push({
                        reason: 'unknown-key',
                        law: 'THE FAIL-CLOSED LAW',
                        items: unknownKeys,
                        detail: `validateReviewCompositionEmit: the refs record admits only the four HARNESS_REF_FAMILIES carriers - the unknown key(s) ${showList(unknownKeys)} are rejected (the composition alphabet is references only)`,
                });
        }

        // stations 5-11 (the roles family laws), only walkable when the carrier is an array.
        if (Array.isArray(roles)) {
                const rolesList = roles as unknown[];
                for (let i = 0; i < rolesList.length; i += 1) {
                        const role = rolesList[i];
                        if (!isRecord(role)) {
                                rejections.push({
                                        reason: 'malformed-role',
                                        law: 'THE FAIL-CLOSED LAW',
                                        items: [`roles[${i}]`],
                                        detail: 'validateReviewCompositionEmit: every role entry must be { roleKey, summary } with non-empty strings (a named role is configuration; it grants NOTHING by itself)',
                                });
                                continue;
                        }
                        const entry = validateRoleEntry(role);
                        if (!entry.ok) {
                                for (const rejection of entry.rejections) {
                                        rejections.push(prefixRejectionItems(rejection, `roles[${i}]`));
                                }
                        }
                }
                const roleKeyDuplicates = findDuplicates(
                        rolesList.filter((role) => isRecord(role) && typeof (role as Record<string, unknown>).roleKey === 'string').map(
                                (role) => (role as Record<string, unknown>).roleKey as string,
                        ),
                );
                if (roleKeyDuplicates.length > 0) {
                        rejections.push({
                                reason: 'duplicate-role-key',
                                law: 'THE FAIL-CLOSED LAW',
                                items: roleKeyDuplicates,
                                detail: 'validateReviewCompositionEmit: roleKeys must be unique within the composition (a named role appears once)',
                        });
                }
                if (rolesList.length > MAX_ROLES) {
                        rejections.push({
                                reason: 'max-roles-exceeded',
                                law: 'THE FAIL-CLOSED LAW',
                                items: [`${rolesList.length} roles`],
                                detail: `validateReviewCompositionEmit: the composition carries at most MAX_ROLES (${MAX_ROLES}) roles (the composition bound)`,
                        });
                }
                if (rolesList.length === 0) {
                        rejections.push({
                                reason: 'empty-roles',
                                law: 'THE FAIL-CLOSED LAW',
                                items: ['roles'],
                                detail: 'validateReviewCompositionEmit: the emit must name its domain roles (a non-empty roles array - THE DH-01 FLOOR; the caller composes them, this family never invents them)',
                        });
                }
        }

        // station 19 (duplicate-ref, the appended design station): duplicate-free families.
        for (const family of HARNESS_REF_FAMILIES) {
                const duplicates = findDuplicates(familyCarriers[family]);
                if (duplicates.length > 0) {
                        rejections.push({
                                reason: 'duplicate-ref',
                                law: 'THE FAIL-CLOSED LAW',
                                items: duplicates.map((duplicate) => `${family}:${duplicate}`),
                                detail: 'validateReviewCompositionEmit: every ref family must be duplicate-free (a reference appears once) - the offender(s) carry the family prefix',
                        });
                }
        }

        if (rejections.length > 0) {
                return { ok: false, mode: 'shape', rejections };
        }
        const composedRoles = roles as unknown[];
        return {
                ok: true,
                value: {
                        roles: composedRoles.map((role) => {
                                const roleRecord = role as Record<string, unknown>;
                                return { roleKey: roleRecord.roleKey as string, summary: roleRecord.summary as string };
                        }),
                        capabilityRefs: [...familyCarriers.capabilityRefs],
                        workflowRefs: [...familyCarriers.workflowRefs],
                        policyRefs: [...familyCarriers.policyRefs],
                        evidenceRefs: [...familyCarriers.evidenceRefs],
                },
        };
}

/**
 * Pure deep shape guard: a well-formed role-composition session (the
 * deep walk above, green). Fails closed on every malformed path; never
 * reads a clock; never mutates its input.
 */
export function isRoleCompositionSession(value: unknown): value is RoleCompositionSession {
        return validateRoleCompositionSession(value).ok;
}

/**
 * THE CANONICAL SERIALIZATION: the fixed-key-order JSON bytes of a
 * role-composition session (byte-deterministic; double-serialize
 * byte-equality; the key order frozen in this module and pinned by
 * tests - the DH-01 algorithm: the frozen per-shape key orders applied
 * deeply, never an alphabetic re-sort). The record keys emit in the
 * ROLE_COMPOSITION_SESSION_SCHEMA_KEYS order, the role entries in the
 * roleKey,summary order, and the history notes in the
 * ROLE_COMPOSITION_NOTE_SCHEMA_KEYS order. Throws TypeError on a
 * malformed record (never dishonest bytes).
 */
export function serializeRoleCompositionSession(record: unknown): string {
        if (!isRoleCompositionSession(record)) {
                throw new TypeError(
                        'serializeRoleCompositionSession: record must satisfy isRoleCompositionSession - no dishonest role-composition session ever gets canonical bytes',
                );
        }
        return JSON.stringify(canonicalSessionObject(record));
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
 *                              so this station never fires on session
 *                              bytes (the version law fires at the
 *                              kit-layer persistence surfaces as the
 *                              typed version-mismatch); the slot is
 *                              retained for the landed family's
 *                              five-reason parse shape;
 *   unknown-key              - an extra key at the record, role or
 *                              note level (tampered bytes);
 *   invalid-record           - the deep semantic walk refuses.
 */
export const ROLES_PARSE_REJECTION_REASONS = [
        'malformed-json',
        'torn-envelope',
        'unknown-contract-version',
        'unknown-key',
        'invalid-record',
] as const;
export type RoleCompositionParseRejectionReason = (typeof ROLES_PARSE_REJECTION_REASONS)[number];

/** Pure predicate over the closed parse-rejection list. */
export function isRoleCompositionParseRejectionReason(value: unknown): value is RoleCompositionParseRejectionReason {
        return (ROLES_PARSE_REJECTION_REASONS as readonly string[]).includes(value as string);
}

/** The typed parse rejection: the frozen reason and the drift-naming detail. */
export interface RoleCompositionParseRejection {
        readonly reason: RoleCompositionParseRejectionReason;
        readonly detail: string;
}

/** The typed parse outcome: ok carries the validated session; failure names the drift. */
export type RoleCompositionParseOutcome =
        | { readonly ok: true; readonly session: RoleCompositionSession }
        | { readonly ok: false; readonly rejection: RoleCompositionParseRejection };

/**
 * THE FAIL-CLOSED PARSE: bytes -> the typed parse outcome. Malformed
 * JSON, a torn envelope, an unknown key (record / role / note level),
 * or invalid content (the deep session walk) - each a typed rejection
 * naming the drift; never a silent partial parse.
 * First-failure-is-the-verdict, in the frozen
 * ROLES_PARSE_REJECTION_REASONS order.
 */
export function parseRoleCompositionSession(bytes: unknown): RoleCompositionParseOutcome {
        if (typeof bytes !== 'string') {
                return {
                        ok: false,
                        rejection: {
                                reason: 'torn-envelope',
                                detail: 'parseRoleCompositionSession: bytes must be a string (the canonical fixed-key-order session bytes)',
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
                                detail: `parseRoleCompositionSession: the bytes are not valid JSON: ${toMessage(error)}`,
                        },
                };
        }
        if (!isRecord(parsed)) {
                return {
                        ok: false,
                        rejection: {
                                reason: 'torn-envelope',
                                detail: 'parseRoleCompositionSession: the bytes must carry a JSON object (the session-record envelope)',
                        },
                };
        }
        const record = parsed as Record<string, unknown>;
        for (const key of ROLE_COMPOSITION_SESSION_SCHEMA_KEYS) {
                if (!hasOwn(record, key)) {
                        return {
                                ok: false,
                                rejection: {
                                        reason: 'torn-envelope',
                                        detail: `parseRoleCompositionSession: the '${key}' key is missing (a torn write - never a silent partial parse)`,
                                },
                        };
                }
        }
        if (typeof record.sessionId !== 'string' || typeof record.industry !== 'string' || typeof record.stage !== 'string' || !Array.isArray(record.roles) || !Array.isArray(record.history)) {
                return {
                        ok: false,
                        rejection: {
                                reason: 'torn-envelope',
                                detail: 'parseRoleCompositionSession: the record envelope carries a value of the wrong structural type (a torn write - never a silent partial parse)',
                        },
                };
        }
        const unknownRecordKeys = Object.keys(record).filter((key) => !(ROLE_COMPOSITION_SESSION_SCHEMA_KEYS as readonly string[]).includes(key));
        if (unknownRecordKeys.length > 0) {
                return {
                        ok: false,
                        rejection: {
                                reason: 'unknown-key',
                                detail: `parseRoleCompositionSession: the record carries the unknown key '${unknownRecordKeys[0]}' (the strict five-key session schema is closed)`,
                        },
                };
        }
        const roles = record.roles as unknown[];
        for (let i = 0; i < roles.length; i += 1) {
                const role = roles[i];
                if (isRecord(role)) {
                        const extraRoleKeys = Object.keys(role as Record<string, unknown>).filter((key) => key !== 'roleKey' && key !== 'summary');
                        if (extraRoleKeys.length > 0) {
                                return {
                                        ok: false,
                                        rejection: {
                                                reason: 'unknown-key',
                                                detail: `parseRoleCompositionSession: the role entry roles[${i}] carries the unknown key '${extraRoleKeys[0]}' (a named role is roleKey + summary only)`,
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
                                (key) => !(ROLE_COMPOSITION_NOTE_SCHEMA_KEYS as readonly string[]).includes(key),
                        );
                        if (extraNoteKeys.length > 0) {
                                return {
                                        ok: false,
                                        rejection: {
                                                reason: 'unknown-key',
                                                detail: `parseRoleCompositionSession: the history note history[${i}] carries the unknown key '${extraNoteKeys[0]}' (the note schema is closed)`,
                                        },
                                };
                        }
                }
        }
        const deep = validateRoleCompositionSession(parsed);
        if (!deep.ok) {
                return {
                        ok: false,
                        rejection: {
                                reason: 'invalid-record',
                                detail: `parseRoleCompositionSession: the parsed record fails the deep session walk (${deep.rejections[0].reason} - ${deep.rejections[0].detail}; never a silent partial parse)`,
                        },
                };
        }
        return { ok: true, session: deep.value };
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

/** The roleKey law violations (empty, over-length, whitespace padding, control characters), as deterministic item strings. */
function roleKeyViolationsOf(roleKey: string): string[] {
        const violations: string[] = [];
        if (roleKey.length === 0) {
                violations.push('empty');
        }
        if (roleKey.length > ROLE_KEY_MAX_LENGTH) {
                violations.push(`${roleKey.length} chars`);
        }
        if (roleKey !== roleKey.trim()) {
                violations.push('leading/trailing whitespace');
        }
        const controls = controlCharactersOf(roleKey);
        if (controls.length > 0) {
                violations.push(...controls);
        }
        return violations;
}

/** The summary law violations (empty, over-length, control characters), as deterministic item strings. */
function summaryViolationsOf(summary: string): string[] {
        const violations: string[] = [];
        if (summary.length === 0) {
                violations.push('empty');
        }
        if (summary.length > ROLE_SUMMARY_MAX_LENGTH) {
                violations.push(`${summary.length} chars`);
        }
        const controls = controlCharactersOf(summary);
        if (controls.length > 0) {
                violations.push(...controls);
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
function isWellFormedNote(value: unknown): value is RoleCompositionTransitionNote {
        if (!isRecord(value)) {
                return false;
        }
        const record = value as Record<string, unknown>;
        const keys = Object.keys(record).sort();
        const expected = [...ROLE_COMPOSITION_NOTE_SCHEMA_KEYS].sort();
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
        if (record.fromStage !== null && !isRoleCompositionStage(record.fromStage)) {
                return false;
        }
        if (!isRoleCompositionStage(record.toStage)) {
                return false;
        }
        if (!isRoleCompositionOpName(record.op)) {
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

/** Prefixes a delegation-walk rejection's items with the entry path (the indexed station context). */
function prefixRejectionItems(rejection: RoleCompositionRejection, prefix: string): RoleCompositionRejection {
        if (rejection.items === undefined) {
                return rejection;
        }
        return {
                ...rejection,
                items: rejection.items.map((item) => `${prefix}:${item}`),
        };
}

/** Builds the canonical fixed-key-order copy of a validated session record. */
function canonicalRoleCompositionSession(record: RoleCompositionSession): RoleCompositionSession {
        return canonicalSessionObject(record) as unknown as RoleCompositionSession;
}

/** Builds the canonical fixed-key-order object of a validated session record (the serializer's engine). */
function canonicalSessionObject(record: RoleCompositionSession): Record<string, unknown> {
        return {
                sessionId: record.sessionId,
                industry: record.industry,
                stage: record.stage,
                roles: record.roles.map((role) => ({ roleKey: role.roleKey, summary: role.summary })),
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
