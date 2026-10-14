/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * DH-007 capability-packs kit: the deterministic staged-record runtime
 * over the packs contract vocabulary AND the REAL DH-01 / DH-06
 * harness surfaces (imported, never re-implemented - THE IMPORT LAW,
 * this wave's charter). The kit walks a record begin -> addPack /
 * replacePackSummary / removePack -> finalizePacks: beginPacks binds
 * the record to a harness through the REAL DH-01 harness-id alphabet
 * (the FORM law - isHarnessId, imported by reference; the EXISTENCE
 * binding is the caller's wiring and the AGREEMENT with the bound
 * harness's own industry is the caller's composition law, both pinned
 * in the battery through the real DH-01 kit) and mints the
 * flauz:pak:<16-hex> id from the injected rng (the capability packs
 * are industry-scoped over the REAL frozen HARNESS_INDUSTRIES list,
 * imported by reference); the pack ops apply the pack laws (shape,
 * bounds, uniqueness, the MAX_PACKS bound); finalizePacks freezes the
 * record (composing -> composed, TERMINAL - the empty-packs floor
 * fires there, never the record shape) AND enforces THE
 * BODY-RESOLUTION LAW: every non-empty bodyRef in the record must
 * resolve against the CALLER-SUPPLIED composed OrganizationDefaults
 * Record's bodies (validated through the REAL DH-06
 * validateOrganizationDefaultsRecord import - a malformed or
 * non-composed bodies record is the typed malformed-bodies refusal,
 * fail closed; a dangling bodyRef is the typed dangling-body-ref
 * refusal naming every offending ref once, in first-seen order; the
 * two-phase law: dangling bodyRefs are LEGAL while composing). THE
 * REMOVE+RE-ADD LAW: a pack's key is its identity - immutable once
 * added; replacePackSummary replaces ONLY the summary; a changed
 * packKey is a NEW pack (remove, then re-add). Removing the last pack
 * is LEGAL while composing (the floor fires only at finalize).
 * emitCapabilityRef emits the COMPOSED record's id as the
 * capabilityRef string (the DH-02 review composition's
 * reference-family member form - the emitted capability reference
 * rides the review composition's capabilityRefs family, the landed
 * schema's capability-side slot for the domain's default capability
 * packs). NO catalog and NO bodies authority is injected: the body
 * resolution happens ONLY against the caller-supplied bodies record
 * at the finalize boundary (THE CONTENT LAW: no per-industry pack
 * content is shipped - the wave is the LAYER, the machinery; the
 * caller composes the packs; this family never invents them).
 *
 * Persistence (the PIN-2 sibling precedent, mirroring the landed
 * DH-01/DH-02/DH-03/DH-04/DH-05/DH-06 laws EXACTLY): the same
 * .flauz/harness subtree, distinct files - the append-only ops ledger
 * .flauz/harness/packs-ops.jsonl (one canonical JSON line per applied
 * op, the seq strictly increasing and equal to the line number) and
 * the envelope .flauz/harness/packs-records.json ({ contractVersion,
 * seq, records }). The ledger is authoritative; the finalize line
 * carries the caller-supplied composed bodies record AS IT STOOD as
 * its payload (the entry-as-it-stood discipline - the replay
 * re-proves THE BODY-RESOLUTION LAW from the ledger alone);
 * loadPacksKit replays it and cross-checks the envelope byte-for-byte
 * (a torn or missing line is the typed E_LEDGER_TORN; a divergent
 * envelope is the typed E_ENVELOPE_MISMATCH - never silently
 * rebuilt). A version-bearing surface (a ledger line or the envelope)
 * carrying another contract version is the typed version-mismatch -
 * THE SINGLE-VERSION LAW's live station in this family (the six-key
 * record carries no version field). Lazy persistence (the subtree
 * lands with the first applied op); a fresh kit never appends over a
 * non-empty packs ledger - reopen with loadPacksKit;
 * restart-deterministic.
 *
 * LAWS (inherited binding from the contract module's header; the
 * contract module carries their enforcement surface): THE IMPORT LAW,
 * THE FORWARD-ONLY LAW / THE APPEND-ONLY LINEAGE LAW, THE
 * BODY-RESOLUTION LAW, THE REMOVE+RE-ADD LAW, THE NO-FORK LAW, THE
 * CONTENT LAW, THE DETERMINISM LAW (no Math.random, no Date.now, no
 * new Date(...) and no process.env in this module - law comments
 * excepted; the clock, the rng and the fsPort are INJECTED seams; the
 * factory consumes exactly ONE clock read and ONE rng read), THE
 * FAIL-CLOSED LAW (factory misuse throws TypeError; every domain
 * refusal is a typed record { reason, law, detail, items? }; a
 * refused op leaves the record unchanged; payload-walk refusals carry
 * the COMPLETE contract rejection table), THE SINGLE-VERSION LAW (the
 * re-export chain), THE APPEND-ONLY LEDGER LAW, THE DISPOSE LAW (every
 * operation after dispose rejects with the typed DISPOSED refusal).
 */

import {
        MAX_PACKS,
        PACKS_CONTRACTS_VERSION,
        PACK_ID_PREFIX,
        PACKS_REJECTION_REASONS,
        isHarnessId,
        isHarnessIndustry,
        isPackId,
        isPackOpName,
        isPackStage,
        serializeCapabilityPacksRecord,
        validatePackEntry,
        validatePackSummary,
        validateCapabilityPacksRecord,
} from './packsContract.js';
import type {
        HarnessIndustry,
        PackOpName,
        PacksRejection,
        PackEntry,
        PackTransitionNote,
        CapabilityPacksRecord,
        PackStage,
} from './packsContract.js';
import {
        validateOrganizationDefaultsRecord,
        serializeOrganizationDefaultsRecord,
} from '../../bodies/common/bodiesContract.js';
import type { OrganizationDefaultsRecord } from '../../bodies/common/bodiesContract.js';
import type { HarnessFsPort } from '../../contract/common/domainHarnessKit.js';

/** THE SINGLE-VERSION LAW: the kit re-carries the contract's version (declared ONCE there). */
export { PACKS_CONTRACTS_VERSION } from './packsContract.js';

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

/**
 * The injected fs port is the DH-01 kit's OWN port type (the ONLY
 * filesystem seam - the PIN-2 sibling precedent; re-exported by
 * reference, never re-declared). The shipped kit never touches a
 * global fs, never reads the env; the caller wires the real driver.
 */
export type { HarnessFsPort } from '../../contract/common/domainHarnessKit.js';

/** The envelope path (relative to the injected root; the same .flauz/harness subtree as the landed families, distinct file). */
export const PACKS_ENVELOPE_RELATIVE_PATH = '.flauz/harness/packs-records.json';

/** The append-only ops ledger path (relative to the injected root; the same .flauz/harness subtree, distinct file). */
export const PACKS_LEDGER_RELATIVE_PATH = '.flauz/harness/packs-ops.jsonl';

/**
 * The frozen ledger-line schema keys, in the canonical fixed-key-order
 * (the ELEVEN-KEY line: the harness link is its own column - the
 * record BINDS to a harness through the REAL DH-01 id alphabet; the
 * payload carries the industry on begin, the pack entry on the pack
 * ops, the caller-supplied composed bodies record AS IT STOOD on
 * finalize).
 */
export const PACKS_LEDGER_LINE_SCHEMA_KEYS = [
        'seq',
        'at',
        'contractVersion',
        'op',
        'packsId',
        'harnessId',
        'fromStage',
        'toStage',
        'law',
        'payload',
        'detail',
] as const;

/** The frozen envelope schema keys, in the canonical fixed-key-order. */
export const PACKS_ENVELOPE_SCHEMA_KEYS = ['contractVersion', 'seq', 'records'] as const;

