/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * DH-008 policy/approval/evidence/KPI profiles kit: the deterministic
 * staged-record runtime over the profiles contract vocabulary AND the
 * REAL authority vocabularies (imported, never re-implemented - THE
 * IMPORT LAW, this wave's charter). The kit walks a record begin ->
 * addProfile / replaceProfileSummary / removeProfile ->
 * finalizeProfiles: beginProfiles binds the record to a harness
 * through the REAL DH-01 harness-id alphabet (the FORM law -
 * isHarnessId, imported by reference; the EXISTENCE binding is the
 * caller's wiring, pinned in the battery through the real DH-01 kit)
 * and mints the flauz:prf:<16-hex> id from the injected rng; the
 * profile ops apply the profile laws (shape, bounds, uniqueness, the
 * MAX_PROFILES bound, THE AUTHORITY-BINDING LAW against the REAL
 * imported vocabularies - the catalog permission predicate, the
 * catalog risk tiers, the lab evidence ladder, the lab eval
 * dimensions); finalizeProfiles freezes the record (composing ->
 * composed, TERMINAL) at THE AUTHORITY-BINDING BOUNDARY: the
 * complete-table record walk re-proves every vocabulary against the
 * REAL imported tables (the typed refusals name each offending item
 * once, in first-seen order) and the empty-profiles floor fires
 * THERE, never the record shape. THE REMOVE+RE-ADD LAW: a profile's
 * key is its identity - immutable once added; only the summary is
 * replaceable; a changed profileKey is a new profile (remove, then
 * re-add); removing the last profile is legal while composing.
 * emitPolicyRef / emitEvidenceRef emit the COMPOSED record's id as
 * the policyRef / the evidenceRef - pure reads, only from a COMPOSED
 * record - riding the DH-02 review composition's policyRefs /
 * evidenceRefs families (a string, duplicate-free).
 *
 * THE NO-NEW-AUTHORITY LAW (ARCHITECTURE-LOCK 12.6): the kit injects
 * NO catalog and NO authority of any kind - the options carry only
 * the clock, the rng and the optional fs port/root pair; the
 * vocabularies are the REAL imported modules (deterministic by
 * construction); a profile is typed CONFIGURATION over them and this
 * layer never grants a permission, brokers an approval, leads
 * evidence or executes anything.
 *
 * The persistence is the PIN-2 mirror (the landed family precedent):
 * the append-only ops ledger <root>/.flauz/harness/profiles-ops.jsonl
 * (each applied op one canonical JSON line; the seq equals the line
 * number; THE APPEND-ONLY LEDGER LAW) and the envelope
 * <root>/.flauz/harness/profiles-records.json ({ contractVersion,
 * seq, records } - the five-key record carries no version field).
 * Lazy persistence (the subtree lands with the first applied op); a
 * fresh kit never appends over a non-empty profiles ledger - reopen
 * with loadProfilesKit; restart-deterministic.
 *
 * LAWS (inherited binding from the contract module's header; the
 * contract module carries their enforcement surface): THE IMPORT LAW,
 * THE AUTHORITY-BINDING LAW, THE NO-NEW-AUTHORITY LAW, THE
 * FORWARD-ONLY LAW / THE APPEND-ONLY LINEAGE LAW, THE REMOVE+RE-ADD
 * LAW, THE NO-FORK LAW, THE CONTENT LAW, THE DETERMINISM LAW (no
 * Math.random, no Date.now, no new Date(...) and no process.env in
 * this module - law comments excepted; the clock, the rng and the
 * fsPort are INJECTED seams; the factory consumes exactly ONE clock
 * read and ONE rng read), THE FAIL-CLOSED LAW (factory misuse throws
 * TypeError; every domain refusal is a typed record { reason, law,
 * detail, items? }; a refused op leaves the record unchanged;
 * payload-walk refusals carry the COMPLETE contract rejection
 * table), THE SINGLE-VERSION LAW (the re-export chain), THE
 * APPEND-ONLY LEDGER LAW, THE DISPOSE LAW (every operation after
 * dispose rejects with the typed DISPOSED refusal).
 */

import {
        MAX_PROFILES,
        PROFILES_CONTRACTS_VERSION,
        PROFILES_ID_PREFIX,
        PROFILES_REJECTION_REASONS,
        isHarnessId,
        isProfilesId,
        isProfilesOpName,
        isProfilesStage,
        serializeProfilesRecord,
        validateProfileEntry,
        validateProfileSummary,
        validateProfilesRecord,
} from './profilesContract.js';
import type {
        ProfilesOpName,
        ProfilesRejection,
        ProfileEntry,
        ProfilesTransitionNote,
        ProfilesRecord,
        ProfilesStage,
} from './profilesContract.js';
import type { HarnessFsPort } from '../../contract/common/domainHarnessKit.js';

/** THE SINGLE-VERSION LAW: the kit re-carries the contract's version (declared ONCE there). */
export { PROFILES_CONTRACTS_VERSION } from './profilesContract.js';

/** THE SINGLE-VERSION LAW (the re-export chain): the landed DH-01 version, re-carried by reference. */
export { DOMAIN_HARNESS_CONTRACTS_VERSION } from '../../contract/common/domainHarnessContract.js';

/** THE SINGLE-VERSION LAW (the re-export chain): the landed DH-02 version, re-carried by reference. */
export { ONBOARDING_CONTRACTS_VERSION } from '../../onboarding/common/onboardingContract.js';

/** THE SINGLE-VERSION LAW (the re-export chain): the landed DH-03 version, re-carried by reference. */
export { ROLES_CONTRACTS_VERSION } from '../../roles/common/rolesContract.js';

/** THE SINGLE-VERSION LAW (the re-export chain): the landed DH-04 version, re-carried by reference. */
export { ONTOLOGY_CONTRACTS_VERSION } from '../../ontology/common/ontologyContract.js';

/** THE SINGLE-VERSION LAW (the re-export chain): the landed DH-05 version, re-carried by reference. */
export { TEMPLATES_CONTRACTS_VERSION } from '../../templates/common/templatesContract.js';

/** THE SINGLE-VERSION LAW (the re-export chain): the landed DH-06 version, re-carried by reference. */
export { BODIES_CONTRACTS_VERSION } from '../../bodies/common/bodiesContract.js';

/** THE SINGLE-VERSION LAW (the re-export chain): the landed DH-07 version, re-carried by reference. */
export { PACKS_CONTRACTS_VERSION } from '../../packs/common/packsContract.js';

/**
 * THE IMPORT LAW: the REAL authority vocabularies are re-exported by
 * reference from the kit surface (the same bindings the contract
 * walks - the catalog permission vocabulary and risk tiers; the lab
 * evidence ladder and eval dimensions through the contract's pinned
 * type-exhaustive mirrors).
 */
export {
        CATALOG_PERMISSION_IDS,
        CATALOG_PERMISSION_RISK_TIERS,
        CATALOG_PERMISSION_TABLE,
        isCatalogPermissionId,
        isCatalogPermissionRiskTier,
} from '../../../capabilities/packs/common/catalog.js';
export { PROFILES_EVIDENCE_LADDER, PROFILES_EVAL_DIMENSIONS, isLabEvidenceLevel, isEvalDimension } from './profilesContract.js';

/**
 * The injected fs port is the DH-01 kit's OWN port type (the ONLY
 * filesystem seam - the PIN-2 sibling precedent; re-exported by
 * reference, never re-declared). The shipped kit never touches a
 * global fs, never reads the env; the caller wires the real driver.
 */
export type { HarnessFsPort } from '../../contract/common/domainHarnessKit.js';

/** The envelope path (relative to the injected root; the same .flauz/harness subtree as the landed families, distinct file). */
export const PROFILES_ENVELOPE_RELATIVE_PATH = '.flauz/harness/profiles-records.json';

/** The append-only ops ledger path (relative to the injected root; the same .flauz/harness subtree, distinct file). */
export const PROFILES_LEDGER_RELATIVE_PATH = '.flauz/harness/profiles-ops.jsonl';

/**
 * The frozen ledger-line schema keys, in the canonical fixed-key-order
 * (the ELEVEN-KEY line: the harness link is its own column - the
 * record BINDS to a harness through the REAL DH-01 id alphabet; the
 * payload carries the profile entry on the profile ops, null on begin
 * and finalize - this family injects no caller-supplied authority,
 * the vocabularies are the imported real modules).
 */
export const PROFILES_LEDGER_LINE_SCHEMA_KEYS = [
        'seq',
        'at',
        'contractVersion',
        'op',
        'profilesId',
        'harnessId',
        'fromStage',
        'toStage',
        'law',
        'payload',
        'detail',
] as const;

/** The frozen envelope schema keys, in the canonical fixed-key-order. */
export const PROFILES_ENVELOPE_SCHEMA_KEYS = ['contractVersion', 'seq', 'records'] as const;

/**
 * One append-only profiles ops ledger line (the canonical persisted
 * op): the seq (equal to the line number), the clock reading, the
 * contract version, the op name, the record id, the BOUND harness id
 * (the REAL DH-01 flauz:hrn:<16-hex> form, carried on every line),
 * the stage edge walked (fromStage null ONLY on the begin line; the
 * profile ops walk the composing->composing self edge - the domain
 * composes its default profiles gradually), the granting law, the
 * canonical op payload (the added / replacement / removed-as-it-stood
 * profile entry on the profile ops; null on begin and finalize), and
 * the deterministic detail sentence.
 */
export interface ProfilesOpsLedgerLine {
        readonly seq: number;
        readonly at: string;
        readonly contractVersion: string;
        readonly op: ProfilesOpName;
        readonly profilesId: string;
        readonly harnessId: string;
        readonly fromStage: ProfilesStage | null;
        readonly toStage: ProfilesStage;
        readonly law: string;
        readonly payload: ProfileEntry | null;
        readonly detail: string;
}

/**
 * The kit-layer refusal extras (the frozen list beyond the contract's
 * PROFILES_REJECTION_REASONS; the contract's twenty-four stations are
 * the PURE record walk - this wave's work order froze that list - so
 * the kit-layer domain stations are declared ONCE here, the
 * DH-006/DH-007 precedent's single-declaration discipline placed one
 * level up):
 *   unknown-record      - no record resolves under the id (a
 *                         malformed id fails closed as unknown);
 *   version-mismatch    - THE SINGLE-VERSION LAW: a version-bearing
 *                         persisted surface (a ledger line or the
 *                         envelope) carries a contract version other
 *                         than PROFILES_CONTRACTS_VERSION (the
 *                         five-key record carries no version field -
 *                         THIS is the law's live station);
 *   empty-profiles      - THE PROFILE LAWS' floor: the finalize
 *                         boundary requires at least one composed
 *                         profile (a composing record may hold zero);
 *   premature-op        - THE FORWARD-ONLY LAW: the op precedes its
 *                         precondition (a policyRef / evidenceRef
 *                         emitted while the record is still at
 *                         'composing' - refs are emitted only from a
 *                         COMPOSED record);
 *   stale-stage         - THE FORWARD-ONLY LAW: the op is behind the
 *                         walk (a mutating op on a composed record -
 *                         'composed' is TERMINAL, the record is
 *                         FROZEN; a changed profile is a NEW record,
 *                         THE APPEND-ONLY LINEAGE LAW);
 *   unknown-profile     - the profileKey names no profile in the
 *                         record (a malformed profileKey fails closed
 *                         as unknown);
 *   DISPOSED            - THE DISPOSE LAW: the kit was disposed;
 *                         every operation after dispose rejects;
 *   CORRUPT_SEAM        - THE DETERMINISM LAW: the injected clock or
 *                         rng returned a malformed value mid-op (an
 *                         empty clock reading, a non-16-hex rng
 *                         output, a duplicate minted record id);
 *   E_LEDGER_TORN       - THE APPEND-ONLY LEDGER LAW: a torn or
 *                         missing profiles ledger line, a structurally
 *                         invalid or out-of-order line, an unknown op
 *                         or an illegal stage edge inside the ledger,
 *                         or a fresh kit attempting to append over an
 *                         existing non-empty profiles ledger (reopen
 *                         with loadProfilesKit);
 *   E_ENVELOPE_MISMATCH - THE APPEND-ONLY LEDGER LAW: the profiles
 *                         envelope diverges from the ledger replay
 *                         (or is missing / malformed while the ledger
 *                         carries lines) - never silently rebuilt;
 *   PROFILES_IO         - THE FAIL-CLOSED LAW: the injected fs port
 *                         refused a read / append / write / mkdir on
 *                         the profiles family's own files;
 *   UNKNOWN_FILTER      - THE FAIL-CLOSED LAW: listProfilesSessions
 *                         received an unknown filter field or a
 *                         non-member filter value.
 */
export const PROFILES_KIT_EXTRA_REFUSAL_REASONS = [
        'unknown-record',
        'version-mismatch',
        'empty-profiles',
        'premature-op',
        'stale-stage',
        'unknown-profile',
        'DISPOSED',
        'CORRUPT_SEAM',
        'E_LEDGER_TORN',
        'E_ENVELOPE_MISMATCH',
        'PROFILES_IO',
        'UNKNOWN_FILTER',
] as const;

/** The frozen kit refusal vocabulary: the contract's 24 domain reasons plus the kit-layer extras. */
export const PROFILES_KIT_REFUSAL_REASONS = [
        ...PROFILES_REJECTION_REASONS,
        ...PROFILES_KIT_EXTRA_REFUSAL_REASONS,
] as const;
export type ProfilesKitRefusalReason = (typeof PROFILES_KIT_REFUSAL_REASONS)[number];

/** Pure predicate over the closed kit-refusal list. */
export function isProfilesKitRefusalReason(value: unknown): value is ProfilesKitRefusalReason {
        return (PROFILES_KIT_REFUSAL_REASONS as readonly string[]).includes(value as string);
}

/**
 * The typed kit refusal: the frozen reason, the violated law's name,
 * the deterministic detail sentence, the optional offending items, and
 * the COMPLETE contract rejection table (payload-walk refusals -
 * never first-only).
 */
export interface ProfilesKitRefusal {
        readonly reason: ProfilesKitRefusalReason;
        readonly law: string;
        readonly detail: string;
        readonly items?: readonly string[];
        /** payload-walk refusals carry the COMPLETE contract rejection table (never first-only). */
        readonly rejections?: readonly ProfilesRejection[];
}

/**
 * The kit construction options (all injected, never env-read; fsPort
 * and root come together or not at all - the DH-01 options law).
 * NO catalog injection and NO authority of any kind (THE
 * NO-NEW-AUTHORITY LAW): the vocabularies are the REAL imported
 * modules, deterministic by construction; the permission /
 * approval / evidence / KPI authorities are never this layer's.
 */
export interface ProfilesKitOptions {
        /** The injected clock (returns the ISO string; the kit never reads a clock itself). */
        readonly clock: () => string;
        /** The record-id-minting seam (returns 16 lowercase hex chars; NEVER the random global). */
        readonly rng: () => string;
        /** The OPTIONAL filesystem seam (persistence when paired with root). */
        readonly fsPort?: HarnessFsPort;
        /** The OPTIONAL persistence root (the .flauz/harness subtree lands under it). */
        readonly root?: string;
}

/** The staged-record op outcome: ok carries the honest record; failure carries the typed refusal. */
export type ProfilesRecordOutcome =
        | { readonly ok: true; readonly record: ProfilesRecord }
        | { readonly ok: false; readonly refusal: ProfilesKitRefusal };

/** The policy-ref outcome: ok carries the emitted policyRef string; failure carries the typed refusal. */
export type ProfilesPolicyRefOutcome =
        | { readonly ok: true; readonly policyRef: string }
        | { readonly ok: false; readonly refusal: ProfilesKitRefusal };

/** The evidence-ref outcome: ok carries the emitted evidenceRef string; failure carries the typed refusal. */
export type ProfilesEvidenceRefOutcome =
        | { readonly ok: true; readonly evidenceRef: string }
        | { readonly ok: false; readonly refusal: ProfilesKitRefusal };

/** The list outcome: ok carries the id-ordered honest records; failure carries the typed refusal. */
export type ProfilesListOutcome =
        | { readonly ok: true; readonly records: readonly ProfilesRecord[] }
        | { readonly ok: false; readonly refusal: ProfilesKitRefusal };

/** The load outcome: ok carries the reopened kit; failure carries the typed refusal. */
export type ProfilesLoadOutcome =
        | { readonly ok: true; readonly kit: ProfilesKit }
        | { readonly ok: false; readonly refusal: ProfilesKitRefusal };

/**
 * The deterministic profiles kit: every operation is async with a
 * typed outcome ({ ok: true, ... } | { ok: false, refusal }); a
 * refused op leaves the record unchanged (inspectable before and
 * after).
 */
export interface ProfilesKit {
        beginProfiles(harnessId: unknown): Promise<ProfilesRecordOutcome>;
        addProfile(profilesId: unknown, profile: unknown): Promise<ProfilesRecordOutcome>;
        replaceProfileSummary(profilesId: unknown, profileKey: unknown, summary: unknown): Promise<ProfilesRecordOutcome>;
        removeProfile(profilesId: unknown, profileKey: unknown): Promise<ProfilesRecordOutcome>;
        finalizeProfiles(profilesId: unknown): Promise<ProfilesRecordOutcome>;
        emitPolicyRef(profilesId: unknown): Promise<ProfilesPolicyRefOutcome>;
        emitEvidenceRef(profilesId: unknown): Promise<ProfilesEvidenceRefOutcome>;
        inspectProfiles(profilesId: unknown): Promise<ProfilesRecordOutcome>;
        listProfilesSessions(filter?: unknown): Promise<ProfilesListOutcome>;
        disposeProfiles(): void;
}

/**
 * Creates a profiles kit (fail-closed factory). Validation order is
 * deterministic and mirrors the landed DH-01/DH-02/DH-03/DH-04/
 * DH-05/DH-06/DH-07 factory walk EXACTLY (the same preconditions, the
 * same message shapes, the createProfilesKit prefix): the options
 * shape (clock / rng), the clock's first read (a non-empty ISO
 * string), the rng's first read (exactly 16 lowercase hex chars - the
 * id-minting law), and the fsPort/root pairing (both or neither; the
 * port must expose readFile / writeFile / appendFile / mkdir). The
 * factory consumes exactly ONE clock read and ONE rng read (there is
 * no inner kit to re-validate the seams - the battery pins the exact
 * count). The kit starts with ZERO records; persistence is LAZY (the
 * .flauz/harness subtree lands with the first applied op; a fresh kit
 * never appends over an existing non-empty profiles ledger - reopen
 * with loadProfilesKit).
 */
export function createProfilesKit(options: ProfilesKitOptions): ProfilesKit {
        const bound = validateKitOptions(options, false, 'createProfilesKit');
        return buildProfilesKit(bound, { seq: 0, records: new Map<string, ProfilesRecord>() });
}

/**
 * Reopens a persisted profiles kit: replays the append-only profiles
 * ops ledger (the authoritative surface - each line re-validated: the
 * frozen eleven-key line schema, the REAL DH-01 harness-id alphabet
 * on every line, the op's stage edge, the record's walk order, the
 * payload's full validation against the REAL imported vocabularies,
 * the MAX_PROFILES bound, the replace line's immutable-parts
 * cross-check, the remove line's entry-as-it-stood cross-check, and
 * the finalize floor AND the finalize complete-table walk - THE
 * AUTHORITY-BINDING LAW re-proved from the ledger alone), and
 * cross-checks the envelope byte-for-byte against the replay-built
 * state. A torn or missing profiles ledger line is the typed
 * E_LEDGER_TORN; a divergent, missing or malformed envelope is the
 * typed E_ENVELOPE_MISMATCH (never silently rebuilt); a
 * version-bearing surface carrying another contract version is the
 * typed version-mismatch (THE SINGLE-VERSION LAW's live station); a
 * refused fs port is the typed PROFILES_IO. A fresh root (no files)
 * reopens as an empty kit. The options require BOTH fsPort and root
 * (the load is a persistence-surface operation).
 */
export async function loadProfilesKit(options: ProfilesKitOptions): Promise<ProfilesLoadOutcome> {
        const bound = validateKitOptions(options, true, 'loadProfilesKit');
        const fsPort = bound.fsPort as HarnessFsPort;
        const ledgerPath = `${bound.root}/${PROFILES_LEDGER_RELATIVE_PATH}`;
        const envelopePath = `${bound.root}/${PROFILES_ENVELOPE_RELATIVE_PATH}`;
        try {
                await fsPort.mkdir(`${bound.root}/.flauz/harness`, { recursive: true });
        } catch (error) {
                return { ok: false, refusal: refused('PROFILES_IO', 'THE FAIL-CLOSED LAW', `loadProfilesKit: the fs port refused the root mkdir: ${toMessage(error)}`) };
        }
        let ledgerText: string | null;
        try {
                ledgerText = await readText(fsPort, ledgerPath);
        } catch (error) {
                return { ok: false, refusal: refused('PROFILES_IO', 'THE FAIL-CLOSED LAW', `loadProfilesKit: the fs port refused the profiles ledger read: ${toMessage(error)}`) };
        }
        let envelopeText: string | null;
        try {
                envelopeText = await readText(fsPort, envelopePath);
        } catch (error) {
                return { ok: false, refusal: refused('PROFILES_IO', 'THE FAIL-CLOSED LAW', `loadProfilesKit: the fs port refused the profiles envelope read: ${toMessage(error)}`) };
        }
        const replay = replayProfilesLedger(ledgerText);
        if (!('lines' in replay)) {
                return { ok: false, refusal: replay };
        }
        const crossCheck = crossCheckProfilesEnvelope(envelopeText, replay.lines.length, replay.records);
        if (crossCheck !== null) {
                return { ok: false, refusal: crossCheck };
        }
        return { ok: true, kit: buildProfilesKit(bound, { seq: replay.lines.length, records: replay.records }) };
}

// --- the kit internals ---

interface BoundOptions {
        readonly clock: () => string;
        readonly rng: () => string;
        readonly fsPort: HarnessFsPort | null;
        readonly root: string | null;
}

interface ProfilesKitState {
        readonly seq: number;
        readonly records: ReadonlyMap<string, ProfilesRecord>;
}

/** The persist fold's result: applied means the profiles ledger line landed (the ledger is authoritative). */
type PersistResult =
        | { readonly applied: false; readonly refusal: ProfilesKitRefusal }
        | { readonly applied: true; readonly refusal: ProfilesKitRefusal | null };

/** The clock read's result: the injected seam's value or the typed corrupt-seam refusal. */
type ClockRead = { readonly at: string } | { readonly refusal: ProfilesKitRefusal };

function validateKitOptions(options: ProfilesKitOptions, requirePersistence: boolean, factoryName: 'createProfilesKit' | 'loadProfilesKit'): BoundOptions {
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
        const clock = opts.clock as () => string;
        const firstClock = clock();
        if (typeof firstClock !== 'string' || firstClock.length === 0) {
                throw new TypeError(`${factoryName}: options.clock() must return a non-empty ISO string (the injected-clock law)`);
        }
        const rng = opts.rng as () => string;
        const firstHex = rng();
        if (!/^[0-9a-f]{16}$/.test(firstHex)) {
                throw new TypeError(
                        `${factoryName}: options.rng() must return exactly 16 lowercase hex chars (the id-minting seam - the kit mints ${PROFILES_ID_PREFIX}<16-hex>)`,
                );
        }
        const hasPort = opts.fsPort !== undefined;
        const hasRoot = opts.root !== undefined;
        if (requirePersistence && (!hasPort || !hasRoot)) {
                throw new TypeError(`${factoryName}: options.fsPort and options.root are both required (the load is a persistence-surface operation)`);
        }
        if (hasPort !== hasRoot) {
                throw new TypeError(`${factoryName}: options.fsPort and options.root come together or not at all (the persistence seam is a pair)`);
        }
        let fsPort: HarnessFsPort | null = null;
        let root: string | null = null;
        if (hasPort && hasRoot) {
                const port = opts.fsPort;
                if (!isRecord(port)) {
                        throw new TypeError(`${factoryName}: options.fsPort must be an object (the ONLY filesystem seam)`);
                }
                for (const name of ['readFile', 'writeFile', 'appendFile', 'mkdir'] as const) {
                        if (typeof (port as Record<string, unknown>)[name] !== 'function') {
                                throw new TypeError(`${factoryName}: options.fsPort.${name} must be a function (the ONLY filesystem seam)`);
                        }
                }
                fsPort = port as unknown as HarnessFsPort;
                if (typeof opts.root !== 'string' || opts.root.length === 0) {
                        throw new TypeError(`${factoryName}: options.root must be a non-empty string (the persistence root)`);
                }
                root = (opts.root as string).replace(/\/+$/, '');
        }
        return { clock, rng, fsPort, root };
}

function refused(
        reason: ProfilesKitRefusalReason,
        law: string,
        detail: string,
        items?: readonly string[],
): ProfilesKitRefusal {
        if (items === undefined) {
                return { reason, law, detail };
        }
        return { reason, law, detail, items };
}

/**
 * Surfaces a payload walk's typed refusal: the reason / law / items
 * mirror the FIRST rejection (the frozen walk order's head) and the
 * COMPLETE rejection table is carried in rejections (never
 * first-only - THE FAIL-CLOSED LAW's complete-table discipline).
 */
function payloadRefused(
        opName: string,
        outcome: { readonly ok: false; readonly mode: 'shape'; readonly rejections: readonly ProfilesRejection[] },
): ProfilesKitRefusal {
        const first = outcome.rejections[0];
        return {
                reason: first.reason,
                law: first.law,
                detail: `${opName}: the payload walk refused - the COMPLETE rejection table follows in the frozen walk order (the first station: ${first.detail})`,
                items: first.items,
                rejections: outcome.rejections,
        };
}

function buildProfilesKit(bound: BoundOptions, seed: ProfilesKitState): ProfilesKit {
        let disposed = false;
        let mutableSeq = seed.seq;
        const records = new Map<string, ProfilesRecord>(seed.records);
        const persisted = bound.fsPort !== null && bound.root !== null;
        const fsPort = bound.fsPort;
        const ledgerPath = bound.root !== null ? `${bound.root}/${PROFILES_LEDGER_RELATIVE_PATH}` : '';
        const envelopePath = bound.root !== null ? `${bound.root}/${PROFILES_ENVELOPE_RELATIVE_PATH}` : '';
        let dirEnsured = false;
        // A kit reloaded from a persisted ledger NEVER re-fires the fresh-kit guard
        // (its ledger preexists; only a fresh createProfilesKit guards the append).
        let ledgerGuardDone = seed.seq > 0;

        function readClock(): ClockRead {
                const at = bound.clock();
                if (typeof at !== 'string' || at.length === 0) {
                        return {
                                refusal: refused(
                                        'CORRUPT_SEAM',
                                        'THE DETERMINISM LAW',
                                        'the injected clock returned an empty value mid-op (the timestamps are carried verbatim from the injected seam)',
                                ),
                        };
                }
                return { at };
        }

        function copyRecord(record: ProfilesRecord): ProfilesRecord {
                return JSON.parse(serializeProfilesRecord(record)) as ProfilesRecord;
        }

        /**
         * THE APPEND-ONLY LEDGER LAW's persistence fold: the append lands
         * first (the ledger is authoritative - the seq advances with the
         * line), the envelope rewrite lands second, the in-memory records
         * commit last (in the caller). An append refusal leaves NOTHING
         * applied; an envelope refusal leaves the op applied and the line
         * landed (the refusal discloses it; a reload fails closed with
         * E_ENVELOPE_MISMATCH until the next op rewrites the envelope).
         */
        async function persist(line: ProfilesOpsLedgerLine, nextRecords: Map<string, ProfilesRecord>): Promise<PersistResult> {
                if (!persisted || fsPort === null) {
                        mutableSeq = line.seq;
                        return { applied: true, refusal: null };
                }
                if (!ledgerGuardDone) {
                        let existing: string | null;
                        try {
                                existing = await readText(fsPort, ledgerPath);
                        } catch (error) {
                                return { applied: false, refusal: refused('PROFILES_IO', 'THE FAIL-CLOSED LAW', `persist: the fs port refused the profiles ledger read: ${toMessage(error)}`) };
                        }
                        if (existing !== null && existing.trim().length > 0) {
                                return {
                                        applied: false,
                                        refusal: refused(
                                                'E_LEDGER_TORN',
                                                'THE APPEND-ONLY LEDGER LAW',
                                                'persist: the profiles ledger already carries lines - reopen with loadProfilesKit (a fresh kit never appends over an existing ledger)',
                                        ),
                                };
                        }
                        ledgerGuardDone = true;
                }
                if (!dirEnsured) {
                        try {
                                await fsPort.mkdir(`${bound.root}/.flauz/harness`, { recursive: true });
                        } catch (error) {
                                return { applied: false, refusal: refused('PROFILES_IO', 'THE FAIL-CLOSED LAW', `persist: the fs port refused the root mkdir: ${toMessage(error)}`) };
                        }
                        dirEnsured = true;
                }
                try {
                        await fsPort.appendFile(ledgerPath, `${ledgerLineBytes(line)}\n`);
                } catch (error) {
                        return { applied: false, refusal: refused('PROFILES_IO', 'THE FAIL-CLOSED LAW', `persist: the fs port refused the profiles ledger append: ${toMessage(error)} (nothing was applied)`) };
                }
                mutableSeq = line.seq;
                try {
                        await fsPort.writeFile(envelopePath, envelopeBytes(line.seq, nextRecords));
                } catch (error) {
                        return {
                                applied: true,
                                refusal: refused(
                                        'PROFILES_IO',
                                        'THE FAIL-CLOSED LAW',
                                        `persist: the profiles ledger line landed at seq ${line.seq} but the fs port refused the envelope rewrite: ${toMessage(error)} (the op applied and the ledger is authoritative; a reload fails closed with E_ENVELOPE_MISMATCH until the envelope is rewritten)`,
                                ),
                        };
                }
                return { applied: true, refusal: null };
        }

        function commit(nextRecords: Map<string, ProfilesRecord>): void {
                records.clear();
                for (const [id, record] of nextRecords) {
                        records.set(id, record);
                }
        }

        function recordOutcome(record: ProfilesRecord): ProfilesRecordOutcome {
                return { ok: true, record: copyRecord(record) };
        }

        /** The disposed guard (THE DISPOSE LAW - the op-entry first station). */
        function refuseIfDisposed(opName: string): ProfilesKitRefusal | null {
                if (disposed) {
                        return refused('DISPOSED', 'THE DISPOSE LAW', `${opName}: the kit was disposed - every operation after dispose rejects`);
                }
                return null;
        }

        /** The unknown-record guard (a malformed id fails closed as unknown - the DH-01 NOT_FOUND discipline, this family's reason). */
        function lookupRecord(opName: string, profilesId: unknown): { record: ProfilesRecord } | { refusal: ProfilesKitRefusal } {
                if (!isProfilesId(profilesId)) {
                        return { refusal: refused('unknown-record', 'THE FAIL-CLOSED LAW', `${opName}: no record with id '${showValue(profilesId)}' (a malformed id fails closed as unknown-record)`) };
                }
                const record = records.get(profilesId);
                if (record === undefined) {
                        return { refusal: refused('unknown-record', 'THE FAIL-CLOSED LAW', `${opName}: no record with id '${profilesId}'`) };
                }
                return { record };
        }

        /**
         * THE FORWARD-ONLY LAW's stage guard: the mutating ops require the
         * 'composing' stage (a composed record is past them - stale-stage,
         * 'composed' is TERMINAL, THE APPEND-ONLY LINEAGE LAW).
         */
        function stageGuard(opName: string, record: ProfilesRecord): ProfilesKitRefusal | null {
                if (record.stage === 'composing') {
                        return null;
                }
                return refused(
                        'stale-stage',
                        'THE FORWARD-ONLY LAW',
                        `${opName}: the record is at the '${record.stage}' stage - the record is FROZEN ('composed' is TERMINAL; a changed profile is a NEW profile, THE APPEND-ONLY LINEAGE LAW) (THE FORWARD-ONLY LAW)`,
                        [record.stage],
                );
        }

        /** The profile lookup for replace / remove (a malformed profileKey fails closed as unknown-profile). */
        function findProfile(record: ProfilesRecord, profileKey: unknown): ProfileEntry | null {
                if (typeof profileKey !== 'string') {
                        return null;
                }
                const found = record.profiles.find((entry) => entry.profileKey === profileKey);
                return found === undefined ? null : found;
        }

        return {
                async beginProfiles(harnessId: unknown): Promise<ProfilesRecordOutcome> {
                        const disposedRefusal = refuseIfDisposed('beginProfiles');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        // THE IMPORT LAW: the REAL DH-01 harness-id alphabet (the FORM law; the
                        // EXISTENCE binding is the caller's wiring - pinned in the battery through
                        // the real DH-01 kit, never resolved here).
                        if (!isHarnessId(harnessId)) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'bad-harness-id',
                                                'THE FAIL-CLOSED LAW',
                                                `beginProfiles: the harnessId must satisfy the REAL DH-01 harness-id alphabet (flauz:hrn:<16-hex>, imported by reference - the FORM law; the EXISTENCE binding is the caller's wiring, never this layer's)`,
                                                [showValue(harnessId)],
                                        ),
                                };
                        }
                        const hex = bound.rng();
                        if (!/^[0-9a-f]{16}$/.test(hex)) {
                                return { ok: false, refusal: refused('CORRUPT_SEAM', 'THE DETERMINISM LAW', 'beginProfiles: the injected rng returned a non-16-hex value (the id-minting seam is corrupt)') };
                        }
                        const profilesId = `${PROFILES_ID_PREFIX}${hex}`;
                        if (records.has(profilesId)) {
                                return { ok: false, refusal: refused('CORRUPT_SEAM', 'THE DETERMINISM LAW', 'beginProfiles: the injected rng minted a duplicate record id (the id-minting seam is corrupt)') };
                        }
                        const clockRead = readClock();
                        if ('refusal' in clockRead) {
                                return { ok: false, refusal: clockRead.refusal };
                        }
                        const at = clockRead.at;
                        const detail = `began the profiles record bound to harness '${harnessId}' (the walk enters the composing stage with ZERO profiles; the caller composes the profiles - this family never invents them, THE CONTENT LAW)`;
                        const record: ProfilesRecord = {
                                profilesId,
                                harnessId,
                                stage: 'composing',
                                profiles: [],
                                history: [
                                        { at, fromStage: null, toStage: 'composing', op: 'begin-profiles', law: 'THE FORWARD-ONLY LAW', detail },
                                ],
                        };
                        const line: ProfilesOpsLedgerLine = {
                                seq: mutableSeq + 1,
                                at,
                                contractVersion: PROFILES_CONTRACTS_VERSION,
                                op: 'begin-profiles',
                                profilesId,
                                harnessId,
                                fromStage: null,
                                toStage: 'composing',
                                law: 'THE FORWARD-ONLY LAW',
                                payload: null,
                                detail,
                        };
                        const nextRecords = new Map(records);
                        nextRecords.set(profilesId, record);
                        const persistResult = await persist(line, nextRecords);
                        if (!persistResult.applied) {
                                return { ok: false, refusal: persistResult.refusal };
                        }
                        commit(nextRecords);
                        if (persistResult.refusal !== null) {
                                return { ok: false, refusal: persistResult.refusal };
                        }
                        return recordOutcome(record);
                },
                async addProfile(profilesId: unknown, profile: unknown): Promise<ProfilesRecordOutcome> {
                        const disposedRefusal = refuseIfDisposed('addProfile');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        const lookup = lookupRecord('addProfile', profilesId);
                        if ('refusal' in lookup) {
                                return { ok: false, refusal: lookup.refusal };
                        }
                        const record = lookup.record;
                        const stageRefusal = stageGuard('addProfile', record);
                        if (stageRefusal !== null) {
                                return { ok: false, refusal: stageRefusal };
                        }
                        // THE AUTHORITY-BINDING LAW: the payload walk proves every vocabulary
                        // against the REAL imported tables (the catalog predicate, the risk
                        // tiers, the evidence ladder, the eval dimensions) - complete table.
                        const verdict = validateProfileEntry(profile);
                        if (!verdict.ok) {
                                return { ok: false, refusal: payloadRefused('addProfile', verdict) };
                        }
                        const entry = verdict.value;
                        if (record.profiles.some((existing) => existing.profileKey === entry.profileKey)) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'duplicate-profile-key',
                                                'THE FAIL-CLOSED LAW',
                                                `addProfile: the profileKey '${entry.profileKey}' is already composed (a profile appears once)`,
                                                [entry.profileKey],
                                        ),
                                };
                        }
                        if (record.profiles.length >= MAX_PROFILES) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'max-profiles',
                                                'THE FAIL-CLOSED LAW',
                                                `addProfile: the record already carries ${record.profiles.length} profiles - the composition bound is MAX_PROFILES (${MAX_PROFILES})`,
                                                [`${record.profiles.length} profiles`],
                                        ),
                                };
                        }
                        const clockRead = readClock();
                        if ('refusal' in clockRead) {
                                return { ok: false, refusal: clockRead.refusal };
                        }
                        const at = clockRead.at;
                        const detail = `added the profile '${entry.profileKey}' (a profile is CONFIGURATION over the REAL authority vocabularies - it grants NOTHING by itself; its permissionRefs, approvalTiers, evidenceFloor and kpiDimensions are proven against the imported catalog and lab vocabularies)`;
                        const next: ProfilesRecord = {
                                profilesId: record.profilesId,
                                harnessId: record.harnessId,
                                stage: 'composing',
                                profiles: [...record.profiles, entry],
                                history: [...record.history, { at, fromStage: 'composing', toStage: 'composing', op: 'add-profile', law: 'THE NO-FORK LAW', detail }],
                        };
                        const line: ProfilesOpsLedgerLine = {
                                seq: mutableSeq + 1,
                                at,
                                contractVersion: PROFILES_CONTRACTS_VERSION,
                                op: 'add-profile',
                                profilesId: record.profilesId,
                                harnessId: record.harnessId,
                                fromStage: 'composing',
                                toStage: 'composing',
                                law: 'THE NO-FORK LAW',
                                payload: entry,
                                detail,
                        };
                        const nextRecords = new Map(records);
                        nextRecords.set(record.profilesId, next);
                        const persistResult = await persist(line, nextRecords);
                        if (!persistResult.applied) {
                                return { ok: false, refusal: persistResult.refusal };
                        }
                        commit(nextRecords);
                        if (persistResult.refusal !== null) {
                                return { ok: false, refusal: persistResult.refusal };
                        }
                        return recordOutcome(next);
                },
                async replaceProfileSummary(profilesId: unknown, profileKey: unknown, summary: unknown): Promise<ProfilesRecordOutcome> {
                        const disposedRefusal = refuseIfDisposed('replaceProfileSummary');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        const lookup = lookupRecord('replaceProfileSummary', profilesId);
                        if ('refusal' in lookup) {
                                return { ok: false, refusal: lookup.refusal };
                        }
                        const record = lookup.record;
                        const stageRefusal = stageGuard('replaceProfileSummary', record);
                        if (stageRefusal !== null) {
                                return { ok: false, refusal: stageRefusal };
                        }
                        const existing = findProfile(record, profileKey);
                        if (existing === null) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'unknown-profile',
                                                'THE FAIL-CLOSED LAW',
                                                `replaceProfileSummary: no profile '${showValue(profileKey)}' in the record (a malformed profileKey fails closed as unknown-profile)`,
                                        ),
                                };
                        }
                        const verdict = validateProfileSummary(summary);
                        if (!verdict.ok) {
                                return { ok: false, refusal: payloadRefused('replaceProfileSummary', verdict) };
                        }
                        const replacement: ProfileEntry = {
                                profileKey: existing.profileKey,
                                summary: verdict.value,
                                permissionRefs: [...existing.permissionRefs],
                                approvalTiers: [...existing.approvalTiers],
                                evidenceFloor: existing.evidenceFloor,
                                kpiDimensions: [...existing.kpiDimensions],
                        };
                        const clockRead = readClock();
                        if ('refusal' in clockRead) {
                                return { ok: false, refusal: clockRead.refusal };
                        }
                        const at = clockRead.at;
                        const detail = `replaced the summary of the profile '${existing.profileKey}' (a profile's key is its identity - immutable once added; only the summary is replaceable, THE REMOVE+RE-ADD LAW)`;
                        const next: ProfilesRecord = {
                                profilesId: record.profilesId,
                                harnessId: record.harnessId,
                                stage: 'composing',
                                profiles: record.profiles.map((entry) => (entry.profileKey === replacement.profileKey ? replacement : entry)),
                                history: [...record.history, { at, fromStage: 'composing', toStage: 'composing', op: 'replace-profile-summary', law: 'THE REMOVE+RE-ADD LAW', detail }],
                        };
                        const line: ProfilesOpsLedgerLine = {
                                seq: mutableSeq + 1,
                                at,
                                contractVersion: PROFILES_CONTRACTS_VERSION,
                                op: 'replace-profile-summary',
                                profilesId: record.profilesId,
                                harnessId: record.harnessId,
                                fromStage: 'composing',
                                toStage: 'composing',
                                law: 'THE REMOVE+RE-ADD LAW',
                                payload: replacement,
                                detail,
                        };
                        const nextRecords = new Map(records);
                        nextRecords.set(record.profilesId, next);
                        const persistResult = await persist(line, nextRecords);
                        if (!persistResult.applied) {
                                return { ok: false, refusal: persistResult.refusal };
                        }
                        commit(nextRecords);
                        if (persistResult.refusal !== null) {
                                return { ok: false, refusal: persistResult.refusal };
                        }
                        return recordOutcome(next);
                },
                async removeProfile(profilesId: unknown, profileKey: unknown): Promise<ProfilesRecordOutcome> {
                        const disposedRefusal = refuseIfDisposed('removeProfile');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        const lookup = lookupRecord('removeProfile', profilesId);
                        if ('refusal' in lookup) {
                                return { ok: false, refusal: lookup.refusal };
                        }
                        const record = lookup.record;
                        const stageRefusal = stageGuard('removeProfile', record);
                        if (stageRefusal !== null) {
                                return { ok: false, refusal: stageRefusal };
                        }
                        const existing = findProfile(record, profileKey);
                        if (existing === null) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'unknown-profile',
                                                'THE FAIL-CLOSED LAW',
                                                `removeProfile: no profile '${showValue(profileKey)}' in the record (a malformed profileKey fails closed as unknown-profile)`,
                                        ),
                                };
                        }
                        const clockRead = readClock();
                        if ('refusal' in clockRead) {
                                return { ok: false, refusal: clockRead.refusal };
                        }
                        const at = clockRead.at;
                        const detail = `removed the profile '${existing.profileKey}' (THE REMOVE+RE-ADD LAW: a changed profileKey is a NEW profile; removing the last profile is legal while composing - the empty-profiles floor fires only at finalize)`;
                        const next: ProfilesRecord = {
                                profilesId: record.profilesId,
                                harnessId: record.harnessId,
                                stage: 'composing',
                                profiles: record.profiles.filter((entry) => entry.profileKey !== existing.profileKey),
                                history: [...record.history, { at, fromStage: 'composing', toStage: 'composing', op: 'remove-profile', law: 'THE REMOVE+RE-ADD LAW', detail }],
                        };
                        const line: ProfilesOpsLedgerLine = {
                                seq: mutableSeq + 1,
                                at,
                                contractVersion: PROFILES_CONTRACTS_VERSION,
                                op: 'remove-profile',
                                profilesId: record.profilesId,
                                harnessId: record.harnessId,
                                fromStage: 'composing',
                                toStage: 'composing',
                                law: 'THE REMOVE+RE-ADD LAW',
                                payload: existing,
                                detail,
                        };
                        const nextRecords = new Map(records);
                        nextRecords.set(record.profilesId, next);
                        const persistResult = await persist(line, nextRecords);
                        if (!persistResult.applied) {
                                return { ok: false, refusal: persistResult.refusal };
                        }
                        commit(nextRecords);
                        if (persistResult.refusal !== null) {
                                return { ok: false, refusal: persistResult.refusal };
                        }
                        return recordOutcome(next);
                },
                async finalizeProfiles(profilesId: unknown): Promise<ProfilesRecordOutcome> {
                        const disposedRefusal = refuseIfDisposed('finalizeProfiles');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        const lookup = lookupRecord('finalizeProfiles', profilesId);
                        if ('refusal' in lookup) {
                                return { ok: false, refusal: lookup.refusal };
                        }
                        const record = lookup.record;
                        const stageRefusal = stageGuard('finalizeProfiles', record);
                        if (stageRefusal !== null) {
                                return { ok: false, refusal: stageRefusal };
                        }
                        // THE PROFILE LAWS' floor: at least one profile at finalize (never the record shape).
                        if (record.profiles.length === 0) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'empty-profiles',
                                                'THE FAIL-CLOSED LAW',
                                                'finalizeProfiles: the profiles must compose at least one profile (the empty-profiles floor - compose profiles with addProfile first; the floor fires HERE, never the record shape)',
                                                ['profiles'],
                                        ),
                                };
                        }
                        // THE AUTHORITY-BINDING BOUNDARY: the complete-table record walk
                        // re-proves every vocabulary against the REAL imported tables (the
                        // catalog permission predicate, the catalog risk tiers, the lab
                        // evidence ladder, the lab eval dimensions) - the typed refusals
                        // name each offending item once, in first-seen order.
                        const boundaryWalk = validateProfilesRecord(record);
                        if (!boundaryWalk.ok) {
                                return { ok: false, refusal: payloadRefused('finalizeProfiles', boundaryWalk) };
                        }
                        const clockRead = readClock();
                        if ('refusal' in clockRead) {
                                return { ok: false, refusal: clockRead.refusal };
                        }
                        const at = clockRead.at;
                        const detail = `finalized the profiles (${record.profiles.length} profile(s); composing -> composed, TERMINAL - the record is FROZEN, a changed profile is a NEW profile; every vocabulary re-proven against the REAL imported catalog and lab tables at the boundary)`;
                        const next: ProfilesRecord = {
                                profilesId: record.profilesId,
                                harnessId: record.harnessId,
                                stage: 'composed',
                                profiles: record.profiles.map((profile) => ({
                                        profileKey: profile.profileKey,
                                        summary: profile.summary,
                                        permissionRefs: [...profile.permissionRefs],
                                        approvalTiers: [...profile.approvalTiers],
                                        evidenceFloor: profile.evidenceFloor,
                                        kpiDimensions: [...profile.kpiDimensions],
                                })),
                                history: [...record.history, { at, fromStage: 'composing', toStage: 'composed', op: 'finalize-profiles', law: 'THE AUTHORITY-BINDING LAW', detail }],
                        };
                        const line: ProfilesOpsLedgerLine = {
                                seq: mutableSeq + 1,
                                at,
                                contractVersion: PROFILES_CONTRACTS_VERSION,
                                op: 'finalize-profiles',
                                profilesId: record.profilesId,
                                harnessId: record.harnessId,
                                fromStage: 'composing',
                                toStage: 'composed',
                                law: 'THE AUTHORITY-BINDING LAW',
                                payload: null,
                                detail,
                        };
                        const nextRecords = new Map(records);
                        nextRecords.set(record.profilesId, next);
                        const persistResult = await persist(line, nextRecords);
                        if (!persistResult.applied) {
                                return { ok: false, refusal: persistResult.refusal };
                        }
                        commit(nextRecords);
                        if (persistResult.refusal !== null) {
                                return { ok: false, refusal: persistResult.refusal };
                        }
                        return recordOutcome(next);
                },
                async emitPolicyRef(profilesId: unknown): Promise<ProfilesPolicyRefOutcome> {
                        const disposedRefusal = refuseIfDisposed('emitPolicyRef');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        const lookup = lookupRecord('emitPolicyRef', profilesId);
                        if ('refusal' in lookup) {
                                return { ok: false, refusal: lookup.refusal };
                        }
                        const record = lookup.record;
                        if (record.stage !== 'composed') {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'premature-op',
                                                'THE FORWARD-ONLY LAW',
                                                `emitPolicyRef: the record is at the '${record.stage}' stage - a policyRef is emitted ONLY from a COMPOSED record (finalizeProfiles first)`,
                                                [record.stage],
                                        ),
                                };
                        }
                        // The emitted ref IS the composed record's id (the review composition's
                        // policyRefs family member form: a string, duplicate-free by identity).
                        // A pure read: no state change, no ledger line - the ref is deterministic.
                        return { ok: true, policyRef: record.profilesId };
                },
                async emitEvidenceRef(profilesId: unknown): Promise<ProfilesEvidenceRefOutcome> {
                        const disposedRefusal = refuseIfDisposed('emitEvidenceRef');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        const lookup = lookupRecord('emitEvidenceRef', profilesId);
                        if ('refusal' in lookup) {
                                return { ok: false, refusal: lookup.refusal };
                        }
                        const record = lookup.record;
                        if (record.stage !== 'composed') {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'premature-op',
                                                'THE FORWARD-ONLY LAW',
                                                `emitEvidenceRef: the record is at the '${record.stage}' stage - an evidenceRef is emitted ONLY from a COMPOSED record (finalizeProfiles first)`,
                                                [record.stage],
                                        ),
                                };
                        }
                        // The emitted ref IS the composed record's id (the review composition's
                        // evidenceRefs family member form: a string, duplicate-free by identity).
                        // A pure read: no state change, no ledger line - the ref is deterministic.
                        return { ok: true, evidenceRef: record.profilesId };
                },
                async inspectProfiles(profilesId: unknown): Promise<ProfilesRecordOutcome> {
                        const disposedRefusal = refuseIfDisposed('inspectProfiles');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        const lookup = lookupRecord('inspectProfiles', profilesId);
                        if ('refusal' in lookup) {
                                return { ok: false, refusal: lookup.refusal };
                        }
                        return recordOutcome(lookup.record);
                },
                async listProfilesSessions(filter?: unknown): Promise<ProfilesListOutcome> {
                        const disposedRefusal = refuseIfDisposed('listProfilesSessions');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        if (filter !== undefined) {
                                if (!isRecord(filter)) {
                                        return { ok: false, refusal: refused('UNKNOWN_FILTER', 'THE FAIL-CLOSED LAW', 'listProfilesSessions: the filter must be an object (or absent)') };
                                }
                                const filterRecord = filter as Record<string, unknown>;
                                const unknownFields = Object.keys(filterRecord).filter((key) => key !== 'stage' && key !== 'harnessId');
                                if (unknownFields.length > 0) {
                                        return {
                                                ok: false,
                                                refusal: refused('UNKNOWN_FILTER', 'THE FAIL-CLOSED LAW', 'listProfilesSessions: the filter carries an unknown field (stage / harnessId only)', unknownFields),
                                        };
                                }
                                if (filterRecord.stage !== undefined && !isProfilesStage(filterRecord.stage)) {
                                        return { ok: false, refusal: refused('UNKNOWN_FILTER', 'THE FAIL-CLOSED LAW', 'listProfilesSessions: the stage filter value is not a member of the frozen PROFILES_STAGES list') };
                                }
                                if (filterRecord.harnessId !== undefined && !isHarnessId(filterRecord.harnessId)) {
                                        return { ok: false, refusal: refused('UNKNOWN_FILTER', 'THE FAIL-CLOSED LAW', 'listProfilesSessions: the harnessId filter value does not satisfy the REAL DH-01 harness-id alphabet (imported by reference)') };
                                }
                        }
                        const ids = [...records.keys()].sort();
                        const listed: ProfilesRecord[] = [];
                        for (const id of ids) {
                                const entry = records.get(id) as ProfilesRecord;
                                if (filter !== undefined && !matchesRecordFilter(entry, filter as Record<string, unknown>)) {
                                        continue;
                                }
                                listed.push(copyRecord(entry));
                        }
                        return { ok: true, records: listed };
                },
                disposeProfiles(): void {
                        disposed = true;
                },
        };
}

