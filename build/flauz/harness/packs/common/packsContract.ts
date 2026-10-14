/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * DH-007 capability-packs contract family: the typed domain
 * capability-pack population layer for the Domain Harness OS direction
 * (WORK-REGISTRY.md - registry row DH-007 "domain capability-pack
 * population"; MASTER-ROADMAP law: a harness is composable
 * configuration over the universal Flauz core, never an industry
 * fork; the Agent Body law: "Agent Body + selected model + permitted
 * capabilities = Agent Instance"). A harness is domain-specific
 * through its industry label (DH-01), its onboarding record (DH-02),
 * its named roles (DH-03), its domain terms (DH-04), its
 * task/workflow templates (DH-05), its organization's default agent
 * bodies (DH-06) - and through its CAPABILITY PACKS: the named
 * default capability packs the domain's work runs on. This family is
 * the DOMAIN-SIDE DEFAULTS layer for capability packs: a typed,
 * staged, deterministic capability-pack record family bound to a
 * harness, composing pack entries (configuration only) whose body
 * references bind to the DH-006 organization-defaults record, with
 * the family's validation, serialization and persistence laws.
 * Composition over the landed families: the frozen industry
 * vocabulary, the harness-id alphabet, the staged-session
 * architecture, the body shape and the PIN-2 persistence pattern are
 * the LANDED DH-01/DH-02/DH-03/DH-04/DH-05/DH-06 surfaces - imported
 * from the real modules, never re-declared, re-implemented or
 * shadowed (THE IMPORT LAW, this wave's charter).
 *
 * LAWS (the DH-007 work order; the landed family precedents,
 * inherited and binding):
 * - THE NO-FORK LAW (binding, the family charter): a pack entry is
 *   CONFIGURATION (a packKey plus a human summary plus its body
 *   references, EXACTLY three keys); it grants NOTHING by itself. The
 *   structural engine's pack station: any additional key on a pack
 *   entry is the typed no-fork rejection.
 * - THE IMPORT LAW (binding, this wave's charter): the frozen industry
 *   vocabulary, the harness-id alphabet, the staged-session
 *   architecture, the body shape and the persistence pattern are the
 *   LANDED DH-01/DH-02/DH-03/DH-04/DH-05/DH-06 surfaces - imported
 *   from the real modules, never re-declared, re-implemented or
 *   shadowed (the battery pins the imports).
 * - THE CONTENT LAW (binding, this wave's honesty): NO per-industry
 *   pack content is shipped - this wave ships the LAYER, the
 *   machinery, not domain content (the registry's DH-002 precedent
 *   "industry templates are LATER waves - do not invent them" applied
 *   verbatim to capability packs; an invented legal / medical /
 *   finance pack vocabulary would be an unsourced fork of domain
 *   truth). The caller composes the packs; this family never invents
 *   them.
 * - THE BODY-RESOLUTION LAW (binding): pack bodyRefs resolve ONLY
 *   against the caller-supplied COMPOSED OrganizationDefaultsRecord at
 *   the finalize boundary, validated through the REAL DH-06
 *   validateOrganizationDefaultsRecord import (fail closed - a
 *   malformed or non-composed authority resolves nothing, never a
 *   silent skip); this layer NEVER injects a bodies authority. The
 *   two-phase law: dangling bodyRefs are LEGAL while composing; the
 *   boundary refuses typed, naming each offending ref once, in
 *   first-seen order.
 * - THE FROZEN-VOCABULARY LAW (binding): the record admits ONLY the
 *   landed HARNESS_INDUSTRIES members, and the harnessId must satisfy
 *   the REAL DH-01 harness-id alphabet (the FORM law - the EXISTENCE
 *   binding is the caller's wiring, never this layer's).
 * - THE FORWARD-ONLY LAW / THE APPEND-ONLY LINEAGE LAW (binding):
 *   composing -> composed; 'composed' is TERMINAL (a frozen record;
 *   every mutating op on a composed record refuses with the stage
 *   law); a changed pack is a NEW pack, never a mutation of a
 *   composed one.
 * - THE PACK LAWS (binding, frozen constants): the packKey is
 *   non-empty, at most PACK_KEY_MAX_LENGTH (64) characters, carries
 *   NO leading or trailing whitespace and no control characters; the
 *   summary is non-empty, at most PACK_SUMMARY_MAX_LENGTH (200)
 *   characters and carries no control characters; the record holds at
 *   most MAX_PACKS (64) packs; packKeys are unique within the record;
 *   bodyRefs is a string array, duplicate-free, MAY be empty (the
 *   honest-gap law: a pack MAY name zero bodies - an
 *   organization-wide capability); at least one pack at finalize (the
 *   empty-packs floor fires THERE, never the record shape - a
 *   composing record may hold zero).
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
 * - THE SINGLE-VERSION LAW (binding): PACKS_CONTRACTS_VERSION is
 *   '1.0.0' declared ONCE here, re-carried by the kit;
 *   DOMAIN_HARNESS_CONTRACTS_VERSION, ONBOARDING_CONTRACTS_VERSION,
 *   ROLES_CONTRACTS_VERSION, ONTOLOGY_CONTRACTS_VERSION,
 *   TEMPLATES_CONTRACTS_VERSION and BODIES_CONTRACTS_VERSION are
 *   declared ONCE in THEIR modules and re-carried here by reference
 *   (the battery pins every copy equal).
 * - Zero external dependencies: this module is pure vocabulary over
 *   typed values; no I/O, no clock, no env read.
 */

import { isHarnessId, isHarnessIndustry } from '../../contract/common/domainHarnessContract.js';
import type { HarnessIndustry } from '../../contract/common/domainHarnessContract.js';

/**
 * THE IMPORT LAW's re-export block: the REAL DH-01 harness-id alphabet
 * and the frozen industry vocabulary, plus the six landed contract
 * versions, are re-exported BY REFERENCE (the same bindings, never
 * re-declared copies). The battery pins referential identity against
 * the real modules.
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

/** THE SINGLE-VERSION LAW: PACKS_CONTRACTS_VERSION is declared ONCE here, re-carried by the kit. */
export const PACKS_CONTRACTS_VERSION = '1.0.0';

/**
 * The capability-packs record id prefix (this family's namespace; the
 * same id law as flauz:hrn: / flauz:onb: / flauz:rol: / flauz:ont: /
 * flauz:tpl: / flauz:bod: - the kit mints <prefix><16 lowercase hex>
 * from the injected rng).
 */
export const PACK_ID_PREFIX = 'flauz:pak:';

/**
 * The closed frozen stage vocabulary: the capability-packs walk's two
 * stages. 'composed' is TERMINAL (a frozen record; every mutating op
 * on a composed record refuses with the stage law; THE APPEND-ONLY
 * LINEAGE LAW: a changed pack is a NEW pack, never a mutation of a
 * composed one).
 */
export const PACK_STAGES = [
        'composing',
        'composed',
] as const;
export type PackStage = (typeof PACK_STAGES)[number];

/** Pure predicate over the closed stage list. */
export function isPackStage(value: unknown): value is PackStage {
        return (PACK_STAGES as readonly string[]).includes(value as string);
}

/** One whitelisted forward stage transition row (THE FORWARD-ONLY LAW's whitelist). */
export interface PackStageTransition {
        readonly from: PackStage;
        readonly to: PackStage;
}

/**
 * The frozen forward-only whitelist: the ONLY legal stage transition
 * is composing->composed. 'composed' is TERMINAL - no reopen; a
 * changed pack is a NEW pack (THE APPEND-ONLY LINEAGE LAW). Widening
 * the map is a versioned contract decision.
 */
export const PACK_FORWARD_TRANSITIONS = [
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
export type PackStageVerdict =
        | { readonly ok: true; readonly from: PackStage; readonly to: PackStage; readonly row: number }
        | {
                        readonly ok: false;
                        readonly reason: 'ILLEGAL_TRANSITION';
                        readonly from: unknown;
                        readonly to: unknown;
                        readonly whitelistRow: number | null;
                        readonly expectedTo: PackStage | null;
                        readonly detail: string;
                };

/**
 * THE FORWARD-ONLY LAW's verdict machine (pure): the exact whitelist
 * membership check (mirroring the DH-006 semantics exactly). The only
 * legal transition is composing->composed; every other edge
 * (self-loops, composed->anything, unknown stages, non-strings) is
 * the typed ILLEGAL_TRANSITION rejection naming the violated
 * whitelist row.
 */
export function canTransitionPackStage(from: unknown, to: unknown): PackStageVerdict {
        const transitions = PACK_FORWARD_TRANSITIONS as readonly PackStageTransition[];
        let rowNumber = 0;
        for (let i = 0; i < transitions.length; i += 1) {
                if (transitions[i].from === from) {
                        rowNumber = i + 1;
                        break;
                }
        }
        if (!isPackStage(from) || !isPackStage(to)) {
                return {
                        ok: false,
                        reason: 'ILLEGAL_TRANSITION',
                        from,
                        to,
                        whitelistRow: rowNumber > 0 ? rowNumber : null,
                        expectedTo: rowNumber > 0 ? transitions[rowNumber - 1].to : null,
                        detail: `canTransitionPackStage: '${showValue(from)}' -> '${showValue(to)}' is refused - both stages must be members of the frozen PACK_STAGES list (THE FORWARD-ONLY LAW - the stage vocabulary is frozen)`,
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
                        detail: `canTransitionPackStage: '${from}' -> '${to}' is refused - 'composed' is TERMINAL (the record is FROZEN; a changed pack is a NEW pack, THE APPEND-ONLY LINEAGE LAW) (THE FORWARD-ONLY LAW)`,
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
                        detail: `canTransitionPackStage: '${from}' -> '${to}' is refused - the only whitelisted forward transition from '${from}' is row ${rowNumber} ('${from}' -> '${expectedTo}') (THE FORWARD-ONLY LAW - forward-only; composed is terminal)`,
                };
        }
        return { ok: true, from, to, row: rowNumber };
}

/**
 * The pack laws (all frozen constants): the packKey is non-empty, at
 * most 64 characters, carries NO leading/trailing whitespace and no
 * control characters; the summary is non-empty, at most 200
 * characters and carries no control characters; the record holds at
 * most MAX_PACKS (64) packs.
 */
export const PACK_KEY_MAX_LENGTH = 64;

/** The summary bound (non-empty, at most 200 characters, no control characters). */
export const PACK_SUMMARY_MAX_LENGTH = 200;

/** The composition bound (at most 64 packs; the empty floor fires at finalize). */
export const MAX_PACKS = 64;

/**
 * The frozen capability-packs op-name vocabulary (the ledger line ops).
 */
export const PACK_OP_NAMES = [
        'begin-packs',
        'add-pack',
        'replace-pack-summary',
        'remove-pack',
        'finalize-packs',
] as const;
export type PackOpName = (typeof PACK_OP_NAMES)[number];

/** Pure predicate over the closed op-name list. */
export function isPackOpName(value: unknown): value is PackOpName {
        return (PACK_OP_NAMES as readonly string[]).includes(value as string);
}

/**
 * One provenance note in the record history: which clock reading the
 * op landed at, the stage edge it walked (fromStage null ONLY on the
 * begin note - the entry into 'composing'; the pack ops are the
 * composing->composing self edge - the organization composes its
 * default capability packs gradually), which op and which law granted
 * it, and the deterministic detail sentence.
 */
export interface PackTransitionNote {
        readonly at: string;
        readonly fromStage: PackStage | null;
        readonly toStage: PackStage;
        readonly op: PackOpName;
        readonly law: string;
        readonly detail: string;
}

/**
 * THE PACK LAWS' configuration entry: a packKey plus a human summary
 * plus its body references, EXACTLY three keys (THE NO-FORK LAW's
 * pack station: any additional key is the typed no-fork rejection).
 * A pack is CONFIGURATION; it grants NOTHING by itself. bodyRefs is a
 * string array, duplicate-free, MAY be empty (the honest-gap law: a
 * pack MAY name zero bodies - an organization-wide capability).
 */
export interface PackEntry {
        readonly packKey: string;
        readonly summary: string;
        readonly bodyRefs: readonly string[];
}

/**
 * The persisted per-record honest record (THE SIX-KEY MODEL): the id,
 * the bound harness id (the REAL DH-01 flauz:hrn:<16-hex> form - the
 * FORM law here; the EXISTENCE binding is the caller's wiring, and
 * the AGREEMENT with the bound harness's own industry is the caller's
 * composition law, both pinned in the battery through the real kits),
 * the industry that scopes the capability packs (one REAL
 * HARNESS_INDUSTRIES member, imported by reference), the stage, the
 * composed packs (MAY be empty while composing - the empty floor
 * fires at finalize, never the record shape), and the full op history
 * with provenance. The record carries NO contractVersion field: THE
 * SINGLE-VERSION LAW is enforced at the kit-layer persistence
 * surfaces (every ledger line and the envelope carry
 * PACKS_CONTRACTS_VERSION; a drift there is the typed
 * version-mismatch). Stage-vs-payload consistency is the ledger
 * replay's cross-check, never this shape's (the DH-01 guard
 * discipline).
 */
export interface CapabilityPacksRecord {
        readonly id: string;
        readonly harnessId: string;
        readonly industry: HarnessIndustry;
        readonly stage: PackStage;
        readonly packs: readonly PackEntry[];
        readonly history: readonly PackTransitionNote[];
}

/** The frozen record schema keys, in the canonical fixed-key-order (the serialization order). */
export const PACKS_RECORD_SCHEMA_KEYS = [
        'id',
        'harnessId',
        'industry',
        'stage',
        'packs',
        'history',
] as const;

/** The frozen history-note schema keys, in the canonical fixed-key-order. */
export const PACKS_NOTE_SCHEMA_KEYS = [
        'at',
        'fromStage',
        'toStage',
        'op',
        'law',
        'detail',
] as const;

/** The frozen pack-entry schema keys, in the canonical fixed-key-order. */
export const PACK_ENTRY_SCHEMA_KEYS = [
        'packKey',
        'summary',
        'bodyRefs',
] as const;

/** Pure predicate: a well-formed capability-packs record id (flauz:pak:<16-hex>). */
export function isPackId(value: unknown): value is string {
        if (typeof value !== 'string') {
                return false;
        }
        if (!value.startsWith(PACK_ID_PREFIX)) {
                return false;
        }
        const hex = value.slice(PACK_ID_PREFIX.length);
        return /^[0-9a-f]{16}$/.test(hex);
}

/**
 * Closed frozen list of capability-packs rejection reasons, in the
 * exact walk order (the work order's seventeen stations are the
 * complete closed walk - the pure record vocabulary; the kit-layer
 * stations - unknown-record, version-mismatch, empty-packs,
 * dangling-body-ref, malformed-bodies, premature-op, stale-stage,
 * unknown-pack - are declared ONCE in the kit module, this wave's
 * placement of the DH-006 precedent's single-declaration discipline
 * one level up; the validation walks collect EVERY violated law into
 * the typed rejection table, the table's records appearing in this
 * order):
 *   malformed-record       - the candidate is not a plain object, a
 *                            carrier carries the wrong structural type
 *                            (a non-array packs / history carrier), or
 *                            a pack entry is not a plain object / its
 *                            packKey or summary carrier is not a
 *                            string;
 *   no-fork                - THE NO-FORK LAW's pack station: a pack
 *                            entry carries a key beyond packKey +
 *                            summary + bodyRefs (a pack is
 *                            CONFIGURATION - it grants NOTHING by
 *                            itself);
 *   unknown-key            - a key outside the frozen six-key record
 *                            schema;
 *   missing-key            - a required record key is absent;
 *   bad-harness-id         - the bound harnessId is not the REAL
 *                            DH-01 flauz:hrn:<16-hex> form (imported
 *                            by reference - the FORM law; the
 *                            EXISTENCE binding is the caller's
 *                            wiring, never this layer's);
 *   bad-industry           - THE FROZEN-VOCABULARY LAW: the industry
 *                            is not a member of the DH-01 list
 *                            (imported by reference);
 *   bad-stage              - the stage is not a member of the frozen
 *                            PACK_STAGES list;
 *   bad-history            - a history note fails the frozen six-key
 *                            note shape;
 *   pack-key-length        - a packKey is empty or longer than
 *                            PACK_KEY_MAX_LENGTH (64) characters;
 *   pack-key-whitespace    - a packKey carries leading or trailing
 *                            whitespace;
 *   pack-key-control-chars - a packKey carries control characters
 *                            (C0/DEL/C1);
 *   summary-length         - a summary is empty or longer than
 *                            PACK_SUMMARY_MAX_LENGTH (200) characters;
 *   summary-control-chars  - a summary carries control characters
 *                            (C0/DEL/C1);
 *   duplicate-pack-key     - packKeys are not unique within the
 *                            record;
 *   max-packs              - the record carries more than MAX_PACKS
 *                            (64) packs (the composition bound);
 *   bad-body-refs-carrier  - a bodyRefs carrier is not an array, or a
 *                            member is not a string;
 *   duplicate-body-ref     - a pack's bodyRefs carry repeats.
 * Widening or reordering the list is a versioned contract decision.
 */
export const PACKS_REJECTION_REASONS = [
        'malformed-record',
        'no-fork',
        'unknown-key',
        'missing-key',
        'bad-harness-id',
        'bad-industry',
        'bad-stage',
        'bad-history',
        'pack-key-length',
        'pack-key-whitespace',
        'pack-key-control-chars',
        'summary-length',
        'summary-control-chars',
        'duplicate-pack-key',
        'max-packs',
        'bad-body-refs-carrier',
        'duplicate-body-ref',
] as const;
export type PacksRejectionReason = (typeof PACKS_REJECTION_REASONS)[number];

/** Pure predicate over the closed rejection list. */
export function isPacksRejectionReason(value: unknown): value is PacksRejectionReason {
        return (PACKS_REJECTION_REASONS as readonly string[]).includes(value as string);
}

/**
 * One typed rejection from a validation walk: the frozen reason, the
 * violated law's name, the offending items, and the deterministic
 * detail sentence. NEVER a string throw, NEVER a silent skip.
 */
export interface PacksRejection {
        readonly reason: PacksRejectionReason;
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
export type PacksValidationOutcome<T> =
        | { readonly ok: true; readonly value: T }
        | { readonly ok: false; readonly mode: 'shape'; readonly rejections: readonly PacksRejection[] };

/**
 * The packKey station walk (the split-station pack laws, the family's
 * per-key validator): malformed-record (the non-string carrier) ->
 * pack-key-length (the bound) -> pack-key-whitespace (the padding) ->
 * pack-key-control-chars (the C0/DEL/C1 set), the complete table over
 * ONE key. Ok carries the packKey string.
 */
export function validatePackKey(packKey: unknown): PacksValidationOutcome<string> {
        const rejections: PacksRejection[] = [];
        if (typeof packKey !== 'string') {
                rejections.push({
                        reason: 'malformed-record',
                        law: 'THE FAIL-CLOSED LAW',
                        items: ['packKey'],
                        detail: 'validatePackKey: the packKey must be a string (the pack\'s identity key)',
                });
                return { ok: false, mode: 'shape', rejections };
        }
        const lengthViolations = packKeyLengthViolationsOf(packKey);
        if (lengthViolations.length > 0) {
                rejections.push({
                        reason: 'pack-key-length',
                        law: 'THE FAIL-CLOSED LAW',
                        items: lengthViolations,
                        detail: `validatePackKey: the packKey must be a non-empty string of at most ${PACK_KEY_MAX_LENGTH} characters`,
                });
        }
        if (packKey !== packKey.trim()) {
                rejections.push({
                        reason: 'pack-key-whitespace',
                        law: 'THE FAIL-CLOSED LAW',
                        items: ['leading/trailing whitespace'],
                        detail: 'validatePackKey: the packKey must carry no leading or trailing whitespace',
                });
        }
        const keyControls = controlCharactersOf(packKey);
        if (keyControls.length > 0) {
                rejections.push({
                        reason: 'pack-key-control-chars',
                        law: 'THE FAIL-CLOSED LAW',
                        items: keyControls,
                        detail: 'validatePackKey: the packKey must carry no control characters (C0/DEL/C1)',
                });
        }
        if (rejections.length > 0) {
                return { ok: false, mode: 'shape', rejections };
        }
        return { ok: true, value: packKey };
}

/**
 * The summary station walk (the kit's replacePackSummary station):
 * malformed-record (the non-string carrier) -> summary-length (the
 * bound) -> summary-control-chars (the C0/DEL/C1 set). Ok carries the
 * summary string.
 */
export function validatePackSummary(summary: unknown): PacksValidationOutcome<string> {
        const rejections: PacksRejection[] = [];
        if (typeof summary !== 'string') {
                rejections.push({
                        reason: 'malformed-record',
                        law: 'THE FAIL-CLOSED LAW',
                        items: ['summary'],
                        detail: 'validatePackSummary: the summary must be a string (the pack\'s human summary)',
                });
                return { ok: false, mode: 'shape', rejections };
        }
        const lengthViolations = summaryLengthViolationsOf(summary);
        if (lengthViolations.length > 0) {
                rejections.push({
                        reason: 'summary-length',
                        law: 'THE FAIL-CLOSED LAW',
                        items: lengthViolations,
                        detail: `validatePackSummary: the summary must be a non-empty string of at most ${PACK_SUMMARY_MAX_LENGTH} characters`,
                });
        }
        const summaryControls = controlCharactersOf(summary);
        if (summaryControls.length > 0) {
                rejections.push({
                        reason: 'summary-control-chars',
                        law: 'THE FAIL-CLOSED LAW',
                        items: summaryControls,
                        detail: 'validatePackSummary: the summary must carry no control characters (C0/DEL/C1)',
                });
        }
        if (rejections.length > 0) {
                return { ok: false, mode: 'shape', rejections };
        }
        return { ok: true, value: summary };
}

/**
 * The single-pack station walk (the kit's addPack station, the
 * family's per-payload validator architecture): malformed-record (the
 * non-object entry, the non-string packKey / summary carriers) ->
 * no-fork -> pack-key-length -> pack-key-whitespace ->
 * pack-key-control-chars -> summary-length -> summary-control-chars
 * -> bad-body-refs-carrier -> duplicate-body-ref, the complete table
 * over ONE entry. Ok carries the canonical { packKey, summary,
 * bodyRefs } copy.
 */
export function validatePackEntry(pack: unknown): PacksValidationOutcome<PackEntry> {
        const rejections: PacksRejection[] = [];
        if (!isRecord(pack)) {
                rejections.push({
                        reason: 'malformed-record',
                        law: 'THE FAIL-CLOSED LAW',
                        items: ['pack'],
                        detail: 'validatePackEntry: every pack entry must be a plain object of exactly { packKey, summary, bodyRefs } (a pack is configuration; it grants NOTHING by itself)',
                });
                return { ok: false, mode: 'shape', rejections };
        }
        const record = pack as Record<string, unknown>;
        const carrierViolations: string[] = [];
        if (typeof record.packKey !== 'string') {
                carrierViolations.push('packKey');
        }
        if (typeof record.summary !== 'string') {
                carrierViolations.push('summary');
        }
        if (carrierViolations.length > 0) {
                rejections.push({
                        reason: 'malformed-record',
                        law: 'THE FAIL-CLOSED LAW',
                        items: carrierViolations,
                        detail: 'validatePackEntry: the packKey and the summary must be strings (a pack is a key plus a human summary plus its body references)',
                });
        }
        const extraKeys = Object.keys(record).filter((key) => !(PACK_ENTRY_SCHEMA_KEYS as readonly string[]).includes(key));
        if (extraKeys.length > 0) {
                rejections.push({
                        reason: 'no-fork',
                        law: 'THE NO-FORK LAW',
                        items: extraKeys,
                        detail: `validatePackEntry: a pack is CONFIGURATION (a packKey plus a human summary plus its body references) - it grants NOTHING by itself; the extra key(s) ${showList(extraKeys)} are execution material and cannot appear on a pack entry`,
                });
        }
        if (typeof record.packKey === 'string') {
                const lengthViolations = packKeyLengthViolationsOf(record.packKey);
                if (lengthViolations.length > 0) {
                        rejections.push({
                                reason: 'pack-key-length',
                                law: 'THE FAIL-CLOSED LAW',
                                items: lengthViolations,
                                detail: `validatePackEntry: the packKey must be a non-empty string of at most ${PACK_KEY_MAX_LENGTH} characters`,
                        });
                }
                if (record.packKey !== record.packKey.trim()) {
                        rejections.push({
                                reason: 'pack-key-whitespace',
                                law: 'THE FAIL-CLOSED LAW',
                                items: ['leading/trailing whitespace'],
                                detail: 'validatePackEntry: the packKey must carry no leading or trailing whitespace',
                        });
                }
                const keyControls = controlCharactersOf(record.packKey);
                if (keyControls.length > 0) {
                        rejections.push({
                                reason: 'pack-key-control-chars',
                                law: 'THE FAIL-CLOSED LAW',
                                items: keyControls,
                                detail: 'validatePackEntry: the packKey must carry no control characters (C0/DEL/C1)',
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
                                detail: `validatePackEntry: the summary must be a non-empty string of at most ${PACK_SUMMARY_MAX_LENGTH} characters`,
                        });
                }
                const summaryControls = controlCharactersOf(record.summary);
                if (summaryControls.length > 0) {
                        rejections.push({
                                reason: 'summary-control-chars',
                                law: 'THE FAIL-CLOSED LAW',
                                items: summaryControls,
                                detail: 'validatePackEntry: the summary must carry no control characters (C0/DEL/C1)',
                        });
                }
        }
        if (!Array.isArray(record.bodyRefs)) {
                rejections.push({
                        reason: 'bad-body-refs-carrier',
                        law: 'THE FAIL-CLOSED LAW',
                        items: ['bodyRefs'],
                        detail: 'validatePackEntry: the bodyRefs must be a string array (the pack\'s body references; MAY be empty - a pack MAY name zero bodies, the honest-gap law)',
                });
        } else {
                const bodyRefs = record.bodyRefs as unknown[];
                const nonStringMembers: string[] = [];
                for (let i = 0; i < bodyRefs.length; i += 1) {
                        if (typeof bodyRefs[i] !== 'string') {
                                nonStringMembers.push(`bodyRefs[${i}]`);
                        }
                }
                if (nonStringMembers.length > 0) {
                        rejections.push({
                                reason: 'bad-body-refs-carrier',
                                law: 'THE FAIL-CLOSED LAW',
                                items: nonStringMembers,
                                detail: 'validatePackEntry: every bodyRefs member must be a string (the body-reference alphabet)',
                        });
                }
                const duplicates = findDuplicates(bodyRefs.filter((ref): ref is string => typeof ref === 'string'));
                if (duplicates.length > 0) {
                        rejections.push({
                                reason: 'duplicate-body-ref',
                                law: 'THE FAIL-CLOSED LAW',
                                items: duplicates,
                                detail: 'validatePackEntry: the bodyRefs array must be duplicate-free (a body reference appears once per pack)',
                        });
                }
        }
        if (rejections.length > 0) {
                return { ok: false, mode: 'shape', rejections };
        }
        return { ok: true, value: { packKey: record.packKey as string, summary: record.summary as string, bodyRefs: [...(record.bodyRefs as string[])] } };
}

/**
 * The deep record walk (pure): the strict seventeen-station walk over
 * the honest record, THE STATIONS IN THE FROZEN ORDER (the
 * station-major discipline: each station is visited once, in the
 * PACKS_REJECTION_REASONS order, and names every offense it sees) -
 * malformed-record (the record, its carriers and its pack entries),
 * no-fork (every pack entry's extra keys, before the record schema
 * stations), unknown-key, missing-key, bad-harness-id (THE REAL DH-01
 * harness-id alphabet import - the FORM law), bad-industry (THE
 * FROZEN-VOCABULARY LAW against the REAL import), bad-stage,
 * bad-history, the pack family laws (pack-key-length /
 * pack-key-whitespace / pack-key-control-chars / summary-length /
 * summary-control-chars per entry, duplicate-pack-key, max-packs,
 * bad-body-refs-carrier, duplicate-body-ref). THE COMPLETE TABLE:
 * every violated station is reported, in the frozen walk order.
 * Empty packs are LEGAL here (the floor fires at finalize, never the
 * record shape); stage-vs-payload consistency is the ledger replay's
 * cross-check, never this walk's. Ok carries the canonical
 * fixed-key-order copy.
 */
export function validateCapabilityPacksRecord(value: unknown): PacksValidationOutcome<CapabilityPacksRecord> {
        const rejections: PacksRejection[] = [];
        if (!isRecord(value)) {
                rejections.push({
                        reason: 'malformed-record',
                        law: 'THE FAIL-CLOSED LAW',
                        items: ['record'],
                        detail: 'validateCapabilityPacksRecord: the record must be a plain object (never a silent partial verdict)',
                });
                return { ok: false, mode: 'shape', rejections };
        }
        const record = value as Record<string, unknown>;
        const keys = Object.keys(record);

        // station 1 (malformed-record): the record's own carriers and the pack
        // entries' structural shapes (a non-object entry, a non-string packKey /
        // summary carrier - the entry-level shape offenses live in this station:
        // the work order's closed walk carries no separate malformed-pack station).
        const carrierViolations: string[] = [];
        if (hasOwn(record, 'packs') && !Array.isArray(record.packs)) {
                carrierViolations.push('packs');
        }
        if (hasOwn(record, 'history') && !Array.isArray(record.history)) {
                carrierViolations.push('history');
        }
        if (Array.isArray(record.packs)) {
                const packs = record.packs as unknown[];
                for (let i = 0; i < packs.length; i += 1) {
                        const pack = packs[i];
                        if (!isRecord(pack)) {
                                carrierViolations.push(`packs[${i}]`);
                                continue;
                        }
                        if (typeof (pack as Record<string, unknown>).packKey !== 'string') {
                                carrierViolations.push(`packs[${i}]:packKey`);
                        }
                        if (typeof (pack as Record<string, unknown>).summary !== 'string') {
                                carrierViolations.push(`packs[${i}]:summary`);
                        }
                }
        }
        if (carrierViolations.length > 0) {
                rejections.push({
                        reason: 'malformed-record',
                        law: 'THE FAIL-CLOSED LAW',
                        items: carrierViolations,
                        detail: `validateCapabilityPacksRecord: a structural shape is malformed - the offending part(s) ${showList(carrierViolations)} (the record and every pack entry must be plain objects, the packs / history carriers must be arrays, and every packKey / summary carrier must be a string - never a silent partial verdict)`,
                });
        }

        // station 2 (no-fork): THE NO-FORK LAW's pack station, over every
        // walkable pack entry (before the record schema stations - the frozen
        // walk order).
        if (Array.isArray(record.packs)) {
                const noForkItems: string[] = [];
                const packs = record.packs as unknown[];
                for (let i = 0; i < packs.length; i += 1) {
                        if (!isRecord(packs[i])) {
                                continue;
                        }
                        const extraKeys = Object.keys(packs[i] as Record<string, unknown>).filter((key) => !(PACK_ENTRY_SCHEMA_KEYS as readonly string[]).includes(key));
                        for (const extraKey of extraKeys) {
                                noForkItems.push(`packs[${i}]:${extraKey}`);
                        }
                }
                if (noForkItems.length > 0) {
                        rejections.push({
                                reason: 'no-fork',
                                law: 'THE NO-FORK LAW',
                                items: noForkItems,
                                detail: `validateCapabilityPacksRecord: a pack is CONFIGURATION (a packKey plus a human summary plus its body references) - it grants NOTHING by itself; the extra key(s) ${showList(noForkItems)} are execution material and cannot appear on a pack entry`,
                        });
                }
        }

        // station 3 (unknown-key): the strict six-key schema is closed.
        const unknownKeys = keys.filter((key) => !(PACKS_RECORD_SCHEMA_KEYS as readonly string[]).includes(key));
        if (unknownKeys.length > 0) {
                rejections.push({
                        reason: 'unknown-key',
                        law: 'THE FAIL-CLOSED LAW',
                        items: unknownKeys,
                        detail: `validateCapabilityPacksRecord: the record schema is closed (THE SIX-KEY MODEL) - the unknown key(s) ${showList(unknownKeys)} are rejected`,
                });
        }

        // station 4 (missing-key): the strict schema requires every key.
        const missingKeys = (PACKS_RECORD_SCHEMA_KEYS as readonly string[]).filter((key) => !hasOwn(record, key));
        if (missingKeys.length > 0) {
                rejections.push({
                        reason: 'missing-key',
                        law: 'THE FAIL-CLOSED LAW',
                        items: missingKeys,
                        detail: `validateCapabilityPacksRecord: the record schema requires every key - the key(s) ${showList(missingKeys)} are missing`,
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
                        detail: 'validateCapabilityPacksRecord: the harnessId must satisfy the REAL DH-01 harness-id alphabet (flauz:hrn:<16-hex>, imported by reference - the FORM law; the EXISTENCE binding is the caller\'s wiring, never this layer\'s)',
                });
        }

        // station 6 (bad-industry): THE FROZEN-VOCABULARY LAW against the REAL import.
        if (hasOwn(record, 'industry') && !isHarnessIndustry(record.industry)) {
                rejections.push({
                        reason: 'bad-industry',
                        law: 'THE FROZEN-VOCABULARY LAW',
                        items: [showValue(record.industry)],
                        detail: 'validateCapabilityPacksRecord: the industry must be a member of the frozen HARNESS_INDUSTRIES list, imported by reference from the DH-01 contract (membership is the only admissibility; the capability packs are industry-scoped)',
                });
        }

        // station 7 (bad-stage).
        // (the absent-key discipline: an absent stage is station 4's missing-key,
        // never a cascade here.)
        if (hasOwn(record, 'stage') && !isPackStage(record.stage)) {
                rejections.push({
                        reason: 'bad-stage',
                        law: 'THE FORWARD-ONLY LAW',
                        items: [showValue(record.stage)],
                        detail: 'validateCapabilityPacksRecord: the stage must be a member of the frozen PACK_STAGES list (composing -> composed; composed is TERMINAL)',
                });
        }

        // station 8 (bad-history), only walkable when the carrier is an array.
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
                                detail: 'validateCapabilityPacksRecord: every history note must carry the frozen six-key note shape (at / fromStage / toStage / op / law / detail - the provenance record)',
                        });
                }
        }

        // stations 9-17 (the pack family laws), only walkable when the carrier is
        // an array; the per-entry stations skip the entries already refused by
        // station 1's shape walk (never a cascade over a malformed entry).
        if (Array.isArray(record.packs)) {
                const packs = record.packs as unknown[];

                // station 9 (pack-key-length): the bound, per walkable entry.
                const keyLengthItems: string[] = [];
                for (let i = 0; i < packs.length; i += 1) {
                        const pack = packs[i];
                        if (!isRecord(pack) || typeof (pack as Record<string, unknown>).packKey !== 'string') {
                                continue;
                        }
                        const violations = packKeyLengthViolationsOf((pack as Record<string, unknown>).packKey as string);
                        for (const violation of violations) {
                                keyLengthItems.push(`packs[${i}]:${violation}`);
                        }
                }
                if (keyLengthItems.length > 0) {
                        rejections.push({
                                reason: 'pack-key-length',
                                law: 'THE FAIL-CLOSED LAW',
                                items: keyLengthItems,
                                detail: `validateCapabilityPacksRecord: every packKey must be a non-empty string of at most ${PACK_KEY_MAX_LENGTH} characters`,
                        });
                }

                // station 10 (pack-key-whitespace): the padding, per walkable entry.
                const keyWhitespaceItems: string[] = [];
                for (let i = 0; i < packs.length; i += 1) {
                        const pack = packs[i];
                        if (!isRecord(pack) || typeof (pack as Record<string, unknown>).packKey !== 'string') {
                                continue;
                        }
                        const packKey = (pack as Record<string, unknown>).packKey as string;
                        if (packKey !== packKey.trim()) {
                                keyWhitespaceItems.push(`packs[${i}]:leading/trailing whitespace`);
                        }
                }
                if (keyWhitespaceItems.length > 0) {
                        rejections.push({
                                reason: 'pack-key-whitespace',
                                law: 'THE FAIL-CLOSED LAW',
                                items: keyWhitespaceItems,
                                detail: 'validateCapabilityPacksRecord: every packKey must carry no leading or trailing whitespace',
                        });
                }

                // station 11 (pack-key-control-chars): the C0/DEL/C1 set, per walkable entry.
                const keyControlItems: string[] = [];
                for (let i = 0; i < packs.length; i += 1) {
                        const pack = packs[i];
                        if (!isRecord(pack) || typeof (pack as Record<string, unknown>).packKey !== 'string') {
                                continue;
                        }
                        const controls = controlCharactersOf((pack as Record<string, unknown>).packKey as string);
                        for (const control of controls) {
                                keyControlItems.push(`packs[${i}]:${control}`);
                        }
                }
                if (keyControlItems.length > 0) {
                        rejections.push({
                                reason: 'pack-key-control-chars',
                                law: 'THE FAIL-CLOSED LAW',
                                items: keyControlItems,
                                detail: 'validateCapabilityPacksRecord: every packKey must carry no control characters (C0/DEL/C1)',
                        });
                }

                // station 12 (summary-length): the bound, per walkable entry.
                const summaryLengthItems: string[] = [];
                for (let i = 0; i < packs.length; i += 1) {
                        const pack = packs[i];
                        if (!isRecord(pack) || typeof (pack as Record<string, unknown>).summary !== 'string') {
                                continue;
                        }
                        const violations = summaryLengthViolationsOf((pack as Record<string, unknown>).summary as string);
                        for (const violation of violations) {
                                summaryLengthItems.push(`packs[${i}]:${violation}`);
                        }
                }
                if (summaryLengthItems.length > 0) {
                        rejections.push({
                                reason: 'summary-length',
                                law: 'THE FAIL-CLOSED LAW',
                                items: summaryLengthItems,
                                detail: `validateCapabilityPacksRecord: every summary must be a non-empty string of at most ${PACK_SUMMARY_MAX_LENGTH} characters`,
                        });
                }

                // station 13 (summary-control-chars): the C0/DEL/C1 set, per walkable entry.
                const summaryControlItems: string[] = [];
                for (let i = 0; i < packs.length; i += 1) {
                        const pack = packs[i];
                        if (!isRecord(pack) || typeof (pack as Record<string, unknown>).summary !== 'string') {
                                continue;
                        }
                        const controls = controlCharactersOf((pack as Record<string, unknown>).summary as string);
                        for (const control of controls) {
                                summaryControlItems.push(`packs[${i}]:${control}`);
                        }
                }
                if (summaryControlItems.length > 0) {
                        rejections.push({
                                reason: 'summary-control-chars',
                                law: 'THE FAIL-CLOSED LAW',
                                items: summaryControlItems,
                                detail: 'validateCapabilityPacksRecord: every summary must carry no control characters (C0/DEL/C1)',
                        });
                }

                // station 14 (duplicate-pack-key): the record-wide uniqueness law.
                const packKeyDuplicates = findDuplicates(
                        packs.filter((pack) => isRecord(pack) && typeof (pack as Record<string, unknown>).packKey === 'string').map(
                                (pack) => (pack as Record<string, unknown>).packKey as string,
                        ),
                );
                if (packKeyDuplicates.length > 0) {
                        rejections.push({
                                reason: 'duplicate-pack-key',
                                law: 'THE FAIL-CLOSED LAW',
                                items: packKeyDuplicates,
                                detail: 'validateCapabilityPacksRecord: packKeys must be unique within the record (a pack appears once)',
                        });
                }

                // station 15 (max-packs): the composition bound.
                if (packs.length > MAX_PACKS) {
                        rejections.push({
                                reason: 'max-packs',
                                law: 'THE FAIL-CLOSED LAW',
                                items: [`${packs.length} packs`],
                                detail: `validateCapabilityPacksRecord: the record carries at most MAX_PACKS (${MAX_PACKS}) packs (the composition bound)`,
                        });
                }

                // station 16 (bad-body-refs-carrier): the carrier and its members, per walkable entry.
                const bodyRefsCarrierItems: string[] = [];
                for (let i = 0; i < packs.length; i += 1) {
                        const pack = packs[i];
                        if (!isRecord(pack)) {
                                continue;
                        }
                        const bodyRefs = (pack as Record<string, unknown>).bodyRefs;
                        if (!Array.isArray(bodyRefs)) {
                                bodyRefsCarrierItems.push(`packs[${i}]:bodyRefs`);
                                continue;
                        }
                        for (let j = 0; j < bodyRefs.length; j += 1) {
                                if (typeof bodyRefs[j] !== 'string') {
                                        bodyRefsCarrierItems.push(`packs[${i}]:bodyRefs[${j}]`);
                                }
                        }
                }
                if (bodyRefsCarrierItems.length > 0) {
                        rejections.push({
                                reason: 'bad-body-refs-carrier',
                                law: 'THE FAIL-CLOSED LAW',
                                items: bodyRefsCarrierItems,
                                detail: 'validateCapabilityPacksRecord: every bodyRefs must be a string array whose members are strings (the pack\'s body references; MAY be empty - a pack MAY name zero bodies, the honest-gap law)',
                        });
                }

                // station 17 (duplicate-body-ref): the per-pack uniqueness law.
                const duplicateRefItems: string[] = [];
                for (let i = 0; i < packs.length; i += 1) {
                        const pack = packs[i];
                        if (!isRecord(pack) || !Array.isArray((pack as Record<string, unknown>).bodyRefs)) {
                                continue;
                        }
                        const bodyRefs = (pack as Record<string, unknown>).bodyRefs as unknown[];
                        const duplicates = findDuplicates(bodyRefs.filter((ref): ref is string => typeof ref === 'string'));
                        for (const duplicate of duplicates) {
                                duplicateRefItems.push(`packs[${i}]:${duplicate}`);
                        }
                }
                if (duplicateRefItems.length > 0) {
                        rejections.push({
                                reason: 'duplicate-body-ref',
                                law: 'THE FAIL-CLOSED LAW',
                                items: duplicateRefItems,
                                detail: 'validateCapabilityPacksRecord: every bodyRefs array must be duplicate-free (a body reference appears once per pack)',
                        });
                }
        }

        if (rejections.length > 0) {
                return { ok: false, mode: 'shape', rejections };
        }
        return { ok: true, value: canonicalCapabilityPacksRecord(record as unknown as CapabilityPacksRecord) };
}

/**
 * Pure deep shape guard: a well-formed capability-packs record (the
 * deep walk above, green). Fails closed on every malformed path;
 * never reads a clock; never mutates its input.
 */
export function isCapabilityPacksRecord(value: unknown): value is CapabilityPacksRecord {
        return validateCapabilityPacksRecord(value).ok;
}

/**
 * THE CANONICAL SERIALIZATION: the fixed-key-order JSON bytes of a
 * capability-packs record (byte-deterministic; double-serialize
 * byte-equality; the key order frozen in this module and pinned by
 * tests - the DH-01 algorithm: the frozen per-shape key orders applied
 * deeply, never an alphabetic re-sort). The record keys emit in the
 * PACKS_RECORD_SCHEMA_KEYS order, the pack entries in the
 * packKey,summary,bodyRefs order, and the history notes in the
 * PACKS_NOTE_SCHEMA_KEYS order. Throws TypeError on a malformed
 * record (never dishonest bytes).
 */
export function serializeCapabilityPacksRecord(record: unknown): string {
        if (!isCapabilityPacksRecord(record)) {
                throw new TypeError(
                        'serializeCapabilityPacksRecord: record must satisfy isCapabilityPacksRecord - no dishonest capability-packs record ever gets canonical bytes',
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
 *   unknown-contract-version - the family-parity slot: THE SIX-KEY
 *                              MODEL carries no contractVersion field,
 *                              so this station never fires on record
 *                              bytes (the version law fires at the
 *                              kit-layer persistence surfaces as the
 *                              typed version-mismatch); the slot is
 *                              retained for the landed family's
 *                              five-reason parse shape;
 *   unknown-key              - an extra key at the record, pack or
 *                              note level (tampered bytes);
 *   invalid-record           - the deep semantic walk refuses.
 */
export const PACKS_PARSE_REJECTION_REASONS = [
        'malformed-json',
        'torn-envelope',
        'unknown-contract-version',
        'unknown-key',
        'invalid-record',
] as const;
export type PacksParseRejectionReason = (typeof PACKS_PARSE_REJECTION_REASONS)[number];

/** Pure predicate over the closed parse-rejection list. */
export function isPacksParseRejectionReason(value: unknown): value is PacksParseRejectionReason {
        return (PACKS_PARSE_REJECTION_REASONS as readonly string[]).includes(value as string);
}

/** The typed parse rejection: the frozen reason and the drift-naming detail. */
export interface PacksParseRejection {
        readonly reason: PacksParseRejectionReason;
        readonly detail: string;
}

/** The typed parse outcome: ok carries the validated record; failure names the drift. */
export type PacksParseOutcome =
        | { readonly ok: true; readonly record: CapabilityPacksRecord }
        | { readonly ok: false; readonly rejection: PacksParseRejection };

/**
 * THE FAIL-CLOSED PARSE: bytes -> the typed parse outcome. Malformed
 * JSON, a torn envelope, an unknown key (record / pack / note level),
 * or invalid content (the deep record walk) - each a typed rejection
 * naming the drift; never a silent partial parse.
 * First-failure-is-the-verdict, in the frozen
 * PACKS_PARSE_REJECTION_REASONS order.
 */
export function parseCapabilityPacksRecord(bytes: unknown): PacksParseOutcome {
        if (typeof bytes !== 'string') {
                return {
                        ok: false,
                        rejection: {
                                reason: 'torn-envelope',
                                detail: 'parseCapabilityPacksRecord: bytes must be a string (the canonical fixed-key-order record bytes)',
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
                                detail: `parseCapabilityPacksRecord: the bytes are not valid JSON: ${toMessage(error)}`,
                        },
                };
        }
        if (!isRecord(parsed)) {
                return {
                        ok: false,
                        rejection: {
                                reason: 'torn-envelope',
                                detail: 'parseCapabilityPacksRecord: the bytes must carry a JSON object (the record envelope)',
                        },
                };
        }
        const record = parsed as Record<string, unknown>;
        for (const key of PACKS_RECORD_SCHEMA_KEYS) {
                if (!hasOwn(record, key)) {
                        return {
                                ok: false,
                                rejection: {
                                        reason: 'torn-envelope',
                                        detail: `parseCapabilityPacksRecord: the '${key}' key is missing (a torn write - never a silent partial parse)`,
                                },
                        };
                }
        }
        if (typeof record.id !== 'string' || typeof record.harnessId !== 'string' || typeof record.industry !== 'string' || typeof record.stage !== 'string' || !Array.isArray(record.packs) || !Array.isArray(record.history)) {
                return {
                        ok: false,
                        rejection: {
                                reason: 'torn-envelope',
                                detail: 'parseCapabilityPacksRecord: the record envelope carries a value of the wrong structural type (a torn write - never a silent partial parse)',
                        },
                };
        }
        const unknownRecordKeys = Object.keys(record).filter((key) => !(PACKS_RECORD_SCHEMA_KEYS as readonly string[]).includes(key));
        if (unknownRecordKeys.length > 0) {
                return {
                        ok: false,
                        rejection: {
                                reason: 'unknown-key',
                                detail: `parseCapabilityPacksRecord: the record carries the unknown key '${unknownRecordKeys[0]}' (the strict six-key record schema is closed)`,
                        },
                };
        }
        const packs = record.packs as unknown[];
        for (let i = 0; i < packs.length; i += 1) {
                const pack = packs[i];
                if (isRecord(pack)) {
                        const extraPackKeys = Object.keys(pack as Record<string, unknown>).filter((key) => !(PACK_ENTRY_SCHEMA_KEYS as readonly string[]).includes(key));
                        if (extraPackKeys.length > 0) {
                                return {
                                        ok: false,
                                        rejection: {
                                                reason: 'unknown-key',
                                                detail: `parseCapabilityPacksRecord: the pack entry packs[${i}] carries the unknown key '${extraPackKeys[0]}' (a pack is packKey + summary + bodyRefs only)`,
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
                                (key) => !(PACKS_NOTE_SCHEMA_KEYS as readonly string[]).includes(key),
                        );
                        if (extraNoteKeys.length > 0) {
                                return {
                                        ok: false,
                                        rejection: {
                                                reason: 'unknown-key',
                                                detail: `parseCapabilityPacksRecord: the history note history[${i}] carries the unknown key '${extraNoteKeys[0]}' (the note schema is closed)`,
                                        },
                                };
                        }
                }
        }
        const deep = validateCapabilityPacksRecord(parsed);
        if (!deep.ok) {
                return {
                        ok: false,
                        rejection: {
                                reason: 'invalid-record',
                                detail: `parseCapabilityPacksRecord: the parsed record fails the deep record walk (${deep.rejections[0].reason} - ${deep.rejections[0].detail}; never a silent partial parse)`,
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

/** The packKey bound violations (empty, over-length), as deterministic item strings. */
function packKeyLengthViolationsOf(packKey: string): string[] {
        const violations: string[] = [];
        if (packKey.length === 0) {
                violations.push('empty');
        }
        if (packKey.length > PACK_KEY_MAX_LENGTH) {
                violations.push(`${packKey.length} chars`);
        }
        return violations;
}

/** The summary bound violations (empty, over-length), as deterministic item strings. */
function summaryLengthViolationsOf(summary: string): string[] {
        const violations: string[] = [];
        if (summary.length === 0) {
                violations.push('empty');
        }
        if (summary.length > PACK_SUMMARY_MAX_LENGTH) {
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
function isWellFormedNote(value: unknown): value is PackTransitionNote {
        if (!isRecord(value)) {
                return false;
        }
        const record = value as Record<string, unknown>;
        const keys = Object.keys(record).sort();
        const expected = [...PACKS_NOTE_SCHEMA_KEYS].sort();
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
        if (record.fromStage !== null && !isPackStage(record.fromStage)) {
                return false;
        }
        if (!isPackStage(record.toStage)) {
                return false;
        }
        if (!isPackOpName(record.op)) {
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

/** Builds the canonical fixed-key-order copy of a validated record. */
function canonicalCapabilityPacksRecord(record: CapabilityPacksRecord): CapabilityPacksRecord {
        return canonicalRecordObject(record) as unknown as CapabilityPacksRecord;
}

/** Builds the canonical fixed-key-order object of a validated record (the serializer's engine). */
function canonicalRecordObject(record: CapabilityPacksRecord): Record<string, unknown> {
        return {
                id: record.id,
                harnessId: record.harnessId,
                industry: record.industry,
                stage: record.stage,
                packs: record.packs.map((pack) => ({ packKey: pack.packKey, summary: pack.summary, bodyRefs: [...pack.bodyRefs] })),
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