/**
 * One append-only capability-packs ops ledger line (the canonical
 * persisted op): the seq (equal to the line number), the clock
 * reading, the contract version, the op name, the record id, the
 * BOUND harness id (the REAL DH-01 flauz:hrn:<16-hex> form, carried
 * on every line), the stage edge walked (fromStage null ONLY on the
 * begin line; the pack ops walk the composing->composing self edge -
 * the organization composes its default capability packs gradually),
 * the granting law, the canonical op payload (the industry on begin;
 * the added / replacement / removed-as-it-stood pack entry on the pack
 * ops; the caller-supplied composed bodies record as it stood on
 * finalize - the replay re-proves THE BODY-RESOLUTION LAW from the
 * ledger alone), and the deterministic detail sentence.
 */
export interface PacksOpsLedgerLine {
        readonly seq: number;
        readonly at: string;
        readonly contractVersion: string;
        readonly op: PackOpName;
        readonly packsId: string;
        readonly harnessId: string;
        readonly fromStage: PackStage | null;
        readonly toStage: PackStage;
        readonly law: string;
        readonly payload: HarnessIndustry | PackEntry | OrganizationDefaultsRecord | null;
        readonly detail: string;
}

/**
 * The kit-layer refusal extras (the frozen list beyond the contract's
 * PACKS_REJECTION_REASONS; the contract's seventeen stations are the
 * PURE record walk - this wave's work order froze that list - so the
 * kit-layer domain stations are declared ONCE here, the DH-006
 * precedent's single-declaration discipline placed one level up):
 *   unknown-record      - no record resolves under the id (a
 *                         malformed id fails closed as unknown);
 *   version-mismatch    - THE SINGLE-VERSION LAW: a version-bearing
 *                         persisted surface (a ledger line or the
 *                         envelope) carries a contract version other
 *                         than PACKS_CONTRACTS_VERSION (the six-key
 *                         record carries no version field - THIS is
 *                         the law's live station);
 *   empty-packs         - THE PACK LAWS' floor: the finalize boundary
 *                         requires at least one composed pack (a
 *                         composing record may hold zero);
 *   dangling-body-ref   - THE BODY-RESOLUTION LAW: a non-empty
 *                         bodyRef does not resolve against the
 *                         caller-supplied composed bodies record at
 *                         the finalize boundary (the refusal names
 *                         every offending ref once, first-seen order;
 *                         the two-phase law: dangling bodyRefs are
 *                         LEGAL while composing);
 *   malformed-bodies    - THE BODY-RESOLUTION LAW: the
 *                         caller-supplied bodies record fails the
 *                         REAL DH-06 validateOrganizationDefaultsRecord
 *                         walk, or is not at the 'composed' stage (fail
 *                         closed - a malformed authority resolves
 *                         nothing, never a silent skip);
 *   premature-op        - THE FORWARD-ONLY LAW: the op precedes its
 *                         precondition (a capability ref emitted while
 *                         the record is still at 'composing' - refs
 *                         are emitted only from a COMPOSED record);
 *   stale-stage         - THE FORWARD-ONLY LAW: the op is behind the
 *                         walk (a mutating op on a composed record -
 *                         'composed' is TERMINAL, the record is
 *                         FROZEN; a changed pack is a NEW record, THE
 *                         APPEND-ONLY LINEAGE LAW);
 *   unknown-pack        - the packKey names no pack in the record (a
 *                         malformed packKey fails closed as unknown);
 *   DISPOSED            - THE DISPOSE LAW: the kit was disposed;
 *                         every operation after dispose rejects;
 *   CORRUPT_SEAM        - THE DETERMINISM LAW: the injected clock or
 *                         rng returned a malformed value mid-op (an
 *                         empty clock reading, a non-16-hex rng
 *                         output, a duplicate minted record id);
 *   E_LEDGER_TORN       - THE APPEND-ONLY LEDGER LAW: a torn or
 *                         missing packs ledger line, a structurally
 *                         invalid or out-of-order line, an unknown op
 *                         or an illegal stage edge inside the ledger,
 *                         or a fresh kit attempting to append over an
 *                         existing non-empty packs ledger (reopen
 *                         with loadPacksKit);
 *   E_ENVELOPE_MISMATCH - THE APPEND-ONLY LEDGER LAW: the packs
 *                         envelope diverges from the ledger replay
 *                         (or is missing / malformed while the ledger
 *                         carries lines) - never silently rebuilt;
 *   PACKS_IO            - THE FAIL-CLOSED LAW: the injected fs port
 *                         refused a read / append / write / mkdir on
 *                         the packs family's own files;
 *   UNKNOWN_FILTER      - THE FAIL-CLOSED LAW: listPacks received an
 *                         unknown filter field or a non-member filter
 *                         value.
 */
export const PACKS_KIT_EXTRA_REFUSAL_REASONS = [
        'unknown-record',
        'version-mismatch',
        'empty-packs',
        'dangling-body-ref',
        'malformed-bodies',
        'premature-op',
        'stale-stage',
        'unknown-pack',
        'DISPOSED',
        'CORRUPT_SEAM',
        'E_LEDGER_TORN',
        'E_ENVELOPE_MISMATCH',
        'PACKS_IO',
        'UNKNOWN_FILTER',
] as const;

/** The frozen kit refusal vocabulary: the contract's 17 domain reasons plus the kit-layer extras. */
export const PACKS_KIT_REFUSAL_REASONS = [
        ...PACKS_REJECTION_REASONS,
        ...PACKS_KIT_EXTRA_REFUSAL_REASONS,
] as const;
export type PacksKitRefusalReason = (typeof PACKS_KIT_REFUSAL_REASONS)[number];

/** Pure predicate over the closed kit-refusal list. */
export function isPacksKitRefusalReason(value: unknown): value is PacksKitRefusalReason {
        return (PACKS_KIT_REFUSAL_REASONS as readonly string[]).includes(value as string);
}

/**
 * The typed kit refusal: the frozen reason, the violated law's name,
 * the deterministic detail sentence, the optional offending items, and
 * the COMPLETE contract rejection table (payload-walk refusals -
 * never first-only).
 */
export interface PacksKitRefusal {
        readonly reason: PacksKitRefusalReason;
        readonly law: string;
        readonly detail: string;
        readonly items?: readonly string[];
        /** payload-walk refusals carry the COMPLETE contract rejection table (never first-only). */
        readonly rejections?: readonly PacksRejection[];
}

/**
 * The kit construction options (all injected, never env-read; fsPort
 * and root come together or not at all - the DH-01 options law).
 * NO catalog and NO bodies authority: the body resolution happens
 * ONLY against the CALLER-SUPPLIED bodies record at the finalize
 * boundary (THE BODY-RESOLUTION LAW / THE CONTENT LAW - the layer,
 * never the domain content).
 */