// --- ledger replay + envelope cross-check (the load surface) ---

interface ProfilesLedgerReplay {
        readonly lines: readonly ProfilesOpsLedgerLine[];
        readonly records: Map<string, ProfilesRecord>;
}

/** Parses and validates the whole profiles ledger text; returns the typed refusal or the replay (never a silent skip). */
function replayProfilesLedger(ledgerText: string | null): ProfilesLedgerReplay | ProfilesKitRefusal {
        if (ledgerText === null || ledgerText.length === 0) {
                return { lines: [], records: new Map<string, ProfilesRecord>() };
        }
        if (!ledgerText.endsWith('\n')) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', 'loadProfilesKit: the profiles ledger does not end with a complete line (a torn append - never a silent skip)');
        }
        const records = new Map<string, ProfilesRecord>();
        const lines: ProfilesOpsLedgerLine[] = [];
        const rawLines = ledgerText.split('\n');
        rawLines.pop();
        for (let i = 0; i < rawLines.length; i += 1) {
                if (rawLines[i].length === 0) {
                        return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadProfilesKit: profiles ledger line ${i + 1} is empty`);
                }
                let parsed: unknown;
                try {
                        parsed = JSON.parse(rawLines[i]);
                } catch {
                        return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadProfilesKit: profiles ledger line ${i + 1} is not valid JSON (a torn write - never a silent skip)`);
                }
                const torn = validateProfilesLedgerLine(parsed, i + 1, records);
                if (torn !== null) {
                        return torn;
                }
                const record = parsed as Record<string, unknown>;
                const line: ProfilesOpsLedgerLine = {
                        seq: record.seq as number,
                        at: record.at as string,
                        contractVersion: record.contractVersion as string,
                        op: record.op as ProfilesOpName,
                        profilesId: record.profilesId as string,
                        harnessId: record.harnessId as string,
                        fromStage: record.fromStage as ProfilesStage | null,
                        toStage: record.toStage as ProfilesStage,
                        law: record.law as string,
                        payload: record.payload as ProfileEntry | null,
                        detail: record.detail as string,
                };
                applyProfilesLine(records, line);
                lines.push(line);
        }
        return { lines, records };
}

