/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * DH-004 domain-ontology contract family: the typed terminology layer
 * for the Domain Harness OS direction (WORK-REGISTRY.md - the wave-4
 * domain ontology/terminology family, registry row DH-004 "domain
 * ontology/terminology layer"). A harness is domain-specific not only
 * through its industry label (DH-01) and its named roles (DH-003) but
 * through its DOMAIN TERMINOLOGY - the terms of art the domain's work
 * is conducted in. This family is that layer: a typed, staged,
 * deterministic terminology record family bound to a harness,
 * composing term entries (configuration only), with the family's
 * validation, serialization and persistence laws. Composition over
 * the landed families: the frozen industry vocabulary, the harness-id
 * alphabet, the staged-session and the PIN-2 persistence architecture
 * are the LANDED DH-01/DH-02/DH-03 surfaces - imported from the real
 * modules, never re-declared, re-implemented or shadowed (THE IMPORT
 * LAW, this wave's charter).
 *
 * LAWS (the DH-004 work order; the landed DH-01/DH-02/DH-03 family
 * precedents, inherited and binding):
 * - THE NO-FORK LAW (binding, the family charter): a harness is
 *   composable configuration over the universal Flauz core - the
 *   ontology COMPOSES the domain terminology; a term is CONFIGURATION
 *   (a term of art plus its definition, EXACTLY two keys); it grants
 *   NOTHING by itself. The structural engine's term station: any
 *   additional key on a term entry is the typed no-fork rejection.
 * - THE IMPORT LAW (binding, this wave's charter): the frozen industry
 *   vocabulary, the harness-id alphabet, the staged-session
 *   architecture and the persistence pattern are the LANDED DH-01 /
 *   DH-02 / DH-03 surfaces - imported from the real modules, never
 *   re-declared, re-implemented or shadowed (the battery pins the
 *   imports).
 * - THE CONTENT LAW (binding, this wave's honesty): NO per-industry
 *   term templates are shipped - this wave ships the LAYER, the
 *   machinery, not domain content (the registry's DH-002 precedent
 *   "industry role templates are LATER waves - do not invent them"
 *   applied verbatim to term templates); an invented legal / medical
 *   / finance vocabulary would be an unsourced fork of domain truth.
 *   The caller composes the terms; this family never invents them.
 * - THE FROZEN-VOCABULARY LAW (binding): the ontology admits ONLY the
 *   landed HARNESS_INDUSTRIES members (membership is the only
 *   admissibility; the ontology is industry-scoped), and the
 *   harnessId must satisfy the REAL DH-01 harness-id alphabet (the
 *   FORM law - the EXISTENCE binding is the caller's wiring, never
 *   this layer's; the AGREEMENT with the bound harness's own industry
 *   is the caller's composition law).
 * - THE FORWARD-ONLY LAW / THE APPEND-ONLY LINEAGE LAW (binding):
 *   composing -> composed; 'composed' is TERMINAL (a frozen
 *   terminology; every mutating op on a composed record refuses with
 *   the stage law); the Lab-driven specialization (DH-012) mints NEW
 *   lineage records - nothing ever mutates a composed one.
 * - THE TERM LAWS (binding, frozen constants): the term is non-empty,
 *   at most TERM_MAX_LENGTH (64) characters, carries NO leading or
 *   trailing whitespace and no control characters; the definition is
 *   non-empty, at most DEFINITION_MAX_LENGTH (300) characters and
 *   carries no control characters; the ontology holds at most
 *   MAX_TERMS (256) terms; terms are unique within the ontology; at
 *   least one term at finalize (the empty-terms floor fires THERE,
 *   never the record shape - a composing record may hold zero).
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
 * - THE SINGLE-VERSION LAW (binding): ONTOLOGY_CONTRACTS_VERSION is
 *   '1.0.0' declared ONCE here, re-carried by the kit;
 *   DOMAIN_HARNESS_CONTRACTS_VERSION, ONBOARDING_CONTRACTS_VERSION
 *   and ROLES_CONTRACTS_VERSION are declared ONCE in THEIR modules
 *   and re-carried here by reference (the battery pins every copy
 *   equal).
 * - Zero external dependencies: this module is pure vocabulary over
 *   typed values; no I/O, no clock, no env read.
 */

import { isHarnessId, isHarnessIndustry } from '../../contract/common/domainHarnessContract.js';
import type { HarnessIndustry } from '../../contract/common/domainHarnessContract.js';

/**
 * THE IMPORT LAW's re-export block: the REAL DH-01 harness-id alphabet
 * and the frozen industry vocabulary, plus the three landed contract
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

/** THE SINGLE-VERSION LAW: ONTOLOGY_CONTRACTS_VERSION is declared ONCE here, re-carried by the kit. */
export const ONTOLOGY_CONTRACTS_VERSION = '1.0.0';

/**
 * The domain-ontology record id prefix (this family's namespace; the
 * same id law as flauz:hrn: / flauz:onb: / flauz:rol: - the kit mints
 * <prefix><16 lowercase hex> from the injected rng).
 */
export const ONTOLOGY_ID_PREFIX = 'flauz:ont:';

/**
 * The closed frozen stage vocabulary: the ontology walk's two stages.
 * 'composed' is TERMINAL (a frozen terminology; every mutating op on a
 * composed record refuses with the stage law; THE APPEND-ONLY LINEAGE
 * LAW: the DH-012 Lab-driven specialization mints NEW lineage records,
 * never a mutation of a composed one).
 */
export const ONTOLOGY_STAGES = [
        'composing',
        'composed',
] as const;
export type OntologyStage = (typeof ONTOLOGY_STAGES)[number];

/** Pure predicate over the closed stage list. */
export function isOntologyStage(value: unknown): value is OntologyStage {
        return (ONTOLOGY_STAGES as readonly string[]).includes(value as string);
}

/** One whitelisted forward stage transition row (THE FORWARD-ONLY LAW's whitelist). */
export interface OntologyStageTransition {
        readonly from: OntologyStage;
        readonly to: OntologyStage;
}

/**
 * The frozen forward-only whitelist: the ONLY legal stage transition
 * is composing->composed. 'composed' is TERMINAL - no reopen; the
 * DH-012 Lab specialization mints a NEW lineage record (never a
 * mutation of a composed one, THE APPEND-ONLY LINEAGE LAW). Widening
 * the map is a versioned contract decision.
 */
export const ONTOLOGY_FORWARD_TRANSITIONS = [
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
export type OntologyStageVerdict =
        | { readonly ok: true; readonly from: OntologyStage; readonly to: OntologyStage; readonly row: number }
        | {
                        readonly ok: false;
                        readonly reason: 'ILLEGAL_TRANSITION';
                        readonly from: unknown;
                        readonly to: unknown;
                        readonly whitelistRow: number | null;
                        readonly expectedTo: OntologyStage | null;
                        readonly detail: string;
                };

/**
 * THE FORWARD-ONLY LAW's verdict machine (pure): the exact whitelist
 * membership check. The only legal transition is composing->composed;
 * every other edge (self-loops, composed->anything, unknown stages,
 * non-strings) is the typed ILLEGAL_TRANSITION rejection naming the
 * violated whitelist row.
 */
export function canTransitionOntologyStage(from: unknown, to: unknown): OntologyStageVerdict {
        const transitions = ONTOLOGY_FORWARD_TRANSITIONS as readonly OntologyStageTransition[];
        let rowNumber = 0;
        for (let i = 0; i < transitions.length; i += 1) {
                if (transitions[i].from === from) {
                        rowNumber = i + 1;
                        break;
                }
        }
        if (!isOntologyStage(from) || !isOntologyStage(to)) {
                return {
                        ok: false,
                        reason: 'ILLEGAL_TRANSITION',
                        from,
                        to,
                        whitelistRow: rowNumber > 0 ? rowNumber : null,
                        expectedTo: rowNumber > 0 ? transitions[rowNumber - 1].to : null,
                        detail: `canTransitionOntologyStage: '${showValue(from)}' -> '${showValue(to)}' is refused - both stages must be members of the frozen ONTOLOGY_STAGES list (THE FORWARD-ONLY LAW - the stage vocabulary is frozen)`,
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
                        detail: `canTransitionOntologyStage: '${from}' -> '${to}' is refused - 'composed' is TERMINAL (the terminology is FROZEN; the DH-012 Lab specialization mints NEW lineage records, never a mutation - THE APPEND-ONLY LINEAGE LAW) (THE FORWARD-ONLY LAW)`,
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
                        detail: `canTransitionOntologyStage: '${from}' -> '${to}' is refused - the only whitelisted forward transition from '${from}' is row ${rowNumber} ('${from}' -> '${expectedTo}') (THE FORWARD-ONLY LAW - forward-only; composed is terminal)`,
                };
        }
        return { ok: true, from, to, row: rowNumber };
}

/**
 * The terminology-layer term laws (all frozen constants): the term is
 * non-empty, at most 64 characters, carries NO leading/trailing
 * whitespace and no control characters; the definition is non-empty,
 * at most 300 characters and carries no control characters; the
 * ontology holds at most MAX_TERMS (256) terms.
 */
export const TERM_MAX_LENGTH = 64;

/** The definition bound (non-empty, at most 300 characters, no control characters). */
export const DEFINITION_MAX_LENGTH = 300;

/** The composition bound (at most 256 terms; the empty floor fires at finalize). */
export const MAX_TERMS = 256;

/**
 * The frozen domain-ontology op-name vocabulary (the ledger line ops).
 */
export const ONTOLOGY_OP_NAMES = [
        'begin-ontology',
        'add-term',
        'replace-term-definition',
        'remove-term',
        'finalize-ontology',
] as const;
export type OntologyOpName = (typeof ONTOLOGY_OP_NAMES)[number];

/** Pure predicate over the closed op-name list. */
export function isOntologyOpName(value: unknown): value is OntologyOpName {
        return (ONTOLOGY_OP_NAMES as readonly string[]).includes(value as string);
}

/**
 * One provenance note in the record history: which clock reading the
 * op landed at, the stage edge it walked (fromStage null ONLY on the
 * begin note - the entry into 'composing'; the term ops are the
 * composing->composing self edge - the terminology composes
 * gradually), which op and which law granted it, and the deterministic
 * detail sentence.
 */
export interface OntologyTransitionNote {
        readonly at: string;
        readonly fromStage: OntologyStage | null;
        readonly toStage: OntologyStage;
        readonly op: OntologyOpName;
        readonly law: string;
        readonly detail: string;
}

/**
 * THE TERM LAWS' configuration entry: a term of art plus its
 * definition, EXACTLY two keys (THE NO-FORK LAW's term station: any
 * additional key is the typed no-fork rejection). A term is
 * CONFIGURATION; it grants NOTHING by itself.
 */
export interface OntologyTerm {
        readonly term: string;
        readonly definition: string;
}

/**
 * The persisted per-record honest record (THE SIX-KEY MODEL): the id,
 * the bound harness id (the REAL DH-01 flauz:hrn:<16-hex> form - the
 * FORM law here; the EXISTENCE binding is the caller's wiring, and
 * the AGREEMENT with the bound harness's own industry is the caller's
 * composition law, both pinned in the battery through the real kits),
 * the industry that scopes the terminology (one REAL
 * HARNESS_INDUSTRIES member, imported by reference), the stage, the
 * composed terms (MAY be empty while composing - the empty floor
 * fires at finalize, never the record shape), and the full op history
 * with provenance. The record carries NO contractVersion field: THE
 * SINGLE-VERSION LAW is enforced at the kit-layer persistence surfaces
 * (every ledger line and the envelope carry
 * ONTOLOGY_CONTRACTS_VERSION; a drift there is the typed
 * version-mismatch). Stage-vs-payload consistency is the ledger
 * replay's cross-check, never this shape's (the DH-01 guard
 * discipline).
 */
export interface DomainOntologyRecord {
        readonly ontologyId: string;
        readonly harnessId: string;
        readonly industry: HarnessIndustry;
        readonly stage: OntologyStage;
        readonly terms: readonly OntologyTerm[];
        readonly history: readonly OntologyTransitionNote[];
}

/** The frozen record schema keys, in the canonical fixed-key-order (the serialization order). */
export const ONTOLOGY_RECORD_SCHEMA_KEYS = [
        'ontologyId',
        'harnessId',
        'industry',
        'stage',
        'terms',
        'history',
] as const;

/** The frozen history-note schema keys, in the canonical fixed-key-order. */
export const ONTOLOGY_NOTE_SCHEMA_KEYS = [
        'at',
        'fromStage',
        'toStage',
        'op',
        'law',
        'detail',
] as const;

/** Pure predicate: a well-formed domain-ontology record id (flauz:ont:<16-hex>). */
export function isOntologyId(value: unknown): value is string {
        if (typeof value !== 'string') {
                return false;
        }
        if (!value.startsWith(ONTOLOGY_ID_PREFIX)) {
                return false;
        }
        const hex = value.slice(ONTOLOGY_ID_PREFIX.length);
        return /^[0-9a-f]{16}$/.test(hex);
}

/**
 * Closed frozen list of domain-ontology rejection reasons, in the
 * exact walk order (the work order's sixteen stations are the EXACT
 * PREFIX; the two appended stations are this family's own design -
 * each documented below - the work order authorizes the extension
 * "where your design needs a distinct station"; the validation walks
 * collect EVERY violated law into the typed rejection table, the
 * table's records appearing in this order):
 *   malformed-record      - the candidate is not a plain object, or a
 *                           carrier carries the wrong structural type
 *                           (a non-array terms / history carrier);
 *   unknown-key           - a key outside the frozen six-key record
 *                           schema;
 *   missing-key           - a required record key is absent;
 *   malformed-harness-id  - the bound harnessId is not the REAL
 *                           DH-01 flauz:hrn:<16-hex> form (imported
 *                           by reference - the FORM law; the
 *                           EXISTENCE binding is the caller's
 *                           wiring, never this layer's);
 *   unknown-industry      - THE FROZEN-VOCABULARY LAW: the industry
 *                           is not a member of the DH-01 list
 *                           (imported by reference);
 *   malformed-term        - a term entry is not a plain object, or a
 *                           term / definition carrier is not a
 *                           string;
 *   no-fork               - THE NO-FORK LAW's term station: a term
 *                           entry carries a key beyond term +
 *                           definition (a term is CONFIGURATION - it
 *                           grants NOTHING by itself);
 *   invalid-term          - the term is empty, longer than 64
 *                           characters, carries leading/trailing
 *                           whitespace, or carries control characters
 *                           (C0/DEL/C1);
 *   invalid-definition    - the definition is empty, longer than 300
 *                           characters, or carries control characters
 *                           (C0/DEL/C1);
 *   duplicate-term        - terms are not unique within the ontology;
 *   max-terms-exceeded    - the ontology carries more than MAX_TERMS
 *                           (256) terms (the composition bound);
 *   empty-terms           - THE DH-01 FLOOR: the finalize boundary
 *                           requires at least one composed term (a
 *                           composing record may hold zero);
 *   unknown-record        - the record id is not the
 *                           flauz:ont:<16-hex> form (and, at the kit
 *                           layer, no record resolves under the id -
 *                           a malformed id fails closed as unknown);
 *   version-mismatch      - THE SINGLE-VERSION LAW: a version-bearing
 *                           persisted surface (a kit-layer ledger line
 *                           or the envelope) carries a contract
 *                           version other than
 *                           ONTOLOGY_CONTRACTS_VERSION (the six-key
 *                           record carries no version field - this
 *                           station never fires in the pure record
 *                           walk);
 *   unknown-stage         - the stage is not a member of the frozen
 *                           ONTOLOGY_STAGES list;
 *   malformed-history     - a history note fails the frozen six-key
 *                           note shape;
 *   stale-stage           - THE FORWARD-ONLY LAW (kit layer): the op
 *                           is behind the walk (a mutating op on a
 *                           composed record - 'composed' is TERMINAL,
 *                           the terminology is FROZEN; a changed
 *                           terminology is a NEW record, THE
 *                           APPEND-ONLY LINEAGE LAW);
 *   unknown-term          - the term names no term in the ontology
 *                           (at the kit layer; a malformed term name
 *                           fails closed as unknown).
 * Widening or reordering the list is a versioned contract decision.
 */
export const ONTOLOGY_REJECTION_REASONS = [
        'malformed-record',
        'unknown-key',
        'missing-key',
        'malformed-harness-id',
        'unknown-industry',
        'malformed-term',
        'no-fork',
        'invalid-term',
        'invalid-definition',
        'duplicate-term',
        'max-terms-exceeded',
        'empty-terms',
        'unknown-record',
        'version-mismatch',
        'unknown-stage',
        'malformed-history',
        'stale-stage',
        'unknown-term',
] as const;
export type OntologyRejectionReason = (typeof ONTOLOGY_REJECTION_REASONS)[number];

/** Pure predicate over the closed rejection list. */
export function isOntologyRejectionReason(value: unknown): value is OntologyRejectionReason {
        return (ONTOLOGY_REJECTION_REASONS as readonly string[]).includes(value as string);
}

/**
 * One typed rejection from a validation walk: the frozen reason, the
 * violated law's name, the offending items, and the deterministic
 * detail sentence. NEVER a string throw, NEVER a silent skip.
 */
export interface OntologyRejection {
        readonly reason: OntologyRejectionReason;
        readonly law: string;
        readonly items?: readonly string[];
        readonly detail: string;
}

/**
 * The typed validation outcome (the family's outcome pattern, the
 * DH-03 RoleCompositionValidationOutcome shape carrying the DH-01
 * complete-table law): ok carries the canonical value; refusal
 * carries the COMPLETE typed rejection table in the frozen walk order
 * - never first-only.
 */
export type OntologyValidationOutcome<T> =
        | { readonly ok: true; readonly value: T }
        | { readonly ok: false; readonly mode: 'shape'; readonly rejections: readonly OntologyRejection[] };

/**
 * The single-term station walk (the kit's addTerm station, the
 * family's per-payload validator architecture): malformed-term ->
 * no-fork -> invalid-term -> invalid-definition, the complete table
 * over ONE entry. Ok carries the canonical { term, definition } copy.
 */
export function validateTermEntry(term: unknown): OntologyValidationOutcome<OntologyTerm> {
        const rejections: OntologyRejection[] = [];
        if (!isRecord(term)) {
                rejections.push({
                        reason: 'malformed-term',
                        law: 'THE FAIL-CLOSED LAW',
                        items: ['term'],
                        detail: 'validateTermEntry: every term entry must be a plain object of exactly { term, definition } (a term is configuration; it grants NOTHING by itself)',
                });
                return { ok: false, mode: 'shape', rejections };
        }
        const record = term as Record<string, unknown>;
        if (typeof record.term !== 'string' || typeof record.definition !== 'string') {
                rejections.push({
                        reason: 'malformed-term',
                        law: 'THE FAIL-CLOSED LAW',
                        items: [typeof record.term !== 'string' ? 'term' : 'definition'],
                        detail: 'validateTermEntry: the term and the definition must be strings (a term of art is a name plus its definition)',
                });
        }
        const extraKeys = Object.keys(record).filter((key) => key !== 'term' && key !== 'definition');
        if (extraKeys.length > 0) {
                rejections.push({
                        reason: 'no-fork',
                        law: 'THE NO-FORK LAW',
                        items: extraKeys,
                        detail: `validateTermEntry: a term is CONFIGURATION (a term of art plus its definition) - it grants NOTHING by itself; the extra key(s) ${showList(extraKeys)} are execution material and cannot appear on a term entry`,
                });
        }
        if (typeof record.term === 'string') {
                const violations = termViolationsOf(record.term);
                if (violations.length > 0) {
                        rejections.push({
                                reason: 'invalid-term',
                                law: 'THE FAIL-CLOSED LAW',
                                items: violations,
                                detail: `validateTermEntry: the term must be a non-empty string of at most ${TERM_MAX_LENGTH} characters with no leading/trailing whitespace and no control characters (C0/DEL/C1)`,
                        });
                }
        }
        if (typeof record.definition === 'string') {
                const violations = definitionViolationsOf(record.definition);
                if (violations.length > 0) {
                        rejections.push({
                                reason: 'invalid-definition',
                                law: 'THE FAIL-CLOSED LAW',
                                items: violations,
                                detail: `validateTermEntry: the definition must be a non-empty string of at most ${DEFINITION_MAX_LENGTH} characters with no control characters (C0/DEL/C1)`,
                        });
                }
        }
        if (rejections.length > 0) {
                return { ok: false, mode: 'shape', rejections };
        }
        return { ok: true, value: { term: record.term as string, definition: record.definition as string } };
}

/**
 * The definition station walk (the kit's replaceTermDefinition
 * station): malformed-record (the non-string carrier) ->
 * invalid-definition (the bounds). Ok carries the definition string.
 */
export function validateTermDefinition(definition: unknown): OntologyValidationOutcome<string> {
        const rejections: OntologyRejection[] = [];
        if (typeof definition !== 'string') {
                rejections.push({
                        reason: 'malformed-record',
                        law: 'THE FAIL-CLOSED LAW',
                        items: ['definition'],
                        detail: 'validateTermDefinition: the definition must be a string (the term of art\'s definition)',
                });
        } else {
                const violations = definitionViolationsOf(definition);
                if (violations.length > 0) {
                        rejections.push({
                                reason: 'invalid-definition',
                                law: 'THE FAIL-CLOSED LAW',
                                items: violations,
                                detail: `validateTermDefinition: the definition must be a non-empty string of at most ${DEFINITION_MAX_LENGTH} characters with no control characters (C0/DEL/C1)`,
                        });
                }
        }
        if (rejections.length > 0) {
                return { ok: false, mode: 'shape', rejections };
        }
        return { ok: true, value: definition as string };
}

/**
 * The deep record walk (pure): the strict six-key shape walk over the
 * honest record - malformed-record (the record and its carriers),
 * unknown-key, missing-key, malformed-harness-id (THE REAL DH-01
 * harness-id alphabet import - the FORM law), unknown-industry (THE
 * FROZEN-VOCABULARY LAW against the REAL import), the terms family
 * laws (malformed-term / no-fork / invalid-term / invalid-definition
 * per entry, duplicate-term, max-terms-exceeded), unknown-record (the
 * id alphabet), unknown-stage, malformed-history. THE COMPLETE TABLE:
 * every violated station is reported, in the frozen walk order. Empty
 * terms are LEGAL here (the floor fires at finalize, never the record
 * shape); stage-vs-payload consistency is the ledger replay's
 * cross-check, never this walk's. Ok carries the canonical
 * fixed-key-order copy.
 */
export function validateOntologyRecord(value: unknown): OntologyValidationOutcome<DomainOntologyRecord> {
        const rejections: OntologyRejection[] = [];
        if (!isRecord(value)) {
                rejections.push({
                        reason: 'malformed-record',
                        law: 'THE FAIL-CLOSED LAW',
                        items: ['record'],
                        detail: 'validateOntologyRecord: the record must be a plain object (never a silent partial verdict)',
                });
                return { ok: false, mode: 'shape', rejections };
        }
        const record = value as Record<string, unknown>;
        const keys = Object.keys(record);

        // station 1 (malformed-record): the carriers.
        const carrierViolations: string[] = [];
        if (hasOwn(record, 'terms') && !Array.isArray(record.terms)) {
                carrierViolations.push('terms');
        }
        if (hasOwn(record, 'history') && !Array.isArray(record.history)) {
                carrierViolations.push('history');
        }
        if (carrierViolations.length > 0) {
                rejections.push({
                        reason: 'malformed-record',
                        law: 'THE FAIL-CLOSED LAW',
                        items: carrierViolations,
                        detail: `validateOntologyRecord: a record field carries the wrong structural type - the carrier(s) ${showList(carrierViolations)} must be arrays (never a silent partial verdict)`,
                });
        }

        // station 2 (unknown-key): the strict six-key schema is closed.
        const unknownKeys = keys.filter((key) => !(ONTOLOGY_RECORD_SCHEMA_KEYS as readonly string[]).includes(key));
        if (unknownKeys.length > 0) {
                rejections.push({
                        reason: 'unknown-key',
                        law: 'THE FAIL-CLOSED LAW',
                        items: unknownKeys,
                        detail: `validateOntologyRecord: the record schema is closed (THE SIX-KEY MODEL) - the unknown key(s) ${showList(unknownKeys)} are rejected`,
                });
        }

        // station 3 (missing-key): the strict schema requires every key.
        const missingKeys = (ONTOLOGY_RECORD_SCHEMA_KEYS as readonly string[]).filter((key) => !hasOwn(record, key));
        if (missingKeys.length > 0) {
                rejections.push({
                        reason: 'missing-key',
                        law: 'THE FAIL-CLOSED LAW',
                        items: missingKeys,
                        detail: `validateOntologyRecord: the record schema requires every key - the key(s) ${showList(missingKeys)} are missing`,
                });
        }

        // station 4 (malformed-harness-id): the REAL DH-01 harness-id alphabet (THE IMPORT LAW).
        // (the absent-key discipline: an absent harnessId is station 3's missing-key,
        // never a cascade here - the DH-01 law: an absent key is the missing-key
        // station, never a structural one.)
        if (hasOwn(record, 'harnessId') && !isHarnessId(record.harnessId)) {
                rejections.push({
                        reason: 'malformed-harness-id',
                        law: 'THE FAIL-CLOSED LAW',
                        items: [showValue(record.harnessId)],
                        detail: 'validateOntologyRecord: the harnessId must satisfy the REAL DH-01 harness-id alphabet (flauz:hrn:<16-hex>, imported by reference - the FORM law; the EXISTENCE binding is the caller\'s wiring, never this layer\'s)',
                });
        }

        // station 5 (unknown-industry): THE FROZEN-VOCABULARY LAW against the REAL import.
        if (hasOwn(record, 'industry') && !isHarnessIndustry(record.industry)) {
                rejections.push({
                        reason: 'unknown-industry',
                        law: 'THE FROZEN-VOCABULARY LAW',
                        items: [showValue(record.industry)],
                        detail: 'validateOntologyRecord: the industry must be a member of the frozen HARNESS_INDUSTRIES list, imported by reference from the DH-01 contract (membership is the only admissibility; the ontology is industry-scoped)',
                });
        }

        // stations 6-11 (the terms family laws), only walkable when the carrier is an array.
        if (Array.isArray(record.terms)) {
                const terms = record.terms as unknown[];
                for (let i = 0; i < terms.length; i += 1) {
                        const term = terms[i];
                        if (!isRecord(term)) {
                                rejections.push({
                                        reason: 'malformed-term',
                                        law: 'THE FAIL-CLOSED LAW',
                                        items: [`terms[${i}]`],
                                        detail: 'validateOntologyRecord: every term entry must be { term, definition } with non-empty strings (a term is configuration; it grants NOTHING by itself)',
                                });
                                continue;
                        }
                        const entry = validateTermEntry(term);
                        if (!entry.ok) {
                                for (const rejection of entry.rejections) {
                                        rejections.push(prefixRejectionItems(rejection, `terms[${i}]`));
                                }
                        }
                }
                const termDuplicates = findDuplicates(
                        terms.filter((term) => isRecord(term) && typeof (term as Record<string, unknown>).term === 'string').map(
                                (term) => (term as Record<string, unknown>).term as string,
                        ),
                );
                if (termDuplicates.length > 0) {
                        rejections.push({
                                reason: 'duplicate-term',
                                law: 'THE FAIL-CLOSED LAW',
                                items: termDuplicates,
                                detail: 'validateOntologyRecord: terms must be unique within the ontology (a term of art appears once)',
                        });
                }
                if (terms.length > MAX_TERMS) {
                        rejections.push({
                                reason: 'max-terms-exceeded',
                                law: 'THE FAIL-CLOSED LAW',
                                items: [`${terms.length} terms`],
                                detail: `validateOntologyRecord: the ontology carries at most MAX_TERMS (${MAX_TERMS}) terms (the composition bound)`,
                        });
                }
        }

        // station 12 (empty-terms) never fires on the record shape: the floor lives at
        // the kit's finalizeOntology boundary (a composing record may hold ZERO terms).

        // station 13 (unknown-record): the id alphabet.
        // (the absent-key discipline: an absent ontologyId is station 3's missing-key,
        // never a cascade here.)
        if (hasOwn(record, 'ontologyId') && !isOntologyId(record.ontologyId)) {
                rejections.push({
                        reason: 'unknown-record',
                        law: 'THE FAIL-CLOSED LAW',
                        items: [showValue(record.ontologyId)],
                        detail: `validateOntologyRecord: the ontologyId must be the ${ONTOLOGY_ID_PREFIX}<16-hex> form (minted from the injected rng at the kit boundary, never caller-supplied)`,
                });
        }

        // station 14 (version-mismatch) never fires on THE SIX-KEY MODEL: the record
        // carries no contractVersion - THE SINGLE-VERSION LAW is enforced at the
        // kit-layer persistence surfaces (every ledger line and the envelope carry
        // ONTOLOGY_CONTRACTS_VERSION; a drift there is the typed version-mismatch).

        // station 15 (unknown-stage).
        // (the absent-key discipline: an absent stage is station 3's missing-key,
        // never a cascade here.)
        if (hasOwn(record, 'stage') && !isOntologyStage(record.stage)) {
                rejections.push({
                        reason: 'unknown-stage',
                        law: 'THE FORWARD-ONLY LAW',
                        items: [showValue(record.stage)],
                        detail: 'validateOntologyRecord: the stage must be a member of the frozen ONTOLOGY_STAGES list (composing -> composed; composed is TERMINAL)',
                });
        }

        // station 16 (malformed-history), only walkable when the carrier is an array.
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
                                detail: 'validateOntologyRecord: every history note must carry the frozen six-key note shape (at / fromStage / toStage / op / law / detail - the provenance record)',
                        });
                }
        }

        if (rejections.length > 0) {
                return { ok: false, mode: 'shape', rejections };
        }
        return { ok: true, value: canonicalOntologyRecord(record as unknown as DomainOntologyRecord) };
}

/**
 * Pure deep shape guard: a well-formed domain-ontology record (the
 * deep walk above, green). Fails closed on every malformed path;
 * never reads a clock; never mutates its input.
 */
export function isOntologyRecord(value: unknown): value is DomainOntologyRecord {
        return validateOntologyRecord(value).ok;
}

/**
 * THE CANONICAL SERIALIZATION: the fixed-key-order JSON bytes of a
 * domain-ontology record (byte-deterministic; double-serialize
 * byte-equality; the key order frozen in this module and pinned by
 * tests - the DH-01 algorithm: the frozen per-shape key orders applied
 * deeply, never an alphabetic re-sort). The record keys emit in the
 * ONTOLOGY_RECORD_SCHEMA_KEYS order, the term entries in the
 * term,definition order, and the history notes in the
 * ONTOLOGY_NOTE_SCHEMA_KEYS order. Throws TypeError on a malformed
 * record (never dishonest bytes).
 */
export function serializeOntologyRecord(record: unknown): string {
        if (!isOntologyRecord(record)) {
                throw new TypeError(
                        'serializeOntologyRecord: record must satisfy isOntologyRecord - no dishonest domain-ontology record ever gets canonical bytes',
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
 *   unknown-key              - an extra key at the record, term or
 *                              note level (tampered bytes);
 *   invalid-record           - the deep semantic walk refuses.
 */
export const ONTOLOGY_PARSE_REJECTION_REASONS = [
        'malformed-json',
        'torn-envelope',
        'unknown-contract-version',
        'unknown-key',
        'invalid-record',
] as const;
export type OntologyParseRejectionReason = (typeof ONTOLOGY_PARSE_REJECTION_REASONS)[number];

/** Pure predicate over the closed parse-rejection list. */
export function isOntologyParseRejectionReason(value: unknown): value is OntologyParseRejectionReason {
        return (ONTOLOGY_PARSE_REJECTION_REASONS as readonly string[]).includes(value as string);
}

/** The typed parse rejection: the frozen reason and the drift-naming detail. */
export interface OntologyParseRejection {
        readonly reason: OntologyParseRejectionReason;
        readonly detail: string;
}

/** The typed parse outcome: ok carries the validated record; failure names the drift. */
export type OntologyParseOutcome =
        | { readonly ok: true; readonly record: DomainOntologyRecord }
        | { readonly ok: false; readonly rejection: OntologyParseRejection };

/**
 * THE FAIL-CLOSED PARSE: bytes -> the typed parse outcome. Malformed
 * JSON, a torn envelope, an unknown key (record / term / note level),
 * or invalid content (the deep record walk) - each a typed rejection
 * naming the drift; never a silent partial parse.
 * First-failure-is-the-verdict, in the frozen
 * ONTOLOGY_PARSE_REJECTION_REASONS order.
 */
export function parseOntologyRecord(bytes: unknown): OntologyParseOutcome {
        if (typeof bytes !== 'string') {
                return {
                        ok: false,
                        rejection: {
                                reason: 'torn-envelope',
                                detail: 'parseOntologyRecord: bytes must be a string (the canonical fixed-key-order record bytes)',
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
                                detail: `parseOntologyRecord: the bytes are not valid JSON: ${toMessage(error)}`,
                        },
                };
        }
        if (!isRecord(parsed)) {
                return {
                        ok: false,
                        rejection: {
                                reason: 'torn-envelope',
                                detail: 'parseOntologyRecord: the bytes must carry a JSON object (the record envelope)',
                        },
                };
        }
        const record = parsed as Record<string, unknown>;
        for (const key of ONTOLOGY_RECORD_SCHEMA_KEYS) {
                if (!hasOwn(record, key)) {
                        return {
                                ok: false,
                                rejection: {
                                        reason: 'torn-envelope',
                                        detail: `parseOntologyRecord: the '${key}' key is missing (a torn write - never a silent partial parse)`,
                                },
                        };
                }
        }
        if (typeof record.ontologyId !== 'string' || typeof record.harnessId !== 'string' || typeof record.industry !== 'string' || typeof record.stage !== 'string' || !Array.isArray(record.terms) || !Array.isArray(record.history)) {
                return {
                        ok: false,
                        rejection: {
                                reason: 'torn-envelope',
                                detail: 'parseOntologyRecord: the record envelope carries a value of the wrong structural type (a torn write - never a silent partial parse)',
                        },
                };
        }
        const unknownRecordKeys = Object.keys(record).filter((key) => !(ONTOLOGY_RECORD_SCHEMA_KEYS as readonly string[]).includes(key));
        if (unknownRecordKeys.length > 0) {
                return {
                        ok: false,
                        rejection: {
                                reason: 'unknown-key',
                                detail: `parseOntologyRecord: the record carries the unknown key '${unknownRecordKeys[0]}' (the strict six-key record schema is closed)`,
                        },
                };
        }
        const terms = record.terms as unknown[];
        for (let i = 0; i < terms.length; i += 1) {
                const term = terms[i];
                if (isRecord(term)) {
                        const extraTermKeys = Object.keys(term as Record<string, unknown>).filter((key) => key !== 'term' && key !== 'definition');
                        if (extraTermKeys.length > 0) {
                                return {
                                        ok: false,
                                        rejection: {
                                                reason: 'unknown-key',
                                                detail: `parseOntologyRecord: the term entry terms[${i}] carries the unknown key '${extraTermKeys[0]}' (a term is term + definition only)`,
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
                                (key) => !(ONTOLOGY_NOTE_SCHEMA_KEYS as readonly string[]).includes(key),
                        );
                        if (extraNoteKeys.length > 0) {
                                return {
                                        ok: false,
                                        rejection: {
                                                reason: 'unknown-key',
                                                detail: `parseOntologyRecord: the history note history[${i}] carries the unknown key '${extraNoteKeys[0]}' (the note schema is closed)`,
                                        },
                                };
                        }
                }
        }
        const deep = validateOntologyRecord(parsed);
        if (!deep.ok) {
                return {
                        ok: false,
                        rejection: {
                                reason: 'invalid-record',
                                detail: `parseOntologyRecord: the parsed record fails the deep record walk (${deep.rejections[0].reason} - ${deep.rejections[0].detail}; never a silent partial parse)`,
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

/** The term law violations (empty, over-length, whitespace padding, control characters), as deterministic item strings. */
function termViolationsOf(term: string): string[] {
        const violations: string[] = [];
        if (term.length === 0) {
                violations.push('empty');
        }
        if (term.length > TERM_MAX_LENGTH) {
                violations.push(`${term.length} chars`);
        }
        if (term !== term.trim()) {
                violations.push('leading/trailing whitespace');
        }
        const controls = controlCharactersOf(term);
        if (controls.length > 0) {
                violations.push(...controls);
        }
        return violations;
}

/** The definition law violations (empty, over-length, control characters), as deterministic item strings. */
function definitionViolationsOf(definition: string): string[] {
        const violations: string[] = [];
        if (definition.length === 0) {
                violations.push('empty');
        }
        if (definition.length > DEFINITION_MAX_LENGTH) {
                violations.push(`${definition.length} chars`);
        }
        const controls = controlCharactersOf(definition);
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
function isWellFormedNote(value: unknown): value is OntologyTransitionNote {
        if (!isRecord(value)) {
                return false;
        }
        const record = value as Record<string, unknown>;
        const keys = Object.keys(record).sort();
        const expected = [...ONTOLOGY_NOTE_SCHEMA_KEYS].sort();
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
        if (record.fromStage !== null && !isOntologyStage(record.fromStage)) {
                return false;
        }
        if (!isOntologyStage(record.toStage)) {
                return false;
        }
        if (!isOntologyOpName(record.op)) {
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
function prefixRejectionItems(rejection: OntologyRejection, prefix: string): OntologyRejection {
        if (rejection.items === undefined) {
                return rejection;
        }
        return {
                ...rejection,
                items: rejection.items.map((item) => `${prefix}:${item}`),
        };
}

/** Builds the canonical fixed-key-order copy of a validated record. */
function canonicalOntologyRecord(record: DomainOntologyRecord): DomainOntologyRecord {
        return canonicalRecordObject(record) as unknown as DomainOntologyRecord;
}

/** Builds the canonical fixed-key-order object of a validated record (the serializer's engine). */
function canonicalRecordObject(record: DomainOntologyRecord): Record<string, unknown> {
        return {
                ontologyId: record.ontologyId,
                harnessId: record.harnessId,
                industry: record.industry,
                stage: record.stage,
                terms: record.terms.map((term) => ({ term: term.term, definition: term.definition })),
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