export interface PacksKitOptions {
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
export type PacksRecordOutcome =
        | { readonly ok: true; readonly record: CapabilityPacksRecord }
        | { readonly ok: false; readonly refusal: PacksKitRefusal };

/** The ref outcome: ok carries the emitted capabilityRef string; failure carries the typed refusal. */
export type PacksRefOutcome =
        | { readonly ok: true; readonly capabilityRef: string }
        | { readonly ok: false; readonly refusal: PacksKitRefusal };

/** The list outcome: ok carries the id-ordered honest records; failure carries the typed refusal. */
export type PacksListOutcome =
        | { readonly ok: true; readonly records: readonly CapabilityPacksRecord[] }
        | { readonly ok: false; readonly refusal: PacksKitRefusal };

/** The load outcome: ok carries the reopened kit; failure carries the typed refusal. */
export type PacksLoadOutcome =
        | { readonly ok: true; readonly kit: PacksKit }
        | { readonly ok: false; readonly refusal: PacksKitRefusal };

/**
 * The deterministic capability-packs kit: every operation is async
 * with a typed outcome ({ ok: true, ... } | { ok: false, refusal });
 * a refused op leaves the record unchanged (inspectable before and
 * after).
 */
export interface PacksKit {
        beginPacks(harnessId: unknown, industry: unknown): Promise<PacksRecordOutcome>;
        addPack(packsId: unknown, pack: unknown): Promise<PacksRecordOutcome>;
        replacePackSummary(packsId: unknown, packKey: unknown, summary: unknown): Promise<PacksRecordOutcome>;
        removePack(packsId: unknown, packKey: unknown): Promise<PacksRecordOutcome>;
        finalizePacks(packsId: unknown, bodiesRecord: unknown): Promise<PacksRecordOutcome>;
        emitCapabilityRef(packsId: unknown): Promise<PacksRefOutcome>;
        inspectPacks(packsId: unknown): Promise<PacksRecordOutcome>;
        listPacks(filter?: unknown): Promise<PacksListOutcome>;
        dispose(): void;
}

/**
 * Creates a capability-packs kit (fail-closed factory). Validation
 * order is deterministic and mirrors the landed DH-01/DH-02/DH-03/
 * DH-04/DH-05/DH-06 factory walk EXACTLY (the same preconditions, the
 * same message shapes, the createPacksKit prefix): the options shape
 * (clock / rng), the clock's first read (a non-empty ISO string), the
 * rng's first read (exactly 16 lowercase hex chars - the id-minting
 * law), and the fsPort/root pairing (both or neither; the port must
 * expose readFile / writeFile / appendFile / mkdir). The factory
 * consumes exactly ONE clock read and ONE rng read (there is no inner
 * kit to re-validate the seams - the battery pins the exact count).
 * The kit starts with ZERO records; persistence is LAZY (the
 * .flauz/harness subtree lands with the first applied op; a fresh kit
 * never appends over an existing non-empty packs ledger - reopen
 * with loadPacksKit).
 */
export function createPacksKit(options: PacksKitOptions): PacksKit {
        const bound = validateKitOptions(options, false, 'createPacksKit');
        return buildPacksKit(bound, { seq: 0, records: new Map<string, CapabilityPacksRecord>() });
}

/**
 * Reopens a persisted capability-packs kit: replays the append-only
 * packs ops ledger (the authoritative surface - each line re-validated:
 * the frozen eleven-key line schema, the REAL DH-01 harness-id
 * alphabet on every line, the op's stage edge, the record's walk
 * order, the payload's full validation, the MAX_PACKS bound, the
 * replace line's immutable-parts cross-check, the remove line's
 * entry-as-it-stood cross-check, the finalize floor AND the finalize
 * payload's body resolution - THE BODY-RESOLUTION LAW re-proved from
 * the ledger alone), and cross-checks the envelope byte-for-byte
 * against the replay-built state. A torn or missing packs ledger
 * line is the typed E_LEDGER_TORN; a divergent, missing or malformed
 * envelope is the typed E_ENVELOPE_MISMATCH (never silently rebuilt);
 * a version-bearing surface carrying another contract version is the
 * typed version-mismatch (THE SINGLE-VERSION LAW's live station); a
 * refused fs port is the typed PACKS_IO. A fresh root (no files)
 * reopens as an empty kit. The options require BOTH fsPort and root
 * (the load is a persistence-surface operation).
 */
export async function loadPacksKit(options: PacksKitOptions): Promise<PacksLoadOutcome> {
        const bound = validateKitOptions(options, true, 'loadPacksKit');
        const fsPort = bound.fsPort as HarnessFsPort;
        const ledgerPath = `${bound.root}/${PACKS_LEDGER_RELATIVE_PATH}`;
        const envelopePath = `${bound.root}/${PACKS_ENVELOPE_RELATIVE_PATH}`;
        try {
                await fsPort.mkdir(`${bound.root}/.flauz/harness`, { recursive: true });
        } catch (error) {
                return { ok: false, refusal: refused('PACKS_IO', 'THE FAIL-CLOSED LAW', `loadPacksKit: the fs port refused the root mkdir: ${toMessage(error)}`) };
        }
        let ledgerText: string | null;
        try {
                ledgerText = await readText(fsPort, ledgerPath);
        } catch (error) {
                return { ok: false, refusal: refused('PACKS_IO', 'THE FAIL-CLOSED LAW', `loadPacksKit: the fs port refused the packs ledger read: ${toMessage(error)}`) };
        }
        let envelopeText: string | null;
        try {
                envelopeText = await readText(fsPort, envelopePath);
        } catch (error) {
                return { ok: false, refusal: refused('PACKS_IO', 'THE FAIL-CLOSED LAW', `loadPacksKit: the fs port refused the packs envelope read: ${toMessage(error)}`) };
        }
        const replay = replayPacksLedger(ledgerText);
        if (!('lines' in replay)) {
                return { ok: false, refusal: replay };
        }
        const crossCheck = crossCheckPacksEnvelope(envelopeText, replay.lines.length, replay.records);
        if (crossCheck !== null) {
                return { ok: false, refusal: crossCheck };
        }
        return { ok: true, kit: buildPacksKit(bound, { seq: replay.lines.length, records: replay.records }) };
}

// --- the kit internals ---

interface BoundOptions {
        readonly clock: () => string;
        readonly rng: () => string;
        readonly fsPort: HarnessFsPort | null;
        readonly root: string | null;
}

interface PacksKitState {
        readonly seq: number;
        readonly records: ReadonlyMap<string, CapabilityPacksRecord>;
}

/** The persist fold's result: applied means the packs ledger line landed (the ledger is authoritative). */
type PersistResult =
        | { readonly applied: false; readonly refusal: PacksKitRefusal }
        | { readonly applied: true; readonly refusal: PacksKitRefusal | null };

/** The clock read's result: the injected seam's value or the typed corrupt-seam refusal. */
type ClockRead = { readonly at: string } | { readonly refusal: PacksKitRefusal };

function validateKitOptions(options: PacksKitOptions, requirePersistence: boolean, factoryName: 'createPacksKit' | 'loadPacksKit'): BoundOptions {
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
                        `${factoryName}: options.rng() must return exactly 16 lowercase hex chars (the id-minting seam - the kit mints ${PACK_ID_PREFIX}<16-hex>)`,
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
        reason: PacksKitRefusalReason,
        law: string,
        detail: string,
        items?: readonly string[],
): PacksKitRefusal {
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
        outcome: { readonly ok: false; readonly mode: 'shape'; readonly rejections: readonly PacksRejection[] },
): PacksKitRefusal {
        const first = outcome.rejections[0];
        return {
                reason: first.reason,
                law: first.law,
                detail: `${opName}: the payload walk refused - the COMPLETE rejection table follows in the frozen walk order (the first station: ${first.detail})`,
                items: first.items,
                rejections: outcome.rejections,
        };
}

function buildPacksKit(bound: BoundOptions, seed: PacksKitState): PacksKit {
        let disposed = false;
        let mutableSeq = seed.seq;
        const records = new Map<string, CapabilityPacksRecord>(seed.records);
        const persisted = bound.fsPort !== null && bound.root !== null;
        const fsPort = bound.fsPort;
        const ledgerPath = bound.root !== null ? `${bound.root}/${PACKS_LEDGER_RELATIVE_PATH}` : '';
        const envelopePath = bound.root !== null ? `${bound.root}/${PACKS_ENVELOPE_RELATIVE_PATH}` : '';
        let dirEnsured = false;
        // A kit reloaded from a persisted ledger NEVER re-fires the fresh-kit guard
        // (its ledger preexists; only a fresh createPacksKit guards the append).
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

        function copyRecord(record: CapabilityPacksRecord): CapabilityPacksRecord {
                return JSON.parse(serializeCapabilityPacksRecord(record)) as CapabilityPacksRecord;
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
        async function persist(line: PacksOpsLedgerLine, nextRecords: Map<string, CapabilityPacksRecord>): Promise<PersistResult> {
                if (!persisted || fsPort === null) {
                        mutableSeq = line.seq;
                        return { applied: true, refusal: null };
                }
                if (!ledgerGuardDone) {
                        let existing: string | null;
                        try {
                                existing = await readText(fsPort, ledgerPath);
                        } catch (error) {
                                return { applied: false, refusal: refused('PACKS_IO', 'THE FAIL-CLOSED LAW', `persist: the fs port refused the packs ledger read: ${toMessage(error)}`) };
                        }
                        if (existing !== null && existing.trim().length > 0) {
                                return {
                                        applied: false,
                                        refusal: refused(
                                                'E_LEDGER_TORN',
                                                'THE APPEND-ONLY LEDGER LAW',
                                                'persist: the packs ledger already carries lines - reopen with loadPacksKit (a fresh kit never appends over an existing ledger)',
                                        ),
                                };
                        }
                        ledgerGuardDone = true;
                }
                if (!dirEnsured) {
                        try {
                                await fsPort.mkdir(`${bound.root}/.flauz/harness`, { recursive: true });
                        } catch (error) {
                                return { applied: false, refusal: refused('PACKS_IO', 'THE FAIL-CLOSED LAW', `persist: the fs port refused the root mkdir: ${toMessage(error)}`) };
                        }
                        dirEnsured = true;
                }
                try {
                        await fsPort.appendFile(ledgerPath, `${ledgerLineBytes(line)}\n`);
                } catch (error) {
                        return { applied: false, refusal: refused('PACKS_IO', 'THE FAIL-CLOSED LAW', `persist: the fs port refused the packs ledger append: ${toMessage(error)} (nothing was applied)`) };
                }
                mutableSeq = line.seq;
                try {
                        await fsPort.writeFile(envelopePath, envelopeBytes(line.seq, nextRecords));
                } catch (error) {
                        return {
                                applied: true,
                                refusal: refused(
                                        'PACKS_IO',
                                        'THE FAIL-CLOSED LAW',
                                        `persist: the packs ledger line landed at seq ${line.seq} but the fs port refused the envelope rewrite: ${toMessage(error)} (the op applied and the ledger is authoritative; a reload fails closed with E_ENVELOPE_MISMATCH until the envelope is rewritten)`,
                                ),
                        };
                }
                return { applied: true, refusal: null };
        }

        function commit(nextRecords: Map<string, CapabilityPacksRecord>): void {
                records.clear();
                for (const [id, record] of nextRecords) {
                        records.set(id, record);
                }
        }

        function recordOutcome(record: CapabilityPacksRecord): PacksRecordOutcome {
                return { ok: true, record: copyRecord(record) };
        }

        /** The disposed guard (THE DISPOSE LAW - the op-entry first station). */
        function refuseIfDisposed(opName: string): PacksKitRefusal | null {
                if (disposed) {
                        return refused('DISPOSED', 'THE DISPOSE LAW', `${opName}: the kit was disposed - every operation after dispose rejects`);
                }
                return null;
        }

        /** The unknown-record guard (a malformed id fails closed as unknown - the DH-01 NOT_FOUND discipline, this family's reason). */
        function lookupRecord(opName: string, packsId: unknown): { record: CapabilityPacksRecord } | { refusal: PacksKitRefusal } {
                if (!isPackId(packsId)) {
                        return { refusal: refused('unknown-record', 'THE FAIL-CLOSED LAW', `${opName}: no record with id '${showValue(packsId)}' (a malformed id fails closed as unknown-record)`) };
                }
                const record = records.get(packsId);
                if (record === undefined) {
                        return { refusal: refused('unknown-record', 'THE FAIL-CLOSED LAW', `${opName}: no record with id '${packsId}'`) };
                }
                return { record };
        }

        /**
         * THE FORWARD-ONLY LAW's stage guard: the mutating ops require the
         * 'composing' stage (a composed record is past them - stale-stage,
         * 'composed' is TERMINAL, THE APPEND-ONLY LINEAGE LAW).
         */
        function stageGuard(opName: string, record: CapabilityPacksRecord): PacksKitRefusal | null {
                if (record.stage === 'composing') {
                        return null;
                }
                return refused(
                        'stale-stage',
                        'THE FORWARD-ONLY LAW',
                        `${opName}: the record is at the '${record.stage}' stage - the record is FROZEN ('composed' is TERMINAL; a changed pack is a NEW pack, THE APPEND-ONLY LINEAGE LAW) (THE FORWARD-ONLY LAW)`,
                        [record.stage],
                );
        }

        /** The pack lookup for replace / remove (a malformed packKey fails closed as unknown-pack). */
        function findPack(record: CapabilityPacksRecord, packKey: unknown): PackEntry | null {
                if (typeof packKey !== 'string') {
                        return null;
                }
                const found = record.packs.find((entry) => entry.packKey === packKey);
                return found === undefined ? null : found;
        }

        return {
                async beginPacks(harnessId: unknown, industry: unknown): Promise<PacksRecordOutcome> {
                        const disposedRefusal = refuseIfDisposed('beginPacks');
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
                                                `beginPacks: the harnessId must satisfy the REAL DH-01 harness-id alphabet (flauz:hrn:<16-hex>, imported by reference - the FORM law; the EXISTENCE binding is the caller's wiring, never this layer's)`,
                                                [showValue(harnessId)],
                                        ),
                                };
                        }
                        if (!isHarnessIndustry(industry)) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'bad-industry',
                                                'THE FROZEN-VOCABULARY LAW',
                                                `beginPacks: the industry must be a member of the frozen HARNESS_INDUSTRIES list, imported by reference from the DH-01 contract (membership is the only admissibility; the capability packs are industry-scoped)`,
                                                [showValue(industry)],
                                        ),
                                };
                        }
                        const hex = bound.rng();
                        if (!/^[0-9a-f]{16}$/.test(hex)) {
                                return { ok: false, refusal: refused('CORRUPT_SEAM', 'THE DETERMINISM LAW', 'beginPacks: the injected rng returned a non-16-hex value (the id-minting seam is corrupt)') };
                        }
                        const packsId = `${PACK_ID_PREFIX}${hex}`;
                        if (records.has(packsId)) {
                                return { ok: false, refusal: refused('CORRUPT_SEAM', 'THE DETERMINISM LAW', 'beginPacks: the injected rng minted a duplicate record id (the id-minting seam is corrupt)') };
                        }
                        const clockRead = readClock();
                        if ('refusal' in clockRead) {
                                return { ok: false, refusal: clockRead.refusal };
                        }
                        const at = clockRead.at;
                        const detail = `began the capability-packs record bound to harness '${harnessId}' over the '${industry}' industry (the walk enters the composing stage with ZERO packs; the caller composes the packs - this family never invents them, THE CONTENT LAW)`;
                        const record: CapabilityPacksRecord = {
                                id: packsId,
                                harnessId,
                                industry,
                                stage: 'composing',
                                packs: [],
                                history: [
                                        { at, fromStage: null, toStage: 'composing', op: 'begin-packs', law: 'THE FORWARD-ONLY LAW', detail },
                                ],
                        };
                        const line: PacksOpsLedgerLine = {
                                seq: mutableSeq + 1,
                                at,
                                contractVersion: PACKS_CONTRACTS_VERSION,
                                op: 'begin-packs',
                                packsId,
                                harnessId,
                                fromStage: null,
                                toStage: 'composing',
                                law: 'THE FORWARD-ONLY LAW',
                                payload: industry,
                                detail,
                        };
                        const nextRecords = new Map(records);
                        nextRecords.set(packsId, record);
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
                async addPack(packsId: unknown, pack: unknown): Promise<PacksRecordOutcome> {
                        const disposedRefusal = refuseIfDisposed('addPack');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        const lookup = lookupRecord('addPack', packsId);
                        if ('refusal' in lookup) {
                                return { ok: false, refusal: lookup.refusal };
                        }
                        const record = lookup.record;
                        const stageRefusal = stageGuard('addPack', record);
                        if (stageRefusal !== null) {
                                return { ok: false, refusal: stageRefusal };
                        }
                        const verdict = validatePackEntry(pack);
                        if (!verdict.ok) {
                                return { ok: false, refusal: payloadRefused('addPack', verdict) };
                        }
                        const entry = verdict.value;
                        if (record.packs.some((existing) => existing.packKey === entry.packKey)) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'duplicate-pack-key',
                                                'THE FAIL-CLOSED LAW',
                                                `addPack: the packKey '${entry.packKey}' is already composed (a pack appears once)`,
                                                [entry.packKey],
                                        ),
                                };
                        }
                        if (record.packs.length >= MAX_PACKS) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'max-packs',
                                                'THE FAIL-CLOSED LAW',
                                                `addPack: the record already carries ${record.packs.length} packs - the composition bound is MAX_PACKS (${MAX_PACKS})`,
                                                [`${record.packs.length} packs`],
                                        ),
                                };
                        }
                        const clockRead = readClock();
                        if ('refusal' in clockRead) {
                                return { ok: false, refusal: clockRead.refusal };
                        }
                        const at = clockRead.at;
                        const detail = `added the pack '${entry.packKey}' (a pack is CONFIGURATION - it grants NOTHING by itself; dangling bodyRefs are LEGAL while composing - THE BODY-RESOLUTION LAW's two-phase law)`;
                        const next: CapabilityPacksRecord = {
                                id: record.id,
                                harnessId: record.harnessId,
                                industry: record.industry,
                                stage: 'composing',
                                packs: [...record.packs, entry],
                                history: [...record.history, { at, fromStage: 'composing', toStage: 'composing', op: 'add-pack', law: 'THE NO-FORK LAW', detail }],
                        };
                        const line: PacksOpsLedgerLine = {
                                seq: mutableSeq + 1,
                                at,
                                contractVersion: PACKS_CONTRACTS_VERSION,
                                op: 'add-pack',
                                packsId: record.id,
                                harnessId: record.harnessId,
                                fromStage: 'composing',
                                toStage: 'composing',
                                law: 'THE NO-FORK LAW',
                                payload: entry,
                                detail,
                        };
                        const nextRecords = new Map(records);
                        nextRecords.set(record.id, next);
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
                async replacePackSummary(packsId: unknown, packKey: unknown, summary: unknown): Promise<PacksRecordOutcome> {
                        const disposedRefusal = refuseIfDisposed('replacePackSummary');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        const lookup = lookupRecord('replacePackSummary', packsId);
                        if ('refusal' in lookup) {
                                return { ok: false, refusal: lookup.refusal };
                        }
                        const record = lookup.record;
                        const stageRefusal = stageGuard('replacePackSummary', record);
                        if (stageRefusal !== null) {
                                return { ok: false, refusal: stageRefusal };
                        }
                        const existing = findPack(record, packKey);
                        if (existing === null) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'unknown-pack',
                                                'THE FAIL-CLOSED LAW',
                                                `replacePackSummary: no pack '${showValue(packKey)}' in the record (a malformed packKey fails closed as unknown-pack)`,
                                        ),
                                };
                        }
                        const verdict = validatePackSummary(summary);
                        if (!verdict.ok) {
                                return { ok: false, refusal: payloadRefused('replacePackSummary', verdict) };
                        }
                        const replacement: PackEntry = { packKey: existing.packKey, summary: verdict.value, bodyRefs: [...existing.bodyRefs] };
                        const clockRead = readClock();
                        if ('refusal' in clockRead) {
                                return { ok: false, refusal: clockRead.refusal };
                        }
                        const at = clockRead.at;
                        const detail = `replaced the summary of the pack '${existing.packKey}' (a pack's key is its identity - immutable once added; only the summary is replaceable, THE REMOVE+RE-ADD LAW)`;
                        const next: CapabilityPacksRecord = {
                                id: record.id,
                                harnessId: record.harnessId,
                                industry: record.industry,
                                stage: 'composing',
                                packs: record.packs.map((entry) => (entry.packKey === replacement.packKey ? replacement : entry)),
                                history: [...record.history, { at, fromStage: 'composing', toStage: 'composing', op: 'replace-pack-summary', law: 'THE REMOVE+RE-ADD LAW', detail }],
                        };
                        const line: PacksOpsLedgerLine = {
                                seq: mutableSeq + 1,
                                at,
                                contractVersion: PACKS_CONTRACTS_VERSION,
                                op: 'replace-pack-summary',
                                packsId: record.id,
                                harnessId: record.harnessId,
                                fromStage: 'composing',
                                toStage: 'composing',
                                law: 'THE REMOVE+RE-ADD LAW',
                                payload: replacement,
                                detail,
                        };
                        const nextRecords = new Map(records);
                        nextRecords.set(record.id, next);
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
                async removePack(packsId: unknown, packKey: unknown): Promise<PacksRecordOutcome> {
                        const disposedRefusal = refuseIfDisposed('removePack');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        const lookup = lookupRecord('removePack', packsId);
                        if ('refusal' in lookup) {
                                return { ok: false, refusal: lookup.refusal };
                        }
                        const record = lookup.record;
                        const stageRefusal = stageGuard('removePack', record);
                        if (stageRefusal !== null) {
                                return { ok: false, refusal: stageRefusal };
                        }
                        const existing = findPack(record, packKey);
                        if (existing === null) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'unknown-pack',
                                                'THE FAIL-CLOSED LAW',
                                                `removePack: no pack '${showValue(packKey)}' in the record (a malformed packKey fails closed as unknown-pack)`,
                                        ),
                                };
                        }
                        const clockRead = readClock();
                        if ('refusal' in clockRead) {
                                return { ok: false, refusal: clockRead.refusal };
                        }
                        const at = clockRead.at;
                        const detail = `removed the pack '${existing.packKey}' (THE REMOVE+RE-ADD LAW: a changed packKey is a NEW pack; removing the last pack is legal while composing - the empty-packs floor fires only at finalize)`;
                        const next: CapabilityPacksRecord = {
                                id: record.id,
                                harnessId: record.harnessId,
                                industry: record.industry,
                                stage: 'composing',
                                packs: record.packs.filter((entry) => entry.packKey !== existing.packKey),
                                history: [...record.history, { at, fromStage: 'composing', toStage: 'composing', op: 'remove-pack', law: 'THE REMOVE+RE-ADD LAW', detail }],
                        };
                        const line: PacksOpsLedgerLine = {
                                seq: mutableSeq + 1,
                                at,
                                contractVersion: PACKS_CONTRACTS_VERSION,
                                op: 'remove-pack',
                                packsId: record.id,
                                harnessId: record.harnessId,
                                fromStage: 'composing',
                                toStage: 'composing',
                                law: 'THE REMOVE+RE-ADD LAW',
                                payload: existing,
                                detail,
                        };
                        const nextRecords = new Map(records);
                        nextRecords.set(record.id, next);
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
                async finalizePacks(packsId: unknown, bodiesRecord: unknown): Promise<PacksRecordOutcome> {
                        const disposedRefusal = refuseIfDisposed('finalizePacks');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        const lookup = lookupRecord('finalizePacks', packsId);
                        if ('refusal' in lookup) {
                                return { ok: false, refusal: lookup.refusal };
                        }
                        const record = lookup.record;
                        const stageRefusal = stageGuard('finalizePacks', record);
                        if (stageRefusal !== null) {
                                return { ok: false, refusal: stageRefusal };
                        }
                        // THE BODY-RESOLUTION LAW, station 1: the CALLER-SUPPLIED bodies record must
                        // pass the REAL DH-06 organization-defaults walk AND sit at 'composed' (fail
                        // closed - a malformed authority resolves nothing, never a silent skip; the
                        // kit NEVER injects a bodies authority of its own).
                        const walked = validateOrganizationDefaultsRecord(bodiesRecord);
                        if (!walked.ok) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'malformed-bodies',
                                                'THE BODY-RESOLUTION LAW',
                                                'finalizePacks: the caller-supplied bodies record fails the REAL DH-06 validateOrganizationDefaultsRecord walk (a malformed authority resolves nothing - fail closed, never a silent skip)',
                                        ),
                                };
                        }
                        const bodies = walked.value;
                        if (bodies.stage !== 'composed') {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'malformed-bodies',
                                                'THE BODY-RESOLUTION LAW',
                                                `finalizePacks: the caller-supplied bodies record is at the '${bodies.stage}' stage - bodyRefs resolve ONLY against a COMPOSED bodies record (the frozen organization defaults)`,
                                                [bodies.stage],
                                        ),
                                };
                        }
                        // THE PACK LAWS' floor: at least one pack at finalize (never the record shape).
                        if (record.packs.length === 0) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'empty-packs',
                                                'THE FAIL-CLOSED LAW',
                                                'finalizePacks: the capability packs must compose at least one pack (the empty-packs floor - compose packs with addPack first; the floor fires HERE, never the record shape)',
                                                ['packs'],
                                        ),
                                };
                        }
                        // THE NO-DANGLING-REF boundary: every non-empty bodyRef must resolve against
                        // the caller-supplied composed bodies record's bodyKeys (each offender named
                        // once, first-seen order).
                        const known = new Set<string>(bodies.bodies.map((body) => body.bodyKey));
                        const reported = new Set<string>();
                        const dangling: string[] = [];
                        for (const pack of record.packs) {
                                for (const ref of pack.bodyRefs) {
                                        if (!known.has(ref) && !reported.has(ref)) {
                                                reported.add(ref);
                                                dangling.push(ref);
                                        }
                                }
                        }
                        if (dangling.length > 0) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'dangling-body-ref',
                                                'THE BODY-RESOLUTION LAW',
                                                `finalizePacks: every non-empty bodyRef must resolve against the caller-supplied composed bodies record '${bodies.bodyId}' (a dangling bodyRef is never a silent skip; the two-phase law allowed these while composing)`,
                                                dangling,
                                        ),
                                };
                        }
                        const clockRead = readClock();
                        if ('refusal' in clockRead) {
                                return { ok: false, refusal: clockRead.refusal };
                        }
                        const at = clockRead.at;
                        const detail = `finalized the capability packs (${record.packs.length} pack(s); composing -> composed, TERMINAL - the record is FROZEN, a changed pack is a NEW pack; every bodyRef resolved against the caller-supplied composed bodies record '${bodies.bodyId}')`;
                        const next: CapabilityPacksRecord = {
                                id: record.id,
                                harnessId: record.harnessId,
                                industry: record.industry,
                                stage: 'composed',
                                packs: record.packs.map((pack) => ({ packKey: pack.packKey, summary: pack.summary, bodyRefs: [...pack.bodyRefs] })),
                                history: [...record.history, { at, fromStage: 'composing', toStage: 'composed', op: 'finalize-packs', law: 'THE BODY-RESOLUTION LAW', detail }],
                        };
                        const line: PacksOpsLedgerLine = {
                                seq: mutableSeq + 1,
                                at,
                                contractVersion: PACKS_CONTRACTS_VERSION,
                                op: 'finalize-packs',
                                packsId: record.id,
                                harnessId: record.harnessId,
                                fromStage: 'composing',
                                toStage: 'composed',
                                law: 'THE BODY-RESOLUTION LAW',
                                payload: bodies,
                                detail,
                        };
                        const nextRecords = new Map(records);
                        nextRecords.set(record.id, next);
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
                async emitCapabilityRef(packsId: unknown): Promise<PacksRefOutcome> {
                        const disposedRefusal = refuseIfDisposed('emitCapabilityRef');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        const lookup = lookupRecord('emitCapabilityRef', packsId);
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
                                                `emitCapabilityRef: the record is at the '${record.stage}' stage - a capabilityRef is emitted ONLY from a COMPOSED record (finalizePacks first)`,
                                                [record.stage],
                                        ),
                                };
                        }
                        // The emitted ref IS the composed record's id (the review composition's
                        // reference-family member form: a string, duplicate-free by identity).
                        // A pure read: no state change, no ledger line - the ref is deterministic.
                        return { ok: true, capabilityRef: record.id };
                },
                async inspectPacks(packsId: unknown): Promise<PacksRecordOutcome> {
                        const disposedRefusal = refuseIfDisposed('inspectPacks');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        const lookup = lookupRecord('inspectPacks', packsId);
                        if ('refusal' in lookup) {
                                return { ok: false, refusal: lookup.refusal };
                        }
                        return recordOutcome(lookup.record);
                },
                async listPacks(filter?: unknown): Promise<PacksListOutcome> {
                        const disposedRefusal = refuseIfDisposed('listPacks');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        if (filter !== undefined) {
                                if (!isRecord(filter)) {
                                        return { ok: false, refusal: refused('UNKNOWN_FILTER', 'THE FAIL-CLOSED LAW', 'listPacks: the filter must be an object (or absent)') };
                                }
                                const filterRecord = filter as Record<string, unknown>;
                                const unknownFields = Object.keys(filterRecord).filter((key) => key !== 'stage' && key !== 'industry' && key !== 'harnessId');
                                if (unknownFields.length > 0) {
                                        return {
                                                ok: false,
                                                refusal: refused('UNKNOWN_FILTER', 'THE FAIL-CLOSED LAW', 'listPacks: the filter carries an unknown field (stage / industry / harnessId only)', unknownFields),
                                        };
                                }
                                if (filterRecord.stage !== undefined && !isPackStage(filterRecord.stage)) {
                                        return { ok: false, refusal: refused('UNKNOWN_FILTER', 'THE FAIL-CLOSED LAW', 'listPacks: the stage filter value is not a member of the frozen PACK_STAGES list') };
                                }
                                if (filterRecord.industry !== undefined && !isHarnessIndustry(filterRecord.industry)) {
                                        return { ok: false, refusal: refused('UNKNOWN_FILTER', 'THE FAIL-CLOSED LAW', 'listPacks: the industry filter value is not a member of the frozen HARNESS_INDUSTRIES list (imported by reference)') };
                                }
                                if (filterRecord.harnessId !== undefined && !isHarnessId(filterRecord.harnessId)) {
                                        return { ok: false, refusal: refused('UNKNOWN_FILTER', 'THE FAIL-CLOSED LAW', 'listPacks: the harnessId filter value does not satisfy the REAL DH-01 harness-id alphabet (imported by reference)') };
                                }
                        }
                        const ids = [...records.keys()].sort();
                        const listed: CapabilityPacksRecord[] = [];
                        for (const id of ids) {
                                const entry = records.get(id) as CapabilityPacksRecord;
                                if (filter !== undefined && !matchesRecordFilter(entry, filter as Record<string, unknown>)) {
                                        continue;
                                }
                                listed.push(copyRecord(entry));
                        }
                        return { ok: true, records: listed };
                },
                dispose(): void {
                        disposed = true;
                },
        };
}