/** Validates one parsed profiles ledger line; returns the typed refusal or null (the line is structurally valid and legal). */
function validateProfilesLedgerLine(parsed: unknown, lineNo: number, records: Map<string, ProfilesRecord>): ProfilesKitRefusal | null {
        if (!isRecord(parsed)) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadProfilesKit: profiles ledger line ${lineNo} is not a JSON object`);
        }
        const record = parsed as Record<string, unknown>;
        const keys = Object.keys(record).sort();
        const expected = [...PROFILES_LEDGER_LINE_SCHEMA_KEYS].sort();
        if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadProfilesKit: profiles ledger line ${lineNo} is structurally invalid (the frozen eleven-key line schema)`);
        }
        if (typeof record.seq !== 'number' || !Number.isInteger(record.seq) || record.seq !== lineNo) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadProfilesKit: profiles ledger line ${lineNo} carries sequence ${showValue(record.seq)}; ledger lines are missing or out of order`);
        }
        if (typeof record.at !== 'string' || record.at.length === 0) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadProfilesKit: profiles ledger line ${lineNo} has no timestamp (the injected clock's reading, carried verbatim)`);
        }
        if (record.contractVersion !== PROFILES_CONTRACTS_VERSION) {
                return refused('version-mismatch', 'THE SINGLE-VERSION LAW', `loadProfilesKit: profiles ledger line ${lineNo} carries contract version ${showValue(record.contractVersion)} - only '${PROFILES_CONTRACTS_VERSION}' is known (the single-version law; the five-key record carries no version field, so THIS is the law's live station)`);
        }
        if (!isProfilesOpName(record.op)) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadProfilesKit: profiles ledger line ${lineNo} carries an unknown op ${showValue(record.op)}`);
        }
        if (!isProfilesId(record.profilesId)) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadProfilesKit: profiles ledger line ${lineNo} carries a malformed record id`);
        }
        if (!isHarnessId(record.harnessId)) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadProfilesKit: profiles ledger line ${lineNo} carries a malformed harness id (the REAL DH-01 flauz:hrn:<16-hex> alphabet, imported by reference)`);
        }
        if (record.fromStage !== null && !isProfilesStage(record.fromStage)) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadProfilesKit: profiles ledger line ${lineNo} carries an unknown fromStage`);
        }
        if (!isProfilesStage(record.toStage)) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadProfilesKit: profiles ledger line ${lineNo} carries an unknown toStage`);
        }
        if (typeof record.law !== 'string' || record.law.length === 0) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadProfilesKit: profiles ledger line ${lineNo} carries no law name (the provenance law)`);
        }
        if (typeof record.detail !== 'string' || record.detail.length === 0) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadProfilesKit: profiles ledger line ${lineNo} carries no provenance detail`);
        }
        const op = record.op as ProfilesOpName;
        const profilesRecord = records.get(record.profilesId as string);
        if (op === 'begin-profiles') {
                if (record.fromStage !== null || record.toStage !== 'composing') {
                        return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadProfilesKit: profiles ledger line ${lineNo} is a begin line that does not land 'composing' (every record enters the walk at composing)`);
                }
                if (record.payload !== null) {
                        return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadProfilesKit: profiles ledger line ${lineNo} is a begin line carrying a non-null payload (this family injects no authority - the vocabularies are the imported real modules)`);
                }
                if (profilesRecord !== undefined) {
                        return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadProfilesKit: profiles ledger line ${lineNo} begins a duplicate record id`);
                }
                return null;
        }
        if (profilesRecord === undefined) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadProfilesKit: profiles ledger line ${lineNo} advances an unknown record`);
        }
        if (profilesRecord.stage !== 'composing') {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadProfilesKit: profiles ledger line ${lineNo} is out of order (the record is not at the composing stage; 'composed' is TERMINAL)`);
        }
        if (op === 'finalize-profiles') {
                if (record.fromStage !== 'composing' || record.toStage !== 'composed') {
                        return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadProfilesKit: profiles ledger line ${lineNo} is a finalize line outside the composing->composed edge`);
                }
                if (record.payload !== null) {
                        return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadProfilesKit: profiles ledger line ${lineNo} is a finalize line carrying a non-null payload (the boundary authority is the imported real modules, never an injected record)`);
                }
                // THE AUTHORITY-BINDING LAW re-proved from the ledger alone: the empty
                // floor AND the complete-table record walk (every vocabulary re-proven
                // against the REAL imported tables at the boundary).
                if (profilesRecord.profiles.length === 0) {
                        return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadProfilesKit: profiles ledger line ${lineNo} finalizes an empty record (the empty-profiles floor - the replay re-validates the boundary law)`);
                }
                const boundaryWalk = validateProfilesRecord({ ...profilesRecord, stage: 'composed' });
                if (!boundaryWalk.ok) {
                        return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadProfilesKit: profiles ledger line ${lineNo} finalizes a record that fails the complete-table boundary walk (${boundaryWalk.rejections[0].reason}) - THE AUTHORITY-BINDING LAW re-proved from the ledger alone`);
                }
                return null;
        }
        if (record.fromStage !== 'composing' || record.toStage !== 'composing') {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadProfilesKit: profiles ledger line ${lineNo} is a profile-op line outside the composing->composing self edge (the domain composes its default profiles gradually)`);
        }
        // THE AUTHORITY-BINDING LAW re-proved from the ledger alone: the profile-op
        // payload passes the full vocabulary walk (the REAL catalog predicate, the
        // REAL risk tiers, the REAL ladder, the REAL eval dimensions).
        const entry = validateProfileEntry(record.payload);
        if (!entry.ok) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadProfilesKit: profiles ledger line ${lineNo} carries an invalid profile payload (${entry.rejections[0].reason}) - THE AUTHORITY-BINDING LAW re-proved from the ledger alone`);
        }
        const payloadProfile = entry.value;
        if (op === 'add-profile') {
                if (profilesRecord.profiles.some((profile) => profile.profileKey === payloadProfile.profileKey)) {
                        return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadProfilesKit: profiles ledger line ${lineNo} adds a duplicate profileKey '${payloadProfile.profileKey}'`);
                }
                if (profilesRecord.profiles.length >= MAX_PROFILES) {
                        return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadProfilesKit: profiles ledger line ${lineNo} exceeds the MAX_PROFILES (${MAX_PROFILES}) composition bound`);
                }
                return null;
        }
        const standing = profilesRecord.profiles.find((profile) => profile.profileKey === payloadProfile.profileKey);
        if (standing === undefined) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadProfilesKit: profiles ledger line ${lineNo} advances an unknown profile '${payloadProfile.profileKey}'`);
        }
        if (op === 'replace-profile-summary') {
                // The immutable-parts cross-check: only the summary may differ (a profile's
                // key is its identity; the permissionRefs, approvalTiers, evidenceFloor and
                // kpiDimensions are carried unchanged).
                if (
                        JSON.stringify(payloadProfile.permissionRefs) !== JSON.stringify(standing.permissionRefs) ||
                        JSON.stringify(payloadProfile.approvalTiers) !== JSON.stringify(standing.approvalTiers) ||
                        payloadProfile.evidenceFloor !== standing.evidenceFloor ||
                        JSON.stringify(payloadProfile.kpiDimensions) !== JSON.stringify(standing.kpiDimensions)
                ) {
                        return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadProfilesKit: profiles ledger line ${lineNo} replaces a profile whose permissionRefs / approvalTiers / evidenceFloor / kpiDimensions do not match the record's profile as it stood (THE REMOVE+RE-ADD LAW)`);
                }
                return null;
        }
        // remove-profile: the payload must match the record's entry AS IT STOOD (the authoritative cross-check).
        if (
                payloadProfile.summary !== standing.summary ||
                JSON.stringify(payloadProfile.permissionRefs) !== JSON.stringify(standing.permissionRefs) ||
                JSON.stringify(payloadProfile.approvalTiers) !== JSON.stringify(standing.approvalTiers) ||
                payloadProfile.evidenceFloor !== standing.evidenceFloor ||
                JSON.stringify(payloadProfile.kpiDimensions) !== JSON.stringify(standing.kpiDimensions)
        ) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadProfilesKit: profiles ledger line ${lineNo} removes a profile entry that does not match the record's profiles as it stood`);
        }
        return null;
}