// --- ledger replay + envelope cross-check (the load surface) ---

interface PacksLedgerReplay {
        readonly lines: readonly PacksOpsLedgerLine[];
        readonly records: Map<string, CapabilityPacksRecord>;
}

/** Parses and validates the whole packs ledger text; returns the typed refusal or the replay (never a silent skip). */
function replayPacksLedger(ledgerText: string | null): PacksLedgerReplay | PacksKitRefusal {
        if (ledgerText === null || ledgerText.length === 0) {
                return { lines: [], records: new Map<string, CapabilityPacksRecord>() };
        }
        if (!ledgerText.endsWith('\n')) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', 'loadPacksKit: the packs ledger does not end with a complete line (a torn append - never a silent skip)');
        }
        const records = new Map<string, CapabilityPacksRecord>();
        const lines: PacksOpsLedgerLine[] = [];
        const rawLines = ledgerText.split('\n');
        rawLines.pop();
        for (let i = 0; i < rawLines.length; i += 1) {
                if (rawLines[i].length === 0) {
                        return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadPacksKit: packs ledger line ${i + 1} is empty`);
                }
                let parsed: unknown;
                try {
                        parsed = JSON.parse(rawLines[i]);
                } catch {
                        return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadPacksKit: packs ledger line ${i + 1} is not valid JSON (a torn write - never a silent skip)`);
                }
                const torn = validatePacksLedgerLine(parsed, i + 1, records);
                if (torn !== null) {
                        return torn;
                }
                const record = parsed as Record<string, unknown>;
                const line: PacksOpsLedgerLine = {
                        seq: record.seq as number,
                        at: record.at as string,
                        contractVersion: record.contractVersion as string,
                        op: record.op as PackOpName,
                        packsId: record.packsId as string,
                        harnessId: record.harnessId as string,
                        fromStage: record.fromStage as PackStage | null,
                        toStage: record.toStage as PackStage,
                        law: record.law as string,
                        payload: record.payload as PacksOpsLedgerLine['payload'],
                        detail: record.detail as string,
                };
                applyPacksLine(records, line);
                lines.push(line);
        }
        return { lines, records };
}