/** Applies one validated profiles ledger line to the replay records (pure fold). */
function applyProfilesLine(records: Map<string, ProfilesRecord>, line: ProfilesOpsLedgerLine): void {
        if (line.op === 'begin-profiles') {
                records.set(line.profilesId, {
                        profilesId: line.profilesId,
                        harnessId: line.harnessId,
                        stage: line.toStage,
                        profiles: [],
                        history: [noteOf(line)],
                });
                return;
        }
        const record = records.get(line.profilesId);
        if (record === undefined) {
                return;
        }
        const base: ProfilesRecord = {
                ...record,
                stage: line.toStage,
                history: [...record.history, noteOf(line)],
        };
        let next: ProfilesRecord;
        if (line.op === 'add-profile') {
                next = { ...base, profiles: [...record.profiles, line.payload as ProfileEntry] };
        } else if (line.op === 'replace-profile-summary') {
                const replacement = line.payload as ProfileEntry;
                next = { ...base, profiles: record.profiles.map((profile) => (profile.profileKey === replacement.profileKey ? replacement : profile)) };
        } else if (line.op === 'remove-profile') {
                const removed = line.payload as ProfileEntry;
                next = { ...base, profiles: record.profiles.filter((profile) => profile.profileKey !== removed.profileKey) };
        } else {
                next = { ...base, profiles: record.profiles.map((profile) => ({ profileKey: profile.profileKey, summary: profile.summary, permissionRefs: [...profile.permissionRefs], approvalTiers: [...profile.approvalTiers], evidenceFloor: profile.evidenceFloor, kpiDimensions: [...profile.kpiDimensions] })) };
        }
        records.set(line.profilesId, next);
}

/** Builds the history note of one ledger line (the provenance fold). */
function noteOf(line: ProfilesOpsLedgerLine): ProfilesTransitionNote {
        return {
                at: line.at,
                fromStage: line.fromStage,
                toStage: line.toStage,
                op: line.op,
                law: line.law,
                detail: line.detail,
        };
}

/** Cross-checks the profiles envelope against the replay; returns the typed refusal or null. */
function crossCheckProfilesEnvelope(
        envelopeText: string | null,
        lineCount: number,
        replayed: Map<string, ProfilesRecord>,
): ProfilesKitRefusal | null {
        if (envelopeText === null) {
                if (lineCount === 0) {
                        return null;
                }
                return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', `loadProfilesKit: the profiles envelope is missing while the ledger carries ${lineCount} line(s) - the divergent envelope is never silently rebuilt`);
        }
        let parsedEnvelope: unknown;
        try {
                parsedEnvelope = JSON.parse(envelopeText);
        } catch {
                return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', 'loadProfilesKit: the profiles envelope is not valid JSON');
        }
        if (!isRecord(parsedEnvelope)) {
                return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', 'loadProfilesKit: the profiles envelope is not a JSON object');
        }
        const envelope = parsedEnvelope as Record<string, unknown>;
        const keys = Object.keys(envelope).sort();
        const expected = [...PROFILES_ENVELOPE_SCHEMA_KEYS].sort();
        if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
                return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', 'loadProfilesKit: the profiles envelope is structurally invalid (the frozen three-key envelope schema)');
        }
        if (envelope.contractVersion !== PROFILES_CONTRACTS_VERSION) {
                return refused('version-mismatch', 'THE SINGLE-VERSION LAW', `loadProfilesKit: the profiles envelope carries contract version ${showValue(envelope.contractVersion)} - only '${PROFILES_CONTRACTS_VERSION}' is known (the single-version law)`);
        }
        if (typeof envelope.seq !== 'number' || !Number.isInteger(envelope.seq) || envelope.seq < 0) {
                return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', 'loadProfilesKit: the profiles envelope carries a malformed seq');
        }
        if (!Array.isArray(envelope.records)) {
                return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', 'loadProfilesKit: the profiles envelope carries a malformed records array');
        }
        const envelopeSeq = envelope.seq as number;
        if (envelopeSeq > lineCount) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadProfilesKit: the profiles envelope claims seq ${envelopeSeq} but the ledger carries ${lineCount} line(s) - missing ledger lines (never a silent skip)`);
        }
        if (envelopeSeq < lineCount) {
                return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', `loadProfilesKit: the profiles envelope claims seq ${envelopeSeq} but the ledger carries ${lineCount} line(s) - the divergent envelope is never silently rebuilt`);
        }
        const envelopeRecordMap = new Map<string, ProfilesRecord>();
        for (let i = 0; i < envelope.records.length; i += 1) {
                const entry = envelope.records[i];
                if (!validateProfilesRecord(entry).ok) {
                        return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', `loadProfilesKit: the profiles envelope's records[${i}] is not a valid profiles record`);
                }
                const profilesRecord = entry as ProfilesRecord;
                envelopeRecordMap.set(profilesRecord.profilesId, profilesRecord);
        }
        const replayBytes = envelopeBytesOf(envelopeSeq, replayed);
        const envelopeBytes = envelopeBytesOf(envelopeSeq, envelopeRecordMap);
        if (replayBytes !== envelopeBytes) {
                return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', 'loadProfilesKit: the profiles envelope diverges from the ledger replay byte-for-byte (never silently rebuilt)');
        }
        return null;
}