/** Validates one parsed packs ledger line; returns the typed refusal or null (the line is structurally valid and legal). */
function validatePacksLedgerLine(parsed: unknown, lineNo: number, records: Map<string, CapabilityPacksRecord>): PacksKitRefusal | null {
        if (!isRecord(parsed)) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadPacksKit: packs ledger line ${lineNo} is not a JSON object`);
        }
        const record = parsed as Record<string, unknown>;
        const keys = Object.keys(record).sort();
        const expected = [...PACKS_LEDGER_LINE_SCHEMA_KEYS].sort();
        if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadPacksKit: packs ledger line ${lineNo} is structurally invalid (the frozen eleven-key line schema)`);
        }
        if (typeof record.seq !== 'number' || !Number.isInteger(record.seq) || record.seq !== lineNo) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadPacksKit: packs ledger line ${lineNo} carries sequence ${showValue(record.seq)}; ledger lines are missing or out of order`);
        }
        if (typeof record.at !== 'string' || record.at.length === 0) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadPacksKit: packs ledger line ${lineNo} has no timestamp (the injected clock's reading, carried verbatim)`);
        }
        if (record.contractVersion !== PACKS_CONTRACTS_VERSION) {
                return refused('version-mismatch', 'THE SINGLE-VERSION LAW', `loadPacksKit: packs ledger line ${lineNo} carries contract version ${showValue(record.contractVersion)} - only '${PACKS_CONTRACTS_VERSION}' is known (the single-version law; the six-key record carries no version field, so THIS is the law's live station)`);
        }
        if (!isPackOpName(record.op)) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadPacksKit: packs ledger line ${lineNo} carries an unknown op ${showValue(record.op)}`);
        }
        if (!isPackId(record.packsId)) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadPacksKit: packs ledger line ${lineNo} carries a malformed record id`);
        }
        if (!isHarnessId(record.harnessId)) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadPacksKit: packs ledger line ${lineNo} carries a malformed harness id (the REAL DH-01 flauz:hrn:<16-hex> alphabet, imported by reference)`);
        }
        if (record.fromStage !== null && !isPackStage(record.fromStage)) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadPacksKit: packs ledger line ${lineNo} carries an unknown fromStage`);
        }
        if (!isPackStage(record.toStage)) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadPacksKit: packs ledger line ${lineNo} carries an unknown toStage`);
        }
        if (typeof record.law !== 'string' || record.law.length === 0) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadPacksKit: packs ledger line ${lineNo} carries no law name (the provenance law)`);
        }
        if (typeof record.detail !== 'string' || record.detail.length === 0) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadPacksKit: packs ledger line ${lineNo} carries no provenance detail`);
        }
        const op = record.op as PackOpName;
        const packsRecord = records.get(record.packsId as string);
        if (op === 'begin-packs') {
                if (record.fromStage !== null || record.toStage !== 'composing') {
                        return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadPacksKit: packs ledger line ${lineNo} is a begin line that does not land 'composing' (every record enters the walk at composing)`);
                }
                if (!isHarnessIndustry(record.payload)) {
                        return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadPacksKit: packs ledger line ${lineNo} is a begin line without a frozen-HARNESS_INDUSTRIES industry payload`);
                }
                if (packsRecord !== undefined) {
                        return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadPacksKit: packs ledger line ${lineNo} begins a duplicate record id`);
                }
                return null;
        }
        if (packsRecord === undefined) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadPacksKit: packs ledger line ${lineNo} advances an unknown record`);
        }
        if (packsRecord.stage !== 'composing') {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadPacksKit: packs ledger line ${lineNo} is out of order (the record is not at the composing stage; 'composed' is TERMINAL)`);
        }
        if (op === 'finalize-packs') {
                if (record.fromStage !== 'composing' || record.toStage !== 'composed') {
                        return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadPacksKit: packs ledger line ${lineNo} is a finalize line outside the composing->composed edge`);
                }
                // The finalize payload is the caller-supplied composed bodies record AS IT
                // STOOD: the replay re-proves the REAL DH-06 walk, the composed stage, the
                // empty-packs floor AND the NO-DANGLING-REF resolution from the ledger alone.
                const walked = validateOrganizationDefaultsRecord(record.payload);
                if (!walked.ok) {
                        return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadPacksKit: packs ledger line ${lineNo} is a finalize line carrying an invalid bodies payload (the REAL DH-06 organization-defaults walk)`);
                }
                if (walked.value.stage !== 'composed') {
                        return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadPacksKit: packs ledger line ${lineNo} is a finalize line whose bodies payload is not at the 'composed' stage (THE BODY-RESOLUTION LAW)`);
                }
                if (packsRecord.packs.length === 0) {
                        return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadPacksKit: packs ledger line ${lineNo} finalizes an empty record (the empty-packs floor - the replay re-validates the boundary law)`);
                }
                const known = new Set<string>(walked.value.bodies.map((body) => body.bodyKey));
                const dangling = packsRecord.packs.flatMap((pack) => pack.bodyRefs).filter((ref) => ref.length > 0 && !known.has(ref));
                if (dangling.length > 0) {
                        return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadPacksKit: packs ledger line ${lineNo} carries a dangling bodyRef payload resolution (${showList(dangling)}) - THE BODY-RESOLUTION LAW re-proved from the ledger alone`);
                }
                return null;
        }
        if (record.fromStage !== 'composing' || record.toStage !== 'composing') {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadPacksKit: packs ledger line ${lineNo} is a pack-op line outside the composing->composing self edge (the organization composes its default capability packs gradually)`);
        }
        const entry = validatePackEntry(record.payload);
        if (!entry.ok) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadPacksKit: packs ledger line ${lineNo} carries an invalid pack payload`);
        }
        const payloadPack = entry.value;
        if (op === 'add-pack') {
                if (packsRecord.packs.some((pack) => pack.packKey === payloadPack.packKey)) {
                        return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadPacksKit: packs ledger line ${lineNo} adds a duplicate packKey '${payloadPack.packKey}'`);
                }
                if (packsRecord.packs.length >= MAX_PACKS) {
                        return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadPacksKit: packs ledger line ${lineNo} exceeds the MAX_PACKS (${MAX_PACKS}) composition bound`);
                }
                return null;
        }
        const standing = packsRecord.packs.find((pack) => pack.packKey === payloadPack.packKey);
        if (standing === undefined) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadPacksKit: packs ledger line ${lineNo} advances an unknown pack '${payloadPack.packKey}'`);
        }
        if (op === 'replace-pack-summary') {
                // The immutable-parts cross-check: only the summary may differ (a pack's key
                // is its identity and the bodyRefs are carried unchanged).
                if (JSON.stringify(payloadPack.bodyRefs) !== JSON.stringify(standing.bodyRefs)) {
                        return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadPacksKit: packs ledger line ${lineNo} replaces a pack whose bodyRefs do not match the record's pack as it stood (THE REMOVE+RE-ADD LAW)`);
                }
                return null;
        }
        // remove-pack: the payload must match the record's entry AS IT STOOD (the authoritative cross-check).
        if (payloadPack.summary !== standing.summary || JSON.stringify(payloadPack.bodyRefs) !== JSON.stringify(standing.bodyRefs)) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadPacksKit: packs ledger line ${lineNo} removes a pack entry that does not match the record's capability packs as it stood`);
        }
        return null;
}