// --- internal helpers (never exported) ---

/** Builds the canonical fixed-key-order bytes of one ledger line. */
function ledgerLineBytes(line: ProfilesOpsLedgerLine): string {
        return JSON.stringify({
                seq: line.seq,
                at: line.at,
                contractVersion: line.contractVersion,
                op: line.op,
                profilesId: line.profilesId,
                harnessId: line.harnessId,
                fromStage: line.fromStage,
                toStage: line.toStage,
                law: line.law,
                payload: payloadObject(line.payload),
                detail: line.detail,
        });
}

/**
 * Builds the canonical fixed-key-order object of a ledger-line payload
 * (the profile entry in its six-key canonical order, or null).
 */
function payloadObject(payload: ProfilesOpsLedgerLine['payload']): ProfileEntry | null {
        if (payload === null) {
                return null;
        }
        return {
                profileKey: payload.profileKey,
                summary: payload.summary,
                permissionRefs: [...payload.permissionRefs],
                approvalTiers: [...payload.approvalTiers],
                evidenceFloor: payload.evidenceFloor,
                kpiDimensions: [...payload.kpiDimensions],
        };
}

/** Builds the canonical fixed-key-order bytes of the envelope (records sorted by profilesId). */
function envelopeBytes(seq: number, nextRecords: Map<string, ProfilesRecord>): string {
        const ids = [...nextRecords.keys()].sort();
        const listed = ids.map((id) => nextRecords.get(id) as ProfilesRecord);
        return `{"contractVersion":${JSON.stringify(PROFILES_CONTRACTS_VERSION)},"seq":${seq},"records":[${listed
                .map((record) => serializeProfilesRecord(record))
                .join(',')}]}`;
}

/** The envelope-bytes builder for the load cross-check (byte-for-byte against the persisted envelope). */
function envelopeBytesOf(seq: number, records: Map<string, ProfilesRecord>): string {
        return envelopeBytes(seq, records);
}

/** Reads a text file through the port; a missing file (ENOENT) reads as null. */
async function readText(port: HarnessFsPort, path: string): Promise<string | null> {
        try {
                return await port.readFile(path, 'utf8');
        } catch (error) {
                if (error !== null && typeof error === 'object' && (error as { code?: unknown }).code === 'ENOENT') {
                        return null;
                }
                throw error;
        }
}

/** Pure predicate: a plain object (not null, not an array). */
function isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function matchesRecordFilter(record: ProfilesRecord, filter: Record<string, unknown>): boolean {
        if (filter.stage !== undefined && record.stage !== filter.stage) {
                return false;
        }
        if (filter.harnessId !== undefined && record.harnessId !== filter.harnessId) {
                return false;
        }
        return true;
}