/** Applies one validated packs ledger line to the replay records (pure fold). */
function applyPacksLine(records: Map<string, CapabilityPacksRecord>, line: PacksOpsLedgerLine): void {
        if (line.op === 'begin-packs') {
                records.set(line.packsId, {
                        id: line.packsId,
                        harnessId: line.harnessId,
                        industry: line.payload as HarnessIndustry,
                        stage: line.toStage,
                        packs: [],
                        history: [noteOf(line)],
                });
                return;
        }
        const record = records.get(line.packsId);
        if (record === undefined) {
                return;
        }
        const base: CapabilityPacksRecord = {
                ...record,
                stage: line.toStage,
                history: [...record.history, noteOf(line)],
        };
        let next: CapabilityPacksRecord;
        if (line.op === 'add-pack') {
                next = { ...base, packs: [...record.packs, line.payload as PackEntry] };
        } else if (line.op === 'replace-pack-summary') {
                const replacement = line.payload as PackEntry;
                next = { ...base, packs: record.packs.map((pack) => (pack.packKey === replacement.packKey ? replacement : pack)) };
        } else if (line.op === 'remove-pack') {
                const removed = line.payload as PackEntry;
                next = { ...base, packs: record.packs.filter((pack) => pack.packKey !== removed.packKey) };
        } else {
                next = { ...base, packs: record.packs.map((pack) => ({ packKey: pack.packKey, summary: pack.summary, bodyRefs: [...pack.bodyRefs] })) };
        }
        records.set(line.packsId, next);
}

/** Builds the history note of one ledger line (the provenance fold). */
function noteOf(line: PacksOpsLedgerLine): PackTransitionNote {
        return {
                at: line.at,
                fromStage: line.fromStage,
                toStage: line.toStage,
                op: line.op,
                law: line.law,
                detail: line.detail,
        };
}

/** Cross-checks the packs envelope against the replay; returns the typed refusal or null. */
function crossCheckPacksEnvelope(
        envelopeText: string | null,
        lineCount: number,
        replayed: Map<string, CapabilityPacksRecord>,
): PacksKitRefusal | null {
        if (envelopeText === null) {
                if (lineCount === 0) {
                        return null;
                }
                return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', `loadPacksKit: the packs envelope is missing while the ledger carries ${lineCount} line(s) - the divergent envelope is never silently rebuilt`);
        }
        let parsedEnvelope: unknown;
        try {
                parsedEnvelope = JSON.parse(envelopeText);
        } catch {
                return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', 'loadPacksKit: the packs envelope is not valid JSON');
        }
        if (!isRecord(parsedEnvelope)) {
                return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', 'loadPacksKit: the packs envelope is not a JSON object');
        }
        const envelope = parsedEnvelope as Record<string, unknown>;
        const keys = Object.keys(envelope).sort();
        const expected = [...PACKS_ENVELOPE_SCHEMA_KEYS].sort();
        if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
                return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', 'loadPacksKit: the packs envelope is structurally invalid (the frozen three-key envelope schema)');
        }
        if (envelope.contractVersion !== PACKS_CONTRACTS_VERSION) {
                return refused('version-mismatch', 'THE SINGLE-VERSION LAW', `loadPacksKit: the packs envelope carries contract version ${showValue(envelope.contractVersion)} - only '${PACKS_CONTRACTS_VERSION}' is known (the single-version law)`);
        }
        if (typeof envelope.seq !== 'number' || !Number.isInteger(envelope.seq) || envelope.seq < 0) {
                return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', 'loadPacksKit: the packs envelope carries a malformed seq');
        }
        if (!Array.isArray(envelope.records)) {
                return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', 'loadPacksKit: the packs envelope carries a malformed records array');
        }
        const envelopeSeq = envelope.seq as number;
        if (envelopeSeq > lineCount) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadPacksKit: the packs envelope claims seq ${envelopeSeq} but the ledger carries ${lineCount} line(s) - missing ledger lines (never a silent skip)`);
        }
        if (envelopeSeq < lineCount) {
                return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', `loadPacksKit: the packs envelope claims seq ${envelopeSeq} but the ledger carries ${lineCount} line(s) - the divergent envelope is never silently rebuilt`);
        }
        const envelopeRecordMap = new Map<string, CapabilityPacksRecord>();
        for (let i = 0; i < envelope.records.length; i += 1) {
                const entry = envelope.records[i];
                if (!validateCapabilityPacksRecord(entry).ok) {
                        return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', `loadPacksKit: the packs envelope's records[${i}] is not a valid capability-packs record`);
                }
                const packsRecord = entry as CapabilityPacksRecord;
                envelopeRecordMap.set(packsRecord.id, packsRecord);
        }
        const replayBytes = envelopeBytesOf(envelopeSeq, replayed);
        const envelopeBytes = envelopeBytesOf(envelopeSeq, envelopeRecordMap);
        if (replayBytes !== envelopeBytes) {
                return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', 'loadPacksKit: the packs envelope diverges from the ledger replay byte-for-byte (never silently rebuilt)');
        }
        return null;
}

// --- internal helpers (never exported) ---

/** Builds the canonical fixed-key-order bytes of one ledger line. */
function ledgerLineBytes(line: PacksOpsLedgerLine): string {
        return JSON.stringify({
                seq: line.seq,
                at: line.at,
                contractVersion: line.contractVersion,
                op: line.op,
                packsId: line.packsId,
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
 * (the industry string, the pack entry, or the caller-supplied
 * composed bodies record - the latter through the REAL DH-06 canonical
 * serializer, imported by reference and never re-implemented here).
 */
function payloadObject(payload: PacksOpsLedgerLine['payload']): HarnessIndustry | Record<string, unknown> | null {
        if (payload === null) {
                return null;
        }
        if (typeof payload === 'string') {
                return payload;
        }
        if ('bodyId' in payload) {
                return JSON.parse(serializeOrganizationDefaultsRecord(payload)) as Record<string, unknown>;
        }
        return { packKey: payload.packKey, summary: payload.summary, bodyRefs: [...payload.bodyRefs] };
}

/** Builds the canonical fixed-key-order bytes of the envelope (records sorted by id). */
function envelopeBytes(seq: number, nextRecords: Map<string, CapabilityPacksRecord>): string {
        const ids = [...nextRecords.keys()].sort();
        const listed = ids.map((id) => nextRecords.get(id) as CapabilityPacksRecord);
        return `{"contractVersion":${JSON.stringify(PACKS_CONTRACTS_VERSION)},"seq":${seq},"records":[${listed
                .map((record) => serializeCapabilityPacksRecord(record))
                .join(',')}]}`;
}

/** The envelope-bytes builder for the load cross-check (byte-for-byte against the persisted envelope). */
function envelopeBytesOf(seq: number, records: Map<string, CapabilityPacksRecord>): string {
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

function matchesRecordFilter(record: CapabilityPacksRecord, filter: Record<string, unknown>): boolean {
        if (filter.stage !== undefined && record.stage !== filter.stage) {
                return false;
        }
        if (filter.industry !== undefined && record.industry !== filter.industry) {
                return false;
        }
        if (filter.harnessId !== undefined && record.harnessId !== filter.harnessId) {
                return false;
        }
        return true;
}
